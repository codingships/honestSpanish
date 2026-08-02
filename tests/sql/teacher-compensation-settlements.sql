\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- The fixture is intentionally independent from the earlier compensation
-- contract tests. Foreign-key dependencies that do not affect settlement
-- behaviour are represented by fixed UUIDs while replica mode is active.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE action IN (
    'close_teacher_compensation_settlement',
    'record_teacher_compensation_settlement_payment',
    'void_teacher_compensation_settlement_payment'
) AND entity_id IN (
    SELECT id::TEXT FROM public.teacher_compensation_settlements
    WHERE request_id::TEXT LIKE '99410000-0000-4000-8000-%'
    UNION ALL
    SELECT id::TEXT FROM public.teacher_compensation_settlement_payments
    WHERE request_id::TEXT LIKE '99420000-0000-4000-8000-%'
    UNION ALL
    SELECT id::TEXT FROM public.teacher_compensation_settlement_payment_voids
    WHERE request_id::TEXT LIKE '99430000-0000-4000-8000-%'
);
DELETE FROM public.teacher_compensation_settlement_payment_voids
WHERE request_id::TEXT LIKE '99430000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_settlement_payments
WHERE request_id::TEXT LIKE '99420000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_settlement_lines
WHERE settlement_id IN (
    SELECT id FROM public.teacher_compensation_settlements
    WHERE request_id::TEXT LIKE '99410000-0000-4000-8000-%'
);
DELETE FROM public.teacher_compensation_settlements
WHERE request_id::TEXT LIKE '99410000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_work_adjustments
WHERE request_id::TEXT LIKE '99402000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_work_ledger
WHERE request_id::TEXT LIKE '99401000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_ledger
WHERE idempotency_key LIKE 'session:99400000-0000-4000-8000-%';
DELETE FROM public.teacher_compensation_engagements
WHERE request_id::TEXT LIKE '99400100-0000-4000-8000-%';
DELETE FROM public.profiles WHERE id::TEXT LIKE '99400000-0000-4000-8000-%';

INSERT INTO public.profiles (id, email, full_name, role) VALUES
    ('99400000-0000-4000-8000-000000000001', 'settlement-admin@test.invalid', 'Settlement Admin', 'admin'),
    ('99400000-0000-4000-8000-000000000002', 'settlement-teacher@test.invalid', 'Settlement Teacher', 'teacher'),
    ('99400000-0000-4000-8000-000000000003', 'chronology-teacher@test.invalid', 'Chronology Teacher', 'teacher'),
    ('99400000-0000-4000-8000-000000000004', 'settlement-student@test.invalid', 'Settlement Student', 'student');

INSERT INTO public.teacher_compensation_engagements (
    id, request_id, teacher_id, engagement_kind, effective_from,
    configured_by, reason, created_at
) VALUES
    (
        '99400100-0000-4000-8000-000000000001',
        '99400100-0000-4000-8000-000000000011',
        '99400000-0000-4000-8000-000000000002', 'external',
        '2024-01-01 00:00:00+00',
        '99400000-0000-4000-8000-000000000001',
        'Settlement contract test engagement.', '2024-01-01 00:00:00+00'
    ),
    (
        '99400100-0000-4000-8000-000000000002',
        '99400100-0000-4000-8000-000000000012',
        '99400000-0000-4000-8000-000000000003', 'external',
        '2024-01-01 00:00:00+00',
        '99400000-0000-4000-8000-000000000001',
        'Chronological close contract test engagement.', '2024-01-01 00:00:00+00'
    );

