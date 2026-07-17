-- CRM core model: contacts, opportunities, tasks, activities and consent.
-- This is intentionally admin-only for v1; student/teacher-facing CRM access can be added later.

CREATE TABLE IF NOT EXISTS public.crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    primary_email TEXT NOT NULL CHECK (position('@' IN primary_email) > 1),
    full_name TEXT,
    phone TEXT,
    preferred_language TEXT DEFAULT 'es' CHECK (preferred_language IN ('es', 'en', 'ru')),
    timezone TEXT DEFAULT 'Europe/Madrid',
    country TEXT,
    lifecycle_stage TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle_stage IN ('lead', 'qualified', 'customer', 'alumni', 'inactive', 'lost')),
    source TEXT,
    source_path TEXT,
    owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    last_contacted_at TIMESTAMPTZ,
    next_follow_up_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
    legacy_lead_id UUID UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
    stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'to_contact', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'nurture')),
    interest TEXT,
    current_level TEXT,
    learning_goal TEXT,
    availability TEXT,
    preferred_package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    expected_value_cents INTEGER CHECK (expected_value_cents IS NULL OR expected_value_cents >= 0),
    probability_percent INTEGER CHECK (probability_percent IS NULL OR probability_percent BETWEEN 0 AND 100),
    lost_reason TEXT,
    converted_subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
    task_type TEXT NOT NULL DEFAULT 'review' CHECK (task_type IN ('email', 'call', 'whatsapp', 'review', 'admin')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'snoozed', 'cancelled')),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('note', 'email_in', 'email_out', 'call', 'whatsapp', 'meeting', 'support', 'payment', 'class', 'system')),
    subject TEXT,
    body TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    related_entity_type TEXT,
    related_entity_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.crm_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('email', 'phone', 'whatsapp')),
    purpose TEXT NOT NULL CHECK (purpose IN ('transactional', 'support', 'marketing', 'sales_follow_up')),
    legal_basis TEXT NOT NULL CHECK (legal_basis IN ('consent', 'contract', 'prior_customer_similar_services', 'legitimate_interest', 'manual_review_required')),
    source TEXT,
    proof TEXT,
    notice_version TEXT,
    captured_at TIMESTAMPTZ,
    opted_out_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.leads
    ADD COLUMN IF NOT EXISTS crm_contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS crm_opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_primary_email_lower_unique
    ON public.crm_contacts (lower(primary_email));
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_profile_id_unique
    ON public.crm_contacts (profile_id)
    WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_contacts_lifecycle_followup_idx
    ON public.crm_contacts (lifecycle_stage, next_follow_up_at);
CREATE INDEX IF NOT EXISTS crm_contacts_owner_followup_idx
    ON public.crm_contacts (owner_id, next_follow_up_at)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_opportunities_contact_idx
    ON public.crm_opportunities (contact_id);
CREATE INDEX IF NOT EXISTS crm_opportunities_open_stage_idx
    ON public.crm_opportunities (stage, opened_at DESC)
    WHERE stage IN ('new', 'to_contact', 'contacted', 'qualified', 'proposal', 'nurture');
CREATE INDEX IF NOT EXISTS crm_opportunities_assigned_stage_idx
    ON public.crm_opportunities (assigned_to, stage)
    WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_opportunities_preferred_package_idx
    ON public.crm_opportunities (preferred_package_id)
    WHERE preferred_package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_opportunities_converted_subscription_idx
    ON public.crm_opportunities (converted_subscription_id)
    WHERE converted_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_tasks_contact_idx
    ON public.crm_tasks (contact_id);
