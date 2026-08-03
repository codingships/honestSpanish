\set ON_ERROR_STOP on

BEGIN;

-- Fixtures bypass signup/role-transition triggers only while they are created.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('99300000-0000-4000-8000-000000000001', 'owner@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000002', 'editor@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000003', 'erasable@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000004', 'student@example.test', clock_timestamp());
INSERT INTO public.profiles (
    id,
    email,
    role,
    adult_confirmed,
    adult_confirmed_at,
    age_policy_version
) VALUES
    (
        '99300000-0000-4000-8000-000000000001',
        'owner@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99300000-0000-4000-8000-000000000002',
        'editor@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99300000-0000-4000-8000-000000000003',
        'erasable@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99300000-0000-4000-8000-000000000004',
        'student@example.test',
        'student',
        TRUE,
        clock_timestamp(),
        'test'
    );
INSERT INTO public.admin_role_assignments (
    profile_id,
    access_role,
    granted_by
) VALUES (
    '99300000-0000-4000-8000-000000000001',
    'owner',
    NULL
);
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
    IF NOT private.admin_has_capability(
        '99300000-0000-4000-8000-000000000001',
        'access.write'
    ) THEN
        RAISE EXCEPTION 'owner_does_not_have_access_write';
    END IF;

    IF private.admin_has_capability(
        '99300000-0000-4000-8000-000000000002',
        'catalog.read'
    ) THEN
        RAISE EXCEPTION 'unassigned_admin_has_capability';
    END IF;

    IF private.admin_has_capability(
        '99300000-0000-4000-8000-000000000004',
        'dashboard.read'
    ) THEN
        RAISE EXCEPTION 'student_has_admin_capability';
    END IF;
END
$$;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000001',
    TRUE
);
DO $$
BEGIN
    IF NOT public.has_my_admin_capability('access.write') THEN
        RAISE EXCEPTION 'authenticated_owner_capability_lookup_failed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.get_my_admin_capabilities() AS capability
        WHERE capability = 'access.write'::public.admin_capability
    ) THEN
        RAISE EXCEPTION 'authenticated_owner_capability_list_failed';
    END IF;
END
$$;
RESET ROLE;

DO $$
BEGIN
    IF has_function_privilege(
        'authenticated',
        'public.admin_grant_access_role(uuid,uuid,public.admin_access_role)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'authenticated_can_execute_admin_access_mutation';
    END IF;
END
$$;

SET LOCAL ROLE service_role;
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    'catalog_editor'
);
RESET ROLE;

DO $$
BEGIN
    IF NOT private.admin_has_capability(
        '99300000-0000-4000-8000-000000000002',
        'catalog.write'
    ) OR private.admin_has_capability(
        '99300000-0000-4000-8000-000000000002',
        'finance.read'
    ) OR private.admin_has_capability(
        '99300000-0000-4000-8000-000000000002',
        'dashboard.read'
    ) THEN
        RAISE EXCEPTION 'catalog_editor_capability_map_is_wrong';
    END IF;

    IF (
        SELECT count(*)
        FROM public.admin_audit_log
        WHERE action = 'admin_access.grant'
          AND entity_id = '99300000-0000-4000-8000-000000000002'
    ) <> 1 THEN
        RAISE EXCEPTION 'catalog_editor_grant_audit_is_wrong';
    END IF;
END
$$;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000002',
    TRUE
);
DO $$
DECLARE
    capabilities public.admin_capability[];
BEGIN
    SELECT pg_catalog.array_agg(capability ORDER BY capability::TEXT)
    INTO capabilities
    FROM public.get_my_admin_capabilities() AS capability;

    IF capabilities IS DISTINCT FROM ARRAY[
        'catalog.read'::public.admin_capability,
        'catalog.write'::public.admin_capability
    ] THEN
        RAISE EXCEPTION 'catalog_editor_self_capability_list_is_wrong: %', capabilities;
    END IF;
END
$$;
RESET ROLE;

-- Repeating an already satisfied grant converges without another audit row.
SET LOCAL ROLE service_role;
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    'catalog_editor'
);
RESET ROLE;

DO $$
BEGIN
    IF (
        SELECT count(*)
        FROM public.admin_audit_log
        WHERE action = 'admin_access.grant'
          AND entity_id = '99300000-0000-4000-8000-000000000002'
          AND after ->> 'access_role' = 'catalog_editor'
    ) <> 1 THEN
        RAISE EXCEPTION 'repeated_grant_is_not_idempotent';
    END IF;
END
$$;

-- The sole owner cannot be removed.
DO $$
BEGIN
    PERFORM public.admin_revoke_access_role(
        '99300000-0000-4000-8000-000000000001',
        '99300000-0000-4000-8000-000000000001',
        'owner'
    );
    RAISE EXCEPTION 'last_owner_revoke_was_not_rejected';
EXCEPTION
    WHEN SQLSTATE '23514' THEN
        IF SQLERRM <> 'admin_access_last_owner' THEN
            RAISE;
        END IF;
END
$$;

SET LOCAL ROLE service_role;
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    'owner'
);
SELECT public.admin_revoke_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000001',
    'owner'
);
RESET ROLE;

DO $$
BEGIN
    IF private.admin_has_capability(
        '99300000-0000-4000-8000-000000000001',
        'access.write'
    ) OR NOT private.admin_has_capability(
        '99300000-0000-4000-8000-000000000002',
        'access.write'
    ) THEN
        RAISE EXCEPTION 'owner_handoff_did_not_change_authority';
    END IF;

    BEGIN
        UPDATE public.admin_audit_log
        SET action = 'tampered'
        WHERE action = 'admin_access.grant';
        RAISE EXCEPTION 'audit_update_was_not_rejected';
    EXCEPTION
        WHEN SQLSTATE '23514' THEN
            IF SQLERRM <> 'admin_audit_log_is_immutable' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        DELETE FROM public.admin_audit_log
        WHERE action = 'admin_access.grant';
        RAISE EXCEPTION 'audit_delete_was_not_rejected';
    EXCEPTION
        WHEN SQLSTATE '23514' THEN
            IF SQLERRM <> 'admin_audit_log_is_immutable' THEN
                RAISE;
            END IF;
    END;
END
$$;

-- Profile erasure may still pseudonymize only admin_id through its existing
-- foreign-key action; the historical event and every other field remain.
INSERT INTO public.admin_audit_log (
    admin_id,
    action,
    entity_type,
    entity_id
) VALUES (
    '99300000-0000-4000-8000-000000000003',
    'pseudonymization.test',
    'admin_access_test',
    '99300000-0000-4000-8000-000000000003'
);
DELETE FROM public.profiles
WHERE id = '99300000-0000-4000-8000-000000000003';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_audit_log
        WHERE action = 'pseudonymization.test'
          AND entity_id = '99300000-0000-4000-8000-000000000003'
          AND admin_id IS NULL
    ) THEN
        RAISE EXCEPTION 'profile_erasure_did_not_pseudonymize_audit_actor';
    END IF;
END
$$;

ROLLBACK;
