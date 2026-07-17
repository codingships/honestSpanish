import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
} from './supabase-staging-hardening-shared';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type RunnerMode = 'plan' | 'preflight-readonly' | 'execute-approved';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CommandCapture {
    id: string;
    display: string;
    path: string;
    exitCode: number | null;
    status: CheckStatus;
    writesSupabase: boolean;
}

interface RunnerReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: 'PLAN_ONLY_READY' | 'PREFLIGHT_VERIFIED' | 'APPLIED_AND_VERIFIED' | 'ALREADY_APPLIED_AND_VERIFIED' | 'BLOCKED';
    mode: RunnerMode;
    target: typeof STAGING_HARDENING_TARGET;
    outputDir: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    credentialPresent: boolean;
    writeCommandInvoked: boolean;
    externalWritePerformed: boolean;
    migrations: typeof STAGING_HARDENING_MIGRATIONS;
    checks: Check[];
    captures: CommandCapture[];
    artifacts: {
        summaryJson: string;
        summaryMarkdown: string;
        manifest: string;
        preflightSql: string;
        applySql: string;
        postVerifySql: string;
        executionPlan: string;
        approvalGate: string;
        rollbackPlan: string;
    };
}

const args = new Set(process.argv.slice(2));
const executeRequested = args.has('--execute-approved');
const preflightRequested = args.has('--preflight-readonly');
const mode: RunnerMode = executeRequested
    ? 'execute-approved'
    : preflightRequested
        ? 'preflight-readonly'
        : 'plan';
const approvalMatched = process.env[STAGING_HARDENING_APPROVAL_ENV] === STAGING_HARDENING_APPROVAL;
const credentialPresent = Boolean(process.env[STAGING_HARDENING_DB_URL_ENV]);
const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-supabase-staging-hardening-runner',
    stamp(startedAt),
);
mkdirSync(outputDir, { recursive: true });

const artifacts: RunnerReport['artifacts'] = {
    summaryJson: path.join(outputDir, 'summary.json'),
    summaryMarkdown: path.join(outputDir, 'summary.md'),
    manifest: path.join(outputDir, 'manifest.json'),
    preflightSql: path.join(outputDir, 'preflight-readonly.sql'),
    applySql: path.join(outputDir, 'apply-exact-migrations.sql'),
    postVerifySql: path.join(outputDir, 'post-apply-readonly-verification.sql'),
    executionPlan: path.join(outputDir, 'execution-plan.md'),
    approvalGate: path.join(outputDir, 'approval-gate.md'),
    rollbackPlan: path.join(outputDir, 'rollback-plan.md'),
};

const migrationValidation = validateMigrationAllowlist();
const checks: Check[] = [
    {
        status: migrationValidation.valid ? 'ok' : 'failed',
        name: 'exact_migration_allowlist_and_sha256',
        message: migrationValidation.valid
            ? 'All and only the allowlisted staging hardening migrations match their pinned SHA-256 values.'
            : 'A staging hardening migration is missing, outside scope or does not match its pinned SHA-256.',
        details: migrationValidation.details,
    },
    validatePackageScript(),
    validateRunnerSourcePosture(),
];
const captures: CommandCapture[] = [];
let writeCommandInvoked = false;
let externalWritePerformed = false;
let closureStatus: RunnerReport['closureStatus'] = mode === 'plan' ? 'PLAN_ONLY_READY' : 'BLOCKED';

writeFileSync(artifacts.preflightSql, renderStagingHardeningPreflightSql(), 'utf8');
writeFileSync(
    artifacts.applySql,
    migrationValidation.valid
        ? renderStagingHardeningApplySql()
        : '-- Not generated: a pinned migration artifact failed local validation.\n',
    'utf8',
);
writeFileSync(artifacts.postVerifySql, renderStagingHardeningPostVerifySql(), 'utf8');

