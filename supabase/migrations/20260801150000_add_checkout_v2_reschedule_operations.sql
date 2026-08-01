-- Checkout V2 rescheduling is a durable two-step operation. The request is
-- committed before Stripe is touched; applying it then converges the database
-- and the Calendar/email outbox in one transaction.

ALTER TABLE public.fulfillment_jobs
    DROP CONSTRAINT IF EXISTS fulfillment_jobs_job_type_check;

ALTER TABLE public.fulfillment_jobs
    ADD CONSTRAINT fulfillment_jobs_job_type_check
    CHECK (job_type IN (
        'session_fulfillment',
        'bulk_session_fulfillment',
        'welcome_fulfillment',
        'session_cancellation',
        'session_reschedule',
        'renewal_notice'
    ));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.fulfillment_jobs AS job
        WHERE job.status = 'processing'
          AND job.subscription_id IS NOT NULL
        GROUP BY job.subscription_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'checkout_v2_reschedule_upgrade_requires_one_processing_job_per_subscription'
            USING ERRCODE = '55000';
    END IF;
END
$$;

DROP INDEX IF EXISTS public.fulfillment_jobs_one_processing_session_idx;

CREATE UNIQUE INDEX fulfillment_jobs_one_processing_subscription_idx
    ON public.fulfillment_jobs(subscription_id)
    WHERE subscription_id IS NOT NULL AND status = 'processing';

CREATE TABLE public.checkout_v2_reschedule_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    session_id UUID NOT NULL
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_id UUID NOT NULL
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL
        REFERENCES public.profiles(id) ON DELETE RESTRICT,
    operation_kind TEXT NOT NULL
        CHECK (operation_kind IN ('provisional_anchor', 'single_session')),
    old_scheduled_at TIMESTAMPTZ NOT NULL,
    new_scheduled_at TIMESTAMPTZ NOT NULL,
    expected_anchor_revision BIGINT NOT NULL
        CHECK (expected_anchor_revision > 0),
    target_stripe_anchor_at TIMESTAMPTZ,
    observed_stripe_anchor_at TIMESTAMPTZ,
    stripe_mutation_started_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'applied', 'failed', 'manual_review')),
    last_error TEXT,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_reschedule_changes_time CHECK (
        old_scheduled_at <> new_scheduled_at
    ),
    CONSTRAINT checkout_v2_reschedule_timestamps_are_whole_seconds CHECK (
        date_trunc('second', old_scheduled_at) = old_scheduled_at
        AND date_trunc('second', new_scheduled_at) = new_scheduled_at
        AND (
            target_stripe_anchor_at IS NULL
            OR date_trunc('second', target_stripe_anchor_at) = target_stripe_anchor_at
        )
        AND (
            observed_stripe_anchor_at IS NULL
            OR date_trunc('second', observed_stripe_anchor_at) = observed_stripe_anchor_at
        )
        AND (
            stripe_mutation_started_at IS NULL
            OR date_trunc('second', stripe_mutation_started_at)
                = stripe_mutation_started_at
        )
    ),
    CONSTRAINT checkout_v2_reschedule_kind_shape CHECK (
        (
            operation_kind = 'provisional_anchor'
            AND target_stripe_anchor_at = new_scheduled_at + INTERVAL '672 hours'
        )
        OR (
            operation_kind = 'single_session'
            AND target_stripe_anchor_at IS NULL
            AND observed_stripe_anchor_at IS NULL
            AND stripe_mutation_started_at IS NULL
        )
    ),
    CONSTRAINT checkout_v2_reschedule_status_lifecycle CHECK (
        (
            status = 'requested'
            AND observed_stripe_anchor_at IS NULL
            AND applied_at IS NULL
            AND last_error IS NULL
        )
        OR (
            status = 'applied'
            AND applied_at IS NOT NULL
            AND last_error IS NULL
            AND (
                (
                    operation_kind = 'provisional_anchor'
                    AND observed_stripe_anchor_at = target_stripe_anchor_at
                    AND stripe_mutation_started_at IS NOT NULL
                )
                OR (
                    operation_kind = 'single_session'
                    AND observed_stripe_anchor_at IS NULL
                )
            )
        )
        OR (
            status IN ('failed', 'manual_review')
            AND applied_at IS NULL
            AND NULLIF(btrim(last_error), '') IS NOT NULL
            AND (
                (
                    observed_stripe_anchor_at IS NULL
                    AND last_error <> 'stripe_confirmed_at_previous_anchor'
                )
                OR (
                    status = 'failed'
                    AND operation_kind = 'provisional_anchor'
                    AND last_error = 'stripe_confirmed_at_previous_anchor'
                    AND observed_stripe_anchor_at IS NOT NULL
                    AND observed_stripe_anchor_at =
                        old_scheduled_at + INTERVAL '672 hours'
                )
            )
        )
    ),
    CONSTRAINT checkout_v2_reschedule_error_length CHECK (
        last_error IS NULL OR char_length(last_error) <= 2000
    ),
    CONSTRAINT checkout_v2_reschedule_timestamp_order CHECK (
        updated_at >= created_at
        AND (applied_at IS NULL OR applied_at >= created_at)
        AND (
            stripe_mutation_started_at IS NULL
            OR stripe_mutation_started_at >= created_at
        )
    )
);

CREATE INDEX checkout_v2_reschedule_operations_subscription_idx
    ON public.checkout_v2_reschedule_operations(subscription_id, created_at DESC);
CREATE INDEX checkout_v2_reschedule_operations_requested_idx
    ON public.checkout_v2_reschedule_operations(created_at, id)
    WHERE status = 'requested';
CREATE UNIQUE INDEX checkout_v2_reschedule_one_pending_subscription_idx
    ON public.checkout_v2_reschedule_operations(subscription_id)
    WHERE status IN ('requested', 'manual_review');

ALTER TABLE public.checkout_v2_reschedule_operations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_v2_reschedule_operations
    FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_reschedule_operations
    FROM service_role;
GRANT SELECT ON TABLE public.checkout_v2_reschedule_operations TO service_role;

-- The original session/slot arbiter already serializes direct session writes
-- by teacher. Recheck durable provisional-anchor reservations after acquiring
-- that lock so a concurrent begin cannot reserve a target between an earlier
-- trigger snapshot and the eventual session INSERT/UPDATE.
CREATE OR REPLACE FUNCTION private.guard_session_against_bookable_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    bypass_operation_id TEXT := NULLIF(
        current_setting('app.checkout_v2_reschedule_operation_id', TRUE),
        ''
    );
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

        IF EXISTS (
            SELECT 1
            FROM public.checkout_v2_reschedule_operations AS operation
            JOIN public.sessions AS source_session
              ON source_session.id = operation.session_id
            JOIN public.checkout_v2_weekly_allocations AS allocation
              ON allocation.subscription_id = operation.subscription_id
             AND allocation.status = 'active'
            CROSS JOIN pg_catalog.generate_series(0, 3) AS occurrence(week_offset)
            WHERE operation.operation_kind = 'provisional_anchor'
              AND (
                    operation.status = 'manual_review'
                    OR (
                        operation.status = 'requested'
                        AND operation.stripe_mutation_started_at IS NOT NULL
                    )
              )
              AND operation.id::TEXT IS DISTINCT FROM bypass_operation_id
              AND source_session.teacher_id = NEW.teacher_id
              AND public.session_tstzrange(
                    NEW.scheduled_at,
                    NEW.duration_minutes
                  ) && public.session_tstzrange(
                    (
                        (
                            operation.new_scheduled_at
                            AT TIME ZONE allocation.timezone_name
                        ) + pg_catalog.make_interval(
                            days => occurrence.week_offset * 7
                        )
                    ) AT TIME ZONE allocation.timezone_name,
                    50
                  )
        ) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_session_is_locked'
                USING ERRCODE = '40001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_session_against_bookable_slots()
    FROM PUBLIC, anon, authenticated, service_role;

