\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE EXTENSION IF NOT EXISTS dblink;

SELECT date_trunc('minute', clock_timestamp()) - INTERVAL '30 days' AS engagement_from,
       date_trunc('minute', clock_timestamp()) - INTERVAL '10 days' AS work_start,
       date_trunc('minute', clock_timestamp()) - INTERVAL '5 days' AS later_engagement
\gset

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE (
    entity_type = 'teacher_compensation_work_adjustments'
    AND entity_id IN (
        SELECT id::TEXT FROM public.teacher_compensation_work_adjustments
        WHERE request_id::TEXT LIKE '99030000-0000-4000-8000-%'
    )
) OR (
    entity_type = 'teacher_compensation_work_ledger'
    AND entity_id IN (
        SELECT id::TEXT FROM public.teacher_compensation_work_ledger
        WHERE request_id::TEXT LIKE '99020000-0000-4000-8000-%'
    )
) OR (
    entity_type = 'teacher_compensation_ledger'
    AND entity_id IN (
        SELECT id::TEXT FROM public.teacher_compensation_ledger
        WHERE session_id::TEXT LIKE '99080000-0000-4000-8000-%'
    )
);
DELETE FROM public.teacher_compensation_work_adjustments
WHERE request_id::TEXT LIKE '99030000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_work_ledger
WHERE request_id::TEXT LIKE '99020000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_ledger
WHERE session_id::TEXT LIKE '99080000-0000-4000-8000-%';
DELETE FROM public.sessions WHERE id::TEXT LIKE '99080000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_cycle_terms
WHERE cycle_id::TEXT LIKE '99070000-0000-4000-8000-%';
DELETE FROM public.checkout_v2_cycles WHERE id::TEXT LIKE '99070000-0000-4000-8000-%';
DELETE FROM public.payments WHERE id::TEXT LIKE '99060000-0000-4000-8000-%';
DELETE FROM public.subscriptions WHERE id::TEXT LIKE '99050000-0000-4000-8000-%';
DELETE FROM public.packages WHERE id::TEXT LIKE '99040000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_engagements
WHERE request_id::TEXT LIKE '99010000-0000-4000-8000-%';
DELETE FROM public.profiles WHERE id::TEXT LIKE '99000000-0000-4000-8000-%';

INSERT INTO public.profiles (id, email, full_name, role) VALUES
    ('99000000-0000-4000-8000-000000000001', 'work-admin@test.invalid', 'Work Admin', 'admin'),
    ('99000000-0000-4000-8000-000000000002', 'work-teacher@test.invalid', 'Work Teacher', 'teacher'),
    ('99000000-0000-4000-8000-000000000003', 'work-crossing@test.invalid', 'Crossing Teacher', 'teacher'),
    ('99000000-0000-4000-8000-000000000004', 'work-concurrent@test.invalid', 'Concurrent Teacher', 'teacher'),
    ('99000000-0000-4000-8000-000000000005', 'work-student@test.invalid', 'Work Student', 'student');

