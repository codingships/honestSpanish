-- A sellable slot is capacity, not generic teacher availability. The first
-- four occurrences are stored as exact instants so checkout can snapshot a
-- real teacher, weekly time and first class before collecting payment.

ALTER TABLE public.subscriptions
    ADD COLUMN checkout_intent_id UUID
        REFERENCES public.checkout_intents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX subscriptions_checkout_intent_unique_idx
    ON public.subscriptions(checkout_intent_id)
    WHERE checkout_intent_id IS NOT NULL;

CREATE TABLE public.bookable_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    package_id UUID NOT NULL,
    contract_schema_version SMALLINT NOT NULL DEFAULT 2 CHECK (contract_schema_version = 2),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    local_start_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    timezone_name TEXT NOT NULL CHECK (timezone_name = 'Europe/Madrid'),
    first_occurrence_at TIMESTAMPTZ NOT NULL,
    capacity SMALLINT NOT NULL DEFAULT 1 CHECK (capacity = 1),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'available', 'paused', 'sold', 'retired')),
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sold_at TIMESTAMPTZ,
    sold_subscription_id UUID UNIQUE REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    sessions_materialized_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT bookable_slots_package_contract_fkey
        FOREIGN KEY (package_id, contract_schema_version)
        REFERENCES public.packages(id, contract_schema_version) ON DELETE RESTRICT,
    CONSTRAINT bookable_slots_lifecycle_check CHECK (
        (
            status = 'draft'
            AND published_at IS NULL
            AND published_by IS NULL
            AND sold_at IS NULL
            AND sold_subscription_id IS NULL
            AND sessions_materialized_at IS NULL
        )
        OR (
            status IN ('available', 'paused')
            AND published_at IS NOT NULL
            AND published_by IS NOT NULL
            AND sold_at IS NULL
            AND sold_subscription_id IS NULL
            AND sessions_materialized_at IS NULL
        )
        OR (
            status = 'sold'
            AND published_at IS NOT NULL
            AND published_by IS NOT NULL
            AND sold_at IS NOT NULL
            AND sold_subscription_id IS NOT NULL
        )
        OR (
            status = 'retired'
            AND sold_at IS NULL
            AND sold_subscription_id IS NULL
            AND sessions_materialized_at IS NULL
        )
    ),
    UNIQUE (id, teacher_id)
);

CREATE TABLE public.bookable_slot_occurrences (
    slot_id UUID NOT NULL,
    occurrence_index SMALLINT NOT NULL CHECK (occurrence_index BETWEEN 1 AND 4),
    teacher_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    duration_minutes SMALLINT NOT NULL DEFAULT 50 CHECK (duration_minutes = 50),
    blocks_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    session_id UUID UNIQUE REFERENCES public.sessions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (slot_id, occurrence_index),
    CONSTRAINT bookable_slot_occurrences_slot_teacher_fkey
        FOREIGN KEY (slot_id, teacher_id)
        REFERENCES public.bookable_slots(id, teacher_id) ON DELETE CASCADE,
    UNIQUE (slot_id, starts_at)
);

ALTER TABLE public.bookable_slot_occurrences
    ADD CONSTRAINT bookable_slot_occurrences_teacher_overlap_excl
    EXCLUDE USING gist (
        teacher_id WITH =,
        public.session_tstzrange(starts_at, duration_minutes) WITH &&
    ) WHERE (blocks_teacher);

CREATE TABLE public.bookable_slot_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES public.bookable_slots(id) ON DELETE RESTRICT,
    checkout_intent_id UUID NOT NULL REFERENCES public.checkout_intents(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'held'
        CHECK (status IN ('held', 'consumed', 'expired', 'released')),
    held_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    close_reason TEXT,
    subscription_id UUID UNIQUE REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT bookable_slot_holds_expiry_check CHECK (
        expires_at > held_at
        AND expires_at <= held_at + INTERVAL '2 hours 5 minutes'
    ),
    CONSTRAINT bookable_slot_holds_lifecycle_check CHECK (
        (
            status = 'held'
            AND closed_at IS NULL
            AND close_reason IS NULL
            AND subscription_id IS NULL
        )
        OR (
            status = 'consumed'
            AND closed_at IS NOT NULL
            AND close_reason = 'paid'
            AND subscription_id IS NOT NULL
        )
        OR (
            status IN ('expired', 'released')
            AND closed_at IS NOT NULL
            AND NULLIF(btrim(close_reason), '') IS NOT NULL
            AND subscription_id IS NULL
        )
    )
);

