-- A hold fingerprint is an opaque, server-computed HMAC of the normalized
-- client address. It is capacity-control state, never a raw network address.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE status = 'held'
    ) THEN
        RAISE EXCEPTION 'checkout_hold_fingerprint_migration_requires_no_live_holds'
            USING ERRCODE = '55000';
    END IF;
END
$$;

ALTER TABLE public.bookable_slot_holds
    ADD COLUMN hold_fingerprint TEXT;

ALTER TABLE public.bookable_slot_holds
    ADD CONSTRAINT bookable_slot_holds_fingerprint_lifecycle_check CHECK (
        (
            status = 'held'
            AND hold_fingerprint IS NOT NULL
            AND hold_fingerprint ~ '^v1:[0-9a-f]{64}$'
        )
        OR (
            status IN ('consumed', 'expired', 'released')
            AND hold_fingerprint IS NULL
        )
    );

CREATE UNIQUE INDEX bookable_slot_holds_one_live_fingerprint_idx
    ON public.bookable_slot_holds(hold_fingerprint)
    WHERE status = 'held';

-- A creating intent that never acquired a Stripe Customer cannot have created
-- a Checkout Session. Once its durable expiry passes, expiring it is the only
-- safe transition needed to release abandoned inventory. Intents with any
-- Stripe snapshot continue to require provider-backed reconciliation.
CREATE OR REPLACE FUNCTION private.guard_checkout_intent_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.id,
        NEW.opportunity_id,
        NEW.contact_id,
        NEW.student_id,
        NEW.package_price_id,
        NEW.lang,
        NEW.legal_policy_version,
        NEW.policy_accepted_at,
        NEW.site_url,
        NEW.stripe_session_expires_at,
        NEW.expires_at,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.opportunity_id,
        OLD.contact_id,
        OLD.student_id,
        OLD.package_price_id,
        OLD.lang,
        OLD.legal_policy_version,
        OLD.policy_accepted_at,
        OLD.site_url,
        OLD.stripe_session_expires_at,
        OLD.expires_at,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION 'checkout_intent_snapshot_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.stripe_customer_id IS NOT NULL
       AND NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
        RAISE EXCEPTION 'checkout_intent_customer_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.stripe_checkout_session_id IS NOT NULL
       AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
        RAISE EXCEPTION 'checkout_intent_session_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'creating' THEN
        IF OLD.stripe_customer_id IS NULL
           AND OLD.stripe_checkout_session_id IS NULL
           AND OLD.completed_at IS NULL
           AND OLD.expires_at <= clock_timestamp()
           AND NEW.status = 'expired'
           AND NEW.stripe_customer_id IS NULL
           AND NEW.stripe_checkout_session_id IS NULL
           AND NEW.completed_at IS NULL THEN
            RETURN NEW;
        END IF;

        IF NEW.status = 'creating'
           AND OLD.stripe_customer_id IS NULL
           AND NEW.stripe_customer_id IS NOT NULL
           AND NEW.stripe_checkout_session_id IS NULL
           AND NEW.completed_at IS NULL THEN
            RETURN NEW;
        END IF;

        IF NEW.stripe_customer_id IS NOT NULL
           AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id
           AND (
               (
                   NEW.status = 'open'
                   AND NEW.stripe_checkout_session_id IS NOT NULL
                   AND NEW.completed_at IS NULL
               )
               OR (
                   NEW.status = 'completed'
                   AND NEW.stripe_checkout_session_id IS NOT NULL
                   AND NEW.completed_at IS NOT NULL
               )
               OR (
                   NEW.status = 'expired'
                   AND NEW.completed_at IS NULL
               )
           ) THEN
            RETURN NEW;
        END IF;
    ELSIF OLD.status = 'open' THEN
        IF NEW.stripe_customer_id IS NOT NULL
           AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id
           AND NEW.stripe_checkout_session_id IS NOT DISTINCT FROM OLD.stripe_checkout_session_id
           AND (
               (
                   NEW.status = 'completed'
                   AND NEW.completed_at IS NOT NULL
               )
               OR (
                   NEW.status = 'expired'
                   AND NEW.completed_at IS NULL
               )
           ) THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'checkout_intent_transition_is_not_allowed'
        USING ERRCODE = '23514';
