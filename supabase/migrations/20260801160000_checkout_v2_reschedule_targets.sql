-- The original sold slot is the immutable origin for the self-service window.
CREATE OR REPLACE FUNCTION private.checkout_v2_reschedule_is_within_self_service_horizon(
    p_subscription_id UUID,
    p_target_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations AS allocation
        JOIN public.bookable_slots AS sold_slot
          ON sold_slot.id = allocation.slot_id
        WHERE allocation.subscription_id = p_subscription_id
          AND sold_slot.status = 'sold'
          AND sold_slot.sold_subscription_id = p_subscription_id
          AND (p_target_at AT TIME ZONE allocation.timezone_name)
                <= (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)
                    + INTERVAL '28 days'
    );
$$;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_reschedule_self_service_horizon()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.operation_kind = 'provisional_anchor'
       AND NOT private.checkout_v2_reschedule_is_within_self_service_horizon(
        NEW.subscription_id,
        NEW.new_scheduled_at
       )
       AND (
            TG_OP = 'INSERT'
            OR NEW.status IN ('requested', 'manual_review')
            OR (
                NEW.status = 'applied'
                AND OLD.status IS DISTINCT FROM 'applied'
            )
            OR NEW.request_id IS DISTINCT FROM OLD.request_id
            OR NEW.session_id IS DISTINCT FROM OLD.session_id
            OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
            OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id
            OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
            OR NEW.operation_kind IS DISTINCT FROM OLD.operation_kind
            OR NEW.old_scheduled_at IS DISTINCT FROM OLD.old_scheduled_at
            OR NEW.new_scheduled_at IS DISTINCT FROM OLD.new_scheduled_at
            OR NEW.expected_anchor_revision IS DISTINCT FROM OLD.expected_anchor_revision
            OR NEW.target_stripe_anchor_at IS DISTINCT FROM OLD.target_stripe_anchor_at
       ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_exceeds_self_service_horizon'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.checkout_v2_reschedule_is_within_self_service_horizon(
    UUID,
    TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_reschedule_self_service_horizon()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_checkout_v2_reschedule_self_service_horizon_trigger
    BEFORE INSERT OR UPDATE ON public.checkout_v2_reschedule_operations
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_checkout_v2_reschedule_self_service_horizon();

CREATE OR REPLACE FUNCTION private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS operation
        WHERE operation.status IN ('requested', 'manual_review')
          AND operation.operation_kind = 'provisional_anchor'
          AND NOT private.checkout_v2_reschedule_is_within_self_service_horizon(
                operation.subscription_id,
                operation.new_scheduled_at
          )
    ) THEN
        RAISE EXCEPTION
            'checkout_v2_reschedule_upgrade_exceeds_self_service_horizon'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe()
    FROM PUBLIC, anon, authenticated, service_role;

SELECT private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe();