INSERT INTO public.teacher_compensation_ledger (
    id, idempotency_key, session_id, teacher_id, student_id,
    subscription_id, cycle_id, cycle_terms_id, engagement_id,
    engagement_kind, event_kind, session_status, scheduled_at,
    source_occurred_at, completed_at, class_rate_cents, amount_cents,
    currency, created_at
) VALUES (
    '99400000-0000-4000-8000-000000000101',
    'session:99400000-0000-4000-8000-000000000111',
    '99400000-0000-4000-8000-000000000111',
    '99400000-0000-4000-8000-000000000002',
    '99400000-0000-4000-8000-000000000004',
    '99400000-0000-4000-8000-000000000121',
    '99400000-0000-4000-8000-000000000131',
    '99400000-0000-4000-8000-000000000131',
    '99400100-0000-4000-8000-000000000001',
    'external', 'class_completed', 'completed',
    '2025-01-15 09:00:00+00', '2025-01-15 10:00:00+00',
    '2025-01-15 10:00:00+00', 2000, 2000, 'eur',
    '2025-01-15 10:00:00+00'
);

INSERT INTO public.teacher_compensation_work_ledger (
    id, request_id, teacher_id, engagement_id, engagement_kind, work_kind,
    started_at, ended_at, duration_minutes, policy_version,
    rate_cents_per_minute, amount_cents, currency, description,
    recorded_by, created_at
) VALUES
    (
        '99401000-0000-4000-8000-000000000001',
        '99401000-0000-4000-8000-000000000011',
        '99400000-0000-4000-8000-000000000002',
        '99400100-0000-4000-8000-000000000001', 'external',
        'mandatory_training', '2025-01-16 10:00:00+00',
        '2025-01-16 11:00:00+00', 60, 1, 25, 1500, 'eur',
        'Mandatory settlement test training.',
        '99400000-0000-4000-8000-000000000001',
        '2025-01-16 11:00:00+00'
    ),
    (
        '99401000-0000-4000-8000-000000000002',
        '99401000-0000-4000-8000-000000000012',
        '99400000-0000-4000-8000-000000000003',
        '99400100-0000-4000-8000-000000000002', 'external',
        'mandatory_meeting', '2024-12-15 10:00:00+00',
        '2024-12-15 10:30:00+00', 30, 1, 25, 750, 'eur',
        'Older mandatory meeting for chronology.',
        '99400000-0000-4000-8000-000000000001',
        '2024-12-15 10:30:00+00'
    ),
    (
        '99401000-0000-4000-8000-000000000003',
        '99401000-0000-4000-8000-000000000013',
        '99400000-0000-4000-8000-000000000003',
        '99400100-0000-4000-8000-000000000002', 'external',
        'mandatory_meeting', '2025-01-20 10:00:00+00',
        '2025-01-20 10:30:00+00', 30, 1, 25, 750, 'eur',
        'Later mandatory meeting for chronology.',
        '99400000-0000-4000-8000-000000000001',
        '2025-01-20 10:30:00+00'
    );

INSERT INTO public.teacher_compensation_work_adjustments (
    id, request_id, work_entry_id, teacher_id, minutes_delta,
    policy_version, rate_cents_per_minute, amount_delta_cents, currency,
    reason, recorded_by, created_at
) VALUES (
    '99402000-0000-4000-8000-000000000001',
    '99402000-0000-4000-8000-000000000011',
    '99401000-0000-4000-8000-000000000001',
    '99400000-0000-4000-8000-000000000002', -10, 1, 25, -250,
    'eur', 'Settlement contract correction.',
    '99400000-0000-4000-8000-000000000001',
    '2025-01-17 10:00:00+00'
);
COMMIT;

