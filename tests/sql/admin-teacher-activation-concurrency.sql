\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE EXTENSION IF NOT EXISTS dblink;

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE admin_id = '99300000-0000-4000-8000-000000000001'
   OR entity_id IN (
       '99300000-0000-4000-8000-000000000002',
       '99300000-0000-4000-8000-000000000003'
   );
DELETE FROM public.teacher_compensation_engagements
WHERE teacher_id IN (
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);
DELETE FROM public.payments
WHERE id IN (
    '99340000-0000-4000-8000-000000000001',
    '99340000-0000-4000-8000-000000000002'
);
DELETE FROM public.profiles
WHERE id IN (
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);
DELETE FROM auth.users
WHERE id IN (
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);
COMMIT;

INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
    ('99300000-0000-4000-8000-000000000001', 'activation-race-admin@test.invalid', clock_timestamp(), '{}'::JSONB),
    ('99300000-0000-4000-8000-000000000002', 'activation-wins@test.invalid', clock_timestamp(), '{}'::JSONB),
    ('99300000-0000-4000-8000-000000000003', 'dependency-wins@test.invalid', clock_timestamp(), '{}'::JSONB);

ALTER TABLE public.profiles
    DISABLE TRIGGER guard_managed_profile_role_transition_trigger;
UPDATE public.profiles
SET role = 'admin'::public.user_role
WHERE id = '99300000-0000-4000-8000-000000000001';
ALTER TABLE public.profiles
    ENABLE TRIGGER guard_managed_profile_role_transition_trigger;

UPDATE public.profiles
SET full_name = CASE id
        WHEN '99300000-0000-4000-8000-000000000002'::UUID THEN 'Activation Wins'
        ELSE 'Dependency Wins'
    END,
    adult_confirmed = TRUE,
    adult_confirmed_at = clock_timestamp(),
    age_policy_version = '2026-07-10'
WHERE id IN (
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);

SELECT format(
    'host=%s port=%s dbname=%s user=%s password=postgres sslmode=disable',
    COALESCE(host(inet_server_addr()), '127.0.0.1'),
    inet_server_port(), current_database(), current_user
) AS activation_race_dblink_connection
\gset

SELECT dblink_connect('teacher_activation_race_one', :'activation_race_dblink_connection');
SELECT dblink_connect('teacher_activation_race_two', :'activation_race_dblink_connection');

