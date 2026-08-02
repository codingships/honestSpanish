\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '20s';

CREATE EXTENSION IF NOT EXISTS dblink;

-- Keep a safe same-day class time while placing the second class at the next
-- Madrid noon, always inside the 24-hour boundary. Subtracting seven absolute
-- days preserves the fixture's existing `first_at + 7 days` recurrence even
-- when the test runs across a DST transition.
WITH current_madrid AS (
    SELECT clock_timestamp() AT TIME ZONE 'Europe/Madrid' AS local_now
)
SELECT date_trunc(
    'second',
    (
        (
            local_now::DATE
            + CASE
                WHEN local_now::TIME < TIME '12:00'
                    THEN 0
                ELSE 1
            END
            + TIME '12:00'
        ) AT TIME ZONE 'Europe/Madrid'
    ) - INTERVAL '7 days'
) AS guarantee_first_at
FROM current_madrid
\gset

-- Durable fixture. Replica mode is confined to setup/teardown so the test can
-- exercise production triggers and RPCs without reconstructing booking UI data.
BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (id, email, role) VALUES
    ('77000000-0000-4000-8000-000000000001', 'guarantee-student@test.invalid', 'student'),
    ('77000000-0000-4000-8000-000000000002', 'guarantee-teacher@test.invalid', 'teacher'),
    ('77000000-0000-4000-8000-000000000003', 'guarantee-admin@test.invalid', 'admin');

INSERT INTO public.packages (
    id, name, display_name, price_monthly, sessions_per_month,
    contract_schema_version, amount_cents, billing_interval_unit,
    billing_interval_count, sessions_per_period, class_duration_minutes
) VALUES (
    '77100000-0000-4000-8000-000000000001',
    'guarantee_v2_package', '{"en":"Guarantee V2"}'::JSONB,
    25900, 4, 2, 25900, 'day', 28, 4, 50
);

INSERT INTO public.package_prices (
    id, package_id, catalog_version, package_key, display_name,
    duration_months, amount_cents, currency, sessions_per_month,
    sessions_per_period, has_group_session, has_dual_teacher,
    stripe_account_id, stripe_livemode, stripe_product_id, stripe_price_id,
    status, contract_schema_version, billing_interval_unit,
    billing_interval_count, class_duration_minutes
) VALUES (
    '77200000-0000-4000-8000-000000000001',
    '77100000-0000-4000-8000-000000000001',
    1, 'guarantee_v2_package', '{"en":"Guarantee V2"}'::JSONB,
    NULL, 25900, 'eur', NULL, 4, FALSE, FALSE,
    'acct_guarantee_test', FALSE, 'prod_guarantee_test',
    'price_guarantee_recurring', 'active', 2, 'day', 28, 50
);

INSERT INTO public.checkout_v2_price_snapshots (
    package_price_id, stripe_account_id, stripe_livemode,
    initial_stripe_price_id, recurring_stripe_price_id
) VALUES (
    '77200000-0000-4000-8000-000000000001',
    'acct_guarantee_test', FALSE,
    'price_guarantee_initial', 'price_guarantee_recurring'
);

INSERT INTO public.crm_contacts (
    id, profile_id, primary_email, full_name
) VALUES (
    '77300000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    'guarantee-student@test.invalid', 'Guarantee Student'
);

INSERT INTO public.crm_opportunities (
    id, contact_id, stage, interest, preferred_package_id,
    checkout_approved_at
) VALUES (
    '77400000-0000-4000-8000-000000000001',
    '77300000-0000-4000-8000-000000000001',
    'won', 'direct_checkout',
    '77100000-0000-4000-8000-000000000001',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days'
);

INSERT INTO public.checkout_intents (
    id, opportunity_id, contact_id, student_id, package_price_id,
    lang, legal_policy_version, policy_accepted_at, site_url, status,
    stripe_checkout_session_id, stripe_customer_id,
    stripe_session_expires_at, expires_at, completed_at, created_at, updated_at
) VALUES (
    '77500000-0000-4000-8000-000000000001',
    '77400000-0000-4000-8000-000000000001',
    '77300000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    'en', 'guarantee-test-v1',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days',
    'https://example.test', 'completed',
    'cs_guarantee_test', 'cus_guarantee_test',
    date_trunc('second', clock_timestamp()) - INTERVAL '47 hours',
    date_trunc('second', clock_timestamp()) - INTERVAL '46 hours',
    date_trunc('second', clock_timestamp()) - INTERVAL '46 hours 30 minutes',
    date_trunc('second', clock_timestamp()) - INTERVAL '48 hours',
    date_trunc('second', clock_timestamp()) - INTERVAL '46 hours 30 minutes'
);

