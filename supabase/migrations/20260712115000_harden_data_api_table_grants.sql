-- RLS controls rows but does not protect TRUNCATE, REFERENCES or TRIGGER.
-- Supabase's historical default grants also vary by project age. Reset the
-- public-schema table ACLs and re-grant only the operations represented by the
-- canonical RLS policies so restored and newly created projects behave alike.

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
FROM PUBLIC, anon, authenticated;

-- Schema-specific defaults cannot override a broader global default grant.
-- Remove both layers for objects created by the migration owner.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;

-- Every table exposed below must keep RLS enabled. Reassert the invariant in
-- the same transaction as the grants so a restored/drifted project cannot
-- expose whole tables merely because a policy definition still exists.
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_availability ENABLE ROW LEVEL SECURITY;

-- Public catalogue surface.
GRANT SELECT ON TABLE public.packages TO anon;

-- Tables with authenticated/admin ALL policies. RLS remains the row boundary.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.leads,
    public.crm_contacts,
    public.crm_opportunities,
    public.crm_tasks,
    public.crm_activities,
    public.crm_consents,
    public.fulfillment_jobs,
    public.packages,
    public.payments,
    public.profiles,
    public.profiles_private,
    public.sessions,
    public.student_teachers,
    public.subscriptions,
    public.teacher_availability
TO authenticated;

-- Read-only administrative surfaces.
GRANT SELECT ON TABLE
    public.admin_audit_log,
    public.processed_webhook_events
TO authenticated;

-- End users submit support requests; all reads and administration stay behind
-- the server-side service-role API.
GRANT INSERT ON TABLE public.support_tickets TO authenticated;