-- Subscription lifecycle functions use advisory key 42854. Acquire it before
-- any row lock here as well, preventing a materialization/reschedule deadlock
-- caused by opposite lock ordering.
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

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)
    );

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

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_reschedule_locked_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_subscription_ids UUID[];
    blocking_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    bypass_operation_id TEXT := NULLIF(
        current_setting('app.checkout_v2_reschedule_operation_id', TRUE),
        ''
    );
BEGIN
    IF TG_TABLE_NAME = 'sessions' THEN
        IF TG_OP = 'UPDATE'
           AND ROW(
                NEW.scheduled_at,
                NEW.status,
                NEW.subscription_id,
                NEW.student_id,
                NEW.teacher_id,
                NEW.duration_minutes,
                NEW.checkout_v2_cycle_id,
                NEW.checkout_v2_cycle_session_index
           ) IS NOT DISTINCT FROM ROW(
                OLD.scheduled_at,
                OLD.status,
                OLD.subscription_id,
                OLD.student_id,
                OLD.teacher_id,
                OLD.duration_minutes,
                OLD.checkout_v2_cycle_id,
                OLD.checkout_v2_cycle_session_index
           ) THEN
            RETURN NEW;
        END IF;

        target_subscription_ids := CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.subscription_id]
            WHEN 'DELETE' THEN ARRAY[OLD.subscription_id]
            ELSE ARRAY[OLD.subscription_id, NEW.subscription_id]
        END;
    ELSIF TG_TABLE_NAME = 'subscriptions' THEN
        target_subscription_ids := CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.id]
            WHEN 'DELETE' THEN ARRAY[OLD.id]
            ELSE ARRAY[OLD.id, NEW.id]
        END;
    ELSE
        target_subscription_ids := CASE TG_OP
            WHEN 'INSERT' THEN ARRAY[NEW.subscription_id]
            WHEN 'DELETE' THEN ARRAY[OLD.subscription_id]
            ELSE ARRAY[OLD.subscription_id, NEW.subscription_id]
        END;
    END IF;

    SELECT operation.* INTO blocking_operation
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.subscription_id = ANY(target_subscription_ids)
      AND (
            operation.status = 'manual_review'
            OR (
                operation.status = 'requested'
                AND (
                    operation.stripe_mutation_started_at IS NOT NULL
                    OR operation.created_at > clock_timestamp() - INTERVAL '15 minutes'
                )
            )
      )
      AND operation.id::TEXT IS DISTINCT FROM bypass_operation_id
    ORDER BY operation.created_at, operation.id
    LIMIT 1;

    IF blocking_operation.id IS NOT NULL THEN
        IF TG_TABLE_NAME = 'sessions' THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_session_is_locked'
                USING ERRCODE = '40001';
        END IF;

        RAISE EXCEPTION 'checkout_v2_reschedule_billing_state_is_locked'
            USING ERRCODE = '40001';
    END IF;

    IF TG_TABLE_NAME = 'sessions' THEN
        IF TG_OP <> 'DELETE'
           AND NEW.status <> 'cancelled'
           AND NEW.teacher_id IS NOT NULL
           AND NEW.scheduled_at IS NOT NULL THEN
            blocking_operation := NULL;

            SELECT operation.* INTO blocking_operation
            FROM public.checkout_v2_reschedule_operations AS operation
            JOIN public.sessions AS source_session
              ON source_session.id = operation.session_id
            JOIN public.checkout_v2_weekly_allocations AS allocation
              ON allocation.subscription_id = operation.subscription_id
             AND allocation.status = 'active'
            CROSS JOIN pg_catalog.generate_series(0, 3) AS occurrence(week_offset)
            WHERE operation.operation_kind = 'provisional_anchor'
              AND (
                    operation.status = 'manual_review'
                    OR (
                        operation.status = 'requested'
                        AND operation.stripe_mutation_started_at IS NOT NULL
                    )
              )
              AND operation.id::TEXT IS DISTINCT FROM bypass_operation_id
              AND source_session.teacher_id = NEW.teacher_id
              AND public.session_tstzrange(
                    NEW.scheduled_at,
                    NEW.duration_minutes
                  ) && public.session_tstzrange(
                    (
                        (
                            operation.new_scheduled_at
                            AT TIME ZONE allocation.timezone_name
                        ) + pg_catalog.make_interval(
                            days => occurrence.week_offset * 7
                        )
                    ) AT TIME ZONE allocation.timezone_name,
                    50
                  )
            ORDER BY operation.created_at, operation.id
            LIMIT 1;

            IF blocking_operation.id IS NOT NULL THEN
                RAISE EXCEPTION 'checkout_v2_reschedule_session_is_locked'
                    USING ERRCODE = '40001';
            END IF;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_reschedule_session_state
    BEFORE INSERT OR DELETE OR UPDATE OF
        scheduled_at,
        status,
        subscription_id,
        student_id,
        teacher_id,
        duration_minutes,
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_reschedule_locked_state();

CREATE TRIGGER guard_checkout_v2_reschedule_subscription_state
    BEFORE INSERT OR DELETE OR UPDATE OF
        student_id,
        package_id,
        package_price_id,
        status,
        duration_months,
        starts_at,
        ends_at,
        sessions_total,
        contracted_sessions_per_period,
        sessions_used,
        stripe_subscription_id,
        contract_schema_version,
        billing_interval_unit,
        billing_interval_count,
        class_duration_minutes
    ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_reschedule_locked_state();

CREATE TRIGGER guard_checkout_v2_reschedule_billing_state
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_billing_state
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_reschedule_locked_state();

CREATE TRIGGER guard_checkout_v2_reschedule_cycle_state
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_cycles
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_reschedule_locked_state();

