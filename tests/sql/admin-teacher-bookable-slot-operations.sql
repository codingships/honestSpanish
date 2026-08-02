\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

BEGIN;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    ('99200000-0000-4000-8000-000000000001', 'slot-admin@test.invalid', clock_timestamp(), '{}'::JSONB),
    ('99200000-0000-4000-8000-000000000002', 'slot-candidate@test.invalid', clock_timestamp(), '{}'::JSONB),
    ('99200000-0000-4000-8000-000000000003', 'slot-dirty@test.invalid', clock_timestamp(), '{}'::JSONB),
    ('99200000-0000-4000-8000-000000000004', 'slot-incomplete@test.invalid', clock_timestamp(), '{}'::JSONB),
    ('99200000-0000-4000-8000-000000000005', 'slot-unverified@test.invalid', NULL, '{}'::JSONB),
    ('99200000-0000-4000-8000-000000000006', 'slot-fulfillment@test.invalid', clock_timestamp(), '{}'::JSONB);

ALTER TABLE public.profiles
    DISABLE TRIGGER guard_managed_profile_role_transition_trigger;
UPDATE public.profiles
SET role = 'admin', full_name = 'Slot Admin'
WHERE id = '99200000-0000-4000-8000-000000000001';
ALTER TABLE public.profiles
    ENABLE TRIGGER guard_managed_profile_role_transition_trigger;

UPDATE public.profiles
SET
    full_name = CASE id
        WHEN '99200000-0000-4000-8000-000000000002'::UUID THEN 'Slot Candidate'
        WHEN '99200000-0000-4000-8000-000000000003'::UUID THEN 'Dirty Candidate'
        WHEN '99200000-0000-4000-8000-000000000004'::UUID THEN 'Incomplete Candidate'
        WHEN '99200000-0000-4000-8000-000000000005'::UUID THEN 'Unverified Candidate'
        ELSE 'Fulfillment Candidate'
    END,
    adult_confirmed = id <> '99200000-0000-4000-8000-000000000004'::UUID,
    adult_confirmed_at = CASE
        WHEN id <> '99200000-0000-4000-8000-000000000004'::UUID
            THEN clock_timestamp()
        ELSE NULL
    END,
    age_policy_version = CASE
        WHEN id <> '99200000-0000-4000-8000-000000000004'::UUID
            THEN '2026-07-10'
        ELSE NULL
    END
WHERE id IN (
    '99200000-0000-4000-8000-000000000002',
    '99200000-0000-4000-8000-000000000003',
    '99200000-0000-4000-8000-000000000004',
    '99200000-0000-4000-8000-000000000005',
    '99200000-0000-4000-8000-000000000006'
);

DO $$
DECLARE
    slot_guard_definition TEXT;
    availability_guard_definition TEXT;
    profile_link_guard_definition TEXT;
    activation_definition TEXT;
    early_lock_trigger_name TEXT;
    contract_trigger_name TEXT;
    slot_guard_trigger_count INTEGER;
    student_dependency_trigger_count INTEGER;
