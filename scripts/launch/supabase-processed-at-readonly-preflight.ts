import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface TargetProject {
    environment: 'staging' | 'production';
    name: string;
    ref: string;
    envFile: string;
    region: string;
}

interface TargetResult {
    environment: TargetProject['environment'];
    name: string;
    ref: string;
    region: string;
    envFile: string;
    exitCode: number | null;
    status: CheckStatus;
    outputPath: string;
    versions: string;
    processedAtDefault: string;
    webhookCounts: string;
    message: string;
}

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    machineSqlPath: string;
    summaryPath: string;
    targetResults: TargetResult[];
    checks: Check[];
}

const targetProjects: TargetProject[] = [
    {
        environment: 'staging',
        name: 'espanol-staging',
        ref: 'mzjyvmlxfpzdfdjzxxyj',
        envFile: '.env.staging',
        region: 'eu-central-1',
    },
    {
        environment: 'production',
        name: 'espanol-honesto',
        ref: 'vkkahxsybhbutszerawz',
        envFile: '.env',
        region: 'eu-west-1',
    },
];

const machineSql = `select 'migration_versions' as check_name,
       coalesce(string_agg(version, ',' order by version), '<NONE>') as check_value
from supabase_migrations.schema_migrations
where version in ('021', '022', '20260702124757', '20260703211451');

select 'processed_at_default' as check_name,
       coalesce((
           select column_default
           from information_schema.columns
           where table_schema = 'public'
             and table_name = 'processed_webhook_events'
             and column_name = 'processed_at'
       ), '<NULL>') as check_value;

select 'webhook_counts' as check_name,
       json_build_object(
           'total', count(*)::int,
           'invalid_status', count(*) filter (where processing_status not in ('processing','succeeded','failed'))::int,
           'null_status', count(*) filter (where processing_status is null)::int,
           'processing_with_processed_at', count(*) filter (where processing_status = 'processing' and processed_at is not null)::int
       )::text as check_value
from public.processed_webhook_events;
`;

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'supabase-processed-at-readonly-preflight', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const machineSqlPath = path.join(outputDir, 'machine-preflight.sql');
writeFileSync(machineSqlPath, machineSql, 'utf8');

const targetResults = targetProjects.map(runTargetPreflight);
const checks = buildChecks(targetResults);
const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: Report['status'] = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: Report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    machineSqlPath,
    summaryPath: path.join(outputDir, 'summary.md'),
    targetResults,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(renderJsonReport(report), null, 2), 'utf8');
writeFileSync(report.summaryPath, renderMarkdown(report), 'utf8');

console.log(`[launch:supabase-processed-at-readonly-preflight] Status: ${status}`);
console.log(`[launch:supabase-processed-at-readonly-preflight] Failed: ${failed.length}`);
console.log(`[launch:supabase-processed-at-readonly-preflight] Warnings: ${warnings.length}`);
console.log(`[launch:supabase-processed-at-readonly-preflight] Summary: ${report.summaryPath}`);

if (failed.length > 0) process.exit(1);

