CREATE TABLE public.staging_integration_smoke_runs (
    run_id UUID PRIMARY KEY,
    lease_name TEXT NOT NULL CHECK (lease_name = 'google-resend-write-smoke'),
    lease_generation BIGINT NOT NULL CHECK (lease_generation > 0),
    marker TEXT NOT NULL UNIQUE CHECK (marker ~ '^SMOKE-INTEGRATION-[A-Za-z0-9-]{20,160}$'),
    status TEXT NOT NULL CHECK (status IN ('running', 'cleaning', 'cleanup_required', 'cleaned')),
    phase TEXT NOT NULL CHECK (phase ~ '^[a-z0-9_]{2,80}$'),
    base_host TEXT NOT NULL CHECK (
        base_host = 'espanolhonesto-staging.alindev95.workers.dev'
        OR base_host ~ '^[a-z0-9]+(?:-[a-z0-9]+)*-espanolhonesto-staging[.]alindev95[.]workers[.]dev$'
    ),
    student_id UUID NOT NULL REFERENCES public.profiles(id),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id),
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id),
    scheduled_at TIMESTAMPTZ NOT NULL,
    original_full_name TEXT,
    original_private_profile JSONB NOT NULL CHECK (
        jsonb_typeof(original_private_profile) = 'object'
        AND original_private_profile ?& ARRAY['drive_folder_id', 'drive_folder_url', 'google_account_email']
        AND (original_private_profile - ARRAY['drive_folder_id', 'drive_folder_url', 'google_account_email']::TEXT[]) = '{}'::JSONB
        AND (original_private_profile->'drive_folder_id' = 'null'::JSONB OR jsonb_typeof(original_private_profile->'drive_folder_id') = 'string')
        AND (original_private_profile->'drive_folder_url' = 'null'::JSONB OR jsonb_typeof(original_private_profile->'drive_folder_url') = 'string')
        AND (original_private_profile->'google_account_email' = 'null'::JSONB OR jsonb_typeof(original_private_profile->'google_account_email') = 'string')
    ),
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    fulfillment_job_id UUID REFERENCES public.fulfillment_jobs(id) ON DELETE SET NULL,
    cancellation_job_id UUID REFERENCES public.fulfillment_jobs(id) ON DELETE SET NULL,
    drive_root_ids TEXT[] NOT NULL DEFAULT '{}',
    calendar_event_ids TEXT[] NOT NULL DEFAULT '{}',
    email_budget_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    email_idempotency_key TEXT GENERATED ALWAYS AS (
        'staging-integration-smoke/email/' || run_id::TEXT
    ) STORED UNIQUE,
    email_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        email_status IN ('not_started', 'sending', 'retryable', 'sent', 'terminal_failed')
    ),
    email_payload_sha256 TEXT CHECK (email_payload_sha256 ~ '^[a-f0-9]{64}$'),
    email_attempt_generation BIGINT NOT NULL DEFAULT 0 CHECK (email_attempt_generation >= 0),
    email_locked_at TIMESTAMPTZ,
    email_first_attempt_at TIMESTAMPTZ,
    email_last_attempt_at TIMESTAMPTZ,
    email_provider_id TEXT,
    email_error_code TEXT CHECK (email_error_code ~ '^[a-z0-9_]{2,80}$'),
    email_http_status INTEGER CHECK (email_http_status BETWEEN 100 AND 599),
    email_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (email_status = 'sent' AND email_provider_id IS NOT NULL AND email_sent_at IS NOT NULL)
        OR (email_status <> 'sent' AND email_provider_id IS NULL AND email_sent_at IS NULL)
    )
);

CREATE INDEX staging_integration_smoke_runs_active_idx
    ON public.staging_integration_smoke_runs(status, updated_at)
    WHERE status IN ('running', 'cleaning', 'cleanup_required');
CREATE UNIQUE INDEX staging_integration_smoke_runs_one_active_idx
    ON public.staging_integration_smoke_runs(lease_name)
    WHERE status IN ('running', 'cleaning', 'cleanup_required');

ALTER TABLE public.staging_integration_smoke_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staging_integration_smoke_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staging_integration_smoke_runs TO service_role;