INSERT INTO public.packages (
    id, name, display_name, price_monthly, sessions_per_month,
    contract_schema_version, amount_cents, billing_interval_unit,
    billing_interval_count, sessions_per_period, class_duration_minutes
) VALUES (
    '99040000-0000-4000-8000-000000000001',
    'teacher_compensation_operations_test', '{"en":"Operations test"}'::JSONB,
    25900, 4, 2, 25900, 'day', 28, 4, 50
);
INSERT INTO public.subscriptions (
    id, student_id, package_id, status, starts_at, ends_at,
    sessions_total, contracted_sessions_per_period, contract_schema_version,
    billing_interval_unit, billing_interval_count, class_duration_minutes
) VALUES (
    '99050000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000005',
    '99040000-0000-4000-8000-000000000001',
    'active', CURRENT_DATE - 7, CURRENT_DATE + 21,
    4, 4, 2, 'day', 28, 50
);
INSERT INTO public.payments (
    id, student_id, subscription_id, amount, currency, status,
    stripe_invoice_id
) VALUES (
    '99060000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000005',
    '99050000-0000-4000-8000-000000000001',
    25900, 'eur', 'succeeded', 'in_ops_candidates_001'
);
INSERT INTO public.checkout_v2_cycles (
    id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
    stripe_price_id, stripe_invoice_id, payment_id,
    materialization_state, sessions_materialized_at
) VALUES (
    '99070000-0000-4000-8000-000000000001',
    '99050000-0000-4000-8000-000000000001',
    1, 'initial',
    date_trunc('minute', clock_timestamp()) - INTERVAL '7 days',
    date_trunc('minute', clock_timestamp()) + INTERVAL '21 days',
    'price_ops_candidates_001', 'in_ops_candidates_001',
    '99060000-0000-4000-8000-000000000001',
    'ready', date_trunc('minute', clock_timestamp()) - INTERVAL '7 days'
);
UPDATE public.payments
SET checkout_v2_cycle_id = '99070000-0000-4000-8000-000000000001'
WHERE id = '99060000-0000-4000-8000-000000000001';
INSERT INTO public.teacher_compensation_cycle_terms (
    cycle_id, policy_version, founder_class_rate_cents,
    external_class_rate_cents, currency, rate_basis,
    threshold_effective_at, active_students_observed
) VALUES (
    '99070000-0000-4000-8000-000000000001',
    1, 4000, 2000, 'eur', 'initial', NULL, 1
);
INSERT INTO public.sessions (
    id, subscription_id, student_id, teacher_id, scheduled_at,
    duration_minutes, status, completed_at, no_show_at,
    cancelled_at, cancelled_by, cancellation_reason,
    checkout_v2_cycle_id, checkout_v2_cycle_session_index
) VALUES
    (
        '99080000-0000-4000-8000-000000000001',
        '99050000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000005',
        '99000000-0000-4000-8000-000000000002',
        date_trunc('minute', clock_timestamp()) - INTERVAL '4 hours',
        50, 'completed',
        date_trunc('minute', clock_timestamp()) - INTERVAL '3 hours',
        NULL, NULL, NULL, NULL,
        '99070000-0000-4000-8000-000000000001', 1
    ),
    (
        '99080000-0000-4000-8000-000000000002',
        '99050000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000005',
        '99000000-0000-4000-8000-000000000002',
        date_trunc('minute', clock_timestamp()) - INTERVAL '3 hours',
        50, 'no_show', NULL,
        date_trunc('minute', clock_timestamp()) - INTERVAL '2 hours 30 minutes',
        NULL, NULL, NULL,
        '99070000-0000-4000-8000-000000000001', 2
    ),
    (
        '99080000-0000-4000-8000-000000000003',
        '99050000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000005',
        '99000000-0000-4000-8000-000000000002',
        date_trunc('minute', clock_timestamp()) + INTERVAL '12 hours',
        50, 'cancelled', NULL, NULL,
        date_trunc('minute', clock_timestamp()) - INTERVAL '1 hour',
        '99000000-0000-4000-8000-000000000005', 'student_late',
        '99070000-0000-4000-8000-000000000001', 3
    ),
    (
        '99080000-0000-4000-8000-000000000004',
        '99050000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000005',
        '99000000-0000-4000-8000-000000000002',
        date_trunc('minute', clock_timestamp()) + INTERVAL '12 hours',
        50, 'cancelled', NULL, NULL,
        date_trunc('minute', clock_timestamp()) - INTERVAL '1 hour',
        '99000000-0000-4000-8000-000000000002', 'teacher_cancelled',
        '99070000-0000-4000-8000-000000000001', 4
    );
COMMIT;

SELECT public.configure_teacher_compensation_engagement(
    '99010000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000002',
    'external', :'engagement_from'::TIMESTAMPTZ,
    '99000000-0000-4000-8000-000000000001',
    'External teacher for mandatory work tests.'
);
SELECT public.configure_teacher_compensation_engagement(
    '99010000-0000-4000-8000-000000000002',
    '99000000-0000-4000-8000-000000000003',
    'founder', :'engagement_from'::TIMESTAMPTZ,
    '99000000-0000-4000-8000-000000000001',
    'Founder used for crossing-engagement tests.'
);
SELECT public.configure_teacher_compensation_engagement(
    '99010000-0000-4000-8000-000000000003',
    '99000000-0000-4000-8000-000000000004',
    'external', :'engagement_from'::TIMESTAMPTZ,
    '99000000-0000-4000-8000-000000000001',
    'External teacher used for concurrency tests.'
);

