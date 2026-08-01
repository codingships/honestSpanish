\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '20s';

BEGIN;

-- Minimal durable references. Replica mode suppresses unrelated audit/runtime
-- triggers while preserving constraints and the production RPC under test.
SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (id, email, role) VALUES
    ('aa000000-0000-4000-8000-000000000001', 'attribution-student@test.invalid', 'student');

INSERT INTO public.packages (
    id, name, display_name, price_monthly, sessions_per_month,
    contract_schema_version, amount_cents, billing_interval_unit,
    billing_interval_count, sessions_per_period, class_duration_minutes
) VALUES (
    'aa100000-0000-4000-8000-000000000001',
    'attribution_v2_package', '{"en":"Attribution V2"}'::JSONB,
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
    'aa200000-0000-4000-8000-000000000001',
    'aa100000-0000-4000-8000-000000000001',
    1, 'attribution_v2_package', '{"en":"Attribution V2"}'::JSONB,
    NULL, 25900, 'eur', NULL, 4, FALSE, FALSE,
    'acct_attribution_test', FALSE, 'prod_attribution_test',
    'price_attribution_test', 'active', 2, 'day', 28, 50
);

INSERT INTO public.crm_contacts (
    id, profile_id, primary_email, full_name
) VALUES
    (
        'aa300000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001',
        'attribution-student@test.invalid', 'Attribution Student'
    ),
    (
        'aa300000-0000-4000-8000-000000000002',
        NULL, 'other-contact@test.invalid', 'Other Contact'
    );

INSERT INTO public.leads (
    id, email, crm_contact_id, crm_opportunity_id
) VALUES (
    'aa400000-0000-4000-8000-000000000001',
    'attribution-student@test.invalid',
    'aa300000-0000-4000-8000-000000000001', NULL
);

INSERT INTO public.crm_opportunities (
    id, contact_id, stage, interest, preferred_package_id,
    checkout_approved_at
) VALUES (
    'aa500000-0000-4000-8000-000000000001',
    'aa300000-0000-4000-8000-000000000001',
    'qualified', 'direct_checkout',
    'aa100000-0000-4000-8000-000000000001', clock_timestamp()
);

INSERT INTO public.checkout_intents (
    id, opportunity_id, contact_id, student_id, package_price_id,
    lang, legal_policy_version, policy_accepted_at, site_url, status,
    stripe_session_expires_at, expires_at
) VALUES (
    'aa600000-0000-4000-8000-000000000001',
    'aa500000-0000-4000-8000-000000000001',
    'aa300000-0000-4000-8000-000000000001',
    'aa000000-0000-4000-8000-000000000001',
    'aa200000-0000-4000-8000-000000000001',
    'en', 'attribution-test-v1', clock_timestamp(),
    'https://example.test', 'creating',
    clock_timestamp() + INTERVAL '30 minutes',
    clock_timestamp() + INTERVAL '35 minutes'
);

SET LOCAL session_replication_role = origin;

