import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildSanitizedWranglerOAuthEnvironment } from './cloudflare-wrangler-oauth';
import {
    parseStagingSmokeEmailBudget,
    parseWranglerWhoamiSummary,
    RESEND_FREE_DAILY_RECIPIENT_LIMIT,
    RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
    runCleanupOwnedNodeCommand,
    runDirectNodeCommand,
    sanitizeStagingSmokeCapture as sanitize,
    STAGING_SMOKE_EMAIL_RECIPIENT_PLAN,
    STAGING_SMOKE_PLANNED_RECIPIENTS,
    type StagingSmokeEmailBudgetAssessment,
    wranglerCliArgs,
} from './staging-smoke-runner-safety';

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
    emailRecipientBudget?: StagingSmokeEmailBudgetAssessment | null;
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

const smokeApprovalEnvVar = 'STAGING_SMOKE_REHEARSAL_APPROVAL';
const cloudflareAccountId = 'd1a22bcf6477ff2ff31d2bfb83084e44';
const stagingWorkerName = 'espanolhonesto-staging';
const baseUrl = 'https://staging.espanolhonesto.com';
const confirmation = 'writes-ok:staging.espanolhonesto.com';
const realEnvSmokeNodePrefix = [
    '--import',
    'tsx',
    '--import',
    './scripts/smoke/astro-env-node-register.mjs',
    'scripts/smoke/real-env-smoke.ts',
];
const exactSmokeApprovalSentence = 'Apruebo ejecutar un smoke rehearsal de staging con writes externos contra `SMOKE_BASE_URL=https://staging.espanolhonesto.com`, con `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:staging.espanolhonesto.com`, usando exclusivamente las cuentas allowlisted existentes de alumno, admin y profesor, con Stripe test mode, evidencia de Checkout/webhooks reales ya completada y evidencia canonica `SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH` del mismo ciclo billing terminada y prevalidada read-only, manteniendo `CHECKOUT_ENABLED_OVERRIDE=false` durante toda la ejecucion, permitiendo unicamente writes de smoke necesarios en Supabase staging, Google, Resend y Admin Jobs, sin crear ni expirar nuevas Checkout Sessions, sin crear usuarios Auth, sin necesitar acceso al buzon del alumno, sin imprimir secretos, sin guardar datos privados en evidencia, sin resetear contrasenas, sin fabricar eventos Stripe, sin activar pagos reales, sin cambiar Cloudflare/DNS/dominios y con cleanup automatico de jobs, sesiones y artefactos temporales. No autorizo ningun otro cambio externo.';
const fullSmokeRequested = process.argv.includes('--execute-approved');
const executeRequested = fullSmokeRequested;
const executionFlag = '--execute-approved';
const approvalEnvVar = smokeApprovalEnvVar;
const exactApprovalSentence = exactSmokeApprovalSentence;
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;

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
    row('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH', '.env.staging', 'canonical completed billing lifecycle summary.json'),
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
    validateNodeSmokeRuntimeBridge(),
    validateFinalSmokePackArtifacts(),
    validateEnvSources(),
    validateApprovalGateSource(),
];