INSERT INTO public.subscriptions (
    id, student_id, package_id, package_price_id, checkout_intent_id,
    status, duration_months, starts_at, ends_at, sessions_total,
    contracted_sessions_per_period, sessions_used, stripe_subscription_id,
    stripe_invoice_id, contract_schema_version, billing_interval_unit,
    billing_interval_count, class_duration_minutes
) VALUES (
    '77600000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    '77100000-0000-4000-8000-000000000001',
    '77200000-0000-4000-8000-000000000001',
    '77500000-0000-4000-8000-000000000001',
    'active', NULL,
    (:'guarantee_first_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid')::DATE,
    (:'guarantee_first_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid')::DATE + 28,
    4, 4, 1, 'sub_guarantee_test', 'in_guarantee_initial',
    2, 'day', 28, 50
);

INSERT INTO public.payments (
    id, student_id, subscription_id, amount, currency, status,
    stripe_payment_intent_id, stripe_invoice_id
) VALUES (
    '77700000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001',
    '77600000-0000-4000-8000-000000000001',
    25900, 'eur', 'succeeded', 'pi_guarantee_initial', 'in_guarantee_initial'
);

INSERT INTO public.checkout_v2_cycles (
    id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
    stripe_price_id, stripe_invoice_id, payment_id,
    materialization_state, sessions_materialized_at
) VALUES (
    '77800000-0000-4000-8000-000000000001',
    '77600000-0000-4000-8000-000000000001',
    1, 'initial',
    :'guarantee_first_at'::TIMESTAMPTZ,
    :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '28 days',
    'price_guarantee_initial', 'in_guarantee_initial',
    '77700000-0000-4000-8000-000000000001',
    'ready', date_trunc('second', clock_timestamp()) - INTERVAL '8 days'
);

UPDATE public.payments
SET checkout_v2_cycle_id = '77800000-0000-4000-8000-000000000001'
WHERE id = '77700000-0000-4000-8000-000000000001';

INSERT INTO public.sessions (
    id, subscription_id, student_id, teacher_id, scheduled_at,
    duration_minutes, status, completed_at, checkout_v2_cycle_id,
    checkout_v2_cycle_session_index
) VALUES
    (
        '77900000-0000-4000-8000-000000000001',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ,
        50, 'completed',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '50 minutes',
        '77800000-0000-4000-8000-000000000001', 1
    ),
    (
        '77900000-0000-4000-8000-000000000002',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '7 days',
        50, 'scheduled', NULL,
        '77800000-0000-4000-8000-000000000001', 2
    ),
    (
        '77900000-0000-4000-8000-000000000003',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '14 days',
        50, 'scheduled', NULL,
        '77800000-0000-4000-8000-000000000001', 3
    ),
    (
        '77900000-0000-4000-8000-000000000004',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '21 days',
        50, 'scheduled', NULL,
        '77800000-0000-4000-8000-000000000001', 4
    );

UPDATE public.sessions
SET
    status = 'cancelled',
    cancelled_at = CASE checkout_v2_cycle_session_index
        WHEN 4 THEN scheduled_at - INTERVAL '25 hours'
        ELSE scheduled_at - INTERVAL '2 hours'
    END,
    cancelled_by = CASE checkout_v2_cycle_session_index
        WHEN 2 THEN teacher_id
        WHEN 3 THEN '77000000-0000-4000-8000-000000000003'::UUID
        ELSE student_id
    END,
    cancellation_reason = 'replacement lineage fixture'
WHERE id IN (
    '77900000-0000-4000-8000-000000000002',
    '77900000-0000-4000-8000-000000000003',
    '77900000-0000-4000-8000-000000000004'
);

