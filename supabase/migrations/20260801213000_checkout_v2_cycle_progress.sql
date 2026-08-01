-- Checkout V2 student progress is derived from session facts. `sessions_used`
-- remains the operational reservation/quota counter and is intentionally not
-- read or mutated by this projection.

CREATE TABLE public.checkout_v2_session_credit_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL UNIQUE,
    session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_id UUID NOT NULL
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    session_index SMALLINT NOT NULL CHECK (session_index BETWEEN 1 AND 4),
    effect TEXT NOT NULL DEFAULT 'restored' CHECK (effect = 'restored'),
    admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 5 AND 2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp())
);

CREATE INDEX checkout_v2_session_credit_adjustments_subscription_idx
    ON public.checkout_v2_session_credit_adjustments(subscription_id, created_at, id);
CREATE INDEX checkout_v2_session_credit_adjustments_cycle_idx
    ON public.checkout_v2_session_credit_adjustments(cycle_id, session_index);

ALTER TABLE public.checkout_v2_session_credit_adjustments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_v2_session_credit_adjustments
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.checkout_v2_session_credit_adjustments TO service_role;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_session_credit_adjustment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    session_row public.sessions%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'checkout_v2_session_credit_adjustment_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO session_row
    FROM public.sessions AS target_session
    WHERE target_session.id = NEW.session_id;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles AS target_cycle
    WHERE target_cycle.id = NEW.cycle_id;

    IF session_row.id IS NULL
       OR cycle_row.id IS NULL
       OR session_row.subscription_id IS DISTINCT FROM NEW.subscription_id
       OR session_row.checkout_v2_cycle_id IS DISTINCT FROM NEW.cycle_id
       OR session_row.checkout_v2_cycle_session_index IS DISTINCT FROM NEW.session_index
       OR cycle_row.subscription_id IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION 'checkout_v2_session_credit_adjustment_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles AS admin_profile
        WHERE admin_profile.id = NEW.admin_id
          AND admin_profile.role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'checkout_v2_session_credit_adjustment_admin_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NOT (
        (
            session_row.status = 'no_show'
            AND session_row.no_show_at IS NOT NULL
        )
        OR (
            session_row.status = 'cancelled'
            AND session_row.scheduled_at IS NOT NULL
            AND session_row.cancelled_at IS NOT NULL
            AND session_row.cancelled_by = session_row.student_id
            AND session_row.scheduled_at
                < session_row.cancelled_at + INTERVAL '24 hours'
            AND session_row.cancellation_reason IS DISTINCT FROM 'guarantee_refund'
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_session_credit_adjustment_outcome_is_ineligible'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_session_credit_adjustment_trigger
    BEFORE INSERT OR UPDATE OR DELETE
    ON public.checkout_v2_session_credit_adjustments
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_session_credit_adjustment();

REVOKE ALL ON FUNCTION private.guard_checkout_v2_session_credit_adjustment()
    FROM PUBLIC, anon, authenticated, service_role;

-- `guarantee_refund` is an internal provenance marker, not a user-provided
-- cancellation reason. Only the guarantee termination saga may write it, and
-- only for one of the three sessions bound to the durable operation.
CREATE OR REPLACE FUNCTION private.guard_checkout_v2_guarantee_refund_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    guarantee_operation_id TEXT := NULLIF(
        pg_catalog.current_setting('app.checkout_v2_guarantee_operation_id', TRUE),
        ''
    );
BEGIN
    IF NEW.cancellation_reason IS DISTINCT FROM 'guarantee_refund' THEN
        RETURN NEW;
    END IF;

    IF TG_OP IS DISTINCT FROM 'UPDATE' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_provenance_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status IS DISTINCT FROM 'scheduled'
       OR NEW.status IS DISTINCT FROM 'cancelled'
       OR NEW.cancelled_at IS NULL
       OR NEW.cancelled_by IS DISTINCT FROM NEW.student_id
       OR guarantee_operation_id IS NULL
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_guarantee_operations AS operation
            WHERE operation.id::TEXT = guarantee_operation_id
              AND operation.subscription_id = NEW.subscription_id
              AND operation.cycle_id = NEW.checkout_v2_cycle_id
              AND operation.actor_id = NEW.student_id
              AND operation.status = 'processing'
              AND operation.cancellation_started_at IS NOT NULL
              AND operation.terminated_at IS NULL
              AND NEW.id IN (
                    operation.second_session_id,
                    operation.third_session_id,
                    operation.fourth_session_id
              )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_refund_provenance_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_guarantee_refund_provenance_trigger
    BEFORE INSERT OR UPDATE OF
        status,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        subscription_id,
        student_id,
        checkout_v2_cycle_id
    ON public.sessions
    FOR EACH ROW
    WHEN (NEW.cancellation_reason = 'guarantee_refund')
    EXECUTE FUNCTION private.guard_checkout_v2_guarantee_refund_provenance();

REVOKE ALL ON FUNCTION private.guard_checkout_v2_guarantee_refund_provenance()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE VIEW public.checkout_v2_session_consumption
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
        WHEN guarantee_operation.id IS NOT NULL
             THEN 'guarantee_refund_cancellation'
        WHEN session.status = 'completed' THEN 'completed'
        WHEN session.status = 'no_show' THEN 'no_show'
        WHEN session.status = 'cancelled'
             AND session.cancelled_by = session.student_id
             AND session.scheduled_at
                < session.cancelled_at + INTERVAL '24 hours'
             THEN 'late_student_cancellation'
        WHEN session.status = 'cancelled'
             AND session.cancelled_by = session.student_id
             THEN 'timely_student_cancellation'
        WHEN session.status = 'cancelled' THEN 'non_student_cancellation'
        ELSE 'scheduled'
    END AS original_consumption_kind,
    guarantee_operation.id IS NULL
        AND (
            session.status IN ('completed', 'no_show')
            OR (
                session.status = 'cancelled'
                AND session.cancelled_by = session.student_id
                AND session.scheduled_at
                    < session.cancelled_at + INTERVAL '24 hours'
            )
        ) AS original_student_credit_consumed,
    adjustment.id AS credit_adjustment_id,
    adjustment.request_id AS credit_adjustment_request_id,
    adjustment.created_at AS credit_restored_at,
    adjustment.id IS NOT NULL AS credit_restored,
    guarantee_operation.id IS NULL
        AND (
            session.status IN ('completed', 'no_show')
            OR (
                session.status = 'cancelled'
                AND session.cancelled_by = session.student_id
                AND session.scheduled_at
                    < session.cancelled_at + INTERVAL '24 hours'
            )
        )
        AND adjustment.id IS NULL AS student_credit_consumed,
    CASE
        WHEN guarantee_operation.id IS NOT NULL
            THEN 'guarantee_refund_cancellation'
        WHEN adjustment.id IS NOT NULL AND session.status = 'no_show'
            THEN 'restored_no_show'
        WHEN adjustment.id IS NOT NULL
            THEN 'restored_late_student_cancellation'
        WHEN session.status = 'completed' THEN 'completed'
        WHEN session.status = 'no_show' THEN 'no_show'
        WHEN session.status = 'cancelled'
             AND session.cancelled_by = session.student_id
             AND session.scheduled_at
                < session.cancelled_at + INTERVAL '24 hours'
             THEN 'late_student_cancellation'
        WHEN session.status = 'cancelled'
             AND session.cancelled_by = session.student_id
             THEN 'timely_student_cancellation'
        WHEN session.status = 'cancelled' THEN 'non_student_cancellation'
        ELSE 'scheduled'
    END AS consumption_kind
FROM public.sessions AS session
JOIN public.checkout_v2_cycles AS cycle
  ON cycle.id = session.checkout_v2_cycle_id
 AND cycle.subscription_id = session.subscription_id
LEFT JOIN public.checkout_v2_session_credit_adjustments AS adjustment
  ON adjustment.session_id = session.id
LEFT JOIN public.checkout_v2_guarantee_operations AS guarantee_operation
  ON guarantee_operation.subscription_id = session.subscription_id
 AND guarantee_operation.cycle_id = session.checkout_v2_cycle_id
 AND guarantee_operation.actor_id = session.student_id
 AND guarantee_operation.terminated_at IS NOT NULL
 AND session.id IN (
        guarantee_operation.second_session_id,
        guarantee_operation.third_session_id,
        guarantee_operation.fourth_session_id
 )
WHERE session.checkout_v2_cycle_id IS NOT NULL;

CREATE VIEW public.checkout_v2_cycle_progress
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
        count(*) FILTER (
            WHERE consumption.original_consumption_kind = 'late_student_cancellation'
        )::INTEGER AS sessions_late_student_cancelled,
        count(*) FILTER (WHERE consumption.credit_restored)::INTEGER AS sessions_restored,
        count(*) FILTER (WHERE consumption.student_credit_consumed)::INTEGER AS sessions_consumed
    FROM public.checkout_v2_cycles AS cycle
    JOIN public.subscriptions AS subscription ON subscription.id = cycle.subscription_id
    LEFT JOIN public.checkout_v2_session_consumption AS consumption
      ON consumption.cycle_id = cycle.id
    GROUP BY cycle.id, subscription.student_id
), classified AS (
    SELECT
        cycle_facts.*,
        CASE
            WHEN materialization_state = 'pending'
                 AND sessions_materialized = 0 THEN 'pending'
            WHEN materialization_state = 'ready'
                 AND sessions_materialized = sessions_total
                 AND positions_materialized = sessions_total THEN 'ready'
            ELSE 'inconsistent'
        END AS progress_state
    FROM cycle_facts
)
SELECT
    cycle_id,
    subscription_id,
    student_id,
    cycle_number,
    cycle_kind,
    starts_at,
    ends_at,
    materialization_state,
    sessions_materialized_at,
    sessions_total,
    sessions_materialized,
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