if (executeRequested && preflightRequested) {
    checks.push({
        status: 'failed',
        name: 'mode_exclusive',
        message: 'Use either --preflight-readonly or --execute-approved, never both.',
        details: ['externalWritePerformed=false'],
    });
} else if (mode === 'plan') {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_connection',
        message: 'Default plan mode generated local artifacts without connecting to Supabase or another service.',
        details: [
            'connectionAttempted=false',
            'writeCommandInvoked=false',
            'externalWritePerformed=false',
        ],
    });
} else if (!migrationValidation.valid) {
    checks.push({
        status: 'failed',
        name: 'local_artifacts_before_connection',
        message: 'Remote preflight/execution is blocked because the exact local migration allowlist did not validate.',
        details: ['connectionAttempted=false', 'externalWritePerformed=false'],
    });
} else if (mode === 'execute-approved' && !approvalMatched) {
    checks.push({
        status: 'failed',
        name: 'exact_approval_gate',
        message: 'Execution was requested but the exact approval environment value did not match; no connection or write was attempted.',
        details: [
            `env=${STAGING_HARDENING_APPROVAL_ENV}`,
            'required=exact sentence in approval-gate.md',
            'connectionAttempted=false',
            'externalWritePerformed=false',
        ],
    });
} else {
    const targetValidation = validateStagingDatabaseUrl(process.env[STAGING_HARDENING_DB_URL_ENV]);
    checks.push({
        status: targetValidation.valid ? 'ok' : 'failed',
        name: 'exact_staging_database_target',
        message: targetValidation.valid
            ? 'Credential endpoint identifies the exact allowlisted Supabase staging project without exposing the credential.'
            : 'Credential endpoint is missing or does not identify the exact allowlisted staging project.',
        details: [
            `projectRef=${STAGING_HARDENING_TARGET.projectRef}`,
            `reason=${targetValidation.reason}`,
        ],
    });

    if (targetValidation.valid && targetValidation.connectionEnv) {
        const preflight = runPsql(
            'preflight_readonly',
            `psql ${STAGING_HARDENING_TARGET.environment} ${STAGING_HARDENING_TARGET.projectRef} -f preflight-readonly.sql`,
            artifacts.preflightSql,
            targetValidation.connectionEnv,
            false,
        );
        captures.push(preflight);
        checks.push(captureCheck(preflight));

        if (preflight.status === 'ok') {
            const preflightFacts = parseSqlFacts(readCaptureStdout(preflight.path));
            const preflightValidation = validatePreflightFacts(preflightFacts);
            checks.push({
                status: preflightValidation.valid ? 'ok' : 'failed',
                name: 'readonly_preflight_facts',
                message: preflightValidation.valid
                    ? 'Read-only preflight confirms dependencies, zero active overlaps and coherent target migration history.'
                    : 'Read-only preflight found schema drift, active overlaps or partial/unexpected migration history.',
                details: [
                    `historyState=${preflightValidation.historyState ?? 'unknown'}`,
                    ...preflightValidation.details,
                ],
            });

            if (preflightValidation.valid && mode === 'preflight-readonly') {
                closureStatus = 'PREFLIGHT_VERIFIED';
            } else if (preflightValidation.valid && mode === 'execute-approved') {
                checks.push({
                    status: 'ok',
                    name: 'exact_approval_gate',
                    message: 'Exact staging-only approval matched after all local and read-only preflight gates passed.',
                    details: [
                        `env=${STAGING_HARDENING_APPROVAL_ENV}`,
                        `projectRef=${STAGING_HARDENING_TARGET.projectRef}`,
                    ],
                });

                if (preflightValidation.historyState !== 'complete') {
                    const alreadyAppliedCount = preflightValidation.appliedMigrationCount ?? 0;
                    writeFileSync(
                        artifacts.applySql,
                        renderStagingHardeningApplySql(process.cwd(), alreadyAppliedCount),
                        'utf8',
                    );
                    writeCommandInvoked = true;
                    const apply = runPsql(
                        'apply_exact_migrations',
                        `psql ${STAGING_HARDENING_TARGET.environment} ${STAGING_HARDENING_TARGET.projectRef} -f apply-exact-migrations.sql`,
                        artifacts.applySql,
                        targetValidation.connectionEnv,
                        true,
                    );
                    captures.push(apply);
                    checks.push(captureCheck(apply));
                    externalWritePerformed = apply.status === 'ok';
                } else if (preflightValidation.historyState === 'complete') {
                    checks.push({
                        status: 'ok',
                        name: 'already_applied_skip_write',
                        message: 'All five exact history versions already exist, so the runner skipped the write and moved to verification.',
                        details: ['writeCommandInvoked=false', 'externalWritePerformed=false'],
                    });
                }

                const applyFailed = writeCommandInvoked && !externalWritePerformed;
                if (!applyFailed) {
                    const verify = runPsql(
                        'post_apply_readonly_verification',
                        `psql ${STAGING_HARDENING_TARGET.environment} ${STAGING_HARDENING_TARGET.projectRef} -f post-apply-readonly-verification.sql`,
                        artifacts.postVerifySql,
                        targetValidation.connectionEnv,
                        false,
                    );
                    captures.push(verify);
                    checks.push(captureCheck(verify));
                    if (verify.status === 'ok') {
                        const postValidation = validatePostVerifyFacts(parseSqlFacts(readCaptureStdout(verify.path)));
                        checks.push({
                            status: postValidation.valid ? 'ok' : 'failed',
                            name: 'post_apply_schema_verification',
                            message: postValidation.valid
                                ? 'History, overlap constraint, trigger, hardened function and execution grants match the exact expected state.'
                                : 'Post-apply read-only verification did not prove the exact expected schema and history state.',
                            details: postValidation.details,
                        });
                        if (postValidation.valid) {
                            closureStatus = externalWritePerformed
                                ? 'APPLIED_AND_VERIFIED'
                                : 'ALREADY_APPLIED_AND_VERIFIED';
                        }
                    }
                }
            }
        }
    }
}