-- Activation owns the profile lock first. The later payment writer must wait,
-- observe the committed teacher role, and fail instead of creating mixed state.
SELECT dblink_send_query('teacher_activation_race_one', $race$
    WITH activated AS MATERIALIZED (
        SELECT public.activate_teacher_profile(
            '99310000-0000-4000-8000-000000000001',
            '99300000-0000-4000-8000-000000000002',
            'founder',
            date_trunc('second', clock_timestamp()) - INTERVAL '1 day',
            '99300000-0000-4000-8000-000000000001',
            'Concurrent activation wins before student state'
        ) AS result
    ), lock_held AS MATERIALIZED (
        SELECT pg_sleep(0.75) FROM activated
    )
    SELECT (result #>> '{profile,id}')::UUID
    FROM activated CROSS JOIN lock_held
$race$);
SELECT pg_sleep(0.10);
SELECT dblink_send_query('teacher_activation_race_two', $race$
    INSERT INTO public.payments (id, student_id, amount, description)
    VALUES (
        '99340000-0000-4000-8000-000000000001',
        '99300000-0000-4000-8000-000000000002',
        25900,
        'Must lose to teacher activation'
    )
    RETURNING id
$race$);
SELECT * FROM dblink_get_result('teacher_activation_race_one') AS result(profile_id UUID);
SELECT * FROM dblink_get_result('teacher_activation_race_one') AS result(profile_id UUID);
DO $$
BEGIN
    PERFORM result.payment_id
    FROM dblink_get_result('teacher_activation_race_two') AS result(payment_id UUID);
    RAISE EXCEPTION 'student_dependency_was_created_after_teacher_activation';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%studentId must belong to a student profile%' THEN
        RAISE;
    END IF;
END;
$$;
SELECT * FROM dblink_get_result('teacher_activation_race_two') AS result(payment_id UUID);

DO $$
BEGIN
    IF (SELECT role FROM public.profiles
        WHERE id = '99300000-0000-4000-8000-000000000002')
            IS DISTINCT FROM 'teacher'::public.user_role
       OR EXISTS (
           SELECT 1 FROM public.payments
           WHERE student_id = '99300000-0000-4000-8000-000000000002'
       ) THEN
        RAISE EXCEPTION 'activation_first_race_left_mixed_profile_state';
    END IF;
END;
$$;

-- The dependency owns the same lock first. Activation waits, then must see the
-- committed payment and reject promotion, preserving the student profile.
SELECT dblink_send_query('teacher_activation_race_one', $race$
    WITH inserted AS MATERIALIZED (
        INSERT INTO public.payments (id, student_id, amount, description)
        VALUES (
            '99340000-0000-4000-8000-000000000002',
            '99300000-0000-4000-8000-000000000003',
            25900,
            'Must win before teacher activation'
        )
        RETURNING id
    ), lock_held AS MATERIALIZED (
        SELECT pg_sleep(0.75) FROM inserted
    )
    SELECT id FROM inserted CROSS JOIN lock_held
$race$);
SELECT pg_sleep(0.10);
SELECT dblink_send_query('teacher_activation_race_two', $race$
    SELECT public.activate_teacher_profile(
        '99310000-0000-4000-8000-000000000002',
        '99300000-0000-4000-8000-000000000003',
        'external',
        date_trunc('second', clock_timestamp()) - INTERVAL '1 day',
        '99300000-0000-4000-8000-000000000001',
        'Concurrent student state wins before activation'
    )
$race$);
SELECT * FROM dblink_get_result('teacher_activation_race_one') AS result(payment_id UUID);
SELECT * FROM dblink_get_result('teacher_activation_race_one') AS result(payment_id UUID);
DO $$
BEGIN
    PERFORM result.activation
    FROM dblink_get_result('teacher_activation_race_two') AS result(activation JSONB);
    RAISE EXCEPTION 'teacher_activation_ignored_concurrent_student_dependency';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%teacher_profile_activation_has_student_dependencies%' THEN
        RAISE;
    END IF;
END;
$$;
SELECT * FROM dblink_get_result('teacher_activation_race_two') AS result(activation JSONB);

SELECT dblink_disconnect('teacher_activation_race_one');
SELECT dblink_disconnect('teacher_activation_race_two');

DO $$
BEGIN
    IF (SELECT role FROM public.profiles
        WHERE id = '99300000-0000-4000-8000-000000000003')
            IS DISTINCT FROM 'student'::public.user_role
       OR NOT EXISTS (
           SELECT 1 FROM public.payments
           WHERE student_id = '99300000-0000-4000-8000-000000000003'
       ) THEN
        RAISE EXCEPTION 'dependency_first_race_left_mixed_profile_state';
    END IF;
END;
$$;

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE admin_id = '99300000-0000-4000-8000-000000000001'
   OR entity_id IN (
       '99300000-0000-4000-8000-000000000002',
       '99300000-0000-4000-8000-000000000003'
   );
DELETE FROM public.teacher_compensation_engagements
WHERE teacher_id IN (
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);
DELETE FROM public.payments
WHERE id IN (
    '99340000-0000-4000-8000-000000000001',
    '99340000-0000-4000-8000-000000000002'
);
DELETE FROM public.profiles
WHERE id IN (
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);
DELETE FROM auth.users
WHERE id IN (
    '99300000-0000-4000-8000-000000000001',
    '99300000-0000-4000-8000-000000000002',
    '99300000-0000-4000-8000-000000000003'
);
COMMIT;
