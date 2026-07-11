import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    EXACT_STAGING_CHECKOUT_BOOTSTRAP_APPROVAL,
    STAGING_CHECKOUT_BOOTSTRAP_APPROVAL_ENV,
} from '../smoke/staging-checkout-bootstrap-approval';

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
    checkoutGateApprovalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    checkoutGateApprovalMatched: boolean;
    externalWriteCommandStarted: boolean;
    checkoutGateWriteAttempted: boolean;
    checkoutGateRollbackVerified: boolean;
    requiredEnvNames: string[];
    envSourceMatrix: EnvSourceRow[];
    latestFinalSmokePackSummaryPath: string | null;
    latestStagingApprovalPath: string | null;
    latestStagingPreflightPath: string | null;
    latestStagingCheckoutGateApprovalPath: string | null;
    checks: Check[];
    captures: Capture[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    checkoutGateApprovalPath: string;
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
    checkoutGateApproval: string;
    rollbackAfterStagingSmoke: string;
    manualEvidenceAfterStagingSmoke: string;
    summary: string;
}

const smokeApprovalEnvVar = 'STAGING_SMOKE_REHEARSAL_APPROVAL';
const checkoutGateApprovalEnvVar = 'STAGING_CHECKOUT_GATE_APPROVAL';
const checkoutGateConfirmationEnvVar = 'STAGING_CHECKOUT_GATE_CONFIRMATION';
const cloudflareAccountId = 'd1a22bcf6477ff2ff31d2bfb83084e44';
const stagingWorkerName = 'espanolhonesto-staging';
const baseUrl = 'https://espanolhonesto-staging.alindev95.workers.dev';
const confirmation = 'writes-ok:espanolhonesto-staging.alindev95.workers.dev';
const checkoutGateConfirmation = 'enabled-after-separate-cloudflare-approval:espanolhonesto-staging.alindev95.workers.dev';
const realEnvSmokeNodePrefix = [
    '--import',
    'tsx',
    '--import',
    './scripts/smoke/astro-env-node-register.mjs',
    'scripts/smoke/real-env-smoke.ts',
];
const exactSmokeApprovalSentence = 'Apruebo ejecutar un smoke rehearsal de staging con writes externos contra `SMOKE_BASE_URL=https://espanolhonesto-staging.alindev95.workers.dev`, con `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:espanolhonesto-staging.alindev95.workers.dev`, usando exclusivamente las cuentas allowlisted existentes de alumno, admin y profesor, con Stripe test mode y evidencia de Checkout/webhooks reales ya prevalidada read-only, permitiendo unicamente writes de smoke necesarios en Supabase staging, Stripe test, Google, Resend y Admin Jobs, sin crear usuarios Auth, sin necesitar acceso al buzon del alumno, sin imprimir secretos, sin guardar datos privados en evidencia, sin resetear contrasenas, sin fabricar eventos Stripe, sin activar pagos reales, sin cambiar Cloudflare/DNS/dominios y con cleanup automatico de CRM, jobs, sesiones y artefactos temporales. El cambio temporal del gate requiere ademas su aprobacion Cloudflare separada y exacta; el runner aprobado sera responsable de restaurarlo y verificarlo en `false` dentro de `finally`. No autorizo ningun otro cambio externo.';
const exactCheckoutGateApprovalSentence = 'Apruebo que el runner cambie temporalmente solo `CHECKOUT_ENABLED_OVERRIDE` del Cloudflare Worker staging `espanolhonesto-staging` de `false` a `true` para completar y verificar el Checkout Stripe test aprobado y que, dentro de `finally`, lo devuelva a `false` y verifique el rollback incluso si el smoke o la activacion fallan; antes del primer write debe atestiguar el runtime cerrado, la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` y el Worker exactos. No autorizo deploy de codigo, cambios de rutas, dominios, DNS, otros secrets/vars, Workers production, Stripe live, Supabase, Google, Resend ni ningun otro write externo.';
const fullSmokeRequested = process.argv.includes('--execute-approved');
const bootstrapCheckoutRequested = process.argv.includes('--bootstrap-checkout-approved');
const executeRequested = fullSmokeRequested || bootstrapCheckoutRequested;
const executionFlag = bootstrapCheckoutRequested ? '--bootstrap-checkout-approved' : '--execute-approved';
const approvalEnvVar = bootstrapCheckoutRequested
    ? STAGING_CHECKOUT_BOOTSTRAP_APPROVAL_ENV
    : smokeApprovalEnvVar;
const exactApprovalSentence = bootstrapCheckoutRequested
    ? EXACT_STAGING_CHECKOUT_BOOTSTRAP_APPROVAL
    : exactSmokeApprovalSentence;
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;
const checkoutGateApprovalMatched = process.env[checkoutGateApprovalEnvVar] === exactCheckoutGateApprovalSentence;

const envNameRows: EnvSourceRow[] = [
    row('PUBLIC_SUPABASE_URL', '.env.staging', 'Supabase staging API'),
    row('PUBLIC_SUPABASE_ANON_KEY', '.env.staging', 'Supabase staging browser auth'),
    row('SUPABASE_SERVICE_ROLE_KEY', '.env.staging', 'Supabase staging smoke setup/verification'),
    row('RESEND_API_KEY', '.env.staging', 'Resend staging/test email flow'),
    row('RESEND_FROM_EMAIL', '.env.staging', 'Resend sender identity'),
    row('EMAIL_RECIPIENT_ALLOWLIST', '.env.staging', 'exact existing admin/teacher/student recipients'),
    row('PUBLIC_APP_ENV', '.env.staging', 'deployed runtime staging attestation'),
    row('PUBLIC_SITE_URL', '.env.staging', 'exact stable staging Worker attestation'),
    row('CHECKOUT_ENABLED', '.env.staging', 'fail-closed runtime attestation'),
    row('CHECKOUT_ENABLED_OVERRIDE', '.env.staging', 'local fail-closed source and rollback target'),
    row('EMAIL_DELIVERY_MODE', '.env.staging', 'deployed Resend allowlist attestation'),
    row('EMAIL_DAILY_RECIPIENT_LIMIT', '.env.staging', 'deployed Resend daily budget attestation'),
    row('EMAIL_MONTHLY_RECIPIENT_LIMIT', '.env.staging', 'deployed Resend monthly budget attestation'),
    row('FULFILLMENT_WORKER_URL', '.env.staging', 'exact fulfillment Worker attestation'),
    row('INTERNAL_JOB_SECRET', '.env.staging', 'authenticated runtime attestation'),
    row('STRIPE_SECRET_KEY', '.env.staging', 'Stripe test-mode checkout and real-event verification'),
    row('PUBLIC_STRIPE_PUBLISHABLE_KEY', '.env.staging', 'deployed Stripe test-mode attestation'),
    row('STRIPE_WEBHOOK_SECRET', '.env.staging', 'deployed Stripe webhook attestation'),
    row('STRIPE_EXPECTED_ACCOUNT_ID', '.env.staging', 'exact dedicated Stripe Sandbox attestation'),
    row('STRIPE_PORTAL_CONFIGURATION_ID', '.env.staging', 'exact Stripe test Portal attestation'),
    row('GOOGLE_SERVICE_ACCOUNT_EMAIL', '.env.staging', 'Google Workspace staging smoke'),
    row('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', '.env.staging', 'Google Workspace staging smoke'),
    row('GOOGLE_ADMIN_EMAIL', '.env.staging', 'Google Workspace DWD subject'),
    row('GOOGLE_DRIVE_ROOT_FOLDER_ID', '.env.staging', 'Google Drive folder/doc smoke'),
    row('GOOGLE_TEMPLATE_DOC_ID', '.env.staging', 'Google Docs template smoke'),
    row('SMOKE_ADMIN_EMAIL', '.env.staging', 'mapped from TEST_ADMIN_EMAIL unless already provided'),
    row('SMOKE_ADMIN_PASSWORD', '.env.staging', 'mapped from TEST_ADMIN_PASSWORD unless already provided'),
    row('SMOKE_TEACHER_EMAIL', '.env.staging', 'mapped from TEST_TEACHER_EMAIL unless already provided'),
    row('SMOKE_TEACHER_PASSWORD', '.env.staging', 'mapped from TEST_TEACHER_PASSWORD unless already provided'),
    row('SMOKE_STUDENT_EMAIL', '.env.staging', 'mapped from TEST_STUDENT_EMAIL unless already provided'),
    row('SMOKE_STUDENT_PASSWORD', '.env.staging', 'mapped from TEST_STUDENT_PASSWORD unless already provided'),
    row('SMOKE_COMPLETED_CHECKOUT_SESSION_ID', '.env.staging', 'real completed Stripe test Checkout evidence'),
    row('SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION', '.env.staging', 'reviewed real renewal/failure/resume/cancellation evidence'),
    row(checkoutGateConfirmationEnvVar, 'generated', 'attestation after the runner-owned Cloudflare gate change'),
    row('SMOKE_BASE_URL', 'generated', 'fixed staging origin'),
    row('SMOKE_EXTERNAL_WRITES_CONFIRMATION', 'generated', 'fixed staging writes-ok host confirmation'),
];

