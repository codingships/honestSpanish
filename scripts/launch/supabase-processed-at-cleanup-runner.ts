import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus = 'PLAN_ONLY_RETIRED' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface TargetProject {
    environment: 'staging' | 'production';
    name: string;
    ref: string;
    envFile: string;
    region: string;
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
    closureStatus: ClosureStatus;
    outputDir: string;
    targetProjects: TargetProject[];
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWritePerformed: boolean;
    migrationFile: string;
    expectedSql: string;
    latestCleanupSummaryPath: string | null;
    latestCleanupManifestPath: string | null;
    latestCleanupApprovalPath: string | null;
    latestReadonlyPreflightPath: string | null;
    checks: Check[];
    captures: CommandCapture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterCleanupPath: string;
    manualEvidenceAfterCleanupPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterCleanup: string;
    manualEvidenceAfterCleanup: string;
    summary: string;
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

const approvalEnvVar = 'SUPABASE_PROCESSED_AT_CLEANUP_APPROVAL';
const exactApprovalSentence = 'Apruebo aplicar la migracion `20260703211451_drop_processed_webhook_processed_at_default` a Supabase staging `mzjyvmlxfpzdfdjzxxyj` primero, verificar read-only que `processed_webhook_events.processed_at` no tiene default y que los estados webhook siguen limpios, y si staging pasa, aplicarla a produccion `vkkahxsybhbutszerawz` y verificar read-only. No autorizo ningun otro cambio de Supabase ni servicios externos.';
const migrationFile = 'supabase/migrations/20260703211451_drop_processed_webhook_processed_at_default.sql';
const expectedSql = 'ALTER TABLE public.processed_webhook_events ALTER COLUMN processed_at DROP DEFAULT;';
const legacyExecutionRetired = true;
const replacementPlanCommand = 'pnpm launch:supabase-production-rollout -- --through processed_at_small_fix --preflight outputs/launch-supabase-production-readonly-preflight/<timestamp>/summary.json';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-supabase-processed-at-cleanup-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestCleanupSummaryPath = latestGeneratedPath('launch-supabase-processed-at-cleanup', 'summary.md');
const latestCleanupManifestPath = latestGeneratedPath('launch-supabase-processed-at-cleanup', 'supabase-processed-at-cleanup-manifest.json');
const latestCleanupApprovalPath = latestGeneratedPath('launch-supabase-processed-at-cleanup', 'approval-request.md');
const latestReadonlyPreflightPath = latestGeneratedPath('supabase-processed-at-readonly-preflight', 'summary.md');

const captures: CommandCapture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateMigrationScope(),
    validateCleanupPackage(),
    validateReadonlyPreflight(),
    validateApprovalGateSource(),
    validateForbiddenScopeSource(),
];

if (executeRequested && legacyExecutionRetired) {
    checks.push({
        status: 'failed',
        name: 'legacy_execution_retired',
        message: 'This legacy runner is permanently fail-closed for external writes. Use the source-bound production rollout wave instead.',
        details: [
            'externalWritePerformed=false',
            `replacement=${replacementPlanCommand}`,
            'staging already has migration 20260703211451 and must not be reapplied by this runner',
        ],
    });
} else if (executeRequested && !approvalMatched) {
    checks.push({
        status: 'failed',
        name: 'exact_approval_gate',
        message: 'Execution was requested but the exact approval gate did not match, so no Supabase write can run.',
        details: [
            `env=${approvalEnvVar}`,
            'required=exact sentence in approval-gate.md',
            'externalWritePerformed=false',
        ],
    });
} else if (executeRequested && approvalMatched) {
    checks.push(...runApprovedExecution(captures));
} else {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_external_write',
        message: 'Plan mode generated the Supabase cleanup runner package without connecting to Supabase or applying SQL.',
        details: [
            'executeRequested=false',
            'externalWritePerformed=false',
            `futureGate=${approvalEnvVar}`,
            'futureFlag=--execute-approved',
        ],
    });
}

let report = createReport(checks, captures);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks, captures);
rendered = renderArtifacts(report);

