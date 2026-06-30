-- Capture the public plan selected before a visitor submits an application.
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS preferred_package TEXT;

COMMENT ON COLUMN public.leads.preferred_package IS 'Package key selected on public pricing before submitting the application form.';