INSERT INTO public.sessions (
    id, subscription_id, student_id, teacher_id, scheduled_at,
    duration_minutes, status, created_at, checkout_v2_cycle_id,
    checkout_v2_cycle_session_index, checkout_v2_replaces_session_id,
    checkout_v2_replacement_request_id, checkout_v2_replacement_actor_id,
    checkout_v2_replacement_source_kind, checkout_v2_replacement_reason
) VALUES
    (
        '77910000-0000-4000-8000-000000000002',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '7 days',
        50, 'scheduled', clock_timestamp() + INTERVAL '1 second',
        '77800000-0000-4000-8000-000000000001', 2,
        '77900000-0000-4000-8000-000000000002',
        '77920000-0000-4000-8000-000000000002',
        '77000000-0000-4000-8000-000000000002',
        'teacher_cancellation', 'replacement_after_teacher_cancellation'
    ),
    (
        '77910000-0000-4000-8000-000000000003',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '14 days',
        50, 'scheduled', clock_timestamp() + INTERVAL '1 second',
        '77800000-0000-4000-8000-000000000001', 3,
        '77900000-0000-4000-8000-000000000003',
        '77920000-0000-4000-8000-000000000003',
        '77000000-0000-4000-8000-000000000003',
        'admin_cancellation', 'replacement_after_admin_cancellation'
    ),
    (
        '77910000-0000-4000-8000-000000000004',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000002',
        :'guarantee_first_at'::TIMESTAMPTZ + INTERVAL '21 days',
        50, 'scheduled', clock_timestamp() + INTERVAL '1 second',
        '77800000-0000-4000-8000-000000000001', 4,
        '77900000-0000-4000-8000-000000000004',
        '77920000-0000-4000-8000-000000000004',
        '77000000-0000-4000-8000-000000000001',
        'timely_student_cancellation',
        'replacement_after_timely_student_cancellation'
    );

INSERT INTO public.checkout_v2_billing_state (
    subscription_id, first_session_id, first_class_at, renewal_anchor_at,
    stripe_renewal_anchor_at, anchor_state, anchor_revision, anchor_fixed_at
) SELECT
    '77600000-0000-4000-8000-000000000001', session_row.id,
    session_row.scheduled_at,
    session_row.scheduled_at + INTERVAL '28 days',
    session_row.scheduled_at + INTERVAL '28 days',
    'fixed', 1, session_row.completed_at
FROM public.sessions AS session_row
WHERE session_row.id = '77900000-0000-4000-8000-000000000001';

INSERT INTO public.bookable_slots (
    id, public_id, package_id, teacher_id, weekday, local_start_time,
    timezone_name, first_occurrence_at, status, published_at, published_by,
    sold_at, sold_subscription_id, sessions_materialized_at, created_by
) VALUES (
    '78200000-0000-4000-8000-000000000001',
    '78200000-0000-4000-8000-000000000002',
    '77100000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM (
        :'guarantee_first_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid'
    ))::SMALLINT,
    (:'guarantee_first_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid')::TIME(0),
    'Europe/Madrid', :'guarantee_first_at'::TIMESTAMPTZ,
    'sold', date_trunc('second', clock_timestamp()) - INTERVAL '3 days',
    '77000000-0000-4000-8000-000000000003',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days',
    '77600000-0000-4000-8000-000000000001',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days',
    '77000000-0000-4000-8000-000000000003'
);

INSERT INTO public.bookable_slot_holds (
    id, slot_id, checkout_intent_id, status, held_at, expires_at,
    closed_at, close_reason, subscription_id, hold_fingerprint
) VALUES (
    '78300000-0000-4000-8000-000000000001',
    '78200000-0000-4000-8000-000000000001',
    '77500000-0000-4000-8000-000000000001',
    'consumed',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days 2 hours',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days 1 hour',
    date_trunc('second', clock_timestamp()) - INTERVAL '2 days',
    'paid', '77600000-0000-4000-8000-000000000001', NULL
);

INSERT INTO public.checkout_v2_weekly_allocations (
    id, subscription_id, slot_id, teacher_id, weekday, local_start_time,
    duration_minutes, timezone_name, status
) VALUES (
    '78400000-0000-4000-8000-000000000001',
    '77600000-0000-4000-8000-000000000001',
    '78200000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM (
        :'guarantee_first_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid'
    ))::SMALLINT,
    (:'guarantee_first_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid')::TIME(0),
    50, 'Europe/Madrid', 'active'
);