CREATE OR REPLACE FUNCTION public.get_checkout_v2_subscription_progress(
    p_subscription_id UUID
)
RETURNS TABLE (
    cycle_id UUID,
    subscription_id UUID,
    student_id UUID,
    cycle_number INTEGER,
    cycle_kind TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    materialization_state TEXT,
    sessions_materialized_at TIMESTAMPTZ,
    sessions_total SMALLINT,
    sessions_materialized INTEGER,
    sessions_scheduled INTEGER,
    sessions_completed INTEGER,
    sessions_no_show INTEGER,
    sessions_late_student_cancelled INTEGER,
    sessions_restored INTEGER,
    sessions_consumed INTEGER,
    sessions_remaining INTEGER,
    progress_state TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        progress.cycle_id,
        progress.subscription_id,
        progress.student_id,
        progress.cycle_number,
        progress.cycle_kind,
        progress.starts_at,
        progress.ends_at,
        progress.materialization_state,
        progress.sessions_materialized_at,
        progress.sessions_total,
        progress.sessions_materialized,
        progress.sessions_scheduled,
        progress.sessions_completed,
        progress.sessions_no_show,
        progress.sessions_late_student_cancelled,
        progress.sessions_restored,
        progress.sessions_consumed,
        progress.sessions_remaining,
        progress.progress_state
    FROM public.checkout_v2_cycle_progress AS progress
    WHERE progress.subscription_id = p_subscription_id
    ORDER BY progress.cycle_number DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_checkout_v2_subscriptions_progress(
    p_subscription_ids UUID[]
)
RETURNS TABLE (
    cycle_id UUID,
    subscription_id UUID,
    student_id UUID,
    cycle_number INTEGER,
    cycle_kind TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    materialization_state TEXT,
    sessions_materialized_at TIMESTAMPTZ,
    sessions_total SMALLINT,
    sessions_materialized INTEGER,
    sessions_scheduled INTEGER,
    sessions_completed INTEGER,
    sessions_no_show INTEGER,
    sessions_late_student_cancelled INTEGER,
    sessions_restored INTEGER,
    sessions_consumed INTEGER,
    sessions_remaining INTEGER,
    progress_state TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF pg_catalog.cardinality(
        COALESCE(p_subscription_ids, ARRAY[]::UUID[])
    ) > 5000 THEN
        RAISE EXCEPTION 'checkout_v2_progress_batch_is_too_large'
            USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    WITH requested_subscriptions AS (
        SELECT DISTINCT requested.subscription_id
        FROM pg_catalog.unnest(
            COALESCE(p_subscription_ids, ARRAY[]::UUID[])
        ) AS requested(subscription_id)
        WHERE requested.subscription_id IS NOT NULL
    )
    SELECT
        latest.cycle_id,
        latest.subscription_id,
        latest.student_id,
        latest.cycle_number,
        latest.cycle_kind,
        latest.starts_at,
        latest.ends_at,
        latest.materialization_state,
        latest.sessions_materialized_at,
        latest.sessions_total,
        latest.sessions_materialized,
        latest.sessions_scheduled,
        latest.sessions_completed,
        latest.sessions_no_show,
        latest.sessions_late_student_cancelled,
        latest.sessions_restored,
        latest.sessions_consumed,
        latest.sessions_remaining,
        latest.progress_state
    FROM requested_subscriptions AS requested
    CROSS JOIN LATERAL (
        SELECT progress.*
        FROM public.checkout_v2_cycle_progress AS progress
        WHERE progress.subscription_id = requested.subscription_id
        ORDER BY progress.cycle_number DESC
        LIMIT 1
    ) AS latest
    ORDER BY latest.subscription_id;
END;
$$;

REVOKE ALL ON TABLE public.checkout_v2_session_consumption
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.checkout_v2_cycle_progress
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sessions, public.subscriptions TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_session_consumption TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_cycle_progress TO service_role;

REVOKE ALL ON FUNCTION public.get_checkout_v2_subscription_progress(UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_v2_subscription_progress(UUID)
    TO service_role;
REVOKE ALL ON FUNCTION public.get_checkout_v2_subscriptions_progress(UUID[])
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_checkout_v2_subscriptions_progress(UUID[])
    TO service_role;

COMMENT ON TABLE public.checkout_v2_session_credit_adjustments IS
    'Immutable, service-readable decisions restoring student credit after an eligible Checkout V2 incident. No write RPC exists until replacement-session materialization is designed.';
COMMENT ON VIEW public.checkout_v2_session_consumption IS
    'One immutable-fact-derived row per Checkout V2 session; credit restoration never changes teacher compensation.';
COMMENT ON VIEW public.checkout_v2_cycle_progress IS
    'Student consumption progress by Checkout V2 cycle. Pending and inconsistent cycles expose NULL consumption totals.';
COMMENT ON FUNCTION public.get_checkout_v2_subscription_progress(UUID) IS
    'Returns the highest cycle_number for a Checkout V2 subscription; service-role only.';
COMMENT ON FUNCTION public.get_checkout_v2_subscriptions_progress(UUID[]) IS
    'Returns one highest-cycle-number row per distinct requested subscription, up to 5000 input UUIDs; service-role only.';
