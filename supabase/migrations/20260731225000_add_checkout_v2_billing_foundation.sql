-- Checkout V2 billing foundation. This migration is additive for historical
-- contracts: every new table and RPC is restricted to contract_schema_version
-- 2 and the legacy monthly checkout remains untouched.

-- Constraint triggers run at commit, so choose the trigger record shape with
-- control flow rather than a CASE that tries to resolve columns from both
-- bookable_slots and bookable_slot_occurrences.
CREATE OR REPLACE FUNCTION private.validate_bookable_slot_occurrences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target_slot_id UUID;
    slot_row public.bookable_slots%ROWTYPE;
    occurrence_count INTEGER;
    occurrence_indexes SMALLINT[];
    occurrence_one TIMESTAMPTZ;
    local_pattern_valid BOOLEAN;
    blocking_valid BOOLEAN;
    materialized_binding_valid BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'bookable_slots' THEN
        target_slot_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSIF TG_TABLE_NAME = 'bookable_slot_occurrences' THEN
        target_slot_id := CASE
            WHEN TG_OP = 'DELETE' THEN OLD.slot_id
            ELSE NEW.slot_id
        END;
    ELSE
        RAISE EXCEPTION 'unexpected_bookable_slot_validation_source'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = target_slot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COUNT(*),
        ARRAY_AGG(occurrence_index ORDER BY occurrence_index),
        MAX(starts_at) FILTER (WHERE occurrence_index = 1),
        COALESCE(BOOL_AND(
            EXTRACT(DOW FROM starts_at AT TIME ZONE slot_row.timezone_name)::SMALLINT
                = slot_row.weekday
            AND (starts_at AT TIME ZONE slot_row.timezone_name)::TIME(0)
                = slot_row.local_start_time
            AND (starts_at AT TIME ZONE slot_row.timezone_name)::DATE
                = (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
                  + ((occurrence_index - 1) * 7)
        ), FALSE),
        COALESCE(BOOL_AND(
            blocks_teacher = (
                slot_row.status IN ('available', 'paused', 'sold')
                AND slot_row.sessions_materialized_at IS NULL
            )
        ), FALSE),
        COALESCE(BOOL_AND(
            (
                slot_row.sessions_materialized_at IS NULL
                AND session_id IS NULL
            )
            OR (
                slot_row.sessions_materialized_at IS NOT NULL
                AND session_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.sessions AS materialized_session
                    JOIN public.subscriptions AS materialized_subscription
                      ON materialized_subscription.id = slot_row.sold_subscription_id
                    WHERE materialized_session.id = session_id
                      AND materialized_session.subscription_id = slot_row.sold_subscription_id
                      AND materialized_session.student_id = materialized_subscription.student_id
                      AND materialized_session.teacher_id = slot_row.teacher_id
                )
            )
        ), FALSE)
    INTO
        occurrence_count,
        occurrence_indexes,
        occurrence_one,
        local_pattern_valid,
        blocking_valid,
        materialized_binding_valid
    FROM public.bookable_slot_occurrences
    WHERE slot_id = target_slot_id;

    IF occurrence_count <> 4
       OR occurrence_indexes IS DISTINCT FROM ARRAY[1, 2, 3, 4]::SMALLINT[]
       OR occurrence_one IS DISTINCT FROM slot_row.first_occurrence_at
       OR NOT local_pattern_valid
       OR NOT blocking_valid
       OR NOT materialized_binding_valid THEN
        RAISE EXCEPTION 'bookable_slot_requires_exact_local_weekly_cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_bookable_slot_occurrences()
    FROM PUBLIC, anon, authenticated;

-- The original trigger required a live `held` row on every subscription
-- status update. Once checkout completed, that hold became `consumed`, making
-- renewals, pauses and cancellations impossible. Validate the transient state
-- on INSERT and the durable consumed/sold state thereafter.
CREATE OR REPLACE FUNCTION private.guard_subscription_checkout_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    durable_binding BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT'
       AND NEW.contract_schema_version = 2
       AND NEW.checkout_intent_id IS NULL THEN
        RAISE EXCEPTION 'versioned_subscription_requires_checkout_binding'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.contract_schema_version = 2 THEN
        IF ROW(
            NEW.checkout_intent_id,
            NEW.student_id,
            NEW.package_id,
            NEW.package_price_id,
            NEW.stripe_subscription_id,
            NEW.contract_schema_version
        ) IS DISTINCT FROM ROW(
            OLD.checkout_intent_id,
            OLD.student_id,
            OLD.package_id,
            OLD.package_price_id,
            OLD.stripe_subscription_id,
            OLD.contract_schema_version
        ) THEN
            RAISE EXCEPTION 'subscription_checkout_binding_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.checkout_intent_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = NEW.checkout_intent_id;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = NEW.checkout_intent_id;

    IF hold_row.id IS NOT NULL THEN
        SELECT * INTO slot_row
        FROM public.bookable_slots
        WHERE id = hold_row.slot_id;
    END IF;

    durable_binding := (
        hold_row.status = 'consumed'
        AND hold_row.subscription_id = NEW.id
        AND slot_row.status = 'sold'
        AND slot_row.sold_subscription_id = NEW.id
    );

    IF intent_row.id IS NULL
       OR hold_row.id IS NULL
       OR slot_row.id IS NULL
       OR intent_row.status <> 'completed'
       OR intent_row.stripe_checkout_session_id IS NULL
       OR NEW.contract_schema_version <> 2
       OR NEW.student_id IS DISTINCT FROM intent_row.student_id
       OR NEW.package_id IS DISTINCT FROM slot_row.package_id
       OR NEW.package_price_id IS DISTINCT FROM intent_row.package_price_id
       OR NEW.stripe_subscription_id IS NULL
       OR NEW.stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
       OR NEW.duration_months IS NOT NULL
       OR NEW.billing_interval_unit <> 'day'
       OR NEW.billing_interval_count <> 28
       OR NEW.class_duration_minutes <> 50 THEN
        RAISE EXCEPTION 'subscription_checkout_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF hold_row.status <> 'held'
           OR hold_row.subscription_id IS NOT NULL
           OR slot_row.status <> 'available'
           OR NEW.status <> 'active'
           OR NEW.stripe_invoice_id IS NULL
           OR NEW.stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$'
           OR NEW.starts_at IS DISTINCT FROM
                (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
           OR NEW.ends_at IS DISTINCT FROM NEW.starts_at + 28
           OR NEW.sessions_total <> 4
           OR NEW.contracted_sessions_per_period <> 4
           OR NEW.sessions_used IS DISTINCT FROM 0 THEN
            RAISE EXCEPTION 'subscription_checkout_binding_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NOT (
        durable_binding
        OR (
            hold_row.status = 'held'
            AND hold_row.subscription_id IS NULL
            AND slot_row.status = 'available'
            AND slot_row.sold_subscription_id IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'subscription_checkout_binding_lifecycle_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.status IN (
            'cancelled'::public.subscription_status,
            'expired'::public.subscription_status
       )
       AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'checkout_v2_terminal_subscription_cannot_reopen'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       AND durable_binding
       AND NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_weekly_allocations AS allocation_row
            WHERE allocation_row.subscription_id = NEW.id
              AND allocation_row.status = 'active'
       ) THEN
        RAISE EXCEPTION 'checkout_v2_live_subscription_requires_weekly_capacity'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_subscription_checkout_binding()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_subscription_checkout_binding_trigger
    ON public.subscriptions;