writeFileSync(report.commandManifestPath, rendered.commandManifest, 'utf8');
writeFileSync(report.executionPlanPath, rendered.executionPlan, 'utf8');
writeFileSync(report.approvalGatePath, rendered.approvalGate, 'utf8');
writeFileSync(report.rollbackAfterCleanupPath, rendered.rollbackAfterCleanup, 'utf8');
writeFileSync(report.manualEvidenceAfterCleanupPath, rendered.manualEvidenceAfterCleanup, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:supabase-processed-at-cleanup-runner] Status: ${report.status}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Closure: ${report.closureStatus}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Failed: ${failed.length}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Warnings: ${warnings.length}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] External write performed: ${report.externalWritePerformed}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Summary: ${report.summaryPath}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Execution plan: ${report.executionPlanPath}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Approval gate: ${report.approvalGatePath}`);
console.log(`[launch:supabase-processed-at-cleanup-runner] Rollback: ${report.rollbackAfterCleanupPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: Check[], reportCaptures: CommandCapture[]): RunnerReport {
    const reportStatus = statusFor(reportChecks);
    const externalWritePerformed = reportCaptures.some((capture) => capture.writesSupabase && capture.status === 'ok');

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        closureStatus: reportStatus === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : 'PLAN_ONLY_RETIRED',
        outputDir,
        targetProjects,
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWritePerformed,
        migrationFile,
        expectedSql,
        latestCleanupSummaryPath,
        latestCleanupManifestPath,
        latestCleanupApprovalPath,
        latestReadonlyPreflightPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'processed-at-cleanup-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'processed-at-cleanup-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterCleanupPath: path.join(outputDir, 'rollback-after-cleanup.md'),
        manualEvidenceAfterCleanupPath: path.join(outputDir, 'manual-evidence-after-cleanup.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_script_supabase_cleanup_runner',
            message: 'package.json is missing.',
            details: [packagePath],
        };
    }

    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };
    const missing: string[] = [];
    if (packageJson.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson.scripts?.['launch:supabase-processed-at-cleanup-runner'] !== 'tsx scripts/launch/supabase-processed-at-cleanup-runner.ts') {
        missing.push('launch:supabase-processed-at-cleanup-runner=tsx scripts/launch/supabase-processed-at-cleanup-runner.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_supabase_cleanup_runner',
        message: missing.length === 0
            ? 'Package scripts expose the gated Supabase processed_at cleanup runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Supabase processed_at cleanup runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:supabase-processed-at-cleanup-runner'] : missing.map((item) => `missing=${item}`),
    };
}

function validateMigrationScope(): Check {
    if (!existsSync(migrationFile)) {
        return {
            status: 'failed',
            name: 'migration_scope_exact',
            message: 'The processed_at cleanup migration file is missing.',
            details: [migrationFile],
        };
    }

    const migration = normalizeSql(readFileSync(migrationFile, 'utf8'));
    const matches = migration === expectedSql;
    const forbidden = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+|CREATE\s+)\b/i.test(migration);

    return {
        status: matches && !forbidden ? 'ok' : 'failed',
        name: 'migration_scope_exact',
        message: matches && !forbidden
            ? 'Migration scope is exactly the DROP DEFAULT statement and contains no broad destructive/write SQL.'
            : 'Migration scope is not the exact approved DROP DEFAULT statement.',
        details: matches && !forbidden
            ? [`file=${migrationFile}`, `sql=${expectedSql}`]
            : [`expected=${expectedSql}`, `actual=${migration}`, `forbiddenBroadWrite=${String(forbidden)}`],
    };
}

