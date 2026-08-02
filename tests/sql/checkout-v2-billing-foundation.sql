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

SELECT public.configure_teacher_compensation_engagement(
    '11000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'founder',
    TIMESTAMPTZ '2020-01-01 00:00:00+00',
    '10000000-0000-4000-8000-000000000003',
    'Checkout V2 billing fixture teacher'
);

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

SELECT intent.id AS policy_rotated_intent_id
FROM public.claim_direct_checkout_intent_for_slot(
    '10000000-0000-4000-8000-000000000001',
    'student@test.invalid',
    'Direct Student',
    :'package_price_id'::UUID,
    'en',
    'test-policy-v2',
    'https://example.test',
    :'slot_public_id'::UUID,
    ('v1:' || repeat('e', 64))::TEXT
) AS intent
\gset

INSERT INTO checkout_v2_test_ids (name, id) VALUES
    ('policy_v1_intent', :'checkout_intent_id'::UUID),
    ('policy_v2_intent', :'policy_rotated_intent_id'::UUID);

UPDATE checkout_v2_test_ids
SET id = :'policy_rotated_intent_id'::UUID
WHERE name = 'direct_intent';

SELECT :'policy_rotated_intent_id'::UUID AS checkout_intent_id
\gset

DO $$
BEGIN
    IF (SELECT id FROM checkout_v2_test_ids WHERE name = 'policy_v1_intent')
       IS NOT DISTINCT FROM
       (SELECT id FROM checkout_v2_test_ids WHERE name = 'policy_v2_intent')
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_intents
            WHERE id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'policy_v1_intent'
            )
              AND status = 'expired'
              AND legal_policy_version = 'test-policy-v1'
              AND policy_accepted_at IS NOT NULL
              AND stripe_customer_id IS NULL
              AND stripe_checkout_session_id IS NULL
              AND completed_at IS NULL
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.bookable_slot_holds
            WHERE checkout_intent_id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'policy_v1_intent'
            )
              AND status = 'expired'
              AND hold_fingerprint IS NULL
              AND closed_at IS NOT NULL
              AND close_reason = 'legal_policy_version_rotated'
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.checkout_intents
            WHERE id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'policy_v2_intent'
            )
              AND status = 'creating'
              AND legal_policy_version = 'test-policy-v2'
              AND stripe_customer_id IS NULL
              AND stripe_checkout_session_id IS NULL
              AND completed_at IS NULL
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.bookable_slot_holds
            WHERE checkout_intent_id = (
                SELECT id FROM checkout_v2_test_ids WHERE name = 'policy_v2_intent'
            )
              AND status = 'held'
              AND hold_fingerprint = ('v1:' || repeat('e', 64))
       ) THEN
        RAISE EXCEPTION 'pre_stripe_legal_policy_rotation_was_not_atomic';
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
        'test-policy-v2',
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
        ('v1:' || repeat('e', 64))::TEXT
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
              ('v1:' || repeat('e', 64)),
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

DO $$
DECLARE
    target_intent_id UUID;
    target_package_price_id UUID;
    target_slot_public_id UUID;
    replayed_intent public.checkout_intents%ROWTYPE;
BEGIN
    SELECT id INTO target_intent_id
    FROM checkout_v2_test_ids
    WHERE name = 'direct_intent';

    SELECT intent.package_price_id, slot.public_id
    INTO target_package_price_id, target_slot_public_id
    FROM public.checkout_intents AS intent
    JOIN public.bookable_slot_holds AS hold
      ON hold.checkout_intent_id = intent.id
    JOIN public.bookable_slots AS slot
      ON slot.id = hold.slot_id
    WHERE intent.id = target_intent_id;

    replayed_intent := public.claim_direct_checkout_intent_for_slot(
        '10000000-0000-4000-8000-000000000001',
        'student@test.invalid',
        'Direct Student',
        target_package_price_id,
        'en',
        'test-policy-v3',
        'https://example.test',
        target_slot_public_id,
        ('v1:' || repeat('f', 64))::TEXT
    );

    IF replayed_intent.id IS DISTINCT FROM target_intent_id
       OR replayed_intent.status <> 'creating'
       OR replayed_intent.legal_policy_version <> 'test-policy-v2'
       OR replayed_intent.stripe_customer_id <> 'cus_test_isolated'
       OR EXISTS (
            SELECT 1
            FROM public.checkout_intents
            WHERE student_id = '10000000-0000-4000-8000-000000000001'
              AND legal_policy_version = 'test-policy-v3'
       )
       OR NOT EXISTS (
            SELECT 1
            FROM public.bookable_slot_holds
            WHERE checkout_intent_id = target_intent_id
              AND status = 'held'
              AND hold_fingerprint = ('v1:' || repeat('e', 64))
       ) THEN
        RAISE EXCEPTION 'customer_snapshot_policy_rotation_replaced_evidence';
    END IF;
END
$$;

UPDATE public.checkout_intents
SET
    status = 'open',
    stripe_checkout_session_id = 'cs_test_isolated',
    updated_at = clock_timestamp()
WHERE id = :'checkout_intent_id'::UUID;

DO $$
DECLARE
    target_intent_id UUID;
    target_package_price_id UUID;
    target_slot_public_id UUID;
    replayed_intent public.checkout_intents%ROWTYPE;
BEGIN
    SELECT id INTO target_intent_id
    FROM checkout_v2_test_ids
    WHERE name = 'direct_intent';

    SELECT intent.package_price_id, slot.public_id
    INTO target_package_price_id, target_slot_public_id
    FROM public.checkout_intents AS intent
    JOIN public.bookable_slot_holds AS hold
      ON hold.checkout_intent_id = intent.id
    JOIN public.bookable_slots AS slot
      ON slot.id = hold.slot_id
    WHERE intent.id = target_intent_id;

    replayed_intent := public.claim_direct_checkout_intent_for_slot(
        '10000000-0000-4000-8000-000000000001',
        'student@test.invalid',
        'Direct Student',
        target_package_price_id,
        'en',
        'test-policy-v4',
        'https://example.test',
        target_slot_public_id,
        ('v1:' || repeat('f', 64))::TEXT
    );

    IF replayed_intent.id IS DISTINCT FROM target_intent_id
       OR replayed_intent.status <> 'open'
       OR replayed_intent.legal_policy_version <> 'test-policy-v2'
       OR replayed_intent.stripe_checkout_session_id <> 'cs_test_isolated'
       OR EXISTS (
            SELECT 1
            FROM public.checkout_intents
            WHERE student_id = '10000000-0000-4000-8000-000000000001'
              AND legal_policy_version = 'test-policy-v4'
       ) THEN
        RAISE EXCEPTION 'open_intent_policy_rotation_replaced_evidence';
    END IF;
END
$$;

SELECT public.complete_checkout_intent(
    :'checkout_intent_id'::UUID,
    :'checkout_opportunity_id'::UUID,
    '10000000-0000-4000-8000-000000000001',
    :'package_price_id'::UUID,
    'cs_test_isolated',
    'cus_test_isolated'
);

DO $$
DECLARE
    target_intent_id UUID;
    target_package_price_id UUID;
    target_slot_public_id UUID;
    replayed_intent public.checkout_intents%ROWTYPE;
BEGIN
    SELECT id INTO target_intent_id
    FROM checkout_v2_test_ids
    WHERE name = 'direct_intent';

    SELECT intent.package_price_id, slot.public_id
    INTO target_package_price_id, target_slot_public_id
    FROM public.checkout_intents AS intent
    JOIN public.bookable_slot_holds AS hold
      ON hold.checkout_intent_id = intent.id
    JOIN public.bookable_slots AS slot
      ON slot.id = hold.slot_id
    WHERE intent.id = target_intent_id;

    replayed_intent := public.claim_direct_checkout_intent_for_slot(
        '10000000-0000-4000-8000-000000000001',
        'student@test.invalid',
        'Direct Student',
        target_package_price_id,
        'en',
        'test-policy-v5',
        'https://example.test',
        target_slot_public_id,
        ('v1:' || repeat('f', 64))::TEXT
    );

    IF replayed_intent.id IS DISTINCT FROM target_intent_id
       OR replayed_intent.status <> 'completed'
       OR replayed_intent.legal_policy_version <> 'test-policy-v2'
       OR replayed_intent.completed_at IS NULL
       OR EXISTS (
            SELECT 1
            FROM public.checkout_intents
            WHERE student_id = '10000000-0000-4000-8000-000000000001'
              AND legal_policy_version = 'test-policy-v5'
       ) THEN
        RAISE EXCEPTION 'completed_intent_policy_rotation_replaced_evidence';
    END IF;
END
$$;

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

-- Availability discovery is a read-only projection of the durable prepare
-- policy. Invalid windows and cross-student access fail before any targets are
-- disclosed.
DO $$
DECLARE
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    BEGIN
        PERFORM *
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at
        );
        RAISE EXCEPTION 'checkout_v2_reschedule_targets_accepted_empty_range';
    EXCEPTION WHEN invalid_parameter_value THEN
        IF SQLERRM <> 'invalid_checkout_v2_reschedule_target_range' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM *
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '48 hours 1 second'
        );
        RAISE EXCEPTION 'checkout_v2_reschedule_targets_accepted_oversized_range';
    EXCEPTION WHEN invalid_parameter_value THEN
        IF SQLERRM <> 'invalid_checkout_v2_reschedule_target_range' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM *
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000004',
            moved_at,
            moved_at + INTERVAL '1 hour'
        );
        RAISE EXCEPTION 'checkout_v2_reschedule_targets_cross_tenant_access_succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        IF SQLERRM <> 'checkout_v2_reschedule_forbidden' THEN
            RAISE;
        END IF;
    END;
END
$$;

