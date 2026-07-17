-- Immutable aggregate-only evidence for the known production migration-history drift.
-- Exact target: vkkahxsybhbutszerawz. This query never returns migration SQL or private rows.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '20s';

WITH expected_history(version, name, expected_statement_count, sort_order) AS (
    VALUES
        ('009', 'jobs', 6, 1),
        ('021', 'harden_session_write_policies', 6, 2),
        ('022', 'track_stripe_webhook_processing_state', 4, 3),
        ('20260702124757', 'harden_profile_role_trigger', 9, 4),
        ('20260703192245', '021_harden_session_write_policies', 1, 5),
        ('20260703192307', '022_track_stripe_webhook_processing_state', 1, 6),
        ('20260703192329', '20260702124757_harden_profile_role_trigger', 1, 7)
), history AS (
    SELECT
        expected.sort_order,
        remote.version,
        remote.name,
        cardinality(remote.statements)::integer AS statement_count,
        ARRAY(
            SELECT encode(extensions.digest(convert_to(statement, 'UTF8'), 'sha256'), 'hex')
            FROM unnest(remote.statements) WITH ORDINALITY AS item(statement, ordinal)
            ORDER BY ordinal
        ) AS statement_sha256,
        encode(
            extensions.digest(convert_to(remote.statements::text, 'UTF8'), 'sha256'),
            'hex'
        ) AS statements_array_sha256,
        encode(
            extensions.digest(convert_to(array_to_string(remote.statements, chr(30)), 'UTF8'), 'sha256'),
            'hex'
        ) AS joined_statements_sha256,
        cardinality(remote.statements) = expected.expected_statement_count AS expected_statement_count_matches
    FROM expected_history AS expected
    JOIN supabase_migrations.schema_migrations AS remote
      ON remote.version = expected.version
     AND remote.name = expected.name
), remote_009_descriptors AS (
    SELECT
        item.ordinality::integer AS ordinal,
        encode(extensions.digest(convert_to(item.statement, 'UTF8'), 'sha256'), 'hex') AS statement_sha256,
        CASE
            WHEN normalized.value ~ '^create table' THEN 'create_table'
            WHEN normalized.value ~ '^create (unique )?index' THEN 'create_index'
            WHEN normalized.value ~ '^alter table' AND normalized.value ~ 'enable row level security' THEN 'enable_rls'
            ELSE 'other'
        END AS operation,
        CASE
            WHEN normalized.value ~ '(^|[^a-z0-9_])(public\\.)?jobs([^a-z0-9_]|$)' THEN 'public.jobs'
            ELSE 'unclassified'
        END AS object_name,
        length(item.statement)::integer AS statement_bytes
    FROM supabase_migrations.schema_migrations AS remote
    CROSS JOIN LATERAL unnest(remote.statements) WITH ORDINALITY AS item(statement, ordinality)
    CROSS JOIN LATERAL (
        SELECT lower(regexp_replace(btrim(item.statement), '\\s+', ' ', 'g')) AS value
    ) AS normalized
    WHERE remote.version = '009' AND remote.name = 'jobs'
), effect_checks(id, classification, observed, passed, sort_order) AS (
    VALUES
        ('009.remote_identity', 'absent', 'version_collision_public.jobs',
            (SELECT count(*) = 6 AND bool_and(object_name = 'public.jobs') FROM remote_009_descriptors), 1),
        ('009.packages_updated_at', 'present', 'column_present',
            EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'updated_at'
                  AND data_type = 'timestamp with time zone' AND column_default = 'now()'
            ), 2),
        ('009.packages_name_unique', 'present', 'unique_constraint_present',
            EXISTS (
                SELECT 1
                FROM pg_constraint AS constraint_row
                JOIN pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                 AND attribute.attnum = constraint_row.conkey[1]
                WHERE constraint_row.conrelid = to_regclass('public.packages')
                  AND constraint_row.conname = 'packages_name_unique'
                  AND constraint_row.contype = 'u'
                  AND cardinality(constraint_row.conkey) = 1
                  AND attribute.attname = 'name'
            ), 3),
        ('009.sessions_duration_default', 'superseded', '50',
            (SELECT column_default = '50' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'duration_minutes'), 4),
        ('009.fulfillment_jobs_table', 'present', 'table_present', to_regclass('public.fulfillment_jobs') IS NOT NULL, 5),
        ('009.fulfillment_jobs_base_columns', 'present', 'base_columns_present',
            NOT EXISTS (
                SELECT required.column_name
                FROM (VALUES
                    ('id', 'uuid', 'NO'),
                    ('job_type', 'text', 'NO'),
                    ('status', 'text', 'NO'),
                    ('session_id', 'uuid', 'YES'),
                    ('subscription_id', 'uuid', 'YES'),
                    ('student_id', 'uuid', 'YES'),
                    ('payload', 'jsonb', 'NO'),
                    ('attempts', 'integer', 'NO'),
                    ('max_attempts', 'integer', 'NO'),
                    ('run_at', 'timestamp with time zone', 'NO'),
                    ('locked_at', 'timestamp with time zone', 'YES'),
                    ('locked_by', 'text', 'YES'),
                    ('last_error', 'text', 'YES'),
                    ('created_at', 'timestamp with time zone', 'YES'),
                    ('updated_at', 'timestamp with time zone', 'YES')
                ) AS required(column_name, data_type, is_nullable)
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns AS actual
                    WHERE actual.table_schema = 'public'
                      AND actual.table_name = 'fulfillment_jobs'
                      AND actual.column_name = required.column_name
                      AND actual.data_type = required.data_type
                      AND actual.is_nullable = required.is_nullable
                )
            )
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fulfillment_jobs' AND column_name='id' AND column_default='gen_random_uuid()')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fulfillment_jobs' AND column_name='status' AND column_default='''pending''::text')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fulfillment_jobs' AND column_name='payload' AND column_default='''{}''::jsonb')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fulfillment_jobs' AND column_name='attempts' AND column_default='0')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fulfillment_jobs' AND column_name='max_attempts' AND column_default='5')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='fulfillment_jobs' AND column_name='run_at' AND column_default='now()'), 6),
        ('009.fulfillment_jobs_constraints', 'superseded', 'base_constraints_present_and_job_type_extended',
            EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'p' AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE%')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE%')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE%')
            AND EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%job_type%session_fulfillment%bulk_session_fulfillment%welcome_fulfillment%'
            )
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%pending%processing%succeeded%failed%cancelled%')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%attempts >= 0%')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.fulfillment_jobs') AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%max_attempts > 0%'), 7),
        ('009.fulfillment_jobs_indexes', 'present', 'required_indexes_present',
            EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'fulfillment_jobs' AND indexname = 'idx_fulfillment_jobs_due' AND indexdef LIKE '%(status, run_at)%' AND indexdef LIKE '%WHERE%status%pending%failed%')
            AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'fulfillment_jobs' AND indexname = 'idx_fulfillment_jobs_session' AND indexdef LIKE '%(session_id)%' AND indexdef LIKE '%WHERE (session_id IS NOT NULL)%'), 8),
        ('009.fulfillment_jobs_rls', 'present', 'rls_enabled',
            COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.fulfillment_jobs')), false), 9),
        ('009.admin_audit_log_table', 'present', 'table_present', to_regclass('public.admin_audit_log') IS NOT NULL, 10),
        ('009.admin_audit_log_columns', 'present', 'base_columns_present',
            NOT EXISTS (
                SELECT required.column_name
                FROM (VALUES
                    ('id', 'uuid', 'NO'),
                    ('admin_id', 'uuid', 'YES'),
                    ('action', 'text', 'NO'),
                    ('entity_type', 'text', 'NO'),
                    ('entity_id', 'text', 'YES'),
                    ('before', 'jsonb', 'YES'),
                    ('after', 'jsonb', 'YES'),
                    ('created_at', 'timestamp with time zone', 'YES')
                ) AS required(column_name, data_type, is_nullable)
                WHERE NOT EXISTS (
                    SELECT 1 FROM information_schema.columns AS actual
                    WHERE actual.table_schema = 'public'
                      AND actual.table_name = 'admin_audit_log'
                      AND actual.column_name = required.column_name
                      AND actual.data_type = required.data_type
                      AND actual.is_nullable = required.is_nullable
                )
            )
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_log' AND column_name='id' AND column_default='gen_random_uuid()')
            AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_log' AND column_name='created_at' AND column_default='now()')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.admin_audit_log') AND contype='f' AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (admin_id) REFERENCES profiles(id) ON DELETE SET NULL%'), 11),
        ('009.admin_audit_log_indexes', 'present', 'required_indexes_present',
            EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'admin_audit_log' AND indexname = 'idx_admin_audit_log_admin' AND indexdef LIKE '%(admin_id)%')
            AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'admin_audit_log' AND indexname = 'idx_admin_audit_log_entity' AND indexdef LIKE '%(entity_type, entity_id)%'), 12),
        ('009.admin_audit_log_rls', 'present', 'rls_enabled',
            COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.admin_audit_log')), false), 13),
        ('009.processed_webhook_events_rls', 'present', 'rls_enabled',
            COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.processed_webhook_events')), false), 14),
        ('009.admin_policies', 'superseded', 'authenticated_private_is_admin',
            (SELECT count(*) = 3
                    AND bool_and(roles = ARRAY['authenticated']::name[])
                    AND bool_and(permissive = 'PERMISSIVE')
                    AND bool_and((coalesce(qual, '') || coalesce(with_check, '')) LIKE '%private.is_admin%')
                    AND bool_and(CASE WHEN policyname = 'Admins can manage fulfillment jobs' THEN cmd = 'ALL' AND with_check IS NOT NULL ELSE cmd = 'SELECT' END)
             FROM pg_policies
             WHERE schemaname = 'public'
               AND (tablename, policyname) IN (
                   ('processed_webhook_events', 'Admins can view processed webhook events'),
                   ('fulfillment_jobs', 'Admins can manage fulfillment jobs'),
                   ('admin_audit_log', 'Admins can view audit log')
               )), 15),
        ('009.update_triggers', 'present', 'both_triggers_present',
            EXISTS (
                SELECT 1 FROM pg_trigger
                WHERE tgrelid = to_regclass('public.packages') AND tgname = 'update_packages_updated_at'
                  AND NOT tgisinternal AND tgenabled <> 'D' AND tgfoid = to_regprocedure('public.update_updated_at()')
                  AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 16) = 16
            )
            AND EXISTS (
                SELECT 1 FROM pg_trigger
                WHERE tgrelid = to_regclass('public.fulfillment_jobs') AND tgname = 'update_fulfillment_jobs_updated_at'
                  AND NOT tgisinternal AND tgenabled <> 'D' AND tgfoid = to_regprocedure('public.update_updated_at()')
                  AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 16) = 16
            ), 16),
        ('009.package_seed_keys', 'superseded', 'four_catalog_keys_present_runtime_values_authoritative',
            (SELECT count(*) = 4 FROM public.packages WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp')), 17),
        ('009.is_admin_function', 'superseded', 'private_helper_active_public_execute_closed',
            to_regprocedure('private.is_admin()') IS NOT NULL
            AND NOT has_function_privilege('anon', 'public.is_admin()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'), 18),
        ('021.forbidden_write_policies', 'present', 'absent_as_required',
            (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname IN ('Students can cancel own sessions', 'Teachers can create assigned sessions', 'Teachers can update assigned sessions', 'Teachers can view and update assigned sessions')), 19),
        ('021.teacher_select_policy', 'superseded', 'legacy_select_present_pending_authenticated_reconciliation',
            EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname = 'Teachers can view assigned sessions' AND cmd = 'SELECT'), 20),
        ('022.processing_columns', 'present', 'four_columns_present',
            (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processed_webhook_events' AND column_name IN ('created_at', 'processing_status', 'processing_error', 'processed_at')), 21),
        ('022.processing_status_contract', 'present', 'not_null_default_processing_check_present',
            EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processed_webhook_events' AND column_name = 'processing_status' AND is_nullable = 'NO' AND column_default = '''processing''::text')
            AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.processed_webhook_events') AND conname = 'processed_webhook_events_processing_status_check' AND pg_get_constraintdef(oid) LIKE '%processing%' AND pg_get_constraintdef(oid) LIKE '%succeeded%' AND pg_get_constraintdef(oid) LIKE '%failed%'), 22),
        ('022.processing_status_rows', 'present', 'zero_invalid_or_null',
            (SELECT count(*) = 0 FROM public.processed_webhook_events WHERE processing_status IS NULL OR processing_status NOT IN ('processing', 'succeeded', 'failed')), 23),
        ('022.timestamp_backfill', 'present', 'zero_null_created_or_processed',
            (SELECT count(*) = 0 FROM public.processed_webhook_events WHERE created_at IS NULL OR processed_at IS NULL), 24),
        ('022.processed_at_default', 'superseded', 'now_pending_exact_followup',
            (SELECT column_default = 'now()' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'processed_webhook_events' AND column_name = 'processed_at'), 25),
        ('20260702124757.public_function_removed', 'present', 'public_function_absent', to_regprocedure('public.protect_profile_role()') IS NULL, 26),
        ('20260702124757.private_function_contract', 'present', 'security_definer_search_path_and_acl',
            EXISTS (
                SELECT 1
                FROM pg_proc AS proc
                WHERE proc.oid = to_regprocedure('private.protect_profile_role()')
                  AND proc.prosecdef
                  AND proc.proconfig = ARRAY['search_path=public, private, pg_temp']::text[]
            )
            AND NOT has_function_privilege('anon', 'private.protect_profile_role()', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'private.protect_profile_role()', 'EXECUTE')
            AND has_function_privilege('service_role', 'private.protect_profile_role()', 'EXECUTE'), 27),
        ('20260702124757.private_function_body', 'present', '709647dfdca8c9d44aaec18bdca57ead1595edce2cab1529334afb51b33c5c43',
            (SELECT encode(extensions.digest(convert_to(pg_get_functiondef(oid), 'UTF8'), 'sha256'), 'hex') = '709647dfdca8c9d44aaec18bdca57ead1595edce2cab1529334afb51b33c5c43' FROM pg_proc WHERE oid = to_regprocedure('private.protect_profile_role()')), 28),
        ('20260702124757.trigger', 'present', 'before_update_trigger_present',
            EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.profiles') AND tgname = 'protect_profile_role_trigger' AND NOT tgisinternal AND tgfoid = to_regprocedure('private.protect_profile_role()')), 29)
), snapshot AS (
    SELECT jsonb_build_object(
        'schemaVersion', 1,
        'capturedAt', clock_timestamp(),
        'provenance', CASE
            WHEN current_setting('espanol_honesto.history_reconciliation_provenance', true) = 'capture_psql_readonly'
                THEN 'supabase_history_capture_psql_readonly'
            WHEN current_setting('espanol_honesto.history_reconciliation_provenance', true) = 'production_rollout_psql_readonly'
                THEN 'production_rollout_psql_readonly'
            ELSE 'supabase_connector_execute_sql'
        END,
        'target', jsonb_build_object(
            'environment', 'production',
            'name', 'espanolhonesto',
            'ref', 'vkkahxsybhbutszerawz',
            'database', current_database()
        ),
        'safety', jsonb_build_object(
            'transactionReadOnly', current_setting('transaction_read_only') = 'on',
            'rawStatementsPersisted', false,
            'rawStatementsReturned', false,
            'privateRowsSelected', false,
            'externalWritePerformed', false
        ),
        'historyRows', (SELECT jsonb_agg(jsonb_build_object(
            'version', version,
            'name', name,
            'statementCount', statement_count,
            'statementSha256', statement_sha256,
            'statementsArraySha256', statements_array_sha256,
            'joinedStatementsSha256', joined_statements_sha256,
            'expectedStatementCountMatches', expected_statement_count_matches
        ) ORDER BY sort_order) FROM history),
        'remote009Descriptors', (SELECT jsonb_agg(to_jsonb(remote_009_descriptors) ORDER BY ordinal) FROM remote_009_descriptors),
        'effectChecks', (SELECT jsonb_agg(jsonb_build_object(
            'id', id,
            'classification', classification,
            'observed', observed,
            'passed', passed
        ) ORDER BY sort_order) FROM effect_checks)
    ) AS value
)
SELECT value AS supabase_production_history_reconciliation_snapshot FROM snapshot;

COMMIT;
