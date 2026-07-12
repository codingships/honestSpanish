import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    parseSqlFacts,
    renderStagingHardeningApplySql,
    renderStagingHardeningPostVerifySql,
    renderStagingHardeningPreflightSql,
    sanitizeStagingHardeningOutput,
    STAGING_HARDENING_APPROVAL,
    STAGING_HARDENING_APPROVAL_ENV,
    STAGING_HARDENING_DB_URL_ENV,
    STAGING_HARDENING_MIGRATIONS,
    STAGING_HARDENING_TARGET,
    validateMigrationAllowlist,
    validatePostVerifyFacts,
    validatePreflightFacts,
    validateStagingDatabaseUrl,
} from '../../scripts/launch/supabase-staging-hardening-shared';

const rootDir = process.cwd();

describe('Supabase staging hardening runner', () => {
    it('pins exactly the five approved staging migration files and their SHA-256 values', () => {
        expect(STAGING_HARDENING_TARGET.projectRef).toBe('mzjyvmlxfpzdfdjzxxyj');
        expect(STAGING_HARDENING_MIGRATIONS.map((migration) => migration.file)).toEqual([
            'supabase/migrations/20260712112000_reconcile_database_model_contract.sql',
            'supabase/migrations/20260712114000_harden_teacher_availability_overlap.sql',
            'supabase/migrations/20260712114500_require_current_adult_policy_on_signup.sql',
            'supabase/migrations/20260712115000_harden_data_api_table_grants.sql',
            'supabase/migrations/20260712195500_harden_sessions_status_contract.sql',
        ]);

        for (const migration of STAGING_HARDENING_MIGRATIONS) {
            const actual = createHash('sha256')
                .update(readFileSync(path.join(rootDir, migration.file)))
                .digest('hex');
            expect(actual).toBe(migration.sha256);
        }
        expect(validateMigrationAllowlist(rootDir).valid).toBe(true);
    });

    it('accepts only an exact direct staging endpoint or project-qualified Supabase pooler user', () => {
        expect(validateStagingDatabaseUrl(
            databaseUrl('postgres', 'db.mzjyvmlxfpzdfdjzxxyj.supabase.co:5432'),
        )).toMatchObject({ valid: true });
        expect(validateStagingDatabaseUrl(
            databaseUrl('postgres.mzjyvmlxfpzdfdjzxxyj', 'aws-0-eu-central-1.pooler.supabase.com:6543'),
        )).toMatchObject({ valid: true });

        for (const rejected of [
            undefined,
            'https://db.mzjyvmlxfpzdfdjzxxyj.supabase.co/postgres',
            databaseUrl('postgres', 'db.vkkahxsybhbutszerawz.supabase.co:5432'),
            databaseUrl('postgres', 'db.mzjyvmlxfpzdfdjzxxyj.supabase.co:5432', 'other'),
            databaseUrl('postgres.wrongref', 'aws-0-eu-central-1.pooler.supabase.com:6543'),
            databaseUrl('postgres', 'db.mzjyvmlxfpzdfdjzxxyj.supabase.co:5432', 'postgres', false),
        ]) {
            expect(validateStagingDatabaseUrl(rejected).valid).toBe(false);
        }
    });

    it('renders one atomic apply file with the migrations and history inserts in fixed order', () => {
        const sql = renderStagingHardeningApplySql(rootDir);
        const positions = STAGING_HARDENING_MIGRATIONS.map((migration) => {
            const migrationPosition = sql.indexOf(migration.file);
            return {
                migration: migrationPosition,
                history: sql.indexOf(`VALUES ('${migration.version}'`, migrationPosition),
            };
        });

        expect(sql).toContain('\\set ON_ERROR_STOP on');
        expect(sql).toContain('BEGIN;');
        expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
        expect(sql.match(/INSERT INTO supabase_migrations\.schema_migrations/gu)).toHaveLength(5);
        for (const [index, position] of positions.entries()) {
            expect(position.migration).toBeGreaterThan(index === 0 ? -1 : positions[index - 1].history);
            expect(position.history).toBeGreaterThan(position.migration);
        }
        expect(sql).not.toContain('supabase db push');
        expect(sql).not.toContain('supabase migration repair');
        expect(sql).not.toContain('vkkahxsybhbutszerawz');

        const suffixSql = renderStagingHardeningApplySql(rootDir, 4);
        expect(suffixSql).toContain('Exact applied prefix: 4; exact pending suffix: 1');
        expect(suffixSql).toContain('20260712195500_harden_sessions_status_contract.sql');
        expect(suffixSql).not.toContain('20260712115000_harden_data_api_table_grants.sql');
        expect(suffixSql).toContain('v_exact_prefix_rows');
        expect(suffixSql).toContain('cardinality(history.statements) > 0');
        expect(suffixSql.match(/INSERT INTO supabase_migrations\.schema_migrations/gu)).toHaveLength(1);
    });

    it('keeps both preflight and post-verification SQL read-only', () => {
        for (const sql of [renderStagingHardeningPreflightSql(), renderStagingHardeningPostVerifySql()]) {
            const withoutComments = sql.replace(/^--.*$/gmu, '');
            expect(sql).toContain('BEGIN READ ONLY;');
            expect(withoutComments).not.toMatch(/^\s*(?:insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/imu);
            expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
        }
        expect(renderStagingHardeningPreflightSql()).toContain(
            "select 'reminder_column_boolean_or_absent', (not exists(",
        );
        expect(renderStagingHardeningPostVerifySql()).toContain(
            "select 'legacy_unique_absent', (not exists(",
        );
    });

    it('accepts an exact applied prefix and rejects unordered history or invalid session data', () => {
        const clean = preflightFacts();
        expect(validatePreflightFacts(clean)).toMatchObject({ valid: true, historyState: 'none' });

        const alreadyApplied = preflightFacts({
            migration_history_count: '5',
            migration_history_versions: '20260712112000,20260712114000,20260712114500,20260712115000,20260712195500',
            migration_history_exact_rows: '5',
        });
        expect(validatePreflightFacts(alreadyApplied)).toMatchObject({ valid: true, historyState: 'complete' });

        const validPrefix = preflightFacts({
            migration_history_count: '4',
            migration_history_versions: '20260712112000,20260712114000,20260712114500,20260712115000',
            migration_history_exact_rows: '4',
        });
        expect(validatePreflightFacts(validPrefix)).toMatchObject({
            valid: true,
            historyState: 'valid_prefix',
            appliedMigrationCount: 4,
        });

        const unordered = preflightFacts({
            migration_history_count: '1',
            migration_history_versions: '20260712114000',
        });
        expect(validatePreflightFacts(unordered)).toMatchObject({ valid: false, historyState: 'partial_or_unexpected' });

        const alteredPrefix = preflightFacts({
            migration_history_count: '4',
            migration_history_versions: '20260712112000,20260712114000,20260712114500,20260712115000',
            migration_history_exact_rows: '3',
        });
        expect(validatePreflightFacts(alteredPrefix)).toMatchObject({ valid: false, historyState: 'valid_prefix' });

        expect(validatePreflightFacts(preflightFacts({ active_overlap_count: '1' })).valid).toBe(false);
        expect(validatePreflightFacts(preflightFacts({ null_lead_required_fields_count: '1' })).valid).toBe(false);
        expect(validatePreflightFacts(preflightFacts({ unsupported_session_duration_count: '1' })).valid).toBe(false);
        expect(validatePreflightFacts(preflightFacts({ unsupported_session_status_count: '1' })).valid).toBe(false);
        expect(validatePreflightFacts(preflightFacts({ reminder_column_boolean_or_absent: 'false' })).valid).toBe(false);
        expect(validatePreflightFacts(preflightFacts({ target_constraint_valid_or_absent: 'false' })).valid).toBe(false);
    });

    it('requires the complete migration history and all schema/security effects after apply', () => {
        const clean = postVerifyFacts();
        expect(validatePostVerifyFacts(clean)).toMatchObject({ valid: true, historyState: 'complete' });

        for (const [key, value] of [
            ['migration_history_exact_rows', '1'],
            ['leads_status_contract', 'false'],
            ['leads_acl_valid', 'false'],
            ['public_is_admin_absent', 'false'],
            ['sessions_reminder_contract', 'false'],
            ['session_duration_contract', 'false'],
            ['session_status_contract', 'false'],
            ['student_teacher_profile_policy_valid', 'false'],
            ['authenticated_identity_policies_count', '12'],
            ['data_api_authenticated_grants_count', '62'],
            ['data_api_client_granted_tables_rls_count', '17'],
            ['data_api_client_granted_tables_without_rls_count', '1'],
            ['data_api_unexpected_client_grants_count', '1'],
            ['data_api_postgres_default_client_grants_count', '1'],
            ['btree_gist_schema', 'extensions'],
            ['active_overlap_count', '1'],
            ['target_constraint_valid', 'false'],
            ['teacher_availability_updated_at_trigger_valid', 'false'],
            ['required_operational_indexes_count', '14'],
            ['handle_new_user_hardened', 'false'],
            ['auth_trigger_valid', 'false'],
            ['handle_new_user_acl_valid', 'false'],
        ] as const) {
            expect(validatePostVerifyFacts(postVerifyFacts({ [key]: value })).valid).toBe(false);
        }
    });

    it('parses tab-separated facts and redacts credential-shaped output', () => {
        expect(parseSqlFacts('alpha\tone\nbeta\ttwo\nnoise').get('beta')).toBe('two');
        const unsafe = `SUPABASE_STAGING_DB_URL=${databaseUrl('postgres', 'db.example', 'postgres', true, 'very-secret')}`;
        const safe = sanitizeStagingHardeningOutput(unsafe);
        expect(safe).not.toContain('very-secret');
        expect(safe).toContain('[redacted]');
    });

    it('keeps plan as the default and places the exact approval gate before any write-capable call', () => {
        const runner = readFileSync(
            path.join(rootDir, 'scripts/launch/supabase-staging-hardening-runner.ts'),
            'utf8',
        );
        const modeDefinition = runner.indexOf("const mode: RunnerMode = executeRequested");
        const approvalGate = runner.indexOf("mode === 'execute-approved' && !approvalMatched");
        const targetGate = runner.indexOf('const targetValidation = validateStagingDatabaseUrl');
        const preflight = runner.indexOf("'preflight_readonly'", targetGate);
        const apply = runner.indexOf("'apply_exact_migrations'", preflight);
        const verify = runner.indexOf("'post_apply_readonly_verification'", apply);

        expect(modeDefinition).toBeGreaterThan(-1);
        expect(runner).toContain(": 'plan';");
        expect(approvalGate).toBeGreaterThan(modeDefinition);
        expect(targetGate).toBeGreaterThan(approvalGate);
        expect(preflight).toBeGreaterThan(targetGate);
        expect(apply).toBeGreaterThan(preflight);
        expect(verify).toBeGreaterThan(apply);
        expect(runner).toContain('STAGING_HARDENING_APPROVAL_ENV');
        expect(runner).toContain('STAGING_HARDENING_DB_URL_ENV');
        expect(STAGING_HARDENING_APPROVAL_ENV).toBe('SUPABASE_STAGING_HARDENING_APPROVAL');
        expect(STAGING_HARDENING_DB_URL_ENV).toBe('SUPABASE_STAGING_DB_URL');
        expect(STAGING_HARDENING_APPROVAL).toContain('No autorizo produccion');
    });
});

function preflightFacts(overrides: Record<string, string> = {}): Map<string, string> {
    return new Map(Object.entries({
        current_database: 'postgres',
        migration_history_columns: 'name,statements,version',
        migration_history_count: '0',
        migration_history_versions: '',
        migration_history_exact_rows: '0',
        teacher_availability_table: 'true',
        profiles_table: 'true',
        profiles_private_table: 'true',
        auth_users_table: 'true',
        leads_table: 'true',
        sessions_table: 'true',
        lead_status_type_valid_or_absent: 'true',
        reminder_column_boolean_or_absent: 'true',
        unsupported_lead_status_count: '0',
        null_lead_required_fields_count: '0',
        session_canonical_columns_count: '3',
        unsupported_session_duration_count: '0',
        unsupported_session_status_count: '0',
        public_is_admin_dependency_count: '0',
        hardening_index_target_tables_count: '8',
        btree_gist_available: 'true',
        active_overlap_count: '0',
        target_constraint_count: '0',
        target_constraint_valid_or_absent: 'true',
        legacy_unique_count: '1',
        handle_new_user_exists: 'true',
        auth_trigger_valid: 'true',
        attestation_columns_count: '3',
        ...overrides,
    }));
}

function postVerifyFacts(overrides: Record<string, string> = {}): Map<string, string> {
    return new Map(Object.entries({
        current_database: 'postgres',
        migration_history_count: '5',
        migration_history_versions: '20260712112000,20260712114000,20260712114500,20260712115000,20260712195500',
        migration_history_exact_rows: '5',
        leads_updated_at_contract: 'true',
        leads_status_contract: 'true',
        leads_defaults_contract: 'true',
        leads_acl_valid: 'true',
        public_is_admin_absent: 'true',
        legacy_session_columns_absent: 'true',
        sessions_reminder_contract: 'true',
        session_duration_contract: 'true',
        session_status_contract: 'true',
        student_teacher_profile_policy_valid: 'true',
        authenticated_identity_policies_count: '13',
        data_api_anon_grants_count: '1',
        data_api_authenticated_grants_count: '63',
        data_api_public_grants_count: '0',
        data_api_authenticated_crud_tables_count: '15',
        data_api_client_granted_tables_rls_count: '18',
        data_api_client_granted_tables_without_rls_count: '0',
        data_api_unexpected_client_grants_count: '0',
        data_api_postgres_default_client_grants_count: '0',
        btree_gist_installed: 'true',
        btree_gist_schema: 'public',
        active_overlap_count: '0',
        target_constraint_valid: 'true',
        legacy_unique_absent: 'true',
        teacher_availability_updated_at_trigger_valid: 'true',
        required_operational_indexes_count: '15',
        required_staging_smoke_indexes_count: '6',
        handle_new_user_hardened: 'true',
        auth_trigger_valid: 'true',
        handle_new_user_acl_valid: 'true',
        ...overrides,
    }));
}

function databaseUrl(
    user: string,
    host: string,
    database = 'postgres',
    withPassword = true,
    password = 'placeholder-secret',
): string {
    const credential = withPassword ? `${user}:${password}` : user;
    return ['postgresql', '://', credential, '@', host, '/', database].join('');
}