-- A provisional first-class move exposes one weekly-pattern target and all
-- four Madrid-local affected sessions without creating a durable operation.
DO $$
DECLARE
    listed_target RECORD;
    operation_count_before BIGINT;
    operation_count_after BIGINT;
    expected_local TIMESTAMP;
    target_index INTEGER;
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT COUNT(*) INTO operation_count_before
    FROM public.checkout_v2_reschedule_operations;

    SELECT * INTO listed_target
    FROM public.list_checkout_v2_reschedule_targets(
        target_session_id,
        '10000000-0000-4000-8000-000000000001',
        moved_at,
        moved_at + INTERVAL '1 hour'
    );

    IF listed_target.target_scheduled_at IS DISTINCT FROM moved_at
       OR listed_target.operation_kind IS DISTINCT FROM 'provisional_anchor'
       OR pg_catalog.cardinality(listed_target.affected_scheduled_ats) <> 4 THEN
        RAISE EXCEPTION 'checkout_v2_provisional_target_shape_is_wrong';
    END IF;

    FOR target_index IN 1..4 LOOP
        expected_local :=
            moved_at AT TIME ZONE 'Europe/Madrid'
            + pg_catalog.make_interval(days => (target_index - 1) * 7);
        IF listed_target.affected_scheduled_ats[target_index]
                IS DISTINCT FROM expected_local AT TIME ZONE 'Europe/Madrid' THEN
            RAISE EXCEPTION 'checkout_v2_provisional_target_did_not_preserve_local_pattern';
        END IF;
    END LOOP;

    SELECT COUNT(*) INTO operation_count_after
    FROM public.checkout_v2_reschedule_operations;
    IF operation_count_after IS DISTINCT FROM operation_count_before THEN
        RAISE EXCEPTION 'checkout_v2_target_listing_created_durable_state';
    END IF;
END
$$;

-- A sold 10:00 slot remains discoverable inside broad 09:00-18:00 teacher
-- availability. Provisional discovery follows the sold allocation directly;
-- 10:00 is intentionally not on a 50-minute grid anchored at 09:00.
SAVEPOINT checkout_v2_target_sold_allocation_time;

UPDATE public.teacher_availability
SET end_time = TIME '18:00:00'
WHERE teacher_id = '10000000-0000-4000-8000-000000000002'
  AND day_of_week = EXTRACT(DOW FROM :'first_local'::TIMESTAMP)::INTEGER
  AND start_time = TIME '09:00:00';

SET LOCAL session_replication_role = replica;

UPDATE public.checkout_v2_weekly_allocations
SET local_start_time = TIME '10:00:00'
WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
  AND status = 'active';

UPDATE public.bookable_slots AS slot
SET
    local_start_time = TIME '10:00:00',
    first_occurrence_at = slot.first_occurrence_at + INTERVAL '1 hour'
WHERE slot.sold_subscription_id = '50000000-0000-4000-8000-000000000001';

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    target_session_id UUID;
    target_at TIMESTAMPTZ;
    listed_target TIMESTAMPTZ;
BEGIN
    SELECT
        billing.first_session_id,
        (
            (billing.first_class_at AT TIME ZONE allocation.timezone_name)::DATE
                + 7
                + allocation.local_start_time
        ) AT TIME ZONE allocation.timezone_name
    INTO target_session_id, target_at
    FROM public.checkout_v2_billing_state AS billing
    JOIN public.checkout_v2_weekly_allocations AS allocation
      ON allocation.subscription_id = billing.subscription_id
     AND allocation.status = 'active'
    WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT target_scheduled_at INTO listed_target
    FROM public.list_checkout_v2_reschedule_targets(
        target_session_id,
        '10000000-0000-4000-8000-000000000001',
        target_at,
        target_at + INTERVAL '1 hour'
    );

    IF listed_target IS DISTINCT FROM target_at
       OR (listed_target AT TIME ZONE 'Europe/Madrid')::TIME
            IS DISTINCT FROM TIME '10:00:00' THEN
        RAISE EXCEPTION 'checkout_v2_sold_allocation_time_was_not_listed';
    END IF;
END
$$;

ROLLBACK TO SAVEPOINT checkout_v2_target_sold_allocation_time;

-- Single-session discovery uses only the assigned teacher and keeps the
-- moved session strictly between its cycle neighbours.
SAVEPOINT checkout_v2_target_single_order;

UPDATE public.teacher_availability
SET end_time = (:'first_local'::TIMESTAMP + INTERVAL '2 hours 30 minutes')::TIME
WHERE teacher_id = '10000000-0000-4000-8000-000000000002'
  AND day_of_week = EXTRACT(DOW FROM :'first_local'::TIMESTAMP)::INTEGER
  AND start_time = :'first_local'::TIMESTAMP::TIME;

DO $$
DECLARE
    second_session_id UUID;
    ordered_target TIMESTAMPTZ;
    first_local_at TIMESTAMP;
BEGIN
    SELECT first_class_at AT TIME ZONE 'Europe/Madrid'
    INTO first_local_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT id INTO second_session_id
    FROM public.sessions
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 2;

    SELECT target_scheduled_at INTO ordered_target
    FROM public.list_checkout_v2_reschedule_targets(
        second_session_id,
        '10000000-0000-4000-8000-000000000001',
        (first_local_at + INTERVAL '50 minutes') AT TIME ZONE 'Europe/Madrid',
        ((first_local_at + INTERVAL '50 minutes') AT TIME ZONE 'Europe/Madrid')
            + INTERVAL '50 minutes'
    );

    IF ordered_target IS DISTINCT FROM
            (first_local_at + INTERVAL '50 minutes') AT TIME ZONE 'Europe/Madrid' THEN
        RAISE EXCEPTION 'checkout_v2_single_target_was_not_listed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            second_session_id,
            '10000000-0000-4000-8000-000000000001',
            (first_local_at + INTERVAL '14 days 50 minutes') AT TIME ZONE 'Europe/Madrid',
            ((first_local_at + INTERVAL '14 days 50 minutes') AT TIME ZONE 'Europe/Madrid')
                + INTERVAL '50 minutes'
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_single_target_crossed_next_session';
    END IF;
END
$$;

UPDATE public.profiles
SET role = 'teacher'
WHERE id = '10000000-0000-4000-8000-000000000005';

INSERT INTO public.teacher_availability (
    teacher_id,
    day_of_week,
    start_time,
    end_time,
    is_active
) VALUES (
    '10000000-0000-4000-8000-000000000005',
    EXTRACT(DOW FROM (:'first_local'::TIMESTAMP + INTERVAL '4 days'))::INTEGER,
    :'first_local'::TIMESTAMP::TIME,
    (:'first_local'::TIMESTAMP + INTERVAL '1 hour')::TIME,
    TRUE
);

DO $$
DECLARE
    second_session_id UUID;
    first_local_at TIMESTAMP;
BEGIN
    SELECT first_class_at AT TIME ZONE 'Europe/Madrid'
    INTO first_local_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT id INTO second_session_id
    FROM public.sessions
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 2;

    IF EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            second_session_id,
            '10000000-0000-4000-8000-000000000001',
            (first_local_at + INTERVAL '4 days') AT TIME ZONE 'Europe/Madrid',
            ((first_local_at + INTERVAL '4 days') AT TIME ZONE 'Europe/Madrid')
                + INTERVAL '1 hour'
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_target_used_unassigned_teacher_availability';
    END IF;
END
$$;

ROLLBACK TO SAVEPOINT checkout_v2_target_single_order;

-- A scheduled-session conflict in any occurrence suppresses the entire
-- provisional four-session cascade.
SAVEPOINT checkout_v2_target_session_conflict;

INSERT INTO public.subscriptions (
    id,
    student_id,
    package_id,
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
    '50000000-0000-4000-8000-000000000098',
    '10000000-0000-4000-8000-000000000004',
    (
        SELECT id
        FROM public.packages
        WHERE contract_schema_version = 1
        ORDER BY id
        LIMIT 1
    ),
    'active',
    1,
    (:'first_local'::TIMESTAMP)::DATE,
    (:'first_local'::TIMESTAMP)::DATE + 60,
    4,
    4,
    0,
    'sub_target_conflict_probe',
    'in_target_conflict_probe',
    1,
    'month',
    1,
    NULL
);

INSERT INTO public.sessions (
    id,
    subscription_id,
    student_id,
    teacher_id,
    scheduled_at,
    duration_minutes,
    status
) VALUES (
    '70000000-0000-4000-8000-000000000098',
    '50000000-0000-4000-8000-000000000098',
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000002',
    (:'first_local'::TIMESTAMP + INTERVAL '28 days') AT TIME ZONE 'Europe/Madrid',
    50,
    'scheduled'
);

DO $$
DECLARE
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    IF EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '1 hour'
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_provisional_target_ignored_session_conflict';
    END IF;
END
$$;

ROLLBACK TO SAVEPOINT checkout_v2_target_session_conflict;

-- A bookable occurrence is also a reservation boundary, even when no session
-- has yet been materialized for it.
SAVEPOINT checkout_v2_target_reservation_conflict;

INSERT INTO public.bookable_slots (
    id,
    package_id,
    teacher_id,
    weekday,
    local_start_time,
    timezone_name,
    first_occurrence_at,
    created_by
) VALUES (
    '40000000-0000-4000-8000-000000000098',
    :'v2_package_id'::UUID,
    '10000000-0000-4000-8000-000000000002',
    EXTRACT(DOW FROM :'first_local'::TIMESTAMP)::SMALLINT,
    :'first_local'::TIMESTAMP::TIME,
    'Europe/Madrid',
    (:'first_local'::TIMESTAMP + INTERVAL '28 days') AT TIME ZONE 'Europe/Madrid',
    '10000000-0000-4000-8000-000000000003'
);

INSERT INTO public.bookable_slot_occurrences (
    slot_id,
    occurrence_index,
    teacher_id,
    starts_at
)
SELECT
    '40000000-0000-4000-8000-000000000098',
    occurrence_index,
    '10000000-0000-4000-8000-000000000002',
    (:'first_local'::TIMESTAMP
        + pg_catalog.make_interval(days => 21 + occurrence_index * 7))
        AT TIME ZONE 'Europe/Madrid'
FROM pg_catalog.generate_series(1, 4) AS occurrence(occurrence_index);

-- Isolate the occurrence-reservation predicate without also creating a
-- recurrent allocation for this synthetic conflicting slot.
SET LOCAL session_replication_role = replica;

UPDATE public.bookable_slots
SET
    status = 'available',
    published_at = clock_timestamp(),
    published_by = '10000000-0000-4000-8000-000000000003'
WHERE id = '40000000-0000-4000-8000-000000000098';

UPDATE public.bookable_slot_occurrences
SET blocks_teacher = TRUE
WHERE slot_id = '40000000-0000-4000-8000-000000000098';

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    IF EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '1 hour'
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_provisional_target_ignored_reservation';
    END IF;
END
$$;

ROLLBACK TO SAVEPOINT checkout_v2_target_reservation_conflict;

