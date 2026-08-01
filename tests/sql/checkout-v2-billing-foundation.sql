\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';

BEGIN;

CREATE TEMP TABLE checkout_v2_test_ids (
    name TEXT PRIMARY KEY,
    id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO auth.users (id, email) VALUES
    ('10000000-0000-4000-8000-000000000001', 'student@test.invalid'),
    ('10000000-0000-4000-8000-000000000002', 'teacher@test.invalid'),
    ('10000000-0000-4000-8000-000000000003', 'admin@test.invalid'),
    ('10000000-0000-4000-8000-000000000004', 'student-two@test.invalid'),
    ('10000000-0000-4000-8000-000000000005', 'student-three@test.invalid'),
    ('10000000-0000-4000-8000-000000000006', 'orphan-owner@test.invalid'),
    ('10000000-0000-4000-8000-000000000007', 'orphan-successor@test.invalid');

UPDATE public.profiles
SET role = 'teacher'
WHERE id = '10000000-0000-4000-8000-000000000002';

UPDATE public.profiles
SET role = 'admin'
WHERE id = '10000000-0000-4000-8000-000000000003';

SELECT
    id AS v2_package_id,
    catalog_version AS v2_catalog_version
FROM public.packages
WHERE name = 'individual_4x50_28d'
  AND contract_schema_version = 2
\gset

UPDATE public.packages
SET is_active = TRUE, is_publicly_listed = TRUE
WHERE id = :'v2_package_id'::UUID;

SELECT (
    public.activate_versioned_package_price(
        :'v2_package_id'::UUID,
        :'v2_catalog_version'::BIGINT,
        25900::INTEGER,
        'eur'::TEXT,
        'day'::TEXT,
        28::SMALLINT,
        4::INTEGER,
        50::SMALLINT,
        'acct_test_isolated'::TEXT,
        FALSE,
        'prod_test_isolated'::TEXT,
        'price_test_recurring_28d'::TEXT,
        '10000000-0000-4000-8000-000000000003'::UUID
    )
).id AS package_price_id
\gset

SELECT public.register_checkout_v2_price_snapshot(
    :'package_price_id'::UUID,
    'acct_test_isolated',
    FALSE,
    'price_test_initial_259',
    'price_test_recurring_28d'
);

SELECT public.register_checkout_v2_price_snapshot(
    :'package_price_id'::UUID,
    'acct_test_isolated',
    FALSE,
    'price_test_initial_259',
    'price_test_recurring_28d'
);

SELECT (
    date_trunc(
        'week',
        pg_catalog.make_date(
            EXTRACT(
                YEAR FROM clock_timestamp() AT TIME ZONE 'Europe/Madrid'
            )::INTEGER + 1,
            7,
            7
        )::TIMESTAMP
    ) + INTERVAL '9 hours'
)::TIMESTAMP AS first_local
\gset

INSERT INTO public.teacher_availability (
    teacher_id,
    day_of_week,
    start_time,
    end_time,
    is_active
) VALUES (
    '10000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM :'first_local'::TIMESTAMP)::INTEGER,
    :'first_local'::TIMESTAMP::TIME,
    (:'first_local'::TIMESTAMP + INTERVAL '1 hour')::TIME,
    TRUE
);

SELECT
    slot.id AS slot_id,
    slot.public_id AS slot_public_id
FROM public.create_bookable_slot(
        :'v2_package_id'::UUID,
        '10000000-0000-4000-8000-000000000002',
        'Europe/Madrid',
        ARRAY[
            :'first_local'::TIMESTAMP AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '7 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '14 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '21 days') AT TIME ZONE 'Europe/Madrid'
        ],
        '10000000-0000-4000-8000-000000000003'
    ) AS slot
\gset

SELECT public.publish_bookable_slot(
    :'slot_id'::UUID,
    '10000000-0000-4000-8000-000000000003'
);

SELECT
    intent.id AS checkout_intent_id,
    intent.contact_id AS checkout_contact_id,
    intent.opportunity_id AS checkout_opportunity_id
FROM public.claim_direct_checkout_intent_for_slot(
        '10000000-0000-4000-8000-000000000001',
        'STUDENT@test.invalid',
        'Direct Student',
        :'package_price_id'::UUID,
        'en',
        'test-policy-v1',
        'https://example.test',
        :'slot_public_id'::UUID,
        ('v1:' || repeat('a', 64))::TEXT
    ) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id) VALUES
    ('direct_intent', :'checkout_intent_id'::UUID),
    ('direct_contact', :'checkout_contact_id'::UUID),
    ('direct_opportunity', :'checkout_opportunity_id'::UUID);

SELECT intent.id AS replay_intent_id
FROM public.claim_direct_checkout_intent_for_slot(
    '10000000-0000-4000-8000-000000000001',
    'student@test.invalid',
    'Direct Student',
    :'package_price_id'::UUID,
    'en',
    'test-policy-v1',
    'https://example.test',
    :'slot_public_id'::UUID,
    ('v1:' || repeat('c', 64))::TEXT
) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('direct_intent_replay', :'replay_intent_id'::UUID);

DO $$
BEGIN
    IF (SELECT id FROM checkout_v2_test_ids WHERE name = 'direct_intent')
       IS DISTINCT FROM
       (SELECT id FROM checkout_v2_test_ids WHERE name = 'direct_intent_replay')
       OR (
            SELECT COUNT(*)
            FROM public.crm_contacts
            WHERE profile_id = '10000000-0000-4000-8000-000000000001'
       ) <> 1
       OR NOT EXISTS (
            SELECT 1
            FROM public.crm_contacts
            WHERE id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'direct_contact'
            )
              AND lower(primary_email) = 'student@test.invalid'
              AND full_name = 'Direct Student'
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.crm_opportunities
            WHERE id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'direct_opportunity'
            )
              AND stage = 'proposal'
              AND interest = 'direct_checkout'
              AND preferred_package_id = (
                    SELECT id
                    FROM public.packages
                    WHERE name = 'individual_4x50_28d'
                      AND contract_schema_version = 2
              )
              AND checkout_approved_at IS NOT NULL
       )
       OR (
            SELECT COUNT(*)
            FROM public.bookable_slot_holds
            WHERE checkout_intent_id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'direct_intent'
            )
              AND status = 'held'
              AND hold_fingerprint = ('v1:' || repeat('a', 64))
       ) <> 1 THEN
        RAISE EXCEPTION 'direct_checkout_claim_is_not_idempotent';
    END IF;
END
$$;

INSERT INTO public.teacher_availability (
    teacher_id,
    day_of_week,
    start_time,
    end_time,
    is_active
) VALUES (
    '10000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM (:'first_local'::TIMESTAMP + INTERVAL '1 day'))::INTEGER,
    :'first_local'::TIMESTAMP::TIME,
    (:'first_local'::TIMESTAMP + INTERVAL '1 hour')::TIME,
    TRUE
);