-- Preserve the existing cancellation API while bringing Checkout V2 onto the
-- same subscription-first lock order as prepare/apply. The unlocked first read
-- only discovers the lock key; all decisions are repeated after row locks.
CREATE OR REPLACE FUNCTION public.cancel_scheduled_session(
    p_session_id UUID,
    p_cancelled_by UUID,
    p_cancelled_by_role TEXT,
    p_cancellation_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
    session_id UUID,
    subscription_id UUID,
    cancelled_at TIMESTAMPTZ,
    late_student_cancellation BOOLEAN,
    quota_restore_attempted BOOLEAN,
    quota_restored BOOLEAN,
    previous_sessions_used INTEGER,
    next_sessions_used INTEGER,
    hours_until_class DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_subscription public.subscriptions%ROWTYPE;
    v_discovered_subscription_id UUID;
    v_is_checkout_v2 BOOLEAN := FALSE;
    v_cancelled_at TIMESTAMPTZ := clock_timestamp();
    v_late_student_cancellation BOOLEAN := FALSE;
    v_quota_restore_attempted BOOLEAN := FALSE;
    v_quota_restored BOOLEAN := FALSE;
    v_previous_sessions_used INTEGER := NULL;
    v_next_sessions_used INTEGER := NULL;
    v_hours_until_class DOUBLE PRECISION := NULL;
    v_job_payload JSONB;
    v_job_dedupe_key TEXT;
    v_job public.fulfillment_jobs%ROWTYPE;
BEGIN
    IF p_cancelled_by_role NOT IN ('student', 'teacher', 'admin') THEN
        RAISE EXCEPTION 'invalid_cancelled_by_role' USING ERRCODE = '22023';
    END IF;

    SELECT target_session.subscription_id
    INTO v_discovered_subscription_id
    FROM public.sessions AS target_session
    WHERE target_session.id = p_session_id;

    IF v_discovered_subscription_id IS NOT NULL THEN
        SELECT subscription_row.contract_schema_version = 2
        INTO v_is_checkout_v2
        FROM public.subscriptions AS subscription_row
        WHERE subscription_row.id = v_discovered_subscription_id;

        IF COALESCE(v_is_checkout_v2, FALSE) THEN
            PERFORM pg_catalog.pg_advisory_xact_lock(
                pg_catalog.hashtextextended(v_discovered_subscription_id::TEXT, 42854)
            );


        END IF;

        SELECT * INTO v_subscription
        FROM public.subscriptions AS subscription_row
        WHERE subscription_row.id = v_discovered_subscription_id
        FOR UPDATE;
    END IF;

    SELECT session_row.*
    INTO v_session
    FROM public.sessions AS session_row
    WHERE session_row.id = p_session_id
    FOR UPDATE;

    IF NOT FOUND OR v_session.status IS DISTINCT FROM 'scheduled' THEN
        RETURN;
    END IF;

    IF v_session.subscription_id IS DISTINCT FROM v_discovered_subscription_id
       OR (
            v_discovered_subscription_id IS NOT NULL
            AND v_subscription.id IS DISTINCT FROM v_discovered_subscription_id
       ) THEN
        RAISE EXCEPTION 'session_cancellation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    IF COALESCE(v_is_checkout_v2, FALSE)
       AND EXISTS (
            SELECT 1
            FROM public.checkout_v2_reschedule_operations AS pending_operation
            WHERE pending_operation.subscription_id = v_subscription.id
              AND (
                    pending_operation.status = 'manual_review'
                    OR (
                        pending_operation.status = 'requested'
                        AND (
                            pending_operation.stripe_mutation_started_at IS NOT NULL
                            OR pending_operation.created_at
                                > v_cancelled_at - INTERVAL '15 minutes'
                        )
                    )
              )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_subscription_has_pending_operation'
            USING ERRCODE = '23505';
    END IF;

    IF (p_cancelled_by_role = 'student' AND p_cancelled_by IS DISTINCT FROM v_session.student_id)
        OR (p_cancelled_by_role = 'teacher' AND p_cancelled_by IS DISTINCT FROM v_session.teacher_id)
        OR (
            p_cancelled_by_role = 'admin'
            AND NOT EXISTS (
                SELECT 1
                FROM public.profiles AS actor_profile
                WHERE actor_profile.id = p_cancelled_by
                  AND actor_profile.role = 'admin'
            )
        ) THEN
        RAISE EXCEPTION 'session_cancellation_forbidden' USING ERRCODE = '42501';
    END IF;

    IF v_session.scheduled_at IS NOT NULL THEN
        v_hours_until_class := (
            EXTRACT(EPOCH FROM (v_session.scheduled_at - v_cancelled_at)) / 3600
        )::DOUBLE PRECISION;
        v_late_student_cancellation := p_cancelled_by_role = 'student'
            AND v_session.scheduled_at < v_cancelled_at + INTERVAL '24 hours';
    END IF;

    IF NOT v_late_student_cancellation AND v_session.subscription_id IS NOT NULL THEN
        v_previous_sessions_used := COALESCE(v_subscription.sessions_used, 0);

        IF v_previous_sessions_used > 0 THEN
            v_quota_restore_attempted := TRUE;
            v_next_sessions_used := v_previous_sessions_used - 1;

            UPDATE public.subscriptions
            SET sessions_used = v_next_sessions_used
            WHERE id = v_subscription.id;

            v_quota_restored := TRUE;
        END IF;
    END IF;

    UPDATE public.sessions
    SET status = 'cancelled',
        cancellation_reason = p_cancellation_reason,
        cancelled_at = v_cancelled_at,
        cancelled_by = p_cancelled_by
    WHERE id = v_session.id;

    v_job_dedupe_key := 'session_cancellation:' || v_session.id::TEXT;
    v_job_payload := pg_catalog.jsonb_build_object(
        'sessionId', v_session.id,
        'cancelledBy', p_cancelled_by_role,
        'reason', p_cancellation_reason
    );

    INSERT INTO public.fulfillment_jobs (
        job_type,
        session_id,
        subscription_id,
        student_id,
        dedupe_key,
        payload
    ) VALUES (
        'session_cancellation',
        v_session.id,
        v_session.subscription_id,
        v_session.student_id,
        v_job_dedupe_key,
        v_job_payload
    )
    ON CONFLICT (job_type, dedupe_key)
        WHERE dedupe_key IS NOT NULL
        DO NOTHING;

    SELECT existing_job.* INTO v_job
    FROM public.fulfillment_jobs AS existing_job
    WHERE existing_job.job_type = 'session_cancellation'
      AND existing_job.dedupe_key = v_job_dedupe_key;

    IF v_job.id IS NULL
       OR v_job.session_id IS DISTINCT FROM v_session.id
       OR v_job.subscription_id IS DISTINCT FROM v_session.subscription_id
       OR v_job.student_id IS DISTINCT FROM v_session.student_id
       OR v_job.payload IS DISTINCT FROM v_job_payload THEN
        RAISE EXCEPTION 'session_cancellation_job_conflicts'
            USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
    SELECT
        v_session.id,
        v_session.subscription_id,
        v_cancelled_at,
        v_late_student_cancellation,
        v_quota_restore_attempted,
        v_quota_restored,
        v_previous_sessions_used,
        v_next_sessions_used,
        v_hours_until_class;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION private.checkout_v2_reschedule_has_sufficient_notice(
    p_scheduled_at TIMESTAMPTZ,
    p_requested_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT p_scheduled_at >= p_requested_at + INTERVAL '24 hours';
$$;

-- One-off moves must respect both already materialized work and recurrent
-- capacity. A change of teacher or recurrent slot is a separate product
-- operation and therefore fails closed here.
CREATE OR REPLACE FUNCTION private.checkout_v2_reschedule_target_is_available(
    p_teacher_id UUID,
    p_subscription_id UUID,
    p_cycle_id UUID,
    p_session_id UUID,
    p_target_at TIMESTAMPTZ,
    p_duration_minutes INTEGER,
    p_exclude_entire_cycle BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
STRICT
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target_local TIMESTAMP := p_target_at AT TIME ZONE 'Europe/Madrid';
    target_weekly_second BIGINT;
BEGIN
    target_weekly_second :=
        EXTRACT(DOW FROM target_local)::BIGINT * 86400
        + EXTRACT(EPOCH FROM target_local::TIME)::BIGINT;

    RETURN EXISTS (
        SELECT 1
        FROM public.teacher_availability AS availability
        WHERE availability.teacher_id = p_teacher_id
          AND availability.is_active = TRUE
          AND availability.day_of_week = EXTRACT(DOW FROM target_local)::INTEGER
          AND availability.start_time <= target_local::TIME
          AND availability.end_time >=
                target_local::TIME + pg_catalog.make_interval(mins => p_duration_minutes)
          AND target_local::TIME
                + pg_catalog.make_interval(mins => p_duration_minutes)
                > target_local::TIME
          AND (
                p_exclude_entire_cycle
                OR pg_catalog.mod(
                    EXTRACT(
                        EPOCH FROM (target_local::TIME - availability.start_time)
                    )::BIGINT,
                    p_duration_minutes::BIGINT * 60
                ) = 0
          )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.sessions AS other_session
        WHERE other_session.teacher_id = p_teacher_id
          AND other_session.status <> 'cancelled'
          AND other_session.scheduled_at IS NOT NULL
          AND (
                (
                    p_exclude_entire_cycle
                    AND other_session.checkout_v2_cycle_id IS DISTINCT FROM p_cycle_id
                )
                OR (NOT p_exclude_entire_cycle AND other_session.id <> p_session_id)
          )
          AND public.session_tstzrange(
                other_session.scheduled_at,
                other_session.duration_minutes
              ) && public.session_tstzrange(p_target_at, p_duration_minutes)
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_occurrences AS occurrence_row
        JOIN public.bookable_slots AS slot_row
          ON slot_row.id = occurrence_row.slot_id
        WHERE occurrence_row.teacher_id = p_teacher_id
          AND occurrence_row.blocks_teacher
          AND public.session_tstzrange(
                occurrence_row.starts_at,
                occurrence_row.duration_minutes
              ) && public.session_tstzrange(p_target_at, p_duration_minutes)
          AND NOT (
                slot_row.status = 'sold'
                AND slot_row.sold_subscription_id = p_subscription_id
                AND occurrence_row.starts_at = p_target_at
                AND occurrence_row.duration_minutes = p_duration_minutes
          )
    )
    AND NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations AS allocation_row
        WHERE allocation_row.teacher_id = p_teacher_id
          AND allocation_row.status IN ('offered', 'active')
          AND allocation_row.subscription_id IS DISTINCT FROM p_subscription_id
          AND pg_catalog.int8range(
                allocation_row.weekday::BIGINT * 86400
                    + EXTRACT(EPOCH FROM allocation_row.local_start_time)::BIGINT,
                allocation_row.weekday::BIGINT * 86400
                    + EXTRACT(EPOCH FROM allocation_row.local_start_time)::BIGINT
                    + allocation_row.duration_minutes::BIGINT * 60,
                '[)'
              ) && pg_catalog.int8range(
                    target_weekly_second,
                    target_weekly_second + p_duration_minutes::BIGINT * 60,
                    '[)'
              )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_checkout_v2_reschedule(
    p_request_id UUID,
    p_session_id UUID,
    p_actor_id UUID,
    p_new_scheduled_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_reschedule_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    requested_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    existing_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
    session_row public.sessions%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    actor_role public.user_role;
    provisional_anchor BOOLEAN;
    target_local TIMESTAMP;
    target_local_date DATE;
    target_index SMALLINT;
    target_at TIMESTAMPTZ;
    previous_scheduled_at TIMESTAMPTZ;
    next_scheduled_at TIMESTAMPTZ;
BEGIN
    IF p_request_id IS NULL
       OR p_session_id IS NULL
       OR p_actor_id IS NULL
       OR p_new_scheduled_at IS NULL
       OR NOT pg_catalog.isfinite(p_new_scheduled_at)
       OR date_trunc('second', p_new_scheduled_at) IS DISTINCT FROM p_new_scheduled_at THEN
        RAISE EXCEPTION 'invalid_checkout_v2_reschedule_request'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 42853)
    );

    SELECT * INTO existing_operation
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.request_id = p_request_id
    FOR UPDATE;

    IF FOUND THEN
        IF ROW(
            existing_operation.session_id,
            existing_operation.actor_id,
            existing_operation.new_scheduled_at
        ) IS DISTINCT FROM ROW(
            p_session_id,
            p_actor_id,
            p_new_scheduled_at
        ) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_request_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN existing_operation;
    END IF;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = p_session_id;

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_session_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(session_row.subscription_id::TEXT, 42854)
    );

    UPDATE public.checkout_v2_reschedule_operations
    SET
        status = 'failed',
        last_error = 'expired_before_stripe_mutation',
        updated_at = requested_at
    WHERE subscription_id = session_row.subscription_id
      AND status = 'requested'
      AND stripe_mutation_started_at IS NULL
      AND created_at <= requested_at - INTERVAL '15 minutes';


    IF session_row.teacher_id IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(session_row.teacher_id::TEXT, 42850)
        );
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions AS target_subscription
    WHERE target_subscription.id = session_row.subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state AS billing
    WHERE billing.subscription_id = subscription_row.id
    FOR UPDATE;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = session_row.checkout_v2_cycle_id
    FOR UPDATE;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations AS allocation
    WHERE allocation.subscription_id = subscription_row.id
      AND allocation.status = 'active'
    FOR UPDATE;

    PERFORM 1
    FROM public.sessions AS cycle_session
    WHERE cycle_session.checkout_v2_cycle_id = cycle_row.id
    ORDER BY cycle_session.checkout_v2_cycle_session_index
    FOR UPDATE;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = p_session_id
    FOR UPDATE;

    SELECT profile.role INTO actor_role
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS pending_operation
        WHERE pending_operation.subscription_id = subscription_row.id
          AND pending_operation.status IN ('requested', 'manual_review')
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_subscription_has_pending_operation'
            USING ERRCODE = '23505';
    END IF;

    IF actor_role IS NULL
       OR NOT (
            actor_role = 'admin'::public.user_role
            OR p_actor_id = session_row.student_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       OR billing_row.subscription_id IS NULL
       OR cycle_row.id IS NULL
       OR cycle_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR allocation_row.id IS NULL
       OR session_row.teacher_id IS DISTINCT FROM allocation_row.teacher_id
       OR session_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR session_row.checkout_v2_cycle_session_index IS NULL
       OR session_row.teacher_id IS NULL
       OR session_row.duration_minutes IS DISTINCT FROM 50
       OR session_row.status IS DISTINCT FROM 'scheduled'
       OR session_row.scheduled_at IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_not_allowed'
            USING ERRCODE = '23514';
    END IF;

    IF session_row.scheduled_at IS NOT DISTINCT FROM p_new_scheduled_at
       OR p_new_scheduled_at <= requested_at THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_target_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NOT private.checkout_v2_reschedule_has_sufficient_notice(
        session_row.scheduled_at,
        requested_at
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_requires_24_hours_notice'
            USING ERRCODE = '23514';
    END IF;

    provisional_anchor :=
        cycle_row.cycle_number = 1
        AND session_row.checkout_v2_cycle_session_index = 1
        AND billing_row.first_session_id = session_row.id
        AND billing_row.anchor_state = 'provisional';

    IF cycle_row.cycle_number = 1
       AND session_row.checkout_v2_cycle_session_index = 1
       AND NOT provisional_anchor THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_first_class_anchor_is_fixed'
            USING ERRCODE = '23514';
    END IF;

    IF provisional_anchor THEN
        target_local := p_new_scheduled_at AT TIME ZONE allocation_row.timezone_name;
        target_local_date := target_local::DATE;

        IF allocation_row.id IS NULL
           OR billing_row.first_class_at IS DISTINCT FROM session_row.scheduled_at
           OR cycle_row.starts_at IS DISTINCT FROM session_row.scheduled_at
           OR clock_timestamp() >= billing_row.first_class_at
           OR EXTRACT(DOW FROM target_local_date)::SMALLINT
                IS DISTINCT FROM allocation_row.weekday
           OR target_local::TIME(0) IS DISTINCT FROM allocation_row.local_start_time
           OR (target_local AT TIME ZONE allocation_row.timezone_name)
                IS DISTINCT FROM p_new_scheduled_at
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.generate_series(0, 3) AS occurrence(week_offset)
                CROSS JOIN LATERAL (
                    SELECT
                        target_local
                        + pg_catalog.make_interval(days => occurrence.week_offset * 7)
                            AS local_occurrence_at
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
           )
           OR (
                SELECT COUNT(*)
                FROM public.sessions AS cycle_session
                WHERE cycle_session.checkout_v2_cycle_id = cycle_row.id
                  AND cycle_session.status = 'scheduled'
                  AND cycle_session.teacher_id = session_row.teacher_id
                  AND cycle_session.duration_minutes = 50
                  AND cycle_session.checkout_v2_cycle_session_index BETWEEN 1 AND 4
           ) IS DISTINCT FROM 4 THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_provisional_anchor_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        FOR target_index IN 1..4 LOOP
            target_at := (
                target_local
                + pg_catalog.make_interval(days => (target_index - 1) * 7)
            ) AT TIME ZONE allocation_row.timezone_name;

            IF NOT private.checkout_v2_reschedule_target_is_available(
                session_row.teacher_id,
                subscription_row.id,
                cycle_row.id,
                session_row.id,
                target_at,
                session_row.duration_minutes,
                TRUE
            ) THEN
                RAISE EXCEPTION 'checkout_v2_reschedule_target_conflicts'
                    USING ERRCODE = '23P01';
            END IF;
        END LOOP;
    ELSE
        IF p_new_scheduled_at < cycle_row.starts_at
           OR p_new_scheduled_at
                + pg_catalog.make_interval(mins => session_row.duration_minutes)
                > cycle_row.ends_at THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_target_outside_cycle'
                USING ERRCODE = '23514';
        END IF;

        SELECT previous_session.scheduled_at INTO previous_scheduled_at
        FROM public.sessions AS previous_session
        WHERE previous_session.checkout_v2_cycle_id = cycle_row.id
          AND previous_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index - 1;

        SELECT following_session.scheduled_at INTO next_scheduled_at
        FROM public.sessions AS following_session
        WHERE following_session.checkout_v2_cycle_id = cycle_row.id
          AND following_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index + 1;

        IF (previous_scheduled_at IS NOT NULL AND p_new_scheduled_at <= previous_scheduled_at)
           OR (next_scheduled_at IS NOT NULL AND p_new_scheduled_at >= next_scheduled_at) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_cycle_order_conflicts'
                USING ERRCODE = '23514';
        END IF;

        IF NOT private.checkout_v2_reschedule_target_is_available(
            session_row.teacher_id,
            subscription_row.id,
            cycle_row.id,
            session_row.id,
            p_new_scheduled_at,
            session_row.duration_minutes,
            FALSE
        ) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_target_conflicts'
                USING ERRCODE = '23P01';
        END IF;
    END IF;

    INSERT INTO public.checkout_v2_reschedule_operations (
        request_id,
        session_id,
        subscription_id,
        cycle_id,
        actor_id,
        operation_kind,
        old_scheduled_at,
        new_scheduled_at,
        expected_anchor_revision,
        target_stripe_anchor_at,
        created_at,
        updated_at
    ) VALUES (
        p_request_id,
        session_row.id,
        subscription_row.id,
        cycle_row.id,
        p_actor_id,
        CASE WHEN provisional_anchor THEN 'provisional_anchor' ELSE 'single_session' END,
        session_row.scheduled_at,
        p_new_scheduled_at,
        billing_row.anchor_revision,
        CASE
            WHEN provisional_anchor THEN p_new_scheduled_at + INTERVAL '672 hours'
            ELSE NULL
        END,
        requested_at,
        requested_at
    )
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_checkout_v2_reschedule_stripe_mutation(
    p_operation_id UUID
)
RETURNS public.checkout_v2_reschedule_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
    session_row public.sessions%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    started_clock TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    target_local TIMESTAMP;
    target_local_date DATE;
    target_index SMALLINT;
    target_at TIMESTAMPTZ;
BEGIN
    IF p_operation_id IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_reschedule_begin_request'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_operation_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = operation_row.session_id;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(operation_row.subscription_id::TEXT, 42854)
    );
    IF session_row.teacher_id IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(session_row.teacher_id::TEXT, 42850)
        );
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions AS target_subscription
    WHERE target_subscription.id = operation_row.subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state AS billing
    WHERE billing.subscription_id = operation_row.subscription_id
    FOR UPDATE;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = operation_row.cycle_id
    FOR UPDATE;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations AS allocation
    WHERE allocation.subscription_id = operation_row.subscription_id
      AND allocation.status = 'active'
    FOR UPDATE;

    PERFORM 1
    FROM public.sessions AS cycle_session
    WHERE cycle_session.checkout_v2_cycle_id = operation_row.cycle_id
    ORDER BY cycle_session.checkout_v2_cycle_session_index
    FOR UPDATE;

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id
    FOR UPDATE;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = operation_row.session_id
    FOR UPDATE;

    IF operation_row.status IS DISTINCT FROM 'requested'
       OR operation_row.operation_kind IS DISTINCT FROM 'provisional_anchor' THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_operation_cannot_begin_stripe_mutation'
            USING ERRCODE = '23514';
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       OR billing_row.subscription_id IS NULL
       OR billing_row.anchor_revision IS DISTINCT FROM
            operation_row.expected_anchor_revision
       OR billing_row.first_session_id IS DISTINCT FROM operation_row.session_id
       OR billing_row.first_class_at IS DISTINCT FROM operation_row.old_scheduled_at
       OR billing_row.anchor_state IS DISTINCT FROM 'provisional'
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_number IS DISTINCT FROM 1
       OR cycle_row.starts_at IS DISTINCT FROM operation_row.old_scheduled_at
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR allocation_row.id IS NULL
       OR session_row.id IS NULL
       OR session_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM operation_row.cycle_id
       OR session_row.checkout_v2_cycle_session_index IS DISTINCT FROM 1
       OR session_row.scheduled_at IS DISTINCT FROM operation_row.old_scheduled_at
       OR session_row.status IS DISTINCT FROM 'scheduled'
       OR session_row.teacher_id IS NULL
       OR session_row.teacher_id IS DISTINCT FROM allocation_row.teacher_id
       OR session_row.duration_minutes IS DISTINCT FROM 50
       OR operation_row.target_stripe_anchor_at IS DISTINCT FROM
            operation_row.new_scheduled_at + INTERVAL '672 hours'
       OR operation_row.old_scheduled_at < operation_row.created_at + INTERVAL '24 hours'
       OR operation_row.old_scheduled_at <= started_clock
       OR operation_row.new_scheduled_at <= started_clock THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    target_local := operation_row.new_scheduled_at
        AT TIME ZONE allocation_row.timezone_name;
    target_local_date := target_local::DATE;

    IF EXTRACT(DOW FROM target_local_date)::SMALLINT
            IS DISTINCT FROM allocation_row.weekday
       OR target_local::TIME(0) IS DISTINCT FROM allocation_row.local_start_time
       OR (target_local AT TIME ZONE allocation_row.timezone_name)
            IS DISTINCT FROM operation_row.new_scheduled_at
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.generate_series(0, 3) AS occurrence(week_offset)
            CROSS JOIN LATERAL (
                SELECT
                    target_local
                    + pg_catalog.make_interval(days => occurrence.week_offset * 7)
                        AS local_occurrence_at
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
       )
       OR (
            SELECT COUNT(*)
            FROM public.sessions AS cycle_session
            WHERE cycle_session.checkout_v2_cycle_id = cycle_row.id
              AND cycle_session.status = 'scheduled'
              AND cycle_session.teacher_id = session_row.teacher_id
              AND cycle_session.duration_minutes = 50
              AND cycle_session.checkout_v2_cycle_session_index BETWEEN 1 AND 4
       ) IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    FOR target_index IN 1..4 LOOP
        target_at := (
            target_local
            + pg_catalog.make_interval(days => (target_index - 1) * 7)
        ) AT TIME ZONE allocation_row.timezone_name;

        IF NOT private.checkout_v2_reschedule_target_is_available(
            session_row.teacher_id,
            subscription_row.id,
            cycle_row.id,
            session_row.id,
            target_at,
            session_row.duration_minutes,
            TRUE
        ) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_target_conflicts'
                USING ERRCODE = '23P01';
        END IF;
    END LOOP;

    IF operation_row.stripe_mutation_started_at IS NOT NULL THEN
        RETURN operation_row;
    END IF;

    IF operation_row.created_at <= started_clock - INTERVAL '15 minutes' THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_operation_expired_before_stripe_mutation'
            USING ERRCODE = '57014';
    END IF;

    UPDATE public.checkout_v2_reschedule_operations
    SET
        stripe_mutation_started_at = started_clock,
        updated_at = started_clock
    WHERE id = operation_row.id
      AND status = 'requested'
      AND stripe_mutation_started_at IS NULL
    RETURNING * INTO operation_row;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_checkout_v2_reschedule_outcome(
    p_operation_id UUID,
    p_status TEXT,
    p_last_error TEXT,
    p_observed_stripe_anchor_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.checkout_v2_reschedule_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
    outcome_clock TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    expected_previous_anchor TIMESTAMPTZ;
    recovering_previous_anchor BOOLEAN := FALSE;
BEGIN
    IF p_operation_id IS NULL
       OR p_status NOT IN ('failed', 'manual_review')
       OR NULLIF(btrim(p_last_error), '') IS NULL
       OR char_length(p_last_error) > 2000
       OR (
            p_observed_stripe_anchor_at IS NOT NULL
            AND (
                NOT pg_catalog.isfinite(p_observed_stripe_anchor_at)
                OR date_trunc('second', p_observed_stripe_anchor_at)
                    IS DISTINCT FROM p_observed_stripe_anchor_at
            )
       ) THEN
        RAISE EXCEPTION 'invalid_checkout_v2_reschedule_outcome'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_operation_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(operation_row.subscription_id::TEXT, 42854)
    );

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id
    FOR UPDATE;

    expected_previous_anchor :=
        operation_row.old_scheduled_at + INTERVAL '672 hours';
    recovering_previous_anchor :=
        operation_row.status = 'manual_review'
        AND operation_row.operation_kind = 'provisional_anchor'
        AND p_status = 'failed'
        AND p_last_error = 'stripe_confirmed_at_previous_anchor'
        AND p_observed_stripe_anchor_at IS NOT DISTINCT FROM
            expected_previous_anchor;

    IF operation_row.status = p_status
       AND operation_row.last_error IS NOT DISTINCT FROM p_last_error
       AND operation_row.observed_stripe_anchor_at
            IS NOT DISTINCT FROM p_observed_stripe_anchor_at THEN
        RETURN operation_row;
    END IF;

    IF NOT (
        (
            operation_row.status = 'requested'
            AND p_observed_stripe_anchor_at IS NULL
            AND p_last_error <> 'stripe_confirmed_at_previous_anchor'
            AND NOT (
                p_status = 'failed'
                AND operation_row.stripe_mutation_started_at IS NOT NULL
            )
            AND NOT (
                p_status = 'manual_review'
                AND operation_row.operation_kind IS DISTINCT FROM 'provisional_anchor'
            )
        )
        OR recovering_previous_anchor
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_outcome_transition_is_not_allowed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.checkout_v2_reschedule_operations
    SET
        status = p_status,
        last_error = p_last_error,
        observed_stripe_anchor_at = CASE
            WHEN recovering_previous_anchor THEN p_observed_stripe_anchor_at
            ELSE observed_stripe_anchor_at
        END,
        updated_at = outcome_clock
    WHERE id = operation_row.id
      AND status = operation_row.status
    RETURNING * INTO operation_row;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_outcome_transition_is_not_allowed'
            USING ERRCODE = '23514';
    END IF;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_checkout_v2_reschedule(
    p_operation_id UUID,
    p_observed_stripe_anchor_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.checkout_v2_reschedule_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
    session_row public.sessions%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    previous_scheduled_at TIMESTAMPTZ;
    next_scheduled_at TIMESTAMPTZ;
    old_session_times JSONB;
    job_payload JSONB;
    job_dedupe_key TEXT;
    job_row public.fulfillment_jobs%ROWTYPE;
    moved_session public.sessions%ROWTYPE;
    applied_clock TIMESTAMPTZ := date_trunc('second', clock_timestamp());
BEGIN
    IF p_operation_id IS NULL
       OR (
            p_observed_stripe_anchor_at IS NOT NULL
            AND (
                NOT pg_catalog.isfinite(p_observed_stripe_anchor_at)
                OR date_trunc('second', p_observed_stripe_anchor_at)
                    IS DISTINCT FROM p_observed_stripe_anchor_at
            )
       ) THEN
        RAISE EXCEPTION 'invalid_checkout_v2_reschedule_apply_request'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_operation_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = operation_row.session_id;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(operation_row.subscription_id::TEXT, 42854)
    );
    IF session_row.teacher_id IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(session_row.teacher_id::TEXT, 42850)
        );
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions AS target_subscription
    WHERE target_subscription.id = operation_row.subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state AS billing
    WHERE billing.subscription_id = operation_row.subscription_id
    FOR UPDATE;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = operation_row.cycle_id
    FOR UPDATE;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations AS allocation
    WHERE allocation.subscription_id = operation_row.subscription_id
      AND allocation.status = 'active'
    FOR UPDATE;

    PERFORM 1
    FROM public.sessions AS cycle_session
    WHERE cycle_session.checkout_v2_cycle_id = operation_row.cycle_id
    ORDER BY cycle_session.checkout_v2_cycle_session_index
    FOR UPDATE;

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id
    FOR UPDATE;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = operation_row.session_id
    FOR UPDATE;

    IF operation_row.status = 'applied' THEN
        IF operation_row.observed_stripe_anchor_at
                IS DISTINCT FROM p_observed_stripe_anchor_at THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_observed_anchor_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN operation_row;
    END IF;

    IF operation_row.status NOT IN ('requested', 'manual_review')
       OR (
            operation_row.status = 'manual_review'
            AND operation_row.operation_kind IS DISTINCT FROM 'provisional_anchor'
       ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_operation_is_not_applicable'
            USING ERRCODE = '23514';
    END IF;

    IF operation_row.operation_kind = 'provisional_anchor' THEN
        IF (
                operation_row.status = 'requested'
                AND operation_row.stripe_mutation_started_at IS NULL
           )
           OR p_observed_stripe_anchor_at IS DISTINCT FROM
                operation_row.target_stripe_anchor_at THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_observed_anchor_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSIF p_observed_stripe_anchor_at IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_observed_anchor_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR billing_row.subscription_id IS NULL
       OR billing_row.anchor_revision IS DISTINCT FROM
            operation_row.expected_anchor_revision
       OR cycle_row.id IS NULL
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR allocation_row.id IS NULL
       OR session_row.id IS NULL
       OR session_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM operation_row.cycle_id
       OR session_row.scheduled_at IS DISTINCT FROM operation_row.old_scheduled_at
       OR session_row.status IS DISTINCT FROM 'scheduled'
       OR session_row.teacher_id IS NULL
       OR session_row.teacher_id IS DISTINCT FROM allocation_row.teacher_id
       OR session_row.duration_minutes IS DISTINCT FROM 50
       OR operation_row.new_scheduled_at <= applied_clock
       OR applied_clock >= operation_row.old_scheduled_at THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    SELECT pg_catalog.jsonb_object_agg(
        cycle_session.id::TEXT,
        pg_catalog.to_jsonb(cycle_session.scheduled_at)
    ) INTO old_session_times
    FROM public.sessions AS cycle_session
    WHERE cycle_session.checkout_v2_cycle_id = operation_row.cycle_id
      AND (
            operation_row.operation_kind = 'provisional_anchor'
            OR cycle_session.id = operation_row.session_id
      );

    PERFORM pg_catalog.set_config(
        'app.checkout_v2_reschedule_operation_id',
        operation_row.id::TEXT,
        TRUE
    );

    IF operation_row.operation_kind = 'provisional_anchor' THEN
        IF cycle_row.cycle_number IS DISTINCT FROM 1
           OR session_row.checkout_v2_cycle_session_index IS DISTINCT FROM 1
           OR billing_row.first_session_id IS DISTINCT FROM session_row.id
           OR billing_row.anchor_state IS DISTINCT FROM 'provisional'
           OR allocation_row.id IS NULL THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_state_conflicts'
                USING ERRCODE = '40001';
        END IF;

        PERFORM public.reconcile_checkout_v2_provisional_anchor(
            operation_row.subscription_id,
            operation_row.expected_anchor_revision,
            (
                operation_row.new_scheduled_at
                AT TIME ZONE allocation_row.timezone_name
            )::DATE,
            p_observed_stripe_anchor_at
        );
    ELSE
        IF operation_row.new_scheduled_at < cycle_row.starts_at
           OR operation_row.new_scheduled_at
                + pg_catalog.make_interval(mins => session_row.duration_minutes)
                > cycle_row.ends_at THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_target_outside_cycle'
                USING ERRCODE = '23514';
        END IF;

        SELECT previous_session.scheduled_at INTO previous_scheduled_at
        FROM public.sessions AS previous_session
        WHERE previous_session.checkout_v2_cycle_id = cycle_row.id
          AND previous_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index - 1;

        SELECT following_session.scheduled_at INTO next_scheduled_at
        FROM public.sessions AS following_session
        WHERE following_session.checkout_v2_cycle_id = cycle_row.id
          AND following_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index + 1;

        IF (previous_scheduled_at IS NOT NULL
                AND operation_row.new_scheduled_at <= previous_scheduled_at)
           OR (next_scheduled_at IS NOT NULL
                AND operation_row.new_scheduled_at >= next_scheduled_at) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_cycle_order_conflicts'
                USING ERRCODE = '23514';
        END IF;

        IF NOT private.checkout_v2_reschedule_target_is_available(
            session_row.teacher_id,
            subscription_row.id,
            cycle_row.id,
            session_row.id,
            operation_row.new_scheduled_at,
            session_row.duration_minutes,
            FALSE
        ) THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_target_conflicts'
                USING ERRCODE = '23P01';
        END IF;

        UPDATE public.sessions
        SET
            scheduled_at = operation_row.new_scheduled_at,
            updated_at = applied_clock
        WHERE id = operation_row.session_id;
    END IF;

    FOR moved_session IN
        SELECT cycle_session.*
        FROM public.sessions AS cycle_session
        WHERE cycle_session.checkout_v2_cycle_id = operation_row.cycle_id
          AND (
                operation_row.operation_kind = 'provisional_anchor'
                OR cycle_session.id = operation_row.session_id
          )
        ORDER BY cycle_session.checkout_v2_cycle_session_index
    LOOP
        job_dedupe_key :=
            'checkout_v2_reschedule:' || operation_row.id::TEXT
            || ':' || moved_session.id::TEXT;
        job_payload := pg_catalog.jsonb_build_object(
            'operationId', operation_row.id,
            'sessionId', moved_session.id,
            'previousScheduledAt', old_session_times -> moved_session.id::TEXT,
            'scheduledAt', moved_session.scheduled_at,
            'sendEmail', TRUE
        );

        INSERT INTO public.fulfillment_jobs (
            job_type,
            session_id,
            subscription_id,
            student_id,
            dedupe_key,
            payload
        ) VALUES (
            'session_reschedule',
            moved_session.id,
            operation_row.subscription_id,
            moved_session.student_id,
            job_dedupe_key,
            job_payload
        )
        ON CONFLICT (job_type, dedupe_key)
            WHERE dedupe_key IS NOT NULL
            DO NOTHING;

        SELECT * INTO job_row
        FROM public.fulfillment_jobs AS existing_job
        WHERE existing_job.job_type = 'session_reschedule'
          AND existing_job.dedupe_key = job_dedupe_key;

        IF job_row.id IS NULL
           OR job_row.session_id IS DISTINCT FROM moved_session.id
           OR job_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
           OR job_row.student_id IS DISTINCT FROM moved_session.student_id
           OR job_row.payload IS DISTINCT FROM job_payload THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_job_conflicts'
                USING ERRCODE = '23505';
        END IF;
    END LOOP;

    UPDATE public.checkout_v2_reschedule_operations
    SET
        observed_stripe_anchor_at = p_observed_stripe_anchor_at,
        stripe_mutation_started_at = CASE
            WHEN operation_kind = 'provisional_anchor' THEN COALESCE(
                stripe_mutation_started_at,
                applied_clock
            )
            ELSE NULL
        END,
        status = 'applied',
        last_error = NULL,
        applied_at = applied_clock,
        updated_at = applied_clock
    WHERE id = operation_row.id
    RETURNING * INTO operation_row;

    RETURN operation_row;
END;
$$;

-- Correlated timestamps span three tables, so a deferred constraint checks
-- only the committed transaction result and still permits the atomic
-- infinity-swap used while moving the initial four-session cycle.
CREATE OR REPLACE FUNCTION private.validate_checkout_v2_first_session_coherence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target_subscription_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'sessions' THEN
        target_subscription_id := COALESCE(NEW.subscription_id, OLD.subscription_id);
    ELSIF TG_TABLE_NAME = 'checkout_v2_cycles' THEN
        target_subscription_id := COALESCE(NEW.subscription_id, OLD.subscription_id);
    ELSE
        target_subscription_id := COALESCE(NEW.subscription_id, OLD.subscription_id);
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_billing_state AS billing
        WHERE billing.subscription_id = target_subscription_id
    ) AND NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_billing_state AS billing
        JOIN public.sessions AS first_session
          ON first_session.id = billing.first_session_id
         AND first_session.subscription_id = billing.subscription_id
         AND first_session.checkout_v2_cycle_session_index = 1
         AND first_session.scheduled_at = billing.first_class_at
        JOIN public.checkout_v2_cycles AS first_cycle
          ON first_cycle.id = first_session.checkout_v2_cycle_id
         AND first_cycle.subscription_id = billing.subscription_id
         AND first_cycle.cycle_number = 1
         AND first_cycle.starts_at = billing.first_class_at
         AND first_cycle.ends_at = billing.renewal_anchor_at
        WHERE billing.subscription_id = target_subscription_id
    ) THEN
        RAISE EXCEPTION 'checkout_v2_first_session_billing_cycle_diverged'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_checkout_v2_first_session_after_session_write
    AFTER INSERT OR UPDATE OR DELETE ON public.sessions
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_checkout_v2_first_session_coherence();

