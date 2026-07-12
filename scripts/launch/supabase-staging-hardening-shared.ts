import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const STAGING_HARDENING_TARGET = {
    environment: 'staging' as const,
    name: 'espanol-staging',
    projectRef: 'mzjyvmlxfpzdfdjzxxyj',
    databaseName: 'postgres',
};

export const STAGING_HARDENING_DB_URL_ENV = 'SUPABASE_STAGING_DB_URL';
export const STAGING_HARDENING_APPROVAL_ENV = 'SUPABASE_STAGING_HARDENING_APPROVAL';
export const STAGING_HARDENING_APPROVAL = 'Autorizo aplicar exclusivamente las migraciones `20260712114000_harden_teacher_availability_overlap.sql` y `20260712114500_require_current_adult_policy_on_signup.sql`, con sus hashes fijados por el runner, al proyecto Supabase staging `mzjyvmlxfpzdfdjzxxyj`; ejecutar primero el preflight de solo lectura, aplicarlas y registrarlas juntas en una transaccion, y verificar despues constraint, trigger, funcion, permisos e historial. No autorizo produccion ni ningun otro cambio o servicio externo.';

export interface StagingHardeningMigration {
    version: string;
    name: string;
    file: string;
    sha256: string;
}

export const STAGING_HARDENING_MIGRATIONS: readonly StagingHardeningMigration[] = [
    {
        version: '20260712114000',
        name: 'harden_teacher_availability_overlap',
        file: 'supabase/migrations/20260712114000_harden_teacher_availability_overlap.sql',
        sha256: '16f695b6377281f3dd5105802c7c9991cf213746acc5a881efe78626aa9bc00a',
    },
    {
        version: '20260712114500',
        name: 'require_current_adult_policy_on_signup',
        file: 'supabase/migrations/20260712114500_require_current_adult_policy_on_signup.sql',
        sha256: '5f01e7e0a2854174cab59002bea4ee01987782846f8a2266bd2dba5c897b7cfb',
    },
];

export interface MigrationValidation {
    valid: boolean;
    details: string[];
}

export interface DatabaseTargetValidation {
    valid: boolean;
    reason: string;
    connectionEnv: NodeJS.ProcessEnv | null;
}

export interface FactValidation {
    valid: boolean;
    details: string[];
    historyState?: 'none' | 'complete' | 'partial_or_unexpected';
}

export type SqlFacts = Map<string, string>;

export function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

export function validateMigrationAllowlist(rootDir = process.cwd()): MigrationValidation {
    const details: string[] = [];

    for (const migration of STAGING_HARDENING_MIGRATIONS) {
        const resolvedRoot = path.resolve(rootDir);
        const resolvedFile = path.resolve(rootDir, migration.file);
        if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
            details.push(`${migration.file}: outside repository root`);
            continue;
        }

        let source: Buffer;
        try {
            source = readFileSync(resolvedFile);
        } catch {
            details.push(`${migration.file}: missing or unreadable`);
            continue;
        }

        const observed = sha256(source);
        if (observed !== migration.sha256) {
            details.push(`${migration.file}: sha256 mismatch (expected ${migration.sha256}, observed ${observed})`);
        } else {
            details.push(`${migration.file}: sha256=${observed}`);
        }
    }

    return {
        valid: details.length === STAGING_HARDENING_MIGRATIONS.length
            && details.every((detail) => detail.includes('sha256=') && !detail.includes('mismatch')),
        details,
    };
}

