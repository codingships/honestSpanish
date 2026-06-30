-- Capture language background on public lead applications.
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS spoken_languages TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
ADD COLUMN IF NOT EXISTS is_russian_speaker BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.leads.spoken_languages IS 'Self-reported languages relevant to lead fit. Values are normalized short labels such as ru, en, es or user-provided free text.';
COMMENT ON COLUMN public.leads.is_russian_speaker IS 'True when the lead explicitly indicates Russian language background.';

CREATE INDEX IF NOT EXISTS leads_spoken_languages_idx
    ON public.leads USING GIN (spoken_languages);

CREATE INDEX IF NOT EXISTS leads_is_russian_speaker_idx
    ON public.leads (is_russian_speaker)
    WHERE is_russian_speaker = TRUE;