CREATE INDEX bookable_slots_catalog_idx
    ON public.bookable_slots(package_id, status, weekday, local_start_time);
CREATE INDEX bookable_slot_occurrences_teacher_start_idx
    ON public.bookable_slot_occurrences(teacher_id, starts_at);
CREATE UNIQUE INDEX bookable_slot_holds_one_live_hold_idx
    ON public.bookable_slot_holds(slot_id)
    WHERE status = 'held';
CREATE UNIQUE INDEX bookable_slot_holds_checkout_idx
    ON public.bookable_slot_holds(checkout_intent_id);
CREATE INDEX bookable_slot_holds_reconciliation_idx
    ON public.bookable_slot_holds(expires_at)
    WHERE status = 'held';

ALTER TABLE public.bookable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookable_slot_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookable_slot_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bookable_slots
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bookable_slot_occurrences
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bookable_slot_holds
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.bookable_slots TO service_role;
GRANT SELECT ON TABLE public.bookable_slot_occurrences TO service_role;
GRANT SELECT ON TABLE public.bookable_slot_holds TO service_role;

CREATE OR REPLACE FUNCTION private.guard_subscription_checkout_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT'
       AND NEW.contract_schema_version = 2
       AND NEW.checkout_intent_id IS NULL THEN
        RAISE EXCEPTION 'versioned_subscription_requires_checkout_binding'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.checkout_intent_id IS DISTINCT FROM OLD.checkout_intent_id THEN
        RAISE EXCEPTION 'subscription_checkout_binding_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_intent_id IS NOT NULL THEN
        SELECT * INTO intent_row
        FROM public.checkout_intents
        WHERE id = NEW.checkout_intent_id;

        SELECT sellable_slot.* INTO slot_row
        FROM public.bookable_slot_holds AS slot_hold
        JOIN public.bookable_slots AS sellable_slot
          ON sellable_slot.id = slot_hold.slot_id
        WHERE slot_hold.checkout_intent_id = NEW.checkout_intent_id
          AND slot_hold.status = 'held';

        IF intent_row.id IS NULL
           OR slot_row.id IS NULL
           OR intent_row.status <> 'completed'
           OR intent_row.stripe_checkout_session_id IS NULL
           OR NEW.contract_schema_version <> 2
           OR NEW.student_id IS DISTINCT FROM intent_row.student_id
           OR NEW.package_price_id IS DISTINCT FROM intent_row.package_price_id
           OR NEW.status <> 'active'
           OR NEW.stripe_subscription_id IS NULL
           OR NEW.stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
           OR NEW.stripe_invoice_id IS NULL
           OR NEW.stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$'
           OR NEW.starts_at IS DISTINCT FROM
                (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
           OR NEW.ends_at IS DISTINCT FROM NEW.starts_at + 28
           OR NEW.sessions_total <> 4
           OR NEW.contracted_sessions_per_period <> 4
           OR NEW.sessions_used IS DISTINCT FROM 0
           OR NEW.duration_months IS NOT NULL
           OR NEW.billing_interval_unit <> 'day'
           OR NEW.billing_interval_count <> 28
           OR NEW.class_duration_minutes <> 50 THEN
            RAISE EXCEPTION 'subscription_checkout_binding_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_subscription_checkout_binding()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_subscription_checkout_binding_trigger
    BEFORE INSERT OR UPDATE OF checkout_intent_id, student_id, package_price_id,
        status, stripe_subscription_id, contract_schema_version
    ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.guard_subscription_checkout_binding();

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    teacher_role public.user_role;
    actor_role public.user_role;
    occurrence_count INTEGER;
    occurrence_future BOOLEAN;
BEGIN
    SELECT * INTO package_row
    FROM public.packages
    WHERE id = NEW.package_id
      AND contract_schema_version = 2;

    IF NOT FOUND
       OR package_row.name <> 'individual_4x50_28d'
       OR package_row.amount_cents <> 25900
       OR package_row.billing_interval_unit <> 'day'
       OR package_row.billing_interval_count <> 28
       OR package_row.sessions_per_period <> 4
       OR package_row.class_duration_minutes <> 50 THEN
        RAISE EXCEPTION 'bookable_slot_requires_initial_v2_offer'
            USING ERRCODE = '23514';
    END IF;

    SELECT role INTO teacher_role
    FROM public.profiles
    WHERE id = NEW.teacher_id;
    IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
        RAISE EXCEPTION 'bookable_slot_teacher_must_be_teacher'
            USING ERRCODE = '23514';
    END IF;

    SELECT role INTO actor_role
    FROM public.profiles
    WHERE id = NEW.created_by;
    IF actor_role IS DISTINCT FROM 'admin'::public.user_role THEN
        RAISE EXCEPTION 'bookable_slot_creator_must_be_admin'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.published_by IS NOT NULL THEN
        SELECT role INTO actor_role
        FROM public.profiles
        WHERE id = NEW.published_by;
        IF actor_role IS DISTINCT FROM 'admin'::public.user_role THEN
            RAISE EXCEPTION 'bookable_slot_publisher_must_be_admin'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NEW.timezone_name <> 'Europe/Madrid' THEN
        RAISE EXCEPTION 'bookable_slot_timezone_is_not_supported'
            USING ERRCODE = '22023';
    END IF;

    IF EXTRACT(DOW FROM NEW.first_occurrence_at AT TIME ZONE NEW.timezone_name)::SMALLINT
            IS DISTINCT FROM NEW.weekday
       OR (NEW.first_occurrence_at AT TIME ZONE NEW.timezone_name)::TIME(0)
            IS DISTINCT FROM NEW.local_start_time THEN
        RAISE EXCEPTION 'bookable_slot_first_occurrence_does_not_match_local_time'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'bookable_slot_must_start_as_draft'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.public_id IS DISTINCT FROM OLD.public_id
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.capacity IS DISTINCT FROM OLD.capacity
           OR NEW.contract_schema_version IS DISTINCT FROM OLD.contract_schema_version THEN
            RAISE EXCEPTION 'bookable_slot_identity_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status <> 'draft' AND ROW(
            NEW.package_id,
            NEW.teacher_id,
            NEW.weekday,
            NEW.local_start_time,
            NEW.timezone_name,
            NEW.first_occurrence_at
        ) IS DISTINCT FROM ROW(
            OLD.package_id,
            OLD.teacher_id,
            OLD.weekday,
            OLD.local_start_time,
            OLD.timezone_name,
            OLD.first_occurrence_at
        ) THEN
            RAISE EXCEPTION 'published_bookable_slot_contract_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.published_at IS NOT NULL
           AND ROW(NEW.published_at, NEW.published_by)
               IS DISTINCT FROM ROW(OLD.published_at, OLD.published_by) THEN
            RAISE EXCEPTION 'bookable_slot_publication_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.sold_at IS NOT NULL
           AND ROW(NEW.sold_at, NEW.sold_subscription_id)
               IS DISTINCT FROM ROW(OLD.sold_at, OLD.sold_subscription_id) THEN
            RAISE EXCEPTION 'bookable_slot_sale_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NOT (
            NEW.status = OLD.status
            OR (OLD.status = 'draft' AND NEW.status IN ('available', 'retired'))
            OR (OLD.status = 'available' AND NEW.status IN ('paused', 'sold', 'retired'))
            OR (OLD.status = 'paused' AND NEW.status IN ('available', 'retired'))
        ) THEN
            RAISE EXCEPTION 'bookable_slot_status_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status IN ('sold', 'retired')
           AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'terminal_bookable_slot_cannot_reopen'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.status IN ('paused', 'retired')
           AND OLD.status = 'available'
           AND EXISTS (
               SELECT 1
               FROM public.bookable_slot_holds
               WHERE slot_id = OLD.id AND status = 'held'
           ) THEN
            RAISE EXCEPTION 'held_bookable_slot_cannot_be_paused_or_retired'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.sessions_materialized_at IS DISTINCT FROM OLD.sessions_materialized_at
           AND NOT (
               OLD.status = 'sold'
               AND NEW.status = 'sold'
               AND OLD.sessions_materialized_at IS NULL
               AND NEW.sessions_materialized_at IS NOT NULL
           ) THEN
            RAISE EXCEPTION 'bookable_slot_materialization_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.sessions_materialized_at IS NOT NULL
           AND NEW.sessions_materialized_at IS DISTINCT FROM OLD.sessions_materialized_at THEN
            RAISE EXCEPTION 'bookable_slot_materialization_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status = 'available' AND (TG_OP = 'INSERT' OR OLD.status <> 'available') THEN
        IF NOT package_row.is_active
           OR NOT package_row.is_publicly_listed
           OR NOT EXISTS (
               SELECT 1
               FROM public.package_prices
               WHERE package_id = NEW.package_id
                 AND contract_schema_version = 2
                 AND status = 'active'
                 AND amount_cents = 25900
                 AND billing_interval_unit = 'day'
                 AND billing_interval_count = 28
                 AND sessions_per_period = 4
                 AND class_duration_minutes = 50
           ) THEN
            RAISE EXCEPTION 'bookable_slot_offer_is_not_active'
                USING ERRCODE = '23514';
        END IF;

        SELECT
            COUNT(*),
            COALESCE(BOOL_AND(starts_at > clock_timestamp()), FALSE)
        INTO occurrence_count, occurrence_future
        FROM public.bookable_slot_occurrences
        WHERE slot_id = NEW.id;

        IF occurrence_count <> 4 OR NOT occurrence_future THEN
            RAISE EXCEPTION 'bookable_slot_requires_four_future_occurrences'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.teacher_availability
            WHERE teacher_id = NEW.teacher_id
              AND is_active = TRUE
              AND day_of_week = NEW.weekday
              AND start_time <= NEW.local_start_time
              AND end_time >= NEW.local_start_time + INTERVAL '50 minutes'
              AND NEW.local_start_time + INTERVAL '50 minutes' > NEW.local_start_time
        ) THEN
            RAISE EXCEPTION 'bookable_slot_is_outside_teacher_availability'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status = 'sold' THEN
        IF NEW.sold_subscription_id IS NULL
           OR NEW.sold_at IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM public.bookable_slot_holds
               WHERE slot_id = NEW.id
                  AND status = 'consumed'
                  AND subscription_id = NEW.sold_subscription_id
                  AND closed_at = NEW.sold_at
           ) THEN
            RAISE EXCEPTION 'sold_bookable_slot_requires_consumed_hold'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.sessions_materialized_at IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM (
               SELECT
                   COUNT(*) AS occurrence_count,
                   COUNT(session_row.id) AS session_count,
                   COALESCE(BOOL_AND(
                       session_row.subscription_id = NEW.sold_subscription_id
                       AND session_row.teacher_id = NEW.teacher_id
                       AND session_row.scheduled_at = occurrence_row.starts_at
                       AND session_row.duration_minutes = occurrence_row.duration_minutes
                       AND session_row.status = 'scheduled'
                       AND session_row.student_id = subscription_row.student_id
                   ), FALSE) AS exact_sessions
               FROM public.bookable_slot_occurrences AS occurrence_row
               LEFT JOIN public.sessions AS session_row
                 ON session_row.id = occurrence_row.session_id
               LEFT JOIN public.subscriptions AS subscription_row
                 ON subscription_row.id = NEW.sold_subscription_id
               WHERE occurrence_row.slot_id = NEW.id
           ) AS materialization
           WHERE materialization.occurrence_count = 4
             AND materialization.session_count = 4
             AND materialization.exact_sessions
       ) THEN
        RAISE EXCEPTION 'bookable_slot_materialization_requires_four_exact_sessions'
            USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_bookable_slot_contract_trigger
    BEFORE INSERT OR UPDATE ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_contract();

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_occurrence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
    expected_blocking BOOLEAN;