export function validateStagingDatabaseUrl(rawValue: string | undefined): DatabaseTargetValidation {
    if (!rawValue) {
        return { valid: false, reason: `${STAGING_HARDENING_DB_URL_ENV} is missing`, connectionEnv: null };
    }

    try {
        const parsed = new URL(rawValue);
        if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
            return { valid: false, reason: 'database URL protocol is not PostgreSQL', connectionEnv: null };
        }

        const hostname = parsed.hostname.toLowerCase();
        const username = decodeURIComponent(parsed.username);
        const directHost = `db.${STAGING_HARDENING_TARGET.projectRef}.supabase.co`;
        const isExactDirect = hostname === directHost && username === 'postgres';
        const isExactPooler = hostname.endsWith('.pooler.supabase.com')
            && username === `postgres.${STAGING_HARDENING_TARGET.projectRef}`;
        if (!isExactDirect && !isExactPooler) {
            return {
                valid: false,
                reason: `database URL does not identify allowlisted staging ref ${STAGING_HARDENING_TARGET.projectRef}`,
                connectionEnv: null,
            };
        }

        const database = parsed.pathname.replace(/^\//u, '');
        if (database !== STAGING_HARDENING_TARGET.databaseName) {
            return { valid: false, reason: 'database name must be postgres', connectionEnv: null };
        }
        if (!parsed.password) {
            return { valid: false, reason: 'database URL has no password credential', connectionEnv: null };
        }

        const connectionEnv: NodeJS.ProcessEnv = {
            PGHOST: parsed.hostname,
            PGUSER: username,
            PGPASSWORD: decodeURIComponent(parsed.password),
            PGDATABASE: database,
        };
        if (parsed.port) connectionEnv.PGPORT = parsed.port;

        return { valid: true, reason: 'exact staging database endpoint', connectionEnv };
    } catch {
        return { valid: false, reason: 'database URL is invalid', connectionEnv: null };
    }
}

