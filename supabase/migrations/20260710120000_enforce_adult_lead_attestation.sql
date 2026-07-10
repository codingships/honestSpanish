ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS adult_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS adult_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS age_policy_version TEXT;

COMMENT ON COLUMN public.leads.adult_confirmed IS 'Self-attestation that the applicant is at least 18 under the recorded age policy version.';
COMMENT ON COLUMN public.leads.adult_confirmed_at IS 'Server timestamp for the latest accepted adult self-attestation.';
COMMENT ON COLUMN public.leads.age_policy_version IS 'Version of the age policy accepted with the adult self-attestation.';