BEGIN
    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_occurrence_has_no_slot'
            USING ERRCODE = '23503';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF slot_row.status <> 'draft' THEN
            RAISE EXCEPTION 'published_bookable_slot_occurrences_are_immutable'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND slot_row.status <> 'draft'
       AND ROW(NEW.slot_id, NEW.occurrence_index, NEW.starts_at, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.slot_id, OLD.occurrence_index, OLD.starts_at, OLD.created_at) THEN
        RAISE EXCEPTION 'published_bookable_slot_occurrences_are_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.session_id IS DISTINCT FROM OLD.session_id
       AND NOT (
           slot_row.status = 'sold'
           AND slot_row.sessions_materialized_at IS NULL
           AND OLD.session_id IS NULL
           AND NEW.session_id IS NOT NULL
           AND EXISTS (
               SELECT 1
               FROM public.sessions AS session_row
               JOIN public.subscriptions AS subscription_row
                 ON subscription_row.id = slot_row.sold_subscription_id
               WHERE session_row.id = NEW.session_id
                 AND session_row.subscription_id = slot_row.sold_subscription_id
                 AND session_row.student_id = subscription_row.student_id
                 AND session_row.teacher_id = slot_row.teacher_id
                 AND session_row.scheduled_at = NEW.starts_at
                 AND session_row.duration_minutes = 50
                 AND session_row.status = 'scheduled'
           )
       ) THEN
        RAISE EXCEPTION 'bookable_slot_occurrence_session_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    NEW.teacher_id := slot_row.teacher_id;
    NEW.duration_minutes := 50;
    expected_blocking := slot_row.status IN ('available', 'paused', 'sold')
        AND slot_row.sessions_materialized_at IS NULL;
    NEW.blocks_teacher := expected_blocking;

    IF EXTRACT(DOW FROM NEW.starts_at AT TIME ZONE slot_row.timezone_name)::SMALLINT
            IS DISTINCT FROM slot_row.weekday
       OR (NEW.starts_at AT TIME ZONE slot_row.timezone_name)::TIME(0)
            IS DISTINCT FROM slot_row.local_start_time THEN
        RAISE EXCEPTION 'bookable_slot_occurrence_does_not_match_local_time'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_occurrences AS other
        WHERE other.slot_id = NEW.slot_id
          AND other.occurrence_index <> NEW.occurrence_index
          AND (
              (NEW.starts_at AT TIME ZONE slot_row.timezone_name)::DATE
              - (other.starts_at AT TIME ZONE slot_row.timezone_name)::DATE
          ) <> (NEW.occurrence_index - other.occurrence_index) * 7
    ) THEN
        RAISE EXCEPTION 'bookable_slot_occurrences_must_be_weekly_in_local_time'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.blocks_teacher THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.teacher_id::TEXT, 42850)
        );

        IF EXISTS (
            SELECT 1
            FROM public.sessions AS session_row
            WHERE session_row.teacher_id = NEW.teacher_id
              AND session_row.id IS DISTINCT FROM NEW.session_id
              AND session_row.status = 'scheduled'
              AND session_row.scheduled_at IS NOT NULL
              AND public.session_tstzrange(
                    session_row.scheduled_at,
                    session_row.duration_minutes
                  ) && public.session_tstzrange(NEW.starts_at, NEW.duration_minutes)
        ) THEN
            RAISE EXCEPTION 'bookable_slot_occurrence_overlaps_scheduled_session'
                USING ERRCODE = '23P01';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_occurrence()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_bookable_slot_occurrence_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.bookable_slot_occurrences
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_occurrence();

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
    target_slot_id := CASE
        WHEN TG_TABLE_NAME = 'bookable_slots' THEN COALESCE(NEW.id, OLD.id)
        ELSE COALESCE(NEW.slot_id, OLD.slot_id)
    END;

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