SELECT competing_slot.public_id AS competing_slot_public_id
FROM public.create_bookable_slot(
    :'v2_package_id'::UUID,
    '10000000-0000-4000-8000-000000000002',
    'Europe/Madrid',
    ARRAY[
        (:'first_local'::TIMESTAMP + INTERVAL '1 day') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '8 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '15 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '22 days') AT TIME ZONE 'Europe/Madrid'
    ],
    '10000000-0000-4000-8000-000000000003'
) AS competing_slot
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('competing_slot_public', :'competing_slot_public_id'::UUID);

SELECT public.publish_bookable_slot(
    slot.id,
    '10000000-0000-4000-8000-000000000003'
)
FROM public.bookable_slots AS slot
WHERE slot.public_id = :'competing_slot_public_id'::UUID;

DO $$
DECLARE
    target_package_price_id UUID;
    target_slot_public_id UUID;
BEGIN
    SELECT id INTO target_package_price_id
    FROM public.package_prices
    WHERE stripe_price_id = 'price_test_recurring_28d';

    SELECT id INTO target_slot_public_id
    FROM checkout_v2_test_ids
    WHERE name = 'competing_slot_public';

    PERFORM public.claim_direct_checkout_intent_for_slot(
        '10000000-0000-4000-8000-000000000001',
        'student@test.invalid',
        'Direct Student',
        target_package_price_id,
        'en',
        'test-policy-v1',
        'https://example.test',
        target_slot_public_id,
        ('v1:' || repeat('a', 64))::TEXT
    );
    RAISE EXCEPTION 'competing_direct_checkout_claim_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_intent_already_has_another_slot_state' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM public.checkout_intents
        WHERE student_id = '10000000-0000-4000-8000-000000000001'
          AND status IN ('creating', 'open')
    ) <> 1 OR (
        SELECT COUNT(*)
        FROM public.bookable_slot_holds
        WHERE status = 'held'
          AND checkout_intent_id = (
              SELECT id FROM checkout_v2_test_ids WHERE name = 'direct_intent'
          )
    ) <> 1 THEN
        RAISE EXCEPTION 'competing_direct_checkout_claim_was_not_atomic';
    END IF;
END
$$;

DO $$
DECLARE
    target_package_price_id UUID;
    target_slot_public_id UUID;
BEGIN
    SELECT id INTO target_package_price_id
    FROM public.package_prices
    WHERE stripe_price_id = 'price_test_recurring_28d';

    SELECT id INTO target_slot_public_id
    FROM checkout_v2_test_ids
    WHERE name = 'competing_slot_public';

    PERFORM public.claim_direct_checkout_intent_for_slot(
        '10000000-0000-4000-8000-000000000004',
        'student-two@test.invalid',
        'Second Student',
        target_package_price_id,
        'en',
        'test-policy-v1',
        'https://example.test',
        target_slot_public_id,
        ('v1:' || repeat('a', 64))::TEXT
    );
    RAISE EXCEPTION 'same_network_second_hold_was_accepted';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'checkout_hold_fingerprint_already_active' THEN
        RAISE;
    END IF;
END
$$;

SELECT intent.id AS second_student_intent_id
FROM public.claim_direct_checkout_intent_for_slot(
    '10000000-0000-4000-8000-000000000004',
    'student-two@test.invalid',
    'Second Student',
    :'package_price_id'::UUID,
    'en',
    'test-policy-v1',
    'https://example.test',
    :'competing_slot_public_id'::UUID,
    ('v1:' || repeat('b', 64))::TEXT
) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('second_student_intent', :'second_student_intent_id'::UUID);

DO $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM public.bookable_slot_holds
        WHERE status = 'held'
          AND hold_fingerprint IN (
              ('v1:' || repeat('a', 64)),
              ('v1:' || repeat('b', 64))
          )
    ) <> 2 THEN
        RAISE EXCEPTION 'distinct_network_fingerprints_did_not_hold_independent_slots';
    END IF;
END
$$;

INSERT INTO public.teacher_availability (
    teacher_id,
    day_of_week,
    start_time,
    end_time,
    is_active
) VALUES (
    '10000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM (:'first_local'::TIMESTAMP + INTERVAL '2 days'))::INTEGER,
    :'first_local'::TIMESTAMP::TIME,
    (:'first_local'::TIMESTAMP + INTERVAL '1 hour')::TIME,
    TRUE
);

SELECT reusable_slot.public_id AS reusable_slot_public_id
FROM public.create_bookable_slot(
    :'v2_package_id'::UUID,
    '10000000-0000-4000-8000-000000000002',
    'Europe/Madrid',
    ARRAY[
        (:'first_local'::TIMESTAMP + INTERVAL '2 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '9 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '16 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '23 days') AT TIME ZONE 'Europe/Madrid'
    ],
    '10000000-0000-4000-8000-000000000003'
) AS reusable_slot
\gset

SELECT public.publish_bookable_slot(
    slot.id,
    '10000000-0000-4000-8000-000000000003'
)
FROM public.bookable_slots AS slot
WHERE slot.public_id = :'reusable_slot_public_id'::UUID;

SELECT public.snapshot_checkout_intent_customer(
    :'second_student_intent_id'::UUID,
    'cus_test_second_student'
);

SELECT public.release_expired_checkout_intent(
    :'second_student_intent_id'::UUID,
    'cs_test_second_student_expired'
);

DO $$
DECLARE
    target_intent_id UUID;
    target_slot_id UUID;
    replayed_hold public.bookable_slot_holds%ROWTYPE;
BEGIN
    SELECT id INTO target_intent_id
    FROM checkout_v2_test_ids
    WHERE name = 'second_student_intent';

    SELECT slot_id INTO target_slot_id
    FROM public.bookable_slot_holds
    WHERE checkout_intent_id = target_intent_id;

    replayed_hold := public.hold_bookable_slot(
        target_slot_id,
        target_intent_id,
        ('v1:' || repeat('c', 64))::TEXT
    );

    IF replayed_hold.checkout_intent_id IS DISTINCT FROM target_intent_id
       OR replayed_hold.slot_id IS DISTINCT FROM target_slot_id
       OR replayed_hold.status <> 'held'
       OR replayed_hold.hold_fingerprint IS DISTINCT FROM (
           'v1:' || repeat('b', 64)
       ) THEN
        RAISE EXCEPTION 'expired_checkout_hold_replay_changed_the_original_hold';
    END IF;
END
$$;

SELECT intent.id AS third_student_intent_id
FROM public.claim_direct_checkout_intent_for_slot(
    '10000000-0000-4000-8000-000000000005',
    'student-three@test.invalid',
    'Third Student',
    :'package_price_id'::UUID,
    'en',
    'test-policy-v1',
    'https://example.test',
    :'reusable_slot_public_id'::UUID,
    ('v1:' || repeat('b', 64))::TEXT
) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('third_student_intent', :'third_student_intent_id'::UUID);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE checkout_intent_id = (
            SELECT id
            FROM checkout_v2_test_ids
            WHERE name = 'second_student_intent'
        )
          AND status = 'expired'
          AND hold_fingerprint IS NULL
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE checkout_intent_id = (
            SELECT id
            FROM checkout_v2_test_ids
            WHERE name = 'third_student_intent'
        )
          AND status = 'held'
          AND hold_fingerprint = ('v1:' || repeat('b', 64))
    ) THEN
        RAISE EXCEPTION 'expired_network_hold_was_not_cleaned_and_reused';
    END IF;
