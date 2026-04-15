-- =============================================================
-- CRITICAL: Prevent role escalation via direct REST API
-- A student can currently PATCH their own profile to set role='admin'
-- because the RLS policy only checks ownership, not column restrictions.
-- =============================================================

-- Trigger: blocks any role change by non-admins
CREATE OR REPLACE FUNCTION prevent_role_escalation()
RETURNS TRIGGER AS $$
BEGIN
    -- Bypass para la Service Role Key y el Supabase SQL Dashboard
    IF auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role AND NOT is_admin() THEN
        RAISE EXCEPTION 'Cannot change role without admin privileges';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER no_role_escalation
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();

-- Also protect stripe_customer_id from being set by non-admins
CREATE OR REPLACE FUNCTION prevent_stripe_id_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id AND NOT is_admin() THEN
        RAISE EXCEPTION 'Cannot modify stripe_customer_id';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER no_stripe_id_change
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION prevent_stripe_id_escalation();