COMMIT;

DO $$
DECLARE
    state_row RECORD;
BEGIN
    SELECT * INTO state_row
    FROM public.get_checkout_v2_guarantee_state(
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000001'
    );
    IF state_row.state IS DISTINCT FROM 'eligible'
       OR state_row.refund_amount_cents IS DISTINCT FROM 19425
       OR state_row.currency IS DISTINCT FROM 'eur' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_eligible_state_is_wrong';
    END IF;

    SELECT * INTO state_row
    FROM public.get_checkout_v2_guarantee_state(
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000003'
    );
    IF state_row.state IS DISTINCT FROM 'eligible' THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_admin_cannot_inspect';
    END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.prepare_checkout_v2_guarantee(
        '77a00000-0000-4000-8000-000000000000',
        '77600000-0000-4000-8000-000000000001',
        '77000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'admin_prepared_student_guarantee';
EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'checkout_v2_guarantee_forbidden' THEN RAISE; END IF;
END
$$;

-- Two connections race different request IDs for one subscription. Both must
-- converge on the unique durable operation.
SELECT dblink_connect(
    'checkout_v2_guarantee_race',
    'host=127.0.0.1 port=' || current_setting('port')
        || ' dbname=' || current_database()
        || ' user=postgres password=postgres sslmode=disable'
);

SELECT dblink_send_query('checkout_v2_guarantee_race', $race$
    DO $remote$
    BEGIN
        PERFORM public.prepare_checkout_v2_guarantee(
            '77a00000-0000-4000-8000-000000000001',
            '77600000-0000-4000-8000-000000000001',
            '77000000-0000-4000-8000-000000000001'
        );
        PERFORM pg_catalog.pg_advisory_lock(771001);
        PERFORM pg_catalog.pg_sleep(1);
        PERFORM pg_catalog.pg_advisory_unlock(771001);
    END
    $remote$;
$race$);

DO $$
DECLARE
    waiting BOOLEAN := FALSE;
BEGIN
    FOR attempt IN 1..50 LOOP
        SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_locks
            WHERE locktype = 'advisory' AND objid = 771001 AND granted
        ) INTO waiting;
        EXIT WHEN waiting;
        PERFORM pg_catalog.pg_sleep(0.02);
    END LOOP;
    IF NOT waiting THEN RAISE EXCEPTION 'guarantee_race_did_not_start'; END IF;
END
$$;

SELECT (public.prepare_checkout_v2_guarantee(
    '77a00000-0000-4000-8000-000000000002',
    '77600000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000001'
)).id AS operation_id
\gset
SELECT pg_catalog.set_config(
    'app.checkout_v2_guarantee_test_operation_id', :'operation_id', FALSE
);

DO $$
DECLARE operation_row public.checkout_v2_guarantee_operations%ROWTYPE;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_guarantee_operations
    WHERE id = current_setting(
        'app.checkout_v2_guarantee_test_operation_id'
    )::UUID;

    IF operation_row.second_session_id IS DISTINCT FROM
            '77910000-0000-4000-8000-000000000002'::UUID
       OR operation_row.third_session_id IS DISTINCT FROM
            '77910000-0000-4000-8000-000000000003'::UUID
       OR operation_row.fourth_session_id IS DISTINCT FROM
            '77910000-0000-4000-8000-000000000004'::UUID THEN
        RAISE EXCEPTION 'guarantee_did_not_snapshot_effective_leaves';
    END IF;
END $$;

SELECT status
FROM dblink_get_result('checkout_v2_guarantee_race') AS result(status TEXT);
SELECT dblink_disconnect('checkout_v2_guarantee_race');

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.checkout_v2_guarantee_operations
        WHERE subscription_id = '77600000-0000-4000-8000-000000000001') <> 1
       OR (public.prepare_checkout_v2_guarantee(
            '77a00000-0000-4000-8000-000000000003',
            '77600000-0000-4000-8000-000000000001',
            '77000000-0000-4000-8000-000000000001'
       )).id IS DISTINCT FROM current_setting(
            'app.checkout_v2_guarantee_test_operation_id'
       )::UUID THEN
        RAISE EXCEPTION 'guarantee_prepare_is_not_exactly_once';
    END IF;
