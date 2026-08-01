-- =============================================
-- ESPAÑOL HONESTO - DATABASE SCHEMA
-- =============================================
-- Canonical deployable superset: 22 application tables shared with production
-- plus 2 staging-only integration-smoke tables. Production must never apply
-- migration 20260710150000 or call its staging-only RPCs.
-- All deployable changes belong in supabase/migrations; do not maintain loose
-- dashboard SQL as a parallel schema source.

-- 1. ENUM TYPES
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'expired', 'pending');
CREATE TYPE payment_status AS ENUM ('succeeded', 'pending', 'failed', 'refunded');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'discarded');

-- 2. LEADS (CRM)
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    interest TEXT,
    current_level TEXT,
    learning_goal TEXT,
    availability TEXT,
    preferred_package TEXT,
    source_path TEXT,
    lang TEXT DEFAULT 'es',
    spoken_languages TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    is_russian_speaker BOOLEAN NOT NULL DEFAULT FALSE,
    level_check_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (level_check_status IN ('not_requested', 'recommended', 'sent', 'received', 'reviewed', 'waived')),
    level_check_context JSONB NOT NULL DEFAULT '{}'::JSONB,
    level_check_summary TEXT,
    level_check_estimated_level TEXT,
    level_check_confidence TEXT CHECK (level_check_confidence IS NULL OR level_check_confidence IN ('low', 'medium', 'high')),
    level_check_plan_recommendation TEXT,
    level_check_fit_flags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    level_check_received_at TIMESTAMPTZ,
    level_check_reviewed_at TIMESTAMPTZ,
    level_check_raw_cleared_at TIMESTAMPTZ,
    adult_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    adult_confirmed_at TIMESTAMPTZ,
    age_policy_version TEXT,
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address TEXT,
    status lead_status NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PROFILES (extends auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role user_role DEFAULT 'student',
    preferred_language TEXT DEFAULT 'es' CHECK (preferred_language IN ('es', 'en', 'ru')),
    phone TEXT,
    timezone TEXT DEFAULT 'Europe/Madrid',
    adult_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    adult_confirmed_at TIMESTAMPTZ,
    age_policy_version TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT profiles_adult_attestation_complete CHECK (
        (adult_confirmed = FALSE AND adult_confirmed_at IS NULL AND age_policy_version IS NULL)
        OR
        (
            adult_confirmed = TRUE
            AND adult_confirmed_at IS NOT NULL
            AND NULLIF(btrim(age_policy_version), '') IS NOT NULL
        )
    )
);

-- 3B. PRIVATE PROFILE DATA (server/admin only)
CREATE TABLE profiles_private (
    profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    stripe_customer_account_id TEXT,
    stripe_customer_livemode BOOLEAN,
    drive_folder_id TEXT, -- Google Drive folder for this user
    drive_folder_url TEXT, -- Canonical shared URL for the Drive folder
    google_account_email TEXT, -- Explicit Google account granted once the student links it
    notes TEXT, -- Internal notes (visible only through server-side/admin paths)
    current_level TEXT DEFAULT 'A2',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT profiles_private_stripe_customer_environment_check CHECK (
        (
            stripe_customer_id IS NULL
            AND stripe_customer_account_id IS NULL
            AND stripe_customer_livemode IS NULL
        )
        OR (
            stripe_customer_id IS NOT NULL
            AND (
                (
                    stripe_customer_account_id IS NULL
                    AND stripe_customer_livemode IS NULL
                )
                OR (
                    stripe_customer_account_id ~ '^acct_[A-Za-z0-9_]+$'
                    AND stripe_customer_livemode IS NOT NULL
                )
            )
        )
    )
);

-- 4. PACKAGES (launch product catalog)
CREATE TABLE packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE, -- Stable product key used by code and Stripe metadata
    display_name JSONB NOT NULL, -- {"es": "...", "en": "...", "ru": "..."}
    price_monthly INTEGER NOT NULL, -- Price in cents
    sessions_per_month INTEGER NOT NULL,
    has_group_session BOOLEAN DEFAULT FALSE,
    has_dual_teacher BOOLEAN DEFAULT FALSE,
    catalog_version BIGINT NOT NULL DEFAULT 1,
    stripe_product_id TEXT,
    stripe_price_1m TEXT, -- Price ID for 1 month
    stripe_price_3m TEXT, -- Price ID for 3 months (10% off)
    stripe_price_6m TEXT, -- Price ID for 6 months (20% off)
    is_active BOOLEAN DEFAULT TRUE,
    is_publicly_listed BOOLEAN NOT NULL DEFAULT FALSE,
    contract_schema_version SMALLINT NOT NULL DEFAULT 1,
    amount_cents INTEGER,
    billing_interval_unit TEXT,
    billing_interval_count SMALLINT,
    sessions_per_period INTEGER,
    class_duration_minutes SMALLINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT packages_catalog_version_positive CHECK (catalog_version > 0),
    CONSTRAINT packages_contract_schema_version_check CHECK (contract_schema_version IN (1, 2)),
    CONSTRAINT packages_id_contract_schema_version_key UNIQUE (id, contract_schema_version),
    CONSTRAINT packages_versioned_contract_shape_check CHECK (
        (
            contract_schema_version = 1
            AND amount_cents IS NULL
            AND billing_interval_unit IS NULL
            AND billing_interval_count IS NULL
            AND sessions_per_period IS NULL
            AND class_duration_minutes IS NULL
        )
        OR (
            contract_schema_version = 2
            AND amount_cents IS NOT NULL AND amount_cents > 0
            AND price_monthly = amount_cents
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit IN ('day', 'week', 'month', 'year')
            AND billing_interval_count IS NOT NULL AND billing_interval_count > 0
            AND sessions_per_period IS NOT NULL AND sessions_per_period > 0
            AND sessions_per_month = sessions_per_period
            AND class_duration_minutes IS NOT NULL AND class_duration_minutes > 0
        )
    )
);

-- 4B. IMMUTABLE STRIPE OFFERS (server-only billing history)
CREATE TABLE package_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL,
    catalog_version BIGINT NOT NULL CHECK (catalog_version > 0),
    package_key TEXT NOT NULL,
    display_name JSONB NOT NULL,
    duration_months SMALLINT CHECK (duration_months IN (1, 3, 6)),
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
    sessions_per_month INTEGER CHECK (sessions_per_month > 0),
    sessions_per_period INTEGER NOT NULL CHECK (
        sessions_per_period > 0
        AND sessions_per_period = sessions_per_month * duration_months
    ),
    has_group_session BOOLEAN NOT NULL DEFAULT FALSE,
    has_dual_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_account_id TEXT CHECK (
        stripe_account_id IS NULL
        OR stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'
    ),
    stripe_livemode BOOLEAN NOT NULL,
    stripe_product_id TEXT NOT NULL CHECK (stripe_product_id ~ '^prod_[A-Za-z0-9_]+$'),
    stripe_price_id TEXT NOT NULL UNIQUE CHECK (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    status TEXT NOT NULL CHECK (status IN ('active', 'retired')),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    contract_schema_version SMALLINT NOT NULL DEFAULT 1,
    billing_interval_unit TEXT,
    billing_interval_count SMALLINT,
    class_duration_minutes SMALLINT,
    CONSTRAINT package_prices_lifecycle_check CHECK (
        (status = 'active' AND retired_at IS NULL)
        OR (status = 'retired' AND retired_at IS NOT NULL)
    ),
    CONSTRAINT package_prices_contract_schema_version_check CHECK (contract_schema_version IN (1, 2)),
    CONSTRAINT package_prices_package_contract_version_fkey
        FOREIGN KEY (package_id, contract_schema_version)
        REFERENCES packages(id, contract_schema_version) ON DELETE RESTRICT,
    CONSTRAINT package_prices_versioned_contract_shape_check CHECK (
        (
            contract_schema_version = 1
            AND duration_months IS NOT NULL AND duration_months IN (1, 3, 6)
            AND sessions_per_month IS NOT NULL AND sessions_per_month > 0
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit = 'month'
            AND billing_interval_count IS NOT NULL
            AND billing_interval_count = duration_months
            AND class_duration_minutes IS NULL
        )
        OR (
            contract_schema_version = 2
            AND duration_months IS NULL
            AND sessions_per_month IS NULL
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit IN ('day', 'week', 'month', 'year')
            AND billing_interval_count IS NOT NULL AND billing_interval_count > 0
            AND sessions_per_period IS NOT NULL AND sessions_per_period > 0
            AND class_duration_minutes IS NOT NULL AND class_duration_minutes > 0
        )
    )
);

-- 4. SUBSCRIPTIONS
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES packages(id),
    package_price_id UUID REFERENCES package_prices(id) ON DELETE RESTRICT,
    status subscription_status DEFAULT 'pending',
    duration_months INTEGER CHECK (duration_months IN (1, 3, 6)),
    starts_at DATE NOT NULL,
    ends_at DATE NOT NULL,
    sessions_total INTEGER NOT NULL, -- Total sessions for the subscription period
    contracted_sessions_per_period INTEGER NOT NULL,
    sessions_used INTEGER DEFAULT 0,
    stripe_subscription_id TEXT,
    stripe_invoice_id TEXT,
    contract_schema_version SMALLINT NOT NULL DEFAULT 1,
    billing_interval_unit TEXT,
    billing_interval_count SMALLINT,
    class_duration_minutes SMALLINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT subscriptions_contracted_sessions_positive CHECK (contracted_sessions_per_period > 0),
    CONSTRAINT subscriptions_contract_schema_version_check CHECK (contract_schema_version IN (1, 2)),
    CONSTRAINT subscriptions_versioned_contract_shape_check CHECK (
        (
            contract_schema_version = 1
            AND duration_months IS NOT NULL AND duration_months IN (1, 3, 6)
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit = 'month'
            AND billing_interval_count IS NOT NULL
            AND billing_interval_count = duration_months
            AND class_duration_minutes IS NULL
        )
        OR (
            contract_schema_version = 2
            AND duration_months IS NULL
            AND billing_interval_unit IS NOT NULL
            AND billing_interval_unit IN ('day', 'week', 'month', 'year')
            AND billing_interval_count IS NOT NULL AND billing_interval_count > 0
            AND class_duration_minutes IS NOT NULL AND class_duration_minutes > 0
        )
    )
);

-- 5. STUDENT-TEACHER ASSIGNMENTS
CREATE TABLE student_teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT TRUE, -- Primary teacher
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(student_id, teacher_id)
);

-- 6. SESSIONS (class bookings)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES profiles(id),
    teacher_id UUID REFERENCES profiles(id),
    scheduled_at TIMESTAMPTZ,
    duration_minutes INTEGER NOT NULL DEFAULT 50,
    meet_link TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    teacher_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Session lifecycle tracking
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id),
    cancellation_reason TEXT,
    drive_doc_id TEXT,
    drive_doc_url TEXT,
    calendar_event_id TEXT,
    reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
    post_class_report JSONB,
    CONSTRAINT sessions_duration_minutes_supported
        CHECK (duration_minutes IN (30, 40, 50))
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION session_tstzrange(start_at timestamptz, dur_min integer)
RETURNS tstzrange
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ SELECT tstzrange(start_at, start_at + (dur_min * interval '1 minute')); $$;

ALTER TABLE sessions
ADD CONSTRAINT no_overlapping_teacher_sessions
EXCLUDE USING gist (
    teacher_id WITH =,
    session_tstzrange(scheduled_at, duration_minutes) WITH &&
)
WHERE (status <> 'cancelled');

-- 7. PAYMENTS
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES profiles(id),
    subscription_id UUID REFERENCES subscriptions(id),
    amount INTEGER NOT NULL, -- Amount in cents
    currency TEXT DEFAULT 'eur',
    status payment_status DEFAULT 'pending',
    stripe_payment_intent_id TEXT,
    stripe_invoice_id TEXT,
    amount_refunded INTEGER NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0 AND amount_refunded <= amount),
    stripe_refund_id TEXT,
    refunded_at TIMESTAMPTZ,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. PROCESSED WEBHOOK EVENTS (Stripe Idempotency)
CREATE TABLE processed_webhook_events (
    stripe_event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'processing' CHECK (processing_status IN ('processing', 'succeeded', 'failed')),
    processing_error TEXT,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. FULFILLMENT JOBS (Google Workspace + Resend reliability)
CREATE TABLE fulfillment_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL CHECK (job_type IN ('session_fulfillment', 'bulk_session_fulfillment', 'welcome_fulfillment', 'session_cancellation', 'renewal_notice')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
    student_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    dedupe_key TEXT,
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

-- 10A. FULFILLMENT EFFECT LEDGER (provider-side idempotency checkpoints)
CREATE TABLE fulfillment_effects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES fulfillment_jobs(id) ON DELETE CASCADE,
    effect_key TEXT NOT NULL CHECK (
        char_length(effect_key) BETWEEN 1 AND 200
        AND effect_key ~ '^[a-z0-9][a-z0-9_.:/-]*$'
    ),
    effect_type TEXT NOT NULL CHECK (
        char_length(effect_type) BETWEEN 1 AND 80
        AND effect_type ~ '^[a-z][a-z0-9_.:-]*$'
    ),
    payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'processing', 'succeeded', 'failed', 'ambiguous', 'manual_review')
    ),
    attempt_generation BIGINT NOT NULL DEFAULT 0 CHECK (attempt_generation >= 0),
    lease_owner TEXT CHECK (
        lease_owner IS NULL
        OR (
            char_length(lease_owner) BETWEEN 1 AND 200
            AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
        )
    ),
    lease_expires_at TIMESTAMPTZ,
    provider_id TEXT CHECK (provider_id IS NULL OR char_length(provider_id) BETWEEN 1 AND 512),
    error JSONB CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
    result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
    first_attempt_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fulfillment_effects_job_effect_unique UNIQUE (job_id, effect_key),
    CONSTRAINT fulfillment_effects_lease_state_check CHECK (
        (
            status = 'processing'
            AND lease_owner IS NOT NULL
            AND lease_expires_at IS NOT NULL
        )
        OR (
            status <> 'processing'
            AND lease_owner IS NULL
            AND lease_expires_at IS NULL
        )
    ),
    CONSTRAINT fulfillment_effects_attempt_state_check CHECK (
        (
            status = 'pending'
            AND attempt_generation = 0
            AND first_attempt_at IS NULL
            AND last_attempt_at IS NULL
        )
        OR (
            status <> 'pending'
            AND attempt_generation > 0
            AND first_attempt_at IS NOT NULL
            AND last_attempt_at IS NOT NULL
        )
    ),
    CONSTRAINT fulfillment_effects_error_state_check CHECK (
        (
            status IN ('failed', 'ambiguous', 'manual_review')
            AND error IS NOT NULL
        )
        OR (
            status IN ('pending', 'processing', 'succeeded')
            AND error IS NULL
        )
    ),
    CONSTRAINT fulfillment_effects_completion_state_check CHECK (
        (
            status = 'succeeded'
            AND completed_at IS NOT NULL
        )
        OR (
            status <> 'succeeded'
            AND completed_at IS NULL
        )
    ),
    CONSTRAINT fulfillment_effects_processing_payload_check CHECK (
        status <> 'processing'
        OR (provider_id IS NULL AND result IS NULL)
    ),
    CONSTRAINT fulfillment_effects_failed_provider_check CHECK (
        status <> 'failed'
        OR provider_id IS NULL
    )
);

-- 10B. EMAIL RECIPIENT BUDGET (Resend Free quota guard)
CREATE TABLE email_recipient_budget_usage (
    budget_scope TEXT NOT NULL CHECK (
        char_length(budget_scope) BETWEEN 1 AND 64
        AND budget_scope ~ '^[a-z0-9:_-]+$'
    ),
    period_kind TEXT NOT NULL CHECK (period_kind IN ('day', 'month')),
    period_start DATE NOT NULL,
    recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
    last_source TEXT NOT NULL CHECK (
        char_length(last_source) BETWEEN 1 AND 80
        AND last_source ~ '^[a-z0-9_.:-]+$'
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (budget_scope, period_kind, period_start)
);

-- 11. SUPPORT TICKETS
CREATE TABLE support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    issue_type TEXT NOT NULL,
    issue_title TEXT NOT NULL,
    message TEXT NOT NULL CHECK (char_length(message) BETWEEN 5 AND 2000),
    page_url TEXT,
    user_agent TEXT,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'closed')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. CRM CORE
CREATE TABLE crm_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    primary_email TEXT NOT NULL CHECK (position('@' IN primary_email) > 1),
    full_name TEXT,
    phone TEXT,
    preferred_language TEXT DEFAULT 'es' CHECK (preferred_language IN ('es', 'en', 'ru')),
    timezone TEXT DEFAULT 'Europe/Madrid',
    country TEXT,
    lifecycle_stage TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle_stage IN ('lead', 'qualified', 'customer', 'alumni', 'inactive', 'lost')),
    source TEXT,
    source_path TEXT,
    owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    last_contacted_at TIMESTAMPTZ,
    next_follow_up_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    legacy_lead_id UUID UNIQUE REFERENCES leads(id) ON DELETE SET NULL,
    stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'to_contact', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'nurture')),
    interest TEXT,
    current_level TEXT,
    learning_goal TEXT,
    availability TEXT,
    preferred_package_id UUID REFERENCES packages(id) ON DELETE SET NULL,
    checkout_approved_at TIMESTAMPTZ,
    expected_value_cents INTEGER CHECK (expected_value_cents IS NULL OR expected_value_cents >= 0),
    probability_percent INTEGER CHECK (probability_percent IS NULL OR probability_percent BETWEEN 0 AND 100),
    lost_reason TEXT,
    converted_subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT crm_opportunities_checkout_approval_package_required CHECK (
        checkout_approved_at IS NULL OR preferred_package_id IS NOT NULL
    )
);

CREATE TABLE checkout_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id UUID NOT NULL REFERENCES crm_opportunities(id) ON DELETE RESTRICT,
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE RESTRICT,
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    package_price_id UUID NOT NULL REFERENCES package_prices(id) ON DELETE RESTRICT,
    lang TEXT NOT NULL CHECK (lang IN ('es', 'en', 'ru')),
    legal_policy_version TEXT NOT NULL CHECK (NULLIF(btrim(legal_policy_version), '') IS NOT NULL),
    policy_accepted_at TIMESTAMPTZ NOT NULL,
    site_url TEXT NOT NULL CHECK (site_url ~ '^https?://'),
    status TEXT NOT NULL DEFAULT 'creating'
        CHECK (status IN ('creating', 'open', 'completed', 'expired')),
    stripe_checkout_session_id TEXT UNIQUE CHECK (
        stripe_checkout_session_id IS NULL
        OR stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    ),
    stripe_customer_id TEXT CHECK (
        stripe_customer_id IS NULL
        OR stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'
    ),
    stripe_session_expires_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT checkout_intents_lifecycle_check CHECK (
        (
            status = 'creating'
            AND stripe_checkout_session_id IS NULL
            AND completed_at IS NULL
        )
        OR (
            status = 'open'
            AND stripe_checkout_session_id IS NOT NULL
            AND completed_at IS NULL
        )
        OR (
            status = 'completed'
            AND stripe_checkout_session_id IS NOT NULL
            AND completed_at IS NOT NULL
        )
        OR (
            status = 'expired'
            AND completed_at IS NULL
        )
    ),
    CONSTRAINT checkout_intents_expiry_check CHECK (
        stripe_session_expires_at > created_at
        AND expires_at > stripe_session_expires_at
    )
);

CREATE TABLE crm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE CASCADE,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
    task_type TEXT NOT NULL DEFAULT 'review' CHECK (task_type IN ('email', 'call', 'whatsapp', 'review', 'admin')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'snoozed', 'cancelled')),
    due_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    related_entity_type TEXT,
    related_entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE SET NULL,
    actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('note', 'email_in', 'email_out', 'call', 'whatsapp', 'meeting', 'support', 'payment', 'class', 'system')),
    subject TEXT,
    body TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    related_entity_type TEXT,
    related_entity_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE crm_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
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

ALTER TABLE leads
    ADD COLUMN crm_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
    ADD COLUMN crm_opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE SET NULL;

-- 13. ADMIN AUDIT LOG
CREATE TABLE admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    before JSONB,
    after JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. TEACHER AVAILABILITY
CREATE TABLE teacher_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time TIME WITHOUT TIME ZONE NOT NULL,
    end_time TIME WITHOUT TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (start_time < end_time)
);

