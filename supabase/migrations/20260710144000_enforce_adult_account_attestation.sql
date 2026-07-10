ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS adult_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS adult_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS age_policy_version TEXT;

COMMENT ON COLUMN public.profiles.adult_confirmed IS 'Server-persisted self-attestation that the account holder is at least 18.';
COMMENT ON COLUMN public.profiles.adult_confirmed_at IS 'Server timestamp, or validated lead timestamp, for the adult self-attestation.';
COMMENT ON COLUMN public.profiles.age_policy_version IS 'Age-policy version associated with the persisted adult self-attestation.';

-- Preserve existing accounts only when a prior database lead attestation can
-- be matched to the same email. Email allowlists and environment names are not
-- accepted as evidence of age.
WITH lead_attestations AS (
    SELECT
        lower(lead.email) AS email_key,
        max(lead.adult_confirmed_at) AS adult_confirmed_at,
        max(lead.age_policy_version) FILTER (WHERE lead.age_policy_version IS NOT NULL) AS age_policy_version
    FROM public.leads AS lead
    WHERE lead.adult_confirmed = TRUE
    GROUP BY lower(lead.email)
)
UPDATE public.profiles AS profile
SET adult_confirmed = TRUE,
    adult_confirmed_at = COALESCE(attestation.adult_confirmed_at, clock_timestamp()),
    age_policy_version = COALESCE(attestation.age_policy_version, 'legacy-lead-attestation')
FROM lead_attestations AS attestation
WHERE lower(profile.email) = attestation.email_key
  AND profile.adult_confirmed = FALSE;

-- The current registration UI already records an explicit boolean in Auth
-- metadata. Copy that existing evidence once into the server-controlled
-- profile row; mutable user metadata is never consulted for runtime access.
UPDATE public.profiles AS profile
SET adult_confirmed = TRUE,
    adult_confirmed_at = clock_timestamp(),
    age_policy_version = COALESCE(
        NULLIF(auth_user.raw_user_meta_data->>'age_policy_version', ''),
        'legacy-auth-attestation'
    )
FROM auth.users AS auth_user
WHERE profile.id = auth_user.id
  AND profile.adult_confirmed = FALSE
  AND COALESCE(auth_user.raw_user_meta_data->'adult_confirmed' = 'true'::jsonb, FALSE);

ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_adult_attestation_complete;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_adult_attestation_complete
    CHECK (
        (adult_confirmed = FALSE AND adult_confirmed_at IS NULL AND age_policy_version IS NULL)
        OR
        (
            adult_confirmed = TRUE
            AND adult_confirmed_at IS NOT NULL
            AND NULLIF(btrim(age_policy_version), '') IS NOT NULL
        )
    ) NOT VALID;

ALTER TABLE public.profiles
    VALIDATE CONSTRAINT profiles_adult_attestation_complete;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_adult_confirmed BOOLEAN;
BEGIN
    v_adult_confirmed := COALESCE(
        NEW.raw_user_meta_data->'adult_confirmed' = 'true'::jsonb,
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
        CASE
            WHEN v_adult_confirmed THEN COALESCE(
                NULLIF(NEW.raw_user_meta_data->>'age_policy_version', ''),
                'unversioned-auth-attestation'
            )
            ELSE NULL
        END
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

-- Direct Data API profile updates must not be able to manufacture the
-- server-persisted evidence. This check runs before the admin bypass used for
-- ordinary role/profile administration; trusted writes go through service_role.
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

DROP TRIGGER IF EXISTS protect_profile_role_trigger ON public.profiles;
CREATE TRIGGER protect_profile_role_trigger
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION private.protect_profile_role();
