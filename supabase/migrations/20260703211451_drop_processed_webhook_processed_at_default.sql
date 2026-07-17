-- Canonicalize processed_webhook_events.processed_at across staging, production
-- and db/schema.sql. New processing claims must stay unprocessed unless the
-- webhook handler explicitly marks them succeeded.
ALTER TABLE public.processed_webhook_events
    ALTER COLUMN processed_at DROP DEFAULT;