function validateCleanupPackage(): Check {
    if (!latestCleanupSummaryPath || !existsSync(latestCleanupSummaryPath) || !latestCleanupManifestPath || !existsSync(latestCleanupManifestPath) || !latestCleanupApprovalPath || !existsSync(latestCleanupApprovalPath)) {
        return {
            status: 'failed',
            name: 'cleanup_package_exists',
            message: 'The Supabase processed_at cleanup package must exist before using the runner.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-cleanup'],
        };
    }

    const approval = readFileSync(latestCleanupApprovalPath, 'utf8');
    const manifest = readFileSync(latestCleanupManifestPath, 'utf8');
    const required = [
        migrationFile,
        'mzjyvmlxfpzdfdjzxxyj',
        'vkkahxsybhbutszerawz',
        expectedSql,
        'processed_at_small_fix',
        'legacy staging-first approval is retired',
        'No Cloudflare, Stripe, Google, Resend, Sentry, DNS, Pages or Worker writes.',
    ];
    const missing = required.filter((snippet) => !approval.includes(snippet) && !manifest.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'cleanup_package_exists',
        message: missing.length === 0
            ? 'Latest cleanup package contains the exact migration, target projects, source-bound replacement and forbidden scope.'
            : 'Latest cleanup package is missing required scope or retirement/replacement facts.',
        details: missing.length === 0
            ? [`summary=${latestCleanupSummaryPath}`, `manifest=${latestCleanupManifestPath}`, `approval=${latestCleanupApprovalPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateReadonlyPreflight(): Check {
    if (!latestReadonlyPreflightPath || !existsSync(latestReadonlyPreflightPath)) {
        return {
            status: 'failed',
            name: 'readonly_preflight_exists',
            message: 'Fresh Supabase processed_at read-only preflight is missing.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-readonly-preflight'],
        };
    }

    const preflight = readFileSync(latestReadonlyPreflightPath, 'utf8');
    const required = [
        '# Supabase processed_at read-only preflight refresh',
        'Mode: read-only metadata/aggregate queries only; no migration applied.',
        'staging | espanol-staging | mzjyvmlxfpzdfdjzxxyj',
        'production | espanol-honesto | vkkahxsybhbutszerawz',
        'processed_at_default=<NULL>',
        'processed_at_default=now()',
        '"invalid_status":0',
        '"null_status":0',
        '"processing_with_processed_at":0',
        'production_processed_at_default',
        'Strict-QA blocker must remain open',
    ];
    const missing = required.filter((snippet) => !preflight.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'readonly_preflight_exists',
        message: missing.length === 0
            ? 'Latest read-only preflight proves expected staging/production drift and clean webhook aggregate state before any apply.'
            : 'Latest read-only preflight is missing required target/drift/aggregate facts.',
        details: missing.length === 0 ? [`preflight=${latestReadonlyPreflightPath}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateApprovalGateSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'supabase-processed-at-cleanup-runner.ts');
    const source = readIfExists(sourcePath);
    if (!source) {
        return {
            status: 'failed',
            name: 'approval_gate_source',
            message: 'Cannot validate this runner source file.',
            details: [sourcePath],
        };
    }

    const required = [
        approvalEnvVar,
        '--execute-approved',
        'const exactApprovalSentence =',
        'const legacyExecutionRetired = true',
        'const replacementPlanCommand =',
        'if (executeRequested && legacyExecutionRetired)',
        'executeRequested && !approvalMatched',
        'externalWritePerformed=false',
        'runApprovedExecution',
        'staging_verify_after_apply',
        'production_apply_after_staging_verified',
        'production_verify_after_apply',
        'SUPABASE_DB_URL',
        expectedSql,
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source places the permanent retirement guard before its historical approval/execution code and points to the source-bound replacement.'
            : 'Runner source is missing the permanent retirement guard or source-bound replacement facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'supabase-processed-at-cleanup-runner.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = [
        'No supabase db push',
        'No row/user/Auth/Storage/API-setting changes',
        'No service key or database URL evidence',
        'No Cloudflare, Stripe, Google, Resend, Sentry, Turnstile, DNS, Pages or Worker writes',
        'No email sending, Google event creation, Stripe session creation or final smoke',
        'No project/table/row/user/storage deletion',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    const commandDisplays = commandManifestDisplays().join('\n');
    const forbiddenCommands = [
        'supabase db push',
        'supabase migration repair',
        'DROP TABLE',
        'DELETE FROM',
        'TRUNCATE',
    ].filter((snippet) => commandDisplays.includes(snippet));

    return {
        status: missing.length === 0 && forbiddenCommands.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && forbiddenCommands.length === 0
            ? 'Runner source keeps cleanup limited to the exact migration and documents forbidden Supabase/provider scope.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden command snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...forbiddenCommands.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function runApprovedExecution(reportCaptures: CommandCapture[]): Check[] {
    const executionChecks: Check[] = [{
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact approval sentence matched; running only the processed_at cleanup sequence.',
        details: [
            `env=${approvalEnvVar}`,
            'staging=mzjyvmlxfpzdfdjzxxyj',
            'production=vkkahxsybhbutszerawz',
        ],
    }];

    const cleanupPack = runPnpmCommand('cleanup_package_refresh', 'corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-cleanup', ['pnpm', '--config.verify-deps-before-run=false', 'launch:supabase-processed-at-cleanup'], false);
    reportCaptures.push(cleanupPack);
    executionChecks.push(checkForCapture(cleanupPack));
    if (cleanupPack.status === 'failed') return executionChecks;

    const readonlyBefore = runPnpmCommand('readonly_preflight_before_apply', 'corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-readonly-preflight', ['pnpm', '--config.verify-deps-before-run=false', 'launch:supabase-processed-at-readonly-preflight'], false);
    reportCaptures.push(readonlyBefore);
    executionChecks.push(checkForCapture(readonlyBefore));
    if (readonlyBefore.status === 'failed') return executionChecks;

    const staging = targetProjects.find((target) => target.environment === 'staging');
    const production = targetProjects.find((target) => target.environment === 'production');
    if (!staging || !production) {
        executionChecks.push({
            status: 'failed',
            name: 'target_projects_available',
            message: 'Staging or production target definition is missing.',
            details: [],
        });
        return executionChecks;
    }

    const stagingApply = runPsqlForTarget(staging, 'staging_apply_exact_migration', migrationFile, true);
    reportCaptures.push(stagingApply);
    executionChecks.push(checkForCapture(stagingApply));
    if (stagingApply.status === 'failed') return executionChecks;

    const stagingVerify = runPsqlForTarget(staging, 'staging_verify_after_apply', latestGeneratedPath('launch-supabase-processed-at-cleanup', 'post-apply-verification.sql') ?? '', false);
    reportCaptures.push(stagingVerify);
    executionChecks.push(checkForCapture(stagingVerify));
    const stagingVerified = verifyPostApplyCapture(stagingVerify);
    executionChecks.push({
        status: stagingVerified ? 'ok' : 'failed',
        name: 'staging_verified_before_production',
        message: stagingVerified
            ? 'Staging verification shows cleanup migration present, no processed_at default and clean webhook aggregate state.'
            : 'Staging verification did not prove cleanup success; production apply was not run.',
        details: [`capture=${stagingVerify.path}`],
    });
    if (!stagingVerified) return executionChecks;

    const productionApply = runPsqlForTarget(production, 'production_apply_after_staging_verified', migrationFile, true);
    reportCaptures.push(productionApply);
    executionChecks.push(checkForCapture(productionApply));
    if (productionApply.status === 'failed') return executionChecks;

    const productionVerify = runPsqlForTarget(production, 'production_verify_after_apply', latestGeneratedPath('launch-supabase-processed-at-cleanup', 'post-apply-verification.sql') ?? '', false);
    reportCaptures.push(productionVerify);
    executionChecks.push(checkForCapture(productionVerify));
    const productionVerified = verifyPostApplyCapture(productionVerify);
    executionChecks.push({
        status: productionVerified ? 'ok' : 'failed',
        name: 'production_verified_after_apply',
        message: productionVerified
            ? 'Production verification shows cleanup migration present, no processed_at default and clean webhook aggregate state.'
            : 'Production verification did not prove cleanup success; strict-QA finding must remain open.',
        details: [`capture=${productionVerify.path}`],
    });

    return executionChecks;
}

function runPnpmCommand(id: string, display: string, args: string[], writesSupabase: boolean): CommandCapture {
    const result = spawnSync('corepack', args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: false,
        timeout: 120000,
        env: process.env,
        windowsHide: true,
    });

    return writeCapture(id, display, writesSupabase, result.status, result.stdout ?? '', result.stderr ?? '', result.error);
}

function runPsqlForTarget(target: TargetProject, id: string, sqlFile: string, writesSupabase: boolean): CommandCapture {
    const display = `psql ${target.environment} ${target.ref} -f ${sqlFile || '<missing-sql-file>'}`;
    if (!sqlFile || !existsSync(sqlFile)) {
        return writeCapture(id, display, writesSupabase, null, '', `Missing SQL file: ${sqlFile || '<empty>'}`, undefined);
    }

    if (!existsSync(target.envFile)) {
        return writeCapture(id, display, writesSupabase, null, '', `Missing env file: ${target.envFile}`, undefined);
    }

    const dbUrl = readEnvValue(target.envFile, 'SUPABASE_DB_URL');
    const databaseEnv = dbUrl ? buildPsqlEnv(dbUrl) : null;
    if (!databaseEnv) {
        return writeCapture(id, display, writesSupabase, null, '', `Missing or invalid SUPABASE_DB_URL in ${target.envFile}`, undefined);
    }

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
        env: {
            ...process.env,
            ...databaseEnv,
            PGSSLMODE: 'require',
            PGCONNECT_TIMEOUT: '10',
            PGOPTIONS: writesSupabase
                ? '-c statement_timeout=15000 -c lock_timeout=5000'
                : '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000',
        },
        encoding: 'utf8',
        timeout: 30000,
        windowsHide: true,
    });

    return writeCapture(id, display, writesSupabase, result.status, result.stdout ?? '', result.stderr ?? '', result.error);
}