END
$$;

INSERT INTO public.teacher_availability (
    teacher_id,
    day_of_week,
    start_time,
    end_time,
    is_active
) VALUES (
    '10000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM (:'first_local'::TIMESTAMP + INTERVAL '3 days'))::INTEGER,
    :'first_local'::TIMESTAMP::TIME,
    (:'first_local'::TIMESTAMP + INTERVAL '1 hour')::TIME,
    TRUE
);

SELECT orphan_slot.public_id AS orphan_slot_public_id
FROM public.create_bookable_slot(
    :'v2_package_id'::UUID,
    '10000000-0000-4000-8000-000000000002',
    'Europe/Madrid',
    ARRAY[
        (:'first_local'::TIMESTAMP + INTERVAL '3 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '10 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '17 days') AT TIME ZONE 'Europe/Madrid',
        (:'first_local'::TIMESTAMP + INTERVAL '24 days') AT TIME ZONE 'Europe/Madrid'
    ],
    '10000000-0000-4000-8000-000000000003'
) AS orphan_slot
\gset

SELECT public.publish_bookable_slot(
    slot.id,
    '10000000-0000-4000-8000-000000000003'
)
FROM public.bookable_slots AS slot
WHERE slot.public_id = :'orphan_slot_public_id'::UUID;

SELECT intent.id AS orphan_intent_id
FROM public.claim_direct_checkout_intent_for_slot(
    '10000000-0000-4000-8000-000000000006',
    'orphan-owner@test.invalid',
    'Orphan Owner',
    :'package_price_id'::UUID,
    'en',
    'test-policy-v1',
    'https://example.test',
    :'orphan_slot_public_id'::UUID,
    ('v1:' || repeat('d', 64))::TEXT
) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('orphan_intent', :'orphan_intent_id'::UUID);

-- Model a process crash before Customer creation. The trigger is disabled only
-- to age this fixture by two hours without making the SQL test wait in real time.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE public.checkout_intents
    DISABLE TRIGGER guard_checkout_intent_snapshots_trigger;

UPDATE public.checkout_intents
SET
    created_at = clock_timestamp() - INTERVAL '4 hours',
    stripe_session_expires_at = clock_timestamp() - INTERVAL '3 hours',
    expires_at = clock_timestamp() - INTERVAL '2 hours',
    updated_at = clock_timestamp()
WHERE id = :'orphan_intent_id'::UUID;

ALTER TABLE public.checkout_intents
    ENABLE TRIGGER guard_checkout_intent_snapshots_trigger;

ALTER TABLE public.bookable_slot_holds
    DISABLE TRIGGER guard_bookable_slot_hold_trigger;

UPDATE public.bookable_slot_holds AS orphan_hold
SET
    held_at = orphan_intent.expires_at - INTERVAL '2 hours',
    expires_at = orphan_intent.expires_at,
    updated_at = clock_timestamp()
FROM public.checkout_intents AS orphan_intent
WHERE orphan_hold.checkout_intent_id = orphan_intent.id
  AND orphan_intent.id = :'orphan_intent_id'::UUID;

ALTER TABLE public.bookable_slot_holds
    ENABLE TRIGGER guard_bookable_slot_hold_trigger;

SET CONSTRAINTS ALL DEFERRED;

SELECT intent.id AS orphan_successor_intent_id
FROM public.claim_direct_checkout_intent_for_slot(
    '10000000-0000-4000-8000-000000000007',
    'orphan-successor@test.invalid',
    'Orphan Successor',
    :'package_price_id'::UUID,
    'en',
    'test-policy-v1',
    'https://example.test',
    :'orphan_slot_public_id'::UUID,
    ('v1:' || repeat('d', 64))::TEXT
) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('orphan_successor_intent', :'orphan_successor_intent_id'::UUID);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_intents
        WHERE id = (
            SELECT id FROM checkout_v2_test_ids WHERE name = 'orphan_intent'
        )
          AND status = 'expired'
          AND stripe_customer_id IS NULL
          AND stripe_checkout_session_id IS NULL
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE checkout_intent_id = (
            SELECT id FROM checkout_v2_test_ids WHERE name = 'orphan_intent'
        )
          AND status = 'expired'
          AND hold_fingerprint IS NULL
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.bookable_slot_holds
        WHERE checkout_intent_id = (
            SELECT id
            FROM checkout_v2_test_ids
            WHERE name = 'orphan_successor_intent'
        )
          AND status = 'held'
          AND hold_fingerprint = ('v1:' || repeat('d', 64))
    ) THEN
        RAISE EXCEPTION 'unowned_expired_checkout_hold_was_not_safely_reclaimed';
    END IF;
END
$$;

SELECT public.snapshot_checkout_intent_customer(
    :'checkout_intent_id'::UUID,
    'cus_test_isolated'
);

SELECT public.complete_checkout_intent(
    :'checkout_intent_id'::UUID,
    :'checkout_opportunity_id'::UUID,
    '10000000-0000-4000-8000-000000000001',
    :'package_price_id'::UUID,
    'cs_test_isolated',
    'cus_test_isolated'
);

INSERT INTO public.subscriptions (
    id,
    student_id,
    package_id,
    package_price_id,
    checkout_intent_id,
    status,
    duration_months,
    starts_at,
    ends_at,
    sessions_total,
    contracted_sessions_per_period,
    sessions_used,
    stripe_subscription_id,
    stripe_invoice_id,
    contract_schema_version,
    billing_interval_unit,
    billing_interval_count,
    class_duration_minutes
) VALUES (
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    :'v2_package_id'::UUID,
    :'package_price_id'::UUID,
    :'checkout_intent_id'::UUID,
    'active',
    NULL,
    (:'first_local'::TIMESTAMP)::DATE,
    (:'first_local'::TIMESTAMP)::DATE + 28,
    4,
    4,
    0,
    'sub_test_isolated',
    'in_test_initial',
    2,
    'day',
    28,
    50
);

SELECT public.consume_bookable_slot_hold(
    :'checkout_intent_id'::UUID,
    '50000000-0000-4000-8000-000000000001'
);