-- Self-service is inclusive through 28 days from the immutable first
-- occurrence of the sold slot. The following weekly occurrence requires
-- support and is not advertised by the listing RPC.
DO $$
DECLARE
    target_session_id UUID;
    horizon_at TIMESTAMPTZ;
BEGIN
    SELECT billing.first_session_id,
        (
            (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)
                + INTERVAL '28 days'
        ) AT TIME ZONE allocation.timezone_name
    INTO target_session_id, horizon_at
    FROM public.checkout_v2_billing_state AS billing
    JOIN public.checkout_v2_weekly_allocations AS allocation
      ON allocation.subscription_id = billing.subscription_id
    JOIN public.bookable_slots AS sold_slot
      ON sold_slot.id = allocation.slot_id
     AND sold_slot.sold_subscription_id = billing.subscription_id
    WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001';

    IF NOT EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            horizon_at,
            horizon_at + INTERVAL '1 hour'
        ) AS target
        WHERE target.target_scheduled_at = horizon_at
    ) THEN
        RAISE EXCEPTION 'checkout_v2_inclusive_self_service_horizon_was_not_listed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            horizon_at + INTERVAL '7 days',
            horizon_at + INTERVAL '7 days 1 hour'
        )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_post_horizon_target_was_listed';
    END IF;
END
$$;

-- The horizon follows Madrid civil time, not 672 absolute hours. Across the
-- CEST-to-CET transition the same local time on day +28 remains inclusive.
SAVEPOINT checkout_v2_local_horizon_dst;
SET LOCAL session_replication_role = replica;

UPDATE public.bookable_slots AS sold_slot
SET first_occurrence_at =
        TIMESTAMP '2035-10-01 09:00:00' AT TIME ZONE 'Europe/Madrid'
FROM public.checkout_v2_weekly_allocations AS allocation
WHERE allocation.subscription_id = '50000000-0000-4000-8000-000000000001'
  AND allocation.slot_id = sold_slot.id;

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    first_at TIMESTAMPTZ :=
        TIMESTAMP '2035-10-01 09:00:00' AT TIME ZONE 'Europe/Madrid';
    same_local_time_day_28 TIMESTAMPTZ :=
        TIMESTAMP '2035-10-29 09:00:00' AT TIME ZONE 'Europe/Madrid';
BEGIN
    IF same_local_time_day_28 - first_at <> INTERVAL '673 hours' THEN
        RAISE EXCEPTION 'checkout_v2_dst_horizon_fixture_did_not_cross_cest_to_cet';
    END IF;

    IF NOT private.checkout_v2_reschedule_is_within_self_service_horizon(
        '50000000-0000-4000-8000-000000000001',
        same_local_time_day_28
    ) OR private.checkout_v2_reschedule_is_within_self_service_horizon(
        '50000000-0000-4000-8000-000000000001',
        same_local_time_day_28 + INTERVAL '1 second'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_local_self_service_horizon_is_not_inclusive';
    END IF;
END
$$;

ROLLBACK TO SAVEPOINT checkout_v2_local_horizon_dst;

-- Prepare uses the same trigger boundary. A +28-day request can cross the
-- Stripe mutation boundary, and every later UPDATE is revalidated there too.
DO $$
DECLARE
    prepared public.checkout_v2_reschedule_operations%ROWTYPE;
    begun public.checkout_v2_reschedule_operations%ROWTYPE;
    horizon_at TIMESTAMPTZ;
BEGIN
    SELECT (
        (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)
            + INTERVAL '28 days'
    ) AT TIME ZONE allocation.timezone_name
    INTO horizon_at
    FROM public.checkout_v2_weekly_allocations AS allocation
    JOIN public.bookable_slots AS sold_slot
      ON sold_slot.id = allocation.slot_id
    WHERE allocation.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND sold_slot.sold_subscription_id = allocation.subscription_id;

    SELECT * INTO prepared
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000028',
        (
            SELECT first_session_id
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        ),
        '10000000-0000-4000-8000-000000000001',
        horizon_at
    );

    SELECT * INTO begun
    FROM public.begin_checkout_v2_reschedule_stripe_mutation(prepared.id);
    IF begun.stripe_mutation_started_at IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_horizon_guard_blocked_valid_boundary';
    END IF;

    BEGIN
        UPDATE public.checkout_v2_reschedule_operations
        SET
            new_scheduled_at = horizon_at + INTERVAL '7 days',
            target_stripe_anchor_at = horizon_at + INTERVAL '35 days'
        WHERE id = begun.id;
        RAISE EXCEPTION 'checkout_v2_boundary_update_crossed_self_service_horizon';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_exceeds_self_service_horizon' THEN
            RAISE;
        END IF;
    END;

    RAISE EXCEPTION 'checkout_v2_horizon_boundary_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_horizon_boundary_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- Neither direct ledger writes nor prepare can persist a +35-day target.
DO $$
DECLARE
    horizon_at TIMESTAMPTZ;
BEGIN
    SELECT (
        (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)
            + INTERVAL '28 days'
    ) AT TIME ZONE allocation.timezone_name
    INTO horizon_at
    FROM public.checkout_v2_weekly_allocations AS allocation
    JOIN public.bookable_slots AS sold_slot
      ON sold_slot.id = allocation.slot_id
    WHERE allocation.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND sold_slot.sold_subscription_id = allocation.subscription_id;

    BEGIN
        INSERT INTO public.checkout_v2_reschedule_operations (
            request_id,
            session_id,
            subscription_id,
            cycle_id,
            actor_id,
            operation_kind,
            old_scheduled_at,
            new_scheduled_at,
            expected_anchor_revision,
            target_stripe_anchor_at
        )
        SELECT
            '71000000-0000-4000-8000-000000000035',
            billing.first_session_id,
            billing.subscription_id,
            session_row.checkout_v2_cycle_id,
            session_row.student_id,
            'provisional_anchor',
            session_row.scheduled_at,
            horizon_at + INTERVAL '7 days',
            billing.anchor_revision,
            horizon_at + INTERVAL '35 days'
        FROM public.checkout_v2_billing_state AS billing
        JOIN public.sessions AS session_row
          ON session_row.id = billing.first_session_id
        WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'checkout_v2_direct_insert_crossed_self_service_horizon';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_exceeds_self_service_horizon' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM public.prepare_checkout_v2_reschedule(
            '71000000-0000-4000-8000-000000000036',
            (
                SELECT first_session_id
                FROM public.checkout_v2_billing_state
                WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
            ),
            '10000000-0000-4000-8000-000000000001',
            horizon_at + INTERVAL '7 days'
        );
        RAISE EXCEPTION 'checkout_v2_prepare_crossed_self_service_horizon';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_exceeds_self_service_horizon' THEN
            RAISE;
        END IF;
    END;
END
$$;

-- The upgrade assertion fails closed if an older deployment contains an
-- active requested/manual-review operation beyond the immutable horizon.
DO $$
DECLARE
    horizon_at TIMESTAMPTZ;
BEGIN
    SELECT (
        (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)
            + INTERVAL '28 days'
    ) AT TIME ZONE allocation.timezone_name
    INTO horizon_at
    FROM public.checkout_v2_weekly_allocations AS allocation
    JOIN public.bookable_slots AS sold_slot
      ON sold_slot.id = allocation.slot_id
    WHERE allocation.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND sold_slot.sold_subscription_id = allocation.subscription_id;

    SET LOCAL session_replication_role = replica;

    INSERT INTO public.checkout_v2_reschedule_operations (
        request_id,
        session_id,
        subscription_id,
        cycle_id,
        actor_id,
        operation_kind,
        old_scheduled_at,
        new_scheduled_at,
        expected_anchor_revision,
        target_stripe_anchor_at
    )
    SELECT
        '71000000-0000-4000-8000-000000000037',
        billing.first_session_id,
        billing.subscription_id,
        session_row.checkout_v2_cycle_id,
        session_row.student_id,
        'provisional_anchor',
        session_row.scheduled_at,
        horizon_at + INTERVAL '7 days',
        billing.anchor_revision,
        horizon_at + INTERVAL '35 days'
    FROM public.checkout_v2_billing_state AS billing
    JOIN public.sessions AS session_row
      ON session_row.id = billing.first_session_id
    WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001';

    SET LOCAL session_replication_role = origin;

    BEGIN
        PERFORM private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe();
        RAISE EXCEPTION 'checkout_v2_horizon_upgrade_assertion_accepted_invalid_operation';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        IF SQLERRM <>
            'checkout_v2_reschedule_upgrade_exceeds_self_service_horizon' THEN
            RAISE;
        END IF;
    END;

    RAISE EXCEPTION 'checkout_v2_horizon_upgrade_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_horizon_upgrade_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- The migration is prospective: an already-applied historical operation does
-- not fail the upgrade assertion and harmless metadata reconciliation remains
-- possible, while its structural contract stays immutable outside the limit.
DO $$
DECLARE
    horizon_at TIMESTAMPTZ;
    historical_operation_id UUID;
BEGIN
    SELECT (
        (sold_slot.first_occurrence_at AT TIME ZONE allocation.timezone_name)
            + INTERVAL '28 days'
    ) AT TIME ZONE allocation.timezone_name
    INTO horizon_at
    FROM public.checkout_v2_weekly_allocations AS allocation
    JOIN public.bookable_slots AS sold_slot
      ON sold_slot.id = allocation.slot_id
    WHERE allocation.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND sold_slot.sold_subscription_id = allocation.subscription_id;

    SET LOCAL session_replication_role = replica;

    INSERT INTO public.checkout_v2_reschedule_operations (
        request_id,
        session_id,
        subscription_id,
        cycle_id,
        actor_id,
        operation_kind,
        old_scheduled_at,
        new_scheduled_at,
        expected_anchor_revision,
        target_stripe_anchor_at,
        observed_stripe_anchor_at,
        stripe_mutation_started_at,
        status,
        applied_at
    )
    SELECT
        '71000000-0000-4000-8000-000000000039',
        billing.first_session_id,
        billing.subscription_id,
        session_row.checkout_v2_cycle_id,
        session_row.student_id,
        'provisional_anchor',
        session_row.scheduled_at,
        horizon_at + INTERVAL '7 days',
        billing.anchor_revision,
        horizon_at + INTERVAL '35 days',
        horizon_at + INTERVAL '35 days',
        date_trunc('second', clock_timestamp()) + INTERVAL '1 second',
        'applied',
        date_trunc('second', clock_timestamp()) + INTERVAL '2 seconds'
    FROM public.checkout_v2_billing_state AS billing
    JOIN public.sessions AS session_row
      ON session_row.id = billing.first_session_id
    WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001'
    RETURNING id INTO historical_operation_id;

    SET LOCAL session_replication_role = origin;

    PERFORM private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe();

    UPDATE public.checkout_v2_reschedule_operations
    SET updated_at = date_trunc('second', updated_at) + INTERVAL '1 second'
    WHERE id = historical_operation_id;

    BEGIN
        UPDATE public.checkout_v2_reschedule_operations
        SET
            new_scheduled_at = new_scheduled_at + INTERVAL '7 days',
            target_stripe_anchor_at = target_stripe_anchor_at + INTERVAL '7 days',
            observed_stripe_anchor_at = observed_stripe_anchor_at + INTERVAL '7 days'
        WHERE id = historical_operation_id;
        RAISE EXCEPTION 'checkout_v2_historical_operation_structural_change_was_accepted';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_exceeds_self_service_horizon' THEN
            RAISE;
        END IF;
    END;

    RAISE EXCEPTION 'checkout_v2_historical_horizon_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_historical_horizon_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- The notice boundary is inclusive at exactly 24 hours and rejects one
