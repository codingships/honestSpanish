\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT date_trunc('second', clock_timestamp()) - INTERVAL '1 year'
    AS engagement_from
\gset

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (id, email, role) VALUES
    ('88000000-0000-4000-8000-000000000001', 'comp-admin@test.invalid', 'admin'),
    ('88000000-0000-4000-8000-000000000002', 'comp-founder@test.invalid', 'teacher'),
    ('88000000-0000-4000-8000-000000000003', 'comp-external@test.invalid', 'teacher'),
    ('88000000-0000-4000-8000-000000000004', 'comp-unconfigured@test.invalid', 'teacher');

INSERT INTO public.packages (
    id, name, display_name, price_monthly, sessions_per_month,
    contract_schema_version, amount_cents, billing_interval_unit,
    billing_interval_count, sessions_per_period, class_duration_minutes
) VALUES (
    '88010000-0000-4000-8000-000000000001',
    'teacher_compensation_v2_test', '{"en":"Teacher compensation"}'::JSONB,
    25900, 4, 2, 25900, 'day', 28, 4, 50
);

DO $fixture$
DECLARE
    position INTEGER;
    student_id UUID;
BEGIN
    FOR position IN 1..13 LOOP
        student_id := (
            '88020000-0000-4000-8000-' || lpad(position::TEXT, 12, '0')
        )::UUID;
        INSERT INTO public.profiles (id, email, role)
        VALUES (
            student_id,
            'comp-student-' || position::TEXT || '@test.invalid',
            'student'
        );
    END LOOP;
END
$fixture$;
COMMIT;

SELECT public.configure_teacher_compensation_engagement(
    '88030000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000002',
    'founder',
    :'engagement_from'::TIMESTAMPTZ,
    '88000000-0000-4000-8000-000000000001',
    'Founder fixture classification.'
);
SELECT public.configure_teacher_compensation_engagement(
    '88030000-0000-4000-8000-000000000002',
    '88000000-0000-4000-8000-000000000003',
    'external',
    :'engagement_from'::TIMESTAMPTZ,
    '88000000-0000-4000-8000-000000000001',
    'External fixture classification.'
);

-- An exact request replay returns the same engagement; a changed replay fails.
SELECT public.configure_teacher_compensation_engagement(
    '88030000-0000-4000-8000-000000000002',
    '88000000-0000-4000-8000-000000000003',
    'external',
    :'engagement_from'::TIMESTAMPTZ,
    '88000000-0000-4000-8000-000000000001',
    'External fixture classification.'
);

DO $$
BEGIN
    PERFORM public.configure_teacher_compensation_engagement(
        '88030000-0000-4000-8000-000000000002',
        '88000000-0000-4000-8000-000000000003',
        'founder',
        (
            SELECT effective_from
            FROM public.teacher_compensation_engagements
            WHERE request_id = '88030000-0000-4000-8000-000000000002'
        ),
        '88000000-0000-4000-8000-000000000001',
        'Changed replay must fail.'
    );
    RAISE EXCEPTION 'changed_engagement_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

-- Create eleven complete initial cycles in sequence. The tenth cycle observes
-- the threshold only after retaining the old rate; the eleventh uses 25 EUR.
DO $cycles$
DECLARE
    position INTEGER;
    session_position INTEGER;
    student_id UUID;
    subscription_id UUID;
    payment_id UUID;
    cycle_id UUID;
    session_id UUID;
    teacher_id UUID;
    cycle_start TIMESTAMPTZ;