END;
$$;

REVOKE ALL ON FUNCTION private.guard_checkout_intent_snapshots()
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    occurrence_count INTEGER;
    occurrences_future BOOLEAN;
BEGIN
    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = NEW.checkout_intent_id;
    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = NEW.slot_id;

    IF intent_row.id IS NULL
       OR slot_row.id IS NULL
       OR NEW.expires_at IS DISTINCT FROM intent_row.expires_at
       OR NOT EXISTS (
           SELECT 1
           FROM public.package_prices
           WHERE id = intent_row.package_price_id
             AND package_id = slot_row.package_id
             AND contract_schema_version = 2
       ) THEN
        RAISE EXCEPTION 'bookable_slot_hold_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT * INTO package_row
        FROM public.packages
        WHERE id = slot_row.package_id;

        SELECT * INTO price_row
        FROM public.package_prices
        WHERE id = intent_row.package_price_id;

        SELECT
            COUNT(*),
            COALESCE(BOOL_AND(starts_at > clock_timestamp()), FALSE)
        INTO occurrence_count, occurrences_future
        FROM public.bookable_slot_occurrences
        WHERE slot_id = slot_row.id;

        IF NEW.status <> 'held'
           OR NEW.hold_fingerprint IS NULL
           OR NEW.hold_fingerprint !~ '^v1:[0-9a-f]{64}$'
           OR intent_row.status NOT IN ('creating', 'open')
           OR intent_row.expires_at <= clock_timestamp()
           OR slot_row.status <> 'available'
           OR slot_row.sessions_materialized_at IS NOT NULL
           OR package_row.id IS NULL
           OR NOT package_row.is_active
           OR NOT package_row.is_publicly_listed
           OR package_row.contract_schema_version <> 2
           OR package_row.name <> 'individual_4x50_28d'
           OR price_row.id IS NULL
           OR price_row.status <> 'active'
           OR price_row.amount_cents <> 25900
           OR price_row.currency <> 'eur'
           OR price_row.billing_interval_unit <> 'day'
           OR price_row.billing_interval_count <> 28
           OR price_row.sessions_per_period <> 4
           OR price_row.class_duration_minutes <> 50
           OR occurrence_count <> 4
           OR NOT occurrences_future
           OR slot_row.first_occurrence_at <= intent_row.expires_at THEN
            RAISE EXCEPTION 'bookable_slot_hold_cannot_start'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF ROW(
            NEW.id,
            NEW.slot_id,
            NEW.checkout_intent_id,
            NEW.held_at,
            NEW.expires_at,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.id,
            OLD.slot_id,
            OLD.checkout_intent_id,
            OLD.held_at,
            OLD.expires_at,
            OLD.created_at
        ) THEN
            RAISE EXCEPTION 'bookable_slot_hold_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status = 'held'
           AND NEW.status = 'held'
           AND NEW.hold_fingerprint IS DISTINCT FROM OLD.hold_fingerprint THEN
            RAISE EXCEPTION 'bookable_slot_hold_fingerprint_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NOT (
            NEW.status = OLD.status
            OR (OLD.status = 'held' AND NEW.status IN ('consumed', 'expired', 'released'))
        ) THEN
            RAISE EXCEPTION 'bookable_slot_hold_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status <> 'held' AND ROW(
            NEW.closed_at,
            NEW.close_reason,
            NEW.subscription_id,
            NEW.hold_fingerprint
        ) IS DISTINCT FROM ROW(
            OLD.closed_at,
            OLD.close_reason,
            OLD.subscription_id,
            OLD.hold_fingerprint
        ) THEN
            RAISE EXCEPTION 'terminal_bookable_slot_hold_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status IN ('expired', 'released')
       AND intent_row.status <> 'expired' THEN
        RAISE EXCEPTION 'bookable_slot_hold_release_requires_expired_checkout'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'consumed' THEN
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = NEW.subscription_id;

        IF intent_row.status <> 'completed'
           OR subscription_row.id IS NULL
           OR subscription_row.student_id IS DISTINCT FROM intent_row.student_id
           OR subscription_row.package_id IS DISTINCT FROM slot_row.package_id
           OR subscription_row.package_price_id IS DISTINCT FROM intent_row.package_price_id
           OR subscription_row.checkout_intent_id IS DISTINCT FROM intent_row.id
           OR subscription_row.contract_schema_version <> 2
           OR subscription_row.status <> 'active'
           OR subscription_row.stripe_subscription_id IS NULL THEN
            RAISE EXCEPTION 'bookable_slot_hold_consumption_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status <> 'held' THEN
        NEW.hold_fingerprint := NULL;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_hold()
    FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID
);
DROP FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID
);
DROP FUNCTION public.hold_bookable_slot(UUID, UUID);

