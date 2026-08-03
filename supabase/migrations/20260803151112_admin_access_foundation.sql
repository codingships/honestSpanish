-- Granular administrator access without changing the academic user-role model.
-- Existing administrators are promoted to owner exactly once so deployment is
-- backward-compatible. All later changes go through service-only, audited RPCs.

CREATE TYPE public.admin_access_role AS ENUM (
    'owner',
    'content_editor',
    'catalog_editor',
    'operator',
    'finance',
    'viewer'
);

CREATE TYPE public.admin_capability AS ENUM (
    'dashboard.read',
    'content.read',
    'content.write',
    'catalog.read',
    'catalog.write',
    'operations.read',
    'operations.write',
    'finance.read',
    'finance.write',
    'access.read',
    'access.write'
);

CREATE TABLE public.admin_role_assignments (
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    access_role public.admin_access_role NOT NULL,
    granted_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    PRIMARY KEY (profile_id, access_role)
);

CREATE INDEX admin_role_assignments_role_profile_idx
    ON public.admin_role_assignments(access_role, profile_id);

ALTER TABLE public.admin_role_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_role_assignments
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_role_assignments TO service_role;

INSERT INTO public.admin_role_assignments (
    profile_id,
    access_role,
    granted_by
)
SELECT
    profile.id,
    'owner'::public.admin_access_role,
    NULL
FROM public.profiles AS profile
WHERE profile.role = 'admin'::public.user_role
ON CONFLICT (profile_id, access_role) DO NOTHING;

