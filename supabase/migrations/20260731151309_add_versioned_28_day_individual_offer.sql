-- Add a second, explicit contract shape without reinterpreting the historical
-- 1/3/6-month catalogue. Checkout remains disabled and no Stripe object is
-- created by this migration.

ALTER TABLE public.packages
    ADD COLUMN is_publicly_listed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN contract_schema_version SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN amount_cents INTEGER,
    ADD COLUMN billing_interval_unit TEXT,
    ADD COLUMN billing_interval_count SMALLINT,
    ADD COLUMN sessions_per_period INTEGER,
    ADD COLUMN class_duration_minutes SMALLINT;

ALTER TABLE public.packages
    ADD CONSTRAINT packages_contract_schema_version_check
        CHECK (contract_schema_version IN (1, 2)),
    ADD CONSTRAINT packages_id_contract_schema_version_key
        UNIQUE (id, contract_schema_version),
    ADD CONSTRAINT packages_versioned_contract_shape_check CHECK (
        (
            contract_schema_version = 1
            AND amount_cents IS NULL
            AND billing_interval_unit IS NULL
            AND billing_interval_count IS NULL
            AND sessions_per_period IS NULL
            AND class_duration_minutes IS NULL
        )
        OR (
            contract_schema_version = 2
            AND amount_cents IS NOT NULL AND amount_cents > 0
            AND price_monthly = amount_cents
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit IN ('day', 'week', 'month', 'year')
            AND billing_interval_count IS NOT NULL AND billing_interval_count > 0
            AND sessions_per_period IS NOT NULL AND sessions_per_period > 0
            AND sessions_per_month = sessions_per_period
            AND class_duration_minutes IS NOT NULL AND class_duration_minutes > 0
        )
    );

ALTER TABLE public.package_prices
    ADD COLUMN contract_schema_version SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN billing_interval_unit TEXT,
    ADD COLUMN billing_interval_count SMALLINT,
    ADD COLUMN class_duration_minutes SMALLINT;

UPDATE public.package_prices
SET
    billing_interval_unit = 'month',
    billing_interval_count = duration_months
WHERE contract_schema_version = 1;

ALTER TABLE public.package_prices
    ALTER COLUMN duration_months DROP NOT NULL,
    ALTER COLUMN sessions_per_month DROP NOT NULL;

ALTER TABLE public.package_prices
    DROP CONSTRAINT package_prices_package_id_fkey,
    ADD CONSTRAINT package_prices_contract_schema_version_check
        CHECK (contract_schema_version IN (1, 2)),
    ADD CONSTRAINT package_prices_package_contract_version_fkey
        FOREIGN KEY (package_id, contract_schema_version)
        REFERENCES public.packages(id, contract_schema_version) ON DELETE RESTRICT,
    ADD CONSTRAINT package_prices_versioned_contract_shape_check CHECK (
        (
            contract_schema_version = 1
            AND duration_months IS NOT NULL AND duration_months IN (1, 3, 6)
            AND sessions_per_month IS NOT NULL AND sessions_per_month > 0
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit = 'month'
            AND billing_interval_count IS NOT NULL
            AND billing_interval_count = duration_months
            AND class_duration_minutes IS NULL
        )
        OR (
            contract_schema_version = 2
            AND duration_months IS NULL
            AND sessions_per_month IS NULL
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit IN ('day', 'week', 'month', 'year')
            AND billing_interval_count IS NOT NULL AND billing_interval_count > 0
            AND sessions_per_period IS NOT NULL AND sessions_per_period > 0
            AND class_duration_minutes IS NOT NULL AND class_duration_minutes > 0
        )
    );

CREATE UNIQUE INDEX package_prices_one_active_v2_offer_idx
    ON public.package_prices(package_id)
    WHERE status = 'active' AND contract_schema_version = 2;