END
$$;

-- Any renewal payment that races after prepare is rejected under the same
-- subscription advisory lock.
DO $$
BEGIN
    INSERT INTO public.payments (
        id, student_id, subscription_id, amount, currency, status,
        stripe_payment_intent_id, stripe_invoice_id
    ) VALUES (
        '77700000-0000-4000-8000-000000000002',
        '77000000-0000-4000-8000-000000000001',
        '77600000-0000-4000-8000-000000000001',
        25900, 'eur', 'pending', 'pi_guarantee_renewal', 'in_guarantee_renewal'
    );
    RAISE EXCEPTION 'renewal_payment_crossed_guarantee_boundary';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_guarantee_state_is_locked' THEN RAISE; END IF;
END
$$;

SELECT (public.claim_checkout_v2_guarantee(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001'
)).id;

UPDATE public.checkout_v2_guarantee_operations
SET lease_expires_at = date_trunc('second', clock_timestamp()) - INTERVAL '1 second'
WHERE id = :'operation_id'::UUID;

DO $$
BEGIN
    PERFORM public.mark_checkout_v2_guarantee_outcome(
        current_setting('app.checkout_v2_guarantee_test_operation_id')::UUID,
        '77b00000-0000-4000-8000-000000000001',
        'retryable', 'expired worker must not win'
    );
    RAISE EXCEPTION 'expired_worker_marked_guarantee_outcome';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_guarantee_claim_is_not_active' THEN RAISE; END IF;
END
$$;

SELECT (public.claim_checkout_v2_guarantee(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001'
)).id;
SELECT (public.mark_checkout_v2_guarantee_outcome(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001',
    'manual_review', 'pre-refund operator check'
)).support_ticket_id AS support_ticket_id
\gset
SELECT pg_catalog.set_config(
    'app.checkout_v2_guarantee_test_support_ticket_id', :'support_ticket_id', FALSE
);

DO $$
BEGIN
    PERFORM public.resolve_checkout_v2_guarantee_review(
        current_setting('app.checkout_v2_guarantee_test_operation_id')::UUID,
        '77000000-0000-4000-8000-000000000001',
        'A student cannot release this review.'
    );
    RAISE EXCEPTION 'student_released_guarantee_review';
EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'checkout_v2_guarantee_review_resolution_forbidden' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.resolve_checkout_v2_guarantee_review(
        current_setting('app.checkout_v2_guarantee_test_operation_id')::UUID,
        '77000000-0000-4000-8000-000000000003',
        'Operator verified the cancellation state.'
    );
    RAISE EXCEPTION 'open_ticket_released_guarantee_review';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_guarantee_review_ticket_is_not_closed' THEN RAISE; END IF;
END
$$;

UPDATE public.support_tickets SET status = 'closed'
WHERE id = :'support_ticket_id'::UUID;

SELECT (public.resolve_checkout_v2_guarantee_review(
    :'operation_id'::UUID,
    '77000000-0000-4000-8000-000000000003',
    'Operator verified the cancellation state.'
)).status;
SELECT (public.resolve_checkout_v2_guarantee_review(
    :'operation_id'::UUID,
    '77000000-0000-4000-8000-000000000003',
    'Operator verified the cancellation state.'
)).status;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.admin_audit_log
        WHERE action = 'resolve_checkout_v2_guarantee_review'
          AND entity_id = current_setting(
              'app.checkout_v2_guarantee_test_operation_id'
          )) <> 1 THEN
        RAISE EXCEPTION 'review_resolution_audit_is_not_exactly_once';
    END IF;
END
$$;

SELECT (public.claim_checkout_v2_guarantee(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001'
)).id;
SELECT (public.mark_checkout_v2_guarantee_outcome(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001',
    'manual_review', 'second operator check'
)).id;

DO $$
BEGIN
    IF (SELECT status FROM public.support_tickets
        WHERE id = current_setting(
            'app.checkout_v2_guarantee_test_support_ticket_id'
        )::UUID) IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'closed_guarantee_ticket_was_not_reopened';
    END IF;
END
$$;

