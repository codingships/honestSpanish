ALTER TABLE public.fulfillment_jobs
    DROP CONSTRAINT IF EXISTS fulfillment_jobs_job_type_check;

ALTER TABLE public.fulfillment_jobs
    ADD CONSTRAINT fulfillment_jobs_job_type_check
    CHECK (job_type IN (
        'session_fulfillment',
        'bulk_session_fulfillment',
        'welcome_fulfillment',
        'session_cancellation',
        'renewal_notice'
    ));

ALTER TABLE public.fulfillment_jobs
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_jobs_type_dedupe
    ON public.fulfillment_jobs(job_type, dedupe_key)
    WHERE dedupe_key IS NOT NULL;