if (executeRequested && checks.some((check) => check.status === 'failed')) {
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
        "requireEnv('SMOKE_STUDENT_EMAIL')",
        "requireEnv('SMOKE_STUDENT_PASSWORD')",
        "requireEnv('SMOKE_COMPLETED_CHECKOUT_SESSION_ID')",
        "requireEnv('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH')",
        'validateCanonicalLifecycleReport',
        'revalidateCanonicalLifecycleState',
        'writes-ok:${parsedUrl.host}',
        '--preflight-only',
        '--runtime-preflight-only',
        'verifyDeployedStagingRuntime',
        'runReadOnlyPreflight',
        'verifyStagingSmokeEmailBudget',
        "from('email_recipient_budget_usage')",
        "'month'",
        'STAGING_SMOKE_PLANNED_RECIPIENTS',
        'sendEmail: false',
        'createNoEmailSchedulingVariant',
        'cancelSchedulingVariantWithoutEmail',
        'externalWritesStarted: false',
        'authUsersCreated: 0',
        'redactSmokeResult(result)',
        'writeSmokeEvidence',
        'runAdminJobsRecoverySmoke',
        "EXPECTED_CHECKOUT_OVERRIDE !== 'false'",
        'completed-checkout-evidence-preserved',
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
        exactSmokeApprovalSentence,
        'READY_FOR_STAGING_SMOKE_APPROVAL',
        'Stripe test mode',
        'CHECKOUT_ENABLED_OVERRIDE=false',
        'No Cloudflare write',
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
    const completedSessionId = resolveEnvName('SMOKE_COMPLETED_CHECKOUT_SESSION_ID', stagingEnv, baseEnv);
    const billingEvidencePath = resolveEnvName('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH', stagingEnv, baseEnv);
    const emailDailyLimit = Number(resolveEnvName('EMAIL_DAILY_RECIPIENT_LIMIT', stagingEnv, baseEnv));
    const emailDailyLimitOk = Number.isSafeInteger(emailDailyLimit)
        && emailDailyLimit > 0
        && emailDailyLimit <= RESEND_FREE_DAILY_RECIPIENT_LIMIT;
    const emailMonthlyLimit = Number(resolveEnvName('EMAIL_MONTHLY_RECIPIENT_LIMIT', stagingEnv, baseEnv));
    const emailMonthlyLimitOk = Number.isSafeInteger(emailMonthlyLimit)
        && emailMonthlyLimit > 0
        && emailMonthlyLimit <= RESEND_FREE_MONTHLY_RECIPIENT_LIMIT;
    const roleEmails = [
        resolveEnvName('SMOKE_ADMIN_EMAIL', stagingEnv, baseEnv),
        resolveEnvName('SMOKE_TEACHER_EMAIL', stagingEnv, baseEnv),
        resolveEnvName('SMOKE_STUDENT_EMAIL', stagingEnv, baseEnv),
    ].filter((value): value is string => Boolean(value)).map((value) => value.toLowerCase());
    const allowlist = new Set((resolveEnvName('EMAIL_RECIPIENT_ALLOWLIST', stagingEnv, baseEnv) ?? '')
        .split(/[;,]/u)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean));
    const normalizedBillingEvidencePath = billingEvidencePath?.replace(/\\/gu, '/') ?? '';
    const billingEvidencePathShapeOk = normalizedBillingEvidencePath.endsWith('/summary.json')
        && normalizedBillingEvidencePath.includes('outputs/launch-staging-billing-lifecycle/');
    const canonicalEvidenceShapeOk = Boolean(
        completedSessionId
        && /^cs_test_[A-Za-z0-9_]+$/u.test(completedSessionId)
        && billingEvidencePathShapeOk
    );
    const roleAllowlistOk = roleEmails.length === 3
        && new Set(roleEmails).size === 3
        && allowlist.size === 3
        && roleEmails.every((email) => allowlist.has(email) && !email.endsWith('@example.com'));
    const ok = missing.length === 0
        && stripeMode === 'test'
        && canonicalEvidenceShapeOk
        && roleAllowlistOk
        && emailDailyLimitOk
        && emailMonthlyLimitOk;

    return {
        status: ok ? 'ok' : executeRequested ? 'failed' : 'warning',
        name: 'staging_smoke_env_source_shape',
        message: ok
            ? 'Staging env has test Stripe, completed Checkout/canonical billing evidence and exactly the three existing allowlisted role accounts.'
            : 'Staging env is missing a required name or fails the Stripe, completed/canonical evidence or role allowlist contract.',
        details: [
            `missingNames=${missing.map((item) => item.name).join(',') || 'none'}`,
            `stripeSecretMode=${stripeMode}`,
            `completedCheckoutAndCanonicalLifecycleShape=${String(canonicalEvidenceShapeOk)}`,
            `canonicalBillingEvidencePathShape=${String(billingEvidencePathShapeOk)}`,
            `exactRoleAllowlist=${String(roleAllowlistOk)}`,
            `emailDailyLimitAtOrBelowResendFreeCap=${String(emailDailyLimitOk)}`,
            `resendFreeDailyRecipientLimit=${RESEND_FREE_DAILY_RECIPIENT_LIMIT}`,
            `emailMonthlyLimitAtOrBelowResendFreeCap=${String(emailMonthlyLimitOk)}`,
            `resendFreeMonthlyRecipientLimit=${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}`,
            'valuesPrinted=false',
        ],
    };
}