let report = buildReport();
writeFileSync(artifacts.executionPlan, renderExecutionPlan(report), 'utf8');
writeFileSync(artifacts.approvalGate, renderApprovalGate(report), 'utf8');
writeFileSync(artifacts.rollbackPlan, renderRollbackPlan(report), 'utf8');
writeFileSync(artifacts.manifest, renderManifest(report), 'utf8');
checks.push(validateGeneratedArtifacts());
report = buildReport();
writeFileSync(artifacts.executionPlan, renderExecutionPlan(report), 'utf8');
writeFileSync(artifacts.approvalGate, renderApprovalGate(report), 'utf8');
writeFileSync(artifacts.rollbackPlan, renderRollbackPlan(report), 'utf8');
writeFileSync(artifacts.manifest, renderManifest(report), 'utf8');
writeFileSync(artifacts.summaryJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(artifacts.summaryMarkdown, renderSummary(report), 'utf8');

console.log(`[launch:supabase-staging-hardening] Status: ${report.status}`);
console.log(`[launch:supabase-staging-hardening] Closure: ${report.closureStatus}`);
console.log(`[launch:supabase-staging-hardening] Mode: ${report.mode}`);
console.log(`[launch:supabase-staging-hardening] Write command invoked: ${String(report.writeCommandInvoked)}`);
console.log(`[launch:supabase-staging-hardening] External write performed: ${String(report.externalWritePerformed)}`);
console.log(`[launch:supabase-staging-hardening] Summary: ${report.artifacts.summaryMarkdown}`);

if (report.status === 'FAILED') process.exit(1);

function buildReport(): RunnerReport {
    const status = statusFor(checks);
    if (status === 'FAILED') closureStatus = 'BLOCKED';
    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        closureStatus,
        mode,
        target: STAGING_HARDENING_TARGET,
        outputDir,
        executeRequested,
        approvalMatched,
        credentialPresent,
        writeCommandInvoked,
        externalWritePerformed,
        migrations: STAGING_HARDENING_MIGRATIONS,
        checks,
        captures,
        artifacts,
    };
}

function validatePackageScript(): Check {
    const packagePath = path.join(process.cwd(), 'package.json');
    if (!existsSync(packagePath)) {
        return { status: 'failed', name: 'package_script', message: 'package.json is missing.', details: [] };
    }
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };
    const expected = 'tsx scripts/launch/supabase-staging-hardening-runner.ts';
    const details: string[] = [];
    if (packageJson.packageManager !== 'pnpm@10.33.0') details.push('packageManager must remain pnpm@10.33.0');
    if (packageJson.scripts?.['launch:supabase-staging-hardening'] !== expected) {
        details.push(`launch:supabase-staging-hardening must equal ${expected}`);
    }
    return {
        status: details.length === 0 ? 'ok' : 'failed',
        name: 'package_script',
        message: details.length === 0
            ? 'The pnpm package script points only to this exact gated runner.'
            : 'The pnpm package script or package-manager contract is missing.',
        details,
    };
}

