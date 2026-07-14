import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_MIGRATIONS,
    collectLocalMigrations,
    mapMigrationHistory,
    sha256,
    stableJson,
    toPosix,
    type RemoteMigration,
} from './supabase-production-rollout-shared';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface TargetIdentity {
    envFile: string;
    expectedProjectRef: string;
    publicUrlMatches: boolean;
    databaseUrlMatches: boolean;
}

const machineSql = String.raw`select 'remote_migrations' as check_name,
       coalesce(
           json_agg(
               json_build_object(
                   'version', version,
                   'name', coalesce(name, '')
               )
               order by version
           ),
           '[]'::json
       )::text as check_value
from supabase_migrations.schema_migrations;

select 'fixture_counts' as check_name,
       json_build_object(
           'auth_users', (select count(*)::int from auth.users),
           'profiles', (select count(*)::int from public.profiles),
           'packages', (select count(*)::int from public.packages),
           'subscriptions', (select count(*)::int from public.subscriptions),
           'student_teachers', (select count(*)::int from public.student_teachers),
           'sessions', (select count(*)::int from public.sessions),
           'payments', (select count(*)::int from public.payments),
           'leads', (select count(*)::int from public.leads),
           'processed_webhook_events', (select count(*)::int from public.processed_webhook_events),
           'fulfillment_jobs', (select count(*)::int from public.fulfillment_jobs),
           'admin_audit_log', (select count(*)::int from public.admin_audit_log),
           'teacher_availability', (select count(*)::int from public.teacher_availability)
       )::text as check_value;

select 'fixture_distributions' as check_name,
       json_build_object(
           'profiles_by_role', coalesce((
               select jsonb_object_agg(role, fixture_count)
               from (
                   select role::text as role, count(*)::int as fixture_count
                   from public.profiles
                   group by role::text
                   order by role::text
               ) profile_counts
           ), '{}'::jsonb),
           'subscriptions_by_status', coalesce((
               select jsonb_object_agg(status, fixture_count)
               from (
                   select status::text as status, count(*)::int as fixture_count
                   from public.subscriptions
                   group by status::text
                   order by status::text
               ) subscription_counts
           ), '{}'::jsonb),
           'sessions_by_status', coalesce((
               select jsonb_object_agg(status, fixture_count)
               from (
                   select status::text as status, count(*)::int as fixture_count
                   from public.sessions
                   group by status::text
                   order by status::text
               ) session_counts
           ), '{}'::jsonb),
           'payments_by_status', coalesce((
               select jsonb_object_agg(status, fixture_count)
               from (
                   select status::text as status, count(*)::int as fixture_count
                   from public.payments
                   group by status::text
                   order by status::text
               ) payment_counts
           ), '{}'::jsonb)
       )::text as check_value;

select 'billing_legacy_hazard' as check_name,
       json_build_object(
           'total_subscriptions', count(*)::int,
           'stripe_linked', count(*) filter (where s.stripe_subscription_id is not null)::int,
           'active_stripe_linked', count(*) filter (
               where s.stripe_subscription_id is not null and s.status::text = 'active'
           )::int,
           'cancelled_stripe_linked', count(*) filter (
               where s.stripe_subscription_id is not null and s.status::text = 'cancelled'
           )::int,
           'package_price_id_column_present', exists (
               select 1
               from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'subscriptions'
                 and column_name = 'package_price_id'
           ),
           'stripe_linked_breakdown', coalesce((
               select jsonb_agg(
                   jsonb_build_object(
                       'status', breakdown.status,
                       'package_key', breakdown.package_key,
                       'duration_months', breakdown.duration_months,
                       'fixture_count', breakdown.fixture_count
                   )
                   order by breakdown.status, breakdown.package_key, breakdown.duration_months
               )
               from (
                   select s2.status::text as status,
                          p.name as package_key,
                          s2.duration_months,
                          count(*)::int as fixture_count
                   from public.subscriptions s2
                   join public.packages p on p.id = s2.package_id
                   where s2.stripe_subscription_id is not null
                   group by s2.status::text, p.name, s2.duration_months
               ) breakdown
           ), '[]'::jsonb)
       )::text as check_value
from public.subscriptions s;

select case when exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'package_price_id'
) then $query$
    select 'billing_package_price_links' as check_name,
           json_build_object(
               'column_present', true,
               'stripe_linked_without_package_price', count(*) filter (
                   where stripe_subscription_id is not null and package_price_id is null
               )::int,
               'all_subscriptions_without_package_price', count(*) filter (
                   where package_price_id is null
               )::int
           )::text as check_value
    from public.subscriptions
$query$ else $query$
    select 'billing_package_price_links' as check_name,
           json_build_object(
               'column_present', false,
               'stripe_linked_without_package_price', count(*) filter (
                   where stripe_subscription_id is not null
               )::int,
               'all_subscriptions_without_package_price', count(*)::int
           )::text as check_value
    from public.subscriptions
$query$ end
\gexec

select 'schema_hazards' as check_name,
       json_build_object(
           'package_prices_table_present', to_regclass('public.package_prices') is not null,
           'checkout_intents_table_present', to_regclass('public.checkout_intents') is not null,
           'email_recipient_budget_usage_table_present', to_regclass('public.email_recipient_budget_usage') is not null,
           'fulfillment_effects_table_present', to_regclass('public.fulfillment_effects') is not null,
           'staging_smoke_table_present', to_regclass('public.staging_integration_smoke_runs') is not null,
           'legacy_jobs_table_present', to_regclass('public.jobs') is not null,
           'lead_adult_column_present', exists (
               select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'leads' and column_name = 'adult_confirmed'
           ),
           'profile_adult_column_present', exists (
               select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'profiles' and column_name = 'adult_confirmed'
           )
       )::text as check_value;

select 'baseline_history_effects' as check_name,
       json_build_object(
           'packages_updated_at_column_present', exists (
               select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'packages' and column_name = 'updated_at'
           ),
           'fulfillment_jobs_table_present', to_regclass('public.fulfillment_jobs') is not null,
           'admin_audit_log_table_present', to_regclass('public.admin_audit_log') is not null,
           'support_tickets_table_present', to_regclass('public.support_tickets') is not null,
           'support_tickets_rls_enabled', coalesce((
               select relrowsecurity
               from pg_class
               where oid = to_regclass('public.support_tickets')
           ), false),
           'private_is_admin_present', to_regprocedure('private.is_admin()') is not null,
           'public_is_admin_present', to_regprocedure('public.is_admin()') is not null,
           'public_is_admin_public_execute_absent', not exists (
               select 1 from information_schema.routine_privileges
               where routine_schema = 'public' and routine_name = 'is_admin'
                 and grantee = 'PUBLIC' and privilege_type = 'EXECUTE'
           ),
           'public_is_admin_anon_execute_absent', not exists (
               select 1 from information_schema.routine_privileges
               where routine_schema = 'public' and routine_name = 'is_admin'
                 and grantee = 'anon' and privilege_type = 'EXECUTE'
           ),
           'public_is_admin_authenticated_execute_absent', not exists (
               select 1 from information_schema.routine_privileges
               where routine_schema = 'public' and routine_name = 'is_admin'
                 and grantee = 'authenticated' and privilege_type = 'EXECUTE'
           ),
           'public_is_admin_service_role_execute_present', exists (
               select 1 from information_schema.routine_privileges
               where routine_schema = 'public' and routine_name = 'is_admin'
                 and grantee = 'service_role' and privilege_type = 'EXECUTE'
           ),
           'pg_graphql_absent', not exists (
               select 1 from pg_extension where extname = 'pg_graphql'
           )
       )::text as check_value;

select 'processed_at_posture' as check_name,
       json_build_object(
           'column_default', coalesce((
               select column_default
               from information_schema.columns
               where table_schema = 'public'
                 and table_name = 'processed_webhook_events'
                 and column_name = 'processed_at'
           ), '<NULL>'),
           'total', count(*)::int,
           'invalid_status', count(*) filter (
               where processing_status not in ('processing', 'succeeded', 'failed')
           )::int,
           'null_status', count(*) filter (where processing_status is null)::int,
           'processing_with_processed_at', count(*) filter (
               where processing_status = 'processing' and processed_at is not null
           )::int
       )::text as check_value
from public.processed_webhook_events;

select 'database_context' as check_name,
       json_build_object(
           'server_version', current_setting('server_version'),
           'database_size_bytes', pg_database_size(current_database())
       )::text as check_value;
`;