CREATE OR REPLACE FUNCTION public.hold_bookable_slot(
    p_slot_id UUID,
    p_checkout_intent_id UUID,
    p_hold_fingerprint TEXT
)
RETURNS public.bookable_slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    occurrence_count INTEGER;
    occurrences_future BOOLEAN;
BEGIN
    IF p_slot_id IS NULL
       OR p_checkout_intent_id IS NULL
       OR p_hold_fingerprint IS NULL
       OR p_hold_fingerprint !~ '^v1:[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_intent_cannot_hold_slot'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id
    FOR UPDATE;

    IF FOUND THEN
        IF hold_row.slot_id IS DISTINCT FROM p_slot_id
           OR hold_row.status <> 'held' THEN
            RAISE EXCEPTION 'checkout_intent_already_has_another_slot_state'
                USING ERRCODE = '23514';
        END IF;
        RETURN hold_row;
    END IF;

    IF intent_row.status NOT IN ('creating', 'open')
       OR intent_row.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_intent_cannot_hold_slot'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_hold_fingerprint, 72941)
    );

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND OR slot_row.status <> 'available' THEN
        RAISE EXCEPTION 'bookable_slot_is_not_available'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = slot_row.package_id
    FOR SHARE;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = intent_row.package_price_id
    FOR SHARE;

    SELECT
        COUNT(*),
        COALESCE(BOOL_AND(starts_at > clock_timestamp()), FALSE)
    INTO occurrence_count, occurrences_future
    FROM public.bookable_slot_occurrences
    WHERE slot_id = slot_row.id;

    IF package_row.id IS NULL
       OR NOT package_row.is_active
       OR NOT package_row.is_publicly_listed
       OR package_row.contract_schema_version <> 2
       OR package_row.name <> 'individual_4x50_28d'
       OR package_row.amount_cents <> 25900
       OR package_row.billing_interval_unit <> 'day'
       OR package_row.billing_interval_count <> 28
       OR package_row.sessions_per_period <> 4
       OR package_row.class_duration_minutes <> 50
       OR price_row.id IS NULL
       OR price_row.package_id IS DISTINCT FROM slot_row.package_id
       OR price_row.contract_schema_version <> 2
       OR price_row.status <> 'active'
       OR price_row.amount_cents <> 25900
       OR price_row.currency <> 'eur'
       OR price_row.billing_interval_unit <> 'day'
       OR price_row.billing_interval_count <> 28
       OR price_row.sessions_per_period <> 4
       OR price_row.class_duration_minutes <> 50
       OR occurrence_count <> 4
       OR NOT occurrences_future
       OR slot_row.first_occurrence_at <= intent_row.expires_at
       OR NOT EXISTS (
           SELECT 1
           FROM public.teacher_availability
           WHERE teacher_id = slot_row.teacher_id
             AND is_active = TRUE
             AND day_of_week = slot_row.weekday
             AND start_time <= slot_row.local_start_time
             AND end_time >= slot_row.local_start_time + INTERVAL '50 minutes'
             AND slot_row.local_start_time + INTERVAL '50 minutes' > slot_row.local_start_time
       ) THEN
        RAISE EXCEPTION 'checkout_intent_offer_does_not_match_slot'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.checkout_intents AS stale_intent
    SET
        status = 'expired',
        updated_at = clock_timestamp()
    FROM public.bookable_slot_holds AS stale_hold
    WHERE stale_hold.checkout_intent_id = stale_intent.id
      AND stale_hold.status = 'held'
      AND (
          stale_hold.slot_id = p_slot_id
          OR stale_hold.hold_fingerprint = p_hold_fingerprint
      )
      AND stale_intent.status = 'creating'
      AND stale_intent.expires_at <= clock_timestamp()
      AND stale_intent.stripe_customer_id IS NULL
      AND stale_intent.stripe_checkout_session_id IS NULL
      AND stale_intent.completed_at IS NULL;

    UPDATE public.bookable_slot_holds AS stale_hold
    SET
        status = 'expired',
        closed_at = clock_timestamp(),
        close_reason = 'checkout_expired'
    FROM public.checkout_intents AS stale_intent
    WHERE stale_hold.status = 'held'
      AND stale_intent.id = stale_hold.checkout_intent_id
      AND stale_intent.status = 'expired'
      AND (
          stale_hold.slot_id = p_slot_id
          OR stale_hold.hold_fingerprint = p_hold_fingerprint
      );

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE slot_id = p_slot_id AND status = 'held'
    ) THEN
        RAISE EXCEPTION 'bookable_slot_is_held'
            USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE hold_fingerprint = p_hold_fingerprint
          AND status = 'held'
    ) THEN
        RAISE EXCEPTION 'checkout_hold_fingerprint_already_active'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.bookable_slot_holds (
        slot_id,
        checkout_intent_id,
        hold_fingerprint,
        expires_at
    ) VALUES (
        p_slot_id,
        p_checkout_intent_id,
        p_hold_fingerprint,
        intent_row.expires_at
    )
    RETURNING * INTO hold_row;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_bookable_slot(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_bookable_slot(UUID, UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.claim_checkout_intent_for_slot(
    p_opportunity_id UUID,
    p_contact_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT,
    p_slot_id UUID,
    p_hold_fingerprint TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    intent_row := public.claim_checkout_intent(
        p_opportunity_id,
        p_contact_id,
        p_student_id,
        p_package_price_id,
        p_lang,
        p_legal_policy_version,
        p_site_url
    );

    PERFORM public.hold_bookable_slot(
        p_slot_id,
        intent_row.id,
        p_hold_fingerprint
    );
    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_direct_checkout_intent_for_slot(
    p_student_id UUID,
    p_primary_email TEXT,
    p_full_name TEXT,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT,
    p_slot_public_id UUID,
    p_hold_fingerprint TEXT
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
       OR p_slot_public_id IS NULL
       OR p_hold_fingerprint IS NULL
       OR p_hold_fingerprint !~ '^v1:[0-9a-f]{64}$' THEN
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
        slot_row.id,
        p_hold_fingerprint
    );

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) TO service_role;

COMMENT ON COLUMN public.bookable_slot_holds.hold_fingerprint IS
    'Opaque HMAC fingerprint used only to limit simultaneous live checkout holds; raw network addresses are never stored.';
COMMENT ON FUNCTION public.claim_direct_checkout_intent_for_slot(
    UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) IS 'Atomically creates or reuses direct-sale CRM authorization, checkout intent and a network-scoped slot hold.';
