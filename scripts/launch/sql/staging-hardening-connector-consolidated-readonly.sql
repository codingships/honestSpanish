-- Execute only through the authenticated Supabase connector against staging
-- mzjyvmlxfpzdfdjzxxyj. The single final resultset supplies the remote half of
-- SUPABASE_CONNECTOR_CONSOLIDATED_STAGING_HARDENING_V1 evidence. It never
-- returns migration SQL, row identifiers, emails, credentials or secrets.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

WITH expected(version, name, source_sha256, expected_stored_sha256, canonical_sha256) AS (
    VALUES
        ('20260712112000', 'reconcile_database_model_contract', '84b12589850221c71b0f6ac1d9210e1a4c180836c274b6078ab638eca6b343aa', '96a236d4b329375f68059929cdb347f98c8dc571a9f6172e38b68f2c8a08383a', 'a1c3f818fbf4492c4febf19fe01d2f9363acf4bff555519451e29eb29bf3af78'),
        ('20260712114000', 'harden_teacher_availability_overlap', '03c48790abf657571b43c2170a58f148d6d15e130a93f4de9be3be6a40aaaea3', 'e673b779a45868db3806e10f47cf474f6a5cd0b9b9646fa78fbf5b7a66985bab', '993d80620e4e30e09c91d2b4a63e32b910369eda957a250ae0c0138d50f42c11'),
        ('20260712114500', 'require_current_adult_policy_on_signup', '5f01e7e0a2854174cab59002bea4ee01987782846f8a2266bd2dba5c897b7cfb', 'bdbc091149217495ea551347d82d505fb02b5520b83d4f52bc2721f50e6404a7', '78653ac55aa4211d90c0abf4295c04b089ded31fa6aa034e7be5c49bf3aa9c01'),
        ('20260712115000', 'harden_data_api_table_grants', '88e26ddd4eed1ba337ab1902fa707de38619f76158b9a46fcbd1b9adf00707b4', 'f306e5ed4de2f44f3cb3dc6ada125f79f0f1b8fad3d4a4ae7e54cf0e65f326ce', '5fa2fb1c0f8e27b3e691b108086e66c5e0dbc15f05c951414ba2d8ce569b70c2'),
        ('20260712195500', 'harden_sessions_status_contract', '5106b1f3081f91246682ff9dc02ed1904eac4fc8dae065bfc05ac3136d5d65b1', '5106b1f3081f91246682ff9dc02ed1904eac4fc8dae065bfc05ac3136d5d65b1', '2ad999b40e02f09ff89ea1ae1796381c42ae6668da74f095857a8ad9dd8fe251')
), observed AS (
    SELECT
        expected.version,
        expected.name,
        expected.source_sha256,
        expected.expected_stored_sha256,
        expected.canonical_sha256,
        count(history.version)::integer AS history_row_count,
        max(cardinality(history.statements))::integer AS statement_count,
        max(encode(extensions.digest(convert_to(history.statements[1], 'UTF8'), 'sha256'), 'hex')) AS stored_statement_sha256,
        max(encode(extensions.digest(
            convert_to(btrim(replace(history.statements[1], E'\r\n', E'\n'), E' \t\r\n'), 'UTF8'),
            'sha256'
        ), 'hex')) AS stored_canonical_sha256
    FROM expected
    LEFT JOIN supabase_migrations.schema_migrations history
      ON history.version = expected.version
     AND history.name = expected.name
    GROUP BY expected.version, expected.name, expected.source_sha256,
        expected.expected_stored_sha256, expected.canonical_sha256
), migration_lines AS (
    SELECT
        '1-' || version AS sort_key,
        concat_ws('|',
            'migration', version, name, source_sha256, stored_statement_sha256,
            canonical_sha256, stored_canonical_sha256, statement_count::text,
            history_row_count::text,
            (stored_statement_sha256 = expected_stored_sha256)::text,
            (stored_canonical_sha256 = canonical_sha256)::text
        ) AS line
    FROM observed
), session_constraint AS (
    SELECT constraint_row.oid, constraint_row.conname, constraint_row.convalidated
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = 'public.sessions'::regclass
      AND constraint_row.conname = 'sessions_status_check'
), session_values AS (
    SELECT
        constraint_row.oid,
        string_agg(matches.value[1], ',' ORDER BY matches.value[1]) AS allowed_values
    FROM session_constraint constraint_row
    CROSS JOIN LATERAL regexp_matches(
        pg_get_constraintdef(constraint_row.oid),
        '''([^'']+)''',
        'g'
    ) AS matches(value)
    GROUP BY constraint_row.oid
), sessions_line AS (
    SELECT
        '2-sessions' AS sort_key,
        concat_ws('|',
            'sessions_status',
            column_row.data_type,
            (column_row.is_nullable = 'NO')::text,
            CASE WHEN column_row.column_default = '''scheduled''::text' THEN 'scheduled' ELSE coalesce(column_row.column_default, '<null>') END,
            constraint_row.conname,
            constraint_row.convalidated::text,
            coalesce(session_values.allowed_values, ''),
            (
                SELECT count(*)::text
                FROM public.sessions
                WHERE status IS NULL OR status NOT IN ('scheduled', 'completed', 'cancelled', 'no_show')
            )
        ) AS line
    FROM information_schema.columns column_row
    JOIN session_constraint constraint_row ON TRUE
    LEFT JOIN session_values ON session_values.oid = constraint_row.oid
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'sessions'
      AND column_row.column_name = 'status'
), expected_grants(grantee, table_name, privilege_type) AS (
    VALUES ('anon', 'packages', 'SELECT')
    UNION ALL
    SELECT 'authenticated', exposed.table_name, privilege.privilege_type
    FROM (VALUES
        ('leads'), ('crm_contacts'), ('crm_opportunities'), ('crm_tasks'),
        ('crm_activities'), ('crm_consents'), ('fulfillment_jobs'), ('packages'),
        ('payments'), ('profiles'), ('profiles_private'), ('sessions'),
        ('student_teachers'), ('subscriptions'), ('teacher_availability')
    ) exposed(table_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privilege(privilege_type)
    UNION ALL
    VALUES
        ('authenticated', 'admin_audit_log', 'SELECT'),
        ('authenticated', 'processed_webhook_events', 'SELECT'),
        ('authenticated', 'support_tickets', 'INSERT')
), observed_client_grants AS (
    SELECT DISTINCT grantee, table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
), missing_grants AS (
    SELECT count(*)::integer AS count
    FROM (
        SELECT grantee, table_name, privilege_type FROM expected_grants
        EXCEPT
        SELECT grantee, table_name, privilege_type FROM observed_client_grants
    ) missing
), unexpected_grants AS (
    SELECT count(*)::integer AS count
    FROM (
        SELECT grantee, table_name, privilege_type FROM observed_client_grants
        EXCEPT
        SELECT grantee, table_name, privilege_type FROM expected_grants
    ) unexpected
), unsafe_default_grants AS (
    SELECT count(*)::integer AS count
    FROM pg_default_acl defaults
    JOIN pg_roles owner_role ON owner_role.oid = defaults.defaclrole
    LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
    CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
    WHERE owner_role.rolname = 'postgres'
      AND (defaults.defaclnamespace = 0 OR namespace.nspname = 'public')
      AND defaults.defaclobjtype = 'r'
      AND (acl.grantee = 0 OR pg_get_userbyid(acl.grantee) IN ('anon', 'authenticated'))
), posture_line AS (
    SELECT
        '3-posture' AS sort_key,
        concat_ws('|',
            'posture',
            (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public'),
            (SELECT count(*)::text
             FROM pg_class table_row
             JOIN pg_namespace namespace ON namespace.oid = table_row.relnamespace
             WHERE namespace.nspname = 'public' AND table_row.relkind IN ('r', 'p') AND NOT table_row.relrowsecurity),
            missing_grants.count::text,
            unexpected_grants.count::text,
            unsafe_default_grants.count::text,
            (missing_grants.count + unexpected_grants.count + unsafe_default_grants.count)::text,
            current_setting('transaction_read_only')
        ) AS line
    FROM missing_grants, unexpected_grants, unsafe_default_grants
), all_lines AS (
    SELECT sort_key, line FROM migration_lines
    UNION ALL
    SELECT sort_key, line FROM sessions_line
    UNION ALL
    SELECT sort_key, line FROM posture_line
)
SELECT line
FROM all_lines
ORDER BY sort_key;

COMMIT;