const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-supabase-production-readonly-preflight',
    stamp(startedAt),
);
mkdirSync(outputDir, { recursive: true });

const machineSqlPath = path.join(outputDir, 'production-readonly-preflight.sql');
const rawOutputPath = path.join(outputDir, 'production-readonly-output.txt');
const summaryJsonPath = path.join(outputDir, 'summary.json');
const summaryMarkdownPath = path.join(outputDir, 'summary.md');
writeFileSync(machineSqlPath, machineSql, 'utf8');

const checks: Check[] = [];
const env = readEnvironment(PRODUCTION_PROJECT.envFile);
const targetIdentity = validateTargetIdentity(env);

checks.push({
    status: targetIdentity.publicUrlMatches && targetIdentity.databaseUrlMatches ? 'ok' : 'failed',
    name: 'exact_production_target',
    message: targetIdentity.publicUrlMatches && targetIdentity.databaseUrlMatches
        ? 'Both Supabase URL forms resolve to the exact approved production project ref.'
        : 'Supabase environment values do not resolve to the exact production project ref.',
    details: [
        `environment=${PRODUCTION_PROJECT.environment}`,
        `project=${PRODUCTION_PROJECT.name}`,
        `ref=${PRODUCTION_PROJECT.ref}`,
        `region=${PRODUCTION_PROJECT.region}`,
        `publicUrlMatches=${targetIdentity.publicUrlMatches}`,
        `databaseUrlMatches=${targetIdentity.databaseUrlMatches}`,
    ],
});

