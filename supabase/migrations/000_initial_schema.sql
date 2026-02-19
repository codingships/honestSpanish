-- =============================================
-- INITIAL SCHEMA
-- Exported from Supabase dashboard — 2026-02-19
-- Run this BEFORE any other migration file.
-- =============================================


-- =============================================
-- ENUMS
-- =============================================

CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');

CREATE TYPE subscription_status AS ENUM ('pending', 'active', 'paused', 'cancelled', 'expired');

CREATE TYPE payment_status AS ENUM ('succeeded', 'pending', 'failed', 'refunded');


-- =============================================
-- HELPER FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================
-- TABLES
-- =============================================

-- packages (product catalog — no RLS needed for reads, admin manages)
CREATE TABLE packages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    display_name        JSONB NOT NULL,
    price_monthly       INTEGER NOT NULL,
    sessions_per_month  INTEGER NOT NULL,
    has_group_session   BOOLEAN DEFAULT FALSE,
    has_dual_teacher    BOOLEAN DEFAULT FALSE,
    stripe_product_id   TEXT,
    stripe_price_1m     TEXT,
    stripe_price_3m     TEXT,
    stripe_price_6m     TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- profiles (one row per auth.users user)
CREATE TABLE profiles (
    id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email               TEXT NOT NULL,
    full_name           TEXT,
    role                user_role DEFAULT 'student',
    preferred_language  TEXT DEFAULT 'es',
    phone               TEXT,
    timezone            TEXT DEFAULT 'Europe/Madrid',
    drive_folder_id     TEXT,
    stripe_customer_id  TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- subscriptions
CREATE TABLE subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id              UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    package_id              UUID NOT NULL REFERENCES packages(id),
    status                  subscription_status DEFAULT 'pending',
    duration_months         INTEGER NOT NULL,
    starts_at               DATE NOT NULL,
    ends_at                 DATE NOT NULL,
    sessions_total          INTEGER NOT NULL,
    sessions_used           INTEGER DEFAULT 0,
    stripe_subscription_id  TEXT,
    stripe_invoice_id       TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- payments
CREATE TABLE payments (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    subscription_id             UUID REFERENCES subscriptions(id),
    amount                      INTEGER NOT NULL,
    currency                    TEXT DEFAULT 'eur',
    status                      payment_status DEFAULT 'pending',
    stripe_payment_intent_id    TEXT,
    stripe_invoice_id           TEXT,
    description                 TEXT,
    created_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- sessions (class bookings)
CREATE TABLE sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES profiles(id),
    teacher_id          UUID REFERENCES profiles(id),
    scheduled_at        TIMESTAMPTZ,
    duration_minutes    INTEGER DEFAULT 60,
    meet_link           TEXT,
    status              TEXT DEFAULT 'scheduled',
    teacher_notes       TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancelled_by        UUID REFERENCES profiles(id),
    cancellation_reason TEXT
);

-- student_teachers (many-to-many assignment)
CREATE TABLE student_teachers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    teacher_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    is_primary  BOOLEAN DEFAULT TRUE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (student_id, teacher_id)
);


-- =============================================
-- TRIGGERS (updated_at)
-- =============================================

CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- =============================================
-- INDEXES
-- =============================================

CREATE INDEX idx_sessions_student_id  ON sessions(student_id);
CREATE INDEX idx_sessions_teacher_id  ON sessions(teacher_id);
CREATE INDEX idx_sessions_scheduled   ON sessions(scheduled_at);
CREATE INDEX idx_sessions_status      ON sessions(status);
CREATE INDEX idx_subscriptions_student ON subscriptions(student_id);
CREATE INDEX idx_subscriptions_status  ON subscriptions(status);
CREATE INDEX idx_payments_student      ON payments(student_id);


-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE packages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_teachers  ENABLE ROW LEVEL SECURITY;

-- packages
CREATE POLICY "Anyone can view active packages"
    ON packages FOR SELECT
    USING (is_active = TRUE);

CREATE POLICY "Admins can manage packages"
    ON packages FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- profiles
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Teachers can view their students"
    ON profiles FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM student_teachers st
        WHERE st.teacher_id = auth.uid() AND st.student_id = profiles.id
    ));

CREATE POLICY "Admins can do everything on profiles"
    ON profiles FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Trigger to prevent role escalation (applied after policies)
CREATE OR REPLACE FUNCTION prevent_role_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'No se puede cambiar el rol directamente';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER prevent_role_change_trigger
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION prevent_role_change();

-- subscriptions
CREATE POLICY "Students can view own subscriptions"
    ON subscriptions FOR SELECT
    USING (student_id = auth.uid());

CREATE POLICY "Teachers can view assigned student subscriptions"
    ON subscriptions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM student_teachers st
        WHERE st.teacher_id = auth.uid() AND st.student_id = subscriptions.student_id
    ));

CREATE POLICY "Admins can manage subscriptions"
    ON subscriptions FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- payments
CREATE POLICY "Students can view own payments"
    ON payments FOR SELECT
    USING (student_id = auth.uid());

CREATE POLICY "Admins can manage payments"
    ON payments FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- sessions
CREATE POLICY "Students can view own sessions"
    ON sessions FOR SELECT
    USING (student_id = auth.uid());

CREATE POLICY "Teachers can view assigned sessions"
    ON sessions FOR SELECT
    USING (teacher_id = auth.uid());

CREATE POLICY "Teachers can update assigned sessions"
    ON sessions FOR UPDATE
    USING (teacher_id = auth.uid())
    WITH CHECK (teacher_id = auth.uid());

CREATE POLICY "Admins can manage sessions"
    ON sessions FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- student_teachers
CREATE POLICY "Students can see their teachers"
    ON student_teachers FOR SELECT
    USING (student_id = auth.uid());

CREATE POLICY "Teachers can see their students"
    ON student_teachers FOR SELECT
    USING (teacher_id = auth.uid());

CREATE POLICY "Admins can manage assignments"
    ON student_teachers FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