function validateApprovalGateSource(): Check {
    const source = readFileSync(new URL(import.meta.url), 'utf8');
    const requiredBySource = [
        {
            label: 'runner',
            source,
            snippets: [
                approvalEnvVar,
                exactSmokeApprovalSentence,
                '--preflight-only',
                'runSmokePreflightCommand',
                '--execute-approved',
                'approvalMatched',
                'SMOKE_BASE_URL',
                'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
                'STRIPE_SECRET_KEY',
                'sk_live_',
                'sanitize',
                'externalWriteCommandStarted',
                "--expect-checkout-override', 'false'",
                'runDirectNodeCommand',
                'runCleanupOwnedNodeCommand',
                'parseStagingSmokeEmailBudget',
                'STAGING_SMOKE_PLANNED_RECIPIENTS',
                'RESEND_FREE_DAILY_RECIPIENT_LIMIT',
                'RESEND_FREE_MONTHLY_RECIPIENT_LIMIT',
            ],
        },
    ];
    const missing = requiredBySource.flatMap((group) => group.snippets
        .filter((snippet) => !group.source.includes(snippet))
        .map((snippet) => `${group.label}:${snippet}`));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains exact approval gate, staging host confirmation, Stripe live rejection and sanitized capture posture.'
            : 'Runner source is missing required approval-gate safeguards.',
        details: missing.length === 0 ? [`env=${approvalEnvVar}`, `flag=${executionFlag}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function runApprovedExecution(reportCaptures: Capture[]): Check[] {
    const approvedChecks: Check[] = [{
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact staging smoke approval matched; executing the guarded smoke with checkout closed throughout.',
        details: [
            `env=${approvalEnvVar}`,
            'flag=--execute-approved',
            `SMOKE_BASE_URL=${baseUrl}`,
            `SMOKE_EXTERNAL_WRITES_CONFIRMATION=${confirmation}`,
            'CHECKOUT_ENABLED_OVERRIDE=false-throughout',
        ],
    }];

    const stagingEnv = parseEnvFile('.env.staging');
    const baseEnv = parseEnvFile('.env');
    const merged = buildSmokeEnv(stagingEnv, baseEnv);
    const missing = requiredEnvNames.filter((name) => !merged[name]);
    if (missing.length > 0) {
        approvedChecks.push(failedCheck(
            'approved_env_materialization',
            'Approved execution cannot run because required env names are missing.',
            missing.map((name) => `missing=${name}`),
        ));
        return approvedChecks;
    }

    if (merged.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
        approvedChecks.push(failedCheck(
            'stripe_test_mode_guard',
            'Approved execution refused to run with a Stripe live secret key.',
            ['stripeSecretMode=live'],
        ));
        return approvedChecks;
    }
    if (merged.CHECKOUT_ENABLED_OVERRIDE !== 'false') {
        approvedChecks.push(failedCheck(
            'checkout_closed_source_guard',
            'Approved execution requires the local staging source to keep CHECKOUT_ENABLED_OVERRIDE=false.',
            ['CHECKOUT_ENABLED_OVERRIDE must equal false', 'externalWriteCommandStarted=false'],
        ));
        return approvedChecks;
    }

    approvedChecks.push({
        status: 'ok',
        name: 'approved_env_materialization',
        message: 'Approved execution materialized staging names and completed Checkout/canonical billing evidence without printing values.',
        details: [
            'valuesPrinted=false',
            `SMOKE_BASE_URL=${baseUrl}`,
            `SMOKE_EXTERNAL_WRITES_CONFIRMATION=${confirmation}`,
            'completedCheckoutEvidenceReused=true',
            'canonicalBillingLifecycleEvidenceRequired=true',
        ],
    });

    const cloudflarePreflight = runCloudflareReadOnlyPreflight();
    reportCaptures.push(...cloudflarePreflight.captures);
    approvedChecks.push(cloudflarePreflight.check);
    if (cloudflarePreflight.check.status !== 'ok') return approvedChecks;

    const preflightCapture = runSmokePreflightCommand(merged);
    reportCaptures.push(preflightCapture);
    approvedChecks.push({
        status: preflightCapture.status,
        name: 'all_preconditions_before_writes',
        message: preflightCapture.status === 'ok'
            ? 'Read-only subprocess verified the closed runtime, payment evidence and the strict Resend Free recipient budget before any smoke write.'
            : 'Read-only subprocess failed, so the write-capable smoke command was not started.',
        details: [
            `exitCode=${preflightCapture.exitCode ?? 'unknown'}`,
            `capture=${preflightCapture.path}`,
            `emailCurrentDailyRecipients=${preflightCapture.emailRecipientBudget?.currentDailyRecipients ?? 'unverified'}`,
            `emailPlannedSmokeRecipients=${preflightCapture.emailRecipientBudget?.plannedSmokeRecipients ?? STAGING_SMOKE_PLANNED_RECIPIENTS}`,
            `emailProjectedDailyRecipients=${preflightCapture.emailRecipientBudget?.projectedDailyRecipients ?? 'unverified'}`,
            `emailStrictDailyLimit=${RESEND_FREE_DAILY_RECIPIENT_LIMIT}`,
            `emailCurrentMonthlyRecipients=${preflightCapture.emailRecipientBudget?.currentMonthlyRecipients ?? 'unverified'}`,
            `emailProjectedMonthlyRecipients=${preflightCapture.emailRecipientBudget?.projectedMonthlyRecipients ?? 'unverified'}`,
            `emailStrictMonthlyLimit=${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}`,
            'CHECKOUT_ENABLED_OVERRIDE=false',
            'externalWriteCommandStarted=false',
        ],
    });
    if (preflightCapture.status !== 'ok') return approvedChecks;

    const capture = runSmokeCommand(merged);
    reportCaptures.push(capture);
    approvedChecks.push({
        status: capture.status,
        name: 'staging_smoke_command',
        message: capture.status === 'ok'
            ? 'Staging smoke exited successfully after validating canonical billing evidence, while reusing the completed Checkout and keeping checkout closed.'
            : 'Staging smoke did not exit successfully; checkout remained closed and no Cloudflare write was attempted.',
        details: [
            `exitCode=${capture.exitCode ?? 'unknown'}`,
            `capture=${capture.path}`,
            'cloudflareWritesStarted=false',
            'writeChildHardTimeout=false',
        ],
    });

    return approvedChecks;
}

function runSmokePreflightCommand(env: Record<string, string>): Capture {
    const capturePath = path.join(outputDir, 'staging-smoke-read-only-preflight-checkout-closed.txt');
    const display = 'node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts --preflight-only --expect-checkout-override false';
    const result = runDirectNodeCommand([
        ...realEnvSmokeNodePrefix,
        '--preflight-only',
        '--expect-checkout-override',
        'false',
    ], {
        env: { ...process.env, ...env },
        timeoutMs: 180_000,
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
    const emailRecipientBudget = parseStagingSmokeEmailBudget(result.stdout ?? '');
    return {
        id: 'staging-smoke-read-only-preflight-checkout-closed',
        display,
        path: capturePath,
        exitCode,
        status: !result.error && exitCode === 0 && emailRecipientBudget ? 'ok' : 'failed',
        externalWriteCommandStarted: false,
        emailRecipientBudget,
    };
}

function runCloudflareReadOnlyPreflight(): { captures: Capture[]; check: Check } {
    const whoami = runWranglerWhoamiCapture();
    const deployment = runWranglerCapture({
        args: ['deployments', 'status', '--config', 'wrangler.toml', '--env', 'staging', '--json'],
        display: 'node node_modules/wrangler/bin/wrangler.js deployments status --config wrangler.toml --env staging --json',
        id: 'cloudflare-staging-deployment-read-only',
        writes: false,
    });
    const config = readFileSync('wrangler.toml', 'utf8');
    const accountEnvOk = !process.env.CLOUDFLARE_ACCOUNT_ID
        || process.env.CLOUDFLARE_ACCOUNT_ID.trim() === cloudflareAccountId;
    const accountMatched = whoami.summary.accountIds.includes(cloudflareAccountId);
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
                ? 'Wrangler read-only preflight matched the exact Cloudflare account and staging Worker while leaving checkout closed.'
                : 'Cloudflare account/Worker identity could not be proven exactly, so smoke writes are blocked.',
            details: [
                `account=${cloudflareAccountId}`,
                `worker=${stagingWorkerName}`,
                `accountMatched=${String(accountMatched)}`,
                `accountEnvMatched=${String(accountEnvOk)}`,
                `deploymentIdentified=${String(deploymentIdentified)}`,
                `stagingConfigExact=${String(stagingConfigExact)}`,
                `whoamiCapture=${whoami.capture.path}`,
                `deploymentCapture=${deployment.capture.path}`,
                'operatorIdentityPersisted=false',
            ],
        },
    };
}

function runWranglerWhoamiCapture() {
    const id = 'cloudflare-staging-whoami-read-only';
    const display = 'node node_modules/wrangler/bin/wrangler.js whoami --json';
    const capturePath = path.join(outputDir, `${id}.txt`);
    const result = runDirectNodeCommand(wranglerCliArgs(['whoami', '--json']), {
        cwd: process.cwd(),
        env: buildSanitizedWranglerOAuthEnvironment(process.env, cloudflareAccountId),
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 180_000,
    });
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const summary = parseWranglerWhoamiSummary(result.stdout ?? '', exitCode);
    writeFileSync(capturePath, [
        `# command\n${display}`,
        `# exit\n${exitCode ?? 'unknown'}`,
        '# safe identity summary',
        JSON.stringify(summary, null, 2),
        result.error ? `# error\n${sanitize(safeErrorMessage(result.error))}` : '',
    ].join('\n'), 'utf8');

    return {
        capture: {
            id,
            display,
            path: capturePath,
            exitCode,
            status: !result.error && exitCode === 0 && summary.jsonParsed ? 'ok' : 'failed',
            externalWriteCommandStarted: false,
        } satisfies Capture,
        summary,
    };
}

