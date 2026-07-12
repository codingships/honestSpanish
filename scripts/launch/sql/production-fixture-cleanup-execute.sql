\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SELECT (
    :'cleanup_gate' = 'EXECUTE_PRODUCTION_FIXTURE_CLEANUP_V1'
    AND :'cleanup_project_ref' = 'vkkahxsybhbutszerawz'
    AND :'cleanup_snapshot_sha256' = 'dbd25299db5562a01a65ad3d2d64689fc0871d9a64d5d3378e074c06e20cf5ab'
    AND :'cleanup_scope_sha256' = '12054149aa95adb338665bb6b6e20f2c875fc1c05f0693e71d41a9685743f510'
    AND :'cleanup_backup_receipt_sha256' ~ '^[a-f0-9]{64}$'
    AND :'cleanup_package_stripe_reference_sha256' ~ '^[a-f0-9]{64}$'
) AS cleanup_gate_ok \gset

\if :cleanup_gate_ok
\else
    ROLLBACK;
    \echo 'Production fixture cleanup SQL gate rejected.'
    \quit 3
\endif

SELECT set_config(
    'cleanup.package_stripe_reference_sha256',
    :'cleanup_package_stripe_reference_sha256',
    TRUE
);
SELECT pg_advisory_xact_lock(hashtextextended(
    'espanol-honesto:production-fixture-cleanup:v1',
    0
));

LOCK TABLE
    auth.users,
    public.admin_audit_log,
    public.fulfillment_jobs,
    public.jobs,
    public.leads,
    public.packages,
    public.payments,
    public.processed_webhook_events,
    public.profiles,
    public.profiles_private,
    public.sessions,
    public.student_teachers,
    public.subscriptions,
    public.support_tickets,
    public.teacher_availability
IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    v_count BIGINT;
    v_deleted BIGINT;
    v_canonical_json JSONB;
    v_stripe_reference_json JSONB;
    v_canonical_sha256 TEXT;
    v_stripe_reference_sha256 TEXT;
    v_jobs_shape_sha256 TEXT;
    v_unexpected_tables TEXT[];