-- Settlement data is private and the privileged operations are service-only.
DO $$
BEGIN
    IF NOT has_table_privilege('service_role', 'public.teacher_compensation_settlements', 'SELECT')
       OR has_table_privilege('service_role', 'public.teacher_compensation_settlements', 'INSERT')
       OR has_table_privilege('anon', 'public.teacher_compensation_settlements', 'SELECT')
       OR has_table_privilege('authenticated', 'public.teacher_compensation_settlement_lines', 'SELECT')
       OR has_table_privilege('authenticated', 'public.teacher_compensation_settlement_payments', 'SELECT')
       OR has_table_privilege('authenticated', 'public.teacher_compensation_settlement_payment_voids', 'SELECT')
       OR NOT has_function_privilege(
            'service_role',
            'public.close_teacher_compensation_settlement(uuid,uuid,date,uuid,text)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'anon',
            'public.close_teacher_compensation_settlement(uuid,uuid,date,uuid,text)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.record_teacher_compensation_settlement_payment(uuid,uuid,timestamptz,text,text,uuid,text)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.void_teacher_compensation_settlement_payment(uuid,uuid,uuid,text)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.void_teacher_compensation_settlement_payment(uuid,uuid,uuid,text)',
            'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_acl_is_wrong';
    END IF;
END
$$;

-- A later month cannot be closed while an older obligation is unassigned.
DO $$
BEGIN
    PERFORM public.close_teacher_compensation_settlement(
        '99410000-0000-4000-8000-000000000003',
        '99400000-0000-4000-8000-000000000003',
        DATE '2025-01-01',
        '99400000-0000-4000-8000-000000000001',
        'January must wait for the older December obligation.'
    );
    RAISE EXCEPTION 'out_of_order_teacher_settlement_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'teacher_compensation_settlement_prior_period_required' THEN RAISE; END IF;
END
$$;

-- Exercise the RPC using the same role used by the server client.
BEGIN;
SET LOCAL ROLE service_role;
SELECT public.close_teacher_compensation_settlement(
    '99410000-0000-4000-8000-000000000001',
    '99400000-0000-4000-8000-000000000002',
    DATE '2025-01-01',
    '99400000-0000-4000-8000-000000000001',
    'January settlement closed after reconciliation.'
);
COMMIT;

DO $$
DECLARE
    v_settlement_id UUID;
BEGIN
    SELECT settlement.id INTO v_settlement_id
    FROM public.teacher_compensation_settlements
        AS settlement
    WHERE settlement.request_id = '99410000-0000-4000-8000-000000000001';

    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_compensation_settlements
        WHERE teacher_compensation_settlements.id = v_settlement_id
          AND teacher_compensation_settlements.teacher_id = '99400000-0000-4000-8000-000000000002'
          AND teacher_compensation_settlements.period_month = DATE '2025-01-01'
          AND teacher_compensation_settlements.timezone = 'Europe/Madrid'
          AND teacher_compensation_settlements.class_amount_cents = 2000
          AND teacher_compensation_settlements.mandatory_work_amount_cents = 1500
          AND teacher_compensation_settlements.adjustment_amount_cents = -250
          AND teacher_compensation_settlements.total_amount_cents = 3250
          AND teacher_compensation_settlements.line_count = 3
    ) OR (SELECT COUNT(*) FROM public.teacher_compensation_settlement_lines
          WHERE teacher_compensation_settlement_lines.settlement_id = v_settlement_id) <> 3
       OR (SELECT COALESCE(SUM(amount_cents), 0)
           FROM public.teacher_compensation_settlement_lines
           WHERE teacher_compensation_settlement_lines.settlement_id = v_settlement_id) <> 3250
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_settlement_lines
            WHERE teacher_compensation_settlement_lines.settlement_id = v_settlement_id
              AND source_kind = 'class' AND amount_cents = 2000
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_settlement_lines
            WHERE teacher_compensation_settlement_lines.settlement_id = v_settlement_id
              AND source_kind = 'mandatory_work'
              AND quantity_minutes = 60 AND amount_cents = 1500
       )
       OR NOT EXISTS (
            SELECT 1 FROM public.teacher_compensation_settlement_lines
            WHERE teacher_compensation_settlement_lines.settlement_id = v_settlement_id
              AND source_kind = 'work_adjustment'
              AND quantity_minutes = -10 AND amount_cents = -250
       ) THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_snapshot_is_wrong';
    END IF;
END
$$;

