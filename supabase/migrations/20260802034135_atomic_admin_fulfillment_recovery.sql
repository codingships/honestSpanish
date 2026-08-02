REVOKE ALL PRIVILEGES ON TABLE public.fulfillment_jobs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.fulfillment_jobs FROM authenticated;
GRANT SELECT ON TABLE public.fulfillment_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fulfillment_jobs TO service_role;

DROP POLICY IF EXISTS "Admins can manage fulfillment jobs" ON public.fulfillment_jobs;
DROP POLICY IF EXISTS "Admins can view fulfillment jobs" ON public.fulfillment_jobs;
CREATE POLICY "Admins can view fulfillment jobs"
    ON public.fulfillment_jobs
    FOR SELECT
    TO authenticated
    USING ((SELECT private.is_admin()));

CREATE OR REPLACE FUNCTION public.admin_recover_fulfillment_job(
    p_job_id UUID,
    p_action TEXT,
    p_admin_id UUID
)
RETURNS public.fulfillment_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    job_before public.fulfillment_jobs%ROWTYPE;
    job_after public.fulfillment_jobs%ROWTYPE;
BEGIN
    IF p_job_id IS NULL
       OR p_admin_id IS NULL
       OR p_action NOT IN ('retry', 'cancel') THEN
        RAISE EXCEPTION 'invalid_fulfillment_job_recovery'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_admin_id
          AND role = 'admin'::public.user_role
    ) THEN
        RAISE EXCEPTION 'fulfillment_job_recovery_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
    INTO job_before
    FROM public.fulfillment_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fulfillment_job_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_action = 'retry' THEN
        IF job_before.status NOT IN ('pending', 'failed', 'cancelled')
           OR job_before.locked_at IS NOT NULL
           OR job_before.locked_by IS NOT NULL THEN
            RAISE EXCEPTION 'fulfillment_job_recovery_conflict'
                USING ERRCODE = '40001';
        END IF;

        UPDATE public.fulfillment_jobs
        SET status = 'pending',
            attempts = 0,
            run_at = pg_catalog.clock_timestamp(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = NULL
        WHERE id = job_before.id
        RETURNING * INTO job_after;
    ELSE
        IF job_before.status NOT IN ('pending', 'failed')
           OR job_before.locked_at IS NOT NULL
           OR job_before.locked_by IS NOT NULL THEN
            RAISE EXCEPTION 'fulfillment_job_recovery_conflict'
                USING ERRCODE = '40001';
        END IF;

        UPDATE public.fulfillment_jobs
        SET status = 'cancelled',
            locked_at = NULL,
            locked_by = NULL
        WHERE id = job_before.id
        RETURNING * INTO job_after;
    END IF;

    INSERT INTO public.admin_audit_log (
        admin_id,
        action,
        entity_type,
        entity_id,
        before,
        after
    ) VALUES (
        p_admin_id,
        'fulfillment_job.' || p_action,
        'fulfillment_job',
        job_before.id::TEXT,
        pg_catalog.to_jsonb(job_before),
        pg_catalog.to_jsonb(job_after)
    );

    RETURN job_after;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_recover_fulfillment_job(UUID, TEXT, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_recover_fulfillment_job(UUID, TEXT, UUID)
    TO service_role;

COMMENT ON FUNCTION public.admin_recover_fulfillment_job(UUID, TEXT, UUID) IS
    'Atomically retries or cancels an unlocked fulfillment job and writes the matching admin audit record.';
