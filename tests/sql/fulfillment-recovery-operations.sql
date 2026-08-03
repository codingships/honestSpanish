\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

BEGIN;

SET LOCAL session_replication_role = replica;
INSERT INTO public.profiles (id, email, full_name, role) VALUES
    ('99100000-0000-4000-8000-000000000001', 'fulfillment-admin@test.invalid', 'Fulfillment Admin', 'admin'),
    ('99100000-0000-4000-8000-000000000002', 'fulfillment-student@test.invalid', 'Fulfillment Student', 'student');

INSERT INTO public.fulfillment_jobs (
    id, job_type, status, attempts, max_attempts, run_at,
    locked_at, locked_by, last_error, updated_at
) VALUES
    (
        '99110000-0000-4000-8000-000000000001',
        'session_fulfillment', 'failed', 4, 5, NOW() - INTERVAL '1 minute',
        NULL, NULL, 'provider timeout', '2026-08-02 00:00:00+00'
    ),
    (
        '99110000-0000-4000-8000-000000000002',
        'session_fulfillment', 'processing', 1, 5, NOW() - INTERVAL '1 minute',
        NOW(), 'worker-active', NULL, '2026-08-02 00:00:00+00'
    ),
    (
        '99110000-0000-4000-8000-000000000003',
        'session_fulfillment', 'failed', 2, 5, NOW() - INTERVAL '1 minute',
        NULL, NULL, 'audit must roll back this retry', '2026-08-02 00:00:00+00'
    ),
    (
        '99110000-0000-4000-8000-000000000004',
        'session_fulfillment', 'failed', 3, 5, NOW() - INTERVAL '1 minute',
        NULL, NULL, 'cancel this job', '2026-08-02 00:00:00+00'
    ),
    (
        '99110000-0000-4000-8000-000000000005',
        'session_fulfillment', 'succeeded', 1, 5, NOW() - INTERVAL '1 minute',
        NULL, NULL, NULL, '2026-08-02 00:00:00+00'
    ),
    (
        '99110000-0000-4000-8000-000000000006',
        'session_fulfillment', 'cancelled', 1, 5, NOW() - INTERVAL '1 minute',
        NULL, NULL, 'keep cancelled', '2026-08-02 00:00:00+00'
    ),
    (
        '99110000-0000-4000-8000-000000000007',
        'session_fulfillment', 'cancelled', 2, 5, NOW() - INTERVAL '1 minute',
        NULL, NULL, 'retry this cancellation', '2026-08-02 00:00:00+00'
    );
SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    recovered public.fulfillment_jobs%ROWTYPE;
    stale_claim_count INTEGER;
BEGIN
    IF pg_catalog.has_table_privilege('anon', 'public.fulfillment_jobs', 'SELECT')
       OR pg_catalog.has_table_privilege('anon', 'public.fulfillment_jobs', 'INSERT')
       OR pg_catalog.has_table_privilege('anon', 'public.fulfillment_jobs', 'UPDATE')
       OR pg_catalog.has_table_privilege('anon', 'public.fulfillment_jobs', 'DELETE') THEN
        RAISE EXCEPTION 'anon unexpectedly has fulfillment job table privileges';
    END IF;

    IF NOT pg_catalog.has_table_privilege('authenticated', 'public.fulfillment_jobs', 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.fulfillment_jobs', 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.fulfillment_jobs', 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.fulfillment_jobs', 'DELETE') THEN
        RAISE EXCEPTION 'authenticated fulfillment job privileges are not read-only';
    END IF;

    IF NOT pg_catalog.has_table_privilege('service_role', 'public.fulfillment_jobs', 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.fulfillment_jobs', 'INSERT')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.fulfillment_jobs', 'UPDATE')
       OR NOT pg_catalog.has_table_privilege('service_role', 'public.fulfillment_jobs', 'DELETE') THEN
        RAISE EXCEPTION 'service_role lacks required fulfillment job worker privileges';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'fulfillment_jobs'
          AND policyname = 'Admin operations readers can view fulfillment jobs'
          AND cmd = 'SELECT'
          AND 'authenticated' = ANY(roles)
          AND COALESCE(qual, '') ILIKE '%operations.read%'
    ) <> 1 OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'fulfillment_jobs'
          AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
          AND (
              'authenticated' = ANY(roles)
              OR 'public' = ANY(roles)
          )
    ) THEN
        RAISE EXCEPTION 'fulfillment job RLS policies are not admin read-only';
    END IF;

    IF pg_catalog.has_function_privilege(
        'anon',
        'public.admin_recover_fulfillment_job(uuid,text,uuid)',
        'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'authenticated',
        'public.admin_recover_fulfillment_job(uuid,text,uuid)',
        'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
        'service_role',
        'public.admin_recover_fulfillment_job(uuid,text,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'fulfillment recovery grants are not service-role only';
    END IF;

    SELECT * INTO recovered
    FROM public.admin_recover_fulfillment_job(
        '99110000-0000-4000-8000-000000000001',
        'retry',
        '99100000-0000-4000-8000-000000000001'
    );

    IF recovered.status <> 'pending'
       OR recovered.attempts <> 0
       OR recovered.locked_at IS NOT NULL
       OR recovered.locked_by IS NOT NULL
       OR recovered.last_error IS NOT NULL THEN
        RAISE EXCEPTION 'retry did not restore the expected pending state';
    END IF;

    IF (SELECT COUNT(*) FROM public.admin_audit_log
        WHERE admin_id = '99100000-0000-4000-8000-000000000001'
          AND action = 'fulfillment_job.retry'
          AND entity_type = 'fulfillment_job'
          AND entity_id = '99110000-0000-4000-8000-000000000001'
          AND before->>'status' = 'failed'
          AND after->>'status' = 'pending') <> 1 THEN
        RAISE EXCEPTION 'retry audit evidence was not written atomically';
    END IF;

    UPDATE public.fulfillment_jobs
    SET status = 'processing', attempts = 5, locked_by = 'stale-worker'
    WHERE id = '99110000-0000-4000-8000-000000000001'
      AND status = 'failed'
      AND attempts = 4
      AND updated_at = '2026-08-02 00:00:00+00';
    GET DIAGNOSTICS stale_claim_count = ROW_COUNT;
    IF stale_claim_count <> 0 THEN
        RAISE EXCEPTION 'a stale worker snapshot overwrote an administrative retry';
    END IF;

    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000002',
            'cancel',
            '99100000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'processing job cancellation unexpectedly succeeded';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    IF (SELECT status FROM public.fulfillment_jobs
        WHERE id = '99110000-0000-4000-8000-000000000002') <> 'processing' THEN
        RAISE EXCEPTION 'cancel changed an actively processing job';
    END IF;

    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000002',
            'retry',
            '99100000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'processing job retry unexpectedly succeeded';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000005',
            'retry',
            '99100000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'succeeded job retry unexpectedly succeeded';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000005',
            'cancel',
            '99100000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'succeeded job cancellation unexpectedly succeeded';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000006',
            'cancel',
            '99100000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'cancelled job cancellation unexpectedly succeeded';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;

    SELECT * INTO recovered
    FROM public.admin_recover_fulfillment_job(
        '99110000-0000-4000-8000-000000000004',
        'cancel',
        '99100000-0000-4000-8000-000000000001'
    );

    IF recovered.status <> 'cancelled'
       OR recovered.attempts <> 3
       OR recovered.last_error <> 'cancel this job' THEN
        RAISE EXCEPTION 'cancel did not preserve the expected terminal state';
    END IF;

    IF (SELECT COUNT(*) FROM public.admin_audit_log
        WHERE admin_id = '99100000-0000-4000-8000-000000000001'
          AND action = 'fulfillment_job.cancel'
          AND entity_type = 'fulfillment_job'
          AND entity_id = '99110000-0000-4000-8000-000000000004'
          AND before->>'status' = 'failed'
          AND after->>'status' = 'cancelled') <> 1 THEN
        RAISE EXCEPTION 'cancel audit evidence was not written atomically';
    END IF;

    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000003',
            'retry',
            '99100000-0000-4000-8000-000000000002'
        );
        RAISE EXCEPTION 'non-admin actor unexpectedly recovered a job';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;