CREATE TRIGGER guard_subscription_checkout_binding_trigger
    BEFORE INSERT OR UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.guard_subscription_checkout_binding();

-- One immutable pair describes the immediate one-time Price and the recurring
-- 28-day Price. The existing package_prices.stripe_price_id remains the
-- recurring Price so legacy readers do not change meaning.
CREATE TABLE public.checkout_v2_price_snapshots (
    package_price_id UUID PRIMARY KEY
        REFERENCES public.package_prices(id) ON DELETE RESTRICT,
    stripe_account_id TEXT NOT NULL CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'),
    stripe_livemode BOOLEAN NOT NULL,
    initial_stripe_price_id TEXT NOT NULL UNIQUE
        CHECK (initial_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    recurring_stripe_price_id TEXT NOT NULL UNIQUE
        CHECK (recurring_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    initial_amount_cents INTEGER NOT NULL DEFAULT 25900
        CHECK (initial_amount_cents = 25900),
    recurring_amount_cents INTEGER NOT NULL DEFAULT 25900
        CHECK (recurring_amount_cents = 25900),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    recurring_interval_unit TEXT NOT NULL DEFAULT 'day'
        CHECK (recurring_interval_unit = 'day'),
    recurring_interval_count SMALLINT NOT NULL DEFAULT 28
        CHECK (recurring_interval_count = 28),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_prices_are_distinct CHECK (
        initial_stripe_price_id <> recurring_stripe_price_id
    )
);

CREATE TABLE public.checkout_v2_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
    cycle_kind TEXT NOT NULL CHECK (cycle_kind IN ('initial', 'renewal')),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    sessions_total SMALLINT NOT NULL DEFAULT 4 CHECK (sessions_total = 4),
    amount_cents INTEGER NOT NULL DEFAULT 25900 CHECK (amount_cents = 25900),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    stripe_price_id TEXT NOT NULL
        CHECK (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    stripe_invoice_id TEXT NOT NULL UNIQUE
        CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
    payment_id UUID NOT NULL UNIQUE
        REFERENCES public.payments(id) ON DELETE RESTRICT,
    materialization_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (materialization_state IN ('pending', 'ready')),
    sessions_materialized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_cycles_exact_period CHECK (
        ends_at = starts_at + INTERVAL '672 hours'
    ),
    CONSTRAINT checkout_v2_cycles_kind_number CHECK (
        (cycle_number = 1 AND cycle_kind = 'initial')
        OR (cycle_number > 1 AND cycle_kind = 'renewal')
    ),
    CONSTRAINT checkout_v2_cycles_materialization_lifecycle CHECK (
        (materialization_state = 'pending' AND sessions_materialized_at IS NULL)
        OR (materialization_state = 'ready' AND sessions_materialized_at IS NOT NULL)
    ),
    UNIQUE (subscription_id, cycle_number),
    UNIQUE (subscription_id, starts_at)
);

ALTER TABLE public.checkout_v2_cycles
    ADD CONSTRAINT checkout_v2_cycles_no_overlap_excl
    EXCLUDE USING gist (
        subscription_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    );

ALTER TABLE public.sessions
    ADD COLUMN checkout_v2_cycle_id UUID
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    ADD COLUMN checkout_v2_cycle_session_index SMALLINT
        CHECK (checkout_v2_cycle_session_index BETWEEN 1 AND 4),
    ADD CONSTRAINT sessions_checkout_v2_cycle_position_complete CHECK (
        (checkout_v2_cycle_id IS NULL) =
        (checkout_v2_cycle_session_index IS NULL)
    );
ALTER TABLE public.payments
    ADD COLUMN checkout_v2_cycle_id UUID
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX payments_checkout_v2_cycle_unique_idx
    ON public.payments(checkout_v2_cycle_id)
    WHERE checkout_v2_cycle_id IS NOT NULL;
CREATE INDEX sessions_checkout_v2_cycle_idx
    ON public.sessions(checkout_v2_cycle_id)
    WHERE checkout_v2_cycle_id IS NOT NULL;
CREATE UNIQUE INDEX sessions_checkout_v2_cycle_position_unique_idx
    ON public.sessions(checkout_v2_cycle_id, checkout_v2_cycle_session_index)
    WHERE checkout_v2_cycle_id IS NOT NULL;

CREATE TABLE public.checkout_v2_billing_state (
    subscription_id UUID PRIMARY KEY
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    first_session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    first_class_at TIMESTAMPTZ NOT NULL,
    renewal_anchor_at TIMESTAMPTZ NOT NULL,
    stripe_renewal_anchor_at TIMESTAMPTZ NOT NULL,
    anchor_state TEXT NOT NULL DEFAULT 'provisional'
        CHECK (anchor_state IN ('provisional', 'fixed')),
    anchor_revision BIGINT NOT NULL DEFAULT 1 CHECK (anchor_revision > 0),
    anchor_fixed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_anchor_exact_period CHECK (
        renewal_anchor_at = first_class_at + INTERVAL '672 hours'
    ),
    CONSTRAINT checkout_v2_anchor_stripe_synced CHECK (
        stripe_renewal_anchor_at = renewal_anchor_at
    ),
    CONSTRAINT checkout_v2_anchor_lifecycle CHECK (
        (anchor_state = 'provisional' AND anchor_fixed_at IS NULL)
        OR (
            anchor_state = 'fixed'
            AND anchor_fixed_at IS NOT NULL
            AND anchor_fixed_at >= first_class_at
        )
    )
);

-- A sold weekly time remains capacity while the subscription is active. The
-- exclusion operates in Madrid-local minute-of-week space and catches partial
-- overlaps, not only identical start times.
CREATE TABLE public.checkout_v2_weekly_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    slot_id UUID NOT NULL UNIQUE,
    teacher_id UUID NOT NULL,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    local_start_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    duration_minutes SMALLINT NOT NULL DEFAULT 50 CHECK (duration_minutes = 50),
    timezone_name TEXT NOT NULL DEFAULT 'Europe/Madrid'
        CHECK (timezone_name = 'Europe/Madrid'),
    weekly_start_minute INTEGER GENERATED ALWAYS AS (
        weekday::INTEGER * 1440
        + EXTRACT(HOUR FROM local_start_time)::INTEGER * 60
        + EXTRACT(MINUTE FROM local_start_time)::INTEGER
    ) STORED,
    status TEXT NOT NULL DEFAULT 'offered'
        CHECK (status IN ('offered', 'active', 'released')),
    released_at TIMESTAMPTZ,
    release_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_allocation_slot_teacher_fkey
        FOREIGN KEY (slot_id, teacher_id)
        REFERENCES public.bookable_slots(id, teacher_id) ON DELETE RESTRICT,
    CONSTRAINT checkout_v2_allocation_same_day CHECK (
        weekly_start_minute + duration_minutes <= (weekday::INTEGER + 1) * 1440
    ),
    CONSTRAINT checkout_v2_allocation_lifecycle CHECK (
        (
            status = 'offered'
            AND subscription_id IS NULL
            AND released_at IS NULL
            AND release_reason IS NULL
        )
        OR (
            status = 'active'
            AND subscription_id IS NOT NULL
            AND released_at IS NULL
            AND release_reason IS NULL
        )
        OR (
            status = 'released'
            AND released_at IS NOT NULL
            AND NULLIF(btrim(release_reason), '') IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX checkout_v2_weekly_allocations_one_active_subscription_idx
    ON public.checkout_v2_weekly_allocations(subscription_id)
    WHERE status = 'active';

ALTER TABLE public.checkout_v2_weekly_allocations
    ADD CONSTRAINT checkout_v2_weekly_capacity_excl
    EXCLUDE USING gist (
        teacher_id WITH =,
        int4range(
            weekly_start_minute,
            weekly_start_minute + duration_minutes,
            '[)'
        ) WITH &&
    ) WHERE (status IN ('offered', 'active'));

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
       OR price_row.amount_cents IS DISTINCT FROM 25900
       OR price_row.currency IS DISTINCT FROM 'eur'
       OR price_row.billing_interval_unit IS DISTINCT FROM 'day'
       OR price_row.billing_interval_count IS DISTINCT FROM 28
       OR price_row.sessions_per_period IS DISTINCT FROM 4
       OR price_row.class_duration_minutes IS DISTINCT FROM 50
       OR price_row.stripe_price_id IS DISTINCT FROM NEW.recurring_stripe_price_id
       OR price_row.stripe_account_id IS DISTINCT FROM NEW.stripe_account_id
       OR price_row.stripe_livemode IS DISTINCT FROM NEW.stripe_livemode THEN
        RAISE EXCEPTION 'checkout_v2_price_snapshot_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_price_snapshot_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_price_snapshots
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_price_snapshot();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_billing_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.anchor_state IS DISTINCT FROM 'provisional'
           OR NEW.anchor_revision IS DISTINCT FROM 1
           OR NEW.anchor_fixed_at IS NOT NULL
           OR NOT EXISTS (
                SELECT 1
                FROM public.subscriptions AS subscription_row
                JOIN public.sessions AS first_session
                  ON first_session.id = NEW.first_session_id
                 AND first_session.subscription_id = subscription_row.id
                JOIN public.checkout_v2_cycles AS first_cycle
                  ON first_cycle.id = first_session.checkout_v2_cycle_id
                 AND first_cycle.subscription_id = subscription_row.id
                 AND first_cycle.cycle_number = 1
                 AND first_cycle.cycle_kind = 'initial'
                WHERE subscription_row.id = NEW.subscription_id
                  AND subscription_row.contract_schema_version = 2
                  AND first_session.checkout_v2_cycle_session_index = 1
                  AND first_session.status = 'scheduled'
                  AND first_session.scheduled_at = NEW.first_class_at
                  AND first_cycle.starts_at = NEW.first_class_at
                  AND first_cycle.ends_at = NEW.renewal_anchor_at
           ) THEN
            RAISE EXCEPTION 'checkout_v2_billing_initial_state_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
           OR NEW.first_session_id IS DISTINCT FROM OLD.first_session_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'checkout_v2_billing_identity_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.anchor_state = 'fixed'
           AND ROW(
                NEW.first_class_at,
                NEW.renewal_anchor_at,
                NEW.stripe_renewal_anchor_at,
                NEW.anchor_state,
                NEW.anchor_fixed_at,
                NEW.anchor_revision
           ) IS DISTINCT FROM ROW(
                OLD.first_class_at,
                OLD.renewal_anchor_at,
                OLD.stripe_renewal_anchor_at,
                OLD.anchor_state,
                OLD.anchor_fixed_at,
                OLD.anchor_revision
           ) THEN
            RAISE EXCEPTION 'fixed_checkout_v2_anchor_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(
            NEW.first_class_at,
            NEW.renewal_anchor_at,
            NEW.stripe_renewal_anchor_at
        ) IS DISTINCT FROM ROW(
            OLD.first_class_at,
            OLD.renewal_anchor_at,
            OLD.stripe_renewal_anchor_at
        ) AND NEW.anchor_revision IS DISTINCT FROM OLD.anchor_revision + 1 THEN
            RAISE EXCEPTION 'checkout_v2_anchor_revision_must_advance_once'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(
            NEW.first_class_at,
            NEW.renewal_anchor_at,
            NEW.stripe_renewal_anchor_at
        ) IS NOT DISTINCT FROM ROW(
            OLD.first_class_at,
            OLD.renewal_anchor_at,
            OLD.stripe_renewal_anchor_at
        ) AND NEW.anchor_revision IS DISTINCT FROM OLD.anchor_revision THEN
            RAISE EXCEPTION 'checkout_v2_anchor_revision_cannot_drift'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.anchor_state = 'provisional'
           AND NEW.anchor_state = 'fixed'
           AND (
                NEW.anchor_fixed_at IS NULL
                OR NEW.anchor_fixed_at < NEW.first_class_at
                OR NEW.anchor_fixed_at > clock_timestamp()
                OR clock_timestamp() < NEW.first_class_at
           ) THEN
            RAISE EXCEPTION 'checkout_v2_anchor_cannot_be_fixed'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.anchor_state IS DISTINCT FROM OLD.anchor_state
           AND NOT (OLD.anchor_state = 'provisional' AND NEW.anchor_state = 'fixed') THEN
            RAISE EXCEPTION 'checkout_v2_anchor_state_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_billing_state_trigger
    BEFORE INSERT OR UPDATE ON public.checkout_v2_billing_state
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_billing_state();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    previous_cycle public.checkout_v2_cycles%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'checkout_v2_cycle_cannot_be_deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = NEW.subscription_id;

        SELECT * INTO payment_row
        FROM public.payments
        WHERE id = NEW.payment_id;

        SELECT * INTO previous_cycle
        FROM public.checkout_v2_cycles
        WHERE subscription_id = NEW.subscription_id
        ORDER BY cycle_number DESC
        LIMIT 1;

        IF subscription_row.id IS NULL
           OR subscription_row.contract_schema_version IS DISTINCT FROM 2
           OR payment_row.id IS NULL
           OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
           OR payment_row.student_id IS DISTINCT FROM subscription_row.student_id
           OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
           OR payment_row.amount IS DISTINCT FROM 25900
           OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
           OR payment_row.stripe_invoice_id IS DISTINCT FROM NEW.stripe_invoice_id
           OR payment_row.checkout_v2_cycle_id IS NOT NULL
           OR NOT EXISTS (
                SELECT 1
                FROM public.checkout_v2_price_snapshots AS price_snapshot
                WHERE price_snapshot.package_price_id = subscription_row.package_price_id
                  AND NEW.stripe_price_id = CASE
                        WHEN NEW.cycle_kind = 'initial'
                        THEN price_snapshot.initial_stripe_price_id
                        ELSE price_snapshot.recurring_stripe_price_id
                      END
           ) THEN
            RAISE EXCEPTION 'checkout_v2_cycle_financial_snapshot_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.cycle_kind = 'initial' THEN
            IF NEW.cycle_number IS DISTINCT FROM 1
               OR NEW.materialization_state IS DISTINCT FROM 'ready'
               OR previous_cycle.id IS NOT NULL
               OR subscription_row.stripe_invoice_id IS DISTINCT FROM NEW.stripe_invoice_id
               OR NOT EXISTS (
                    SELECT 1
                    FROM public.bookable_slots AS slot_row
                    JOIN public.bookable_slot_occurrences AS occurrence_row
                      ON occurrence_row.slot_id = slot_row.id
                     AND occurrence_row.occurrence_index = 1
                    JOIN public.sessions AS session_row
                      ON session_row.id = occurrence_row.session_id
                    WHERE slot_row.sold_subscription_id = subscription_row.id
                      AND slot_row.status = 'sold'
                      AND session_row.subscription_id = subscription_row.id
                      AND session_row.scheduled_at = NEW.starts_at
               ) THEN
                RAISE EXCEPTION 'checkout_v2_initial_cycle_is_invalid'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            SELECT * INTO billing_row
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = NEW.subscription_id;

            IF previous_cycle.id IS NULL
               OR NEW.materialization_state IS DISTINCT FROM 'pending'
               OR NEW.cycle_number IS DISTINCT FROM previous_cycle.cycle_number + 1
               OR NEW.starts_at IS DISTINCT FROM previous_cycle.ends_at
               OR subscription_row.stripe_invoice_id IS DISTINCT FROM previous_cycle.stripe_invoice_id
               OR billing_row.anchor_state IS DISTINCT FROM 'fixed' THEN
                RAISE EXCEPTION 'checkout_v2_renewal_cycle_is_invalid'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF ROW(
            NEW.id,
            NEW.subscription_id,
            NEW.cycle_number,
            NEW.cycle_kind,
            NEW.sessions_total,
            NEW.amount_cents,
            NEW.currency,
            NEW.stripe_price_id,
            NEW.stripe_invoice_id,
            NEW.payment_id,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.id,
            OLD.subscription_id,
            OLD.cycle_number,
            OLD.cycle_kind,
            OLD.sessions_total,
            OLD.amount_cents,
            OLD.currency,
            OLD.stripe_price_id,
            OLD.stripe_invoice_id,
            OLD.payment_id,
            OLD.created_at
        ) THEN
            RAISE EXCEPTION 'checkout_v2_cycle_financial_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(NEW.materialization_state, NEW.sessions_materialized_at)
           IS DISTINCT FROM
           ROW(OLD.materialization_state, OLD.sessions_materialized_at)
           AND NOT (
                OLD.materialization_state = 'pending'
                AND NEW.materialization_state = 'ready'
                AND OLD.sessions_materialized_at IS NULL
                AND NEW.sessions_materialized_at IS NOT NULL
                AND (
                    SELECT COUNT(*)
                    FROM public.sessions
                    WHERE checkout_v2_cycle_id = OLD.id
                      AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
                ) = 4
           ) THEN
            RAISE EXCEPTION 'checkout_v2_cycle_materialization_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(NEW.starts_at, NEW.ends_at)
           IS DISTINCT FROM ROW(OLD.starts_at, OLD.ends_at) THEN
            SELECT * INTO billing_row
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = OLD.subscription_id;

            IF OLD.cycle_number <> 1
               OR billing_row.anchor_state IS DISTINCT FROM 'provisional' THEN
                RAISE EXCEPTION 'checkout_v2_cycle_period_is_immutable'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_cycle_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_cycles
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_cycle();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_weekly_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
BEGIN
    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = NEW.slot_id;

    IF slot_row.id IS NULL
       OR slot_row.teacher_id IS DISTINCT FROM NEW.teacher_id
       OR slot_row.weekday IS DISTINCT FROM NEW.weekday
       OR slot_row.local_start_time IS DISTINCT FROM NEW.local_start_time
       OR slot_row.timezone_name IS DISTINCT FROM NEW.timezone_name THEN
        RAISE EXCEPTION 'checkout_v2_weekly_allocation_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'offered' AND (
        NEW.subscription_id IS NOT NULL
        OR slot_row.status NOT IN ('available', 'paused')
    ) THEN
        RAISE EXCEPTION 'checkout_v2_weekly_offer_is_invalid'
            USING ERRCODE = '23514';
    ELSIF NEW.status = 'active' AND (
        NEW.subscription_id IS NULL
        OR slot_row.status <> 'sold'
        OR slot_row.sold_subscription_id IS DISTINCT FROM NEW.subscription_id
    ) THEN
        RAISE EXCEPTION 'checkout_v2_weekly_assignment_is_invalid'
            USING ERRCODE = '23514';
    ELSIF NEW.status = 'released' THEN
        IF NEW.subscription_id IS NOT NULL THEN
            SELECT * INTO subscription_row
            FROM public.subscriptions
            WHERE id = NEW.subscription_id;
        END IF;

        IF NOT (
            (OLD.status = 'offered' AND slot_row.status = 'retired')
            OR (
                OLD.status = 'active'
                AND subscription_row.status IN (
                    'cancelled'::public.subscription_status,
                    'expired'::public.subscription_status
                )
            )
        ) THEN
            RAISE EXCEPTION 'checkout_v2_weekly_release_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF ROW(
            NEW.slot_id,
            NEW.teacher_id,
            NEW.weekday,
            NEW.local_start_time,
            NEW.duration_minutes,
            NEW.timezone_name,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.slot_id,
            OLD.teacher_id,
            OLD.weekday,
            OLD.local_start_time,
            OLD.duration_minutes,
            OLD.timezone_name,
            OLD.created_at
        ) OR NOT (
            NEW.status = OLD.status
            OR (
                OLD.status = 'offered'
                AND NEW.status = 'active'
                AND OLD.subscription_id IS NULL
                AND NEW.subscription_id IS NOT NULL
            )
            OR (OLD.status = 'offered' AND NEW.status = 'released')
            OR (OLD.status = 'active' AND NEW.status = 'released')
        ) OR (
            NEW.status = OLD.status
            AND ROW(NEW.subscription_id, NEW.released_at, NEW.release_reason)
                IS DISTINCT FROM
                ROW(OLD.subscription_id, OLD.released_at, OLD.release_reason)
        ) OR (
            NEW.status = 'released'
            AND (
                NEW.released_at IS NULL
                OR NULLIF(btrim(NEW.release_reason), '') IS NULL
            )
        ) THEN
            RAISE EXCEPTION 'checkout_v2_weekly_allocation_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_weekly_allocation_trigger
    BEFORE INSERT OR UPDATE ON public.checkout_v2_weekly_allocations
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_weekly_allocation();

CREATE OR REPLACE FUNCTION private.sync_checkout_v2_weekly_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version <> 2 THEN
        RETURN NULL;
    END IF;

    IF NEW.status IN ('available', 'paused') AND NOT EXISTS (
        SELECT 1
        FROM public.package_prices AS package_price
        JOIN public.checkout_v2_price_snapshots AS price_snapshot
          ON price_snapshot.package_price_id = package_price.id
        WHERE package_price.package_id = NEW.package_id
          AND package_price.contract_schema_version = 2
          AND package_price.status = 'active'
    ) THEN
        IF NEW.status = 'available' THEN
            RAISE EXCEPTION 'checkout_v2_slot_requires_complete_price_snapshot'
                USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
    END IF;

    IF NEW.status IN ('available', 'paused') THEN
        INSERT INTO public.checkout_v2_weekly_allocations (
            slot_id,
            teacher_id,
            weekday,
            local_start_time,
            timezone_name,
            status
        ) VALUES (
            NEW.id,
            NEW.teacher_id,
            NEW.weekday,
            NEW.local_start_time,
            NEW.timezone_name,
            'offered'
        )
        ON CONFLICT (slot_id) DO NOTHING;
    ELSIF NEW.status = 'sold' THEN
        UPDATE public.checkout_v2_weekly_allocations
        SET
            subscription_id = NEW.sold_subscription_id,
            status = 'active'
        WHERE slot_id = NEW.id
          AND status = 'offered';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'sold_checkout_v2_slot_has_no_weekly_capacity'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.status = 'retired' THEN
        UPDATE public.checkout_v2_weekly_allocations
        SET
            status = 'released',
            released_at = clock_timestamp(),
            release_reason = 'slot_retired'
        WHERE slot_id = NEW.id
          AND status = 'offered';
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER sync_checkout_v2_weekly_allocation_trigger
    AFTER INSERT OR UPDATE OF status ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.sync_checkout_v2_weekly_allocation();

-- A sold slot is an immutable sale snapshot, but its weekly capacity is not
-- permanent. Ending a V2 subscription releases only the allocation row, so a
-- later offer can reuse that teacher/time without rewriting history.
CREATE OR REPLACE FUNCTION private.release_checkout_v2_allocation_on_subscription_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version <> 2
       OR NEW.status NOT IN (
            'cancelled'::public.subscription_status,
            'expired'::public.subscription_status
       )
       OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NULL;
    END IF;

    UPDATE public.checkout_v2_weekly_allocations
    SET
        status = 'released',
        released_at = clock_timestamp(),
        release_reason = 'subscription_' || NEW.status::TEXT
    WHERE subscription_id = NEW.id
      AND status = 'active';

    IF NOT FOUND AND NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations
        WHERE subscription_id = NEW.id
          AND status = 'released'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_terminal_subscription_has_no_allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER release_checkout_v2_allocation_on_subscription_end_trigger
    AFTER UPDATE OF status ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.release_checkout_v2_allocation_on_subscription_end();

-- Price snapshots do not exist before this migration, so no existing durable
-- Checkout V2 sale can be attributed safely. Require a clean activation point
-- instead of guessing a Stripe Price pair or backfilling weekly capacity.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.bookable_slots AS slot_row
        WHERE slot_row.contract_schema_version = 2
          AND slot_row.status IN ('available', 'paused', 'sold')
    ) THEN
        RAISE EXCEPTION 'checkout_v2_billing_foundation_requires_zero_durable_v2_slots'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.subscriptions AS subscription_row
        WHERE subscription_row.contract_schema_version = 2
          AND subscription_row.status IN (
                'active'::public.subscription_status,
                'paused'::public.subscription_status
          )
          AND NOT EXISTS (
                SELECT 1
                FROM public.bookable_slots AS sold_slot
                WHERE sold_slot.contract_schema_version = 2
                  AND sold_slot.status = 'sold'
                  AND sold_slot.sold_subscription_id = subscription_row.id
          )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_billing_foundation_rejects_unbound_active_subscription'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