const localMigrations = collectLocalMigrations();
checks.push({
    status: localMigrations.length > 0 ? 'ok' : 'failed',
    name: 'local_migration_inventory',
    message: localMigrations.length > 0
        ? 'Canonical local migrations were inventoried with deterministic order and SHA-256 hashes.'
        : 'No local Supabase migrations were found.',
    details: [`count=${localMigrations.length}`],
});

let exitCode: number | null = null;
let parsed: Record<string, unknown> = {};
let remoteMigrations: RemoteMigration[] = [];

if (checks.every((check) => check.status !== 'failed')) {
    const databaseEnv = buildPsqlEnv(requiredEnv(env, 'SUPABASE_DB_URL'));
    const result = spawnSync('psql', [
        '-X',
        '-w',
        '-q',
        '-v',
        'ON_ERROR_STOP=1',
        '-A',
        '-t',
        '-F',
        '\t',
        '-f',
        machineSqlPath,
    ], {
        env: {
            ...process.env,
            ...databaseEnv,
            PGSSLMODE: 'require',
            PGCONNECT_TIMEOUT: '10',
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=20000 -c lock_timeout=5000',
        },
        encoding: 'utf8',
        timeout: 45_000,
        windowsHide: true,
    });

    exitCode = typeof result.status === 'number' ? result.status : null;
    const safeStdout = sanitizeOutput(result.stdout ?? '');
    const safeStderr = sanitizeOutput(result.stderr ?? '');
    writeFileSync(rawOutputPath, `# stdout\n${safeStdout}\n# stderr\n${safeStderr}\n`, 'utf8');

    if (result.error || exitCode !== 0) {
        checks.push({
            status: 'failed',
            name: 'readonly_query_execution',
            message: 'Production read-only psql preflight failed.',
            details: [result.error ? sanitizeOutput(result.error.message) : `exitCode=${exitCode ?? 'unknown'}`],
        });
    } else {
        try {
            parsed = parseMachineOutput(result.stdout ?? '');
            remoteMigrations = parseRemoteMigrations(parsed.remote_migrations);
            checks.push({
                status: 'ok',
                name: 'readonly_query_execution',
                message: 'Production metadata and aggregate fixture preflight completed under database-enforced read-only mode.',
                details: [
                    `exitCode=${exitCode}`,
                    'default_transaction_read_only=on',
                    'no row identifiers, emails, Stripe IDs, payloads or secret values selected',
                ],
            });
        } catch (error) {
            checks.push({
                status: 'failed',
                name: 'readonly_output_parse',
                message: 'Production preflight output could not be parsed safely.',
                details: [sanitizeOutput(error instanceof Error ? error.message : String(error))],
            });
        }
    }
} else {
    writeFileSync(rawOutputPath, 'Preflight stopped before psql because local target validation failed.\n', 'utf8');
}

