\set ON_ERROR_STOP on

BEGIN;

-- Fixtures bypass signup/role-transition triggers only while they are created.
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
    ('99300000-0000-4000-8000-000000000001', 'owner@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000002', 'editor@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000003', 'erasable@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000004', 'student@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000005', 'operator@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000006', 'viewer@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000007', 'finance@example.test', clock_timestamp()),
    ('99300000-0000-4000-8000-000000000008', 'content@example.test', clock_timestamp());
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
    ),
    (
        '99300000-0000-4000-8000-000000000005',
        'operator@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99300000-0000-4000-8000-000000000006',
        'viewer@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99300000-0000-4000-8000-000000000007',
        'finance@example.test',
        'admin',
        TRUE,
        clock_timestamp(),
        'test'
    ),
    (
        '99300000-0000-4000-8000-000000000008',
        'content@example.test',
        'admin',
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

INSERT INTO public.packages (
    id,
    name,
    display_name,
    price_monthly,
    sessions_per_month,
    is_active,
    is_publicly_listed
) VALUES (
    '99400000-0000-4000-8000-000000000001',
    'admin-access-private-package',
    '{"es":"Paquete privado de prueba"}'::JSONB,
    25900,
    4,
    FALSE,
    FALSE
);

INSERT INTO public.leads (id, email, name) VALUES (
    '99400000-0000-4000-8000-000000000002',
    'rls-lead@example.test',
    'RLS lead'
);

INSERT INTO public.payments (
    id,
    student_id,
    amount,
    status,
    description
) VALUES (
    '99400000-0000-4000-8000-000000000003',
    '99300000-0000-4000-8000-000000000004',
    25900,
    'succeeded',
    'RLS payment'
);

INSERT INTO public.support_tickets (
    id,
    user_id,
    issue_type,
    issue_title,
    message
) VALUES (
    '99400000-0000-4000-8000-000000000004',
    '99300000-0000-4000-8000-000000000004',
    'other',
    'RLS support ticket',
    'Support ticket created for the admin capability contract.'
);

INSERT INTO public.support_ticket_events (
    ticket_id,
    sequence,
    actor_id,
    event_type,
    visibility,
    body
) VALUES (
    '99400000-0000-4000-8000-000000000004',
    2,
    '99300000-0000-4000-8000-000000000001',
    'internal_note',
    'internal',
    'Internal RLS note'
);

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
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000005',
    'operator'
);
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000006',
    'viewer'
);
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000007',
    'finance'
);
SELECT public.admin_grant_access_role(
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000008',
    'content_editor'
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

-- The database itself enforces the same domains as the application. These
-- checks deliberately use authenticated sessions against the Data API surface.
DO $$
DECLARE
    exposed_admin_functions TEXT[];
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND (
              COALESCE(policy.qual, '') ILIKE '%private.is_admin%'
              OR COALESCE(policy.with_check, '') ILIKE '%private.is_admin%'
          )
    ) THEN
        RAISE EXCEPTION 'legacy_all_admin_rls_policy_remains';
    END IF;

    IF pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(
            'private.protect_profile_role()'::REGPROCEDURE
        ),
        'private.is_admin'
    ) > 0 THEN
        RAISE EXCEPTION 'profile_role_guard_still_bypasses_for_admins';
    END IF;

    SELECT pg_catalog.array_agg(
        pg_catalog.format('%I.%I', namespace.nspname, routine.proname)
        ORDER BY routine.proname
    )
    INTO exposed_admin_functions
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
      AND routine.proname LIKE 'admin\_%' ESCAPE '\'
      AND pg_catalog.has_function_privilege(
          'authenticated',
          routine.oid,
          'EXECUTE'
      );

    IF exposed_admin_functions IS NOT NULL THEN
        RAISE EXCEPTION 'authenticated_admin_rpc_surface_is_exposed: %',
            exposed_admin_functions;
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
    visible_count INTEGER;
    changed_count INTEGER;
BEGIN
    SELECT count(*) INTO visible_count
    FROM public.packages
    WHERE id = '99400000-0000-4000-8000-000000000001';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'catalog_editor_cannot_read_private_package';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.leads
    WHERE id = '99400000-0000-4000-8000-000000000002';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'catalog_editor_can_read_operations_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.payments
    WHERE id = '99400000-0000-4000-8000-000000000003';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'catalog_editor_can_read_finance_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.admin_audit_log;
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'catalog_editor_can_read_access_history';
    END IF;

    BEGIN
        UPDATE public.packages
        SET price_monthly = 26000
        WHERE id = '99400000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'catalog_editor_can_bypass_managed_catalog_rpc';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    UPDATE public.leads
    SET name = 'Forbidden catalog edit'
    WHERE id = '99400000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count <> 0 THEN
        RAISE EXCEPTION 'catalog_editor_can_write_operations_data';
    END IF;
