-- Track Stripe webhook processing state so event idempotency is claimed before side effects.
ALTER TABLE public.processed_webhook_events
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS processing_status TEXT,
    ADD COLUMN IF NOT EXISTS processing_error TEXT,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

UPDATE public.processed_webhook_events
SET
    processing_status = COALESCE(processing_status, 'succeeded'),
    created_at = COALESCE(created_at, processed_at, NOW()),
    processed_at = COALESCE(processed_at, created_at, NOW())
WHERE processing_status IS NULL
   OR processed_at IS NULL
   OR created_at IS NULL;

ALTER TABLE public.processed_webhook_events
    ALTER COLUMN processing_status SET DEFAULT 'processing',
    ALTER COLUMN processing_status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'processed_webhook_events_processing_status_check'
          AND conrelid = 'public.processed_webhook_events'::regclass
    ) THEN
        ALTER TABLE public.processed_webhook_events
            ADD CONSTRAINT processed_webhook_events_processing_status_check
            CHECK (processing_status IN ('processing', 'succeeded', 'failed'));
    END IF;
END $$;