const migrationMappings = mapMigrationHistory(localMigrations, remoteMigrations);
const canonicalMissing = migrationMappings.filter((migration) => migration.historyStatus !== 'exact');
const semanticMissing = migrationMappings.filter((migration) => migration.historyStatus === 'missing' && !migration.stagingOnly);
const aliases = migrationMappings.filter((migration) => migration.historyStatus === 'alias');
const ambiguous = migrationMappings.filter((migration) => migration.historyStatus === 'ambiguous');
const versionNameMismatches = migrationMappings.filter((migration) => migration.versionNameMismatch);
const duplicateSemanticHistory = migrationMappings.filter((migration) => migration.duplicateSemanticHistory);
const stagingOnlyMappings = STAGING_ONLY_MIGRATIONS.map((expected) => ({
    expected,
    mapping: migrationMappings.find((migration) => (
        migration.version === expected.version && migration.name === expected.name
    )),
}));
const stagingOnlyExcluded = stagingOnlyMappings.every(({ mapping }) => (
    mapping?.stagingOnly === true && mapping.historyStatus === 'missing'
));

checks.push({
    status: ambiguous.length === 0 ? 'ok' : 'failed',
    name: 'migration_alias_mapping',
    message: ambiguous.length === 0
        ? 'Remote migration aliases map deterministically by canonical migration name.'
        : 'One or more local migrations map to multiple remote history entries.',
    details: [
        `remote=${remoteMigrations.length}`,
        `local=${localMigrations.length}`,
        `canonicalVersionMissing=${canonicalMissing.length}`,
        `semanticAliases=${aliases.length}`,
        `semanticMissingExcludingStagingOnly=${semanticMissing.length}`,
        `ambiguous=${ambiguous.length}`,
    ],
});

checks.push({
    status: versionNameMismatches.length === 0 && duplicateSemanticHistory.length === 0 ? 'ok' : 'warning',
    name: 'migration_history_drift_hazards',
    message: versionNameMismatches.length === 0 && duplicateSemanticHistory.length === 0
        ? 'No version/name collision or duplicate semantic history was found.'
        : 'Migration history contains version/name drift or duplicate semantic entries; verify schema effects and never repair/reapply blindly.',
    details: [
        `versionNameMismatch=${versionNameMismatches.map((migration) => migration.version).join(',') || '<none>'}`,
        `duplicateSemanticHistory=${duplicateSemanticHistory.map((migration) => migration.version).join(',') || '<none>'}`,
    ],
});