BEGIN
    IF to_regclass('public.package_prices') IS NOT NULL
        OR to_regclass('public.checkout_intents') IS NOT NULL
        OR to_regclass('public.email_recipient_budget_usage') IS NOT NULL
        OR to_regclass('public.fulfillment_effects') IS NOT NULL
        OR to_regclass('public.staging_integration_smoke_runs') IS NOT NULL
        OR to_regclass('public.staging_integration_smoke_leases') IS NOT NULL THEN
        RAISE EXCEPTION 'Schema drift: a table outside the approved snapshot is present';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'package_price_id'
    ) THEN
        RAISE EXCEPTION 'Schema drift: subscriptions.package_price_id must still be absent';
    END IF;

    SELECT array_agg(tablename ORDER BY tablename)
    INTO v_unexpected_tables
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
          'admin_audit_log',
          'fulfillment_jobs',
          'jobs',
          'leads',
          'packages',
          'payments',
          'processed_webhook_events',
          'profiles',
          'profiles_private',
          'sessions',
          'student_teachers',
          'subscriptions',
          'support_tickets',
          'teacher_availability'
      );
    IF v_unexpected_tables IS NOT NULL THEN
        RAISE EXCEPTION 'Schema drift: unexpected public tables are present: %', v_unexpected_tables;
    END IF;

    IF (SELECT count(*) FROM auth.users) <> 138 THEN
        RAISE EXCEPTION 'Baseline drift: auth.users';
    END IF;
    IF (SELECT count(*) FROM public.profiles) <> 138 THEN
        RAISE EXCEPTION 'Baseline drift: profiles';
    END IF;
    IF (SELECT count(*) FROM public.profiles_private) <> 138 THEN
        RAISE EXCEPTION 'Baseline drift: profiles_private';
    END IF;
    IF (SELECT count(*) FROM public.packages) <> 5 THEN
        RAISE EXCEPTION 'Baseline drift: packages';
    END IF;
    IF (SELECT count(*) FROM public.packages WHERE name = 'essential' AND is_active = FALSE) <> 1 THEN
        RAISE EXCEPTION 'Baseline drift: inactive essential package';
    END IF;
    IF (SELECT count(*) FROM public.packages WHERE name NOT IN ('group', 'standard', 'hybrid', 'bootcamp', 'essential')) <> 0 THEN
        RAISE EXCEPTION 'Baseline drift: unexpected package key';
    END IF;
    IF (SELECT count(*) FROM public.subscriptions) <> 84 THEN
        RAISE EXCEPTION 'Baseline drift: subscriptions';
    END IF;
    IF (SELECT count(*) FROM public.student_teachers) <> 127 THEN
        RAISE EXCEPTION 'Baseline drift: student_teachers';
    END IF;
    IF (SELECT count(*) FROM public.sessions) <> 700 THEN
        RAISE EXCEPTION 'Baseline drift: sessions';
    END IF;
    IF (SELECT count(*) FROM public.payments) <> 108 THEN
        RAISE EXCEPTION 'Baseline drift: payments';
    END IF;
    IF (SELECT count(*) FROM public.processed_webhook_events) <> 184 THEN
        RAISE EXCEPTION 'Baseline drift: processed_webhook_events';
    END IF;
    IF (SELECT count(*) FROM public.admin_audit_log) <> 3 THEN
        RAISE EXCEPTION 'Baseline drift: admin_audit_log';
    END IF;
    IF (SELECT count(*) FROM public.teacher_availability) <> 5 THEN
        RAISE EXCEPTION 'Baseline drift: teacher_availability';
    END IF;
    IF (SELECT count(*) FROM public.leads) <> 0
        OR (SELECT count(*) FROM public.fulfillment_jobs) <> 0 THEN
        RAISE EXCEPTION 'Baseline drift: an expected-empty application table is not empty';
    END IF;
    IF (SELECT count(*) FROM public.jobs) <> 111 THEN
        RAISE EXCEPTION 'Baseline drift: legacy jobs';
    END IF;
    IF (SELECT count(*) FROM public.support_tickets) <> 2 THEN
        RAISE EXCEPTION 'Baseline drift: support_tickets';
    END IF;

    IF (SELECT count(*) FROM public.profiles WHERE role::text = 'admin') <> 1
        OR (SELECT count(*) FROM public.profiles WHERE role::text = 'student') <> 136
        OR (SELECT count(*) FROM public.profiles WHERE role::text = 'teacher') <> 1 THEN
        RAISE EXCEPTION 'Baseline drift: profile role distribution';
    END IF;
    IF (SELECT count(*) FROM public.subscriptions WHERE status::text = 'active') <> 58
        OR (SELECT count(*) FROM public.subscriptions WHERE status::text = 'cancelled') <> 26 THEN
        RAISE EXCEPTION 'Baseline drift: subscription status distribution';
    END IF;
    IF (SELECT count(*) FROM public.sessions WHERE status = 'no_show') <> 13
        OR (SELECT count(*) FROM public.sessions WHERE status = 'cancelled') <> 653
        OR (SELECT count(*) FROM public.sessions WHERE status = 'completed') <> 16
        OR (SELECT count(*) FROM public.sessions WHERE status = 'scheduled') <> 18 THEN
        RAISE EXCEPTION 'Baseline drift: session status distribution';
    END IF;
    IF (SELECT count(*) FROM public.payments WHERE status::text = 'failed') <> 26
        OR (SELECT count(*) FROM public.payments WHERE status::text = 'succeeded') <> 82 THEN
        RAISE EXCEPTION 'Baseline drift: payment status distribution';
    END IF;
    IF (SELECT count(*) FROM public.subscriptions WHERE stripe_subscription_id IS NOT NULL) <> 27 THEN
        RAISE EXCEPTION 'Baseline drift: Stripe-linked subscriptions';
    END IF;
    IF (
        SELECT count(*)
        FROM public.subscriptions AS subscription
        JOIN public.packages AS package ON package.id = subscription.package_id
        WHERE subscription.status::text = 'active'
          AND subscription.stripe_subscription_id IS NOT NULL
          AND subscription.duration_months = 6
          AND package.name = 'standard'
    ) <> 1 THEN
        RAISE EXCEPTION 'Baseline drift: active standard Stripe fixture';
    END IF;
    IF (
        SELECT count(*)
        FROM public.subscriptions AS subscription
        JOIN public.packages AS package ON package.id = subscription.package_id
        WHERE subscription.status::text = 'cancelled'
          AND subscription.stripe_subscription_id IS NOT NULL
          AND subscription.duration_months = 3
          AND package.name = 'essential'
    ) <> 26 THEN
        RAISE EXCEPTION 'Baseline drift: cancelled essential Stripe fixtures';
    END IF;

    IF (SELECT count(*) FROM public.jobs WHERE status = 'succeeded') <> 111
        OR (SELECT count(*) FROM public.jobs WHERE kind = 'cancel_session') <> 20
        OR (SELECT count(*) FROM public.jobs WHERE kind = 'welcome') <> 22
        OR (SELECT count(*) FROM public.jobs WHERE kind = 'provision') <> 42
        OR (SELECT count(*) FROM public.jobs WHERE kind = 'reminder') <> 5
        OR (SELECT count(*) FROM public.jobs WHERE kind = 'create_drive_folder') <> 22
        OR (SELECT count(*) FROM public.jobs WHERE aggregate_type = 'session') <> 67
        OR (SELECT count(*) FROM public.jobs WHERE aggregate_type = 'subscription') <> 44
        OR (
            SELECT count(*) FROM public.jobs
            WHERE (created_at AT TIME ZONE 'UTC')::date = DATE '2026-04-17'
        ) <> 111
        OR NOT (
            SELECT COALESCE(EXTRACT(EPOCH FROM (max(created_at) - min(created_at))) <= 10800, FALSE)
            FROM public.jobs
        ) THEN
        RAISE EXCEPTION 'Baseline drift: legacy jobs fixture distribution';
    END IF;
    IF (SELECT count(*) FROM public.support_tickets WHERE status = 'closed') <> 2
        OR (
            SELECT count(*)
            FROM public.support_tickets AS ticket
            JOIN public.profiles AS profile ON profile.id = ticket.user_id
            WHERE profile.role::text = 'student'
        ) <> 2
        OR (
            SELECT count(*) FROM public.support_tickets
            WHERE (created_at AT TIME ZONE 'UTC')::date = DATE '2026-06-11'
        ) <> 2 THEN
        RAISE EXCEPTION 'Baseline drift: support ticket fixture distribution';
    END IF;

    WITH shape AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'name', column_name,
                'type', data_type,
                'udt', udt_name,
                'nullable', is_nullable,
                'default', column_default
            ) ORDER BY ordinal_position
        ) AS value
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'jobs'
    )
    SELECT encode(extensions.digest(convert_to(value::text, 'UTF8'), 'sha256'), 'hex')
    INTO v_jobs_shape_sha256
    FROM shape;
    IF v_jobs_shape_sha256 <> 'b707ddc341370795c975b8eddff2ae1394afed9f121ab116306fea2db3e1b1ec' THEN
        RAISE EXCEPTION 'Schema drift: legacy jobs shape hash';
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass AND contype = 'f') <> 0
        OR (SELECT count(*) FROM pg_constraint WHERE confrelid = 'public.jobs'::regclass AND contype = 'f') <> 0
        OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'jobs') <> 0
        OR (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.jobs'::regclass AND NOT tgisinternal) <> 0 THEN
        RAISE EXCEPTION 'Schema drift: legacy jobs dependencies, policies or triggers';
    END IF;
    IF (SELECT array_agg(conname ORDER BY conname) FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass)
        IS DISTINCT FROM ARRAY['jobs_pkey', 'jobs_status_check']::name[] THEN
        RAISE EXCEPTION 'Schema drift: legacy jobs constraints';
    END IF;
    IF (SELECT array_agg(indexname ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'jobs')
        IS DISTINCT FROM ARRAY[
            'jobs_aggregate_idx',
            'jobs_dedupe_key_unique',
            'jobs_kind_status_idx',
            'jobs_pkey',
            'jobs_status_run_after_idx'
        ]::name[] THEN
        RAISE EXCEPTION 'Schema drift: legacy jobs indexes';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.jobs'::regclass
          AND conname = 'jobs_status_check'
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%pending%'
          AND pg_get_constraintdef(oid) LIKE '%running%'
          AND pg_get_constraintdef(oid) LIKE '%succeeded%'
          AND pg_get_constraintdef(oid) LIKE '%failed_retryable%'
          AND pg_get_constraintdef(oid) LIKE '%failed_terminal%'
          AND pg_get_constraintdef(oid) LIKE '%cancelled%'
    ) THEN
        RAISE EXCEPTION 'Schema drift: legacy jobs status constraint';
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.support_tickets'::regclass AND contype = 'f') <> 1 THEN
        RAISE EXCEPTION 'Schema drift: support_tickets foreign key count';
    END IF;

    SELECT
        jsonb_agg(
            jsonb_build_object(
                'name', name,
                'display_name', display_name,
                'price_monthly', price_monthly,
                'sessions_per_month', sessions_per_month,
                'has_group_session', has_group_session,
                'has_dual_teacher', has_dual_teacher,
                'is_active', is_active
            ) ORDER BY name
        ),
        jsonb_agg(
            jsonb_build_object(
                'name', name,
                'stripe_product_id', stripe_product_id,
                'stripe_price_1m', stripe_price_1m,
                'stripe_price_3m', stripe_price_3m,
                'stripe_price_6m', stripe_price_6m
            ) ORDER BY name
        )
    INTO v_canonical_json, v_stripe_reference_json
    FROM public.packages
    WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp');

    v_canonical_sha256 := encode(
        extensions.digest(convert_to(v_canonical_json::text, 'UTF8'), 'sha256'),
        'hex'
    );
    v_stripe_reference_sha256 := encode(
        extensions.digest(convert_to(v_stripe_reference_json::text, 'UTF8'), 'sha256'),
        'hex'
    );
    IF jsonb_array_length(v_canonical_json) <> 4
        OR v_canonical_sha256 <> '6d17a17ca7bd8a99c2f0ba17522780546b473e49c386cee83d1da9acf08da38e' THEN
        RAISE EXCEPTION 'Baseline drift: canonical package catalog hash';
    END IF;
    IF (
        SELECT count(*) FILTER (WHERE stripe_product_id IS NOT NULL)
            + count(*) FILTER (WHERE stripe_price_1m IS NOT NULL)
            + count(*) FILTER (WHERE stripe_price_3m IS NOT NULL)
            + count(*) FILTER (WHERE stripe_price_6m IS NOT NULL)
        FROM public.packages
        WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp')
    ) <> 16 THEN
        RAISE EXCEPTION 'Baseline drift: canonical package Stripe-reference count';
    END IF;
    IF v_stripe_reference_sha256 <> current_setting('cleanup.package_stripe_reference_sha256') THEN
        RAISE EXCEPTION 'Baseline drift: canonical package Stripe-reference hash';
    END IF;

    DELETE FROM public.jobs;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 111 THEN RAISE EXCEPTION 'Delete drift: jobs'; END IF;

    DROP TABLE public.jobs;

    DELETE FROM public.fulfillment_jobs;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 0 THEN RAISE EXCEPTION 'Delete drift: fulfillment_jobs'; END IF;

    DELETE FROM public.processed_webhook_events;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 184 THEN RAISE EXCEPTION 'Delete drift: processed_webhook_events'; END IF;

    DELETE FROM public.admin_audit_log;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 3 THEN RAISE EXCEPTION 'Delete drift: admin_audit_log'; END IF;

    DELETE FROM public.support_tickets;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 2 THEN RAISE EXCEPTION 'Delete drift: support_tickets'; END IF;

    DELETE FROM public.payments;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 108 THEN RAISE EXCEPTION 'Delete drift: payments'; END IF;

    DELETE FROM public.sessions;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 700 THEN RAISE EXCEPTION 'Delete drift: sessions'; END IF;

    DELETE FROM public.student_teachers;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 127 THEN RAISE EXCEPTION 'Delete drift: student_teachers'; END IF;

    DELETE FROM public.teacher_availability;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 5 THEN RAISE EXCEPTION 'Delete drift: teacher_availability'; END IF;

    DELETE FROM public.subscriptions;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 84 THEN RAISE EXCEPTION 'Delete drift: subscriptions'; END IF;

    DELETE FROM public.leads;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 0 THEN RAISE EXCEPTION 'Delete drift: leads'; END IF;

    DELETE FROM public.profiles_private;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 138 THEN RAISE EXCEPTION 'Delete drift: profiles_private'; END IF;

    DELETE FROM public.profiles;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 138 THEN RAISE EXCEPTION 'Delete drift: profiles'; END IF;

    UPDATE public.packages
    SET stripe_product_id = NULL,
        stripe_price_1m = NULL,
        stripe_price_3m = NULL,
        stripe_price_6m = NULL,
        updated_at = clock_timestamp()
    WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp');
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 4 THEN RAISE EXCEPTION 'Update drift: canonical package count'; END IF;

    DELETE FROM public.packages
    WHERE name = 'essential' AND is_active = FALSE;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 1 THEN RAISE EXCEPTION 'Delete drift: essential package'; END IF;

    IF (SELECT count(*) FROM auth.users) <> 138 THEN
        RAISE EXCEPTION 'Postcondition failed: auth.users changed';
    END IF;
    IF (SELECT count(*) FROM public.profiles) <> 0
        OR (SELECT count(*) FROM public.profiles_private) <> 0
        OR (SELECT count(*) FROM public.subscriptions) <> 0
        OR (SELECT count(*) FROM public.student_teachers) <> 0
        OR (SELECT count(*) FROM public.sessions) <> 0
        OR (SELECT count(*) FROM public.payments) <> 0
        OR (SELECT count(*) FROM public.leads) <> 0
        OR (SELECT count(*) FROM public.processed_webhook_events) <> 0
        OR (SELECT count(*) FROM public.fulfillment_jobs) <> 0
        OR (SELECT count(*) FROM public.support_tickets) <> 0
        OR (SELECT count(*) FROM public.admin_audit_log) <> 0
        OR (SELECT count(*) FROM public.teacher_availability) <> 0 THEN
        RAISE EXCEPTION 'Postcondition failed: application fixture rows remain';
    END IF;
    IF (SELECT count(*) FROM public.packages) <> 4
        OR (SELECT count(*) FROM public.packages WHERE name = 'essential') <> 0
        OR (
            SELECT count(*)
            FROM public.packages
            WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp')
              AND stripe_product_id IS NULL
              AND stripe_price_1m IS NULL
              AND stripe_price_3m IS NULL
              AND stripe_price_6m IS NULL
        ) <> 4 THEN
        RAISE EXCEPTION 'Postcondition failed: package preservation/cleanup';
    END IF;
    IF to_regclass('public.jobs') IS NOT NULL THEN
        RAISE EXCEPTION 'Postcondition failed: legacy jobs table still exists';
    END IF;
END $$;

COMMIT;

SELECT 'FIXTURE_CLEANUP_EXECUTE_OK|'
    || 'project_ref=vkkahxsybhbutszerawz|'
    || 'snapshot=dbd25299db5562a01a65ad3d2d64689fc0871d9a64d5d3378e074c06e20cf5ab|'
    || 'scope=12054149aa95adb338665bb6b6e20f2c875fc1c05f0693e71d41a9685743f510|'
    || 'auth_users=BLOCKED_UNTOUCHED_138|packages=4|legacy_jobs=ABSENT';