UPDATE public.support_tickets SET status = 'closed'
WHERE id = :'support_ticket_id'::UUID;
SELECT (public.resolve_checkout_v2_guarantee_review(
    :'operation_id'::UUID,
    '77000000-0000-4000-8000-000000000003',
    'Operator verified the second failure.'
)).status;

SELECT (public.claim_checkout_v2_guarantee(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001'
)).id;
SELECT (public.begin_checkout_v2_guarantee_cancellation(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001'
)).cancellation_started_at AS cancellation_started_at
\gset

-- Stripe and PostgreSQL clocks may differ by a few seconds.
SELECT (public.apply_checkout_v2_guarantee_termination(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001',
    :'cancellation_started_at'::TIMESTAMPTZ - INTERVAL '3 seconds'
)).terminated_at;

DO $$
DECLARE
    progress public.checkout_v2_cycle_progress%ROWTYPE;
BEGIN
    SELECT * INTO progress
    FROM public.checkout_v2_cycle_progress
    WHERE cycle_id = '77800000-0000-4000-8000-000000000001';

    IF progress.progress_state IS DISTINCT FROM 'ready'
       OR progress.sessions_consumed IS DISTINCT FROM 1
       OR progress.sessions_remaining IS DISTINCT FROM 3
       OR EXISTS (
            SELECT 1
            FROM public.checkout_v2_session_consumption
            WHERE session_id IN (
                '77910000-0000-4000-8000-000000000002',
                '77910000-0000-4000-8000-000000000003',
                '77910000-0000-4000-8000-000000000004'
            )
              AND (
                  consumption_kind IS DISTINCT FROM 'guarantee_refund_cancellation'
                  OR original_student_credit_consumed
                  OR student_credit_consumed
              )
       )
       OR EXISTS (
            SELECT 1
            FROM public.teacher_compensation_ledger
            WHERE session_id IN (
                '77910000-0000-4000-8000-000000000002',
                '77910000-0000-4000-8000-000000000003',
                '77910000-0000-4000-8000-000000000004'
            )
       )
       OR EXISTS (
            SELECT 1
            FROM public.teacher_compensation_session_reconciliation_candidates
            WHERE session_id IN (
                '77910000-0000-4000-8000-000000000002',
                '77910000-0000-4000-8000-000000000003',
                '77910000-0000-4000-8000-000000000004'
            )
       )
       OR EXISTS (
            SELECT 1 FROM public.sessions
            WHERE id IN (
                '77900000-0000-4000-8000-000000000002',
                '77900000-0000-4000-8000-000000000003',
                '77900000-0000-4000-8000-000000000004'
            )
              AND (
                  status IS DISTINCT FROM 'cancelled'
                  OR cancellation_reason IS DISTINCT FROM
                        'replacement lineage fixture'
              )
       ) THEN
        RAISE EXCEPTION 'durable_guarantee_refund_progress_is_wrong:%',
            pg_catalog.row_to_json(progress);
    END IF;
END
$$;

SELECT (public.begin_checkout_v2_guarantee_refund(
    :'operation_id'::UUID,
    '77b00000-0000-4000-8000-000000000001'
)).refund_started_at AS refund_started_at
\gset

SELECT (public.observe_checkout_v2_guarantee_refund(
    :'operation_id'::UUID, 're_guarantee_test', 'pending',
    :'refund_started_at'::TIMESTAMPTZ - INTERVAL '3 seconds',
    19425, 'eur', 'pi_guarantee_initial'
)).status;
SELECT (public.observe_checkout_v2_guarantee_refund(
    :'operation_id'::UUID, 're_guarantee_test', 'succeeded',
    :'refund_started_at'::TIMESTAMPTZ - INTERVAL '3 seconds',
    19425, 'eur', 'pi_guarantee_initial'
)).status;

