-- Admin RLS policies should only run for authenticated users.
-- Otherwise anonymous reads can try to evaluate private.is_admin().

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_audit_log' AND policyname = 'Admins can view audit log') THEN
        EXECUTE $sql$ALTER POLICY "Admins can view audit log" ON public.admin_audit_log TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fulfillment_jobs' AND policyname = 'Admins can manage fulfillment jobs') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage fulfillment jobs" ON public.fulfillment_jobs TO authenticated USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'Admins can manage leads') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage leads" ON public.leads TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'Admins can view leads') THEN
        EXECUTE $sql$ALTER POLICY "Admins can view leads" ON public.leads TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'packages' AND policyname = 'Admins can manage packages') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage packages" ON public.packages TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'payments' AND policyname = 'Admins can manage payments') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage payments" ON public.payments TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'processed_webhook_events' AND policyname = 'Admins can view processed webhook events') THEN
        EXECUTE $sql$ALTER POLICY "Admins can view processed webhook events" ON public.processed_webhook_events TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Admins can do everything on profiles') THEN
        EXECUTE $sql$ALTER POLICY "Admins can do everything on profiles" ON public.profiles TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles_private' AND policyname = 'Admins can manage profiles_private') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage profiles_private" ON public.profiles_private TO authenticated USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname = 'Admins can manage sessions') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage sessions" ON public.sessions TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_teachers' AND policyname = 'Admins can manage assignments') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage assignments" ON public.student_teachers TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscriptions' AND policyname = 'Admins can manage subscriptions') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage subscriptions" ON public.subscriptions TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'teacher_availability' AND policyname = 'Admins can manage all availability') THEN
        EXECUTE $sql$ALTER POLICY "Admins can manage all availability" ON public.teacher_availability TO authenticated USING ((select private.is_admin()))$sql$;
    END IF;
END $$;