SELECT public.materialize_bookable_slot_sessions(
    :'slot_id'::UUID,
    '50000000-0000-4000-8000-000000000001'
);

SELECT session_id AS first_session_id
FROM public.bookable_slot_occurrences
WHERE slot_id = :'slot_id'::UUID
  AND occurrence_index = 1
\gset

INSERT INTO public.payments (
    id,
    student_id,
    subscription_id,
    amount,
    currency,
    status,
    stripe_payment_intent_id,
    stripe_invoice_id
) VALUES (
    '60000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    25900,
    'eur',
    'succeeded',
    'pi_test_initial',
    'in_test_initial'
);

SELECT scheduled_at + INTERVAL '672 hours' AS first_anchor_at
FROM public.sessions
WHERE id = :'first_session_id'::UUID
\gset

SELECT public.initialize_checkout_v2_billing(
    '50000000-0000-4000-8000-000000000001',
    :'first_session_id'::UUID,
    '60000000-0000-4000-8000-000000000001',
    'price_test_initial_259',
    :'first_anchor_at'::TIMESTAMPTZ
);

-- Exact replay is idempotent and revalidates every durable link.
SELECT public.initialize_checkout_v2_billing(
    '50000000-0000-4000-8000-000000000001',
    :'first_session_id'::UUID,
    '60000000-0000-4000-8000-000000000001',
    'price_test_initial_259',
    :'first_anchor_at'::TIMESTAMPTZ
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_billing_state AS billing
        JOIN public.checkout_v2_cycles AS cycle
          ON cycle.subscription_id = billing.subscription_id
         AND cycle.cycle_number = 1
        JOIN public.checkout_v2_weekly_allocations AS allocation
          ON allocation.subscription_id = billing.subscription_id
         AND allocation.status = 'active'
        WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND billing.anchor_state = 'provisional'
          AND billing.renewal_anchor_at = billing.first_class_at + INTERVAL '672 hours'
          AND cycle.ends_at = cycle.starts_at + INTERVAL '672 hours'
          AND cycle.sessions_total = 4
          AND cycle.stripe_price_id = 'price_test_initial_259'
          AND cycle.materialization_state = 'ready'
          AND cycle.sessions_materialized_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'initial_checkout_v2_ledger_is_incomplete';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.sessions
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND checkout_v2_cycle_id IS NOT NULL
          AND checkout_v2_cycle_session_index BETWEEN 1 AND 4
    ) <> 4 THEN
        RAISE EXCEPTION 'initial_sessions_are_not_bound_to_cycle';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.payments
        WHERE id = '60000000-0000-4000-8000-000000000001'
          AND checkout_v2_cycle_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'initial_payment_is_not_bound_to_cycle';
    END IF;
END
$$;

-- Once the RPC establishes the ledger, direct writes cannot detach or
-- reposition its payment and materialized sessions.
DO $$
BEGIN
    UPDATE public.payments
    SET checkout_v2_cycle_id = NULL
    WHERE id = '60000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'linked_checkout_v2_payment_was_detached';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_cycle_binding_is_immutable' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.sessions
    SET
        checkout_v2_cycle_id = NULL,
        checkout_v2_cycle_session_index = NULL
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 2;
    RAISE EXCEPTION 'materialized_checkout_v2_session_was_detached';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_cycle_binding_is_immutable' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    UPDATE public.sessions
    SET checkout_v2_cycle_session_index = 4
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 2;
    RAISE EXCEPTION 'materialized_checkout_v2_session_was_repositioned';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_session_cycle_position_is_immutable' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    DELETE FROM public.sessions
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 2;
    RAISE EXCEPTION 'materialized_checkout_v2_session_was_deleted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_materialized_session_cannot_be_deleted' THEN
        RAISE;
    END IF;
END
$$;

UPDATE public.subscriptions
SET status = 'paused'
WHERE id = '50000000-0000-4000-8000-000000000001';

UPDATE public.subscriptions
SET status = 'active'
WHERE id = '50000000-0000-4000-8000-000000000001';

DO $$
BEGIN
    PERFORM public.apply_subscription_renewal(
        '50000000-0000-4000-8000-000000000001',
        'sub_test_isolated',
        'in_forbidden_legacy_renewal',
        (
            SELECT ends_at + 28
            FROM public.subscriptions
            WHERE id = '50000000-0000-4000-8000-000000000001'
        )
    );
    RAISE EXCEPTION 'legacy_renewal_unexpectedly_accepted_v2';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_renewal_requires_cycle_ledger' THEN
        RAISE;
    END IF;
END
$$;

SELECT
    ((billing.first_class_at AT TIME ZONE allocation.timezone_name)::DATE + 7)
        AS moved_first_local_date,
    (
        (
            (billing.first_class_at AT TIME ZONE allocation.timezone_name)::DATE + 7
        ) + allocation.local_start_time
    ) AT TIME ZONE allocation.timezone_name AS moved_first_class_at
FROM public.checkout_v2_billing_state AS billing
JOIN public.checkout_v2_weekly_allocations AS allocation
  ON allocation.subscription_id = billing.subscription_id
 AND allocation.status = 'active'
WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001'
\gset

SELECT public.reconcile_checkout_v2_provisional_anchor(
    '50000000-0000-4000-8000-000000000001',
    1,
    :'moved_first_local_date'::DATE,
    :'moved_first_class_at'::TIMESTAMPTZ + INTERVAL '672 hours'
);

-- Replaying the exact already-applied revision is safe.
SELECT public.reconcile_checkout_v2_provisional_anchor(
    '50000000-0000-4000-8000-000000000001',
    1,
    :'moved_first_local_date'::DATE,
    :'moved_first_class_at'::TIMESTAMPTZ + INTERVAL '672 hours'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_billing_state AS billing
        JOIN public.checkout_v2_cycles AS cycle
          ON cycle.subscription_id = billing.subscription_id
         AND cycle.cycle_number = 1
        JOIN public.subscriptions AS subscription
          ON subscription.id = billing.subscription_id
        WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND billing.anchor_revision = 2
          AND billing.renewal_anchor_at = billing.first_class_at + INTERVAL '672 hours'
          AND cycle.starts_at = billing.first_class_at
          AND cycle.ends_at = billing.renewal_anchor_at
          AND subscription.starts_at = (
                billing.first_class_at AT TIME ZONE 'Europe/Madrid'
              )::DATE
          AND subscription.ends_at = (
                billing.renewal_anchor_at AT TIME ZONE 'Europe/Madrid'
              )::DATE
    ) THEN
        RAISE EXCEPTION 'provisional_anchor_did_not_reconcile_atomically';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM public.sessions AS session_row
        JOIN public.checkout_v2_billing_state AS billing
          ON billing.subscription_id = session_row.subscription_id
        JOIN public.checkout_v2_weekly_allocations AS allocation
          ON allocation.subscription_id = billing.subscription_id
         AND allocation.status = 'active'
        WHERE session_row.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND session_row.checkout_v2_cycle_session_index BETWEEN 1 AND 4
          AND session_row.status = 'scheduled'
          AND session_row.scheduled_at = (
                (
                    (billing.first_class_at AT TIME ZONE allocation.timezone_name)::DATE
                    + allocation.local_start_time
                    + pg_catalog.make_interval(
                        days => (session_row.checkout_v2_cycle_session_index - 1) * 7
                      )
                ) AT TIME ZONE allocation.timezone_name
          )
    ) <> 4 THEN
        RAISE EXCEPTION 'provisional_anchor_did_not_move_all_four_sessions';
    END IF;
