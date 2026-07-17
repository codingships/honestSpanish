-- User metadata is mutable and is used only as one-time signup input. Accept
-- an adult attestation only when its version exactly matches the current legal
-- policy, then persist the server-controlled timestamp and canonical version.
CREATE OR REPLACE FUNCTION public.handle_new_user()
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

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
