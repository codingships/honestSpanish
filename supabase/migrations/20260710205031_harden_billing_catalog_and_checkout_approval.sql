-- Preserve immutable Stripe offers, freeze subscription quotas and require an
-- explicit CRM approval before checkout. All new billing history is server-only.

ALTER TABLE public.packages
    ADD COLUMN IF NOT EXISTS catalog_version BIGINT NOT NULL DEFAULT 1;

ALTER TABLE public.profiles_private
    ADD COLUMN IF NOT EXISTS stripe_customer_account_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_customer_livemode BOOLEAN;

ALTER TABLE public.profiles_private
    DROP CONSTRAINT IF EXISTS profiles_private_stripe_customer_environment_check;
ALTER TABLE public.profiles_private
    ADD CONSTRAINT profiles_private_stripe_customer_environment_check CHECK (
        (
            stripe_customer_id IS NULL
            AND stripe_customer_account_id IS NULL
            AND stripe_customer_livemode IS NULL
        )
        OR (
            stripe_customer_id IS NOT NULL
            AND (
                (
                    stripe_customer_account_id IS NULL
                    AND stripe_customer_livemode IS NULL
                )
                OR (
                    stripe_customer_account_id ~ '^acct_[A-Za-z0-9_]+$'
                    AND stripe_customer_livemode IS NOT NULL
                )
            )
        )
    );

ALTER TABLE public.packages
    DROP CONSTRAINT IF EXISTS packages_catalog_version_positive;
ALTER TABLE public.packages
    ADD CONSTRAINT packages_catalog_version_positive CHECK (catalog_version > 0);