END
$$;

-- A four-week Madrid-local pattern is invalid when any occurrence is missing
-- in spring or ambiguous in autumn, even if the first requested date itself
-- round-trips successfully.
DO $$
DECLARE
    target_year INTEGER := EXTRACT(
        YEAR FROM clock_timestamp() AT TIME ZONE 'Europe/Madrid'
    )::INTEGER + 1;
    march_end DATE;
    spring_first_local_date DATE;
BEGIN
    march_end := pg_catalog.make_date(target_year, 3, 31);
    spring_first_local_date :=
        march_end - EXTRACT(DOW FROM march_end)::INTEGER - 21;

    PERFORM public.reconcile_checkout_v2_provisional_anchor(
        '50000000-0000-4000-8000-000000000001',
        2,
        spring_first_local_date,
        (
            (spring_first_local_date + TIME '02:30')
            AT TIME ZONE 'Europe/Madrid'
        ) + INTERVAL '672 hours'
    );
    RAISE EXCEPTION 'nonexistent_madrid_occurrence_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_provisional_anchor_cannot_move' THEN
        RAISE;
    END IF;
END
$$;

DO $$
DECLARE
    target_year INTEGER := EXTRACT(
        YEAR FROM clock_timestamp() AT TIME ZONE 'Europe/Madrid'
    )::INTEGER + 1;
    october_end DATE;
    autumn_first_local_date DATE;
BEGIN
    october_end := pg_catalog.make_date(target_year, 10, 31);
    autumn_first_local_date :=
        october_end - EXTRACT(DOW FROM october_end)::INTEGER;

    PERFORM public.reconcile_checkout_v2_provisional_anchor(
        '50000000-0000-4000-8000-000000000001',
        2,
        autumn_first_local_date,
        (
            (autumn_first_local_date + TIME '02:30')
            AT TIME ZONE 'Europe/Madrid'
        ) + INTERVAL '672 hours'
    );
    RAISE EXCEPTION 'ambiguous_madrid_occurrence_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_provisional_anchor_cannot_move' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    IF (
        SELECT anchor_revision
        FROM public.checkout_v2_billing_state
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
    ) IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'rejected_dst_anchor_changed_billing_state';
    END IF;
END
$$;

-- The role used by application code cannot bypass the temporal RPC.
DO $$
BEGIN
    IF has_table_privilege(
        'service_role',
        'public.checkout_v2_billing_state',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION 'service_role_can_bypass_checkout_v2_anchor_rpc';
    END IF;
END
$$;

-- Test-only clock seam: move the still-provisional four-session snapshot into
-- the past as database owner, then exercise the real public fixation RPC. This
-- does not grant the application role any equivalent mutation path.
SELECT (
    (
        date_trunc(
            'week',
            clock_timestamp() AT TIME ZONE allocation.timezone_name
        )
        + pg_catalog.make_interval(
            days => ((allocation.weekday::INTEGER + 6) % 7) - 7
          )
        + allocation.local_start_time
    ) AT TIME ZONE allocation.timezone_name
) AS simulated_first_class_at
FROM public.checkout_v2_billing_state AS billing
JOIN public.checkout_v2_weekly_allocations AS allocation
  ON allocation.subscription_id = billing.subscription_id
 AND allocation.status = 'active'
WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001'
\gset

UPDATE public.sessions
SET scheduled_at = 'infinity'::TIMESTAMPTZ
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND checkout_v2_cycle_session_index BETWEEN 1 AND 4;

UPDATE public.sessions
SET scheduled_at = (
    (:'simulated_first_class_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid')
    + pg_catalog.make_interval(
        days => (checkout_v2_cycle_session_index - 1) * 7
      )
) AT TIME ZONE 'Europe/Madrid'
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND checkout_v2_cycle_session_index BETWEEN 1 AND 4;

UPDATE public.checkout_v2_cycles
SET
    starts_at = :'simulated_first_class_at'::TIMESTAMPTZ,
    ends_at = :'simulated_first_class_at'::TIMESTAMPTZ + INTERVAL '672 hours'
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND cycle_number = 1;

UPDATE public.checkout_v2_billing_state
SET
    first_class_at = :'simulated_first_class_at'::TIMESTAMPTZ,
    renewal_anchor_at = :'simulated_first_class_at'::TIMESTAMPTZ + INTERVAL '672 hours',
    stripe_renewal_anchor_at = :'simulated_first_class_at'::TIMESTAMPTZ + INTERVAL '672 hours',
    anchor_revision = anchor_revision + 1
WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

UPDATE public.subscriptions
SET
    starts_at = (:'simulated_first_class_at'::TIMESTAMPTZ AT TIME ZONE 'Europe/Madrid')::DATE,
    ends_at = (
        (:'simulated_first_class_at'::TIMESTAMPTZ + INTERVAL '672 hours')
        AT TIME ZONE 'Europe/Madrid'
    )::DATE
WHERE id = '50000000-0000-4000-8000-000000000001';

SELECT public.fix_checkout_v2_billing_anchor(
    '50000000-0000-4000-8000-000000000001',
    :'simulated_first_class_at'::TIMESTAMPTZ + INTERVAL '50 minutes'
);

DO $$
BEGIN
    PERFORM public.fix_checkout_v2_billing_anchor(
        '50000000-0000-4000-8000-000000000001',
        (
            SELECT anchor_fixed_at + INTERVAL '1 minute'
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        )
    );
    RAISE EXCEPTION 'contradictory_fixed_anchor_replay_was_accepted';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'checkout_v2_fixed_anchor_conflicts' THEN
        RAISE;
    END IF;
END
$$;

-- A paid invoice can race a local pause event; reconciliation returns the
-- subscription to active without losing its durable sold-slot binding.
UPDATE public.subscriptions
SET status = 'paused'
WHERE id = '50000000-0000-4000-8000-000000000001';

INSERT INTO public.payments (
    id,
    student_id,
    subscription_id,
    amount,
    currency,
    status,
    stripe_payment_intent_id,
    stripe_invoice_id
) VALUES (
    '60000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    25900,
    'eur',
    'succeeded',
    'pi_test_renewal_1',
    'in_test_renewal_1'
);

SELECT ends_at AS renewal_period_start
FROM public.checkout_v2_cycles
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND cycle_number = 1
\gset

SELECT public.apply_checkout_v2_renewal(
    '50000000-0000-4000-8000-000000000001',
    'sub_test_isolated',
    'in_test_renewal_1',
    '60000000-0000-4000-8000-000000000002',
    'price_test_recurring_28d',
    :'renewal_period_start'::TIMESTAMPTZ,
    :'renewal_period_start'::TIMESTAMPTZ + INTERVAL '672 hours'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles AS cycle
        JOIN public.subscriptions AS subscription
          ON subscription.id = cycle.subscription_id
        JOIN public.bookable_slot_holds AS hold
          ON hold.subscription_id = subscription.id
        JOIN public.bookable_slots AS slot
          ON slot.sold_subscription_id = subscription.id
        WHERE cycle.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND cycle.cycle_number = 2
          AND cycle.cycle_kind = 'renewal'
          AND cycle.stripe_price_id = 'price_test_recurring_28d'
          AND cycle.materialization_state = 'pending'
          AND cycle.sessions_materialized_at IS NULL
          AND cycle.ends_at = cycle.starts_at + INTERVAL '672 hours'
          AND hold.status = 'consumed'
          AND slot.status = 'sold'
          AND subscription.status = 'active'
          AND subscription.stripe_invoice_id = 'in_test_renewal_1'
    ) THEN
        RAISE EXCEPTION 'renewal_did_not_preserve_the_durable_sale';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.payments AS payment_row
        JOIN public.checkout_v2_cycles AS cycle
          ON cycle.id = payment_row.checkout_v2_cycle_id
        WHERE payment_row.id = '60000000-0000-4000-8000-000000000002'
          AND cycle.cycle_number = 2
    ) THEN
        RAISE EXCEPTION 'renewal_payment_is_not_bound_to_cycle';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sessions
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND checkout_v2_cycle_id = (
                SELECT id
                FROM public.checkout_v2_cycles
                WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
                  AND cycle_number = 2
          )
    ) THEN
        RAISE EXCEPTION 'pending_renewal_cycle_claims_materialized_sessions';
    END IF;