checks.push({
    status: stagingOnlyExcluded ? 'ok' : 'failed',
    name: 'staging_only_migrations_excluded',
    message: stagingOnlyExcluded
        ? 'Both staging-only migrations are absent from production history and remain excluded.'
        : 'At least one staging-only migration is missing locally, misclassified or present in production migration history.',
    details: stagingOnlyMappings.map(({ expected, mapping }) => [
        `version=${expected.version}`,
        `name=${expected.name}`,
        `stagingOnly=${String(mapping?.stagingOnly ?? false)}`,
        `historyStatus=${mapping?.historyStatus ?? 'local-file-missing-or-renamed'}`,
        `remoteVersions=${mapping?.remoteVersions.join(',') || '<none>'}`,
    ].join(';')),
});

const billingHazard = asRecord(parsed.billing_legacy_hazard);
const packagePriceLinks = asRecord(parsed.billing_package_price_links);
const fixtureCounts = asRecord(parsed.fixture_counts);
const processedAtPosture = asRecord(parsed.processed_at_posture);
const baselineHistoryEffects = asRecord(parsed.baseline_history_effects);

checks.push({
    status: Number(packagePriceLinks.stripe_linked_without_package_price ?? 0) === 0 ? 'ok' : 'warning',
    name: 'billing_legacy_fixture_hazard',
    message: Number(packagePriceLinks.stripe_linked_without_package_price ?? 0) === 0
        ? 'No Stripe-linked subscription lacks an immutable package price link.'
        : 'Stripe-linked legacy subscriptions require an explicit preservation/cleanup decision before billing migrations.',
    details: [
        `stripeLinked=${String(billingHazard.stripe_linked ?? '<unknown>')}`,
        `activeStripeLinked=${String(billingHazard.active_stripe_linked ?? '<unknown>')}`,
        `cancelledStripeLinked=${String(billingHazard.cancelled_stripe_linked ?? '<unknown>')}`,
        `stripeLinkedWithoutPackagePrice=${String(packagePriceLinks.stripe_linked_without_package_price ?? '<unknown>')}`,
    ],
});

const missingBaselineEffects = Object.entries(baselineHistoryEffects)
    .filter(([, present]) => present !== true)
    .map(([name]) => name);
checks.push({
    status: Object.keys(baselineHistoryEffects).length > 0 && missingBaselineEffects.length === 0 ? 'ok' : 'failed',
    name: 'baseline_alias_effect_verification',
    message: Object.keys(baselineHistoryEffects).length > 0 && missingBaselineEffects.length === 0
        ? 'Read-only schema effects required by the baseline version/name and alias drift are present.'
        : 'One or more baseline schema effects are missing; do not reapply or repair history blindly.',
    details: [
        `missing=${missingBaselineEffects.join(',') || '<none>'}`,
        ...Object.entries(baselineHistoryEffects).map(([name, present]) => `${name}=${String(present)}`),
    ],
});

checks.push({
    status: processedAtPosture.column_default === '<NULL>' ? 'ok' : 'warning',
    name: 'processed_at_default',
    message: processedAtPosture.column_default === '<NULL>'
        ? 'Production processed_at has no default.'
        : 'Production retains the processed_at default and needs the separately approved small migration.',
    details: [
        `columnDefault=${String(processedAtPosture.column_default ?? '<unknown>')}`,
        `total=${String(processedAtPosture.total ?? '<unknown>')}`,
        `invalidStatus=${String(processedAtPosture.invalid_status ?? '<unknown>')}`,
        `processingWithProcessedAt=${String(processedAtPosture.processing_with_processed_at ?? '<unknown>')}`,
    ],
});