function runTargetPreflight(target: TargetProject): TargetResult {
    const outputPath = path.join(outputDir, `${target.environment}-preflight.txt`);

    if (!existsSync(target.envFile)) {
        const message = `Missing ${target.envFile}; cannot run ${target.environment} preflight.`;
        writeFileSync(outputPath, `${message}\n`, 'utf8');
        return emptyResult(target, 'failed', outputPath, message);
    }

    const dbUrl = readEnvValue(target.envFile, 'SUPABASE_DB_URL');
    if (!dbUrl) {
        const message = `Missing SUPABASE_DB_URL in ${target.envFile}; cannot run ${target.environment} preflight.`;
        writeFileSync(outputPath, `${message}\n`, 'utf8');
        return emptyResult(target, 'failed', outputPath, message);
    }

    const databaseEnv = buildPsqlEnv(dbUrl);
    if (!databaseEnv) {
        const message = `SUPABASE_DB_URL in ${target.envFile} could not be parsed as a Postgres connection URL.`;
        writeFileSync(outputPath, `${message}\n`, 'utf8');
        return emptyResult(target, 'failed', outputPath, message);
    }

    const childEnv = {
        ...process.env,
        ...databaseEnv,
        PGSSLMODE: 'require',
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000',
    };

    const result = spawnSync('psql', [
        '-X',
        '-w',
        '-v',
        'ON_ERROR_STOP=1',
        '-A',
        '-t',
        '-F',
        '\t',
        '-f',
        machineSqlPath,
    ], {
        env: childEnv,
        encoding: 'utf8',
        timeout: 30_000,
        windowsHide: true,
    });

    const combinedOutput = [
        '# stdout',
        result.stdout ?? '',
        '# stderr',
        result.stderr ?? '',
    ].join('\n');
    writeFileSync(outputPath, combinedOutput, 'utf8');

    if (result.error) {
        return emptyResult(target, 'failed', outputPath, safeErrorMessage(result.error));
    }

    const exitCode = typeof result.status === 'number' ? result.status : null;
    if (exitCode !== 0) {
        return {
            ...emptyResult(target, 'failed', outputPath, `psql exited with code ${exitCode ?? 'unknown'}.`),
            exitCode,
        };
    }

    const parsed = parseMachineOutput(result.stdout ?? '');
    const processedAtDefault = parsed.processed_at_default ?? '<UNKNOWN>';
    const webhookCounts = normalizeJsonText(parsed.webhook_counts ?? '<UNKNOWN>');
    const statusForTarget: CheckStatus = processedAtDefault === '<UNKNOWN>' || webhookCounts === '<UNKNOWN>' ? 'warning' : 'ok';

    return {
        environment: target.environment,
        name: target.name,
        ref: target.ref,
        region: target.region,
        envFile: target.envFile,
        exitCode,
        status: statusForTarget,
        outputPath,
        versions: parsed.migration_versions ?? '<UNKNOWN>',
        processedAtDefault,
        webhookCounts,
        message: statusForTarget === 'ok'
            ? 'Read-only metadata and aggregate preflight completed.'
            : 'Read-only preflight completed, but one or more expected values could not be parsed.',
    };
}

function emptyResult(target: TargetProject, status: CheckStatus, outputPath: string, message: string): TargetResult {
    return {
        environment: target.environment,
        name: target.name,
        ref: target.ref,
        region: target.region,
        envFile: target.envFile,
        exitCode: null,
        status,
        outputPath,
        versions: '<UNKNOWN>',
        processedAtDefault: '<UNKNOWN>',
        webhookCounts: '<UNKNOWN>',
        message,
    };
}

function buildChecks(results: TargetResult[]): Check[] {
    const checks: Check[] = [
        {
            status: 'ok',
            name: 'readonly_guard',
            message: 'psql runs with read-only transaction, timeout and no-password-prompt guardrails.',
            details: [
                'PGOPTIONS=default_transaction_read_only=on,statement_timeout=15000,lock_timeout=5000',
                'PGCONNECT_TIMEOUT=10',
                'psql -X -w',
                'machine output only; no database URL or secret values stored',
            ],
        },
        {
            status: results.every((result) => result.status !== 'failed') ? 'ok' : 'failed',
            name: 'psql_execution',
            message: results.every((result) => result.status !== 'failed')
                ? 'Read-only psql preflight completed for every target project.'
                : 'One or more read-only psql preflights failed.',
            details: results.map((result) => `${result.environment}=${result.exitCode ?? 'no-exit'}:${result.message}`),
        },
    ];

    const staging = results.find((result) => result.environment === 'staging');
    const production = results.find((result) => result.environment === 'production');
    const productionDefaultOpen = production?.processedAtDefault !== '<NULL>';

    checks.push({
        status: staging?.processedAtDefault === '<NULL>' ? 'ok' : 'warning',
        name: 'staging_processed_at_default',
        message: staging?.processedAtDefault === '<NULL>'
            ? 'Staging processed_at default is absent.'
            : 'Staging processed_at default is not confirmed absent.',
        details: [`processed_at_default=${staging?.processedAtDefault ?? '<MISSING>'}`],
    });

    checks.push({
        status: productionDefaultOpen ? 'warning' : 'ok',
        name: 'production_processed_at_default',
        message: productionDefaultOpen
            ? 'Production still retains processed_at DEFAULT and the Strict-QA blocker must remain open.'
            : 'Production processed_at default is absent.',
        details: [`processed_at_default=${production?.processedAtDefault ?? '<MISSING>'}`],
    });

    checks.push({
        status: webhookCountsClean(results) ? 'ok' : 'warning',
        name: 'webhook_aggregate_state',
        message: webhookCountsClean(results)
            ? 'Webhook aggregate state is clean in every parsed target result.'
            : 'Webhook aggregate state could not be confirmed clean.',
        details: results.map((result) => `${result.environment}=${result.webhookCounts}`),
    });

    return checks;
}