-- Exact replay and stale out-of-order events cannot degrade terminal state or
-- enqueue a second student email.
SELECT (public.observe_checkout_v2_guarantee_refund(
    :'operation_id'::UUID, 're_guarantee_test', 'succeeded',
    :'refund_started_at'::TIMESTAMPTZ - INTERVAL '3 seconds',
    19425, 'eur', 'pi_guarantee_initial'
)).status;
SELECT (public.observe_checkout_v2_guarantee_refund(
    :'operation_id'::UUID, 're_guarantee_test', 'pending',
    :'refund_started_at'::TIMESTAMPTZ - INTERVAL '3 seconds',
    19425, 'eur', 'pi_guarantee_initial'
)).status;
SELECT (public.observe_checkout_v2_guarantee_refund(
    :'operation_id'::UUID, 're_guarantee_test', 'failed',
    :'refund_started_at'::TIMESTAMPTZ - INTERVAL '3 seconds',
    19425, 'eur', 'pi_guarantee_initial'
)).status;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.payments
        WHERE id = '77700000-0000-4000-8000-000000000001'
          AND amount_refunded = 19425
          AND stripe_refund_id = 're_guarantee_test'
    ) OR (SELECT COUNT(*) FROM public.fulfillment_jobs
        WHERE job_type = 'guarantee_refund'
          AND dedupe_key = 'guarantee_refund:' || current_setting(
              'app.checkout_v2_guarantee_test_operation_id'
          )) <> 1
      OR NOT EXISTS (
        SELECT 1 FROM public.fulfillment_jobs
        WHERE job_type = 'guarantee_refund'
          AND subscription_id = '77600000-0000-4000-8000-000000000001'
          AND student_id = '77000000-0000-4000-8000-000000000001'
          AND payload = pg_catalog.jsonb_build_object(
              'operationId', current_setting(
                  'app.checkout_v2_guarantee_test_operation_id'
              )::UUID,
              'refundAmount', 19425,
              'currency', 'eur',
              'sendEmail', TRUE
          )
      ) THEN
        RAISE EXCEPTION 'guarantee_refund_reconciliation_is_not_exactly_once';
    END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.sessions
    SET completed_at = completed_at + INTERVAL '1 minute'
    WHERE id = '77900000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'refunded_first_session_was_rewritten';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_guarantee_terminal_state_is_locked' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.sessions
    SET cancellation_reason = 'reactivated_elsewhere'
    WHERE id = '77910000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'refunded_session_cancellation_was_rewritten';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_guarantee_terminal_state_is_locked' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.subscriptions SET status = 'active'
    WHERE id = '77600000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'refunded_subscription_was_reactivated';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_guarantee_terminal_state_is_locked' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.payments SET status = 'refunded'
    WHERE id = '77700000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'guarantee_payment_snapshot_was_rewritten';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'checkout_v2_guarantee_terminal_state_is_locked' THEN RAISE; END IF;
END
$$;

-- Synthetic failed-refund evidence is never releasable through the generic
-- admin recovery RPC.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.support_tickets (
    id, user_id, issue_type, issue_title, message, status
) VALUES (
    '77c00000-0000-4000-8000-000000000002',
    '77000000-0000-4000-8000-000000000001',
    'guarantee_review', 'Failed refund evidence',
    'A failed Stripe refund must stay under review.', 'closed'
);
INSERT INTO public.checkout_v2_guarantee_operations (
    id, request_id, subscription_id, cycle_id, payment_id, actor_id,
    first_session_id, second_session_id, third_session_id, fourth_session_id,
    stripe_customer_id, stripe_subscription_id, stripe_invoice_id,
    stripe_payment_intent_id, gross_amount_cents, refund_amount_cents,
    currency, status, cancellation_started_at, stripe_cancelled_at,
    terminated_at, refund_started_at, stripe_refund_id, refund_status,
    refund_created_at, support_ticket_id, last_error
) VALUES (
    '77d00000-0000-4000-8000-000000000002',
    '77a00000-0000-4000-8000-000000000099',
    '77e00000-0000-4000-8000-000000000099',
    '77f00000-0000-4000-8000-000000000099',
    '78000000-0000-4000-8000-000000000099',
    '77000000-0000-4000-8000-000000000001',
    '78100000-0000-4000-8000-000000000091',
    '78100000-0000-4000-8000-000000000092',
    '78100000-0000-4000-8000-000000000093',
    '78100000-0000-4000-8000-000000000094',
    'cus_failed_evidence', 'sub_failed_evidence', 'in_failed_evidence',
    'pi_failed_evidence', 25900, 19425, 'eur', 'manual_review',
    date_trunc('second', clock_timestamp()),
    date_trunc('second', clock_timestamp()),
    date_trunc('second', clock_timestamp()),
    date_trunc('second', clock_timestamp()),
    're_failed_evidence', 'failed',
    date_trunc('second', clock_timestamp()),
    '77c00000-0000-4000-8000-000000000002', 'stripe_refund_failed'
);
COMMIT;

