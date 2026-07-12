\set ON_ERROR_STOP on

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

WITH canonical_packages AS (
    SELECT
        count(*)::integer AS canonical_count,
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
        ) AS canonical_json,
        jsonb_agg(
            jsonb_build_object(
                'name', name,
                'stripe_product_id', stripe_product_id,
                'stripe_price_1m', stripe_price_1m,
                'stripe_price_3m', stripe_price_3m,
                'stripe_price_6m', stripe_price_6m
            ) ORDER BY name
        ) AS stripe_reference_json,
        count(*) FILTER (WHERE stripe_product_id IS NOT NULL)
            + count(*) FILTER (WHERE stripe_price_1m IS NOT NULL)
            + count(*) FILTER (WHERE stripe_price_3m IS NOT NULL)
            + count(*) FILTER (WHERE stripe_price_6m IS NOT NULL)
            AS stripe_reference_non_null_fields
    FROM public.packages
    WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp')
), counts AS (
    SELECT jsonb_build_object(
        'auth_users', (SELECT count(*) FROM auth.users),
        'profiles', (SELECT count(*) FROM public.profiles),
        'profiles_private', (SELECT count(*) FROM public.profiles_private),
        'packages', (SELECT count(*) FROM public.packages),
        'essential_packages', (SELECT count(*) FROM public.packages WHERE name = 'essential'),
        'inactive_essential_packages', (
            SELECT count(*) FROM public.packages WHERE name = 'essential' AND is_active = FALSE
        ),
        'subscriptions', (SELECT count(*) FROM public.subscriptions),
        'student_teachers', (SELECT count(*) FROM public.student_teachers),
        'sessions', (SELECT count(*) FROM public.sessions),
        'payments', (SELECT count(*) FROM public.payments),
        'leads', (SELECT count(*) FROM public.leads),
        'processed_webhook_events', (SELECT count(*) FROM public.processed_webhook_events),
        'fulfillment_jobs', (SELECT count(*) FROM public.fulfillment_jobs),
        'jobs', (SELECT count(*) FROM public.jobs),
        'support_tickets', (SELECT count(*) FROM public.support_tickets),
        'admin_audit_log', (SELECT count(*) FROM public.admin_audit_log),
        'teacher_availability', (SELECT count(*) FROM public.teacher_availability)
    ) AS value
), distributions AS (
    SELECT jsonb_build_object(
        'profiles_admin', (SELECT count(*) FROM public.profiles WHERE role::text = 'admin'),
        'profiles_student', (SELECT count(*) FROM public.profiles WHERE role::text = 'student'),
        'profiles_teacher', (SELECT count(*) FROM public.profiles WHERE role::text = 'teacher'),
        'subscriptions_active', (SELECT count(*) FROM public.subscriptions WHERE status::text = 'active'),
        'subscriptions_cancelled', (SELECT count(*) FROM public.subscriptions WHERE status::text = 'cancelled'),
        'sessions_no_show', (SELECT count(*) FROM public.sessions WHERE status = 'no_show'),
        'sessions_cancelled', (SELECT count(*) FROM public.sessions WHERE status = 'cancelled'),
        'sessions_completed', (SELECT count(*) FROM public.sessions WHERE status = 'completed'),
        'sessions_scheduled', (SELECT count(*) FROM public.sessions WHERE status = 'scheduled'),
        'payments_failed', (SELECT count(*) FROM public.payments WHERE status::text = 'failed'),
        'payments_succeeded', (SELECT count(*) FROM public.payments WHERE status::text = 'succeeded'),
        'stripe_linked_subscriptions', (
            SELECT count(*) FROM public.subscriptions WHERE stripe_subscription_id IS NOT NULL
        ),
        'active_standard_6m_stripe_linked', (
            SELECT count(*)
            FROM public.subscriptions AS subscription
            JOIN public.packages AS package ON package.id = subscription.package_id
            WHERE subscription.status::text = 'active'
              AND subscription.stripe_subscription_id IS NOT NULL
              AND subscription.duration_months = 6
              AND package.name = 'standard'
        ),
        'cancelled_essential_3m_stripe_linked', (
            SELECT count(*)
            FROM public.subscriptions AS subscription
            JOIN public.packages AS package ON package.id = subscription.package_id
            WHERE subscription.status::text = 'cancelled'
              AND subscription.stripe_subscription_id IS NOT NULL
              AND subscription.duration_months = 3
              AND package.name = 'essential'
        ),
        'jobs_succeeded', (SELECT count(*) FROM public.jobs WHERE status = 'succeeded'),
        'jobs_cancel_session', (SELECT count(*) FROM public.jobs WHERE kind = 'cancel_session'),
        'jobs_welcome', (SELECT count(*) FROM public.jobs WHERE kind = 'welcome'),
        'jobs_provision', (SELECT count(*) FROM public.jobs WHERE kind = 'provision'),
        'jobs_reminder', (SELECT count(*) FROM public.jobs WHERE kind = 'reminder'),
        'jobs_create_drive_folder', (SELECT count(*) FROM public.jobs WHERE kind = 'create_drive_folder'),
        'jobs_session_aggregate', (SELECT count(*) FROM public.jobs WHERE aggregate_type = 'session'),
        'jobs_subscription_aggregate', (SELECT count(*) FROM public.jobs WHERE aggregate_type = 'subscription'),
        'jobs_created_on_2026_04_17_utc', (
            SELECT count(*) FROM public.jobs
            WHERE (created_at AT TIME ZONE 'UTC')::date = DATE '2026-04-17'
        ),
        'jobs_created_range_within_3h', (
            SELECT COALESCE(EXTRACT(EPOCH FROM (max(created_at) - min(created_at))) <= 10800, FALSE)
            FROM public.jobs
        ),
        'support_tickets_closed', (SELECT count(*) FROM public.support_tickets WHERE status = 'closed'),
        'support_tickets_linked_students', (
            SELECT count(*)
            FROM public.support_tickets AS ticket
            JOIN public.profiles AS profile ON profile.id = ticket.user_id
            WHERE profile.role::text = 'student'
        ),
        'support_tickets_created_on_2026_06_11_utc', (
            SELECT count(*) FROM public.support_tickets
            WHERE (created_at AT TIME ZONE 'UTC')::date = DATE '2026-06-11'
        )
    ) AS value
), legacy_jobs_posture AS (
    SELECT jsonb_build_object(
        'shape_sha256', (
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
            FROM shape
        ),
        'outbound_foreign_keys', (
            SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.jobs'::regclass AND contype = 'f'
        ),
        'inbound_references', (
            SELECT count(*) FROM pg_constraint
            WHERE confrelid = 'public.jobs'::regclass AND contype = 'f'
        ),
        'constraint_names', COALESCE((
            SELECT jsonb_agg(conname ORDER BY conname)
            FROM pg_constraint WHERE conrelid = 'public.jobs'::regclass
        ), '[]'::jsonb),
        'index_names', COALESCE((
            SELECT jsonb_agg(indexname ORDER BY indexname)
            FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'jobs'
        ), '[]'::jsonb),
        'policy_count', (
            SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'jobs'
        ),
        'user_trigger_count', (
            SELECT count(*) FROM pg_trigger
            WHERE tgrelid = 'public.jobs'::regclass AND NOT tgisinternal
        ),
        'status_constraint_valid', EXISTS (
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
        )
    ) AS value
), support_tickets_posture AS (
    SELECT jsonb_build_object(
        'outbound_foreign_keys', (
            SELECT count(*) FROM pg_constraint
            WHERE conrelid = 'public.support_tickets'::regclass AND contype = 'f'
        )
    ) AS value
), schema_posture AS (
    SELECT jsonb_build_object(
        'package_prices_absent', to_regclass('public.package_prices') IS NULL,
        'checkout_intents_absent', to_regclass('public.checkout_intents') IS NULL,
        'email_recipient_budget_usage_absent', to_regclass('public.email_recipient_budget_usage') IS NULL,
        'fulfillment_effects_absent', to_regclass('public.fulfillment_effects') IS NULL,
        'staging_smoke_runs_absent', to_regclass('public.staging_integration_smoke_runs') IS NULL,
        'staging_smoke_leases_absent', to_regclass('public.staging_integration_smoke_leases') IS NULL,
        'package_price_id_column_absent', NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'subscriptions'
              AND column_name = 'package_price_id'
        ),
        'unexpected_public_tables', COALESCE((
            SELECT jsonb_agg(tablename ORDER BY tablename)
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
              )
        ), '[]'::jsonb)
    ) AS value
), computed AS (
    SELECT
        counts.value AS counts,
        distributions.value AS distributions,
        schema_posture.value AS schema_posture,
        legacy_jobs_posture.value AS legacy_jobs_posture,
        support_tickets_posture.value AS support_tickets_posture,
        canonical_packages.canonical_count,
        canonical_packages.stripe_reference_non_null_fields,
        encode(
            extensions.digest(
                convert_to(canonical_packages.canonical_json::text, 'UTF8'),
                'sha256'
            ),
            'hex'
        ) AS canonical_package_sha256,
        encode(
            extensions.digest(
                convert_to(canonical_packages.stripe_reference_json::text, 'UTF8'),
                'sha256'
            ),
            'hex'
        ) AS package_stripe_reference_sha256
    FROM counts, distributions, schema_posture, canonical_packages, legacy_jobs_posture, support_tickets_posture
)
SELECT 'FIXTURE_CLEANUP_PREVIEW|' || jsonb_build_object(
    'schemaVersion', 2,
    'mode', 'read_only',
    'targetProjectRef', 'vkkahxsybhbutszerawz',
    'aggregateSnapshotSha256', 'dbd25299db5562a01a65ad3d2d64689fc0871d9a64d5d3378e074c06e20cf5ab',
    'approvalScopeSha256', '12054149aa95adb338665bb6b6e20f2c875fc1c05f0693e71d41a9685743f510',
    'counts', computed.counts,
    'distributions', computed.distributions,
    'schemaPosture', computed.schema_posture,
    'legacyJobsPosture', computed.legacy_jobs_posture,
    'supportTicketsPosture', computed.support_tickets_posture,
    'canonicalPackageCount', computed.canonical_count,
    'canonicalPackageSha256', computed.canonical_package_sha256,
    'packageStripeReferenceSha256', computed.package_stripe_reference_sha256,
    'packageStripeReferenceNonNullFields', computed.stripe_reference_non_null_fields,
    'authDeletion', 'blocked_separate_step',
    'baselineMatches', (
        computed.counts = jsonb_build_object(
            'auth_users', 138,
            'profiles', 138,
            'profiles_private', 138,
            'packages', 5,
            'essential_packages', 1,
            'inactive_essential_packages', 1,
            'subscriptions', 84,
            'student_teachers', 127,
            'sessions', 700,
            'payments', 108,
            'leads', 0,
            'processed_webhook_events', 184,
            'fulfillment_jobs', 0,
            'jobs', 111,
            'support_tickets', 2,
            'admin_audit_log', 3,
            'teacher_availability', 5
        )
        AND computed.distributions = jsonb_build_object(
            'profiles_admin', 1,
            'profiles_student', 136,
            'profiles_teacher', 1,
            'subscriptions_active', 58,
            'subscriptions_cancelled', 26,
            'sessions_no_show', 13,
            'sessions_cancelled', 653,
            'sessions_completed', 16,
            'sessions_scheduled', 18,
            'payments_failed', 26,
            'payments_succeeded', 82,
            'stripe_linked_subscriptions', 27,
            'active_standard_6m_stripe_linked', 1,
            'cancelled_essential_3m_stripe_linked', 26,
            'jobs_succeeded', 111,
            'jobs_cancel_session', 20,
            'jobs_welcome', 22,
            'jobs_provision', 42,
            'jobs_reminder', 5,
            'jobs_create_drive_folder', 22,
            'jobs_session_aggregate', 67,
            'jobs_subscription_aggregate', 44,
            'jobs_created_on_2026_04_17_utc', 111,
            'jobs_created_range_within_3h', TRUE,
            'support_tickets_closed', 2,
            'support_tickets_linked_students', 2,
            'support_tickets_created_on_2026_06_11_utc', 2
        )
        AND computed.schema_posture = jsonb_build_object(
            'package_prices_absent', TRUE,
            'checkout_intents_absent', TRUE,
            'email_recipient_budget_usage_absent', TRUE,
            'fulfillment_effects_absent', TRUE,
            'staging_smoke_runs_absent', TRUE,
            'staging_smoke_leases_absent', TRUE,
            'package_price_id_column_absent', TRUE,
            'unexpected_public_tables', '[]'::jsonb
        )
        AND computed.legacy_jobs_posture = jsonb_build_object(
            'shape_sha256', 'b707ddc341370795c975b8eddff2ae1394afed9f121ab116306fea2db3e1b1ec',
            'outbound_foreign_keys', 0,
            'inbound_references', 0,
            'constraint_names', jsonb_build_array('jobs_pkey', 'jobs_status_check'),
            'index_names', jsonb_build_array(
                'jobs_aggregate_idx',
                'jobs_dedupe_key_unique',
                'jobs_kind_status_idx',
                'jobs_pkey',
                'jobs_status_run_after_idx'
            ),
            'policy_count', 0,
            'user_trigger_count', 0,
            'status_constraint_valid', TRUE
        )
        AND computed.support_tickets_posture = jsonb_build_object('outbound_foreign_keys', 1)
        AND computed.canonical_count = 4
        AND computed.canonical_package_sha256 = '6d17a17ca7bd8a99c2f0ba17522780546b473e49c386cee83d1da9acf08da38e'
        AND computed.stripe_reference_non_null_fields = 16
    )
)::text
FROM computed;

COMMIT;
