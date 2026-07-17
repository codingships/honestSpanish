-- Restore the two runtime invariants missing from staging without mixing in
-- unrelated advisor/performance cleanup.

CREATE OR REPLACE FUNCTION public.get_available_slots(
    p_teacher_id UUID,
    p_date DATE,
    p_duration_minutes INTEGER DEFAULT 50
)
RETURNS TABLE (
    slot_start TIMESTAMPTZ,
    slot_end TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_day_of_week INTEGER;
    v_timezone TEXT := 'Europe/Madrid';
BEGIN
    v_day_of_week := EXTRACT(DOW FROM p_date);

    RETURN QUERY
    WITH availability_slots AS (
        SELECT
            (p_date + ta.start_time) AT TIME ZONE v_timezone AS block_start,
            (p_date + ta.end_time) AT TIME ZONE v_timezone AS block_end
        FROM teacher_availability ta
        WHERE ta.teacher_id = p_teacher_id
          AND ta.day_of_week = v_day_of_week
          AND ta.is_active = TRUE
    ),
    existing_sessions AS (
        SELECT
            s.scheduled_at AS session_start,
            s.scheduled_at + (s.duration_minutes || ' minutes')::INTERVAL AS session_end
        FROM sessions s
        WHERE s.teacher_id = p_teacher_id
          AND DATE(s.scheduled_at AT TIME ZONE v_timezone) = p_date
          AND s.status <> 'cancelled'
    ),
    time_slots AS (
        SELECT
            generate_series(
                a.block_start,
                a.block_end - (p_duration_minutes || ' minutes')::INTERVAL,
                (p_duration_minutes || ' minutes')::INTERVAL
            ) AS slot_start
        FROM availability_slots a
    )
    SELECT
        ts.slot_start,
        ts.slot_start + (p_duration_minutes || ' minutes')::INTERVAL AS slot_end
    FROM time_slots ts
    WHERE NOT EXISTS (
        SELECT 1
        FROM existing_sessions es
        WHERE ts.slot_start < es.session_end
          AND ts.slot_start + (p_duration_minutes || ' minutes')::INTERVAL > es.session_start
    )
    ORDER BY ts.slot_start;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) FROM public;
REVOKE EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(UUID, DATE, INTEGER) TO service_role;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.leads'::regclass
          AND conname = 'leads_email_key'
          AND contype = 'u'
    ) THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.leads'::regclass
          AND conname = 'leads_email_unique'
          AND contype = 'u'
    ) THEN
        ALTER TABLE public.leads
            RENAME CONSTRAINT leads_email_unique TO leads_email_key;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT email
        FROM public.leads
        WHERE email IS NOT NULL
        GROUP BY email
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot add leads_email_key: duplicate lead emails exist';
    END IF;

    ALTER TABLE public.leads
        ADD CONSTRAINT leads_email_key UNIQUE (email);
END;
$$;