BEGIN
    IF has_function_privilege(
        'anon',
        'public.activate_teacher_profile(uuid,uuid,text,timestamptz,uuid,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.activate_teacher_profile(uuid,uuid,text,timestamptz,uuid,text)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.activate_teacher_profile(uuid,uuid,text,timestamptz,uuid,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'teacher activation grants are incorrect';
    END IF;

    IF has_function_privilege(
        'service_role',
        'public.create_bookable_slot(uuid,uuid,text,timestamptz[],uuid)',
        'EXECUTE'
    ) OR has_function_privilege(
        'service_role',
        'public.publish_bookable_slot(uuid,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'raw slot mutation RPCs remain executable by service_role';
    END IF;

    IF NOT has_function_privilege(
        'service_role',
        'public.admin_create_bookable_slot(uuid,uuid,uuid,text,timestamptz[],uuid,text)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.admin_transition_bookable_slot(uuid,uuid,text,uuid,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'managed slot RPC grants are missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
        'private.guard_bookable_slot_teacher_engagement()'::regprocedure
    ) INTO slot_guard_definition;
    SELECT pg_catalog.pg_get_functiondef(
        'private.guard_availability_covering_bookable_slots()'::regprocedure
    ) INTO availability_guard_definition;
    SELECT pg_catalog.pg_get_functiondef(
        'private.enforce_profile_role_links()'::regprocedure
    ) INTO profile_link_guard_definition;
    SELECT pg_catalog.pg_get_functiondef(
        'public.activate_teacher_profile(uuid,uuid,text,timestamptz,uuid,text)'::regprocedure
    ) INTO activation_definition;

    SELECT COUNT(DISTINCT class_row.relname)
    INTO student_dependency_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
    JOIN pg_catalog.pg_class AS class_row ON class_row.oid = trigger_row.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = class_row.relnamespace
    WHERE trigger_row.tgfoid = (
        'private.enforce_profile_role_links()'::regprocedure
    )::OID
      AND NOT trigger_row.tgisinternal
      AND namespace_row.nspname = 'public'
      AND class_row.relname IN (
          'student_teachers', 'sessions', 'subscriptions', 'payments',
          'fulfillment_jobs', 'checkout_intents'
      );

    SELECT COUNT(*), MIN(trigger_row.tgname)
    INTO slot_guard_trigger_count, early_lock_trigger_name
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.bookable_slots'::regclass
      AND trigger_row.tgfoid = (
          'private.guard_bookable_slot_teacher_engagement()'::regprocedure
      )::OID
      AND NOT trigger_row.tgisinternal;

    SELECT trigger_row.tgname
    INTO contract_trigger_name
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.bookable_slots'::regclass
      AND trigger_row.tgname = 'guard_bookable_slot_contract_trigger'
      AND NOT trigger_row.tgisinternal;

    IF slot_guard_trigger_count <> 1
       OR early_lock_trigger_name IS DISTINCT FROM
          'a_lock_and_guard_bookable_slot_teacher_engagement_trigger'
       OR contract_trigger_name IS NULL
       OR early_lock_trigger_name >= contract_trigger_name THEN
        RAISE EXCEPTION 'teacher lock trigger does not run before slot contract validation';
    END IF;

    IF position(
        'hashtextextended(NEW.teacher_id::TEXT, 58173)'
        IN slot_guard_definition
    ) = 0
       OR position(
           'hashtextextended(OLD.teacher_id::TEXT, 58173)'
           IN availability_guard_definition
       ) = 0
       OR position(
           'hashtextextended(first_teacher_id::TEXT, 58173)'
           IN availability_guard_definition
       ) = 0
       OR position(
           'hashtextextended(second_teacher_id::TEXT, 58173)'
           IN availability_guard_definition
       ) = 0 THEN
        RAISE EXCEPTION 'slot publication and availability do not share the teacher lock';
    END IF;

    IF student_dependency_trigger_count <> 6
       OR position(
           'hashtextextended(NEW.student_id::TEXT, 58174)'
           IN profile_link_guard_definition
       ) = 0
       OR position(
           'hashtextextended(p_profile_id::TEXT, 58174)'
           IN activation_definition
       ) = 0 THEN
        RAISE EXCEPTION 'teacher activation and student dependencies do not share the profile lock';
    END IF;
END;
$$;

SET LOCAL ROLE service_role;
DO $$
BEGIN
    BEGIN
        UPDATE public.profiles
        SET role = 'teacher'::public.user_role
        WHERE id = '99200000-0000-4000-8000-000000000002';
        RAISE EXCEPTION 'direct service-role profile promotion was accepted';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$$;
RESET ROLE;

SELECT public.activate_teacher_profile(
    '99210000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000002',
    'founder',
    date_trunc('second', clock_timestamp()) + INTERVAL '1 day',
    '99200000-0000-4000-8000-000000000001',
    'Initial founder activation for sellable slots'
) AS first_activation
\gset

SELECT public.activate_teacher_profile(
    '99210000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000002',
    'founder',
    (:'first_activation'::JSONB #>> '{engagement,effective_from}')::TIMESTAMPTZ,
    '99200000-0000-4000-8000-000000000001',
    'Initial founder activation for sellable slots'
);

DO $$
DECLARE
    profile_role public.user_role;
    engagement_count INTEGER;
    audit_count INTEGER;
BEGIN
    SELECT role INTO profile_role
    FROM public.profiles
    WHERE id = '99200000-0000-4000-8000-000000000002';

    SELECT COUNT(*) INTO engagement_count
    FROM public.teacher_compensation_engagements
    WHERE teacher_id = '99200000-0000-4000-8000-000000000002';

    SELECT COUNT(*) INTO audit_count
    FROM public.admin_audit_log
    WHERE action = 'activate_teacher_profile'
      AND entity_id = '99200000-0000-4000-8000-000000000002';

    IF profile_role IS DISTINCT FROM 'teacher'::public.user_role
       OR engagement_count <> 1
       OR audit_count <> 1 THEN
        RAISE EXCEPTION 'teacher activation was not atomic or idempotent';
    END IF;

    BEGIN
        PERFORM public.activate_teacher_profile(
            '99210000-0000-4000-8000-000000000001',
            '99200000-0000-4000-8000-000000000002',
            'founder',
            (SELECT effective_from FROM public.teacher_compensation_engagements
             WHERE teacher_id = '99200000-0000-4000-8000-000000000002'),
            '99200000-0000-4000-8000-000000000001',
            'Conflicting activation reason must fail'
        );
        RAISE EXCEPTION 'activation request conflict was accepted';
    EXCEPTION WHEN serialization_failure THEN
        NULL;
    END;

    BEGIN
        PERFORM public.activate_teacher_profile(
            '99210000-0000-4000-8000-000000000002',
            '99200000-0000-4000-8000-000000000004',
            'external',
            clock_timestamp(),
            '99200000-0000-4000-8000-000000000001',
            'Incomplete adult profile must fail activation'
        );
        RAISE EXCEPTION 'incomplete profile activation was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        PERFORM public.activate_teacher_profile(
            '99210000-0000-4000-8000-000000000004',
            '99200000-0000-4000-8000-000000000005',
            'external',
            clock_timestamp(),
            '99200000-0000-4000-8000-000000000001',
            'Unverified auth identity must fail activation'
        );
        RAISE EXCEPTION 'unverified auth identity activation was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

INSERT INTO public.student_teachers (student_id, teacher_id, is_primary)
VALUES (
    '99200000-0000-4000-8000-000000000003',
    '99200000-0000-4000-8000-000000000002',
    TRUE
);

DO $$
BEGIN
    BEGIN
        PERFORM public.activate_teacher_profile(
            '99210000-0000-4000-8000-000000000003',
            '99200000-0000-4000-8000-000000000003',
            'external',
            clock_timestamp(),
            '99200000-0000-4000-8000-000000000001',
            'Student dependency must block activation'
        );
        RAISE EXCEPTION 'student dependency activation was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

INSERT INTO public.fulfillment_jobs (job_type, student_id, payload)
VALUES (
    'welcome_fulfillment',
    '99200000-0000-4000-8000-000000000006',
    '{}'::JSONB
);

DO $$
BEGIN
    BEGIN
        PERFORM public.activate_teacher_profile(
            '99210000-0000-4000-8000-000000000005',
            '99200000-0000-4000-8000-000000000006',
            'external',
            clock_timestamp(),
            '99200000-0000-4000-8000-000000000001',
            'Fulfillment dependency must block activation'
        );
        RAISE EXCEPTION 'fulfillment dependency activation was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

SELECT id AS v2_package_id, catalog_version AS v2_catalog_version
FROM public.packages
WHERE name = 'individual_4x50_28d'
  AND contract_schema_version = 2
\gset

UPDATE public.packages
SET is_active = TRUE, is_publicly_listed = TRUE
WHERE id = :'v2_package_id'::UUID;

SELECT (public.activate_versioned_package_price(
    :'v2_package_id'::UUID,
    :'v2_catalog_version'::BIGINT,
    25900::INTEGER,
    'eur'::TEXT,
    'day'::TEXT,
    28::SMALLINT,
    4::INTEGER,
    50::SMALLINT,
    'acct_admin_slot_test'::TEXT,
    FALSE,
    'prod_admin_slot_test'::TEXT,
    'price_admin_slot_test'::TEXT,
    '99200000-0000-4000-8000-000000000001'::UUID
)).id AS package_price_id
\gset

SELECT public.register_checkout_v2_price_snapshot(
    :'package_price_id'::UUID,
    'acct_admin_slot_test',
    FALSE,
    'price_admin_slot_initial_test',
    'price_admin_slot_test'
);

SELECT (
    date_trunc(
        'week',
        pg_catalog.make_date(
            EXTRACT(YEAR FROM clock_timestamp() AT TIME ZONE 'Europe/Madrid')::INTEGER + 1,
            7,
            7
        )::TIMESTAMP
    ) + INTERVAL '10 hours'
)::TIMESTAMP AS first_local
\gset

INSERT INTO public.teacher_availability (
    teacher_id, day_of_week, start_time, end_time, is_active
) VALUES (
    '99200000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM :'first_local'::TIMESTAMP)::INTEGER,
    :'first_local'::TIMESTAMP::TIME,
    (:'first_local'::TIMESTAMP + INTERVAL '1 hour')::TIME,
    TRUE
) RETURNING id AS availability_id
\gset

SELECT slot.id AS slot_id
FROM public.admin_create_bookable_slot(
    '99220000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000002',
    :'v2_package_id'::UUID,
    'Europe/Madrid',
    ARRAY[
        :'first_local'::TIMESTAMP AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '7 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '14 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '21 days') AT TIME ZONE 'Europe/Madrid'
    ],
    '99200000-0000-4000-8000-000000000001',
    'Create first audited sellable place'
) AS slot
\gset

SELECT public.admin_create_bookable_slot(
    '99220000-0000-4000-8000-000000000001',
    '99200000-0000-4000-8000-000000000002',
    :'v2_package_id'::UUID,
    'Europe/Madrid',
    ARRAY[
        :'first_local'::TIMESTAMP AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '7 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '14 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '21 days') AT TIME ZONE 'Europe/Madrid'
    ],
    '99200000-0000-4000-8000-000000000001',
    'Create first audited sellable place'
);

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.bookable_slots
        WHERE id = (
            SELECT slot_id FROM public.bookable_slot_admin_operations
            WHERE request_id = '99220000-0000-4000-8000-000000000001'
        )) <> 1
       OR (SELECT COUNT(*) FROM public.bookable_slot_admin_operations
           WHERE request_id = '99220000-0000-4000-8000-000000000001') <> 1 THEN
        RAISE EXCEPTION 'slot creation retry was not idempotent';
    END IF;

    BEGIN
        PERFORM public.admin_create_bookable_slot(
            '99220000-0000-4000-8000-000000000002',
            '99200000-0000-4000-8000-000000000002',
            (
                SELECT package_id
                FROM public.bookable_slots
                WHERE id = (
                    SELECT slot_id FROM public.bookable_slot_admin_operations
                    WHERE request_id = '99220000-0000-4000-8000-000000000001'
                )
            ),
            'Europe/Madrid',
            (
                SELECT array_agg(starts_at ORDER BY occurrence_index)
                FROM public.bookable_slot_occurrences
                WHERE slot_id = (
                    SELECT slot_id FROM public.bookable_slot_admin_operations
                    WHERE request_id = '99220000-0000-4000-8000-000000000001'
                )
            ),
            '99200000-0000-4000-8000-000000000001',
            'Duplicate exact sellable place must fail'
        );
        RAISE EXCEPTION 'duplicate nonterminal slot was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.teacher_compensation_engagements AS engagement
        JOIN public.bookable_slots AS slot
          ON slot.id = (
              SELECT operation.slot_id
              FROM public.bookable_slot_admin_operations AS operation
              WHERE operation.request_id = '99220000-0000-4000-8000-000000000001'
          )
         AND slot.teacher_id = engagement.teacher_id
        WHERE engagement.effective_from > clock_timestamp()
          AND engagement.effective_from <= slot.first_occurrence_at
    ) THEN
        RAISE EXCEPTION 'future engagement is not effective by first occurrence';
    END IF;