-- Checkout V2 rescheduling availability is derived from the same invariants as
-- the durable prepare operation. Listing is deliberately read-only: callers
-- receive viable targets but no reservation or operation is created.
CREATE OR REPLACE FUNCTION public.list_checkout_v2_reschedule_targets(
    p_session_id UUID,
    p_actor_id UUID,
    p_from TIMESTAMPTZ,
    p_to TIMESTAMPTZ,
    p_ignored_pending_request_id UUID DEFAULT NULL
)
RETURNS TABLE (
    target_scheduled_at TIMESTAMPTZ,
    operation_kind TEXT,
    affected_scheduled_ats TIMESTAMPTZ[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    requested_at TIMESTAMPTZ := date_trunc('second', statement_timestamp());
    session_row public.sessions%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    ignored_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    actor_role public.user_role;
    provisional_anchor BOOLEAN;
    previous_scheduled_at TIMESTAMPTZ;
    next_scheduled_at TIMESTAMPTZ;
    candidate_local TIMESTAMP;
    candidate_at TIMESTAMPTZ;
    candidate_affected_ats TIMESTAMPTZ[];
    target_index SMALLINT;
    target_local TIMESTAMP;
    target_at TIMESTAMPTZ;
    matching_instants BIGINT;
    all_targets_available BOOLEAN;
BEGIN
    IF p_session_id IS NULL
       OR p_actor_id IS NULL
       OR p_from IS NULL
       OR p_to IS NULL
       OR NOT pg_catalog.isfinite(p_from)
       OR NOT pg_catalog.isfinite(p_to)
       OR date_trunc('second', p_from) IS DISTINCT FROM p_from
       OR date_trunc('second', p_to) IS DISTINCT FROM p_to
       OR p_to <= p_from
       OR p_to - p_from > INTERVAL '48 hours' THEN
        RAISE EXCEPTION 'invalid_checkout_v2_reschedule_target_range'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = p_session_id;

    IF session_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_session_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT profile.role INTO actor_role
    FROM public.profiles AS profile
    WHERE profile.id = p_actor_id;

    IF actor_role IS NULL
       OR NOT (
            actor_role = 'admin'::public.user_role
            OR (
                actor_role = 'student'::public.user_role
                AND p_actor_id = session_row.student_id
            )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions AS target_subscription
    WHERE target_subscription.id = session_row.subscription_id;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state AS billing
    WHERE billing.subscription_id = subscription_row.id;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = session_row.checkout_v2_cycle_id;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations AS allocation
    WHERE allocation.subscription_id = subscription_row.id
      AND allocation.status = 'active';

    IF p_ignored_pending_request_id IS NOT NULL THEN
        SELECT * INTO ignored_operation
        FROM public.checkout_v2_reschedule_operations AS operation
        WHERE operation.request_id = p_ignored_pending_request_id;

        IF ignored_operation.id IS NULL
           OR ignored_operation.session_id IS DISTINCT FROM p_session_id
           OR ignored_operation.actor_id IS DISTINCT FROM p_actor_id
           OR ignored_operation.new_scheduled_at IS DISTINCT FROM p_from
           OR p_to IS DISTINCT FROM p_from + INTERVAL '1 second'
           OR ignored_operation.status IS DISTINCT FROM 'requested'
           OR ignored_operation.stripe_mutation_started_at IS NOT NULL THEN
            RAISE EXCEPTION 'checkout_v2_reschedule_ignored_pending_request_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS pending_operation
        WHERE pending_operation.subscription_id = subscription_row.id
          AND pending_operation.request_id IS DISTINCT FROM
                p_ignored_pending_request_id
          AND (
                pending_operation.status = 'manual_review'
                OR (
                    pending_operation.status = 'requested'
                    AND (
                        pending_operation.stripe_mutation_started_at IS NOT NULL
                        OR pending_operation.created_at
                            > requested_at - INTERVAL '15 minutes'
                    )
                )
          )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_subscription_has_pending_operation'
            USING ERRCODE = '23505';
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
        IF billing_row.first_class_at IS DISTINCT FROM session_row.scheduled_at
           OR cycle_row.starts_at IS DISTINCT FROM session_row.scheduled_at
           OR requested_at >= billing_row.first_class_at
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
    ELSE
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
    END IF;

    FOR candidate_local IN
        SELECT DISTINCT candidate_slot.local_at
        FROM pg_catalog.generate_series(
            (p_from AT TIME ZONE allocation_row.timezone_name)::DATE::TIMESTAMP,
            (p_to AT TIME ZONE allocation_row.timezone_name)::DATE::TIMESTAMP,
            INTERVAL '1 day'
        ) AS local_day(day_at)
        CROSS JOIN LATERAL (
            SELECT local_day.day_at + allocation_row.local_start_time AS local_at
            WHERE provisional_anchor

            UNION ALL

            SELECT generated_slot.local_at
            FROM public.teacher_availability AS availability
            CROSS JOIN LATERAL pg_catalog.generate_series(
                local_day.day_at + availability.start_time,
                local_day.day_at + availability.end_time - INTERVAL '50 minutes',
                INTERVAL '50 minutes'
            ) AS generated_slot(local_at)
            WHERE NOT provisional_anchor
              AND availability.teacher_id = session_row.teacher_id
              AND availability.is_active = TRUE
              AND availability.day_of_week =
                    EXTRACT(DOW FROM local_day.day_at)::INTEGER
        ) AS candidate_slot
        ORDER BY candidate_slot.local_at
    LOOP
        candidate_at := candidate_local AT TIME ZONE allocation_row.timezone_name;

        CONTINUE WHEN candidate_at < p_from
            OR candidate_at >= p_to
            OR candidate_at <= requested_at
            OR candidate_at IS NOT DISTINCT FROM session_row.scheduled_at;

        CONTINUE WHEN provisional_anchor
          AND NOT private.checkout_v2_reschedule_is_within_self_service_horizon(
            subscription_row.id,
            candidate_at
        );

        SELECT COUNT(*) INTO matching_instants
        FROM pg_catalog.generate_series(
            candidate_at - INTERVAL '2 hours',
            candidate_at + INTERVAL '2 hours',
            INTERVAL '30 minutes'
        ) AS possible_instant(instant_at)
        WHERE possible_instant.instant_at AT TIME ZONE allocation_row.timezone_name
            = candidate_local;

        CONTINUE WHEN matching_instants <> 1;

        IF provisional_anchor THEN
            CONTINUE WHEN EXTRACT(DOW FROM candidate_local)::SMALLINT
                    IS DISTINCT FROM allocation_row.weekday
                OR candidate_local::TIME(0)
                    IS DISTINCT FROM allocation_row.local_start_time;

            candidate_affected_ats := ARRAY[]::TIMESTAMPTZ[];
            all_targets_available := TRUE;

            FOR target_index IN 1..4 LOOP
                target_local := candidate_local
                    + pg_catalog.make_interval(days => (target_index - 1) * 7);
                target_at := target_local AT TIME ZONE allocation_row.timezone_name;

                SELECT COUNT(*) INTO matching_instants
                FROM pg_catalog.generate_series(
                    target_at - INTERVAL '2 hours',
                    target_at + INTERVAL '2 hours',
                    INTERVAL '30 minutes'
                ) AS possible_instant(instant_at)
                WHERE possible_instant.instant_at AT TIME ZONE allocation_row.timezone_name
                    = target_local;

                IF matching_instants <> 1
                   OR NOT private.checkout_v2_reschedule_target_is_available(
                        session_row.teacher_id,
                        subscription_row.id,
                        cycle_row.id,
                        session_row.id,
                        target_at,
                        session_row.duration_minutes,
                        TRUE
                   ) THEN
                    all_targets_available := FALSE;
                    EXIT;
                END IF;

                candidate_affected_ats := pg_catalog.array_append(
                    candidate_affected_ats,
                    target_at
                );
            END LOOP;

            IF all_targets_available THEN
                target_scheduled_at := candidate_at;
                operation_kind := 'provisional_anchor';
                affected_scheduled_ats := candidate_affected_ats;
                RETURN NEXT;
            END IF;
        ELSE
            CONTINUE WHEN candidate_at < cycle_row.starts_at
                OR candidate_at
                    + pg_catalog.make_interval(mins => session_row.duration_minutes)
                    > cycle_row.ends_at
                OR (
                    previous_scheduled_at IS NOT NULL
                    AND candidate_at <= previous_scheduled_at
                )
                OR (
                    next_scheduled_at IS NOT NULL
                    AND candidate_at >= next_scheduled_at
                );

            IF private.checkout_v2_reschedule_target_is_available(
                session_row.teacher_id,
                subscription_row.id,
                cycle_row.id,
                session_row.id,
                candidate_at,
                session_row.duration_minutes,
                FALSE
            ) THEN
                target_scheduled_at := candidate_at;
                operation_kind := 'single_session';
                affected_scheduled_ats := ARRAY[candidate_at];
                RETURN NEXT;
            END IF;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.list_checkout_v2_reschedule_targets(
    UUID,
    UUID,
    TIMESTAMPTZ,
    TIMESTAMPTZ,
    UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_checkout_v2_reschedule_targets(
    UUID,
    UUID,
    TIMESTAMPTZ,
    TIMESTAMPTZ,
    UUID
) TO service_role;

COMMENT ON FUNCTION public.list_checkout_v2_reschedule_targets(
    UUID,
    UUID,
    TIMESTAMPTZ,
    TIMESTAMPTZ,
    UUID
) IS 'Lists viable Checkout V2 reschedule targets without creating reservations or operations.';