function webhookCountsClean(results: TargetResult[]): boolean {
    return results.every((result) => {
        try {
            const counts = JSON.parse(result.webhookCounts) as {
                invalid_status?: number;
                null_status?: number;
                processing_with_processed_at?: number;
            };
            return counts.invalid_status === 0
                && counts.null_status === 0
                && counts.processing_with_processed_at === 0;
        } catch {
            return false;
        }
    });
}

function parseMachineOutput(stdout: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
        if (!line.trim()) continue;
        const [key, ...rest] = line.split('\t');
        if (!key || rest.length === 0) continue;
        parsed[key] = rest.join('\t').trim();
    }
    return parsed;
}

function normalizeJsonText(value: string): string {
    if (value === '<UNKNOWN>') return value;
    try {
        return JSON.stringify(JSON.parse(value));
    } catch {
        return value;
    }
}

function readEnvValue(envFile: string, key: string): string | null {
    const content = readFileSync(envFile, 'utf8');
    for (const line of content.split(/\r?\n/u)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
        if (!match || match[1] !== key) continue;
        return stripQuotes(match[2].trim());
    }
    return null;
}

function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

function buildPsqlEnv(dbUrl: string): NodeJS.ProcessEnv | null {
    try {
        const parsed = new URL(dbUrl);
        const [rawUser, rawPassword = ''] = parsed.username || parsed.password
            ? [parsed.username, parsed.password]
            : parsed.username.split(':', 2);
        const env: NodeJS.ProcessEnv = {
            PGHOST: parsed.hostname,
            PGUSER: decodeURIComponent(rawUser),
            PGPASSWORD: decodeURIComponent(rawPassword),
            PGDATABASE: parsed.pathname.replace(/^\//u, ''),
        };
        if (parsed.port) env.PGPORT = parsed.port;
        return env;
    } catch {
        return null;
    }
}

function renderJsonReport(report: Report): Record<string, unknown> {
    return {
        schemaVersion: report.schemaVersion,
        startedAt: report.startedAt,
        endedAt: report.endedAt,
        status: report.status,
        outputDir: report.outputDir,
        machineSql: {
            path: toPosix(path.relative(process.cwd(), report.machineSqlPath)),
            sha256: sha256(machineSql),
            bytes: Buffer.byteLength(machineSql, 'utf8'),
        },
        targetResults: report.targetResults.map((result) => ({
            ...result,
            outputPath: toPosix(path.relative(process.cwd(), result.outputPath)),
        })),
        checks: report.checks,
        noMigrationApplied: true,
        noSecretsStored: true,
        readOnlyGuard: {
            pgoptions: 'default_transaction_read_only=on, statement_timeout=15000, lock_timeout=5000',
            pgconnectTimeout: 10,
            psqlNoPasswordPrompt: true,
        },
    };
}

function renderMarkdown(report: Report): string {
    const lines = [
        '# Supabase processed_at read-only preflight refresh',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        '- Mode: read-only metadata/aggregate queries only; no migration applied.',
        '- Read-only guard: PGOPTIONS default_transaction_read_only=on, statement_timeout=15000, lock_timeout=5000; PGCONNECT_TIMEOUT=10; psql -w.',
        `- Machine SQL: ${toPosix(path.relative(process.cwd(), report.machineSqlPath))}`,
        '',
        '## Targets',
        '',
        '| Environment | Project | Ref | Exit | processed_at_default | webhook_counts | Output |',
        '| --- | --- | --- | ---: | --- | --- | --- |',
        ...report.targetResults.map((result) => `| ${result.environment} | ${result.name} | ${result.ref} | ${result.exitCode ?? 'n/a'} | ${result.processedAtDefault} | ${escapeCell(result.webhookCounts)} | ${toPosix(path.relative(process.cwd(), result.outputPath))} |`),
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        '## Safety',
        '',
        '- This command does not apply SQL, does not call `supabase db push`, does not mutate Supabase data or settings and does not print database URLs, passwords, service role keys, JWTs or private row payloads.',
        '- If production still shows `processed_at_default=now()`, keep `ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149` open until migration `20260703211451_drop_processed_webhook_processed_at_default` is applied and verified or explicitly accepted as risk.',
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function safeErrorMessage(error: Error): string {
    return error.message.replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-postgres-url]');
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