CREATE TABLE public.staging_integration_smoke_leases (
    lease_name TEXT PRIMARY KEY CHECK (lease_name = 'google-resend-write-smoke'),
    run_id UUID NOT NULL,
    owner_token UUID NOT NULL,
    generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.staging_integration_smoke_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staging_integration_smoke_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staging_integration_smoke_leases TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_staging_integration_smoke_lease(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_ttl_seconds INTEGER
)
RETURNS TABLE (acquired BOOLEAN, expires_at TIMESTAMPTZ, generation BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
    v_generation BIGINT;
BEGIN
    IF p_lease_name IS DISTINCT FROM 'google-resend-write-smoke'
       OR p_run_id IS NULL
       OR p_owner_token IS NULL
       OR p_ttl_seconds NOT BETWEEN 60 AND 3600 THEN
        RAISE EXCEPTION 'invalid_staging_smoke_lease_request' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.staging_integration_smoke_runs AS smoke_run
        WHERE smoke_run.run_id <> p_run_id
          AND smoke_run.status IN ('running', 'cleaning', 'cleanup_required')
    ) THEN
        RETURN QUERY SELECT FALSE, COALESCE(
            (
                SELECT lease.expires_at
                FROM public.staging_integration_smoke_leases AS lease
                WHERE lease.lease_name = p_lease_name
            ),
            v_now
        ), COALESCE((
            SELECT lease.generation
            FROM public.staging_integration_smoke_leases AS lease
            WHERE lease.lease_name = p_lease_name
        ), 0::BIGINT);
        RETURN;
    END IF;

    INSERT INTO public.staging_integration_smoke_leases AS lease (
        lease_name,
        run_id,
        owner_token,
        generation,
        expires_at,
        updated_at
    ) VALUES (
        p_lease_name,
        p_run_id,
        p_owner_token,
        1,
        v_now + make_interval(secs => p_ttl_seconds),
        v_now
    )
    ON CONFLICT (lease_name) DO UPDATE
    SET run_id = EXCLUDED.run_id,
        owner_token = EXCLUDED.owner_token,
        generation = CASE
            WHEN lease.run_id = EXCLUDED.run_id
             AND lease.owner_token = EXCLUDED.owner_token
             AND lease.expires_at > v_now
                THEN lease.generation
            ELSE lease.generation + 1
        END,
        expires_at = EXCLUDED.expires_at,
        updated_at = v_now
    WHERE lease.expires_at <= v_now
       OR (
           lease.run_id = EXCLUDED.run_id
           AND lease.owner_token = EXCLUDED.owner_token
       )
    RETURNING lease.expires_at, lease.generation INTO v_expires_at, v_generation;

    IF v_expires_at IS NULL THEN
        RETURN QUERY SELECT FALSE, lease.expires_at, lease.generation
        FROM public.staging_integration_smoke_leases AS lease
        WHERE lease.lease_name = p_lease_name;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, v_expires_at, v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_staging_integration_smoke_lease(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_ttl_seconds INTEGER
)
RETURNS TABLE (renewed BOOLEAN, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_ttl_seconds NOT BETWEEN 60 AND 3600 THEN
        RAISE EXCEPTION 'invalid_staging_smoke_lease_request' USING ERRCODE = '22023';
    END IF;

    UPDATE public.staging_integration_smoke_leases AS lease
    SET expires_at = v_now + make_interval(secs => p_ttl_seconds),
        updated_at = v_now
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
    RETURNING lease.expires_at INTO v_expires_at;

    RETURN QUERY SELECT v_expires_at IS NOT NULL, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_staging_integration_smoke_lease(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    UPDATE public.staging_integration_smoke_leases
    SET expires_at = LEAST(expires_at, v_now),
        updated_at = v_now
    WHERE lease_name = p_lease_name
      AND run_id = p_run_id
      AND owner_token = p_owner_token
      AND generation = p_generation;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_staging_integration_smoke_job(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_job_id UUID,
    p_dedupe_key TEXT,
    p_smoke_marker TEXT,
    p_student_id UUID,
    p_worker_id TEXT
)
RETURNS TABLE (claimed BOOLEAN, job_status TEXT, attempts INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_job public.fulfillment_jobs%ROWTYPE;
    v_run public.staging_integration_smoke_runs%ROWTYPE;
    v_claimed_attempts INTEGER;
BEGIN
    SELECT smoke_run.*
    INTO v_run
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND smoke_run.marker = p_smoke_marker
      AND smoke_run.student_id = p_student_id
      AND smoke_run.status IN ('running', 'cleaning')
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_job_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    SELECT job.*
    INTO v_job
    FROM public.fulfillment_jobs AS job
    WHERE job.id = p_job_id
      AND job.dedupe_key = p_dedupe_key
      AND job.student_id = p_student_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_job_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_job.job_type NOT IN ('session_fulfillment', 'session_cancellation')
       OR v_job.dedupe_key IS DISTINCT FROM (CASE v_job.job_type
            WHEN 'session_fulfillment' THEN 'staging-integration:' || p_smoke_marker
            ELSE 'staging-integration-cleanup:' || p_smoke_marker
          END)
       OR v_job.id IS DISTINCT FROM (CASE v_job.job_type
            WHEN 'session_fulfillment' THEN v_run.fulfillment_job_id
            ELSE v_run.cancellation_job_id
          END)
       OR v_job.session_id IS DISTINCT FROM v_run.session_id
       OR v_job.subscription_id IS DISTINCT FROM v_run.subscription_id
       OR v_job.payload->'sendEmail' IS DISTINCT FROM 'false'::JSONB
       OR v_job.payload->'smokeMarker' IS DISTINCT FROM to_jsonb(p_smoke_marker)
       OR v_job.payload->'smokeRunId' IS DISTINCT FROM to_jsonb(p_run_id::TEXT)
       OR v_job.run_at IS DISTINCT FROM TIMESTAMPTZ '2099-01-01 00:00:00+00' THEN
        RAISE EXCEPTION 'exact_job_identity_mismatch' USING ERRCODE = 'P0001';
    END IF;

    IF v_job.status = 'succeeded' THEN
        RETURN QUERY SELECT FALSE, v_job.status, v_job.attempts;
        RETURN;
    END IF;
    IF v_job.status = 'processing'
       AND v_job.locked_by ~ ('^[a-z0-9-]+:' || p_run_id::TEXT || ':[0-9]+$')
       AND v_job.locked_by IS DISTINCT FROM p_worker_id THEN
        NULL;
    ELSIF v_job.status NOT IN ('pending', 'failed') THEN
        RAISE EXCEPTION 'exact_job_not_processable' USING ERRCODE = 'P0001';
    END IF;
    IF v_job.attempts >= v_job.max_attempts THEN
        RAISE EXCEPTION 'exact_job_not_processable' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fulfillment_jobs AS job
    SET status = 'processing',
        attempts = v_job.attempts + 1,
        locked_at = v_now,
        locked_by = p_worker_id,
        last_error = NULL
    WHERE job.id = v_job.id
      AND job.status = v_job.status
      AND job.attempts = v_job.attempts
      AND job.locked_by IS NOT DISTINCT FROM v_job.locked_by
    RETURNING job.attempts INTO v_claimed_attempts;
    IF v_claimed_attempts IS NULL THEN
        RAISE EXCEPTION 'exact_job_claim_conflict' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT TRUE, 'processing'::TEXT, v_claimed_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_staging_integration_smoke_job(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_job_id UUID,
    p_worker_id TEXT,
    p_attempts INTEGER,
    p_succeeded BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    PERFORM 1
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND p_job_id IN (smoke_run.fulfillment_job_id, smoke_run.cancellation_job_id)
      AND smoke_run.status IN ('running', 'cleaning')
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_job_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fulfillment_jobs
    SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
        locked_at = NULL,
        locked_by = NULL,
        last_error = CASE WHEN p_succeeded THEN NULL ELSE 'SMOKE_JOB_EXECUTION_FAILED' END
    WHERE id = p_job_id
      AND status = 'processing'
      AND locked_by = p_worker_id
      AND attempts = p_attempts;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_staging_integration_smoke_email(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_smoke_marker TEXT,
    p_base_host TEXT,
    p_payload_sha256 TEXT,
    p_daily_limit INTEGER,
    p_monthly_limit INTEGER
)
RETURNS TABLE (
    claimed BOOLEAN,
    email_status TEXT,
    attempt_generation BIGINT,
    idempotency_key TEXT,
    provider_id TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_run public.staging_integration_smoke_runs%ROWTYPE;
BEGIN
    IF p_payload_sha256 !~ '^[a-f0-9]{64}$'
       OR p_daily_limit NOT BETWEEN 1 AND 10
       OR p_monthly_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'exact_email_request_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT smoke_run.*
    INTO v_run
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND smoke_run.marker = p_smoke_marker
      AND smoke_run.base_host = p_base_host
      AND smoke_run.status = 'running'
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_email_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    IF v_run.email_payload_sha256 IS NOT NULL
       AND v_run.email_payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
        RAISE EXCEPTION 'exact_email_payload_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_run.email_status = 'sent' THEN
        RETURN QUERY SELECT FALSE, v_run.email_status, v_run.email_attempt_generation,
            v_run.email_idempotency_key, v_run.email_provider_id;
        RETURN;
    END IF;
    IF v_run.email_status = 'terminal_failed'
       OR (
           v_run.email_first_attempt_at IS NOT NULL
           AND v_run.email_first_attempt_at <= v_now - INTERVAL '23 hours'
       ) THEN
        RAISE EXCEPTION 'exact_email_retry_window_expired' USING ERRCODE = 'P0001';
    END IF;
    IF v_run.email_status = 'sending'
       AND v_run.email_locked_at > v_now - INTERVAL '2 minutes' THEN
        RETURN QUERY SELECT FALSE, v_run.email_status, v_run.email_attempt_generation,
            v_run.email_idempotency_key, NULL::TEXT;
        RETURN;
    END IF;

    IF NOT v_run.email_budget_reserved THEN
        PERFORM * FROM public.reserve_email_recipient_budget(
            'nonproduction',
            1,
            p_daily_limit,
            p_monthly_limit,
            'staging_integration_smoke'
        );
    END IF;

    UPDATE public.staging_integration_smoke_runs
    SET email_budget_reserved = TRUE,
        email_status = 'sending',
        email_payload_sha256 = p_payload_sha256,
        email_attempt_generation = email_attempt_generation + 1,
        email_locked_at = v_now,
        email_first_attempt_at = COALESCE(email_first_attempt_at, v_now),
        email_last_attempt_at = v_now,
        email_error_code = NULL,
        email_http_status = NULL,
        updated_at = v_now
    WHERE run_id = p_run_id
      AND lease_generation = p_generation
      AND email_attempt_generation = v_run.email_attempt_generation
    RETURNING staging_integration_smoke_runs.* INTO v_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_email_claim_conflict' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT TRUE, v_run.email_status, v_run.email_attempt_generation,
        v_run.email_idempotency_key, NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_staging_integration_smoke_email(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_attempt_generation BIGINT,
    p_outcome TEXT,
    p_provider_id TEXT,
    p_error_code TEXT,
    p_http_status INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    IF p_outcome NOT IN ('sent', 'retryable', 'terminal_failed')
       OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_]{2,80}$')
       OR (p_http_status IS NOT NULL AND p_http_status NOT BETWEEN 100 AND 599)
       OR (p_outcome = 'sent' AND (p_provider_id IS NULL OR p_error_code IS NOT NULL))
       OR (p_outcome <> 'sent' AND p_provider_id IS NOT NULL) THEN
        RAISE EXCEPTION 'exact_email_finalize_invalid' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND smoke_run.status = 'running'
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_email_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.staging_integration_smoke_runs
    SET email_status = p_outcome,
        email_locked_at = NULL,
        email_provider_id = CASE WHEN p_outcome = 'sent' THEN p_provider_id ELSE NULL END,
        email_error_code = CASE WHEN p_outcome = 'sent' THEN NULL ELSE COALESCE(p_error_code, 'provider_unknown') END,
        email_http_status = p_http_status,
        email_sent_at = CASE WHEN p_outcome = 'sent' THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE run_id = p_run_id
      AND lease_generation = p_generation
      AND email_status = 'sending'
      AND email_attempt_generation = p_attempt_generation;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_staging_integration_smoke_lease(TEXT, UUID, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_staging_integration_smoke_lease(TEXT, UUID, UUID, INTEGER)
    TO service_role;
REVOKE ALL ON FUNCTION public.renew_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT, INTEGER)
    TO service_role;
REVOKE ALL ON FUNCTION public.claim_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, TEXT, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, INTEGER, BOOLEAN
) TO service_role;
REVOKE ALL ON FUNCTION public.claim_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.release_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT)
    TO service_role;

COMMENT ON TABLE public.staging_integration_smoke_runs IS
    'Durable, service-role-only recovery state for the focused staging integration smoke.';
COMMENT ON TABLE public.staging_integration_smoke_leases IS
    'Exclusive TTL lease preventing concurrent focused staging integration smoke runs.';