BEGIN
    FOR position IN 1..11 LOOP
        student_id := ('88020000-0000-4000-8000-' || lpad(position::TEXT, 12, '0'))::UUID;
        subscription_id := ('88040000-0000-4000-8000-' || lpad(position::TEXT, 12, '0'))::UUID;
        payment_id := ('88050000-0000-4000-8000-' || lpad(position::TEXT, 12, '0'))::UUID;
        cycle_id := ('88060000-0000-4000-8000-' || lpad(position::TEXT, 12, '0'))::UUID;
        cycle_start := date_trunc('second', clock_timestamp())
            - INTERVAL '20 days' + make_interval(hours => position * 2);
        teacher_id := CASE WHEN position = 2
            THEN '88000000-0000-4000-8000-000000000002'::UUID
            ELSE '88000000-0000-4000-8000-000000000003'::UUID
        END;

        PERFORM set_config('session_replication_role', 'replica', TRUE);
        INSERT INTO public.subscriptions (
            id, student_id, package_id, status, duration_months,
            starts_at, ends_at, sessions_total, contracted_sessions_per_period,
            sessions_used, stripe_subscription_id, stripe_invoice_id,
            contract_schema_version, billing_interval_unit,
            billing_interval_count, class_duration_minutes
        ) VALUES (
            subscription_id, student_id,
            '88010000-0000-4000-8000-000000000001',
            'active', NULL,
            (cycle_start AT TIME ZONE 'Europe/Madrid')::DATE,
            (cycle_start AT TIME ZONE 'Europe/Madrid')::DATE + 28,
            4, 4, 4,
            'sub_comp_' || position::TEXT,
            'in_comp_' || position::TEXT,
            2, 'day', 28, 50
        );
        INSERT INTO public.payments (
            id, student_id, subscription_id, amount, currency, status,
            stripe_payment_intent_id, stripe_invoice_id
        ) VALUES (
            payment_id, student_id, subscription_id, 25900, 'eur', 'succeeded',
            'pi_comp_' || position::TEXT, 'in_comp_' || position::TEXT
        );
        INSERT INTO public.checkout_v2_cycles (
            id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
            stripe_price_id, stripe_invoice_id, payment_id,
            materialization_state, sessions_materialized_at, created_at
        ) VALUES (
            cycle_id, subscription_id, 1, 'initial', cycle_start,
            cycle_start + INTERVAL '28 days',
            'price_comp_' || position::TEXT,
            'in_comp_' || position::TEXT,
            payment_id, 'ready', date_trunc('second', clock_timestamp()),
            date_trunc('second', clock_timestamp())
                - INTERVAL '30 days' + make_interval(mins => position)
        );
        UPDATE public.payments
        SET checkout_v2_cycle_id = cycle_id
        WHERE id = payment_id;

        FOR session_position IN 1..4 LOOP
            session_id := (
                '88070000-0000-4000-8000-'
                || lpad((position * 10 + session_position)::TEXT, 12, '0')
            )::UUID;
            INSERT INTO public.sessions (
                id, subscription_id, student_id, teacher_id, scheduled_at,
                duration_minutes, status
            ) VALUES (
                session_id, subscription_id, student_id,
                teacher_id,
                cycle_start + make_interval(days => (session_position - 1) * 7),
                50, 'scheduled'
            );
            IF session_position < 4 THEN
                UPDATE public.sessions
                SET checkout_v2_cycle_id = cycle_id,
                    checkout_v2_cycle_session_index = session_position
                WHERE id = session_id;
            END IF;
        END LOOP;

        PERFORM set_config('session_replication_role', 'origin', TRUE);
        UPDATE public.sessions
        SET checkout_v2_cycle_id = cycle_id,
            checkout_v2_cycle_session_index = 4
        WHERE id = session_id;
    END LOOP;
END
$cycles$;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.teacher_compensation_cycle_terms) <> 11
       OR EXISTS (
            SELECT 1 FROM public.teacher_compensation_cycle_terms
            WHERE cycle_id IN (
                '88060000-0000-4000-8000-000000000001',
                '88060000-0000-4000-8000-000000000010'
            ) AND external_class_rate_cents <> 2000
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_cycle_terms
            WHERE cycle_id = '88060000-0000-4000-8000-000000000011'
              AND external_class_rate_cents = 2500
              AND rate_basis = 'ten_active'
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_milestones
            WHERE policy_version = 1
              AND ten_active_trigger_cycle_id = '88060000-0000-4000-8000-000000000010'
              AND ten_active_students_count = 10
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_threshold_snapshot_is_wrong';
    END IF;
END
$$;

-- Outcome matrix: external/founder completed, no-show on both rate tiers and
-- a strict late student cancellation accrue. Exactly 24h, teacher cancellation
-- and admin cancellation do not accrue. Guarantee invalidation is exercised by
-- the real saga in checkout-v2-guarantee.sql.
UPDATE public.sessions
SET status = 'completed',
    completed_at = scheduled_at + INTERVAL '50 minutes'
WHERE id = '88070000-0000-4000-8000-000000000011';

UPDATE public.sessions
SET status = 'completed',
    completed_at = scheduled_at + INTERVAL '50 minutes'
WHERE id = '88070000-0000-4000-8000-000000000021';

UPDATE public.sessions
SET status = 'cancelled',
    cancelled_at = scheduled_at - INTERVAL '23 hours 59 minutes',
    cancelled_by = student_id,
    cancellation_reason = 'student_late'
WHERE id = '88070000-0000-4000-8000-000000000031';

-- A substitute can be accepted before the outcome; the actual founder
-- engagement is frozen by the resulting entry, not by the cycle tier.
UPDATE public.sessions
SET teacher_id = '88000000-0000-4000-8000-000000000002'
WHERE id = '88070000-0000-4000-8000-000000000032';
UPDATE public.sessions
SET status = 'completed',
    completed_at = scheduled_at + INTERVAL '50 minutes'
WHERE id = '88070000-0000-4000-8000-000000000032';

UPDATE public.sessions
SET status = 'cancelled',
    cancelled_at = scheduled_at - INTERVAL '24 hours',
    cancelled_by = student_id,
    cancellation_reason = 'student_exact_cutoff'
WHERE id = '88070000-0000-4000-8000-000000000041';

UPDATE public.sessions
SET status = 'cancelled',
    cancelled_at = scheduled_at - INTERVAL '1 hour',
    cancelled_by = '88000000-0000-4000-8000-000000000003',
    cancellation_reason = 'teacher_cancelled'
WHERE id = '88070000-0000-4000-8000-000000000051';

UPDATE public.sessions
SET status = 'cancelled',
    cancelled_at = scheduled_at - INTERVAL '1 hour',
    cancelled_by = '88000000-0000-4000-8000-000000000001',
    cancellation_reason = 'admin_cancelled'
WHERE id = '88070000-0000-4000-8000-000000000061';

UPDATE public.sessions
SET status = 'no_show',
    no_show_at = date_trunc('second', clock_timestamp())
WHERE id = '88070000-0000-4000-8000-000000000101';
UPDATE public.sessions
SET status = 'no_show',
    no_show_at = date_trunc('second', clock_timestamp())
WHERE id = '88070000-0000-4000-8000-000000000111';

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.teacher_compensation_ledger) <> 6
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_ledger
            WHERE session_id = '88070000-0000-4000-8000-000000000011'
              AND event_kind = 'class_completed'
              AND amount_cents = 2000
              AND engagement_kind = 'external'
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_ledger
            WHERE session_id = '88070000-0000-4000-8000-000000000021'
              AND amount_cents = 4000
              AND engagement_kind = 'founder'
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_ledger
            WHERE session_id = '88070000-0000-4000-8000-000000000031'
              AND event_kind = 'student_late_cancellation'
              AND amount_cents = 2000
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_ledger
            WHERE session_id = '88070000-0000-4000-8000-000000000032'
              AND event_kind = 'class_completed'
              AND amount_cents = 4000
              AND engagement_kind = 'founder'
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_ledger
            WHERE session_id = '88070000-0000-4000-8000-000000000101'
              AND event_kind = 'student_no_show'
              AND amount_cents = 2000
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_ledger
            WHERE session_id = '88070000-0000-4000-8000-000000000111'
              AND event_kind = 'student_no_show'
              AND amount_cents = 2500
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_outcome_matrix_is_wrong';
    END IF;
