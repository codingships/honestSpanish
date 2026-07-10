-- Safe recovery for the crash window between creating a Stripe Checkout
-- Session and persisting its ID locally. A Stripe Customer snapshot is bound
-- to the intent before Session creation. An intent with no Session ID can be
-- abandoned only after its local recovery deadline and only for that exact
-- Customer; the application must first prove through Stripe pagination that
-- no Session carrying the intent metadata exists.

CREATE OR REPLACE FUNCTION public.claim_checkout_intent(
    p_opportunity_id UUID,
    p_contact_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    opportunity_row public.crm_opportunities%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    intent_row public.checkout_intents%ROWTYPE;
    claim_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_opportunity_id IS NULL
       OR p_contact_id IS NULL
       OR p_student_id IS NULL
       OR p_package_price_id IS NULL
       OR p_lang IS NULL
       OR p_lang NOT IN ('es', 'en', 'ru')
       OR NULLIF(btrim(p_legal_policy_version), '') IS NULL
       OR NULLIF(btrim(p_site_url), '') IS NULL
       OR p_site_url !~ '^https?://' THEN
        RAISE EXCEPTION 'invalid_checkout_intent_snapshot'
            USING ERRCODE = '22023';
    END IF;

    -- One stable profile row serializes every purchase attempt for a student.
    PERFORM 1
    FROM public.profiles
    WHERE id = p_student_id
      AND role = 'student'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_student_is_not_available'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO opportunity_row
    FROM public.crm_opportunities
    WHERE id = p_opportunity_id
    FOR UPDATE;

    IF NOT FOUND
       OR opportunity_row.contact_id IS DISTINCT FROM p_contact_id
       OR opportunity_row.stage <> 'proposal'
       OR opportunity_row.checkout_approved_at IS NULL
       OR opportunity_row.converted_subscription_id IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_approval_is_not_available'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = p_package_price_id
      AND status = 'active';

    IF NOT FOUND
       OR price_row.package_id IS DISTINCT FROM opportunity_row.preferred_package_id THEN
        RAISE EXCEPTION 'checkout_price_is_not_approved'
            USING ERRCODE = '42501';
    END IF;

    -- A completed intent whose opportunity has not yet been converted is a
    -- paid purchase under reconciliation, not capacity for a second purchase.
    -- Return it under the same student lock so the caller fails closed.
    SELECT checkout_intent.* INTO intent_row
    FROM public.checkout_intents AS checkout_intent
    JOIN public.crm_opportunities AS intent_opportunity
      ON intent_opportunity.id = checkout_intent.opportunity_id
    WHERE (
        checkout_intent.status IN ('creating', 'open')
        OR (
            checkout_intent.status = 'completed'
            AND intent_opportunity.converted_subscription_id IS NULL
        )
    )
      AND (
          checkout_intent.student_id = p_student_id
          OR checkout_intent.opportunity_id = p_opportunity_id
      )
    ORDER BY
        CASE checkout_intent.status
            WHEN 'completed' THEN 0
            WHEN 'open' THEN 1
            ELSE 2
        END,
        checkout_intent.created_at DESC
    LIMIT 1
    FOR UPDATE OF checkout_intent;

    IF FOUND THEN
        RETURN intent_row;
    END IF;

    INSERT INTO public.checkout_intents (
        opportunity_id,
        contact_id,
        student_id,
        package_price_id,
        lang,
        legal_policy_version,
        policy_accepted_at,
        site_url,
        status,
        stripe_session_expires_at,
        expires_at
    ) VALUES (
        p_opportunity_id,
        p_contact_id,
        p_student_id,
        p_package_price_id,
        p_lang,
        p_legal_policy_version,
        claim_time,
        p_site_url,
        'creating',
        claim_time + INTERVAL '1 hour',
        claim_time + INTERVAL '2 hours'
    )
    RETURNING * INTO intent_row;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.snapshot_checkout_intent_customer(
    p_intent_id UUID,
    p_stripe_customer_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    IF p_intent_id IS NULL
       OR p_stripe_customer_id IS NULL
       OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_customer_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status <> 'creating'
       OR intent_row.stripe_checkout_session_id IS NOT NULL
       OR intent_row.completed_at IS NOT NULL
       OR (
           intent_row.stripe_customer_id IS NOT NULL
           AND intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id
       ) THEN
        RAISE EXCEPTION 'checkout_intent_customer_cannot_be_snapshotted'
            USING ERRCODE = '42501';
    END IF;

    IF intent_row.stripe_customer_id IS NULL THEN
        UPDATE public.checkout_intents
        SET
            stripe_customer_id = p_stripe_customer_id,
            updated_at = clock_timestamp()
        WHERE id = p_intent_id
        RETURNING * INTO intent_row;
    END IF;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_checkout_intent_customer(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_checkout_intent_customer(UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.release_abandoned_checkout_intent(
    p_intent_id UUID,
    p_stripe_customer_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    IF p_intent_id IS NULL
       OR p_stripe_customer_id IS NULL
       OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_abandoned_checkout_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status <> 'creating'
       OR intent_row.stripe_checkout_session_id IS NOT NULL
       OR intent_row.completed_at IS NOT NULL
       OR intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id
       OR intent_row.expires_at > clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_intent_cannot_be_abandoned'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.checkout_intents
    SET
        status = 'expired',
        updated_at = clock_timestamp()
    WHERE id = p_intent_id
    RETURNING * INTO intent_row;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_checkout_intent(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_abandoned_checkout_intent(UUID, TEXT)
    TO service_role;
