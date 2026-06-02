-- =============================================
-- RECONCILE SCHEMA DRIFT WITH RUNTIME EXPECTATIONS
-- =============================================
--
-- Goals:
-- 1. Bring the formal migration chain back in line with the schema the app
--    actually uses today.
-- 2. Capture tables/columns that only existed in loose SQL files or context
--    dumps so a clean bootstrap is no longer misleading.
-- 3. Backfill canonical session column names from earlier migration variants.

-- Profiles: current academic level is used by scheduling/document flows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'current_level'
    ) THEN
        ALTER TABLE public.profiles
        ADD COLUMN current_level TEXT DEFAULT 'A2';
    END IF;
END $$;

-- Webhook idempotency table used by the Stripe webhook handler.
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRM leads table used by public subscription/signup capture flows.
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL,
    interest TEXT,
    lang TEXT,
    consent_given BOOLEAN NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'discarded'))
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'leads'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE public.leads
        ADD COLUMN status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'discarded'));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'leads'
          AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
          AND indexdef ILIKE '%(email)%'
    ) THEN
        ALTER TABLE public.leads
        ADD CONSTRAINT leads_email_unique UNIQUE (email);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'leads'
          AND policyname = 'Admins can view leads'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "Admins can view leads"
                ON public.leads FOR SELECT
                USING (is_admin())
        $policy$;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'leads'
          AND policyname = 'Admins can manage leads'
    ) THEN
        EXECUTE $policy$
            CREATE POLICY "Admins can manage leads"
                ON public.leads FOR ALL
                USING (is_admin())
        $policy$;
    END IF;
END $$;

-- Sessions: the app expects the canonical names below, but earlier migrations
-- used legacy variants. Ensure the canonical columns exist and backfill them.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'drive_doc_url'
    ) THEN
        ALTER TABLE public.sessions
        ADD COLUMN drive_doc_url TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'drive_doc_link'
    ) THEN
        UPDATE public.sessions
        SET drive_doc_url = COALESCE(drive_doc_url, drive_doc_link)
        WHERE drive_doc_link IS NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'calendar_event_id'
    ) THEN
        ALTER TABLE public.sessions
        ADD COLUMN calendar_event_id TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'google_calendar_event_id'
    ) THEN
        UPDATE public.sessions
        SET calendar_event_id = COALESCE(calendar_event_id, google_calendar_event_id)
        WHERE google_calendar_event_id IS NOT NULL;
    END IF;
END $$;

COMMENT ON COLUMN public.sessions.drive_doc_id IS 'Google Drive document ID for this class exercise document';
COMMENT ON COLUMN public.sessions.drive_doc_url IS 'Shareable link to the Google Drive document';
COMMENT ON COLUMN public.sessions.calendar_event_id IS 'Google Calendar event ID for this class';
