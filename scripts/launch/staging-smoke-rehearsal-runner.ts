import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus = 'PLAN_ONLY_READY' | 'EXECUTED_AND_NEEDS_REVIEW' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface Capture {
    id: string;
    display: string;
    path: string;
    exitCode: number | null;
    status: CheckStatus;
    externalWriteCommandStarted: boolean;
}

interface RunnerReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: ClosureStatus;
    outputDir: string;
    baseUrl: string;
    confirmation: string;
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWriteCommandStarted: boolean;
    requiredEnvNames: string[];
    envSourceMatrix: EnvSourceRow[];
    latestFinalSmokePackSummaryPath: string | null;
    latestStagingApprovalPath: string | null;
    latestStagingPreflightPath: string | null;
    checks: Check[];
    captures: Capture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterStagingSmokePath: string;
    manualEvidenceAfterStagingSmokePath: string;
    summaryPath: string;
}

interface EnvSourceRow {
    name: string;
    preferredSource: '.env.staging' | '.env' | 'generated';
    presentInStaging: boolean;
    presentInEnv: boolean;
    providedByRunner: boolean;
    requiredFor: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterStagingSmoke: string;
    manualEvidenceAfterStagingSmoke: string;
    summary: string;
}

const approvalEnvVar = 'STAGING_SMOKE_REHEARSAL_APPROVAL';
const baseUrl = 'https://staging.espanolhonesto.com';
const confirmation = 'writes-ok:staging.espanolhonesto.com';
const exactApprovalSentence = 'Apruebo ejecutar un smoke rehearsal de staging con writes externos contra `SMOKE_BASE_URL=https://staging.espanolhonesto.com`, con `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:staging.espanolhonesto.com`, usando solo credenciales de smoke/admin/profesor del origen seguro aprobado, con Stripe test mode, permitiendo unicamente writes de smoke necesarios en Supabase staging, Stripe test, Google, Resend y Admin Jobs, sin imprimir secretos, sin guardar datos privados en evidencia, sin resetear contrasenas de admin/profesor, sin activar pagos reales, sin cambiar Cloudflare/DNS/dominios y con rollback/cleanup segun `rollback-and-cleanup-plan.md`. No autorizo ningun otro cambio externo.';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;

const envNameRows: EnvSourceRow[] = [
    row('PUBLIC_SUPABASE_URL', '.env.staging', 'Supabase staging API'),
    row('PUBLIC_SUPABASE_ANON_KEY', '.env.staging', 'Supabase staging browser auth'),
    row('SUPABASE_SERVICE_ROLE_KEY', '.env.staging', 'Supabase staging smoke setup/verification'),
    row('RESEND_API_KEY', '.env.staging', 'Resend staging/test email flow'),
    row('RESEND_FROM_EMAIL', '.env.staging', 'Resend sender identity'),
    row('STRIPE_SECRET_KEY', '.env', 'Stripe test-mode checkout/webhook smoke'),
    row('STRIPE_WEBHOOK_SECRET', '.env', 'Stripe test-mode webhook simulation'),
    row('CRON_SECRET', '.env', 'Reminder cron smoke authorization'),
    row('GOOGLE_SERVICE_ACCOUNT_EMAIL', '.env', 'Google Workspace staging smoke'),
    row('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', '.env', 'Google Workspace staging smoke'),
    row('GOOGLE_ADMIN_EMAIL', '.env', 'Google Workspace DWD subject'),
    row('GOOGLE_DRIVE_ROOT_FOLDER_ID', '.env', 'Google Drive folder/doc smoke'),
    row('GOOGLE_TEMPLATE_DOC_ID', '.env', 'Google Docs template smoke'),
    row('SMOKE_ADMIN_EMAIL', '.env.staging', 'mapped from TEST_ADMIN_EMAIL unless already provided'),
    row('SMOKE_ADMIN_PASSWORD', '.env.staging', 'mapped from TEST_ADMIN_PASSWORD unless already provided'),
    row('SMOKE_TEACHER_EMAIL', '.env.staging', 'mapped from TEST_TEACHER_EMAIL unless already provided'),
    row('SMOKE_TEACHER_PASSWORD', '.env.staging', 'mapped from TEST_TEACHER_PASSWORD unless already provided'),
    row('SMOKE_BASE_URL', 'generated', 'fixed staging origin'),
    row('SMOKE_EXTERNAL_WRITES_CONFIRMATION', 'generated', 'fixed staging writes-ok host confirmation'),
];