END
$$;

-- Reconciliation is an exact replay and source economics freeze afterwards.
SELECT public.reconcile_teacher_compensation_session(
    '88070000-0000-4000-8000-000000000111',
    '88000000-0000-4000-8000-000000000001'
);
SELECT public.reconcile_teacher_compensation_session(
    '88070000-0000-4000-8000-000000000111',
    '88000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    UPDATE public.sessions
    SET teacher_id = '88000000-0000-4000-8000-000000000002'
    WHERE id = '88070000-0000-4000-8000-000000000111';
    RAISE EXCEPTION 'accrued_session_source_was_mutated';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

-- A terminal historical row inserted with triggers disabled is not backfilled.
-- The explicit RPC creates its missing terms and accrual once.
DO $historical$
DECLARE
    student_id UUID := '88020000-0000-4000-8000-000000000012';
    subscription_id UUID := '88040000-0000-4000-8000-000000000012';
    payment_id UUID := '88050000-0000-4000-8000-000000000012';
    cycle_id UUID := '88060000-0000-4000-8000-000000000012';
    session_id UUID;
    position INTEGER;
    cycle_start TIMESTAMPTZ := date_trunc('second', clock_timestamp()) - INTERVAL '10 days';
BEGIN
    PERFORM set_config('session_replication_role', 'replica', TRUE);
    INSERT INTO public.subscriptions (
        id, student_id, package_id, status, starts_at, ends_at,
        sessions_total, contracted_sessions_per_period, sessions_used,
        stripe_subscription_id, stripe_invoice_id, contract_schema_version,
        billing_interval_unit, billing_interval_count, class_duration_minutes
    ) VALUES (
        subscription_id, student_id, '88010000-0000-4000-8000-000000000001',
        'active', (cycle_start AT TIME ZONE 'Europe/Madrid')::DATE,
        (cycle_start AT TIME ZONE 'Europe/Madrid')::DATE + 28,
        4, 4, 4, 'sub_comp_12', 'in_comp_12', 2, 'day', 28, 50
    );
    INSERT INTO public.payments (
        id, student_id, subscription_id, amount, currency, status,
        stripe_payment_intent_id, stripe_invoice_id
    ) VALUES (
        payment_id, student_id, subscription_id, 25900, 'eur', 'succeeded',
        'pi_comp_12', 'in_comp_12'
    );
    INSERT INTO public.checkout_v2_cycles (
        id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
        stripe_price_id, stripe_invoice_id, payment_id,
        materialization_state, sessions_materialized_at, created_at
    ) VALUES (
        cycle_id, subscription_id, 1, 'initial', cycle_start,
        cycle_start + INTERVAL '28 days', 'price_comp_12', 'in_comp_12', payment_id,
        'ready', clock_timestamp(), clock_timestamp()
    );
    UPDATE public.payments SET checkout_v2_cycle_id = cycle_id WHERE id = payment_id;
    FOR position IN 1..4 LOOP
        session_id := ('88070000-0000-4000-8000-' || lpad((120 + position)::TEXT, 12, '0'))::UUID;
        INSERT INTO public.sessions (
            id, subscription_id, student_id, teacher_id, scheduled_at,
            duration_minutes, status, completed_at,
            checkout_v2_cycle_id, checkout_v2_cycle_session_index
        ) VALUES (
            session_id, subscription_id, student_id,
            '88000000-0000-4000-8000-000000000003',
            cycle_start + make_interval(days => (position - 1) * 7),
            50,
            CASE WHEN position = 1 THEN 'completed' ELSE 'scheduled' END,
            CASE WHEN position = 1 THEN cycle_start + INTERVAL '50 minutes' ELSE NULL END,
            cycle_id, position
        );
    END LOOP;
    PERFORM set_config('session_replication_role', 'origin', TRUE);
END
$historical$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.teacher_compensation_ledger
        WHERE session_id = '88070000-0000-4000-8000-000000000121'
    ) THEN
        RAISE EXCEPTION 'historical_terminal_was_backfilled_automatically';
    END IF;
