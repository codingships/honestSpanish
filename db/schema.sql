-- =============================================
-- ESPAÃ‘OL HONESTO - DATABASE SCHEMA
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
    id UUID PRIMARY KEY DEFAULT gen_ranÛµã‹h‘éì¶»§q«^t€€Í•½¹‘}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ%8€ …¹•±±•œ°€¹½}Í¡½Üœ¤(€€€€€€€€€€€9Í•½¹‘}•áÕÍ•(€€€€€€€€¤(€€€€¤Q!8(€€€€€€€•±¥¥‰¥±¥Ñå}ÍÑ…Ñ”€èô€±½Í•œì(€€€€€€€•±¥¥‰¥±¥Ñå}É•…Í½¸€èôM(€€€€€€€€€€€]!8Í•½¹‘}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€…¹•±±•œ(€€€€€€€€€€€€9Í•½¹‘}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð%L9=P9U10(€€€€€€€€€€€€9Í•½¹‘}Í•ÍÍ¥½¸¹…¹•±±•‘}‰ä€ôÍ•½¹‘}Í•ÍÍ¥½¸¹ÍÑÕ‘•¹Ñ}¥(€€€€€€€€€€€€9Í•½¹‘}Í•ÍÍ¥½¸¹Í¡•‘Õ±•‘}…Ð€ðÍ•½¹‘}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð€¬%9QIY0€œÈÐ¡½ÕÉÌœ(€€€€€€€€€€€€€€€Q!8€Í•½¹‘}±…ÍÍ}±…Ñ•}…¹•±±…Ñ¥½¸œ(€€€€€€€€€€€]!8Í•½¹‘}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€¹½}Í¡½Üœ(€€€€€€€€€€€€€€€Q!8€Í•½¹‘}±…ÍÍ}¹½}Í¡½Üœ(€€€€€€€€€€€]!8Í•½¹‘}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€…¹•±±•œ(€€€€€€€€€€€€€€€Q!8€Í•½¹‘}±…ÍÍ}…¹•±±…Ñ¥½¹}É•ÅÕ¥É•Í}ÍÕÁÁ½ÉÐœ(€€€€€€€€€€€1M€Í•½¹‘}±…ÍÍ}ÍÑ…ÉÑ•‘}½É}½¹ÍÕµ•œ(€€€€€€€9ì(€€€€€€€IQUI89aPì(€€€€€€€IQUI8ì(€€€9%ì((€€€Ñ¡¥É‘}½¹ÍÕµ•€èô9=P€ (€€€€€€€Ñ¡¥É‘}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€Í¡•‘Õ±•œ(€€€€€€€=H€ (€€€€€€€€€€€Ñ¡¥É‘}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€…¹•±±•œ(€€€€€€€€€€€9Ñ¡¥É‘}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð%L9=P9U10(€€€€€€€€€€€9€ (€€€€€€€€€€€€€€€Ñ¡¥É‘}Í•ÍÍ¥½¸¹…¹•±±•‘}‰ä%L%MQ%9PI=4Ñ¡¥É‘}Í•ÍÍ¥½¸¹ÍÑÕ‘•¹Ñ}¥(€€€€€€€€€€€€€€€=HÑ¡¥É‘}Í•ÍÍ¥½¸¹Í¡•‘Õ±•‘}…Ð€øôÑ¡¥É‘}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð€¬%9QIY0€œÈÐ¡½ÕÉÌœ(€€€€€€€€€€€€¤(€€€€€€€€¤(€€€€¤ì(€€€™½ÕÉÑ¡}½¹ÍÕµ•€èô9=P€ (€€€€€€€™½ÕÉÑ¡}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€Í¡•‘Õ±•œ(€€€€€€€=H€ (€€€€€€€€€€€™½ÕÉÑ¡}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€…¹•±±•œ(€€€€€€€€€€€9™½ÕÉÑ¡}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð%L9=P9U10(€€€€€€€€€€€9€ (€€€€€€€€€€€€€€€™½ÕÉÑ¡}Í•ÍÍ¥½¸¹…¹•±±•‘}‰ä%L%MQ%9PI=4™½ÕÉÑ¡}Í•ÍÍ¥½¸¹ÍÑÕ‘•¹Ñ}¥(€€€€€€€€€€€€€€€=H™½ÕÉÑ¡}Í•ÍÍ¥½¸¹Í¡•‘Õ±•‘}…Ð€øô™½ÕÉÑ¡}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð€¬%9QIY0€œÈÐ¡½ÕÉÌœ(€€€€€€€€€€€€¤(€€€€€€€€¤(€€€€¤ì((€€€%Ñ¡¥É‘}½¹ÍÕµ•=H™½ÕÉÑ¡}½¹ÍÕµ•Q!8(€€€€€€€•±¥¥‰¥±¥Ñå}ÍÑ…Ñ”€èô€±½Í•œì(€€€€€€€•±¥¥‰¥±¥Ñå}É•…Í½¸€èô€É•µ…¥¹¥¹}±…ÍÍ}½¹ÍÕµ•œì(€€€€€€€IQUI89aPì(€€€€€€€IQUI8ì(€€€9%ì((€€€•±¥¥‰¥±¥Ñå}ÍÑ…Ñ”€èô€•±¥¥‰±”œì(€€€•±¥¥‰¥±¥Ñå}É•…Í½¸€èô€•±¥¥‰±”œì(€€€IQUI89aPì)9ì(ì()IQ=HIA1U9Q%=8ÁÕ‰±¥Œ¹…ÁÁ±å}¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}Ñ•Éµ¥¹…Ñ¥½¸ (€€€Á}½Á•É…Ñ¥½¹}¥UU%°(€€€Á}Ý½É­•É}Ñ½­•¸UU%°(€€€Á}ÍÑÉ¥Á•}…¹•±±•‘}…ÐQ%5MQ5AQh(¤)IQUI9LÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}½Á•É…Ñ¥½¹Ì)19UÁ±ÁÍÅ°)MUI%Qd%9H)MPÍ•…É¡}Á…Ñ €ô€œœ)L€)1I(€€€½Á•É…Ñ¥½¹}É½ÜÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}½Á•É…Ñ¥½¹Ì•I=]QeAì(€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½ÜÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹Ì•I=]QeAì(€€€™¥ÉÍÑ}Í•ÍÍ¥½¸ÁÕ‰±¥Œ¹Í•ÍÍ¥½¹Ì•I=]QeAì(€€€Ñ…É•Ñ}Í•ÍÍ¥½¸ÁÕ‰±¥Œ¹Í•ÍÍ¥½¹Ì•I=]QeAì(€€€…ÁÁ±¥•‘}…ÐQ%5MQ5AQh€èô‘…Ñ•}ÑÉÕ¹Œ Í•½¹œ°±½­}Ñ¥µ•ÍÑ…µÀ ¤¤ì(€€€©½‰}Á…å±½…)M=9ì(€€€©½‰}É½ÜÁÕ‰±¥Œ¹™Õ±™¥±±µ•¹Ñ}©½‰Ì•I=]QeAì)	%8(€€€%Á}½Á•É…Ñ¥½¹}¥%L9U10(€€€€€€=HÁ}Ý½É­•É}Ñ½­•¸%L9U10(€€€€€€=HÁ}ÍÑÉ¥Á•}…¹•±±•‘}…Ð%L9U10(€€€€€€=H9=PÁ}…Ñ…±½œ¹¥Í™¥¹¥Ñ”¡Á}ÍÑÉ¥Á•}…¹•±±•‘}…Ð¤(€€€€€€=H‘…Ñ•}ÑÉÕ¹Œ Í•½¹œ°Á}ÍÑÉ¥Á•}…¹•±±•‘}…Ð¤%L%MQ%9PI=4Á}ÍÑÉ¥Á•}…¹•±±•‘}…ÐQ!8(€€€€€€€I%MaAQ%=8€¥¹Ù…±¥‘}¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}Ñ•Éµ¥¹…Ñ¥½¸œ(€€€€€€€€€€€UM%9II=€ô€œÈÈÀÈÌœì(€€€9%ì((€€€½Á•É…Ñ¥½¹}É½Ü€èôÁÉ¥Ù…Ñ”¹±½­}¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}½Á•É…Ñ¥½¸¡Á}½Á•É…Ñ¥½¹}¥¤ì((€€€%½Á•É…Ñ¥½¹}É½Ü¹Ñ•Éµ¥¹…Ñ•‘}…Ð%L9=P9U10Q!8(€€€€€€€IQUI8½Á•É…Ñ¥½¹}É½Üì(€€€9%ì((€€€%½Á•É…Ñ¥½¹}É½Ü¹ÍÑ…ÑÕÌ%L%MQ%9PI=4€ÁÉ½•ÍÍ¥¹œœ(€€€€€€=H½Á•É…Ñ¥½¹}É½Ü¹±•…Í•}Ñ½­•¸%L%MQ%9PI=4Á}Ý½É­•É}Ñ½­•¸(€€€€€€=H½Á•É…Ñ¥½¹}É½Ü¹±•…Í•}•áÁ¥É•Í}…Ð€ðô…ÁÁ±¥•‘}…Ð(€€€€€€=H½Á•É…Ñ¥½¹}É½Ü¹…¹•±±…Ñ¥½¹}ÍÑ…ÉÑ•‘}…Ð%L9U10(€€€€€€=HÁ}ÍÑÉ¥Á•}…¹•±±•‘}…Ð(€€€€€€€€€€€€ð½Á•É…Ñ¥½¹}É½Ü¹…¹•±±…Ñ¥½¹}ÍÑ…ÉÑ•‘}…Ð€´%9QIY0€œÔµ¥¹ÕÑ•Ìœ(€€€€€€=HÁ}ÍÑÉ¥Á•}…¹•±±•‘}…Ð€ø…ÁÁ±¥•‘}…Ð€¬%9QIY0€œÔµ¥¹ÕÑ•ÌœQ!8(€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}Ñ•Éµ¥¹…Ñ¥½¹}ÍÑ…Ñ•}½¹™±¥ÑÌœ(€€€€€€€€€€€UM%9II=€ô€œÐÀÀÀÄœì(€€€9%ì((€€€M1P€¨%9Q<ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü(€€€I=4ÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹Ì(€€€]!I¥€ô½Á•É…Ñ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥ì(€€€M1P€¨%9Q<™¥ÉÍÑ}Í•ÍÍ¥½¸(€€€I=4ÁÉ¥Ù…Ñ”¹¡•­½ÕÑ}ØÉ}•™™•Ñ¥Ù•}å±•}Í•ÍÍ¥½¹Ì¡½Á•É…Ñ¥½¹}É½Ü¹å±•}¥¤(€€€]!I¡•­½ÕÑ}ØÉ}å±•}Í•ÍÍ¥½¹}¥¹‘•à€ô€Äì((€€€%ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹¥%L9U10(€€€€€€=HÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹½¹ÑÉ…Ñ}Í¡•µ…}Ù•ÉÍ¥½¸%L%MQ%9PI=4€È(€€€€€€=HÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹ÍÑÉ¥Á•}ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥%L%MQ%9PI=4(€€€€€€€€€€€½Á•É…Ñ¥½¹}É½Ü¹ÍÑÉ¥Á•}ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥(€€€€€€=H™¥ÉÍÑ}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ%L%MQ%9PI=4€½µÁ±•Ñ•œ(€€€€€€=H™¥ÉÍÑ}Í•ÍÍ¥½¸¹½µÁ±•Ñ•‘}…Ð%L9U10(€€€€€€=H™¥ÉÍÑ}Í•ÍÍ¥½¸¹Í¡•‘Õ±•‘}…Ð%L9U10(€€€€€€=H™¥ÉÍÑ}Í•ÍÍ¥½¸¹½µÁ±•Ñ•‘}…Ð€ð™¥ÉÍÑ}Í•ÍÍ¥½¸¹Í¡•‘Õ±•‘}…Ð(€€€€€€€€€€€€¬Á}…Ñ…±½œ¹µ…­•}¥¹Ñ•ÉÙ…°¡µ¥¹Ì€ôø™¥ÉÍÑ}Í•ÍÍ¥½¸¹‘ÕÉ…Ñ¥½¹}µ¥¹ÕÑ•Ì¤(€€€€€€=H™¥ÉÍÑ}Í•ÍÍ¥½¸¹¥%L%MQ%9PI=4½Á•É…Ñ¥½¹}É½Ü¹™¥ÉÍÑ}Í•ÍÍ¥½¹}¥Q!8(€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}Ñ•Éµ¥¹…Ñ¥½¹}ÍÑ…Ñ•}½¹™±¥ÑÌœ(€€€€€€€€€€€UM%9II=€ô€œÐÀÀÀÄœì(€€€9%ì((€€€AI=I4Á}…Ñ…±½œ¹Í•Ñ}½¹™¥œ (€€€€€€€€…ÁÀ¹¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}½Á•É…Ñ¥½¹}¥œ°(€€€€€€€½Á•É…Ñ¥½¹}É½Ü¹¥èéQaP°(€€€€€€€QIU(€€€€¤ì((€€€=HÑ…É•Ñ}Í•ÍÍ¥½¸%8(€€€€€€€M1P€¨(€€€€€€€I=4ÁÉ¥Ù…Ñ”¹¡•­½ÕÑ}ØÉ}•™™•Ñ¥Ù•}å±•}Í•ÍÍ¥½¹Ì¡½Á•É…Ñ¥½¹}É½Ü¹å±•}¥¤(€€€€€€€]!I¡•­½ÕÑ}ØÉ}å±•}Í•ÍÍ¥½¹}¥¹‘•à	Q]8€È9€Ð(€€€€€€€=IH	d¡•­½ÕÑ}ØÉ}å±•}Í•ÍÍ¥½¹}¥¹‘•à°É•…Ñ•‘}…Ð°¥(€€€1==@(€€€€€€€%Ñ…É•Ñ}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€Í¡•‘Õ±•œQ!8(€€€€€€€€€€€UAQÁÕ‰±¥Œ¹Í•ÍÍ¥½¹Ì(€€€€€€€€€€€MP(€€€€€€€€€€€€€€€ÍÑ…ÑÕÌ€ô€…¹•±±•œ°(€€€€€€€€€€€€€€€…¹•±±•‘}…Ð€ô…ÁÁ±¥•‘}…Ð°(€€€€€€€€€€€€€€€…¹•±±•‘}‰ä€ô½Á•É…Ñ¥½¹}É½Ü¹…Ñ½É}¥°(€€€€€€€€€€€€€€€…¹•±±…Ñ¥½¹}É•…Í½¸€ô€Õ…É…¹Ñ••}É•™Õ¹œ°(€€€€€€€€€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô…ÁÁ±¥•‘}…Ð(€€€€€€€€€€€]!I¥€ôÑ…É•Ñ}Í•ÍÍ¥½¸¹¥(€€€€€€€€€€€€€9ÍÑ…ÑÕÌ€ô€Í¡•‘Õ±•œì((€€€€€€€€€€€%9=P=U9Q!8(€€€€€€€€€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}Í•ÍÍ¥½¹}ÍÑ…Ñ•}½¹™±¥ÑÌœ(€€€€€€€€€€€€€€€€€€€UM%9II=€ô€œÐÀÀÀÄœì(€€€€€€€€€€€9%ì((€€€€€€€€€€€©½‰}Á…å±½…€èôÁ}…Ñ…±½œ¹©Í½¹‰}‰Õ¥±‘}½‰©•Ð (€€€€€€€€€€€€€€€€Í•ÍÍ¥½¹%œ°Ñ…É•Ñ}Í•ÍÍ¥½¸¹¥°(€€€€€€€€€€€€€€€€…¹•±±•‘	äœ°€Õ…É…¹Ñ•”œ°(€€€€€€€€€€€€€€€€É•…Í½¸œ°€Õ…É…¹Ñ••}É•™Õ¹œ°(€€€€€€€€€€€€€€€€Í•¹‘µ…¥°œ°1M(€€€€€€€€€€€€¤ì((€€€€€€€€€€€%9MIP%9Q<ÁÕ‰±¥Œ¹™Õ±™¥±±µ•¹Ñ}©½‰Ì€ (€€€€€€€€€€€€€€€©½‰}ÑåÁ”°(€€€€€€€€€€€€€€€Í•ÍÍ¥½¹}¥°(€€€€€€€€€€€€€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥°(€€€€€€€€€€€€€€€ÍÑÕ‘•¹Ñ}¥°(€€€€€€€€€€€€€€€‘•‘ÕÁ•}­•ä°(€€€€€€€€€€€€€€€Á…å±½…(€€€€€€€€€€€€¤Y1UL€ (€€€€€€€€€€€€€€€€Í•ÍÍ¥½¹}…¹•±±…Ñ¥½¸œ°(€€€€€€€€€€€€€€€Ñ…É•Ñ}Í•ÍÍ¥½¸¹¥°(€€€€€€€€€€€€€€€½Á•É…Ñ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥°(€€€€€€€€€€€€€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹ÍÑÕ‘•¹Ñ}¥°(€€€€€€€€€€€€€€€€Í•ÍÍ¥½¹}…¹•±±…Ñ¥½¸èœñðÑ…É•Ñ}Í•ÍÍ¥½¸¹¥èéQaP°(€€€€€€€€€€€€€€€©½‰}Á…å±½…(€€€€€€€€€€€€¤(€€€€€€€€€€€=8=91%P€¡©½‰}ÑåÁ”°‘•‘ÕÁ•}­•ä¤(€€€€€€€€€€€€€€€]!I‘•‘ÕÁ•}­•ä%L9=P9U10(€€€€€€€€€€€€€€€<9=Q!%9ì((€€€€€€€€€€€M1P€¨%9Q<©½‰}É½Ü(€€€€€€€€€€€I=4ÁÕ‰±¥Œ¹™Õ±™¥±±µ•¹Ñ}©½‰Ì(€€€€€€€€€€€]!I©½‰}ÑåÁ”€ô€Í•ÍÍ¥½¹}…¹•±±…Ñ¥½¸œ(€€€€€€€€€€€€€9‘•‘ÕÁ•}­•ä€ô€Í•ÍÍ¥½¹}…¹•±±…Ñ¥½¸èœñðÑ…É•Ñ}Í•ÍÍ¥½¸¹¥èéQaPì((€€€€€€€€€€€%©½‰}É½Ü¹¥%L9U10(€€€€€€€€€€€€€€=H©½‰}É½Ü¹Í•ÍÍ¥½¹}¥%L%MQ%9PI=4Ñ…É•Ñ}Í•ÍÍ¥½¸¹¥(€€€€€€€€€€€€€€=H©½‰}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥%L%MQ%9PI=4½Á•É…Ñ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥(€€€€€€€€€€€€€€=H©½‰}É½Ü¹ÍÑÕ‘•¹Ñ}¥%L%MQ%9PI=4ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹ÍÑÕ‘•¹Ñ}¥(€€€€€€€€€€€€€€=H©½‰}É½Ü¹Á…å±½…%L%MQ%9PI=4©½‰}Á…å±½…Q!8(€€€€€€€€€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}…¹•±±…Ñ¥½¹}©½‰}½¹™±¥ÑÌœ(€€€€€€€€€€€€€€€€€€€UM%9II=€ô€œÈÌÔÀÔœì(€€€€€€€€€€€9%ì(€€€€€€€1M%Ñ…É•Ñ}Í•ÍÍ¥½¸¹¥€ô½Á•É…Ñ¥½¹}É½Ü¹Í•½¹‘}Í•ÍÍ¥½¹}¥(€€€€€€€€€9Ñ…É•Ñ}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ%8€ …¹•±±•œ°€¹½}Í¡½Üœ¤(€€€€€€€€€9a%MQL€ (€€€€€€€€€€€€€€€M1P€Ä(€€€€€€€€€€€€€€€I=4ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}Í•ÍÍ¥½¹}¥¹¥‘•¹Ñ}É•Í½±ÕÑ¥½¹ÌLÉ•Í½±ÕÑ¥½¹}É½Ü(€€€€€€€€€€€€€€€]!IÉ•Í½±ÕÑ¥½¹}É½Ü¹Í•ÍÍ¥½¹}¥€ôÑ…É•Ñ}Í•ÍÍ¥½¸¹¥(€€€€€€€€€€€€€€€€€9É•Í½±ÕÑ¥½¹}É½Ü¹É•Í½±ÕÑ¥½¸€ô€•áÕÍ•œ(€€€€€€€€€€¤Q!8(€€€€€€€€€€€9U10ì(€€€€€€€1M%Ñ…É•Ñ}Í•ÍÍ¥½¸¹ÍÑ…ÑÕÌ€ô€…¹•±±•œ(€€€€€€€€€9Ñ…É•Ñ}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð%L9=P9U10(€€€€€€€€€9€ (€€€€€€€€€€€€€€€Ñ…É•Ñ}Í•ÍÍ¥½¸¹…¹•±±•‘}‰ä%L%MQ%9PI=4Ñ…É•Ñ}Í•ÍÍ¥½¸¹ÍÑÕ‘•¹Ñ}¥(€€€€€€€€€€€€€€€=HÑ…É•Ñ}Í•ÍÍ¥½¸¹Í¡•‘Õ±•‘}…Ð(€€€€€€€€€€€€€€€€€€€€øôÑ…É•Ñ}Í•ÍÍ¥½¸¹…¹•±±•‘}…Ð€¬%9QIY0€œÈÐ¡½ÕÉÌœ(€€€€€€€€€€¤Q!8(€€€€€€€€€€€9U10ì(€€€€€€€1M(€€€€€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}Í•ÍÍ¥½¹}ÍÑ…Ñ•}½¹™±¥ÑÌœ(€€€€€€€€€€€€€€€UM%9II=€ô€œÐÀÀÀÄœì(€€€€€€€9%ì(€€€91==@ì((€€€UAQÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹Ì(€€€MP(€€€€€€€ÍÑ…ÑÕÌ€ô€…¹•±±•œèéÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…ÑÕÌ°(€€€€€€€Í•ÍÍ¥½¹Í}ÕÍ•€ô€Ä°(€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ô…ÁÁ±¥•‘}…Ð(€€€]!I¥€ô½Á•É…Ñ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥(€€€€€9ÍÑ…ÑÕÌ%8€ (€€€€€€€€€€€€…Ñ¥Ù”œèéÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€Á…ÕÍ•œèéÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€…¹•±±•œèéÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…ÑÕÌ(€€€€€€¤ì((€€€%9=P=U9Q!8(€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…Ñ•}½¹™±¥ÑÌœ(€€€€€€€€€€€UM%9II=€ô€œÐÀÀÀÄœì(€€€9%ì((€€€UAQÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}Õ…É…¹Ñ••}½Á•É…Ñ¥½¹Ì(€€€MP(€€€€€€€ÍÑÉ¥Á•}…¹•±±•‘}…Ð€ôÁ}ÍÑÉ¥Á•}…¹•±±•‘}…Ð°(€€€€€€€Ñ•Éµ¥¹…Ñ•‘}…Ð€ô…ÁÁ±¥•‘}…Ð(€€€]!I¥€ôÁ}½Á•É…Ñ¥½¹}¥(€€€IQUI9%9€¨%9Q<½Á•É…Ñ¥½¹}É½Üì((€€€IQUI8½Á•É…Ñ¥½¹}É½Üì)9ì(ì()IQ=HIA1U9Q%=8ÁÕ‰±¥Œ¹ÁÉ•Á…É•}¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±” (€€€Á}É•ÅÕ•ÍÑ}¥UU%°(€€€Á}Í•ÍÍ¥½¹}¥UU%°(€€€Á}…Ñ½É}¥UU%°(€€€Á}¹•Ý}Í¡•‘Õ±•‘}…ÐQ%5MQ5AQh(¤)IQUI9LÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}½Á•É…Ñ¥½¹Ì)19UÁ±ÁÍÅ°)MUI%Qd%9H)MPÍ•…É¡}Á…Ñ €ô€œœ)L€)1I(€€€É•ÅÕ•ÍÑ•‘}…ÐQ%5MQ5AQh€èô‘…Ñ•}ÑÉÕ¹Œ Í•½¹œ°±½­}Ñ¥µ•ÍÑ…µÀ ¤¤ì(€€€•á¥ÍÑ¥¹}½Á•É…Ñ¥½¸ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}½Á•É…Ñ¥½¹Ì•I=]QeAì(€€€½Á•É…Ñ¥½¹}É½ÜÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}½Á•É…Ñ¥½¹Ì•I=]QeAì(€€€Í•ÍÍ¥½¹}É½ÜÁÕ‰±¥Œ¹Í•ÍÍ¥½¹Ì•I=]QeAì(€€€ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½ÜÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹Ì•I=]QeAì(€€€å±•}É½ÜÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}å±•Ì•I=]QeAì(€€€‰¥±±¥¹}É½ÜÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}‰¥±±¥¹}ÍÑ…Ñ”•I=]QeAì(€€€…±±½…Ñ¥½¹}É½ÜÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}Ý••­±å}…±±½…Ñ¥½¹Ì•I=]QeAì(€€€…Ñ½É}É½±”ÁÕ‰±¥Œ¹ÕÍ•É}É½±”ì(€€€ÁÉ½Ù¥Í¥½¹…±}…¹¡½È	==18ì(€€€Ñ…É•Ñ}±½…°Q%5MQ5@ì(€€€Ñ…É•Ñ}±½…±}‘…Ñ”Qì(€€€Ñ…É•Ñ}¥¹‘•àM511%9Pì(€€€Ñ…É•Ñ}…ÐQ%5MQ5AQhì(€€€ÁÉ•Ù¥½ÕÍ}Í¡•‘Õ±•‘}…ÐQ%5MQ5AQhì(€€€¹•áÑ}Í¡•‘Õ±•‘}…ÐQ%5MQ5AQhì)	%8(€€€%Á}É•ÅÕ•ÍÑ}¥%L9U10(€€€€€€=HÁ}Í•ÍÍ¥½¹}¥%L9U10(€€€€€€=HÁ}…Ñ½É}¥%L9U10(€€€€€€=HÁ}¹•Ý}Í¡•‘Õ±•‘}…Ð%L9U10(€€€€€€=H9=PÁ}…Ñ…±½œ¹¥Í™¥¹¥Ñ”¡Á}¹•Ý}Í¡•‘Õ±•‘}…Ð¤(€€€€€€=H‘…Ñ•}ÑÉÕ¹Œ Í•½¹œ°Á}¹•Ý}Í¡•‘Õ±•‘}…Ð¤%L%MQ%9PI=4Á}¹•Ý}Í¡•‘Õ±•‘}…ÐQ!8(€€€€€€€I%MaAQ%=8€¥¹Ù…±¥‘}¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}É•ÅÕ•ÍÐœ(€€€€€€€€€€€UM%9II=€ô€œÈÈÀÈÌœì(€€€9%ì((€€€AI=I4Á}…Ñ…±½œ¹Á}…‘Ù¥Í½Éå}á…Ñ}±½¬ (€€€€€€€Á}…Ñ…±½œ¹¡…Í¡Ñ•áÑ•áÑ•¹‘•¡Á}É•ÅÕ•ÍÑ}¥èéQaP°€ÐÈàÔÌ¤(€€€€¤ì((€€€M1P€¨%9Q<•á¥ÍÑ¥¹}½Á•É…Ñ¥½¸(€€€I=4ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}½Á•É…Ñ¥½¹ÌL½Á•É…Ñ¥½¸(€€€]!I½Á•É…Ñ¥½¸¹É•ÅÕ•ÍÑ}¥€ôÁ}É•ÅÕ•ÍÑ}¥(€€€=HUAQì((€€€%=U9Q!8(€€€€€€€%I=\ (€€€€€€€€€€€•á¥ÍÑ¥¹}½Á•É…Ñ¥½¸¹Í•ÍÍ¥½¹}¥°(€€€€€€€€€€€•á¥ÍÑ¥¹}½Á•É…Ñ¥½¸¹…Ñ½É}¥°(€€€€€€€€€€€•á¥ÍÑ¥¹}½Á•É…Ñ¥½¸¹¹•Ý}Í¡•‘Õ±•‘}…Ð(€€€€€€€€¤%L%MQ%9PI=4I=\ (€€€€€€€€€€€Á}Í•ÍÍ¥½¹}¥°(€€€€€€€€€€€Á}…Ñ½É}¥°(€€€€€€€€€€€Á}¹•Ý}Í¡•‘Õ±•‘}…Ð(€€€€€€€€¤Q!8(€€€€€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}É•ÅÕ•ÍÑ}½¹™±¥ÑÌœ(€€€€€€€€€€€€€€€UM%9II=€ô€œÈÌÔÀÔœì(€€€€€€€9%ì(€€€€€€€IQUI8•á¥ÍÑ¥¹}½Á•É…Ñ¥½¸ì(€€€9%ì((€€€M1P€¨%9Q<Í•ÍÍ¥½¹}É½Ü(€€€I=4ÁÕ‰±¥Œ¹Í•ÍÍ¥½¹ÌLÑ…É•Ñ}Í•ÍÍ¥½¸(€€€]!IÑ…É•Ñ}Í•ÍÍ¥½¸¹¥€ôÁ}Í•ÍÍ¥½¹}¥(€€€€€9a%MQL€ (€€€€€€€€€€€M1P€ÄI=4ÁÉ¥Ù…Ñ”¹¡•­½ÕÑ}ØÉ}•™™•Ñ¥Ù•}å±•}Í•ÍÍ¥½¹Ì¡Ñ…É•Ñ}Í•ÍÍ¥½¸¹¡•­½ÕÑ}ØÉ}å±•}¥¤L•™™•Ñ¥Ù•}Í•ÍÍ¥½¸(€€€€€€€€€€€]!I•™™•Ñ¥Ù•}Í•ÍÍ¥½¸¹¥€ôÑ…É•Ñ}Í•ÍÍ¥½¸¹¥(€€€€€€¤ì((€€€%Í•ÍÍ¥½¹}É½Ü¹¥%L9U10Q!8(€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}Í•ÍÍ¥½¹}¹½Ñ}™½Õ¹œ(€€€€€€€€€€€UM%9II=€ô€@ÀÀÀÈœì(€€€9%ì((€€€AI=I4Á}…Ñ…±½œ¹Á}…‘Ù¥Í½Éå}á…Ñ}±½¬ (€€€€€€€Á}…Ñ…±½œ¹¡…Í¡Ñ•áÑ•áÑ•¹‘•¡Í•ÍÍ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥èéQaP°€ÐÈàÔÐ¤(€€€€¤ì((€€€UAQÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}½Á•É…Ñ¥½¹Ì(€€€MP(€€€€€€€ÍÑ…ÑÕÌ€ô€™…¥±•œ°(€€€€€€€±…ÍÑ}•ÉÉ½È€ô€•áÁ¥É•‘}‰•™½É•}ÍÑÉ¥Á•}µÕÑ…Ñ¥½¸œ°(€€€€€€€ÕÁ‘…Ñ•‘}…Ð€ôÉ•ÅÕ•ÍÑ•‘}…Ð(€€€]!IÍÕ‰ÍÉ¥ÁÑ¥½¹}¥€ôÍ•ÍÍ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥(€€€€€9ÍÑ…ÑÕÌ€ô€É•ÅÕ•ÍÑ•œ(€€€€€9ÍÑÉ¥Á•}µÕÑ…Ñ¥½¹}ÍÑ…ÉÑ•‘}…Ð%L9U10(€€€€€9É•…Ñ•‘}…Ð€ðôÉ•ÅÕ•ÍÑ•‘}…Ð€´%9QIY0€œÄÔµ¥¹ÕÑ•Ìœì(((€€€%Í•ÍÍ¥½¹}É½Ü¹Ñ•…¡•É}¥%L9=P9U10Q!8(€€€€€€€AI=I4Á}…Ñ…±½œ¹Á}…‘Ù¥Í½Éå}á…Ñ}±½¬ (€€€€€€€€€€€Á}…Ñ…±½œ¹¡…Í¡Ñ•áÑ•áÑ•¹‘•¡Í•ÍÍ¥½¹}É½Ü¹Ñ•…¡•É}¥èéQaP°€ÐÈàÔÀ¤(€€€€€€€€¤ì(€€€9%ì((€€€M1P€¨%9Q<ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü(€€€I=4ÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹ÌLÑ…É•Ñ}ÍÕ‰ÍÉ¥ÁÑ¥½¸(€€€]!IÑ…É•Ñ}ÍÕ‰ÍÉ¥ÁÑ¥½¸¹¥€ôÍ•ÍÍ¥½¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥(€€€=HUAQì((€€€M1P€¨%9Q<‰¥±±¥¹}É½Ü(€€€I=4ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}‰¥±±¥¹}ÍÑ…Ñ”L‰¥±±¥¹œ(€€€]!I‰¥±±¥¹œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥€ôÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹¥(€€€=HUAQì((€€€M1P€¨%9Q<å±•}É½Ü(€€€I=4ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}å±•ÌLå±”(€€€]!Iå±”¹¥€ôÍ•ÍÍ¥½¹}É½Ü¹¡•­½ÕÑ}ØÉ}å±•}¥(€€€=HUAQì((€€€M1P€¨%9Q<…±±½…Ñ¥½¹}É½Ü(€€€I=4ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}Ý••­±å}…±±½…Ñ¥½¹ÌL…±±½…Ñ¥½¸(€€€]!I…±±½…Ñ¥½¸¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥€ôÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹¥(€€€€€9…±±½…Ñ¥½¸¹ÍÑ…ÑÕÌ€ô€…Ñ¥Ù”œ(€€€=HUAQì((€€€AI=I4€Ä(€€€I=4ÁÕ‰±¥Œ¹Í•ÍÍ¥½¹ÌLå±•}Í•ÍÍ¥½¸(€€€]!Iå±•}Í•ÍÍ¥½¸¹¡•­½ÕÑ}ØÉ}å±•}¥€ôå±•}É½Ü¹¥(€€€=IH	d(€€€€€€€å±•}Í•ÍÍ¥½¸¹¡•­½ÕÑ}ØÉ}å±•}Í•ÍÍ¥½¹}¥¹‘•à°(€€€€€€€å±•}Í•ÍÍ¥½¸¹É•…Ñ•‘}…Ð°(€€€€€€€å±•}Í•ÍÍ¥½¸¹¥(€€€=HUAQì((€€€M1P€¨%9Q<Í•ÍÍ¥½¹}É½Ü(€€€I=4ÁÕ‰±¥Œ¹Í•ÍÍ¥½¹ÌLÑ…É•Ñ}Í•ÍÍ¥½¸(€€€]!IÑ…É•Ñ}Í•ÍÍ¥½¸¹¥€ôÁ}Í•ÍÍ¥½¹}¥(€€€€€9a%MQL€ (€€€€€€€€€€€M1P€ÄI=4ÁÉ¥Ù…Ñ”¹¡•­½ÕÑ}ØÉ}•™™•Ñ¥Ù•}å±•}Í•ÍÍ¥½¹Ì¡Ñ…É•Ñ}Í•ÍÍ¥½¸¹¡•­½ÕÑ}ØÉ}å±•}¥¤L•™™•Ñ¥Ù•}Í•ÍÍ¥½¸(€€€€€€€€€€€]!I•™™•Ñ¥Ù•}Í•ÍÍ¥½¸¹¥€ôÑ…É•Ñ}Í•ÍÍ¥½¸¹¥(€€€€€€¤(€€€=HUAQì((€€€M1PÁÉ½™¥±”¹É½±”%9Q<…Ñ½É}É½±”(€€€I=4ÁÕ‰±¥Œ¹ÁÉ½™¥±•ÌLÁÉ½™¥±”(€€€]!IÁÉ½™¥±”¹¥€ôÁ}…Ñ½É}¥ì((€€€%a%MQL€ (€€€€€€€M1P€Ä(€€€€€€€I=4ÁÕ‰±¥Œ¹¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}½Á•É…Ñ¥½¹ÌLÁ•¹‘¥¹}½Á•É…Ñ¥½¸(€€€€€€€]!IÁ•¹‘¥¹}½Á•É…Ñ¥½¸¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥€ôÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹¥(€€€€€€€€€9Á•¹‘¥¹}½Á•É…Ñ¥½¸¹ÍÑ…ÑÕÌ%8€ É•ÅÕ•ÍÑ•œ°€µ…¹Õ…±}É•Ù¥•Üœ¤(€€€€¤Q!8(€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}ÍÕ‰ÍÉ¥ÁÑ¥½¹}¡…Í}Á•¹‘¥¹}½Á•É…Ñ¥½¸œ(€€€€€€€€€€€UM%9II=€ô€œÈÌÔÀÔœì(€€€9%ì((€€€%…Ñ½É}É½±”%L9U10(€€€€€€=H9=P€ (€€€€€€€€€€€…Ñ½É}É½±”€ô€…‘µ¥¸œèéÁÕ‰±¥Œ¹ÕÍ•É}É½±”(€€€€€€€€€€€=HÁ}…Ñ½É}¥€ôÍ•ÍÍ¥½¹}É½Ü¹ÍÑÕ‘•¹Ñ}¥(€€€€€€€¤Q!8(€€€€€€€I%MaAQ%=8€¡•­½ÕÑ}ØÉ}É•Í¡•‘Õ±•}™½É‰¥‘‘•¸œ(€€€€€€€€€€€UM%9II=€ô€œÐÈÔÀÄœì(€€€9%ì((€€€%ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹¥%L9U10(€€€€€€=HÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹½¹ÑÉ…Ñ}Í¡•µ…}Ù•ÉÍ¥½¸%L%MQ%9PI=4€È(€€€€€€=HÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹ÍÑ…ÑÕÌ9=P%8€ (€€€€€€€€€€€€…Ñ¥Ù”œèéÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…ÑÕÌ°(€€€€€€€€€€€€Á…ÕÍ•œèéÁÕ‰±¥Œ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}ÍÑ…ÑÕÌ(€€€€€€€¤(€€€€€€=H‰¥±±¥¹}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥%L9U10(€€€€€€=Hå±•}É½Ü¹¥%L9U10(€€€€€€=Hå±•}É½Ü¹ÍÕ‰ÍÉ¥ÁÑ¥½¹}¥%L%MQ%9PI=4ÍÕ‰ÍÉ¥ÁÑ¥½¹}É½Ü¹¥(€€€€€€=Hå±•}É½Ü¹µ…Ñ•É¥…±¥é…Ñ¥½¹}ÍÑ…Ñ”%L%MQ%9PI=4€É•…‘äœ(€€€€€€=H…±±½…Ñ¥½¹}É½Ü¹¥%L9U10(€€€€€€=HÍ•ÍÍ¥½¹}É½Ü¹Ñ•…¡•É}¥%L%MQ%9PI=4…±±½…Ñ¥½¹}É½Ü