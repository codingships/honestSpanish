ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS level_check_status TEXT NOT NULL DEFAULT 'not_requested',
    ADD COLUMN IF NOT EXISTS level_check_context JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS level_check_summary TEXT,
    ADD COLUMN IF NOT EXISTS level_check_estimated_level TEXT,
    ADD COLUMN IF NOT EXISTS level_check_confidence TEXT,
    ADD COLUMN IF NOT EXISTS level_check_plan_recommendation TEXT,
    ADD COLUMN IF NOT EXISTS level_check_fit_flags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS level_check_received_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS level_check_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS level_check_raw_cleared_at TIMESTAMPTZ;

DO $$
BEGIN
    ALTER TABLE public.leads
        ADD CONSTRAINT leads_level_check_status_check
        CHECK (level_check_status IN ('not_requested', 'recommended', 'sent', 'received', 'reviewed', 'waived'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.leads
        ADD CONSTRAINT leads_level_check_confidence_check
        CHECK (level_check_confidence IS NULL OR level_check_confidence IN ('low', 'medium', 'high'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.leads.level_check_status IS 'Operational status for the lightweight level diagnostic, separate from the legacy lead lifecycle.';
COMMENT ON COLUMN public.leads.level_check_context IS 'Temporary lightweight diagnostic answers. Raw context should be cleared when a lead is discarded.';
COMMENT ON COLUMN public.leads.level_check_summary IS 'CRM-safe summary of the diagnostic used for manual review and later comparison.';
COMMENT ON COLUMN public.leads.level_check_raw_cleared_at IS 'Timestamp proving raw diagnostic context was cleared after discard or retention decision.';

CREATE INDEX IF NOT EXISTS leads_level_check_status_idx
    ON public.leads (level_check_status, level_check_received_at DESC);

CREATE INDEX IF NOT EXISTS leads_level_check_fit_flags_idx
    ON public.leads USING GIN (level_check_fit_flags);
