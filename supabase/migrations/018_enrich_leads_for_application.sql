-- Enrich public lead applications so "solicitar plaza" can be reviewed
-- without pushing users straight into checkout.

ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS current_level TEXT,
ADD COLUMN IF NOT EXISTS learning_goal TEXT,
ADD COLUMN IF NOT EXISTS availability TEXT,
ADD COLUMN IF NOT EXISTS source_path TEXT;

COMMENT ON COLUMN public.leads.current_level IS 'Self-reported Spanish level from the application form.';
COMMENT ON COLUMN public.leads.learning_goal IS 'Free-text learning goal / reason for requesting a place.';
COMMENT ON COLUMN public.leads.availability IS 'Free-text availability notes for scheduling fit.';
COMMENT ON COLUMN public.leads.source_path IS 'Public site path where the lead application was submitted.';