END
$$;

SELECT public.reconcile_teacher_compensation_cycle(
    '88060000-0000-4000-8000-000000000012',
    '88000000-0000-4000-8000-000000000001'
);
SELECT public.reconcile_teacher_compensation_cycle(
    '88060000-0000-4000-8000-000000000012',
    '88000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.teacher_compensation_ledger
        WHERE session_id = '88070000-0000-4000-8000-000000000121'
    ) THEN
        RAISE EXCEPTION 'cycle_reconciliation_created_an_obligation';
    END IF;
END
$$;

SELECT public.reconcile_teacher_compensation_session(
    '88070000-0000-4000-8000-000000000121',
    '88000000-0000-4000-8000-000000000001'
);
SELECT public.reconcile_teacher_compensation_session(
    '88070000-0000-4000-8000-000000000121',
    '88000000-0000-4000-8000-000000000001'
);

-- Missing engagement is a narrow operational precondition error. This fixture
-- is trigger-free historical data so it does not violate the slot precondition.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.subscriptions (
    id, student_id, package_id, status, starts_at, ends_at,
    sessions_total, contracted_sessions_per_period, sessions_used,
    stripe_subscription_id, stripe_invoice_id, contract_schema_version,
    billing_interval_unit, billing_interval_count, class_duration_minutes
) VALUES (
    '88040000-0000-4000-8000-000000000013',
    '88020000-0000-4000-8000-000000000013',
    '88010000-0000-4000-8000-000000000001',
    'active', current_date - 5, current_date + 23,
    4, 4, 4, 'sub_comp_13', 'in_comp_13', 2, 'day', 28, 50
);
INSERT INTO public.payments (
    id, student_id, subscription_id, amount, currency, status,
    stripe_payment_intent_id, stripe_invoice_id
) VALUES (
    '88050000-0000-4000-8000-000000000013',
    '88020000-0000-4000-8000-000000000013',
    '88040000-0000-4000-8000-000000000013',
    25900, 'eur', 'succeeded', 'pi_comp_13', 'in_comp_13'
);
INSERT INTO public.checkout_v2_cycles (
    id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
    stripe_price_id, stripe_invoice_id, payment_id,
    materialization_state, sessions_materialized_at, created_at
) VALUES (
    '77060000-0000-4000-8000-000000000013',
    '88040000-0000-4000-8000-000000000013',
    1, 'initial', date_trunc('second', transaction_timestamp()) - INTERVAL '5 days',
    date_trunc('second', transaction_timestamp()) + INTERVAL '23 days',
    'price_comp_13', 'in_comp_13',
    '88050000-0000-4000-8000-000000000013',
    'ready', clock_timestamp(),
    (SELECT created_at FROM public.checkout_v2_cycles
     WHERE id = '88060000-0000-4000-8000-000000000010')
);
UPDATE public.payments
SET checkout_v2_cycle_id = '77060000-0000-4000-8000-000000000013'
WHERE id = '88050000-0000-4000-8000-000000000013';
DO $missing_engagement_fixture$
DECLARE
    position INTEGER;
    session_id UUID;
    starts_at TIMESTAMPTZ := date_trunc('second', clock_timestamp()) - INTERVAL '5 days';
BEGIN
    FOR position IN 1..4 LOOP
        session_id := ('88070000-0000-4000-8000-' || lpad((130 + position)::TEXT, 12, '0'))::UUID;
        INSERT INTO public.sessions (
            id, subscription_id, student_id, teacher_id, scheduled_at,
            duration_minutes, status, completed_at,
            checkout_v2_cycle_id, checkout_v2_cycle_session_index
        ) VALUES (
            session_id,
            '88040000-0000-4000-8000-000000000013',
            '88020000-0000-4000-8000-000000000013',
            '88000000-0000-4000-8000-000000000004',
            starts_at + make_interval(days => (position - 1) * 7),
            50,
            CASE WHEN position = 1 THEN 'completed' ELSE 'scheduled' END,
            CASE WHEN position = 1 THEN starts_at + INTERVAL '50 minutes' ELSE NULL END,
            '77060000-0000-4000-8000-000000000013',
            position
        );
    END LOOP;