CREATE CONSTRAINT TRIGGER validate_bookable_slot_after_write
    AFTER INSERT OR UPDATE ON public.bookable_slots
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_bookable_slot_occurrences();

CREATE CONSTRAINT TRIGGER validate_bookable_slot_occurrence_after_write
    AFTER INSERT OR UPDATE OR DELETE ON public.bookable_slot_occurrences
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_bookable_slot_occurrences();

CREATE OR REPLACE FUNCTION private.sync_bookable_slot_occurrence_blocking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.bookable_slot_occurrences
    SET blocks_teacher = (
        NEW.status IN ('available', 'paused', 'sold')
        AND NEW.sessions_materialized_at IS NULL
    )
    WHERE slot_id = NEW.id;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_bookable_slot_occurrence_blocking()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_bookable_slot_occurrence_blocking_trigger
    AFTER UPDATE OF status, sessions_materialized_at ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.sync_bookable_slot_occurrence_blocking();

CREATE OR REPLACE FUNCTION private.guard_session_against_bookable_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'scheduled'
       AND NEW.teacher_id IS NOT NULL
       AND NEW.scheduled_at IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.teacher_id::TEXT, 42850)
        );

        IF EXISTS (
            SELECT 1
            FROM public.bookable_slot_occurrences AS occurrence_row
            JOIN public.bookable_slots AS slot_row
              ON slot_row.id = occurrence_row.slot_id
            WHERE occurrence_row.teacher_id = NEW.teacher_id
              AND occurrence_row.blocks_teacher
              AND public.session_tstzrange(
                    occurrence_row.starts_at,
                    occurrence_row.duration_minutes
                  ) && public.session_tstzrange(NEW.scheduled_at, NEW.duration_minutes)
              AND NOT (
                  slot_row.status = 'sold'
                  AND slot_row.sold_subscription_id = NEW.subscription_id
                  AND occurrence_row.starts_at = NEW.scheduled_at
                  AND occurrence_row.duration_minutes = NEW.duration_minutes
              )
        ) THEN
            RAISE EXCEPTION 'scheduled_session_overlaps_bookable_slot'
                USING ERRCODE = '23P01';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_session_against_bookable_slots()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_session_against_bookable_slots_trigger
    BEFORE INSERT OR UPDATE OF teacher_id, scheduled_at, duration_minutes, status
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_session_against_bookable_slots();

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
            NEW.subscription_id
        ) IS DISTINCT FROM ROW(
            OLD.closed_at,
            OLD.close_reason,
            OLD.subscription_id
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

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_hold()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_bookable_slot_hold_trigger
    BEFORE INSERT OR UPDATE ON public.bookable_slot_holds
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_hold();

CREATE OR REPLACE FUNCTION private.validate_versioned_checkout_slot_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.package_prices
        WHERE id = NEW.package_price_id
          AND contract_schema_version = 2
    ) AND NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE checkout_intent_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'versioned_checkout_requires_bookable_slot_hold'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_versioned_checkout_slot_hold()
    FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER validate_versioned_checkout_slot_hold_after_write
    AFTER INSERT OR UPDATE ON public.checkout_intents
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_versioned_checkout_slot_hold();