CREATE CONSTRAINT TRIGGER validate_checkout_v2_first_session_after_cycle_write
    AFTER INSERT OR UPDATE OR DELETE ON public.checkout_v2_cycles
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_checkout_v2_first_session_coherence();

CREATE CONSTRAINT TRIGGER validate_checkout_v2_first_session_after_billing_write
    AFTER INSERT OR UPDATE OR DELETE ON public.checkout_v2_billing_state
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_checkout_v2_first_session_coherence();

-- Constraint triggers do not inspect pre-existing rows when installed. The
-- upgrade therefore proves the same invariant read-only and stops instead of
-- guessing how to repair historical billing state.
CREATE OR REPLACE FUNCTION private.assert_checkout_v2_first_session_coherence_upgrade_safe()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_billing_state AS billing
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.sessions AS first_session
            JOIN public.checkout_v2_cycles AS first_cycle
              ON first_cycle.id = first_session.checkout_v2_cycle_id
             AND first_cycle.subscription_id = billing.subscription_id
             AND first_cycle.cycle_number = 1
             AND first_cycle.starts_at = billing.first_class_at
             AND first_cycle.ends_at = billing.renewal_anchor_at
            WHERE first_session.id = billing.first_session_id
              AND first_session.subscription_id = billing.subscription_id
              AND first_session.checkout_v2_cycle_session_index = 1
              AND first_session.scheduled_at = billing.first_class_at
        )
    ) THEN
        RAISE EXCEPTION
            'checkout_v2_reschedule_upgrade_requires_coherent_first_session_billing_cycle'
            USING ERRCODE = '55000';
    END IF;

    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION private.checkout_v2_reschedule_has_sufficient_notice(
    TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.checkout_v2_reschedule_target_is_available(
    UUID, UUID, UUID, UUID, TIMESTAMPTZ, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_reschedule_locked_state()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.validate_checkout_v2_first_session_coherence()
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_checkout_v2_first_session_coherence_upgrade_safe()
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.prepare_checkout_v2_reschedule(
    UUID, UUID, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_checkout_v2_reschedule(
    UUID, UUID, UUID, TIMESTAMPTZ
) TO service_role;

REVOKE ALL ON FUNCTION public.begin_checkout_v2_reschedule_stripe_mutation(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_checkout_v2_reschedule_stripe_mutation(UUID)
    TO service_role;

REVOKE ALL ON FUNCTION public.mark_checkout_v2_reschedule_outcome(
    UUID, TEXT, TEXT, TIMESTAMPTZ
)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_v2_reschedule_outcome(
    UUID, TEXT, TEXT, TIMESTAMPTZ
)
    TO service_role;

REVOKE ALL ON FUNCTION public.apply_checkout_v2_reschedule(
    UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_v2_reschedule(
    UUID, TIMESTAMPTZ
) TO service_role;

-- The lower-level anchor reconciler remains available to its owner for this
-- SECURITY DEFINER composition, but application code must pass through the
-- durable request and the 24-hour policy boundary above.
REVOKE EXECUTE ON FUNCTION public.reconcile_checkout_v2_provisional_anchor(
    UUID, BIGINT, DATE, TIMESTAMPTZ
) FROM service_role;

SELECT private.assert_checkout_v2_first_session_coherence_upgrade_safe();

COMMENT ON TABLE public.checkout_v2_reschedule_operations IS
    'Durable idempotency, policy snapshot and Stripe reconciliation ledger for Checkout V2 rescheduling.';
COMMENT ON FUNCTION public.prepare_checkout_v2_reschedule(UUID, UUID, UUID, TIMESTAMPTZ) IS
    'Validates and durably records one owner/admin Checkout V2 rescheduling request with at least 24 hours notice.';
COMMENT ON FUNCTION public.begin_checkout_v2_reschedule_stripe_mutation(UUID) IS
    'Atomically records the irreversible boundary immediately before a fresh provisional-anchor Stripe mutation.';
COMMENT ON FUNCTION public.mark_checkout_v2_reschedule_outcome(
    UUID, TEXT, TEXT, TIMESTAMPTZ
) IS
    'Closes a prepared operation, including a manual review proven to remain at the exact previous Stripe anchor.';
COMMENT ON FUNCTION public.apply_checkout_v2_reschedule(UUID, TIMESTAMPTZ) IS
    'Atomically applies one prepared Checkout V2 reschedule and enqueues exact Calendar/email update jobs.';
COMMENT ON FUNCTION private.assert_checkout_v2_first_session_coherence_upgrade_safe() IS
    'Fails the upgrade read-only when historical Checkout V2 first-session, cycle and billing timestamps diverge.';