checks.push({
    status: Object.keys(fixtureCounts).length > 0 ? 'warning' : 'failed',
    name: 'fixture_inventory_requires_policy',
    message: Object.keys(fixtureCounts).length > 0
        ? 'Production contains aggregate fixture data; no cleanup may run without backup evidence and an explicit preservation policy.'
        : 'Aggregate fixture counts are unavailable.',
    details: Object.entries(fixtureCounts).map(([name, count]) => `${name}=${String(count)}`),
});

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    mode: 'read_only' as const,
    target: PRODUCTION_PROJECT,
    targetIdentity,
    psql: {
        exitCode,
        readOnly: true,
        noPasswordPrompt: true,
        connectTimeoutSeconds: 10,
        statementTimeoutMilliseconds: 20_000,
        lockTimeoutMilliseconds: 5_000,
    },
    artifacts: {
        machineSql: toPosix(path.relative(process.cwd(), machineSqlPath)),
        machineSqlSha256: sha256(machineSql),
        rawOutput: toPosix(path.relative(process.cwd(), rawOutputPath)),
        summaryJson: toPosix(path.relative(process.cwd(), summaryJsonPath)),
        summaryMarkdown: toPosix(path.relative(process.cwd(), summaryMarkdownPath)),
    },
    migrationInventory: {
        localCount: localMigrations.length,
        remoteCount: remoteMigrations.length,
        canonicalVersionMissingCount: canonicalMissing.length,
        semanticAliasCount: aliases.length,
        semanticMissingCountExcludingStagingOnly: semanticMissing.length,
        ambiguousCount: ambiguous.length,
        versionNameMismatchCount: versionNameMismatches.length,
        duplicateSemanticHistoryCount: duplicateSemanticHistory.length,
        localMigrations: migrationMappings,
        remoteMigrations,
    },
    aggregates: parsed,
    checks,
    safety: {
        noExternalWrite: true,
        noPrivateRowsSelected: true,
        noSecretsStored: true,
        noMigrationStatementsSelected: true,
        forbiddenCommands: ['supabase db push', 'supabase migration repair'],
        productionExclusions: STAGING_ONLY_MIGRATIONS.map((migration) => ({ ...migration })),
    },
};

writeFileSync(summaryJsonPath, stableJson(report), 'utf8');
writeFileSync(summaryMarkdownPath, renderMarkdown(report), 'utf8');

console.log(`[launch:supabase-production-readonly-preflight] Status: ${status}`);
console.log(`[launch:supabase-production-readonly-preflight] Failed: ${failed.length}`);
console.log(`[launch:supabase-production-readonly-preflight] Warnings: ${warnings.length}`);
console.log(`[launch:supabase-production-readonly-preflight] Target: ${PRODUCTION_PROJECT.name} (${PRODUCTION_PROJECT.ref})`);
console.log(`[launch:supabase-production-readonly-preflight] Summary: ${summaryMarkdownPath}`);

if (failed.length > 0) process.exit(1);

function readEnvironment(envFile: string): Map<string, string> {
    const content = readFileSync(envFile, 'utf8');
    const values = new Map<string, string>();
    for (const line of content.split(/\r?\n/u)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
        if (!match) continue;
        values.set(match[1], stripQuotes(match[2].trim()));
    }
    return values;
}

function validateTargetIdentity(env: Map<string, string>): TargetIdentity {
    const publicUrl = env.get('PUBLIC_SUPABASE_URL') ?? '';
    const databaseUrl = env.get('SUPABASE_DB_URL') ?? '';
    return {
        envFile: PRODUCTION_PROJECT.envFile,
        expectedProjectRef: PRODUCTION_PROJECT.ref,
        publicUrlMatches: urlContainsProjectRef(publicUrl, PRODUCTION_PROJECT.ref),
        databaseUrlMatches: urlContainsProjectRef(databaseUrl, PRODUCTION_PROJECT.ref),
    };
}

function urlContainsProjectRef(value: string, projectRef: string): boolean {
    try {
        const parsed = new URL(value);
        return [parsed.hostname, parsed.username, parsed.pathname]
            .map((part) => decodeURIComponent(part))
            .some((part) => part.includes(projectRef));
    } catch {
        return false;
    }
}

function requiredEnv(env: Map<string, string>, key: string): string {
    const value = env.get(key);
    if (!value) throw new Error(`Missing required environment key ${key}.`);
    return value;
}