function validateRunnerSourcePosture(): Check {
    const source = readFileSync(path.join(process.cwd(), 'scripts/launch/supabase-staging-hardening-runner.ts'), 'utf8');
    const requiredInOrder = [
        "mode === 'execute-approved' && !approvalMatched",
        'const targetValidation = validateStagingDatabaseUrl',
        "'preflight_readonly'",
        "preflightValidation.historyState !== 'complete'",
        "'apply_exact_migrations'",
        "'post_apply_readonly_verification'",
    ];
    const missing = requiredInOrder.filter((snippet) => !source.includes(snippet));
    let previousIndex = -1;
    const outOfOrder: string[] = [];
    for (const snippet of requiredInOrder) {
        const index = source.indexOf(snippet);
        if (index <= previousIndex) outOfOrder.push(snippet);
        previousIndex = index;
    }
    const forbidden = [
        { label: 'Supabase CLI invocation', pattern: /spawnSync\(\s*['"]supabase['"]/u },
        { label: 'shell-mediated command', pattern: /spawnSync\(\s*['"](?:powershell|pwsh|cmd|bash|sh)['"]/u },
    ].filter((item) => item.pattern.test(source));
    return {
        status: missing.length === 0 && outOfOrder.length === 0 && forbidden.length === 0 ? 'ok' : 'failed',
        name: 'runner_source_posture',
        message: missing.length === 0 && outOfOrder.length === 0 && forbidden.length === 0
            ? 'Source gates the exact staging target, read-only preflight, atomic apply and post-verification in that order.'
            : 'Runner source is missing a gate, has unsafe sequencing or names forbidden production/general migration operations.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...outOfOrder.map((snippet) => `outOfOrder=${snippet}`),
            ...forbidden.map((item) => `forbidden=${item.label}`),
        ],
    };
}

function runPsql(
    id: string,
    display: string,
    sqlFile: string,
    connectionEnv: NodeJS.ProcessEnv,
    writesSupabase: boolean,
): CommandCapture {
    const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        ...connectionEnv,
        PGSSLMODE: 'require',
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: writesSupabase
            ? '-c statement_timeout=30000 -c lock_timeout=5000'
            : '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000',
    };
    delete childEnv[STAGING_HARDENING_DB_URL_ENV];
    delete childEnv[STAGING_HARDENING_APPROVAL_ENV];

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
        sqlFile,
    ], {
        cwd: process.cwd(),
        env: childEnv,
        encoding: 'utf8',
        timeout: writesSupabase ? 60000 : 30000,
        windowsHide: true,
    });

    const capturePath = path.join(outputDir, `${id}.txt`);
    const stdout = sanitizeStagingHardeningOutput(result.stdout ?? '');
    const stderr = sanitizeStagingHardeningOutput(result.stderr ?? '');
    const error = result.error ? sanitizeStagingHardeningOutput(result.error.message) : 'none';
    writeFileSync(capturePath, [
        `command=${display}`,
        `writesSupabase=${String(writesSupabase)}`,
        `exitCode=${String(result.status)}`,
        `error=${error}`,
        '',
        '## stdout',
        '',
        stdout || '(empty)',
        '',
        '## stderr',
        '',
        stderr || '(empty)',
        '',
    ].join('\n'), 'utf8');

    return {
        id,
        display,
        path: capturePath,
        exitCode: result.status,
        status: result.status === 0 && !result.error ? 'ok' : 'failed',
        writesSupabase,
    };
}

function readCaptureStdout(capturePath: string): string {
    const capture = readFileSync(capturePath, 'utf8');
    const start = capture.indexOf('## stdout\n\n');
    const end = capture.indexOf('\n\n## stderr', start + 1);
    return start >= 0 && end > start ? capture.slice(start + '## stdout\n\n'.length, end) : '';
}

function captureCheck(capture: CommandCapture): Check {
    return {
        status: capture.status,
        name: `command_${capture.id}`,
        message: capture.status === 'ok'
            ? `Command completed: ${capture.display}`
            : `Command failed or timed out: ${capture.display}`,
        details: [
            `capture=${toRelative(capture.path)}`,
            `writesSupabase=${String(capture.writesSupabase)}`,
            `exitCode=${String(capture.exitCode)}`,
        ],
    };
}

function renderExecutionPlan(report: RunnerReport): string {
    return `${[
        '# Supabase staging hardening execution plan',
        '',
        `- Exact project: ${report.target.name} (${report.target.projectRef}).`,
        `- Mode for this run: ${report.mode}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        '- Default mode is local plan-only and never opens a network connection.',
        '',
        '## Fixed migration allowlist',
        '',
        ...report.migrations.map((migration) => `- \`${migration.file}\` — SHA-256 \`${migration.sha256}\`.`),
        '',
        '## Future read-only preflight',
        '',
        'Supply the staging database credential only through the process environment, then run:',
        '',
        '```powershell',
        `$env:${STAGING_HARDENING_DB_URL_ENV}='<staging database URL>'`,
        'pnpm launch:supabase-staging-hardening -- --preflight-readonly',
        '```',
        '',
        'The runner validates that the URL identifies exactly the direct staging host or its project-qualified Supabase pooler user. It never prints or stores the URL.',
        '',
        '## Future approved execution',
        '',
        '```powershell',
        `$env:${STAGING_HARDENING_DB_URL_ENV}='<staging database URL>'`,
        `$env:${STAGING_HARDENING_APPROVAL_ENV}='${STAGING_HARDENING_APPROVAL.replace(/'/g, "''")}'`,
        'pnpm launch:supabase-staging-hardening -- --execute-approved',
        '```',
        '',
        'Execution order is fixed: local hash allowlist → endpoint allowlist → read-only preflight → one atomic transaction containing exactly the missing suffix of the five-migration sequence and its history inserts → read-only post-verification.',
        '',
        '## Stop conditions',
        '',
        '- Stop before connecting if any local SHA-256 changes.',
        '- Stop before connecting if exact approval is absent for execute mode.',
        '- Stop before SQL if the endpoint is not exactly staging `mzjyvmlxfpzdfdjzxxyj`.',
        '- Stop before write if target history is not an exact ordered prefix, active overlaps exist, dependencies are missing or an existing named constraint has another definition.',
        '- If all target versions already exist, do not reapply; run only the exact post-verification.',
        '- Never run a general migration push, migration repair, production action, Auth setting change or provider write from this runner.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(report: RunnerReport): string {
    return `${[
        '# Supabase staging hardening approval gate',
        '',
        'This document is not approval. It records the exact future gate.',
        '',
        `- Required flag: \`--execute-approved\`.`,
        `- Required environment variable: \`${STAGING_HARDENING_APPROVAL_ENV}\`.`,
        `- Credential environment variable: \`${STAGING_HARDENING_DB_URL_ENV}\`.`,
        `- Approval matched in this run: ${String(report.approvalMatched)}.`,
        `- External write performed in this run: ${String(report.externalWritePerformed)}.`,
        '',
        '## Exact sentence',
        '',
        STAGING_HARDENING_APPROVAL,
        '',
        '## Explicitly excluded',
        '',
        '- Production and every Supabase project other than `mzjyvmlxfpzdfdjzxxyj`.',
        '- Any migration other than the five pinned files/hashes.',
        '- General database push, migration repair, row cleanup, Auth/configuration changes, Storage changes and secret rotation.',
        '- Cloudflare, Stripe, Resend, Google, Sentry, DNS, domain, email and payment actions.',
        '',
    ].join('\n')}\n`;
}

function renderRollbackPlan(report: RunnerReport): string {
    return `${[
        '# Supabase staging hardening rollback plan',
        '',
        `- External write performed in this run: ${String(report.externalWritePerformed)}.`,
        '- Plan and read-only preflight modes require no rollback.',
        '- The apply file is one transaction with `ON_ERROR_STOP`; any SQL error before `COMMIT` rolls back all schema effects and migration-history inserts together.',
        '',
        '## After a committed apply',
        '',
        'There is intentionally no automatic rollback command. The five-migration sequence tightens invariants and only normalizes values accepted by preflight; a forward fix is safer than silently weakening them.',
        '',
        'If a verified staging incident requires reversal:',
        '',
        '1. Stop staging signup/availability writes and preserve the sanitized runner captures.',
        '2. Obtain a separate exact approval naming staging, the incident and the precise reversal SQL.',
        '3. In a read-only transaction, prove there are no duplicate active slots before considering restoration of the former unique constraint; otherwise do not drop the exclusion constraint.',
        '4. Restore the prior `handle_new_user()` definition from the committed migration immediately preceding this hardening, not from an ad-hoc reconstruction.',
        '5. Remove only the migration-history rows applied by the incident run, and only in the same transaction that completely restores those schema effects. Never use migration repair as a shortcut.',
        '6. Re-run the read-only preflight/verification appropriate to the restored state and record a non-secret incident receipt.',
        '',
        'If post-verification fails after a successful commit, do not retry or roll back automatically. Inspect metadata read-only and prepare a reviewed forward fix or separately approved reversal.',
        '',
    ].join('\n')}\n`;
}

function renderManifest(report: RunnerReport): string {
    return `${JSON.stringify({
        schemaVersion: report.schemaVersion,
        generatedAt: report.endedAt,
        mode: report.mode,
        target: report.target,
        exactApprovalEnv: STAGING_HARDENING_APPROVAL_ENV,
        credentialEnv: STAGING_HARDENING_DB_URL_ENV,
        executeRequested: report.executeRequested,
        approvalMatched: report.approvalMatched,
        credentialPresent: report.credentialPresent,
        writeCommandInvoked: report.writeCommandInvoked,
        externalWritePerformed: report.externalWritePerformed,
        migrations: report.migrations,
        execution: {
            generalDbPush: false,
            migrationRepair: false,
            transaction: 'exact missing suffix of the five migrations and its supabase_migrations.schema_migrations inserts in one transaction',
            preflight: 'read-only',
            postVerification: 'read-only',
        },
        artifacts: Object.fromEntries(
            Object.entries(report.artifacts).map(([key, value]) => [key, toRelative(value)]),
        ),
        captures: report.captures.map((capture) => ({
            ...capture,
            path: toRelative(capture.path),
        })),
    }, null, 2)}\n`;
}

function renderSummary(report: RunnerReport): string {
    return `${[
        '# Supabase staging hardening runner summary',
        '',
        `- Status: ${report.status}.`,
        `- Closure: ${report.closureStatus}.`,
        `- Mode: ${report.mode}.`,
        `- Target: ${report.target.name} (${report.target.projectRef}).`,
        `- Execute requested: ${String(report.executeRequested)}.`,
        `- Approval matched: ${String(report.approvalMatched)}.`,
        `- Credential present: ${String(report.credentialPresent)} (value is never recorded).`,
        `- Write command invoked: ${String(report.writeCommandInvoked)}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / ') || '-')} |`),
        '',
        'Default plan mode is entirely local. No Supabase or other service is contacted unless a future operator explicitly chooses read-only preflight or supplies every execute approval gate.',
        '',
    ].join('\n')}\n`;
}

function validateGeneratedArtifacts(): Check {
    const paths = [
        artifacts.preflightSql,
        artifacts.applySql,
        artifacts.postVerifySql,
        artifacts.executionPlan,
        artifacts.approvalGate,
        artifacts.rollbackPlan,
        artifacts.manifest,
    ];
    const combined = paths.filter(existsSync).map((file) => readFileSync(file, 'utf8')).join('\n');
    const required = [
        STAGING_HARDENING_TARGET.projectRef,
        STAGING_HARDENING_APPROVAL_ENV,
        STAGING_HARDENING_DB_URL_ENV,
        STAGING_HARDENING_MIGRATIONS[0].sha256,
        STAGING_HARDENING_MIGRATIONS[1].sha256,
        'BEGIN READ ONLY',
        'BEGIN;',
        'supabase_migrations.schema_migrations',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafe = [
        /postgres(?:ql)?:\/\/[^\s<]+:[^\s<]+@/iu,
        /SUPABASE_STAGING_DB_URL\s*=\s*postgres/iu,
        /vkkahxsybhbutszerawz/iu,
    ].filter((pattern) => pattern.test(combined));
    return {
        status: missing.length === 0 && unsafe.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifacts_no_secrets_and_exact_scope',
        message: missing.length === 0 && unsafe.length === 0
            ? 'Generated artifacts contain the exact target, hashes, gates, transaction/verification posture and no credential value.'
            : 'Generated artifacts are incomplete, contain a credential-shaped value or name forbidden production.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...unsafe.map((pattern) => `unsafePattern=${String(pattern)}`),
        ],
    };
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function toRelative(filePath: string): string {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}