CREATE OR REPLACE FUNCTION public.create_bookable_slot(
    p_package_id UUID,
    p_teacher_id UUID,
    p_timezone_name TEXT,
    p_occurrences TIMESTAMPTZ[],
    p_created_by UUID
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF p_package_id IS NULL
       OR p_teacher_id IS NULL
       OR p_created_by IS NULL
       OR NULLIF(btrim(p_timezone_name), '') IS NULL
       OR cardinality(p_occurrences) <> 4
       OR array_position(p_occurrences, NULL) IS NOT NULL
       OR p_timezone_name <> 'Europe/Madrid' THEN
        RAISE EXCEPTION 'invalid_bookable_slot_snapshot'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.bookable_slots (
        package_id,
        teacher_id,
        weekday,
        local_start_time,
        timezone_name,
        first_occurrence_at,
        created_by
    ) VALUES (
        p_package_id,
        p_teacher_id,
        EXTRACT(DOW FROM p_occurrences[1] AT TIME ZONE p_timezone_name)::SMALLINT,
        (p_occurrences[1] AT TIME ZONE p_timezone_name)::TIME(0),
        p_timezone_name,
        p_occurrences[1],
        p_created_by
    )
    RETURNING * INTO slot_row;

    INSERT INTO public.bookable_slot_occurrences (
        slot_id,
        occurrence_index,
        teacher_id,
        starts_at,
        duration_minutes
    )
    SELECT
        slot_row.id,
        occurrence.ordinality::SMALLINT,
        slot_row.teacher_id,
        occurrence.starts_at,
        50
    FROM unnest(p_occurrences) WITH ORDINALITY
        AS occurrence(starts_at, ordinality);

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bookable_slot(UUID, UUID, TEXT, TIMESTAMPTZ[], UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bookable_slot(UUID, UUID, TEXT, TIMESTAMPTZ[], UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.publish_bookable_slot(
    p_slot_id UUID,
    p_published_by UUID
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF p_slot_id IS NULL OR p_published_by IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_publication'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF slot_row.status = 'available' THEN RETURN slot_row; END IF;
    IF slot_row.status NOT IN ('draft', 'paused') THEN
        RAISE EXCEPTION 'bookable_slot_cannot_be_published'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.bookable_slots
    SET
        status = 'available',
        published_at = COALESCE(published_at, clock_timestamp()),
        published_by = COALESCE(published_by, p_published_by)
    WHERE id = p_slot_id
    RETURNING * INTO slot_row;

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_bookable_slot(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_bookable_slot(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.hold_bookable_slot(
    p_slot_id UUID,
    p_checkout_intent_id UUID
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
    IF p_slot_id IS NULL OR p_checkout_intent_id IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status NOT IN ('creating', 'open')
       OR intent_row.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_intent_cannot_hold_slot'
            USING ERRCODE = '23514';
    END IF;

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

    UPDATE public.bookable_slot_holds AS stale_hold
    SET
        status = 'expired',
        closed_at = clock_timestamp(),
        close_reason = 'checkout_expired'
    FROM public.checkout_intents AS stale_intent
    WHERE stale_hold.slot_id = p_slot_id
      AND stale_hold.status = 'held'
      AND stale_intent.id = stale_hold.checkout_intent_id
      AND stale_intent.status = 'expired';

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE slot_id = p_slot_id AND status = 'held'
    ) THEN
        RAISE EXCEPTION 'bookable_slot_is_held'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.bookable_slot_holds (
        slot_id,
        checkout_intent_id,
        expires_at
    ) VALUES (
        p_slot_id,
        p_checkout_intent_id,
        intent_row.expires_at
    )
    RETURNING * INTO hold_row;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_bookable_slot(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_bookable_slot(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.claim_checkout_intent_for_slot(
    p_opportunity_id UUID,
    p_contact_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT,
    p_slot_id UUID
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

    PERFORM public.hold_bookable_slot(p_slot_id, intent_row.id);
    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.release_bookable_slot_hold(
    p_checkout_intent_id UUID,
    p_reason TEXT
)
RETURNS public.bookable_slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    release_status TEXT;
BEGIN
    IF p_checkout_intent_id IS NULL
       OR NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold_release'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;
    IF NOT FOUND OR intent_row.status <> 'expired' THEN
        RAISE EXCEPTION 'bookable_slot_hold_release_requires_expired_checkout'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_hold_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF hold_row.status IN ('expired', 'released') THEN RETURN hold_row; END IF;
    IF hold_row.status = 'consumed' THEN
        RAISE EXCEPTION 'consumed_bookable_slot_hold_cannot_be_released'
            USING ERRCODE = '23514';
    END IF;

    release_status := CASE
        WHEN intent_row.expires_at <= clock_timestamp() THEN 'expired'
        ELSE 'released'
    END;

    UPDATE public.bookable_slot_holds
    SET
        status = release_status,
        closed_at = clock_timestamp(),
        close_reason = left(btrim(p_reason), 200)
    WHERE id = hold_row.id
    RETURNING * INTO hold_row;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_bookable_slot_hold(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_bookable_slot_hold(UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.consume_bookable_slot_hold(
    p_checkout_intent_id UUID,
    p_subscription_id UUID
)
RETURNS public.bookable_slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    consumed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_checkout_intent_id IS NULL OR p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold_consumption'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;
    IF NOT FOUND OR intent_row.status <> 'completed' THEN
        RAISE EXCEPTION 'paid_checkout_intent_is_required'
            USING ERRCODE = '23514';
    END IF;

    SELECT slot_id INTO hold_row.slot_id
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id;
    IF hold_row.slot_id IS NULL THEN
        RAISE EXCEPTION 'bookable_slot_hold_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = hold_row.slot_id
    FOR UPDATE;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id
    FOR UPDATE;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF hold_row.status = 'consumed'
       AND hold_row.subscription_id = p_subscription_id
       AND slot_row.status = 'sold'
       AND slot_row.sold_subscription_id = p_subscription_id THEN
        RETURN hold_row;
    END IF;

    IF hold_row.status <> 'held'
       OR slot_row.status <> 'available'
       OR subscription_row.id IS NULL
       OR subscription_row.student_id IS DISTINCT FROM intent_row.student_id
       OR subscription_row.package_id IS DISTINCT FROM slot_row.package_id
       OR subscription_row.package_price_id IS DISTINCT FROM intent_row.package_price_id
       OR subscription_row.checkout_intent_id IS DISTINCT FROM intent_row.id
       OR subscription_row.contract_schema_version <> 2
       OR subscription_row.status <> 'active'
       OR subscription_row.stripe_subscription_id IS NULL THEN
        RAISE EXCEPTION 'bookable_slot_hold_cannot_be_consumed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.bookable_slot_holds
    SET
        status = 'consumed',
        closed_at = consumed_at,
        close_reason = 'paid',
        subscription_id = p_subscription_id
    WHERE id = hold_row.id
    RETURNING * INTO hold_row;

    UPDATE public.bookable_slots
    SET
        status = 'sold',
        sold_at = consumed_at,
        sold_subscription_id = p_subscription_id
    WHERE id = slot_row.id;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_bookable_slot_hold(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_bookable_slot_hold(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_bookable_slot_sessions(
    p_slot_id UUID,
    p_subscription_id UUID
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    occurrence_row public.bookable_slot_occurrences%ROWTYPE;
    created_session_id UUID;
BEGIN
    IF p_slot_id IS NULL OR p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_materialization'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF slot_row.id IS NULL
       OR subscription_row.id IS NULL
       OR slot_row.status <> 'sold'
       OR slot_row.sold_subscription_id IS DISTINCT FROM subscription_row.id
       OR subscription_row.status <> 'active'
       OR subscription_row.package_id IS DISTINCT FROM slot_row.package_id
       OR subscription_row.contract_schema_version <> 2
       OR subscription_row.sessions_total <> 4
       OR subscription_row.contracted_sessions_per_period <> 4 THEN
        RAISE EXCEPTION 'bookable_slot_cannot_materialize_sessions'
            USING ERRCODE = '23514';
    END IF;

    IF slot_row.sessions_materialized_at IS NOT NULL THEN
        IF subscription_row.sessions_used IS DISTINCT FROM 4 THEN
            RAISE EXCEPTION 'materialized_bookable_slot_requires_consumed_quota'
                USING ERRCODE = '23514';
        END IF;
        RETURN slot_row;
    END IF;

    IF subscription_row.sessions_used IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'bookable_slot_materialization_requires_unused_quota'
            USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM public.profiles
    WHERE id = subscription_row.student_id AND role = 'student'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_student_is_not_available'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.student_teachers
        WHERE student_id = subscription_row.student_id
          AND teacher_id = slot_row.teacher_id
    ) THEN
        INSERT INTO public.student_teachers (student_id, teacher_id, is_primary)
        VALUES (
            subscription_row.student_id,
            slot_row.teacher_id,
            NOT EXISTS (
                SELECT 1 FROM public.student_teachers
                WHERE student_id = subscription_row.student_id
                  AND is_primary
            )
        );
    END IF;

    FOR occurrence_row IN
        SELECT *
        FROM public.bookable_slot_occurrences
        WHERE slot_id = slot_row.id
        ORDER BY occurrence_index
        FOR UPDATE
    LOOP
        IF occurrence_row.session_id IS NOT NULL THEN
            RAISE EXCEPTION 'bookable_slot_occurrence_is_already_materialized'
                USING ERRCODE = '23514';
        END IF;

        INSERT INTO public.sessions (
            subscription_id,
            student_id,
            teacher_id,
            scheduled_at,
            duration_minutes,
            status
        ) VALUES (
            subscription_row.id,
            subscription_row.student_id,
            slot_row.teacher_id,
            occurrence_row.starts_at,
            occurrence_row.duration_minutes,
            'scheduled'
        )
        RETURNING id INTO created_session_id;

        UPDATE public.bookable_slot_occurrences
        SET session_id = created_session_id
        WHERE slot_id = occurrence_row.slot_id
          AND occurrence_index = occurrence_row.occurrence_index;
    END LOOP;

    UPDATE public.subscriptions
    SET sessions_used = 4
    WHERE id = subscription_row.id
      AND sessions_used = 0;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_quota_could_not_be_consumed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.bookable_slots
    SET sessions_materialized_at = clock_timestamp()
    WHERE id = slot_row.id
    RETURNING * INTO slot_row;

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_bookable_slot_sessions(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_bookable_slot_sessions(UUID, UUID)
    TO service_role;

COMMENT ON TABLE public.bookable_slots IS
    'Immutable sellable weekly capacity for the version-2 individual offer; generic teacher availability is not inventory.';
COMMENT ON TABLE public.bookable_slot_occurrences IS
    'The first four exact local-time occurrences promised before checkout, with their atomically materialized session identities.';
COMMENT ON TABLE public.bookable_slot_holds IS
    'Checkout-scoped capacity hold; expiry is released only after the Checkout intent is safely marked expired.';