function buildPsqlEnv(dbUrl: string): NodeJS.ProcessEnv {
    const parsed = new URL(dbUrl);
    const environment: NodeJS.ProcessEnv = {
        PGHOST: parsed.hostname,
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: parsed.pathname.replace(/^\//u, ''),
    };
    if (parsed.port) environment.PGPORT = parsed.port;
    return environment;
}

function parseMachineOutput(stdout: string): Record<string, unknown> {
    const parsed: Record<string, unknown> = {};
    for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
        if (!line.trim()) continue;
        const [key, ...rest] = line.split('\t');
        if (!key || rest.length === 0) continue;
        const value = rest.join('\t').trim();
        parsed[key] = JSON.parse(value) as unknown;
    }
    return parsed;
}

function parseRemoteMigrations(value: unknown): RemoteMigration[] {
    if (!Array.isArray(value)) throw new Error('remote_migrations is not an array.');
    return value.map((entry) => {
        if (!entry || typeof entry !== 'object') throw new Error('remote_migrations contains a non-object entry.');
        const record = entry as Record<string, unknown>;
        if (typeof record.version !== 'string' || typeof record.name !== 'string') {
            throw new Error('remote_migrations contains an invalid version/name entry.');
        }
        return { version: record.version, name: record.name };
    });
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function sanitizeOutput(value: string): string {
    return value
        .replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-postgres-url]')
        .replace(/(password|service_role|secret|token)=\S+/giu, '$1=[redacted]');
}

function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

function renderMarkdown(report: typeof report): string {
    const migrations = report.migrationInventory.localMigrations;
    const lines = [
        '# Supabase production read-only rollout preflight',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Exact target: ${report.target.name} (${report.target.ref}, ${report.target.region})`,
        '- Mode: database-enforced read-only metadata and aggregate counts; no external write.',
        `- Canonical local migrations: ${report.migrationInventory.localCount}`,
        `- Remote history entries: ${report.migrationInventory.remoteCount}`,
        `- Canonical versions absent from remote history: ${report.migrationInventory.canonicalVersionMissingCount}`,
        `- Semantic aliases found by migration name: ${report.migrationInventory.semanticAliasCount}`,
        `- Semantically missing migrations, excluding staging-only: ${report.migrationInventory.semanticMissingCountExcludingStagingOnly}`,
        `- Version/name mismatches: ${report.migrationInventory.versionNameMismatchCount}`,
        `- Duplicate semantic history entries: ${report.migrationInventory.duplicateSemanticHistoryCount}`,
        '',
        '## Aggregate production posture',
        '',
        '```json',
        JSON.stringify(report.aggregates, null, 2),
        '```',
        '',
        'The aggregates contain counts, public package keys and status buckets only. They contain no user identifiers, emails, Stripe object IDs, row payloads or secret values.',
        '',
        '## Migration history map',
        '',
        '| Order | Canonical version | Name | SHA-256 | History | Remote version(s) | Drift flags | Wave | Scope |',
        '| ---: | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...migrations.map((migration) => [
            `| ${migration.order}`,
            migration.version,
            migration.name,
            migration.sha256,
            migration.historyStatus,
            migration.remoteVersions.join(', ') || '-',
            [migration.versionNameMismatch ? 'version/name mismatch' : '', migration.duplicateSemanticHistory ? 'semantic duplicate' : ''].filter(Boolean).join('; ') || '-',
            migration.plannedWave ?? 'unplanned',
            migration.stagingOnly ? 'STAGING ONLY; forbidden in production' : 'production candidate',
        ].join(' | ') + ' |'),
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        '## Non-negotiable safety boundary',
        '',
        '- Never use blanket `supabase db push` against this drifted production project.',
        '- Never use `supabase migration repair` merely to make histories look equal. Alias evidence must be verified by schema effects first.',
        ...STAGING_ONLY_MIGRATIONS.map((migration) => (
            `- Never apply production migration ${migration.version}_${migration.name}.sql; it is staging-only.`
        )),
        '- This preflight did not apply SQL, mutate Auth/Storage/settings, select private rows or store connection values.',
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