-- second less without relying on wall-clock timing in the test process.
DO $$
BEGIN
    IF NOT private.checkout_v2_reschedule_has_sufficient_notice(
        '2030-01-02 10:00:00+00'::TIMESTAMPTZ,
        '2030-01-01 10:00:00+00'::TIMESTAMPTZ
    ) OR private.checkout_v2_reschedule_has_sufficient_notice(
        '2030-01-02 09:59:59+00'::TIMESTAMPTZ,
        '2030-01-01 10:00:00+00'::TIMESTAMPTZ
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_notice_boundary_is_wrong';
    END IF;

    IF (
        (
            '2027-10-25 09:00:00 Europe/Madrid'::TIMESTAMPTZ
            AT TIME ZONE 'Europe/Madrid'
        ) + INTERVAL '7 days'
    ) AT TIME ZONE 'Europe/Madrid'
        IS NOT DISTINCT FROM
        '2027-10-25 09:00:00 Europe/Madrid'::TIMESTAMPTZ + INTERVAL '7 days' THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_dst_target_used_utc_interval';
    END IF;
END
$$;

SELECT
    operation.id AS anchor_reschedule_operation_id,
    operation.target_stripe_anchor_at AS anchor_reschedule_target_at
FROM public.prepare_checkout_v2_reschedule(
    '71000000-0000-4000-8000-000000000001',
    :'first_session_id'::UUID,
    '10000000-0000-4000-8000-000000000001',
    :'moved_first_class_at'::TIMESTAMPTZ
) AS operation
\gset

DO $$
DECLARE
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    BEGIN
        PERFORM *
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '1 second'
        );
        RAISE EXCEPTION 'checkout_v2_get_targets_ignored_pending_operation';
    EXCEPTION WHEN unique_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_subscription_has_pending_operation' THEN
            RAISE;
        END IF;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '1 second',
            '71000000-0000-4000-8000-000000000001'
        ) AS target
        WHERE target.target_scheduled_at = moved_at
          AND target.operation_kind = 'provisional_anchor'
          AND pg_catalog.cardinality(target.affected_scheduled_ats) = 4
    ) THEN
        RAISE EXCEPTION 'checkout_v2_exact_pending_request_was_not_ignored';
    END IF;

    BEGIN
        PERFORM *
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at + INTERVAL '1 second',
            moved_at + INTERVAL '2 seconds',
            '71000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'checkout_v2_mismatched_pending_request_was_ignored';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <>
            'checkout_v2_reschedule_ignored_pending_request_is_invalid' THEN
            RAISE;
        END IF;
    END;
END
$$;

-- A browser may recover after a pre-Stripe request was abandoned. At the
-- exact 15-minute boundary it no longer blocks listing; prepare remains the
-- only operation allowed to close it durably.
DO $$
DECLARE
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
    operations_before BIGINT;
    operations_after BIGINT;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT COUNT(*) INTO operations_before
    FROM public.checkout_v2_reschedule_operations;

    UPDATE public.checkout_v2_reschedule_operations
    SET
        created_at = date_trunc('second', statement_timestamp())
            - INTERVAL '15 minutes',
        updated_at = date_trunc('second', statement_timestamp())
            - INTERVAL '15 minutes'
    WHERE request_id = '71000000-0000-4000-8000-000000000001'
      AND status = 'requested'
      AND stripe_mutation_started_at IS NULL;

    IF NOT FOUND OR NOT EXISTS (
        SELECT 1
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '1 second'
        ) AS target
        WHERE target.target_scheduled_at = moved_at
    ) THEN
        RAISE EXCEPTION 'checkout_v2_expired_pre_boundary_request_blocked_listing';
    END IF;

    SELECT COUNT(*) INTO operations_after
    FROM public.checkout_v2_reschedule_operations;
    IF operations_after IS DISTINCT FROM operations_before THEN
        RAISE EXCEPTION 'checkout_v2_expired_listing_changed_durable_state';
    END IF;

    RAISE EXCEPTION 'checkout_v2_expired_listing_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_expired_listing_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- Exact request replay returns the same durable operation.
DO $$
DECLARE
    replayed public.checkout_v2_reschedule_operations%ROWTYPE;
BEGIN
    SELECT * INTO replayed
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000001',
        (
            SELECT first_session_id
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        ),
        '10000000-0000-4000-8000-000000000001',
        (
            SELECT first_class_at + INTERVAL '7 days'
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        )
    );

    IF replayed.id IS DISTINCT FROM (
        SELECT id
        FROM public.checkout_v2_reschedule_operations
        WHERE request_id = '71000000-0000-4000-8000-000000000001'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_request_replay_changed_identity';
    END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000001',
        (
            SELECT first_session_id
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        ),
        '10000000-0000-4000-8000-000000000001',
        (
            SELECT first_class_at + INTERVAL '14 days'
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        )
    );
    RAISE EXCEPTION 'checkout_v2_reschedule_request_id_was_reused';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'checkout_v2_reschedule_request_conflicts' THEN
        RAISE;
    END IF;
END
$$;

-- The subscription advisory lock plus the partial unique index make a
-- prepared Stripe saga exclusive until it is applied or reconciled.
DO $$
BEGIN
    PERFORM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000002',
        (
            SELECT first_session_id
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        ),
        '10000000-0000-4000-8000-000000000001',
        (
            SELECT first_class_at + INTERVAL '7 days'
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        )
    );
    RAISE EXCEPTION 'checkout_v2_subscription_accepted_two_pending_reschedules';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'checkout_v2_reschedule_subscription_has_pending_operation' THEN
        RAISE;
    END IF;
END
$$;

-- Cancellation shares the same lock and cannot invalidate a prepared Stripe
-- operation between prepare and apply.
DO $$
BEGIN
    PERFORM public.cancel_scheduled_session(
        (
            SELECT first_session_id
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
        ),
        '10000000-0000-4000-8000-000000000001',
        'student',
        'concurrent cancellation test'
    );
    RAISE EXCEPTION 'checkout_v2_pending_reschedule_was_cancelled';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'checkout_v2_reschedule_subscription_has_pending_operation' THEN
        RAISE;
    END IF;
END
$$;

-- Authenticated administrators may perform writes allowed by the session RLS
-- policy without receiving 42501 from private ledger/slot lookups. The same
-- trigger must still reject the write when a durable reservation is active.
SAVEPOINT checkout_v2_authenticated_admin_guard;

SELECT public.mark_checkout_v2_reschedule_outcome(
    :'anchor_reschedule_operation_id'::UUID,
    'failed',
    'authenticated_admin_permission_fixture'
);

SELECT pg_catalog.set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000003',
    TRUE
);
SELECT pg_catalog.set_config(
    'app.checkout_v2_test_first_session_id',
    :'first_session_id',
    TRUE
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
    UPDATE public.sessions
    SET teacher_id = teacher_id
    WHERE id = current_setting(
        'app.checkout_v2_test_first_session_id'
    )::UUID;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'authenticated_admin_allowed_write_did_not_run';
    END IF;
END
$$;

RESET ROLE;
ROLLBACK TO SAVEPOINT checkout_v2_authenticated_admin_guard;

SELECT pg_catalog.set_config(
    'request.jwt.claim.sub',
    '10000000-0000-4000-8000-000000000003',
    TRUE
);
SELECT pg_catalog.set_config(
    'app.checkout_v2_test_first_session_id',
    :'first_session_id',
    TRUE
);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
    UPDATE public.sessions
    SET status = 'completed'
    WHERE id = current_setting(
        'app.checkout_v2_test_first_session_id'
    )::UUID;
    RAISE EXCEPTION 'authenticated_admin_crossed_active_reschedule';
EXCEPTION WHEN SQLSTATE '40001' THEN
    IF SQLERRM <> 'checkout_v2_reschedule_session_is_locked' THEN
        RAISE;
    END IF;
END
$$;

RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', TRUE);

-- Manual review is allowed before our Stripe mutation when preflight discovers
-- external divergence. It is terminal, blocks conflicting lifecycle writes,
-- but leaves notes and provider artifact fields writable.
DO $$
DECLARE
    operation_id UUID := (
        SELECT id
        FROM public.checkout_v2_reschedule_operations
        WHERE request_id = '71000000-0000-4000-8000-000000000001'
    );
    first_session UUID := (
        SELECT first_session_id
        FROM public.checkout_v2_billing_state
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
    );
BEGIN
    PERFORM public.mark_checkout_v2_reschedule_outcome(
        operation_id,
        'manual_review',
        'stripe_preflight_anchor_diverged'
    );

    PERFORM pg_catalog.set_config(
        'app.checkout_v2_reschedule_operation_id',
        '00000000-0000-4000-8000-000000000099',
        TRUE
    );

    BEGIN
        UPDATE public.sessions
        SET status = 'completed'
        WHERE id = first_session;
        RAISE EXCEPTION 'checkout_v2_manual_review_allowed_completion';
    EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM <> 'checkout_v2_reschedule_session_is_locked' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        UPDATE public.sessions
        SET status = 'no_show',
            no_show_at = date_trunc('second', clock_timestamp())
        WHERE id = first_session;
        RAISE EXCEPTION 'checkout_v2_manual_review_allowed_no_show';
    EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM <> 'checkout_v2_reschedule_session_is_locked' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        UPDATE public.sessions
        SET scheduled_at = scheduled_at + INTERVAL '5 minutes'
        WHERE id = first_session;
        RAISE EXCEPTION 'checkout_v2_manual_review_allowed_time_change';
    EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM <> 'checkout_v2_reschedule_session_is_locked' THEN
            RAISE;
        END IF;
    END;

    UPDATE public.sessions
    SET
        teacher_notes = 'notes remain writable while reschedule is pending',
        calendar_event_id = 'calendar_artifact_remains_writable'
    WHERE id = first_session;

    BEGIN
        UPDATE public.checkout_v2_billing_state
        SET updated_at = date_trunc('second', clock_timestamp())
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'checkout_v2_manual_review_allowed_billing_write';
    EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM <> 'checkout_v2_reschedule_billing_state_is_locked' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        UPDATE public.checkout_v2_cycles
        SET updated_at = date_trunc('second', clock_timestamp())
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
          AND cycle_number = 1;
        RAISE EXCEPTION 'checkout_v2_manual_review_allowed_cycle_write';
    EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM <> 'checkout_v2_reschedule_billing_state_is_locked' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            operation_id,
            'failed',
            'must_not_reopen_manual_review'
        );
        RAISE EXCEPTION 'checkout_v2_manual_review_was_reopened';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_outcome_transition_is_not_allowed' THEN
            RAISE;
        END IF;
    END;

    PERFORM public.apply_checkout_v2_reschedule(
        operation_id,
        (
            SELECT target_stripe_anchor_at
            FROM public.checkout_v2_reschedule_operations
            WHERE id = operation_id
        )
    );

    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations
        WHERE id = operation_id
          AND status = 'applied'
          AND last_error IS NULL
          AND stripe_mutation_started_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'checkout_v2_manual_review_was_not_reconciled';
    END IF;

    RAISE EXCEPTION 'checkout_v2_manual_review_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_manual_review_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- A provisional operation whose Stripe mutation boundary was crossed may leave
