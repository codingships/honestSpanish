-- Inert lineage foundation for Checkout V2 replacement sessions.
-- This migration deliberately provides no write RPC. The insert guard keeps
-- replacement rows impossible until the atomic replacement operation lands.

ALTER TABLE public.sessions
    ADD COLUMN checkout_v2_replaces_session_id UUID UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    ADD COLUMN checkout_v2_replacement_request_id UUID UNIQUE,
    ADD COLUMN checkout_v2_replacement_actor_id UUID
        REFERENCES public.profiles(id) ON DELETE RESTRICT,
    ADD COLUMN checkout_v2_replacement_source_kind TEXT,
    ADD COLUMN checkout_v2_replacement_reason TEXT,
    ADD COLUMN checkout_v2_replacement_credit_adjustment_id UUID UNIQUE
        REFERENCES public.checkout_v2_session_credit_adjustments(id) ON DELETE RESTRICT,
    ADD CONSTRAINT sessions_checkout_v2_replacement_shape_check CHECK (
        (
            checkout_v2_replaces_session_id IS NULL
            AND checkout_v2_replacement_request_id IS NULL
            AND checkout_v2_replacement_actor_id IS NULL
            AND checkout_v2_replacement_source_kind IS NULL
            AND checkout_v2_replacement_reason IS NULL
            AND checkout_v2_replacement_credit_adjustment_id IS NULL
        )
        OR
        (
            checkout_v2_replaces_session_id IS NOT NULL
            AND checkout_v2_replacement_request_id IS NOT NULL
            AND checkout_v2_replacement_actor_id IS NOT NULL
            AND checkout_v2_replacement_source_kind IN (
                'timely_student_cancellation',
                'teacher_cancellation',
                'admin_cancellation',
                'restored_late_student_cancellation',
                'restored_no_show'
            )
            AND checkout_v2_replacement_reason = CASE checkout_v2_replacement_source_kind
                WHEN 'timely_student_cancellation'
                    THEN 'replacement_after_timely_student_cancellation'
                WHEN 'teacher_cancellation'
                    THEN 'replacement_after_teacher_cancellation'
                WHEN 'admin_cancellation'
                    THEN 'replacement_after_admin_cancellation'
                WHEN 'restored_late_student_cancellation'
                    THEN 'replacement_after_restored_late_student_cancellation'
                WHEN 'restored_no_show'
                    THEN 'replacement_after_restored_no_show'
            END
            AND (
                (
                    checkout_v2_replacement_source_kind IN (
                        'restored_late_student_cancellation',
                        'restored_no_show'
                    )
                    AND checkout_v2_replacement_credit_adjustment_id IS NOT NULL
                )
                OR
                (
                    checkout_v2_replacement_source_kind IN (
                        'timely_student_cancellation',
                        'teacher_cancellation',
                        'admin_cancellation'
                    )
                    AND checkout_v2_replacement_credit_adjustment_id IS NULL
                )
            )
        )
    );

DROP INDEX public.sessions_checkout_v2_cycle_position_unique_idx;
CREATE UNIQUE INDEX sessions_checkout_v2_cycle_position_unique_idx
    ON public.sessions(checkout_v2_cycle_id, checkout_v2_cycle_session_index)
    WHERE checkout_v2_cycle_id IS NOT NULL
      AND checkout_v2_replaces_session_id IS NULL;

CREATE INDEX sessions_checkout_v2_replacement_actor_idx
    ON public.sessions(checkout_v2_replacement_actor_id)
    WHERE checkout_v2_replacement_actor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.checkout_v2_effective_cycle_sessions(
    p_cycle_id UUID
)
RETURNS SETOF public.sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE lineage AS (
        SELECT root_session.id, 0 AS replacement_depth
        FROM public.sessions AS root_session
        WHERE root_session.checkout_v2_cycle_id = p_cycle_id
          AND root_session.checkout_v2_replaces_session_id IS NULL

        UNION ALL

        SELECT replacement.id, lineage.replacement_depth + 1
        FROM lineage
        JOIN public.sessions AS replacement
          ON replacement.checkout_v2_replaces_session_id = lineage.id
         AND replacement.checkout_v2_cycle_id = p_cycle_id
    ), effective_ids AS (
        SELECT DISTINCT ON (session_row.checkout_v2_cycle_session_index)
            session_row.id
        FROM lineage
        JOIN public.sessions AS session_row ON session_row.id = lineage.id
        ORDER BY
            session_row.checkout_v2_cycle_session_index,
            lineage.replacement_depth DESC,
            session_row.created_at DESC,
            session_row.id DESC
    )
    SELECT session_row.*
    FROM effective_ids
    JOIN public.sessions AS session_row ON session_row.id = effective_ids.id
    ORDER BY session_row.checkout_v2_cycle_session_index;
END;
$$;