-- Grants, RLS, and the absence of broad policies form the API boundary.
DO $$
BEGIN
    IF NOT (
        SELECT relrowsecurity
        FROM pg_catalog.pg_class
        WHERE oid = 'public.acquisition_attribution_events'::REGCLASS
    ) THEN
        RAISE EXCEPTION 'acquisition_attribution_rls_not_enabled';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policy
        WHERE polrelid = 'public.acquisition_attribution_events'::REGCLASS
    ) THEN
        RAISE EXCEPTION 'acquisition_attribution_unexpected_rls_policy';
    END IF;
    IF has_table_privilege('anon', 'public.acquisition_attribution_events', 'SELECT')
       OR has_table_privilege('authenticated', 'public.acquisition_attribution_events', 'SELECT')
       OR has_table_privilege('service_role', 'public.acquisition_attribution_events', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.acquisition_attribution_events', 'SELECT') THEN
        RAISE EXCEPTION 'acquisition_attribution_table_grants_are_wrong';
    END IF;
    IF has_function_privilege(
        'anon',
        'public.record_acquisition_attribution_event(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.record_acquisition_attribution_event(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.record_acquisition_attribution_event(uuid,text,uuid,uuid,text,text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'acquisition_attribution_function_grants_are_wrong';
    END IF;
END
$$;

-- The minimized schema must not grow accidental tracking fields.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'acquisition_attribution_events'
          AND column_name IN (
              'ip_address', 'user_agent', 'url', 'raw_url', 'raw_query',
              'gclid', 'fbclid', 'msclkid'
          )
    ) THEN
        RAISE EXCEPTION 'acquisition_attribution_forbidden_tracking_column';
    END IF;
END
$$;

CREATE TEMP TABLE acquisition_attribution_replay_results (event_id UUID NOT NULL);

INSERT INTO acquisition_attribution_replay_results (event_id)
SELECT (public.record_acquisition_attribution_event(
    'aa700000-0000-4000-8000-000000000001',
    'application_submit',
    'aa400000-0000-4000-8000-000000000001', NULL,
    '/en/apply', 'external', 'search.example', NULL, 'en',
    'search', 'cpc', 'move-to-spain', NULL, 'adult-50min'
)).id;

-- Exact replay returns the original row rather than creating a duplicate.
INSERT INTO acquisition_attribution_replay_results (event_id)
SELECT (public.record_acquisition_attribution_event(
    'aa700000-0000-4000-8000-000000000001',
    'application_submit',
    'aa400000-0000-4000-8000-000000000001', NULL,
    '/en/apply', 'external', 'search.example', NULL, 'en',
    'search', 'cpc', 'move-to-spain', NULL, 'adult-50min'
)).id;

DO $$
BEGIN
    IF (SELECT count(DISTINCT event_id) FROM acquisition_attribution_replay_results) <> 1 THEN
        RAISE EXCEPTION 'acquisition_attribution_replay_changed_identity';
    END IF;
    IF (
        SELECT count(*)
        FROM public.acquisition_attribution_events
        WHERE request_id = 'aa700000-0000-4000-8000-000000000001'
    ) <> 1 THEN
        RAISE EXCEPTION 'acquisition_attribution_replay_duplicated_row';
    END IF;
END
$$;

-- The service role can call the RPC, but cannot bypass it with direct INSERT.
SET LOCAL ROLE service_role;
SELECT public.record_acquisition_attribution_event(
    'aa700000-0000-4000-8000-000000000002',
    'level_check_submit',
    'aa400000-0000-4000-8000-000000000001', NULL,
    '/en/level-check', 'internal', NULL, '/en/apply', 'en',
    NULL, NULL, NULL, NULL, NULL
);
DO $$
BEGIN
    INSERT INTO public.acquisition_attribution_events (
        request_id, event_kind, contact_id, lead_id, landing_path,
        referrer_kind, entry_language
    ) VALUES (
        'aa700000-0000-4000-8000-000000000099',
        'application_submit',
        'aa300000-0000-4000-8000-000000000001',
        'aa400000-0000-4000-8000-000000000001',
        '/en/direct-insert', 'direct', 'en'
    );
    RAISE EXCEPTION 'service_role_direct_insert_was_accepted';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END
$$;
RESET ROLE;

SELECT public.record_acquisition_attribution_event(
    'aa700000-0000-4000-8000-000000000003',
    'checkout_start', NULL,
    'aa600000-0000-4000-8000-000000000001',
    '/en/pricing', 'direct', NULL, NULL, 'en',
    NULL, NULL, NULL, NULL, NULL
);

DO $$
BEGIN
    PERFORM public.record_acquisition_attribution_event(
        'aa700000-0000-4000-8000-000000000007',
        'checkout_start', NULL,
        'aa600000-0000-4000-8000-000000000001',
        '/en/pricing', 'direct', NULL, NULL, 'en',
        NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'acquisition_attribution_duplicate_checkout_was_accepted';
EXCEPTION WHEN unique_violation THEN
    NULL;
END
$$;

DO $$
BEGIN
    PERFORM public.record_acquisition_attribution_event(
        'aa700000-0000-4000-8000-000000000001',
        'application_submit',
        'aa400000-0000-4000-8000-000000000001', NULL,
        '/en/changed', 'external', 'search.example', NULL, 'en',
        'search', 'cpc', 'move-to-spain', NULL, 'adult-50min'
    );
    RAISE EXCEPTION 'acquisition_attribution_request_conflict_was_accepted';
EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'acquisition_attribution_request_id_conflicts' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.record_acquisition_attribution_event(
        'aa700000-0000-4000-8000-000000000004',
        'checkout_start',
        'aa400000-0000-4000-8000-000000000001',
        'aa600000-0000-4000-8000-000000000001',
        '/en/pricing', 'direct', NULL, NULL, 'en',
        NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'acquisition_attribution_invalid_reference_shape_was_accepted';
EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_acquisition_attribution_event' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    PERFORM public.record_acquisition_attribution_event(
        'aa700000-0000-4000-8000-000000000005',
        'application_submit',
        'aa400000-0000-4000-8000-000000000001', NULL,
        '/en/apply?secret=value', 'external', 'Search.Example', NULL, 'en',
        'not allowed', NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'acquisition_attribution_unsafe_payload_was_accepted';
EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_acquisition_attribution_event' THEN RAISE; END IF;
END
$$;

-- Composite FKs independently prevent a reference/contact mismatch.
DO $$
BEGIN
    INSERT INTO public.acquisition_attribution_events (
        request_id, event_kind, contact_id, lead_id, landing_path,
        referrer_kind, entry_language
    ) VALUES (
        'aa700000-0000-4000-8000-000000000006',
        'application_submit',
        'aa300000-0000-4000-8000-000000000002',
        'aa400000-0000-4000-8000-000000000001',
        '/en/apply', 'direct', 'en'
    );
    RAISE EXCEPTION 'acquisition_attribution_cross_contact_reference_was_accepted';
EXCEPTION WHEN foreign_key_violation THEN
    NULL;
END
$$;

DO $$
BEGIN
    UPDATE public.acquisition_attribution_events
    SET utm_campaign = 'rewritten'
    WHERE request_id = 'aa700000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'acquisition_attribution_update_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'acquisition_attribution_event_is_immutable' THEN RAISE; END IF;
END
$$;

DO $$
BEGIN
    DELETE FROM public.acquisition_attribution_events
    WHERE request_id = 'aa700000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'acquisition_attribution_delete_was_accepted';
EXCEPTION WHEN object_not_in_prerequisite_state THEN
    IF SQLERRM <> 'acquisition_attribution_event_is_immutable' THEN RAISE; END IF;
END
$$;

ROLLBACK;