-- manual review only when Stripe is then observed at the exact previous anchor.
-- The recovery is idempotent and never clears the durable mutation marker.
DO $$
DECLARE
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
    begun_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    recovered_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    replayed_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    previous_anchor TIMESTAMPTZ;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations
    WHERE request_id = '71000000-0000-4000-8000-000000000001';

    previous_anchor := operation_row.old_scheduled_at + INTERVAL '672 hours';

    BEGIN
        UPDATE public.checkout_v2_reschedule_operations
        SET
            status = 'failed',
            last_error = 'stripe_confirmed_at_previous_anchor',
            observed_stripe_anchor_at = previous_anchor + INTERVAL '1 second'
        WHERE id = operation_row.id;
        RAISE EXCEPTION 'lifecycle_constraint_accepted_wrong_previous_anchor';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            operation_row.id,
            'failed',
            'requested_failure_must_not_record_observed_anchor',
            previous_anchor
        );
        RAISE EXCEPTION 'requested_failure_recorded_observed_anchor';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_outcome_transition_is_not_allowed' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        UPDATE public.checkout_v2_reschedule_operations
        SET
            status = 'failed',
            last_error = 'stripe_confirmed_at_previous_anchor'
        WHERE id = operation_row.id;
        RAISE EXCEPTION 'lifecycle_constraint_reserved_previous_anchor_reason_from_requested';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            operation_row.id,
            'failed',
            'stripe_confirmed_at_previous_anchor'
        );
        RAISE EXCEPTION 'requested_operation_used_reserved_previous_anchor_reason';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_outcome_transition_is_not_allowed' THEN
            RAISE;
        END IF;
    END;

    -- An ambiguous begin may cross Stripe's external boundary without
    -- persisting the local mutation marker. Exact observation at the previous
    -- anchor still closes that manual-review operation safely. The nested
    -- exception rolls this fixture back so the marked-start path stays separate.
    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            operation_row.id,
            'manual_review',
            'stripe_update_acceptance_unknown'
        );

        IF EXISTS (
            SELECT 1
            FROM public.checkout_v2_reschedule_operations
            WHERE id = operation_row.id
              AND stripe_mutation_started_at IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'manual_review_without_stripe_start_fixture_invalid';
        END IF;

        SELECT * INTO recovered_operation
        FROM public.mark_checkout_v2_reschedule_outcome(
            operation_row.id,
            'failed',
            'stripe_confirmed_at_previous_anchor',
            previous_anchor
        );

        IF recovered_operation.id IS DISTINCT FROM operation_row.id
           OR recovered_operation.status IS DISTINCT FROM 'failed'
           OR recovered_operation.last_error IS DISTINCT FROM
                'stripe_confirmed_at_previous_anchor'
           OR recovered_operation.observed_stripe_anchor_at IS DISTINCT FROM
                previous_anchor
           OR recovered_operation.stripe_mutation_started_at IS NOT NULL
           OR recovered_operation.applied_at IS NOT NULL THEN
            RAISE EXCEPTION 'manual_review_previous_anchor_recovery_without_start_was_not_exact';
        END IF;

        RAISE EXCEPTION 'manual_review_without_stripe_start_fixture_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'manual_review_without_stripe_start_fixture_rollback' THEN
            RAISE;
        END IF;
    END;

    SELECT * INTO begun_operation
    FROM public.begin_checkout_v2_reschedule_stripe_mutation(operation_row.id);

    PERFORM public.mark_checkout_v2_reschedule_outcome(
        operation_row.id,
        'manual_review',
        'stripe_update_acceptance_unknown'
    );

    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            operation_row.id,
            'failed',
            'stripe_confirmed_at_previous_anchor',
            previous_anchor + INTERVAL '1 second'
        );
        RAISE EXCEPTION 'manual_review_recovered_from_wrong_anchor';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_outcome_transition_is_not_allowed' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            operation_row.id,
            'failed',
            'different_recovery_reason',
            previous_anchor
        );
        RAISE EXCEPTION 'manual_review_recovered_with_wrong_reason';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_outcome_transition_is_not_allowed' THEN
            RAISE;
        END IF;
    END;

    SELECT * INTO recovered_operation
    FROM public.mark_checkout_v2_reschedule_outcome(
        operation_row.id,
        'failed',
        'stripe_confirmed_at_previous_anchor',
        previous_anchor
    );

    IF recovered_operation.id IS DISTINCT FROM operation_row.id
       OR recovered_operation.status IS DISTINCT FROM 'failed'
       OR recovered_operation.last_error IS DISTINCT FROM
            'stripe_confirmed_at_previous_anchor'
       OR recovered_operation.observed_stripe_anchor_at IS DISTINCT FROM
            previous_anchor
       OR recovered_operation.stripe_mutation_started_at IS NULL
       OR recovered_operation.stripe_mutation_started_at IS DISTINCT FROM
            begun_operation.stripe_mutation_started_at
       OR recovered_operation.applied_at IS NOT NULL THEN
        RAISE EXCEPTION 'manual_review_previous_anchor_recovery_was_not_exact';
    END IF;

    SELECT * INTO replayed_operation
    FROM public.mark_checkout_v2_reschedule_outcome(
        operation_row.id,
        'failed',
        'stripe_confirmed_at_previous_anchor',
        previous_anchor
    );

    IF replayed_operation IS DISTINCT FROM recovered_operation THEN
        RAISE EXCEPTION 'manual_review_previous_anchor_recovery_replay_drifted';
    END IF;

    RAISE EXCEPTION 'manual_review_previous_anchor_recovery_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'manual_review_previous_anchor_recovery_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- A request that never crossed the Stripe boundary expires safely for a new
-- action. Exact request replay remains inspectable before that sanitation.
DO $$
DECLARE
    original_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    replayed public.checkout_v2_reschedule_operations%ROWTYPE;
    replacement public.checkout_v2_reschedule_operations%ROWTYPE;
BEGIN
    SELECT * INTO original_operation
    FROM public.checkout_v2_reschedule_operations
    WHERE request_id = '71000000-0000-4000-8000-000000000001';

    UPDATE public.checkout_v2_reschedule_operations
    SET
        created_at = date_trunc('second', clock_timestamp()) - INTERVAL '16 minutes',
        updated_at = date_trunc('second', clock_timestamp()) - INTERVAL '16 minutes'
    WHERE id = original_operation.id;

    SELECT * INTO replayed
    FROM public.prepare_checkout_v2_reschedule(
        original_operation.request_id,
        original_operation.session_id,
        original_operation.actor_id,
        original_operation.new_scheduled_at
    );

    IF replayed.status IS DISTINCT FROM 'requested' THEN
        RAISE EXCEPTION 'checkout_v2_exact_retry_was_expired_before_reconciliation';
    END IF;

    BEGIN
        PERFORM public.cancel_scheduled_session(
            original_operation.session_id,
            original_operation.actor_id,
            'student',
            'stale unstarted operation must not lock cancellation'
        );
        RAISE EXCEPTION 'checkout_v2_stale_cancel_fixture_rollback';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'checkout_v2_stale_cancel_fixture_rollback' THEN
            RAISE;
        END IF;
    END;

    SELECT * INTO replacement
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000012',
        original_operation.session_id,
        original_operation.actor_id,
        original_operation.new_scheduled_at
    );

    IF replacement.status IS DISTINCT FROM 'requested'
       OR (
            SELECT status
            FROM public.checkout_v2_reschedule_operations
            WHERE id = original_operation.id
       ) IS DISTINCT FROM 'failed'
       OR (
            SELECT last_error
            FROM public.checkout_v2_reschedule_operations
            WHERE id = original_operation.id
       ) IS DISTINCT FROM 'expired_before_stripe_mutation' THEN
        RAISE EXCEPTION 'checkout_v2_unstarted_expiration_is_not_safe';
    END IF;

    PERFORM public.mark_checkout_v2_reschedule_outcome(
        replacement.id,
        'failed',
        'replacement_fixture_closed'
    );

    RAISE EXCEPTION 'checkout_v2_expiration_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_expiration_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- Applying a provisional anchor is forbidden until the irreversible Stripe
-- boundary has been recorded durably.
DO $$
BEGIN
    PERFORM public.apply_checkout_v2_reschedule(
        (
            SELECT id
            FROM public.checkout_v2_reschedule_operations
            WHERE request_id = '71000000-0000-4000-8000-000000000001'
        ),
        (
            SELECT target_stripe_anchor_at
            FROM public.checkout_v2_reschedule_operations
            WHERE request_id = '71000000-0000-4000-8000-000000000001'
        )
    );
    RAISE EXCEPTION 'checkout_v2_provisional_apply_skipped_begin';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_reschedule_observed_anchor_is_invalid' THEN
        RAISE;
    END IF;
