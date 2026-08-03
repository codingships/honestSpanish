-- Managed V2 catalogue drafts and publication. Package identities stay stable;
-- every publication creates a new immutable package_prices snapshot.

-- The Checkout V2 price pair used to encode only the launch offer. Keep the
-- same five-argument registration boundary, but derive the contractual terms
-- from package_prices so future offers can be prepared without schema edits.
ALTER TABLE public.checkout_v2_price_snapshots
    DROP CONSTRAINT IF EXISTS checkout_v2_price_snapshots_initial_amount_cents_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_price_snapshots_recurring_amount_cents_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_price_snapshots_currency_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_price_snapshots_recurring_interval_unit_check,
    DROP CONSTRAINT IF EXISTS checkout_v2_price_snapshots_recurring_interval_count_check;

ALTER TABLE public.checkout_v2_price_snapshots
    ALTER COLUMN initial_amount_cents DROP DEFAULT,
    ALTER COLUMN recurring_amount_cents DROP DEFAULT,
    ALTER COLUMN currency DROP DEFAULT,
    ALTER COLUMN recurring_interval_unit DROP DEFAULT,
    ALTER COLUMN recurring_interval_count DROP DEFAULT,
    ADD COLUMN sessions_per_period INTEGER,
    ADD COLUMN class_duration_minutes SMALLINT,
    ADD COLUMN session_base_amount_cents INTEGER,
    ADD COLUMN session_remainder_units INTEGER;

UPDATE public.checkout_v2_price_snapshots
SET
    sessions_per_period = 4,
    class_duration_minutes = 50,
    session_base_amount_cents = initial_amount_cents / 4,
    session_remainder_units = initial_amount_cents % 4
WHERE sessions_per_period IS NULL;