END;
$$;

SELECT public.admin_transition_bookable_slot(
    '99230000-0000-4000-8000-000000000001', :'slot_id'::UUID,
    'publish', '99200000-0000-4000-8000-000000000001',
    'Publish first audited sellable place'
);

DO $$
BEGIN
    BEGIN
        UPDATE public.teacher_availability
        SET is_active = FALSE
        WHERE teacher_id = '99200000-0000-4000-8000-000000000002'
          AND is_active;
        RAISE EXCEPTION 'availability backing a sellable slot was disabled';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

SELECT public.admin_transition_bookable_slot(
    '99230000-0000-4000-8000-000000000002', :'slot_id'::UUID,
    'pause', '99200000-0000-4000-8000-000000000001',
    'Temporarily hide the audited sellable place'
);
SELECT public.admin_transition_bookable_slot(
    '99230000-0000-4000-8000-000000000003', :'slot_id'::UUID,
    'resume', '99200000-0000-4000-8000-000000000001',
    'Restore the audited sellable place'
);
SELECT public.admin_transition_bookable_slot(
    '99230000-0000-4000-8000-000000000004', :'slot_id'::UUID,
    'retire', '99200000-0000-4000-8000-000000000001',
    'Retire the audited sellable place permanently'
);

UPDATE public.teacher_availability
SET is_active = FALSE
WHERE id = :'availability_id'::UUID;