-- An identical request replays the snapshot; changed input and a second request
-- for the same teacher/month must fail without creating another settlement.
SELECT public.close_teacher_compensation_settlement(
    '99410000-0000-4000-8000-000000000001',
    '99400000-0000-4000-8000-000000000002',
    DATE '2025-01-01',
    '99400000-0000-4000-8000-000000000001',
    'January settlement closed after reconciliation.'
);

DO $$
BEGIN
    PERFORM public.close_teacher_compensation_settlement(
        '99410000-0000-4000-8000-000000000001',
        '99400000-0000-4000-8000-000000000002',
        DATE '2025-01-01',
        '99400000-0000-4000-8000-000000000001',
        'A changed replay must not rewrite the frozen snapshot.'
    );
    RAISE EXCEPTION 'changed_teacher_settlement_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_request_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.close_teacher_compensation_settlement(
        '99410000-0000-4000-8000-000000000002',
        '99400000-0000-4000-8000-000000000002',
        DATE '2025-01-01',
        '99400000-0000-4000-8000-000000000001',
        'A second close for the same month must fail.'
    );
    RAISE EXCEPTION 'duplicate_teacher_settlement_period_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_period_conflicts' THEN RAISE; END IF;
END
$$;

-- Once a month is closed, late backfills whose business timestamp belongs to
-- that month are rejected at the source ledger boundary.
DO $$
BEGIN
    INSERT INTO public.teacher_compensation_work_ledger (
        request_id, teacher_id, engagement_id, engagement_kind, work_kind,
        started_at, ended_at, duration_minutes, policy_version,
        rate_cents_per_minute, amount_cents, currency, description,
        recorded_by
    ) VALUES (
        '99401000-0000-4000-8000-000000000019',
        '99400000-0000-4000-8000-000000000002',
        '99400100-0000-4000-8000-000000000001', 'external',
        'mandatory_meeting', '2025-01-25 10:00:00+00',
        '2025-01-25 10:30:00+00', 30, 1, 25, 750, 'eur',
        'This late January source must be rejected.',
        '99400000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'closed_teacher_settlement_period_accepted_late_source';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_period_closed' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.adjust_teacher_compensation_work(
        '99402000-0000-4000-8000-000000000019',
        '99401000-0000-4000-8000-000000000001',
        5,
        'A closed month cannot receive a later correction.',
        '99400000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'closed_teacher_settlement_period_accepted_late_adjustment';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_period_closed' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.teacher_compensation_work_adjustments
        WHERE request_id = '99402000-0000-4000-8000-000000000019'
    ) THEN
        RAISE EXCEPTION 'rejected_closed_period_adjustment_was_persisted';
    END IF;
END
$$;

-- Closing the older period first unlocks the next period for the same teacher.
SELECT public.close_teacher_compensation_settlement(
    '99410000-0000-4000-8000-000000000004',
    '99400000-0000-4000-8000-000000000003',
    DATE '2024-12-01',
    '99400000-0000-4000-8000-000000000001',
    'December chronology prerequisite closed first.'
);
SELECT public.close_teacher_compensation_settlement(
    '99410000-0000-4000-8000-000000000005',
    '99400000-0000-4000-8000-000000000003',
    DATE '2025-01-01',
    '99400000-0000-4000-8000-000000000001',
    'January chronology period closed second.'
);

SELECT date_trunc('second', clock_timestamp()) AS settlement_paid_at
\gset

SELECT public.record_teacher_compensation_settlement_payment(
    '99420000-0000-4000-8000-000000000001',
    (SELECT id FROM public.teacher_compensation_settlements
     WHERE request_id = '99410000-0000-4000-8000-000000000001'),
    :'settlement_paid_at'::TIMESTAMPTZ,
    'bank-transfer-2025-01', 'invoice-2025-01',
    '99400000-0000-4000-8000-000000000001',
    'Manual bank transfer checked by the operator.'
);
SELECT public.record_teacher_compensation_settlement_payment(
    '99420000-0000-4000-8000-000000000001',
    (SELECT id FROM public.teacher_compensation_settlements
     WHERE request_id = '99410000-0000-4000-8000-000000000001'),
    :'settlement_paid_at'::TIMESTAMPTZ,
    'bank-transfer-2025-01', 'invoice-2025-01',
    '99400000-0000-4000-8000-000000000001',
    'Manual bank transfer checked by the operator.'
);

DO $$
DECLARE
    v_paid_at TIMESTAMPTZ;
BEGIN
    SELECT payment.paid_at INTO v_paid_at
    FROM public.teacher_compensation_settlement_payments AS payment
    WHERE payment.request_id = '99420000-0000-4000-8000-000000000001';
    PERFORM public.record_teacher_compensation_settlement_payment(
        '99420000-0000-4000-8000-000000000001',
        (SELECT id FROM public.teacher_compensation_settlements
         WHERE request_id = '99410000-0000-4000-8000-000000000001'),
        v_paid_at,
        'changed-reference', 'invoice-2025-01',
        '99400000-0000-4000-8000-000000000001',
        'Changed replay must not rewrite payment evidence.'
    );
    RAISE EXCEPTION 'changed_teacher_settlement_payment_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_payment_request_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.record_teacher_compensation_settlement_payment(
        '99420000-0000-4000-8000-000000000002',
        (SELECT id FROM public.teacher_compensation_settlements
         WHERE request_id = '99410000-0000-4000-8000-000000000001'),
        clock_timestamp(), 'second-reference', NULL,
        '99400000-0000-4000-8000-000000000001',
        'A second payment record must be rejected.'
    );
    RAISE EXCEPTION 'duplicate_teacher_settlement_payment_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_already_paid' THEN RAISE; END IF;