function writeCapture(
    id: string,
    display: string,
    writesSupabase: boolean,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    error: Error | undefined,
): CommandCapture {
    const status: CheckStatus = exitCode === 0 && !error ? 'ok' : 'failed';
    const capturePath = path.join(outputDir, `${id}.txt`);
    const body = [
        `command=${display}`,
        `writesSupabase=${String(writesSupabase)}`,
        `exitCode=${String(exitCode)}`,
        `error=${error ? safeErrorMessage(error) : 'none'}`,
        '',
        '## stdout',
        '',
        sanitizeOutput(stdout) || '(empty)',
        '',
        '## stderr',
        '',
        sanitizeOutput(stderr) || '(empty)',
        '',
    ].join('\n');
    writeFileSync(capturePath, body, 'utf8');

    return {
        id,
        display,
        path: capturePath,
        exitCode,
        status,
        writesSupabase,
    };
}

function checkForCapture(capture: CommandCapture): Check {
    return {
        status: capture.status,
        name: `command_${capture.id}`,
        message: capture.status === 'ok'
            ? `Command completed: ${capture.display}`
            : `Command failed or timed out: ${capture.display}`,
        details: [
            `capture=${capture.path}`,
            `exitCode=${String(capture.exitCode)}`,
            `writesSupabase=${String(capture.writesSupabase)}`,
        ],
    };
}