END
$$;

DO $$
BEGIN
    INSERT INTO public.sessions (
        subscription_id,
        student_id,
        status
    ) VALUES (
        '50000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'cancelled'
    );
    RAISE EXCEPTION 'checkout_v2_session_without_cycle_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_session_requires_cycle' THEN
        RAISE;
    END IF;
END
$$;

SELECT public.materialize_checkout_v2_cycle_sessions(
    '50000000-0000-4000-8000-000000000001',
    'in_test_renewal_1'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND cycle_number = 2
          AND materialization_state = 'ready'
          AND sessions_materialized_at IS NOT NULL
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE id = '50000000-0000-4000-8000-000000000001'
          AND sessions_used = 4
    ) OR (
        SELECT COUNT(*)
        FROM public.sessions
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND checkout_v2_cycle_id IS NOT NULL
    ) <> 8 OR (
        SELECT COUNT(*)
        FROM public.sessions AS session_row
        JOIN public.checkout_v2_cycles AS cycle_row
          ON cycle_row.id = session_row.checkout_v2_cycle_id
        JOIN public.checkout_v2_billing_state AS billing_row
          ON billing_row.subscription_id = cycle_row.subscription_id
        JOIN public.checkout_v2_weekly_allocations AS allocation_row
          ON allocation_row.subscription_id = cycle_row.subscription_id
         AND allocation_row.status = 'active'
        WHERE cycle_row.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND cycle_row.cycle_number = 2
          AND session_row.checkout_v2_cycle_session_index BETWEEN 1 AND 4
          AND session_row.student_id = '10000000-0000-4000-8000-000000000001'
          AND session_row.teacher_id = allocation_row.teacher_id
          AND session_row.duration_minutes = 50
          AND session_row.status = 'scheduled'
          AND EXTRACT(
                DOW FROM session_row.scheduled_at AT TIME ZONE allocation_row.timezone_name
              )::SMALLINT = allocation_row.weekday
          AND (session_row.scheduled_at AT TIME ZONE allocation_row.timezone_name)::TIME(0)
                = allocation_row.local_start_time
          AND session_row.scheduled_at = (
                (
                    (billing_row.first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
                    + 28
                    + ((session_row.checkout_v2_cycle_session_index - 1) * 7)
                    + allocation_row.local_start_time
                ) AT TIME ZONE allocation_row.timezone_name
          )
    ) <> 4 THEN
        RAISE EXCEPTION 'renewal_cycle_sessions_were_not_materialized_exactly';
    END IF;
END
$$;

SELECT public.materialize_checkout_v2_cycle_sessions(
    '50000000-0000-4000-8000-000000000001',
    'in_test_renewal_1'
);

DO $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM public.sessions AS session_row
        JOIN public.checkout_v2_cycles AS cycle_row
          ON cycle_row.id = session_row.checkout_v2_cycle_id
        WHERE cycle_row.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND cycle_row.cycle_number = 2
    ) <> 4 THEN
        RAISE EXCEPTION 'renewal_cycle_materialization_replay_duplicated_sessions';
    END IF;
END
$$;

DO $$
DECLARE
    duplicate_result BOOLEAN;
BEGIN
    SELECT public.apply_checkout_v2_renewal(
        '50000000-0000-4000-8000-000000000001',
        'sub_test_isolated',
        'in_test_renewal_1',
        '60000000-0000-4000-8000-000000000002',
        'price_test_recurring_28d',
        cycle.starts_at,
        cycle.ends_at
    ) INTO duplicate_result
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND cycle.cycle_number = 2;

    IF duplicate_result IS NOT FALSE THEN
        RAISE EXCEPTION 'duplicate_renewal_was_not_idempotent';
    END IF;
END
$$;

INSERT INTO public.payments (
    id,
    student_id,
    subscription_id,
    amount,
    currency,
    status,
    stripe_payment_intent_id,
    stripe_invoice_id
) VALUES (
    '60000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    25900,
    'eur',
    'succeeded',
    'pi_test_renewal_2',
    'in_test_renewal_2'
);

SELECT ends_at AS renewal_period_2_start
FROM public.checkout_v2_cycles
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND cycle_number = 2
\gset

SELECT public.apply_checkout_v2_renewal(
    '50000000-0000-4000-8000-000000000001',
    'sub_test_isolated',
    'in_test_renewal_2',
    '60000000-0000-4000-8000-000000000003',
    'price_test_recurring_28d',
    :'renewal_period_2_start'::TIMESTAMPTZ,
    :'renewal_period_2_start'::TIMESTAMPTZ + INTERVAL '672 hours'
);

