-- =============================================
-- ESPAÑOL HONESTO - DATABASE SCHEMA
-- =============================================

-- 1. ENUM TYPES
CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
CREATE TYPE subscription_status AS ENUM ('active', 'paused', 'cancelled', 'expired', 'pending');
CREATE TYPE payment_status AS ENUM ('succeeded', 'pending', 'failed', 'refunded');

-- 2. PROFILES (extends auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role user_role DEFAULT 'student',
    preferred_language TEXT DEFAULT 'es' CHECK (preferred_language IN ('es', 'en', 'ru')),
    phone TEXT,
    timezone TEXT DEFAULT 'Europe/Madrid',
    drive_folder_id TEXT, -- Google Drive folder for this user
    stripe_customer_id TEXT UNIQUE,
    notes TEXT, -- Internal notes (visible to teachers/admin)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PACKAGES (the 3 plans)
CREATE TABLE packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL, -- 'essential', 'intensive', 'premium'
    display_name JSONB NOT NULL, -- {"es": "Esencial", "en": "Essential", "ru": "Базовый"}
    price_monthly INTEGER NOT NULL, -- Price in cents (16000 = €160)
    sessions_per_month INTEGER NOT NULL,
    has_group_session BOOLEAN DEFAULT FALSE,
    has_dual_teacher BOOLEAN DEFAULT FALSE,
    stripe_product_id TEXT,
    stripe_price_1m TEXT, -- Price ID for 1 month
    stripe_price_3m TEXT, -- Price ID for 3 months (10% off)
    stripe_price_6m TEXT, -- Price ID for 6 months (20% off)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SUBSCRIPTIONS
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES packages(id),
    status subscription_status DEFAULT 'pending',
    duration_months INTEGER NOT NULL CHECK (duration_months IN (1, 3, 6)),
    starts_at DATE NOT NULL,
    ends_at DATE NOT NULL,
    sessions_total INTEGER NOT NULL, -- Total sessions for the subscription period
    sessions_used INTEGER DEFAULT 0,
    stripe_subscription_id TEXT,
    stripe_invoice_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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
    duration_minutes INTEGER DEFAULT 60,
    meet_link TEXT,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    teacher_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Session lifecycle tracking
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id),
    cancellation_reason TEXT
);

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
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id);
CREATE INDEX idx_subscriptions_student ON subscriptions(student_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_sessions_student ON sessions(student_id);
CREATE INDEX idx_sessions_teacher ON sessions(teacher_id);
CREATE INDEX idx_sessions_scheduled ON sessions(scheduled_at);
CREATE INDEX idx_payments_student ON payments(student_id);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile" 
    ON profiles FOR SELECT 
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
    ON profiles FOR UPDATE 
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Teachers can view their students" 
    ON profiles FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM student_teachers st 
            WHERE st.teacher_id = auth.uid() 
            AND st.student_id = profiles.id
        )
    );

CREATE POLICY "Students can view their teachers" 
    ON profiles FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM student_teachers st 
            WHERE st.student_id = auth.uid() 
            AND st.teacher_id = profiles.id
        )
    );

CREATE POLICY "Admins can do everything on profiles" 
    ON profiles FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- PACKAGES POLICIES (public read)
CREATE POLICY "Anyone can view active packages" 
    ON packages FOR SELECT 
    USING (is_active = TRUE);

CREATE POLICY "Admins can manage packages" 
    ON packages FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- SUBSCRIPTIONS POLICIES
CREATE POLICY "Students can view own subscriptions" 
    ON subscriptions FOR SELECT 
    USING (student_id = auth.uid());

CREATE POLICY "Teachers can view assigned student subscriptions" 
    ON subscriptions FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM student_teachers st 
            WHERE st.teacher_id = auth.uid() 
            AND st.student_id = subscriptions.student_id
        )
    );

CREATE POLICY "Admins can manage subscriptions" 
    ON subscriptions FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- SESSIONS POLICIES
CREATE POLICY "Students can view own sessions" 
    ON sessions FOR SELECT 
    USING (student_id = auth.uid());

CREATE POLICY "Teachers can view and update assigned sessions" 
    ON sessions FOR ALL 
    USING (teacher_id = auth.uid())
    WITH CHECK (
        teacher_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM student_teachers st 
            WHERE st.teacher_id = auth.uid() 
            AND st.student_id = sessions.student_id
        )
    );

CREATE POLICY "Admins can manage sessions" 
    ON sessions FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- PAYMENTS POLICIES
CREATE POLICY "Students can view own payments" 
    ON payments FOR SELECT 
    USING (student_id = auth.uid());

CREATE POLICY "Admins can manage payments" 
    ON payments FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- STUDENT_TEACHERS POLICIES
CREATE POLICY "Students can see their teachers" 
    ON student_teachers FOR SELECT 
    USING (student_id = auth.uid());

CREATE POLICY "Teachers can see their students" 
    ON student_teachers FOR SELECT 
    USING (teacher_id = auth.uid());

CREATE POLICY "Admins can manage assignments" 
    ON student_teachers FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM profiles 
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- =============================================
-- FUNCTIONS & TRIGGERS
-- =============================================

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
-- SEED DATA: PACKAGES
-- =============================================
INSERT INTO packages (name, display_name, price_monthly, sessions_per_month, has_group_session, has_dual_teacher) VALUES
('essential', '{"es": "Esencial", "en": "Essential", "ru": "Базовый"}', 16000, 4, FALSE, FALSE),
('intensive', '{"es": "Intensivo", "en": "Intensive", "ru": "Интенсивный"}', 28000, 7, TRUE, FALSE),
('premium', '{"es": "Premium", "en": "Premium", "ru": "Премиум"}', 30000, 4, FALSE, TRUE);