END
$$;

DO $$
DECLARE
    v_settlement_id UUID;
    v_payment_id UUID;
BEGIN
    SELECT settlement.id INTO v_settlement_id
    FROM public.teacher_compensation_settlements AS settlement
    WHERE settlement.request_id = '99410000-0000-4000-8000-000000000001';
    SELECT payment.id INTO v_payment_id
    FROM public.teacher_compensation_settlement_payments AS payment
    WHERE payment.request_id = '99420000-0000-4000-8000-000000000001';

    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_compensation_settlement_payments
        WHERE teacher_compensation_settlement_payments.id = v_payment_id
          AND teacher_compensation_settlement_payments.settlement_id = v_settlement_id
          AND teacher_compensation_settlement_payments.teacher_id = '99400000-0000-4000-8000-000000000002'
          AND teacher_compensation_settlement_payments.amount_cents = 3250
          AND teacher_compensation_settlement_payments.currency = 'eur'
          AND teacher_compensation_settlement_payments.payment_reference = 'bank-transfer-2025-01'
          AND teacher_compensation_settlement_payments.invoice_reference = 'invoice-2025-01'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.teacher_compensation_settlement_balances
        WHERE teacher_compensation_settlement_balances.id = v_settlement_id
          AND teacher_compensation_settlement_balances.status = 'paid'
          AND teacher_compensation_settlement_balances.payment_id = v_payment_id
          AND teacher_compensation_settlement_balances.total_amount_cents = 3250
    ) OR (SELECT COUNT(*) FROM public.admin_audit_log
          WHERE action = 'close_teacher_compensation_settlement'
            AND entity_id = v_settlement_id::TEXT) <> 1
       OR (SELECT COUNT(*) FROM public.admin_audit_log
           WHERE action = 'record_teacher_compensation_settlement_payment'
             AND entity_id = v_payment_id::TEXT) <> 1 THEN
        RAISE EXCEPTION 'teacher_compensation_settlement_payment_snapshot_is_wrong';
    END IF;
END
$$;

