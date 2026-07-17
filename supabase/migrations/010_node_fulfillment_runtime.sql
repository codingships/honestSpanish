-- Node fulfillment runtime.
-- Adds cancellation fulfillment jobs so Google Calendar and cancellation emails
-- are processed outside the Cloudflare Pages runtime.

ALTER TABLE public.fulfillment_jobs
    DROP CONSTRAINT IF EXISTS fulfillment_jobs_job_type_check;

ALTER TABLE public.fulfillment_jobs
    ADD CONSTRAINT fulfillment_jobs_job_type_check
    CHECK (job_type IN (
        'session_fulfillment',
        'bulk_session_fulfillment',
        'welcome_fulfillment',
        'session_cancellation'
    ));