export function renderStagingHardeningPreflightSql(): string {
    const versions = STAGING_HARDENING_MIGRATIONS.map((migration) => `'${migration.version}'`).join(', ');
    return `${[
        '-- Espanol Honesto staging hardening: read-only preflight.',
        '-- Target ref is validated from the credential endpoint before psql is started.',
        'BEGIN READ ONLY;',
        `select 'current_database', current_database();`,
        `select 'migration_history_columns', coalesce(string_agg(column_name, ',' order by column_name), '')`,
        'from information_schema.columns',
        "where table_schema = 'supabase_migrations' and table_name = 'schema_migrations';",
        `select 'migration_history_count', count(*)::text`,
        'from supabase_migrations.schema_migrations',
        `where version in (${versions});`,
        `select 'migration_history_versions', coalesce(string_agg(version, ',' order by version), '')`,
        'from supabase_migrations.schema_migrations',
        `where version in (${versions});`,
        `select 'teacher_availability_table', (to_regclass('public.teacher_availability') is not null)::text;`,
        `select 'profiles_table', (to_regclass('public.profiles') is not null)::text;`,
        `select 'profiles_private_table', (to_regclass('public.profiles_private') is not null)::text;`,
        `select 'auth_users_table', (to_regclass('auth.users') is not null)::text;`,
        `select 'btree_gist_available', exists(select 1 from pg_available_extensions where name = 'btree_gist')::text;`,
        `select 'active_overlap_count', count(*)::text`,
        'from public.teacher_availability first_slot',
        'join public.teacher_availability second_slot',
        '  on first_slot.teacher_id = second_slot.teacher_id',
        ' and first_slot.day_of_week = second_slot.day_of_week',
        ' and first_slot.id < second_slot.id',
        ' and first_slot.start_time < second_slot.end_time',
        ' and second_slot.start_time < first_slot.end_time',
        'where first_slot.is_active = true and second_slot.is_active = true;',
        `select 'target_constraint_count', count(*)::text`,
        'from pg_constraint',
        `where conrelid = 'public.teacher_availability'::regclass`,
        `  and conname = 'teacher_availability_no_active_overlap';`,
        `select 'target_constraint_valid_or_absent', coalesce(bool_and(contype = 'x'`,
        `    and pg_get_constraintdef(oid) ilike '%exclude using gist%'`,
        `    and pg_get_constraintdef(oid) ilike '%teacher_id with =%'`,
        `    and pg_get_constraintdef(oid) ilike '%day_of_week with =%'`,
        `    and pg_get_constraintdef(oid) ilike '%numrange%'`,
        `    and pg_get_constraintdef(oid) ilike '%is_active%'), true)::text`,
        'from pg_constraint',
        `where conrelid = 'public.teacher_availability'::regclass`,
        `  and conname = 'teacher_availability_no_active_overlap';`,
        `select 'legacy_unique_count', count(*)::text`,
        'from pg_constraint',
        `where conrelid = 'public.teacher_availability'::regclass`,
        `  and conname = 'teacher_availability_teacher_id_day_of_week_start_time_key';`,
        `select 'handle_new_user_exists', (to_regprocedure('public.handle_new_user()') is not null)::text;`,
        `select 'auth_trigger_valid', exists(`,
        '    select 1 from pg_trigger trigger_row',
        '    join pg_proc function_row on function_row.oid = trigger_row.tgfoid',
        `    where trigger_row.tgname = 'on_auth_user_created'`,
        `      and trigger_row.tgrelid = 'auth.users'::regclass`,
        `      and function_row.oid = to_regprocedure('public.handle_new_user()')`,
        '      and not trigger_row.tgisinternal',
        '      and (trigger_row.tgtype & 1) = 1',
        '      and (trigger_row.tgtype & 4) = 4',
        '      and (trigger_row.tgtype & 66) = 0',
        ')::text;',
        `select 'attestation_columns_count', count(*)::text`,
        'from information_schema.columns',
        "where table_schema = 'public' and table_name = 'profiles'",
        "  and column_name in ('adult_confirmed', 'adult_confirmed_at', 'age_policy_version');",
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderStagingHardeningApplySql(rootDir = process.cwd()): string {
    const migrationSources = STAGING_HARDENING_MIGRATIONS.map((migration) => ({
        ...migration,
        source: readFileSync(path.resolve(rootDir, migration.file), 'utf8').trim(),
    }));
    const versions = migrationSources.map((migration) => `'${migration.version}'`).join(', ');
    const lines = [
        '-- Write-capable artifact. It does not authorize itself.',
        `-- Exact target: Supabase staging ${STAGING_HARDENING_TARGET.projectRef}.`,
        '-- The runner executes this only after its exact approval and read-only preflight pass.',
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL lock_timeout = '5s';",
        'DO $staging_hardening_history_gate$',
        'DECLARE',
        '    v_existing_count INTEGER;',
        'BEGIN',
        '    SELECT count(*) INTO v_existing_count',
        '    FROM supabase_migrations.schema_migrations',
        `    WHERE version IN (${versions});`,
        '    IF v_existing_count <> 0 THEN',
        "        RAISE EXCEPTION 'Staging hardening migration history changed after preflight; expected zero target versions';",
        '    END IF;',
        'END',
        '$staging_hardening_history_gate$;',
        '',
    ];

    for (const migration of migrationSources) {
        const sqlTag = `$staging_hardening_${migration.version}$`;
        lines.push(
            `-- ${migration.file}`,
            `-- sha256: ${migration.sha256}`,
            migration.source,
            '',
            'INSERT INTO supabase_migrations.schema_migrations (version, statements, name)',
            `VALUES ('${migration.version}', ARRAY[${sqlTag}${migration.source}${sqlTag}]::text[], '${migration.name}');`,
            '',
        );
    }

    lines.push('COMMIT;', '');
    return `${lines.join('\n')}\n`;
}

export function renderStagingHardeningPostVerifySql(): string {
    const versions = STAGING_HARDENING_MIGRATIONS.map((migration) => `'${migration.version}'`).join(', ');
    const expectedHistoryRows = STAGING_HARDENING_MIGRATIONS
        .map((migration) => `('${migration.version}', '${migration.name}')`)
        .join(', ');
    return `${[
        '-- Espanol Honesto staging hardening: read-only post-apply verification.',
        'BEGIN READ ONLY;',
        `select 'current_database', current_database();`,
        `select 'migration_history_count', count(*)::text`,
        'from supabase_migrations.schema_migrations',
        `where version in (${versions});`,
        `select 'migration_history_versions', coalesce(string_agg(version, ',' order by version), '')`,
        'from supabase_migrations.schema_migrations',
        `where version in (${versions});`,
        `select 'migration_history_exact_rows', count(*)::text`,
        'from supabase_migrations.schema_migrations history',
        `join (values ${expectedHistoryRows}) expected(version, name)`,
        '  on history.version = expected.version and history.name = expected.name',
        'where cardinality(history.statements) > 0;',
        `select 'btree_gist_installed', exists(select 1 from pg_extension where extname = 'btree_gist')::text;`,
        `select 'active_overlap_count', count(*)::text`,
        'from public.teacher_availability first_slot',
        'join public.teacher_availability second_slot',
        '  on first_slot.teacher_id = second_slot.teacher_id',
        ' and first_slot.day_of_week = second_slot.day_of_week',
        ' and first_slot.id < second_slot.id',
        ' and first_slot.start_time < second_slot.end_time',
        ' and second_slot.start_time < first_slot.end_time',
        'where first_slot.is_active = true and second_slot.is_active = true;',
        `select 'target_constraint_valid', exists(`,
        '    select 1 from pg_constraint',
        `    where conrelid = 'public.teacher_availability'::regclass`,
        `      and conname = 'teacher_availability_no_active_overlap'`,
        `      and contype = 'x'`,
        `      and pg_get_constraintdef(oid) ilike '%exclude using gist%'`,
        `      and pg_get_constraintdef(oid) ilike '%teacher_id with =%'`,
        `      and pg_get_constraintdef(oid) ilike '%day_of_week with =%'`,
        `      and pg_get_constraintdef(oid) ilike '%numrange%'`,
        `      and pg_get_constraintdef(oid) ilike '%is_active%'`,
        ')::text;',
        `select 'legacy_unique_absent', not exists(`,
        '    select 1 from pg_constraint',
        `    where conrelid = 'public.teacher_availability'::regclass`,
        `      and conname = 'teacher_availability_teacher_id_day_of_week_start_time_key'`,
        ')::text;',
        `select 'handle_new_user_hardened', exists(`,
        '    select 1 from pg_proc function_row',
        `    where function_row.oid = to_regprocedure('public.handle_new_user()')`,
        '      and function_row.prosecdef',
        `      and coalesce(array_to_string(function_row.proconfig, ','), '') like '%search_path=public%'`,
        `      and pg_get_functiondef(function_row.oid) like '%2026-07-10%'`,
        `      and pg_get_functiondef(function_row.oid) like '%v_requested_age_policy_version = v_current_age_policy_version%'`,
        `      and pg_get_functiondef(function_row.oid) like '%CASE WHEN v_adult_confirmed THEN v_current_age_policy_version ELSE NULL END%'`,
        ')::text;',
        `select 'auth_trigger_valid', exists(`,
        '    select 1 from pg_trigger trigger_row',
        '    join pg_proc function_row on function_row.oid = trigger_row.tgfoid',
        `    where trigger_row.tgname = 'on_auth_user_created'`,
        `      and trigger_row.tgrelid = 'auth.users'::regclass`,
        `      and function_row.oid = to_regprocedure('public.handle_new_user()')`,
        '      and not trigger_row.tgisinternal',
        '      and (trigger_row.tgtype & 1) = 1',
        '      and (trigger_row.tgtype & 4) = 4',
        '      and (trigger_row.tgtype & 66) = 0',
        ')::text;',
        `select 'handle_new_user_acl_valid', (` ,
        `    not has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')`,
        `    and not has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')`,
        `    and has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE')`,
        ')::text;',
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function parseSqlFacts(output: string): SqlFacts {
    const facts = new Map<string, string>();
    for (const line of output.split(/\r?\n/u)) {
        const separator = line.indexOf('\t');
        if (separator <= 0) continue;
        facts.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return facts;
}

export function validatePreflightFacts(facts: SqlFacts): FactValidation {
    const details: string[] = [];
    const expectedVersions = STAGING_HARDENING_MIGRATIONS.map((migration) => migration.version).join(',');
    const historyCount = Number(facts.get('migration_history_count'));
    const historyVersions = facts.get('migration_history_versions') ?? '';
    const historyState = historyCount === 0 && historyVersions === ''
        ? 'none'
        : historyCount === 2 && historyVersions === expectedVersions
            ? 'complete'
            : 'partial_or_unexpected';

    requireFact(facts, 'current_database', STAGING_HARDENING_TARGET.databaseName, details);
    const historyColumns = new Set((facts.get('migration_history_columns') ?? '').split(','));
    for (const column of ['name', 'statements', 'version']) {
        if (!historyColumns.has(column)) details.push(`migration_history_columns missing ${column}`);
    }
    if (historyState === 'partial_or_unexpected') {
        details.push(`migration history must contain neither or both exact versions (count=${String(historyCount)}, versions=${historyVersions})`);
    }
    for (const key of [
        'teacher_availability_table',
        'profiles_table',
        'profiles_private_table',
        'auth_users_table',
        'btree_gist_available',
        'target_constraint_valid_or_absent',
        'handle_new_user_exists',
        'auth_trigger_valid',
    ]) {
        requireFact(facts, key, 'true', details);
    }
    requireFact(facts, 'active_overlap_count', '0', details);
    requireFact(facts, 'attestation_columns_count', '3', details);
    const constraintCount = Number(facts.get('target_constraint_count'));
    if (![0, 1].includes(constraintCount)) details.push(`target_constraint_count expected 0 or 1, observed ${String(constraintCount)}`);
    const legacyCount = Number(facts.get('legacy_unique_count'));
    if (![0, 1].includes(legacyCount)) details.push(`legacy_unique_count expected 0 or 1, observed ${String(legacyCount)}`);

    return { valid: details.length === 0, details, historyState };
}

export function validatePostVerifyFacts(facts: SqlFacts): FactValidation {
    const details: string[] = [];
    const expectedVersions = STAGING_HARDENING_MIGRATIONS.map((migration) => migration.version).join(',');
    requireFact(facts, 'current_database', STAGING_HARDENING_TARGET.databaseName, details);
    requireFact(facts, 'migration_history_count', '2', details);
    requireFact(facts, 'migration_history_versions', expectedVersions, details);
    requireFact(facts, 'migration_history_exact_rows', '2', details);
    requireFact(facts, 'btree_gist_installed', 'true', details);
    requireFact(facts, 'active_overlap_count', '0', details);
    for (const key of [
        'target_constraint_valid',
        'legacy_unique_absent',
        'handle_new_user_hardened',
        'auth_trigger_valid',
        'handle_new_user_acl_valid',
    ]) {
        requireFact(facts, key, 'true', details);
    }
    return { valid: details.length === 0, details, historyState: 'complete' };
}

function requireFact(facts: SqlFacts, key: string, expected: string, details: string[]): void {
    const observed = facts.get(key);
    if (observed !== expected) details.push(`${key}: expected ${expected}, observed ${observed ?? '<missing>'}`);
}

export function sanitizeStagingHardeningOutput(value: string): string {
    return value
        .replace(/(postgres|postgresql):\/\/[^\s"']+/giu, '$1://[redacted]')
        .replace(/(PGPASSWORD|SUPABASE_STAGING_DB_URL)\s*[=:]\s*[^\s"']+/giu, '$1=[redacted]')
        .replace(/(password authentication failed for user\s+)[^\r\n]+/giu, '$1[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/giu, 'Bearer [redacted]');
}