ALTER TABLE public.checkout_v2_price_snapshots
    ALTER COLUMN sessions_per_period SET NOT NULL,
    ALTER COLUMN class_duration_minutes SET NOT NULL,
    ALTER COLUMN session_base_amount_cents SET NOT NULL,
    ALTER COLUMN session_remainder_units SET NOT NULL,
    ADD CONSTRAINT checkout_v2_price_snapshots_amounts_check CHECK (
        initial_amount_cents > 0
        AND recurring_amount_cents = initial_amount_cents
    ),
    ADD CONSTRAINT checkout_v2_price_snapshots_currency_check CHECK (
        currency ~ '^[a-z]{3}$'
    ),
    ADD CONSTRAINT checkout_v2_price_snapshots_interval_check CHECK (
        recurring_interval_unit IN ('day', 'week', 'month', 'year')
        AND recurring_interval_count > 0
        AND recurring_interval_count <= CASE recurring_interval_unit
            WHEN 'day' THEN 1095
            WHEN 'week' THEN 156
            WHEN 'month' THEN 36
            WHEN 'year' THEN 3
        END
    ),
    ADD CONSTRAINT checkout_v2_price_snapshots_session_shape_check CHECK (
        sessions_per_period > 0
        AND sessions_per_period <= 200
        AND class_duration_minutes BETWEEN 15 AND 240
        AND session_base_amount_cents > 0
        AND session_remainder_units >= 0
        AND session_remainder_units < sessions_per_period
        AND session_base_amount_cents * sessions_per_period
            + session_remainder_units = initial_amount_cents
    );

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_price_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    price_row public.package_prices%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'checkout_v2_price_snapshot_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            LEAST(NEW.initial_stripe_price_id, NEW.recurring_stripe_price_id),
            42851
        )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            GREATEST(NEW.initial_stripe_price_id, NEW.recurring_stripe_price_id),
            42851
        )
    );

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_price_snapshots AS other_snapshot
        WHERE other_snapshot.initial_stripe_price_id IN (
                NEW.initial_stripe_price_id,
                NEW.recurring_stripe_price_id
            )
           OR other_snapshot.recurring_stripe_price_id IN (
                NEW.initial_stripe_price_id,
                NEW.recurring_stripe_price_id
            )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_stripe_price_is_already_bound'
            USING ERRCODE = '23505';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = NEW.package_price_id;

    IF NOT FOUND
       OR price_row.contract_schema_version IS DISTINCT FROM 2
       OR price_row.amount_cents IS DISTINCT FROM NEW.initial_amount_cents
       OR NEW.recurring_amount_cents IS DISTINCT FROM NEW.initial_amount_cents
       OR price_row.currency IS DISTINCT FROM NEW.currency
       OR price_row.billing_interval_unit IS DISTINCT FROM NEW.recurring_interval_unit
       OR price_row.billing_interval_count IS DISTINCT FROM NEW.recurring_interval_count
       OR price_row.sessions_per_period IS DISTINCT FROM NEW.sessions_per_period
       OR price_row.class_duration_minutes IS DISTINCT FROM NEW.class_duration_minutes
       OR price_row.stripe_price_id IS DISTINCT FROM NEW.recurring_stripe_price_id
       OR price_row.stripe_account_id IS DISTINCT FROM NEW.stripe_account_id
       OR price_row.stripe_livemode IS DISTINCT FROM NEW.stripe_livemode
       OR NEW.session_base_amount_cents IS DISTINCT FROM (
            NEW.initial_amount_cents / NEW.sessions_per_period
       )
       OR NEW.session_remainder_units IS DISTINCT FROM (
            NEW.initial_amount_cents % NEW.sessions_per_period
       ) THEN
        RAISE EXCEPTION 'checkout_v2_price_snapshot_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_checkout_v2_price_snapshot(
    p_package_price_id UUID,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_initial_stripe_price_id TEXT,
    p_recurring_stripe_price_id TEXT
)
RETURNS public.checkout_v2_price_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    snapshot_row public.checkout_v2_price_snapshots%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
BEGIN
    IF p_package_price_id IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_livemode IS NULL
       OR p_initial_stripe_price_id IS NULL
       OR p_initial_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_recurring_stripe_price_id IS NULL
       OR p_recurring_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_initial_stripe_price_id = p_recurring_stripe_price_id THEN
        RAISE EXCEPTION 'invalid_checkout_v2_price_snapshot'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_package_price_id::TEXT, 42852)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            LEAST(p_initial_stripe_price_id, p_recurring_stripe_price_id),
            42851
        )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            GREATEST(p_initial_stripe_price_id, p_recurring_stripe_price_id),
            42851
        )
    );

    SELECT * INTO snapshot_row
    FROM public.checkout_v2_price_snapshots
    WHERE package_price_id = p_package_price_id
    FOR UPDATE;

    IF FOUND THEN
        IF ROW(
            snapshot_row.stripe_account_id,
            snapshot_row.stripe_livemode,
            snapshot_row.initial_stripe_price_id,
            snapshot_row.recurring_stripe_price_id
        ) IS DISTINCT FROM ROW(
            p_stripe_account_id,
            p_stripe_livemode,
            p_initial_stripe_price_id,
            p_recurring_stripe_price_id
        ) THEN
            RAISE EXCEPTION 'checkout_v2_price_snapshot_already_registered'
                USING ERRCODE = '23505';
        END IF;
        RETURN snapshot_row;
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = p_package_price_id
    FOR UPDATE;

    IF NOT FOUND
       OR price_row.contract_schema_version IS DISTINCT FROM 2
       OR price_row.amount_cents <= 0
       OR price_row.sessions_per_period <= 0
       OR price_row.class_duration_minutes <= 0 THEN
        RAISE EXCEPTION 'checkout_v2_price_snapshot_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_price_snapshots AS other_snapshot
        WHERE other_snapshot.initial_stripe_price_id IN (
                p_initial_stripe_price_id,
                p_recurring_stripe_price_id
            )
           OR other_snapshot.recurring_stripe_price_id IN (
                p_initial_stripe_price_id,
                p_recurring_stripe_price_id
            )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_stripe_price_is_already_bound'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.checkout_v2_price_snapshots (
        package_price_id,
        stripe_account_id,
        stripe_livemode,
        initial_stripe_price_id,
        recurring_stripe_price_id,
        initial_amount_cents,
        recurring_amount_cents,
        currency,
        recurring_interval_unit,
        recurring_interval_count,
        sessions_per_period,
        class_duration_minutes,
        session_base_amount_cents,
        session_remainder_units
    ) VALUES (
        price_row.id,
        p_stripe_account_id,
        p_stripe_livemode,
        p_initial_stripe_price_id,
        p_recurring_stripe_price_id,
        price_row.amount_cents,
        price_row.amount_cents,
        price_row.currency,
        price_row.billing_interval_unit,
        price_row.billing_interval_count,
        price_row.sessions_per_period,
        price_row.class_duration_minutes,
        price_row.amount_cents / price_row.sessions_per_period,
        price_row.amount_cents % price_row.sessions_per_period
    )
    RETURNING * INTO snapshot_row;

    RETURN snapshot_row;
