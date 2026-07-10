-- Ensure direct profile self-updates cannot mutate role or profile email.
-- Staging was missing the trigger entirely, and production still had the older
-- role-only trigger body. Keep the trigger function out of the public/exposed
-- schema so it is not a callable Data API surface.
CREATE SCHEMA IF NOT EXISTS private;

DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;
DROP FUNCTION IF EXISTS public.protect_profile_role();

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
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION private.protect_profile_role();
