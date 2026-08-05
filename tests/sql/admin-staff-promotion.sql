\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    (
        '99500000-0000-4000-8000-000000000001',
        'promotion-owner@example.test',
        clock_timestamp(),
        '{"full_name":"Promotion Owner","adult_confirmed":true,"age_policy_version":"2026-07-10"}'::JSONB
    ),
    (
        '99500000-0000-4000-8000-000000000002',
        'promotion-candidate@example.test',
        clock_timestamp(),
        '{"full_name":"Promotion Candidate","adult_confirmed":true,"age_policy_version":"2026-07-10"}'::JSONB
    ),
    (
        '99500000-0000-4000-8000-000000000003',
        'promotion-other@example.test',
        clock_timestamp(),
        '{"full_name":"Other Candidate","adult_confirmed":true,"age_policy_version":"2026-07-10"}'::JSONB
    ),
    (
        '99500000-0000-4000-8000-000000000004',
        'promotion-unverified@example.test',
        NULL,
        '{"full_name":"Unverified Candidate","adult_confirmed":true,"age_policy_version":"2026-07-10"}'::JSONB
    ),
    (
        '99500000-0000-4000-8000-000000000005',
        'promotion-incomplete@example.test',
        clock_timestamp(),
        '{"full_name":"Incomplete Candidate"}'::JSONB
    ),
    (
        '99500000-0000-4000-8000-000000000006',
        'promotion-dirty@example.test',
        clock_timestamp(),
        '{"full_name":"Dirty Candidate","adult_confirmed":true,"age_policy_version":"2026-07-10"}'::JSONB
    );

ALTER TABLE public.profiles
    DISABLE TRIGGER guard_managed_profile_role_transition_trigger;
UPDATE public.profiles
SET role = 'admin'::public.user_role
WHERE id = '99500000-0000-4000-8000-000000000001';
ALTER TABLE public.profiles
    ENABLE TRIGGER guard_managed_profile_role_transition_trigger;

INSERT INTO public.admin_role_assignments (profile_id, access_role, granted_by)
VALUES ('99500000-0000-4000-8000-000000000001', 'owner', NULL);

DO $$
BEGIN
    IF has_function_privilege(
        'anon',
        'public.promote_admin_profile(uuid,uuid,public.admin_access_role,uuid,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.promote_admin_profile(uuid,uuid,public.admin_access_role,uuid,text)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.promote_admin_profile(uuid,uuid,public.admin_access_role,uuid,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'admin promotion grants are incorrect';
    END IF;

    IF to_regclass('public.admin_audit_log_staff_invitation_request_key') IS NULL
       OR to_regclass('public.admin_audit_log_admin_promotion_request_key') IS NULL THEN
        RAISE EXCEPTION 'staff request idempotency indexes are missing';
    END IF;
END
$$;

SET LOCAL ROLE service_role;

DO $$
BEGIN
    BEGIN
        UPDATE public.profiles
        SET role = 'admin'::public.user_role
        WHERE id = '99500000-0000-4000-8000-000000000002';
        RAISE EXCEPTION 'direct profile promotion was accepted';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.promote_admin_profile(
            '99510000-0000-4000-8000-000000000001',
            '99500000-0000-4000-8000-000000000002',
            'viewer',
            '99500000-0000-4000-8000-000000000002',
            'Unauthorized actor must fail'
        );
        RAISE EXCEPTION 'unauthorized promotion was accepted';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.promote_admin_profile(
            '99510000-0000-4000-8000-000000000002',
            '99500000-0000-4000-8000-000000000004',
            'viewer',
            '99500000-0000-4000-8000-000000000001',
            'Unverified identity must fail'
        );
        RAISE EXCEPTION 'unverified promotion was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        PERFORM public.promote_admin_profile(
            '99510000-0000-4000-8000-000000000003',
            '99500000-0000-4000-8000-000000000005',
            'viewer',
            '99500000-0000-4000-8000-000000000001',
            'Incomplete profile must fail'
        );
        RAISE EXCEPTION 'incomplete promotion was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;
END
$$;

RESET ROLE;

INSERT INTO public.payments (student_id, amount, status, description)
VALUES (
    '99500000-0000-4000-8000-000000000006',
    25900,
    'succeeded',
    'Student dependency for promotion contract'
);

SET LOCAL ROLE service_role;

DO $$
DECLARE
    first_result JSONB;
    replay_result JSONB;
BEGIN
    BEGIN
        PERFORM public.promote_admin_profile(
            '99510000-0000-4000-8000-000000000004',
            '99500000-0000-4000-8000-000000000006',
            'viewer',
            '99500000-0000-4000-8000-000000000001',
            'Student dependency must fail'
        );
        RAISE EXCEPTION 'dependent student promotion was accepted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    first_result := public.promote_admin_profile(
        '99510000-0000-4000-8000-000000000005',
        '99500000-0000-4000-8000-000000000002',
        'viewer',
        '99500000-0000-4000-8000-000000000001',
        'Initial administrator access'
    );
    IF first_result ->> 'changed' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'first promotion did not report a change';
    END IF;

    replay_result := public.promote_admin_profile(
        '99510000-0000-4000-8000-000000000005',
        '99500000-0000-4000-8000-000000000002',
        'viewer',
        '99500000-0000-4000-8000-000000000001',
        'Initial administrator access'
    );
    IF replay_result ->> 'changed' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'exact promotion replay was not idempotent';
    END IF;

    BEGIN
        PERFORM public.promote_admin_profile(
            '99510000-0000-4000-8000-000000000005',
            '99500000-0000-4000-8000-000000000003',
            'viewer',
            '99500000-0000-4000-8000-000000000001',
            'Initial administrator access'
        );
        RAISE EXCEPTION 'promotion request id was reused for another profile';
    EXCEPTION
        WHEN serialization_failure THEN NULL;
    END;
END
$$;

RESET ROLE;

DO $$
BEGIN
    IF (SELECT role FROM public.profiles
        WHERE id = '99500000-0000-4000-8000-000000000002')
        IS DISTINCT FROM 'admin'::public.user_role THEN
        RAISE EXCEPTION 'candidate was not promoted';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_role_assignments
        WHERE profile_id = '99500000-0000-4000-8000-000000000002'
          AND access_role = 'viewer'
          AND granted_by = '99500000-0000-4000-8000-000000000001'
    ) THEN
        RAISE EXCEPTION 'initial access assignment was not recorded';
    END IF;

    IF (SELECT COUNT(*)
        FROM public.admin_audit_log
        WHERE action = 'admin_access.promote'
          AND entity_id = '99500000-0000-4000-8000-000000000002'
          AND after ->> 'request_id' = '99510000-0000-4000-8000-000000000005') <> 1 THEN
        RAISE EXCEPTION 'promotion audit is missing or duplicated';
    END IF;
END
$$;

ROLLBACK;