END;
$$;

CREATE TYPE public.package_catalog_draft_status AS ENUM (
    'draft',
    'published',
    'discarded'
);

CREATE TABLE public.package_catalog_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
    base_catalog_version BIGINT NOT NULL CHECK (base_catalog_version > 0),
    package_key TEXT NOT NULL CHECK (
        package_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$'
    ),
    display_name JSONB NOT NULL CHECK (
        pg_catalog.jsonb_typeof(display_name) = 'object'
        AND pg_catalog.jsonb_typeof(display_name -> 'es') = 'string'
        AND pg_catalog.jsonb_typeof(display_name -> 'en') = 'string'
        AND pg_catalog.jsonb_typeof(display_name -> 'ru') = 'string'
        AND pg_catalog.char_length(pg_catalog.btrim(display_name ->> 'es')) BETWEEN 1 AND 120
        AND pg_catalog.char_length(pg_catalog.btrim(display_name ->> 'en')) BETWEEN 1 AND 120
        AND pg_catalog.char_length(pg_catalog.btrim(display_name ->> 'ru')) BETWEEN 1 AND 120
    ),
    amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    billing_interval_unit TEXT NOT NULL CHECK (
        billing_interval_unit IN ('day', 'week', 'month', 'year')
    ),
    billing_interval_count SMALLINT NOT NULL CHECK (
        billing_interval_count > 0
    ),
    sessions_per_period INTEGER NOT NULL CHECK (
        sessions_per_period BETWEEN 1 AND 200
    ),
    class_duration_minutes SMALLINT NOT NULL CHECK (
        class_duration_minutes BETWEEN 15 AND 240
    ),
    has_group_session BOOLEAN NOT NULL DEFAULT FALSE,
    has_dual_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    is_publicly_listed BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    status public.package_catalog_draft_status NOT NULL DEFAULT 'draft',
    published_package_price_id UUID UNIQUE
        REFERENCES public.package_prices(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    published_at TIMESTAMPTZ,
    discarded_at TIMESTAMPTZ,
    CONSTRAINT package_catalog_drafts_interval_limit_check CHECK (
        billing_interval_count <= CASE billing_interval_unit
            WHEN 'day' THEN 1095
            WHEN 'week' THEN 156
            WHEN 'month' THEN 36
            WHEN 'year' THEN 3
        END
    ),
    CONSTRAINT package_catalog_drafts_session_allocation_check CHECK (
        amount_cents >= sessions_per_period
    ),
    CONSTRAINT package_catalog_drafts_lifecycle_check CHECK (
        (
            status = 'draft'
            AND published_package_price_id IS NULL
            AND published_at IS NULL
            AND discarded_at IS NULL
        )
        OR (
            status = 'published'
            AND published_package_price_id IS NOT NULL
            AND published_at IS NOT NULL
            AND discarded_at IS NULL
        )
        OR (
            status = 'discarded'
            AND published_package_price_id IS NULL
            AND published_at IS NULL
            AND discarded_at IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX package_catalog_drafts_one_open_per_package_idx
    ON public.package_catalog_drafts(package_id)
    WHERE status = 'draft';
CREATE INDEX package_catalog_drafts_package_history_idx
    ON public.package_catalog_drafts(package_id, created_at DESC, id DESC);

ALTER TABLE public.package_catalog_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.package_catalog_drafts
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.package_catalog_drafts TO service_role;

-- Browser sessions can read packages according to RLS, but catalogue writes
-- are server-only and pass through the audited RPCs below.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.packages FROM authenticated;
DROP POLICY IF EXISTS "Admin catalog writers can manage packages" ON public.packages;

CREATE OR REPLACE FUNCTION private.guard_versioned_package_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    contract_changed BOOLEAN;
BEGIN
    IF NEW.contract_schema_version IS DISTINCT FROM OLD.contract_schema_version THEN
        RAISE EXCEPTION 'package_contract_schema_version_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    contract_changed := ROW(
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
    );

    IF OLD.contract_schema_version = 2
       AND contract_changed
       AND CURRENT_USER <> 'postgres' THEN
        RAISE EXCEPTION 'versioned_package_contract_fields_require_publish_rpc'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.version_package_catalog()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    contract_changed BOOLEAN;
BEGIN
    contract_changed := ROW(
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
    );

    IF OLD.contract_schema_version = 2 THEN
        IF NEW.catalog_version = OLD.catalog_version + 1 THEN
            IF CURRENT_USER <> 'postgres' THEN
                RAISE EXCEPTION 'versioned_package_publish_requires_rpc'
                    USING ERRCODE = '42501';
            END IF;

            UPDATE public.package_prices
            SET status = 'retired', retired_at = clock_timestamp()
            WHERE package_id = OLD.id
              AND contract_schema_version = 2
              AND status = 'active';

            NEW.stripe_price_1m := NULL;
            NEW.stripe_price_3m := NULL;
            NEW.stripe_price_6m := NULL;
        ELSIF NEW.catalog_version = OLD.catalog_version AND NOT contract_changed THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'invalid_versioned_package_catalog_transition'
                USING ERRCODE = '23514';
        END IF;
    ELSIF contract_changed THEN
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

CREATE OR REPLACE FUNCTION public.create_package_catalog_draft(
    p_actor_id UUID,
    p_package_id UUID DEFAULT NULL,
    p_package_key TEXT DEFAULT NULL,
    p_display_name JSONB DEFAULT NULL,
    p_amount_cents INTEGER DEFAULT NULL,
    p_billing_interval_unit TEXT DEFAULT NULL,
    p_billing_interval_count SMALLINT DEFAULT NULL,
    p_sessions_per_period INTEGER DEFAULT NULL,
    p_class_duration_minutes SMALLINT DEFAULT NULL,
    p_has_group_session BOOLEAN DEFAULT FALSE,
    p_has_dual_teacher BOOLEAN DEFAULT FALSE,
    p_is_publicly_listed BOOLEAN DEFAULT FALSE
)
RETURNS public.package_catalog_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    draft_row public.package_catalog_drafts%ROWTYPE;
BEGIN
    IF p_actor_id IS NULL OR NOT private.admin_has_capability(
        p_actor_id,
        'catalog.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'catalog_write_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF p_package_id IS NOT NULL THEN
        SELECT * INTO package_row
        FROM public.packages
        WHERE id = p_package_id
        FOR UPDATE;

        IF NOT FOUND OR package_row.contract_schema_version <> 2 THEN
            RAISE EXCEPTION 'versioned_package_not_found'
                USING ERRCODE = 'P0002';
        END IF;
    ELSE
        IF p_package_key IS NULL
           OR p_display_name IS NULL
           OR p_amount_cents IS NULL
           OR p_billing_interval_unit IS NULL
           OR p_billing_interval_count IS NULL
           OR p_sessions_per_period IS NULL
           OR p_class_duration_minutes IS NULL THEN
            RAISE EXCEPTION 'new_package_draft_fields_required'
                USING ERRCODE = '22023';
        END IF;

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
            pg_catalog.lower(pg_catalog.btrim(p_package_key)),
            p_display_name,
            p_amount_cents,
            p_sessions_per_period,
            COALESCE(p_has_group_session, FALSE),
            COALESCE(p_has_dual_teacher, FALSE),
            FALSE,
            FALSE,
            2,
            p_amount_cents,
            p_billing_interval_unit,
            p_billing_interval_count,
            p_sessions_per_period,
            p_class_duration_minutes
        )
        RETURNING * INTO package_row;
    END IF;

    INSERT INTO public.package_catalog_drafts (
        package_id,
        base_catalog_version,
        package_key,
        display_name,
        amount_cents,
        currency,
        billing_interval_unit,
        billing_interval_count,
        sessions_per_period,
        class_duration_minutes,
        has_group_session,
        has_dual_teacher,
        is_publicly_listed,
        created_by,
        updated_by
    ) VALUES (
        package_row.id,
        package_row.catalog_version,
        package_row.name,
        CASE WHEN p_package_id IS NULL THEN p_display_name ELSE package_row.display_name END,
        CASE WHEN p_package_id IS NULL THEN p_amount_cents ELSE package_row.amount_cents END,
        'eur',
        CASE WHEN p_package_id IS NULL THEN p_billing_interval_unit ELSE package_row.billing_interval_unit END,
        CASE WHEN p_package_id IS NULL THEN p_billing_interval_count ELSE package_row.billing_interval_count END,
        CASE WHEN p_package_id IS NULL THEN p_sessions_per_period ELSE package_row.sessions_per_period END,
        CASE WHEN p_package_id IS NULL THEN p_class_duration_minutes ELSE package_row.class_duration_minutes END,
        CASE WHEN p_package_id IS NULL THEN COALESCE(p_has_group_session, FALSE) ELSE COALESCE(package_row.has_group_session, FALSE) END,
        CASE WHEN p_package_id IS NULL THEN COALESCE(p_has_dual_teacher, FALSE) ELSE COALESCE(package_row.has_dual_teacher, FALSE) END,
        CASE WHEN p_package_id IS NULL THEN COALESCE(p_is_publicly_listed, FALSE) ELSE package_row.is_publicly_listed END,
        p_actor_id,
        p_actor_id
    )
    RETURNING * INTO draft_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_actor_id,
        'catalog_v2.draft_create',
        'package_catalog_draft',
        draft_row.id::TEXT,
        NULL,
        pg_catalog.to_jsonb(draft_row)
    );

    RETURN draft_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_package_catalog_draft(
    p_draft_id UUID,
    p_expected_revision BIGINT,
    p_display_name JSONB,
    p_amount_cents INTEGER,
    p_billing_interval_unit TEXT,
    p_billing_interval_count SMALLINT,
    p_sessions_per_period INTEGER,
    p_class_duration_minutes SMALLINT,
    p_has_group_session BOOLEAN,
    p_has_dual_teacher BOOLEAN,
    p_is_publicly_listed BOOLEAN,
    p_actor_id UUID
)
RETURNS public.package_catalog_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    before_row public.package_catalog_drafts%ROWTYPE;
    updated_row public.package_catalog_drafts%ROWTYPE;
    current_catalog_version BIGINT;
BEGIN
    IF p_actor_id IS NULL OR NOT private.admin_has_capability(
        p_actor_id,
        'catalog.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'catalog_write_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO before_row
    FROM public.package_catalog_drafts
    WHERE id = p_draft_id
    FOR UPDATE;

    IF NOT FOUND OR before_row.status <> 'draft' THEN
        RAISE EXCEPTION 'catalog_draft_not_editable'
            USING ERRCODE = '23514';
    END IF;
    IF before_row.revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'stale_catalog_draft_revision'
            USING ERRCODE = '40001';
    END IF;

    SELECT catalog_version INTO current_catalog_version
    FROM public.packages
    WHERE id = before_row.package_id
    FOR UPDATE;
    IF current_catalog_version IS DISTINCT FROM before_row.base_catalog_version THEN
        RAISE EXCEPTION 'stale_package_catalog_version'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.package_catalog_drafts
    SET
        display_name = p_display_name,
        amount_cents = p_amount_cents,
        billing_interval_unit = p_billing_interval_unit,
        billing_interval_count = p_billing_interval_count,
        sessions_per_period = p_sessions_per_period,
        class_duration_minutes = p_class_duration_minutes,
        has_group_session = COALESCE(p_has_group_session, FALSE),
        has_dual_teacher = COALESCE(p_has_dual_teacher, FALSE),
        is_publicly_listed = COALESCE(p_is_publicly_listed, FALSE),
        revision = revision + 1,
        updated_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE id = p_draft_id
    RETURNING * INTO updated_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_actor_id,
        'catalog_v2.draft_update',
        'package_catalog_draft',
        p_draft_id::TEXT,
        pg_catalog.to_jsonb(before_row),
        pg_catalog.to_jsonb(updated_row)
    );

    RETURN updated_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_package_catalog_draft(
    p_draft_id UUID,
    p_expected_revision BIGINT,
    p_actor_id UUID
)
RETURNS public.package_catalog_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    before_row public.package_catalog_drafts%ROWTYPE;
    discarded_row public.package_catalog_drafts%ROWTYPE;
BEGIN
    IF p_actor_id IS NULL OR NOT private.admin_has_capability(
        p_actor_id,
        'catalog.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'catalog_write_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO before_row
    FROM public.package_catalog_drafts
    WHERE id = p_draft_id
    FOR UPDATE;
    IF NOT FOUND OR before_row.status <> 'draft' THEN
        RAISE EXCEPTION 'catalog_draft_not_editable'
            USING ERRCODE = '23514';
    END IF;
    IF before_row.revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'stale_catalog_draft_revision'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.package_catalog_drafts
    SET
        status = 'discarded',
        revision = revision + 1,
        discarded_at = date_trunc('second', clock_timestamp()),
        updated_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE id = p_draft_id
    RETURNING * INTO discarded_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_actor_id,
        'catalog_v2.draft_discard',
        'package_catalog_draft',
        p_draft_id::TEXT,
        pg_catalog.to_jsonb(before_row),
        pg_catalog.to_jsonb(discarded_row)
    );

    RETURN discarded_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_package_catalog_draft(
    p_draft_id UUID,
    p_expected_revision BIGINT,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_stripe_product_id TEXT,
    p_initial_stripe_price_id TEXT,
    p_recurring_stripe_price_id TEXT,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    before_row public.package_catalog_drafts%ROWTYPE;
    published_row public.package_catalog_drafts%ROWTYPE;
    package_row public.packages%ROWTYPE;
    package_price_row public.package_prices%ROWTYPE;
    checkout_snapshot public.checkout_v2_price_snapshots%ROWTYPE;
    target_catalog_version BIGINT;
BEGIN
    IF p_actor_id IS NULL OR NOT private.admin_has_capability(
        p_actor_id,
        'catalog.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'catalog_write_forbidden'
            USING ERRCODE = '42501';
    END IF;
    IF p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_livemode IS NULL
       OR p_stripe_product_id IS NULL
       OR p_stripe_product_id !~ '^prod_[A-Za-z0-9_]+$'
       OR p_initial_stripe_price_id IS NULL
       OR p_initial_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_recurring_stripe_price_id IS NULL
       OR p_recurring_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_initial_stripe_price_id = p_recurring_stripe_price_id THEN
        RAISE EXCEPTION 'invalid_catalog_publish_stripe_binding'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO before_row
    FROM public.package_catalog_drafts
    WHERE id = p_draft_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'catalog_draft_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF before_row.status = 'published' THEN
        SELECT * INTO package_row
        FROM public.packages
        WHERE id = before_row.package_id;
        SELECT * INTO package_price_row
        FROM public.package_prices
        WHERE id = before_row.published_package_price_id;
        SELECT * INTO checkout_snapshot
        FROM public.checkout_v2_price_snapshots
        WHERE package_price_id = before_row.published_package_price_id;

        IF before_row.revision IS DISTINCT FROM p_expected_revision
           OR package_price_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
           OR package_price_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
           OR package_price_row.stripe_product_id IS DISTINCT FROM p_stripe_product_id
           OR package_price_row.stripe_price_id IS DISTINCT FROM p_recurring_stripe_price_id
           OR checkout_snapshot.initial_stripe_price_id IS DISTINCT FROM p_initial_stripe_price_id THEN
            RAISE EXCEPTION 'catalog_draft_already_published_differently'
                USING ERRCODE = '23505';
        END IF;

        RETURN pg_catalog.jsonb_build_object(
            'draft', pg_catalog.to_jsonb(before_row),
            'package', pg_catalog.to_jsonb(package_row),
            'package_price', pg_catalog.to_jsonb(package_price_row),
            'checkout_snapshot', pg_catalog.to_jsonb(checkout_snapshot),
            'changed', FALSE
        );
    END IF;

    IF before_row.status <> 'draft' THEN
        RAISE EXCEPTION 'catalog_draft_not_publishable'
            USING ERRCODE = '23514';
    END IF;
    IF before_row.revision IS DISTINCT FROM p_expected_revision THEN
        RAISE EXCEPTION 'stale_catalog_draft_revision'
            USING ERRCODE = '40001';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = before_row.package_id
    FOR UPDATE;
    IF NOT FOUND
       OR package_row.contract_schema_version <> 2
       OR package_row.catalog_version IS DISTINCT FROM before_row.base_catalog_version
       OR package_row.name IS DISTINCT FROM before_row.package_key THEN
        RAISE EXCEPTION 'stale_package_catalog_version'
            USING ERRCODE = '40001';
    END IF;

    target_catalog_version := package_row.catalog_version + 1;

    UPDATE public.packages
    SET
        display_name = before_row.display_name,
        price_monthly = before_row.amount_cents,
        sessions_per_month = before_row.sessions_per_period,
        has_group_session = before_row.has_group_session,
        has_dual_teacher = before_row.has_dual_teacher,
        catalog_version = target_catalog_version,
        stripe_product_id = p_stripe_product_id,
        is_active = TRUE,
        is_publicly_listed = before_row.is_publicly_listed,
        amount_cents = before_row.amount_cents,
        billing_interval_unit = before_row.billing_interval_unit,
        billing_interval_count = before_row.billing_interval_count,
        sessions_per_period = before_row.sessions_per_period,
        class_duration_minutes = before_row.class_duration_minutes,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE id = package_row.id
    RETURNING * INTO package_row;

    package_price_row := public.activate_versioned_package_price(
        package_row.id,
        target_catalog_version,
        before_row.amount_cents,
        before_row.currency,
        before_row.billing_interval_unit,
        before_row.billing_interval_count,
        before_row.sessions_per_period,
        before_row.class_duration_minutes,
        p_stripe_account_id,
        p_stripe_livemode,
        p_stripe_product_id,
        p_recurring_stripe_price_id,
        p_actor_id
    );

    checkout_snapshot := public.register_checkout_v2_price_snapshot(
        package_price_row.id,
        p_stripe_account_id,
        p_stripe_livemode,
        p_initial_stripe_price_id,
        p_recurring_stripe_price_id
    );

    UPDATE public.package_catalog_drafts
    SET
        status = 'published',
        published_package_price_id = package_price_row.id,
        published_at = date_trunc('second', clock_timestamp()),
        updated_by = p_actor_id,
        updated_at = date_trunc('second', clock_timestamp())
    WHERE id = before_row.id
    RETURNING * INTO published_row;

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_actor_id,
        'catalog_v2.publish',
        'package',
        package_row.id::TEXT,
        pg_catalog.to_jsonb(before_row),
        pg_catalog.jsonb_build_object(
            'draft_id', published_row.id,
            'catalog_version', package_row.catalog_version,
            'package_price_id', package_price_row.id,
            'is_publicly_listed', package_row.is_publicly_listed
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'draft', pg_catalog.to_jsonb(published_row),
        'package', pg_catalog.to_jsonb(package_row),
        'package_price', pg_catalog.to_jsonb(package_price_row),
        'checkout_snapshot', pg_catalog.to_jsonb(checkout_snapshot),
        'changed', TRUE
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_versioned_package(
    p_package_id UUID,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    before_row public.packages%ROWTYPE;
    retired_row public.packages%ROWTYPE;
    retired_price_ids JSONB;
    changed BOOLEAN;
BEGIN
    IF p_actor_id IS NULL OR NOT private.admin_has_capability(
        p_actor_id,
        'catalog.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'catalog_write_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO before_row
    FROM public.packages
    WHERE id = p_package_id
    FOR UPDATE;
    IF NOT FOUND OR before_row.contract_schema_version <> 2 THEN
        RAISE EXCEPTION 'versioned_package_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    changed := before_row.is_active OR before_row.is_publicly_listed;
    UPDATE public.packages
    SET
        is_active = FALSE,
        is_publicly_listed = FALSE,
        updated_at = CASE
            WHEN changed THEN date_trunc('second', clock_timestamp())
            ELSE updated_at
        END
    WHERE id = before_row.id
    RETURNING * INTO retired_row;

    WITH retired AS (
        UPDATE public.package_prices
        SET status = 'retired', retired_at = clock_timestamp()
        WHERE package_id = before_row.id
          AND contract_schema_version = 2
          AND status = 'active'
        RETURNING stripe_price_id
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(stripe_price_id), '[]'::JSONB)
    INTO retired_price_ids
    FROM retired;

    IF changed OR pg_catalog.jsonb_array_length(retired_price_ids) > 0 THEN
        INSERT INTO public.admin_audit_log (
            admin_id, action, entity_type, entity_id, before, after
        ) VALUES (
            p_actor_id,
            'catalog_v2.retire',
            'package',
            before_row.id::TEXT,
            pg_catalog.to_jsonb(before_row),
            pg_catalog.jsonb_build_object(
                'package', pg_catalog.to_jsonb(retired_row),
                'retired_stripe_price_ids', retired_price_ids
            )
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'package', pg_catalog.to_jsonb(retired_row),
        'retired_stripe_price_ids', retired_price_ids,
        'changed', changed OR pg_catalog.jsonb_array_length(retired_price_ids) > 0
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_catalog_draft(
    UUID, UUID, TEXT, JSONB, INTEGER, TEXT, SMALLINT, INTEGER, SMALLINT,
    BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_package_catalog_draft(
    UUID, UUID, TEXT, JSONB, INTEGER, TEXT, SMALLINT, INTEGER, SMALLINT,
    BOOLEAN, BOOLEAN, BOOLEAN
) TO service_role;

REVOKE ALL ON FUNCTION public.update_package_catalog_draft(
    UUID, BIGINT, JSONB, INTEGER, TEXT, SMALLINT, INTEGER, SMALLINT,
    BOOLEAN, BOOLEAN, BOOLEAN, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_package_catalog_draft(
    UUID, BIGINT, JSONB, INTEGER, TEXT, SMALLINT, INTEGER, SMALLINT,
    BOOLEAN, BOOLEAN, BOOLEAN, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.discard_package_catalog_draft(UUID, BIGINT, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discard_package_catalog_draft(UUID, BIGINT, UUID)
    TO service_role;

REVOKE ALL ON FUNCTION public.publish_package_catalog_draft(
    UUID, BIGINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_package_catalog_draft(
    UUID, BIGINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, UUID
) TO service_role;

REVOKE ALL ON FUNCTION public.retire_versioned_package(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_versioned_package(UUID, UUID)
    TO service_role;

COMMENT ON TABLE public.package_catalog_drafts IS
    'Editable proposals for a stable package identity. Publish creates immutable Stripe and database snapshots; published/discarded rows never become drafts again.';
COMMENT ON FUNCTION public.publish_package_catalog_draft(
    UUID, BIGINT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, UUID
) IS 'Atomically publishes one validated draft after the caller verifies the exact Stripe Product and initial/recurring Prices.';