ALTER TABLE teacher_availability
ADD CONSTRAINT teacher_availability_no_active_overlap
EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    (numrange(
        EXTRACT(EPOCH FROM start_time),
        EXTRACT(EPOCH FROM end_time),
        '[)'
    )) WITH &&
)
WHERE (is_active = TRUE);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_subscriptions_student ON subscriptions(student_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX subscriptions_package_idx ON subscriptions(package_id);
CREATE INDEX subscriptions_package_price_idx ON subscriptions(package_price_id) WHERE package_price_id IS NOT NULL;
CREATE UNIQUE INDEX subscriptions_stripe_subscription_unique_idx ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX package_prices_one_active_duration_idx ON package_prices(package_id, duration_months) WHERE status = 'active';
CREATE UNIQUE INDEX package_prices_one_active_v2_offer_idx ON package_prices(package_id) WHERE status = 'active' AND contract_schema_version = 2;
CREATE INDEX package_prices_package_version_idx ON package_prices(package_id, catalog_version);
CREATE INDEX idx_sessions_student ON sessions(student_id);
CREATE INDEX idx_sessions_teacher ON sessions(teacher_id);
CREATE INDEX idx_sessions_scheduled ON sessions(scheduled_at);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_reminder_pending
    ON sessions(scheduled_at, status, reminder_sent)
    WHERE status = 'scheduled' AND reminder_sent = FALSE;
CREATE INDEX sessions_subscription_idx ON sessions(subscription_id);
CREATE INDEX sessions_cancelled_by_idx ON sessions(cancelled_by);
CREATE INDEX idx_payments_student ON payments(student_id);
CREATE INDEX payments_subscription_idx ON payments(subscription_id);
CREATE INDEX payments_stripe_payment_intent_idx ON payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX payments_stripe_invoice_unique_idx ON payments(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX idx_fulfillment_jobs_due ON fulfillment_jobs(status, run_at) WHERE status IN ('pending', 'failed');
CREATE INDEX idx_fulfillment_jobs_session ON fulfillment_jobs(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_fulfillment_jobs_subscription ON fulfillment_jobs(subscription_id);
CREATE INDEX idx_fulfillment_jobs_student ON fulfillment_jobs(student_id);
CREATE UNIQUE INDEX idx_fulfillment_jobs_type_dedupe ON fulfillment_jobs(job_type, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX fulfillment_effects_claimable_lease_idx
    ON fulfillment_effects(status, lease_expires_at, created_at)
    WHERE status IN ('pending', 'failed', 'processing');
CREATE INDEX idx_support_tickets_status_created ON support_tickets(status, created_at DESC);
CREATE INDEX idx_support_tickets_user ON support_tickets(user_id, created_at DESC);
CREATE UNIQUE INDEX crm_contacts_primary_email_lower_unique ON crm_contacts (lower(primary_email));
CREATE UNIQUE INDEX crm_contacts_profile_id_unique ON crm_contacts(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX crm_contacts_lifecycle_followup_idx ON crm_contacts(lifecycle_stage, next_follow_up_at);
CREATE INDEX crm_contacts_owner_followup_idx ON crm_contacts(owner_id, next_follow_up_at) WHERE owner_id IS NOT NULL;
CREATE INDEX crm_opportunities_contact_idx ON crm_opportunities(contact_id);
CREATE INDEX crm_opportunities_open_stage_idx ON crm_opportunities(stage, opened_at DESC) WHERE stage IN ('new', 'to_contact', 'contacted', 'qualified', 'proposal', 'nurture');
CREATE INDEX crm_opportunities_assigned_stage_idx ON crm_opportunities(assigned_to, stage) WHERE assigned_to IS NOT NULL;
CREATE INDEX crm_opportunities_preferred_package_idx ON crm_opportunities(preferred_package_id) WHERE preferred_package_id IS NOT NULL;
CREATE INDEX crm_opportunities_converted_subscription_idx ON crm_opportunities(converted_subscription_id) WHERE converted_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX crm_opportunities_one_open_checkout_approval_idx ON crm_opportunities(contact_id)
    WHERE checkout_approved_at IS NOT NULL AND converted_subscription_id IS NULL;
CREATE UNIQUE INDEX checkout_intents_one_open_per_student_idx ON checkout_intents(student_id)
    WHERE status IN ('creating', 'open');
CREATE UNIQUE INDEX checkout_intents_one_open_per_opportunity_idx ON checkout_intents(opportunity_id)
    WHERE status IN ('creating', 'open');
CREATE INDEX checkout_intents_package_price_idx ON checkout_intents(package_price_id);
CREATE INDEX crm_tasks_contact_idx ON crm_tasks(contact_id);
CREATE INDEX crm_tasks_opportunity_idx ON crm_tasks(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX crm_tasks_assigned_status_due_idx ON crm_tasks(assigned_to, status, due_at);
CREATE INDEX crm_tasks_open_due_idx ON crm_tasks(due_at) WHERE status = 'open';
CREATE INDEX crm_tasks_related_entity_idx ON crm_tasks(related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL AND related_entity_id IS NOT NULL;
CREATE INDEX crm_activities_contact_occurred_idx ON crm_activities(contact_id, occurred_at DESC);
CREATE INDEX crm_activities_opportunity_idx ON crm_activities(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX crm_activities_actor_idx ON crm_activities(actor_id) WHERE actor_id IS NOT NULL;
CREATE INDEX crm_activities_type_occurred_idx ON crm_activities(activity_type, occurred_at DESC);
CREATE INDEX crm_activities_related_entity_idx ON crm_activities(related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL AND related_entity_id IS NOT NULL;
CREATE INDEX crm_consents_contact_idx ON crm_consents(contact_id);
CREATE INDEX crm_consents_channel_purpose_idx ON crm_consents(channel, purpose, opted_out_at);
CREATE UNIQUE INDEX crm_consents_one_active_per_contact_channel_purpose ON crm_consents(contact_id, channel, purpose) WHERE opted_out_at IS NULL;
CREATE INDEX checkout_intents_contact_idx ON checkout_intents(contact_id);
CREATE INDEX leads_crm_contact_idx ON leads(crm_contact_id) WHERE crm_contact_id IS NOT NULL;
CREATE INDEX leads_crm_opportunity_idx ON leads(crm_opportunity_id) WHERE crm_opportunity_id IS NOT NULL;
CREATE INDEX leads_spoken_languages_idx ON leads USING GIN(spoken_languages);
CREATE INDEX leads_is_russian_speaker_idx ON leads(is_russian_speaker) WHERE is_russian_speaker = TRUE;
CREATE INDEX leads_level_check_status_idx ON leads(level_check_status, level_check_received_at DESC);
CREATE INDEX leads_level_check_fit_flags_idx ON leads USING GIN(level_check_fit_flags);
CREATE INDEX idx_admin_audit_log_admin ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_log_entity ON admin_audit_log(entity_type, entity_id);
CREATE INDEX package_prices_created_by_idx ON package_prices(created_by);
CREATE INDEX student_teachers_teacher_idx ON student_teachers(teacher_id);
CREATE INDEX idx_teacher_availability_teacher ON teacher_availability(teacher_id);
CREATE INDEX idx_teacher_availability_day ON teacher_availability(day_of_week);
CREATE UNIQUE INDEX profiles_private_stripe_customer_unique ON profiles_private(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX subscriptions_one_active_per_student ON subscriptions(student_id) WHERE status = 'active';
CREATE UNIQUE INDEX student_teachers_one_primary_teacher_per_student ON student_teachers(student_id) WHERE is_primary = TRUE;
ALTER TABLE profiles_private
    ADD CONSTRAINT profiles_private_google_account_email_requires_folder
    CHECK (google_account_email IS NULL OR drive_folder_id IS NOT NULL);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles_private ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_recipient_budget_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_availability ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE packages TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    leads,
    crm_contacts,
    crm_opportunities,
    crm_tasks,
    crm_activities,
    crm_consents,
    fulfillment_jobs,
    packages,
    payments,
    profiles,
    profiles_private,
    sessions,
    student_teachers,
    subscriptions,
    teacher_availability
TO authenticated;

GRANT SELECT ON TABLE admin_audit_log, processed_webhook_events TO authenticated;
GRANT INSERT ON TABLE support_tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    leads, crm_contacts, crm_opportunities, crm_tasks, crm_activities, crm_consents
TO service_role;

REVOKE ALL ON TABLE package_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE package_prices TO service_role;

REVOKE ALL ON TABLE checkout_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE checkout_intents TO service_role;

REVOKE ALL ON TABLE fulfillment_effects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fulfillment_effects TO service_role;

REVOKE ALL ON TABLE email_recipient_budget_usage FROM anon;
REVOKE ALL ON TABLE email_recipient_budget_usage FROM authenticated;
REVOKE ALL ON TABLE email_recipient_budget_usage FROM public;
GRANT SELECT, INSERT, UPDATE ON TABLE email_recipient_budget_usage TO service_role;

REVOKE ALL ON TABLE support_tickets FROM anon;
REVOKE ALL ON TABLE support_tickets FROM authenticated;
REVOKE ALL ON TABLE support_tickets FROM public;
GRANT INSERT ON TABLE support_tickets TO authenticated;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE OR REPLACE FUNCTION private.populate_legacy_contract_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version = 1 THEN
        NEW.billing_interval_unit := 'month';
        NEW.billing_interval_count := NEW.duration_months;
        NEW.class_duration_minutes := NULL;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.populate_legacy_contract_interval()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER populate_legacy_package_price_interval_trigger
    BEFORE INSERT ON package_prices
    FOR EACH ROW
    EXECUTE FUNCTION private.populate_legacy_contract_interval();

CREATE TRIGGER populate_legacy_subscription_interval_trigger
    BEFORE INSERT ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.populate_legacy_contract_interval();

CREATE OR REPLACE FUNCTION private.guard_versioned_package_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version IS DISTINCT FROM OLD.contract_schema_version THEN
        RAISE EXCEPTION 'package_contract_schema_version_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.contract_schema_version = 2 AND ROW(
        NEW.name,
        NEW.display_name,
        NEW.price_monthly,
        NEW.sessions_per_month,
        NEW.has_group_session,
        NEW.has_dual_teacher,
        NEW.amount_cents,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.sessions_per_period,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.name,
        OLD.display_name,
        OLD.price_monthly,
        OLD.sessions_per_month,
        OLD.has_group_session,
        OLD.has_dual_teacher,
        OLD.amount_cents,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.sessions_per_period,
        OLD.class_duration_minutes
    ) THEN
        RAISE EXCEPTION 'versioned_package_contract_fields_are_immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_versioned_package_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_versioned_package_contract_trigger
    BEFORE UPDATE ON packages
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_versioned_package_contract();

-- Billing catalog history is immutable except for the active-to-retired
-- lifecycle transition performed by the synchronization RPC.
CREATE OR REPLACE FUNCTION private.guard_package_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.package_id,
        NEW.catalog_version,
        NEW.package_key,
        NEW.display_name,
        NEW.duration_months,
        NEW.amount_cents,
        NEW.currency,
        NEW.sessions_per_month,
        NEW.sessions_per_period,
        NEW.has_group_session,
        NEW.has_dual_teacher,
        NEW.stripe_livemode,
        NEW.stripe_product_id,
        NEW.stripe_price_id,
        NEW.activated_at,
        NEW.created_by,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.package_id,
        OLD.catalog_version,
        OLD.package_key,
        OLD.display_name,
        OLD.duration_months,
        OLD.amount_cents,
        OLD.currency,
        OLD.sessions_per_month,
        OLD.sessions_per_period,
        OLD.has_group_session,
        OLD.has_dual_teacher,
        OLD.stripe_livemode,
        OLD.stripe_product_id,
        OLD.stripe_price_id,
        OLD.activated_at,
        OLD.created_by,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION 'package_price_commercial_fields_are_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.stripe_account_id IS NOT NULL
       AND NEW.stripe_account_id IS DISTINCT FROM OLD.stripe_account_id THEN
        RAISE EXCEPTION 'package_price_stripe_account_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'retired'
       AND (
           NEW.status IS DISTINCT FROM OLD.status
           OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
       ) THEN
        RAISE EXCEPTION 'retired_package_price_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_package_price_history()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_package_price_history_trigger
    BEFORE UPDATE ON package_prices
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_package_price_history();

CREATE OR REPLACE FUNCTION private.guard_versioned_package_price_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.contract_schema_version,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.contract_schema_version,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.class_duration_minutes
    ) THEN
        RAISE EXCEPTION 'package_price_versioned_contract_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_versioned_package_price_history()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_versioned_package_price_history_trigger
    BEFORE UPDATE ON package_prices
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_versioned_package_price_history();

-- Contractual catalog edits create a new version, retire current offers and
-- force Stripe Price synchronization before another checkout can start.
CREATE OR REPLACE FUNCTION private.version_package_catalog()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.name,
        NEW.display_name,
        NEW.price_monthly,
        NEW.sessions_per_month,
        NEW.has_group_session,
        NEW.has_dual_teacher,
        NEW.amount_cents,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.sessions_per_period,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.name,
        OLD.display_name,
        OLD.price_monthly,
        OLD.sessions_per_month,
        OLD.has_group_session,
        OLD.has_dual_teacher,
        OLD.amount_cents,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.sessions_per_period,
        OLD.class_duration_minutes
    ) THEN
        NEW.catalog_version := OLD.catalog_version + 1;

        UPDATE public.package_prices
        SET status = 'retired', retired_at = clock_timestamp()
        WHERE package_id = OLD.id
          AND status = 'active';

        NEW.stripe_price_1m := NULL;
        NEW.stripe_price_3m := NULL;
        NEW.stripe_price_6m := NULL;
    ELSE
        NEW.catalog_version := OLD.catalog_version;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.version_package_catalog()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER version_package_catalog_trigger
    BEFORE UPDATE ON packages
    FOR EACH ROW
    EXECUTE FUNCTION private.version_package_catalog();

-- Subscription quotas and package terms remain fixed for the life of the
-- subscription, including automatic renewals.
CREATE OR REPLACE FUNCTION private.enforce_subscription_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    contract_price public.package_prices%ROWTYPE;
BEGIN
    IF NEW.contracted_sessions_per_period IS NULL THEN
        NEW.contracted_sessions_per_period := NEW.sessions_total;
    END IF;

    IF NEW.contracted_sessions_per_period <= 0 THEN
        RAISE EXCEPTION 'invalid_contracted_sessions_per_period'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.student_id IS DISTINCT FROM OLD.student_id
           OR NEW.package_id IS DISTINCT FROM OLD.package_id
           OR NEW.duration_months IS DISTINCT FROM OLD.duration_months
           OR NEW.contracted_sessions_per_period IS DISTINCT FROM OLD.contracted_sessions_per_period THEN
            RAISE EXCEPTION 'subscription_contract_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.package_price_id IS NOT NULL
           AND NEW.package_price_id IS DISTINCT FROM OLD.package_price_id THEN
            RAISE EXCEPTION 'subscription_package_price_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.stripe_subscription_id IS NOT NULL
           AND NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
            RAISE EXCEPTION 'subscription_stripe_id_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.package_price_id IS NOT NULL THEN
        SELECT * INTO contract_price
        FROM public.package_prices
        WHERE id = NEW.package_price_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'package_price_not_found'
                USING ERRCODE = '23503';
        END IF;

        IF contract_price.package_id IS DISTINCT FROM NEW.package_id
           OR contract_price.duration_months IS DISTINCT FROM NEW.duration_months
           OR contract_price.sessions_per_period IS DISTINCT FROM NEW.contracted_sessions_per_period THEN
            RAISE EXCEPTION 'subscription_contract_does_not_match_package_price'
                USING ERRCODE = '23514';
        END IF;

        IF TG_OP = 'INSERT'
           AND NEW.sessions_total IS DISTINCT FROM contract_price.sessions_per_period THEN
            RAISE EXCEPTION 'initial_subscription_quota_does_not_match_contract'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_subscription_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_subscription_contract_trigger
    BEFORE INSERT OR UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.enforce_subscription_contract();

CREATE OR REPLACE FUNCTION private.guard_versioned_subscription_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version = 1 THEN
        NEW.billing_interval_unit := 'month';
        NEW.billing_interval_count := NEW.duration_months;
        NEW.class_duration_minutes := NULL;
    END IF;

    IF TG_OP = 'UPDATE' AND ROW(
        NEW.contract_schema_version,
        NEW.billing_interval_unit,
        NEW.billing_interval_count,
        NEW.class_duration_minutes
    ) IS DISTINCT FROM ROW(
        OLD.contract_schema_version,
        OLD.billing_interval_unit,
        OLD.billing_interval_count,
        OLD.class_duration_minutes
    ) THEN
        RAISE EXCEPTION 'subscription_versioned_contract_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.package_price_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.package_prices AS contract_price
           WHERE contract_price.id = NEW.package_price_id
             AND contract_price.contract_schema_version = NEW.contract_schema_version
             AND contract_price.billing_interval_unit = NEW.billing_interval_unit
             AND contract_price.billing_interval_count = NEW.billing_interval_count
             AND contract_price.class_duration_minutes IS NOT DISTINCT FROM NEW.class_duration_minutes
       ) THEN
        RAISE EXCEPTION 'subscription_versioned_contract_does_not_match_package_price'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_versioned_subscription_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_versioned_subscription_contract_trigger
    BEFORE INSERT OR UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_versioned_subscription_contract();

-- Apply an invoice renewal once, reset the immutable period quota and reject
-- attempts to attach the invoice to a different Stripe subscription.
CREATE OR REPLACE FUNCTION public.apply_subscription_renewal(
    p_subscription_id UUID,
    p_stripe_subscription_id TEXT,
    p_stripe_invoice_id TEXT,
    p_new_ends_at DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
BEGIN
    IF p_subscription_id IS NULL
       OR p_stripe_subscription_id IS NULL
       OR p_stripe_invoice_id IS NULL
       OR p_new_ends_at IS NULL
       OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_renewal_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF NOT FOUND
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id THEN
        RAISE EXCEPTION 'renewal_subscription_does_not_match'
            USING ERRCODE = '42501';
    END IF;

    IF subscription_row.stripe_invoice_id = p_stripe_invoice_id
       OR p_new_ends_at <= subscription_row.ends_at THEN
        RETURN FALSE;
    END IF;

    UPDATE public.subscriptions
    SET
        ends_at = p_new_ends_at,
        sessions_total = subscription_row.contracted_sessions_per_period,
        sessions_used = 0,
        status = 'active',
        stripe_invoice_id = p_stripe_invoice_id
    WHERE id = p_subscription_id;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    TO service_role;

-- Reconcile refund snapshots monotonically so delayed or repeated Stripe
-- events cannot reduce an already-recorded refunded amount.
CREATE OR REPLACE FUNCTION public.reconcile_stripe_refund(
    p_payment_id UUID,
    p_amount_refunded INTEGER,
    p_stripe_refund_id TEXT,
    p_refunded_at TIMESTAMPTZ
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    payment_row public.payments%ROWTYPE;
    effective_amount INTEGER;
BEGIN
    IF p_payment_id IS NULL
       OR p_amount_refunded IS NULL
       OR p_stripe_refund_id IS NULL
       OR p_refunded_at IS NULL
       OR p_amount_refunded < 0
       OR p_stripe_refund_id !~ '^re_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_refund_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'refund_payment_not_found'
            USING ERRCODE = '23503';
    END IF;

    effective_amount := LEAST(
        payment_row.amount,
        GREATEST(COALESCE(payment_row.amount_refunded, 0), p_amount_refunded)
    );

    UPDATE public.payments
    SET
        amount_refunded = effective_amount,
        stripe_refund_id = CASE
            WHEN p_amount_refunded > COALESCE(payment_row.amount_refunded, 0)
              OR (
                  p_amount_refunded = COALESCE(payment_row.amount_refunded, 0)
                  AND p_refunded_at >= COALESCE(payment_row.refunded_at, '-infinity'::TIMESTAMPTZ)
              )
                THEN p_stripe_refund_id
            ELSE payment_row.stripe_refund_id
        END,
        refunded_at = GREATEST(
            COALESCE(payment_row.refunded_at, '-infinity'::TIMESTAMPTZ),
            p_refunded_at
        ),
        status = CASE
            WHEN effective_amount >= payment_row.amount THEN 'refunded'::public.payment_status
            ELSE payment_row.status
        END
    WHERE id = p_payment_id
    RETURNING * INTO payment_row;

    RETURN payment_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_stripe_refund(UUID, INTEGER, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_stripe_refund(UUID, INTEGER, TEXT, TIMESTAMPTZ)
    TO service_role;

-- Freeze approval fields while checkout creation is in progress, its Stripe
-- Session remains open or a paid intent still awaits CRM conversion.
CREATE OR REPLACE FUNCTION private.protect_open_checkout_intent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    protected_fields_changed BOOLEAN;
    has_in_flight_intent BOOLEAN;
    has_unconverted_completed_intent BOOLEAN;
    is_exact_conversion BOOLEAN;
BEGIN
    protected_fields_changed := ROW(
        NEW.stage,
        NEW.preferred_package_id,
        NEW.checkout_approved_at,
        NEW.converted_subscription_id
    ) IS DISTINCT FROM ROW(
        OLD.stage,
        OLD.preferred_package_id,
        OLD.checkout_approved_at,
        OLD.converted_subscription_id
    );

    IF NOT protected_fields_changed THEN
        RETURN NEW;
    END IF;

    SELECT
        COALESCE(bool_or(status IN ('creating', 'open')), FALSE),
        COALESCE(bool_or(status = 'completed'), FALSE)
    INTO has_in_flight_intent, has_unconverted_completed_intent
    FROM public.checkout_intents
    WHERE opportunity_id = OLD.id;

    has_unconverted_completed_intent :=
        OLD.converted_subscription_id IS NULL
        AND has_unconverted_completed_intent;

    is_exact_conversion :=
        NOT has_in_flight_intent
        AND has_unconverted_completed_intent
        AND OLD.converted_subscription_id IS NULL
        AND NEW.converted_subscription_id IS NOT NULL
        AND NEW.stage = 'won'
        AND NEW.preferred_package_id IS NOT DISTINCT FROM OLD.preferred_package_id
        AND NEW.checkout_approved_at IS NULL
        AND EXISTS (
            SELECT 1
            FROM public.checkout_intents AS completed_intent
            JOIN public.subscriptions AS converted_subscription
              ON converted_subscription.id = NEW.converted_subscription_id
             AND converted_subscription.student_id = completed_intent.student_id
             AND converted_subscription.package_price_id = completed_intent.package_price_id
            WHERE completed_intent.opportunity_id = OLD.id
              AND completed_intent.status = 'completed'
        );

    IF (has_in_flight_intent OR has_unconverted_completed_intent)
       AND NOT is_exact_conversion THEN
        RAISE EXCEPTION 'open_checkout_intent_must_finish_or_expire_first'
            USING ERRCODE = '55006';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_open_checkout_intent()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER protect_open_checkout_intent_trigger
    BEFORE UPDATE ON crm_opportunities
    FOR EACH ROW
    EXECUTE FUNCTION private.protect_open_checkout_intent();

-- Checkout authorization, legal acceptance and identity are durable evidence.
-- Permit only the operational writes used to bind a Customer, persist a
-- Session, complete a paid checkout or release an expired reservation.
CREATE OR REPLACE FUNCTION private.guard_checkout_intent_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF ROW(
        NEW.id,
        NEW.opportunity_id,
        NEW.contact_id,
        NEW.student_id,
        NEW.package_price_id,
        NEW.lang,
        NEW.legal_policy_version,
        NEW.policy_accepted_at,
        NEW.site_url,
        NEW.stripe_session_expires_at,
        NEW.expires_at,
        NEW.created_at
    ) IS DISTINCT FROM ROW(
        OLD.id,
        OLD.opportunity_id,
        OLD.contact_id,
        OLD.student_id,
        OLD.package_price_id,
        OLD.lang,
        OLD.legal_policy_version,
        OLD.policy_accepted_at,
        OLD.site_url,
        OLD.stripe_session_expires_at,
        OLD.expires_at,
        OLD.created_at
    ) THEN
        RAISE EXCEPTION 'checkout_intent_snapshot_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.stripe_customer_id IS NOT NULL
       AND NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
        RAISE EXCEPTION 'checkout_intent_customer_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD.stripe_checkout_session_id IS NOT NULL
       AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
        RAISE EXCEPTION 'checkout_intent_session_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW IS NOT DISTINCT FROM OLD THEN
        RETURN NEW;
    END IF;

    IF OLD.status = 'creating' THEN
        IF NEW.status = 'creating'
           AND OLD.stripe_customer_id IS NULL
           AND NEW.stripe_customer_id IS NOT NULL
           AND NEW.stripe_checkout_session_id IS NULL
           AND NEW.completed_at IS NULL THEN
            RETURN NEW;
        END IF;

        IF NEW.stripe_customer_id IS NOT NULL
           AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id
           AND (
               (
                   NEW.status = 'open'
                   AND NEW.stripe_checkout_session_id IS NOT NULL
                   AND NEW.completed_at IS NULL
               )
               OR (
                   NEW.status = 'completed'
                   AND NEW.stripe_checkout_session_id IS NOT NULL
                   AND NEW.completed_at IS NOT NULL
               )
               OR (
                   NEW.status = 'expired'
                   AND NEW.completed_at IS NULL
               )
           ) THEN
            RETURN NEW;
        END IF;
    ELSIF OLD.status = 'open' THEN
        IF NEW.stripe_customer_id IS NOT NULL
           AND NEW.stripe_customer_id IS NOT DISTINCT FROM OLD.stripe_customer_id
           AND NEW.stripe_checkout_session_id IS NOT DISTINCT FROM OLD.stripe_checkout_session_id
           AND (
               (
                   NEW.status = 'completed'
                   AND NEW.completed_at IS NOT NULL
               )
               OR (
                   NEW.status = 'expired'
                   AND NEW.completed_at IS NULL
               )
           ) THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'checkout_intent_transition_is_not_allowed'
        USING ERRCODE = '23514';
END;
$$;

REVOKE ALL ON FUNCTION private.guard_checkout_intent_snapshots()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_checkout_intent_snapshots_trigger
    BEFORE UPDATE ON checkout_intents
    FOR EACH ROW
    EXECUTE FUNCTION private.guard_checkout_intent_snapshots();

-- Claim a single checkout atomically for both the approved opportunity and
-- the student. Repeated requests reuse creating/open intents and paid intents
-- whose CRM conversion is still pending.
CREATE OR REPLACE FUNCTION public.claim_checkout_intent(
    p_opportunity_id UUID,
    p_contact_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    opportunity_row public.crm_opportunities%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    intent_row public.checkout_intents%ROWTYPE;
    claim_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_opportunity_id IS NULL
       OR p_contact_id IS NULL
       OR p_student_id IS NULL
       OR p_package_price_id IS NULL
       OR p_lang IS NULL
       OR p_lang NOT IN ('es', 'en', 'ru')
       OR NULLIF(btrim(p_legal_policy_version), '') IS NULL
       OR NULLIF(btrim(p_site_url), '') IS NULL
       OR p_site_url !~ '^https?://' THEN
        RAISE EXCEPTION 'invalid_checkout_intent_snapshot'
            USING ERRCODE = '22023';
    END IF;

    -- Serialize all checkout claims for one student on the stable profile row.
    PERFORM 1
    FROM public.profiles
    WHERE id = p_student_id
      AND role = 'student'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_student_is_not_available'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO opportunity_row
    FROM public.crm_opportunities
    WHERE id = p_opportunity_id
    FOR UPDATE;

    IF NOT FOUND
       OR opportunity_row.contact_id IS DISTINCT FROM p_contact_id
       OR opportunity_row.stage <> 'proposal'
       OR opportunity_row.checkout_approved_at IS NULL
       OR opportunity_row.converted_subscription_id IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_approval_is_not_available'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = p_package_price_id
      AND status = 'active';

    IF NOT FOUND
       OR price_row.package_id IS DISTINCT FROM opportunity_row.preferred_package_id THEN
        RAISE EXCEPTION 'checkout_price_is_not_approved'
            USING ERRCODE = '42501';
    END IF;

    -- A completed intent whose opportunity has not yet been converted is a
    -- paid purchase under reconciliation, not capacity for a second purchase.
    SELECT checkout_intent.* INTO intent_row
    FROM public.checkout_intents AS checkout_intent
    JOIN public.crm_opportunities AS intent_opportunity
      ON intent_opportunity.id = checkout_intent.opportunity_id
    WHERE (
        checkout_intent.status IN ('creating', 'open')
        OR (
            checkout_intent.status = 'completed'
            AND intent_opportunity.converted_subscription_id IS NULL
        )
    )
      AND (
          checkout_intent.student_id = p_student_id
          OR checkout_intent.opportunity_id = p_opportunity_id
      )
    ORDER BY
        CASE checkout_intent.status
            WHEN 'completed' THEN 0
            WHEN 'open' THEN 1
            ELSE 2
        END,
        checkout_intent.created_at DESC
    LIMIT 1
    FOR UPDATE OF checkout_intent;

    IF FOUND THEN
        RETURN intent_row;
    END IF;

    INSERT INTO public.checkout_intents (
        opportunity_id,
        contact_id,
        student_id,
        package_price_id,
        lang,
        legal_policy_version,
        policy_accepted_at,
        site_url,
        status,
        stripe_session_expires_at,
        expires_at
    ) VALUES (
        p_opportunity_id,
        p_contact_id,
        p_student_id,
        p_package_price_id,
        p_lang,
        p_legal_policy_version,
        claim_time,
        p_site_url,
        'creating',
        claim_time + INTERVAL '1 hour',
        claim_time + INTERVAL '2 hours'
    )
    RETURNING * INTO intent_row;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT)
    TO service_role;

-- Bind the exact Stripe Customer before any Checkout Session can be created.
-- This durable snapshot is the lookup scope for crash recovery.
CREATE OR REPLACE FUNCTION public.snapshot_checkout_intent_customer(
    p_intent_id UUID,
    p_stripe_customer_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    IF p_intent_id IS NULL
       OR p_stripe_customer_id IS NULL
       OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_customer_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status <> 'creating'
       OR intent_row.stripe_checkout_session_id IS NOT NULL
       OR intent_row.completed_at IS NOT NULL
       OR (
           intent_row.stripe_customer_id IS NOT NULL
           AND intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id
       ) THEN
        RAISE EXCEPTION 'checkout_intent_customer_cannot_be_snapshotted'
            USING ERRCODE = '42501';
    END IF;

    IF intent_row.stripe_customer_id IS NULL THEN
        UPDATE public.checkout_intents
        SET
            stripe_customer_id = p_stripe_customer_id,
            updated_at = clock_timestamp()
        WHERE id = p_intent_id
        RETURNING * INTO intent_row;
    END IF;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_checkout_intent_customer(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_checkout_intent_customer(UUID, TEXT)
    TO service_role;

-- Release a creating intent only after the application exhaustively proved
-- that its exact Customer has no Stripe Session carrying the intent metadata.
CREATE OR REPLACE FUNCTION public.release_abandoned_checkout_intent(
    p_intent_id UUID,
    p_stripe_customer_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    IF p_intent_id IS NULL
       OR p_stripe_customer_id IS NULL
       OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_abandoned_checkout_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status <> 'creating'
       OR intent_row.stripe_checkout_session_id IS NOT NULL
       OR intent_row.completed_at IS NOT NULL
       OR intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id
       OR intent_row.expires_at > clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_intent_cannot_be_abandoned'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.checkout_intents
    SET
        status = 'expired',
        updated_at = clock_timestamp()
    WHERE id = p_intent_id
    RETURNING * INTO intent_row;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_abandoned_checkout_intent(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_abandoned_checkout_intent(UUID, TEXT)
    TO service_role;

-- Complete the exact claimed intent after Stripe confirms payment. The CRM
-- approval remains frozen until the subscription conversion update succeeds.
CREATE OR REPLACE FUNCTION public.complete_checkout_intent(
    p_intent_id UUID,
    p_opportunity_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_stripe_checkout_session_id TEXT,
    p_stripe_customer_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    completion_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_intent_id IS NULL
       OR p_opportunity_id IS NULL
       OR p_student_id IS NULL
       OR p_package_price_id IS NULL
       OR p_stripe_checkout_session_id IS NULL
       OR p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
       OR p_stripe_customer_id IS NULL
       OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_checkout_session_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.opportunity_id IS DISTINCT FROM p_opportunity_id
       OR intent_row.student_id IS DISTINCT FROM p_student_id
       OR intent_row.package_price_id IS DISTINCT FROM p_package_price_id
       OR intent_row.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id
       OR intent_row.status NOT IN ('creating', 'open', 'completed')
       OR (
           intent_row.stripe_checkout_session_id IS NOT NULL
           AND intent_row.stripe_checkout_session_id IS DISTINCT FROM p_stripe_checkout_session_id
       ) THEN
        RAISE EXCEPTION 'checkout_intent_does_not_match_paid_session'
            USING ERRCODE = '42501';
    END IF;

    IF intent_row.status <> 'completed' THEN
        UPDATE public.checkout_intents
        SET
            status = 'completed',
            stripe_checkout_session_id = p_stripe_checkout_session_id,
            completed_at = completion_time,
            updated_at = completion_time
        WHERE id = p_intent_id
        RETURNING * INTO intent_row;
    END IF;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_checkout_intent(UUID, UUID, UUID, UUID, TEXT, TEXT)
    TO service_role;

-- Release either an open reservation with its exact stored Session, or a
-- creating reservation whose verified expired Session was never persisted.
CREATE OR REPLACE FUNCTION public.release_expired_checkout_intent(
    p_intent_id UUID,
    p_stripe_checkout_session_id TEXT
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    IF p_intent_id IS NULL
       OR p_stripe_checkout_session_id IS NULL
       OR p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_expired_checkout_session_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR NOT (
           (
               intent_row.status = 'creating'
               AND intent_row.stripe_checkout_session_id IS NULL
           )
           OR (
               intent_row.status = 'open'
               AND intent_row.stripe_checkout_session_id = p_stripe_checkout_session_id
           )
       ) THEN
        RAISE EXCEPTION 'checkout_intent_cannot_be_released'
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.checkout_intents
    SET
        status = 'expired',
        stripe_checkout_session_id = p_stripe_checkout_session_id,
        completed_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = p_intent_id
    RETURNING * INTO intent_row;

    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_expired_checkout_intent(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_checkout_intent(UUID, TEXT)
    TO service_role;

-- Atomically binds one verified Stripe Price to a catalog version. Only the
-- service role may invoke this internal synchronization boundary.
CREATE OR REPLACE FUNCTION public.activate_package_price(
    p_package_id UUID,
    p_catalog_version BIGINT,
    p_duration_months SMALLINT,
    p_amount_cents INTEGER,
    p_currency TEXT,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_stripe_product_id TEXT,
    p_stripe_price_id TEXT,
    p_activated_by UUID DEFAULT NULL
)
RETURNS public.package_prices
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    activation_time TIMESTAMPTZ := clock_timestamp();
    expected_amount INTEGER;
BEGIN
    IF p_package_id IS NULL
       OR p_catalog_version IS NULL
       OR p_duration_months IS NULL
       OR p_amount_cents IS NULL
       OR p_currency IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_livemode IS NULL
       OR p_stripe_product_id IS NULL
       OR p_stripe_price_id IS NULL
       OR p_catalog_version <= 0
       OR p_duration_months NOT IN (1, 3, 6)
       OR p_amount_cents <= 0
       OR p_currency <> 'eur'
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_product_id !~ '^prod_[A-Za-z0-9_]+$'
       OR p_stripe_price_id !~ '^price_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_package_price_activation'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'package_not_found'
            USING ERRCODE = '23503';
    END IF;

    IF package_row.catalog_version IS DISTINCT FROM p_catalog_version THEN
        RAISE EXCEPTION 'stale_package_catalog_version'
            USING ERRCODE = '40001';
    END IF;

    expected_amount := CASE p_duration_months
        WHEN 1 THEN package_row.price_monthly
        WHEN 3 THEN ROUND(package_row.price_monthly::NUMERIC * 3 * 90 / 100)::INTEGER
        WHEN 6 THEN ROUND(package_row.price_monthly::NUMERIC * 6 * 80 / 100)::INTEGER
    END;

    IF expected_amount IS DISTINCT FROM p_amount_cents THEN
        RAISE EXCEPTION 'package_price_amount_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    IF p_activated_by IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.profiles
           WHERE id = p_activated_by AND role = 'admin'
       ) THEN
        RAISE EXCEPTION 'activated_by_must_be_admin'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE stripe_price_id = p_stripe_price_id
    FOR UPDATE;

    IF FOUND THEN
        IF price_row.status <> 'active'
           OR price_row.package_id IS DISTINCT FROM p_package_id
           OR price_row.catalog_version IS DISTINCT FROM p_catalog_version
           OR price_row.duration_months IS DISTINCT FROM p_duration_months
           OR price_row.amount_cents IS DISTINCT FROM p_amount_cents
           OR price_row.currency IS DISTINCT FROM p_currency
           OR (
               price_row.stripe_account_id IS NOT NULL
               AND price_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
           )
           OR price_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
           OR price_row.stripe_product_id IS DISTINCT FROM p_stripe_product_id THEN
            RAISE EXCEPTION 'stripe_price_id_already_bound_to_another_offer'
                USING ERRCODE = '23505';
        END IF;

        IF price_row.stripe_account_id IS NULL THEN
            UPDATE public.package_prices
            SET stripe_account_id = p_stripe_account_id
            WHERE id = price_row.id
            RETURNING * INTO price_row;
        END IF;
    ELSE
        UPDATE public.package_prices
        SET status = 'retired', retired_at = activation_time
        WHERE package_id = p_package_id
          AND duration_months = p_duration_months
          AND status = 'active';

        INSERT INTO public.package_prices (
            package_id,
            catalog_version,
            package_key,
            display_name,
            duration_months,
            amount_cents,
            currency,
            sessions_per_month,
            sessions_per_period,
            has_group_session,
            has_dual_teacher,
            stripe_account_id,
            stripe_livemode,
            stripe_product_id,
            stripe_price_id,
            status,
            activated_at,
            created_by
        ) VALUES (
            package_row.id,
            package_row.catalog_version,
            package_row.name,
            package_row.display_name,
            p_duration_months,
            p_amount_cents,
            p_currency,
            package_row.sessions_per_month,
            package_row.sessions_per_month * p_duration_months,
            COALESCE(package_row.has_group_session, FALSE),
            COALESCE(package_row.has_dual_teacher, FALSE),
            p_stripe_account_id,
            p_stripe_livemode,
            p_stripe_product_id,
            p_stripe_price_id,
            'active',
            activation_time,
            p_activated_by
        ) RETURNING * INTO price_row;
    END IF;

    UPDATE public.packages
    SET
        stripe_product_id = p_stripe_product_id,
        stripe_price_1m = CASE
            WHEN p_duration_months = 1 THEN p_stripe_price_id ELSE stripe_price_1m
        END,
        stripe_price_3m = CASE
            WHEN p_duration_months = 3 THEN p_stripe_price_id ELSE stripe_price_3m
        END,
        stripe_price_6m = CASE
            WHEN p_duration_months = 6 THEN p_stripe_price_id ELSE stripe_price_6m
        END
    WHERE id = p_package_id;

    RETURN price_row;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_package_price(
    UUID, BIGINT, SMALLINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_package_price(
    UUID, BIGINT, SMALLINT, INTEGER, TEXT, TEXT, BOOLEAN, TEXT, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_versioned_package_price(
    p_package_id UUID,
    p_catalog_version BIGINT,
    p_amount_cents INTEGER,
    p_currency TEXT,
    p_billing_interval_unit TEXT,
    p_billing_interval_count SMALLINT,
    p_sessions_per_period INTEGER,
    p_class_duration_minutes SMALLINT,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_stripe_product_id TEXT,
    p_stripe_price_id TEXT,
    p_activated_by UUID DEFAULT NULL
)
RETURNS public.package_prices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    activation_time TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_package_id IS NULL
       OR p_catalog_version IS NULL
       OR p_amount_cents IS NULL
       OR p_currency IS NULL
       OR p_billing_interval_unit IS NULL
       OR p_billing_interval_count IS NULL
       OR p_sessions_per_period IS NULL
       OR p_class_duration_minutes IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_livemode IS NULL
       OR p_stripe_product_id IS NULL
       OR p_stripe_price_id IS NULL
       OR p_catalog_version <= 0
       OR p_amount_cents <= 0
       OR p_currency <> 'eur'
       OR p_billing_interval_unit NOT IN ('day', 'week', 'month', 'year')
       OR p_billing_interval_count <= 0
       OR p_sessions_per_period <= 0
       OR p_class_duration_minutes <= 0
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_product_id !~ '^prod_[A-Za-z0-9_]+$'
       OR p_stripe_price_id !~ '^price_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_versioned_package_price_activation'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = p_package_id
    FOR UPDATE;

    IF NOT FOUND
       OR package_row.contract_schema_version <> 2
       OR package_row.catalog_version IS DISTINCT FROM p_catalog_version
       OR package_row.amount_cents IS DISTINCT FROM p_amount_cents
       OR package_row.billing_interval_unit IS DISTINCT FROM p_billing_interval_unit
       OR package_row.billing_interval_count IS DISTINCT FROM p_billing_interval_count
       OR package_row.sessions_per_period IS DISTINCT FROM p_sessions_per_period
       OR package_row.class_duration_minutes IS DISTINCT FROM p_class_duration_minutes THEN
        RAISE EXCEPTION 'versioned_package_price_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    IF p_activated_by IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.profiles
           WHERE id = p_activated_by AND role = 'admin'
       ) THEN
        RAISE EXCEPTION 'activated_by_must_be_admin'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE stripe_price_id = p_stripe_price_id
    FOR UPDATE;

    IF FOUND THEN
        IF price_row.status <> 'active'
           OR price_row.package_id IS DISTINCT FROM p_package_id
           OR price_row.catalog_version IS DISTINCT FROM p_catalog_version
           OR price_row.contract_schema_version <> 2
           OR price_row.amount_cents IS DISTINCT FROM p_amount_cents
           OR price_row.currency IS DISTINCT FROM p_currency
           OR price_row.billing_interval_unit IS DISTINCT FROM p_billing_interval_unit
           OR price_row.billing_interval_count IS DISTINCT FROM p_billing_interval_count
           OR price_row.sessions_per_period IS DISTINCT FROM p_sessions_per_period
           OR price_row.class_duration_minutes IS DISTINCT FROM p_class_duration_minutes
           OR price_row.stripe_account_id IS DISTINCT FROM p_stripe_account_id
           OR price_row.stripe_livemode IS DISTINCT FROM p_stripe_livemode
           OR price_row.stripe_product_id IS DISTINCT FROM p_stripe_product_id THEN
            RAISE EXCEPTION 'stripe_price_id_already_bound_to_another_offer'
                USING ERRCODE = '23505';
        END IF;

        RETURN price_row;
    END IF;

    UPDATE public.package_prices
    SET status = 'retired', retired_at = activation_time
    WHERE package_id = p_package_id
      AND contract_schema_version = 2
      AND status = 'active';

    INSERT INTO public.package_prices (
        package_id, catalog_version, package_key, display_name,
        duration_months, amount_cents, currency, sessions_per_month,
        sessions_per_period, has_group_session, has_dual_teacher,
        stripe_account_id, stripe_livemode, stripe_product_id, stripe_price_id,
        status, activated_at, created_by, contract_schema_version,
        billing_interval_unit, billing_interval_count, class_duration_minutes
    ) VALUES (
        package_row.id, package_row.catalog_version, package_row.name, package_row.display_name,
        NULL, p_amount_cents, p_currency, NULL,
        p_sessions_per_period, COALESCE(package_row.has_group_session, FALSE),
        COALESCE(package_row.has_dual_teacher, FALSE), p_stripe_account_id,
        p_stripe_livemode, p_stripe_product_id, p_stripe_price_id,
        'active', activation_time, p_activated_by, 2,
        p_billing_interval_unit, p_billing_interval_count, p_class_duration_minutes
    )
    RETURNING * INTO price_row;

    RETURN price_row;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_versioned_package_price(
    UUID, BIGINT, INTEGER, TEXT, TEXT, SMALLINT, INTEGER, SMALLINT,
    TEXT, BOOLEAN, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_versioned_package_price(
    UUID, BIGINT, INTEGER, TEXT, TEXT, SMALLINT, INTEGER, SMALLINT,
    TEXT, BOOLEAN, TEXT, TEXT, UUID
) TO service_role;

COMMENT ON COLUMN public.packages.contract_schema_version IS
    '1 keeps the historical monthly catalogue; 2 uses explicit immutable interval and class terms.';
COMMENT ON FUNCTION public.activate_versioned_package_price(
    UUID, BIGINT, INTEGER, TEXT, TEXT, SMALLINT, INTEGER, SMALLINT,
    TEXT, BOOLEAN, TEXT, TEXT, UUID
) IS 'Binds one verified Stripe Price to a version-2 contract snapshot; service role only.';

COMMENT ON TABLE public.package_prices IS
    'Immutable Stripe offers. Active rows are valid for new checkout; retired rows remain resolvable for paid sessions and renewals.';
COMMENT ON COLUMN public.crm_opportunities.checkout_approved_at IS
    'Explicit admin approval for checkout of preferred_package_id. Proposal stage alone is not authorization.';
COMMENT ON COLUMN public.subscriptions.contracted_sessions_per_period IS
    'Immutable quota purchased for each renewal period; catalog edits do not affect existing subscriptions.';

-- Atomic, service-role-only recipient reservation. The hard ceilings preserve
-- margin below Resend Free's 100/day and 3,000/month provider limits.
CREATE OR REPLACE FUNCTION public.reserve_email_recipient_budget(
    p_budget_scope TEXT,
    p_recipient_count INTEGER,
    p_daily_limit INTEGER,
    p_monthly_limit INTEGER,
    p_source TEXT
)
RETURNS TABLE (
    daily_used INTEGER,
    monthly_used INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_day_start DATE := (v_now AT TIME ZONE 'UTC')::DATE;
    v_month_start DATE := date_trunc('month', v_now AT TIME ZONE 'UTC')::DATE;
    v_daily_used INTEGER;
    v_monthly_used INTEGER;
BEGIN
    IF p_budget_scope IS NULL
       OR char_length(p_budget_scope) NOT BETWEEN 1 AND 64
       OR p_budget_scope !~ '^[a-z0-9:_-]+$' THEN
        RAISE EXCEPTION 'email_budget_invalid_scope' USING ERRCODE = '22023';
    END IF;

    IF p_source IS NULL
       OR char_length(p_source) NOT BETWEEN 1 AND 80
       OR p_source !~ '^[a-z0-9_.:-]+$' THEN
        RAISE EXCEPTION 'email_budget_invalid_source' USING ERRCODE = '22023';
    END IF;

    IF p_recipient_count IS NULL OR p_recipient_count < 1 OR p_recipient_count > 80 THEN
        RAISE EXCEPTION 'email_budget_invalid_recipient_count' USING ERRCODE = '22023';
    END IF;

    IF p_daily_limit IS NULL OR p_daily_limit < 1 OR p_daily_limit > 80 THEN
        RAISE EXCEPTION 'email_budget_invalid_daily_limit' USING ERRCODE = '22023';
    END IF;

    IF p_monthly_limit IS NULL OR p_monthly_limit < 1 OR p_monthly_limit > 2400 THEN
        RAISE EXCEPTION 'email_budget_invalid_monthly_limit' USING ERRCODE = '22023';
    END IF;

    IF p_recipient_count > p_daily_limit THEN
        RAISE EXCEPTION 'email_budget_daily_exceeded' USING ERRCODE = 'P0001';
    END IF;

    IF p_recipient_count > p_monthly_limit THEN
        RAISE EXCEPTION 'email_budget_monthly_exceeded' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.email_recipient_budget_usage AS usage (
        budget_scope, period_kind, period_start, recipient_count,
        last_source, created_at, updated_at
    ) VALUES (
        p_budget_scope, 'day', v_day_start, p_recipient_count,
        p_source, v_now, v_now
    )
    ON CONFLICT (budget_scope, period_kind, period_start) DO UPDATE
    SET recipient_count = usage.recipient_count + EXCLUDED.recipient_count,
        last_source = EXCLUDED.last_source,
        updated_at = v_now
    WHERE usage.recipient_count + EXCLUDED.recipient_count <= p_daily_limit
    RETURNING usage.recipient_count INTO v_daily_used;

    IF v_daily_used IS NULL THEN
        RAISE EXCEPTION 'email_budget_daily_exceeded' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.email_recipient_budget_usage AS usage (
        budget_scope, period_kind, period_start, recipient_count,
        last_source, created_at, updated_at
    ) VALUES (
        p_budget_scope, 'month', v_month_start, p_recipient_count,
        p_source, v_now, v_now
    )
    ON CONFLICT (budget_scope, period_kind, period_start) DO UPDATE
    SET recipient_count = usage.recipient_count + EXCLUDED.recipient_count,
        last_source = EXCLUDED.last_source,
        updated_at = v_now
    WHERE usage.recipient_count + EXCLUDED.recipient_count <= p_monthly_limit
    RETURNING usage.recipient_count INTO v_monthly_used;

    IF v_monthly_used IS NULL THEN
        RAISE EXCEPTION 'email_budget_monthly_exceeded' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT v_daily_used, v_monthly_used;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_email_recipient_budget(TEXT, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;

-- Claim/finalize one exact provider effect in short, fenced transactions.
-- External I/O occurs between these RPCs and never while a row lock is held.
CREATE OR REPLACE FUNCTION public.claim_fulfillment_effect(
    p_job_id UUID,
    p_effect_key TEXT,
    p_effect_type TEXT,
    p_payload_sha256 TEXT,
    p_lease_owner TEXT,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
    effect_id UUID,
    claimed BOOLEAN,
    effect_status TEXT,
    attempt_generation BIGINT,
    provider_id TEXT,
    result JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_effect public.fulfillment_effects%ROWTYPE;
BEGIN
    IF p_job_id IS NULL
       OR p_effect_key IS NULL
       OR pg_catalog.char_length(p_effect_key) NOT BETWEEN 1 AND 200
       OR p_effect_key !~ '^[a-z0-9][a-z0-9_.:/-]*$'
       OR p_effect_type IS NULL
       OR pg_catalog.char_length(p_effect_type) NOT BETWEEN 1 AND 80
       OR p_effect_type !~ '^[a-z][a-z0-9_.:-]*$'
       OR p_payload_sha256 IS NULL
       OR p_payload_sha256 !~ '^[a-f0-9]{64}$'
       OR p_lease_owner IS NULL
       OR pg_catalog.char_length(p_lease_owner) NOT BETWEEN 1 AND 200
       OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
       OR p_lease_seconds IS NULL
       OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
        RAISE EXCEPTION 'fulfillment_effect_claim_invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.fulfillment_effects (
        job_id,
        effect_key,
        effect_type,
        payload_sha256
    ) VALUES (
        p_job_id,
        p_effect_key,
        p_effect_type,
        p_payload_sha256
    )
    ON CONFLICT (job_id, effect_key) DO NOTHING;

    SELECT effect.*
    INTO v_effect
    FROM public.fulfillment_effects AS effect
    WHERE effect.job_id = p_job_id
      AND effect.effect_key = p_effect_key
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fulfillment_effect_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_effect.effect_type IS DISTINCT FROM p_effect_type
       OR v_effect.payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
        RAISE EXCEPTION 'fulfillment_effect_identity_mismatch' USING ERRCODE = 'P0001';
    END IF;

    IF v_effect.status IN ('succeeded', 'ambiguous', 'manual_review') THEN
        RETURN QUERY SELECT
            v_effect.id,
            FALSE,
            v_effect.status,
            v_effect.attempt_generation,
            v_effect.provider_id,
            v_effect.result;
        RETURN;
    END IF;

    IF v_effect.status = 'processing' THEN
        IF v_effect.lease_expires_at > v_now THEN
            RETURN QUERY SELECT
                v_effect.id,
                FALSE,
                v_effect.status,
                v_effect.attempt_generation,
                v_effect.provider_id,
                v_effect.result;
            RETURN;
        END IF;

        UPDATE public.fulfillment_effects AS effect
        SET status = 'ambiguous',
            lease_owner = NULL,
            lease_expires_at = NULL,
            error = pg_catalog.jsonb_build_object(
                'code', 'lease_expired_before_finalization',
                'expired_at', v_effect.lease_expires_at,
                'detected_at', v_now
            ),
            updated_at = v_now
        WHERE effect.id = v_effect.id
          AND effect.status = 'processing'
          AND effect.attempt_generation = v_effect.attempt_generation
          AND effect.lease_owner IS NOT DISTINCT FROM v_effect.lease_owner
        RETURNING effect.* INTO v_effect;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'fulfillment_effect_claim_conflict' USING ERRCODE = 'P0001';
        END IF;

        RETURN QUERY SELECT
            v_effect.id,
            FALSE,
            v_effect.status,
            v_effect.attempt_generation,
            v_effect.provider_id,
            v_effect.result;
        RETURN;
    END IF;

    IF v_effect.status NOT IN ('pending', 'failed') THEN
        RAISE EXCEPTION 'fulfillment_effect_not_claimable' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fulfillment_effects AS effect
    SET status = 'processing',
        attempt_generation = v_effect.attempt_generation + 1,
        lease_owner = p_lease_owner,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        provider_id = NULL,
        error = NULL,
        result = NULL,
        first_attempt_at = COALESCE(v_effect.first_attempt_at, v_now),
        last_attempt_at = v_now,
        completed_at = NULL,
        updated_at = v_now
    WHERE effect.id = v_effect.id
      AND effect.status = v_effect.status
      AND effect.attempt_generation = v_effect.attempt_generation
      AND effect.lease_owner IS NOT DISTINCT FROM v_effect.lease_owner
    RETURNING effect.* INTO v_effect;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'fulfillment_effect_claim_conflict' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT
        v_effect.id,
        TRUE,
        v_effect.status,
        v_effect.attempt_generation,
        v_effect.provider_id,
        v_effect.result;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_fulfillment_effect(
    p_effect_id UUID,
    p_lease_owner TEXT,
    p_attempt_generation BIGINT,
    p_outcome TEXT,
    p_provider_id TEXT DEFAULT NULL,
    p_error JSONB DEFAULT NULL,
    p_result JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    IF p_effect_id IS NULL
       OR p_lease_owner IS NULL
       OR pg_catalog.char_length(p_lease_owner) NOT BETWEEN 1 AND 200
       OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'
       OR p_attempt_generation IS NULL
       OR p_attempt_generation < 1
       OR p_outcome IS NULL
       OR p_outcome NOT IN ('succeeded', 'failed', 'ambiguous', 'manual_review')
       OR (
           p_provider_id IS NOT NULL
           AND pg_catalog.char_length(p_provider_id) NOT BETWEEN 1 AND 512
       )
       OR (p_error IS NOT NULL AND pg_catalog.jsonb_typeof(p_error) <> 'object')
       OR (p_result IS NOT NULL AND pg_catalog.jsonb_typeof(p_result) <> 'object') THEN
        RAISE EXCEPTION 'fulfillment_effect_finalize_invalid' USING ERRCODE = '22023';
    END IF;

    IF (p_outcome = 'succeeded' AND p_error IS NOT NULL)
       OR (p_outcome <> 'succeeded' AND p_error IS NULL)
       OR (p_outcome = 'failed' AND p_provider_id IS NOT NULL) THEN
        RAISE EXCEPTION 'fulfillment_effect_finalize_incoherent' USING ERRCODE = '22023';
    END IF;

    UPDATE public.fulfillment_effects AS effect
    SET status = p_outcome,
        lease_owner = NULL,
        lease_expires_at = NULL,
        provider_id = p_provider_id,
        error = p_error,
        result = p_result,
        completed_at = CASE WHEN p_outcome = 'succeeded' THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE effect.id = p_effect_id
      AND effect.status = 'processing'
      AND effect.lease_owner = p_lease_owner
      AND effect.attempt_generation = p_attempt_generation
      AND effect.lease_expires_at > v_now;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER)
    TO service_role;

REVOKE ALL ON FUNCTION public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB)
    TO service_role;

COMMENT ON TABLE public.fulfillment_effects IS
    'Durable, fenced checkpoints for one external side effect of a fulfillment job.';
COMMENT ON FUNCTION public.claim_fulfillment_effect(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) IS
    'Creates or atomically claims one exact effect; expired processing leases become ambiguous and are never replayed blindly.';
COMMENT ON FUNCTION public.finalize_fulfillment_effect(UUID, TEXT, BIGINT, TEXT, TEXT, JSONB, JSONB) IS
    'Finalizes only the exact unexpired lease owner and attempt generation for a fulfillment effect.';

-- Atomically cancel a scheduled class and return its credit when policy allows.
-- The service-role-only RPC prevents a cancelled class from being committed
-- separately from the corresponding subscription balance adjustment.
CREATE OR REPLACE FUNCTION public.cancel_scheduled_session(
    p_session_id UUID,
    p_cancelled_by UUID,
    p_cancelled_by_role TEXT,
    p_cancellation_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
    session_id UUID,
    subscription_id UUID,
    cancelled_at TIMESTAMPTZ,
    late_student_cancellation BOOLEAN,
    quota_restore_attempted BOOLEAN,
    quota_restored BOOLEAN,
    previous_sessions_used INTEGER,
    next_sessions_used INTEGER,
    hours_until_class DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_cancelled_at TIMESTAMPTZ := clock_timestamp();
    v_late_student_cancellation BOOLEAN := FALSE;
    v_quota_restore_attempted BOOLEAN := FALSE;
    v_quota_restored BOOLEAN := FALSE;
    v_previous_sessions_used INTEGER := NULL;
    v_next_sessions_used INTEGER := NULL;
    v_hours_until_class DOUBLE PRECISION := NULL;
BEGIN
    IF p_cancelled_by_role NOT IN ('student', 'teacher', 'admin') THEN
        RAISE EXCEPTION 'invalid_cancelled_by_role' USING ERRCODE = '22023';
    END IF;

    SELECT session_row.*
    INTO v_session
    FROM public.sessions AS session_row
    WHERE session_row.id = p_session_id
    FOR UPDATE;

    IF NOT FOUND OR v_session.status IS DISTINCT FROM 'scheduled' THEN
        RETURN;
    END IF;

    IF (p_cancelled_by_role = 'student' AND p_cancelled_by IS DISTINCT FROM v_session.student_id)
        OR (p_cancelled_by_role = 'teacher' AND p_cancelled_by IS DISTINCT FROM v_session.teacher_id)
        OR (
            p_cancelled_by_role = 'admin'
            AND NOT EXISTS (
                SELECT 1
                FROM public.profiles AS actor_profile
                WHERE actor_profile.id = p_cancelled_by
                  AND actor_profile.role = 'admin'
            )
        ) THEN
        RAISE EXCEPTION 'session_cancellation_forbidden' USING ERRCODE = '42501';
    END IF;

    IF v_session.scheduled_at IS NOT NULL THEN
        v_hours_until_class := (
            EXTRACT(EPOCH FROM (v_session.scheduled_at - v_cancelled_at)) / 3600
        )::DOUBLE PRECISION;
        v_late_student_cancellation := p_cancelled_by_role = 'student'
            AND v_session.scheduled_at < v_cancelled_at + INTERVAL '24 hours';
    END IF;

    IF NOT v_late_student_cancellation AND v_session.subscription_id IS NOT NULL THEN
        SELECT COALESCE(subscription_row.sessions_used, 0)
        INTO v_previous_sessions_used
        FROM public.subscriptions AS subscription_row
        WHERE subscription_row.id = v_session.subscription_id
        FOR UPDATE;

        IF FOUND AND v_previous_sessions_used > 0 THEN
            v_quota_restore_attempted := TRUE;
            v_next_sessions_used := v_previous_sessions_used - 1;

            UPDATE public.subscriptions
            SET sessions_used = v_next_sessions_used
            WHERE id = v_session.subscription_id;

            v_quota_restored := TRUE;
        END IF;
    END IF;

    UPDATE public.sessions
    SET status = 'cancelled',
        cancellation_reason = p_cancellation_reason,
        cancelled_at = v_cancelled_at,
        cancelled_by = p_cancelled_by
    WHERE id = v_session.id;

    RETURN QUERY
    SELECT
        v_session.id,
        v_session.subscription_id,
        v_cancelled_at,
        v_late_student_cancellation,
        v_quota_restore_attempted,
        v_quota_restored,
        v_previous_sessions_used,
        v_next_sessions_used,
        v_hours_until_class;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_session(UUID, UUID, TEXT, TEXT) TO service_role;

-- Helper function: checks if current user is admin.
-- It lives outside the exposed public API schema.
CREATE OR REPLACE FUNCTION private.is_admin() RETURNS boolean
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

-- DB-level role guard for profile relationships used by campus operations.
-- This is the last barrier behind API/admin/service-role writes.
CREATE OR REPLACE FUNCTION private.enforce_profile_role_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
    student_role public.user_role;
    teacher_role public.user_role;
BEGIN
    IF TG_TABLE_NAME = 'student_teachers' THEN
        SELECT role INTO student_role FROM public.profiles WHERE id = NEW.student_id;
        IF student_role IS DISTINCT FROM 'student'::public.user_role THEN
            RAISE EXCEPTION 'studentId must belong to a student profile' USING ERRCODE = '23514';
        END IF;

        SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
        IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
            RAISE EXCEPTION 'teacherId must belong to a teacher profile' USING ERRCODE = '23514';
        END IF;

    ELSIF TG_TABLE_NAME = 'sessions' THEN
        SELECT role INTO student_role FROM public.profiles WHERE id = NEW.student_id;
        IF student_role IS DISTINCT FROM 'student'::public.user_role THEN
            RAISE EXCEPTION 'studentId must belong to a student profile' USING ERRCODE = '23514';
        END IF;

        IF NEW.teacher_id IS NOT NULL THEN
            SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
            IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
                RAISE EXCEPTION 'teacherId must belong to a teacher profile' USING ERRCODE = '23514';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME IN ('subscriptions', 'payments', 'fulfillment_jobs') THEN
        IF NEW.student_id IS NOT NULL THEN
            SELECT role INTO student_role FROM public.profiles WHERE id = NEW.student_id;
            IF student_role IS DISTINCT FROM 'student'::public.user_role THEN
                RAISE EXCEPTION 'studentId must belong to a student profile' USING ERRCODE = '23514';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'teacher_availability' THEN
        SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
        IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
            RAISE EXCEPTION 'teacherId must belong to a teacher profile' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM public;
REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM anon;
REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_profile_role_links() TO service_role;

-- LEADS POLICIES
CREATE POLICY "Admins can manage leads" 
    ON leads FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Admins can view leads" 
    ON leads FOR SELECT TO authenticated USING ((select private.is_admin()));

-- CRM POLICIES
CREATE POLICY "Admins can manage crm contacts"
    ON crm_contacts FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

CREATE POLICY "Admins can manage crm opportunities"
    ON crm_opportunities FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

CREATE POLICY "Admins can manage crm tasks"
    ON crm_tasks FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

CREATE POLICY "Admins can manage crm activities"
    ON crm_activities FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

CREATE POLICY "Admins can manage crm consents"
    ON crm_consents FOR ALL TO authenticated
    USING ((select private.is_admin()))
    WITH CHECK ((select private.is_admin()));

-- PACKAGES POLICIES
CREATE POLICY "Admins can manage packages" 
    ON packages FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Anyone can view active packages" 
    ON packages FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view publicly listed packages"
    ON packages FOR SELECT USING (is_publicly_listed = true);

-- WEBHOOK / FULFILLMENT / AUDIT POLICIES
CREATE POLICY "Admins can view processed webhook events"
    ON processed_webhook_events FOR SELECT TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Admins can manage fulfillment jobs"
    ON fulfillment_jobs FOR ALL TO authenticated USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));

-- SUPPORT TICKETS POLICIES
CREATE POLICY "Users can create own support tickets"
    ON support_tickets FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Admins can view audit log"
    ON admin_audit_log FOR SELECT TO authenticated USING ((select private.is_admin()));

-- PAYMENTS POLICIES
CREATE POLICY "Admins can manage payments" 
    ON payments FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Students can view own payments" 
    ON payments FOR SELECT TO authenticated USING (student_id = (select auth.uid()));

-- PROFILES POLICIES
CREATE POLICY "Admins can do everything on profiles" 
    ON profiles FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Students can view their teachers" 
    ON profiles FOR SELECT
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM student_teachers st
        WHERE st.student_id = (SELECT auth.uid())
          AND st.teacher_id = profiles.id
    ));

CREATE POLICY "Teachers can view their students" 
    ON profiles FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM student_teachers st WHERE st.teacher_id = (select auth.uid()) AND st.student_id = profiles.id));

CREATE POLICY "Users can update own profile" 
    ON profiles FOR UPDATE TO authenticated
    USING ((select auth.uid()) = id) WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "Users can view own profile" 
    ON profiles FOR SELECT TO authenticated USING ((select auth.uid()) = id);

CREATE POLICY "Admins can manage profiles_private"
    ON profiles_private FOR ALL TO authenticated USING ((select private.is_admin())) WITH CHECK ((select private.is_admin()));

-- SESSIONS POLICIES
CREATE POLICY "Admins can manage sessions" 
    ON sessions FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Students can view own sessions" 
    ON sessions FOR SELECT TO authenticated USING (student_id = (select auth.uid()));

CREATE POLICY "Teachers can view assigned sessions"
    ON sessions FOR SELECT TO authenticated
    USING (teacher_id = (select auth.uid()));

-- STUDENT_TEACHERS POLICIES
CREATE POLICY "Admins can manage assignments" 
    ON student_teachers FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Students can see their teachers" 
    ON student_teachers FOR SELECT TO authenticated USING (student_id = (select auth.uid()));

CREATE POLICY "Teachers can see their students" 
    ON student_teachers FOR SELECT TO authenticated USING (teacher_id = (select auth.uid()));

-- SUBSCRIPTIONS POLICIES
CREATE POLICY "Admins can manage subscriptions" 
    ON subscriptions FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Students can view own subscriptions" 
    ON subscriptions FOR SELECT TO authenticated USING (student_id = (select auth.uid()));

CREATE POLICY "Teachers can view assigned student subscriptions" 
    ON subscriptions FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM student_teachers st WHERE st.teacher_id = (select auth.uid()) AND st.student_id = subscriptions.student_id));

-- TEACHER_AVAILABILITY POLICIES
CREATE POLICY "Admins can manage all availability" 
    ON teacher_availability FOR ALL TO authenticated USING ((select private.is_admin()));

CREATE POLICY "Students can view assigned teacher availability" 
    ON teacher_availability FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM student_teachers st WHERE st.student_id = (select auth.uid()) AND st.teacher_id = teacher_availability.teacher_id));

CREATE POLICY "Teachers can manage own availability" 
    ON teacher_availability FOR ALL TO authenticated
    USING (teacher_id = (select auth.uid()))
    WITH CHECK (teacher_id = (select auth.uid()));

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

CREATE OR REPLACE FUNCTION get_available_slots(
    p_teacher_id UUID,
    p_date DATE,
    p_duration_minutes INTEGER DEFAULT 50
)
RETURNS TABLE (
    slot_start TIMESTAMPTZ,
    slot_end TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_day_of_week INTEGER;
    v_timezone TEXT := 'Europe/Madrid';
BEGIN
    v_day_of_week := EXTRACT(DOW FROM p_date);

    RETURN QUERY
    WITH availability_slots AS (
        SELECT
            (p_date + ta.start_time) AT TIME ZONE v_timezone AS block_start,
            (p_date + ta.end_time) AT TIME ZONE v_timezone AS block_end
        FROM teacher_availability ta
        WHERE ta.teacher_id = p_teacher_id
          AND ta.day_of_week = v_day_of_week
          AND ta.is_active = TRUE
    ),
    existing_sessions AS (
        SELECT
            s.scheduled_at AS session_start,
            s.scheduled_at + (s.duration_minutes || ' minutes')::INTERVAL AS session_end
        FROM sessions s
        WHERE s.teacher_id = p_teacher_id
          AND DATE(s.scheduled_at AT TIME ZONE v_timezone) = p_date
          AND s.status <> 'cancelled'
    ),
    time_slots AS (
        SELECT
            generate_series(
                a.block_start,
                a.block_end - (p_duration_minutes || ' minutes')::INTERVAL,
                (p_duration_minutes || ' minutes')::INTERVAL
            ) AS slot_start
        FROM availability_slots a
    )
    SELECT
        ts.slot_start,
        ts.slot_start + (p_duration_minutes || ' minutes')::INTERVAL AS slot_end
    FROM time_slots ts
    WHERE NOT EXISTS (
        SELECT 1
        FROM existing_sessions es
        WHERE ts.slot_start < es.session_end
          AND ts.slot_start + (p_duration_minutes || ' minutes')::INTERVAL > es.session_start
    )
    ORDER BY ts.slot_start;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM public;
REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_available_slots(UUID, DATE, INTEGER) TO service_role;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_age_policy_version CONSTANT TEXT := '2026-07-10';
    v_requested_age_policy_version TEXT;
    v_adult_confirmed BOOLEAN;
BEGIN
    v_requested_age_policy_version := NULLIF(
        btrim(NEW.raw_user_meta_data->>'age_policy_version'),
        ''
    );
    v_adult_confirmed := COALESCE(
        NEW.raw_user_meta_data->'adult_confirmed' = 'true'::jsonb,
        FALSE
    ) AND COALESCE(
        v_requested_age_policy_version = v_current_age_policy_version,
        FALSE
    );

    INSERT INTO profiles (
        id,
        email,
        full_name,
        adult_confirmed,
        adult_confirmed_at,
        age_policy_version
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
        v_adult_confirmed,
        CASE WHEN v_adult_confirmed THEN clock_timestamp() ELSE NULL END,
        CASE WHEN v_adult_confirmed THEN v_current_age_policy_version ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO profiles_private (profile_id)
    VALUES (NEW.id)
    ON CONFLICT (profile_id) DO NOTHING;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION handle_new_user() FROM public;
GRANT EXECUTE ON FUNCTION handle_new_user() TO service_role;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE FUNCTION private.protect_profile_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.adult_confirmed IS DISTINCT FROM OLD.adult_confirmed
        OR NEW.adult_confirmed_at IS DISTINCT FROM OLD.adult_confirmed_at
        OR NEW.age_policy_version IS DISTINCT FROM OLD.age_policy_version THEN
        RAISE EXCEPTION 'Cannot modify adult account attestation';
    END IF;

    IF (select private.is_admin()) THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Cannot modify role';
    END IF;

    IF NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'Cannot modify profile email';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_profile_role() FROM public;
REVOKE ALL ON FUNCTION private.protect_profile_role() FROM anon;
REVOKE ALL ON FUNCTION private.protect_profile_role() FROM authenticated;
GRANT EXECUTE ON FUNCTION private.protect_profile_role() TO service_role;

CREATE TRIGGER protect_profile_role_trigger
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION private.protect_profile_role();

CREATE TRIGGER enforce_student_teacher_profile_roles
    BEFORE INSERT OR UPDATE OF student_id, teacher_id ON student_teachers
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

CREATE TRIGGER enforce_session_profile_roles
    BEFORE INSERT OR UPDATE OF student_id, teacher_id ON sessions
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

CREATE TRIGGER enforce_subscription_student_role
    BEFORE INSERT OR UPDATE OF student_id ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

CREATE TRIGGER enforce_payment_student_role
    BEFORE INSERT OR UPDATE OF student_id ON payments
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

CREATE TRIGGER enforce_fulfillment_job_student_role
    BEFORE INSERT OR UPDATE OF student_id ON fulfillment_jobs
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

CREATE TRIGGER enforce_teacher_availability_teacher_role
    BEFORE INSERT OR UPDATE OF teacher_id ON teacher_availability
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

CREATE TRIGGER update_profiles_private_updated_at
    BEFORE UPDATE ON profiles_private
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_packages_updated_at
    BEFORE UPDATE ON packages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_teacher_availability_updated_at
    BEFORE UPDATE ON teacher_availability
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_fulfillment_jobs_updated_at
    BEFORE UPDATE ON fulfillment_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_fulfillment_effects_updated_at
    BEFORE UPDATE ON fulfillment_effects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_crm_contacts_updated_at
    BEFORE UPDATE ON crm_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_crm_opportunities_updated_at
    BEFORE UPDATE ON crm_opportunities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_crm_tasks_updated_at
    BEFORE UPDATE ON crm_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_crm_consents_updated_at
    BEFORE UPDATE ON crm_consents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Durable staging integration smoke lease/recovery state (service-role only).
CREATE TABLE public.staging_integration_smoke_runs (
    run_id UUID PRIMARY KEY,
    lease_name TEXT NOT NULL CHECK (lease_name = 'google-resend-write-smoke'),
    lease_generation BIGINT NOT NULL CHECK (lease_generation > 0),
    marker TEXT NOT NULL UNIQUE CHECK (marker ~ '^SMOKE-INTEGRATION-[A-Za-z0-9-]{20,160}$'),
    status TEXT NOT NULL CHECK (status IN ('running', 'cleaning', 'cleanup_required', 'cleaned')),
    phase TEXT NOT NULL CHECK (phase ~ '^[a-z0-9_]{2,80}$'),
    base_host TEXT NOT NULL CONSTRAINT staging_integration_smoke_runs_base_host_check CHECK (
        base_host = 'espanolhonesto-staging.alindev95.workers.dev'
        OR base_host = 'staging.espanolhonesto.com'
        OR base_host ~ '^[a-z0-9]+(?:-[a-z0-9]+)*-espanolhonesto-staging[.]alindev95[.]workers[.]dev$'
    ),
    student_id UUID NOT NULL REFERENCES public.profiles(id),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id),
    subscription_id UUID NOT NULL REFERENCES public.subscriptions(id),
    scheduled_at TIMESTAMPTZ NOT NULL,
    original_full_name TEXT,
    original_private_profile JSONB NOT NULL CHECK (
        jsonb_typeof(original_private_profile) = 'object'
        AND original_private_profile ?& ARRAY['drive_folder_id', 'drive_folder_url', 'google_account_email']
        AND (original_private_profile - ARRAY['drive_folder_id', 'drive_folder_url', 'google_account_email']::TEXT[]) = '{}'::JSONB
        AND (original_private_profile->'drive_folder_id' = 'null'::JSONB OR jsonb_typeof(original_private_profile->'drive_folder_id') = 'string')
        AND (original_private_profile->'drive_folder_url' = 'null'::JSONB OR jsonb_typeof(original_private_profile->'drive_folder_url') = 'string')
        AND (original_private_profile->'google_account_email' = 'null'::JSONB OR jsonb_typeof(original_private_profile->'google_account_email') = 'string')
    ),
    session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    fulfillment_job_id UUID REFERENCES public.fulfillment_jobs(id) ON DELETE SET NULL,
    cancellation_job_id UUID REFERENCES public.fulfillment_jobs(id) ON DELETE SET NULL,
    drive_root_ids TEXT[] NOT NULL DEFAULT '{}',
    calendar_event_ids TEXT[] NOT NULL DEFAULT '{}',
    email_budget_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    email_idempotency_key TEXT GENERATED ALWAYS AS (
        'staging-integration-smoke/email/' || run_id::TEXT
    ) STORED UNIQUE,
    email_status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        email_status IN ('not_started', 'sending', 'retryable', 'sent', 'terminal_failed')
    ),
    email_payload_sha256 TEXT CHECK (email_payload_sha256 ~ '^[a-f0-9]{64}$'),
    email_attempt_generation BIGINT NOT NULL DEFAULT 0 CHECK (email_attempt_generation >= 0),
    email_locked_at TIMESTAMPTZ,
    email_first_attempt_at TIMESTAMPTZ,
    email_last_attempt_at TIMESTAMPTZ,
    email_provider_id TEXT,
    email_error_code TEXT CHECK (email_error_code ~ '^[a-z0-9_]{2,80}$'),
    email_http_status INTEGER CHECK (email_http_status BETWEEN 100 AND 599),
    email_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (email_status = 'sent' AND email_provider_id IS NOT NULL AND email_sent_at IS NOT NULL)
        OR (email_status <> 'sent' AND email_provider_id IS NULL AND email_sent_at IS NULL)
    )
);

CREATE INDEX staging_integration_smoke_runs_active_idx
    ON public.staging_integration_smoke_runs(status, updated_at)
    WHERE status IN ('running', 'cleaning', 'cleanup_required');
CREATE UNIQUE INDEX staging_integration_smoke_runs_one_active_idx
    ON public.staging_integration_smoke_runs(lease_name)
    WHERE status IN ('running', 'cleaning', 'cleanup_required');

ALTER TABLE public.staging_integration_smoke_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staging_integration_smoke_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staging_integration_smoke_runs TO service_role;

CREATE TABLE public.staging_integration_smoke_leases (
    lease_name TEXT PRIMARY KEY CHECK (lease_name = 'google-resend-write-smoke'),
    run_id UUID NOT NULL,
    owner_token UUID NOT NULL,
    generation BIGINT NOT NULL DEFAULT 1 CHECK (generation > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.staging_integration_smoke_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staging_integration_smoke_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.staging_integration_smoke_leases TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_staging_integration_smoke_lease(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_ttl_seconds INTEGER
)
RETURNS TABLE (acquired BOOLEAN, expires_at TIMESTAMPTZ, generation BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
    v_generation BIGINT;
BEGIN
    IF p_lease_name IS DISTINCT FROM 'google-resend-write-smoke'
       OR p_run_id IS NULL
       OR p_owner_token IS NULL
       OR p_ttl_seconds NOT BETWEEN 60 AND 3600 THEN
        RAISE EXCEPTION 'invalid_staging_smoke_lease_request' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.staging_integration_smoke_runs AS smoke_run
        WHERE smoke_run.run_id <> p_run_id
          AND smoke_run.status IN ('running', 'cleaning', 'cleanup_required')
    ) THEN
        RETURN QUERY SELECT FALSE, COALESCE(
            (
                SELECT lease.expires_at
                FROM public.staging_integration_smoke_leases AS lease
                WHERE lease.lease_name = p_lease_name
            ),
            v_now
        ), COALESCE((
            SELECT lease.generation
            FROM public.staging_integration_smoke_leases AS lease
            WHERE lease.lease_name = p_lease_name
        ), 0::BIGINT);
        RETURN;
    END IF;

    INSERT INTO public.staging_integration_smoke_leases AS lease (
        lease_name,
        run_id,
        owner_token,
        generation,
        expires_at,
        updated_at
    ) VALUES (
        p_lease_name,
        p_run_id,
        p_owner_token,
        1,
        v_now + make_interval(secs => p_ttl_seconds),
        v_now
    )
    ON CONFLICT (lease_name) DO UPDATE
    SET run_id = EXCLUDED.run_id,
        owner_token = EXCLUDED.owner_token,
        generation = CASE
            WHEN lease.run_id = EXCLUDED.run_id
             AND lease.owner_token = EXCLUDED.owner_token
             AND lease.expires_at > v_now
                THEN lease.generation
            ELSE lease.generation + 1
        END,
        expires_at = EXCLUDED.expires_at,
        updated_at = v_now
    WHERE lease.expires_at <= v_now
       OR (
           lease.run_id = EXCLUDED.run_id
           AND lease.owner_token = EXCLUDED.owner_token
       )
    RETURNING lease.expires_at, lease.generation INTO v_expires_at, v_generation;

    IF v_expires_at IS NULL THEN
        RETURN QUERY SELECT FALSE, lease.expires_at, lease.generation
        FROM public.staging_integration_smoke_leases AS lease
        WHERE lease.lease_name = p_lease_name;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, v_expires_at, v_generation;
END;
$$;

CREATE OR REPLACE FUNCTION public.renew_staging_integration_smoke_lease(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_ttl_seconds INTEGER
)
RETURNS TABLE (renewed BOOLEAN, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
BEGIN
    IF p_ttl_seconds NOT BETWEEN 60 AND 3600 THEN
        RAISE EXCEPTION 'invalid_staging_smoke_lease_request' USING ERRCODE = '22023';
    END IF;

    UPDATE public.staging_integration_smoke_leases AS lease
    SET expires_at = v_now + make_interval(secs => p_ttl_seconds),
        updated_at = v_now
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
    RETURNING lease.expires_at INTO v_expires_at;

    RETURN QUERY SELECT v_expires_at IS NOT NULL, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_staging_integration_smoke_lease(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    UPDATE public.staging_integration_smoke_leases
    SET expires_at = LEAST(expires_at, v_now),
        updated_at = v_now
    WHERE lease_name = p_lease_name
      AND run_id = p_run_id
      AND owner_token = p_owner_token
      AND generation = p_generation;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_staging_integration_smoke_job(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_job_id UUID,
    p_dedupe_key TEXT,
    p_smoke_marker TEXT,
    p_student_id UUID,
    p_worker_id TEXT
)
RETURNS TABLE (claimed BOOLEAN, job_status TEXT, attempts INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_job public.fulfillment_jobs%ROWTYPE;
    v_run public.staging_integration_smoke_runs%ROWTYPE;
    v_claimed_attempts INTEGER;
BEGIN
    SELECT smoke_run.*
    INTO v_run
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND smoke_run.marker = p_smoke_marker
      AND smoke_run.student_id = p_student_id
      AND smoke_run.status IN ('running', 'cleaning')
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_job_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    SELECT job.*
    INTO v_job
    FROM public.fulfillment_jobs AS job
    WHERE job.id = p_job_id
      AND job.dedupe_key = p_dedupe_key
      AND job.student_id = p_student_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_job_not_found' USING ERRCODE = 'P0001';
    END IF;

    IF v_job.job_type NOT IN ('session_fulfillment', 'session_cancellation')
       OR v_job.dedupe_key IS DISTINCT FROM (CASE v_job.job_type
            WHEN 'session_fulfillment' THEN 'staging-integration:' || p_smoke_marker
            ELSE 'staging-integration-cleanup:' || p_smoke_marker
          END)
       OR v_job.id IS DISTINCT FROM (CASE v_job.job_type
            WHEN 'session_fulfillment' THEN v_run.fulfillment_job_id
            ELSE v_run.cancellation_job_id
          END)
       OR v_job.session_id IS DISTINCT FROM v_run.session_id
       OR v_job.subscription_id IS DISTINCT FROM v_run.subscription_id
       OR v_job.payload->'sendEmail' IS DISTINCT FROM 'false'::JSONB
       OR v_job.payload->'smokeMarker' IS DISTINCT FROM to_jsonb(p_smoke_marker)
       OR v_job.payload->'smokeRunId' IS DISTINCT FROM to_jsonb(p_run_id::TEXT)
       OR v_job.run_at IS DISTINCT FROM TIMESTAMPTZ '2099-01-01 00:00:00+00' THEN
        RAISE EXCEPTION 'exact_job_identity_mismatch' USING ERRCODE = 'P0001';
    END IF;

    IF v_job.status = 'succeeded' THEN
        RETURN QUERY SELECT FALSE, v_job.status, v_job.attempts;
        RETURN;
    END IF;
    IF v_job.status = 'processing'
       AND v_job.locked_by ~ ('^[a-z0-9-]+:' || p_run_id::TEXT || ':[0-9]+$')
       AND v_job.locked_by IS DISTINCT FROM p_worker_id THEN
        NULL;
    ELSIF v_job.status NOT IN ('pending', 'failed') THEN
        RAISE EXCEPTION 'exact_job_not_processable' USING ERRCODE = 'P0001';
    END IF;
    IF v_job.attempts >= v_job.max_attempts THEN
        RAISE EXCEPTION 'exact_job_not_processable' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fulfillment_jobs AS job
    SET status = 'processing',
        attempts = v_job.attempts + 1,
        locked_at = v_now,
        locked_by = p_worker_id,
        last_error = NULL
    WHERE job.id = v_job.id
      AND job.status = v_job.status
      AND job.attempts = v_job.attempts
      AND job.locked_by IS NOT DISTINCT FROM v_job.locked_by
    RETURNING job.attempts INTO v_claimed_attempts;
    IF v_claimed_attempts IS NULL THEN
        RAISE EXCEPTION 'exact_job_claim_conflict' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT TRUE, 'processing'::TEXT, v_claimed_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_staging_integration_smoke_job(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_job_id UUID,
    p_worker_id TEXT,
    p_attempts INTEGER,
    p_succeeded BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    PERFORM 1
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND p_job_id IN (smoke_run.fulfillment_job_id, smoke_run.cancellation_job_id)
      AND smoke_run.status IN ('running', 'cleaning')
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_job_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.fulfillment_jobs
    SET status = CASE WHEN p_succeeded THEN 'succeeded' ELSE 'failed' END,
        locked_at = NULL,
        locked_by = NULL,
        last_error = CASE WHEN p_succeeded THEN NULL ELSE 'SMOKE_JOB_EXECUTION_FAILED' END
    WHERE id = p_job_id
      AND status = 'processing'
      AND locked_by = p_worker_id
      AND attempts = p_attempts;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_staging_integration_smoke_email(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_smoke_marker TEXT,
    p_base_host TEXT,
    p_payload_sha256 TEXT,
    p_daily_limit INTEGER,
    p_monthly_limit INTEGER
)
RETURNS TABLE (
    claimed BOOLEAN,
    email_status TEXT,
    attempt_generation BIGINT,
    idempotency_key TEXT,
    provider_id TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_run public.staging_integration_smoke_runs%ROWTYPE;
BEGIN
    IF p_payload_sha256 !~ '^[a-f0-9]{64}$'
       OR p_daily_limit NOT BETWEEN 1 AND 10
       OR p_monthly_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'exact_email_request_invalid' USING ERRCODE = '22023';
    END IF;

    SELECT smoke_run.*
    INTO v_run
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND smoke_run.marker = p_smoke_marker
      AND smoke_run.base_host = p_base_host
      AND smoke_run.status = 'running'
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_email_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    IF v_run.email_payload_sha256 IS NOT NULL
       AND v_run.email_payload_sha256 IS DISTINCT FROM p_payload_sha256 THEN
        RAISE EXCEPTION 'exact_email_payload_mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF v_run.email_status = 'sent' THEN
        RETURN QUERY SELECT FALSE, v_run.email_status, v_run.email_attempt_generation,
            v_run.email_idempotency_key, v_run.email_provider_id;
        RETURN;
    END IF;
    IF v_run.email_status = 'terminal_failed'
       OR (
           v_run.email_first_attempt_at IS NOT NULL
           AND v_run.email_first_attempt_at <= v_now - INTERVAL '23 hours'
       ) THEN
        RAISE EXCEPTION 'exact_email_retry_window_expired' USING ERRCODE = 'P0001';
    END IF;
    IF v_run.email_status = 'sending'
       AND v_run.email_locked_at > v_now - INTERVAL '2 minutes' THEN
        RETURN QUERY SELECT FALSE, v_run.email_status, v_run.email_attempt_generation,
            v_run.email_idempotency_key, NULL::TEXT;
        RETURN;
    END IF;

    IF NOT v_run.email_budget_reserved THEN
        PERFORM * FROM public.reserve_email_recipient_budget(
            'nonproduction',
            1,
            p_daily_limit,
            p_monthly_limit,
            'staging_integration_smoke'
        );
    END IF;

    UPDATE public.staging_integration_smoke_runs
    SET email_budget_reserved = TRUE,
        email_status = 'sending',
        email_payload_sha256 = p_payload_sha256,
        email_attempt_generation = email_attempt_generation + 1,
        email_locked_at = v_now,
        email_first_attempt_at = COALESCE(email_first_attempt_at, v_now),
        email_last_attempt_at = v_now,
        email_error_code = NULL,
        email_http_status = NULL,
        updated_at = v_now
    WHERE run_id = p_run_id
      AND lease_generation = p_generation
      AND email_attempt_generation = v_run.email_attempt_generation
    RETURNING staging_integration_smoke_runs.* INTO v_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_email_claim_conflict' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY SELECT TRUE, v_run.email_status, v_run.email_attempt_generation,
        v_run.email_idempotency_key, NULL::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_staging_integration_smoke_email(
    p_lease_name TEXT,
    p_run_id UUID,
    p_owner_token UUID,
    p_generation BIGINT,
    p_attempt_generation BIGINT,
    p_outcome TEXT,
    p_provider_id TEXT,
    p_error_code TEXT,
    p_http_status INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_updated_count BIGINT;
BEGIN
    IF p_outcome NOT IN ('sent', 'retryable', 'terminal_failed')
       OR (p_error_code IS NOT NULL AND p_error_code !~ '^[a-z0-9_]{2,80}$')
       OR (p_http_status IS NOT NULL AND p_http_status NOT BETWEEN 100 AND 599)
       OR (p_outcome = 'sent' AND (p_provider_id IS NULL OR p_error_code IS NOT NULL))
       OR (p_outcome <> 'sent' AND p_provider_id IS NOT NULL) THEN
        RAISE EXCEPTION 'exact_email_finalize_invalid' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.staging_integration_smoke_leases AS lease
    JOIN public.staging_integration_smoke_runs AS smoke_run
      ON smoke_run.run_id = lease.run_id
    WHERE lease.lease_name = p_lease_name
      AND lease.run_id = p_run_id
      AND lease.owner_token = p_owner_token
      AND lease.generation = p_generation
      AND lease.expires_at > v_now
      AND smoke_run.lease_generation = p_generation
      AND smoke_run.status = 'running'
    FOR UPDATE OF lease, smoke_run;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'exact_email_lease_invalid' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.staging_integration_smoke_runs
    SET email_status = p_outcome,
        email_locked_at = NULL,
        email_provider_id = CASE WHEN p_outcome = 'sent' THEN p_provider_id ELSE NULL END,
        email_error_code = CASE WHEN p_outcome = 'sent' THEN NULL ELSE COALESCE(p_error_code, 'provider_unknown') END,
        email_http_status = p_http_status,
        email_sent_at = CASE WHEN p_outcome = 'sent' THEN v_now ELSE NULL END,
        updated_at = v_now
    WHERE run_id = p_run_id
      AND lease_generation = p_generation
      AND email_status = 'sending'
      AND email_attempt_generation = p_attempt_generation;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_staging_integration_smoke_lease(TEXT, UUID, UUID, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_staging_integration_smoke_lease(TEXT, UUID, UUID, INTEGER)
    TO service_role;
REVOKE ALL ON FUNCTION public.renew_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT, INTEGER)
    TO service_role;
REVOKE ALL ON FUNCTION public.claim_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, TEXT, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, TEXT, UUID, TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staging_integration_smoke_job(
    TEXT, UUID, UUID, BIGINT, UUID, TEXT, INTEGER, BOOLEAN
) TO service_role;
REVOKE ALL ON FUNCTION public.claim_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staging_integration_smoke_email(
    TEXT, UUID, UUID, BIGINT, BIGINT, TEXT, TEXT, TEXT, INTEGER
) TO service_role;
REVOKE ALL ON FUNCTION public.release_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_staging_integration_smoke_lease(TEXT, UUID, UUID, BIGINT)
    TO service_role;

COMMENT ON TABLE public.staging_integration_smoke_runs IS
    'Durable, service-role-only recovery state for the focused staging integration smoke.';
COMMENT ON TABLE public.staging_integration_smoke_leases IS
    'Exclusive TTL lease preventing concurrent focused staging integration smoke runs.';

-- =============================================
-- SEED DATA: PACKAGES
-- =============================================
INSERT INTO packages (name, display_name, price_monthly, sessions_per_month, has_group_session, has_dual_teacher, is_active) VALUES
('group', '{"es": "Grupal Externo", "en": "External Group", "ru": "Групповые занятия"}', 5000, 4, TRUE, FALSE, TRUE),
('standard', '{"es": "Mensual Estándar", "en": "Standard Monthly", "ru": "Стандартный месяц"}', 14500, 4, FALSE, FALSE, TRUE),
('hybrid', '{"es": "Híbrido Mensual", "en": "Hybrid Monthly", "ru": "Гибридный месяц"}', 15000, 4, TRUE, TRUE, TRUE),
('bootcamp', '{"es": "Intensivo Bootcamp", "en": "Bootcamp Intensive", "ru": "Интенсив Bootcamp"}', 34500, 20, FALSE, FALSE, TRUE);

INSERT INTO packages (
    name,
    display_name,
    price_monthly,
    sessions_per_month,
    has_group_session,
    has_dual_teacher,
    is_active,
    is_publicly_listed,
    contract_schema_version,
    amount_cents,
    billing_interval_unit,
    billing_interval_count,
    sessions_per_period,
    class_duration_minutes
) VALUES (
    'individual_4x50_28d',
    '{"es":"4 clases individuales","en":"4 individual classes","ru":"4 индивидуальных занятия"}'::jsonb,
    25900,
    4,
    FALSE,
    FALSE,
    FALSE,
    TRUE,
    2,
    25900,
    'day',
    28,
    4,
    50
);
-- Added by the post-smoke model hardening migration. Keep these outside the
-- verbatim staging-only migration block above while retaining the final schema.
CREATE INDEX staging_integration_smoke_runs_student_idx
    ON public.staging_integration_smoke_runs(student_id);
CREATE INDEX staging_integration_smoke_runs_teacher_idx
    ON public.staging_integration_smoke_runs(teacher_id);
CREATE INDEX staging_integration_smoke_runs_subscription_idx
    ON public.staging_integration_smoke_runs(subscription_id);
CREATE INDEX staging_integration_smoke_runs_session_idx
    ON public.staging_integration_smoke_runs(session_id);
CREATE INDEX staging_integration_smoke_runs_fulfillment_job_idx
    ON public.staging_integration_smoke_runs(fulfillment_job_id);
CREATE INDEX staging_integration_smoke_runs_cancellation_job_idx
    ON public.staging_integration_smoke_runs(cancellation_job_id);

-- A sellable slot is capacity, not generic teacher availability. The first
-- four occurrences are stored as exact instants so checkout can snapshot a
-- real teacher, weekly time and first class before collecting payment.

ALTER TABLE public.subscriptions
    ADD COLUMN checkout_intent_id UUID
        REFERENCES public.checkout_intents(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX subscriptions_checkout_intent_unique_idx
    ON public.subscriptions(checkout_intent_id)
    WHERE checkout_intent_id IS NOT NULL;

CREATE TABLE public.bookable_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    package_id UUID NOT NULL,
    contract_schema_version SMALLINT NOT NULL DEFAULT 2 CHECK (contract_schema_version = 2),
    teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    local_start_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    timezone_name TEXT NOT NULL CHECK (timezone_name = 'Europe/Madrid'),
    first_occurrence_at TIMESTAMPTZ NOT NULL,
    capacity SMALLINT NOT NULL DEFAULT 1 CHECK (capacity = 1),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'available', 'paused', 'sold', 'retired')),
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    sold_at TIMESTAMPTZ,
    sold_subscription_id UUID UNIQUE REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    sessions_materialized_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT bookable_slots_package_contract_fkey
        FOREIGN KEY (package_id, contract_schema_version)
        REFERENCES public.packages(id, contract_schema_version) ON DELETE RESTRICT,
    CONSTRAINT bookable_slots_lifecycle_check CHECK (
        (
            status = 'draft'
            AND published_at IS NULL
            AND published_by IS NULL
            AND sold_at IS NULL
            AND sold_subscription_id IS NULL
            AND sessions_materialized_at IS NULL
        )
        OR (
            status IN ('available', 'paused')
            AND published_at IS NOT NULL
            AND published_by IS NOT NULL
            AND sold_at IS NULL
            AND sold_subscription_id IS NULL
            AND sessions_materialized_at IS NULL
        )
        OR (
            status = 'sold'
            AND published_at IS NOT NULL
            AND published_by IS NOT NULL
            AND sold_at IS NOT NULL
            AND sold_subscription_id IS NOT NULL
        )
        OR (
            status = 'retired'
            AND sold_at IS NULL
            AND sold_subscription_id IS NULL
            AND sessions_materialized_at IS NULL
        )
    ),
    UNIQUE (id, teacher_id)
);

CREATE TABLE public.bookable_slot_occurrences (
    slot_id UUID NOT NULL,
    occurrence_index SMALLINT NOT NULL CHECK (occurrence_index BETWEEN 1 AND 4),
    teacher_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    duration_minutes SMALLINT NOT NULL DEFAULT 50 CHECK (duration_minutes = 50),
    blocks_teacher BOOLEAN NOT NULL DEFAULT FALSE,
    session_id UUID UNIQUE REFERENCES public.sessions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (slot_id, occurrence_index),
    CONSTRAINT bookable_slot_occurrences_slot_teacher_fkey
        FOREIGN KEY (slot_id, teacher_id)
        REFERENCES public.bookable_slots(id, teacher_id) ON DELETE CASCADE,
    UNIQUE (slot_id, starts_at)
);

ALTER TABLE public.bookable_slot_occurrences
    ADD CONSTRAINT bookable_slot_occurrences_teacher_overlap_excl
    EXCLUDE USING gist (
        teacher_id WITH =,
        public.session_tstzrange(starts_at, duration_minutes) WITH &&
    ) WHERE (blocks_teacher);

CREATE TABLE public.bookable_slot_holds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID NOT NULL REFERENCES public.bookable_slots(id) ON DELETE RESTRICT,
    checkout_intent_id UUID NOT NULL REFERENCES public.checkout_intents(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'held'
        CHECK (status IN ('held', 'consumed', 'expired', 'released')),
    held_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    close_reason TEXT,
    subscription_id UUID UNIQUE REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT bookable_slot_holds_expiry_check CHECK (
        expires_at > held_at
        AND expires_at <= held_at + INTERVAL '2 hours 5 minutes'
    ),
    CONSTRAINT bookable_slot_holds_lifecycle_check CHECK (
        (
            status = 'held'
            AND closed_at IS NULL
            AND close_reason IS NULL
            AND subscription_id IS NULL
        )
        OR (
            status = 'consumed'
            AND closed_at IS NOT NULL
            AND close_reason = 'paid'
            AND subscription_id IS NOT NULL
        )
        OR (
            status IN ('expired', 'released')
            AND closed_at IS NOT NULL
            AND NULLIF(btrim(close_reason), '') IS NOT NULL
            AND subscription_id IS NULL
        )
    )
);

CREATE INDEX bookable_slots_catalog_idx
    ON public.bookable_slots(package_id, status, weekday, local_start_time);
CREATE INDEX bookable_slot_occurrences_teacher_start_idx
    ON public.bookable_slot_occurrences(teacher_id, starts_at);
CREATE UNIQUE INDEX bookable_slot_holds_one_live_hold_idx
    ON public.bookable_slot_holds(slot_id)
    WHERE status = 'held';
CREATE UNIQUE INDEX bookable_slot_holds_checkout_idx
    ON public.bookable_slot_holds(checkout_intent_id);
CREATE INDEX bookable_slot_holds_reconciliation_idx
    ON public.bookable_slot_holds(expires_at)
    WHERE status = 'held';

ALTER TABLE public.bookable_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookable_slot_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookable_slot_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.bookable_slots
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bookable_slot_occurrences
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.bookable_slot_holds
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.bookable_slots TO service_role;
GRANT SELECT ON TABLE public.bookable_slot_occurrences TO service_role;
GRANT SELECT ON TABLE public.bookable_slot_holds TO service_role;

CREATE OR REPLACE FUNCTION private.guard_subscription_checkout_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT'
       AND NEW.contract_schema_version = 2
       AND NEW.checkout_intent_id IS NULL THEN
        RAISE EXCEPTION 'versioned_subscription_requires_checkout_binding'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.checkout_intent_id IS DISTINCT FROM OLD.checkout_intent_id THEN
        RAISE EXCEPTION 'subscription_checkout_binding_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_intent_id IS NOT NULL THEN
        SELECT * INTO intent_row
        FROM public.checkout_intents
        WHERE id = NEW.checkout_intent_id;

        SELECT sellable_slot.* INTO slot_row
        FROM public.bookable_slot_holds AS slot_hold
        JOIN public.bookable_slots AS sellable_slot
          ON sellable_slot.id = slot_hold.slot_id
        WHERE slot_hold.checkout_intent_id = NEW.checkout_intent_id
          AND slot_hold.status = 'held';

        IF intent_row.id IS NULL
           OR slot_row.id IS NULL
           OR intent_row.status <> 'completed'
           OR intent_row.stripe_checkout_session_id IS NULL
           OR NEW.contract_schema_version <> 2
           OR NEW.student_id IS DISTINCT FROM intent_row.student_id
           OR NEW.package_price_id IS DISTINCT FROM intent_row.package_price_id
           OR NEW.status <> 'active'
           OR NEW.stripe_subscription_id IS NULL
           OR NEW.stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
           OR NEW.stripe_invoice_id IS NULL
           OR NEW.stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$'
           OR NEW.starts_at IS DISTINCT FROM
                (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
           OR NEW.ends_at IS DISTINCT FROM NEW.starts_at + 28
           OR NEW.sessions_total <> 4
           OR NEW.contracted_sessions_per_period <> 4
           OR NEW.sessions_used IS DISTINCT FROM 0
           OR NEW.duration_months IS NOT NULL
           OR NEW.billing_interval_unit <> 'day'
           OR NEW.billing_interval_count <> 28
           OR NEW.class_duration_minutes <> 50 THEN
            RAISE EXCEPTION 'subscription_checkout_binding_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_subscription_checkout_binding()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_subscription_checkout_binding_trigger
    BEFORE INSERT OR UPDATE OF checkout_intent_id, student_id, package_price_id,
        status, stripe_subscription_id, contract_schema_version
    ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.guard_subscription_checkout_binding();

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    package_row public.packages%ROWTYPE;
    teacher_role public.user_role;
    actor_role public.user_role;
    occurrence_count INTEGER;
    occurrence_future BOOLEAN;
BEGIN
    SELECT * INTO package_row
    FROM public.packages
    WHERE id = NEW.package_id
      AND contract_schema_version = 2;

    IF NOT FOUND
       OR package_row.name <> 'individual_4x50_28d'
       OR package_row.amount_cents <> 25900
       OR package_row.billing_interval_unit <> 'day'
       OR package_row.billing_interval_count <> 28
       OR package_row.sessions_per_period <> 4
       OR package_row.class_duration_minutes <> 50 THEN
        RAISE EXCEPTION 'bookable_slot_requires_initial_v2_offer'
            USING ERRCODE = '23514';
    END IF;

    SELECT role INTO teacher_role
    FROM public.profiles
    WHERE id = NEW.teacher_id;
    IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
        RAISE EXCEPTION 'bookable_slot_teacher_must_be_teacher'
            USING ERRCODE = '23514';
    END IF;

    SELECT role INTO actor_role
    FROM public.profiles
    WHERE id = NEW.created_by;
    IF actor_role IS DISTINCT FROM 'admin'::public.user_role THEN
        RAISE EXCEPTION 'bookable_slot_creator_must_be_admin'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.published_by IS NOT NULL THEN
        SELECT role INTO actor_role
        FROM public.profiles
        WHERE id = NEW.published_by;
        IF actor_role IS DISTINCT FROM 'admin'::public.user_role THEN
            RAISE EXCEPTION 'bookable_slot_publisher_must_be_admin'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NEW.timezone_name <> 'Europe/Madrid' THEN
        RAISE EXCEPTION 'bookable_slot_timezone_is_not_supported'
            USING ERRCODE = '22023';
    END IF;

    IF EXTRACT(DOW FROM NEW.first_occurrence_at AT TIME ZONE NEW.timezone_name)::SMALLINT
            IS DISTINCT FROM NEW.weekday
       OR (NEW.first_occurrence_at AT TIME ZONE NEW.timezone_name)::TIME(0)
            IS DISTINCT FROM NEW.local_start_time THEN
        RAISE EXCEPTION 'bookable_slot_first_occurrence_does_not_match_local_time'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
        RAISE EXCEPTION 'bookable_slot_must_start_as_draft'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.public_id IS DISTINCT FROM OLD.public_id
           OR NEW.created_by IS DISTINCT FROM OLD.created_by
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.capacity IS DISTINCT FROM OLD.capacity
           OR NEW.contract_schema_version IS DISTINCT FROM OLD.contract_schema_version THEN
            RAISE EXCEPTION 'bookable_slot_identity_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status <> 'draft' AND ROW(
            NEW.package_id,
            NEW.teacher_id,
            NEW.weekday,
            NEW.local_start_time,
            NEW.timezone_name,
            NEW.first_occurrence_at
        ) IS DISTINCT FROM ROW(
            OLD.package_id,
            OLD.teacher_id,
            OLD.weekday,
            OLD.local_start_time,
            OLD.timezone_name,
            OLD.first_occurrence_at
        ) THEN
            RAISE EXCEPTION 'published_bookable_slot_contract_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.published_at IS NOT NULL
           AND ROW(NEW.published_at, NEW.published_by)
               IS DISTINCT FROM ROW(OLD.published_at, OLD.published_by) THEN
            RAISE EXCEPTION 'bookable_slot_publication_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.sold_at IS NOT NULL
           AND ROW(NEW.sold_at, NEW.sold_subscription_id)
               IS DISTINCT FROM ROW(OLD.sold_at, OLD.sold_subscription_id) THEN
            RAISE EXCEPTION 'bookable_slot_sale_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NOT (
            NEW.status = OLD.status
            OR (OLD.status = 'draft' AND NEW.status IN ('available', 'retired'))
            OR (OLD.status = 'available' AND NEW.status IN ('paused', 'sold', 'retired'))
            OR (OLD.status = 'paused' AND NEW.status IN ('available', 'retired'))
        ) THEN
            RAISE EXCEPTION 'bookable_slot_status_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status IN ('sold', 'retired')
           AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'terminal_bookable_slot_cannot_reopen'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.status IN ('paused', 'retired')
           AND OLD.status = 'available'
           AND EXISTS (
               SELECT 1
               FROM public.bookable_slot_holds
               WHERE slot_id = OLD.id AND status = 'held'
           ) THEN
            RAISE EXCEPTION 'held_bookable_slot_cannot_be_paused_or_retired'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.sessions_materialized_at IS DISTINCT FROM OLD.sessions_materialized_at
           AND NOT (
               OLD.status = 'sold'
               AND NEW.status = 'sold'
               AND OLD.sessions_materialized_at IS NULL
               AND NEW.sessions_materialized_at IS NOT NULL
           ) THEN
            RAISE EXCEPTION 'bookable_slot_materialization_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.sessions_materialized_at IS NOT NULL
           AND NEW.sessions_materialized_at IS DISTINCT FROM OLD.sessions_materialized_at THEN
            RAISE EXCEPTION 'bookable_slot_materialization_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status = 'available' AND (TG_OP = 'INSERT' OR OLD.status <> 'available') THEN
        IF NOT package_row.is_active
           OR NOT package_row.is_publicly_listed
           OR NOT EXISTS (
               SELECT 1
               FROM public.package_prices
               WHERE package_id = NEW.package_id
                 AND contract_schema_version = 2
                 AND status = 'active'
                 AND amount_cents = 25900
                 AND billing_interval_unit = 'day'
                 AND billing_interval_count = 28
                 AND sessions_per_period = 4
                 AND class_duration_minutes = 50
           ) THEN
            RAISE EXCEPTION 'bookable_slot_offer_is_not_active'
                USING ERRCODE = '23514';
        END IF;

        SELECT
            COUNT(*),
            COALESCE(BOOL_AND(starts_at > clock_timestamp()), FALSE)
        INTO occurrence_count, occurrence_future
        FROM public.bookable_slot_occurrences
        WHERE slot_id = NEW.id;

        IF occurrence_count <> 4 OR NOT occurrence_future THEN
            RAISE EXCEPTION 'bookable_slot_requires_four_future_occurrences'
                USING ERRCODE = '23514';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.teacher_availability
            WHERE teacher_id = NEW.teacher_id
              AND is_active = TRUE
              AND day_of_week = NEW.weekday
              AND start_time <= NEW.local_start_time
              AND end_time >= NEW.local_start_time + INTERVAL '50 minutes'
              AND NEW.local_start_time + INTERVAL '50 minutes' > NEW.local_start_time
        ) THEN
            RAISE EXCEPTION 'bookable_slot_is_outside_teacher_availability'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status = 'sold' THEN
        IF NEW.sold_subscription_id IS NULL
           OR NEW.sold_at IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM public.bookable_slot_holds
               WHERE slot_id = NEW.id
                  AND status = 'consumed'
                  AND subscription_id = NEW.sold_subscription_id
                  AND closed_at = NEW.sold_at
           ) THEN
            RAISE EXCEPTION 'sold_bookable_slot_requires_consumed_hold'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.sessions_materialized_at IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM (
               SELECT
                   COUNT(*) AS occurrence_count,
                   COUNT(session_row.id) AS session_count,
                   COALESCE(BOOL_AND(
                       session_row.subscription_id = NEW.sold_subscription_id
                       AND session_row.teacher_id = NEW.teacher_id
                       AND session_row.scheduled_at = occurrence_row.starts_at
                       AND session_row.duration_minutes = occurrence_row.duration_minutes
                       AND session_row.status = 'scheduled'
                       AND session_row.student_id = subscription_row.student_id
                   ), FALSE) AS exact_sessions
               FROM public.bookable_slot_occurrences AS occurrence_row
               LEFT JOIN public.sessions AS session_row
                 ON session_row.id = occurrence_row.session_id
               LEFT JOIN public.subscriptions AS subscription_row
                 ON subscription_row.id = NEW.sold_subscription_id
               WHERE occurrence_row.slot_id = NEW.id
           ) AS materialization
           WHERE materialization.occurrence_count = 4
             AND materialization.session_count = 4
             AND materialization.exact_sessions
       ) THEN
        RAISE EXCEPTION 'bookable_slot_materialization_requires_four_exact_sessions'
            USING ERRCODE = '23514';
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_contract()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_bookable_slot_contract_trigger
    BEFORE INSERT OR UPDATE ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_contract();

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_occurrence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
    expected_blocking BOOLEAN;
BEGIN
    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_occurrence_has_no_slot'
            USING ERRCODE = '23503';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF slot_row.status <> 'draft' THEN
            RAISE EXCEPTION 'published_bookable_slot_occurrences_are_immutable'
                USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND slot_row.status <> 'draft'
       AND ROW(NEW.slot_id, NEW.occurrence_index, NEW.starts_at, NEW.created_at)
           IS DISTINCT FROM
           ROW(OLD.slot_id, OLD.occurrence_index, OLD.starts_at, OLD.created_at) THEN
        RAISE EXCEPTION 'published_bookable_slot_occurrences_are_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.session_id IS DISTINCT FROM OLD.session_id
       AND NOT (
           slot_row.status = 'sold'
           AND slot_row.sessions_materialized_at IS NULL
           AND OLD.session_id IS NULL
           AND NEW.session_id IS NOT NULL
           AND EXISTS (
               SELECT 1
               FROM public.sessions AS session_row
               JOIN public.subscriptions AS subscription_row
                 ON subscription_row.id = slot_row.sold_subscription_id
               WHERE session_row.id = NEW.session_id
                 AND session_row.subscription_id = slot_row.sold_subscription_id
                 AND session_row.student_id = subscription_row.student_id
                 AND session_row.teacher_id = slot_row.teacher_id
                 AND session_row.scheduled_at = NEW.starts_at
                 AND session_row.duration_minutes = 50
                 AND session_row.status = 'scheduled'
           )
       ) THEN
        RAISE EXCEPTION 'bookable_slot_occurrence_session_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    NEW.teacher_id := slot_row.teacher_id;
    NEW.duration_minutes := 50;
    expected_blocking := slot_row.status IN ('available', 'paused', 'sold')
        AND slot_row.sessions_materialized_at IS NULL;
    NEW.blocks_teacher := expected_blocking;

    IF EXTRACT(DOW FROM NEW.starts_at AT TIME ZONE slot_row.timezone_name)::SMALLINT
            IS DISTINCT FROM slot_row.weekday
       OR (NEW.starts_at AT TIME ZONE slot_row.timezone_name)::TIME(0)
            IS DISTINCT FROM slot_row.local_start_time THEN
        RAISE EXCEPTION 'bookable_slot_occurrence_does_not_match_local_time'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_occurrences AS other
        WHERE other.slot_id = NEW.slot_id
          AND other.occurrence_index <> NEW.occurrence_index
          AND (
              (NEW.starts_at AT TIME ZONE slot_row.timezone_name)::DATE
              - (other.starts_at AT TIME ZONE slot_row.timezone_name)::DATE
          ) <> (NEW.occurrence_index - other.occurrence_index) * 7
    ) THEN
        RAISE EXCEPTION 'bookable_slot_occurrences_must_be_weekly_in_local_time'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.blocks_teacher THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.teacher_id::TEXT, 42850)
        );

        IF EXISTS (
            SELECT 1
            FROM public.sessions AS session_row
            WHERE session_row.teacher_id = NEW.teacher_id
              AND session_row.id IS DISTINCT FROM NEW.session_id
              AND session_row.status = 'scheduled'
              AND session_row.scheduled_at IS NOT NULL
              AND public.session_tstzrange(
                    session_row.scheduled_at,
                    session_row.duration_minutes
                  ) && public.session_tstzrange(NEW.starts_at, NEW.duration_minutes)
        ) THEN
            RAISE EXCEPTION 'bookable_slot_occurrence_overlaps_scheduled_session'
                USING ERRCODE = '23P01';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_occurrence()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_bookable_slot_occurrence_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.bookable_slot_occurrences
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_occurrence();

CREATE OR REPLACE FUNCTION private.validate_bookable_slot_occurrences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target_slot_id UUID;
    slot_row public.bookable_slots%ROWTYPE;
    occurrence_count INTEGER;
    occurrence_indexes SMALLINT[];
    occurrence_one TIMESTAMPTZ;
    local_pattern_valid BOOLEAN;
    blocking_valid BOOLEAN;
    materialized_binding_valid BOOLEAN;
BEGIN
    target_slot_id := CASE
        WHEN TG_TABLE_NAME = 'bookable_slots' THEN COALESCE(NEW.id, OLD.id)
        ELSE COALESCE(NEW.slot_id, OLD.slot_id)
    END;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = target_slot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COUNT(*),
        ARRAY_AGG(occurrence_index ORDER BY occurrence_index),
        MAX(starts_at) FILTER (WHERE occurrence_index = 1),
        COALESCE(BOOL_AND(
            EXTRACT(DOW FROM starts_at AT TIME ZONE slot_row.timezone_name)::SMALLINT
                = slot_row.weekday
            AND (starts_at AT TIME ZONE slot_row.timezone_name)::TIME(0)
                = slot_row.local_start_time
            AND (starts_at AT TIME ZONE slot_row.timezone_name)::DATE
                = (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
                  + ((occurrence_index - 1) * 7)
        ), FALSE),
        COALESCE(BOOL_AND(
            blocks_teacher = (
                slot_row.status IN ('available', 'paused', 'sold')
                AND slot_row.sessions_materialized_at IS NULL
            )
        ), FALSE),
        COALESCE(BOOL_AND(
            (
                slot_row.sessions_materialized_at IS NULL
                AND session_id IS NULL
            )
            OR (
                slot_row.sessions_materialized_at IS NOT NULL
                AND session_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.sessions AS materialized_session
                    JOIN public.subscriptions AS materialized_subscription
                      ON materialized_subscription.id = slot_row.sold_subscription_id
                    WHERE materialized_session.id = session_id
                      AND materialized_session.subscription_id = slot_row.sold_subscription_id
                      AND materialized_session.student_id = materialized_subscription.student_id
                      AND materialized_session.teacher_id = slot_row.teacher_id
                )
            )
        ), FALSE)
    INTO
        occurrence_count,
        occurrence_indexes,
        occurrence_one,
        local_pattern_valid,
        blocking_valid,
        materialized_binding_valid
    FROM public.bookable_slot_occurrences
    WHERE slot_id = target_slot_id;

    IF occurrence_count <> 4
       OR occurrence_indexes IS DISTINCT FROM ARRAY[1, 2, 3, 4]::SMALLINT[]
       OR occurrence_one IS DISTINCT FROM slot_row.first_occurrence_at
       OR NOT local_pattern_valid
       OR NOT blocking_valid
       OR NOT materialized_binding_valid THEN
        RAISE EXCEPTION 'bookable_slot_requires_exact_local_weekly_cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_bookable_slot_occurrences()
    FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER validate_bookable_slot_after_write
    AFTER INSERT OR UPDATE ON public.bookable_slots
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_bookable_slot_occurrences();

CREATE CONSTRAINT TRIGGER validate_bookable_slot_occurrence_after_write
    AFTER INSERT OR UPDATE OR DELETE ON public.bookable_slot_occurrences
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_bookable_slot_occurrences();

CREATE OR REPLACE FUNCTION private.sync_bookable_slot_occurrence_blocking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.bookable_slot_occurrences
    SET blocks_teacher = (
        NEW.status IN ('available', 'paused', 'sold')
        AND NEW.sessions_materialized_at IS NULL
    )
    WHERE slot_id = NEW.id;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_bookable_slot_occurrence_blocking()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_bookable_slot_occurrence_blocking_trigger
    AFTER UPDATE OF status, sessions_materialized_at ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.sync_bookable_slot_occurrence_blocking();

CREATE OR REPLACE FUNCTION private.guard_session_against_bookable_slots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'scheduled'
       AND NEW.teacher_id IS NOT NULL
       AND NEW.scheduled_at IS NOT NULL THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(NEW.teacher_id::TEXT, 42850)
        );

        IF EXISTS (
            SELECT 1
            FROM public.bookable_slot_occurrences AS occurrence_row
            JOIN public.bookable_slots AS slot_row
              ON slot_row.id = occurrence_row.slot_id
            WHERE occurrence_row.teacher_id = NEW.teacher_id
              AND occurrence_row.blocks_teacher
              AND public.session_tstzrange(
                    occurrence_row.starts_at,
                    occurrence_row.duration_minutes
                  ) && public.session_tstzrange(NEW.scheduled_at, NEW.duration_minutes)
              AND NOT (
                  slot_row.status = 'sold'
                  AND slot_row.sold_subscription_id = NEW.subscription_id
                  AND occurrence_row.starts_at = NEW.scheduled_at
                  AND occurrence_row.duration_minutes = NEW.duration_minutes
              )
        ) THEN
            RAISE EXCEPTION 'scheduled_session_overlaps_bookable_slot'
                USING ERRCODE = '23P01';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_session_against_bookable_slots()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_session_against_bookable_slots_trigger
    BEFORE INSERT OR UPDATE OF teacher_id, scheduled_at, duration_minutes, status
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_session_against_bookable_slots();

CREATE OR REPLACE FUNCTION private.guard_bookable_slot_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    occurrence_count INTEGER;
    occurrences_future BOOLEAN;
BEGIN
    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = NEW.checkout_intent_id;
    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = NEW.slot_id;

    IF intent_row.id IS NULL
       OR slot_row.id IS NULL
       OR NEW.expires_at IS DISTINCT FROM intent_row.expires_at
       OR NOT EXISTS (
           SELECT 1
           FROM public.package_prices
           WHERE id = intent_row.package_price_id
             AND package_id = slot_row.package_id
             AND contract_schema_version = 2
       ) THEN
        RAISE EXCEPTION 'bookable_slot_hold_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT * INTO package_row
        FROM public.packages
        WHERE id = slot_row.package_id;

        SELECT * INTO price_row
        FROM public.package_prices
        WHERE id = intent_row.package_price_id;

        SELECT
            COUNT(*),
            COALESCE(BOOL_AND(starts_at > clock_timestamp()), FALSE)
        INTO occurrence_count, occurrences_future
        FROM public.bookable_slot_occurrences
        WHERE slot_id = slot_row.id;

        IF NEW.status <> 'held'
           OR intent_row.status NOT IN ('creating', 'open')
           OR intent_row.expires_at <= clock_timestamp()
           OR slot_row.status <> 'available'
           OR slot_row.sessions_materialized_at IS NOT NULL
           OR package_row.id IS NULL
           OR NOT package_row.is_active
           OR NOT package_row.is_publicly_listed
           OR package_row.contract_schema_version <> 2
           OR package_row.name <> 'individual_4x50_28d'
           OR price_row.id IS NULL
           OR price_row.status <> 'active'
           OR price_row.amount_cents <> 25900
           OR price_row.currency <> 'eur'
           OR price_row.billing_interval_unit <> 'day'
           OR price_row.billing_interval_count <> 28
           OR price_row.sessions_per_period <> 4
           OR price_row.class_duration_minutes <> 50
           OR occurrence_count <> 4
           OR NOT occurrences_future
           OR slot_row.first_occurrence_at <= intent_row.expires_at THEN
            RAISE EXCEPTION 'bookable_slot_hold_cannot_start'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF ROW(
            NEW.id,
            NEW.slot_id,
            NEW.checkout_intent_id,
            NEW.held_at,
            NEW.expires_at,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.id,
            OLD.slot_id,
            OLD.checkout_intent_id,
            OLD.held_at,
            OLD.expires_at,
            OLD.created_at
        ) THEN
            RAISE EXCEPTION 'bookable_slot_hold_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF NOT (
            NEW.status = OLD.status
            OR (OLD.status = 'held' AND NEW.status IN ('consumed', 'expired', 'released'))
        ) THEN
            RAISE EXCEPTION 'bookable_slot_hold_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.status <> 'held' AND ROW(
            NEW.closed_at,
            NEW.close_reason,
            NEW.subscription_id
        ) IS DISTINCT FROM ROW(
            OLD.closed_at,
            OLD.close_reason,
            OLD.subscription_id
        ) THEN
            RAISE EXCEPTION 'terminal_bookable_slot_hold_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.status IN ('expired', 'released')
       AND intent_row.status <> 'expired' THEN
        RAISE EXCEPTION 'bookable_slot_hold_release_requires_expired_checkout'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'consumed' THEN
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = NEW.subscription_id;

        IF intent_row.status <> 'completed'
           OR subscription_row.id IS NULL
           OR subscription_row.student_id IS DISTINCT FROM intent_row.student_id
           OR subscription_row.package_id IS DISTINCT FROM slot_row.package_id
           OR subscription_row.package_price_id IS DISTINCT FROM intent_row.package_price_id
           OR subscription_row.checkout_intent_id IS DISTINCT FROM intent_row.id
           OR subscription_row.contract_schema_version <> 2
           OR subscription_row.status <> 'active'
           OR subscription_row.stripe_subscription_id IS NULL THEN
            RAISE EXCEPTION 'bookable_slot_hold_consumption_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bookable_slot_hold()
    FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_bookable_slot_hold_trigger
    BEFORE INSERT OR UPDATE ON public.bookable_slot_holds
    FOR EACH ROW EXECUTE FUNCTION private.guard_bookable_slot_hold();

CREATE OR REPLACE FUNCTION private.validate_versioned_checkout_slot_hold()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.package_prices
        WHERE id = NEW.package_price_id
          AND contract_schema_version = 2
    ) AND NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE checkout_intent_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'versioned_checkout_requires_bookable_slot_hold'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_versioned_checkout_slot_hold()
    FROM PUBLIC, anon, authenticated;

CREATE CONSTRAINT TRIGGER validate_versioned_checkout_slot_hold_after_write
    AFTER INSERT OR UPDATE ON public.checkout_intents
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION private.validate_versioned_checkout_slot_hold();

CREATE OR REPLACE FUNCTION public.create_bookable_slot(
    p_package_id UUID,
    p_teacher_id UUID,
    p_timezone_name TEXT,
    p_occurrences TIMESTAMPTZ[],
    p_created_by UUID
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF p_package_id IS NULL
       OR p_teacher_id IS NULL
       OR p_created_by IS NULL
       OR NULLIF(btrim(p_timezone_name), '') IS NULL
       OR cardinality(p_occurrences) <> 4
       OR array_position(p_occurrences, NULL) IS NOT NULL
       OR p_timezone_name <> 'Europe/Madrid' THEN
        RAISE EXCEPTION 'invalid_bookable_slot_snapshot'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.bookable_slots (
        package_id,
        teacher_id,
        weekday,
        local_start_time,
        timezone_name,
        first_occurrence_at,
        created_by
    ) VALUES (
        p_package_id,
        p_teacher_id,
        EXTRACT(DOW FROM p_occurrences[1] AT TIME ZONE p_timezone_name)::SMALLINT,
        (p_occurrences[1] AT TIME ZONE p_timezone_name)::TIME(0),
        p_timezone_name,
        p_occurrences[1],
        p_created_by
    )
    RETURNING * INTO slot_row;

    INSERT INTO public.bookable_slot_occurrences (
        slot_id,
        occurrence_index,
        teacher_id,
        starts_at,
        duration_minutes
    )
    SELECT
        slot_row.id,
        occurrence.ordinality::SMALLINT,
        slot_row.teacher_id,
        occurrence.starts_at,
        50
    FROM unnest(p_occurrences) WITH ORDINALITY
        AS occurrence(starts_at, ordinality);

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bookable_slot(UUID, UUID, TEXT, TIMESTAMPTZ[], UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bookable_slot(UUID, UUID, TEXT, TIMESTAMPTZ[], UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.publish_bookable_slot(
    p_slot_id UUID,
    p_published_by UUID
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
BEGIN
    IF p_slot_id IS NULL OR p_published_by IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_publication'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF slot_row.status = 'available' THEN RETURN slot_row; END IF;
    IF slot_row.status NOT IN ('draft', 'paused') THEN
        RAISE EXCEPTION 'bookable_slot_cannot_be_published'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.bookable_slots
    SET
        status = 'available',
        published_at = COALESCE(published_at, clock_timestamp()),
        published_by = COALESCE(published_by, p_published_by)
    WHERE id = p_slot_id
    RETURNING * INTO slot_row;

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_bookable_slot(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_bookable_slot(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.hold_bookable_slot(
    p_slot_id UUID,
    p_checkout_intent_id UUID
)
RETURNS public.bookable_slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    package_row public.packages%ROWTYPE;
    price_row public.package_prices%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    occurrence_count INTEGER;
    occurrences_future BOOLEAN;
BEGIN
    IF p_slot_id IS NULL OR p_checkout_intent_id IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;

    IF NOT FOUND
       OR intent_row.status NOT IN ('creating', 'open')
       OR intent_row.expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_intent_cannot_hold_slot'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    IF NOT FOUND OR slot_row.status <> 'available' THEN
        RAISE EXCEPTION 'bookable_slot_is_not_available'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO package_row
    FROM public.packages
    WHERE id = slot_row.package_id
    FOR SHARE;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = intent_row.package_price_id
    FOR SHARE;

    SELECT
        COUNT(*),
        COALESCE(BOOL_AND(starts_at > clock_timestamp()), FALSE)
    INTO occurrence_count, occurrences_future
    FROM public.bookable_slot_occurrences
    WHERE slot_id = slot_row.id;

    IF package_row.id IS NULL
       OR NOT package_row.is_active
       OR NOT package_row.is_publicly_listed
       OR package_row.contract_schema_version <> 2
       OR package_row.name <> 'individual_4x50_28d'
       OR package_row.amount_cents <> 25900
       OR package_row.billing_interval_unit <> 'day'
       OR package_row.billing_interval_count <> 28
       OR package_row.sessions_per_period <> 4
       OR package_row.class_duration_minutes <> 50
       OR price_row.id IS NULL
       OR price_row.package_id IS DISTINCT FROM slot_row.package_id
       OR price_row.contract_schema_version <> 2
       OR price_row.status <> 'active'
       OR price_row.amount_cents <> 25900
       OR price_row.currency <> 'eur'
       OR price_row.billing_interval_unit <> 'day'
       OR price_row.billing_interval_count <> 28
       OR price_row.sessions_per_period <> 4
       OR price_row.class_duration_minutes <> 50
       OR occurrence_count <> 4
       OR NOT occurrences_future
       OR slot_row.first_occurrence_at <= intent_row.expires_at
       OR NOT EXISTS (
           SELECT 1
           FROM public.teacher_availability
           WHERE teacher_id = slot_row.teacher_id
             AND is_active = TRUE
             AND day_of_week = slot_row.weekday
             AND start_time <= slot_row.local_start_time
             AND end_time >= slot_row.local_start_time + INTERVAL '50 minutes'
             AND slot_row.local_start_time + INTERVAL '50 minutes' > slot_row.local_start_time
       ) THEN
        RAISE EXCEPTION 'checkout_intent_offer_does_not_match_slot'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id
    FOR UPDATE;

    IF FOUND THEN
        IF hold_row.slot_id IS DISTINCT FROM p_slot_id
           OR hold_row.status <> 'held' THEN
            RAISE EXCEPTION 'checkout_intent_already_has_another_slot_state'
                USING ERRCODE = '23514';
        END IF;
        RETURN hold_row;
    END IF;

    UPDATE public.bookable_slot_holds AS stale_hold
    SET
        status = 'expired',
        closed_at = clock_timestamp(),
        close_reason = 'checkout_expired'
    FROM public.checkout_intents AS stale_intent
    WHERE stale_hold.slot_id = p_slot_id
      AND stale_hold.status = 'held'
      AND stale_intent.id = stale_hold.checkout_intent_id
      AND stale_intent.status = 'expired';

    IF EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE slot_id = p_slot_id AND status = 'held'
    ) THEN
        RAISE EXCEPTION 'bookable_slot_is_held'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.bookable_slot_holds (
        slot_id,
        checkout_intent_id,
        expires_at
    ) VALUES (
        p_slot_id,
        p_checkout_intent_id,
        intent_row.expires_at
    )
    RETURNING * INTO hold_row;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.hold_bookable_slot(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hold_bookable_slot(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.claim_checkout_intent_for_slot(
    p_opportunity_id UUID,
    p_contact_id UUID,
    p_student_id UUID,
    p_package_price_id UUID,
    p_lang TEXT,
    p_legal_policy_version TEXT,
    p_site_url TEXT,
    p_slot_id UUID
)
RETURNS public.checkout_intents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
BEGIN
    intent_row := public.claim_checkout_intent(
        p_opportunity_id,
        p_contact_id,
        p_student_id,
        p_package_price_id,
        p_lang,
        p_legal_policy_version,
        p_site_url
    );

    PERFORM public.hold_bookable_slot(p_slot_id, intent_row.id);
    RETURN intent_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_checkout_intent_for_slot(
    UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID
) TO service_role;

CREATE OR REPLACE FUNCTION public.release_bookable_slot_hold(
    p_checkout_intent_id UUID,
    p_reason TEXT
)
RETURNS public.bookable_slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    release_status TEXT;
BEGIN
    IF p_checkout_intent_id IS NULL
       OR NULLIF(btrim(p_reason), '') IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold_release'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;
    IF NOT FOUND OR intent_row.status <> 'expired' THEN
        RAISE EXCEPTION 'bookable_slot_hold_release_requires_expired_checkout'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_hold_not_found'
            USING ERRCODE = 'P0002';
    END IF;
    IF hold_row.status IN ('expired', 'released') THEN RETURN hold_row; END IF;
    IF hold_row.status = 'consumed' THEN
        RAISE EXCEPTION 'consumed_bookable_slot_hold_cannot_be_released'
            USING ERRCODE = '23514';
    END IF;

    release_status := CASE
        WHEN intent_row.expires_at <= clock_timestamp() THEN 'expired'
        ELSE 'released'
    END;

    UPDATE public.bookable_slot_holds
    SET
        status = release_status,
        closed_at = clock_timestamp(),
        close_reason = left(btrim(p_reason), 200)
    WHERE id = hold_row.id
    RETURNING * INTO hold_row;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.release_bookable_slot_hold(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_bookable_slot_hold(UUID, TEXT)
    TO service_role;

CREATE OR REPLACE FUNCTION public.consume_bookable_slot_hold(
    p_checkout_intent_id UUID,
    p_subscription_id UUID
)
RETURNS public.bookable_slot_holds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    consumed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_checkout_intent_id IS NULL OR p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_hold_consumption'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = p_checkout_intent_id
    FOR UPDATE;
    IF NOT FOUND OR intent_row.status <> 'completed' THEN
        RAISE EXCEPTION 'paid_checkout_intent_is_required'
            USING ERRCODE = '23514';
    END IF;

    SELECT slot_id INTO hold_row.slot_id
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id;
    IF hold_row.slot_id IS NULL THEN
        RAISE EXCEPTION 'bookable_slot_hold_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = hold_row.slot_id
    FOR UPDATE;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = p_checkout_intent_id
    FOR UPDATE;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF hold_row.status = 'consumed'
       AND hold_row.subscription_id = p_subscription_id
       AND slot_row.status = 'sold'
       AND slot_row.sold_subscription_id = p_subscription_id THEN
        RETURN hold_row;
    END IF;

    IF hold_row.status <> 'held'
       OR slot_row.status <> 'available'
       OR subscription_row.id IS NULL
       OR subscription_row.student_id IS DISTINCT FROM intent_row.student_id
       OR subscription_row.package_id IS DISTINCT FROM slot_row.package_id
       OR subscription_row.package_price_id IS DISTINCT FROM intent_row.package_price_id
       OR subscription_row.checkout_intent_id IS DISTINCT FROM intent_row.id
       OR subscription_row.contract_schema_version <> 2
       OR subscription_row.status <> 'active'
       OR subscription_row.stripe_subscription_id IS NULL THEN
        RAISE EXCEPTION 'bookable_slot_hold_cannot_be_consumed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.bookable_slot_holds
    SET
        status = 'consumed',
        closed_at = consumed_at,
        close_reason = 'paid',
        subscription_id = p_subscription_id
    WHERE id = hold_row.id
    RETURNING * INTO hold_row;

    UPDATE public.bookable_slots
    SET
        status = 'sold',
        sold_at = consumed_at,
        sold_subscription_id = p_subscription_id
    WHERE id = slot_row.id;

    RETURN hold_row;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_bookable_slot_hold(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_bookable_slot_hold(UUID, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.materialize_bookable_slot_sessions(
    p_slot_id UUID,
    p_subscription_id UUID
)
RETURNS public.bookable_slots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    occurrence_row public.bookable_slot_occurrences%ROWTYPE;
    created_session_id UUID;
BEGIN
    IF p_slot_id IS NULL OR p_subscription_id IS NULL THEN
        RAISE EXCEPTION 'invalid_bookable_slot_materialization'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = p_slot_id
    FOR UPDATE;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF slot_row.id IS NULL
       OR subscription_row.id IS NULL
       OR slot_row.status <> 'sold'
       OR slot_row.sold_subscription_id IS DISTINCT FROM subscription_row.id
       OR subscription_row.status <> 'active'
       OR subscription_row.package_id IS DISTINCT FROM slot_row.package_id
       OR subscription_row.contract_schema_version <> 2
       OR subscription_row.sessions_total <> 4
       OR subscription_row.contracted_sessions_per_period <> 4 THEN
        RAISE EXCEPTION 'bookable_slot_cannot_materialize_sessions'
            USING ERRCODE = '23514';
    END IF;

    IF slot_row.sessions_materialized_at IS NOT NULL THEN
        IF subscription_row.sessions_used IS DISTINCT FROM 4 THEN
            RAISE EXCEPTION 'materialized_bookable_slot_requires_consumed_quota'
                USING ERRCODE = '23514';
        END IF;
        RETURN slot_row;
    END IF;

    IF subscription_row.sessions_used IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'bookable_slot_materialization_requires_unused_quota'
            USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM public.profiles
    WHERE id = subscription_row.student_id AND role = 'student'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_student_is_not_available'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.student_teachers
        WHERE student_id = subscription_row.student_id
          AND teacher_id = slot_row.teacher_id
    ) THEN
        INSERT INTO public.student_teachers (student_id, teacher_id, is_primary)
        VALUES (
            subscription_row.student_id,
            slot_row.teacher_id,
            NOT EXISTS (
                SELECT 1 FROM public.student_teachers
                WHERE student_id = subscription_row.student_id
                  AND is_primary
            )
        );
    END IF;

    FOR occurrence_row IN
        SELECT *
        FROM public.bookable_slot_occurrences
        WHERE slot_id = slot_row.id
        ORDER BY occurrence_index
        FOR UPDATE
    LOOP
        IF occurrence_row.session_id IS NOT NULL THEN
            RAISE EXCEPTION 'bookable_slot_occurrence_is_already_materialized'
                USING ERRCODE = '23514';
        END IF;

        INSERT INTO public.sessions (
            subscription_id,
            student_id,
            teacher_id,
            scheduled_at,
            duration_minutes,
            status
        ) VALUES (
            subscription_row.id,
            subscription_row.student_id,
            slot_row.teacher_id,
            occurrence_row.starts_at,
            occurrence_row.duration_minutes,
            'scheduled'
        )
        RETURNING id INTO created_session_id;

        UPDATE public.bookable_slot_occurrences
        SET session_id = created_session_id
        WHERE slot_id = occurrence_row.slot_id
          AND occurrence_index = occurrence_row.occurrence_index;
    END LOOP;

    UPDATE public.subscriptions
    SET sessions_used = 4
    WHERE id = subscription_row.id
      AND sessions_used = 0;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'bookable_slot_quota_could_not_be_consumed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.bookable_slots
    SET sessions_materialized_at = clock_timestamp()
    WHERE id = slot_row.id
    RETURNING * INTO slot_row;

    RETURN slot_row;
END;
$$;

REVOKE ALL ON FUNCTION public.materialize_bookable_slot_sessions(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.materialize_bookable_slot_sessions(UUID, UUID)
    TO service_role;

COMMENT ON TABLE public.bookable_slots IS
    'Immutable sellable weekly capacity for the version-2 individual offer; generic teacher availability is not inventory.';
COMMENT ON TABLE public.bookable_slot_occurrences IS
    'The first four exact local-time occurrences promised before checkout, with their atomically materialized session identities.';
COMMENT ON TABLE public.bookable_slot_holds IS
    'Checkout-scoped capacity hold; expiry is released only after the Checkout intent is safely marked expired.';

-- Checkout V2 billing foundation. This migration is additive for historical
-- contracts: every new table and RPC is restricted to contract_schema_version
-- 2 and the legacy monthly checkout remains untouched.

-- Constraint triggers run at commit, so choose the trigger record shape with
-- control flow rather than a CASE that tries to resolve columns from both
-- bookable_slots and bookable_slot_occurrences.
CREATE OR REPLACE FUNCTION private.validate_bookable_slot_occurrences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    target_slot_id UUID;
    slot_row public.bookable_slots%ROWTYPE;
    occurrence_count INTEGER;
    occurrence_indexes SMALLINT[];
    occurrence_one TIMESTAMPTZ;
    local_pattern_valid BOOLEAN;
    blocking_valid BOOLEAN;
    materialized_binding_valid BOOLEAN;
BEGIN
    IF TG_TABLE_NAME = 'bookable_slots' THEN
        target_slot_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    ELSIF TG_TABLE_NAME = 'bookable_slot_occurrences' THEN
        target_slot_id := CASE
            WHEN TG_OP = 'DELETE' THEN OLD.slot_id
            ELSE NEW.slot_id
        END;
    ELSE
        RAISE EXCEPTION 'unexpected_bookable_slot_validation_source'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = target_slot_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COUNT(*),
        ARRAY_AGG(occurrence_index ORDER BY occurrence_index),
        MAX(starts_at) FILTER (WHERE occurrence_index = 1),
        COALESCE(BOOL_AND(
            EXTRACT(DOW FROM starts_at AT TIME ZONE slot_row.timezone_name)::SMALLINT
                = slot_row.weekday
            AND (starts_at AT TIME ZONE slot_row.timezone_name)::TIME(0)
                = slot_row.local_start_time
            AND (starts_at AT TIME ZONE slot_row.timezone_name)::DATE
                = (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
                  + ((occurrence_index - 1) * 7)
        ), FALSE),
        COALESCE(BOOL_AND(
            blocks_teacher = (
                slot_row.status IN ('available', 'paused', 'sold')
                AND slot_row.sessions_materialized_at IS NULL
            )
        ), FALSE),
        COALESCE(BOOL_AND(
            (
                slot_row.sessions_materialized_at IS NULL
                AND session_id IS NULL
            )
            OR (
                slot_row.sessions_materialized_at IS NOT NULL
                AND session_id IS NOT NULL
                AND EXISTS (
                    SELECT 1
                    FROM public.sessions AS materialized_session
                    JOIN public.subscriptions AS materialized_subscription
                      ON materialized_subscription.id = slot_row.sold_subscription_id
                    WHERE materialized_session.id = session_id
                      AND materialized_session.subscription_id = slot_row.sold_subscription_id
                      AND materialized_session.student_id = materialized_subscription.student_id
                      AND materialized_session.teacher_id = slot_row.teacher_id
                )
            )
        ), FALSE)
    INTO
        occurrence_count,
        occurrence_indexes,
        occurrence_one,
        local_pattern_valid,
        blocking_valid,
        materialized_binding_valid
    FROM public.bookable_slot_occurrences
    WHERE slot_id = target_slot_id;

    IF occurrence_count <> 4
       OR occurrence_indexes IS DISTINCT FROM ARRAY[1, 2, 3, 4]::SMALLINT[]
       OR occurrence_one IS DISTINCT FROM slot_row.first_occurrence_at
       OR NOT local_pattern_valid
       OR NOT blocking_valid
       OR NOT materialized_binding_valid THEN
        RAISE EXCEPTION 'bookable_slot_requires_exact_local_weekly_cycle'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_bookable_slot_occurrences()
    FROM PUBLIC, anon, authenticated;

-- The original trigger required a live `held` row on every subscription
-- status update. Once checkout completed, that hold became `consumed`, making
-- renewals, pauses and cancellations impossible. Validate the transient state
-- on INSERT and the durable consumed/sold state thereafter.
CREATE OR REPLACE FUNCTION private.guard_subscription_checkout_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    intent_row public.checkout_intents%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    durable_binding BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT'
       AND NEW.contract_schema_version = 2
       AND NEW.checkout_intent_id IS NULL THEN
        RAISE EXCEPTION 'versioned_subscription_requires_checkout_binding'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.contract_schema_version = 2 THEN
        IF ROW(
            NEW.checkout_intent_id,
            NEW.student_id,
            NEW.package_id,
            NEW.package_price_id,
            NEW.stripe_subscription_id,
            NEW.contract_schema_version
        ) IS DISTINCT FROM ROW(
            OLD.checkout_intent_id,
            OLD.student_id,
            OLD.package_id,
            OLD.package_price_id,
            OLD.stripe_subscription_id,
            OLD.contract_schema_version
        ) THEN
            RAISE EXCEPTION 'subscription_checkout_binding_is_immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.checkout_intent_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO intent_row
    FROM public.checkout_intents
    WHERE id = NEW.checkout_intent_id;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = NEW.checkout_intent_id;

    IF hold_row.id IS NOT NULL THEN
        SELECT * INTO slot_row
        FROM public.bookable_slots
        WHERE id = hold_row.slot_id;
    END IF;

    durable_binding := (
        hold_row.status = 'consumed'
        AND hold_row.subscription_id = NEW.id
        AND slot_row.status = 'sold'
        AND slot_row.sold_subscription_id = NEW.id
    );

    IF intent_row.id IS NULL
       OR hold_row.id IS NULL
       OR slot_row.id IS NULL
       OR intent_row.status <> 'completed'
       OR intent_row.stripe_checkout_session_id IS NULL
       OR NEW.contract_schema_version <> 2
       OR NEW.student_id IS DISTINCT FROM intent_row.student_id
       OR NEW.package_id IS DISTINCT FROM slot_row.package_id
       OR NEW.package_price_id IS DISTINCT FROM intent_row.package_price_id
       OR NEW.stripe_subscription_id IS NULL
       OR NEW.stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
       OR NEW.duration_months IS NOT NULL
       OR NEW.billing_interval_unit <> 'day'
       OR NEW.billing_interval_count <> 28
       OR NEW.class_duration_minutes <> 50 THEN
        RAISE EXCEPTION 'subscription_checkout_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF hold_row.status <> 'held'
           OR hold_row.subscription_id IS NOT NULL
           OR slot_row.status <> 'available'
           OR NEW.status <> 'active'
           OR NEW.stripe_invoice_id IS NULL
           OR NEW.stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$'
           OR NEW.starts_at IS DISTINCT FROM
                (slot_row.first_occurrence_at AT TIME ZONE slot_row.timezone_name)::DATE
           OR NEW.ends_at IS DISTINCT FROM NEW.starts_at + 28
           OR NEW.sessions_total <> 4
           OR NEW.contracted_sessions_per_period <> 4
           OR NEW.sessions_used IS DISTINCT FROM 0 THEN
            RAISE EXCEPTION 'subscription_checkout_binding_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NOT (
        durable_binding
        OR (
            hold_row.status = 'held'
            AND hold_row.subscription_id IS NULL
            AND slot_row.status = 'available'
            AND slot_row.sold_subscription_id IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'subscription_checkout_binding_lifecycle_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.status IN (
            'cancelled'::public.subscription_status,
            'expired'::public.subscription_status
       )
       AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'checkout_v2_terminal_subscription_cannot_reopen'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       AND durable_binding
       AND NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_weekly_allocations AS allocation_row
            WHERE allocation_row.subscription_id = NEW.id
              AND allocation_row.status = 'active'
       ) THEN
        RAISE EXCEPTION 'checkout_v2_live_subscription_requires_weekly_capacity'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_subscription_checkout_binding()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_subscription_checkout_binding_trigger
    ON public.subscriptions;
CREATE TRIGGER guard_subscription_checkout_binding_trigger
    BEFORE INSERT OR UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.guard_subscription_checkout_binding();

-- One immutable pair describes the immediate one-time Price and the recurring
-- 28-day Price. The existing package_prices.stripe_price_id remains the
-- recurring Price so legacy readers do not change meaning.
CREATE TABLE public.checkout_v2_price_snapshots (
    package_price_id UUID PRIMARY KEY
        REFERENCES public.package_prices(id) ON DELETE RESTRICT,
    stripe_account_id TEXT NOT NULL CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9_]+$'),
    stripe_livemode BOOLEAN NOT NULL,
    initial_stripe_price_id TEXT NOT NULL UNIQUE
        CHECK (initial_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    recurring_stripe_price_id TEXT NOT NULL UNIQUE
        CHECK (recurring_stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    initial_amount_cents INTEGER NOT NULL DEFAULT 25900
        CHECK (initial_amount_cents = 25900),
    recurring_amount_cents INTEGER NOT NULL DEFAULT 25900
        CHECK (recurring_amount_cents = 25900),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    recurring_interval_unit TEXT NOT NULL DEFAULT 'day'
        CHECK (recurring_interval_unit = 'day'),
    recurring_interval_count SMALLINT NOT NULL DEFAULT 28
        CHECK (recurring_interval_count = 28),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_prices_are_distinct CHECK (
        initial_stripe_price_id <> recurring_stripe_price_id
    )
);

CREATE TABLE public.checkout_v2_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID NOT NULL
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    cycle_number INTEGER NOT NULL CHECK (cycle_number > 0),
    cycle_kind TEXT NOT NULL CHECK (cycle_kind IN ('initial', 'renewal')),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    sessions_total SMALLINT NOT NULL DEFAULT 4 CHECK (sessions_total = 4),
    amount_cents INTEGER NOT NULL DEFAULT 25900 CHECK (amount_cents = 25900),
    currency TEXT NOT NULL DEFAULT 'eur' CHECK (currency = 'eur'),
    stripe_price_id TEXT NOT NULL
        CHECK (stripe_price_id ~ '^price_[A-Za-z0-9_]+$'),
    stripe_invoice_id TEXT NOT NULL UNIQUE
        CHECK (stripe_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
    payment_id UUID NOT NULL UNIQUE
        REFERENCES public.payments(id) ON DELETE RESTRICT,
    materialization_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (materialization_state IN ('pending', 'ready')),
    sessions_materialized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_cycles_exact_period CHECK (
        ends_at = starts_at + INTERVAL '672 hours'
    ),
    CONSTRAINT checkout_v2_cycles_kind_number CHECK (
        (cycle_number = 1 AND cycle_kind = 'initial')
        OR (cycle_number > 1 AND cycle_kind = 'renewal')
    ),
    CONSTRAINT checkout_v2_cycles_materialization_lifecycle CHECK (
        (materialization_state = 'pending' AND sessions_materialized_at IS NULL)
        OR (materialization_state = 'ready' AND sessions_materialized_at IS NOT NULL)
    ),
    UNIQUE (subscription_id, cycle_number),
    UNIQUE (subscription_id, starts_at)
);

ALTER TABLE public.checkout_v2_cycles
    ADD CONSTRAINT checkout_v2_cycles_no_overlap_excl
    EXCLUDE USING gist (
        subscription_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
    );

ALTER TABLE public.sessions
    ADD COLUMN checkout_v2_cycle_id UUID
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT,
    ADD COLUMN checkout_v2_cycle_session_index SMALLINT
        CHECK (checkout_v2_cycle_session_index BETWEEN 1 AND 4),
    ADD CONSTRAINT sessions_checkout_v2_cycle_position_complete CHECK (
        (checkout_v2_cycle_id IS NULL) =
        (checkout_v2_cycle_session_index IS NULL)
    );
ALTER TABLE public.payments
    ADD COLUMN checkout_v2_cycle_id UUID
        REFERENCES public.checkout_v2_cycles(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX payments_checkout_v2_cycle_unique_idx
    ON public.payments(checkout_v2_cycle_id)
    WHERE checkout_v2_cycle_id IS NOT NULL;
CREATE INDEX sessions_checkout_v2_cycle_idx
    ON public.sessions(checkout_v2_cycle_id)
    WHERE checkout_v2_cycle_id IS NOT NULL;
CREATE UNIQUE INDEX sessions_checkout_v2_cycle_position_unique_idx
    ON public.sessions(checkout_v2_cycle_id, checkout_v2_cycle_session_index)
    WHERE checkout_v2_cycle_id IS NOT NULL;

CREATE TABLE public.checkout_v2_billing_state (
    subscription_id UUID PRIMARY KEY
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    first_session_id UUID NOT NULL UNIQUE
        REFERENCES public.sessions(id) ON DELETE RESTRICT,
    first_class_at TIMESTAMPTZ NOT NULL,
    renewal_anchor_at TIMESTAMPTZ NOT NULL,
    stripe_renewal_anchor_at TIMESTAMPTZ NOT NULL,
    anchor_state TEXT NOT NULL DEFAULT 'provisional'
        CHECK (anchor_state IN ('provisional', 'fixed')),
    anchor_revision BIGINT NOT NULL DEFAULT 1 CHECK (anchor_revision > 0),
    anchor_fixed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_anchor_exact_period CHECK (
        renewal_anchor_at = first_class_at + INTERVAL '672 hours'
    ),
    CONSTRAINT checkout_v2_anchor_stripe_synced CHECK (
        stripe_renewal_anchor_at = renewal_anchor_at
    ),
    CONSTRAINT checkout_v2_anchor_lifecycle CHECK (
        (anchor_state = 'provisional' AND anchor_fixed_at IS NULL)
        OR (
            anchor_state = 'fixed'
            AND anchor_fixed_at IS NOT NULL
            AND anchor_fixed_at >= first_class_at
        )
    )
);

-- A sold weekly time remains capacity while the subscription is active. The
-- exclusion operates in Madrid-local minute-of-week space and catches partial
-- overlaps, not only identical start times.
CREATE TABLE public.checkout_v2_weekly_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID
        REFERENCES public.subscriptions(id) ON DELETE RESTRICT,
    slot_id UUID NOT NULL UNIQUE,
    teacher_id UUID NOT NULL,
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    local_start_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    duration_minutes SMALLINT NOT NULL DEFAULT 50 CHECK (duration_minutes = 50),
    timezone_name TEXT NOT NULL DEFAULT 'Europe/Madrid'
        CHECK (timezone_name = 'Europe/Madrid'),
    weekly_start_minute INTEGER GENERATED ALWAYS AS (
        weekday::INTEGER * 1440
        + EXTRACT(HOUR FROM local_start_time)::INTEGER * 60
        + EXTRACT(MINUTE FROM local_start_time)::INTEGER
    ) STORED,
    status TEXT NOT NULL DEFAULT 'offered'
        CHECK (status IN ('offered', 'active', 'released')),
    released_at TIMESTAMPTZ,
    release_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT checkout_v2_allocation_slot_teacher_fkey
        FOREIGN KEY (slot_id, teacher_id)
        REFERENCES public.bookable_slots(id, teacher_id) ON DELETE RESTRICT,
    CONSTRAINT checkout_v2_allocation_same_day CHECK (
        weekly_start_minute + duration_minutes <= (weekday::INTEGER + 1) * 1440
    ),
    CONSTRAINT checkout_v2_allocation_lifecycle CHECK (
        (
            status = 'offered'
            AND subscription_id IS NULL
            AND released_at IS NULL
            AND release_reason IS NULL
        )
        OR (
            status = 'active'
            AND subscription_id IS NOT NULL
            AND released_at IS NULL
            AND release_reason IS NULL
        )
        OR (
            status = 'released'
            AND released_at IS NOT NULL
            AND NULLIF(btrim(release_reason), '') IS NOT NULL
        )
    )
);

CREATE UNIQUE INDEX checkout_v2_weekly_allocations_one_active_subscription_idx
    ON public.checkout_v2_weekly_allocations(subscription_id)
    WHERE status = 'active';

ALTER TABLE public.checkout_v2_weekly_allocations
    ADD CONSTRAINT checkout_v2_weekly_capacity_excl
    EXCLUDE USING gist (
        teacher_id WITH =,
        int4range(
            weekly_start_minute,
            weekly_start_minute + duration_minutes,
            '[)'
        ) WITH &&
    ) WHERE (status IN ('offered', 'active'));

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_price_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    price_row public.package_prices%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'checkout_v2_price_snapshot_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            LEAST(NEW.initial_stripe_price_id, NEW.recurring_stripe_price_id),
            42851
        )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            GREATEST(NEW.initial_stripe_price_id, NEW.recurring_stripe_price_id),
            42851
        )
    );

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_price_snapshots AS other_snapshot
        WHERE other_snapshot.initial_stripe_price_id IN (
                NEW.initial_stripe_price_id,
                NEW.recurring_stripe_price_id
            )
           OR other_snapshot.recurring_stripe_price_id IN (
                NEW.initial_stripe_price_id,
                NEW.recurring_stripe_price_id
            )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_stripe_price_is_already_bound'
            USING ERRCODE = '23505';
    END IF;

    SELECT * INTO price_row
    FROM public.package_prices
    WHERE id = NEW.package_price_id;

    IF NOT FOUND
       OR price_row.contract_schema_version IS DISTINCT FROM 2
       OR price_row.amount_cents IS DISTINCT FROM 25900
       OR price_row.currency IS DISTINCT FROM 'eur'
       OR price_row.billing_interval_unit IS DISTINCT FROM 'day'
       OR price_row.billing_interval_count IS DISTINCT FROM 28
       OR price_row.sessions_per_period IS DISTINCT FROM 4
       OR price_row.class_duration_minutes IS DISTINCT FROM 50
       OR price_row.stripe_price_id IS DISTINCT FROM NEW.recurring_stripe_price_id
       OR price_row.stripe_account_id IS DISTINCT FROM NEW.stripe_account_id
       OR price_row.stripe_livemode IS DISTINCT FROM NEW.stripe_livemode THEN
        RAISE EXCEPTION 'checkout_v2_price_snapshot_does_not_match_catalog'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_price_snapshot_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_price_snapshots
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_price_snapshot();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_billing_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.anchor_state IS DISTINCT FROM 'provisional'
           OR NEW.anchor_revision IS DISTINCT FROM 1
           OR NEW.anchor_fixed_at IS NOT NULL
           OR NOT EXISTS (
                SELECT 1
                FROM public.subscriptions AS subscription_row
                JOIN public.sessions AS first_session
                  ON first_session.id = NEW.first_session_id
                 AND first_session.subscription_id = subscription_row.id
                JOIN public.checkout_v2_cycles AS first_cycle
                  ON first_cycle.id = first_session.checkout_v2_cycle_id
                 AND first_cycle.subscription_id = subscription_row.id
                 AND first_cycle.cycle_number = 1
                 AND first_cycle.cycle_kind = 'initial'
                WHERE subscription_row.id = NEW.subscription_id
                  AND subscription_row.contract_schema_version = 2
                  AND first_session.checkout_v2_cycle_session_index = 1
                  AND first_session.status = 'scheduled'
                  AND first_session.scheduled_at = NEW.first_class_at
                  AND first_cycle.starts_at = NEW.first_class_at
                  AND first_cycle.ends_at = NEW.renewal_anchor_at
           ) THEN
            RAISE EXCEPTION 'checkout_v2_billing_initial_state_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
           OR NEW.first_session_id IS DISTINCT FROM OLD.first_session_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'checkout_v2_billing_identity_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.anchor_state = 'fixed'
           AND ROW(
                NEW.first_class_at,
                NEW.renewal_anchor_at,
                NEW.stripe_renewal_anchor_at,
                NEW.anchor_state,
                NEW.anchor_fixed_at,
                NEW.anchor_revision
           ) IS DISTINCT FROM ROW(
                OLD.first_class_at,
                OLD.renewal_anchor_at,
                OLD.stripe_renewal_anchor_at,
                OLD.anchor_state,
                OLD.anchor_fixed_at,
                OLD.anchor_revision
           ) THEN
            RAISE EXCEPTION 'fixed_checkout_v2_anchor_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(
            NEW.first_class_at,
            NEW.renewal_anchor_at,
            NEW.stripe_renewal_anchor_at
        ) IS DISTINCT FROM ROW(
            OLD.first_class_at,
            OLD.renewal_anchor_at,
            OLD.stripe_renewal_anchor_at
        ) AND NEW.anchor_revision IS DISTINCT FROM OLD.anchor_revision + 1 THEN
            RAISE EXCEPTION 'checkout_v2_anchor_revision_must_advance_once'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(
            NEW.first_class_at,
            NEW.renewal_anchor_at,
            NEW.stripe_renewal_anchor_at
        ) IS NOT DISTINCT FROM ROW(
            OLD.first_class_at,
            OLD.renewal_anchor_at,
            OLD.stripe_renewal_anchor_at
        ) AND NEW.anchor_revision IS DISTINCT FROM OLD.anchor_revision THEN
            RAISE EXCEPTION 'checkout_v2_anchor_revision_cannot_drift'
                USING ERRCODE = '23514';
        END IF;

        IF OLD.anchor_state = 'provisional'
           AND NEW.anchor_state = 'fixed'
           AND (
                NEW.anchor_fixed_at IS NULL
                OR NEW.anchor_fixed_at < NEW.first_class_at
                OR NEW.anchor_fixed_at > clock_timestamp()
                OR clock_timestamp() < NEW.first_class_at
           ) THEN
            RAISE EXCEPTION 'checkout_v2_anchor_cannot_be_fixed'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.anchor_state IS DISTINCT FROM OLD.anchor_state
           AND NOT (OLD.anchor_state = 'provisional' AND NEW.anchor_state = 'fixed') THEN
            RAISE EXCEPTION 'checkout_v2_anchor_state_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_billing_state_trigger
    BEFORE INSERT OR UPDATE ON public.checkout_v2_billing_state
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_billing_state();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    previous_cycle public.checkout_v2_cycles%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'checkout_v2_cycle_cannot_be_deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT * INTO subscription_row
        FROM public.subscriptions
        WHERE id = NEW.subscription_id;

        SELECT * INTO payment_row
        FROM public.payments
        WHERE id = NEW.payment_id;

        SELECT * INTO previous_cycle
        FROM public.checkout_v2_cycles
        WHERE subscription_id = NEW.subscription_id
        ORDER BY cycle_number DESC
        LIMIT 1;

        IF subscription_row.id IS NULL
           OR subscription_row.contract_schema_version IS DISTINCT FROM 2
           OR payment_row.id IS NULL
           OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
           OR payment_row.student_id IS DISTINCT FROM subscription_row.student_id
           OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
           OR payment_row.amount IS DISTINCT FROM 25900
           OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
           OR payment_row.stripe_invoice_id IS DISTINCT FROM NEW.stripe_invoice_id
           OR payment_row.checkout_v2_cycle_id IS NOT NULL
           OR NOT EXISTS (
                SELECT 1
                FROM public.checkout_v2_price_snapshots AS price_snapshot
                WHERE price_snapshot.package_price_id = subscription_row.package_price_id
                  AND NEW.stripe_price_id = CASE
                        WHEN NEW.cycle_kind = 'initial'
                        THEN price_snapshot.initial_stripe_price_id
                        ELSE price_snapshot.recurring_stripe_price_id
                      END
           ) THEN
            RAISE EXCEPTION 'checkout_v2_cycle_financial_snapshot_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.cycle_kind = 'initial' THEN
            IF NEW.cycle_number IS DISTINCT FROM 1
               OR NEW.materialization_state IS DISTINCT FROM 'ready'
               OR previous_cycle.id IS NOT NULL
               OR subscription_row.stripe_invoice_id IS DISTINCT FROM NEW.stripe_invoice_id
               OR NOT EXISTS (
                    SELECT 1
                    FROM public.bookable_slots AS slot_row
                    JOIN public.bookable_slot_occurrences AS occurrence_row
                      ON occurrence_row.slot_id = slot_row.id
                     AND occurrence_row.occurrence_index = 1
                    JOIN public.sessions AS session_row
                      ON session_row.id = occurrence_row.session_id
                    WHERE slot_row.sold_subscription_id = subscription_row.id
                      AND slot_row.status = 'sold'
                      AND session_row.subscription_id = subscription_row.id
                      AND session_row.scheduled_at = NEW.starts_at
               ) THEN
                RAISE EXCEPTION 'checkout_v2_initial_cycle_is_invalid'
                    USING ERRCODE = '23514';
            END IF;
        ELSE
            SELECT * INTO billing_row
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = NEW.subscription_id;

            IF previous_cycle.id IS NULL
               OR NEW.materialization_state IS DISTINCT FROM 'pending'
               OR NEW.cycle_number IS DISTINCT FROM previous_cycle.cycle_number + 1
               OR NEW.starts_at IS DISTINCT FROM previous_cycle.ends_at
               OR subscription_row.stripe_invoice_id IS DISTINCT FROM previous_cycle.stripe_invoice_id
               OR billing_row.anchor_state IS DISTINCT FROM 'fixed' THEN
                RAISE EXCEPTION 'checkout_v2_renewal_cycle_is_invalid'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF ROW(
            NEW.id,
            NEW.subscription_id,
            NEW.cycle_number,
            NEW.cycle_kind,
            NEW.sessions_total,
            NEW.amount_cents,
            NEW.currency,
            NEW.stripe_price_id,
            NEW.stripe_invoice_id,
            NEW.payment_id,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.id,
            OLD.subscription_id,
            OLD.cycle_number,
            OLD.cycle_kind,
            OLD.sessions_total,
            OLD.amount_cents,
            OLD.currency,
            OLD.stripe_price_id,
            OLD.stripe_invoice_id,
            OLD.payment_id,
            OLD.created_at
        ) THEN
            RAISE EXCEPTION 'checkout_v2_cycle_financial_snapshot_is_immutable'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(NEW.materialization_state, NEW.sessions_materialized_at)
           IS DISTINCT FROM
           ROW(OLD.materialization_state, OLD.sessions_materialized_at)
           AND NOT (
                OLD.materialization_state = 'pending'
                AND NEW.materialization_state = 'ready'
                AND OLD.sessions_materialized_at IS NULL
                AND NEW.sessions_materialized_at IS NOT NULL
                AND (
                    SELECT COUNT(*)
                    FROM public.sessions
                    WHERE checkout_v2_cycle_id = OLD.id
                      AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
                ) = 4
           ) THEN
            RAISE EXCEPTION 'checkout_v2_cycle_materialization_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;

        IF ROW(NEW.starts_at, NEW.ends_at)
           IS DISTINCT FROM ROW(OLD.starts_at, OLD.ends_at) THEN
            SELECT * INTO billing_row
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = OLD.subscription_id;

            IF OLD.cycle_number <> 1
               OR billing_row.anchor_state IS DISTINCT FROM 'provisional' THEN
                RAISE EXCEPTION 'checkout_v2_cycle_period_is_immutable'
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_cycle_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON public.checkout_v2_cycles
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_cycle();

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_weekly_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    slot_row public.bookable_slots%ROWTYPE;
    subscription_row public.subscriptions%ROWTYPE;
BEGIN
    SELECT * INTO slot_row
    FROM public.bookable_slots
    WHERE id = NEW.slot_id;

    IF slot_row.id IS NULL
       OR slot_row.teacher_id IS DISTINCT FROM NEW.teacher_id
       OR slot_row.weekday IS DISTINCT FROM NEW.weekday
       OR slot_row.local_start_time IS DISTINCT FROM NEW.local_start_time
       OR slot_row.timezone_name IS DISTINCT FROM NEW.timezone_name THEN
        RAISE EXCEPTION 'checkout_v2_weekly_allocation_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'offered' AND (
        NEW.subscription_id IS NOT NULL
        OR slot_row.status NOT IN ('available', 'paused')
    ) THEN
        RAISE EXCEPTION 'checkout_v2_weekly_offer_is_invalid'
            USING ERRCODE = '23514';
    ELSIF NEW.status = 'active' AND (
        NEW.subscription_id IS NULL
        OR slot_row.status <> 'sold'
        OR slot_row.sold_subscription_id IS DISTINCT FROM NEW.subscription_id
    ) THEN
        RAISE EXCEPTION 'checkout_v2_weekly_assignment_is_invalid'
            USING ERRCODE = '23514';
    ELSIF NEW.status = 'released' THEN
        IF NEW.subscription_id IS NOT NULL THEN
            SELECT * INTO subscription_row
            FROM public.subscriptions
            WHERE id = NEW.subscription_id;
        END IF;

        IF NOT (
            (OLD.status = 'offered' AND slot_row.status = 'retired')
            OR (
                OLD.status = 'active'
                AND subscription_row.status IN (
                    'cancelled'::public.subscription_status,
                    'expired'::public.subscription_status
                )
            )
        ) THEN
            RAISE EXCEPTION 'checkout_v2_weekly_release_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF ROW(
            NEW.slot_id,
            NEW.teacher_id,
            NEW.weekday,
            NEW.local_start_time,
            NEW.duration_minutes,
            NEW.timezone_name,
            NEW.created_at
        ) IS DISTINCT FROM ROW(
            OLD.slot_id,
            OLD.teacher_id,
            OLD.weekday,
            OLD.local_start_time,
            OLD.duration_minutes,
            OLD.timezone_name,
            OLD.created_at
        ) OR NOT (
            NEW.status = OLD.status
            OR (
                OLD.status = 'offered'
                AND NEW.status = 'active'
                AND OLD.subscription_id IS NULL
                AND NEW.subscription_id IS NOT NULL
            )
            OR (OLD.status = 'offered' AND NEW.status = 'released')
            OR (OLD.status = 'active' AND NEW.status = 'released')
        ) OR (
            NEW.status = OLD.status
            AND ROW(NEW.subscription_id, NEW.released_at, NEW.release_reason)
                IS DISTINCT FROM
                ROW(OLD.subscription_id, OLD.released_at, OLD.release_reason)
        ) OR (
            NEW.status = 'released'
            AND (
                NEW.released_at IS NULL
                OR NULLIF(btrim(NEW.release_reason), '') IS NULL
            )
        ) THEN
            RAISE EXCEPTION 'checkout_v2_weekly_allocation_transition_is_invalid'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER guard_checkout_v2_weekly_allocation_trigger
    BEFORE INSERT OR UPDATE ON public.checkout_v2_weekly_allocations
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_weekly_allocation();

CREATE OR REPLACE FUNCTION private.sync_checkout_v2_weekly_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version <> 2 THEN
        RETURN NULL;
    END IF;

    IF NEW.status IN ('available', 'paused') AND NOT EXISTS (
        SELECT 1
        FROM public.package_prices AS package_price
        JOIN public.checkout_v2_price_snapshots AS price_snapshot
          ON price_snapshot.package_price_id = package_price.id
        WHERE package_price.package_id = NEW.package_id
          AND package_price.contract_schema_version = 2
          AND package_price.status = 'active'
    ) THEN
        IF NEW.status = 'available' THEN
            RAISE EXCEPTION 'checkout_v2_slot_requires_complete_price_snapshot'
                USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
    END IF;

    IF NEW.status IN ('available', 'paused') THEN
        INSERT INTO public.checkout_v2_weekly_allocations (
            slot_id,
            teacher_id,
            weekday,
            local_start_time,
            timezone_name,
            status
        ) VALUES (
            NEW.id,
            NEW.teacher_id,
            NEW.weekday,
            NEW.local_start_time,
            NEW.timezone_name,
            'offered'
        )
        ON CONFLICT (slot_id) DO NOTHING;
    ELSIF NEW.status = 'sold' THEN
        UPDATE public.checkout_v2_weekly_allocations
        SET
            subscription_id = NEW.sold_subscription_id,
            status = 'active'
        WHERE slot_id = NEW.id
          AND status = 'offered';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'sold_checkout_v2_slot_has_no_weekly_capacity'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.status = 'retired' THEN
        UPDATE public.checkout_v2_weekly_allocations
        SET
            status = 'released',
            released_at = clock_timestamp(),
            release_reason = 'slot_retired'
        WHERE slot_id = NEW.id
          AND status = 'offered';
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER sync_checkout_v2_weekly_allocation_trigger
    AFTER INSERT OR UPDATE OF status ON public.bookable_slots
    FOR EACH ROW EXECUTE FUNCTION private.sync_checkout_v2_weekly_allocation();

-- A sold slot is an immutable sale snapshot, but its weekly capacity is not
-- permanent. Ending a V2 subscription releases only the allocation row, so a
-- later offer can reuse that teacher/time without rewriting history.
CREATE OR REPLACE FUNCTION private.release_checkout_v2_allocation_on_subscription_end()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.contract_schema_version <> 2
       OR NEW.status NOT IN (
            'cancelled'::public.subscription_status,
            'expired'::public.subscription_status
       )
       OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NULL;
    END IF;

    UPDATE public.checkout_v2_weekly_allocations
    SET
        status = 'released',
        released_at = clock_timestamp(),
        release_reason = 'subscription_' || NEW.status::TEXT
    WHERE subscription_id = NEW.id
      AND status = 'active';

    IF NOT FOUND AND NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations
        WHERE subscription_id = NEW.id
          AND status = 'released'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_terminal_subscription_has_no_allocation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER release_checkout_v2_allocation_on_subscription_end_trigger
    AFTER UPDATE OF status ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION private.release_checkout_v2_allocation_on_subscription_end();

-- Price snapshots do not exist before this migration, so no existing durable
-- Checkout V2 sale can be attributed safely. Require a clean activation point
-- instead of guessing a Stripe Price pair or backfilling weekly capacity.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.bookable_slots AS slot_row
        WHERE slot_row.contract_schema_version = 2
          AND slot_row.status IN ('available', 'paused', 'sold')
    ) THEN
        RAISE EXCEPTION 'checkout_v2_billing_foundation_requires_zero_durable_v2_slots'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.subscriptions AS subscription_row
        WHERE subscription_row.contract_schema_version = 2
          AND subscription_row.status IN (
                'active'::public.subscription_status,
                'paused'::public.subscription_status
          )
          AND NOT EXISTS (
                SELECT 1
                FROM public.bookable_slots AS sold_slot
                WHERE sold_slot.contract_schema_version = 2
                  AND sold_slot.status = 'sold'
                  AND sold_slot.sold_subscription_id = subscription_row.id
          )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_billing_foundation_rejects_unbound_active_subscription'
            USING ERRCODE = '23514';
    END IF;
END;
$$;

-- Session and payment attribution must always stay inside the owning
-- subscription, even for direct service-role writes.
CREATE OR REPLACE FUNCTION private.guard_checkout_v2_cycle_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_cycle_id IS NOT NULL
       AND NEW.checkout_v2_cycle_id IS DISTINCT FROM OLD.checkout_v2_cycle_id THEN
        RAISE EXCEPTION 'checkout_v2_cycle_binding_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.checkout_v2_cycle_id IS NOT NULL
       AND NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_cycles AS cycle_row
            WHERE cycle_row.id = NEW.checkout_v2_cycle_id
              AND cycle_row.subscription_id = NEW.subscription_id
              AND (
                    TG_TABLE_NAME <> 'payments'
                    OR cycle_row.payment_id = NEW.id
              )
              AND (
                    TG_TABLE_NAME <> 'sessions'
                    OR cycle_row.materialization_state = 'ready'
              )
       ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_subscription_binding_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_session_position()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.checkout_v2_cycle_id IS NOT NULL
       AND ROW(
            NEW.checkout_v2_cycle_id,
            NEW.checkout_v2_cycle_session_index
       ) IS DISTINCT FROM ROW(
            OLD.checkout_v2_cycle_id,
            OLD.checkout_v2_cycle_session_index
       ) THEN
        RAISE EXCEPTION 'checkout_v2_session_cycle_position_is_immutable'
            USING ERRCODE = '23514';
    END IF;

    IF (NEW.checkout_v2_cycle_id IS NULL) <>
       (NEW.checkout_v2_cycle_session_index IS NULL) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_position_is_incomplete'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_checkout_v2_materialized_session_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    IF OLD.checkout_v2_cycle_id IS NOT NULL THEN
        RAISE EXCEPTION 'checkout_v2_materialized_session_cannot_be_deleted'
            USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER guard_session_checkout_v2_cycle_binding_trigger
    BEFORE INSERT OR UPDATE OF
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index,
        subscription_id
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_cycle_binding();

CREATE TRIGGER guard_session_checkout_v2_cycle_position_trigger
    BEFORE INSERT OR UPDATE OF
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_session_position();

CREATE TRIGGER guard_checkout_v2_materialized_session_delete_trigger
    BEFORE DELETE ON public.sessions
    FOR EACH ROW
    WHEN (OLD.checkout_v2_cycle_id IS NOT NULL)
    EXECUTE FUNCTION private.guard_checkout_v2_materialized_session_delete();

CREATE TRIGGER guard_payment_checkout_v2_cycle_binding_trigger
    BEFORE INSERT OR UPDATE OF checkout_v2_cycle_id, subscription_id
    ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.guard_checkout_v2_cycle_binding();

-- Register the verified Stripe pair once. The caller must verify both remote
-- Price objects before invoking this database boundary.
CREATE OR REPLACE FUNCTION public.register_checkout_v2_price_snapshot(
    p_package_price_id UUID,
    p_stripe_account_id TEXT,
    p_stripe_livemode BOOLEAN,
    p_initial_stripe_price_id TEXT,
    p_recurring_stripe_price_id TEXT
)
RETURNS public.checkout_v2_price_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    snapshot_row public.checkout_v2_price_snapshots%ROWTYPE;
BEGIN
    IF p_package_price_id IS NULL
       OR p_stripe_account_id IS NULL
       OR p_stripe_account_id !~ '^acct_[A-Za-z0-9_]+$'
       OR p_stripe_livemode IS NULL
       OR p_initial_stripe_price_id IS NULL
       OR p_initial_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_recurring_stripe_price_id IS NULL
       OR p_recurring_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_initial_stripe_price_id = p_recurring_stripe_price_id THEN
        RAISE EXCEPTION 'invalid_checkout_v2_price_snapshot'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_package_price_id::TEXT, 42852)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            LEAST(p_initial_stripe_price_id, p_recurring_stripe_price_id),
            42851
        )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            GREATEST(p_initial_stripe_price_id, p_recurring_stripe_price_id),
            42851
        )
    );

    SELECT * INTO snapshot_row
    FROM public.checkout_v2_price_snapshots
    WHERE package_price_id = p_package_price_id
    FOR UPDATE;

    IF FOUND THEN
        IF ROW(
            snapshot_row.stripe_account_id,
            snapshot_row.stripe_livemode,
            snapshot_row.initial_stripe_price_id,
            snapshot_row.recurring_stripe_price_id
        ) IS DISTINCT FROM ROW(
            p_stripe_account_id,
            p_stripe_livemode,
            p_initial_stripe_price_id,
            p_recurring_stripe_price_id
        ) THEN
            RAISE EXCEPTION 'checkout_v2_price_snapshot_already_registered'
                USING ERRCODE = '23505';
        END IF;
        RETURN snapshot_row;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_price_snapshots AS other_snapshot
        WHERE other_snapshot.initial_stripe_price_id IN (
                p_initial_stripe_price_id,
                p_recurring_stripe_price_id
            )
           OR other_snapshot.recurring_stripe_price_id IN (
                p_initial_stripe_price_id,
                p_recurring_stripe_price_id
            )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_stripe_price_is_already_bound'
            USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.checkout_v2_price_snapshots (
        package_price_id,
        stripe_account_id,
        stripe_livemode,
        initial_stripe_price_id,
        recurring_stripe_price_id
    ) VALUES (
        p_package_price_id,
        p_stripe_account_id,
        p_stripe_livemode,
        p_initial_stripe_price_id,
        p_recurring_stripe_price_id
    )
    RETURNING * INTO snapshot_row;

    RETURN snapshot_row;
END;
$$;

-- Initialize the exact first cycle only after the paid subscription, consumed
-- hold and four materialized sessions all exist. The transaction either links
-- every ledger row or leaves no partial billing foundation.
CREATE OR REPLACE FUNCTION public.initialize_checkout_v2_billing(
    p_subscription_id UUID,
    p_first_session_id UUID,
    p_initial_payment_id UUID,
    p_initial_stripe_price_id TEXT,
    p_stripe_renewal_anchor_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_billing_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    first_session_row public.sessions%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    hold_row public.bookable_slot_holds%ROWTYPE;
    slot_row public.bookable_slots%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    existing_cycle public.checkout_v2_cycles%ROWTYPE;
    materialized_count INTEGER;
BEGIN
    -- Match consume_bookable_slot_hold's slot -> hold -> subscription order so
    -- a recovery attempt cannot deadlock checkout finalization.
    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE subscription_id = p_subscription_id
      AND status = 'consumed';

    IF hold_row.id IS NOT NULL THEN
        SELECT * INTO slot_row
        FROM public.bookable_slots
        WHERE id = hold_row.slot_id
        FOR UPDATE;
    END IF;

    SELECT * INTO hold_row
    FROM public.bookable_slot_holds
    WHERE subscription_id = p_subscription_id
      AND status = 'consumed'
    FOR UPDATE;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO first_session_row
    FROM public.sessions
    WHERE id = p_first_session_id
    FOR UPDATE;

    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = p_initial_payment_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    SELECT COUNT(*) INTO materialized_count
    FROM public.bookable_slot_occurrences
    WHERE slot_id = slot_row.id
      AND session_id IS NOT NULL;

    IF billing_row.subscription_id IS NOT NULL THEN
        SELECT * INTO existing_cycle
        FROM public.checkout_v2_cycles
        WHERE subscription_id = p_subscription_id
          AND cycle_number = 1
        FOR UPDATE;

        IF subscription_row.id IS NULL
           OR subscription_row.contract_schema_version IS DISTINCT FROM 2
           OR billing_row.first_session_id IS DISTINCT FROM p_first_session_id
           OR billing_row.renewal_anchor_at IS DISTINCT FROM p_stripe_renewal_anchor_at
           OR first_session_row.subscription_id IS DISTINCT FROM p_subscription_id
           OR existing_cycle.id IS NULL
           OR existing_cycle.starts_at IS DISTINCT FROM billing_row.first_class_at
           OR existing_cycle.ends_at IS DISTINCT FROM billing_row.renewal_anchor_at
           OR existing_cycle.payment_id IS DISTINCT FROM p_initial_payment_id
           OR existing_cycle.stripe_price_id IS DISTINCT FROM p_initial_stripe_price_id
           OR existing_cycle.materialization_state IS DISTINCT FROM 'ready'
           OR existing_cycle.sessions_materialized_at IS NULL
           OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM existing_cycle.id
           OR hold_row.status IS DISTINCT FROM 'consumed'
           OR slot_row.status IS DISTINCT FROM 'sold'
           OR slot_row.sold_subscription_id IS DISTINCT FROM p_subscription_id
           OR (
                SELECT COUNT(*)
                FROM public.sessions
                WHERE subscription_id = p_subscription_id
                  AND checkout_v2_cycle_id = existing_cycle.id
                  AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
           ) IS DISTINCT FROM 4
           OR NOT EXISTS (
                SELECT 1
                FROM public.checkout_v2_weekly_allocations
                WHERE slot_id = slot_row.id
                  AND subscription_id = subscription_row.id
                  AND status IN ('active', 'released')
           )
           OR NOT EXISTS (
                SELECT 1
                FROM public.checkout_v2_price_snapshots
                WHERE package_price_id = subscription_row.package_price_id
                  AND initial_stripe_price_id = p_initial_stripe_price_id
           ) THEN
            RAISE EXCEPTION 'checkout_v2_billing_is_already_initialized'
                USING ERRCODE = '23505';
        END IF;
        RETURN billing_row;
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status IS DISTINCT FROM 'active'::public.subscription_status
       OR subscription_row.sessions_total IS DISTINCT FROM 4
       OR subscription_row.contracted_sessions_per_period IS DISTINCT FROM 4
       OR subscription_row.sessions_used IS DISTINCT FROM 4
       OR first_session_row.id IS NULL
       OR first_session_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR first_session_row.status IS DISTINCT FROM 'scheduled'
       OR first_session_row.scheduled_at IS NULL
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM subscription_row.id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM 25900
       OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
       OR payment_row.stripe_invoice_id IS DISTINCT FROM subscription_row.stripe_invoice_id
       OR (billing_row.subscription_id IS NULL AND payment_row.checkout_v2_cycle_id IS NOT NULL)
       OR hold_row.id IS NULL
       OR slot_row.status IS DISTINCT FROM 'sold'
       OR slot_row.sold_subscription_id IS DISTINCT FROM subscription_row.id
       OR slot_row.sessions_materialized_at IS NULL
       OR materialized_count IS DISTINCT FROM 4
       OR NOT EXISTS (
            SELECT 1
            FROM public.bookable_slot_occurrences
            WHERE slot_id = slot_row.id
              AND occurrence_index = 1
              AND session_id = first_session_row.id
       )
       OR p_stripe_renewal_anchor_at IS DISTINCT FROM
            first_session_row.scheduled_at + INTERVAL '672 hours'
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_price_snapshots
            WHERE package_price_id = subscription_row.package_price_id
              AND initial_stripe_price_id = p_initial_stripe_price_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_billing_initialization_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.checkout_v2_cycles (
        subscription_id,
        cycle_number,
        cycle_kind,
        starts_at,
        ends_at,
        stripe_price_id,
        stripe_invoice_id,
        payment_id,
        materialization_state,
        sessions_materialized_at
    ) VALUES (
        subscription_row.id,
        1,
        'initial',
        first_session_row.scheduled_at,
        p_stripe_renewal_anchor_at,
        p_initial_stripe_price_id,
        subscription_row.stripe_invoice_id,
        payment_row.id,
        'ready',
        clock_timestamp()
    )
    RETURNING * INTO cycle_row;

    UPDATE public.sessions AS session_row
    SET
        checkout_v2_cycle_id = cycle_row.id,
        checkout_v2_cycle_session_index = occurrence_row.occurrence_index
    FROM public.bookable_slot_occurrences AS occurrence_row
    WHERE occurrence_row.slot_id = slot_row.id
      AND occurrence_row.session_id = session_row.id
      AND session_row.subscription_id = subscription_row.id;

    GET DIAGNOSTICS materialized_count = ROW_COUNT;
    IF materialized_count IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_initial_cycle_session_binding_failed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.payments
    SET checkout_v2_cycle_id = cycle_row.id
    WHERE id = payment_row.id;

    INSERT INTO public.checkout_v2_billing_state (
        subscription_id,
        first_session_id,
        first_class_at,
        renewal_anchor_at,
        stripe_renewal_anchor_at
    ) VALUES (
        subscription_row.id,
        first_session_row.id,
        first_session_row.scheduled_at,
        p_stripe_renewal_anchor_at,
        p_stripe_renewal_anchor_at
    )
    RETURNING * INTO billing_row;

    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations
        WHERE slot_id = slot_row.id
          AND subscription_id = subscription_row.id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_weekly_assignment_is_missing'
            USING ERRCODE = '23514';
    END IF;

    RETURN billing_row;
END;
$$;

-- Stripe is updated first with a stable application idempotency key; this RPC
-- then reconciles the exact observed anchor. A repeated confirmation converges
-- without advancing the revision twice.
CREATE OR REPLACE FUNCTION public.reconcile_checkout_v2_provisional_anchor(
    p_subscription_id UUID,
    p_expected_revision BIGINT,
    p_new_first_local_date DATE,
    p_observed_stripe_renewal_anchor_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_billing_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    new_first_local TIMESTAMP;
    new_first_class_at TIMESTAMPTZ;
    affected_sessions INTEGER;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    IF billing_row.subscription_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_billing_state_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE subscription_id = p_subscription_id
      AND cycle_number = 1
    FOR UPDATE;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations
    WHERE subscription_id = p_subscription_id
      AND status = 'active'
    FOR UPDATE;

    IF p_new_first_local_date IS NULL OR allocation_row.id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_provisional_anchor_cannot_move'
            USING ERRCODE = '23514';
    END IF;

    new_first_local := p_new_first_local_date + allocation_row.local_start_time;
    new_first_class_at := new_first_local AT TIME ZONE allocation_row.timezone_name;

    IF billing_row.first_class_at IS NOT DISTINCT FROM new_first_class_at
       AND billing_row.renewal_anchor_at IS NOT DISTINCT FROM p_observed_stripe_renewal_anchor_at THEN
        IF p_expected_revision NOT IN (
            billing_row.anchor_revision,
            billing_row.anchor_revision - 1
        ) THEN
            RAISE EXCEPTION 'checkout_v2_anchor_revision_conflicts'
                USING ERRCODE = '40001';
        END IF;
        RETURN billing_row;
    END IF;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       OR billing_row.anchor_state IS DISTINCT FROM 'provisional'
       OR billing_row.anchor_revision IS DISTINCT FROM p_expected_revision
       OR clock_timestamp() >= billing_row.first_class_at
       OR new_first_class_at <= clock_timestamp()
       OR EXTRACT(DOW FROM p_new_first_local_date)::SMALLINT
            IS DISTINCT FROM allocation_row.weekday
       OR (new_first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
            IS DISTINCT FROM p_new_first_local_date
       OR (new_first_class_at AT TIME ZONE allocation_row.timezone_name)::TIME(0)
            IS DISTINCT FROM allocation_row.local_start_time
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.generate_series(0, 3) AS occurrence(week_offset)
            CROSS JOIN LATERAL (
                SELECT
                    new_first_local
                    + pg_catalog.make_interval(days => occurrence.week_offset * 7)
                        AS local_occurrence_at
            ) AS target
            CROSS JOIN LATERAL (
                SELECT COUNT(*) AS matching_instants
                FROM pg_catalog.generate_series(
                    (
                        target.local_occurrence_at
                        AT TIME ZONE allocation_row.timezone_name
                    ) - INTERVAL '2 hours',
                    (
                        target.local_occurrence_at
                        AT TIME ZONE allocation_row.timezone_name
                    ) + INTERVAL '2 hours',
                    INTERVAL '30 minutes'
                ) AS candidate(candidate_at)
                WHERE (
                    candidate.candidate_at
                    AT TIME ZONE allocation_row.timezone_name
                ) = target.local_occurrence_at
            ) AS resolution
            WHERE resolution.matching_instants <> 1
       )
       OR p_observed_stripe_renewal_anchor_at IS DISTINCT FROM
            new_first_class_at + INTERVAL '672 hours'
       OR cycle_row.id IS NULL
       OR cycle_row.cycle_kind IS DISTINCT FROM 'initial'
       OR NOT EXISTS (
            SELECT 1
            FROM public.sessions
            WHERE id = billing_row.first_session_id
              AND checkout_v2_cycle_id = cycle_row.id
              AND checkout_v2_cycle_session_index = 1
       )
       OR (
            SELECT COUNT(*)
            FROM public.sessions AS session_row
            WHERE session_row.checkout_v2_cycle_id = cycle_row.id
              AND session_row.subscription_id = p_subscription_id
              AND session_row.teacher_id = allocation_row.teacher_id
              AND session_row.duration_minutes = 50
              AND session_row.status = 'scheduled'
              AND session_row.scheduled_at > clock_timestamp()
              AND session_row.checkout_v2_cycle_session_index BETWEEN 1 AND 4
       ) IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_provisional_anchor_cannot_move'
            USING ERRCODE = '23514';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(allocation_row.teacher_id::TEXT, 42850)
    );

    PERFORM 1
    FROM public.sessions
    WHERE checkout_v2_cycle_id = cycle_row.id
    ORDER BY checkout_v2_cycle_session_index
    FOR UPDATE;

    -- Move the four timestamps to an empty range first so a whole-week shift
    -- cannot collide transiently with another row from the same cycle's
    -- immediate exclusion constraint. `infinity + duration = infinity`.
    UPDATE public.sessions
    SET scheduled_at = 'infinity'::TIMESTAMPTZ
    WHERE checkout_v2_cycle_id = cycle_row.id;
    GET DIAGNOSTICS affected_sessions = ROW_COUNT;

    IF affected_sessions IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_provisional_anchor_session_count_changed'
            USING ERRCODE = '40001';
    END IF;

    UPDATE public.sessions AS session_row
    SET scheduled_at = (
        new_first_local
        + pg_catalog.make_interval(
            days => (session_row.checkout_v2_cycle_session_index - 1) * 7
          )
    ) AT TIME ZONE allocation_row.timezone_name
    WHERE session_row.checkout_v2_cycle_id = cycle_row.id;

    UPDATE public.checkout_v2_cycles
    SET
        starts_at = new_first_class_at,
        ends_at = p_observed_stripe_renewal_anchor_at,
        updated_at = clock_timestamp()
    WHERE id = cycle_row.id;

    UPDATE public.checkout_v2_billing_state
    SET
        first_class_at = new_first_class_at,
        renewal_anchor_at = p_observed_stripe_renewal_anchor_at,
        stripe_renewal_anchor_at = p_observed_stripe_renewal_anchor_at,
        anchor_revision = anchor_revision + 1
    WHERE subscription_id = p_subscription_id
    RETURNING * INTO billing_row;

    UPDATE public.subscriptions
    SET
        starts_at = p_new_first_local_date,
        ends_at = (
            p_observed_stripe_renewal_anchor_at AT TIME ZONE 'Europe/Madrid'
        )::DATE
    WHERE id = p_subscription_id;

    RETURN billing_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.fix_checkout_v2_billing_anchor(
    p_subscription_id UUID,
    p_fixed_at TIMESTAMPTZ
)
RETURNS public.checkout_v2_billing_state
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    billing_row public.checkout_v2_billing_state%ROWTYPE;
BEGIN
    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    IF billing_row.anchor_state = 'fixed' THEN
        IF billing_row.anchor_fixed_at IS DISTINCT FROM p_fixed_at THEN
            RAISE EXCEPTION 'checkout_v2_fixed_anchor_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN billing_row;
    END IF;

    IF billing_row.subscription_id IS NULL
       OR p_fixed_at IS NULL
       OR p_fixed_at < billing_row.first_class_at
       OR clock_timestamp() < billing_row.first_class_at
       OR p_fixed_at > clock_timestamp() THEN
        RAISE EXCEPTION 'checkout_v2_anchor_cannot_be_fixed'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.checkout_v2_billing_state
    SET anchor_state = 'fixed', anchor_fixed_at = p_fixed_at
    WHERE subscription_id = p_subscription_id
    RETURNING * INTO billing_row;

    RETURN billing_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_checkout_v2_renewal(
    p_subscription_id UUID,
    p_stripe_subscription_id TEXT,
    p_stripe_invoice_id TEXT,
    p_payment_id UUID,
    p_recurring_stripe_price_id TEXT,
    p_period_start TIMESTAMPTZ,
    p_period_end TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    previous_cycle public.checkout_v2_cycles%ROWTYPE;
    existing_cycle public.checkout_v2_cycles%ROWTYPE;
    payment_row public.payments%ROWTYPE;
    next_cycle public.checkout_v2_cycles%ROWTYPE;
BEGIN
    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = p_subscription_id
    FOR UPDATE;

    SELECT * INTO payment_row
    FROM public.payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF subscription_row.id IS NULL
       OR subscription_row.contract_schema_version IS DISTINCT FROM 2
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id
       OR billing_row.subscription_id IS NULL
       OR p_stripe_invoice_id IS NULL
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$'
       OR p_recurring_stripe_price_id IS NULL
       OR p_recurring_stripe_price_id !~ '^price_[A-Za-z0-9_]+$'
       OR p_period_start IS NULL
       OR p_period_end IS DISTINCT FROM p_period_start + INTERVAL '672 hours'
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_price_snapshots
            WHERE package_price_id = subscription_row.package_price_id
              AND recurring_stripe_price_id = p_recurring_stripe_price_id
       ) THEN
        RAISE EXCEPTION 'checkout_v2_renewal_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    SELECT * INTO existing_cycle
    FROM public.checkout_v2_cycles
    WHERE stripe_invoice_id = p_stripe_invoice_id
    FOR UPDATE;
    IF FOUND THEN
        IF existing_cycle.subscription_id IS DISTINCT FROM p_subscription_id
           OR existing_cycle.payment_id IS DISTINCT FROM p_payment_id
           OR existing_cycle.stripe_price_id IS DISTINCT FROM p_recurring_stripe_price_id
           OR existing_cycle.starts_at IS DISTINCT FROM p_period_start
           OR existing_cycle.ends_at IS DISTINCT FROM p_period_end
           OR payment_row.id IS NULL
           OR payment_row.subscription_id IS DISTINCT FROM p_subscription_id
           OR payment_row.stripe_invoice_id IS DISTINCT FROM p_stripe_invoice_id
           OR payment_row.checkout_v2_cycle_id IS DISTINCT FROM existing_cycle.id THEN
            RAISE EXCEPTION 'checkout_v2_renewal_invoice_conflicts'
                USING ERRCODE = '23505';
        END IF;
        RETURN FALSE;
    END IF;

    SELECT * INTO previous_cycle
    FROM public.checkout_v2_cycles
    WHERE subscription_id = p_subscription_id
    ORDER BY cycle_number DESC
    LIMIT 1
    FOR UPDATE;

    IF subscription_row.status NOT IN (
            'active'::public.subscription_status,
            'paused'::public.subscription_status
       )
       OR subscription_row.stripe_invoice_id IS DISTINCT FROM previous_cycle.stripe_invoice_id
       OR billing_row.anchor_state IS DISTINCT FROM 'fixed'
       OR previous_cycle.id IS NULL
       OR previous_cycle.materialization_state IS DISTINCT FROM 'ready'
       OR p_period_start IS DISTINCT FROM previous_cycle.ends_at
       OR payment_row.id IS NULL
       OR payment_row.subscription_id IS DISTINCT FROM p_subscription_id
       OR payment_row.status IS DISTINCT FROM 'succeeded'::public.payment_status
       OR payment_row.amount IS DISTINCT FROM 25900
       OR lower(payment_row.currency) IS DISTINCT FROM 'eur'
       OR payment_row.stripe_invoice_id IS DISTINCT FROM p_stripe_invoice_id
       OR payment_row.checkout_v2_cycle_id IS NOT NULL
       THEN
        RAISE EXCEPTION 'checkout_v2_renewal_snapshot_is_invalid'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.checkout_v2_cycles (
        subscription_id,
        cycle_number,
        cycle_kind,
        starts_at,
        ends_at,
        stripe_price_id,
        stripe_invoice_id,
        payment_id
    ) VALUES (
        p_subscription_id,
        previous_cycle.cycle_number + 1,
        'renewal',
        p_period_start,
        p_period_end,
        p_recurring_stripe_price_id,
        p_stripe_invoice_id,
        p_payment_id
    )
    RETURNING * INTO next_cycle;

    UPDATE public.payments
    SET checkout_v2_cycle_id = next_cycle.id
    WHERE id = p_payment_id;

    UPDATE public.subscriptions
    SET
        ends_at = (p_period_end AT TIME ZONE 'Europe/Madrid')::DATE,
        sessions_total = 4,
        sessions_used = 0,
        status = 'active',
        stripe_invoice_id = p_stripe_invoice_id
    WHERE id = p_subscription_id;

    RETURN TRUE;
END;
$$;

-- The historical helper remains byte-for-byte compatible for monthly V1
-- subscriptions, but it cannot bypass the cycle ledger for V2.
CREATE OR REPLACE FUNCTION public.apply_subscription_renewal(
    p_subscription_id UUID,
    p_stripe_subscription_id TEXT,
    p_stripe_invoice_id TEXT,
    p_new_ends_at DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    subscription_row public.subscriptions%ROWTYPE;
BEGIN
    IF p_subscription_id IS NULL
       OR p_stripe_subscription_id IS NULL
       OR p_stripe_invoice_id IS NULL
       OR p_new_ends_at IS NULL
       OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9_]+$'
       OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid_stripe_renewal_snapshot'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO subscription_row
    FROM public.subscriptions
    WHERE id = p_subscription_id
    FOR UPDATE;

    IF NOT FOUND
       OR subscription_row.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id THEN
        RAISE EXCEPTION 'renewal_subscription_does_not_match'
            USING ERRCODE = '42501';
    END IF;

    IF subscription_row.contract_schema_version = 2 THEN
        RAISE EXCEPTION 'checkout_v2_renewal_requires_cycle_ledger'
            USING ERRCODE = '23514';
    END IF;

    IF subscription_row.stripe_invoice_id = p_stripe_invoice_id
       OR p_new_ends_at <= subscription_row.ends_at THEN
        RETURN FALSE;
    END IF;

    UPDATE public.subscriptions
    SET
        ends_at = p_new_ends_at,
        sessions_total = subscription_row.contracted_sessions_per_period,
        sessions_used = 0,
        status = 'active',
        stripe_invoice_id = p_stripe_invoice_id
    WHERE id = p_subscription_id;

    RETURN TRUE;
END;
$$;

ALTER TABLE public.checkout_v2_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_v2_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_v2_billing_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_v2_weekly_allocations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.checkout_v2_price_snapshots
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_v2_cycles
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_v2_billing_state
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.checkout_v2_weekly_allocations
    FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_price_snapshots
    FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_cycles
    FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_billing_state
    FROM service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.checkout_v2_weekly_allocations
    FROM service_role;

GRANT SELECT ON TABLE public.checkout_v2_price_snapshots TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_cycles TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_billing_state TO service_role;
GRANT SELECT ON TABLE public.checkout_v2_weekly_allocations TO service_role;

REVOKE ALL ON FUNCTION private.guard_checkout_v2_price_snapshot()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_billing_state()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_cycle()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_weekly_allocation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_checkout_v2_weekly_allocation()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.release_checkout_v2_allocation_on_subscription_end()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_cycle_binding()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_checkout_v2_session_position()
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.register_checkout_v2_price_snapshot(UUID, TEXT, BOOLEAN, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_checkout_v2_price_snapshot(UUID, TEXT, BOOLEAN, TEXT, TEXT)
    TO service_role;

REVOKE ALL ON FUNCTION public.initialize_checkout_v2_billing(UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_checkout_v2_billing(UUID, UUID, UUID, TEXT, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.reconcile_checkout_v2_provisional_anchor(UUID, BIGINT, DATE, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_checkout_v2_provisional_anchor(UUID, BIGINT, DATE, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.fix_checkout_v2_billing_anchor(UUID, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fix_checkout_v2_billing_anchor(UUID, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.apply_checkout_v2_renewal(UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_checkout_v2_renewal(UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ)
    TO service_role;

REVOKE ALL ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_renewal(UUID, TEXT, TEXT, DATE)
    TO service_role;

COMMENT ON TABLE public.checkout_v2_price_snapshots IS
    'Immutable verified pair of the immediate one-time Stripe Price and recurring 28-day Stripe Price.';
COMMENT ON TABLE public.checkout_v2_billing_state IS
    'Exact first-class and renewal-anchor state; provisional until the first class starts, then immutable.';
COMMENT ON TABLE public.checkout_v2_cycles IS
    'One immutable 28-day, four-session, EUR 259 billing ledger row per paid Checkout V2 cycle.';
COMMENT ON TABLE public.checkout_v2_weekly_allocations IS
    'Persistent Madrid-local weekly teacher capacity owned by an active Checkout V2 subscription.';