SELECT pg_catalog.set_config(
    'request.jwt.claim.sub',
    '99100000-0000-4000-8000-000000000001',
    TRUE
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
    BEGIN
        UPDATE public.fulfillment_jobs
        SET attempts = 99
        WHERE id = '99110000-0000-4000-8000-000000000003';
        RAISE EXCEPTION 'authenticated admin unexpectedly updated a fulfillment job directly';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;

RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', TRUE);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.fulfillment_jobs
        WHERE id = '99110000-0000-4000-8000-000000000003'
          AND attempts = 2
          AND status = 'failed'
    ) THEN
        RAISE EXCEPTION 'authenticated direct update changed the protected fulfillment job';
    END IF;
END;
$$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
    recovered public.fulfillment_jobs%ROWTYPE;
BEGIN
    SELECT * INTO recovered
    FROM public.admin_recover_fulfillment_job(
        '99110000-0000-4000-8000-000000000007',
        'retry',
        '99100000-0000-4000-8000-000000000001'
    );

    IF recovered.status <> 'pending'
       OR recovered.attempts <> 0
       OR recovered.last_error IS NOT NULL THEN
        RAISE EXCEPTION 'service_role RPC did not recover the cancelled job';
    END IF;
END;
$$;

RESET ROLE;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.admin_audit_log
        WHERE admin_id = '99100000-0000-4000-8000-000000000001'
          AND action = 'fulfillment_job.retry'
          AND entity_type = 'fulfillment_job'
          AND entity_id = '99110000-0000-4000-8000-000000000007'
          AND before->>'status' = 'cancelled'
          AND after->>'status' = 'pending') <> 1 THEN
        RAISE EXCEPTION 'service_role recovery did not write atomic audit evidence';
    END IF;
END;
$$;

CREATE FUNCTION pg_temp.reject_fulfillment_recovery_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.entity_id = '99110000-0000-4000-8000-000000000003' THEN
        RAISE EXCEPTION 'forced audit failure' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reject_fulfillment_recovery_audit
    BEFORE INSERT ON public.admin_audit_log
    FOR EACH ROW
    EXECUTE FUNCTION pg_temp.reject_fulfillment_recovery_audit();

DO $$
BEGIN
    BEGIN
        PERFORM public.admin_recover_fulfillment_job(
            '99110000-0000-4000-8000-000000000003',
            'retry',
            '99100000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'recovery unexpectedly survived an audit failure';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM public.fulfillment_jobs
        WHERE id = '99110000-0000-4000-8000-000000000003'
          AND status = 'failed'
          AND attempts = 2
          AND last_error = 'audit must roll back this retry'
    ) THEN
        RAISE EXCEPTION 'job mutation was not rolled back with its failed audit';
    END IF;
END;
$$;

ROLLBACK;
