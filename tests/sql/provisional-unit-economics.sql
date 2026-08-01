\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '20s';

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (id, email, full_name, role) VALUES
    ('bb000000-0000-4000-8000-000000000001', 'economics-admin@test.invalid', 'Economics Admin', 'admin'),
    ('bb000000-0000-4000-8000-000000000002', 'paid-one@test.invalid', 'Paid One', 'student'),
    ('bb000000-0000-4000-8000-000000000003', 'paid-two@test.invalid', 'Paid Two', 'student'),
    ('bb000000-0000-4000-8000-000000000004', 'unpaid@test.invalid', 'Unpaid Student', 'student'),
    ('bb000000-0000-4000-8000-000000000005', 'teacher@test.invalid', 'Test Teacher', 'teacher');

INSERT INTO public.packages (
    id, name, display_name, price_monthly, sessions_per_month,
    contract_schema_version, amount_cents, billing_interval_unit,
    billing_interval_count, sessions_per_period, class_duration_minutes
) VALUES (
    'bb100000-0000-4000-8000-000000000001', 'economics_v2_package',
    '{"en":"Economics V2"}'::JSONB, 25900, 4, 2, 25900, 'day', 28, 4, 50
);

INSERT INTO public.package_prices (
    id, package_id, catalog_version, package_key, display_name,
    duration_months, amount_cents, currency, sessions_per_month,
    sessions_per_period, has_group_session, has_dual_teacher,
    stripe_account_id, stripe_livemode, stripe_product_id, stripe_price_id,
    status, contract_schema_version, billing_interval_unit,
    billing_interval_count, class_duration_minutes
) VALUES (
    'bb200000-0000-4000-8000-000000000001',
    'bb100000-0000-4000-8000-000000000001', 1, 'economics_v2_package',
    '{"en":"Economics V2"}'::JSONB, NULL, 25900, 'eur', NULL, 4,
    FALSE, FALSE, 'acct_economics_test', FALSE, 'prod_economics_test',
    'price_economics_test', 'active', 2, 'day', 28, 50
);