CREATE TABLE IF NOT EXISTS public.package_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
    catalog_version BIGINT NOT NULL CHECK (catalog_version > 0),
    package_key TEXT NOT NULL,
    display_name JSONB NOT NULL,
    duration_months SMALLINT NOT NULL CHECK (duration_months IN (1, 3, 6)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
    sessions_per_month INTEGER NOT NULL CHECK (sessions_per_month > 0),
    sessions_per_period INTEGER NOT NULL CHECK (
        sessions_per_period > 0
        AND sessions_per_period = sessions_per_month * duration_months
    ),
    has_group_session BOOLEAN NOT NULL DEFAULT FALSE,
    has_dual_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_account_id TEXT CHECK (
        stripe_account_id IS NULL
        OR stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'
    ),
    stripe_livemode BOOLEAN NOT NULL,
    stripe_product_id TEXT NOT NULL CHECK (stripe_product_id ~ '^prod_[A-Za-z0-9_]+$'),
    stripe_price_id TEXT NOT NULL UNIQUE CHECK (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT package_prices_lifecycle_check CHECK (
        (status = 'active' AND retired_at IS NULL)
        OR (status = 'retired' AND retired_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS package_prices_one_active_duration_idx
    ON public.package_prices(package_id, duration_months)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS package_prices_package_version_idx
    ON public.package_prices(package_id, catalog_version);

-- Existing linked objects in both current databases were audited as Stripe test
-- mode before this migration. The account ID is intentionally left unknown; all
-- offers activated by the new code must record it.
INSERT INTO public.package_prices (
    package_id,
    catalog_version,
    package_key,
    display_name,
    duration_months,
    amount_cents,
    currency,
    sessions_per_month,
    sessions_per_period,
    has_group_session,
    has_dual_teacher,
    stripe_account_id,
    stripe_livemode,
    stripe_product_id,
    stripe_price_id,
    status,
    activated_at,
    created_at
)
SELECT
    package_row.id,
    package_row.catalog_version,
    package_row.name,
    package_row.display_name,
    price_row.duration_months,
    price_row.amount_cents,
    'eur',
    package_row.sessions_per_month,
    package_row.sessions_per_month * price_row.duration_months,
    COALESCE(package_row.has_group_session, FALSE),
    COALESCE(package_row.has_dual_teacher, FALSE),
    NULL,
    FALSE,
    package_row.stripe_product_id,
    price_row.stripe_price_id,
    'active',
    COALESCE(package_row.updated_at, package_row.created_at, NOW()),
    COALESCE(package_row.updated_at, package_row.created_at, NOW())
FROM public.packages AS package_row
CROSS JOIN LATERAL (
    VALUES
        (1::SMALLINT, package_row.stripe_price_1m, package_row.price_monthly),
        (
            3::SMALLINT,
            package_row.stripe_price_3m,
            ROUND(package_row.price_monthly::NUMERIC * 3 * 90 / 100)::INTEGER
        ),
        (
            6::SMALLINT,
            package_row.stripe_price_6m,
            ROUND(package_row.price_monthly::NUMERIC * 6 * 80 / 100)::INTEGER
        )
) AS price_row(duration_months, stripe_price_id, amount_cents)
WHERE package_row.stripe_product_id IS NOT NULL
  AND price_row.stripe_price_id IS NOT NULL
ON CONFLICT (stripe_price_id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.guard_package_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.package_id,
        NEW.catalog_version,
        NEW.package_key,
        NEW.display_name,
        NEW.duration_months,
        NEW.amount_cents,
        NEW.currency,
        NEW.sessions_per_month,
        NEW.sessions_per_period,
        NEW.has_group_session,
        NEW.has_dual_teacher,
        NEW.stripe_livemode,
        NEW.stripe_product_id,
        NEW.stripe_price_id,
        NEW.activated_at,
        NEW.created_by,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.package_id,
        OLD.catalog_version,
        OLD.package_key,
        OLD.display_name,
        OLD.duration_months,
        OLD.amount_cents,
        OLD.currency,
        OLD.sessions_per_month,
        OLD.sessions_per_period,
        OLD.has_group_session,
        OLD.has_dual_teacher,
        OLD.stripe_livemode,
        OLD.stripe_product_id,
        OLD.stripe_price_id,
        OLD.activated_at,
        OLD.created_by,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION 'package_price_commercial_fields_are_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.stripe_account_id IS NOT NULL
       AND NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id THEN
        RAISE EXCEPTION 'package_price_stripe_account_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'retired'
       AND (
           NEW.status IS DISTINCT FROM OLD.status
           OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
       ) THEN
        RAISE EXCEPTION 'retired_package_price_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_package_price_history()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_package_price_history_trigger ON public.package_prices;
CREATE TRIGGER guard_package_price_history_trigger
    BEFORE UPDATE ON public.package_prices
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_package_price_history();

CREATE OR REPLACE FUNCTION private.version_package_catalog()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.name,
        NEW.display_name,
        NEW.price_monthly,
        NEW.sessions_per_month,
        NEW.has_group_session,
        NEW.has_dual_teacher
    ) IS DISTINCT FROM ROW(
        OLD.name,
        OLD.display_name,
        OLD.price_monthly,
        OLD.sessions_per_month,
        OLD.has_group_session,
        OLD.has_dual_teacher
    ) THEN
        NEW.catalog_version := OLD.catalog_version + 1;

        UPDATE public.package_prices
        SET status = 'retired', retired_at = clock_timestamp()
        WHERE package_id = OLD.id
          AND status = 'active';

        NEW.stripe_price_1m := NULL;
        NEW.stripe_price_3m := NULL;
        NEW.stripe_price_6m := NULL;
    ELSE
        NEW.catalog_version := OLD.catalog_version;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.version_package_catalog()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS version_package_catalog_trigger ON public.packages;
CREATE TRIGGER version_package_catalog_trigger
    BEFORE UPDATE ON public.packages
    FOR EACH ROW
    EXECUTE FUNCTION private.version_package_catalog();

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS package_price_id UUID
        REFERENCES public.package_prices(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS contracted_sessions_per_period INTEGER;

UPDATE public.subscriptions
SET contracted_sessions_per_period = sessions_total
WHERE contracted_sessions_per_period IS NULL;

ALTER TABLE public.subscriptions
    ALTER COLUMN contracted_sessions_per_period SET NOT NULL;

ALTER TABLE public.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_contracted_sessions_positive;
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_contracted_sessions_positive
        CHECK (contracted_sessions_per_period > 0);

CREATE INDEX IF NOT EXISTS subscriptions_package_price_idx
    ON public.subscriptions(package_price_id)
    WHERE package_price_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_unique_idx
    ON public.subscriptions(stripe_subscription_id)
    WHERE stripe_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_invoice_unique_idx
    ON public.payments(stripe_invoice_id)
    WHERE stripe_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.enforce_subscription_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    contract_price public.package_prices%ROWTYPE;
BEGIN
    IF NEW.contracted_sessions_per_period IS NULL THEN
        NEW.contracted_sessions_per_period := NEW.sessions_total;
    END IF;

    IF NEW.contracted_sessions_per_period <= 0 THEN
        RAISE EXCEPTION 'invalid_contracted_sessions_per_period'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.student_id IS DISTINCT FROM OLD.student_id
           OR NEW.package_id IS DISTINCT FROM OLD.package_id
           OR NEW.duration_months IS DISTINCT FROM OLD.duration_months
           OR NEW.contracted_sessions_per_period IS DISTINCT FROM OLD.contracted_sessions_per_period THEN
            RAISE EXCEPTION 'subscription_contract_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.package_price_id IS NOT NULL
           AND NEW.package_price_id IS DISTINCT FROM OLD.package_price_id THEN
            RAISE EXCEPTION 'subscription_package_price_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.stripe_subscription_id IS NOT NULL
           AND NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
            RAISE EXCEPTION 'subscription_stripe_id_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.package_price_id IS NOT NULL THEN
        SELECT * INTO contract_price
        FROM public.package_prices
        WHERE id = NEW.package_price_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'package_price_not_found'
                USING ERRCODE = '23503';
        END IF;

        IF contract_price.package_id IS DISTINCT FROM NEW.package_id
           OR contract_price.duration_months IS DISTINCT FROM NEW.duration_months
           OR contract_price.sessions_per_period IS DISTINCT FROM NEW.contracted_sessions_per_period THEN
            RAISE EXCEPTION 'subscription_contract_does_not_match_package_price'
                USING ERRCODE = '23514';
        END IF;

        IF TG_OP = 'INSERT'
           AND NEW.sessions_total IS DISTINCT FROM contract_price.sessions_per_period THEN
            RAISE EXCEPTION 'initial_subscription_quota_does_not_match_contract'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_subscription_contract()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_subscription_contract_trigger ON public.subscriptions;
CREATE TRIGGER enforce_subscription_contract_trigger
    BEFORE INSERT OR UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_subscription_contract();

CREATE OR REPLACE FUNCTION public.apply_subscription_renewal(
    p_subscription_id UUID,
    p_stripe_subscription_id TEXT,
    p_stripe_invoice_id TEXT,
    p_new_ends_at DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
BEGIN
    IF p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_renewal_identifiers'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF NOT FOUND
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id THEN
        RAISE EXCEPTION 'renewal_subscription_does_not_match'
            USING ERRCODE = '42501';
    END IF;

    IF subscription_row.stripe_invoice_id = p_stripe_invoice_id
       OR p_new_ends_at <= subscription_row.ends_at THEN
        RETURN FALSE;
    END IF;

    UPDATE public.subscriptions
    SET
        ends_at = p_new_ends_at,
        sessions_total = subscription_row.contracted_sessions_per_period,
        sessions_used = 0,
        status = 'active',
        stripe_invoice_id = p_stripe_invoice_id
    WHERE id = p_subscription_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_stripe_refund(
    p_payment_id UUID,
    p_amount_refunded INTEGER,
    p_stripe_refund_id TEXT,
    p_refunded_at TIMESTAMPTZ
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    payment_row public.payments%ROWTYPE;
    effective_amount INTEGER;
BEGIN
    IF p_amount_refunded < 0
       OR p_stripe_refund_id !~ '^re_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_refund_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'refund_payment_not_found'
            USING ERRCODE = '23503';
    END IF;

    effective_amount := LEAST(
        payment_row.amount,
        GREATEST(COALESCE(payment_row.amount_refunded, 0), p_amount_refunded)
    );

    UPDATE public.payments
    SET
        amount_refunded = effective_amount,
        stripe_refund_id = CASE
            WHEN p_amount_refunded > COALESCE(payment_row.amount_refunded, 0)
              OR (
                  p_amount_refunded = COALESCE(payment_row.amount_refunded, 0)
                  AND p_refunded_at >= COALESCE(payment_row.refunded_at, '-infinity'::TIMESTAMPTZ)
              )
                THEN p_stripe_refund_id
            ELSE payment_row.stripe_refund_id
        END,
        refunded_at = GREATEST(
            COALESCE(payment_row.refunded_at, '-infinity'::TIMESTAMPTZ),
            p_refunded_at
        ),
        status = CASE
            WHEN effective_amount >= payment_row.amount THEN 'refunded'::public.payment_status
            ELSE payment_row.status
        END
    WHERE id = p_payment_id
    RETURNING * INTO payment_row;

    RETURN payment_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stripe_refund(UUID, INTEGER, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stripe_refund(UUID, INTEGER, TEXT, TIMESTAMPTZ)
    TO service_role;

ALTER TABLE public.crm_opportunities
    ADD COLUMN IF NOT EXISTS checkout_approved_at TIMESTAMPTZ;

ALTER TABLE public.crm_opportunities
    DROP CONSTRAINT IF EXISTS crm_opportunities_checkout_approval_package_required;
ALTER TABLE public.crm_opportunities
    ADD CONSTRAINT crm_opportunities_checkout_approval_package_required CHECK (
        checkout_approved_at IS NULL OR preferred_package_id IS NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_one_open_checkout_approval_idx
    ON public.crm_opportunities(contact_id)
    WHERE checkout_approved_at IS NOT NULL
      AND converted_subscription_id IS NULL;

CREATE TABLE IF NOT EXISTS public.checkout_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES public.crm_opportunities(id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    package_price_id UUID NOT NULL REFERENCES public.package_prices(id) ON DELETE RESTRICT,
    lang TEXT NOT NULL CHECK (lang IN ('es', 'en', 'ru')),
    legal_policy_version TEXT NOT NULL CHECK (NULLIF(btrim(legal_policy_version), '') IS NOT NULL),
    policy_accepted_at TIMESTAMPTZ NOT NULL,
    site_url TEXT NOT NULL CHECK (site_url ~ '^https?://'),
    status TEXT NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'open', 'completed', 'expired')),
    stripe_checkout_session_id TEXT UNIQUE CHECK (
        stripe_checkout_session_id IS NULL
        OR stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    ),
    stripe_customer_id TEXT CHECK (
        stripe_customer_id IS NULL
        OR stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'
    ),
    stripe_session_expires_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT checkout_intents_lifecycle_check CHECK (
        (status = 'completed' AND completed_at IS NOT NULL)
        OR (status <> 'completed' AND completed_at IS NULL)
    ),
    CONSTRAINT checkout_intents_expiry_check CHECK (
        stripe_session_expires_at > created_at
        AND expires_at > stripe_session_expires_at
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_one_open_per_student_idx
    ON public.checkout_intents(student_id)
    WHERE status IN ('creating', 'open');
CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_one_open_per_opportunity_idx
    ON public.checkout_intents(opportunity_id)
    WHERE status IN ('creating', 'open');
CREATE INDEX IF NOT EXISTS checkout_intents_package_price_idx
    ON public.checkout_intents(package_price_id);

ALTER TABLE public.checkout_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.checkout_intents TO service_role;

CREATE OR REPLACE FUNCTION private.protect_open_checkout_intent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.stage,
        NEW.preferred_package_id,
        NEW.checkout_approved_at,
        NEW.converted_subscription_id
    ) IS DISTINCT FROM ROW(
        OLD.stage,
        OLD.preferred_package_id,
        OLD.checkout_approved_at,
        OLD.converted_subscription_id
    ) AND EXISTS (
        SELECT 1
        FROM public.checkout_intents
        WHERE opportunity_id = OLD.id
          AND status IN ('creating', 'open')
    ) THEN
        RAISE EXCEPTION 'open_checkout_intent_must_finish_or_expire_first'
            USING ERRCODE = '55006';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_open_checkout_intent()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_open_checkout_intent_trigger ON public.crm_opportunities;
CREATE TRIGGER protect_open_checkout_intent_trigger
    BEFORE UPDATE ON public.crm_opportunities
    FOR EACH ROW
    EXECUTE FUNCTION private.protect_open_checkout_intent();

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
    SELECT * INTO opportunity_row
    FROM public.crm_opportunities
    WHERE id = p_opportunity_id
    FOR UPDATE;

    IF p_lang NOT IN ('es', 'en', 'ru')
       OR NULLIF(btrim(p_legal_policy_version), '') IS NULL
       OR p_site_url !~ '^https?://' THEN
        RAISE EXCEPTION 'invalid_checkout_intent_snapshot'
            USING ERRCODE = '22023';
    END IF;

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

    UPDATE public.checkout_intents
    SET status = 'expired', updated_at = claim_time
    WHERE status = 'creating'
      AND stripe_checkout_session_id IS NULL
      AND expires_at <= claim_time
      AND (
          student_id = p_student_id
          OR opportunity_id = p_opportunity_id
      );

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE status IN ('creating', 'open')
      AND (
          student_id = p_student_id
          OR opportunity_id = p_opportunity_id
      )
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

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

CREATE OR REPLACE FUNCTION public.complete_checkout_intent(
    p_intent_id UUID,
    p_opportunity_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_stripe_checkout_session_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    completion_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_session_id'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.opportunity_id IS DISTINCT FROM p_opportunity_id
       OR intent_row.student_id IS DISTINCT FROM p_student_id
       OR intent_row.package_price_id IS DISTINCT FROM p_package_price_id
       OR intent_row.status NOT IN ('creating', 'open', 'completed')
       OR (
           intent_row.stripe_checkout_session_id IS NOT NULL
           AND intent_row.stripe_checkout_session_id IS DISTINCT FROM p_stripe_checkout_session_id
       ) THEN
        RAISE EXCEPTION 'checkout_intent_does_not_match_paid_session'
            USING ERRCODE = '42501';
    END IF;

    IF intent_row.status <> 'completed' THEN
        UPDATE public.checkout_intents
        SET
            status = 'completed',
            stripe_checkout_session_id = p_stripe_checkout_session_id,
            completed_at = completion_time,
            updated_at = completion_time
        WHERE id = p_intent_id
        RETURNING * INTO intent_row;

        UPDATE public.crm_opportunities
        SET checkout_approved_at = NULL, updated_at = completion_time
        WHERE id = intent_row.opportunity_id
          AND converted_subscription_id IS NULL;
    END IF;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.release_expired_checkout_intent(
    p_intent_id UUID,
    p_stripe_checkout_session_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status <> 'open'
       OR intent_row.stripe_checkout_session_id IS DISTINCT FROM p_stripe_checkout_session_id THEN
        RAISE EXCEPTION 'checkout_intent_cannot_be_released'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.checkout_intents
    SET status = 'expired', updated_at = clock_timestamp()
    WHERE id = p_intent_id
    RETURNING * INTO intent_row;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_expired_checkout_intent(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_checkout_intent(UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.activate_package_price(
    p_package_id UUID,
    p_catalog_version BIGINT,
    p_duration_months SMALLINT,
    p_amount_cents INTEGER,
    p_currency TEXT,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_stripe_product_id TEXT,
    p_stripe_price_id TEXT,
    p_activated_by UUID DEFAULT NULL
)
RETURNS public.package_prices
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    activation_time TIMESTAMPTZ := clock_timestamp();
    expected_amount INTEGER;
BEGIN
    IF p_catalog_version <= 0
       OR p_duration_months NOT IN (1, 3, 6)
       OR p_amount_cents <= 0
       OR p_currency <> 'eur'
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_product_id !~ '^prod_[A-Za-z0-9_]+$'
       OR p_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_stripe_livemode IS NULL THEN
        RAISE EXCEPTION 'invalid_package_price_activation'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'package_not_found'
            USING ERRCODE = '23503';
    END IF;

    IF package_row.catalog_version IS DISTINCT FROM p_catalog_version THEN
        RAISE EXCEPTION 'stale_package_catalog_version'
            USING ERRCODE = '40001';
    END IF;

    expected_amount := CASE p_duration_months
        WHEN 1 THEN package_row.price_monthly
        WHEN 3 THEN ROUND(package_row.price_monthly::NUMERIC * 3 * 90 / 100)::INTEGER
        WHEN 6 THEN ROUND(package_row.price_monthly::NUMERIC * 6 * 80 / 100)::INTEGER
    END;

    IF expected_amount IS DISTINCT FROM p_amount_cents THEN
        RAISE EXCEPTION 'package_price_amount_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    IF p_activated_by IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.profiles
           WHERE id = p_activated_by AND role = 'admin'
       ) THEN
        RAISE EXCEPTION 'activated_by_must_be_admin'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE stripe_price_id = p_stripe_price_id
    FOR UPDATE;

    IF FOUND THEN
        IF price_row.status <> 'active'
           OR price_row.package_id IS DISTINCT FROM p_package_id
           OR price_row.catalog_version IS DISTINCT FROM p_catalog_version
           OR price_row.duration_months IS DISTINCT FROM p_duration_months
           OR price_row.amount_cents IS DISTINCT FROM p_amount_cents
           OR price_row.currency IS DISTINCT FROM p_currency
           -- Migrated legacy rows intentionally have no account snapshot. The
           -- API verifies the connected account before calling this RPC; all
           -- newly inserted rows must record the exact account.
           OR (
               price_row.stripe_account_id IS NOT NULL
               AND price_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
           )
           OR price_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
           OR price_row.stripe_product_id IS DISTINCT FROM p_stripe_product_id THEN
            RAISE EXCEPTION 'stripe_price_id_already_bound_to_another_offer'
                USING ERRCODE = '23505';
        END IF;

        IF price_row.stripe_account_id IS NULL THEN
            UPDATE public.package_prices
            SET stripe_account_id = p_stripe_account_id
            WHERE id = price_row.id
            RETURNING * INTO price_row;
        END IF;
    ELSE
        UPDATE public.package_prices
        SET status = 'retired', retired_at = activation_time
        WHERE package_id = p_package_id
          AND duration_months = p_duration_months
          AND status = 'active';

        INSERT INTO public.package_prices (
            package_id,
            catalog_version,
            package_key,
            display_name,
            duration_months,
            amount_cents,
            currency,
            sessions_per_month,
            sessions_per_period,
            has_group_session,
            has_dual_teacher,
            stripe_account_id,
            stripe_livemode,
            stripe_product_id,
            stripe_price_id,
            status,
            activated_at,
            created_by
        ) VALUES (
            package_row.id,
            package_row.catalog_version,
            package_row.name,
            package_row.display_name,
            p_duration_months,
            p_amount_cents,
            p_currency,
            package_row.sessions_per_month,
            package_row.sessions_per_month * p_duration_months,
            COALESCE(package_row.has_group_session, FALSE),
            COALESCE(package_row.has_dual_teacher, FALSE),
            p_stripe_account_id,
            p_stripe_livemode,
            p_stripe_product_id,
            p_stripe_price_id,
            'active',
            activation_time,
            p_activated_by
        ) RETURNING * INTO price_row;
    END IF;

    UPDATE public.packages
    SET
        stripe_product_id = p_stripe_product_id,
        stripe_price_1m = CASE
            WHEN p_duration_months = 1 THEN p_stripe_price_id ELSE stripe_price_1m
        END,
        stripe_price_3m = CASE
            WHEN p_duration_months = 3 THEN p_stripe_price_id ELSE stripe_price_3m
        END,
        stripe_price_6m = CASE
            WHEN p_duration_months = 6 THEN p_stripe_price_id ELSE stripe_price_6m
        END
    WHERE id = p_package_id;

    RETURN price_row;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_package_price(
    UUID, BIGINT, SMALLINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_package_price(
    UUID, BIGINT, SMALLINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, UUID
) TO service_role;

ALTER TABLE public.package_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.package_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.package_prices TO service_role;

COMMENT ON TABLE public.package_prices IS
    'Immutable Stripe offers. Active rows are valid for new checkout; retired rows remain resolvable for paid sessions and renewals.';
COMMENT ON COLUMN public.crm_opportunities.checkout_approved_at IS
    'Explicit admin approval for checkout of preferred_package_id. Proposal stage alone is not authorization.';
COMMENT ON COLUMN public.subscriptions.contracted_sessions_per_period IS
    'Immutable quota purchased for each renewal period; catalog edits do not affect existing subscriptions.';
