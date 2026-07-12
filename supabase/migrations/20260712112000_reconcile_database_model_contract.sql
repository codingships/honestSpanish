-- Reconcile historical hosted-schema drift with db/schema.sql before the
-- remaining release-candidate hardening migrations are applied.

ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
DECLARE
    v_lead_status_type OID;
    v_status_column_type OID;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.leads
        WHERE status IS NULL
           OR created_at IS NULL
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23502',
            MESSAGE = 'Cannot enforce the canonical leads contract: null status or created_at values exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.leads
        WHERE status IS NOT NULL
          AND status::TEXT NOT IN ('new', 'contacted', 'discarded')
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Cannot convert leads.status to public.lead_status: unsupported values exist';
    END IF;

    v_lead_status_type := to_regtype('public.lead_status');

    IF v_lead_status_type IS NULL THEN
        EXECUTE 'CREATE TYPE public.lead_status AS ENUM (''new'', ''contacted'', ''discarded'')';
        v_lead_status_type := to_regtype('public.lead_status');
    END IF;

    SELECT attribute.atttypid
    INTO v_status_column_type
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.leads'::regclass
      AND attribute.attname = 'status'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;

    IF v_status_column_type IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '42703',
            MESSAGE = 'Cannot reconcile leads.status: column does not exist';
    END IF;

    -- Production historically enforced the text column with this check. Drop
    -- it only after the equivalent enum-domain validation above has passed.
    ALTER TABLE public.leads
        DROP CONSTRAINT IF EXISTS leads_status_check;

    IF v_status_column_type <> v_lead_status_type THEN
        ALTER TABLE public.leads
            ALTER COLUMN status DROP DEFAULT;

        EXECUTE $sql$
            ALTER TABLE public.leads
                ALTER COLUMN status TYPE public.lead_status
                USING status::TEXT::public.lead_status
        $sql$;
    END IF;
END $$;

ALTER TABLE public.leads
    ALTER COLUMN updated_at SET DEFAULT NOW(),
    ALTER COLUMN lang SET DEFAULT 'es'::TEXT,
    ALTER COLUMN consent_given SET DEFAULT FALSE,
    ALTER COLUMN status SET DEFAULT 'new'::public.lead_status,
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT timezone('utc'::TEXT, NOW()),
    ALTER COLUMN created_at SET NOT NULL;

REVOKE ALL ON TABLE public.leads FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leads TO service_role;

-- private.is_admin() is the only supported policy helper. Intentionally omit
-- CASCADE so unexpected dependencies stop the migration instead of disappearing.
DROP FUNCTION IF EXISTS public.is_admin();

-- Preserve any value that may still live only in a legacy session column. The
-- earlier drift migration already performed the first backfill; these guards
-- make the final cleanup independently safe and idempotent.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'drive_doc_link'
    ) THEN
        EXECUTE $sql$
            UPDATE public.sessions
            SET drive_doc_url = COALESCE(drive_doc_url, drive_doc_link)
            WHERE drive_doc_link IS NOT NULL
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'google_calendar_event_id'
    ) THEN
        EXECUTE $sql$
            UPDATE public.sessions
            SET calendar_event_id = COALESCE(calendar_event_id, google_calendar_event_id)
            WHERE google_calendar_event_id IS NOT NULL
        $sql$;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'google_meet_link'
    ) THEN
        EXECUTE $sql$
            UPDATE public.sessions
            SET meet_link = COALESCE(meet_link, google_meet_link)
            WHERE google_meet_link IS NOT NULL
        $sql$;
    END IF;
END $$;

ALTER TABLE public.sessions
    DROP COLUMN IF EXISTS drive_doc_link,
    DROP COLUMN IF EXISTS google_calendar_event_id,
    DROP COLUMN IF EXISTS google_meet_link;

-- This field was historically added from an ad-hoc SQL script even though the
-- fulfillment Worker relies on it. Absorb it into the deployable history and
-- make null impossible so reminder claims cannot silently skip a session.
ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;

UPDATE public.sessions
SET reminder_sent = FALSE
WHERE reminder_sent IS NULL;

ALTER TABLE public.sessions
    ALTER COLUMN reminder_sent SET DEFAULT FALSE,
    ALTER COLUMN reminder_sent SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_reminder_pending
    ON public.sessions (scheduled_at, status, reminder_sent)
    WHERE status = 'scheduled' AND reminder_sent = FALSE;

-- Both hosted projects received these objects outside the migration history.
-- Keep fresh databases and migration-built environments equivalent.
CREATE INDEX IF NOT EXISTS idx_profiles_role
    ON public.profiles(role);

DROP POLICY IF EXISTS "Students can view their teachers" ON public.profiles;
CREATE POLICY "Students can view their teachers"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.student_teachers AS assignment
        WHERE assignment.student_id = (SELECT auth.uid())
          AND assignment.teacher_id = profiles.id
    ));

-- Historical user-facing policies were created without an explicit target
-- role and invoked auth.uid() once per candidate row. Keep the same access
-- model while limiting it to authenticated users and allowing Postgres to
-- cache the request identity as an initplan.
DROP POLICY IF EXISTS "Students can view own payments" ON public.payments;
CREATE POLICY "Students can view own payments"
    ON public.payments FOR SELECT
    TO authenticated
    USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Teachers can view their students" ON public.profiles;
CREATE POLICY "Teachers can view their students"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.student_teachers AS assignment
        WHERE assignment.teacher_id = (SELECT auth.uid())
          AND assignment.student_id = profiles.id
    ));

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Students can view own sessions" ON public.sessions;
CREATE POLICY "Students can view own sessions"
    ON public.sessions FOR SELECT
    TO authenticated
    USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Teachers can view assigned sessions" ON public.sessions;
CREATE POLICY "Teachers can view assigned sessions"
    ON public.sessions FOR SELECT
    TO authenticated
    USING (teacher_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can see their teachers" ON public.student_teachers;
CREATE POLICY "Students can see their teachers"
    ON public.student_teachers FOR SELECT
    TO authenticated
    USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Teachers can see their students" ON public.student_teachers;
CREATE POLICY "Teachers can see their students"
    ON public.student_teachers FOR SELECT
    TO authenticated
    USING (teacher_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Students can view own subscriptions" ON public.subscriptions;
CREATE POLICY "Students can view own subscriptions"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (student_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Teachers can view assigned student subscriptions" ON public.subscriptions;
CREATE POLICY "Teachers can view assigned student subscriptions"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.student_teachers AS assignment
        WHERE assignment.teacher_id = (SELECT auth.uid())
          AND assignment.student_id = subscriptions.student_id
    ));

DROP POLICY IF EXISTS "Students can view assigned teacher availability" ON public.teacher_availability;
CREATE POLICY "Students can view assigned teacher availability"
    ON public.teacher_availability FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1
        FROM public.student_teachers AS assignment
        WHERE assignment.student_id = (SELECT auth.uid())
          AND assignment.teacher_id = teacher_availability.teacher_id
    ));

DROP POLICY IF EXISTS "Teachers can manage own availability" ON public.teacher_availability;
CREATE POLICY "Teachers can manage own availability"
    ON public.teacher_availability FOR ALL
    TO authenticated
    USING (teacher_id = (SELECT auth.uid()))
    WITH CHECK (teacher_id = (SELECT auth.uid()));

-- Follow-up after hosted application: regenerate src/types/database.types.ts
-- from the reconciled Supabase staging schema.
