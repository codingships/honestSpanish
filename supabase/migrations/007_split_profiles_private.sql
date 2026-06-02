-- =============================================
-- SPLIT PRIVATE PROFILE DATA + ENFORCE UNIQUENESS
-- =============================================
--
-- Goals:
-- 1. Move internal-only profile fields out of public.profiles.
-- 2. Keep those fields accessible only through service_role or explicit admin access.
-- 3. Enforce the business invariants the app previously assumed via `.single()`.

CREATE TABLE IF NOT EXISTS public.profiles_private (
    profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    stripe_customer_id TEXT,
    drive_folder_id TEXT,
    notes TEXT,
    current_level TEXT DEFAULT 'A2',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND column_name = 'stripe_customer_id'
    ) THEN
        INSERT INTO public.profiles_private (
            profile_id,
            stripe_customer_id,
            drive_folder_id,
            notes,
            current_level,
            created_at,
            updated_at
        )
        SELECT
            id,
            stripe_customer_id,
            drive_folder_id,
            notes,
            COALESCE(current_level, 'A2'),
            COALESCE(created_at, NOW()),
            COALESCE(updated_at, NOW())
        FROM public.profiles
        ON CONFLICT (profile_id) DO UPDATE
        SET
            stripe_customer_id = COALESCE(public.profiles_private.stripe_customer_id, EXCLUDED.stripe_customer_id),
            drive_folder_id = COALESCE(public.profiles_private.drive_folder_id, EXCLUDED.drive_folder_id),
            notes = COALESCE(public.profiles_private.notes, EXCLUDED.notes),
            current_level = COALESCE(public.profiles_private.current_level, EXCLUDED.current_level),
            updated_at = GREATEST(public.profiles_private.updated_at, EXCLUDED.updated_at);
    ELSE
        INSERT INTO public.profiles_private (profile_id, created_at, updated_at)
        SELECT
            id,
            COALESCE(created_at, NOW()),
            COALESCE(updated_at, NOW())
        FROM public.profiles
        ON CONFLICT (profile_id) DO NOTHING;
    END IF;
END $$;

ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage profiles_private" ON public.profiles_private;
CREATE POLICY "Admins can manage profiles_private"
    ON public.profiles_private FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

DROP TRIGGER IF EXISTS update_profiles_private_updated_at ON public.profiles_private;
CREATE TRIGGER update_profiles_private_updated_at
    BEFORE UPDATE ON public.profiles_private
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'profiles_private_stripe_customer_unique'
    ) THEN
        CREATE UNIQUE INDEX profiles_private_stripe_customer_unique
            ON public.profiles_private (stripe_customer_id)
            WHERE stripe_customer_id IS NOT NULL;
    END IF;
END $$;

DROP TRIGGER IF EXISTS protect_profile_internal_fields_trigger ON public.profiles;
DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;
DROP TRIGGER IF EXISTS protect_role_escalation ON public.profiles;
DROP TRIGGER IF EXISTS prevent_role_escalation_trigger ON public.profiles;
DROP TRIGGER IF EXISTS prevent_role_change_trigger ON public.profiles;

CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF is_admin() THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Cannot modify role';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER protect_profile_role_trigger
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

DROP FUNCTION IF EXISTS public.protect_profile_internal_fields();
DROP FUNCTION IF EXISTS public.prevent_stripe_id_escalation();
DROP FUNCTION IF EXISTS public.prevent_role_escalation();
DROP FUNCTION IF EXISTS public.prevent_role_change();

DROP INDEX IF EXISTS public.idx_profiles_stripe_customer;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_customer_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS drive_folder_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS notes;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS current_level;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles_private (profile_id)
    VALUES (NEW.id)
    ON CONFLICT (profile_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'subscriptions_one_active_per_student'
    ) THEN
        CREATE UNIQUE INDEX subscriptions_one_active_per_student
            ON public.subscriptions (student_id)
            WHERE status = 'active'::public.subscription_status;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'student_teachers_one_primary_teacher_per_student'
    ) THEN
        CREATE UNIQUE INDEX student_teachers_one_primary_teacher_per_student
            ON public.student_teachers (student_id)
            WHERE is_primary = TRUE;
    END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.session_tstzrange(start_at timestamptz, dur_min integer)
RETURNS tstzrange
LANGUAGE sql IMMUTABLE
AS $$ SELECT tstzrange(start_at, start_at + (dur_min * interval '1 minute')); $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'no_overlapping_teacher_sessions'
          AND conrelid = 'public.sessions'::regclass
    ) THEN
        ALTER TABLE public.sessions
        ADD CONSTRAINT no_overlapping_teacher_sessions
        EXCLUDE USING gist (
            teacher_id WITH =,
            public.session_tstzrange(scheduled_at, duration_minutes) WITH &&
        )
        WHERE (status <> 'cancelled');
    END IF;
END $$;
