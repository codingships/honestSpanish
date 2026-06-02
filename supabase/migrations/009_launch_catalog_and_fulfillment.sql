-- Launch catalog + fulfillment reliability.
-- Apply before enabling public checkout for the current product catalog.

ALTER TABLE public.packages
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'packages_name_unique'
            AND conrelid = 'public.packages'::regclass
    ) THEN
        ALTER TABLE public.packages
            ADD CONSTRAINT packages_name_unique UNIQUE (name);
    END IF;
END $$;

ALTER TABLE public.sessions
    ALTER COLUMN duration_minutes SET DEFAULT 55;

CREATE TABLE IF NOT EXISTS public.fulfillment_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL CHECK (job_type IN ('session_fulfillment', 'bulk_session_fulfillment', 'welcome_fulfillment')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    before JSONB,
    after JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_due
    ON public.fulfillment_jobs(status, run_at)
    WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_session
    ON public.fulfillment_jobs(session_id)
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin
    ON public.admin_audit_log(admin_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity
    ON public.admin_audit_log(entity_type, entity_id);

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$;

DROP POLICY IF EXISTS "Admins can view processed webhook events" ON public.processed_webhook_events;
CREATE POLICY "Admins can view processed webhook events"
    ON public.processed_webhook_events FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage fulfillment jobs" ON public.fulfillment_jobs;
CREATE POLICY "Admins can manage fulfillment jobs"
    ON public.fulfillment_jobs FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can view audit log" ON public.admin_audit_log;
CREATE POLICY "Admins can view audit log"
    ON public.admin_audit_log FOR SELECT USING (public.is_admin());

DROP TRIGGER IF EXISTS update_packages_updated_at ON public.packages;
CREATE TRIGGER update_packages_updated_at
    BEFORE UPDATE ON public.packages
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_fulfillment_jobs_updated_at ON public.fulfillment_jobs;
CREATE TRIGGER update_fulfillment_jobs_updated_at
    BEFORE UPDATE ON public.fulfillment_jobs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

INSERT INTO public.packages (name, display_name, price_monthly, sessions_per_month, has_group_session, has_dual_teacher, is_active)
VALUES
    ('group', '{"es": "Grupal Externo", "en": "External Group", "ru": "Групповые занятия"}', 5000, 4, TRUE, FALSE, TRUE),
    ('standard', '{"es": "Mensual Estándar", "en": "Standard Monthly", "ru": "Стандартный месяц"}', 14500, 4, FALSE, FALSE, TRUE),
    ('hybrid', '{"es": "Híbrido Mensual", "en": "Hybrid Monthly", "ru": "Гибридный месяц"}', 15000, 4, TRUE, TRUE, TRUE),
    ('bootcamp', '{"es": "Intensivo Bootcamp", "en": "Bootcamp Intensive", "ru": "Интенсив Bootcamp"}', 34500, 20, FALSE, FALSE, TRUE)
ON CONFLICT (name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    price_monthly = EXCLUDED.price_monthly,
    sessions_per_month = EXCLUDED.sessions_per_month,
    has_group_session = EXCLUDED.has_group_session,
    has_dual_teacher = EXCLUDED.has_dual_teacher,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