END
$missing_engagement_fixture$;
COMMIT;

DO $$
BEGIN
    PERFORM public.reconcile_teacher_compensation_session(
        '88070000-0000-4000-8000-000000000131',
        '88000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'missing_engagement_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'teacher_compensation_precondition_missing' THEN RAISE; END IF;
END
$$;

-- Two independent connections can race the first cycle snapshot and first
-- obligation without a duplicate or a deadlock. The first connection holds
-- its transaction-scoped locks briefly after accrual so the second genuinely
-- overlaps it rather than merely replaying after commit.
SELECT public.configure_teacher_compensation_engagement(
    '88030000-0000-4000-8000-000000000004',
    '88000000-0000-4000-8000-000000000004',
    'external',
    :'engagement_from'::TIMESTAMPTZ,
    '88000000-0000-4000-8000-000000000001',
    'Concurrent accrual fixture classification.'
);

SELECT format(
    'host=%s port=%s dbname=%s user=%s password=postgres sslmode=disable',
    COALESCE(host(inet_server_addr()), '127.0.0.1'),
    inet_server_port(),
    current_database(),
    current_user
) AS compensation_dblink_connection
\gset

SELECT dblink_connect('compensation_race_one', :'compensation_dblink_connection');
SELECT dblink_connect('compensation_race_two', :'compensation_dblink_connection');
SELECT dblink_send_query('compensation_race_one', $race$
    WITH accrued AS MATERIALIZED (
        SELECT public.reconcile_teacher_compensation_session(
            '88070000-0000-4000-8000-000000000131',
            '88000000-0000-4000-8000-000000000001'
        ) AS entry
    ), lock_held AS MATERIALIZED (
        SELECT pg_sleep(0.75) FROM accrued
    )
    SELECT (entry).id FROM accrued CROSS JOIN lock_held
$race$);
SELECT pg_sleep(0.10);
SELECT dblink_send_query('compensation_race_two', $race$
    SELECT (public.reconcile_teacher_compensation_session(
        '88070000-0000-4000-8000-000000000131',
        '88000000-0000-4000-8000-000000000001'
    )).id
$race$);
SELECT * FROM dblink_get_result('compensation_race_one') AS result(entry_id UUID);
SELECT * FROM dblink_get_result('compensation_race_two') AS result(entry_id UUID);
SELECT dblink_disconnect('compensation_race_one');
SELECT dblink_disconnect('compensation_race_two');

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.teacher_compensation_cycle_terms
        WHERE cycle_id = '77060000-0000-4000-8000-000000000013'
          AND external_class_rate_cents = 2500) <> 1
       OR (SELECT COUNT(*) FROM public.teacher_compensation_ledger
           WHERE session_id = '88070000-0000-4000-8000-000000000131') <> 1 THEN
        RAISE EXCEPTION 'concurrent_compensation_accrual_was_not_exactly_once';
    END IF;
END
$$;

-- A ready renewal on a cancelled historical subscription still blocks live
-- milestone inference until it has immutable terms. Otherwise later
-- reconciliation could incorrectly apply the raised rate to earlier work.
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.subscriptions
SET status = 'cancelled'::public.subscription_status
WHERE id = '88040000-0000-4000-8000-000000000013';
UPDATE public.teacher_compensation_milestones
SET ten_active_trigger_cycle_id = NULL,
    ten_active_reached_at = NULL,
    ten_active_students_count = NULL
WHERE policy_version = 1;
INSERT INTO public.checkout_v2_cycles (
    id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
    stripe_price_id, stripe_invoice_id, payment_id,
    materialization_state, sessions_materialized_at, created_at
)
SELECT
    '76060000-0000-4000-8000-000000000014', subscription_id, 2, 'renewal',
    ends_at, ends_at + INTERVAL '28 days',
    'price_comp_14', 'in_comp_14',
    '76050000-0000-4000-8000-000000000014',
    'ready', date_trunc('second', clock_timestamp()), created_at + INTERVAL '1 minute'
