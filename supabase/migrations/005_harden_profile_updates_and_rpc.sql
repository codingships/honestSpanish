-- =============================================
-- HARDEN PROFILE UPDATES AND PRIVATE RPC ACCESS
-- =============================================
--
-- Goals:
-- 1. Prevent authenticated users from mutating internal-only profile fields
--    through direct Supabase API access.
-- 2. Keep legitimate server-side flows working by allowing service_role/admin.
-- 3. Prevent public/authenticated clients from calling get_available_slots()
--    directly and bypassing application-level ownership checks.

-- Restrict the slot RPC to trusted server-side callers only.
REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, date, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_available_slots(uuid, date, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, date, integer) TO service_role;

-- Policies introduced by the next migrations need this helper before the
-- launch-catalog migration historically re-declared it. Keep the bootstrap
-- chain executable from an empty database; migration 016 later moves the
-- hardened implementation to the private schema.
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

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO service_role;

-- Consolidate profile protection in a single trigger.
DROP TRIGGER IF EXISTS prevent_role_change_trigger ON public.profiles;
DROP TRIGGER IF EXISTS no_role_escalation ON public.profiles;
DROP TRIGGER IF EXISTS no_stripe_id_change ON public.profiles;
DROP TRIGGER IF EXISTS protect_profile_internal_fields_trigger ON public.profiles;

CREATE OR REPLACE FUNCTION public.protect_profile_internal_fields()
RETURNS TRIGGER AS $$
BEGIN
    -- Service role and SQL editor bypass: trusted server-side writes.
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- Admins can manage internal fields.
    IF is_admin() THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Cannot modify role';
    END IF;

    IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
        RAISE EXCEPTION 'Cannot modify stripe_customer_id';
    END IF;

    IF NEW.drive_folder_id IS DISTINCT FROM OLD.drive_folder_id THEN
        RAISE EXCEPTION 'Cannot modify drive_folder_id';
    END IF;

    IF NEW.notes IS DISTINCT FROM OLD.notes THEN
        RAISE EXCEPTION 'Cannot modify notes';
    END IF;

    IF NEW.current_level IS DISTINCT FROM OLD.current_level THEN
        RAISE EXCEPTION 'Cannot modify current_level';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER protect_profile_internal_fields_trigger
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.protect_profile_internal_fields();
