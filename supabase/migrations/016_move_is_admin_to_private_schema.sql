-- Move the admin RLS helper out of the exposed public API schema.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = (select auth.uid())
          AND role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION private.is_admin() FROM public;
REVOKE ALL ON FUNCTION private.is_admin() FROM anon;
REVOKE ALL ON FUNCTION private.is_admin() FROM authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_audit_log' AND policyname = 'Admins can view audit log') THEN
        EXECUTE $sql$ALTER POLICY "Admins can view audit log" ON public.admin_audit_log USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fulfillment_jobs' AND policyname = 'Admins can manage fulfillment jobs') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage fulfillment jobs" ON public.fulfillment_jobs USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'Admins can manage leads') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage leads" ON public.leads USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'Admins can view leads') THEN
        EXECUTE $sql$ALTER POLICY "Admins can view leads" ON public.leads USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'packages' AND policyname = 'Admins can manage packages') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage packages" ON public.packages USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payments' AND policyname = 'Admins can manage payments') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage payments" ON public.payments USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'processed_webhook_events' AND policyname = 'Admins can view processed webhook events') THEN
        EXECUTE $sql$ALTER POLICY "Admins can view processed webhook events" ON public.processed_webhook_events USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Admins can do everything on profiles') THEN
        EXECUTE $sql$ALTER POLICY "Admins can do everything on profiles" ON public.profiles USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles_private' AND policyname = 'Admins can manage profiles_private') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage profiles_private" ON public.profiles_private USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname = 'Admins can manage sessions') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage sessions" ON public.sessions USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_teachers' AND policyname = 'Admins can manage assignments') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage assignments" ON public.student_teachers USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'Admins can manage subscriptions') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage subscriptions" ON public.subscriptions USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'teacher_availability' AND policyname = 'Admins can manage all availability') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage all availability" ON public.teacher_availability USING ((select private.is_admin()))$sql$;
    END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;