DO $$
BEGIN
    IF (SELECT COUNT(*)
        FROM public.teacher_compensation_session_reconciliation_candidates
        WHERE session_id::TEXT LIKE '99080000-0000-4000-8000-%') <> 3
       OR NOT EXISTS (
            SELECT 1
            FROM public.teacher_compensation_session_reconciliation_candidates
            WHERE session_id = '99080000-0000-4000-8000-000000000001'
              AND event_kind = 'class_completed'
              AND teacher_full_name = 'Work Teacher'
              AND teacher_email = 'work-teacher@test.invalid'
              AND student_full_name = 'Work Student'
              AND student_email = 'work-student@test.invalid'
       )
       OR EXISTS (
            SELECT 1
            FROM public.teacher_compensation_session_reconciliation_candidates
            WHERE session_id = '99080000-0000-4000-8000-000000000004'
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_reconciliation_candidates_are_wrong';
    END IF;
END
$$;

-- Each database precondition used by accrual also removes the row from the
-- reconciliation candidate view; the fixture is restored after every probe.
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.sessions SET duration_minutes = 40
WHERE id = '99080000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_with_wrong_duration_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.checkout_v2_cycles
SET materialization_state = 'pending', sessions_materialized_at = NULL
WHERE id = '99070000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_with_unready_cycle_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.payments SET status = 'failed'
WHERE id = '99060000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_without_succeeded_payment_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.payments SET amount = 25899
WHERE id = '99060000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_with_wrong_payment_amount_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.payments SET currency = 'usd'
WHERE id = '99060000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_with_wrong_payment_currency_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.payments SET checkout_v2_cycle_id = NULL
WHERE id = '99060000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_with_unbound_payment_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.teacher_compensation_cycle_terms
WHERE cycle_id = '99070000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_without_cycle_terms_was_exposed';
    END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.teacher_compensation_engagements
SET effective_from = date_trunc('minute', clock_timestamp())
WHERE request_id = '99010000-0000-4000-8000-000000000001';
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_without_applicable_engagement_was_exposed';
    END IF;
END $$;
ROLLBACK;

SELECT public.reconcile_teacher_compensation_session(
    '99080000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000001'
);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.teacher_compensation_session_reconciliation_candidates
               WHERE session_id = '99080000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'candidate_with_existing_ledger_was_exposed';
    END IF;
END $$;

-- A valid hour freezes the engagement, exact interval, rate, and amount.
SELECT public.record_teacher_compensation_work(
    '99020000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000002',
    'mandatory_training',
    :'work_start'::TIMESTAMPTZ,
    :'work_start'::TIMESTAMPTZ + INTERVAL '60 minutes',
    'Mandatory launch training for the teaching method.',
    '99000000-0000-4000-8000-000000000001'
);
SELECT public.record_teacher_compensation_work(
    '99020000-0000-4000-8000-000000000001',
    '99000000-0000-4000-8000-000000000002',
    'mandatory_training',
    :'work_start'::TIMESTAMPTZ,
    :'work_start'::TIMESTAMPTZ + INTERVAL '60 minutes',
    'Mandatory launch training for the teaching method.',
    '99000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.teacher_compensation_work_ledger
        WHERE request_id = '99020000-0000-4000-8000-000000000001') <> 1
       OR NOT EXISTS (
            SELECT 1
            FROM public.teacher_compensation_work_ledger AS work_entry
            JOIN public.teacher_compensation_engagements AS engagement
              ON engagement.id = work_entry.engagement_id
            WHERE work_entry.request_id = '99020000-0000-4000-8000-000000000001'
              AND work_entry.duration_minutes = 60
              AND work_entry.rate_cents_per_minute = 25
              AND work_entry.amount_cents = 1500
              AND work_entry.currency = 'eur'
              AND work_entry.engagement_kind = 'external'
              AND engagement.teacher_id = work_entry.teacher_id
       ) THEN
        RAISE EXCEPTION 'mandatory_work_snapshot_is_wrong';
    END IF;
END
$$;

DO $$
BEGIN
    INSERT INTO public.teacher_compensation_work_ledger (
        request_id, teacher_id, engagement_id, engagement_kind, work_kind,
        started_at, ended_at, duration_minutes, policy_version,
        rate_cents_per_minute, amount_cents, currency, description, recorded_by
    )
    SELECT
        gen_random_uuid(),
        '99000000-0000-4000-8000-000000000003',
        engagement_id,
        engagement_kind,
        work_kind,
        started_at,
        ended_at,
        duration_minutes,
        policy_version,
        rate_cents_per_minute,
        amount_cents,
        currency,
        'A mismatched engagement identity must fail at the table boundary.',
        recorded_by
    FROM public.teacher_compensation_work_ledger
    WHERE request_id = '99020000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'mismatched_work_engagement_identity_was_accepted';
EXCEPTION WHEN foreign_key_violation THEN
    NULL;
END
$$;

-- Half-open intervals allow adjacency but reject any overlap for one teacher.
SELECT public.record_teacher_compensation_work(
    '99020000-0000-4000-8000-000000000004',
    '99000000-0000-4000-8000-000000000002',
    'mandatory_meeting',
    :'work_start'::TIMESTAMPTZ + INTERVAL '60 minutes',
    :'work_start'::TIMESTAMPTZ + INTERVAL '90 minutes',
    'Mandatory meeting adjacent to the completed training.',
    '99000000-0000-4000-8000-000000000001'
);
DO $$
BEGIN
    PERFORM public.record_teacher_compensation_work(
        gen_random_uuid(), '99000000-0000-4000-8000-000000000002',
        'mandatory_meeting',
        (SELECT started_at + INTERVAL '30 minutes'
         FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        (SELECT ended_at + INTERVAL '15 minutes'
         FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        'This interval overlaps work that is already frozen.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'overlapping_teacher_work_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.record_teacher_compensation_work(
        '99020000-0000-4000-8000-000000000001',
        '99000000-0000-4000-8000-000000000002',
        'mandatory_meeting',
        (SELECT started_at FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        (SELECT ended_at FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        'Changed replay must fail instead of rewriting work.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'changed_work_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

-- Invalid categories, fractional-minute intervals, and non-admin actors fail.
DO $$
BEGIN
    PERFORM public.record_teacher_compensation_work(
        gen_random_uuid(), '99000000-0000-4000-8000-000000000002',
        'marketing',
        (SELECT started_at FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        (SELECT started_at + INTERVAL '10 minutes'
         FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        'Marketing is outside the mandatory teacher-work policy.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'unsupported_work_kind_was_accepted';
EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_teacher_compensation_work' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.record_teacher_compensation_work(
        gen_random_uuid(), '99000000-0000-4000-8000-000000000002',
        'mandatory_meeting',
        (SELECT started_at FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        (SELECT started_at + INTERVAL '10 minutes 30 seconds'
         FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        'A fractional minute interval must not be rounded.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'fractional_work_interval_was_accepted';
EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_teacher_compensation_work' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.record_teacher_compensation_work(
        gen_random_uuid(), '99000000-0000-4000-8000-000000000002',
        'mandatory_meeting',
        (SELECT started_at FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        (SELECT started_at + INTERVAL '10 minutes'
         FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        'A student cannot record a teacher obligation.',
        '99000000-0000-4000-8000-000000000005'
    );
    RAISE EXCEPTION 'non_admin_work_actor_was_accepted';
EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'teacher_compensation_work_forbidden' THEN RAISE; END IF;
END
$$;

-- A work interval may not cross a later engagement classification.
SELECT public.configure_teacher_compensation_engagement(
    '99010000-0000-4000-8000-000000000004',
    '99000000-0000-4000-8000-000000000003',
    'external', :'later_engagement'::TIMESTAMPTZ,
    '99000000-0000-4000-8000-000000000001',
    'Later classification used to reject a crossing interval.'
);
DO $$
BEGIN
    PERFORM public.record_teacher_compensation_work(
        gen_random_uuid(), '99000000-0000-4000-8000-000000000003',
        'mandatory_meeting',
        (SELECT effective_from - INTERVAL '30 minutes'
         FROM public.teacher_compensation_engagements
         WHERE request_id = '99010000-0000-4000-8000-000000000004'),
        (SELECT effective_from + INTERVAL '30 minutes'
         FROM public.teacher_compensation_engagements
         WHERE request_id = '99010000-0000-4000-8000-000000000004'),
        'This meeting crosses a classification boundary.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'crossing_engagement_work_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

-- A later retroactive engagement cannot enter already-frozen work history.
SELECT public.record_teacher_compensation_work(
    '99020000-0000-4000-8000-000000000002',
    '99000000-0000-4000-8000-000000000004',
    'mandatory_meeting',
    :'work_start'::TIMESTAMPTZ,
    :'work_start'::TIMESTAMPTZ + INTERVAL '30 minutes',
    'Mandatory meeting that freezes its effective engagement.',
    '99000000-0000-4000-8000-000000000001'
);
DO $$
BEGIN
    PERFORM public.configure_teacher_compensation_engagement(
        gen_random_uuid(), '99000000-0000-4000-8000-000000000004',
        'founder',
        (SELECT started_at + INTERVAL '15 minutes'
         FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000002'),
        '99000000-0000-4000-8000-000000000001',
        'This classification would rewrite frozen work history.'
    );
    RAISE EXCEPTION 'retroactive_work_engagement_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

-- Corrections are append-only, exact-on-replay, and cannot make minutes negative.
SELECT public.adjust_teacher_compensation_work(
    '99030000-0000-4000-8000-000000000001',
    (SELECT id FROM public.teacher_compensation_work_ledger
     WHERE request_id = '99020000-0000-4000-8000-000000000001'),
    -15,
    'Correct the training duration from sixty to forty-five minutes.',
    '99000000-0000-4000-8000-000000000001'
);
SELECT public.adjust_teacher_compensation_work(
    '99030000-0000-4000-8000-000000000001',
    (SELECT id FROM public.teacher_compensation_work_ledger
     WHERE request_id = '99020000-0000-4000-8000-000000000001'),
    -15,
    'Correct the training duration from sixty to forty-five minutes.',
    '99000000-0000-4000-8000-000000000001'
);

DO $$
DECLARE
    target_id UUID := (SELECT id FROM public.teacher_compensation_work_ledger
                       WHERE request_id = '99020000-0000-4000-8000-000000000001');
BEGIN
    IF (SELECT COUNT(*) FROM public.teacher_compensation_work_adjustments
        WHERE request_id = '99030000-0000-4000-8000-000000000001') <> 1
       OR (SELECT duration_minutes FROM public.teacher_compensation_work_ledger
           WHERE id = target_id)
          + (SELECT SUM(minutes_delta) FROM public.teacher_compensation_work_adjustments
             WHERE work_entry_id = target_id) <> 45
       OR (SELECT amount_delta_cents FROM public.teacher_compensation_work_adjustments
           WHERE request_id = '99030000-0000-4000-8000-000000000001') <> -375 THEN
        RAISE EXCEPTION 'work_adjustment_snapshot_is_wrong';
    END IF;
END
$$;

DO $$
BEGIN
    INSERT INTO public.teacher_compensation_work_adjustments (
        request_id, work_entry_id, teacher_id, minutes_delta,
        policy_version, rate_cents_per_minute, amount_delta_cents,
        currency, reason, recorded_by
    )
    SELECT
        gen_random_uuid(),
        work_entry_id,
        '99000000-0000-4000-8000-000000000003',
        1,
        policy_version,
        rate_cents_per_minute,
        rate_cents_per_minute,
        currency,
        'A mismatched work-entry teacher must fail at the table boundary.',
        recorded_by
    FROM public.teacher_compensation_work_adjustments
    WHERE request_id = '99030000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'mismatched_work_adjustment_identity_was_accepted';
EXCEPTION WHEN foreign_key_violation THEN
    NULL;
END
$$;

DO $$
BEGIN
    PERFORM public.adjust_teacher_compensation_work(
        '99030000-0000-4000-8000-000000000001',
        (SELECT id FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        -10, 'Changed adjustment replay must fail.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'changed_adjustment_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.adjust_teacher_compensation_work(
        gen_random_uuid(),
        (SELECT id FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        -46, 'This correction would produce a negative minute balance.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'negative_work_balance_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'teacher_compensation_work_adjustment_balance_out_of_range' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.adjust_teacher_compensation_work(
        gen_random_uuid(),
        (SELECT id FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        676, 'This correction would exceed the twelve-hour safety cap.',
        '99000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'positive_work_overadjustment_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'teacher_compensation_work_adjustment_balance_out_of_range' THEN RAISE; END IF;
END
$$;

-- Two concurrent exact requests converge on one row.
SELECT format(
    'host=%s port=%s dbname=%s user=%s password=postgres sslmode=disable',
    COALESCE(host(inet_server_addr()), '127.0.0.1'),
    inet_server_port(), current_database(), current_user
) AS compensation_work_dblink_connection
\gset

SELECT dblink_connect('compensation_work_race_one', :'compensation_work_dblink_connection');
SELECT dblink_connect('compensation_work_race_two', :'compensation_work_dblink_connection');
SELECT dblink_send_query('compensation_work_race_one', format($race$
    WITH recorded AS MATERIALIZED (
        SELECT public.record_teacher_compensation_work(
            '99020000-0000-4000-8000-000000000003',
            '99000000-0000-4000-8000-000000000004',
            'mandatory_training', %L::TIMESTAMPTZ + INTERVAL '30 minutes',
            %L::TIMESTAMPTZ + INTERVAL '50 minutes',
            'Concurrent mandatory training exact request.',
            '99000000-0000-4000-8000-000000000001'
        ) AS entry
    ), lock_held AS MATERIALIZED (
        SELECT pg_sleep(0.75) FROM recorded
    )
    SELECT (entry).id FROM recorded CROSS JOIN lock_held
$race$, :'work_start', :'work_start'));
SELECT pg_sleep(0.10);
SELECT dblink_send_query('compensation_work_race_two', format($race$
    SELECT (public.record_teacher_compensation_work(
        '99020000-0000-4000-8000-000000000003',
        '99000000-0000-4000-8000-000000000004',
        'mandatory_training', %L::TIMESTAMPTZ + INTERVAL '30 minutes',
        %L::TIMESTAMPTZ + INTERVAL '50 minutes',
        'Concurrent mandatory training exact request.',
        '99000000-0000-4000-8000-000000000001'
    )).id
$race$, :'work_start', :'work_start'));
SELECT * FROM dblink_get_result('compensation_work_race_one') AS result(entry_id UUID);
SELECT * FROM dblink_get_result('compensation_work_race_two') AS result(entry_id UUID);
SELECT * FROM dblink_get_result('compensation_work_race_one') AS result(entry_id UUID);
SELECT * FROM dblink_get_result('compensation_work_race_two') AS result(entry_id UUID);

-- Two distinct corrections racing from 45 minutes toward the 720-minute cap
-- serialize on the work entry: exactly one reaches 720 and the other fails.
SELECT dblink_send_query('compensation_work_race_one', $race$
    WITH adjusted AS MATERIALIZED (
        SELECT public.adjust_teacher_compensation_work(
            '99030000-0000-4000-8000-000000000002',
            (SELECT id FROM public.teacher_compensation_work_ledger
             WHERE request_id = '99020000-0000-4000-8000-000000000001'),
            675,
            'First concurrent correction toward the safety cap.',
            '99000000-0000-4000-8000-000000000001'
        ) AS entry
    ), lock_held AS MATERIALIZED (
        SELECT pg_sleep(0.75) FROM adjusted
    )
    SELECT (entry).id FROM adjusted CROSS JOIN lock_held
$race$);
SELECT pg_sleep(0.10);
SELECT dblink_send_query('compensation_work_race_two', $race$
    SELECT (public.adjust_teacher_compensation_work(
        '99030000-0000-4000-8000-000000000003',
        (SELECT id FROM public.teacher_compensation_work_ledger
         WHERE request_id = '99020000-0000-4000-8000-000000000001'),
        675,
        'Second concurrent correction toward the safety cap.',
        '99000000-0000-4000-8000-000000000001'
    )).id
$race$);
SELECT * FROM dblink_get_result('compensation_work_race_one') AS result(entry_id UUID);
DO $$
BEGIN
    PERFORM result.entry_id
    FROM dblink_get_result('compensation_work_race_two') AS result(entry_id UUID);
    RAISE EXCEPTION 'concurrent_positive_adjustments_both_succeeded';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%teacher_compensation_work_adjustment_balance_out_of_range%' THEN
        RAISE;
    END IF;
END
$$;
SELECT dblink_disconnect('compensation_work_race_one');
SELECT dblink_disconnect('compensation_work_race_two');

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.teacher_compensation_work_ledger
        WHERE request_id = '99020000-0000-4000-8000-000000000003') <> 1 THEN
        RAISE EXCEPTION 'concurrent_work_record_was_not_exactly_once';
    END IF;
    IF (SELECT COUNT(*) FROM public.teacher_compensation_work_adjustments
        WHERE request_id IN (
            '99030000-0000-4000-8000-000000000002',
            '99030000-0000-4000-8000-000000000003'
        )) <> 1
       OR (
            SELECT work_entry.duration_minutes
                + COALESCE(SUM(adjustment.minutes_delta), 0)
            FROM public.teacher_compensation_work_ledger AS work_entry
            LEFT JOIN public.teacher_compensation_work_adjustments AS adjustment
              ON adjustment.work_entry_id = work_entry.id
            WHERE work_entry.request_id = '99020000-0000-4000-8000-000000000001'
            GROUP BY work_entry.duration_minutes
       ) <> 720 THEN
        RAISE EXCEPTION 'concurrent_work_adjustment_cap_was_not_serialized';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM public.teacher_compensation_work_balances
        WHERE request_id = '99020000-0000-4000-8000-000000000001'
          AND duration_minutes = 60
          AND amount_cents = 1500
          AND adjustment_minutes = 660
          AND adjusted_minutes = 720
          AND adjustment_amount_cents = 16500
          AND adjusted_amount_cents = 18000
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.teacher_compensation_work_balances
        WHERE request_id = '99020000-0000-4000-8000-000000000004'
          AND adjustment_minutes = 0
          AND adjusted_minutes = duration_minutes
          AND adjustment_amount_cents = 0
          AND adjusted_amount_cents = amount_cents
    ) THEN
        RAISE EXCEPTION 'teacher_compensation_work_balances_are_wrong';
    END IF;
END
$$;

-- Direct mutation is impossible and each first insert is audited once.
DO $$
BEGIN
    UPDATE public.teacher_compensation_work_ledger
    SET description = description
    WHERE request_id = '99020000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'work_ledger_was_mutated';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;
DO $$
BEGIN
    DELETE FROM public.teacher_compensation_work_adjustments
    WHERE request_id = '99030000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'work_adjustment_was_deleted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.admin_audit_log
        WHERE entity_type = 'teacher_compensation_work_ledger'
          AND entity_id IN (
              SELECT id::TEXT FROM public.teacher_compensation_work_ledger
              WHERE request_id::TEXT LIKE '99020000-0000-4000-8000-%'
          )) <> 4
       OR (SELECT COUNT(*) FROM public.admin_audit_log
           WHERE entity_type = 'teacher_compensation_work_adjustments'
             AND entity_id IN (
                 SELECT id::TEXT FROM public.teacher_compensation_work_adjustments
                 WHERE request_id::TEXT LIKE '99030000-0000-4000-8000-%'
             )) <> 2 THEN
        RAISE EXCEPTION 'teacher_work_audit_log_is_wrong';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT has_table_privilege(
        'service_role', 'public.teacher_compensation_work_ledger', 'SELECT'
    ) OR has_table_privilege(
        'service_role', 'public.teacher_compensation_work_ledger', 'INSERT'
    ) OR has_table_privilege(
        'authenticated', 'public.teacher_compensation_work_ledger', 'SELECT'
    ) OR has_table_privilege(
        'anon', 'public.teacher_compensation_work_adjustments', 'SELECT'
    ) OR NOT has_table_privilege(
        'service_role',
        'public.teacher_compensation_session_reconciliation_candidates',
        'SELECT'
    ) OR has_table_privilege(
        'authenticated',
        'public.teacher_compensation_session_reconciliation_candidates',
        'SELECT'
    ) OR NOT has_table_privilege(
        'service_role', 'public.teacher_compensation_work_balances', 'SELECT'
    ) OR has_table_privilege(
        'authenticated', 'public.teacher_compensation_work_balances', 'SELECT'
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class
        WHERE oid = 'public.teacher_compensation_session_reconciliation_candidates'::REGCLASS
          AND reloptions @> ARRAY['security_invoker=true']
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class
        WHERE oid = 'public.teacher_compensation_work_balances'::REGCLASS
          AND reloptions @> ARRAY['security_invoker=true']
    ) OR NOT has_function_privilege(
        'service_role',
        'public.record_teacher_compensation_work(uuid,uuid,text,timestamptz,timestamptz,text,uuid)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.record_teacher_compensation_work(uuid,uuid,text,timestamptz,timestamptz,text,uuid)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.adjust_teacher_compensation_work(uuid,uuid,integer,text,uuid)',
        'EXECUTE'
    ) OR has_function_privilege(
        'anon',
        'public.adjust_teacher_compensation_work(uuid,uuid,integer,text,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'teacher_work_privileges_are_wrong';
    END IF;
END
$$;

-- Cleanup is trigger-free and idempotent for the shared fresh/incremental suites.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE (
    entity_type = 'teacher_compensation_work_adjustments'
    AND entity_id IN (
        SELECT id::TEXT FROM public.teacher_compensation_work_adjustments
        WHERE request_id::TEXT LIKE '99030000-0000-4000-8000-%'
    )
) OR (
    entity_type = 'teacher_compensation_work_ledger'
    AND entity_id IN (
        SELECT id::TEXT FROM public.teacher_compensation_work_ledger
        WHERE request_id::TEXT LIKE '99020000-0000-4000-8000-%'
    )
) OR (
    entity_type = 'teacher_compensation_ledger'
    AND entity_id IN (
        SELECT id::TEXT FROM public.teacher_compensation_ledger
        WHERE session_id::TEXT LIKE '99080000-0000-4000-8000-%'
    )
);
DELETE FROM public.teacher_compensation_work_adjustments
WHERE request_id::TEXT LIKE '99030000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_work_ledger
WHERE request_id::TEXT LIKE '99020000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_ledger
WHERE session_id::TEXT LIKE '99080000-0000-4000-8000-%';
DELETE FROM public.sessions WHERE id::TEXT LIKE '99080000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_cycle_terms
WHERE cycle_id::TEXT LIKE '99070000-0000-4000-8000-%';
DELETE FROM public.checkout_v2_cycles WHERE id::TEXT LIKE '99070000-0000-4000-8000-%';
DELETE FROM public.payments WHERE id::TEXT LIKE '99060000-0000-4000-8000-%';
DELETE FROM public.subscriptions WHERE id::TEXT LIKE '99050000-0000-4000-8000-%';
DELETE FROM public.packages WHERE id::TEXT LIKE '99040000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_engagements
WHERE request_id::TEXT LIKE '99010000-0000-4000-8000-%';
DELETE FROM public.profiles
WHERE id::TEXT LIKE '99000000-0000-4000-8000-%';
COMMIT;
