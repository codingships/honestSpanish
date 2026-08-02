-- A legal-policy rotation may replace only a pre-Stripe creating intent. The
-- former intent and hold remain as immutable evidence in terminal states.
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
           AND (
               OLD.expires_at <= clock_timestamp()
               OR current_setting(
                   'app.checkout_policy_rotation_intent_id',
                   TRUE
               ) = OLD.id::TEXT
           )
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
    rotated_intent_id UUID;
    rotation_time TIMESTAMPTZ;
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

    IF intent_row.legal_policy_version IS DISTINCT FROM p_legal_policy_version THEN
        -- A Customer, Session, payment completion, or non-creating state is a
        -- provider-backed snapshot. Return it unchanged so the caller can
        -- fail closed and reconcile it; never release its inventory here.
        IF intent_row.status <> 'creating'
           OR intent_row.stripe_customer_id IS NOT NULL
           OR intent_row.stripe_checkout_session_id IS NOT NULL
           OR intent_row.completed_at IS NOT NULL THEN
            RETURN intent_row;
        END IF;

        rotated_intent_id := intent_row.id;
        rotation_time := clock_timestamp();

        PERFORM set_config(
            'app.checkout_policy_rotation_intent_id',
            rotated_intent_id::TEXT,
            TRUE
        );

        UPDATE public.checkout_intents
        SET
            status = 'expired',
            updated_at = rotation_time
        WHERE id = rotated_intent_id
          AND status = 'creating'
          AND legal_policy_version IS DISTINCT FROM p_legal_policy_version
          AND stripe_customer_id IS NULL
          AND stripe_checkout_session_id IS NULL
          AND completed_at IS NULL;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'checkout_policy_rotation_conflict'
                USING ERRCODE = '40001';
        END IF;

        PERFORM set_config(
            'app.checkout_policy_rotation_intent_id',
            '',
            TRUE
        );

        UPDATE public.bookable_slot_holds
        SET
            status = 'expired',
            closed_at = rotation_time,
            close_reason = 'legal_policy_version_rotated'
        WHERE checkout_intent_id = rotated_intent_id
          AND status = 'held';

        intent_row := public.claim_checkout_intent(
            p_opportunity_id,
            p_contact_id,
            p_student_id,
            p_package_price_id,
            p_lang,
            p_legal_policy_version,
            p_site_url
        );

        IF intent_row.status <> 'creating'
           OR intent_row.legal_policy_version IS DISTINCT FROM p_legal_policy_version
           OR intent_row.stripe_customer_id IS NOT NULL
           OR intent_row.stripe_checkout_session_id IS NOT NULL
           OR intent_row.completed_at IS NOT NULL THEN
            RAISE EXCEPTION 'checkout_policy_rotation_did_not_create_successor'
                USING ERRCODE = '40001';
        END IF;
    END IF;

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

COMMENT ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT
) IS 'Atomically rotates pre-Stripe checkout evidence when the accepted legal policy changes, then acquires the requested slot hold.';