-- Session and payment attribution must always stay inside the owning
-- subscription, even for direct service-role writes.
CREATE OR REPLACE FUNCTION private.guard_checkout_v2_cycle_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_cycle_id IS NOT NULL
       AND NEW.checkout_v2_cycle_id IS DISTINCT FROM OLD.checkout_v2_cycle_id THEN
        RAISE EXCEPTION 'checkout_v2_cycle_binding_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_cycle_id IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_cycles AS cycle_row
            WHERE cycle_row.id = NEW.checkout_v2_cycle_id
              AND cycle_row.subscription_id = NEW.subscription_id
              AND (
                    TG_TABLE_NAME <> 'payments'
                    OR cycle_row.payment_id = NEW.id
              )
              AND (
                    TG_TABLE_NAME <> 'sessions'
                    OR cycle_row.materialization_state = 'ready'
              )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_subscription_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_session_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_cycle_id IS NOT NULL
       AND ROW(
            NEW.checkout_v2_cycle_id,
            NEW.checkout_v2_cycle_session_index
       ) IS DISTINCT FROM ROW(
            OLD.checkout_v2_cycle_id,
            OLD.checkout_v2_cycle_session_index
       ) THEN
        RAISE EXCEPTION 'checkout_v2_session_cycle_position_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF (NEW.checkout_v2_cycle_id IS NULL) <>
       (NEW.checkout_v2_cycle_session_index IS NULL) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_position_is_incomplete'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_materialized_session_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF OLD.checkout_v2_cycle_id IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_v2_materialized_session_cannot_be_deleted'
            USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER guard_session_checkout_v2_cycle_binding_trigger
    BEFORE INSERT OR UPDATE OF
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index,
        subscription_id
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_cycle_binding();