DO $$
DECLARE
    cycle_row public.checkout_v2_cycles%ROWTYPE;
    billing_row public.checkout_v2_billing_state%ROWTYPE;
    allocation_row public.checkout_v2_weekly_allocations%ROWTYPE;
    competing_session_at TIMESTAMPTZ;
BEGIN
    SELECT * INTO cycle_row
    FROM public.checkout_v2_cycles
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND cycle_number = 3;

    SELECT * INTO billing_row
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = cycle_row.subscription_id;

    SELECT * INTO allocation_row
    FROM public.checkout_v2_weekly_allocations
    WHERE subscription_id = cycle_row.subscription_id
      AND status = 'active';

    competing_session_at := (
        (billing_row.first_class_at AT TIME ZONE allocation_row.timezone_name)::DATE
        + 56
        + allocation_row.local_start_time
    ) AT TIME ZONE allocation_row.timezone_name;

    INSERT INTO public.sessions (
        subscription_id,
        student_id,
        teacher_id,
        scheduled_at,
        duration_minutes,
        status,
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    ) VALUES (
        cycle_row.subscription_id,
        '10000000-0000-4000-8000-000000000001',
        allocation_row.teacher_id,
        competing_session_at,
        50,
        'scheduled',
        cycle_row.id,
        1
    );

    PERFORM public.materialize_checkout_v2_cycle_sessions(
        cycle_row.subscription_id,
        cycle_row.stripe_invoice_id
    );
    RAISE EXCEPTION 'conflicting_cycle_materialization_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_cycle_cannot_materialize_sessions' THEN
        RAISE;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.sessions AS session_row
        JOIN public.checkout_v2_cycles AS pending_cycle
          ON pending_cycle.id = session_row.checkout_v2_cycle_id
        WHERE pending_cycle.subscription_id = '50000000-0000-4000-8000-000000000001'
          AND pending_cycle.cycle_number = 3
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND cycle_number = 3
          AND materialization_state = 'pending'
          AND sessions_materialized_at IS NULL
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE id = '50000000-0000-4000-8000-000000000001'
          AND sessions_used = 0
    ) THEN
        RAISE EXCEPTION 'conflicting_cycle_materialization_was_not_atomic';
    END IF;
END
$$;

SELECT public.materialize_checkout_v2_cycle_sessions(
    '50000000-0000-4000-8000-000000000001',
    'in_test_renewal_2'
);

INSERT INTO public.payments (
    id,
    student_id,
    subscription_id,
    amount,
    currency,
    status,
    stripe_payment_intent_id,
    stripe_invoice_id
) VALUES (
    '60000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    25900,
    'eur',
    'succeeded',
    'pi_test_renewal_3',
    'in_test_renewal_3'
);

SELECT ends_at AS renewal_period_3_start
FROM public.checkout_v2_cycles
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND cycle_number = 3
\gset

SELECT public.apply_checkout_v2_renewal(
    '50000000-0000-4000-8000-000000000001',
    'sub_test_isolated',
    'in_test_renewal_3',
    '60000000-0000-4000-8000-000000000004',
    'price_test_recurring_28d',
    :'renewal_period_3_start'::TIMESTAMPTZ,
    :'renewal_period_3_start'::TIMESTAMPTZ + INTERVAL '672 hours'
);

DO $$
BEGIN
    PERFORM public.apply_checkout_v2_renewal(
        '50000000-0000-4000-8000-000000000001',
        'sub_test_isolated',
        'in_test_renewal_1',
        '60000000-0000-4000-8000-000000000002',
        'price_test_wrong_replay',
        cycle.starts_at,
        cycle.ends_at
    )
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND cycle.cycle_number = 2;
    RAISE EXCEPTION 'contradictory_renewal_replay_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_renewal_snapshot_is_invalid' THEN
        RAISE;
    END IF;
END
$$;