REVOKE ALL ON FUNCTION private.checkout_v2_effective_cycle_sessions(UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.checkout_v2_effective_cycle_sessions(UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_session_replacement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    source_session public.sessions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    adjustment_row public.checkout_v2_session_credit_adjustments%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND ROW(
        NEW.checkout_v2_replaces_session_id,
        NEW.checkout_v2_replacement_request_id,
        NEW.checkout_v2_replacement_actor_id,
        NEW.checkout_v2_replacement_source_kind,
        NEW.checkout_v2_replacement_reason,
        NEW.checkout_v2_replacement_credit_adjustment_id
    ) IS DISTINCT FROM ROW(
        OLD.checkout_v2_replaces_session_id,
        OLD.checkout_v2_replacement_request_id,
        OLD.checkout_v2_replacement_actor_id,
        OLD.checkout_v2_replacement_source_kind,
        OLD.checkout_v2_replacement_reason,
        OLD.checkout_v2_replacement_credit_adjustment_id
    ) THEN
        RAISE EXCEPTION 'checkout_v2_session_replacement_lineage_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_replaces_session_id IS NOT NULL
       AND ROW(
            NEW.subscription_id,
            NEW.student_id,
            NEW.teacher_id,
            NEW.checkout_v2_cycle_id,
            NEW.checkout_v2_cycle_session_index,
            NEW.duration_minutes,
            NEW.created_at
       ) IS DISTINCT FROM ROW(
            OLD.subscription_id,
            OLD.student_id,
            OLD.teacher_id,
            OLD.checkout_v2_cycle_id,
            OLD.checkout_v2_cycle_session_index,
            OLD.duration_minutes,
            OLD.created_at
       ) THEN
        RAISE EXCEPTION 'checkout_v2_session_replacement_identity_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_replaces_session_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO source_session
    FROM public.sessions AS source
    WHERE source.id = NEW.checkout_v2_replaces_session_id;

    IF source_session.id IS NULL
       OR source_session.id = NEW.id
       OR source_session.created_at IS NULL
       OR NEW.created_at IS NULL
       OR source_session.created_at >= NEW.created_at
       OR source_session.subscription_id IS DISTINCT FROM NEW.subscription_id
       OR source_session.student_id IS DISTINCT FROM NEW.student_id
       OR source_session.teacher_id IS DISTINCT FROM NEW.teacher_id
       OR source_session.checkout_v2_cycle_id IS DISTINCT FROM NEW.checkout_v2_cycle_id
       OR source_session.checkout_v2_cycle_session_index IS DISTINCT FROM NEW.checkout_v2_cycle_session_index
       OR source_session.duration_minutes IS DISTINCT FROM NEW.duration_minutes THEN
        RAISE EXCEPTION 'checkout_v2_session_replacement_source_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state AS billing
    WHERE billing.subscription_id = NEW.subscription_id;

    IF billing_row.subscription_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_session_replacement_billing_state_is_missing'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_cycle_session_index = 1
       AND billing_row.anchor_state = 'provisional' THEN
        RAISE EXCEPTION 'checkout_v2_provisional_first_session_cannot_be_replaced'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_replacement_credit_adjustment_id IS NOT NULL THEN
        SELECT * INTO adjustment_row
        FROM public.checkout_v2_session_credit_adjustments AS adjustment
        WHERE adjustment.id = NEW.checkout_v2_replacement_credit_adjustment_id;

        IF adjustment_row.id IS NULL
           OR adjustment_row.session_id IS DISTINCT FROM source_session.id
           OR adjustment_row.subscription_id IS DISTINCT FROM NEW.subscription_id
           OR adjustment_row.cycle_id IS DISTINCT FROM NEW.checkout_v2_cycle_id
           OR adjustment_row.session_index IS DISTINCT FROM NEW.checkout_v2_cycle_session_index THEN
            RAISE EXCEPTION 'checkout_v2_session_replacement_credit_adjustment_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NOT (
        (
            NEW.checkout_v2_replacement_source_kind = 'timely_student_cancellation'
            AND source_session.status = 'cancelled'
            AND source_session.cancelled_by = source_session.student_id
            AND source_session.cancelled_at IS NOT NULL
            AND source_session.scheduled_at >= source_session.cancelled_at + INTERVAL '24 hours'
        )
        OR (
            NEW.checkout_v2_replacement_source_kind = 'teacher_cancellation'
            AND source_session.status = 'cancelled'
            AND source_session.cancelled_by = source_session.teacher_id
        )
        OR (
            NEW.checkout_v2_replacement_source_kind = 'admin_cancellation'
            AND source_session.status = 'cancelled'
            AND source_session.cancelled_by = NEW.checkout_v2_replacement_actor_id
            AND EXISTS (
                SELECT 1 FROM public.profiles AS actor
                WHERE actor.id = NEW.checkout_v2_replacement_actor_id
                  AND actor.role = 'admin'::public.user_role
            )
        )
        OR (
            NEW.checkout_v2_replacement_source_kind = 'restored_late_student_cancellation'
            AND source_session.status = 'cancelled'
            AND source_session.cancelled_by = source_session.student_id
            AND source_session.cancelled_at IS NOT NULL
            AND source_session.scheduled_at < source_session.cancelled_at + INTERVAL '24 hours'
            AND adjustment_row.id IS NOT NULL
        )
        OR (
            NEW.checkout_v2_replacement_source_kind = 'restored_no_show'
            AND source_session.status = 'no_show'
            AND source_session.no_show_at IS NOT NULL
            AND adjustment_row.id IS NOT NULL
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_session_replacement_source_kind_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    -- PR 1 is intentionally inert. PR 2 replaces this final gate with the
    -- transactional replacement RPC and its unforgeable provenance check.
    RAISE EXCEPTION 'checkout_v2_session_replacement_insert_is_not_enabled'
        USING ERRCODE = '0A000';
END;
$$;

CREATE TRIGGER aa_guard_checkout_v2_session_replacement_trigger
    BEFORE INSERT OR UPDATE OF
        subscription_id,
        student_id,
        teacher_id,
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index,
        duration_minutes,
        created_at,
        checkout_v2_replaces_session_id,
        checkout_v2_replacement_request_id,
        checkout_v2_replacement_actor_id,
        checkout_v2_replacement_source_kind,
        checkout_v2_replacement_reason,
        checkout_v2_replacement_credit_adjustment_id
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_session_replacement();

REVOKE ALL ON FUNCTION private.guard_checkout_v2_session_replacement()
    FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.checkout_v2_effective_cycle_sessions(UUID) IS
    'Returns exactly one effective leaf per materialized Checkout V2 cycle position; private schema and service-role only.';
COMMENT ON COLUMN public.sessions.checkout_v2_replaces_session_id IS
    'Immediate predecessor in an immutable Checkout V2 replacement chain. Inserts remain disabled until the atomic replacement RPC lands.';
COMMENT ON COLUMN public.sessions.checkout_v2_replacement_reason IS
    'Participant-safe closed reason code only. Detail belongs in a future admin-only audit record.';


CREATE OR REPLACE VIEW public.checkout_v2_cycle_progress
WITH (security_invoker = true)
AS
WITH cycle_facts AS (
    SELECT
        cycle.id AS cycle_id,
        cycle.subscription_id,
        subscription.student_id,
        cycle.cycle_number,
        cycle.cycle_kind,
        cycle.starts_at,
        cycle.ends_at,
        cycle.materialization_state,
        cycle.sessions_materialized_at,
        cycle.sessions_total,
        count(consumption.session_id)::INTEGER AS sessions_materialized,
        count(DISTINCT consumption.session_index)::INTEGER AS positions_materialized,
        count(*) FILTER (WHERE consumption.session_status = 'scheduled')::INTEGER AS sessions_scheduled,
        count(*) FILTER (WHERE consumption.session_status = 'completed')::INTEGER AS sessions_completed,
        count(*) FILTER (WHERE consumption.session_status = 'no_show')::INTEGER AS sessions_no_show,
        count(*) FILTER (WHERE consumption.original_consumption_kind = 'late_student_cancellation')::INTEGER
            AS sessions_late_student_cancelled,
        count(*) FILTER (WHERE consumption.credit_restored)::INTEGER AS sessions_restored,
        count(*) FILTER (WHERE consumption.student_credit_consumed)::INTEGER AS sessions_consumed
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription ON subscription.id = cycle.subscription_id
    LEFT JOIN public.checkout_v2_session_consumption AS consumption ON consumption.cycle_id = cycle.id
    GROUP BY cycle.id, subscription.student_id
), classified AS (
    SELECT cycle_facts.*, CASE
        WHEN materialization_state = 'pending' AND sessions_materialized = 0 THEN 'pending'
        WHEN materialization_state = 'ready'
             AND sessions_materialized = sessions_total
             AND positions_materialized = sessions_total THEN 'ready'
        ELSE 'inconsistent'
    END AS progress_state
    FROM cycle_facts
)
SELECT
    cycle_id, subscription_id, student_id, cycle_number, cycle_kind,
    starts_at, ends_at, materialization_state, sessions_materialized_at,
    sessions_total, sessions_materialized,
    CASE WHEN progress_state = 'ready' THEN sessions_scheduled END AS sessions_scheduled,
    CASE WHEN progress_state = 'ready' THEN sessions_completed END AS sessions_completed,
    CASE WHEN progress_state = 'ready' THEN sessions_no_show END AS sessions_no_show,
    CASE WHEN progress_state = 'ready' THEN sessions_late_student_cancelled END
        AS sessions_late_student_cancelled,
    CASE WHEN progress_state = 'ready' THEN sessions_restored END AS sessions_restored,
    CASE WHEN progress_state = 'ready' THEN sessions_consumed END AS sessions_consumed,
    CASE WHEN progress_state = 'ready' THEN sessions_total - sessions_consumed END
        AS sessions_remaining,
    progress_state
FROM classified;

REVOKE ALL ON TABLE public.checkout_v2_session_consumption,
    public.checkout_v2_cycle_progress FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.checkout_v2_session_consumption,
    public.checkout_v2_cycle_progress TO service_role;

COMMENT ON VIEW public.checkout_v2_session_consumption IS
    'One effective Checkout V2 session leaf per paid cycle position; historical roots remain immutable and queryable on sessions.';
COMMENT ON VIEW public.checkout_v2_cycle_progress IS
    'Checkout V2 cycle progress projected from exactly four effective session positions.';


-- Preserve the restored incident across a replacement chain. The effective
-- leaf owns current consumption; an adjustment on that same leaf still means
-- restored/not consumed until a descendant actually consumes the position.
CREATE OR REPLACE VIEW public.checkout_v2_session_consumption
WITH (security_invoker = true)
AS
SELECT
    session.id AS session_id,
    session.subscription_id,
    session.checkout_v2_cycle_id AS cycle_id,
    cycle.cycle_number,
    session.checkout_v2_cycle_session_index AS session_index,
    session.status AS session_status,
    session.scheduled_at,
    session.completed_at,
    session.no_show_at,
    session.cancelled_at,
    session.cancelled_by,
    session.cancellation_reason,
    CASE
        WHEN guarantee_operation.id IS NOT NULL THEN 'guarantee_refund_cancellation'
        WHEN COALESCE(incident.status, session.status) = 'completed' THEN 'completed'
        WHEN COALESCE(incident.status, session.status) = 'no_show' THEN 'no_show'
        WHEN COALESCE(incident.status, session.status) = 'cancelled'
             AND COALESCE(incident.cancelled_by, session.cancelled_by)
                 = COALESCE(incident.student_id, session.student_id)
             AND COALESCE(incident.scheduled_at, session.scheduled_at)
                 < COALESCE(incident.cancelled_at, session.cancelled_at) + INTERVAL '24 hours'
            THEN 'late_student_cancellation'
        WHEN COALESCE(incident.status, session.status) = 'cancelled'
             AND COALESCE(incident.cancelled_by, session.cancelled_by)
                 = COALESCE(incident.student_id, session.student_id)
            THEN 'timely_student_cancellation'
        WHEN COALESCE(incident.status, session.status) = 'cancelled'
            THEN 'non_student_cancellation'
        ELSE 'scheduled'
    END AS original_consumption_kind,
    guarantee_operation.id IS NULL AND (
        COALESCE(incident.status, session.status) IN ('completed', 'no_show') OR (
            COALESCE(incident.status, session.status) = 'cancelled'
            AND COALESCE(incident.cancelled_by, session.cancelled_by)
                = COALESCE(incident.student_id, session.student_id)
            AND COALESCE(incident.scheduled_at, session.scheduled_at)
                < COALESCE(incident.cancelled_at, session.cancelled_at) + INTERVAL '24 hours'
        )
    ) AS original_student_credit_consumed,
    adjustment.id AS credit_adjustment_id,
    adjustment.request_id AS credit_adjustment_request_id,
    adjustment.created_at AS credit_restored_at,
    adjustment.id IS NOT NULL AS credit_restored,
    guarantee_operation.id IS NULL AND (
        session.status IN ('completed', 'no_show') OR (
            session.status = 'cancelled'
            AND session.cancelled_by = session.student_id
            AND session.scheduled_at < session.cancelled_at + INTERVAL '24 hours'
        )
    ) AND NOT (
        adjustment.id IS NOT NULL
        AND adjustment.session_id = session.id
    ) AS student_credit_consumed,
    CASE
        WHEN guarantee_operation.id IS NOT NULL THEN 'guarantee_refund_cancellation'
        WHEN adjustment.id IS NOT NULL
             AND adjustment.session_id = session.id
             AND session.status = 'no_show' THEN 'restored_no_show'
        WHEN adjustment.id IS NOT NULL
             AND adjustment.session_id = session.id
            THEN 'restored_late_student_cancellation'
        WHEN session.status = 'completed' THEN 'completed'
        WHEN session.status = 'no_show' THEN 'no_show'
        WHEN session.status = 'cancelled' AND session.cancelled_by = session.student_id
             AND session.scheduled_at < session.cancelled_at + INTERVAL '24 hours'
            THEN 'late_student_cancellation'
        WHEN session.status = 'cancelled' AND session.cancelled_by = session.student_id
            THEN 'timely_student_cancellation'
        WHEN session.status = 'cancelled' THEN 'non_student_cancellation'
        ELSE 'scheduled'
    END AS consumption_kind
FROM public.checkout_v2_cycles AS cycle
CROSS JOIN LATERAL private.checkout_v2_effective_cycle_sessions(cycle.id) AS session
LEFT JOIN LATERAL (
    WITH RECURSIVE ancestry AS (
        SELECT
            session.id,
            session.checkout_v2_replaces_session_id,
            session.checkout_v2_replacement_credit_adjustment_id,
            0 AS ancestor_depth

        UNION ALL

        SELECT
            predecessor.id,
            predecessor.checkout_v2_replaces_session_id,
            predecessor.checkout_v2_replacement_credit_adjustment_id,
            ancestry.ancestor_depth + 1
        FROM ancestry
        JOIN public.sessions AS predecessor
          ON predecessor.id = ancestry.checkout_v2_replaces_session_id
    )
    SELECT adjustment_row.*
    FROM ancestry
    JOIN public.checkout_v2_session_credit_adjustments AS adjustment_row
      ON adjustment_row.id = ancestry.checkout_v2_replacement_credit_adjustment_id
      OR adjustment_row.session_id = ancestry.id
    ORDER BY
        (adjustment_row.id = ancestry.checkout_v2_replacement_credit_adjustment_id) DESC,
        ancestry.ancestor_depth ASC,
        adjustment_row.created_at DESC,
        adjustment_row.id DESC
    LIMIT 1
) AS adjustment ON TRUE
LEFT JOIN public.sessions AS predecessor
  ON predecessor.id = session.checkout_v2_replaces_session_id
LEFT JOIN public.sessions AS incident
  ON incident.id = COALESCE(adjustment.session_id, predecessor.id)
LEFT JOIN public.checkout_v2_guarantee_operations AS guarantee_operation
  ON guarantee_operation.subscription_id = session.subscription_id
 AND guarantee_operation.cycle_id = session.checkout_v2_cycle_id
 AND guarantee_operation.actor_id = session.student_id
 AND guarantee_operation.terminated_at IS NOT NULL
 AND session.id IN (
        guarantee_operation.second_session_id,
        guarantee_operation.third_session_id,
        guarantee_operation.fourth_session_id
 );

-- Root-aware lifecycle invariants. Replacements remain disabled, so these
-- definitions are observationally identical for all pre-migration data.

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_cycle_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    expected_local_date DATE;
    expected_scheduled_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = NEW.subscription_id;

    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_cycle_id IS NOT NULL
       AND NEW.checkout_v2_cycle_id IS DISTINCT FROM OLD.checkout_v2_cycle_id THEN
        RAISE EXCEPTION 'checkout_v2_cycle_binding_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'sessions'
       AND subscription_row.contract_schema_version = 2
       AND NEW.checkout_v2_cycle_id IS NULL
       AND EXISTS (
            SELECT 1
            FROM public.checkout_v2_billing_state AS existing_billing
            WHERE existing_billing.subscription_id = NEW.subscription_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_session_requires_cycle'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_cycle_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE id = NEW.checkout_v2_cycle_id;

    IF cycle_row.id IS NULL
       OR cycle_row.subscription_id IS DISTINCT FROM NEW.subscription_id
       OR (
            TG_TABLE_NAME = 'payments'
            AND cycle_row.payment_id IS DISTINCT FROM NEW.id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_subscription_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'sessions' THEN
      IF NEW.checkout_v2_replaces_session_id IS NULL
         AND cycle_row.materialization_state = 'pending' THEN
        SELECT * INTO billing_row
        FROM public.checkout_v2_billing_state
        WHERE subscription_id = NEW.subscription_id;

        SELECT * INTO allocation_row
        FROM public.checkout_v2_weekly_allocations
        WHERE subscription_id = NEW.subscription_id
          AND status = 'active';

        IF cycle_row.cycle_kind IS DISTINCT FROM 'renewal'
           OR subscription_row.status IS DISTINCT FROM 'active'::public.subscription_status
           OR billing_row.subscription_id IS NULL
           OR billing_row.anchor_state IS DISTINCT FROM 'fixed'
           OR allocation_row.id IS NULL
           OR NEW.checkout_v2_cycle_session_index IS NULL THEN
            RAISE EXCEPTION 'checkout_v2_pending_cycle_session_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        expected_local_date :=
            (billing_row.first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
            + ((cycle_row.cycle_number - 1) * 28)
            + ((NEW.checkout_v2_cycle_session_index - 1) * 7);
        expected_scheduled_at :=
            (expected_local_date + allocation_row.local_start_time)
            AT TIME ZONE allocation_row.timezone_name;

        IF NEW.student_id IS DISTINCT FROM subscription_row.student_id
           OR NEW.teacher_id IS DISTINCT FROM allocation_row.teacher_id
           OR NEW.scheduled_at IS DISTINCT FROM expected_scheduled_at
           OR NEW.duration_minutes IS DISTINCT FROM allocation_row.duration_minutes::INTEGER
           OR NEW.status IS DISTINCT FROM 'scheduled' THEN
            RAISE EXCEPTION 'checkout_v2_pending_cycle_session_is_invalid'
                USING ERRCODE = '23514';
        END IF;
      END IF;
    END IF;

    RETURN NEW;
END;
$$;

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
    WHERE session_row.checkout_v2_cycle_id = cycle_row.id
      AND session_row.checkout_v2_replaces_session_id IS NULL;

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

CREATE OR REPLACE FUNCTION private.ensure_teacher_compensation_cycle_terms(
    p_cycle_id UUID
)
RETURNS public.teacher_compensation_cycle_terms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    policy_row public.teacher_compensation_policy_versions%ROWTYPE;
    milestone_row public.teacher_compensation_milestones%ROWTYPE;
    trigger_cycle_row public.checkout_v2_cycles%ROWTYPE;
    terms_row public.teacher_compensation_cycle_terms%ROWTYPE;
    session_count INTEGER;
    active_student_count INTEGER;
    raised_by_ten BOOLEAN := FALSE;
    raised_by_days BOOLEAN := FALSE;
    ten_effective_at TIMESTAMPTZ;
    ninety_effective_at TIMESTAMPTZ;
    rate_basis TEXT := 'initial';
    threshold_effective_at TIMESTAMPTZ := NULL;
    external_rate INTEGER;
BEGIN
    IF p_cycle_id IS NULL THEN
        RETURN NULL;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('teacher-compensation-policy-v1', 58131)
    );

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE id = p_cycle_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = cycle_row.subscription_id;
    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = cycle_row.payment_id;
    SELECT COUNT(*) INTO session_count
    FROM public.sessions
    WHERE checkout_v2_cycle_id = cycle_row.id
      AND checkout_v2_replaces_session_id IS NULL
      AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
      AND teacher_id IS NOT NULL
      AND student_id = subscription_row.student_id
      AND subscription_id = subscription_row.id;

    IF session_count < 4 THEN
        RETURN NULL;
    END IF;

    IF session_count <> 4
       OR subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.checkout_v2_cycle_id IS NOT NULL
            AND payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM cycle_row.amount_cents
       OR lower(payment_row.currency) IS DISTINCT FROM cycle_row.currency
       OR cycle_row.amount_cents IS DISTINCT FROM 25900
       OR cycle_row.currency IS DISTINCT FROM 'eur' THEN
        RAISE EXCEPTION 'teacher_compensation_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    SELECT * INTO policy_row
    FROM public.teacher_compensation_policy_versions
    WHERE version = 1;
    SELECT * INTO milestone_row
    FROM public.teacher_compensation_milestones
    WHERE policy_version = 1
    FOR UPDATE;

    IF policy_row.version IS NULL OR milestone_row.policy_version IS NULL THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;
    IF milestone_row.ten_active_history_state = 'requires_confirmation' THEN
        RAISE EXCEPTION 'teacher_compensation_precondition_missing'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO terms_row
    FROM public.teacher_compensation_cycle_terms
    WHERE cycle_id = cycle_row.id
    FOR UPDATE;
    IF FOUND THEN
        IF terms_row.policy_version IS DISTINCT FROM policy_row.version
           OR terms_row.founder_class_rate_cents IS DISTINCT FROM policy_row.founder_class_rate_cents
           OR terms_row.external_class_rate_cents NOT IN (
                policy_row.external_initial_class_rate_cents,
                policy_row.external_raised_class_rate_cents
           )
           OR terms_row.currency IS DISTINCT FROM policy_row.currency THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN terms_row;
    END IF;

    SELECT COUNT(DISTINCT active_subscription.student_id)::INTEGER
    INTO active_student_count
    FROM public.subscriptions AS active_subscription
    JOIN public.checkout_v2_cycles AS initial_cycle
      ON initial_cycle.subscription_id = active_subscription.id
     AND initial_cycle.cycle_number = 1
     AND initial_cycle.cycle_kind = 'initial'
     AND initial_cycle.materialization_state = 'ready'
    WHERE active_subscription.contract_schema_version = 2
      AND active_subscription.status = 'active'::public.subscription_status;

    active_student_count := COALESCE(active_student_count, 0);

    IF milestone_row.ten_active_trigger_cycle_id IS NOT NULL THEN
        SELECT * INTO trigger_cycle_row
        FROM public.checkout_v2_cycles
        WHERE id = milestone_row.ten_active_trigger_cycle_id;
        IF trigger_cycle_row.id IS NULL THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
        -- A live milestone is serialized after its trigger cycle terms. Any
        -- subsequently snapshotted cycle is therefore economically later even
        -- when application timestamps tie (or UUID ordering points backwards).
        -- Historical confirmations lack that live ordering proof and retain the
        -- deterministic (created_at, id) chronology used during reconciliation.
        IF milestone_row.ten_active_history_confirmation IS NULL
           AND EXISTS (
                SELECT 1 FROM public.teacher_compensation_cycle_terms
                WHERE cycle_id = milestone_row.ten_active_trigger_cycle_id
           ) THEN
            raised_by_ten := TRUE;
        ELSE
            raised_by_ten := ROW(cycle_row.created_at, cycle_row.id)
                > ROW(trigger_cycle_row.created_at, trigger_cycle_row.id);
        END IF;
        ten_effective_at := milestone_row.ten_active_reached_at;
    END IF;

    IF milestone_row.first_ready_initial_at IS NOT NULL THEN
        ninety_effective_at := milestone_row.first_ready_initial_at
            + make_interval(days => policy_row.elapsed_day_threshold);
        raised_by_days := cycle_row.created_at >= ninety_effective_at;
    END IF;

    IF raised_by_ten AND raised_by_days THEN
        IF ten_effective_at <= ninety_effective_at THEN
            rate_basis := 'ten_active';
            threshold_effective_at := ten_effective_at;
        ELSE
            rate_basis := 'ninety_days';
            threshold_effective_at := ninety_effective_at;
        END IF;
    ELSIF raised_by_ten THEN
        rate_basis := 'ten_active';
        threshold_effective_at := ten_effective_at;
    ELSIF raised_by_days THEN
        rate_basis := 'ninety_days';
        threshold_effective_at := ninety_effective_at;
    END IF;

    external_rate := CASE
        WHEN rate_basis = 'initial' THEN policy_row.external_initial_class_rate_cents
        ELSE policy_row.external_raised_class_rate_cents
    END;

    INSERT INTO public.teacher_compensation_cycle_terms (
        cycle_id,
        policy_version,
        founder_class_rate_cents,
        external_class_rate_cents,
        currency,
        rate_basis,
        threshold_effective_at,
        active_students_observed
    ) VALUES (
        cycle_row.id,
        policy_row.version,
        policy_row.founder_class_rate_cents,
        external_rate,
        policy_row.currency,
        rate_basis,
        threshold_effective_at,
        active_student_count
    ) RETURNING * INTO terms_row;

    IF cycle_row.cycle_kind = 'initial'
       AND cycle_row.cycle_number = 1
       AND cycle_row.materialization_state = 'ready' THEN
        PERFORM set_config('app.teacher_compensation_milestone_write', 'on', TRUE);

        IF milestone_row.first_ready_initial_cycle_id IS NULL THEN
            UPDATE public.teacher_compensation_milestones
            SET first_ready_initial_cycle_id = cycle_row.id,
                first_ready_initial_at = cycle_row.created_at,
                updated_at = date_trunc('second', clock_timestamp())
            WHERE policy_version = 1
            RETURNING * INTO milestone_row;
        ELSIF ROW(cycle_row.created_at, cycle_row.id)
                < ROW(milestone_row.first_ready_initial_at,
                    milestone_row.first_ready_initial_cycle_id) THEN
            RAISE EXCEPTION 'teacher_compensation_state_conflicts'
                USING ERRCODE = '40001';
        END IF;

    END IF;

    -- A renewal can be the first serialized observation of ten active students
    -- after reactivation or historical recovery. It keeps the prior rate because
    -- the milestone is persisted only after this cycle's terms are immutable.
    IF milestone_row.ten_active_trigger_cycle_id IS NULL
       AND active_student_count >= policy_row.active_student_threshold THEN
        IF EXISTS (
            SELECT 1
            FROM public.subscriptions AS historical_subscription
            JOIN public.checkout_v2_cycles AS historical_cycle
              ON historical_cycle.subscription_id = historical_subscription.id
             AND historical_cycle.materialization_state = 'ready'
            LEFT JOIN public.teacher_compensation_cycle_terms AS historical_terms
              ON historical_terms.cycle_id = historical_cycle.id
            WHERE historical_subscription.contract_schema_version = 2
              AND historical_terms.cycle_id IS NULL
        ) THEN
            RAISE EXCEPTION 'teacher_compensation_precondition_missing'
                USING ERRCODE = '55000';
        END IF;
        PERFORM set_config('app.teacher_compensation_milestone_write', 'on', TRUE);
        UPDATE public.teacher_compensation_milestones
        SET ten_active_trigger_cycle_id = cycle_row.id,
            ten_active_reached_at = cycle_row.created_at,
            ten_active_students_count = active_student_count::SMALLINT,
            updated_at = date_trunc('second', clock_timestamp())
        WHERE policy_version = 1;
    END IF;

    RETURN terms_row;
END;
$$;

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
         AND first_session.checkout_v2_replaces_session_id IS NULL
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
              AND first_session.checkout_v2_replaces_session_id IS NULL
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

-- Effective-leaf-aware guarantee and rescheduling reads. Existing row locks
-- continue to lock the complete cycle lineage deterministically.

CREATE OR REPLACE FUNCTION private.lock_checkout_v2_guarantee_operation(
    p_operation_id UUID
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations AS guarantee_operation
    WHERE guarantee_operation.id = p_operation_id;

    IF operation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_operation_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(operation_row.subscription_id::TEXT, 42854)
    );

    PERFORM 1 FROM public.subscriptions AS subscription
    WHERE subscription.id = operation_row.subscription_id FOR UPDATE;
    PERFORM 1 FROM public.checkout_v2_billing_state AS billing_state
    WHERE billing_state.subscription_id = operation_row.subscription_id FOR UPDATE;
    PERFORM 1 FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.id = operation_row.cycle_id FOR UPDATE;
    PERFORM 1 FROM public.payments AS payment
    WHERE payment.id = operation_row.payment_id FOR UPDATE;
    PERFORM 1
    FROM public.sessions
    WHERE checkout_v2_cycle_id = operation_row.cycle_id
    ORDER BY checkout_v2_cycle_session_index, created_at, id
    FOR UPDATE;

    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations AS guarantee_operation
    WHERE guarantee_operation.id = p_operation_id
    FOR UPDATE;

    RETURN operation_row;
END;
$$;

CREATE OR REPLACE FUNCTION private.evaluate_checkout_v2_guarantee(
    p_subscription_id UUID,
    p_actor_id UUID,
    p_lock_rows BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    eligibility_state TEXT,
    eligibility_reason TEXT,
    subscription_id UUID,
    cycle_id UUID,
    payment_id UUID,
    first_session_id UUID,
    second_session_id UUID,
    third_session_id UUID,
    fourth_session_id UUID,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_invoice_id TEXT,
    stripe_payment_intent_id TEXT,
    gross_amount_cents INTEGER,
    refund_amount_cents INTEGER,
    currency TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    evaluated_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    actor_role public.user_role;
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    first_session public.sessions%ROWTYPE;
    second_session public.sessions%ROWTYPE;
    third_session public.sessions%ROWTYPE;
    fourth_session public.sessions%ROWTYPE;
    intent_row public.checkout_intents%ROWTYPE;
    price_snapshot public.checkout_v2_price_snapshots%ROWTYPE;
    second_excused BOOLEAN := FALSE;
    third_consumed BOOLEAN := TRUE;
    fourth_consumed BOOLEAN := TRUE;
BEGIN
    IF p_subscription_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_request'
            USING ERRCODE = '22023';
    END IF;

    SELECT role INTO actor_role
    FROM public.profiles
    WHERE id = p_actor_id;

    IF p_lock_rows THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_subscription_id::TEXT, 42854)
        );
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = p_subscription_id
        FOR UPDATE;
    ELSE
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = p_subscription_id;
    END IF;

    IF subscription_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF actor_role IS NULL
       OR NOT (
            actor_role = 'admin'::public.user_role
            OR (
                actor_role = 'student'::public.user_role
                AND p_actor_id = subscription_row.student_id
            )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF p_lock_rows THEN
        SELECT * INTO billing_row
        FROM public.checkout_v2_billing_state AS billing_state
        WHERE billing_state.subscription_id = p_subscription_id
        FOR UPDATE;

        SELECT * INTO cycle_row
        FROM public.checkout_v2_cycles AS cycle
        WHERE cycle.subscription_id = p_subscription_id
          AND cycle.cycle_number = 1
        FOR UPDATE;

        IF cycle_row.id IS NOT NULL THEN
            SELECT * INTO payment_row
            FROM public.payments
            WHERE id = cycle_row.payment_id
            FOR UPDATE;

            SELECT * INTO first_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 1;
            SELECT * INTO second_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 2;
            SELECT * INTO third_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 3;
            SELECT * INTO fourth_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 4;
        END IF;
    ELSE
        SELECT * INTO billing_row
        FROM public.checkout_v2_billing_state AS billing_state
        WHERE billing_state.subscription_id = p_subscription_id;

        SELECT * INTO cycle_row
        FROM public.checkout_v2_cycles AS cycle
        WHERE cycle.subscription_id = p_subscription_id
          AND cycle.cycle_number = 1;

        IF cycle_row.id IS NOT NULL THEN
            SELECT * INTO payment_row
            FROM public.payments
            WHERE id = cycle_row.payment_id;
            SELECT * INTO first_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 1;
            SELECT * INTO second_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 2;
            SELECT * INTO third_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 3;
            SELECT * INTO fourth_session
            FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id)
            WHERE checkout_v2_cycle_session_index = 4;
        END IF;
    END IF;

    IF subscription_row.checkout_intent_id IS NOT NULL THEN
        SELECT * INTO intent_row
        FROM public.checkout_intents
        WHERE id = subscription_row.checkout_intent_id;
    END IF;

    IF subscription_row.package_price_id IS NOT NULL THEN
        SELECT * INTO price_snapshot
        FROM public.checkout_v2_price_snapshots
        WHERE package_price_id = subscription_row.package_price_id;
    END IF;

    subscription_id := subscription_row.id;
    cycle_id := cycle_row.id;
    payment_id := payment_row.id;
    first_session_id := first_session.id;
    second_session_id := second_session.id;
    third_session_id := third_session.id;
    fourth_session_id := fourth_session.id;
    stripe_customer_id := intent_row.stripe_customer_id;
    stripe_subscription_id := subscription_row.stripe_subscription_id;
    stripe_invoice_id := payment_row.stripe_invoice_id;
    stripe_payment_intent_id := payment_row.stripe_payment_intent_id;
    gross_amount_cents := price_snapshot.initial_amount_cents;
    refund_amount_cents := CASE
        WHEN price_snapshot.initial_amount_cents IS NOT NULL
         AND price_snapshot.initial_amount_cents % 4 = 0
        THEN price_snapshot.initial_amount_cents / 4 * 3
        ELSE NULL
    END;
    currency := lower(price_snapshot.currency);

    IF subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'subscription_not_active';
        RETURN NEXT;
        RETURN;
    END IF;

    IF billing_row.subscription_id IS NULL
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_kind IS DISTINCT FROM 'initial'
       OR cycle_row.materialization_state IS DISTINCT FROM 'ready'
       OR cycle_row.sessions_materialized_at IS NULL
       OR billing_row.first_session_id IS DISTINCT FROM first_session.id
       OR payment_row.id IS NULL
       OR intent_row.id IS NULL
       OR intent_row.status IS DISTINCT FROM 'completed'
       OR intent_row.student_id IS DISTINCT FROM subscription_row.student_id
       OR intent_row.package_price_id IS DISTINCT FROM subscription_row.package_price_id
       OR intent_row.stripe_customer_id IS NULL
       OR price_snapshot.package_price_id IS NULL
       OR price_snapshot.initial_amount_cents IS DISTINCT FROM 25900
       OR price_snapshot.initial_amount_cents % 4 <> 0
       OR refund_amount_cents IS DISTINCT FROM 19425
       OR lower(price_snapshot.currency) IS DISTINCT FROM 'eur'
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM cycle_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM 25900
       OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
       OR payment_row.amount_refunded IS DISTINCT FROM 0
       OR payment_row.stripe_invoice_id IS DISTINCT FROM cycle_row.stripe_invoice_id
       OR payment_row.stripe_invoice_id IS DISTINCT FROM subscription_row.stripe_invoice_id
       OR payment_row.stripe_payment_intent_id IS NULL
       OR subscription_row.stripe_subscription_id IS NULL
       OR first_session.id IS NULL
       OR second_session.id IS NULL
       OR third_session.id IS NULL
       OR fourth_session.id IS NULL THEN
        eligibility_state := 'closed';
        eligibility_reason := 'contract_snapshot_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles AS renewal_cycle
        WHERE renewal_cycle.subscription_id = p_subscription_id
          AND renewal_cycle.cycle_number > 1
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'renewal_already_exists';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.payments AS later_payment
        WHERE later_payment.subscription_id = p_subscription_id
          AND later_payment.id IS DISTINCT FROM payment_row.id
          AND (
                later_payment.status IN (
                    'succeeded'::public.payment_status,
                    'pending'::public.payment_status,
                    'refunded'::public.payment_status
                )
                OR later_payment.amount_refunded > 0
                OR later_payment.stripe_refund_id IS NOT NULL
          )
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'renewal_payment_exists';
        RETURN NEXT;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS reschedule_operation
        WHERE reschedule_operation.subscription_id = p_subscription_id
          AND reschedule_operation.status IN ('requested', 'manual_review')
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := 'reschedule_pending';
        RETURN NEXT;
        RETURN;
    END IF;

    IF first_session.status = 'scheduled'
       AND first_session.scheduled_at IS NOT NULL
       AND evaluated_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes) THEN
        eligibility_state := 'not_started';
        eligibility_reason := 'first_class_not_completed';
        RETURN NEXT;
        RETURN;
    END IF;

    IF first_session.status IS DISTINCT FROM 'completed'
       OR first_session.scheduled_at IS NULL
       OR first_session.completed_at IS NULL
       OR first_session.completed_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes)
       OR evaluated_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes)
       OR first_session.completed_at > evaluated_at THEN
        eligibility_state := 'closed';
        eligibility_reason := 'first_class_completion_invalid';
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.checkout_v2_session_incident_resolutions AS resolution_row
        WHERE resolution_row.session_id = second_session.id
          AND resolution_row.subscription_id = subscription_row.id
          AND resolution_row.cycle_id = cycle_row.id
          AND resolution_row.session_index = 2
          AND resolution_row.resolution = 'excused'
    ) INTO second_excused;

    IF NOT (
        (
            second_session.status = 'scheduled'
            AND second_session.scheduled_at IS NOT NULL
            AND evaluated_at < second_session.scheduled_at
        )
        OR (
            second_session.status IN ('cancelled', 'no_show')
            AND second_excused
        )
    ) THEN
        eligibility_state := 'closed';
        eligibility_reason := CASE
            WHEN second_session.status = 'cancelled'
             AND second_session.cancelled_at IS NOT NULL
             AND second_session.cancelled_by = second_session.student_id
             AND second_session.scheduled_at < second_session.cancelled_at + INTERVAL '24 hours'
                THEN 'second_class_late_cancellation'
            WHEN second_session.status = 'no_show'
                THEN 'second_class_no_show'
            WHEN second_session.status = 'cancelled'
                THEN 'second_class_cancellation_requires_support'
            ELSE 'second_class_started_or_consumed'
        END;
        RETURN NEXT;
        RETURN;
    END IF;

    third_consumed := NOT (
        third_session.status = 'scheduled'
        OR (
            third_session.status = 'cancelled'
            AND third_session.cancelled_at IS NOT NULL
            AND (
                third_session.cancelled_by IS DISTINCT FROM third_session.student_id
                OR third_session.scheduled_at >= third_session.cancelled_at + INTERVAL '24 hours'
            )
        )
    );
    fourth_consumed := NOT (
        fourth_session.status = 'scheduled'
        OR (
            fourth_session.status = 'cancelled'
            AND fourth_session.cancelled_at IS NOT NULL
            AND (
                fourth_session.cancelled_by IS DISTINCT FROM fourth_session.student_id
                OR fourth_session.scheduled_at >= fourth_session.cancelled_at + INTERVAL '24 hours'
            )
        )
    );

    IF third_consumed OR fourth_consumed THEN
        eligibility_state := 'closed';
        eligibility_reason := 'remaining_class_consumed';
        RETURN NEXT;
        RETURN;
    END IF;

    eligibility_state := 'eligible';
    eligibility_reason := 'eligible';
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_checkout_v2_guarantee_termination(
    p_operation_id UUID,
    p_worker_token UUID,
    p_stripe_cancelled_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_guarantee_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    first_session public.sessions%ROWTYPE;
    target_session public.sessions%ROWTYPE;
    applied_at TIMESTAMPTZ := date_trunc('second', clock_timestamp());
    job_payload JSONB;
    job_row public.fulfillment_jobs%ROWTYPE;
BEGIN
    IF p_operation_id IS NULL
       OR p_worker_token IS NULL
       OR p_stripe_cancelled_at IS NULL
       OR NOT pg_catalog.isfinite(p_stripe_cancelled_at)
       OR date_trunc('second', p_stripe_cancelled_at) IS DISTINCT FROM p_stripe_cancelled_at THEN
        RAISE EXCEPTION 'invalid_checkout_v2_guarantee_termination'
            USING ERRCODE = '22023';
    END IF;

    operation_row := private.lock_checkout_v2_guarantee_operation(p_operation_id);

    IF operation_row.terminated_at IS NOT NULL THEN
        RETURN operation_row;
    END IF;

    IF operation_row.status IS DISTINCT FROM 'processing'
       OR operation_row.lease_token IS DISTINCT FROM p_worker_token
       OR operation_row.lease_expires_at <= applied_at
       OR operation_row.cancellation_started_at IS NULL
       OR p_stripe_cancelled_at
            < operation_row.cancellation_started_at - INTERVAL '5 minutes'
       OR p_stripe_cancelled_at > applied_at + INTERVAL '5 minutes' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_termination_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = operation_row.subscription_id;
    SELECT * INTO first_session
    FROM private.checkout_v2_effective_cycle_sessions(operation_row.cycle_id)
    WHERE checkout_v2_cycle_session_index = 1;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM
            operation_row.stripe_subscription_id
       OR first_session.status IS DISTINCT FROM 'completed'
       OR first_session.completed_at IS NULL
       OR first_session.scheduled_at IS NULL
       OR first_session.completed_at < first_session.scheduled_at
            + pg_catalog.make_interval(mins => first_session.duration_minutes)
       OR first_session.id IS DISTINCT FROM operation_row.first_session_id THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_termination_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    PERFORM pg_catalog.set_config(
        'app.checkout_v2_guarantee_operation_id',
        operation_row.id::TEXT,
        TRUE
    );

    FOR target_session IN
        SELECT *
        FROM private.checkout_v2_effective_cycle_sessions(operation_row.cycle_id)
        WHERE checkout_v2_cycle_session_index BETWEEN 2 AND 4
        ORDER BY checkout_v2_cycle_session_index, created_at, id
    LOOP
        IF target_session.status = 'scheduled' THEN
            UPDATE public.sessions
            SET
                status = 'cancelled',
                cancelled_at = applied_at,
                cancelled_by = operation_row.actor_id,
                cancellation_reason = 'guarantee_refund',
                updated_at = applied_at
            WHERE id = target_session.id
              AND status = 'scheduled';

            IF NOT FOUND THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_session_state_conflicts'
                    USING ERRCODE = '40001';
            END IF;

            job_payload := pg_catalog.jsonb_build_object(
                'sessionId', target_session.id,
                'cancelledBy', 'guarantee',
                'reason', 'guarantee_refund',
                'sendEmail', FALSE
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
                target_session.id,
                operation_row.subscription_id,
                subscription_row.student_id,
                'session_cancellation:' || target_session.id::TEXT,
                job_payload
            )
            ON CONFLICT (job_type, dedupe_key)
                WHERE dedupe_key IS NOT NULL
                DO NOTHING;

            SELECT * INTO job_row
            FROM public.fulfillment_jobs
            WHERE job_type = 'session_cancellation'
              AND dedupe_key = 'session_cancellation:' || target_session.id::TEXT;

            IF job_row.id IS NULL
               OR job_row.session_id IS DISTINCT FROM target_session.id
               OR job_row.subscription_id IS DISTINCT FROM operation_row.subscription_id
               OR job_row.student_id IS DISTINCT FROM subscription_row.student_id
               OR job_row.payload IS DISTINCT FROM job_payload THEN
                RAISE EXCEPTION 'checkout_v2_guarantee_cancellation_job_conflicts'
                    USING ERRCODE = '23505';
            END IF;
        ELSIF target_session.id = operation_row.second_session_id
          AND target_session.status IN ('cancelled', 'no_show')
          AND EXISTS (
                SELECT 1
                FROM public.checkout_v2_session_incident_resolutions AS resolution_row
                WHERE resolution_row.session_id = target_session.id
                  AND resolution_row.resolution = 'excused'
          ) THEN
            NULL;
        ELSIF target_session.status = 'cancelled'
          AND target_session.cancelled_at IS NOT NULL
          AND (
                target_session.cancelled_by IS DISTINCT FROM target_session.student_id
                OR target_session.scheduled_at
                    >= target_session.cancelled_at + INTERVAL '24 hours'
          ) THEN
            NULL;
        ELSE
            RAISE EXCEPTION 'checkout_v2_guarantee_session_state_conflicts'
                USING ERRCODE = '40001';
        END IF;
    END LOOP;

    UPDATE public.subscriptions
    SET
        status = 'cancelled'::public.subscription_status,
        sessions_used = 1,
        updated_at = applied_at
    WHERE id = operation_row.subscription_id
      AND status IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status,
            'cancelled'::public.subscription_status
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_subscription_state_conflicts'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.checkout_v2_guarantee_operations
    SET
        stripe_cancelled_at = p_stripe_cancelled_at,
        terminated_at = applied_at
    WHERE id = p_operation_id
    RETURNING * INTO operation_row;

    RETURN operation_row;
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
    WHERE target_session.id = p_session_id
      AND EXISTS (
            SELECT 1 FROM private.checkout_v2_effective_cycle_sessions(target_session.checkout_v2_cycle_id) AS effective_session
            WHERE effective_session.id = target_session.id
      );

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
    ORDER BY
        cycle_session.checkout_v2_cycle_session_index,
        cycle_session.created_at,
        cycle_session.id
    FOR UPDATE;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = p_session_id
      AND EXISTS (
            SELECT 1 FROM private.checkout_v2_effective_cycle_sessions(target_session.checkout_v2_cycle_id) AS effective_session
            WHERE effective_session.id = target_session.id
      )
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
                FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS cycle_session
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
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS previous_session
        WHERE previous_session.checkout_v2_cycle_id = cycle_row.id
          AND previous_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index - 1;

        SELECT following_session.scheduled_at INTO next_scheduled_at
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS following_session
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
    WHERE target_session.id = operation_row.session_id
      AND EXISTS (
            SELECT 1 FROM private.checkout_v2_effective_cycle_sessions(target_session.checkout_v2_cycle_id) AS effective_session
            WHERE effective_session.id = target_session.id
      );

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
    ORDER BY
        cycle_session.checkout_v2_cycle_session_index,
        cycle_session.created_at,
        cycle_session.id
    FOR UPDATE;

    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations AS operation
    WHERE operation.id = p_operation_id
    FOR UPDATE;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = operation_row.session_id
      AND EXISTS (
            SELECT 1 FROM private.checkout_v2_effective_cycle_sessions(target_session.checkout_v2_cycle_id) AS effective_session
            WHERE effective_session.id = target_session.id
      )
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
    FROM private.checkout_v2_effective_cycle_sessions(operation_row.cycle_id) AS cycle_session
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
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS previous_session
        WHERE previous_session.checkout_v2_cycle_id = cycle_row.id
          AND previous_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index - 1;

        SELECT following_session.scheduled_at INTO next_scheduled_at
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS following_session
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
        FROM private.checkout_v2_effective_cycle_sessions(operation_row.cycle_id) AS cycle_session
        WHERE cycle_session.checkout_v2_cycle_id = operation_row.cycle_id
          AND (
                operation_row.operation_kind = 'provisional_anchor'
                OR cycle_session.id = operation_row.session_id
          )
        ORDER BY
            cycle_session.checkout_v2_cycle_session_index,
            cycle_session.created_at,
            cycle_session.id
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
    WHERE target_session.id = p_session_id
      AND EXISTS (
            SELECT 1 FROM private.checkout_v2_effective_cycle_sessions(target_session.checkout_v2_cycle_id) AS effective_session
            WHERE effective_session.id = target_session.id
      );

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
                FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS cycle_session
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
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS previous_session
        WHERE previous_session.checkout_v2_cycle_id = cycle_row.id
          AND previous_session.checkout_v2_cycle_session_index =
                session_row.checkout_v2_cycle_session_index - 1;

        SELECT following_session.scheduled_at INTO next_scheduled_at
        FROM private.checkout_v2_effective_cycle_sessions(cycle_row.id) AS following_session
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
                      AND checkout_v2_replaces_session_id IS NULL
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
