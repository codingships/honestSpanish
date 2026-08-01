\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '20s';

-- A direct session INSERT that took its first trigger snapshot before begin
-- committed must recheck the durable reservation after waiting for the same
-- teacher advisory lock. The named dblink session keeps begin's transaction
-- open for one second, exercising the real two-connection race deterministically.
CREATE EXTENSION IF NOT EXISTS dblink;

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (id, email, role) VALUES
    ('74000000-0000-4000-8000-000000000001', 'race-student@test.invalid', 'student'),
    ('74000000-0000-4000-8000-000000000002', 'race-teacher@test.invalid', 'teacher'),
    ('74000000-0000-4000-8000-000000000003', 'race-other@test.invalid', 'student');

INSERT INTO public.packages (
    id, name, display_name, price_monthly, sessions_per_month,
    contract_schema_version, amount_cents, billing_interval_unit,
    billing_interval_count, sessions_per_period, class_duration_minutes
) VALUES
    (
        '74100000-0000-4000-8000-000000000001',
        'concurrency_v2_package',
        '{"en":"Concurrency V2"}'::JSONB,
        25900, 4, 2, 25900, 'day', 28, 4, 50
    ),
    (
        '74100000-0000-4000-8000-000000000002',
        'concurrency_legacy_package',
        '{"en":"Concurrency legacy"}'::JSONB,
        100, 1, 1, NULL, NULL, NULL, NULL, NULL
    );

INSERT INTO public.subscriptions (
    id, student_id, package_id, status, duration_months, starts_at,
    ends_at, sessions_total, contracted_sessions_per_period, sessions_used,
    stripe_subscription_id, contract_schema_version, billing_interval_unit,
    billing_interval_count, class_duration_minutes
) VALUES
    (
        '74200000-0000-4000-8000-000000000001',
        '74000000-0000-4000-8000-000000000001',
        '74100000-0000-4000-8000-000000000001',
        'active', NULL, DATE '2035-01-01', DATE '2035-01-29',
        4, 4, 4, 'sub_concurrency_v2', 2, 'day', 28, 50
    ),
    (
        '74200000-0000-4000-8000-000000000002',
        '74000000-0000-4000-8000-000000000003',
        '74100000-0000-4000-8000-000000000002',
        'active', 1, DATE '2035-01-01', DATE '2035-02-01',
        1, 1, 0, NULL, 1, 'month', 1, NULL
    );

INSERT INTO public.payments (
    id, student_id, subscription_id, amount, currency, status,
    stripe_invoice_id
) VALUES (
    '74300000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000001',
    '74200000-0000-4000-8000-000000000001',
    25900, 'eur', 'succeeded', 'in_concurrency_v2'
);

INSERT INTO public.checkout_v2_cycles (
    id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
    stripe_price_id, stripe_invoice_id, payment_id,
    materialization_state, sessions_materialized_at
) VALUES (
    '74400000-0000-4000-8000-000000000001',
    '74200000-0000-4000-8000-000000000001',
    1, 'initial',
    TIMESTAMPTZ '2035-01-01 10:00:00+00',
    TIMESTAMPTZ '2035-01-29 10:00:00+00',
    'price_concurrency_v2', 'in_concurrency_v2',
    '74300000-0000-4000-8000-000000000001',
    'ready', TIMESTAMPTZ '2034-12-01 00:00:00+00'
);

UPDATE public.payments
SET checkout_v2_cycle_id = '74400000-0000-4000-8000-000000000001'
WHERE id = '74300000-0000-4000-8000-000000000001';

INSERT INTO public.sessions (
    id, subscription_id, student_id, teacher_id, scheduled_at,
    duration_minutes, status, checkout_v2_cycle_id,
    checkout_v2_cycle_session_index
)
SELECT
    ('74500000-0000-4000-8000-00000000000' || occurrence)::UUID,
    '74200000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000002',
    TIMESTAMPTZ '2035-01-01 10:00:00+00'
        + pg_catalog.make_interval(days => (occurrence - 1) * 7),
    50, 'scheduled',
    '74400000-0000-4000-8000-000000000001',
    occurrence
FROM pg_catalog.generate_series(1, 4) AS occurrence;

INSERT INTO public.checkout_v2_billing_state (
    subscription_id, first_session_id, first_class_at, renewal_anchor_at,
    stripe_renewal_anchor_at, anchor_state, anchor_revision
) VALUES (
    '74200000-0000-4000-8000-000000000001',
    '74500000-0000-4000-8000-000000000001',
    TIMESTAMPTZ '2035-01-01 10:00:00+00',
    TIMESTAMPTZ '2035-01-29 10:00:00+00',
    TIMESTAMPTZ '2035-01-29 10:00:00+00',
    'provisional', 1
);

INSERT INTO public.bookable_slots (
    id, package_id, teacher_id, weekday, local_start_time, timezone_name,
    first_occurrence_at, status, published_at, published_by, sold_at,
    sold_subscription_id, sessions_materialized_at, created_by
) VALUES (
    '74700000-0000-4000-8000-000000000001',
    '74100000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM TIMESTAMPTZ '2035-01-01 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid')::SMALLINT,
    (TIMESTAMPTZ '2035-01-01 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid')::TIME(0),
    'Europe/Madrid',
    TIMESTAMPTZ '2035-01-01 10:00:00+00',
    'sold',
    TIMESTAMPTZ '2034-12-01 00:00:00+00',
    '74000000-0000-4000-8000-000000000002',
    TIMESTAMPTZ '2034-12-01 00:05:00+00',
    '74200000-0000-4000-8000-000000000001',
    TIMESTAMPTZ '2034-12-01 00:10:00+00',
    '74000000-0000-4000-8000-000000000002'
);

