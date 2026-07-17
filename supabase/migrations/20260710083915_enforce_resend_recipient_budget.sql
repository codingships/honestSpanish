-- Persistent, atomic Resend recipient budget. Counts recipient entries, not
-- messages, because each recipient consumes provider quota.
CREATE TABLE public.email_recipient_budget_usage (
    budget_scope TEXT NOT NULL CHECK (
        char_length(budget_scope) BETWEEN 1 AND 64
        AND budget_scope ~ '^[a-z0-9:_-]+$'
    ),
    period_kind TEXT NOT NULL CHECK (period_kind IN ('day', 'month')),
    period_start DATE NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
    last_source TEXT NOT NULL CHECK (
        char_length(last_source) BETWEEN 1 AND 80
        AND last_source ~ '^[a-z0-9_.:-]+$'
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (budget_scope, period_kind, period_start)
);

ALTER TABLE public.email_recipient_budget_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.email_recipient_budget_usage FROM PUBLIC;
REVOKE ALL ON TABLE public.email_recipient_budget_usage FROM anon;
REVOKE ALL ON TABLE public.email_recipient_budget_usage FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.email_recipient_budget_usage TO service_role;

-- Both counters are reserved in one transaction. If either limit is reached,
-- the exception rolls the whole function back, including the first counter.
CREATE OR REPLACE FUNCTION public.reserve_email_recipient_budget(
    p_budget_scope TEXT,
    p_recipient_count INTEGER,
    p_daily_limit INTEGER,
    p_monthly_limit INTEGER,
    p_source TEXT
)
RETURNS TABLE (
    daily_used INTEGER,
    monthly_used INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_day_start DATE := (v_now AT TIME ZONE 'UTC')::DATE;
    v_month_start DATE := date_trunc('month', v_now AT TIME ZONE 'UTC')::DATE;
    v_daily_used INTEGER;
    v_monthly_used INTEGER;
BEGIN
    IF p_budget_scope IS NULL
       OR char_length(p_budget_scope) NOT BETWEEN 1 AND 64
       OR p_budget_scope !~ '^[a-z0-9:_-]+$' THEN
        RAISE EXCEPTION 'email_budget_invalid_scope' USING ERRCODE = '22023';
    END IF;

    IF p_source IS NULL
       OR char_length(p_source) NOT BETWEEN 1 AND 80
       OR p_source !~ '^[a-z0-9_.:-]+$' THEN
        RAISE EXCEPTION 'email_budget_invalid_source' USING ERRCODE = '22023';
    END IF;

    IF p_recipient_count IS NULL OR p_recipient_count < 1 OR p_recipient_count > 80 THEN
        RAISE EXCEPTION 'email_budget_invalid_recipient_count' USING ERRCODE = '22023';
    END IF;

    -- Hard ceilings preserve margin below Resend Free's provider limits.
    IF p_daily_limit IS NULL OR p_daily_limit < 1 OR p_daily_limit > 80 THEN
        RAISE EXCEPTION 'email_budget_invalid_daily_limit' USING ERRCODE = '22023';
    END IF;

    IF p_monthly_limit IS NULL OR p_monthly_limit < 1 OR p_monthly_limit > 2400 THEN
        RAISE EXCEPTION 'email_budget_invalid_monthly_limit' USING ERRCODE = '22023';
    END IF;

    IF p_recipient_count > p_daily_limit THEN
        RAISE EXCEPTION 'email_budget_daily_exceeded' USING ERRCODE = 'P0001';
    END IF;

    IF p_recipient_count > p_monthly_limit THEN
        RAISE EXCEPTION 'email_budget_monthly_exceeded' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.email_recipient_budget_usage AS usage (
        budget_scope,
        period_kind,
        period_start,
        recipient_count,
        last_source,
        created_at,
        updated_at
    ) VALUES (
        p_budget_scope,
        'day',
        v_day_start,
        p_recipient_count,
        p_source,
        v_now,
        v_now
    )
    ON CONFLICT (budget_scope, period_kind, period_start) DO UPDATE
    SET recipient_count = usage.recipient_count + EXCLUDED.recipient_count,
        last_source = EXCLUDED.last_source,
        updated_at = v_now
    WHERE usage.recipient_count + EXCLUDED.recipient_count <= p_daily_limit
    RETURNING usage.recipient_count INTO v_daily_used;

    IF v_daily_used IS NULL THEN
        RAISE EXCEPTION 'email_budget_daily_exceeded' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.email_recipient_budget_usage AS usage (
        budget_scope,
        period_kind,
        period_start,
        recipient_count,
        last_source,
        created_at,
        updated_at
    ) VALUES (
        p_budget_scope,
        'month',
        v_month_start,
        p_recipient_count,
        p_source,
        v_now,
        v_now
    )
    ON CONFLICT (budget_scope, period_kind, period_start) DO UPDATE
    SET recipient_count = usage.recipient_count + EXCLUDED.recipient_count,
        last_source = EXCLUDED.last_source,
        updated_at = v_now
    WHERE usage.recipient_count + EXCLUDED.recipient_count <= p_monthly_limit
    RETURNING usage.recipient_count INTO v_monthly_used;

    IF v_monthly_used IS NULL THEN
        RAISE EXCEPTION 'email_budget_monthly_exceeded' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT v_daily_used, v_monthly_used;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;

COMMENT ON TABLE public.email_recipient_budget_usage IS
    'Aggregate recipient reservations for the Resend quota gate; contains no recipient addresses.';
COMMENT ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) IS
    'Atomically reserves UTC daily and monthly recipient budget; service-role only.';