SELECT refund_created_at AS failed_refund_at
FROM public.checkout_v2_guarantee_operations
WHERE id = '77d00000-0000-4000-8000-000000000002'
\gset

SELECT (public.observe_checkout_v2_guarantee_refund(
    '77d00000-0000-4000-8000-000000000002',
    're_failed_evidence', 'pending', :'failed_refund_at'::TIMESTAMPTZ,
    19425, 'eur', 'pi_failed_evidence'
)).status;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_guarantee_operations
        WHERE id = '77d00000-0000-4000-8000-000000000002'
          AND status = 'manual_review'
          AND refund_status = 'failed'
    ) THEN
        RAISE EXCEPTION 'stale_pending_degraded_failed_refund_review';
    END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.resolve_checkout_v2_guarantee_review(
        '77d00000-0000-4000-8000-000000000002',
        '77000000-0000-4000-8000-000000000003',
        'This evidence cannot be released.'
    );
    RAISE EXCEPTION 'failed_refund_evidence_was_released';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_guarantee_review_has_refund_evidence' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    IF NOT has_table_privilege(
        'service_role', 'public.checkout_v2_guarantee_operations', 'SELECT'
    ) OR has_table_privilege(
        'service_role', 'public.checkout_v2_guarantee_operations', 'INSERT'
    ) OR has_table_privilege(
        'authenticated', 'public.checkout_v2_guarantee_operations', 'SELECT'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.resolve_checkout_v2_guarantee_review(uuid,uuid,text)', 'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.resolve_checkout_v2_guarantee_review(uuid,uuid,text)', 'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.mark_checkout_v2_guarantee_outcome(uuid,uuid,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_guarantee_privileges_are_wrong';
    END IF;
END
$$;

-- Idempotent cleanup for local and CI databases.
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.admin_audit_log
WHERE entity_type = 'checkout_v2_guarantee_operation'
  AND entity_id IN (
      :'operation_id', '77d00000-0000-4000-8000-000000000002'
  );
DELETE FROM public.fulfillment_jobs
WHERE subscription_id = '77600000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_v2_guarantee_operations
WHERE id IN (
    :'operation_id'::UUID,
    '77d00000-0000-4000-8000-000000000002'::UUID
);
DELETE FROM public.support_tickets
WHERE id IN (
    :'support_ticket_id'::UUID,
    '77c00000-0000-4000-8000-000000000002'::UUID
);
DELETE FROM public.checkout_v2_billing_state
WHERE subscription_id = '77600000-0000-4000-8000-000000000001';
DELETE FROM public.bookable_slot_holds
WHERE id = '78300000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_v2_weekly_allocations
WHERE id = '78400000-0000-4000-8000-000000000001';
DELETE FROM public.bookable_slots
WHERE id = '78200000-0000-4000-8000-000000000001';
DELETE FROM public.sessions
WHERE subscription_id = '77600000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_v2_cycles
WHERE subscription_id = '77600000-0000-4000-8000-000000000001';
DELETE FROM public.payments
WHERE subscription_id = '77600000-0000-4000-8000-000000000001';
DELETE FROM public.subscriptions
WHERE id = '77600000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_intents
WHERE id = '77500000-0000-4000-8000-000000000001';
DELETE FROM public.crm_opportunities
WHERE id = '77400000-0000-4000-8000-000000000001';
DELETE FROM public.crm_contacts
WHERE id = '77300000-0000-4000-8000-000000000001';
DELETE FROM public.checkout_v2_price_snapshots
WHERE package_price_id = '77200000-0000-4000-8000-000000000001';
DELETE FROM public.package_prices
WHERE id = '77200000-0000-4000-8000-000000000001';
DELETE FROM public.packages
WHERE id = '77100000-0000-4000-8000-000000000001';
DELETE FROM public.profiles
WHERE id IN (
    '77000000-0000-4000-8000-000000000001',
    '77000000-0000-4000-8000-000000000002',
    '77000000-0000-4000-8000-000000000003'
);
COMMIT;