END
$$;

SELECT public.begin_checkout_v2_reschedule_stripe_mutation(
    :'anchor_reschedule_operation_id'::UUID
);
SELECT public.begin_checkout_v2_reschedule_stripe_mutation(
    :'anchor_reschedule_operation_id'::UUID
);

DO $$
DECLARE
    target_session_id UUID;
    moved_at TIMESTAMPTZ;
BEGIN
    SELECT first_session_id, first_class_at + INTERVAL '7 days'
    INTO target_session_id, moved_at
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    BEGIN
        PERFORM *
        FROM public.list_checkout_v2_reschedule_targets(
            target_session_id,
            '10000000-0000-4000-8000-000000000001',
            moved_at,
            moved_at + INTERVAL '1 second',
            '71000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'checkout_v2_post_boundary_pending_request_was_ignored';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <>
            'checkout_v2_reschedule_ignored_pending_request_is_invalid' THEN
            RAISE;
        END IF;
    END;
END
$$;

-- Once Stripe mutation has begun, the four provisional targets are reserved
-- against sessions from every subscription, not only changes to this cycle.
DO $$
DECLARE
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations
    WHERE request_id = '71000000-0000-4000-8000-000000000001';

    INSERT INTO public.subscriptions (
        id,
        student_id,
        package_id,
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
    )
    SELECT
        '50000000-0000-4000-8000-000000000099',
        '10000000-0000-4000-8000-000000000004',
        (
            SELECT id
            FROM public.packages
            WHERE contract_schema_version = 1
            ORDER BY id
            LIMIT 1
        ),
        'active',
        1,
        starts_at,
        ends_at,
        4,
        4,
        0,
        'sub_reschedule_capacity_probe',
        'in_reschedule_capacity_probe',
        1,
        'month',
        1,
        NULL
    FROM public.subscriptions
    WHERE id = operation_row.subscription_id;

    BEGIN
        INSERT INTO public.sessions (
            id,
            subscription_id,
            student_id,
            teacher_id,
            scheduled_at,
            duration_minutes,
            status
        )
        SELECT
            '70000000-0000-4000-8000-000000000099',
            '50000000-0000-4000-8000-000000000099',
            '10000000-0000-4000-8000-000000000004',
            source_session.teacher_id,
            operation_row.new_scheduled_at,
            50,
            'scheduled'
        FROM public.sessions AS source_session
        WHERE source_session.id = operation_row.session_id;

        RAISE EXCEPTION 'checkout_v2_started_target_capacity_was_taken';
    EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM <> 'checkout_v2_reschedule_session_is_locked' THEN
            RAISE;
        END IF;
    END;

    RAISE EXCEPTION 'checkout_v2_capacity_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_capacity_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

DO $$
DECLARE
    operation_row public.checkout_v2_reschedule_operations%ROWTYPE;
BEGIN
    SELECT * INTO operation_row
    FROM public.checkout_v2_reschedule_operations
    WHERE request_id = '71000000-0000-4000-8000-000000000001';

    IF operation_row.stripe_mutation_started_at IS NULL
       OR operation_row.stripe_mutation_started_at < operation_row.created_at THEN
        RAISE EXCEPTION 'checkout_v2_stripe_mutation_begin_is_not_durable';
    END IF;

    UPDATE public.checkout_v2_reschedule_operations
    SET
        created_at = date_trunc('second', clock_timestamp()) - INTERVAL '16 minutes',
        updated_at = GREATEST(
            stripe_mutation_started_at,
            date_trunc('second', clock_timestamp()) - INTERVAL '16 minutes'
        )
    WHERE id = operation_row.id;

    BEGIN
        PERFORM public.prepare_checkout_v2_reschedule(
            '71000000-0000-4000-8000-000000000013',
            operation_row.session_id,
            operation_row.actor_id,
            operation_row.new_scheduled_at
        );
        RAISE EXCEPTION 'checkout_v2_started_operation_was_autoexpired';
    EXCEPTION WHEN unique_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_subscription_has_pending_operation' THEN
            RAISE;
        END IF;
    END;

    IF (
        SELECT status
        FROM public.checkout_v2_reschedule_operations
        WHERE id = operation_row.id
    ) IS DISTINCT FROM 'requested' THEN
        RAISE EXCEPTION 'checkout_v2_started_operation_changed_terminal_state';
    END IF;

    RAISE EXCEPTION 'checkout_v2_started_expiration_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_started_expiration_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

SELECT public.apply_checkout_v2_reschedule(
    :'anchor_reschedule_operation_id'::UUID,
    :'anchor_reschedule_target_at'::TIMESTAMPTZ
);

-- Exact apply replay is idempotent and cannot enqueue duplicate jobs.
SELECT public.apply_checkout_v2_reschedule(
    :'anchor_reschedule_operation_id'::UUID,
    :'anchor_reschedule_target_at'::TIMESTAMPTZ
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.checkout_v2_reschedule_operations AS operation
        WHERE operation.request_id = '71000000-0000-4000-8000-000000000001'
          AND operation.status = 'applied'
          AND operation.operation_kind = 'provisional_anchor'
          AND operation.observed_stripe_anchor_at = operation.target_stripe_anchor_at
          AND operation.target_stripe_anchor_at =
                operation.new_scheduled_at + INTERVAL '672 hours'
    ) OR (
        SELECT COUNT(*)
        FROM public.fulfillment_jobs AS job
        WHERE job.job_type = 'session_reschedule'
          AND job.dedupe_key LIKE
                'checkout_v2_reschedule:'
                || (
                    SELECT id::TEXT
                    FROM public.checkout_v2_reschedule_operations
                    WHERE request_id = '71000000-0000-4000-8000-000000000001'
                ) || ':%'
          AND job.payload->>'operationId' =
                (
                    SELECT id::TEXT
                    FROM public.checkout_v2_reschedule_operations
                    WHERE request_id = '71000000-0000-4000-8000-000000000001'
                )
          AND job.payload->'sendEmail' = 'true'::JSONB
          AND (job.payload->>'previousScheduledAt')::TIMESTAMPTZ
                IS DISTINCT FROM (job.payload->>'scheduledAt')::TIMESTAMPTZ
    ) IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_anchor_reschedule_or_jobs_are_incomplete';
    END IF;

    IF (
        SELECT sessions_used
        FROM public.subscriptions
        WHERE id = '50000000-0000-4000-8000-000000000001'
    ) IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'checkout_v2_anchor_reschedule_changed_quota';
    END IF;
END
$$;

UPDATE public.teacher_availability
SET end_time = (:'first_local'::TIMESTAMP + INTERVAL '3 hours')::TIME
WHERE teacher_id = '10000000-0000-4000-8000-000000000002'
  AND day_of_week =
        EXTRACT(DOW FROM (:'first_local'::TIMESTAMP + INTERVAL '2 days'))::INTEGER
  AND start_time = :'first_local'::TIMESTAMP::TIME
  AND is_active = TRUE;

DO $$
DECLARE
    target_session public.sessions%ROWTYPE;
BEGIN
    SELECT * INTO target_session
    FROM public.sessions
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 3;

    IF NOT private.checkout_v2_reschedule_target_is_available(
        target_session.teacher_id,
        target_session.subscription_id,
        target_session.checkout_v2_cycle_id,
        target_session.id,
        target_session.scheduled_at + INTERVAL '2 days 50 minutes',
        target_session.duration_minutes,
        FALSE
    ) OR private.checkout_v2_reschedule_target_is_available(
        target_session.teacher_id,
        target_session.subscription_id,
        target_session.checkout_v2_cycle_id,
        target_session.id,
        target_session.scheduled_at + INTERVAL '2 days 1 hour 1 minute',
        target_session.duration_minutes,
        FALSE
    ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_slot_grid_is_not_enforced';
    END IF;
END
$$;

-- Failed is terminal only before Stripe mutation and releases the subscription
-- for a new request; neither apply nor a different terminal status can reopen it.
DO $$
DECLARE
    target_session public.sessions%ROWTYPE;
    failed_operation public.checkout_v2_reschedule_operations%ROWTYPE;
    replacement public.checkout_v2_reschedule_operations%ROWTYPE;
BEGIN
    SELECT * INTO target_session
    FROM public.sessions
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 3;

    SELECT * INTO failed_operation
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000014',
        target_session.id,
        target_session.student_id,
        target_session.scheduled_at + INTERVAL '2 days 50 minutes'
    );

    SELECT * INTO failed_operation
    FROM public.mark_checkout_v2_reschedule_outcome(
        failed_operation.id,
        'failed',
        'safe_failure_before_external_mutation'
    );
    PERFORM public.mark_checkout_v2_reschedule_outcome(
        failed_operation.id,
        'failed',
        'safe_failure_before_external_mutation'
    );

    BEGIN
        PERFORM public.mark_checkout_v2_reschedule_outcome(
            failed_operation.id,
            'manual_review',
            'must_not_reopen_failed'
        );
        RAISE EXCEPTION 'checkout_v2_failed_operation_was_reopened';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_outcome_transition_is_not_allowed' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM public.apply_checkout_v2_reschedule(failed_operation.id, NULL);
        RAISE EXCEPTION 'checkout_v2_failed_operation_was_applied';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_reschedule_operation_is_not_applicable' THEN
            RAISE;
        END IF;
    END;

    SELECT * INTO replacement
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000015',
        target_session.id,
        target_session.student_id,
        target_session.scheduled_at + INTERVAL '2 days 50 minutes'
    );

    IF replacement.status IS DISTINCT FROM 'requested' THEN
        RAISE EXCEPTION 'checkout_v2_failed_operation_did_not_release_subscription';
    END IF;

    RAISE EXCEPTION 'checkout_v2_outcome_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_outcome_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

-- A one-session operation changes only that row. The nested block rolls the
-- fixture back after also proving that replay never revives a later-cancelled
-- session.
DO $$
DECLARE
    target_session public.sessions%ROWTYPE;
    prepared public.checkout_v2_reschedule_operations%ROWTYPE;
    applied public.checkout_v2_reschedule_operations%ROWTYPE;
    anchor_before public.checkout_v2_billing_state%ROWTYPE;
    quota_before INTEGER;
    other_session_times_before JSONB;