ALTER TABLE public.subscriptions
    ADD COLUMN contract_schema_version SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN billing_interval_unit TEXT,
    ADD COLUMN billing_interval_count SMALLINT,
    ADD COLUMN class_duration_minutes SMALLINT;

UPDATE public.subscriptions
SET
    billing_interval_unit = 'month',
    billing_interval_count = duration_months
WHERE contract_schema_version = 1;

ALTER TABLE public.subscriptions
    ALTER COLUMN duration_months DROP NOT NULL;

ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_contract_schema_version_check
        CHECK (contract_schema_version IN (1, 2)),
    ADD CONSTRAINT subscriptions_versioned_contract_shape_check CHECK (
        (
            contract_schema_version = 1
            AND duration_months IS NOT NULL AND duration_months IN (1, 3, 6)
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit = 'month'
            AND billing_interval_count IS NOT NULL
            AND billing_interval_count = duration_months
            AND class_duration_minutes IS NULL
        )
        OR (
            contract_schema_version = 2
            AND duration_months IS NULL
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit IN ('day', 'week', 'month', 'year')
            AND billing_interval_count IS NOT NULL AND billing_interval_count > 0
            AND class_duration_minutes IS NOT NULL AND class_duration_minutes > 0
        )
    );

-- Existing application paths keep writing the legacy columns. Normalize only
-- schema-version 1 inserts so they remain byte-for-byte monthly contracts while
-- the application migrates to an explicit v2 writer.
CREATE OR REPLACE FUNCTION private.populate_legacy_contract_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version = 1 THEN
        NEW.billing_interval_unit := 'month';
        NEW.billing_interval_count := NEW.duration_months;
        NEW.class_duration_minutes := NULL;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.populate_legacy_contract_interval()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER populate_legacy_package_price_interval_trigger
    BEFORE INSERT ON public.package_prices
    FOR EACH ROW
    EXECUTE FUNCTION private.populate_legacy_contract_interval();

CREATE TRIGGER populate_legacy_subscription_interval_trigger
    BEFORE INSERT ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.populate_legacy_contract_interval();

CREATE OR REPLACE FUNCTION private.guard_versioned_package_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version IS DISTINCT FROM OLD.contract_schema_version THEN
        RAISE EXCEPTION 'package_contract_schema_version_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.contract_schema_version = 2 AND ROW(
        NEW.name,
        NEW.display_name,
        NEW.price_monthly,
        NEW.sessions_per_month,
        NEW.has_group_session,
        NEW.has_dual_teacher,
        NEW.amount_cents,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.sessions_per_period,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.name,
        OLD.display_name,
        OLD.price_monthly,
        OLD.sessions_per_month,
        OLD.has_group_session,
        OLD.has_dual_teacher,
        OLD.amount_cents,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.sessions_per_period,
        OLD.class_duration_minutes
    ) THEN
        RAISE EXCEPTION 'versioned_package_contract_fields_are_immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_versioned_package_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_versioned_package_contract_trigger
    BEFORE UPDATE ON public.packages
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_versioned_package_contract();

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
        NEW.has_dual_teacher,
        NEW.amount_cents,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.sessions_per_period,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.name,
        OLD.display_name,
        OLD.price_monthly,
        OLD.sessions_per_month,
        OLD.has_group_session,
        OLD.has_dual_teacher,
        OLD.amount_cents,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.sessions_per_period,
        OLD.class_duration_minutes
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

CREATE OR REPLACE FUNCTION private.guard_versioned_package_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.contract_schema_version,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.contract_schema_version,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.class_duration_minutes
    ) THEN
        RAISE EXCEPTION 'package_price_versioned_contract_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_versioned_package_price_history()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_versioned_package_price_history_trigger
    BEFORE UPDATE ON public.package_prices
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_versioned_package_price_history();