function verifyPostApplyCapture(capture: CommandCapture): boolean {
    if (capture.status !== 'ok') return false;
    const body = readFileSync(capture.path, 'utf8');
    return body.includes('20260703211451')
        && !body.includes('now()')
        && body.includes('0')
        && !body.includes('invalid_status":1')
        && !body.includes('null_status":1')
        && !body.includes('processing_with_processed_at":1');
}

function renderArtifacts(report: RunnerReport): RenderedArtifacts {
    const commandManifest = `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        mode: report.executeRequested ? 'execute-approved' : 'plan',
        approvalEnvVar: report.approvalEnvVar,
        approvalMatched: report.approvalMatched,
        externalWritePerformed: report.externalWritePerformed,
        exactApprovalSentence,
        targetProjects: report.targetProjects,
        migrationFile: report.migrationFile,
        expectedSql: report.expectedSql,
        commands: commandManifestDisplays().map((display) => ({ display })),
        sourceEvidence: {
            cleanupSummary: toRelativeOrNull(report.latestCleanupSummaryPath),
            cleanupManifest: toRelativeOrNull(report.latestCleanupManifestPath),
            cleanupApproval: toRelativeOrNull(report.latestCleanupApprovalPath),
            readonlyPreflight: toRelativeOrNull(report.latestReadonlyPreflightPath),
        },
        captures: report.captures.map((capture) => ({
            id: capture.id,
            path: toRelative(capture.path),
            exitCode: capture.exitCode,
            status: capture.status,
            writesSupabase: capture.writesSupabase,
        })),
        forbiddenScope: forbiddenScopeLines(),
    }, null, 2)}\n`;

    const executionPlan = `${[
        '# Supabase processed_at Cleanup Execution Plan',
        '',
        'This is a historical compatibility package. Its external-write path is retired and permanently fail-closed because staging already contains migration `20260703211451` and the source-bound production rollout now owns the remaining production change.',
        '',
        '## Current Mode',
        '',
        `- Execute requested: ${String(report.executeRequested)}.`,
        `- Approval matched: ${String(report.approvalMatched)}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        '',
        '## Targets',
        '',
        '| Environment | Project | Ref | Region | Env file |',
        '| --- | --- | --- | --- | --- |',
        ...report.targetProjects.map((target) => `| ${target.environment} | ${target.name} | ${target.ref} | ${target.region} | ${target.envFile} |`),
        '',
        '## Evidence To Review First',
        '',
        `- Cleanup package summary: ${toRelativeOrFallback(report.latestCleanupSummaryPath, 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/summary.md')}`,
        `- Cleanup manifest: ${toRelativeOrFallback(report.latestCleanupManifestPath, 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/supabase-processed-at-cleanup-manifest.json')}`,
        `- Approval request: ${toRelativeOrFallback(report.latestCleanupApprovalPath, 'outputs/launch-supabase-processed-at-cleanup/<timestamp>/approval-request.md')}`,
        `- Read-only preflight: ${toRelativeOrFallback(report.latestReadonlyPreflightPath, 'outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md')}`,
        '',
        '## Safe Replacement Commands',
        '',
        '```bash',
        ...commandManifestDisplays(),
        '```',
        '',
        '## Execution Retirement',
        '',
        '- Do not execute this legacy runner. Passing `--execute-approved` fails before any network or SQL command.',
        '- Generate a fresh production read-only preflight, then use the source-bound `processed_at_small_fix` wave either alone or as the first wave of the complete 25-migration rollout.',
        `- Replacement plan command: \`${replacementPlanCommand}\`.`,
        '- The replacement runner generates a scope-bound approval sentence, records exact migration history and verifies source SHA-256 plus schema effect.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if staging verification does not show migration `20260703211451`, `processed_at` without default and clean webhook aggregate counts.',
        '- Stop if the target project ref differs from `mzjyvmlxfpzdfdjzxxyj` or `vkkahxsybhbutszerawz`.',
        '- Stop if migration tooling proposes any migration outside `20260703211451`.',
        '- Stop if output would expose database URLs, passwords, service role keys, JWTs, private rows or personal data.',
        '',
    ].join('\n')}\n`;

    const approvalGate = `${[
        '# Supabase processed_at Legacy Runner Retirement Gate',
        '',
        'This file is not approval. No approval sentence can make this legacy runner write to Supabase; its execute path is retired and fail-closed.',
        '',
        `- Environment variable: \`${approvalEnvVar}\`.`,
        '- Required flag: `--execute-approved`.',
        `- Execute requested in this run: ${String(report.executeRequested)}.`,
        `- Approval matched in this run: ${String(report.approvalMatched)}.`,
        `- External write performed in this run: ${String(report.externalWritePerformed)}.`,
        '',
        '## Historical Approval Sentence (Not Executable)',
        '',
        exactApprovalSentence,
        '',
        '## Allowed Scope',
        '',
        '- Generate local/read-only evidence only.',
        `- Use \`${replacementPlanCommand}\` to prepare the current production-only wave.`,
        '- Execute only the replacement production rollout runner under its fresh, hash-bound exact approval.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;

    const rollbackAfterCleanup = `${[
        '# Supabase processed_at Cleanup Rollback',
        '',
        'This legacy runner cannot apply the cleanup migration. It does not authorize rollback writes.',
        '',
        '## If Plan Mode Was Used',
        '',
        '- No rollback is required; this package generated local evidence only.',
        '',
        '## If Legacy Execution Is Requested',
        '',
        '- The runner fails before network access or SQL; no rollback is required.',
        '- Generate a fresh production preflight and use the replacement rollout wave.',
        '',
        '## If Production Apply Or Verification Fails',
        '',
        '- Keep the strict-QA finding open.',
        '- Use the replacement rollout receipt/captures and run fresh read-only aggregate checks.',
        '- If a verified incident requires restoring the prior default, use the generated rollback SQL with separate exact approval naming production `vkkahxsybhbutszerawz`.',
        '',
    ].join('\n')}\n`;

    const manualEvidenceAfterCleanup = `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id database_readiness',
        '  --status pass',
        '  --summary "Supabase production processed_at rollout wave applied under exact source-bound approval; fresh read-only verification confirms no default and clean webhook aggregate counts."',
        '  --environment "Supabase production vkkahxsybhbutszerawz; staging mzjyvmlxfpzdfdjzxxyj already verified"',
        '  --owner Alin',
        `  --evidence "command_output=../../${toRelative(report.summaryPath)}::legacy runner retirement verified; externalWritePerformed=false"`,
        '  --evidence "command_output=../../outputs/launch-supabase-production-rollout-runner/<timestamp>/summary.json::replacement rollout receipt reviewed"',
        '  --evidence "command_output=../../outputs/supabase-processed-at-readonly-preflight/<timestamp>/summary.md::post-rollout staging/production defaults and webhook aggregates verified"',
        '  --evidence "manual_note=Replace with actual non-secret replacement rollout and tracker/status refresh evidence."',
        '',
        '# Add --write only after the approved cleanup actually runs and placeholder evidence is replaced.',
        '',
    ].join(' \\\n')}`;

    const summary = renderSummary(report);

    return {
        commandManifest,
        executionPlan,
        approvalGate,
        rollbackAfterCleanup,
        manualEvidenceAfterCleanup,
        summary,
    };
}

function renderSummary(report: RunnerReport): string {
    const lines = [
        '# Supabase processed_at Cleanup Runner Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Generated: ${report.endedAt}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterCleanupPath)}`,
        `- Manual evidence template: ${toRelative(report.manualEvidenceAfterCleanupPath)}`,
        '',
        'This legacy runner is permanently fail-closed for external writes. `--execute-approved` fails before network or SQL. Use the source-bound production rollout `processed_at_small_fix` wave; plan mode here only produces compatibility evidence.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / ') || '-')} |`),
        '',
    ];

    if (report.captures.length > 0) {
        lines.push(
            '## Captures',
            '',
            '| Status | Command | Writes Supabase | Path |',
            '| --- | --- | --- | --- |',
            ...report.captures.map((capture) => `| ${capture.status} | ${escapeCell(capture.display)} | ${String(capture.writesSupabase)} | ${escapeCell(toRelative(capture.path))} |`),
            '',
        );
    }

    return `${lines.join('\n')}\n`;
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const required = [
        'External write performed',
        approvalEnvVar,
        exactApprovalSentence,
        expectedSql,
        'fail-closed',
        replacementPlanCommand,
        'No supabase db push',
        'No service key or database URL evidence',
        'No Cloudflare, Stripe, Google, Resend, Sentry, Turnstile, DNS, Pages or Worker writes',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafe = [
        'postgres://',
        'postgresql://',
        'sb_secret_',
        'SUPABASE_SERVICE_ROLE_KEY=',
    ].filter((snippet) => combined.includes(snippet));

    return {
        status: missing.length === 0 && unsafe.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && unsafe.length === 0
            ? 'Generated runner artifacts preserve exact approval gate, scope, rollback and no-secret posture.'
            : 'Generated runner artifacts are missing gate/scope facts or include unsafe snippets.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...unsafe.map((snippet) => `unsafe=${snippet}`),
        ],
    };
}

function commandManifestDisplays(): string[] {
    return [
        'pnpm launch:supabase-processed-at-cleanup',
        'pnpm launch:supabase-processed-at-readonly-preflight',
        'pnpm launch:supabase-production-readonly-preflight',
        replacementPlanCommand,
    ];
}

function forbiddenScopeLines(): string[] {
    return [
        'No supabase db push.',
        'No external write through this retired legacy runner.',
        'No migration outside `20260703211451_drop_processed_webhook_processed_at_default`.',
        'No row/user/Auth/Storage/API-setting changes.',
        'No service key or database URL evidence.',
        'No project/table/row/user/storage deletion.',
        'No Cloudflare, Stripe, Google, Resend, Sentry, Turnstile, DNS, Pages or Worker writes.',
        'No email sending, Google event creation, Stripe session creation or final smoke.',
    ];
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
        const env: NodeJS.ProcessEnv = {
            PGHOST: parsed.hostname,
            PGUSER: decodeURIComponent(parsed.username),
            PGPASSWORD: decodeURIComponent(parsed.password),
            PGDATABASE: parsed.pathname.replace(/^\//u, ''),
        };
        if (parsed.port) env.PGPORT = parsed.port;
        return env;
    } catch {
        return null;
    }
}

function normalizeSql(sql: string): string {
    return sql
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/--.*$/u, '').trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function readIfExists(filePath: string): string | null {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();

    return candidates[0] ?? null;
}

function toRelative(filePath: string): string {
    return toPosix(path.relative(process.cwd(), filePath));
}

function toRelativeOrNull(filePath: string | null): string | null {
    return filePath ? toRelative(filePath) : null;
}

function toRelativeOrFallback(filePath: string | null, fallback: string): string {
    return filePath ? toRelative(filePath) : fallback;
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function sanitizeOutput(value: string): string {
    return value
        .replace(/(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/giu, '$1://[redacted-user]:[redacted-password]@')
        .replace(/sb_secret_[A-Za-z0-9_-]{20,}/g, 'sb_secret_[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [redacted]')
        .replace(/service_role[_=:\s]+[A-Za-z0-9._-]{20,}/gi, 'service_role=[redacted]');
}

function safeErrorMessage(error: Error): string {
    return sanitizeOutput(error.message).replace(/\r?\n/g, ' ').slice(0, 500);
}
