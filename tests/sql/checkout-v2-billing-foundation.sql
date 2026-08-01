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
    ('10000000-0000-4000-8000-000000000003', 'admin@test.invalid');

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
    ) + INTERVAL '6 days 2 hours 30 minutes'
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

SELECT (
    public.create_bookable_slot(
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
    )
).id AS slot_id
\gset

SELECT public.publish_bookable_slot(
    :'slot_id'::UUID,
    '10000000-0000-4000-8000-000000000003'
);

INSERT INTO public.crm_contacts (
    id,
    profile_id,
    primary_email,
    lifecycle_stage
) VALUES (
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'student@test.invalid',
    'qualified'
);

INSERT INTO public.crm_opportunities (
    id,
    contact_id,
    stage,
    preferred_package_id,
    checkout_approved_at
) VALUES (
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'proposal',
    :'v2_package_id'::UUID,
    clock_timestamp()
);

SELECT (
    public.claim_checkout_intent_for_slot(
        '40000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        :'package_price_id'::UUID,
        'en',
        'test-policy-v1',
        'https://example.test',
        :'slot_id'::UUID
    )
).id AS checkout_intent_id
\gset

SELECT public.snapshot_checkout_intent_customer(
    :'checkout_intent_id'::UUID,
    'cus_test_isolated'
);

SELECT public.complete_checkout_intent(
    :'checkout_intent_id'::UUID,
    '40000000-0000-4000-8000-000000000001',
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
        - INTERVAL '1 day'
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
        status,
        checkout_v2_cycle_id,
        checkout_v2_cycle_session_index
    )
    SELECT
        cycle.subscription_id,
        '10000000-0000-4000-8000-000000000001',
        'cancelled',
        cycle.id,
        1
    FROM public.checkout_v2_cycles AS cycle
    WHERE cycle.subscription_id = '50000000-0000-4000-8000-000000000001'
      AND cycle.cycle_number = 2;
    RAISE EXCEPTION 'pending_checkout_v2_cycle_accepted_a_session';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'checkout_v2_cycle_subscription_binding_is_invalid' THEN
        RAISE;
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
            (:'first_local'::TIMESTAMP + INTERVAL '56 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '63 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '70 days') AT TIME ZONE 'Europe/Madrid',
            (:'first_local'::TIMESTAMP + INTERVAL '77 days') AT TIME ZONE 'Europe/Madrid'
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

UPDATE public.subscriptions
SET status = 'cancelled'
WHERE id = '50000000-0000-4000-8000-000000000001';

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
BEGIN
    IF has_table_privilege('anon', 'public.checkout_v2_cycles', 'SELECT')
       OR has_table_privilege('authenticated', 'public.checkout_v2_billing_state', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.checkout_v2_cycles', 'SELECT')
       OR has_table_privilege('service_role', 'public.checkout_v2_cycles', 'INSERT')
       OR has_table_privilege('service_role', 'public.checkout_v2_cycles', 'UPDATE')
       OR has_table_privilege('service_role', 'public.checkout_v2_billing_state', 'UPDATE')
       OR has_table_privilege('service_role', 'public.checkout_v2_price_snapshots', 'INSERT') THEN
        RAISE EXCEPTION 'checkout_v2_financial_table_privileges_are_invalid';
    END IF;
END
$$;

SET CONSTRAINTS ALL IMMEDIATE;

ROLLBACK;