SELECT public.void_teacher_compensation_settlement_payment(
    '99430000-0000-4000-8000-000000000001',
    (SELECT id FROM public.teacher_compensation_settlement_payments
     WHERE request_id = '99420000-0000-4000-8000-000000000001'),
    '99400000-0000-4000-8000-000000000001',
    'The first payment evidence used the wrong bank reference.'
);
SELECT public.void_teacher_compensation_settlement_payment(
    '99430000-0000-4000-8000-000000000001',
    (SELECT id FROM public.teacher_compensation_settlement_payments
     WHERE request_id = '99420000-0000-4000-8000-000000000001'),
    '99400000-0000-4000-8000-000000000001',
    'The first payment evidence used the wrong bank reference.'
);

DO $$
BEGIN
    PERFORM public.void_teacher_compensation_settlement_payment(
        '99430000-0000-4000-8000-000000000001',
        (SELECT id FROM public.teacher_compensation_settlement_payments
         WHERE request_id = '99420000-0000-4000-8000-000000000001'),
        '99400000-0000-4000-8000-000000000001',
        'A changed void replay must not rewrite history.'
    );
    RAISE EXCEPTION 'changed_teacher_settlement_payment_void_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_payment_void_request_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.void_teacher_compensation_settlement_payment(
        '99430000-0000-4000-8000-000000000002',
        (SELECT id FROM public.teacher_compensation_settlement_payments
         WHERE request_id = '99420000-0000-4000-8000-000000000001'),
        '99400000-0000-4000-8000-000000000001',
        'A second void event for one payment must fail.'
    );
    RAISE EXCEPTION 'duplicate_teacher_settlement_payment_void_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_settlement_payment_already_void' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_compensation_settlement_balances
        WHERE request_id = '99410000-0000-4000-8000-000000000001'
          AND status = 'closed' AND payment_id IS NULL
    ) OR (SELECT COUNT(*) FROM public.admin_audit_log
          WHERE action = 'void_teacher_compensation_settlement_payment'
            AND entity_id = (
                SELECT id::TEXT
                FROM public.teacher_compensation_settlement_payment_voids
                WHERE request_id = '99430000-0000-4000-8000-000000000001'
            )) <> 1 THEN
        RAISE EXCEPTION 'voided_teacher_settlement_payment_remains_current';
    END IF;
END
$$;

SELECT date_trunc('second', clock_timestamp()) AS replacement_paid_at
\gset
SELECT public.record_teacher_compensation_settlement_payment(
    '99420000-0000-4000-8000-000000000003',
    (SELECT id FROM public.teacher_compensation_settlements
     WHERE request_id = '99410000-0000-4000-8000-000000000001'),
    :'replacement_paid_at'::TIMESTAMPTZ,
    'corrected-bank-transfer-2025-01', 'invoice-2025-01',
    '99400000-0000-4000-8000-000000000001',
    'Corrected manual payment evidence after void.'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.teacher_compensation_settlement_balances
        WHERE request_id = '99410000-0000-4000-8000-000000000001'
          AND status = 'paid'
          AND payment_reference = 'corrected-bank-transfer-2025-01'
    ) THEN
        RAISE EXCEPTION 'replacement_teacher_settlement_payment_is_not_current';
    END IF;
END
$$;

-- Settlement, source lines, and payment evidence are all immutable.
DO $$
BEGIN
    UPDATE public.teacher_compensation_settlements SET close_note = 'Rewritten note'
    WHERE request_id = '99410000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'teacher_settlement_update_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    DELETE FROM public.teacher_compensation_settlement_payment_voids
    WHERE request_id = '99430000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'teacher_settlement_payment_void_delete_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    DELETE FROM public.teacher_compensation_settlement_lines
    WHERE settlement_id = (
        SELECT id FROM public.teacher_compensation_settlements
        WHERE request_id = '99410000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'teacher_settlement_line_delete_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.teacher_compensation_settlement_payments
    SET payment_reference = 'rewritten-reference'
    WHERE request_id = '99420000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'teacher_settlement_payment_update_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'teacher_compensation_state_conflicts' THEN RAISE; END IF;
END
$$;