INSERT INTO public.crm_contacts (id, profile_id, primary_email, full_name) VALUES
    ('bb300000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'paid-one@test.invalid', 'Paid One'),
    ('bb300000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000003', 'paid-two@test.invalid', 'Paid Two'),
    ('bb300000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000004', 'unpaid@test.invalid', 'Unpaid Student');

INSERT INTO public.crm_opportunities (
    id, contact_id, stage, interest, preferred_package_id, checkout_approved_at
) VALUES
    ('bb400000-0000-4000-8000-000000000001', 'bb300000-0000-4000-8000-000000000001', 'qualified', 'direct_checkout', 'bb100000-0000-4000-8000-000000000001', clock_timestamp()),
    ('bb400000-0000-4000-8000-000000000002', 'bb300000-0000-4000-8000-000000000002', 'qualified', 'direct_checkout', 'bb100000-0000-4000-8000-000000000001', clock_timestamp()),
    ('bb400000-0000-4000-8000-000000000003', 'bb300000-0000-4000-8000-000000000003', 'qualified', 'direct_checkout', 'bb100000-0000-4000-8000-000000000001', clock_timestamp());

INSERT INTO public.checkout_intents (
    id, opportunity_id, contact_id, student_id, package_price_id, lang,
    legal_policy_version, policy_accepted_at, site_url, status,
    stripe_session_expires_at, expires_at
) VALUES
    ('bb500000-0000-4000-8000-000000000001', 'bb400000-0000-4000-8000-000000000001', 'bb300000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'bb200000-0000-4000-8000-000000000001', 'en', 'economics-test-v1', clock_timestamp(), 'https://example.test', 'creating', clock_timestamp() + INTERVAL '30 minutes', clock_timestamp() + INTERVAL '35 minutes'),
    ('bb500000-0000-4000-8000-000000000002', 'bb400000-0000-4000-8000-000000000002', 'bb300000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000003', 'bb200000-0000-4000-8000-000000000001', 'en', 'economics-test-v1', clock_timestamp(), 'https://example.test', 'creating', clock_timestamp() + INTERVAL '30 minutes', clock_timestamp() + INTERVAL '35 minutes'),
    ('bb500000-0000-4000-8000-000000000003', 'bb400000-0000-4000-8000-000000000003', 'bb300000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000004', 'bb200000-0000-4000-8000-000000000001', 'en', 'economics-test-v1', clock_timestamp(), 'https://example.test', 'creating', clock_timestamp() + INTERVAL '30 minutes', clock_timestamp() + INTERVAL '35 minutes');

INSERT INTO public.subscriptions (
    id, student_id, package_id, package_price_id, checkout_intent_id, status,
    starts_at, ends_at, sessions_total, contracted_sessions_per_period,
    sessions_used, stripe_subscription_id, stripe_invoice_id,
    contract_schema_version, billing_interval_unit, billing_interval_count,
    class_duration_minutes
) VALUES
    ('bb600000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'bb100000-0000-4000-8000-000000000001', 'bb200000-0000-4000-8000-000000000001', 'bb500000-0000-4000-8000-000000000001', 'active', DATE '2035-01-01', DATE '2035-01-29', 4, 4, 0, 'sub_economics_1', 'in_economics_1', 2, 'day', 28, 50),
    ('bb600000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000003', 'bb100000-0000-4000-8000-000000000001', 'bb200000-0000-4000-8000-000000000001', 'bb500000-0000-4000-8000-000000000002', 'active', DATE '2035-02-01', DATE '2035-03-01', 4, 4, 0, 'sub_economics_2', 'in_economics_2', 2, 'day', 28, 50);

INSERT INTO public.payments (
    id, student_id, subscription_id, amount, currency, status,
    stripe_payment_intent_id, stripe_invoice_id, amount_refunded, created_at
) VALUES
    ('bb700000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'bb600000-0000-4000-8000-000000000001', 25900, 'eur', 'succeeded', 'pi_economics_1', 'in_economics_1', 19425, TIMESTAMPTZ '2026-07-20 10:00:00+00'),
    ('bb700000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000003', 'bb600000-0000-4000-8000-000000000002', 25900, 'eur', 'succeeded', 'pi_economics_2', 'in_economics_2', 0, TIMESTAMPTZ '2026-07-21 10:00:00+00'),
    ('bb700000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000002', 'bb600000-0000-4000-8000-000000000001', 25900, 'eur', 'succeeded', 'pi_economics_renewal_1', 'in_economics_renewal_1', 0, TIMESTAMPTZ '2026-07-22 10:00:00+00');

-- Student one deliberately has a collected payment but pending fulfillment.
INSERT INTO public.checkout_v2_cycles (
    id, subscription_id, cycle_number, cycle_kind, starts_at, ends_at,
    stripe_price_id, stripe_invoice_id, payment_id, materialization_state,
    sessions_materialized_at, created_at
) VALUES
    ('bb800000-0000-4000-8000-000000000001', 'bb600000-0000-4000-8000-000000000001', 1, 'initial', TIMESTAMPTZ '2035-01-01 10:00:00+00', TIMESTAMPTZ '2035-01-29 10:00:00+00', 'price_economics_test', 'in_economics_1', 'bb700000-0000-4000-8000-000000000001', 'pending', NULL, TIMESTAMPTZ '2034-12-21 10:00:00+00'),
    ('bb800000-0000-4000-8000-000000000002', 'bb600000-0000-4000-8000-000000000002', 1, 'initial', TIMESTAMPTZ '2035-02-01 10:00:00+00', TIMESTAMPTZ '2035-03-01 10:00:00+00', 'price_economics_test', 'in_economics_2', 'bb700000-0000-4000-8000-000000000002', 'ready', TIMESTAMPTZ '2035-01-21 10:00:00+00', TIMESTAMPTZ '2035-01-21 10:00:00+00'),
    ('bb800000-0000-4000-8000-000000000003', 'bb600000-0000-4000-8000-000000000001', 2, 'renewal', TIMESTAMPTZ '2035-01-29 10:00:00+00', TIMESTAMPTZ '2035-02-26 10:00:00+00', 'price_economics_test', 'in_economics_renewal_1', 'bb700000-0000-4000-8000-000000000003', 'pending', NULL, TIMESTAMPTZ '2035-01-22 10:00:00+00');

UPDATE public.payments SET checkout_v2_cycle_id = CASE id
    WHEN 'bb700000-0000-4000-8000-000000000001'::UUID THEN 'bb800000-0000-4000-8000-000000000001'::UUID
    WHEN 'bb700000-0000-4000-8000-000000000002'::UUID THEN 'bb800000-0000-4000-8000-000000000002'::UUID
    ELSE 'bb800000-0000-4000-8000-000000000003'::UUID END
WHERE id IN (
    'bb700000-0000-4000-8000-000000000001',
    'bb700000-0000-4000-8000-000000000002',
    'bb700000-0000-4000-8000-000000000003'
);

INSERT INTO public.sessions (
    id, subscription_id, student_id, teacher_id, scheduled_at,
    duration_minutes, status, completed_at
) VALUES
    ('bb710000-0000-4000-8000-000000000001', 'bb600000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000005', TIMESTAMPTZ '2035-01-02 10:00:00+00', 50, 'completed', TIMESTAMPTZ '2035-01-02 11:00:00+00'),
    ('bb710000-0000-4000-8000-000000000002', 'bb600000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000005', TIMESTAMPTZ '2035-01-09 10:00:00+00', 50, 'completed', TIMESTAMPTZ '2035-01-09 11:00:00+00');

INSERT INTO public.teacher_compensation_ledger (
    idempotency_key, session_id, teacher_id, student_id, subscription_id,
    cycle_id, cycle_terms_id, engagement_id, engagement_kind, event_kind,
    session_status, scheduled_at, source_occurred_at, completed_at,
    class_rate_cents, amount_cents, currency
) VALUES
    ('session:bb710000-0000-4000-8000-000000000001', 'bb710000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000005', 'bb000000-0000-4000-8000-000000000002', 'bb600000-0000-4000-8000-000000000001', 'bb800000-0000-4000-8000-000000000001', 'bb720000-0000-4000-8000-000000000001', 'bb730000-0000-4000-8000-000000000001', 'founder', 'class_completed', 'completed', TIMESTAMPTZ '2035-01-02 10:00:00+00', TIMESTAMPTZ '2035-01-02 11:00:00+00', TIMESTAMPTZ '2035-01-02 11:00:00+00', 4000, 4000, 'eur'),
    ('session:bb710000-0000-4000-8000-000000000002', 'bb710000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000005', 'bb000000-0000-4000-8000-000000000002', 'bb600000-0000-4000-8000-000000000001', 'bb800000-0000-4000-8000-000000000001', 'bb720000-0000-4000-8000-000000000001', 'bb730000-0000-4000-8000-000000000001', 'founder', 'class_completed', 'completed', TIMESTAMPTZ '2035-01-09 10:00:00+00', TIMESTAMPTZ '2035-01-09 11:00:00+00', TIMESTAMPTZ '2035-01-09 11:00:00+00', 4000, 4000, 'eur');

INSERT INTO public.acquisition_attribution_events (
    id, request_id, event_kind, contact_id, checkout_intent_id,
    landing_path, referrer_kind, referrer_host, entry_language, utm_source,
    utm_medium, utm_campaign, captured_at
) VALUES (
    'bb900000-0000-4000-8000-000000000001',
    'bb900000-0000-4000-8000-000000000002', 'checkout_start',
    'bb300000-0000-4000-8000-000000000001',
    'bb500000-0000-4000-8000-000000000001', '/en/pricing', 'external',
    'search.example', 'en', 'search', 'cpc', 'move-to-spain',
    TIMESTAMPTZ '2026-07-19 10:00:00+00'
);

SET LOCAL session_replication_role = origin;

DO $$
DECLARE table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'acquisition_campaigns', 'operational_cost_ledger',
        'acquisition_cost_allocation_ledger'
    ] LOOP
        IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = ('public.' || table_name)::REGCLASS) THEN
            RAISE EXCEPTION 'unit_economics_rls_not_enabled:%', table_name;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = ('public.' || table_name)::REGCLASS) THEN
            RAISE EXCEPTION 'unit_economics_unexpected_policy:%', table_name;
        END IF;
        IF has_table_privilege('anon', 'public.' || table_name, 'SELECT')
           OR has_table_privilege('authenticated', 'public.' || table_name, 'SELECT')
           OR has_table_privilege('service_role', 'public.' || table_name, 'INSERT')
           OR NOT has_table_privilege('service_role', 'public.' || table_name, 'SELECT') THEN
            RAISE EXCEPTION 'unit_economics_wrong_table_grants:%', table_name;
        END IF;
    END LOOP;
END
$$;

DO $$
BEGIN
    IF has_function_privilege('anon', 'public.create_acquisition_campaign(uuid,text,text,text,text,text,text,text,text,uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.record_operational_cost(uuid,text,uuid,uuid,integer,timestamptz,uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.adjust_operational_cost(uuid,uuid,integer,uuid,text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.record_acquisition_cost_allocation(uuid,uuid,uuid,integer,text,uuid,uuid,text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.adjust_acquisition_cost_allocation(uuid,uuid,integer,uuid,text)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.create_acquisition_campaign(uuid,text,text,text,text,text,text,text,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'unit_economics_wrong_function_grants';
    END IF;
END
$$;

SELECT public.create_acquisition_campaign(
    'bba00000-0000-4000-8000-000000000001', 'Observed Search', 'Google Ads',
    'google-campaign-1', 'search', 'cpc', 'move-to-spain', NULL, NULL,
    'bb000000-0000-4000-8000-000000000001'
);
SELECT public.create_acquisition_campaign(
    'bba00000-0000-4000-8000-000000000002', 'Manual Partnership', 'Referral',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'bb000000-0000-4000-8000-000000000001'
);
SELECT public.create_acquisition_campaign(
    'bba00000-0000-4000-8000-000000000003', 'No Sales Campaign', 'Google Ads',
    'google-campaign-3', 'search', 'cpc', 'no-sales', NULL, NULL,
    'bb000000-0000-4000-8000-000000000001'
);

-- Exact replay is stable; changed replay conflicts.
SELECT public.create_acquisition_campaign(
    'bba00000-0000-4000-8000-000000000001', 'Observed Search', 'Google Ads',
    'google-campaign-1', 'search', 'cpc', 'move-to-spain', NULL, NULL,
    'bb000000-0000-4000-8000-000000000001'
);
DO $$ BEGIN
    PERFORM public.create_acquisition_campaign(
        'bba00000-0000-4000-8000-000000000001', 'Changed Name', 'Google Ads',
        'google-campaign-1', 'search', 'cpc', 'move-to-spain', NULL, NULL,
        'bb000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'campaign_changed_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'acquisition_campaign_request_id_conflicts' THEN RAISE; END IF;
END $$;

DO $$ BEGIN
    PERFORM public.create_acquisition_campaign(
        'bba00000-0000-4000-8000-000000000099', 'Partial UTM', 'Google Ads',
        NULL, 'search', NULL, NULL, NULL, NULL,
        'bb000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'partial_utm_campaign_was_accepted';
EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_acquisition_campaign' THEN RAISE; END IF;
END $$;

SELECT public.record_operational_cost(
    'bbb00000-0000-4000-8000-000000000001', 'acquisition_spend',
    (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000001'),
    NULL, 20000, TIMESTAMPTZ '2034-12-01 10:00:00+00',
    'bb000000-0000-4000-8000-000000000001', 'Observed search launch spend'
);
SELECT public.record_operational_cost(
    'bbb00000-0000-4000-8000-000000000002', 'acquisition_spend',
    (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000002'),
    NULL, 5000, TIMESTAMPTZ '2034-12-01 10:00:00+00',
    'bb000000-0000-4000-8000-000000000001', 'Manual partnership spend'
);
SELECT public.record_operational_cost(
    'bbb00000-0000-4000-8000-000000000003', 'acquisition_spend',
    (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000003'),
    NULL, 3000, TIMESTAMPTZ '2034-12-01 10:00:00+00',
    'bb000000-0000-4000-8000-000000000001', 'Campaign without sales spend'
);

-- Pending materialization is not a reason to hide collected revenue or costs.
SELECT public.record_operational_cost(
    'bbb00000-0000-4000-8000-000000000004', 'student_tool', NULL,
    'bb000000-0000-4000-8000-000000000002', 1000,
    TIMESTAMPTZ '2035-01-01 10:00:00+00',
    'bb000000-0000-4000-8000-000000000001', 'Student delivery tool cost'
);

DO $$
DECLARE replay_row public.operational_cost_ledger%ROWTYPE;
DECLARE root_id UUID;
BEGIN
    SELECT id INTO root_id FROM public.operational_cost_ledger
    WHERE request_id = 'bbb00000-0000-4000-8000-000000000004';
    SELECT * INTO replay_row FROM public.record_operational_cost(
        'bbb00000-0000-4000-8000-000000000004', 'student_tool', NULL,
        'bb000000-0000-4000-8000-000000000002', 1000,
        TIMESTAMPTZ '2035-01-01 10:00:00+00',
        'bb000000-0000-4000-8000-000000000001', 'Student delivery tool cost');
    IF replay_row.id <> root_id THEN
        RAISE EXCEPTION 'operational_cost_replay_changed_identity';
    END IF;
END $$;
DO $$ BEGIN
    PERFORM public.record_operational_cost(
        'bbb00000-0000-4000-8000-000000000004', 'student_tool', NULL,
        'bb000000-0000-4000-8000-000000000002', 1001,
        TIMESTAMPTZ '2035-01-01 10:00:00+00',
        'bb000000-0000-4000-8000-000000000001', 'Student delivery tool cost');
    RAISE EXCEPTION 'operational_cost_changed_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'operational_cost_request_id_conflicts' THEN RAISE; END IF;
END $$;

SELECT public.adjust_operational_cost(
    'bbb10000-0000-4000-8000-000000000001',
    (SELECT original_cost_id FROM public.operational_cost_balances
     WHERE request_id = 'bbb00000-0000-4000-8000-000000000004'),
    100, 'bb000000-0000-4000-8000-000000000001',
    'Additional student tool usage'
);
DO $$
DECLARE replay_row public.operational_cost_ledger%ROWTYPE;
DECLARE movement_id UUID;
DECLARE original_id UUID;
BEGIN
    SELECT id, original_cost_id INTO movement_id, original_id
    FROM public.operational_cost_ledger
    WHERE request_id = 'bbb10000-0000-4000-8000-000000000001';
    SELECT * INTO replay_row FROM public.adjust_operational_cost(
        'bbb10000-0000-4000-8000-000000000001', original_id, 100,
        'bb000000-0000-4000-8000-000000000001',
        'Additional student tool usage');
    IF replay_row.id <> movement_id THEN
        RAISE EXCEPTION 'operational_cost_adjustment_replay_changed_identity';
    END IF;
    BEGIN
        PERFORM public.adjust_operational_cost(
            'bbb10000-0000-4000-8000-000000000001', original_id, 101,
            'bb000000-0000-4000-8000-000000000001',
            'Additional student tool usage');
        RAISE EXCEPTION 'operational_cost_adjustment_changed_replay_was_accepted';
    EXCEPTION WHEN serialization_failure THEN
        IF SQLERRM <> 'operational_cost_request_id_conflicts' THEN RAISE; END IF;
    END;
END $$;

DO $$ BEGIN
    PERFORM public.record_operational_cost(
        'bbb00000-0000-4000-8000-000000000098', 'delivery_material', NULL,
        'bb000000-0000-4000-8000-000000000004', 1000, clock_timestamp(),
        'bb000000-0000-4000-8000-000000000001', 'Unpaid student direct cost');
    RAISE EXCEPTION 'unpaid_student_direct_cost_was_accepted';
EXCEPTION WHEN foreign_key_violation THEN
    IF SQLERRM <> 'operational_cost_first_paid_cycle_not_found' THEN RAISE; END IF;
END $$;

DO $$ BEGIN
    PERFORM public.record_operational_cost(
        'bbb00000-0000-4000-8000-000000000099', 'payment_processing', NULL,
        'bb000000-0000-4000-8000-000000000002', 1000, clock_timestamp(),
        'bb000000-0000-4000-8000-000000000001', 'Unsupported processing cost');
    RAISE EXCEPTION 'unsupported_cost_kind_was_accepted';
EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_operational_cost' THEN RAISE; END IF;
END $$;

SELECT public.record_acquisition_cost_allocation(
    'bbc00000-0000-4000-8000-000000000001',
    (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000001'),
    'bb000000-0000-4000-8000-000000000002', 12000, 'observed_checkout',
    'bb900000-0000-4000-8000-000000000001',
    'bb000000-0000-4000-8000-000000000001', NULL
);
-- A manual allocation may deliberately use an observed campaign.
SELECT public.record_acquisition_cost_allocation(
    'bbc00000-0000-4000-8000-000000000002',
    (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000001'),
    'bb000000-0000-4000-8000-000000000003', 8000, 'manual', NULL,
    'bb000000-0000-4000-8000-000000000001', 'Administrator verified offline source'
);
DO $$
DECLARE replay_row public.acquisition_cost_allocation_ledger%ROWTYPE;
DECLARE root_id UUID;
BEGIN
    SELECT id INTO root_id FROM public.acquisition_cost_allocation_ledger
    WHERE request_id = 'bbc00000-0000-4000-8000-000000000002';
    SELECT * INTO replay_row FROM public.record_acquisition_cost_allocation(
        'bbc00000-0000-4000-8000-000000000002',
        (SELECT id FROM public.acquisition_campaigns
         WHERE request_id = 'bba00000-0000-4000-8000-000000000001'),
        'bb000000-0000-4000-8000-000000000003', 8000, 'manual', NULL,
        'bb000000-0000-4000-8000-000000000001',
        'Administrator verified offline source');
    IF replay_row.id <> root_id THEN
        RAISE EXCEPTION 'allocation_replay_changed_identity';
    END IF;
END $$;
DO $$ BEGIN
    PERFORM public.record_acquisition_cost_allocation(
        'bbc00000-0000-4000-8000-000000000002',
        (SELECT id FROM public.acquisition_campaigns
         WHERE request_id = 'bba00000-0000-4000-8000-000000000001'),
        'bb000000-0000-4000-8000-000000000003', 7999, 'manual', NULL,
        'bb000000-0000-4000-8000-000000000001',
        'Administrator verified offline source');
    RAISE EXCEPTION 'allocation_changed_replay_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'acquisition_allocation_request_id_conflicts' THEN RAISE; END IF;
END $$;

DO $$ BEGIN
    PERFORM public.record_acquisition_cost_allocation(
        'bbc00000-0000-4000-8000-000000000098',
        (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000002'),
        'bb000000-0000-4000-8000-000000000003', 1, 'manual', NULL,
        'bb000000-0000-4000-8000-000000000001', 'Duplicate active allocation');
    RAISE EXCEPTION 'duplicate_positive_allocation_was_accepted';
EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'student_already_has_positive_acquisition_allocation' THEN RAISE; END IF;
END $$;

DO $$
DECLARE original_id UUID;
BEGIN
    SELECT original_allocation_id INTO original_id
    FROM public.acquisition_cost_allocation_balances
    WHERE request_id = 'bbc00000-0000-4000-8000-000000000001';
    PERFORM public.adjust_acquisition_cost_allocation(
        'bbc00000-0000-4000-8000-000000000099', original_id, 1,
        'bb000000-0000-4000-8000-000000000001', 'Would exceed recorded campaign spend');
    RAISE EXCEPTION 'over_allocation_adjustment_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'acquisition_allocation_exceeds_campaign_spend' THEN RAISE; END IF;
END $$;

-- Zeroing an allocation frees the student for a deliberate reassignment.
SELECT public.adjust_acquisition_cost_allocation(
    'bbd00000-0000-4000-8000-000000000001',
    (SELECT original_allocation_id FROM public.acquisition_cost_allocation_balances WHERE request_id = 'bbc00000-0000-4000-8000-000000000001'),
    -12000, 'bb000000-0000-4000-8000-000000000001', 'Reassign student to verified partnership'
);
DO $$
DECLARE replay_row public.acquisition_cost_allocation_ledger%ROWTYPE;
DECLARE movement_id UUID;
DECLARE original_id UUID;
BEGIN
    SELECT id, original_allocation_id INTO movement_id, original_id
    FROM public.acquisition_cost_allocation_ledger
    WHERE request_id = 'bbd00000-0000-4000-8000-000000000001';
    SELECT * INTO replay_row FROM public.adjust_acquisition_cost_allocation(
        'bbd00000-0000-4000-8000-000000000001', original_id, -12000,
        'bb000000-0000-4000-8000-000000000001',
        'Reassign student to verified partnership');
    IF replay_row.id <> movement_id THEN
        RAISE EXCEPTION 'allocation_adjustment_replay_changed_identity';
    END IF;
    BEGIN
        PERFORM public.adjust_acquisition_cost_allocation(
            'bbd00000-0000-4000-8000-000000000001', original_id, -11999,
            'bb000000-0000-4000-8000-000000000001',
            'Reassign student to verified partnership');
        RAISE EXCEPTION 'allocation_adjustment_changed_replay_was_accepted';
    EXCEPTION WHEN serialization_failure THEN
        IF SQLERRM <> 'acquisition_allocation_request_id_conflicts' THEN RAISE; END IF;
    END;
END $$;
SELECT public.record_acquisition_cost_allocation(
    'bbc00000-0000-4000-8000-000000000003',
    (SELECT id FROM public.acquisition_campaigns WHERE request_id = 'bba00000-0000-4000-8000-000000000002'),
    'bb000000-0000-4000-8000-000000000002', 5000, 'manual', NULL,
    'bb000000-0000-4000-8000-000000000001', 'Verified partnership reassignment'
);

DO $$
DECLARE spend_id UUID;
BEGIN
    SELECT original_cost_id INTO spend_id FROM public.operational_cost_balances
    WHERE request_id = 'bbb00000-0000-4000-8000-000000000002';
    PERFORM public.adjust_operational_cost(
        'bbe00000-0000-4000-8000-000000000001', spend_id, -1,
        'bb000000-0000-4000-8000-000000000001', 'Would reduce spend below allocations');
    RAISE EXCEPTION 'spend_below_allocations_was_accepted';
EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'campaign_spend_cannot_fall_below_allocations' THEN RAISE; END IF;
END $$;

-- Append-only records cannot be rewritten or removed.
DO $$ BEGIN
    UPDATE public.acquisition_campaigns SET name = 'Rewritten'
    WHERE request_id = 'bba00000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'campaign_update_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'provisional_unit_economics_entry_is_immutable' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
    DELETE FROM public.operational_cost_ledger
    WHERE request_id = 'bbb00000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'operational_cost_delete_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'provisional_unit_economics_entry_is_immutable' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
    UPDATE public.acquisition_cost_allocation_ledger SET amount_delta_cents = 1
    WHERE request_id = 'bbc00000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'allocation_update_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'provisional_unit_economics_entry_is_immutable' THEN RAISE; END IF;
END $$;

-- Locks on the original ledger roots are part of the concurrency contract.
DO $$
DECLARE operational_definition TEXT;
DECLARE allocation_definition TEXT;
BEGIN
    SELECT pg_get_functiondef('public.adjust_operational_cost(uuid,uuid,integer,uuid,text)'::REGPROCEDURE)
      INTO operational_definition;
    SELECT pg_get_functiondef('public.adjust_acquisition_cost_allocation(uuid,uuid,integer,uuid,text)'::REGPROCEDURE)
      INTO allocation_definition;
    IF position('operational-cost:' IN operational_definition) = 0
       OR position('acquisition-allocation:' IN allocation_definition) = 0 THEN
        RAISE EXCEPTION 'original_ledger_lock_missing';
    END IF;
END
$$;

DO $$
DECLARE student_one public.student_unit_economics%ROWTYPE;
DECLARE portfolio public.portfolio_unit_economics%ROWTYPE;
BEGIN
    SELECT * INTO student_one FROM public.student_unit_economics
    WHERE student_id = 'bb000000-0000-4000-8000-000000000002';
    IF student_one.first_cycle_id <> 'bb800000-0000-4000-8000-000000000001'
       OR student_one.gross_revenue_cents <> 51800
       OR student_one.refunds_cents <> 19425
       OR student_one.net_revenue_cents <> 32375
       OR student_one.teacher_compensation_cents <> 8000
       OR student_one.direct_operational_cost_cents <> 1100
       OR student_one.acquisition_cost_cents <> 5000
       OR student_one.provisional_contribution_cents <> 18275 THEN
        RAISE EXCEPTION 'pending_cycle_student_economics_wrong:%', to_jsonb(student_one);
    END IF;
    IF student_one.paid_cycle_count <> 2 OR student_one.subscription_count <> 1 THEN
        RAISE EXCEPTION 'renewal_cardinality_wrong:%', to_jsonb(student_one);
    END IF;

    IF (SELECT count(*) FROM public.acquisition_allocation_candidates
        WHERE student_id IN (
            'bb000000-0000-4000-8000-000000000002',
            'bb000000-0000-4000-8000-000000000003'
        ) AND has_active_allocation) <> 2 THEN
        RAISE EXCEPTION 'allocated_students_missing_from_candidates';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.acquisition_campaign_unit_economics
        WHERE campaign_name = 'No Sales Campaign'
          AND acquired_student_count = 0
          AND campaign_spend_cents = 3000
          AND provisional_contribution_cents = -3000
    ) THEN
        RAISE EXCEPTION 'campaign_without_sales_economics_wrong';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.acquisition_campaign_unit_economics
        WHERE campaign_name = 'Manual Partnership'
          AND acquired_student_count = 1
          AND gross_revenue_cents = 51800
          AND teacher_compensation_cents = 8000
          AND allocated_acquisition_cost_cents = 5000
          AND campaign_spend_cents = 5000
          AND provisional_contribution_cents = 18275
    ) THEN
        RAISE EXCEPTION 'renewal_changed_acquisition_cardinality_or_cost';
    END IF;

    SELECT * INTO portfolio FROM public.portfolio_unit_economics;
    IF portfolio.portfolio_key <> 'all' OR portfolio.student_count <> 2
       OR portfolio.gross_revenue_cents <> 77700
       OR portfolio.refunds_cents <> 19425
       OR portfolio.net_revenue_cents <> 58275
       OR portfolio.teacher_compensation_cents <> 8000
       OR portfolio.direct_operational_cost_cents <> 1100
       OR portfolio.campaign_spend_cents <> 28000
       OR portfolio.allocated_acquisition_cost_cents <> 13000
       OR portfolio.unallocated_acquisition_cost_cents <> 15000
       OR portfolio.provisional_contribution_cents <> 21175
       OR portfolio.currency <> 'eur' THEN
        RAISE EXCEPTION 'portfolio_economics_wrong:%', to_jsonb(portfolio);
    END IF;
END
$$;

SET LOCAL ROLE service_role;
DO $$ BEGIN
    INSERT INTO public.operational_cost_ledger (
        request_id, entry_kind, cost_kind, student_id, amount_delta_cents,
        incurred_at, description, recorded_by
    ) VALUES (
        'bbf00000-0000-4000-8000-000000000001', 'original', 'student_tool',
        'bb000000-0000-4000-8000-000000000002', 1, clock_timestamp(),
        'Forbidden direct insert', 'bb000000-0000-4000-8000-000000000001'
    );
    RAISE EXCEPTION 'service_role_direct_insert_was_accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

ROLLBACK;
