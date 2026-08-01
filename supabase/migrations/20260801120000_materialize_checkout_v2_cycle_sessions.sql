-- Complete the Checkout V2 runtime boundary without reopening the immutable
-- sale snapshot. Direct B2C checkout owns CRM authorization atomically, while
-- renewal scheduling consumes the persistent Madrid-local weekly allocation.

-- Europe/Madrid changes offset on Sundays inside the 02:00 local hour. A
-- weekly commercial slot in that hour would eventually produce either no
-- instant or two instants after the renewal has already been paid.
ALTER TABLE public.bookable_slots
    ADD CONSTRAINT bookable_slots_dst_safe_weekly_time_check
    CHECK (
        NOT (
            weekday = 0
            AND local_start_time >= TIME '02:00:00'
            AND local_start_time < TIME '03:00:00'
        )
    );

ALTER TABLE public.bookable_slots
    ADD CONSTRAINT bookable_slots_first_occurrence_whole_second_check
    CHECK (
        mod(
            EXTRACT(MICROSECONDS FROM first_occurrence_at)::NUMERIC,
            1000000
        ) = 0
    );

ALTER TABLE public.bookable_slot_occurrences
    ADD CONSTRAINT bookable_slot_occurrences_whole_second_check
    CHECK (
        mod(EXTRACT(MICROSECONDS FROM starts_at)::NUMERIC, 1000000) = 0
    );

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_cycle_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    expected_local_date DATE;
    expected_scheduled_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = NEW.subscription_id;

    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_cycle_id IS NOT NULL
       AND NEW.checkout_v2_cycle_id IS DISTINCT FROM OLD.checkout_v2_cycle_id THEN
        RAISE EXCEPTION 'checkout_v2_cycle_binding_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'sessions'
       AND subscription_row.contract_schema_version = 2
       AND NEW.checkout_v2_cycle_id IS NULL
       AND EXISTS (
            SELECT 1
            FROM public.checkout_v2_billing_state AS existing_billing
            WHERE existing_billing.subscription_id = NEW.subscription_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_session_requires_cycle'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_cycle_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE id = NEW.checkout_v2_cycle_id;

    IF cycle_row.id IS NULL
       OR cycle_row.subscription_id IS DISTINCT FROM NEW.subscription_id
       OR (
            TG_TABLE_NAME = 'payments'
            AND cycle_row.payment_id IS DISTINCT FROM NEW.id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_subscription_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'sessions'
       AND cycle_row.materialization_state = 'pending' THEN
        SELECT * INTO billing_row
        FROM public.checkout_v2_billing_state
        WHERE subscription_id = NEW.subscription_id;

        SELECT * INTO allocation_row
        FROM public.checkout_v2_weekly_allocations
        WHERE subscription_id = NEW.subscription_id
          AND status = 'active';

        IF cycle_row.cycle_kind IS DISTINCT FROM 'renewal'
           OR subscription_row.status IS DISTINCT FROM 'active'::public.subscription_status
           OR billing_row.subscription_id IS NULL
           OR billing_row.anchor_state IS DISTINCT FROM 'fixed'
           OR allocation_row.id IS NULL
           OR NEW.checkout_v2_cycle_session_index IS NULL THEN
            RAISE EXCEPTION 'checkout_v2_pending_cycle_session_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        expected_local_date :=
            (billing_row.first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
            + ((cycle_row.cycle_number - 1) * 28)
            + ((NEW.checkout_v2_cycle_session_index - 1) * 7);
        expected_scheduled_at :=
            (expected_local_date + allocation_row.local_start_time)
            AT TIME ZONE allocation_row.timezone_name;

        IF NEW.student_id IS DISTINCT FROM subscription_row.student_id
           OR NEW.teacher_id IS DISTINCT FROM allocation_row.teacher_id
           OR NEW.scheduled_at IS DISTINCT FROM expected_scheduled_at
           OR NEW.duration_minutes IS DISTINCT FROM allocation_row.duration_minutes::INTEGER
           OR NEW.status IS DISTINCT FROM 'scheduled' THEN
            RAISE EXCEPTION 'checkout_v2_pending_cycle_session_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_checkout_v2_cycle_binding()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.materialize_checkout_v2_cycle_sessions(
    p_subscription_id UUID,
    p_stripe_invoice_id TEXT
)
RETURNS public.checkout_v2_cycles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    first_local_date DATE;
    expected_session_count INTEGER;
    exact_sessions BOOLEAN;
BEGIN
    IF p_subscription_id IS NULL
       OR p_stripe_invoice_id IS NULL
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_v2_cycle_materialization'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE subscription_id = p_subscription_id
      AND stripe_invoice_id = p_stripe_invoice_id
    FOR UPDATE;

    IF cycle_row.id IS NOT NULL THEN
        SELECT * INTO payment_row
        FROM public.payments
        WHERE id = cycle_row.payment_id
        FOR UPDATE;
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_kind IS DISTINCT FROM 'renewal'
       OR cycle_row.cycle_number <= 1
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.stripe_invoice_id IS DISTINCT FROM cycle_row.stripe_invoice_id
       OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id THEN
        RAISE EXCEPTION 'checkout_v2_cycle_cannot_materialize_sessions'
            USING ERRCODE = '23514';
    END IF;

    SELECT
        COUNT(*),
        COALESCE(BOOL_AND(
            session_row.subscription_id = subscription_row.id
            AND session_row.student_id = subscription_row.student_id
            AND session_row.duration_minutes = 50
            AND session_row.checkout_v2_cycle_session_index BETWEEN 1 AND 4
        ), FALSE)
    INTO expected_session_count, exact_sessions
    FROM public.sessions AS session_row
    WHERE session_row.checkout_v2_cycle_id = cycle_row.id;

    IF cycle_row.materialization_state = 'ready' THEN
        IF expected_session_count IS DISTINCT FROM 4 OR NOT exact_sessions THEN
            RAISE EXCEPTION 'checkout_v2_materialized_cycle_is_inconsistent'
                USING ERRCODE = '23514';
        END IF;
        RETURN cycle_row;
    END IF;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations
    WHERE subscription_id = p_subscription_id
      AND status = 'active'
    FOR UPDATE;

    IF subscription_row.status IS DISTINCT FROM 'active'::public.subscription_status
       OR billing_row.subscription_id IS NULL
       OR billing_row.anchor_state IS DISTINCT FROM 'fixed'
       OR allocation_row.id IS NULL
       OR allocation_row.teacher_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_cycle_cannot_materialize_sessions'
            USING ERRCODE = '23514';
    END IF;

    first_local_date :=
        (billing_row.first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
        + ((cycle_row.cycle_number - 1) * 28);

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.generate_series(0, 3) AS occurrence(session_offset)
        CROSS JOIN LATERAL (
            SELECT
                first_local_date
                + (occurrence.session_offset * 7)
                + allocation_row.local_start_time AS local_occurrence_at
        ) AS target
        CROSS JOIN LATERAL (
            SELECT COUNT(*) AS matching_instants
            FROM pg_catalog.generate_series(
                (target.local_occurrence_at AT TIME ZONE allocation_row.timezone_name)
                    - INTERVAL '2 hours',
                (target.local_occurrence_at AT TIME ZONE allocation_row.timezone_name)
                    + INTERVAL '2 hours',
                INTERVAL '30 minutes'
            ) AS candidate(candidate_at)
            WHERE candidate.candidate_at AT TIME ZONE allocation_row.timezone_name
                = target.local_occurrence_at
        ) AS resolution
        WHERE resolution.matching_instants <> 1
    ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_local_schedule_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF cycle_row.materialization_state IS DISTINCT FROM 'pending'
       OR subscription_row.sessions_used IS DISTINCT FROM 0
       OR expected_session_count IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'checkout_v2_cycle_cannot_materialize_sessions'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(allocation_row.teacher_id::TEXT, 42850)
    );

    INSERT INTO public.sessions (
        subscription_id,
        student_id,
        teacher_id,
        scheduled_at,
        duration_minutes,
        status,
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    )
    SELECT
        subscription_row.id,
        subscription_row.student_id,
        allocation_row.teacher_id,
        (
            first_local_date
            + (occurrence.session_offset * 7)
            + allocation_row.local_start_time
        ) AT TIME ZONE allocation_row.timezone_name,
        allocation_row.duration_minutes,
        'scheduled',
        cycle_row.id,
        occurrence.session_offset + 1
    FROM pg_catalog.generate_series(0, 3) AS occurrence(session_offset);

    UPDATE public.subscriptions
    SET sessions_used = 4
    WHERE id = subscription_row.id
      AND status = 'active'
      AND sessions_used = 0;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_v2_cycle_quota_could_not_be_consumed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.checkout_v2_cycles
    SET
        materialization_state = 'ready',
        sessions_materialized_at = clock_timestamp()
    WHERE id = cycle_row.id
      AND materialization_state = 'pending'
    RETURNING * INTO cycle_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_v2_cycle_materialization_conflicts'
            USING ERRCODE = '40001';
    END IF;

    RETURN cycle_row;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_checkout_v2_cycle_sessions(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_checkout_v2_cycle_sessions(UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.claim_direct_checkout_intent_for_slot(
    p_student_id UUID,
    p_primary_email TEXT,
    p_full_name TEXT,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT,
    p_slot_public_id UUID
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    profile_row public.profiles%ROWTYPE;
    contact_row public.crm_contacts%ROWTYPE;
    opportunity_row public.crm_opportunities%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    intent_row public.checkout_intents%ROWTYPE;
    normalized_email TEXT := lower(btrim(p_primary_email));
    direct_claim_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_student_id IS NULL
       OR NULLIF(normalized_email, '') IS NULL
       OR position('@' IN normalized_email) <= 1
       OR p_package_price_id IS NULL
       OR p_lang IS NULL
       OR p_lang NOT IN ('es', 'en', 'ru')
       OR NULLIF(btrim(p_legal_policy_version), '') IS NULL
       OR NULLIF(btrim(p_site_url), '') IS NULL
       OR p_site_url !~ '^https?://'
       OR p_slot_public_id IS NULL THEN
        RAISE EXCEPTION 'invalid_direct_checkout_claim'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(normalized_email, 42852)
    );

    SELECT * INTO profile_row
    FROM public.profiles
    WHERE id = p_student_id
      AND role = 'student'
    FOR UPDATE;

    IF profile_row.id IS NULL
       OR lower(btrim(profile_row.email)) IS DISTINCT FROM normalized_email THEN
        RAISE EXCEPTION 'direct_checkout_student_identity_is_invalid'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = p_package_price_id
      AND status = 'active'
      AND contract_schema_version = 2
    FOR SHARE;
    IF price_row.id IS NULL THEN
        RAISE EXCEPTION 'direct_checkout_price_is_not_available'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO contact_row
    FROM public.crm_contacts
    WHERE profile_id = p_student_id
       OR lower(primary_email) = normalized_email
    ORDER BY CASE WHEN profile_id = p_student_id THEN 0 ELSE 1 END
    LIMIT 1
    FOR UPDATE;

    IF contact_row.id IS NOT NULL THEN
        IF (
            contact_row.profile_id IS NOT NULL
            AND contact_row.profile_id IS DISTINCT FROM p_student_id
        ) OR lower(btrim(contact_row.primary_email)) IS DISTINCT FROM normalized_email
           OR EXISTS (
                SELECT 1
                FROM public.crm_contacts AS conflicting_contact
                WHERE conflicting_contact.id <> contact_row.id
                  AND (
                        conflicting_contact.profile_id = p_student_id
                        OR lower(conflicting_contact.primary_email) = normalized_email
                  )
           ) THEN
            RAISE EXCEPTION 'direct_checkout_contact_identity_conflicts'
                USING ERRCODE = '23505';
        END IF;

        UPDATE public.crm_contacts
        SET
            profile_id = p_student_id,
            full_name = COALESCE(full_name, NULLIF(btrim(p_full_name), '')),
            preferred_language = COALESCE(preferred_language, p_lang)
        WHERE id = contact_row.id
        RETURNING * INTO contact_row;
    ELSE
        INSERT INTO public.crm_contacts (
            profile_id,
            primary_email,
            full_name,
            preferred_language,
            lifecycle_stage,
            source,
            source_path
        ) VALUES (
            p_student_id,
            normalized_email,
            NULLIF(btrim(p_full_name), ''),
            p_lang,
            'qualified',
            'direct_checkout',
            p_site_url
        )
        RETURNING * INTO contact_row;
    END IF;

    SELECT * INTO opportunity_row
    FROM public.crm_opportunities
    WHERE contact_id = contact_row.id
      AND checkout_approved_at IS NOT NULL
      AND converted_subscription_id IS NULL
    FOR UPDATE;

    IF opportunity_row.id IS NOT NULL THEN
        IF opportunity_row.stage IS DISTINCT FROM 'proposal'
           OR opportunity_row.preferred_package_id IS DISTINCT FROM price_row.package_id
           OR opportunity_row.interest IS DISTINCT FROM 'direct_checkout' THEN
            RAISE EXCEPTION 'direct_checkout_approval_conflicts'
                USING ERRCODE = '23505';
        END IF;
    ELSE
        INSERT INTO public.crm_opportunities (
            contact_id,
            stage,
            interest,
            preferred_package_id,
            checkout_approved_at,
            expected_value_cents,
            probability_percent
        ) VALUES (
            contact_row.id,
            'proposal',
            'direct_checkout',
            price_row.package_id,
            direct_claim_time,
            price_row.amount_cents,
            100
        )
        RETURNING * INTO opportunity_row;
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE public_id = p_slot_public_id
    FOR UPDATE;
    IF slot_row.id IS NULL
       OR slot_row.package_id IS DISTINCT FROM price_row.package_id THEN
        RAISE EXCEPTION 'direct_checkout_slot_is_not_available'
            USING ERRCODE = '23514';
    END IF;

    intent_row := public.claim_checkout_intent_for_slot(
        opportunity_row.id,
        contact_row.id,
        p_student_id,
        p_package_price_id,
        p_lang,
        p_legal_policy_version,
        p_site_url,
        slot_row.id
    );

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID
) TO service_role;

COMMENT ON FUNCTION public.materialize_checkout_v2_cycle_sessions(UUID, TEXT) IS
    'Idempotently materializes one paid Checkout V2 renewal into four Madrid-local weekly sessions.';
COMMENT ON FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID
) IS 'Atomically creates or reuses direct-sale CRM authorization, checkout intent and slot hold.';