CREATE TRIGGER guard_session_checkout_v2_cycle_position_trigger
    BEFORE INSERT OR UPDATE OF
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_session_position();

CREATE TRIGGER guard_checkout_v2_materialized_session_delete_trigger
    BEFORE DELETE ON public.sessions
    FOR EACH ROW
    WHEN (OLD.checkout_v2_cycle_id IS NOT NULL)
    EXECUTE FUNCTION private.guard_checkout_v2_materialized_session_delete();

CREATE TRIGGER guard_payment_checkout_v2_cycle_binding_trigger
    BEFORE INSERT OR UPDATE OF checkout_v2_cycle_id, subscription_id
    ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_cycle_binding();

-- Register the verified Stripe pair once. The caller must verify both remote
-- Price objects before invoking this database boundary.
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
        recurring_stripe_price_id
    ) VALUES (
        p_package_price_id,
        p_stripe_account_id,
        p_stripe_livemode,
        p_initial_stripe_price_id,
        p_recurring_stripe_price_id
    )
    RETURNING * INTO snapshot_row;

    RETURN snapshot_row;
END;
$$;

-- Initialize the exact first cycle only after the paid subscription, consumed
-- hold and four materialized sessions all exist. The transaction either links
-- every ledger row or leaves no partial billing foundation.
CREATE OR REPLACE FUNCTION public.initialize_checkout_v2_billing(
    p_subscription_id UUID,
    p_first_session_id UUID,
    p_initial_payment_id UUID,
    p_initial_stripe_price_id TEXT,
    p_stripe_renewal_anchor_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_billing_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    first_session_row public.sessions%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    existing_cycle public.checkout_v2_cycles%ROWTYPE;
    materialized_count INTEGER;
BEGIN
    -- Match consume_bookable_slot_hold's slot -> hold -> subscription order so
    -- a recovery attempt cannot deadlock checkout finalization.
    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE subscription_id = p_subscription_id
      AND status = 'consumed';

    IF hold_row.id IS NOT NULL THEN
        SELECT * INTO slot_row
        FROM public.bookable_slots
        WHERE id = hold_row.slot_id
        FOR UPDATE;
    END IF;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE subscription_id = p_subscription_id
      AND status = 'consumed'
    FOR UPDATE;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO first_session_row
    FROM public.sessions
    WHERE id = p_first_session_id
    FOR UPDATE;

    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = p_initial_payment_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    SELECT COUNT(*) INTO materialized_count
    FROM public.bookable_slot_occurrences
    WHERE slot_id = slot_row.id
      AND session_id IS NOT NULL;

    IF billing_row.subscription_id IS NOT NULL THEN
        SELECT * INTO existing_cycle
        FROM public.checkout_v2_cycles
        WHERE subscription_id = p_subscription_id
          AND cycle_number = 1
        FOR UPDATE;

        IF subscription_row.id IS NULL
           OR subscription_row.contract_schema_version IS DISTINCT FROM 2
           OR billing_row.first_session_id IS DISTINCT FROM p_first_session_id
           OR billing_row.renewal_anchor_at IS DISTINCT FROM p_stripe_renewal_anchor_at
           OR first_session_row.subscription_id IS DISTINCT FROM p_subscription_id
           OR existing_cycle.id IS NULL
           OR existing_cycle.starts_at IS DISTINCT FROM billing_row.first_class_at
           OR existing_cycle.ends_at IS DISTINCT FROM billing_row.renewal_anchor_at
           OR existing_cycle.payment_id IS DISTINCT FROM p_initial_payment_id
           OR existing_cycle.stripe_price_id IS DISTINCT FROM p_initial_stripe_price_id
           OR existing_cycle.materialization_state IS DISTINCT FROM 'ready'
           OR existing_cycle.sessions_materialized_at IS NULL
           OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM existing_cycle.id
           OR hold_row.status IS DISTINCT FROM 'consumed'
           OR slot_row.status IS DISTINCT FROM 'sold'
           OR slot_row.sold_subscription_id IS DISTINCT FROM p_subscription_id
           OR (
                SELECT COUNT(*)
                FROM public.sessions
                WHERE subscription_id = p_subscription_id
                  AND checkout_v2_cycle_id = existing_cycle.id
                  AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
           ) IS DISTINCT FROM 4
           OR NOT EXISTS (
                SELECT 1
                FROM public.checkout_v2_weekly_allocations
                WHERE slot_id = slot_row.id
                  AND subscription_id = subscription_row.id
                  AND status IN ('active', 'released')
           )
           OR NOT EXISTS (
                SELECT 1
                FROM public.checkout_v2_price_snapshots
                WHERE package_price_id = subscription_row.package_price_id
                  AND initial_stripe_price_id = p_initial_stripe_price_id
           ) THEN
            RAISE EXCEPTION 'checkout_v2_billing_is_already_initialized'
                USING ERRCODE = '23505';
        END IF;
        RETURN billing_row;
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status IS DISTINCT FROM 'active'::public.subscription_status
       OR subscription_row.sessions_total IS DISTINCT FROM 4
       OR subscription_row.contracted_sessions_per_period IS DISTINCT FROM 4
       OR subscription_row.sessions_used IS DISTINCT FROM 4
       OR first_session_row.id IS NULL
       OR first_session_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR first_session_row.status IS DISTINCT FROM 'scheduled'
       OR first_session_row.scheduled_at IS NULL
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM 25900
       OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
       OR payment_row.stripe_invoice_id IS DISTINCT FROM subscription_row.stripe_invoice_id
       OR (billing_row.subscription_id IS NULL AND payment_row.checkout_v2_cycle_id IS NOT NULL)
       OR hold_row.id IS NULL
       OR slot_row.status IS DISTINCT FROM 'sold'
       OR slot_row.sold_subscription_id IS DISTINCT FROM subscription_row.id
       OR slot_row.sessions_materialized_at IS NULL
       OR materialized_count IS DISTINCT FROM 4
       OR NOT EXISTS (
            SELECT 1
            FROM public.bookable_slot_occurrences
            WHERE slot_id = slot_row.id
              AND occurrence_index = 1
              AND session_id = first_session_row.id
       )
       OR p_stripe_renewal_anchor_at IS DISTINCT FROM
            first_session_row.scheduled_at + INTERVAL '672 hours'
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_price_snapshots
            WHERE package_price_id = subscription_row.package_price_id
              AND initial_stripe_price_id = p_initial_stripe_price_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_billing_initialization_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.checkout_v2_cycles (
        subscription_id,
        cycle_number,
        cycle_kind,
        starts_at,
        ends_at,
        stripe_price_id,
        stripe_invoice_id,
        payment_id,
        materialization_state,
        sessions_materialized_at
    ) VALUES (
        subscription_row.id,
        1,
        'initial',
        first_session_row.scheduled_at,
        p_stripe_renewal_anchor_at,
        p_initial_stripe_price_id,
        subscription_row.stripe_invoice_id,
        payment_row.id,
        'ready',
        clock_timestamp()
    )
    RETURNING * INTO cycle_row;

    UPDATE public.sessions AS session_row
    SET
        checkout_v2_cycle_id = cycle_row.id,
        checkout_v2_cycle_session_index = occurrence_row.occurrence_index
    FROM public.bookable_slot_occurrences AS occurrence_row
    WHERE occurrence_row.slot_id = slot_row.id
      AND occurrence_row.session_id = session_row.id
      AND session_row.subscription_id = subscription_row.id;

    GET DIAGNOSTICS materialized_count = ROW_COUNT;
    IF materialized_count IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_initial_cycle_session_binding_failed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.payments
    SET checkout_v2_cycle_id = cycle_row.id
    WHERE id = payment_row.id;

    INSERT INTO public.checkout_v2_billing_state (
        subscription_id,
        first_session_id,
        first_class_at,
        renewal_anchor_at,
        stripe_renewal_anchor_at
    ) VALUES (
        subscription_row.id,
        first_session_row.id,
        first_session_row.scheduled_at,
        p_stripe_renewal_anchor_at,
        p_stripe_renewal_anchor_at
    )
    RETURNING * INTO billing_row;

    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations
        WHERE slot_id = slot_row.id
          AND subscription_id = subscription_row.id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_weekly_assignment_is_missing'
            USING ERRCODE = '23514';
    END IF;

    RETURN billing_row;
END;
$$;

-- Stripe is updated first with a stable application idempotency key; this RPC
-- then reconciles the exact observed anchor. A repeated confirmation converges
-- without advancing the revision twice.
CREATE OR REPLACE FUNCTION public.reconcile_checkout_v2_provisional_anchor(
    p_subscription_id UUID,
    p_expected_revision BIGINT,
    p_new_first_local_date DATE,
    p_observed_stripe_renewal_anchor_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_billing_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    new_first_local TIMESTAMP;
    new_first_class_at TIMESTAMPTZ;
    affected_sessions INTEGER;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    IF billing_row.subscription_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_billing_state_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE subscription_id = p_subscription_id
      AND cycle_number = 1
    FOR UPDATE;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations
    WHERE subscription_id = p_subscription_id
      AND status = 'active'
    FOR UPDATE;

    IF p_new_first_local_date IS NULL OR allocation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_provisional_anchor_cannot_move'
            USING ERRCODE = '23514';
    END IF;

    new_first_local := p_new_first_local_date + allocation_row.local_start_time;
    new_first_class_at := new_first_local AT TIME ZONE allocation_row.timezone_name;

    IF billing_row.first_class_at IS NOT DISTINCT FROM new_first_class_at
       AND billing_row.renewal_anchor_at IS NOT DISTINCT FROM p_observed_stripe_renewal_anchor_at THEN
        IF p_expected_revision NOT IN (
            billing_row.anchor_revision,
            billing_row.anchor_revision - 1
        ) THEN
            RAISE EXCEPTION 'checkout_v2_anchor_revision_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN billing_row;
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       OR billing_row.anchor_state IS DISTINCT FROM 'provisional'
       OR billing_row.anchor_revision IS DISTINCT FROM p_expected_revision
       OR clock_timestamp() >= billing_row.first_class_at
       OR new_first_class_at <= clock_timestamp()
       OR EXTRACT(DOW FROM p_new_first_local_date)::SMALLINT
            IS DISTINCT FROM allocation_row.weekday
       OR (new_first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
            IS DISTINCT FROM p_new_first_local_date
       OR (new_first_class_at AT TIME ZONE allocation_row.timezone_name)::TIME(0)
            IS DISTINCT FROM allocation_row.local_start_time
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.generate_series(0, 3) AS occurrence(week_offset)
            CROSS JOIN LATERAL (
                SELECT
                    new_first_local
                    + pg_catalog.make_interval(days => occurrence.week_offset * 7)
                        AS local_occurrence_at
            ) AS target
            CROSS JOIN LATERAL (
                SELECT COUNT(*) AS matching_instants
                FROM pg_catalog.generate_series(
                    (
                        target.local_occurrence_at
                        AT TIME ZONE allocation_row.timezone_name
                    ) - INTERVAL '2 hours',
                    (
                        target.local_occurrence_at
                        AT TIME ZONE allocation_row.timezone_name
                    ) + INTERVAL '2 hours',
                    INTERVAL '30 minutes'
                ) AS candidate(candidate_at)
                WHERE (
                    candidate.candidate_at
                    AT TIME ZONE allocation_row.timezone_name
                ) = target.local_occurrence_at
            ) AS resolution
            WHERE resolution.matching_instants <> 1
       )
       OR p_observed_stripe_renewal_anchor_at IS DISTINCT FROM
            new_first_class_at + INTERVAL '672 hours'
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_kind IS DISTINCT FROM 'initial'
       OR NOT EXISTS (
            SELECT 1
            FROM public.sessions
            WHERE id = billing_row.first_session_id
              AND checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 1
       )
       OR (
            SELECT COUNT(*)
            FROM public.sessions AS session_row
            WHERE session_row.checkout_v2_cycle_id = cycle_row.id
              AND session_row.subscription_id = p_subscription_id
              AND session_row.teacher_id = allocation_row.teacher_id
              AND session_row.duration_minutes = 50
              AND session_row.status = 'scheduled'
              AND session_row.scheduled_at > clock_timestamp()
              AND session_row.checkout_v2_cycle_session_index BETWEEN 1 AND 4
       ) IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_provisional_anchor_cannot_move'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(allocation_row.teacher_id::TEXT, 42850)
    );

    PERFORM 1
    FROM public.sessions
    WHERE checkout_v2_cycle_id = cycle_row.id
    ORDER BY checkout_v2_cycle_session_index
    FOR UPDATE;

    -- Move the four timestamps to an empty range first so a whole-week shift
    -- cannot collide transiently with another row from the same cycle's
    -- immediate exclusion constraint. `infinity + duration = infinity`.
    UPDATE public.sessions
    SET scheduled_at = 'infinity'::TIMESTAMPTZ
    WHERE checkout_v2_cycle_id = cycle_row.id;
    GET DIAGNOSTICS affected_sessions = ROW_COUNT;

    IF affected_sessions IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_provisional_anchor_session_count_changed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.sessions AS session_row
    SET scheduled_at = (
        new_first_local
        + pg_catalog.make_interval(
            days => (session_row.checkout_v2_cycle_session_index - 1) * 7
          )
    ) AT TIME ZONE allocation_row.timezone_name
    WHERE session_row.checkout_v2_cycle_id = cycle_row.id;

    UPDATE public.checkout_v2_cycles
    SET
        starts_at = new_first_class_at,
        ends_at = p_observed_stripe_renewal_anchor_at,
        updated_at = clock_timestamp()
    WHERE id = cycle_row.id;

    UPDATE public.checkout_v2_billing_state
    SET
        first_class_at = new_first_class_at,
        renewal_anchor_at = p_observed_stripe_renewal_anchor_at,
        stripe_renewal_anchor_at = p_observed_stripe_renewal_anchor_at,
        anchor_revision = anchor_revision + 1
    WHERE subscription_id = p_subscription_id
    RETURNING * INTO billing_row;

    UPDATE public.subscriptions
    SET
        starts_at = p_new_first_local_date,
        ends_at = (
            p_observed_stripe_renewal_anchor_at AT TIME ZONE 'Europe/Madrid'
        )::DATE
    WHERE id = p_subscription_id;

    RETURN billing_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fix_checkout_v2_billing_anchor(
    p_subscription_id UUID,
    p_fixed_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_billing_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    billing_row public.checkout_v2_billing_state%ROWTYPE;
BEGIN
    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    IF billing_row.anchor_state = 'fixed' THEN
        IF billing_row.anchor_fixed_at IS DISTINCT FROM p_fixed_at THEN
            RAISE EXCEPTION 'checkout_v2_fixed_anchor_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN billing_row;
    END IF;

    IF billing_row.subscription_id IS NULL
       OR p_fixed_at IS NULL
       OR p_fixed_at < billing_row.first_class_at
       OR clock_timestamp() < billing_row.first_class_at
       OR p_fixed_at > clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_v2_anchor_cannot_be_fixed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.checkout_v2_billing_state
    SET anchor_state = 'fixed', anchor_fixed_at = p_fixed_at
    WHERE subscription_id = p_subscription_id
    RETURNING * INTO billing_row;

    RETURN billing_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_checkout_v2_renewal(
    p_subscription_id UUID,
    p_stripe_subscription_id TEXT,
    p_stripe_invoice_id TEXT,
    p_payment_id UUID,
    p_recurring_stripe_price_id TEXT,
    p_period_start TIMESTAMPTZ,
    p_period_end TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    previous_cycle public.checkout_v2_cycles%ROWTYPE;
    existing_cycle public.checkout_v2_cycles%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    next_cycle public.checkout_v2_cycles%ROWTYPE;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id
       OR billing_row.subscription_id IS NULL
       OR p_stripe_invoice_id IS NULL
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$'
       OR p_recurring_stripe_price_id IS NULL
       OR p_recurring_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_period_start IS NULL
       OR p_period_end IS DISTINCT FROM p_period_start + INTERVAL '672 hours'
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_price_snapshots
            WHERE package_price_id = subscription_row.package_price_id
              AND recurring_stripe_price_id = p_recurring_stripe_price_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_renewal_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO existing_cycle
    FROM public.checkout_v2_cycles
    WHERE stripe_invoice_id = p_stripe_invoice_id
    FOR UPDATE;
    IF FOUND THEN
        IF existing_cycle.subscription_id IS DISTINCT FROM p_subscription_id
           OR existing_cycle.payment_id IS DISTINCT FROM p_payment_id
           OR existing_cycle.stripe_price_id IS DISTINCT FROM p_recurring_stripe_price_id
           OR existing_cycle.starts_at IS DISTINCT FROM p_period_start
           OR existing_cycle.ends_at IS DISTINCT FROM p_period_end
           OR payment_row.id IS NULL
           OR payment_row.subscription_id IS DISTINCT FROM p_subscription_id
           OR payment_row.stripe_invoice_id IS DISTINCT FROM p_stripe_invoice_id
           OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM existing_cycle.id THEN
            RAISE EXCEPTION 'checkout_v2_renewal_invoice_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN FALSE;
    END IF;

    SELECT * INTO previous_cycle
    FROM public.checkout_v2_cycles
    WHERE subscription_id = p_subscription_id
    ORDER BY cycle_number DESC
    LIMIT 1
    FOR UPDATE;

    IF subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       OR subscription_row.stripe_invoice_id IS DISTINCT FROM previous_cycle.stripe_invoice_id
       OR billing_row.anchor_state IS DISTINCT FROM 'fixed'
       OR previous_cycle.id IS NULL
       OR previous_cycle.materialization_state IS DISTINCT FROM 'ready'
       OR p_period_start IS DISTINCT FROM previous_cycle.ends_at
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM p_subscription_id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM 25900
       OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
       OR payment_row.stripe_invoice_id IS DISTINCT FROM p_stripe_invoice_id
       OR payment_row.checkout_v2_cycle_id IS NOT NULL
       THEN
        RAISE EXCEPTION 'checkout_v2_renewal_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.checkout_v2_cycles (
        subscription_id,
        cycle_number,
        cycle_kind,
        starts_at,
        ends_at,
        stripe_price_id,
        stripe_invoice_id,
        payment_id
    ) VALUES (
        p_subscription_id,
        previous_cycle.cycle_number + 1,
        'renewal',
        p_period_start,
        p_period_end,
        p_recurring_stripe_price_id,
        p_stripe_invoice_id,
        p_payment_id
    )
    RETURNING * INTO next_cycle;

    UPDATE public.payments
    SET checkout_v2_cycle_id = next_cycle.id
    WHERE id = p_payment_id;

    UPDATE public.subscriptions
    SET
        ends_at = (p_period_end AT TIME ZONE 'Europe/Madrid')::DATE,
        sessions_total = 4,
        sessions_used = 0,
        status = 'active',
        stripe_invoice_id = p_stripe_invoice_id
    WHERE id = p_subscription_id;

    RETURN TRUE;
END;
$$;

-- The historical helper remains byte-for-byte compatible for monthly V1
-- subscriptions, but it cannot bypass the cycle ledger for V2.
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
    IF p_subscription_id IS NULL
       OR p_stripe_subscription_id IS NULL
       OR p_stripe_invoice_id IS NULL
       OR p_new_ends_at IS NULL
       OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_renewal_snapshot'
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

    IF subscription_row.contract_schema_version = 2 THEN
        RAISE EXCEPTION 'checkout_v2_renewal_requires_cycle_ledger'
            USING ERRCODE = '23514';
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

ALTER TABLE public.checkout_v2_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_v2_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_v2_billing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_v2_weekly_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_v2_price_snapshots
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_v2_cycles
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_v2_billing_state
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_v2_weekly_allocations
    FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_price_snapshots
    FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_cycles
    FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_billing_state
    FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_weekly_allocations
    FROM service_role;

GRANT SELECT ON TABLE public.checkout_v2_price_snapshots TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_cycles TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_billing_state TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_weekly_allocations TO service_role;

REVOKE ALL ON FUNCTION private.guard_checkout_v2_price_snapshot()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_billing_state()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_cycle()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_weekly_allocation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_checkout_v2_weekly_allocation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.release_checkout_v2_allocation_on_subscription_end()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_cycle_binding()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_session_position()
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.register_checkout_v2_price_snapshot(UUID, TEXT, BOOLEAN, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_checkout_v2_price_snapshot(UUID, TEXT, BOOLEAN, TEXT, TEXT)
    TO service_role;

REVOKE ALL ON FUNCTION public.initialize_checkout_v2_billing(UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_checkout_v2_billing(UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_checkout_v2_provisional_anchor(UUID, BIGINT, DATE, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_checkout_v2_provisional_anchor(UUID, BIGINT, DATE, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.fix_checkout_v2_billing_anchor(UUID, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fix_checkout_v2_billing_anchor(UUID, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.apply_checkout_v2_renewal(UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_v2_renewal(UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    TO service_role;

COMMENT ON TABLE public.checkout_v2_price_snapshots IS
    'Immutable verified pair of the immediate one-time Stripe Price and recurring 28-day Stripe Price.';
COMMENT ON TABLE public.checkout_v2_billing_state IS
    'Exact first-class and renewal-anchor state; provisional until the first class starts, then immutable.';
COMMENT ON TABLE public.checkout_v2_cycles IS
    'One immutable 28-day, four-session, EUR 259 billing ledger row per paid Checkout V2 cycle.';
COMMENT ON TABLE public.checkout_v2_weekly_allocations IS
    'Persistent Madrid-local weekly teacher capacity owned by an active Checkout V2 subscription.';