const bootstrapDeferredEnvNames = new Set([
    'SMOKE_COMPLETED_CHECKOUT_SESSION_ID',
    'SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION',
]);
const requiredEnvNames = envNameRows
    .filter((item) => !bootstrapCheckoutRequested || !bootstrapDeferredEnvNames.has(item.name))
    .map((item) => item.name);
const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-staging-smoke-rehearsal-runner', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestFinalSmokePackSummaryPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'summary.md');
const latestStagingApprovalPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-staging-smoke.md');
const latestStagingPreflightPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'staging-preflight-checklist.md');
const latestStagingCheckoutGateApprovalPath = latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-staging-checkout-gate.md');
const captures: Capture[] = [];
const checks: Check[] = [
    validatePackageScript(),
    validateSmokeHarness(),
    validateNodeSmokeRuntimeBridge(),
    validateFinalSmokePackArtifacts(),
    bootstrapCheckoutRequested ? validateBootstrapEnvSources() : validateEnvSources(),
    validateApprovalGateSource(),
];

if (fullSmokeRequested && bootstrapCheckoutRequested) {
    checks.push(failedCheck(
        'mutually_exclusive_execution_modes',
        'Full smoke and Checkout bootstrap modes cannot run in the same process.',
        ['--execute-approved', '--bootstrap-checkout-approved', 'externalWriteCommandStarted=false'],
    ));
} else if (executeRequested && checks.some((check) => check.status === 'failed')) {
    checks.push(failedCheck(
        'initial_read_only_guards',
        'One or more initial source, artifact or environment guards failed, so no write-capable command can run.',
        [
            `failed=${checks.filter((check) => check.status === 'failed').map((check) => check.name).join(',')}`,
            'externalWriteCommandStarted=false',
        ],
    ));
} else if (executeRequested && !approvalMatched) {
    checks.push({
        status: 'failed',
        name: 'exact_approval_gate',
        message: 'Execution was requested but the exact approval for this staging mode did not match, so no write-capable command can run.',
        details: [`env=${approvalEnvVar}`, 'required=exact sentence in approval-gate.md', 'externalWriteCommandStarted=false'],
    });
} else if (bootstrapCheckoutRequested && approvalMatched) {
    checks.push(...runApprovedCheckoutBootstrap(captures));
} else if (fullSmokeRequested && approvalMatched) {
    checks.push(...runApprovedExecution(captures));
} else {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_external_write',
        message: 'Plan mode generated the staging smoke runner package without running the write-capable smoke.',
        details: ['executeRequested=false', 'externalWriteCommandStarted=false', `futureGate=${approvalEnvVar}`, `futureFlag=${executionFlag}`],
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
writeFileSync(report.checkoutGateApprovalPath, rendered.checkoutGateApproval, 'utf8');
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
console.log(`[launch:staging-smoke-rehearsal-runner] Separate checkout gate approval: ${report.checkoutGateApprovalPath}`);
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
    const checkoutGateWriteAttempted = reportCaptures.some((capture) => capture.id === 'cloudflare-staging-checkout-gate-enable');
    const checkoutGateRollbackVerified = reportChecks.some((check) => (
        check.name === 'cloudflare_staging_checkout_gate_rollback'
        && check.status === 'ok'
    ));

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
        checkoutGateApprovalEnvVar,
        executeRequested,
        approvalMatched,
        checkoutGateApprovalMatched,
        externalWriteCommandStarted,
        checkoutGateWriteAttempted,
        checkoutGateRollbackVerified,
        requiredEnvNames,
        envSourceMatrix: buildEnvSourceMatrix(),
        latestFinalSmokePackSummaryPath,
        latestStagingApprovalPath,
        latestStagingPreflightPath,
        latestStagingCheckoutGateApprovalPath,
        checks: reportChecks,
        captures: reportCaptures,
        commandManifestPath: path.join(outputDir, 'staging-smoke-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'staging-smoke-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        checkoutGateApprovalPath: path.join(outputDir, 'cloudflare-checkout-gate-approval.md'),
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
        "requireEnv('SMOKE_STUDENT_EMAIL')",
        "requireEnv('SMOKE_STUDENT_PASSWORD')",
        "requireEnv('SMOKE_COMPLETED_CHECKOUT_SESSION_ID')",
        "requireEnv('SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION')",
        "requireEnv('STAGING_CHECKOUT_GATE_CONFIRMATION')",
        'writes-ok:${parsedUrl.host}',
        '--preflight-only',
        '--runtime-preflight-only',
        'verifyDeployedStagingRuntime',
        'runReadOnlyPreflight',
        'externalWritesStarted: false',
        'authUsersCreated: 0',
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

function validateNodeSmokeRuntimeBridge(): Check {
    const registerPath = path.join('scripts', 'smoke', 'astro-env-node-register.mjs');
    const loaderPath = path.join('scripts', 'smoke', 'astro-env-node-loader.mjs');
    const shimPath = path.join('scripts', 'smoke', 'astro-env-server-node.mjs');
    const missingFiles = [registerPath, loaderPath, shimPath].filter((file) => !existsSync(file));
    const registerSource = existsSync(registerPath) ? readFileSync(registerPath, 'utf8') : '';
    const loaderSource = existsSync(loaderPath) ? readFileSync(loaderPath, 'utf8') : '';
    const shimSource = existsSync(shimPath) ? readFileSync(shimPath, 'utf8') : '';
    const missingSnippets = [
        ['register', "register(new URL('./astro-env-node-loader.mjs'"],
        ['loader', "specifier === 'astro:env/server'"],
        ['shim', 'process.env[key]'],
    ].filter(([kind, snippet]) => !(
        kind === 'register' ? registerSource : kind === 'loader' ? loaderSource : shimSource
    ).includes(snippet)).map(([kind, snippet]) => `${kind}:${snippet}`);
    const missing = [...missingFiles, ...missingSnippets];

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'node_smoke_runtime_bridge',
        message: missing.length === 0
            ? 'The Node smoke bridge resolves only Astro runtime-secret reads to process.env while leaving Worker code unchanged.'
            : 'The Node smoke bridge is missing or no longer maps the exact Astro runtime-secret module safely.',
        details: missing.length === 0
            ? [registerPath, loaderPath, shimPath, 'secretValuesPrinted=false']
            : missing.map((item) => `missing=${item}`),
    };
}

function validateFinalSmokePackArtifacts(): Check {
    if (!latestStagingApprovalPath || !latestStagingPreflightPath || !latestStagingCheckoutGateApprovalPath || !latestFinalSmokePackSummaryPath) {
        return {
            status: 'warning',
            name: 'staging_smoke_pack_artifacts',
            message: 'Latest staging smoke approval/preflight artifacts are missing.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:final-smoke-execution-pack'],
        };
    }

    const approval = readFileSync(latestStagingApprovalPath, 'utf8');
    const preflight = readFileSync(latestStagingPreflightPath, 'utf8');
    const checkoutGateApproval = readFileSync(latestStagingCheckoutGateApprovalPath, 'utf8');
    const summary = readFileSync(latestFinalSmokePackSummaryPath, 'utf8');
    const required = [
        exactSmokeApprovalSentence,
        exactCheckoutGateApprovalSentence,
        'READY_FOR_STAGING_SMOKE_APPROVAL',
        'Stripe test mode',
        'No Cloudflare deploy/domain/DNS writes',
        'Do not use this rehearsal alone to mark `final_smoke` pass.',
    ];
    const combined = [approval, preflight, checkoutGateApproval, summary].join('\n');
    const missing = required.filter((snippet) => !combined.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'staging_smoke_pack_artifacts',
        message: missing.length === 0
            ? 'Latest staging smoke pack artifacts contain exact approval, readiness and no-final-smoke-closure boundaries.'
            : 'Latest staging smoke pack artifacts are missing required scope or approval facts.',
        details: missing.length === 0
            ? [`summary=${latestFinalSmokePackSummaryPath}`, `approval=${latestStagingApprovalPath}`, `preflight=${latestStagingPreflightPath}`, `checkoutGateApproval=${latestStagingCheckoutGateApprovalPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateBootstrapEnvSources(): Check {
    const stagingEnv = parseEnvFile('.env.staging');
    const baseEnv = parseEnvFile('.env');
    const missing = requiredEnvNames.filter((name) => !resolveEnvName(name, stagingEnv, baseEnv));
    const stripeSecret = resolveEnvName('STRIPE_SECRET_KEY', stagingEnv, baseEnv);
    const stripeMode = stripeSecret?.startsWith('sk_test_')
        ? 'test'
        : stripeSecret?.startsWith('sk_live_')
            ? 'live'
            : stripeSecret
                ? 'unknown'
                : 'missing';
    const stripeAccountExact = resolveEnvName('STRIPE_EXPECTED_ACCOUNT_ID', stagingEnv, baseEnv) === 'acct_1TruqOC22M3erP0j';
    const roleEmails = [
        resolveEnvName('SMOKE_ADMIN_EMAIL', stagingEnv, baseEnv),
        resolveEnvName('SMOKE_TEACHER_EMAIL', stagingEnv, baseEnv),
        resolveEnvName('SMOKE_STUDENT_EMAIL', stagingEnv, baseEnv),
    ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
    const allowlist = new Set((resolveEnvName('EMAIL_RECIPIENT_ALLOWLIST', stagingEnv, baseEnv) ?? '')
        .split(/[;,]/u)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean));
    const roleAllowlistOk = roleEmails.length === 3
        && new Set(roleEmails).size === 3
        && allowlist.size === 3
        && roleEmails.every((email) => allowlist.has(email) && !email.endsWith('@example.com'));
    const gateConfirmationOk = resolveEnvName(checkoutGateConfirmationEnvVar, stagingEnv, baseEnv) === checkoutGateConfirmation;
    const ok = missing.length === 0
        && stripeMode === 'test'
        && stripeAccountExact
        && roleAllowlistOk
        && gateConfirmationOk;

    return {
        status: ok ? 'ok' : 'failed',
        name: 'staging_checkout_bootstrap_env_source_shape',
        message: ok
            ? 'Bootstrap env has the exact staging resources, Stripe test Sandbox and three existing allowlisted role accounts without requiring completed-payment evidence yet.'
            : 'Bootstrap env is missing a required name or fails the exact staging, Stripe test or role allowlist contract.',
        details: [
            `missingNames=${missing.join(',') || 'none'}`,
            `stripeSecretMode=${stripeMode}`,
            `stripeAccountExact=${String(stripeAccountExact)}`,
            `exactRoleAllowlist=${String(roleAllowlistOk)}`,
            `separateCheckoutGateConfirmation=${String(gateConfirmationOk)}`,
            'completedCheckoutEvidenceRequired=false-for-bootstrap-only',
            'valuesPrinted=false',
        ],
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
    const completedSessionId = resolveEnvName('SMOKE_COMPLETED_CHECKOUT_SESSION_ID', stagingEnv, baseEnv);
    const billingConfirmation = resolveEnvName('SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION', stagingEnv, baseEnv);
    const gateConfirmation = resolveEnvName(checkoutGateConfirmationEnvVar, stagingEnv, baseEnv);
    const roleEmails = [
        resolveEnvName('SMOKE_ADMIN_EMAIL', stagingEnv, baseEnv),
        resolveEnvName('SMOKE_TEACHER_EMAIL', stagingEnv, baseEnv),
        resolveEnvName('SMOKE_STUDENT_EMAIL', stagingEnv, baseEnv),
    ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
    const allowlist = new Set((resolveEnvName('EMAIL_RECIPIENT_ALLOWLIST', stagingEnv, baseEnv) ?? '')
        .split(/[;,]/u)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean));
    const manualEvidenceShapeOk = Boolean(
        completedSessionId
        && /^cs_test_[A-Za-z0-9_]+$/u.test(completedSessionId)
        && billingConfirmation === `reviewed-real-events:${completedSessionId}`
    );
    const roleAllowlistOk = roleEmails.length === 3
        && new Set(roleEmails).size === 3
        && allowlist.size === 3
        && roleEmails.every((email) => allowlist.has(email) && !email.endsWith('@example.com'));
    const gateConfirmationOk = gateConfirmation === checkoutGateConfirmation;
    const ok = missing.length === 0
        && stripeMode === 'test'
        && manualEvidenceShapeOk
        && roleAllowlistOk
        && gateConfirmationOk;

    return {
        status: ok ? 'ok' : 'failed',
        name: 'staging_smoke_env_source_shape',
        message: ok
            ? 'Staging env has test Stripe, real Checkout/manual evidence, separate gate confirmation and exactly the three existing allowlisted role accounts.'
            : 'Staging env is missing a required name or fails the Stripe, manual evidence, gate confirmation or role allowlist contract.',
        details: [
            `missingNames=${missing.map((item) => item.name).join(',') || 'none'}`,
            `stripeSecretMode=${stripeMode}`,
            `completedCheckoutAndManualLifecycleShape=${String(manualEvidenceShapeOk)}`,
            `exactRoleAllowlist=${String(roleAllowlistOk)}`,
            `separateCheckoutGateConfirmation=${String(gateConfirmationOk)}`,
            'valuesPrinted=false',
        ],
    };
}

function validateApprovalGateSource(): Check {
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    const required = [
        approvalEnvVar,
        bootstrapCheckoutRequested ? 'EXACT_STAGING_CHECKOUT_BOOTSTRAP_APPROVAL' : exactSmokeApprovalSentence,
        exactCheckoutGateApprovalSentence,
        checkoutGateConfirmationEnvVar,
        checkoutGateApprovalEnvVar,
        '--preflight-only',
        'runSmokePreflightCommand',
        'runCheckoutGateRollback',
        'finally',
        '--execute-approved',
        '--bootstrap-checkout-approved',
        'runApprovedCheckoutBootstrap',
        'runCheckoutBootstrapCleanupCommand',
        'approvalMatched',
        'SMOKE_BASE_URL',
        'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
        'STRIPE_SECRET_KEY',
        'sk_live_',
        'sanitize',
        'externalWriteCommandStarted',
        'wrangler secret put CHECKOUT_ENABLED_OVERRIDE',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains exact approval gate, staging host confirmation, Stripe live rejection and sanitized capture posture.'
            : 'Runner source is missing required approval-gate safeguards.',
        details: missing.length === 0 ? [`env=${approvalEnvVar}`, `flag=${executionFlag}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function runApprovedCheckoutBootstrap(reportCaptures: Capture[]): Check[] {
    const approvedChecks: Check[] = [{
        status: 'ok',
        name: 'exact_checkout_bootstrap_approval',
        message: 'Exact staging Checkout bootstrap approval matched for the dedicated Sandbox and allowlisted student.',
        details: [`env=${approvalEnvVar}`, 'flag=--bootstrap-checkout-approved', `SMOKE_BASE_URL=${baseUrl}`],
    }];

    const stagingEnv = parseEnvFile('.env.staging');
    const baseEnv = parseEnvFile('.env');
    const merged = buildSmokeEnv(stagingEnv, baseEnv);
    if (!checkoutGateApprovalMatched) {
        approvedChecks.push(failedCheck(
            'exact_checkout_gate_approval',
            'The separate Cloudflare staging checkout-gate approval did not match, so no Cloudflare or bootstrap write was attempted.',
            [`env=${checkoutGateApprovalEnvVar}`, 'required=exact sentence in cloudflare-checkout-gate-approval.md'],
        ));
        return approvedChecks;
    }
    approvedChecks.push({
        status: 'ok',
        name: 'exact_checkout_gate_approval',
        message: 'The separate exact approval authorizes only the staging checkout override true/false window owned by this runner.',
        details: [`env=${checkoutGateApprovalEnvVar}`, `account=${cloudflareAccountId}`, `worker=${stagingWorkerName}`],
    });

    const missing = requiredEnvNames.filter((name) => !merged[name]);
    if (missing.length > 0) {
        approvedChecks.push(failedCheck(
            'bootstrap_env_materialization',
            'Approved Checkout bootstrap cannot run because required staging environment names are missing.',
            missing.map((name) => `missing=${name}`),
        ));
        return approvedChecks;
    }
    if (merged.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
        approvedChecks.push(failedCheck('stripe_test_mode_guard', 'Checkout bootstrap refused Stripe live credentials.', ['stripeSecretMode=live']));
        return approvedChecks;
    }
    approvedChecks.push({
        status: 'ok',
        name: 'bootstrap_env_materialization',
        message: 'Checkout bootstrap environment was materialized without completed-payment evidence or secret output.',
        details: ['valuesPrinted=false', 'completedCheckoutEvidenceRequired=false-for-bootstrap-only'],
    });

    const cloudflarePreflight = runCloudflareReadOnlyPreflight();
    reportCaptures.push(...cloudflarePreflight.captures);
    approvedChecks.push(cloudflarePreflight.check);
    if (cloudflarePreflight.check.status !== 'ok') return approvedChecks;

    const closedRuntime = runRuntimePreflightCommand(merged, 'false', 0);
    reportCaptures.push(closedRuntime);
    approvedChecks.push({
        status: closedRuntime.status,
        name: 'bootstrap_closed_runtime_before_writes',
        message: closedRuntime.status === 'ok'
            ? 'The deployed staging runtimes attest checkout closed before any bootstrap write.'
            : 'The closed staging runtime could not be attested, so no bootstrap write was started.',
        details: [`exitCode=${closedRuntime.exitCode ?? 'unknown'}`, `capture=${closedRuntime.path}`, 'externalWriteCommandStarted=false'],
    });
    if (closedRuntime.status !== 'ok') return approvedChecks;

    const bootstrapPreflight = runCheckoutBootstrapPreflightCommand(merged);
    reportCaptures.push(bootstrapPreflight);
    approvedChecks.push({
        status: bootstrapPreflight.status,
        name: 'checkout_bootstrap_read_only_preflight',
        message: bootstrapPreflight.status === 'ok'
            ? 'Stripe/Supabase/catalog/student bootstrap preconditions passed with checkout still closed.'
            : 'Checkout bootstrap preconditions failed, so the Cloudflare gate was not changed.',
        details: [`exitCode=${bootstrapPreflight.exitCode ?? 'unknown'}`, `capture=${bootstrapPreflight.path}`, 'externalWriteCommandStarted=false'],
    });
    if (bootstrapPreflight.status !== 'ok') return approvedChecks;

    let gateWriteAttempted = false;
    let bootstrapFailureNeedsCleanup = false;
    let gateRollbackVerified = false;
    try {
        gateWriteAttempted = true;
        const enableCapture = runCheckoutGateWrite('true', 'enable');
        reportCaptures.push(enableCapture);
        approvedChecks.push({
            status: enableCapture.status,
            name: 'cloudflare_staging_checkout_gate_enable',
            message: enableCapture.status === 'ok'
                ? 'The exact staging checkout gate write completed; enabled runtime verification is still required.'
                : 'The checkout gate write failed or is ambiguous; bootstrap did not start and finally rollback is mandatory.',
            details: [`exitCode=${enableCapture.exitCode ?? 'unknown'}`, `capture=${enableCapture.path}`, `worker=${stagingWorkerName}`],
        });

        if (enableCapture.status === 'ok') {
            const enabledRuntime = runRuntimePreflightCommand(merged, 'true', 0);
            reportCaptures.push(enabledRuntime);
            approvedChecks.push({
                status: enabledRuntime.status,
                name: 'bootstrap_enabled_runtime_before_checkout',
                message: enabledRuntime.status === 'ok'
                    ? 'The deployed staging runtime attests checkout enabled for the bounded bootstrap window.'
                    : 'The enabled runtime could not be attested, so no Checkout bootstrap write started.',
                details: [`exitCode=${enabledRuntime.exitCode ?? 'unknown'}`, `capture=${enabledRuntime.path}`],
            });

            if (enabledRuntime.status === 'ok') {
                const bootstrapCapture = runCheckoutBootstrapCommand(merged);
                reportCaptures.push(bootstrapCapture);
                approvedChecks.push({
                    status: bootstrapCapture.status,
                    name: 'staging_checkout_bootstrap_command',
                    message: bootstrapCapture.status === 'ok'
                        ? 'One verified open Stripe test Checkout was preserved and handed off only through the local clipboard.'
                        : 'Checkout bootstrap failed or timed out; the runner will close the Cloudflare gate before starting a separate bounded cleanup subprocess.',
                    details: [`exitCode=${bootstrapCapture.exitCode ?? 'unknown'}`, `capture=${bootstrapCapture.path}`, 'checkoutUrlStoredInEvidence=false'],
                });
                if (bootstrapCapture.status !== 'ok') {
                    bootstrapFailureNeedsCleanup = true;
                }
            }
        }
    } catch (error) {
        if (gateWriteAttempted) bootstrapFailureNeedsCleanup = true;
        approvedChecks.push(failedCheck(
            'checkout_bootstrap_or_gate_unexpected_error',
            'An unexpected bootstrap/gate error occurred; finally rollback was still attempted.',
            [sanitize(safeErrorMessage(error))],
        ));
    } finally {
        if (gateWriteAttempted) {
            try {
                const rollbackCheck = runCheckoutGateRollback(merged, reportCaptures);
                approvedChecks.push(rollbackCheck);
                gateRollbackVerified = rollbackCheck.status === 'ok';
            } catch (error) {
                approvedChecks.push(failedCheck(
                    'cloudflare_staging_checkout_gate_rollback',
                    'Finally entered rollback, but the rollback procedure failed unexpectedly; state is ambiguous and requires immediate manual closure.',
                    [sanitize(safeErrorMessage(error)), `worker=${stagingWorkerName}`, 'rollbackState=ambiguous'],
                ));
            }
        }
    }

    if (bootstrapFailureNeedsCleanup && gateRollbackVerified) {
        const cleanupCapture = runCheckoutBootstrapCleanupCommand(merged);
        reportCaptures.push(cleanupCapture);
        approvedChecks.push({
            status: cleanupCapture.status,
            name: 'staging_checkout_bootstrap_failure_cleanup',
            message: cleanupCapture.status === 'ok'
                ? 'After the gate rollback attempt, a fresh subprocess verified cleanup of only incomplete bootstrap-owned Stripe/Supabase artifacts.'
                : 'After the gate rollback attempt, bootstrap artifact cleanup could not be verified; preserve the failed state for manual review.',
            details: [`exitCode=${cleanupCapture.exitCode ?? 'unknown'}`, `capture=${cleanupCapture.path}`, 'cleanupStartedAfterGateRollbackAttempt=true'],
        });
    } else if (bootstrapFailureNeedsCleanup) {
        approvedChecks.push(failedCheck(
            'staging_checkout_bootstrap_failure_cleanup',
            'Bootstrap cleanup was intentionally skipped because the Cloudflare checkout rollback is ambiguous; close and verify the gate manually before any data cleanup.',
            [`worker=${stagingWorkerName}`, 'cleanupStarted=false', 'priority=close-checkout-gate'],
        ));
    }

    return approvedChecks;
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
    if (!checkoutGateApprovalMatched) {
        approvedChecks.push(failedCheck(
            'exact_checkout_gate_approval',
            'The separate Cloudflare staging checkout-gate approval did not match, so no Cloudflare or smoke write was attempted.',
            [`env=${checkoutGateApprovalEnvVar}`, 'required=exact sentence in cloudflare-checkout-gate-approval.md'],
        ));
        return approvedChecks;
    }
    approvedChecks.push({
        status: 'ok',
        name: 'exact_checkout_gate_approval',
        message: 'The separate exact approval authorizes only the staging checkout override true/false window owned by this runner.',
        details: [`env=${checkoutGateApprovalEnvVar}`, `account=${cloudflareAccountId}`, `worker=${stagingWorkerName}`],
    });
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

    const cloudflarePreflight = runCloudflareReadOnlyPreflight();
    reportCaptures.push(...cloudflarePreflight.captures);
    approvedChecks.push(cloudflarePreflight.check);
    if (cloudflarePreflight.check.status !== 'ok') return approvedChecks;

    const preflightCapture = runSmokePreflightCommand(merged, 'false', 'before-gate-write');
    reportCaptures.push(preflightCapture);
    approvedChecks.push({
        status: preflightCapture.status,
        name: 'all_preconditions_before_writes',
        message: preflightCapture.status === 'ok'
            ? 'Read-only subprocess verified the closed deployed runtimes, Supabase staging, Google/Resend posture, catalog, role allowlist and reviewed payment evidence before any write.'
            : 'Read-only subprocess failed, so the write-capable smoke command was not started.',
        details: [
            `exitCode=${preflightCapture.exitCode ?? 'unknown'}`,
            `capture=${preflightCapture.path}`,
            'externalWriteCommandStarted=false',
        ],
    });
    if (preflightCapture.status !== 'ok') return approvedChecks;

    let gateWriteAttempted = false;
    try {
        gateWriteAttempted = true;
        const enableCapture = runCheckoutGateWrite('true', 'enable');
        reportCaptures.push(enableCapture);
        approvedChecks.push({
            status: enableCapture.status,
            name: 'cloudflare_staging_checkout_gate_enable',
            message: enableCapture.status === 'ok'
                ? 'The exact staging Worker checkout override write completed; deployed runtime verification is still required before smoke writes.'
                : 'The checkout override write failed or is ambiguous; smoke writes were not started and finally rollback is mandatory.',
            details: [`exitCode=${enableCapture.exitCode ?? 'unknown'}`, `capture=${enableCapture.path}`, `worker=${stagingWorkerName}`],
        });

        if (enableCapture.status === 'ok') {
            const enabledPreflight = runSmokePreflightCommand(merged, 'true', 'after-gate-write');
            reportCaptures.push(enabledPreflight);
            approvedChecks.push({
                status: enabledPreflight.status,
                name: 'enabled_runtime_before_smoke_writes',
                message: enabledPreflight.status === 'ok'
                    ? 'The newly deployed web runtime attests checkout override true while fulfillment remains staging-bound; all read-only prerequisites passed.'
                    : 'The enabled runtime could not be attested exactly, so the smoke command was not started.',
                details: [`exitCode=${enabledPreflight.exitCode ?? 'unknown'}`, `capture=${enabledPreflight.path}`],
            });

            if (enabledPreflight.status === 'ok') {
                const capture = runSmokeCommand(merged);
                reportCaptures.push(capture);
                approvedChecks.push({
                    status: capture.status,
                    name: 'staging_smoke_command',
                    message: capture.status === 'ok'
                        ? 'Staging smoke command exited successfully; inspect redacted real-env-smoke summary before closing integration evidence.'
                        : 'Staging smoke command did not exit successfully; finally rollback still ran before this runner returned.',
                    details: [`exitCode=${capture.exitCode ?? 'unknown'}`, `capture=${capture.path}`],
                });
            }
        }
    } catch (error) {
        approvedChecks.push(failedCheck(
            'staging_smoke_or_gate_unexpected_error',
            'An unexpected gate/smoke runner error occurred; finally rollback was still attempted.',
            [sanitize(safeErrorMessage(error))],
        ));
    } finally {
        if (gateWriteAttempted) {
            try {
                approvedChecks.push(runCheckoutGateRollback(merged, reportCaptures));
            } catch (error) {
                approvedChecks.push(failedCheck(
                    'cloudflare_staging_checkout_gate_rollback',
                    'Finally entered rollback, but the rollback procedure itself failed unexpectedly; state is ambiguous and requires immediate manual closure.',
                    [sanitize(safeErrorMessage(error)), `worker=${stagingWorkerName}`, 'rollbackState=ambiguous'],
                ));
            }
        }
    }

    return approvedChecks;
}

function runCheckoutBootstrapPreflightCommand(env: Record<string, string>): Capture {
    const capturePath = path.join(outputDir, 'staging-checkout-bootstrap-read-only-preflight.txt');
    const display = 'corepack pnpm --config.verify-deps-before-run=false exec tsx scripts/smoke-checkout.ts --bootstrap-preflight';
    const result = spawnSync('corepack', [
        'pnpm',
        '--config.verify-deps-before-run=false',
        'exec',
        'tsx',
        'scripts/smoke-checkout.ts',
        '--bootstrap-preflight',
    ], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 180_000,
        windowsHide: true,
    });
    writeFileSync(capturePath, [
        `# command\n${display}`,
        '# stdout',
        sanitize(result.stdout ?? ''),
        '# stderr',
        sanitize(result.stderr ?? ''),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n'), 'utf8');
    const exitCode = typeof result.status === 'number' ? result.status : null;
    return {
        id: 'staging-checkout-bootstrap-read-only-preflight',
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 ? 'ok' : 'failed',
        externalWriteCommandStarted: false,
    };
}

function runCheckoutBootstrapCommand(env: Record<string, string>): Capture {
    const capturePath = path.join(outputDir, 'staging-checkout-bootstrap-command-output.txt');
    const display = 'corepack pnpm --config.verify-deps-before-run=false exec tsx scripts/smoke-checkout.ts --bootstrap-preserve-open';
    const result = spawnSync('corepack', [
        'pnpm',
        '--config.verify-deps-before-run=false',
        'exec',
        'tsx',
        'scripts/smoke-checkout.ts',
        '--bootstrap-preserve-open',
    ], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 240_000,
        windowsHide: true,
    });
    writeFileSync(capturePath, [
        `# command\n${display}`,
        '# stdout',
        sanitize(result.stdout ?? ''),
        '# stderr',
        sanitize(result.stderr ?? ''),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n'), 'utf8');
    const exitCode = typeof result.status === 'number' ? result.status : null;
    return {
        id: 'staging-checkout-bootstrap-command',
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 ? 'ok' : 'failed',
        externalWriteCommandStarted: true,
    };
}

function runCheckoutBootstrapCleanupCommand(env: Record<string, string>): Capture {
    const capturePath = path.join(outputDir, 'staging-checkout-bootstrap-failure-cleanup.txt');
    const display = 'corepack pnpm --config.verify-deps-before-run=false exec tsx scripts/smoke-checkout.ts --bootstrap-cleanup';
    const result = spawnSync('corepack', [
        'pnpm',
        '--config.verify-deps-before-run=false',
        'exec',
        'tsx',
        'scripts/smoke-checkout.ts',
        '--bootstrap-cleanup',
    ], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 180_000,
        windowsHide: true,
    });
    writeFileSync(capturePath, [
        `# command\n${display}`,
        '# stdout',
        sanitize(result.stdout ?? ''),
        '# stderr',
        sanitize(result.stderr ?? ''),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n'), 'utf8');
    const exitCode = typeof result.status === 'number' ? result.status : null;
    return {
        id: 'staging-checkout-bootstrap-failure-cleanup',
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 ? 'ok' : 'failed',
        externalWriteCommandStarted: true,
    };
}

function runSmokePreflightCommand(
    env: Record<string, string>,
    expectedOverride: 'false' | 'true',
    phase: 'after-gate-write' | 'before-gate-write',
): Capture {
    const capturePath = path.join(outputDir, `staging-smoke-read-only-preflight-${phase}.txt`);
    const display = `node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts --preflight-only --expect-checkout-override ${expectedOverride}`;
    const result = spawnSync('node', [
        ...realEnvSmokeNodePrefix,
        '--preflight-only',
        '--expect-checkout-override',
        expectedOverride,
    ], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 180_000,
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
        id: `staging-smoke-read-only-preflight-${phase}`,
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 ? 'ok' : 'failed',
        externalWriteCommandStarted: false,
    };
}

function runRuntimePreflightCommand(env: Record<string, string>, expectedOverride: 'false' | 'true', attempt: number): Capture {
    const capturePath = path.join(outputDir, `staging-runtime-read-only-${expectedOverride}-attempt-${attempt}.txt`);
    const display = `node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts --runtime-preflight-only --expect-checkout-override ${expectedOverride}`;
    const result = spawnSync('node', [
        ...realEnvSmokeNodePrefix,
        '--runtime-preflight-only',
        '--expect-checkout-override',
        expectedOverride,
    ], {
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 120_000,
        windowsHide: true,
    });
    writeFileSync(capturePath, [
        `# command\n${display}`,
        '# stdout',
        sanitize(result.stdout ?? ''),
        '# stderr',
        sanitize(result.stderr ?? ''),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n'), 'utf8');
    const exitCode = typeof result.status === 'number' ? result.status : null;
    return {
        id: `staging-runtime-read-only-${expectedOverride}-attempt-${attempt}`,
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 ? 'ok' : 'failed',
        externalWriteCommandStarted: false,
    };
}

function runCloudflareReadOnlyPreflight(): { captures: Capture[]; check: Check } {
    const whoami = runWranglerCapture({
        args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'whoami', '--json'],
        display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler whoami --json',
        id: 'cloudflare-staging-whoami-read-only',
        writes: false,
    });
    const deployment = runWranglerCapture({
        args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'status', '--config', 'wrangler.toml', '--env', 'staging', '--json'],
        display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler deployments status --config wrangler.toml --env staging --json',
        id: 'cloudflare-staging-deployment-read-only',
        writes: false,
    });
    const config = readFileSync('wrangler.toml', 'utf8');
    const accountEnvOk = !process.env.CLOUDFLARE_ACCOUNT_ID
        || process.env.CLOUDFLARE_ACCOUNT_ID.trim() === cloudflareAccountId;
    const accountMatched = whoami.raw.includes(cloudflareAccountId);
    const deploymentIdentified = /"version_id"\s*:/u.test(deployment.raw);
    const stagingConfigExact = config.includes('[env.staging]')
        && config.includes(`name = "${stagingWorkerName}"`);
    const ok = whoami.capture.status === 'ok'
        && deployment.capture.status === 'ok'
        && accountEnvOk
        && accountMatched
        && deploymentIdentified
        && stagingConfigExact;
    return {
        captures: [whoami.capture, deployment.capture],
        check: {
            status: ok ? 'ok' : 'failed',
            name: 'cloudflare_staging_account_worker_preflight',
            message: ok
                ? 'Wrangler read-only preflight matched the exact Cloudflare account and staging Worker configuration before the gate write.'
                : 'Cloudflare account/Worker identity could not be proven exactly, so the gate write is blocked.',
            details: [
                `account=${cloudflareAccountId}`,
                `worker=${stagingWorkerName}`,
                `accountMatched=${String(accountMatched)}`,
                `accountEnvMatched=${String(accountEnvOk)}`,
                `deploymentIdentified=${String(deploymentIdentified)}`,
                `stagingConfigExact=${String(stagingConfigExact)}`,
                `whoamiCapture=${whoami.capture.path}`,
                `deploymentCapture=${deployment.capture.path}`,
            ],
        },
    };
}

function runCheckoutGateWrite(value: 'false' | 'true', phase: 'enable' | `rollback-${number}`): Capture {
    return runWranglerCapture({
        args: [
            'pnpm',
            '--config.verify-deps-before-run=false',
            'exec',
            'wrangler',
            'secret',
            'put',
            'CHECKOUT_ENABLED_OVERRIDE',
            '--config',
            'wrangler.toml',
            '--env',
            'staging',
        ],
        display: 'corepack pnpm --config.verify-deps-before-run=false exec wrangler secret put CHECKOUT_ENABLED_OVERRIDE --config wrangler.toml --env staging',
        id: phase === 'enable'
            ? 'cloudflare-staging-checkout-gate-enable'
            : `cloudflare-staging-checkout-gate-${phase}`,
        input: `${value}\n`,
        writes: true,
    }).capture;
}

function runCheckoutGateRollback(env: Record<string, string>, reportCaptures: Capture[]): Check {
    const details: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const rollback = runCheckoutGateWrite('false', `rollback-${attempt}`);
        reportCaptures.push(rollback);
        details.push(`rollbackAttempt${attempt}Exit=${rollback.exitCode ?? 'unknown'}`);

        const verification = runRuntimePreflightCommand(env, 'false', attempt);
        reportCaptures.push(verification);
        details.push(`verificationAttempt${attempt}Exit=${verification.exitCode ?? 'unknown'}`);
        if (verification.status === 'ok') {
            return {
                status: 'ok',
                name: 'cloudflare_staging_checkout_gate_rollback',
                message: 'Finally restored CHECKOUT_ENABLED_OVERRIDE=false and the deployed runtime attestation plus 403 gate probe verified the rollback.',
                details: [
                    ...details,
                    `worker=${stagingWorkerName}`,
                    'rollbackState=verified-false',
                ],
            };
        }
    }
    return {
        status: 'failed',
        name: 'cloudflare_staging_checkout_gate_rollback',
        message: 'Finally attempted the bounded rollback, but deployed CHECKOUT_ENABLED_OVERRIDE=false could not be verified; state is ambiguous and requires immediate manual closure.',
        details: [
            ...details,
            `worker=${stagingWorkerName}`,
            'rollbackState=ambiguous',
        ],
    };
}

function runWranglerCapture(input: {
    args: string[];
    display: string;
    id: string;
    input?: string;
    writes: boolean;
}): { capture: Capture; raw: string } {
    const capturePath = path.join(outputDir, `${input.id}.txt`);
    const result = spawnSync('corepack', input.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        input: input.input,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
    });
    const raw = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    writeFileSync(capturePath, [
        `# command\n${input.display}`,
        `# exit\n${typeof result.status === 'number' ? result.status : 'unknown'}`,
        '# output',
        sanitize(raw),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n'), 'utf8');
    const exitCode = typeof result.status === 'number' ? result.status : null;
    return {
        capture: {
            id: input.id,
            display: input.display,
            path: capturePath,
            exitCode,
            status: !result.error && exitCode === 0 ? 'ok' : 'failed',
            externalWriteCommandStarted: input.writes,
        },
        raw,
    };
}

function runSmokeCommand(env: Record<string, string>): Capture {
    const capturePath = path.join(outputDir, 'staging-smoke-command-output.txt');
    const display = 'node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts';
    const result = spawnSync('node', realEnvSmokeNodePrefix, {
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

function buildSmokeEnv(stagingEnv: Record<string, string>, _baseEnvValues: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};

    for (const name of [
        'STRIPE_SECRET_KEY',
        'PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_EXPECTED_ACCOUNT_ID',
        'STRIPE_PORTAL_CONFIGURATION_ID',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
    ]) {
        if (stagingEnv[name]) env[name] = stagingEnv[name];
    }

    for (const name of [
        'PUBLIC_SUPABASE_URL',
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'RESEND_API_KEY',
        'RESEND_FROM_EMAIL',
        'EMAIL_RECIPIENT_ALLOWLIST',
        'PUBLIC_APP_ENV',
        'PUBLIC_SITE_URL',
        'CHECKOUT_ENABLED',
        'CHECKOUT_ENABLED_OVERRIDE',
        'EMAIL_DELIVERY_MODE',
        'EMAIL_DAILY_RECIPIENT_LIMIT',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT',
        'FULFILLMENT_WORKER_URL',
        'INTERNAL_JOB_SECRET',
    ]) {
        if (stagingEnv[name]) env[name] = stagingEnv[name];
    }

    env.SMOKE_BASE_URL = baseUrl;
    env.SMOKE_EXTERNAL_WRITES_CONFIRMATION = confirmation;
    env.SMOKE_ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || stagingEnv.TEST_ADMIN_EMAIL || '';
    env.SMOKE_ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || stagingEnv.TEST_ADMIN_PASSWORD || '';
    env.SMOKE_TEACHER_EMAIL = process.env.SMOKE_TEACHER_EMAIL || stagingEnv.TEST_TEACHER_EMAIL || '';
    env.SMOKE_TEACHER_PASSWORD = process.env.SMOKE_TEACHER_PASSWORD || stagingEnv.TEST_TEACHER_PASSWORD || '';
    env.SMOKE_STUDENT_EMAIL = process.env.SMOKE_STUDENT_EMAIL || stagingEnv.TEST_STUDENT_EMAIL || '';
    env.SMOKE_STUDENT_PASSWORD = process.env.SMOKE_STUDENT_PASSWORD || stagingEnv.TEST_STUDENT_PASSWORD || '';
    env.SMOKE_COMPLETED_CHECKOUT_SESSION_ID = process.env.SMOKE_COMPLETED_CHECKOUT_SESSION_ID || stagingEnv.SMOKE_COMPLETED_CHECKOUT_SESSION_ID || '';
    env.SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION = process.env.SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION || stagingEnv.SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION || '';
    env.EMAIL_FROM = stagingEnv.EMAIL_FROM || stagingEnv.RESEND_FROM_EMAIL || '';
    env[checkoutGateConfirmationEnvVar] = checkoutGateConfirmation;
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

function resolveEnvName(name: string, stagingEnv: Record<string, string>, _baseEnvValues: Record<string, string>): string | null {
    if (name === 'SMOKE_BASE_URL') return baseUrl;
    if (name === 'SMOKE_EXTERNAL_WRITES_CONFIRMATION') return confirmation;
    if (name === checkoutGateConfirmationEnvVar) return checkoutGateConfirmation;
    if (name === 'SMOKE_ADMIN_EMAIL') return process.env.SMOKE_ADMIN_EMAIL || stagingEnv.TEST_ADMIN_EMAIL || null;
    if (name === 'SMOKE_ADMIN_PASSWORD') return process.env.SMOKE_ADMIN_PASSWORD || stagingEnv.TEST_ADMIN_PASSWORD || null;
    if (name === 'SMOKE_TEACHER_EMAIL') return process.env.SMOKE_TEACHER_EMAIL || stagingEnv.TEST_TEACHER_EMAIL || null;
    if (name === 'SMOKE_TEACHER_PASSWORD') return process.env.SMOKE_TEACHER_PASSWORD || stagingEnv.TEST_TEACHER_PASSWORD || null;
    if (name === 'SMOKE_STUDENT_EMAIL') return process.env.SMOKE_STUDENT_EMAIL || stagingEnv.TEST_STUDENT_EMAIL || null;
    if (name === 'SMOKE_STUDENT_PASSWORD') return process.env.SMOKE_STUDENT_PASSWORD || stagingEnv.TEST_STUDENT_PASSWORD || null;
    return process.env[name] || stagingEnv[name] || null;
}

function mappedStagingName(name: string): string[] {
    const map: Record<string, string[]> = {
        SMOKE_ADMIN_EMAIL: ['TEST_ADMIN_EMAIL'],
        SMOKE_ADMIN_PASSWORD: ['TEST_ADMIN_PASSWORD'],
        SMOKE_TEACHER_EMAIL: ['TEST_TEACHER_EMAIL'],
        SMOKE_TEACHER_PASSWORD: ['TEST_TEACHER_PASSWORD'],
        SMOKE_STUDENT_EMAIL: ['TEST_STUDENT_EMAIL'],
        SMOKE_STUDENT_PASSWORD: ['TEST_STUDENT_PASSWORD'],
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
    const checkoutGateApproval = renderCheckoutGateApproval(reportToRender);
    const rollbackAfterStagingSmoke = renderRollback(reportToRender);
    const manualEvidenceAfterStagingSmoke = renderManualEvidence(reportToRender);
    const summary = renderSummary(reportToRender);

    return {
        commandManifest,
        executionPlan,
        approvalGate,
        checkoutGateApproval,
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
        mode: reportToRender.executeRequested
            ? bootstrapCheckoutRequested ? 'bootstrap-checkout-approved' : 'execute-approved'
            : 'plan',
        baseUrl: reportToRender.baseUrl,
        confirmation: reportToRender.confirmation,
        approvalEnvVar: reportToRender.approvalEnvVar,
        checkoutGateApprovalEnvVar: reportToRender.checkoutGateApprovalEnvVar,
        approvalMatched: reportToRender.approvalMatched,
        checkoutGateApprovalMatched: reportToRender.checkoutGateApprovalMatched,
        externalWriteCommandStarted: reportToRender.externalWriteCommandStarted,
        checkoutGateWriteAttempted: reportToRender.checkoutGateWriteAttempted,
        checkoutGateRollbackVerified: reportToRender.checkoutGateRollbackVerified,
        command: bootstrapCheckoutRequested
            ? 'corepack pnpm --config.verify-deps-before-run=false launch:staging-smoke-rehearsal-runner -- --bootstrap-checkout-approved'
            : 'node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts',
        requiredEnvNames: reportToRender.requiredEnvNames,
        envSourceMatrix: reportToRender.envSourceMatrix,
        safety: {
            planModeDoesNotRunSmoke: !reportToRender.executeRequested,
            exactApprovalRequired: true,
            allPreconditionsRunInSeparateReadOnlySubprocess: true,
            cloudflareCheckoutGateWritePerformedByRunner: reportToRender.checkoutGateWriteAttempted,
            cloudflareCheckoutGateRollbackOwnedByFinally: true,
            stripeLiveModeRejected: true,
            secretValuesStored: false,
            finalSmokeClosedByThisRunner: false,
        },
        forbiddenScope: [
            'No production smoke and no live-domain claim from this rehearsal.',
            'No secret value printing, screenshots, commits or output files.',
            'No password reset for owner/admin/teacher accounts.',
            'No Stripe live mode or real charge.',
            'No Cloudflare write except the separately approved CHECKOUT_ENABLED_OVERRIDE true/false window on the exact staging Worker.',
            'No Cloudflare code, route, domain or DNS change.',
            'No Supabase schema migration, destructive cleanup or broad data deletion.',
            'No Google Drive/Calendar cleanup outside smoke-created artifacts.',
        ],
        files: {
            executionPlan: fileMeta(reportToRender.executionPlanPath, renderExecutionPlan(reportToRender)),
            approvalGate: fileMeta(reportToRender.approvalGatePath, renderApprovalGate(reportToRender)),
            checkoutGateApproval: fileMeta(reportToRender.checkoutGateApprovalPath, renderCheckoutGateApproval(reportToRender)),
            rollback: fileMeta(reportToRender.rollbackAfterStagingSmokePath, renderRollback(reportToRender)),
            manualEvidence: fileMeta(reportToRender.manualEvidenceAfterStagingSmokePath, renderManualEvidence(reportToRender)),
            summary: fileMeta(reportToRender.summaryPath, renderSummary(reportToRender)),
        },
        checks: reportToRender.checks,
        captures: reportToRender.captures.map((capture) => ({ ...capture, path: toRelative(capture.path) })),
    }, null, 2)}\n`;
}

function renderExecutionPlan(reportToRender: RunnerReport): string {
    const approvedSteps = bootstrapCheckoutRequested
        ? [
            '1. Materialize staging names in memory and reject missing names, Stripe live, a different Stripe account or a non-allowlisted role set.',
            '2. Verify the exact Wrangler account/Worker and attest the deployed runtime with checkout override `false`.',
            '3. Run the Checkout bootstrap read-only preflight: catalog, Student, CRM contact, no blocking subscription and no conflicting Customer state.',
            '4. Write only `CHECKOUT_ENABLED_OVERRIDE=true`, re-attest the enabled runtime and prepare one Standard one-month Stripe test Checkout under a Test Clock.',
            '5. Preserve the verified open Checkout and copy its URL only to the local clipboard; do not store it in evidence or logs.',
            '6. In `finally`, restore `CHECKOUT_ENABLED_OVERRIDE=false` and require signed runtime attestation plus `403 Checkout is disabled`.',
        ]
        : [
            '1. Materialize staging smoke environment names in memory from `.env.staging`, explicit process gates and generated host confirmation.',
            '2. Reject missing names, live Stripe, non-allowlisted role emails, missing completed Checkout/manual lifecycle evidence or either missing exact approval.',
            '3. Verify Wrangler account/Worker and run the complete read-only preflight with deployed checkout override `false`, including signed web/fulfillment runtime attestations.',
            '4. Write only `CHECKOUT_ENABLED_OVERRIDE=true`, then re-run the full read-only preflight and require the enabled web runtime attestation before any smoke write.',
            '5. Run the smoke only after both preflights pass; capture sanitized output and redacted evidence.',
            '6. In `finally`, write `CHECKOUT_ENABLED_OVERRIDE=false` and require signed runtime attestation plus the `403 Checkout is disabled` probe; retry at most three times and fail as ambiguous if it cannot be verified.',
        ];
    return `${[
        '# Staging Smoke Rehearsal Runner Execution Plan',
        '',
        `- Status: ${reportToRender.status}`,
        `- Closure: ${reportToRender.closureStatus}`,
        `- Execute requested: ${String(reportToRender.executeRequested)}`,
        `- Approval matched: ${String(reportToRender.approvalMatched)}`,
        `- Checkout-gate approval matched: ${String(reportToRender.checkoutGateApprovalMatched)}`,
        `- Checkout-gate rollback verified: ${String(reportToRender.checkoutGateRollbackVerified)}`,
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
        'First review `cloudflare-checkout-gate-approval.md` and provide both exact approvals. The runner owns the one staging gate window and its mandatory `finally` rollback.',
        '',
        '```powershell',
        `$env:${approvalEnvVar}='${exactApprovalSentence.replace(/'/g, "''")}'`,
        `$env:${checkoutGateApprovalEnvVar}='${exactCheckoutGateApprovalSentence.replace(/'/g, "''")}'`,
        `corepack pnpm --config.verify-deps-before-run=false launch:staging-smoke-rehearsal-runner -- ${executionFlag}`,
        '```',
        '',
        'The runner will:',
        '',
        ...approvedSteps,
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
        `- Required flag: \`${executionFlag}\`.`,
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
        '- Stripe live mode or real charges.',
        '- Any Cloudflare write, including the temporary checkout gate; use `cloudflare-checkout-gate-approval.md` as a separate approval boundary.',
        '- Supabase migrations, schema changes, destructive cleanup or broad data deletion.',
        '- Secret value printing or private payload evidence.',
        '',
    ].join('\n')}\n`;
}

function renderCheckoutGateApproval(reportToRender: RunnerReport): string {
    return `${[
        '# Separate Cloudflare Staging Checkout Gate Approval',
        '',
        'This file is not permission. It documents the separate exact approval under which the approved runner owns the single Cloudflare staging gate window and its mandatory rollback.',
        '',
        '- Exact resource: Cloudflare Worker staging `espanolhonesto-staging`.',
        '- Exact variable: `CHECKOUT_ENABLED_OVERRIDE`.',
        '- Temporary value: `true` only for the approved Stripe test Checkout/smoke window.',
        '- Mandatory rollback: `false` on the same Worker immediately after success or failure.',
        `- Approval environment variable: \`${checkoutGateApprovalEnvVar}\`.`,
        `- Internal harness confirmation: ${checkoutGateConfirmationEnvVar}=${checkoutGateConfirmation}.`,
        '- Verification before smoke writes: signed web/fulfillment runtime attestations plus an unauthenticated valid-shape request that must return `401` only during the gate window.',
        '- Verification after `finally`: signed attestations plus `403 Checkout is disabled`.',
        `- Gate write attempted: ${String(reportToRender.checkoutGateWriteAttempted)}.`,
        `- Gate rollback verified: ${String(reportToRender.checkoutGateRollbackVerified)}.`,
        '',
        '## Exact Separate Approval Sentence',
        '',
        exactCheckoutGateApprovalSentence,
        '',
        '## Safety Boundary',
        '',
        `- The runner requires a fresh read-only match for account \`${cloudflareAccountId}\` and Worker \`${stagingWorkerName}\` before the first write.`,
        '- No Cloudflare code, route, domain, DNS or other binding/secret write is authorized.',
        '- Do not paste a token or secret value into this file, logs, chat or evidence.',
        '- The staging smoke approval is not a substitute for this approval.',
        '- This approval never covers production.',
        '',
    ].join('\n')}\n`;
}

function renderRollback(reportToRender: RunnerReport): string {
    return `${[
        '# Staging Smoke Rehearsal Rollback And Cleanup',
        '',
        'This file does not authorize cleanup writes by itself. Use it after an approved staging smoke run.',
        '',
        reportToRender.checkoutGateWriteAttempted
            ? `- The gate write was attempted. Final rollback verification: ${reportToRender.checkoutGateRollbackVerified ? 'verified-false' : 'ambiguous; immediate manual closure required'}.`
            : '- No staging gate write was attempted by this runner run. No gate rollback is required.',
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
        '- The harness reuses the existing allowlisted student; it creates zero Auth users and never needs access to that inbox.',
        '- It deletes its unconverted CRM opportunity/checkout intent, temporary scheduling subscription/sessions, Google class docs/events, fulfillment job and matching audit rows; the reusable student and folder ID remain.',
        '- It restores prior notes, Google-link value and teacher assignments. A cleanup failure keeps the smoke failed.',
        '- Leave the completed Checkout/webhook/payment evidence and all non-smoke customer/student data untouched.',
        '- Do not run Supabase schema migrations as part of smoke cleanup.',
        '- The runner restores `CHECKOUT_ENABLED_OVERRIDE=false` inside `finally`; do not accept the run unless signed attestation and `403 Checkout is disabled` verify it. If the report says ambiguous, close it manually immediately before any rerun.',
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
    const checkoutGateApprovalPath = `../../${toRelative(reportToRender.checkoutGateApprovalPath)}`;
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
        `  --evidence "command_output=${checkoutGateApprovalPath}::separate Cloudflare checkout gate approval and mandatory rollback reviewed"`,
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
        `- Checkout-gate approval matched: ${String(reportToRender.checkoutGateApprovalMatched)}`,
        `- External write command started: ${String(reportToRender.externalWriteCommandStarted)}`,
        `- Checkout-gate write attempted: ${String(reportToRender.checkoutGateWriteAttempted)}`,
        `- Checkout-gate rollback verified: ${String(reportToRender.checkoutGateRollbackVerified)}`,
        `- Command manifest: ${toRelative(reportToRender.commandManifestPath)}`,
        `- Execution plan: ${toRelative(reportToRender.executionPlanPath)}`,
        `- Approval gate: ${toRelative(reportToRender.approvalGatePath)}`,
        `- Separate checkout gate approval: ${toRelative(reportToRender.checkoutGateApprovalPath)}`,
        `- Rollback: ${toRelative(reportToRender.rollbackAfterStagingSmokePath)}`,
        `- Manual evidence dry run: ${toRelative(reportToRender.manualEvidenceAfterStagingSmokePath)}`,
        '',
        `This runner is plan-only unless both exact approval environment variables (\`${approvalEnvVar}\` and \`${checkoutGateApprovalEnvVar}\`) plus \`${executionFlag}\` are present. Approved mode first proves the closed deployed runtimes, owns only the exact temporary gate write, re-attests before any write and restores/verifies \`false\` inside \`finally\`.`,
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
        'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
        'No Cloudflare code, route, domain or DNS change',
        'Stripe live',
        'redacted',
        'rollback',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const hasValidClosure = [
        'PLAN_ONLY_READY',
        'EXECUTED_AND_NEEDS_REVIEW',
        'BLOCKED_BY_GATE_OR_ARTIFACTS',
    ].some((closure) => combined.includes(closure));
    if (!hasValidClosure) missing.push('validClosureStatus');

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
        .replace(/https:\/\/checkout\.stripe\.com\/[^\s"')]+/g, '[redacted-checkout-url]')
        .replace(/\b(?:cs|cus|sub|in|pi|evt|price|prod|pm)_(?:test|live)?_?[A-Za-z0-9_]+\b/g, '[redacted-stripe-id]')
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