CREATE OR REPLACE FUNCTION private.guard_versioned_subscription_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version = 1 THEN
        NEW.billing_interval_unit := 'month';
        NEW.billing_interval_count := NEW.duration_months;
        NEW.class_duration_minutes := NULL;
    END IF;

    IF TG_OP = 'UPDATE' AND ROW(
        NEW.contract_schema_version,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.contract_schema_version,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.class_duration_minutes
    ) THEN
        RAISE EXCEPTION 'subscription_versioned_contract_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.package_price_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.package_prices AS contract_price
           WHERE contract_price.id = NEW.package_price_id
             AND contract_price.contract_schema_version = NEW.contract_schema_version
             AND contract_price.billing_interval_unit = NEW.billing_interval_unit
             AND contract_price.billing_interval_count = NEW.billing_interval_count
             AND contract_price.class_duration_minutes IS NOT DISTINCT FROM NEW.class_duration_minutes
       ) THEN
        RAISE EXCEPTION 'subscription_versioned_contract_does_not_match_package_price'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_versioned_subscription_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_versioned_subscription_contract_trigger
    BEFORE INSERT OR UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_versioned_subscription_contract();

-- V2 synchronization boundary. It deliberately has a new name and signature so
-- legacy callers and historical monthly offers remain untouched.
CREATE OR REPLACE FUNCTION public.activate_versioned_package_price(
    p_package_id UUID,
    p_catalog_version BIGINT,
    p_amount_cents INTEGER,
    p_currency TEXT,
    p_billing_interval_unit TEXT,
    p_billing_interval_count SMALLINT,
    p_sessions_per_period INTEGER,
    p_class_duration_minutes SMALLINT,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_stripe_product_id TEXT,
    p_stripe_price_id TEXT,
    p_activated_by UUID DEFAULT NULL
)
RETURNS public.package_prices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    activation_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_package_id IS NULL
       OR p_catalog_version IS NULL
       OR p_amount_cents IS NULL
       OR p_currency IS NULL
       OR p_billing_interval_unit IS NULL
       OR p_billing_interval_count IS NULL
       OR p_sessions_per_period IS NULL
       OR p_class_duration_minutes IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_livemode IS NULL
       OR p_stripe_product_id IS NULL
       OR p_stripe_price_id IS NULL
       OR p_catalog_version <= 0
       OR p_amount_cents <= 0
       OR p_currency <> 'eur'
       OR p_billing_interval_unit NOT IN ('day', 'week', 'month', 'year')
       OR p_billing_interval_count <= 0
       OR p_sessions_per_period <= 0
       OR p_class_duration_minutes <= 0
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_product_id !~ '^prod_[A-Za-z0-9_]+$'
       OR p_stripe_price_id !~ '^price_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_versioned_package_price_activation'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND
       OR package_row.contract_schema_version <> 2
       OR package_row.catalog_version IS DISTINCT FROM p_catalog_version
       OR package_row.amount_cents IS DISTINCT FROM p_amount_cents
       OR package_row.billing_interval_unit IS DISTINCT FROM p_billing_interval_unit
       OR package_row.billing_interval_count IS DISTINCT FROM p_billing_interval_count
       OR package_row.sessions_per_period IS DISTINCT FROM p_sessions_per_period
       OR package_row.class_duration_minutes IS DISTINCT FROM p_class_duration_minutes THEN
        RAISE EXCEPTION 'versioned_package_price_does_not_match_catalog'
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
           OR price_row.contract_schema_version <> 2
           OR price_row.amount_cents IS DISTINCT FROM p_amount_cents
           OR price_row.currency IS DISTINCT FROM p_currency
           OR price_row.billing_interval_unit IS DISTINCT FROM p_billing_interval_unit
           OR price_row.billing_interval_count IS DISTINCT FROM p_billing_interval_count
           OR price_row.sessions_per_period IS DISTINCT FROM p_sessions_per_period
           OR price_row.class_duration_minutes IS DISTINCT FROM p_class_duration_minutes
           OR price_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
           OR price_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
           OR price_row.stripe_product_id IS DISTINCT FROM p_stripe_product_id THEN
            RAISE EXCEPTION 'stripe_price_id_already_bound_to_another_offer'
                USING ERRCODE = '23505';
        END IF;

        RETURN price_row;
    END IF;

    UPDATE public.package_prices
    SET status = 'retired', retired_at = activation_time
    WHERE package_id = p_package_id
      AND contract_schema_version = 2
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
        created_by,
        contract_schema_version,
        billing_interval_unit,
        billing_interval_count,
        class_duration_minutes
    ) VALUES (
        package_row.id,
        package_row.catalog_version,
        package_row.name,
        package_row.display_name,
        NULL,
        p_amount_cents,
        p_currency,
        NULL,
        p_sessions_per_period,
        COALESCE(package_row.has_group_session, FALSE),
        COALESCE(package_row.has_dual_teacher, FALSE),
        p_stripe_account_id,
        p_stripe_livemode,
        p_stripe_product_id,
        p_stripe_price_id,
        'active',
        activation_time,
        p_activated_by,
        2,
        p_billing_interval_unit,
        p_billing_interval_count,
        p_class_duration_minutes
    )
    RETURNING * INTO price_row;

    RETURN price_row;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_versioned_package_price(
    UUID, BIGINT, INTEGER, TEXT, TEXT, SMALLINT, INTEGER, SMALLINT,
    TEXT, BOOLEAN, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_versioned_package_price(
    UUID, BIGINT, INTEGER, TEXT, TEXT, SMALLINT, INTEGER, SMALLINT,
    TEXT, BOOLEAN, TEXT, TEXT, UUID
) TO service_role;

CREATE POLICY "Anyone can view publicly listed packages"
    ON public.packages FOR SELECT
    USING (is_publicly_listed = TRUE);

INSERT INTO public.packages (
    name,
    display_name,
    price_monthly,
    sessions_per_month,
    has_group_session,
    has_dual_teacher,
    is_active,
    is_publicly_listed,
    contract_schema_version,
    amount_cents,
    billing_interval_unit,
    billing_interval_count,
    sessions_per_period,
    class_duration_minutes
) VALUES (
    'individual_4x50_28d',
    '{"es":"4 clases individuales","en":"4 individual classes","ru":"4 индивидуальных занятия"}'::jsonb,
    25900,
    4,
    FALSE,
    FALSE,
    FALSE,
    TRUE,
    2,
    25900,
    'day',
    28,
    4,
    50
)
ON CONFLICT (name) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.packages
        WHERE name = 'individual_4x50_28d'
          AND display_name = '{"es":"4 clases individuales","en":"4 individual classes","ru":"4 индивидуальных занятия"}'::jsonb
          AND price_monthly = 25900
          AND sessions_per_month = 4
          AND COALESCE(has_group_session, FALSE) = FALSE
          AND COALESCE(has_dual_teacher, FALSE) = FALSE
          AND contract_schema_version = 2
          AND amount_cents = 25900
          AND billing_interval_unit = 'day'
          AND billing_interval_count = 28
          AND sessions_per_period = 4
          AND class_duration_minutes = 50
          AND is_active = FALSE
          AND is_publicly_listed = TRUE
          AND stripe_product_id IS NULL
          AND stripe_price_1m IS NULL
          AND stripe_price_3m IS NULL
          AND stripe_price_6m IS NULL
    ) THEN
        RAISE EXCEPTION 'individual_4x50_28d_seed_conflicts_with_existing_catalog';
    END IF;
END;
$$;

COMMENT ON COLUMN public.packages.contract_schema_version IS
    '1 keeps the historical monthly catalogue; 2 uses explicit immutable interval and class terms.';
COMMENT ON FUNCTION public.activate_versioned_package_price(
    UUID, BIGINT, INTEGER, TEXT, TEXT, SMALLINT, INTEGER, SMALLINT,
    TEXT, BOOLEAN, TEXT, TEXT, UUID
) IS 'Binds one verified Stripe Price to a version-2 contract snapshot; service role only.';