END
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000005',
    TRUE
);
DO $$
DECLARE
    visible_count INTEGER;
    changed_count INTEGER;
BEGIN
    SELECT count(*) INTO visible_count
    FROM public.leads
    WHERE id = '99400000-0000-4000-8000-000000000002';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'operator_cannot_read_operations_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.packages
    WHERE id = '99400000-0000-4000-8000-000000000001';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'operator_can_read_private_catalog_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.payments
    WHERE id = '99400000-0000-4000-8000-000000000003';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'operator_can_read_finance_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.support_ticket_events
    WHERE ticket_id = '99400000-0000-4000-8000-000000000004'
      AND visibility = 'internal';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'operator_cannot_read_internal_support_history';
    END IF;

    UPDATE public.leads
    SET name = 'Operator edit'
    WHERE id = '99400000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count <> 1 THEN
        RAISE EXCEPTION 'operator_cannot_write_operations_data';
    END IF;

    BEGIN
        UPDATE public.profiles
        SET role = 'teacher'
        WHERE id = '99300000-0000-4000-8000-000000000004';
        RAISE EXCEPTION 'profile_role_update_not_blocked';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM NOT IN (
                'Cannot modify role',
                'profile_role_requires_managed_activation'
            ) THEN
                RAISE;
            END IF;
    END;
END
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000006',
    TRUE
);
DO $$
DECLARE
    visible_count INTEGER;
    changed_count INTEGER;
BEGIN
    SELECT count(*) INTO visible_count
    FROM public.packages
    WHERE id = '99400000-0000-4000-8000-000000000001';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'viewer_cannot_read_catalog_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.leads
    WHERE id = '99400000-0000-4000-8000-000000000002';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'viewer_cannot_read_operations_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.payments
    WHERE id = '99400000-0000-4000-8000-000000000003';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'viewer_cannot_read_finance_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.admin_audit_log;
    IF visible_count < 1 THEN
        RAISE EXCEPTION 'viewer_cannot_read_access_history';
    END IF;

    BEGIN
        UPDATE public.packages
        SET price_monthly = 27000
        WHERE id = '99400000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'viewer_can_bypass_managed_catalog_rpc';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    DELETE FROM public.leads
    WHERE id = '99400000-0000-4000-8000-000000000002';
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count <> 0 THEN
        RAISE EXCEPTION 'viewer_can_delete_operations_data';
    END IF;
END
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000007',
    TRUE
);
DO $$
DECLARE
    visible_count INTEGER;
    changed_count INTEGER;
BEGIN
    SELECT count(*) INTO visible_count
    FROM public.payments
    WHERE id = '99400000-0000-4000-8000-000000000003';
    IF visible_count <> 1 THEN
        RAISE EXCEPTION 'finance_admin_cannot_read_finance_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.leads
    WHERE id = '99400000-0000-4000-8000-000000000002';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'finance_admin_can_read_operations_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.packages
    WHERE id = '99400000-0000-4000-8000-000000000001';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'finance_admin_can_read_private_catalog_data';
    END IF;

    UPDATE public.payments
    SET description = 'Finance edit'
    WHERE id = '99400000-0000-4000-8000-000000000003';
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    IF changed_count <> 1 THEN
        RAISE EXCEPTION 'finance_admin_cannot_write_finance_data';
    END IF;
END
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000008',
    TRUE
);
DO $$
DECLARE
    visible_count INTEGER;
BEGIN
    SELECT count(*) INTO visible_count
    FROM public.packages
    WHERE id = '99400000-0000-4000-8000-000000000001';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'content_editor_can_read_private_catalog_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.leads
    WHERE id = '99400000-0000-4000-8000-000000000002';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'content_editor_can_read_operations_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.payments
    WHERE id = '99400000-0000-4000-8000-000000000003';
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'content_editor_can_read_finance_data';
    END IF;

    SELECT count(*) INTO visible_count
    FROM public.admin_audit_log;
    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'content_editor_can_read_access_history';
    END IF;
END
$$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '99300000-0000-4000-8000-000000000004',
    TRUE
);
DO $$
DECLARE
    public_count INTEGER;
    internal_count INTEGER;
BEGIN
    SELECT count(*) INTO public_count
    FROM public.support_ticket_events
    WHERE ticket_id = '99400000-0000-4000-8000-000000000004'
      AND visibility = 'public';
    SELECT count(*) INTO internal_count
    FROM public.support_ticket_events
    WHERE ticket_id = '99400000-0000-4000-8000-000000000004'
      AND visibility = 'internal';

    IF public_count <> 1 OR internal_count <> 0 THEN
        RAISE EXCEPTION 'student_support_history_visibility_is_wrong: public %, internal %',
            public_count,
            internal_count;
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