DO $$
DECLARE
    final_status TEXT;
    operation_count INTEGER;
    audit_count INTEGER;
BEGIN
    SELECT status INTO final_status
    FROM public.bookable_slots
    WHERE id = (
        SELECT slot_id FROM public.bookable_slot_admin_operations
        WHERE request_id = '99220000-0000-4000-8000-000000000001'
    );
    SELECT COUNT(*) INTO operation_count
    FROM public.bookable_slot_admin_operations
    WHERE slot_id = (
        SELECT slot_id FROM public.bookable_slot_admin_operations
        WHERE request_id = '99220000-0000-4000-8000-000000000001'
    );
    SELECT COUNT(*) INTO audit_count
    FROM public.admin_audit_log
    WHERE entity_type = 'bookable_slot'
      AND entity_id = (
          SELECT slot_id::TEXT FROM public.bookable_slot_admin_operations
          WHERE request_id = '99220000-0000-4000-8000-000000000001'
      );

    IF final_status <> 'retired'
       OR operation_count <> 5
       OR audit_count <> 5 THEN
        RAISE EXCEPTION 'managed slot lifecycle or audit trail is incomplete';
    END IF;

    BEGIN
        UPDATE public.bookable_slot_admin_operations
        SET reason = 'Mutation must fail'
        WHERE slot_id = (
            SELECT slot_id FROM public.bookable_slot_admin_operations
            WHERE request_id = '99220000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'append-only slot operation was mutable';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END;
$$;

ROLLBACK;