function runWranglerCapture(input: {
    args: string[];
    display: string;
    id: string;
    input?: string;
    env?: Record<string, string>;
    writes: boolean;
}): { capture: Capture; raw: string } {
    const capturePath = path.join(outputDir, `${input.id}.txt`);
    const result = runDirectNodeCommand(wranglerCliArgs(input.args), {
        cwd: process.cwd(),
        env: buildSanitizedWranglerOAuthEnvironment(
            { ...process.env, ...input.env },
            cloudflareAccountId,
        ),
        input: input.input,
        maxBuffer: 10 * 1024 * 1024,
        timeoutMs: 180_000,
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
    const display = 'node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts --expect-checkout-override false';
    const result = runCleanupOwnedNodeCommand([
        ...realEnvSmokeNodePrefix,
        '--expect-checkout-override',
        'false',
    ], {
        env: {
            ...process.env,
            ...env,
        },
    });

    const output = [
        `# command\n${display}`,
        '# child output',
        'not buffered by parent; inspect the redacted outputs/real-env-smoke evidence written by the child',
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
    env.SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH = process.env.SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH || stagingEnv.SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH || '';
    env.EMAIL_FROM = stagingEnv.EMAIL_FROM || stagingEnv.RESEND_FROM_EMAIL || '';
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
        command: 'node --import tsx --import ./scripts/smoke/astro-env-node-register.mjs scripts/smoke/real-env-smoke.ts --expect-checkout-override false',
        requiredEnvNames: reportToRender.requiredEnvNames,
        envSourceMatrix: reportToRender.envSourceMatrix,
        safety: {
            planModeDoesNotRunSmoke: !reportToRender.executeRequested,
            exactApprovalRequired: true,
            allPreconditionsRunInSeparateReadOnlySubprocess: true,
            cloudflareWritesPerformedByRunner: false,
            checkoutOverrideKeptFalseThroughout: true,
            completedCheckoutEvidenceReused: true,
            writeCapableChildHardTimeout: false,
            writeCapableChildOwnsCleanupBeforeExit: true,
            writeCapableChildOutputBufferedByParent: false,
            stripeLiveModeRejected: true,
            secretValuesStored: false,
            finalSmokeClosedByThisRunner: false,
            resendFreeDailyRecipientLimit: RESEND_FREE_DAILY_RECIPIENT_LIMIT,
            resendFreeMonthlyRecipientLimit: RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
            plannedSmokeEmailRecipients: STAGING_SMOKE_PLANNED_RECIPIENTS,
            smokeEmailRecipientPlan: STAGING_SMOKE_EMAIL_RECIPIENT_PLAN,
            cleanupEmailRecipients: STAGING_SMOKE_EMAIL_RECIPIENT_PLAN.cleanup,
        },
        forbiddenScope: [
            'No production smoke and no live-domain claim from this rehearsal.',
            'No secret value printing or screenshots, and no secret values in commits or output files.',
            'No password reset for owner/admin/teacher accounts.',
            'No Stripe live mode or real charge.',
            'No Cloudflare write, code, route, domain or DNS change.',
            'No new or expired Checkout Session; reuse only the completed evidence.',
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
    const approvedSteps = [
        '1. Materialize staging smoke names in memory and reject missing names, Stripe live, non-allowlisted role emails or missing completed Checkout/canonical lifecycle evidence.',
        '2. Require local `CHECKOUT_ENABLED_OVERRIDE=false` and verify the exact Wrangler account/Worker read-only.',
        `3. Run the complete read-only preflight with checkout closed and require both current UTC daily + ${STAGING_SMOKE_PLANNED_RECIPIENTS} <= ${RESEND_FREE_DAILY_RECIPIENT_LIMIT} and current UTC monthly + ${STAGING_SMOKE_PLANNED_RECIPIENTS} <= ${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}.`,
        '4. Validate the explicit canonical lifecycle summary and revalidate the already completed Checkout/webhook/billing state live; never create or expire a Checkout Session.',
        '5. Run one email-producing confirmation, reminder and cancellation path (two recipients each); secondary scheduling variants and cleanup use `sendEmail:false` or direct no-email equivalents.',
        '6. Run the remaining Supabase/Google/Admin Jobs smoke writes with checkout closed; the runner imposes no hard timeout on this write-capable child and waits for its cleanup-owning `finally` before return.',
    ];
    return `${[
        '# Staging Smoke Rehearsal Runner Execution Plan',
        '',
        `- Status: ${reportToRender.status}`,
        `- Closure: ${reportToRender.closureStatus}`,
        `- Execute requested: ${String(reportToRender.executeRequested)}`,
        `- Approval matched: ${String(reportToRender.approvalMatched)}`,
        `- External write command started: ${String(reportToRender.externalWriteCommandStarted)}`,
        '- Cloudflare writes started: false',
        '- Checkout override throughout: false',
        `- Base URL: ${reportToRender.baseUrl}`,
        `- Confirmation: ${reportToRender.confirmation}`,
        `- Planned smoke email recipients: ${STAGING_SMOKE_PLANNED_RECIPIENTS} / ${RESEND_FREE_DAILY_RECIPIENT_LIMIT} daily cap`,
        `- Strict monthly recipient cap: ${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}`,
        '- Email-producing coverage: confirmation 2 + reminder 2 + cancellation 2; secondary variants 0; cleanup 0',
        '',
        '## Plan Mode',
        '',
        '- Generates this package only.',
        '- Does not run `scripts/smoke/real-env-smoke.ts`.',
        '- Does not call Supabase, Stripe, Google, Resend, Cloudflare, Sentry or Turnstile.',
        '',
        '## Approved Mode',
        '',
        'Only after the exact approval:',
        '',
        '```powershell',
        `$env:${approvalEnvVar}='${exactApprovalSentence.replace(/'/g, "''")}'`,
        `corepack pnpm --config.verify-deps-before-run=false launch:staging-smoke-rehearsal-runner -- ${executionFlag}`,
        '```',
        '',
        'The runner will:',
        '',
        ...approvedSteps,
        '',
        'A future Checkout bootstrap, if ever needed, is a separate manually controlled deployment operation. This runner does not automate that gate change.',
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
        '- Any Cloudflare write or temporary checkout-gate change.',
        '- Creating or expiring any Checkout Session; only the completed evidence may be read.',
        '- Supabase migrations, schema changes, destructive cleanup or broad data deletion.',
        '- Secret value printing or private payload evidence.',
        `- More than ${STAGING_SMOKE_PLANNED_RECIPIENTS} smoke recipient entries or any cleanup email; strict ceilings remain ${RESEND_FREE_DAILY_RECIPIENT_LIMIT}/day and ${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}/month.`,
        '',
    ].join('\n')}\n`;
}

function renderRollback(_reportToRender: RunnerReport): string {
    return `${[
        '# Staging Smoke Rehearsal Rollback And Cleanup',
        '',
        'This file does not authorize cleanup writes by itself. Use it after an approved staging smoke run.',
        '',
        '- This runner never writes the Cloudflare checkout gate. `CHECKOUT_ENABLED_OVERRIDE=false` is a precondition and is verified by runtime attestation plus the 403 probe.',
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
        '- It deletes temporary teacher availability, scheduling subscription/sessions, Google class docs/events, fulfillment job and matching audit rows; the reusable student and folder ID remain.',
        '- It restores prior notes, Google-link value and teacher assignments. A cleanup failure keeps the smoke failed.',
        '- Cleanup sends zero email recipients. Secondary scheduling variants create real artifacts with `sendEmail:false`; cleanup cancels/deletes them directly without enqueuing email work.',
        '- Evidence must show exactly +6 in both UTC daily and monthly counters before cleanup, then +0 in both counters during cleanup.',
        '- Leave the completed Checkout/webhook/payment evidence and all non-smoke customer/student data untouched.',
        '- Do not run Supabase schema migrations as part of smoke cleanup.',
        '- The runner does not hard-kill the write-capable child. Do not terminate it merely for taking longer than expected: a forced operator interruption can bypass cleanup and requires manual reconciliation.',
        '- After a forced interruption, reconcile `teacher_availability` rows created in the runner window as well as sessions, subscriptions, jobs, audits and Google artifacts; never delete pre-existing availability broadly.',
        '- Leave `CHECKOUT_ENABLED_OVERRIDE=false`. The exceptional bootstrap tool is outside this runner, never changes Cloudflare and requires an external deployment owner to restore and verify the gate.',
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
        '  --evidence "command_output=../../outputs/launch-staging-billing-lifecycle/<timestamp>/summary.json::canonical gated billing lifecycle completed and live-revalidated"',
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
        '- Cloudflare writes started: false',
        '- Checkout override throughout: false',
        `- Planned smoke email recipients: ${STAGING_SMOKE_PLANNED_RECIPIENTS} (confirmation 2 + reminder 2 + cancellation 2)`,
        `- Strict Resend Free daily recipient cap: ${RESEND_FREE_DAILY_RECIPIENT_LIMIT}`,
        `- Strict Resend Free monthly recipient cap: ${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}`,
        '- Secondary scheduling and cleanup email recipients: 0',
        `- Command manifest: ${toRelative(reportToRender.commandManifestPath)}`,
        `- Execution plan: ${toRelative(reportToRender.executionPlanPath)}`,
        `- Approval gate: ${toRelative(reportToRender.approvalGatePath)}`,
        `- Rollback: ${toRelative(reportToRender.rollbackAfterStagingSmokePath)}`,
        `- Manual evidence dry run: ${toRelative(reportToRender.manualEvidenceAfterStagingSmokePath)}`,
        '',
        `This runner is plan-only unless \`${approvalEnvVar}\` plus \`${executionFlag}\` are present. Approved mode proves the deployed checkout gate is closed, requires and live-revalidates the canonical billing lifecycle evidence for the completed Checkout, performs no Cloudflare write and waits without a hard timeout for the write-capable child's cleanup-owning \`finally\`.`,
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
        /-----BEGIN [A-Z0-9][A-Z0-9 ._\/-]*-----/u,
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
        'No Cloudflare write',
        'Stripe live',
        'redacted',
        'rollback',
        `Planned smoke email recipients: ${STAGING_SMOKE_PLANNED_RECIPIENTS}`,
        `Strict Resend Free monthly recipient cap: ${RESEND_FREE_MONTHLY_RECIPIENT_LIMIT}`,
        'Cleanup sends zero email recipients',
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