BEGIN
    SELECT * INTO target_session
    FROM public.sessions
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
      AND checkout_v2_cycle_session_index = 3;

    SELECT * INTO anchor_before
    FROM public.checkout_v2_billing_state
    WHERE subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT sessions_used INTO quota_before
    FROM public.subscriptions
    WHERE id = '50000000-0000-4000-8000-000000000001';

    SELECT pg_catalog.jsonb_object_agg(id::TEXT, pg_catalog.to_jsonb(scheduled_at))
    INTO other_session_times_before
    FROM public.sessions
    WHERE checkout_v2_cycle_id = target_session.checkout_v2_cycle_id
      AND id <> target_session.id;

    SELECT * INTO prepared
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000003',
        target_session.id,
        '10000000-0000-4000-8000-000000000001',
        target_session.scheduled_at + INTERVAL '2 days 50 minutes'
    );

    SELECT * INTO applied
    FROM public.apply_checkout_v2_reschedule(prepared.id, NULL);

    IF applied.status <> 'applied'
       OR applied.operation_kind <> 'single_session'
       OR (
            SELECT scheduled_at
            FROM public.sessions
            WHERE id = target_session.id
       ) IS DISTINCT FROM target_session.scheduled_at + INTERVAL '2 days 50 minutes'
       OR (
            SELECT pg_catalog.jsonb_object_agg(
                id::TEXT,
                pg_catalog.to_jsonb(scheduled_at)
            )
            FROM public.sessions
            WHERE checkout_v2_cycle_id = target_session.checkout_v2_cycle_id
              AND id <> target_session.id
       ) IS DISTINCT FROM other_session_times_before
       OR (
            SELECT sessions_used
            FROM public.subscriptions
            WHERE id = target_session.subscription_id
       ) IS DISTINCT FROM quota_before
       OR (
            SELECT anchor_revision
            FROM public.checkout_v2_billing_state
            WHERE subscription_id = target_session.subscription_id
       ) IS DISTINCT FROM anchor_before.anchor_revision
       OR (
            SELECT COUNT(*)
            FROM public.fulfillment_jobs
            WHERE job_type = 'session_reschedule'
              AND dedupe_key =
                    'checkout_v2_reschedule:' || prepared.id::TEXT
                    || ':' || target_session.id::TEXT
              AND payload->>'operationId' = prepared.id::TEXT
              AND (payload->>'previousScheduledAt')::TIMESTAMPTZ =
                    target_session.scheduled_at
              AND (payload->>'scheduledAt')::TIMESTAMPTZ =
                    target_session.scheduled_at + INTERVAL '2 days 50 minutes'
              AND payload->'sendEmail' = 'true'::JSONB
       ) <> 1 THEN
        RAISE EXCEPTION 'checkout_v2_single_session_reschedule_is_not_exact';
    END IF;

    PERFORM public.cancel_scheduled_session(
        target_session.id,
        target_session.student_id,
        'student',
        'no-revival test'
    );
    PERFORM public.apply_checkout_v2_reschedule(prepared.id, NULL);

    IF (
        SELECT status
        FROM public.sessions
        WHERE id = target_session.id
    ) IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'checkout_v2_applied_replay_revived_cancelled_session';
    END IF;

    RAISE EXCEPTION 'checkout_v2_single_session_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_single_session_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

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

-- The initial-sale horizon does not restrict ordinary single-session changes
-- in later renewal cycles; their existing notice and ordering rules still do.
DO $$
DECLARE
    renewal_session public.sessions%ROWTYPE;
    prepared public.checkout_v2_reschedule_operations%ROWTYPE;
BEGIN
    SELECT session_row.* INTO STRICT renewal_session
    FROM public.sessions AS session_row
    JOIN public.checkout_v2_cycles AS cycle_row
      ON cycle_row.id = session_row.checkout_v2_cycle_id
    WHERE cycle_row.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND cycle_row.cycle_number = 2
      AND session_row.checkout_v2_cycle_session_index = 3;

    SELECT * INTO prepared
    FROM public.prepare_checkout_v2_reschedule(
        '71000000-0000-4000-8000-000000000038',
        renewal_session.id,
        renewal_session.student_id,
        renewal_session.scheduled_at + INTERVAL '2 days 50 minutes'
    );

    IF prepared.operation_kind IS DISTINCT FROM 'single_session'
       OR prepared.status IS DISTINCT FROM 'requested' THEN
        RAISE EXCEPTION 'checkout_v2_later_cycle_single_session_was_not_prepared';
    END IF;

    RAISE EXCEPTION 'checkout_v2_later_cycle_single_session_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_later_cycle_single_session_fixture_rollback' THEN
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

-- A ready cycle remains replayable after a non-payable teacher cancellation
-- and after cancellation releases the durable weekly allocation. Replay must
-- validate the already-materialized facts without requiring live capacity again.
UPDATE public.sessions AS session_row
SET
    status = 'cancelled',
    cancelled_at = session_row.scheduled_at - INTERVAL '1 hour',
    cancelled_by = '10000000-0000-4000-8000-000000000002',
    cancellation_reason = 'teacher_cancelled'
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
              AND status = 'cancelled'
              AND cancelled_by = teacher_id
              AND cancellation_reason = 'teacher_cancelled'
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

