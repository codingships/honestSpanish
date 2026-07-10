-- ESPANOL HONESTO - LEGACY RLS SECURITY PATCH
--
-- This manual patch is kept only as a historical/live-database aid.
-- Prefer the canonical migrations in supabase/migrations/, especially:
--   - 021_harden_session_write_policies.sql
--   - 20260702124757_harden_profile_role_trigger.sql
--
-- Current invariant:
-- - Students and teachers may read their allowed session rows.
-- - Students and teachers must not write sessions directly through the Data API.
-- - Server API routes perform quota, availability, cancellation-window,
--   transition and fulfillment checks, then write with service-role.

-- 1. PROFILES: let students read assigned teacher profiles.
DROP POLICY IF EXISTS "Students can view their teachers" ON public.profiles;
CREATE POLICY "Students can view their teachers"
    ON public.profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.student_teachers st
            WHERE st.student_id = auth.uid()
              AND st.teacher_id = profiles.id
        )
    );

-- 2. SESSIONS: remove historical direct student/teacher write paths.
DROP POLICY IF EXISTS "Students can cancel own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Teachers can create assigned sessions" ON public.sessions;
DROP POLICY IF EXISTS "Teachers can update assigned sessions" ON public.sessions;
DROP POLICY IF EXISTS "Teachers can view and update assigned sessions" ON public.sessions;

DROP POLICY IF EXISTS "Teachers can view assigned sessions" ON public.sessions;
CREATE POLICY "Teachers can view assigned sessions"
    ON public.sessions FOR SELECT
    USING (teacher_id = auth.uid());