INSERT INTO public.checkout_v2_weekly_allocations (
    id, subscription_id, slot_id, teacher_id, weekday, local_start_time,
    duration_minutes, timezone_name, status
) VALUES (
    '74600000-0000-4000-8000-000000000001',
    '74200000-0000-4000-8000-000000000001',
    '74700000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM TIMESTAMPTZ '2035-01-29 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid')::SMALLINT,
    (TIMESTAMPTZ '2035-01-29 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid')::TIME(0),
    50, 'Europe/Madrid', 'active'
);

INSERT INTO public.teacher_availability (
    teacher_id, day_of_week, start_time, end_time, is_active
) VALUES (
    '74000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM TIMESTAMPTZ '2035-01-29 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid')::INTEGER,
    (TIMESTAMPTZ '2035-01-29 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid')::TIME,
    ((TIMESTAMPTZ '2035-01-29 10:00:00+00'
        AT TIME ZONE 'Europe/Madrid') + INTERVAL '1 hour')::TIME,
    TRUE
);

INSERT INTO public.checkout_v2_reschedule_operations (
    id, request_id, session_id, subscription_id, cycle_id, actor_id,
    operation_kind, old_scheduled_at, new_scheduled_at,
    expected_anchor_revision, target_stripe_anchor_at, created_at, updated_at
) VALUES (
    '74800000-0000-4000-8000-000000000001',
    '74900000-0000-4000-8000-000000000001',
    '74500000-0000-4000-8000-000000000001',
    '74200000-0000-4000-8000-000000000001',
    '74400000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000001',
    'provisional_anchor',
    TIMESTAMPTZ '2035-01-01 10:00:00+00',
    TIMESTAMPTZ '2035-01-29 10:00:00+00',
    1,
    TIMESTAMPTZ '2035-02-26 10:00:00+00',
    date_trunc('second', clock_timestamp()),
    date_trunc('second', clock_timestamp())
);

COMMIT;

SELECT dblink_connect(
    'checkout_v2_reschedule_race',
    'host=127.0.0.1 port=5432 dbname=' || current_database()
        || ' user=postgres password=postgres sslmode=disable'
);

SELECT dblink_exec(
    'checkout_v2_reschedule_race',
    'SET lock_timeout = ''5s''; SET statement_timeout = ''15s'';'
);
SELECT dblink_exec(
    'checkout_v2_reschedule_race',
    'DO $lock$ BEGIN PERFORM pg_catalog.pg_advisory_lock(749001); END $lock$;'
);

SELECT dblink_send_query('checkout_v2_reschedule_race', $race$
    DO $remote$
    BEGIN
        PERFORM public.begin_checkout_v2_reschedule_stripe_mutation(
            '74800000-0000-4000-8000-000000000001'
        );
        PERFORM pg_catalog.pg_advisory_unlock(749001);
        PERFORM pg_catalog.pg_sleep(1);
    END
    $remote$;
$race$);

SELECT pg_catalog.pg_advisory_lock(749001);
SELECT pg_catalog.pg_advisory_unlock(749001);

DO $$
BEGIN
    INSERT INTO public.sessions (
        id, subscription_id, student_id, teacher_id, scheduled_at,
        duration_minutes, status
    ) VALUES (
        '74500000-0000-4000-8000-000000000010',
        '74200000-0000-4000-8000-000000000002',
        '74000000-0000-4000-8000-000000000003',
        '74000000-0000-4000-8000-000000000002',
        TIMESTAMPTZ '2035-01-29 10:00:00+00',
        50, 'scheduled'
    );
    RAISE EXCEPTION 'direct_session_insert_crossed_started_reschedule';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_reschedule_session_is_locked' THEN
        RAISE;
    END IF;
END
$$;

SELECT *
FROM dblink_get_result('checkout_v2_reschedule_race') AS result(status TEXT);
SELECT dblink_disconnect('checkout_v2_reschedule_race');

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.checkout_v2_reschedule_operations
WHERE id = '74800000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_v2_billing_state
WHERE subscription_id = '74200000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_v2_weekly_allocations
WHERE id = '74600000-0000-4000-8000-000000000001';
DELETE FROM public.teacher_availability
WHERE teacher_id = '74000000-0000-4000-8000-000000000002';
DELETE FROM public.sessions
WHERE id::TEXT LIKE '74500000-0000-4000-8000-0000000000%';
DELETE FROM public.checkout_v2_cycles
WHERE id = '74400000-0000-4000-8000-000000000001';
DELETE FROM public.payments
WHERE id = '74300000-0000-4000-8000-000000000001';
DELETE FROM public.subscriptions
WHERE id IN (
    '74200000-0000-4000-8000-000000000001',
    '74200000-0000-4000-8000-000000000002'
);
DELETE FROM public.packages
WHERE id IN (
    '74100000-0000-4000-8000-000000000001',
    '74100000-0000-4000-8000-000000000002'
);
DELETE FROM public.profiles
WHERE id IN (
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000002',
    '74000000-0000-4000-8000-000000000003'
);
COMMIT;

RESET lock_timeout;
RESET statement_timeout;
