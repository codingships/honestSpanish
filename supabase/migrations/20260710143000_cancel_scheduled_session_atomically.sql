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
    v_cancelled_at TIMESTAMPTZ := clock_timestamp();
    v_late_student_cancellation BOOLEAN := FALSE;
    v_quota_restore_attempted BOOLEAN := FALSE;
    v_quota_restored BOOLEAN := FALSE;
    v_previous_sessions_used INTEGER := NULL;
    v_next_sessions_used INTEGER := NULL;
    v_hours_until_class DOUBLE PRECISION := NULL;
BEGIN
    IF p_cancelled_by_role NOT IN ('student', 'teacher', 'admin') THEN
        RAISE EXCEPTION 'invalid_cancelled_by_role' USING ERRCODE = '22023';
    END IF;

    SELECT session_row.*
    INTO v_session
    FROM public.sessions AS session_row
    WHERE session_row.id = p_session_id
    FOR UPDATE;

    IF NOT FOUND OR v_session.status IS DISTINCT FROM 'scheduled' THEN
        RETURN;
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
        SELECT COALESCE(subscription_row.sessions_used, 0)
        INTO v_previous_sessions_used
        FROM public.subscriptions AS subscription_row
        WHERE subscription_row.id = v_session.subscription_id
        FOR UPDATE;

        IF FOUND AND v_previous_sessions_used > 0 THEN
            v_quota_restore_attempted := TRUE;
            v_next_sessions_used := v_previous_sessions_used - 1;

            UPDATE public.subscriptions
            SET sessions_used = v_next_sessions_used
            WHERE id = v_session.subscription_id;

            v_quota_restored := TRUE;
        END IF;
    END IF;

    UPDATE public.sessions
    SET status = 'cancelled',
        cancellation_reason = p_cancellation_reason,
        cancelled_at = v_cancelled_at,
        cancelled_by = p_cancelled_by
    WHERE id = v_session.id;

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

REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) TO service_role;