CREATE OR REPLACE FUNCTION private.admin_role_has_capability(
    p_access_role public.admin_access_role,
    p_capability public.admin_capability
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT CASE p_access_role
        WHEN 'owner'::public.admin_access_role THEN TRUE
        WHEN 'viewer'::public.admin_access_role THEN p_capability IN (
            'dashboard.read'::public.admin_capability,
            'content.read'::public.admin_capability,
            'catalog.read'::public.admin_capability,
            'operations.read'::public.admin_capability,
            'finance.read'::public.admin_capability,
            'access.read'::public.admin_capability
        )
        WHEN 'content_editor'::public.admin_access_role THEN p_capability IN (
            'content.read'::public.admin_capability,
            'content.write'::public.admin_capability
        )
        WHEN 'catalog_editor'::public.admin_access_role THEN p_capability IN (
            'catalog.read'::public.admin_capability,
            'catalog.write'::public.admin_capability
        )
        WHEN 'operator'::public.admin_access_role THEN p_capability IN (
            'operations.read'::public.admin_capability,
            'operations.write'::public.admin_capability
        )
        WHEN 'finance'::public.admin_access_role THEN p_capability IN (
            'finance.read'::public.admin_capability,
            'finance.write'::public.admin_capability
        )
        ELSE FALSE
    END
$$;

CREATE OR REPLACE FUNCTION private.admin_has_capability(
    p_profile_id UUID,
    p_capability public.admin_capability
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        JOIN public.admin_role_assignments AS assignment
          ON assignment.profile_id = profile.id
        WHERE profile.id = p_profile_id
          AND profile.role = 'admin'::public.user_role
          AND private.admin_role_has_capability(
              assignment.access_role,
              p_capability
          )
    )
$$;

CREATE OR REPLACE FUNCTION public.has_my_admin_capability(
    p_capability public.admin_capability
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        private.admin_has_capability(auth.uid(), p_capability),
        FALSE
    )
$$;

CREATE OR REPLACE FUNCTION public.get_my_admin_capabilities()
RETURNS SETOF public.admin_capability
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT capability
    FROM pg_catalog.unnest(
        pg_catalog.enum_range(NULL::public.admin_capability)
    ) AS capability
    WHERE private.admin_has_capability(auth.uid(), capability)
    ORDER BY capability::TEXT
$$;

CREATE OR REPLACE FUNCTION public.admin_grant_access_role(
    p_actor_id UUID,
    p_profile_id UUID,
    p_access_role public.admin_access_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_role public.user_role;
    assignment_created BOOLEAN := FALSE;
BEGIN
    IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_access_role IS NULL THEN
        RAISE EXCEPTION 'admin_access_invalid_grant'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_profile_id::TEXT, 58175)
    );

    IF NOT private.admin_has_capability(
        p_actor_id,
        'access.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'admin_access_forbidden'
            USING ERRCODE = '42501';
    END IF;

    SELECT profile.role
    INTO target_role
    FROM public.profiles AS profile
    WHERE profile.id = p_profile_id
    FOR UPDATE;

    IF target_role IS DISTINCT FROM 'admin'::public.user_role THEN
        RAISE EXCEPTION 'admin_access_target_must_be_admin'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.admin_role_assignments (
        profile_id,
        access_role,
        granted_by
    ) VALUES (
        p_profile_id,
        p_access_role,
        p_actor_id
    )
    ON CONFLICT (profile_id, access_role) DO NOTHING;
    assignment_created := FOUND;

    IF assignment_created THEN
        INSERT INTO public.admin_audit_log (
            admin_id,
            action,
            entity_type,
            entity_id,
            before,
            after
        ) VALUES (
            p_actor_id,
            'admin_access.grant',
            'admin_access',
            p_profile_id::TEXT,
            NULL,
            pg_catalog.jsonb_build_object('access_role', p_access_role)
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'changed', assignment_created,
        'profile_id', p_profile_id,
        'access_role', p_access_role
    );
END
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_access_role(
    p_actor_id UUID,
    p_profile_id UUID,
    p_access_role public.admin_access_role
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    assignment_removed BOOLEAN := FALSE;
    owner_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR p_profile_id IS NULL OR p_access_role IS NULL THEN
        RAISE EXCEPTION 'admin_access_invalid_revoke'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('admin-access-owners', 58175)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_profile_id::TEXT, 58175)
    );

    IF NOT private.admin_has_capability(
        p_actor_id,
        'access.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'admin_access_forbidden'
            USING ERRCODE = '42501';
    END IF;

    IF p_access_role = 'owner'::public.admin_access_role
       AND EXISTS (
           SELECT 1
           FROM public.admin_role_assignments AS assignment
           WHERE assignment.profile_id = p_profile_id
             AND assignment.access_role = 'owner'::public.admin_access_role
       ) THEN
        SELECT count(*)::INTEGER
        INTO owner_count
        FROM public.admin_role_assignments AS assignment
        JOIN public.profiles AS profile ON profile.id = assignment.profile_id
        WHERE assignment.access_role = 'owner'::public.admin_access_role
          AND profile.role = 'admin'::public.user_role;

        IF owner_count <= 1 THEN
            RAISE EXCEPTION 'admin_access_last_owner'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    DELETE FROM public.admin_role_assignments
    WHERE profile_id = p_profile_id
      AND access_role = p_access_role;
    assignment_removed := FOUND;

    IF assignment_removed THEN
        INSERT INTO public.admin_audit_log (
            admin_id,
            action,
            entity_type,
            entity_id,
            before,
            after
        ) VALUES (
            p_actor_id,
            'admin_access.revoke',
            'admin_access',
            p_profile_id::TEXT,
            pg_catalog.jsonb_build_object('access_role', p_access_role),
            NULL
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'changed', assignment_removed,
        'profile_id', p_profile_id,
        'access_role', p_access_role
    );
END
$$;

CREATE OR REPLACE FUNCTION private.guard_admin_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    -- Preserve the existing ON DELETE SET NULL contract for administrator
    -- profile erasure. Only the nested foreign-key action may pseudonymize the
    -- actor; every direct update and every content change remains forbidden.
    IF TG_OP = 'UPDATE'
       AND pg_catalog.pg_trigger_depth() > 1
       AND OLD.admin_id IS NOT NULL
       AND NEW.admin_id IS NULL
       AND (
           pg_catalog.to_jsonb(NEW) - 'admin_id'
       ) = (
           pg_catalog.to_jsonb(OLD) - 'admin_id'
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'admin_audit_log_is_immutable'
        USING ERRCODE = '23514';
END
$$;

CREATE TRIGGER guard_admin_audit_log_immutable_trigger
    BEFORE UPDATE OR DELETE ON public.admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION private.guard_admin_audit_log_immutable();

REVOKE ALL ON FUNCTION private.admin_role_has_capability(
    public.admin_access_role,
    public.admin_capability
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.admin_has_capability(
    UUID,
    public.admin_capability
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.guard_admin_audit_log_immutable()
    FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_my_admin_capability(
    public.admin_capability
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_my_admin_capability(
    public.admin_capability
) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_admin_capabilities()
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_admin_capabilities()
    TO authenticated;

REVOKE ALL ON FUNCTION public.admin_grant_access_role(
    UUID,
    UUID,
    public.admin_access_role
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_access_role(
    UUID,
    UUID,
    public.admin_access_role
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_revoke_access_role(
    UUID,
    UUID,
    public.admin_access_role
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_access_role(
    UUID,
    UUID,
    public.admin_access_role
) TO service_role;

COMMENT ON TABLE public.admin_role_assignments IS
    'Server-managed, cumulative operational roles for profiles whose academic role is admin.';
COMMENT ON FUNCTION public.has_my_admin_capability(public.admin_capability) IS
    'Returns only whether the authenticated user owns one requested administrative capability.';
COMMENT ON FUNCTION public.get_my_admin_capabilities() IS
    'Returns the effective administrative capabilities of only the authenticated user.';
COMMENT ON FUNCTION public.admin_grant_access_role(
    UUID,
    UUID,
    public.admin_access_role
) IS 'Idempotently grants one administrative role and records an immutable audit event.';
COMMENT ON FUNCTION public.admin_revoke_access_role(
    UUID,
    UUID,
    public.admin_access_role
) IS 'Idempotently revokes one administrative role, preserving at least one owner, and records an immutable audit event.';