FROM public.checkout_v2_cycles
WHERE id = '77060000-0000-4000-8000-000000000013';
DELETE FROM public.teacher_compensation_cycle_terms
WHERE cycle_id = '88060000-0000-4000-8000-000000000012';
SET LOCAL session_replication_role = origin;
DO $$
BEGIN
    PERFORM public.reconcile_teacher_compensation_cycle(
        '88060000-0000-4000-8000-000000000012',
        '88000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'cancelled_historical_cycle_without_terms_was_ignored';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'teacher_compensation_precondition_missing' THEN RAISE; END IF;
END
$$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.sessions
SET status = 'cancelled',
    cancelled_at = scheduled_at - INTERVAL '23 hours',
    cancelled_by = student_id,
    cancellation_reason = 'future_source_fixture'
WHERE id = '88070000-0000-4000-8000-000000000132';
SET LOCAL session_replication_role = origin;
DO $$
BEGIN
    PERFORM public.reconcile_teacher_compensation_session(
        '88070000-0000-4000-8000-000000000132',
        '88000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'future_late_cancellation_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;
ROLLBACK;

-- Incremental installations must resolve unknown ten-active history through
-- an audited decision. A currently impossible `not_reached` answer is rejected.
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.teacher_compensation_milestones
SET ten_active_history_state = 'requires_confirmation',
    ten_active_trigger_cycle_id = NULL,
    ten_active_reached_at = NULL,
    ten_active_students_count = NULL,
    ten_active_bootstrap_request_id = NULL,
    ten_active_confirmed_by = NULL,
    ten_active_history_confirmation = NULL,
    ten_active_confirmation_reason = NULL
WHERE policy_version = 1;
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
    PERFORM public.reconcile_teacher_compensation_cycle(
        '88060000-0000-4000-8000-000000000001',
        '88000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'unconfirmed_ten_active_history_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'teacher_compensation_precondition_missing' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.confirm_teacher_compensation_ten_active_history(
        '88030000-0000-4000-8000-000000000101',
        'not_reached', NULL, NULL,
        '88000000-0000-4000-8000-000000000001',
        'Current active count makes this answer impossible.'
    );
    RAISE EXCEPTION 'impossible_not_reached_history_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'invalid_teacher_compensation_history_confirmation' THEN RAISE; END IF;
END
$$;

SET LOCAL session_replication_role = replica;
UPDATE public.subscriptions
SET status = 'cancelled'::public.subscription_status
WHERE id::TEXT BETWEEN
    '88040000-0000-4000-8000-000000000004'
    AND '88040000-0000-4000-8000-000000000013';
SET LOCAL session_replication_role = origin;

SELECT public.confirm_teacher_compensation_ten_active_history(
    '88030000-0000-4000-8000-000000000102',
    'not_reached', NULL, NULL,
    '88000000-0000-4000-8000-000000000001',
    'Historical review found no earlier ten-active milestone.'
);
SELECT public.confirm_teacher_compensation_ten_active_history(
    '88030000-0000-4000-8000-000000000102',
    'not_reached', NULL, NULL,
    '88000000-0000-4000-8000-000000000001',
    'Historical review found no earlier ten-active milestone.'
);
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.teacher_compensation_milestones
SET ten_active_history_state = 'requires_confirmation',
    ten_active_trigger_cycle_id = NULL,
    ten_active_reached_at = NULL,
    ten_active_students_count = NULL,
    ten_active_bootstrap_request_id = NULL,
    ten_active_confirmed_by = NULL,
    ten_active_history_confirmation = NULL,
    ten_active_confirmation_reason = NULL
WHERE policy_version = 1;
SET LOCAL session_replication_role = origin;
SELECT public.confirm_teacher_compensation_ten_active_history(
    '88030000-0000-4000-8000-000000000103',
    'reached',
    '88060000-0000-4000-8000-000000000010',
    10,
    '88000000-0000-4000-8000-000000000001',
    'Historical review confirmed the ten-active milestone.'
);
SELECT public.confirm_teacher_compensation_ten_active_history(
    '88030000-0000-4000-8000-000000000103',
    'reached',
    '88060000-0000-4000-8000-000000000010',
    10,
    '88000000-0000-4000-8000-000000000001',
    'Historical review confirmed the ten-active milestone.'
);
ROLLBACK;

-- Isolate the new precondition triggers from the existing slot lifecycle
-- triggers, then prove the complete available/sold/hold matrix.
BEGIN;
ALTER TABLE public.bookable_slots DISABLE TRIGGER USER;
ALTER TABLE public.bookable_slots ENABLE TRIGGER guard_teacher_compensation_slot;
ALTER TABLE public.bookable_slot_holds DISABLE TRIGGER USER;
ALTER TABLE public.bookable_slot_holds ENABLE TRIGGER guard_teacher_compensation_hold;

SET LOCAL session_replication_role = replica;
INSERT INTO public.profiles (id, email, role) VALUES
    ('88000000-0000-4000-8000-000000000005', 'comp-guard@test.invalid', 'teacher'),
    ('88000000-0000-4000-8000-000000000006', 'comp-no-engagement@test.invalid', 'teacher');
SET LOCAL session_replication_role = origin;
INSERT INTO public.bookable_slots (
    id, package_id, teacher_id, weekday, local_start_time, timezone_name,
    first_occurrence_at, created_by
) VALUES (
    '88080000-0000-4000-8000-000000000001',
    '88010000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000005',
    EXTRACT(DOW FROM (date_trunc('second', clock_timestamp()) + INTERVAL '30 days')
        AT TIME ZONE 'Europe/Madrid')::SMALLINT,
    ((date_trunc('second', clock_timestamp()) + INTERVAL '30 days')
        AT TIME ZONE 'Europe/Madrid')::TIME(0),
    'Europe/Madrid',
    date_trunc('second', clock_timestamp()) + INTERVAL '30 days',
    '88000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    UPDATE public.bookable_slots
    SET status = 'available', published_at = clock_timestamp(),
        published_by = '88000000-0000-4000-8000-000000000001'
    WHERE id = '88080000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'available_slot_without_engagement_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'teacher_compensation_engagement_required' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.bookable_slots
    SET status = 'sold', published_at = clock_timestamp(),
        published_by = '88000000-0000-4000-8000-000000000001',
        sold_at = clock_timestamp(),
        sold_subscription_id = '88040000-0000-4000-8000-000000000001'
    WHERE id = '88080000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'sold_slot_without_engagement_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'teacher_compensation_engagement_required' THEN RAISE; END IF;
END
$$;

SELECT public.configure_teacher_compensation_engagement(
    '88030000-0000-4000-8000-000000000005',
    '88000000-0000-4000-8000-000000000005',
    'external', :'engagement_from'::TIMESTAMPTZ,
    '88000000-0000-4000-8000-000000000001',
    'Slot and hold guard fixture classification.'
);
UPDATE public.bookable_slots
SET status = 'available', published_at = clock_timestamp(),
    published_by = '88000000-0000-4000-8000-000000000001'
WHERE id = '88080000-0000-4000-8000-000000000001';
UPDATE public.bookable_slots
SET status = 'sold', sold_at = clock_timestamp(),
    sold_subscription_id = '88040000-0000-4000-8000-000000000001'
WHERE id = '88080000-0000-4000-8000-000000000001';

SET LOCAL session_replication_role = replica;
INSERT INTO public.bookable_slots (
    id, package_id, teacher_id, weekday, local_start_time, timezone_name,
    first_occurrence_at, status, published_at, published_by, created_by
) VALUES (
    '88080000-0000-4000-8000-000000000002',
    '88010000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000006',
    EXTRACT(DOW FROM (date_trunc('second', clock_timestamp()) + INTERVAL '31 days')
        AT TIME ZONE 'Europe/Madrid')::SMALLINT,
    ((date_trunc('second', clock_timestamp()) + INTERVAL '31 days')
        AT TIME ZONE 'Europe/Madrid')::TIME(0),
    'Europe/Madrid', date_trunc('second', clock_timestamp()) + INTERVAL '31 days',
    'available', clock_timestamp(), '88000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000001'
), (
    '88080000-0000-4000-8000-000000000003',
    '88010000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000004',
    EXTRACT(DOW FROM (date_trunc('second', clock_timestamp()) + INTERVAL '32 days')
        AT TIME ZONE 'Europe/Madrid')::SMALLINT,
    ((date_trunc('second', clock_timestamp()) + INTERVAL '32 days')
        AT TIME ZONE 'Europe/Madrid')::TIME(0),
    'Europe/Madrid', date_trunc('second', clock_timestamp()) + INTERVAL '32 days',
    'available', clock_timestamp(), '88000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000001'
);
INSERT INTO public.checkout_intents (
    id, opportunity_id, contact_id, student_id, package_price_id, lang,
    legal_policy_version, policy_accepted_at, site_url, status,
    stripe_session_expires_at, expires_at
) VALUES
    ('88090000-0000-4000-8000-000000000001', gen_random_uuid(), gen_random_uuid(),
     '88020000-0000-4000-8000-000000000001', gen_random_uuid(), 'en', 'test-v1',
     clock_timestamp(), 'https://test.invalid', 'creating',
     clock_timestamp() + INTERVAL '30 minutes', clock_timestamp() + INTERVAL '35 minutes'),
    ('88090000-0000-4000-8000-000000000002', gen_random_uuid(), gen_random_uuid(),
     '88020000-0000-4000-8000-000000000002', gen_random_uuid(), 'en', 'test-v1',
     clock_timestamp(), 'https://test.invalid', 'creating',
     clock_timestamp() + INTERVAL '30 minutes', clock_timestamp() + INTERVAL '35 minutes');
SET LOCAL session_replication_role = origin;

DO $$
BEGIN
    INSERT INTO public.bookable_slot_holds (
        slot_id, checkout_intent_id, held_at, expires_at, hold_fingerprint
    ) VALUES (
        '88080000-0000-4000-8000-000000000002',
        '88090000-0000-4000-8000-000000000001',
        clock_timestamp(), clock_timestamp() + INTERVAL '35 minutes',
        'v1:' || repeat('1', 64)
    );
    RAISE EXCEPTION 'hold_without_engagement_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'teacher_compensation_engagement_required' THEN RAISE; END IF;
END
$$;

INSERT INTO public.bookable_slot_holds (
    slot_id, checkout_intent_id, held_at, expires_at, hold_fingerprint
) VALUES (
    '88080000-0000-4000-8000-000000000003',
    '88090000-0000-4000-8000-000000000002',
    clock_timestamp(), clock_timestamp() + INTERVAL '35 minutes',
    'v1:' || repeat('2', 64)
);
ROLLBACK;

-- Ninety-day selection is independent of the ten-active route. Test-only
-- replica mutation is rolled back and never exercises production mutation APIs.
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.subscriptions
SET status = 'cancelled'::public.subscription_status
WHERE id = '88040000-0000-4000-8000-000000000013';
UPDATE public.teacher_compensation_milestones
SET first_ready_initial_at = date_trunc('second', clock_timestamp()) - INTERVAL '91 days',
    ten_active_trigger_cycle_id = NULL,
    ten_active_reached_at = NULL,
    ten_active_students_count = NULL
WHERE policy_version = 1;
DELETE FROM public.teacher_compensation_cycle_terms
WHERE cycle_id = '88060000-0000-4000-8000-000000000012';
SET LOCAL session_replication_role = origin;
SELECT public.reconcile_teacher_compensation_session(
    '88070000-0000-4000-8000-000000000121',
    '88000000-0000-4000-8000-000000000001'
);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_compensation_cycle_terms
        WHERE cycle_id = '88060000-0000-4000-8000-000000000012'
          AND external_class_rate_cents = 2500
          AND rate_basis = 'ninety_days'
    ) THEN
        RAISE EXCEPTION 'ninety_day_threshold_was_not_snapshotted';
    END IF;
END
$$;
ROLLBACK;

DO $$
BEGIN
    IF NOT has_table_privilege(
        'service_role', 'public.teacher_compensation_ledger', 'SELECT'
    ) OR has_table_privilege(
        'service_role', 'public.teacher_compensation_ledger', 'INSERT'
    ) OR has_table_privilege(
        'authenticated', 'public.teacher_compensation_ledger', 'SELECT'
    ) OR has_table_privilege(
        'anon', 'public.teacher_compensation_cycle_terms', 'SELECT'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.configure_teacher_compensation_engagement(uuid,uuid,text,timestamptz,uuid,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.configure_teacher_compensation_engagement(uuid,uuid,text,timestamptz,uuid,text)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.confirm_teacher_compensation_ten_active_history(uuid,text,uuid,integer,uuid,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.confirm_teacher_compensation_ten_active_history(uuid,text,uuid,integer,uuid,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'anon',
        'public.confirm_teacher_compensation_ten_active_history(uuid,text,uuid,integer,uuid,text)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.reconcile_teacher_compensation_session(uuid,uuid)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.reconcile_teacher_compensation_cycle(uuid,uuid)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.reconcile_teacher_compensation_cycle(uuid,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_privileges_are_wrong';
    END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.teacher_compensation_policy_versions
    SET founder_class_rate_cents = 4000
    WHERE version = 1;
    RAISE EXCEPTION 'teacher_compensation_policy_was_mutated';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

-- Cleanup is deliberately trigger-free and idempotent for shared CI databases.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE entity_type = 'teacher_compensation_ledger';
DELETE FROM public.teacher_compensation_ledger
WHERE session_id::TEXT LIKE '88070000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_cycle_terms
WHERE cycle_id::TEXT LIKE '88060000-0000-4000-8000-%'
   OR cycle_id = '77060000-0000-4000-8000-000000000013';
UPDATE public.teacher_compensation_milestones
SET first_ready_initial_cycle_id = NULL,
    first_ready_initial_at = NULL,
    ten_active_trigger_cycle_id = NULL,
    ten_active_reached_at = NULL,
    ten_active_students_count = NULL,
    updated_at = date_trunc('second', clock_timestamp())
WHERE policy_version = 1;
DELETE FROM public.sessions WHERE id::TEXT LIKE '88070000-0000-4000-8000-%';
DELETE FROM public.checkout_v2_cycles
WHERE id::TEXT LIKE '88060000-0000-4000-8000-%'
   OR id = '77060000-0000-4000-8000-000000000013';
DELETE FROM public.payments WHERE id::TEXT LIKE '88050000-0000-4000-8000-%';
DELETE FROM public.subscriptions WHERE id::TEXT LIKE '88040000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_engagements
WHERE id IN (
    SELECT id FROM public.teacher_compensation_engagements
    WHERE teacher_id::TEXT LIKE '88000000-0000-4000-8000-%'
);
DELETE FROM public.packages WHERE id = '88010000-0000-4000-8000-000000000001';
DELETE FROM public.profiles
WHERE id::TEXT LIKE '88000000-0000-4000-8000-%'
   OR id::TEXT LIKE '88020000-0000-4000-8000-%';
COMMIT;