CREATE INDEX IF NOT EXISTS crm_tasks_opportunity_idx
    ON public.crm_tasks (opportunity_id)
    WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_tasks_assigned_status_due_idx
    ON public.crm_tasks (assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS crm_tasks_open_due_idx
    ON public.crm_tasks (due_at)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS crm_activities_contact_occurred_idx
    ON public.crm_activities (contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_opportunity_idx
    ON public.crm_activities (opportunity_id)
    WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_activities_actor_idx
    ON public.crm_activities (actor_id)
    WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_activities_type_occurred_idx
    ON public.crm_activities (activity_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_activities_related_entity_idx
    ON public.crm_activities (related_entity_type, related_entity_id)
    WHERE related_entity_type IS NOT NULL AND related_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS crm_consents_contact_idx
    ON public.crm_consents (contact_id);
CREATE INDEX IF NOT EXISTS crm_consents_channel_purpose_idx
    ON public.crm_consents (channel, purpose, opted_out_at);
CREATE UNIQUE INDEX IF NOT EXISTS crm_consents_one_active_per_contact_channel_purpose
    ON public.crm_consents (contact_id, channel, purpose)
    WHERE opted_out_at IS NULL;

CREATE INDEX IF NOT EXISTS leads_crm_contact_idx
    ON public.leads (crm_contact_id)
    WHERE crm_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_crm_opportunity_idx
    ON public.leads (crm_opportunity_id)
    WHERE crm_opportunity_id IS NOT NULL;

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_consents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.leads,
    public.crm_contacts,
    public.crm_opportunities,
    public.crm_tasks,
    public.crm_activities,
    public.crm_consents
FROM anon;

REVOKE ALL ON TABLE
    public.leads,
    public.crm_contacts,
    public.crm_opportunities,
    public.crm_tasks,
    public.crm_activities,
    public.crm_consents
FROM public;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.leads,
    public.crm_contacts,
    public.crm_opportunities,
    public.crm_tasks,
    public.crm_activities,
    public.crm_consents
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.leads,
    public.crm_contacts,
    public.crm_opportunities,
    public.crm_tasks,
    public.crm_activities,
    public.crm_consents
TO service_role;

DROP POLICY IF EXISTS "Admins can manage crm contacts" ON public.crm_contacts;
CREATE POLICY "Admins can manage crm contacts"
    ON public.crm_contacts FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

DROP POLICY IF EXISTS "Admins can manage crm opportunities" ON public.crm_opportunities;
CREATE POLICY "Admins can manage crm opportunities"
    ON public.crm_opportunities FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

DROP POLICY IF EXISTS "Admins can manage crm tasks" ON public.crm_tasks;
CREATE POLICY "Admins can manage crm tasks"
    ON public.crm_tasks FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

DROP POLICY IF EXISTS "Admins can manage crm activities" ON public.crm_activities;
CREATE POLICY "Admins can manage crm activities"
    ON public.crm_activities FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

DROP POLICY IF EXISTS "Admins can manage crm consents" ON public.crm_consents;
CREATE POLICY "Admins can manage crm consents"
    ON public.crm_consents FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

DROP TRIGGER IF EXISTS update_crm_contacts_updated_at ON public.crm_contacts;
CREATE TRIGGER update_crm_contacts_updated_at
    BEFORE UPDATE ON public.crm_contacts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_crm_opportunities_updated_at ON public.crm_opportunities;
CREATE TRIGGER update_crm_opportunities_updated_at
    BEFORE UPDATE ON public.crm_opportunities
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_crm_tasks_updated_at ON public.crm_tasks;
CREATE TRIGGER update_crm_tasks_updated_at
    BEFORE UPDATE ON public.crm_tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_crm_consents_updated_at ON public.crm_consents;
CREATE TRIGGER update_crm_consents_updated_at
    BEFORE UPDATE ON public.crm_consents
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Backfill existing students as CRM contacts.
INSERT INTO public.crm_contacts (
    profile_id,
    primary_email,
    full_name,
    phone,
    preferred_language,
    timezone,
    lifecycle_stage,
    source,
    created_at,
    updated_at
)
SELECT
    p.id,
    lower(p.email),
    p.full_name,
    p.phone,
    p.preferred_language,
    p.timezone,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM public.subscriptions s
            WHERE s.student_id = p.id AND s.status = 'active'
        ) THEN 'customer'
        WHEN EXISTS (
            SELECT 1 FROM public.subscriptions s
            WHERE s.student_id = p.id
        ) THEN 'alumni'
        ELSE 'inactive'
    END,
    'profile',
    p.created_at,
    p.updated_at
FROM public.profiles p
WHERE p.role = 'student'
  AND p.email IS NOT NULL
ON CONFLICT ((lower(primary_email))) DO UPDATE SET
    profile_id = COALESCE(public.crm_contacts.profile_id, EXCLUDED.profile_id),
    full_name = COALESCE(public.crm_contacts.full_name, EXCLUDED.full_name),
    phone = COALESCE(public.crm_contacts.phone, EXCLUDED.phone),
    preferred_language = COALESCE(public.crm_contacts.preferred_language, EXCLUDED.preferred_language),
    timezone = COALESCE(public.crm_contacts.timezone, EXCLUDED.timezone),
    lifecycle_stage = CASE
        WHEN EXCLUDED.lifecycle_stage IN ('customer', 'alumni') THEN EXCLUDED.lifecycle_stage
        ELSE public.crm_contacts.lifecycle_stage
    END,
    updated_at = NOW();

-- Backfill public lead forms as contacts.
INSERT INTO public.crm_contacts (
    primary_email,
    full_name,
    preferred_language,
    lifecycle_stage,
    source,
    source_path,
    created_at,
    updated_at
)
SELECT
    lower(l.email),
    l.name,
    COALESCE(l.lang, 'es'),
    CASE
        WHEN l.status = 'contacted' THEN 'qualified'
        WHEN l.status = 'discarded' THEN 'lost'
        ELSE 'lead'
    END,
    'lead_form',
    l.source_path,
    l.created_at,
    l.updated_at
FROM public.leads l
WHERE l.email IS NOT NULL
ON CONFLICT ((lower(primary_email))) DO UPDATE SET
    full_name = COALESCE(public.crm_contacts.full_name, EXCLUDED.full_name),
    preferred_language = COALESCE(public.crm_contacts.preferred_language, EXCLUDED.preferred_language),
    source = COALESCE(public.crm_contacts.source, EXCLUDED.source),
    source_path = COALESCE(public.crm_contacts.source_path, EXCLUDED.source_path),
    lifecycle_stage = CASE
        WHEN public.crm_contacts.lifecycle_stage IN ('customer', 'alumni') THEN public.crm_contacts.lifecycle_stage
        ELSE EXCLUDED.lifecycle_stage
    END,
    updated_at = NOW();

-- Backfill leads as sales opportunities.
INSERT INTO public.crm_opportunities (
    contact_id,
    legacy_lead_id,
    stage,
    interest,
    current_level,
    learning_goal,
    availability,
    preferred_package_id,
    opened_at,
    created_at,
    updated_at
)
SELECT
    c.id,
    l.id,
    CASE
        WHEN l.status = 'contacted' THEN 'contacted'
        WHEN l.status = 'discarded' THEN 'lost'
        ELSE 'new'
    END,
    l.interest,
    l.current_level,
    l.learning_goal,
    l.availability,
    pkg.id,
    COALESCE(l.created_at, NOW()),
    l.created_at,
    l.updated_at
FROM public.leads l
JOIN public.crm_contacts c ON lower(c.primary_email) = lower(l.email)
LEFT JOIN public.packages pkg ON pkg.name = l.preferred_package
ON CONFLICT (legacy_lead_id) DO UPDATE SET
    contact_id = EXCLUDED.contact_id,
    stage = EXCLUDED.stage,
    interest = EXCLUDED.interest,
    current_level = EXCLUDED.current_level,
    learning_goal = EXCLUDED.learning_goal,
    availability = EXCLUDED.availability,
    preferred_package_id = EXCLUDED.preferred_package_id,
    updated_at = NOW();

UPDATE public.leads l
SET
    crm_contact_id = c.id,
    crm_opportunity_id = o.id
FROM public.crm_contacts c
JOIN public.crm_opportunities o ON o.contact_id = c.id
WHERE o.legacy_lead_id = l.id
  AND lower(c.primary_email) = lower(l.email);

INSERT INTO public.crm_consents (
    contact_id,
    channel,
    purpose,
    legal_basis,
    source,
    proof,
    captured_at,
    created_at,
    updated_at
)
SELECT
    c.id,
    'email',
    'sales_follow_up',
    CASE WHEN l.consent_given THEN 'consent' ELSE 'manual_review_required' END,
    'lead_form',
    l.source_path,
    l.created_at,
    l.created_at,
    l.updated_at
FROM public.leads l
JOIN public.crm_contacts c ON c.id = l.crm_contact_id
WHERE l.email IS NOT NULL
ON CONFLICT (contact_id, channel, purpose) WHERE opted_out_at IS NULL DO UPDATE SET
    legal_basis = EXCLUDED.legal_basis,
    source = EXCLUDED.source,
    proof = EXCLUDED.proof,
    captured_at = EXCLUDED.captured_at,
    updated_at = NOW();

INSERT INTO public.crm_activities (
    contact_id,
    opportunity_id,
    activity_type,
    subject,
    body,
    occurred_at,
    metadata,
    related_entity_type,
    related_entity_id,
    created_at
)
SELECT
    l.crm_contact_id,
    l.crm_opportunity_id,
    'system',
    'Solicitud de plaza recibida',
    l.learning_goal,
    COALESCE(l.created_at, NOW()),
    jsonb_build_object(
        'interest', l.interest,
        'current_level', l.current_level,
        'availability', l.availability,
        'preferred_package', l.preferred_package,
        'source_path', l.source_path
    ),
    'lead',
    l.id::text,
    COALESCE(l.created_at, NOW())
FROM public.leads l
WHERE l.crm_contact_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.crm_activities existing
      WHERE existing.contact_id = l.crm_contact_id
        AND existing.activity_type = 'system'
        AND existing.related_entity_type = 'lead'
        AND existing.related_entity_id = l.id::text
  );

INSERT INTO public.crm_activities (
    contact_id,
    activity_type,
    subject,
    occurred_at,
    related_entity_type,
    related_entity_id,
    created_at
)
SELECT
    c.id,
    'system',
    'Cuenta de alumno creada',
    COALESCE(p.created_at, NOW()),
    'profile',
    p.id::text,
    COALESCE(p.created_at, NOW())
FROM public.crm_contacts c
JOIN public.profiles p ON p.id = c.profile_id
WHERE p.role = 'student'
  AND NOT EXISTS (
      SELECT 1
      FROM public.crm_activities existing
      WHERE existing.contact_id = c.id
        AND existing.activity_type = 'system'
        AND existing.related_entity_type = 'profile'
        AND existing.related_entity_id = p.id::text
  );