const requiredEnvNames = envNameRows.map((item) => item.name);
const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-staging-smoke-rehearsal-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestFinalSmokePackSummaryPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'summary.md');
const latestStagingApprovalPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-staging-smoke.md');
const latestStagingPreflightPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'staging-preflight-checklist.md');
const captures: Capture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateSmokeHarness(),
    validateFinalSmokePackArtifacts(),
    validateEnvSources(),
    validateApprovalGateSource(),
];

if (executeRequested && !approvalMatched) {
    checks.push({
        status: 'failed',
        name: 'exact_approval_gate',
        message: 'Execution was requested but the exact staging smoke approval did not match, so no write-capable smoke can run.',
        details: [`env=${approvalEnvVar}`, 'required=exact sentence in approval-gate.md', 'externalWriteCommandStarted=false'],
    });
} else if (executeRequested && approvalMatched) {
    checks.push(...runApprovedExecution(captures));
} else {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_external_write',
        message: 'Plan mode generated the staging smoke runner package without running the write-capable smoke.',
        details: ['executeRequested=false', 'externalWriteCommandStarted=false', `futureGate=${approvalEnvVar}`, 'futureFlag=--execute-approved'],
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
writeFileSync(report.rollbackAfterStagingSmokePath, rendered.rollbackAfterStagingSmoke, 'utf8');
writeFileSync(report.manualEvidenceAfterStagingSmokePath, rendered.manualEvidenceAfterStagingSmoke, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:staging-smoke-rehearsal-runner] Status: ${report.status}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Closure: ${report.closureStatus}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Failed: ${failed.length}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Warnings: ${warnings.length}`);
console.log(`[launch:staging-smoke-rehearsal-runner] External write command started: ${report.externalWriteCommandStarted}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Summary: ${report.summaryPath}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Execution plan: ${report.executionPlanPath}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Approval gate: ${report.approvalGatePath}`);
console.log(`[launch:staging-smoke-rehearsal-runner] Rollback: ${report.rollbackAfterStagingSmokePath}`);

if (failed.length > 0) process.exit(1);

function row(name: string, preferredSource: EnvSourceRow['preferredSource'], requiredFor: string): EnvSourceRow {
    return {
        name,
        preferredSource,
        presentInStaging: false,
        presentInEnv: false,
        providedByRunner: preferredSource === 'generated',
        requiredFor,
    };
}

function createReport(reportChecks: Check[], reportCaptures: Capture[]): RunnerReport {
    const status = statusFor(reportChecks);
    const externalWriteCommandStarted = reportCaptures.some((capture) => capture.externalWriteCommandStarted);

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        closureStatus: status === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : executeRequested
                ? 'EXECUTED_AND_NEEDS_REVIEW'
                : 'PLAN_ONLY_READY',
        outputDir,
        baseUrl,
        confirmation,
        approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWriteCommandStarted,
        requiredEnvNames,
        envSourceMatrix: buildEnvSourceMatrix(),
        latestFinalSmokePackSummaryPath,
        latestStagingApprovalPath,
        latestStagingPreflightPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'staging-smoke-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'staging-smoke-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterStagingSmokePath: path.join(outputDir, 'rollback-after-staging-smoke.md'),
        manualEvidenceAfterStagingSmokePath: path.join(outputDir, 'manual-evidence-after-staging-smoke.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) return failedCheck('package_script_staging_smoke_runner', 'package.json is missing.', [packagePath]);

    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { packageManager?: string; scripts?: Record<string, string> };
    const missing: string[] = [];
    if (packageJson.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson.scripts?.['launch:staging-smoke-rehearsal-runner'] !== 'tsx scripts/launch/staging-smoke-rehearsal-runner.ts') {
        missing.push('launch:staging-smoke-rehearsal-runner=tsx scripts/launch/staging-smoke-rehearsal-runner.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_staging_smoke_runner',
        message: missing.length === 0
            ? 'Package scripts expose the gated staging smoke rehearsal runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated staging smoke rehearsal runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:staging-smoke-rehearsal-runner'] : missing.map((item) => `missing=${item}`),
    };
}

function validateSmokeHarness(): Check {
    const smokePath = path.join('scripts', 'smoke', 'real-env-smoke.ts');
    if (!existsSync(smokePath)) return failedCheck('real_env_smoke_harness_contract', 'The real environment smoke harness is missing.', [smokePath]);

    const source = readFileSync(smokePath, 'utf8');
    const required = [
        "requireEnv('SMOKE_BASE_URL')",
        "requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')",
        "requireEnv('SMOKE_ADMIN_EMAIL')",
        "requireEnv('SMOKE_ADMIN_PASSWORD')",
        "requireEnv('SMOKE_TEACHER_EMAIL')",
        "requireEnv('SMOKE_TEACHER_PASSWORD')",
        'writes-ok:${parsedUrl.host}',
        'redactSmokeResult(result)',
        'writeSmokeEvidence',
        'runAdminJobsRecoverySmoke',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'real_env_smoke_harness_contract',
        message: missing.length === 0
            ? 'Real environment smoke harness has exact host confirmation, explicit credentials, redaction and Admin Jobs coverage.'
            : 'Real environment smoke harness is missing required staging runner contract snippets.',
        details: missing.length === 0 ? [smokePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateFinalSmokePackArtifacts(): Check {
    if (!latestStagingApprovalPath || !latestStagingPreflightPath || !latestFinalSmokePackSummaryPath) {
        return {
            status: 'warning',
            name: 'staging_smoke_pack_artifacts',
            message: 'Latest staging smoke approval/preflight artifacts are missing.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:final-smoke-execution-pack'],
        };
    }

    const approval = readFileSync(latestStagingApprovalPath, 'utf8');
    const preflight = readFileSync(latestStagingPreflightPath, 'utf8');
    const summary = readFileSync(latestFinalSmokePackSummaryPath, 'utf8');
    const required = [
        exactApprovalSentence,
        'READY_FOR_STAGING_SMOKE_APPROVAL',
        'Stripe test mode',
        'No Cloudflare deploy/domain/DNS writes',
        'Do not use this rehearsal alone to mark `final_smoke` pass.',
    ];
    const combined = [approval, preflight, summary].join('\n');
    const missing = required.filter((snippet) => !combined.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'staging_smoke_pack_artifacts',
        message: missing.length === 0
            ? 'Latest staging smoke pack artifacts contain exact approval, readiness and no-final-smoke-closure boundaries.'
            : 'Latest staging smoke pack artifacts are missing required scope or approval facts.',
        details: missing.length === 0
            ? [`summary=${latestFinalSmokePackSummaryPath}`, `approval=${latestStagingApprovalPath}`, `preflight=${latestStagingPreflightPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateEnvSources(): Check {
    const stagingEnv = parseEnvFile('.env.staging');
    const baseEnv = parseEnvFile('.env');
    const matrix = buildEnvSourceMatrix(stagingEnv, baseEnv);
    const missing = matrix.filter((item) => !resolveEnvName(item.name, stagingEnv, baseEnv) && !item.providedByRunner);
    const stripeSecret = resolveEnvName('STRIPE_SECRET_KEY', stagingEnv, baseEnv);
    const stripeMode = stripeSecret?.startsWith('sk_test_')
        ? 'test'
        : stripeSecret?.startsWith('sk_live_')
            ? 'live'
            : stripeSecret
                ? 'unknown'
                : 'missing';

    return {
        status: missing.length === 0 && stripeMode === 'test' ? 'ok' : 'failed',
        name: 'staging_smoke_env_source_shape',
        message: missing.length === 0 && stripeMode === 'test'
            ? 'Required staging smoke environment names are available and Stripe secret mode is test.'
            : 'Required staging smoke environment names are missing or Stripe is not confirmed test mode.',
        details: [
            `missingNames=${missing.map((item) => item.name).join(',') || 'none'}`,
            `stripeSecretMode=${stripeMode}`,
            'valuesPrinted=false',
        ],
    };
}

function validateApprovalGateSource(): Check {
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    const required = [
        approvalEnvVar,
        exactApprovalSentence,
        '--execute-approved',
        'approvalMatched',
        'SMOKE_BASE_URL',
        'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
        'STRIPE_SECRET_KEY',
        'sk_live_',
        'sanitize',
        'externalWriteCommandStarted',
        'No Cloudflare deploy/domain/DNS writes',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains exact approval gate, staging host confirmation, Stripe live rejection and sanitized capture posture.'
            : 'Runner source is missing required approval-gate safeguards.',
        details: missing.length === 0 ? [`env=${approvalEnvVar}`, 'flag=--execute-approved'] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function runApprovedExecution(reportCaptures: Capture[]): Check[] {
    const approvedChecks: Check[] = [{
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact staging smoke approval matched; executing only the guarded staging smoke command.',
        details: [`env=${approvalEnvVar}`, 'flag=--execute-approved', `SMOKE_BASE_URL=${baseUrl}`, `SMOKE_EXTERNAL_WRITES_CONFIRMATION=${confirmation}`],
    }];

    const stagingEnv = parseEnvFile('.env.staging');
    const baseEnv = parseEnvFile('.env');
    const merged = buildSmokeEnv(stagingEnv, baseEnv);
    const missing = requiredEnvNames.filter((name) => !merged[name]);
    if (missing.length > 0) {
        approvedChecks.push(failedCheck('approved_env_materialization', 'Approved execution cannot run because required env names are missing.', missing.map((name) => `missing=${name}`)));
        return approvedChecks;
    }

    if (merged.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
        approvedChecks.push(failedCheck('stripe_test_mode_guard', 'Approved execution refused to run with a Stripe live secret key.', ['stripeSecretMode=live']));
        return approvedChecks;
    }

    approvedChecks.push({
        status: 'ok',
        name: 'approved_env_materialization',
        message: 'Approved execution materialized staging smoke environment names without printing values.',
        details: ['valuesPrinted=false', `SMOKE_BASE_URL=${baseUrl}`, `SMOKE_EXTERNAL_WRITES_CONFIRMATION=${confirmation}`],
    });

    const capture = runSmokeCommand(merged);
    reportCaptures.push(capture);
    approvedChecks.push({
        status: capture.status,
        name: 'staging_smoke_command',
        message: capture.status === 'ok'
            ? 'Staging smoke command exited successfully; inspect redacted real-env-smoke summary before closing integration evidence.'
            : 'Staging smoke command did not exit successfully; inspect redacted capture and smoke summary if present.',
        details: [`exitCode=${capture.exitCode ?? 'unknown'}`, `capture=${capture.path}`],
    });

    return approvedChecks;
}

function runSmokeCommand(env: Record<string, string>): Capture {
    const capturePath = path.join(outputDir, 'staging-smoke-command-output.txt');
    const display = 'corepack pnpm --config.verify-deps-before-run=false exec tsx scripts/smoke/real-env-smoke.ts';
    const result = spawnSync('corepack', [
        'pnpm',
        '--config.verify-deps-before-run=false',
        'exec',
        'tsx',
        'scripts/smoke/real-env-smoke.ts',
    ], {
        env: {
            ...process.env,
            ...env,
        },
        encoding: 'utf8',
        timeout: 600_000,
        windowsHide: true,
    });

    const output = [
        `# command\n${display}`,
        '# stdout',
        sanitize(result.stdout ?? ''),
        '# stderr',
        sanitize(result.stderr ?? ''),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n');
    writeFileSync(capturePath, output, 'utf8');
    const exitCode = typeof result.status === 'number' ? result.status : null;

    return {
        id: 'staging_smoke_command',
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 ? 'ok' : 'failed',
        externalWriteCommandStarted: true,
    };
}

function buildSmokeEnv(stagingEnv: Record<string, string>, baseEnvValues: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};

    for (const name of [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'CRON_SECRET',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
    ]) {
        if (baseEnvValues[name]) env[name] = baseEnvValues[name];
    }

    for (const name of [
        'PUBLIC_SUPABASE_URL',
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'RESEND_API_KEY',
        'RESEND_FROM_EMAIL',
    ]) {
        if (stagingEnv[name]) env[name] = stagingEnv[name];
    }

    env.SMOKE_BASE_URL = baseUrl;
    env.SMOKE_EXTERNAL_WRITES_CONFIRMATION = confirmation;
    env.SMOKE_ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || stagingEnv.TEST_ADMIN_EMAIL || '';
    env.SMOKE_ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || stagingEnv.TEST_ADMIN_PASSWORD || '';
    env.SMOKE_TEACHER_EMAIL = process.env.SMOKE_TEACHER_EMAIL || stagingEnv.TEST_TEACHER_EMAIL || '';
    env.SMOKE_TEACHER_PASSWORD = process.env.SMOKE_TEACHER_PASSWORD || stagingEnv.TEST_TEACHER_PASSWORD || '';
    if (process.env.SMOKE_STUDENT_PASSWORD) env.SMOKE_STUDENT_PASSWORD = process.env.SMOKE_STUDENT_PASSWORD;
    if (process.env.SMOKE_AUTH_USER_SCAN_MAX_PAGES) env.SMOKE_AUTH_USER_SCAN_MAX_PAGES = process.env.SMOKE_AUTH_USER_SCAN_MAX_PAGES;

    return env;
}

function buildEnvSourceMatrix(
    stagingEnv = parseEnvFile('.env.staging'),
    baseEnvValues = parseEnvFile('.env'),
): EnvSourceRow[] {
    return envNameRows.map((item) => ({
        ...item,
        presentInStaging: stagingEnv[item.name] !== undefined || mappedStagingName(item.name).some((name) => stagingEnv[name] !== undefined),
        presentInEnv: baseEnvValues[item.name] !== undefined,
    }));
}

function resolveEnvName(name: string, stagingEnv: Record<string, string>, baseEnvValues: Record<string, string>): string | null {
    if (name === 'SMOKE_BASE_URL') return baseUrl;
    if (name === 'SMOKE_EXTERNAL_WRITES_CONFIRMATION') return confirmation;
    if (name === 'SMOKE_ADMIN_EMAIL') return process.env.SMOKE_ADMIN_EMAIL || stagingEnv.TEST_ADMIN_EMAIL || null;
    if (name === 'SMOKE_ADMIN_PASSWORD') return process.env.SMOKE_ADMIN_PASSWORD || stagingEnv.TEST_ADMIN_PASSWORD || null;
    if (name === 'SMOKE_TEACHER_EMAIL') return process.env.SMOKE_TEACHER_EMAIL || stagingEnv.TEST_TEACHER_EMAIL || null;
    if (name === 'SMOKE_TEACHER_PASSWORD') return process.env.SMOKE_TEACHER_PASSWORD || stagingEnv.TEST_TEACHER_PASSWORD || null;
    return stagingEnv[name] || baseEnvValues[name] || null;
}

function mappedStagingName(name: string): string[] {
    const map: Record<string, string[]> = {
        SMOKE_ADMIN_EMAIL: ['TEST_ADMIN_EMAIL'],
        SMOKE_ADMIN_PASSWORD: ['TEST_ADMIN_PASSWORD'],
        SMOKE_TEACHER_EMAIL: ['TEST_TEACHER_EMAIL'],
        SMOKE_TEACHER_PASSWORD: ['TEST_TEACHER_PASSWORD'],
    };
    return map[name] ?? [];
}

function parseEnvFile(file: string): Record<string, string> {
    if (!existsSync(file)) return {};
    const parsed: Record<string, string> = {};
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/u)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
        if (!match) continue;
        parsed[match[1]] = stripQuotes(match[2].trim());
    }
    return parsed;
}

function stripQuotes(value: string): string {
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return value;
}

function renderArtifacts(reportToRender: RunnerReport): RenderedArtifacts {
    const commandManifest = renderCommandManifest(reportToRender);
    const executionPlan = renderExecutionPlan(reportToRender);
    const approvalGate = renderApprovalGate(reportToRender);
    const rollbackAfterStagingSmoke = renderRollback(reportToRender);
    const manualEvidenceAfterStagingSmoke = renderManualEvidence(reportToRender);
    const summary = renderSummary(reportToRender);

    return {
        commandManifest,
        executionPlan,
        approvalGate,
        rollbackAfterStagingSmoke,
        manualEvidenceAfterStagingSmoke,
        summary,
    };
}

function renderCommandManifest(reportToRender: RunnerReport): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: reportToRender.endedAt,
        status: reportToRender.status,
        closureStatus: reportToRender.closureStatus,
        mode: reportToRender.executeRequested ? 'execute-approved' : 'plan',
        baseUrl: reportToRender.baseUrl,
        confirmation: reportToRender.confirmation,
        approvalEnvVar: reportToRender.approvalEnvVar,
        approvalMatched: reportToRender.approvalMatched,
        externalWriteCommandStarted: reportToRender.externalWriteCommandStarted,
        command: 'corepack pnpm --config.verify-deps-before-run=false exec tsx scripts/smoke/real-env-smoke.ts',
        requiredEnvNames: reportToRender.requiredEnvNames,
        envSourceMatrix: reportToRender.envSourceMatrix,
        safety: {
            planModeDoesNotRunSmoke: !reportToRender.executeRequested,
            exactApprovalRequired: true,
            stripeLiveModeRejected: true,
            secretValuesStored: false,
            finalSmokeClosedByThisRunner: false,
        },
        forbiddenScope: [
            'No production smoke and no live-domain claim from this rehearsal.',
            'No secret value printing, screenshots, commits or output files.',
            'No password reset for owner/admin/teacher accounts.',
            'No `CHECKOUT_ENABLED=true`, Stripe live mode or real charge.',
            'No Cloudflare deploy/domain/DNS writes.',
            'No Supabase schema migration, destructive cleanup or broad data deletion.',
            'No Google Drive/Calendar cleanup outside smoke-created artifacts.',
        ],
        files: {
            executionPlan: fileMeta(reportToRender.executionPlanPath, renderExecutionPlan(reportToRender)),
            approvalGate: fileMeta(reportToRender.approvalGatePath, renderApprovalGate(reportToRender)),
            rollback: fileMeta(reportToRender.rollbackAfterStagingSmokePath, renderRollback(reportToRender)),
            manualEvidence: fileMeta(reportToRender.manualEvidenceAfterStagingSmokePath, renderManualEvidence(reportToRender)),
            summary: fileMeta(reportToRender.summaryPath, renderSummary(reportToRender)),
        },
        checks: reportToRender.checks,
        captures: reportToRender.captures.map((capture) => ({ ...capture, path: toRelative(capture.path) })),
    }, null, 2)}\n`;
}

function renderExecutionPlan(reportToRender: RunnerReport): string {
    return `${[
        '# Staging Smoke Rehearsal Runner Execution Plan',
        '',
        `- Status: ${reportToRender.status}`,
        `- Closure: ${reportToRender.closureStatus}`,
        `- Execute requested: ${String(reportToRender.executeRequested)}`,
        `- Approval matched: ${String(reportToRender.approvalMatched)}`,
        `- External write command started: ${String(reportToRender.externalWriteCommandStarted)}`,
        `- Base URL: ${reportToRender.baseUrl}`,
        `- Confirmation: ${reportToRender.confirmation}`,
        '',
        '## Plan Mode',
        '',
        '- Generates this package only.',
        '- Does not run `scripts/smoke/real-env-smoke.ts`.',
        '- Does not call Supabase, Stripe, Google, Resend, Cloudflare, Sentry or Turnstile.',
        '',
        '## Approved Mode',
        '',
        'Only after exact approval:',
        '',
        '```powershell',
        `$env:${approvalEnvVar}='${exactApprovalSentence.replace(/'/g, "''")}'`,
        'corepack pnpm --config.verify-deps-before-run=false launch:staging-smoke-rehearsal-runner -- --execute-approved',
        '```',
        '',
        'The runner will:',
        '',
        '1. Materialize staging smoke environment names in memory from `.env.staging`, `.env` and generated host confirmation.',
        '2. Reject missing required names and reject Stripe live secret mode.',
        '3. Run only `corepack pnpm --config.verify-deps-before-run=false exec tsx scripts/smoke/real-env-smoke.ts`.',
        '4. Capture sanitized command output and rely on `outputs/real-env-smoke/<timestamp>/summary.md` for redacted smoke evidence.',
        '',
        '## Environment Source Matrix',
        '',
        '| Name | Preferred Source | Present In .env.staging | Present In .env | Provided By Runner | Required For |',
        '| --- | --- | --- | --- | --- | --- |',
        ...reportToRender.envSourceMatrix.map((item) => `| ${item.name} | ${item.preferredSource} | ${String(item.presentInStaging)} | ${String(item.presentInEnv)} | ${String(item.providedByRunner)} | ${item.requiredFor} |`),
        '',
    ].join('\n')}\n`;
}

function renderApprovalGate(reportToRender: RunnerReport): string {
    return `${[
        '# Staging Smoke Rehearsal Runner Approval Gate',
        '',
        'This file is not approval. It documents the exact gate that the runner requires before it can run a write-capable staging smoke.',
        '',
        `- Environment variable: \`${approvalEnvVar}\`.`,
        '- Required flag: `--execute-approved`.',
        `- Approval matched in this run: ${String(reportToRender.approvalMatched)}.`,
        `- Execute requested in this run: ${String(reportToRender.executeRequested)}.`,
        `- External write command started: ${String(reportToRender.externalWriteCommandStarted)}.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Explicitly Not Approved',
        '',
        '- Production smoke or live-domain launch sign-off.',
        '- Stripe live mode, real charges or `CHECKOUT_ENABLED=true`.',
        '- Cloudflare deploy/domain/DNS/routes/Pages/Workers writes.',
        '- Supabase migrations, schema changes, destructive cleanup or broad data deletion.',
        '- Secret value printing or private payload evidence.',
        '',
    ].join('\n')}\n`;
}

function renderRollback(reportToRender: RunnerReport): string {
    return `${[
        '# Staging Smoke Rehearsal Rollback And Cleanup',
        '',
        'This file does not authorize cleanup writes by itself. Use it after an approved staging smoke run.',
        '',
        reportToRender.externalWriteCommandStarted
            ? '- A staging smoke command was started. Inspect the redacted `outputs/real-env-smoke/<timestamp>/summary.md` before any cleanup.'
            : '- No staging smoke command was started by this runner run. No external rollback is required.',
        '',
        '## If The Smoke Fails',
        '',
        '- Keep `integration_readiness` and `final_smoke` open.',
        '- Record the redacted smoke summary and this runner summary in the tracker.',
        '- Fix technical/logistical/UX failures without changing style unless a specific UX defect requires a minimal correction.',
        '- Rerun the staging smoke under the same exact approval boundary or a freshly approved boundary if scope changes.',
        '',
        '## Cleanup Boundaries',
        '',
        '- Cancel only smoke-managed Stripe test subscriptions identified by the harness.',
        '- Clean only smoke-created Google Drive/Calendar artifacts after confirming ownership and scope.',
        '- Leave real customer/student data untouched unless a separate exact cleanup approval names the resource.',
        '- Do not run Supabase schema migrations as part of smoke cleanup.',
        '',
        '## Reverting This Local Runner',
        '',
        '- Remove `scripts/launch/staging-smoke-rehearsal-runner.ts`, its package script, queue/docs/tests/tracker references and regenerated artifacts.',
        '- No external rollback is required for plan-only runs.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidence(reportToRender: RunnerReport): string {
    const summaryPath = `../../${toRelative(reportToRender.summaryPath)}`;
    const manifestPath = `../../${toRelative(reportToRender.commandManifestPath)}`;
    const approvalPath = `../../${toRelative(reportToRender.approvalGatePath)}`;
    const rollbackPath = `../../${toRelative(reportToRender.rollbackAfterStagingSmokePath)}`;

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pending',
        '  --summary "Staging smoke rehearsal runner package prepared; attach redacted smoke summary after exact-approved execution."',
        '  --environment staging',
        '  --owner Alin',
        `  --evidence "command_output=${summaryPath}::staging smoke runner summary"`,
        `  --evidence "command_output=${manifestPath}::staging smoke command manifest without secret values"`,
        `  --evidence "command_output=${approvalPath}::exact approval gate reviewed"`,
        `  --evidence "command_output=${rollbackPath}::rollback and cleanup boundary reviewed"`,
        '  --evidence "command_output=../../outputs/real-env-smoke/<timestamp>/summary.md::redacted staging smoke summary after approved execution"',
        '',
        '# Add --write only after approved execution and replacing placeholders with concrete non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(reportToRender: RunnerReport): string {
    const lines = [
        '# Staging Smoke Rehearsal Runner Summary',
        '',
        `- Status: ${reportToRender.status}`,
        `- Closure: ${reportToRender.closureStatus}`,
        `- Base URL: ${reportToRender.baseUrl}`,
        `- Confirmation: ${reportToRender.confirmation}`,
        `- Execute requested: ${String(reportToRender.executeRequested)}`,
        `- Approval matched: ${String(reportToRender.approvalMatched)}`,
        `- External write command started: ${String(reportToRender.externalWriteCommandStarted)}`,
        `- Command manifest: ${toRelative(reportToRender.commandManifestPath)}`,
        `- Execution plan: ${toRelative(reportToRender.executionPlanPath)}`,
        `- Approval gate: ${toRelative(reportToRender.approvalGatePath)}`,
        `- Rollback: ${toRelative(reportToRender.rollbackAfterStagingSmokePath)}`,
        `- Manual evidence dry run: ${toRelative(reportToRender.manualEvidenceAfterStagingSmokePath)}`,
        '',
        'This runner is plan-only unless both the exact approval environment variable and `--execute-approved` are present. In plan mode it does not run the smoke and does not write external services.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of reportToRender.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const forbiddenSecretPatterns = [
        new RegExp('-----BEGIN ' + 'PRIVATE KEY-----'),
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /sb_secret_[A-Za-z0-9_-]{20,}/,
        /AIza[0-9A-Za-z_-]{30,}/,
        /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));
    const required = [
        'exact approval',
        'PLAN_ONLY_READY',
        'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
        'No Cloudflare deploy/domain/DNS writes',
        'Stripe live',
        'redacted',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated runner artifacts contain staging smoke scope gates and no obvious secret values.'
            : 'Generated runner artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function parseStatus(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function statusFor(checkList: Check[]): ReportStatus {
    return parseStatus(checkList);
}

function failedCheck(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function fileMeta(filePath: string, contents: string) {
    return {
        path: toRelative(filePath),
        sha256: sha256(contents),
        bytes: Buffer.byteLength(contents, 'utf8'),
    };
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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

    return candidates[0] ? toRelative(candidates[0]) : null;
}

function sanitize(value: string): string {
    return value
        .replace(/-----BEGIN [\s\S]*?PRIVATE KEY-----/g, '[redacted-private-key]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{8,}/g, '[redacted-stripe-secret]')
        .replace(/pk_(live|test)_[A-Za-z0-9]{8,}/g, '[redacted-stripe-publishable]')
        .replace(/whsec_[A-Za-z0-9]{8,}/g, '[redacted-webhook-secret]')
        .replace(/sb_secret_[A-Za-z0-9_-]{8,}/g, '[redacted-supabase-secret]')
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-key]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{8,}/g, '[redacted-resend-key]')
        .replace(/(postgres|postgresql):\/\/[^\s"']+/g, '[redacted-postgres-url]');
}

function safeErrorMessage(error: Error): string {
    return sanitize(`${error.name}: ${error.message}`);
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toRelative(filePath: string): string {
    return path.isAbsolute(filePath)
        ? path.relative(process.cwd(), filePath).split(path.sep).join('/')
        : filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
