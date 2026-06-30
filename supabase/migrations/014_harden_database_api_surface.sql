-- Harden unused database API surfaces reported by Supabase advisors.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'graphql'
          AND p.proname = 'resolve'
          AND pg_get_function_identity_arguments(p.oid) = 'query text, variables jsonb, "operationName" text, extensions jsonb'
    ) THEN
        REVOKE EXECUTE ON FUNCTION graphql.resolve(text, jsonb, text, jsonb) FROM anon;
        REVOKE EXECUTE ON FUNCTION graphql.resolve(text, jsonb, text, jsonb) FROM authenticated;
        REVOKE EXECUTE ON FUNCTION graphql.resolve(text, jsonb, text, jsonb) FROM public;
    END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'protect_profile_role'
          AND pg_get_function_identity_arguments(p.oid) = ''
    ) THEN
        REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM anon;
        REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM authenticated;
        REVOKE EXECUTE ON FUNCTION public.protect_profile_role() FROM public;
        GRANT EXECUTE ON FUNCTION public.protect_profile_role() TO service_role;
    END IF;
END $$;

ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.session_tstzrange(timestamptz, integer) SET search_path = public;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'get_available_slots'
          AND pg_get_function_identity_arguments(p.oid) = 'p_teacher_id uuid, p_date date, p_duration_minutes integer'
    ) THEN
        ALTER FUNCTION public.get_available_slots(uuid, date, integer) SET search_path = public;
    END IF;
END $$;