DO $$
BEGIN
    IF (
        SELECT COUNT(*)
        FROM public.fulfillment_jobs AS job_row
        WHERE job_row.job_type = 'bulk_session_fulfillment'
          AND job_row.dedupe_key LIKE 'checkout_v2_cycle:%'
    ) IS DISTINCT FROM (
        SELECT COUNT(*)
        FROM public.checkout_v2_cycles AS cycle_row
        WHERE cycle_row.materialization_state = 'ready'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_ready_cycles_do_not_have_exactly_one_fulfillment_job';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.checkout_v2_cycles AS cycle_row
        JOIN public.subscriptions AS subscription_row
          ON subscription_row.id = cycle_row.subscription_id
        WHERE cycle_row.materialization_state = 'ready'
          AND NOT EXISTS (
                SELECT 1
                FROM public.fulfillment_jobs AS job_row
                WHERE job_row.job_type = 'bulk_session_fulfillment'
                  AND job_row.subscription_id = cycle_row.subscription_id
                  AND job_row.student_id = subscription_row.student_id
                  AND job_row.dedupe_key = 'checkout_v2_cycle:' || cycle_row.id::TEXT
                  AND job_row.payload->>'checkoutV2CycleId' = cycle_row.id::TEXT
                  AND job_row.payload->'sessionIds' = (
                        SELECT pg_catalog.jsonb_agg(
                            session_row.id::TEXT
                            ORDER BY session_row.checkout_v2_cycle_session_index
                        )
                        FROM public.sessions AS session_row
                        WHERE session_row.checkout_v2_cycle_id = cycle_row.id
                  )
                  AND job_row.payload->'autoCreateMeeting' = 'true'::JSONB
                  AND job_row.payload->'sendEmail' = 'true'::JSONB
          )
    ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_payload_is_not_exact';
    END IF;

    IF has_function_privilege(
        'service_role',
        'private.enqueue_checkout_v2_cycle_fulfillment()',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'private.enqueue_checkout_v2_cycle_fulfillment()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_trigger_is_publicly_callable';
    END IF;

    IF has_function_privilege(
        'service_role',
        'private.ensure_checkout_v2_cycle_fulfillment(uuid)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'private.ensure_checkout_v2_cycle_fulfillment(uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_helper_is_publicly_callable';
    END IF;

    IF has_function_privilege(
        'service_role',
        'private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'private.assert_checkout_v2_cycle_fulfillment_upgrade_safe()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'checkout_v2_cycle_fulfillment_upgrade_guard_is_publicly_callable';
    END IF;
END
$$;

DO $$
DECLARE
    target_cycle_id UUID;
    jobs_before INTEGER;
    jobs_after INTEGER;
BEGIN
    SELECT COUNT(*) INTO jobs_before
    FROM public.fulfillment_jobs;

    PERFORM private.assert_checkout_v2_cycle_fulfillment_upgrade_safe();

    SELECT COUNT(*) INTO jobs_after
    FROM public.fulfillment_jobs;

    IF jobs_after IS DISTINCT FROM jobs_before THEN
        RAISE EXCEPTION 'checkout_v2_upgrade_guard_reenqueued_existing_effects';
    END IF;

    SELECT cycle_row.id INTO target_cycle_id
    FROM public.checkout_v2_cycles AS cycle_row
    WHERE cycle_row.materialization_state = 'ready'
    ORDER BY cycle_row.created_at, cycle_row.id
    LIMIT 1;

    IF target_cycle_id IS NULL THEN
        RAISE EXCEPTION 'checkout_v2_upgrade_guard_fixture_has_no_ready_cycle';
    END IF;

    DELETE FROM public.fulfillment_jobs
    WHERE job_type = 'bulk_session_fulfillment'
      AND dedupe_key = 'checkout_v2_cycle:' || target_cycle_id::TEXT;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'checkout_v2_upgrade_guard_fixture_has_no_cycle_job';
    END IF;

    BEGIN
        PERFORM private.assert_checkout_v2_cycle_fulfillment_upgrade_safe();
        RAISE EXCEPTION 'checkout_v2_upgrade_guard_accepted_missing_job';
    EXCEPTION
        WHEN SQLSTATE '55000' THEN
            IF SQLERRM <>
                'checkout_v2_cycle_fulfillment_upgrade_requires_exact_ready_cycle_jobs' THEN
                RAISE;
            END IF;
    END;

    SELECT COUNT(*) INTO jobs_after
    FROM public.fulfillment_jobs;

    IF jobs_after IS DISTINCT FROM jobs_before - 1
       OR EXISTS (
            SELECT 1
            FROM public.fulfillment_jobs
            WHERE job_type = 'bulk_session_fulfillment'
              AND dedupe_key = 'checkout_v2_cycle:' || target_cycle_id::TEXT
       ) THEN
        RAISE EXCEPTION 'checkout_v2_upgrade_guard_created_external_work';
    END IF;

    PERFORM private.ensure_checkout_v2_cycle_fulfillment(target_cycle_id);
    PERFORM private.assert_checkout_v2_cycle_fulfillment_upgrade_safe();

    SELECT COUNT(*) INTO jobs_after
    FROM public.fulfillment_jobs;

    IF jobs_after IS DISTINCT FROM jobs_before THEN
        RAISE EXCEPTION 'checkout_v2_upgrade_guard_fixture_was_not_restored';
    END IF;
END
$$;

-- Existing deployments may still contain legacy/ad-hoc sessions without a
-- subscription even though the canonical schema is stricter. The compatible
-- cancellation replacement continues to cancel them without quota writes.
ALTER TABLE public.sessions ALTER COLUMN subscription_id DROP NOT NULL;

INSERT INTO public.sessions (
    id,
    subscription_id,
    student_id,
    teacher_id,
    scheduled_at,
    duration_minutes,
    status
) VALUES (
    '72000000-0000-4000-8000-000000000001',
    NULL,
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    date_trunc('day', clock_timestamp()) + INTERVAL '10 years 3 hours',
    50,
    'scheduled'
);

INSERT INTO public.fulfillment_jobs (
    id,
    job_type,
    session_id,
    subscription_id,
    student_id,
    dedupe_key,
    payload
) VALUES (
    '73000000-0000-4000-8000-000000000010',
    'session_cancellation',
    '72000000-0000-4000-8000-000000000001',
    NULL,
    '10000000-0000-4000-8000-000000000001',
    'session_cancellation:72000000-0000-4000-8000-000000000001',
    '{}'::JSONB
);

DO $$
BEGIN
    PERFORM public.cancel_scheduled_session(
        '72000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'student',
        'legacy ad-hoc cancellation test'
    );
    RAISE EXCEPTION 'session_cancellation_accepted_conflicting_outbox';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'session_cancellation_job_conflicts' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.sessions
        WHERE id = '72000000-0000-4000-8000-000000000001'
          AND status = 'scheduled'
    ) THEN
        RAISE EXCEPTION 'session_cancellation_conflict_did_not_roll_back_state';
    END IF;
END
$$;

DELETE FROM public.fulfillment_jobs
WHERE id = '73000000-0000-4000-8000-000000000010';

SELECT public.cancel_scheduled_session(
    '72000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'student',
    'legacy ad-hoc cancellation test'
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.sessions
        WHERE id = '72000000-0000-4000-8000-000000000001'
          AND subscription_id IS NULL
          AND status = 'cancelled'
          AND cancelled_at IS NOT NULL
    )
       OR (
            SELECT COUNT(*)
            FROM public.fulfillment_jobs
            WHERE job_type = 'session_cancellation'
              AND session_id = '72000000-0000-4000-8000-000000000001'
              AND subscription_id IS NULL
              AND student_id = '10000000-0000-4000-8000-000000000001'
              AND dedupe_key =
                    'session_cancellation:72000000-0000-4000-8000-000000000001'
              AND payload = pg_catalog.jsonb_build_object(
                    'sessionId',
                    '72000000-0000-4000-8000-000000000001'::UUID,
                    'cancelledBy',
                    'student',
                    'reason',
                    'legacy ad-hoc cancellation test'
              )
       ) IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'legacy_session_without_subscription_was_not_cancelled';
    END IF;
END
$$;

DELETE FROM public.fulfillment_jobs
WHERE dedupe_key = 'session_cancellation:72000000-0000-4000-8000-000000000001';

DELETE FROM public.sessions
WHERE id = '72000000-0000-4000-8000-000000000001';

ALTER TABLE public.sessions ALTER COLUMN subscription_id SET NOT NULL;

-- Both the migration precondition and the deferred trigger reject correlated
-- timestamp drift without attempting a backfill.
DO $$
BEGIN
    SET CONSTRAINTS validate_checkout_v2_first_session_after_session_write DEFERRED;

    UPDATE public.sessions
    SET scheduled_at = scheduled_at + INTERVAL '1 hour'
    WHERE id = (
        SELECT first_session_id
        FROM public.checkout_v2_billing_state
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
    );

    PERFORM private.assert_checkout_v2_first_session_coherence_upgrade_safe();
    RAISE EXCEPTION 'checkout_v2_upgrade_guard_accepted_timestamp_drift';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <>
        'checkout_v2_reschedule_upgrade_requires_coherent_first_session_billing_cycle' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    SET CONSTRAINTS validate_checkout_v2_first_session_after_session_write DEFERRED;

    UPDATE public.sessions
    SET scheduled_at = scheduled_at + INTERVAL '1 hour'
    WHERE id = (
        SELECT first_session_id
        FROM public.checkout_v2_billing_state
        WHERE subscription_id = '50000000-0000-4000-8000-000000000001'
    );

    SET CONSTRAINTS validate_checkout_v2_first_session_after_session_write IMMEDIATE;
    RAISE EXCEPTION 'checkout_v2_deferred_guard_accepted_timestamp_drift';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_first_session_billing_cycle_diverged' THEN
        RAISE;
    END IF;
END
$$;

-- Workers may have several pending effects across one subscription, but only
-- one may hold the processing lease while it calls an external provider.
DO $$
DECLARE
    processing_index_definition TEXT;
BEGIN
    SELECT pg_catalog.pg_get_indexdef(index_row.indexrelid)
    INTO processing_index_definition
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indexrelid =
        'public.fulfillment_jobs_one_processing_subscription_idx'::REGCLASS;

    IF processing_index_definition IS DISTINCT FROM
        'CREATE UNIQUE INDEX fulfillment_jobs_one_processing_subscription_idx '
        || 'ON public.fulfillment_jobs USING btree (subscription_id) '
        || 'WHERE ((subscription_id IS NOT NULL) '
        || 'AND (status = ''processing''::text))' THEN
        RAISE EXCEPTION 'processing_subscription_index_definition_drifted';
    END IF;
END
$$;

DO $$
DECLARE
    target_session public.sessions%ROWTYPE;
    other_session public.sessions%ROWTYPE;
BEGIN
    SELECT session_row.* INTO target_session
    FROM public.sessions AS session_row
    JOIN public.checkout_v2_billing_state AS billing
      ON billing.first_session_id = session_row.id
    WHERE billing.subscription_id = '50000000-0000-4000-8000-000000000001';

    SELECT session_row.* INTO other_session
    FROM public.sessions AS session_row
    WHERE session_row.checkout_v2_cycle_id = target_session.checkout_v2_cycle_id
      AND session_row.id <> target_session.id
    ORDER BY session_row.checkout_v2_cycle_session_index
    LIMIT 1;

    INSERT INTO public.fulfillment_jobs (
        id,
        job_type,
        status,
        session_id,
        subscription_id,
        student_id,
        dedupe_key,
        payload
    ) VALUES
        (
            '73000000-0000-4000-8000-000000000001',
            'session_reschedule',
            'pending',
            target_session.id,
            target_session.subscription_id,
            target_session.student_id,
            'processing-session-lock:test:1',
            '{}'::JSONB
        ),
        (
            '73000000-0000-4000-8000-000000000002',
            'session_reschedule',
            'pending',
            other_session.id,
            other_session.subscription_id,
            other_session.student_id,
            'processing-subscription-lock:test:2',
            '{}'::JSONB
        );

    UPDATE public.fulfillment_jobs
    SET status = 'processing'
    WHERE id = '73000000-0000-4000-8000-000000000001';

    BEGIN
        UPDATE public.fulfillment_jobs
        SET status = 'processing'
        WHERE id = '73000000-0000-4000-8000-000000000002';
        RAISE EXCEPTION 'two_jobs_processed_the_same_subscription';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    INSERT INTO public.fulfillment_jobs (
        id,
        job_type,
        status,
        session_id,
        subscription_id,
        student_id,
        dedupe_key,
        payload
    ) VALUES
        (
            '73000000-0000-4000-8000-000000000003',
            'session_reschedule',
            'processing',
            target_session.id,
            NULL,
            target_session.student_id,
            'processing-legacy-nullable:test:1',
            '{}'::JSONB
        ),
        (
            '73000000-0000-4000-8000-000000000004',
            'session_cancellation',
            'processing',
            target_session.id,
            NULL,
            target_session.student_id,
            'processing-legacy-nullable:test:2',
            '{}'::JSONB
        );

    RAISE EXCEPTION 'checkout_v2_processing_job_fixture_rollback';
EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_v2_processing_job_fixture_rollback' THEN
        RAISE;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class
        WHERE oid = 'public.checkout_v2_reschedule_operations'::REGCLASS
          AND relrowsecurity
    )
       OR NOT has_table_privilege(
            'service_role',
            'public.checkout_v2_reschedule_operations',
            'SELECT'
       )
       OR has_table_privilege(
            'service_role',
            'public.checkout_v2_reschedule_operations',
            'INSERT'
       )
       OR has_table_privilege(
            'authenticated',
            'public.checkout_v2_reschedule_operations',
            'SELECT'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.prepare_checkout_v2_reschedule(uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.apply_checkout_v2_reschedule(uuid,timestamptz)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.begin_checkout_v2_reschedule_stripe_mutation(uuid)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.mark_checkout_v2_reschedule_outcome(uuid,text,text,timestamptz)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.cancel_scheduled_session(uuid,uuid,text,text)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'public.list_checkout_v2_reschedule_targets(uuid,uuid,timestamptz,timestamptz,uuid)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.list_checkout_v2_reschedule_targets(uuid,uuid,timestamptz,timestamptz,uuid)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'anon',
            'public.list_checkout_v2_reschedule_targets(uuid,uuid,timestamptz,timestamptz,uuid)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'private.checkout_v2_reschedule_is_within_self_service_horizon(uuid,timestamptz)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'private.guard_checkout_v2_reschedule_self_service_horizon()',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'private.assert_checkout_v2_reschedule_self_service_horizon_upgrade_safe()',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.prepare_checkout_v2_reschedule(uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'public.reconcile_checkout_v2_provisional_anchor(uuid,bigint,date,timestamptz)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'private.checkout_v2_reschedule_has_sufficient_notice(timestamptz,timestamptz)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'private.guard_session_against_bookable_slots()',
            'EXECUTE'
       )
       OR has_function_privilege(
            'service_role',
            'private.guard_checkout_v2_reschedule_locked_state()',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.begin_checkout_v2_reschedule_stripe_mutation(uuid)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'public.mark_checkout_v2_reschedule_outcome(uuid,text,text,timestamptz)',
            'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'checkout_v2_reschedule_privileges_are_too_broad';
    END IF;
END
$$;

ROLLBACK;

\ir checkout-v2-reschedule-concurrency.sql