SELECT (
    public.create_bookable_slot(
        :'v2_package_id'::UUID,
        '10000000-0000-4000-8000-000000000002',
        'Europe/Madrid',
        ARRAY[
            (:'first_local'::TIMESTAMP + INTERVAL '119 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '126 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '133 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '140 days') AT TIME ZONE 'Europe/Madrid'
        ],
        '10000000-0000-4000-8000-000000000003'
    )
).id AS overlapping_slot_id
\gset

INSERT INTO checkout_v2_test_ids (name, id)
VALUES ('overlapping_slot', :'overlapping_slot_id'::UUID);

DO $$
DECLARE
    target_slot_id UUID;
BEGIN
    SELECT id INTO target_slot_id
    FROM checkout_v2_test_ids
    WHERE name = 'overlapping_slot';

    PERFORM public.publish_bookable_slot(
        target_slot_id,
        '10000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'overlapping_weekly_capacity_was_published';
EXCEPTION WHEN exclusion_violation THEN
    NULL;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.bookable_slots
        WHERE id = (
            SELECT id
            FROM checkout_v2_test_ids
            WHERE name = 'overlapping_slot'
        )
          AND status <> 'draft'
    ) THEN
        RAISE EXCEPTION 'failed_weekly_capacity_publish_changed_the_slot';
    END IF;
END
$$;

-- A ready cycle remains replayable after ordinary session evolution and after
-- cancellation releases the durable weekly allocation. Replay must validate
-- the already-materialized facts without requiring live capacity again.
UPDATE public.sessions AS session_row
SET
    status = 'completed',
    completed_at = session_row.scheduled_at + INTERVAL '50 minutes'
FROM public.checkout_v2_cycles AS cycle_row
WHERE cycle_row.id = session_row.checkout_v2_cycle_id
  AND cycle_row.subscription_id = '50000000-0000-4000-8000-000000000001'
  AND cycle_row.cycle_number = 2
  AND session_row.checkout_v2_cycle_session_index = 1;

UPDATE public.subscriptions
SET status = 'cancelled'
WHERE id = '50000000-0000-4000-8000-000000000001';

DO $$
BEGIN
    PERFORM public.materialize_checkout_v2_cycle_sessions(
        '50000000-0000-4000-8000-000000000001',
        'in_test_renewal_3'
    );
    RAISE EXCEPTION 'terminal_subscription_materialized_pending_cycle';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_cycle_cannot_materialize_sessions' THEN
        RAISE;
    END IF;
END
$$;

SELECT public.publish_bookable_slot(
    :'overlapping_slot_id'::UUID,
    '10000000-0000-4000-8000-000000000003'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND status = 'released'
          AND release_reason = 'subscription_cancelled'
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_weekly_allocations
        WHERE slot_id = (
            SELECT id
            FROM checkout_v2_test_ids
            WHERE name = 'overlapping_slot'
        )
          AND status = 'offered'
    ) OR NOT EXISTS (
        SELECT 1
        FROM public.bookable_slots
        WHERE sold_subscription_id = '50000000-0000-4000-8000-000000000001'
          AND status = 'sold'
    ) THEN
        RAISE EXCEPTION 'terminal_subscription_did_not_release_reusable_capacity';
    END IF;

    BEGIN
        UPDATE public.subscriptions
        SET status = 'active'
        WHERE id = '50000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'terminal_checkout_v2_subscription_reopened';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_terminal_subscription_cannot_reopen' THEN
            RAISE;
        END IF;
    END;
END
$$;

DO $$
DECLARE
    replayed_cycle public.checkout_v2_cycles%ROWTYPE;
BEGIN
    SELECT * INTO replayed_cycle
    FROM public.materialize_checkout_v2_cycle_sessions(
        '50000000-0000-4000-8000-000000000001',
        'in_test_renewal_1'
    );

    IF replayed_cycle.cycle_number <> 2
       OR replayed_cycle.materialization_state <> 'ready'
       OR replayed_cycle.sessions_materialized_at IS NULL
       OR (
            SELECT COUNT(*)
            FROM public.sessions
            WHERE checkout_v2_cycle_id = replayed_cycle.id
       ) <> 4
       OR NOT EXISTS (
            SELECT 1
            FROM public.sessions
            WHERE checkout_v2_cycle_id = replayed_cycle.id
              AND checkout_v2_cycle_session_index = 1
              AND status = 'completed'
              AND completed_at IS NOT NULL
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.subscriptions
            WHERE id = replayed_cycle.subscription_id
              AND status = 'cancelled'
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_v2_weekly_allocations
            WHERE subscription_id = replayed_cycle.subscription_id
              AND status = 'released'
              AND release_reason = 'subscription_cancelled'
       ) THEN
        RAISE EXCEPTION 'ready_cycle_replay_after_allocation_release_is_not_idempotent';
    END IF;
END
$$;

DO $$
BEGIN
    IF has_table_privilege('anon', 'public.checkout_v2_cycles', 'SELECT')
       OR has_table_privilege('authenticated', 'public.checkout_v2_billing_state', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.checkout_v2_cycles', 'SELECT')
       OR has_table_privilege('service_role', 'public.checkout_v2_cycles', 'INSERT')
       OR has_table_privilege('service_role', 'public.checkout_v2_cycles', 'UPDATE')
       OR has_table_privilege('service_role', 'public.checkout_v2_billing_state', 'UPDATE')
       OR has_table_privilege('service_role', 'public.checkout_v2_price_snapshots', 'INSERT')
       OR has_function_privilege(
            'anon',
            'public.materialize_checkout_v2_cycle_sessions(uuid,text)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.materialize_checkout_v2_cycle_sessions(uuid,text)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.claim_direct_checkout_intent_for_slot(uuid,text,text,uuid,text,text,text,uuid,text)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.claim_direct_checkout_intent_for_slot(uuid,text,text,uuid,text,text,text,uuid,text)',
            'EXECUTE'
       )
       OR to_regprocedure(
            'public.claim_direct_checkout_intent_for_slot(uuid,text,text,uuid,text,text,text,uuid)'
       ) IS NOT NULL
       OR to_regprocedure(
            'public.claim_checkout_intent_for_slot(uuid,uuid,uuid,uuid,text,text,text,uuid)'
       ) IS NOT NULL
       OR to_regprocedure('public.hold_bookable_slot(uuid,uuid)') IS NOT NULL
       OR has_function_privilege(
            'authenticated',
            'public.hold_bookable_slot(uuid,uuid,text)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.hold_bookable_slot(uuid,uuid,text)',
            'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'checkout_v2_financial_table_privileges_are_invalid';
    END IF;
END
$$;

-- Keep one mutable occurrence so the fractional-second constraint is reached
-- before the separate immutability guard for published inventory.
SELECT (
    public.create_bookable_slot(
        :'v2_package_id'::UUID,
        '10000000-0000-4000-8000-000000000002',
        'Europe/Madrid',
        ARRAY[
            (:'first_local'::TIMESTAMP + INTERVAL '196 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '203 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '210 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '217 days') AT TIME ZONE 'Europe/Madrid'
        ],
        '10000000-0000-4000-8000-000000000003'
    )
).id;

DO $$
DECLARE
    violated_constraint TEXT;
BEGIN
    INSERT INTO public.bookable_slots (
        package_id,
        teacher_id,
        weekday,
        local_start_time,
        timezone_name,
        first_occurrence_at,
        created_by
    )
    SELECT
        package_id,
        teacher_id,
        0,
        TIME '02:30:00',
        'Europe/Madrid',
        (
            date_trunc(
                'week',
                first_occurrence_at AT TIME ZONE 'Europe/Madrid'
            ) + INTERVAL '6 days 2 hours 30 minutes'
        ) AT TIME ZONE 'Europe/Madrid',
        created_by
    FROM public.bookable_slots
    ORDER BY created_at
    LIMIT 1;
    RAISE EXCEPTION 'dst_unsafe_weekly_slot_was_accepted';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'bookable_slots_dst_safe_weekly_time_check' THEN
        RAISE;
    END IF;
END
$$;

DO $$
DECLARE
    violated_constraint TEXT;
BEGIN
    INSERT INTO public.bookable_slots (
        package_id,
        teacher_id,
        weekday,
        local_start_time,
        timezone_name,
        first_occurrence_at,
        created_by
    )
    SELECT
        package_id,
        teacher_id,
        weekday,
        local_start_time,
        timezone_name,
        first_occurrence_at + INTERVAL '0.123 seconds',
        created_by
    FROM public.bookable_slots
    ORDER BY created_at
    LIMIT 1;
    RAISE EXCEPTION 'fractional_bookable_slot_was_accepted';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'bookable_slots_first_occurrence_whole_second_check' THEN
        RAISE;
    END IF;
END
$$;

DO $$
DECLARE
    violated_constraint TEXT;
BEGIN
    UPDATE public.bookable_slot_occurrences
    SET starts_at = starts_at + INTERVAL '0.123 seconds'
    WHERE (slot_id, occurrence_index) = (
        SELECT occurrence_row.slot_id, occurrence_row.occurrence_index
        FROM public.bookable_slot_occurrences AS occurrence_row
        JOIN public.bookable_slots AS slot_row
          ON slot_row.id = occurrence_row.slot_id
        WHERE slot_row.status = 'draft'
        ORDER BY occurrence_row.slot_id, occurrence_row.occurrence_index
        LIMIT 1
    );
    RAISE EXCEPTION 'fractional_bookable_occurrence_was_accepted';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS violated_constraint = CONSTRAINT_NAME;
    IF violated_constraint <> 'bookable_slot_occurrences_whole_second_check' THEN
        RAISE;
    END IF;
END
$$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
