import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';
import { inspectStripeLiveReadiness } from './stripe-live-readiness';
import { orchestrateWebActiveTransition } from './cloudflare-production-web-active-orchestrator';
import { verifyCloudflareWhoamiOutput } from '../ci/verify-cloudflare-identity';
import {
    validateCloudflareRuntimeCutoverPreflightSummary,
    validateCloudflareRuntimeReadonlySummary,
} from './cloudflare-production-evidence';
import {
    acquireWorkerWriteReconciliationLock,
    acquireNormalWorkerWriteExecutionLock,
    assertWorkerWriteExecutionLockOwned,
    assertExactSecretInventory,
    assertNoGoogleWebBindings,
    captureInitialApprovalSentence,
    classifyWorkerWriteProviderResult,
    findUnresolvedWorkerWriteCheckpoints,
    forbiddenGoogleWebBindingNames,
    parseExactSecretInventory,
    persistCanonicalWorkerWriteCheckpoint,
    persistWorkerWriteCheckpointAtomically,
    reconcileWorkerWriteCheckpoint,
    reconcileWorkerWriteCheckpointToSafeState,
    requireRecoverableWorkerWriteExecutionLock,
    releaseWorkerWriteExecutionLock,
    resolveCanonicalWorkerWriteCheckpoint,
    startWorkerWriteCheckpoint,
    summarizeWorkerWriteCheckpoints,
    type WorkerWriteCheckpoint,
    type WorkerWriteLockOwner,
    type WorkerWriteReceiptSummary,
} from './cloudflare-production-worker-safety';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type ClosureStatus = 'PLAN_ONLY_READY' | 'EXECUTED_AND_NEEDS_REVIEW' | 'BLOCKED_BY_GATE_OR_ARTIFACTS';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CommandSpec {
    id: string;
    display: string;
    bin: string;
    args: string[];
    timeoutMs: number;
    writesCloudflare: boolean;
}

interface CommandCapture {
    id: string;
    display: string;
    path: string;
    exitCode: number | null;
    status: CheckStatus;
    writesCloudflare: boolean;
    writeCheckpointSequence?: number;
}

interface ProbeCapture {
    id: string;
    url: string;
    status: CheckStatus;
    httpStatus: number | null;
    bytes: number;
    path: string;
}

interface ExecutionEnv {
    approvalSentence: string;
    secretValues: Record<string, string>;
    directWorkerUrl: string | null;
}

interface CloudflareTarget {
    accountId: string;
    accountLabel: string;
    productionWorker: string;
    pagesProject: string;
    customDomains: string[];
}

interface RunnerReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: ClosureStatus;
    outputDir: string;
    target: CloudflareTarget;
    approvalEnvVar: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: WorkerWriteReceiptSummary['externalWritePerformed'];
    externalWriteOutcome: WorkerWriteReceiptSummary['externalWriteOutcome'];
    readonlyReconciliationRequired: boolean;
    requiredSecretNames: string[];
    directWorkerUrlEnvVar: string;
    envFileEnvVar: string;
    latestRuntimeReadonlyPath: string | null;
    latestPreflightSummaryPath: string | null;
    latestVariableMatrixPath: string | null;
    latestCutoverManifestPath: string | null;
    latestSecretsApprovalPath: string | null;
    latestPhaseOneRunnerPath: string | null;
    checks: Check[];
    captures: CommandCapture[];
    probes: ProbeCapture[];
    writeCheckpoints: WorkerWriteCheckpoint[];
    writeCheckpointPaths: string[];
    commandManifestPath: string;
    executionPlanPath: string;
    approvalGatePath: string;
    rollbackAfterSecretsPath: string;
    manualEvidenceAfterSecretsPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    commandManifest: string;
    executionPlan: string;
    approvalGate: string;
    rollbackAfterSecrets: string;
    manualEvidenceAfterSecrets: string;
    summary: string;
}

const target: CloudflareTarget = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: 'Español Honesto Cloudflare account',
    productionWorker: 'espanolhonesto',
    pagesProject: 'espanolhonesto',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
};

const approvalEnvVar = 'CLOUDFLARE_WORKER_SECRETS_APPROVAL';
const reconciliationApprovalEnvVar = 'CLOUDFLARE_WORKER_SECRETS_RECONCILIATION_APPROVAL';
const directWorkerUrlEnvVar = 'CLOUDFLARE_WORKER_DIRECT_URL';
const envFileEnvVar = 'CLOUDFLARE_WORKER_ENV_FILE';
const exactApprovalSentence = 'Apruebo configurar/verificar solo los secrets/vars necesarios y desplegar el paquete web activo del Cloudflare Worker production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, despues de validar cuenta, Worker bootstrap, Supabase production `vkkahxsybhbutszerawz`, Stripe live, `PUBLIC_SITE_URL=https://espanolhonesto.com`, `PUBLIC_APP_ENV=production`, URL directa exacta, build activo limpio y dry-run, usando valores desde el origen seguro aprobado, sin imprimir valores ni guardarlos en outputs, con `CHECKOUT_ENABLED=false`, fulfillment todavia inerte, sin mover dominios, borrar Pages ni cambiar DNS, y con redeploy compensatorio automatico del bootstrap web si el deploy activo o su verificacion quedan fallidos o ambiguos.';
const exactReconciliationApprovalSentence = 'Apruebo reconciliar exclusivamente la ejecucion pendiente del Cloudflare Worker production `espanolhonesto` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, mediante readbacks frescos de identidad, version, inventario de secrets, ausencia de bindings Google y atestacion HMAC; autorizo unicamente un redeploy compensatorio del bootstrap web con checkout desactivado si la compensacion ya se inicio o el runtime remoto sigue ambiguo, sin secret puts, Stripe writes, DNS, dominios, Pages ni production fulfillment, y solo liberar los checkpoints y locks tras probar un estado remoto seguro.';
const normalExecuteRequested = process.argv.includes('--execute-approved');
const reconcileRequested = process.argv.includes('--reconcile-approved');
const executeRequested = normalExecuteRequested || reconcileRequested;
const productionSupabaseRef = 'vkkahxsybhbutszerawz';
const productionSite = 'https://espanolhonesto.com';
const productionWorkerIdentity = 'espanolhonesto';
const productionDirectWorkerHost = 'espanolhonesto.alindev95.workers.dev';
// Approval must be present in the process environment that started this
// runner. Loading the secure value file later must never manufacture consent.
const initialApprovalSentence = captureInitialApprovalSentence(process.env, approvalEnvVar);
const initialReconciliationApprovalSentence = captureInitialApprovalSentence(process.env, reconciliationApprovalEnvVar);

const requiredSecretNames = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'PUBLIC_SENTRY_DSN',
    'FULFILLMENT_WORKER_URL',
    'INTERNAL_JOB_SECRET',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'ADMIN_EMAIL',
    'SUPPORT_ALERT_EMAIL',
];

const modernProbeRoutes = [
    '/',
    '/es',
    '/en',
    '/ru',
    '/robots.txt',
    '/sitemap-index.xml',
    '/sitemap-0.xml',
    '/llms.txt',
];

const startedAt = new Date();
const writeRunId = stamp(startedAt);
const workerSecretsStateRoot = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-worker-secrets');
const canonicalPendingCheckpointDir = path.join(workerSecretsStateRoot, 'write-checkpoints-pending');
const canonicalResolvedCheckpointDir = path.join(workerSecretsStateRoot, 'write-checkpoints-resolved');
const canonicalWriteLockPath = path.join(workerSecretsStateRoot, 'write-execution.lock');
const canonicalReconciliationLockPath = path.join(workerSecretsStateRoot, 'write-reconciliation.lock');
const outputDir = path.join(workerSecretsStateRoot, writeRunId);
mkdirSync(outputDir, { recursive: true });

const latestRuntimeReadonlyPath = latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.json');
const latestPreflightSummaryPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.json');
const latestVariableMatrixPath = latestPreflightSummaryPath
    ? path.join(path.dirname(latestPreflightSummaryPath), 'cloudflare-production-worker-variable-matrix.md')
    : null;
const latestCutoverManifestPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json');
const latestSecretsApprovalPath = latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-worker-secrets.md');
const latestPhaseOneRunnerPath = latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'summary.md');

const captures: CommandCapture[] = [];
const probes: ProbeCapture[] = [];
const writeCheckpoints: WorkerWriteCheckpoint[] = [];
const writeCheckpointPaths: string[] = [];
const checks: Check[] = reconcileRequested
    ? [
        validateRequestedMode(),
        validateCanonicalWriteState(),
        validatePackageScript(),
        validateWranglerConfig(),
        validateApprovalGateSource(),
        validateForbiddenScopeSource(),
    ]
    : [
        validateRequestedMode(),
        validateCanonicalWriteState(),
        validatePackageScript(),
        validateLatestRuntimeReadonlyEvidence(),
        validateLatestNoWritePreflight(),
        validateLatestCutoverPack(),
        validateLatestPhaseOneRunner(),
        validateWranglerConfig(),
        validateActiveBuildSource(),
        validateApprovalGateSource(),
        validateForbiddenScopeSource(),
    ];

let approvalMatched = false;
let externalWriteAttempted = false;
let nextWriteCheckpointSequence = 1;
let writeExecutionLockAcquired = false;
let normalWriteLockOwner: WorkerWriteLockOwner | null = null;
let recoveredPrimaryWriteLockOwner: WorkerWriteLockOwner | null = null;
let reconciliationWriteLockOwner: WorkerWriteLockOwner | null = null;

await main();

async function main(): Promise<void> {
    if (executeRequested && checks.some((check) => check.status === 'failed')) {
        checks.push({
            status: 'failed',
            name: 'initial_validation_gate',
            message: 'Initial local validation failed, so no Cloudflare command can run.',
            details: ['externalWriteAttempted=false'],
        });
    } else if (executeRequested) {
        const envFile = process.env[envFileEnvVar]?.trim() || '.env.production';
        dotenv.config({ path: envFile, override: false, quiet: true });
        const env = validateExecutionEnv(
            reconcileRequested ? initialReconciliationApprovalSentence : initialApprovalSentence,
            reconcileRequested ? exactReconciliationApprovalSentence : exactApprovalSentence,
            reconcileRequested ? 'reconciliation_environment_gate' : 'execution_environment_gate',
        );
        checks.push(env.check);

        if (env.value) {
            const executionChecks = reconcileRequested
                ? await runApprovedReconciliation(env.value, captures, probes)
                : await runApprovedExecution(env.value, captures, probes);
            approvalMatched = executionChecks.some((check) =>
                ['exact_approval_gate', 'exact_reconciliation_approval_gate'].includes(check.name)
                && check.status === 'ok');
            checks.push(...executionChecks);
        }
    } else {
        checks.push({
            status: 'ok',
            name: 'plan_mode_no_external_write',
            message: 'Plan mode generated the Cloudflare Worker secret-name/direct-probe runner package without calling Cloudflare or writing secrets.',
            details: [
                'executeRequested=false',
                'externalWritePerformed=false',
                `futureGate=${approvalEnvVar}`,
                'futureFlag=--execute-approved',
            ],
        });
    }

    let report = createReport(checks, captures, probes);
    let rendered = renderArtifacts(report);
    checks.push(validateGeneratedArtifactPosture(rendered));
    report = createReport(checks, captures, probes);
    rendered = renderArtifacts(report);

    writeFileSync(report.commandManifestPath, rendered.commandManifest, 'utf8');
    writeFileSync(report.executionPlanPath, rendered.executionPlan, 'utf8');
    writeFileSync(report.approvalGatePath, rendered.approvalGate, 'utf8');
    writeFileSync(report.rollbackAfterSecretsPath, rendered.rollbackAfterSecrets, 'utf8');
    writeFileSync(report.manualEvidenceAfterSecretsPath, rendered.manualEvidenceAfterSecrets, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');

    const failed = report.checks.filter((check) => check.status === 'failed');
    const warnings = report.checks.filter((check) => check.status === 'warning');

    console.log(`[launch:cloudflare-production-worker-secrets] Status: ${report.status}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Closure: ${report.closureStatus}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Failed: ${failed.length}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Warnings: ${warnings.length}`);
    console.log(`[launch:cloudflare-production-worker-secrets] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:cloudflare-production-worker-secrets] External write attempted: ${report.externalWriteAttempted}`);
    console.log(`[launch:cloudflare-production-worker-secrets] External write outcome: ${report.externalWriteOutcome}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Read-only reconciliation required: ${report.readonlyReconciliationRequired}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Summary: ${report.summaryPath}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Execution plan: ${report.executionPlanPath}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:cloudflare-production-worker-secrets] Rollback: ${report.rollbackAfterSecretsPath}`);

    if (failed.length > 0) process.exit(1);
}

function createReport(reportChecks: Check[], reportCaptures: CommandCapture[], reportProbes: ProbeCapture[]): RunnerReport {
    const writeReceipt = summarizeWorkerWriteCheckpoints(writeCheckpoints);
    const reportStatus: ReportStatus = writeReceipt.readonlyReconciliationRequired
        ? 'FAILED'
        : statusFor(reportChecks);

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        closureStatus: reportStatus === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_ARTIFACTS'
            : executeRequested
                ? 'EXECUTED_AND_NEEDS_REVIEW'
                : 'PLAN_ONLY_READY',
        outputDir,
        target,
        approvalEnvVar: reconcileRequested ? reconciliationApprovalEnvVar : approvalEnvVar,
        executeRequested,
        approvalMatched,
        externalWriteAttempted: writeReceipt.externalWriteAttempted,
        externalWritePerformed: writeReceipt.externalWritePerformed,
        externalWriteOutcome: writeReceipt.externalWriteOutcome,
        readonlyReconciliationRequired: writeReceipt.readonlyReconciliationRequired,
        requiredSecretNames,
        directWorkerUrlEnvVar,
        envFileEnvVar,
        latestRuntimeReadonlyPath,
        latestPreflightSummaryPath,
        latestVariableMatrixPath,
        latestCutoverManifestPath,
        latestSecretsApprovalPath,
        latestPhaseOneRunnerPath,
        checks: reportChecks,
        captures: reportCaptures,
        probes: reportProbes,
        writeCheckpoints,
        writeCheckpointPaths,
        commandManifestPath: path.join(outputDir, 'cloudflare-worker-secrets-command-manifest.json'),
        executionPlanPath: path.join(outputDir, 'cloudflare-worker-secrets-execution-plan.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        rollbackAfterSecretsPath: path.join(outputDir, 'rollback-after-worker-secrets.md'),
        manualEvidenceAfterSecretsPath: path.join(outputDir, 'manual-evidence-after-worker-secrets.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validateCanonicalWriteState(): Check {
    try {
        const unresolved = findUnresolvedWorkerWriteCheckpoints(canonicalPendingCheckpointDir);
        const lockExists = existsSync(canonicalWriteLockPath);
        const reconciliationLockExists = existsSync(canonicalReconciliationLockPath);
        const clean = unresolved.length === 0 && !lockExists && !reconciliationLockExists;
        const recoveryReady = lockExists;
        const validForMode = reconcileRequested ? recoveryReady : clean;
        return {
            status: validForMode ? 'ok' : executeRequested ? 'failed' : 'warning',
            name: 'canonical_write_state_restart_gate',
            message: reconcileRequested && recoveryReady
                ? 'A prior locked Cloudflare write run is present and eligible for explicitly approved read-only-first reconciliation.'
                : clean
                ? 'The stable Cloudflare write journal has no unresolved prior run or execution lock.'
                : reconcileRequested
                    ? 'Recovery requires the retained primary write lock from the interrupted run.'
                    : 'A prior Cloudflare write run is unresolved; normal execution is fail-closed until explicit reconciliation is completed.',
            details: [
                `canonicalPendingCount=${unresolved.length}`,
                `canonicalLockExists=${String(lockExists)}`,
                `reconciliationLockExists=${String(reconciliationLockExists)}`,
                `executionBlocked=${String(!clean)}`,
                `pendingDirectory=${canonicalPendingCheckpointDir}`,
                `lockPath=${canonicalWriteLockPath}`,
            ],
        };
    } catch (error) {
        return {
            status: executeRequested ? 'failed' : 'warning',
            name: 'canonical_write_state_restart_gate',
            message: 'The stable Cloudflare write journal could not be parsed, so execution is fail-closed.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

function validateRequestedMode(): Check {
    const exclusive = !(normalExecuteRequested && reconcileRequested);
    return {
        status: exclusive ? 'ok' : 'failed',
        name: 'exclusive_execution_mode',
        message: exclusive
            ? 'Normal execution and recovery modes are mutually exclusive.'
            : 'Normal execution and recovery flags cannot be combined.',
        details: [
            `executeApproved=${String(normalExecuteRequested)}`,
            `reconcileApproved=${String(reconcileRequested)}`,
        ],
    };
}

function validatePackageScript(): Check {
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>('package.json');
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:cloudflare-production-worker-secrets'] !== 'tsx scripts/launch/cloudflare-production-worker-secrets.ts') {
        missing.push('launch:cloudflare-production-worker-secrets=tsx scripts/launch/cloudflare-production-worker-secrets.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_cloudflare_worker_secrets',
        message: missing.length === 0
            ? 'Package scripts expose the gated Cloudflare production Worker secret-name runner and preserve pnpm policy.'
            : 'Package scripts are missing the gated Cloudflare production Worker secret-name runner or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:cloudflare-production-worker-secrets'] : missing.map((item) => `missing=${item}`),
    };
}

function validateLatestRuntimeReadonlyEvidence(): Check {
    if (!latestRuntimeReadonlyPath || !existsSync(latestRuntimeReadonlyPath)) {
        return {
            status: 'failed',
            name: 'latest_runtime_readonly_evidence_exists',
            message: 'Fresh Cloudflare runtime read-only evidence is missing; run it before executing the secret-name phase.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly'],
        };
    }

    const summary = readJsonIfExists<unknown>(latestRuntimeReadonlyPath);
    if (summary === null) {
        return {
            status: 'failed',
            name: 'latest_runtime_readonly_evidence_exists',
            message: 'Latest Cloudflare runtime evidence is not valid structured JSON.',
            details: [`path=${latestRuntimeReadonlyPath}`],
        };
    }
    const validation = validateCloudflareRuntimeReadonlySummary(summary, target);

    return {
        status: validation.valid ? 'ok' : 'failed',
        name: 'latest_runtime_readonly_evidence_exists',
        message: validation.valid
            ? 'Latest structured Cloudflare runtime evidence is fresh and proves exact account, Pages-domain ownership, read-only scope and unambiguous critical checks.'
            : 'Latest structured Cloudflare runtime evidence is stale, failed, ambiguous or missing required critical facts.',
        details: validation.valid
            ? [`path=${latestRuntimeReadonlyPath}`, `endedAt=${validation.evidenceTimestamp}`]
            : validation.errors.map((error) => `invalid=${error}`),
    };
}

function validateLatestNoWritePreflight(): Check {
    if (!latestPreflightSummaryPath || !existsSync(latestPreflightSummaryPath)) {
        return {
            status: 'failed',
            name: 'latest_no_write_preflight_exists',
            message: 'The Cloudflare runtime cutover preflight must exist before the secret-name runner can be used.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight'],
        };
    }

    const preflight = readJsonIfExists<unknown>(latestPreflightSummaryPath);
    const matrixMissing = !latestVariableMatrixPath || !existsSync(latestVariableMatrixPath);
    if (preflight === null) {
        return {
            status: 'failed',
            name: 'latest_no_write_preflight_exists',
            message: 'Latest no-write preflight is not valid structured JSON.',
            details: [`path=${latestPreflightSummaryPath}`],
        };
    }
    const validation = validateCloudflareRuntimeCutoverPreflightSummary(preflight, target);

    return {
        status: validation.valid && !matrixMissing ? 'ok' : 'failed',
        name: 'latest_no_write_preflight_exists',
        message: validation.valid && !matrixMissing
            ? 'Latest structured no-write preflight and its same-run variable matrix are fresh and unambiguous before secret-name execution.'
            : 'Latest structured no-write preflight is stale, failed, ambiguous or missing its same-run variable matrix.',
        details: validation.valid && !matrixMissing
            ? [
                `preflight=${latestPreflightSummaryPath}`,
                `variableMatrix=${latestVariableMatrixPath}`,
                `generatedAt=${validation.evidenceTimestamp}`,
            ]
            : [
                ...validation.errors.map((error) => `invalid=${error}`),
                ...(matrixMissing ? ['missing=cloudflare-production-worker-variable-matrix.md'] : []),
            ],
    };
}

function validateLatestCutoverPack(): Check {
    if (!latestCutoverManifestPath || !existsSync(latestCutoverManifestPath) || !latestSecretsApprovalPath || !existsSync(latestSecretsApprovalPath)) {
        return {
            status: 'failed',
            name: 'latest_cutover_pack_exists',
            message: 'The Cloudflare cutover package and Worker-secrets approval request must exist before this runner can be used.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover'],
        };
    }

    const approval = readFileSync(latestSecretsApprovalPath, 'utf8');
    const required = [
        '# Cloudflare Web Worker Secrets And Active Deploy Approval Request',
        exactApprovalSentence,
        'lists names only',
        'builds the active package from a clean dist root',
        'compensates automatically to the web bootstrap',
        'pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --config wrangler.toml --env production',
        'pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
        'No printing, logging, screenshotting or committing secret values.',
        'No domain move',
    ];
    const missing = required.filter((snippet) => !approval.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'latest_cutover_pack_exists',
        message: missing.length === 0
            ? 'Latest cutover package contains the Worker secret-name approval text and forbidden scope.'
            : 'Latest cutover package is missing required Worker secret-name approval facts.',
        details: missing.length === 0
            ? [`manifest=${latestCutoverManifestPath}`, `approval=${latestSecretsApprovalPath}`]
            : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateLatestPhaseOneRunner(): Check {
    if (!latestPhaseOneRunnerPath || !existsSync(latestPhaseOneRunnerPath)) {
        return {
            status: 'failed',
            name: 'latest_phase1_runner_exists',
            message: 'Executed and proven phase-1 web bootstrap evidence is mandatory before secret loading.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-phase1'],
        };
    }

    const phaseOne = readFileSync(latestPhaseOneRunnerPath, 'utf8');
    const required = [
        'Cloudflare Production Worker Phase 1 Summary',
        '- Status: OK',
        '- Closure: EXECUTED_AND_NEEDS_REVIEW',
        '- Execute requested: true',
        '- External write performed: true',
        '| ok | web_bootstrap_secret_shape_after_deploy |',
        '| ok | web_bootstrap_health_after_deploy |',
        target.productionWorker,
    ];
    const missing = required.filter((snippet) => !phaseOne.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'latest_phase1_runner_exists',
        message: missing.length === 0
            ? 'Phase-1 evidence proves the exact web bootstrap was executed and verified.'
            : 'Phase-1 evidence is plan-only, stale in shape or lacks executed bootstrap proof.',
        details: missing.length === 0 ? [`path=${latestPhaseOneRunnerPath}`] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateWranglerConfig(): Check {
    const wranglerPath = 'wrangler.toml';
    if (!existsSync(wranglerPath)) {
        return {
            status: 'failed',
            name: 'wrangler_secret_phase_config',
            message: 'wrangler.toml is missing.',
            details: [wranglerPath],
        };
    }

    const wrangler = readFileSync(wranglerPath, 'utf8');
    const required = [
        'name = "espanolhonesto-env-required"',
        'keep_vars = true',
        '[env.production]',
        'name = "espanolhonesto"',
        'PUBLIC_APP_ENV = "production"',
        'SUPABASE_EXPECTED_PROJECT_REF = "vkkahxsybhbutszerawz"',
        'WORKER_IDENTITY = "espanolhonesto"',
        'PUBLIC_SITE_URL = "https://espanolhonesto.com"',
        'CHECKOUT_ENABLED = "false"',
        'CHECKOUT_ENABLED_OVERRIDE = "false"',
    ];
    const missing = required.filter((snippet) => !wrangler.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_secret_phase_config',
        message: missing.length === 0
            ? 'Wrangler uses a safe non-production base name and the explicit production env keeps identity, site, Supabase and checkout fail-closed.'
            : 'Wrangler config is missing required production/fail-closed posture.',
        details: missing.length === 0 ? [wranglerPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateActiveBuildSource(): Check {
    const buildPath = path.join('scripts', 'dev', 'build-production-release.ts');
    const buildSource = readIfExists(buildPath) ?? '';
    const packageJson = readIfExists('package.json') ?? '';
    const required = [
        ['package.json', packageJson, '"build:production:release": "tsx scripts/dev/build-production-release.ts"'],
        [buildPath, buildSource, "process.env.CLOUDFLARE_ENV = 'production'"],
        [buildPath, buildSource, "process.env.WEB_RUNTIME_MODE = 'active'"],
        [buildPath, buildSource, "process.env.CHECKOUT_ENABLED = 'false'"],
        [buildPath, buildSource, "process.env.CHECKOUT_ENABLED_OVERRIDE = 'false'"],
        [buildPath, buildSource, 'disableProductionReleaseSentryUpload(process.env)'],
        [buildPath, buildSource, 'rmSync(distRoot, { force: true, recursive: true })'],
        [buildPath, buildSource, 'validateGeneratedActiveConfig'],
        [buildPath, buildSource, "config.main, 'entry.mjs'"],
        [buildPath, buildSource, "config.targetEnvironment, 'production'"],
        [buildPath, buildSource, 'assets.run_worker_first=true'],
        [buildPath, buildSource, 'routes must be absent/empty'],
    ] as const;
    const missing = required
        .filter(([, source, snippet]) => !source.includes(snippet))
        .map(([file, , snippet]) => `${file}:${snippet}`);

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'active_web_build_source',
        message: missing.length === 0
            ? 'The dedicated active web build cleans dist and validates the exact production package before upload.'
            : 'The active web build is missing clean-build or resolved-config safety checks.',
        details: missing.length === 0 ? [buildPath, 'checkout=false', 'domains=absent'] : missing.map((item) => `missing=${item}`),
    };
}

function validateApprovalGateSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'cloudflare-production-worker-secrets.ts');
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
        reconciliationApprovalEnvVar,
        directWorkerUrlEnvVar,
        envFileEnvVar,
        '--execute-approved',
        '--reconcile-approved',
        'const exactApprovalSentence =',
        'executeRequested',
        'externalWritePerformed=false',
        'wrangler secret put',
        'wrangler deploy --config dist/server/wrangler.json --keep-vars',
        'compensateToWebBootstrap',
        'initialApprovalSentence',
        'initialReconciliationApprovalSentence',
        'exclusive_reconciliation_lock_acquired',
        'persistWorkerWriteCheckpointAtomically',
        'wrangler versions view',
        'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production --format json',
        'pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
        'secretValues',
        'sanitizeOutput',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'approval_gate_source',
        message: missing.length === 0
            ? 'Runner source contains exact approval, secret-name commandization, direct-probe support and output sanitization.'
            : 'Runner source is missing required approval gate or commandized execution facts.',
        details: missing.length === 0 ? [sourcePath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateForbiddenScopeSource(): Check {
    const sourcePath = path.join('scripts', 'launch', 'cloudflare-production-worker-secrets.ts');
    const source = readIfExists(sourcePath) ?? '';
    const required = [
        'No domain move',
        'No DNS change',
        'No Pages deletion',
        'No route change',
        'No `CHECKOUT_ENABLED=true`',
        'No secret value printing',
        'No Stripe API write',
        'No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    const forbiddenCommandSnippets = [
        'wrangler pages project delete',
        'wrangler route delete',
        'wrangler dns',
        'CHECKOUT_ENABLED=true',
    ];
    const commandText = Object.values(buildStaticCommands()).map((command) => command.display).join('\n');
    const presentForbidden = forbiddenCommandSnippets.filter((snippet) => commandText.includes(snippet));

    return {
        status: missing.length === 0 && presentForbidden.length === 0 ? 'ok' : 'failed',
        name: 'forbidden_scope_source',
        message: missing.length === 0 && presentForbidden.length === 0
            ? 'Runner source keeps the phase limited to Worker secret-name loading plus read-only direct probes.'
            : 'Runner source is missing forbidden-scope wording or contains a forbidden command snippet.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...presentForbidden.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function validateExecutionEnv(
    approvalSentence: string,
    expectedApprovalSentence = exactApprovalSentence,
    checkName = 'execution_environment_gate',
): { check: Check; value: ExecutionEnv | null } {
    const missingNames = requiredSecretNames.filter((name) => !secretValueFor(name));
    const placeholderNames = requiredSecretNames.filter((name) => isPlaceholderValue(secretValueFor(name) ?? ''));
    const directWorkerUrl = normalizeDirectWorkerUrl(process.env[directWorkerUrlEnvVar]);
    const dailyLimit = Number(secretValueFor('EMAIL_DAILY_RECIPIENT_LIMIT'));
    const monthlyLimit = Number(secretValueFor('EMAIL_MONTHLY_RECIPIENT_LIMIT'));
    const targetMismatches = [
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() === target.accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
        secretValueFor('SUPABASE_EXPECTED_PROJECT_REF') === productionSupabaseRef ? null : 'SUPABASE_EXPECTED_PROJECT_REF',
        supabaseProjectRef(secretValueFor('PUBLIC_SUPABASE_URL')) === productionSupabaseRef ? null : 'PUBLIC_SUPABASE_URL',
        secretValueFor('PUBLIC_APP_ENV') === 'production' ? null : 'PUBLIC_APP_ENV',
        secretValueFor('WORKER_IDENTITY') === productionWorkerIdentity ? null : 'WORKER_IDENTITY',
        normalizeOrigin(secretValueFor('PUBLIC_SITE_URL')) === productionSite ? null : 'PUBLIC_SITE_URL',
        secretValueFor('CHECKOUT_ENABLED') === 'false' ? null : 'CHECKOUT_ENABLED',
        secretValueFor('CHECKOUT_ENABLED_OVERRIDE') === 'false' ? null : 'CHECKOUT_ENABLED_OVERRIDE',
        secretValueFor('STRIPE_SECRET_KEY')?.startsWith('sk_live_') ? null : 'STRIPE_SECRET_KEY mode',
        secretValueFor('PUBLIC_STRIPE_PUBLISHABLE_KEY')?.startsWith('pk_live_') ? null : 'PUBLIC_STRIPE_PUBLISHABLE_KEY mode',
        /^acct_[A-Za-z0-9]{8,}$/u.test(secretValueFor('STRIPE_EXPECTED_ACCOUNT_ID') ?? '') ? null : 'STRIPE_EXPECTED_ACCOUNT_ID',
        secretValueFor('EMAIL_DELIVERY_MODE') === 'live' ? null : 'EMAIL_DELIVERY_MODE',
        Number.isSafeInteger(dailyLimit) && dailyLimit > 0 && dailyLimit <= 80 ? null : 'EMAIL_DAILY_RECIPIENT_LIMIT',
        Number.isSafeInteger(monthlyLimit) && monthlyLimit > 0 && monthlyLimit <= 2400 ? null : 'EMAIL_MONTHLY_RECIPIENT_LIMIT',
        directWorkerUrl ? null : directWorkerUrlEnvVar,
    ].filter((value): value is string => Boolean(value));
    approvalMatched = approvalSentence === expectedApprovalSentence;

    if (!approvalMatched || missingNames.length > 0 || placeholderNames.length > 0 || targetMismatches.length > 0) {
        return {
            check: {
                status: 'failed',
                name: checkName,
                message: 'Execution was requested but approval, target identity or required source values are invalid, so no Cloudflare write can run.',
                details: [
                    `approvalMatched=${String(approvalMatched)}`,
                    `missingNames=${missingNames.join(', ') || 'none'}`,
                    `placeholderNames=${placeholderNames.join(', ') || 'none'}`,
                    `targetMismatches=${targetMismatches.join(', ') || 'none'}`,
                    'externalWritePerformed=false',
                ],
            },
            value: null,
        };
    }

    return {
        check: {
            status: 'ok',
            name: checkName,
            message: 'Exact approval matched and every required Worker secret/var name has a source value available without printing values.',
            details: [
                `approvalEnv=${reconcileRequested ? reconciliationApprovalEnvVar : approvalEnvVar}`,
                `secretNameCount=${requiredSecretNames.length}`,
                `targetAccount=${target.accountId}`,
                `supabaseProjectRef=${productionSupabaseRef}`,
                'stripeMode=live',
                `site=${productionSite}`,
                'appEnvironment=production',
                'directWorkerUrl=validated_exact_workers_dev_host',
            ],
        },
        value: {
            approvalSentence,
            secretValues: Object.fromEntries(requiredSecretNames.map((name) => [name, secretValueFor(name) ?? ''])),
            directWorkerUrl,
        },
    };
}

async function runApprovedExecution(
    env: ExecutionEnv,
    reportCaptures: CommandCapture[],
    reportProbes: ProbeCapture[]
): Promise<Check[]> {
    const executionChecks: Check[] = [];

    executionChecks.push({
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact approval sentence matched; running only web Worker secret-name commands followed by required read-only direct attestation.',
        details: [
            `env=${approvalEnvVar}`,
            `targetAccount=${target.accountId}`,
            `targetWorker=${target.productionWorker}`,
            `secretNameCount=${requiredSecretNames.length}`,
        ],
    });

    const staticCommands = buildStaticCommands();
    for (const command of [staticCommands.whoami, staticCommands.deploymentsList, staticCommands.secretListBefore]) {
        const capture = runCommand(command);
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    const remoteTargetCheck = validateRemotePreWriteTarget(
        reportCaptures.find((capture) => capture.id === staticCommands.whoami.id),
        reportCaptures.find((capture) => capture.id === staticCommands.deploymentsList.id),
    );
    executionChecks.push(remoteTargetCheck);
    if (remoteTargetCheck.status === 'failed') return executionChecks;

    const baselineDeploymentsCapture = reportCaptures.find(
        (capture) => capture.id === staticCommands.deploymentsList.id,
    );
    const baselineVersionId = deploymentVersionId(baselineDeploymentsCapture);
    if (!baselineVersionId || !env.directWorkerUrl) {
        executionChecks.push({
            status: 'failed',
            name: 'bootstrap_pre_write_prerequisites',
            message: 'The exact bootstrap version and direct URL are mandatory before any secret put.',
            details: [
                `versionId=${baselineVersionId ? 'present' : 'missing'}`,
                `directWorkerUrl=${env.directWorkerUrl ? 'validated' : 'missing'}`,
            ],
        });
        return executionChecks;
    }

    const preWriteSecretInventory = validateExactSecretInventoryCapture(
        reportCaptures.find((capture) => capture.id === staticCommands.secretListBefore.id),
        ['INTERNAL_JOB_SECRET'],
        'exact_bootstrap_secret_inventory_pre_write',
    );
    executionChecks.push(preWriteSecretInventory);
    if (preWriteSecretInventory.status === 'failed') return executionChecks;

    const preWriteVersionCapture = runCommand(buildVersionViewCommand(
        'wrangler-version-view-production-pre-secret-write',
        baselineVersionId,
    ));
    reportCaptures.push(preWriteVersionCapture);
    executionChecks.push(checkForCapture(preWriteVersionCapture));
    if (preWriteVersionCapture.status === 'failed') return executionChecks;
    const preWriteGoogleBoundary = validateNoGoogleBindingsCapture(
        preWriteVersionCapture,
        baselineVersionId,
        'remote_google_bindings_absent_pre_write',
    );
    executionChecks.push(preWriteGoogleBoundary);
    if (preWriteGoogleBoundary.status === 'failed') return executionChecks;

    const immediateBootstrapChecks = await verifyWebBootstrapState(
        env.directWorkerUrl,
        baselineVersionId,
        env,
        reportProbes,
        ['INTERNAL_JOB_SECRET'],
    );
    executionChecks.push(...immediateBootstrapChecks);
    if (immediateBootstrapChecks.some((check) => check.status === 'failed')) return executionChecks;

    const stripeReadiness = await validateFreshStripeLiveReadiness(env);
    executionChecks.push(stripeReadiness);
    if (stripeReadiness.status === 'failed') return executionChecks;

    for (const command of [staticCommands.activeBuild, staticCommands.activeDeployDryRun]) {
        const capture = runCommand(command);
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    const activeConfigCheck = validateBuiltActiveConfig();
    executionChecks.push(activeConfigCheck);
    if (activeConfigCheck.status === 'failed') return executionChecks;

    const activeDryRunCheck = validateActiveDryRun(
        reportCaptures.find((capture) => capture.id === staticCommands.activeDeployDryRun.id),
    );
    executionChecks.push(activeDryRunCheck);
    if (activeDryRunCheck.status === 'failed') return executionChecks;

    const writeLockCheck = acquireCanonicalWriteLock();
    executionChecks.push(writeLockCheck);
    if (writeLockCheck.status === 'failed') return executionChecks;

    const secretPutCaptures: CommandCapture[] = [];
    for (const name of requiredSecretNames) {
        const command = buildSecretPutCommand(name);
        const capture = runCommand(command, `${env.secretValues[name]}\n`);
        reportCaptures.push(capture);
        secretPutCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') {
            executionChecks.push(...await reconcileFailedSecretWriteReadOnly(
                env,
                reportCaptures,
                reportProbes,
            ));
            return executionChecks;
        }
    }

    const afterCapture = runCommand(staticCommands.secretListAfter);
    reportCaptures.push(afterCapture);
    executionChecks.push(checkForCapture(afterCapture));
    if (afterCapture.status === 'failed') return executionChecks;

    const postWriteInventory = validateExactSecretInventoryCapture(
        afterCapture,
        requiredSecretNames,
        'exact_secret_inventory_after_write',
    );
    executionChecks.push(postWriteInventory);
    if (postWriteInventory.status === 'failed') return executionChecks;

    const bootstrapDeploymentsCapture = runCommand(staticCommands.deploymentsListAfter);
    reportCaptures.push(bootstrapDeploymentsCapture);
    executionChecks.push(checkForCapture(bootstrapDeploymentsCapture));
    if (bootstrapDeploymentsCapture.status === 'failed') return executionChecks;

    const bootstrapVersionId = deploymentVersionId(bootstrapDeploymentsCapture);
    if (!env.directWorkerUrl || !bootstrapVersionId) {
        executionChecks.push({
            status: 'failed',
            name: 'direct_worker_attestation_prerequisites',
            message: 'Secret writes completed but exact bootstrap URL/version attestation prerequisites are missing; active deploy remains blocked.',
            details: [`directWorkerUrl=${env.directWorkerUrl ? 'validated' : 'missing'}`, `versionId=${bootstrapVersionId ? 'validated' : 'missing'}`],
        });
        return executionChecks;
    }

    const postWriteVersionCapture = runCommand(buildVersionViewCommand(
        'wrangler-version-view-production-after-secret-write',
        bootstrapVersionId,
    ));
    reportCaptures.push(postWriteVersionCapture);
    executionChecks.push(checkForCapture(postWriteVersionCapture));
    if (postWriteVersionCapture.status === 'failed') return executionChecks;
    const postWriteGoogleBoundary = validateNoGoogleBindingsCapture(
        postWriteVersionCapture,
        bootstrapVersionId,
        'remote_google_bindings_absent_after_secret_write',
    );
    executionChecks.push(postWriteGoogleBoundary);
    if (postWriteGoogleBoundary.status === 'failed') return executionChecks;

    const bootstrapChecks = await verifyWebBootstrapState(
        env.directWorkerUrl,
        bootstrapVersionId,
        env,
        reportProbes,
        requiredSecretNames,
    );
    executionChecks.push(...bootstrapChecks);
    if (bootstrapChecks.some((check) => check.status === 'failed')) return executionChecks;
    for (const capture of secretPutCaptures) reconcileCaptureWrite(capture, true);

    let activeDeployCapture: CommandCapture | null = null;
    const transition = await orchestrateWebActiveTransition({
        deployActive: async () => {
            activeDeployCapture = runCommand(staticCommands.activeDeploy);
            reportCaptures.push(activeDeployCapture);
            executionChecks.push(checkForCapture(activeDeployCapture));
            return activeDeployCapture.status === 'ok';
        },
        proveActive: async () => {
            const activeDeploymentsCapture = runCommand(staticCommands.deploymentsListAfterActive);
            reportCaptures.push(activeDeploymentsCapture);
            executionChecks.push(checkForCapture(activeDeploymentsCapture));
            const activeVersionId = deploymentVersionId(activeDeploymentsCapture);
            const versionChanged = Boolean(activeVersionId && activeVersionId !== bootstrapVersionId);
            executionChecks.push({
                status: activeDeploymentsCapture.status === 'ok' && versionChanged ? 'ok' : 'failed',
                name: 'active_web_version_gate',
                message: activeDeploymentsCapture.status === 'ok' && versionChanged
                    ? 'A distinct active web Worker version is deployed.'
                    : 'A distinct active web Worker version could not be proven after deploy.',
                details: [
                    `versionPresent=${String(Boolean(activeVersionId))}`,
                    `versionChanged=${String(versionChanged)}`,
                ],
            });
            if (!activeVersionId || !versionChanged) return false;

            const activeVersionCapture = runCommand(buildVersionViewCommand(
                'wrangler-version-view-production-after-active-deploy',
                activeVersionId,
            ));
            reportCaptures.push(activeVersionCapture);
            executionChecks.push(checkForCapture(activeVersionCapture));
            const activeGoogleBoundary = validateNoGoogleBindingsCapture(
                activeVersionCapture,
                activeVersionId,
                'remote_google_bindings_absent_after_active_deploy',
            );
            executionChecks.push(activeGoogleBoundary);
            if (activeVersionCapture.status === 'failed' || activeGoogleBoundary.status === 'failed') return false;

            const activeSecretInventoryCapture = runCommand(buildSecretListCommand(
                'wrangler-secret-list-production-after-active-deploy',
            ));
            reportCaptures.push(activeSecretInventoryCapture);
            executionChecks.push(checkForCapture(activeSecretInventoryCapture));
            const activeSecretInventory = validateExactSecretInventoryCapture(
                activeSecretInventoryCapture,
                requiredSecretNames,
                'exact_secret_inventory_after_active_deploy',
            );
            executionChecks.push(activeSecretInventory);
            if (activeSecretInventory.status === 'failed') return false;

            const activeChecks = await runDirectWorkerProbes(env.directWorkerUrl!, activeVersionId, env, reportProbes);
            executionChecks.push(...activeChecks);
            const proven = activeChecks.every((check) => check.status === 'ok');
            if (proven && activeDeployCapture) reconcileCaptureWrite(activeDeployCapture, true);
            return proven;
        },
        compensateBootstrap: async () => compensateToWebBootstrap(
            env,
            reportCaptures,
            reportProbes,
            executionChecks,
        ),
    });

    executionChecks.push({
        status: transition.status === 'ACTIVE_PROVEN' ? 'ok' : 'failed',
        name: 'web_active_transition_outcome',
        message: transition.status === 'ACTIVE_PROVEN'
            ? 'The web transition reached and proved the active state.'
            : transition.status === 'BOOTSTRAP_COMPENSATED_AND_PROVEN'
                ? 'The active state was not proven; the runner restored and proved the inert bootstrap.'
                : 'Neither active state nor bootstrap compensation could be proven; manual reconciliation is required.',
        details: [
            `status=${transition.status}`,
            `phases=${transition.phases.map((phase) => `${phase.phase}:${phase.completed ? 'ok' : phase.error ? 'error' : 'failed'}`).join(',')}`,
        ],
    });

    if (transition.status === 'ACTIVE_PROVEN') {
        executionChecks.push({
            status: 'ok',
            name: 'active_web_deploy_verified',
            message: 'The active web package is version-bound, directly reachable, HMAC-attested and still keeps checkout disabled.',
            details: ['fulfillmentRuntime=still_bootstrap', 'checkoutEnabled=false', 'customDomainsUnchanged=true'],
        });
        executionChecks.push(releaseCanonicalWriteLockAfterProof());
    }
    return executionChecks;
}

async function runApprovedReconciliation(
    env: ExecutionEnv,
    reportCaptures: CommandCapture[],
    reportProbes: ProbeCapture[],
): Promise<Check[]> {
    const executionChecks: Check[] = [{
        status: 'ok',
        name: 'exact_reconciliation_approval_gate',
        message: 'The separate recovery approval matched from the initial process environment.',
        details: [
            `env=${reconciliationApprovalEnvVar}`,
            `targetAccount=${target.accountId}`,
            `targetWorker=${target.productionWorker}`,
            'secretPutsAuthorized=false',
            'conditionalWrite=bootstrap_compensation_only',
        ],
    }];

    let priorUnresolved: WorkerWriteCheckpoint[];
    try {
        priorUnresolved = findUnresolvedWorkerWriteCheckpoints(canonicalPendingCheckpointDir);
        recoveredPrimaryWriteLockOwner = requireRecoverableWorkerWriteExecutionLock(canonicalWriteLockPath);
        reconciliationWriteLockOwner = acquireWorkerWriteReconciliationLock(
            canonicalReconciliationLockPath,
            writeRunId,
        );
        assertWorkerWriteExecutionLockOwned(canonicalWriteLockPath, recoveredPrimaryWriteLockOwner);
        requireRecoverableWorkerWriteExecutionLock(canonicalWriteLockPath);
        writeExecutionLockAcquired = true;
        executionChecks.push({
            status: 'ok',
            name: 'exclusive_reconciliation_lock_acquired',
            message: 'This is the only recovery process allowed to inspect or compensate the pending run.',
            details: [`pendingCount=${priorUnresolved.length}`, `lockPath=${canonicalReconciliationLockPath}`],
        });
    } catch (error) {
        if (reconciliationWriteLockOwner) {
            try {
                releaseWorkerWriteExecutionLock(
                    canonicalReconciliationLockPath,
                    reconciliationWriteLockOwner,
                );
            } catch {
                // Owner-CAS deliberately refuses to delete a replaced lock.
            }
            reconciliationWriteLockOwner = null;
        }
        recoveredPrimaryWriteLockOwner = null;
        executionChecks.push({
            status: 'failed',
            name: 'exclusive_reconciliation_lock_acquired',
            message: 'Another recovery owns the exclusive lock or canonical recovery state is invalid.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        });
        return executionChecks;
    }

    let recoveryCompleted = false;
    try {
        const commands = buildStaticCommands();
        for (const command of [commands.whoami, commands.deploymentsList, commands.secretListBefore]) {
            const capture = runCommand(command);
            reportCaptures.push(capture);
            executionChecks.push(checkForCapture(capture));
            if (capture.status === 'failed') return executionChecks;
        }

        const targetCheck = validateRemotePreWriteTarget(
            reportCaptures.find((capture) => capture.id === commands.whoami.id),
            reportCaptures.find((capture) => capture.id === commands.deploymentsList.id),
        );
        executionChecks.push(targetCheck);
        if (targetCheck.status === 'failed') return executionChecks;

        const deploymentsCapture = reportCaptures.find((capture) => capture.id === commands.deploymentsList.id);
        const inventoryCapture = reportCaptures.find((capture) => capture.id === commands.secretListBefore.id);
        const versionId = deploymentVersionId(deploymentsCapture);
        let presentSecretNames: string[] = [];
        try {
            if (!versionId || !inventoryCapture || inventoryCapture.status !== 'ok') {
                throw new Error('Recovery readback is missing the exact version or secret inventory.');
            }
            presentSecretNames = parseExactSecretInventory(readIfExists(inventoryCapture.path) ?? '');
            const unexpected = presentSecretNames.filter((name) => !requiredSecretNames.includes(name));
            if (unexpected.length > 0 || !presentSecretNames.includes('INTERNAL_JOB_SECRET')) {
                throw new Error(`Recovery inventory is outside the allowlist or lacks INTERNAL_JOB_SECRET: ${unexpected.join(',') || 'no unexpected names'}.`);
            }
            executionChecks.push({
                status: 'ok',
                name: 'recovery_secret_inventory_allowlisted',
                message: 'Fresh recovery readback proves an allowlisted secret inventory with the HMAC secret present.',
                details: [`nameCount=${presentSecretNames.length}`, `capture=${inventoryCapture.path}`],
            });
        } catch (error) {
            executionChecks.push({
                status: 'failed',
                name: 'recovery_secret_inventory_allowlisted',
                message: 'Recovery cannot continue without an exact allowlisted inventory and HMAC secret.',
                details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
            });
            return executionChecks;
        }

        const versionCapture = runCommand(buildVersionViewCommand(
            'wrangler-version-view-production-recovery-before-decision',
            versionId!,
        ));
        reportCaptures.push(versionCapture);
        executionChecks.push(checkForCapture(versionCapture));
        const googleBoundary = validateNoGoogleBindingsCapture(
            versionCapture,
            versionId!,
            'remote_google_bindings_absent_recovery_before_decision',
        );
        executionChecks.push(googleBoundary);
        if (versionCapture.status === 'failed' || googleBoundary.status === 'failed') return executionChecks;

        const compensationWasInitiated = priorUnresolved.some((checkpoint) =>
            checkpoint.commandId.includes('bootstrap') && checkpoint.commandId.includes('compensat'));
        const remoteMode = await readRemoteWebRuntimeMode(env.directWorkerUrl!, reportProbes);
        executionChecks.push(remoteMode.check);

        let safeStateProven = false;
        if (!compensationWasInitiated && remoteMode.mode === 'bootstrap') {
            const bootstrapChecks = await verifyWebBootstrapState(
                env.directWorkerUrl!,
                versionId!,
                env,
                reportProbes,
                presentSecretNames,
            );
            executionChecks.push(...bootstrapChecks.map(asRecoveryObservation));
            safeStateProven = bootstrapChecks.every((check) => check.status === 'ok');
        } else if (!compensationWasInitiated && remoteMode.mode === 'active') {
            const exactInventory = validateExactSecretInventoryCapture(
                inventoryCapture,
                requiredSecretNames,
                'recovery_exact_active_secret_inventory',
            );
            executionChecks.push(asRecoveryObservation(exactInventory));
            if (exactInventory.status === 'ok') {
                const activeChecks = await runDirectWorkerProbes(
                    env.directWorkerUrl!,
                    versionId!,
                    env,
                    reportProbes,
                );
                executionChecks.push(...activeChecks.map(asRecoveryObservation));
                safeStateProven = activeChecks.every((check) => check.status === 'ok');
            }
        }

        if (compensationWasInitiated || !safeStateProven) {
            executionChecks.push({
                status: 'warning',
                name: 'recovery_bootstrap_compensation_required',
                message: compensationWasInitiated
                    ? 'A prior compensation checkpoint exists; recovery may only converge by proving a fresh bootstrap compensation.'
                    : 'Fresh readbacks could not classify a fully proven safe runtime; recovery may only deploy the inert bootstrap.',
                details: [`remoteMode=${remoteMode.mode ?? 'ambiguous'}`, 'checkoutEnabled=false'],
            });
            safeStateProven = await compensateToWebBootstrap(
                env,
                reportCaptures,
                reportProbes,
                executionChecks,
                { recovery: true },
            );
        }
        if (!safeStateProven) return executionChecks;

        for (const checkpoint of priorUnresolved) reconcilePriorCheckpointToSafeState(checkpoint);
        const remaining = findUnresolvedWorkerWriteCheckpoints(canonicalPendingCheckpointDir);
        if (remaining.length > 0) {
            executionChecks.push({
                status: 'failed',
                name: 'canonical_recovery_checkpoints_resolved',
                message: 'Safe remote state was proven but canonical checkpoints remain unresolved; locks stay closed.',
                details: [`pendingCount=${remaining.length}`],
            });
            return executionChecks;
        }

        assertRecoveryWriteLockOwnership();
        releaseWorkerWriteExecutionLock(canonicalWriteLockPath, recoveredPrimaryWriteLockOwner!);
        assertWorkerWriteExecutionLockOwned(
            canonicalReconciliationLockPath,
            reconciliationWriteLockOwner!,
        );
        releaseWorkerWriteExecutionLock(
            canonicalReconciliationLockPath,
            reconciliationWriteLockOwner!,
        );
        recoveredPrimaryWriteLockOwner = null;
        reconciliationWriteLockOwner = null;
        writeExecutionLockAcquired = false;
        recoveryCompleted = true;
        executionChecks.push({
            status: 'ok',
            name: 'canonical_recovery_checkpoints_resolved',
            message: 'Fresh exact proof established a safe remote state; pending checkpoints moved to resolved and both locks were released.',
            details: [`resolvedPriorCount=${priorUnresolved.length}`, 'pendingCount=0'],
        });
        return executionChecks;
    } finally {
        if (!recoveryCompleted && reconciliationWriteLockOwner) {
            releaseWorkerWriteExecutionLock(
                canonicalReconciliationLockPath,
                reconciliationWriteLockOwner,
            );
            reconciliationWriteLockOwner = null;
            writeExecutionLockAcquired = false;
        }
    }
}

function asRecoveryObservation(check: Check): Check {
    return check.status === 'failed'
        ? { ...check, status: 'warning', name: `recovery_observation_${check.name}` }
        : check;
}

function reconcilePriorCheckpointToSafeState(checkpoint: WorkerWriteCheckpoint): void {
    const reconciled = reconcileWorkerWriteCheckpointToSafeState(checkpoint);
    recordWriteCheckpoint(reconciled);
    writeCheckpointPaths.push(...resolveCanonicalWorkerWriteCheckpoint(
        canonicalPendingCheckpointDir,
        canonicalResolvedCheckpointDir,
        reconciled,
    ));
}

function assertRecoveryWriteLockOwnership(): void {
    if (!recoveredPrimaryWriteLockOwner || !reconciliationWriteLockOwner) {
        throw new Error('Recovery lock ownership is incomplete.');
    }
    assertWorkerWriteExecutionLockOwned(canonicalWriteLockPath, recoveredPrimaryWriteLockOwner);
    requireRecoverableWorkerWriteExecutionLock(canonicalWriteLockPath);
    assertWorkerWriteExecutionLockOwned(
        canonicalReconciliationLockPath,
        reconciliationWriteLockOwner,
    );
}

function assertProviderWriteLockOwnership(): void {
    if (reconcileRequested) {
        assertRecoveryWriteLockOwnership();
        return;
    }
    if (!normalWriteLockOwner) throw new Error('Normal write-lock ownership is missing.');
    assertWorkerWriteExecutionLockOwned(canonicalWriteLockPath, normalWriteLockOwner);
    if (existsSync(canonicalReconciliationLockPath)) {
        throw new Error('A reconciliation lock blocks normal provider writes.');
    }
}

function acquireCanonicalWriteLock(): Check {
    try {
        normalWriteLockOwner = acquireNormalWorkerWriteExecutionLock(
            canonicalWriteLockPath,
            canonicalReconciliationLockPath,
            writeRunId,
        );
        writeExecutionLockAcquired = true;
        return {
            status: 'ok',
            name: 'canonical_write_execution_lock_acquired',
            message: 'A stable exclusive write lock was acquired immediately before the first provider mutation.',
            details: [`runId=${writeRunId}`, `lockPath=${canonicalWriteLockPath}`],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'canonical_write_execution_lock_acquired',
            message: 'The stable exclusive write lock could not be acquired; no provider mutation may begin.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

function releaseCanonicalWriteLockAfterProof(): Check {
    try {
        const unresolved = findUnresolvedWorkerWriteCheckpoints(canonicalPendingCheckpointDir);
        if (unresolved.length > 0) {
            throw new Error(`Refusing to release the write lock with ${unresolved.length} unresolved checkpoint(s).`);
        }
        if (!normalWriteLockOwner) throw new Error('Normal write-lock owner is missing.');
        assertWorkerWriteExecutionLockOwned(canonicalWriteLockPath, normalWriteLockOwner);
        if (existsSync(canonicalReconciliationLockPath)) {
            throw new Error('Refusing normal lock release while reconciliation lock exists.');
        }
        releaseWorkerWriteExecutionLock(canonicalWriteLockPath, normalWriteLockOwner);
        normalWriteLockOwner = null;
        writeExecutionLockAcquired = false;
        return {
            status: 'ok',
            name: 'canonical_write_execution_lock_released',
            message: 'Every provider write has exact read-back proof; the stable execution lock was released.',
            details: [`runId=${writeRunId}`, 'canonicalPendingCount=0'],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'canonical_write_execution_lock_released',
            message: 'The stable write lock remains in place because all read-backs could not be proven.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

async function reconcileFailedSecretWriteReadOnly(
    env: ExecutionEnv,
    reportCaptures: CommandCapture[],
    reportProbes: ProbeCapture[],
): Promise<Check[]> {
    const reconciliationChecks: Check[] = [{
        status: 'failed',
        name: 'secret_write_outcome_ambiguous_needs_readonly_reconciliation',
        message: 'A secret put failed or timed out after its atomic write-ahead checkpoint; no write may be retried.',
        details: [
            'externalWritePerformed=unknown',
            'readonlyReconciliationRequired=true',
            'retryForbidden=true',
        ],
    }];

    const secretInventoryCapture = runCommand(buildSecretListCommand(
        'wrangler-secret-list-production-after-ambiguous-write',
    ));
    reportCaptures.push(secretInventoryCapture);
    reconciliationChecks.push(checkForCapture(secretInventoryCapture));
    reconciliationChecks.push(validateSecretInventoryAllowlistedCapture(
        secretInventoryCapture,
        requiredSecretNames,
        'allowlisted_secret_inventory_after_ambiguous_write',
    ));

    const deploymentsCapture = runCommand(buildStaticCommands().deploymentsListAfter);
    reportCaptures.push(deploymentsCapture);
    reconciliationChecks.push(checkForCapture(deploymentsCapture));
    const versionId = deploymentVersionId(deploymentsCapture);
    if (!versionId || !env.directWorkerUrl) {
        reconciliationChecks.push({
            status: 'failed',
            name: 'remote_state_after_ambiguous_secret_write',
            message: 'Read-only reconciliation could not identify the exact current web version.',
            details: ['manualStopRequired=true'],
        });
        return reconciliationChecks;
    }

    const versionCapture = runCommand(buildVersionViewCommand(
        'wrangler-version-view-production-after-ambiguous-secret-write',
        versionId,
    ));
    reportCaptures.push(versionCapture);
    reconciliationChecks.push(checkForCapture(versionCapture));
    reconciliationChecks.push(validateNoGoogleBindingsCapture(
        versionCapture,
        versionId,
        'remote_google_bindings_absent_after_ambiguous_secret_write',
    ));
    try {
        const presentSecretNames = parseExactSecretInventory(readIfExists(secretInventoryCapture.path) ?? '');
        reconciliationChecks.push(...await verifyWebBootstrapState(
            env.directWorkerUrl,
            versionId,
            env,
            reportProbes,
            presentSecretNames,
        ));
    } catch (error) {
        reconciliationChecks.push({
            status: 'failed',
            name: 'bootstrap_attestation_after_ambiguous_secret_write',
            message: 'Exact present-secret inventory could not be derived for bootstrap attestation.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        });
    }
    return reconciliationChecks;
}

async function validateFreshStripeLiveReadiness(env: ExecutionEnv): Promise<Check> {
    try {
        const stripe = new Stripe(env.secretValues.STRIPE_SECRET_KEY, {
            maxNetworkRetries: 0,
            timeout: 20_000,
        });
        const readiness = await inspectStripeLiveReadiness(
            stripe,
            env.secretValues.STRIPE_EXPECTED_ACCOUNT_ID,
            env.secretValues.STRIPE_PORTAL_CONFIGURATION_ID,
        );
        return {
            status: readiness.ok ? 'ok' : 'failed',
            name: 'fresh_stripe_live_readiness_pre_write_gate',
            message: readiness.ok
                ? 'Fresh read-only Stripe proof matches the exact live account, ES/EUR readiness, Portal and single webhook.'
                : 'Fresh Stripe live readiness did not match; no Cloudflare secret write may start.',
            details: readiness.ok
                ? [
                    `accountMatched=${String(readiness.facts.accountMatched)}`,
                    `accountReady=${String(readiness.facts.accountReady)}`,
                    `country=${readiness.facts.country}`,
                    `currency=${readiness.facts.currency}`,
                    `portalMatched=${String(readiness.facts.portalMatched)}`,
                    `webhookMatched=${String(readiness.facts.webhookMatched)}`,
                    `enabledWebhookCount=${readiness.facts.enabledWebhookCount}`,
                ]
                : readiness.failures.map((failure) => `failure=${failure}`),
        };
    } catch {
        return {
            status: 'failed',
            name: 'fresh_stripe_live_readiness_pre_write_gate',
            message: 'Fresh Stripe live readiness could not be proven; no Cloudflare secret write may start.',
            details: ['failure=stripe_readonly_probe_unavailable'],
        };
    }
}

function validateBuiltActiveConfig(): Check {
    const configPath = path.join('dist', 'server', 'wrangler.json');
    if (!existsSync(configPath)) {
        return {
            status: 'failed',
            name: 'built_active_web_config',
            message: 'The active production build did not produce dist/server/wrangler.json.',
            details: [`missing=${configPath}`],
        };
    }

    try {
        const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
            assets?: { run_worker_first?: unknown };
            main?: unknown;
            name?: unknown;
            routes?: unknown[];
            services?: Array<{ binding?: unknown; service?: unknown }>;
            targetEnvironment?: unknown;
            triggers?: { crons?: unknown[] };
            vars?: Record<string, unknown>;
        };
        const vars = config.vars ?? {};
        const expected: Array<[string, unknown, unknown]> = [
            ['name', config.name, target.productionWorker],
            ['main', config.main, 'entry.mjs'],
            ['targetEnvironment', config.targetEnvironment, 'production'],
            ['PUBLIC_APP_ENV', vars.PUBLIC_APP_ENV, 'production'],
            ['WEB_RUNTIME_MODE', vars.WEB_RUNTIME_MODE, 'active'],
            ['SUPABASE_EXPECTED_PROJECT_REF', vars.SUPABASE_EXPECTED_PROJECT_REF, productionSupabaseRef],
            ['WORKER_IDENTITY', vars.WORKER_IDENTITY, productionWorkerIdentity],
            ['PUBLIC_SITE_URL', vars.PUBLIC_SITE_URL, productionSite],
            ['CHECKOUT_ENABLED', vars.CHECKOUT_ENABLED, 'false'],
            ['CHECKOUT_ENABLED_OVERRIDE', vars.CHECKOUT_ENABLED_OVERRIDE, 'false'],
        ];
        const mismatches = expected
            .filter(([, actual, wanted]) => actual !== wanted)
            .map(([name, actual, wanted]) => `${name}=${String(actual ?? 'missing')} expected=${String(wanted)}`);
        const fulfillmentBound = config.services?.some((binding) =>
            binding.binding === 'FULFILLMENT_SERVICE'
            && binding.service === 'espanol-honesto-fulfillment-production',
        ) === true;
        if (!fulfillmentBound) mismatches.push('FULFILLMENT_SERVICE=espanol-honesto-fulfillment-production');
        if (config.assets?.run_worker_first !== true) mismatches.push('assets.run_worker_first=true');
        if ((config.routes?.length ?? 0) > 0) mismatches.push('routes must be absent/empty');
        if ((config.triggers?.crons?.length ?? 0) > 0) mismatches.push('crons must be absent/empty');

        return {
            status: mismatches.length === 0 ? 'ok' : 'failed',
            name: 'built_active_web_config',
            message: mismatches.length === 0
                ? 'The clean resolved package is the exact active production web Worker with checkout false and no domain attachment.'
                : 'The resolved active web package does not match the exact production safety contract.',
            details: mismatches.length === 0 ? [`config=${configPath}`, 'customDomains=absent'] : mismatches,
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'built_active_web_config',
            message: 'The resolved active Wrangler config could not be parsed.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

function validateActiveDryRun(capture: CommandCapture | undefined): Check {
    const output = capture ? readIfExists(capture.path) ?? '' : '';
    const required = [
        'WEB_RUNTIME_MODE',
        'active',
        'CHECKOUT_ENABLED',
        'CHECKOUT_ENABLED_OVERRIDE',
        'false',
        'FULFILLMENT_SERVICE',
        'espanol-honesto-fulfillment-production',
    ];
    const missing = required.filter((snippet) => !output.includes(snippet));
    const domainMentions = target.customDomains.filter((domain) => output.includes(domain));
    const ok = capture?.status === 'ok' && missing.length === 0 && domainMentions.length === 0;
    return {
        status: ok ? 'ok' : 'failed',
        name: 'active_web_dry_run_guard',
        message: ok
            ? 'Immediate dry-run proves the active package, fulfillment binding, checkout false and no custom-domain attachment.'
            : 'Immediate active dry-run did not prove the exact no-domain/checkout-false package.',
        details: [
            `capture=${capture?.path ?? 'missing'}`,
            ...missing.map((snippet) => `missing=${snippet}`),
            ...domainMentions.map((domain) => `forbiddenDomainMention=${domain}`),
        ],
    };
}

function validateExactSecretInventoryCapture(
    capture: CommandCapture | undefined,
    expectedNames: readonly string[],
    checkName: string,
): Check {
    try {
        if (!capture || capture.status !== 'ok') throw new Error('Secret inventory command failed.');
        const names = assertExactSecretInventory(readIfExists(capture.path) ?? '', expectedNames);
        return {
            status: 'ok',
            name: checkName,
            message: 'Cloudflare secret inventory matches the exact allowlist.',
            details: [`nameCount=${names.length}`, `capture=${capture.path}`],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: checkName,
            message: 'Cloudflare secret inventory is malformed, partial or outside the exact allowlist.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

function validateSecretInventoryAllowlistedCapture(
    capture: CommandCapture | undefined,
    allowedNames: readonly string[],
    checkName: string,
): Check {
    try {
        if (!capture || capture.status !== 'ok') throw new Error('Secret inventory command failed.');
        const names = parseExactSecretInventory(readIfExists(capture.path) ?? '');
        const unexpected = names.filter((name) => !allowedNames.includes(name));
        if (unexpected.length > 0) throw new Error(`Unexpected secret names: ${unexpected.join(',')}.`);
        return {
            status: 'ok',
            name: checkName,
            message: 'Read-only reconciliation found only allowlisted secret names.',
            details: [`nameCount=${names.length}`, `capture=${capture.path}`],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: checkName,
            message: 'Read-only reconciliation could not prove an allowlisted secret inventory.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

function validateNoGoogleBindingsCapture(
    capture: CommandCapture | undefined,
    expectedVersionId: string,
    checkName: string,
): Check {
    try {
        if (!capture || capture.status !== 'ok') throw new Error('Version binding command failed.');
        const names = assertNoGoogleWebBindings(readIfExists(capture.path) ?? '', expectedVersionId);
        return {
            status: 'ok',
            name: checkName,
            message: 'The exact deployed web version contains no Google binding name of any type.',
            details: [
                `versionId=${expectedVersionId}`,
                `bindingNameCount=${names.length}`,
                `forbiddenGoogleBindings=none`,
                `capture=${capture.path}`,
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: checkName,
            message: 'The exact deployed web version did not prove the Google binding boundary.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        };
    }
}

async function verifyWebBootstrapState(
    baseUrl: string,
    expectedVersionId: string,
    env: ExecutionEnv,
    reportProbes: ProbeCapture[],
    presentSecretNames: readonly string[],
): Promise<Check[]> {
    const results: Check[] = [];
    try {
        const healthUrl = new URL('/health', baseUrl).toString();
        const healthResponse = await fetch(healthUrl, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
        const health = await healthResponse.json() as {
            appEnvironment?: unknown;
            checkoutEnabled?: unknown;
            runtimeMode?: unknown;
            status?: unknown;
            workerIdentity?: unknown;
        };
        const healthy = healthResponse.status === 200
            && health.appEnvironment === 'production'
            && health.checkoutEnabled === false
            && health.runtimeMode === 'bootstrap'
            && health.status === 'ok'
            && health.workerIdentity === productionWorkerIdentity;
        results.push({
            status: healthy ? 'ok' : 'failed',
            name: 'web_bootstrap_health_before_active_deploy',
            message: healthy
                ? 'Direct health proves the current web version is still the inert bootstrap before active deploy.'
                : 'Direct health did not prove the current inert bootstrap before active deploy.',
            details: [`httpStatus=${healthResponse.status}`, `version=${expectedVersionId}`],
        });

        const rootUrl = new URL('/', baseUrl).toString();
        const rootResponse = await fetch(rootUrl, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
        let errorCode = 'invalid-body';
        try {
            errorCode = String((await rootResponse.json() as { errorCode?: unknown }).errorCode ?? 'missing');
        } catch {
            // Keep only the non-secret parse outcome.
        }
        const blocked = rootResponse.status === 503
            && errorCode === 'WEB_RUNTIME_BOOTSTRAP'
            && rootResponse.headers.get('Cache-Control') === 'no-store';
        results.push({
            status: blocked ? 'ok' : 'failed',
            name: 'web_bootstrap_503_before_active_deploy',
            message: blocked
                ? 'The current bootstrap still blocks application traffic immediately before active deploy.'
                : 'The current bootstrap did not prove its application-traffic block.',
            details: [`httpStatus=${rootResponse.status}`, `errorCode=${errorCode}`],
        });
    } catch (error) {
        results.push({
            status: 'failed',
            name: 'web_bootstrap_direct_probe_before_active_deploy',
            message: 'The current bootstrap could not be proven immediately before active deploy.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        });
    }

    results.push(await runWebRuntimeAttestation(
        baseUrl,
        expectedVersionId,
        env,
        'bootstrap',
        reportProbes,
        presentSecretNames,
    ));
    return results;
}

async function readRemoteWebRuntimeMode(
    baseUrl: string,
    reportProbes: ProbeCapture[],
): Promise<{ check: Check; mode: 'bootstrap' | 'active' | null }> {
    const url = new URL('/health', baseUrl).toString();
    const id = 'direct-worker-recovery-runtime-mode';
    let httpStatus: number | null = null;
    let mode: 'bootstrap' | 'active' | null = null;
    let bytes = 0;
    let error = 'none';
    try {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
        httpStatus = response.status;
        const raw = await response.text();
        bytes = Buffer.byteLength(raw, 'utf8');
        const parsed = JSON.parse(raw) as { runtimeMode?: unknown; workerIdentity?: unknown };
        if (
            response.status === 200
            && parsed.workerIdentity === productionWorkerIdentity
            && (parsed.runtimeMode === 'bootstrap' || parsed.runtimeMode === 'active')
        ) mode = parsed.runtimeMode;
    } catch (caught) {
        error = sanitizeError(caught instanceof Error ? caught : new Error(String(caught)));
    }
    const status: CheckStatus = mode ? 'ok' : 'warning';
    const capturePath = path.join(outputDir, `${id}.txt`);
    writeFileSync(capturePath, [
        `url=${url}`,
        `httpStatus=${httpStatus ?? 'none'}`,
        `bytes=${bytes}`,
        `runtimeMode=${mode ?? 'ambiguous'}`,
        `error=${error}`,
        '',
    ].join('\n'), 'utf8');
    reportProbes.push({ id, url, status, httpStatus, bytes, path: capturePath });
    return {
        mode,
        check: {
            status,
            name: 'fresh_remote_runtime_mode_recovery',
            message: mode
                ? `Fresh direct health classifies the current web runtime as ${mode}.`
                : 'Fresh direct health could not classify the current web runtime.',
            details: [`capture=${capturePath}`, `runtimeMode=${mode ?? 'ambiguous'}`],
        },
    };
}

async function runDirectWorkerProbes(
    baseUrl: string,
    expectedVersionId: string,
    env: ExecutionEnv,
    reportProbes: ProbeCapture[],
): Promise<Check[]> {
    const probeChecks: Check[] = [];

    for (const route of modernProbeRoutes) {
        const url = new URL(route, baseUrl).toString();
        const id = `direct-worker-probe-${route === '/' ? 'root' : route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
        const started = Date.now();
        let httpStatus: number | null = null;
        let bytes = 0;
        let bodyPreview = '';
        let status: CheckStatus = 'failed';
        let error = 'none';

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            const response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
            });
            clearTimeout(timeout);
            httpStatus = response.status;
            const body = sanitizeOutput(await response.text());
            bytes = Buffer.byteLength(body, 'utf8');
            bodyPreview = body.slice(0, 500);
            status = response.status >= 200 && response.status < 400 && bytes > 40 ? 'ok' : 'failed';
        } catch (caught) {
            error = sanitizeError(caught instanceof Error ? caught : new Error(String(caught)));
        }

        const capturePath = path.join(outputDir, `${id}.txt`);
        writeFileSync(capturePath, [
            `url=${url}`,
            `httpStatus=${httpStatus ?? 'none'}`,
            `bytes=${bytes}`,
            `durationMs=${Date.now() - started}`,
            `error=${error}`,
            '',
            '## sanitized_body_preview',
            '',
            bodyPreview || '(empty)',
            '',
        ].join('\n'), 'utf8');

        const capture: ProbeCapture = {
            id,
            url,
            status,
            httpStatus,
            bytes,
            path: capturePath,
        };
        reportProbes.push(capture);
        probeChecks.push({
            status,
            name: id,
            message: status === 'ok'
                ? `Direct Worker read-only probe passed for ${route}.`
                : `Direct Worker read-only probe failed for ${route}.`,
            details: [
                `capture=${capturePath}`,
                `httpStatus=${httpStatus ?? 'none'}`,
                `bytes=${bytes}`,
            ],
        });
    }

    probeChecks.push(await runWebRuntimeAttestation(baseUrl, expectedVersionId, env, 'active', reportProbes));
    return probeChecks;
}

function validateRemotePreWriteTarget(
    whoamiCapture: CommandCapture | undefined,
    deploymentsCapture: CommandCapture | undefined,
): Check {
    const whoami = whoamiCapture ? readIfExists(whoamiCapture.path) ?? '' : '';
    const versionId = deploymentVersionId(deploymentsCapture);
    let accountMatched = false;
    let identityError = 'none';
    try {
        verifyCloudflareWhoamiOutput(whoami, target.accountId);
        accountMatched = true;
    } catch (error) {
        identityError = sanitizeError(error instanceof Error ? error : new Error(String(error)));
    }
    const workerCommandMatched = deploymentsCapture?.display.includes(`--name ${target.productionWorker} --json`) === true;
    const deploymentExists = Boolean(versionId);
    const ok = accountMatched && workerCommandMatched && deploymentExists;

    return {
        status: ok ? 'ok' : 'failed',
        name: 'remote_target_pre_write_gate',
        message: ok
            ? 'Read-only Wrangler preflight proves the exact Cloudflare account, production Worker and deployed version before any secret write.'
            : 'Read-only Wrangler preflight did not prove the exact account, Worker and version; no secret write may start.',
        details: [
            `accountMatched=${String(accountMatched)}`,
            `workerCommandMatched=${String(workerCommandMatched)}`,
            `deploymentVersionPresent=${String(deploymentExists)}`,
            `targetAccount=${target.accountId}`,
            `targetWorker=${target.productionWorker}`,
            `identityError=${identityError}`,
        ],
    };
}

function deploymentVersionId(capture: CommandCapture | undefined): string | null {
    if (!capture) return null;
    const text = readIfExists(capture.path) ?? '';
    return /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(text)?.[1] ?? null;
}

async function runWebRuntimeAttestation(
    baseUrl: string,
    expectedVersionId: string,
    env: ExecutionEnv,
    expectedMode: 'bootstrap' | 'active',
    reportProbes: ProbeCapture[],
    presentSecretNames: readonly string[] = requiredSecretNames,
): Promise<Check> {
    const url = new URL('/api/internal/runtime-attestation', baseUrl).toString();
    const id = 'direct-worker-runtime-attestation';
    const nonce = randomUUID();
    const started = Date.now();
    let httpStatus: number | null = null;
    let bytes = 0;
    let error = 'none';
    let identity = 'missing';
    let version = 'missing';
    let verified = false;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20_000);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${env.secretValues.INTERNAL_JOB_SECRET}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ nonce }),
                redirect: 'error',
                signal: controller.signal,
            });
            httpStatus = response.status;
            const raw = await response.text();
            bytes = Buffer.byteLength(raw, 'utf8');
            const parsed = JSON.parse(raw) as Partial<RuntimeAttestationEnvelope>;
            identity = typeof parsed.workerIdentity === 'string' ? parsed.workerIdentity : 'missing';
            version = typeof parsed.workerVersionId === 'string' ? parsed.workerVersionId : 'missing';
            if (
                response.status === 200
                && typeof parsed.nonce === 'string'
                && typeof parsed.proof === 'string'
                && parsed.role === 'web'
                && parsed.schema === RUNTIME_ATTESTATION_SCHEMA
                && identity === productionWorkerIdentity
                && version === expectedVersionId
            ) {
                const presentSecrets = Object.fromEntries(
                    Object.entries(env.secretValues)
                        .filter(([name]) => presentSecretNames.includes(name)),
                );
                const config = await buildRuntimeAttestationConfig('web', {
                    ...presentSecrets,
                    PUBLIC_APP_ENV: 'production',
                    WEB_RUNTIME_MODE: expectedMode,
                    SUPABASE_EXPECTED_PROJECT_REF: productionSupabaseRef,
                    WORKER_IDENTITY: productionWorkerIdentity,
                    WORKER_VERSION_ID: expectedVersionId,
                    CHECKOUT_ENABLED: 'false',
                    CHECKOUT_ENABLED_OVERRIDE: 'false',
                    EMAIL_DELIVERY_MODE: expectedMode === 'active' ? 'live' : 'disabled',
                    EMAIL_DAILY_RECIPIENT_LIMIT: expectedMode === 'active' ? '80' : '0',
                    EMAIL_MONTHLY_RECIPIENT_LIMIT: expectedMode === 'active' ? '2400' : '0',
                });
                verified = await verifyRuntimeAttestation(parsed as RuntimeAttestationEnvelope, {
                    config,
                    nonce,
                    role: 'web',
                    schema: RUNTIME_ATTESTATION_SCHEMA,
                }, env.secretValues.INTERNAL_JOB_SECRET);
            }
        } finally {
            clearTimeout(timeout);
        }
    } catch (caught) {
        error = sanitizeError(caught instanceof Error ? caught : new Error(String(caught)));
    }

    const status: CheckStatus = verified ? 'ok' : 'failed';
    const capturePath = path.join(outputDir, `${id}-${expectedMode}.txt`);
    writeFileSync(capturePath, [
        `url=${url}`,
        `httpStatus=${httpStatus ?? 'none'}`,
        `bytes=${bytes}`,
        `durationMs=${Date.now() - started}`,
        `status=${status}`,
        `workerIdentity=${identity}`,
        `workerVersionMatched=${String(version === expectedVersionId)}`,
        `runtimeMode=${expectedMode}`,
        `supabaseExpectedProjectRef=${productionSupabaseRef}`,
        `proofVerified=${String(verified)}`,
        `error=${error}`,
        '',
        'No secret value, attestation proof or response body is stored.',
        '',
    ].join('\n'), 'utf8');
    reportProbes.push({ id: `${id}-${expectedMode}`, url, status, httpStatus, bytes, path: capturePath });

    return {
        status,
        name: `direct_worker_runtime_attestation_${expectedMode}`,
        message: verified
            ? `Authenticated direct probe attests the exact ${expectedMode} Worker identity, deployed version and production Supabase configuration.`
            : `Authenticated direct probe did not attest the exact ${expectedMode} Worker identity/version/Supabase configuration.`,
        details: [
            `capture=${capturePath}`,
            `workerIdentity=${identity}`,
            `workerVersionMatched=${String(version === expectedVersionId)}`,
            `supabaseExpectedProjectRef=${productionSupabaseRef}`,
            `proofVerified=${String(verified)}`,
        ],
    };
}

async function compensateToWebBootstrap(
    env: ExecutionEnv,
    reportCaptures: CommandCapture[],
    reportProbes: ProbeCapture[],
    executionChecks: Check[],
    options: { recovery?: boolean } = {},
): Promise<boolean> {
    executionChecks.push({
        status: options.recovery ? 'warning' : 'failed',
        name: options.recovery ? 'recovery_bootstrap_compensation_started' : 'active_web_deploy_not_proven',
        message: options.recovery
            ? 'Explicit recovery is converging the ambiguous or previously initiated state to the inert bootstrap.'
            : 'The active web deploy failed or its final state is ambiguous; compensating bootstrap redeploy is mandatory.',
        details: ['checkoutRemainsDisabled=true', 'fulfillmentRemainsBootstrap=true'],
    });

    const commands = buildStaticCommands();
    let compensationDeployCapture: CommandCapture | null = null;
    for (const command of [commands.bootstrapBuildForCompensation, commands.bootstrapDeployForCompensation]) {
        const capture = runCommand(command);
        if (command.writesCloudflare) compensationDeployCapture = capture;
        reportCaptures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') {
            executionChecks.push({
                status: 'failed',
                name: 'active_web_deploy_state_ambiguous',
                message: 'Compensating bootstrap build/deploy failed or timed out; remote web state is ambiguous.',
                details: ['manualStopRequired=true'],
            });
            return false;
        }
    }

    const deployments = runCommand(commands.deploymentsListAfterCompensation);
    reportCaptures.push(deployments);
    executionChecks.push(checkForCapture(deployments));
    const versionId = deploymentVersionId(deployments);
    if (deployments.status === 'failed' || !versionId || !env.directWorkerUrl) {
        executionChecks.push({
            status: 'failed',
            name: 'active_web_deploy_state_ambiguous',
            message: 'Compensating deploy returned but a new bootstrap version/direct URL could not be proven.',
            details: ['manualStopRequired=true'],
        });
        return false;
    }

    const versionCapture = runCommand(buildVersionViewCommand(
        'wrangler-version-view-production-after-bootstrap-compensation',
        versionId,
    ));
    reportCaptures.push(versionCapture);
    executionChecks.push(checkForCapture(versionCapture));
    const googleBoundary = validateNoGoogleBindingsCapture(
        versionCapture,
        versionId,
        'remote_google_bindings_absent_after_bootstrap_compensation',
    );
    executionChecks.push(googleBoundary);
    if (versionCapture.status === 'failed' || googleBoundary.status === 'failed') return false;

    const secretInventoryCapture = runCommand(buildSecretListCommand(
        'wrangler-secret-list-production-after-bootstrap-compensation',
    ));
    reportCaptures.push(secretInventoryCapture);
    executionChecks.push(checkForCapture(secretInventoryCapture));
    const secretInventory = options.recovery
        ? validateSecretInventoryAllowlistedCapture(
            secretInventoryCapture,
            requiredSecretNames,
            'allowlisted_secret_inventory_after_recovery_bootstrap_compensation',
        )
        : validateExactSecretInventoryCapture(
            secretInventoryCapture,
            requiredSecretNames,
            'exact_secret_inventory_after_bootstrap_compensation',
        );
    executionChecks.push(secretInventory);
    if (secretInventory.status === 'failed') return false;

    let presentSecretNames: string[];
    try {
        presentSecretNames = parseExactSecretInventory(readIfExists(secretInventoryCapture.path) ?? '');
        if (!presentSecretNames.includes('INTERNAL_JOB_SECRET')) {
            throw new Error('Recovery bootstrap inventory lacks INTERNAL_JOB_SECRET.');
        }
    } catch (error) {
        executionChecks.push({
            status: 'failed',
            name: 'bootstrap_compensation_inventory_for_attestation',
            message: 'Bootstrap compensation cannot be attested without its exact present-secret inventory.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
        });
        return false;
    }

    const bootstrapChecks = await verifyWebBootstrapState(
        env.directWorkerUrl,
        versionId,
        env,
        reportProbes,
        presentSecretNames,
    );
    executionChecks.push(...bootstrapChecks);
    const proven = bootstrapChecks.every((check) => check.status === 'ok');
    if (proven && compensationDeployCapture) reconcileCaptureWrite(compensationDeployCapture, true);
    executionChecks.push({
        status: proven ? 'ok' : 'failed',
        name: proven ? 'compensating_web_bootstrap_proven' : 'active_web_deploy_state_ambiguous',
        message: proven
            ? 'Compensating redeploy restored a version-bound web bootstrap with traffic blocked and HMAC configuration proven.'
            : 'Compensating redeploy ran but the bootstrap/503/HMAC state is not fully proven.',
        details: proven
            ? [`versionId=${versionId}`, 'runtimeMode=bootstrap', 'applicationHttpStatus=503']
            : ['manualStopRequired=true'],
    });
    return proven;
}

function runCommand(command: CommandSpec, input?: string): CommandCapture {
    let writeCheckpoint: WorkerWriteCheckpoint | null = null;
    if (command.writesCloudflare) {
        if (!writeExecutionLockAcquired) {
            throw new Error(`Refusing Cloudflare write ${command.id} without the stable execution lock.`);
        }
        assertProviderWriteLockOwnership();
        externalWriteAttempted = true;
        writeCheckpoint = startWorkerWriteCheckpoint(command.id, nextWriteCheckpointSequence, writeRunId);
        nextWriteCheckpointSequence += 1;
        recordWriteCheckpoint(writeCheckpoint);
    }
    const result = spawnSync(command.bin, command.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        input,
        shell: process.platform === 'win32',
        timeout: command.timeoutMs,
        windowsHide: true,
        env: process.env,
    });
    const stdout = sanitizeOutput(result.stdout ?? '');
    const stderr = sanitizeOutput(result.stderr ?? '');
    const exitCode = result.status;
    const timedOut = Boolean(result.error?.message.includes('ETIMEDOUT'));
    const status: CheckStatus = exitCode === 0 && !timedOut && !result.error ? 'ok' : 'failed';
    if (writeCheckpoint) {
        writeCheckpoint = classifyWorkerWriteProviderResult(writeCheckpoint, {
            exitCode,
            timedOut,
            errorPresent: Boolean(result.error),
        });
        recordWriteCheckpoint(writeCheckpoint);
    }
    const capturePath = path.join(outputDir, `${command.id}.txt`);
    const body = [
        `command=${command.display}`,
        `writesCloudflare=${String(command.writesCloudflare)}`,
        `exitCode=${String(exitCode)}`,
        `error=${result.error ? sanitizeError(result.error) : 'none'}`,
        '',
        '## stdout',
        '',
        stdout || '(empty)',
        '',
        '## stderr',
        '',
        stderr || '(empty)',
        '',
    ].join('\n');

    writeFileSync(capturePath, body, 'utf8');

    return {
        id: command.id,
        display: command.display,
        path: capturePath,
        exitCode,
        status,
        writesCloudflare: command.writesCloudflare,
        ...(writeCheckpoint ? { writeCheckpointSequence: writeCheckpoint.sequence } : {}),
    };
}

function recordWriteCheckpoint(checkpoint: WorkerWriteCheckpoint): void {
    const existingIndex = writeCheckpoints.findIndex((candidate) =>
        candidate.runId === checkpoint.runId && candidate.sequence === checkpoint.sequence);
    if (existingIndex >= 0) writeCheckpoints[existingIndex] = checkpoint;
    else writeCheckpoints.push(checkpoint);
    writeCheckpointPaths.push(persistCanonicalWorkerWriteCheckpoint(canonicalPendingCheckpointDir, checkpoint));
    writeCheckpointPaths.push(persistWorkerWriteCheckpointAtomically(outputDir, checkpoint));
}

function reconcileCaptureWrite(capture: CommandCapture, intendedStateProven: boolean): void {
    if (capture.writeCheckpointSequence === undefined) return;
    const checkpoint = writeCheckpoints.find(
        (candidate) => candidate.runId === writeRunId && candidate.sequence === capture.writeCheckpointSequence,
    );
    if (!checkpoint) throw new Error(`Missing write checkpoint for ${capture.id}.`);
    const reconciled = reconcileWorkerWriteCheckpoint(checkpoint, intendedStateProven);
    recordWriteCheckpoint(reconciled);
    if (reconciled.stage === 'readback_proven') {
        writeCheckpointPaths.push(...resolveCanonicalWorkerWriteCheckpoint(
            canonicalPendingCheckpointDir,
            canonicalResolvedCheckpointDir,
            reconciled,
        ));
    }
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
            `writesCloudflare=${String(capture.writesCloudflare)}`,
        ],
    };
}

function renderArtifacts(report: RunnerReport): RenderedArtifacts {
    const commands = buildStaticCommands();
    const recoveryMode = reconcileRequested;
    const artifactApprovalSentence = recoveryMode ? exactReconciliationApprovalSentence : exactApprovalSentence;
    const artifactExecutionFlag = recoveryMode ? '--reconcile-approved' : '--execute-approved';
    const commandManifest = `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        target: report.target,
        mode: recoveryMode ? 'reconcile-approved' : report.executeRequested ? 'execute-approved' : 'plan',
        approvalEnvVar: report.approvalEnvVar,
        approvalMatched: report.approvalMatched,
        externalWriteAttempted: report.externalWriteAttempted,
        externalWritePerformed: report.externalWritePerformed,
        externalWriteOutcome: report.externalWriteOutcome,
        readonlyReconciliationRequired: report.readonlyReconciliationRequired,
        exactApprovalSentence: artifactApprovalSentence,
        requiredSecretNames: report.requiredSecretNames,
        directWorkerUrlEnvVar: report.directWorkerUrlEnvVar,
        envFileEnvVar: report.envFileEnvVar,
        commandShapes: recoveryMode ? [
            commands.whoami.display,
            commands.deploymentsList.display,
            commands.secretListBefore.display,
            'pnpm --config.verify-deps-before-run=false exec wrangler versions view VERSION_ID --name espanolhonesto --json',
            commands.bootstrapBuildForCompensation.display,
            commands.bootstrapDeployForCompensation.display,
        ] : [
            commands.whoami.display,
            commands.deploymentsList.display,
            commands.activeBuild.display,
            commands.activeDeployDryRun.display,
            commands.secretListBefore.display,
            'pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --config wrangler.toml --env production',
            commands.secretListAfter.display,
            commands.deploymentsListAfter.display,
            commands.activeDeploy.display,
            commands.deploymentsListAfterActive.display,
            commands.bootstrapBuildForCompensation.display,
            commands.bootstrapDeployForCompensation.display,
        ],
        captures: report.captures.map((capture) => ({
            id: capture.id,
            path: toRelative(capture.path),
            exitCode: capture.exitCode,
            status: capture.status,
            writesCloudflare: capture.writesCloudflare,
        })),
        probes: report.probes.map((probe) => ({
            id: probe.id,
            httpStatus: probe.httpStatus,
            bytes: probe.bytes,
            status: probe.status,
            path: toRelative(probe.path),
        })),
        writeCheckpoints: report.writeCheckpoints,
        writeCheckpointPaths: report.writeCheckpointPaths.map(toRelative),
        sourceEvidence: {
            runtimeReadonly: toRelativeOrNull(report.latestRuntimeReadonlyPath),
            noWritePreflight: toRelativeOrNull(report.latestPreflightSummaryPath),
            variableMatrix: toRelativeOrNull(report.latestVariableMatrixPath),
            cutoverManifest: toRelativeOrNull(report.latestCutoverManifestPath),
            secretsApproval: toRelativeOrNull(report.latestSecretsApprovalPath),
            phaseOneRunner: toRelativeOrNull(report.latestPhaseOneRunnerPath),
        },
        forbiddenScope: forbiddenScopeLines(),
    }, null, 2)}\n`;

    const executionPlan = `${[
        '# Cloudflare Production Worker Secrets And Active Deploy Execution Plan',
        '',
        recoveryMode
            ? 'This separately approved recovery performs fresh readbacks first and may only converge an ambiguous state to the inert bootstrap. It never runs secret puts.'
            : 'This exact-gated package loads the final production Worker secret/var names, performs a clean active build and deploy with checkout disabled, and verifies the new version directly. It is not phase-1 Worker creation approval and it is not domain approval.',
        '',
        '## Current Mode',
        '',
        `- Execute requested: ${String(report.executeRequested)}.`,
        `- Approval matched: ${String(report.approvalMatched)}.`,
        `- External write attempted: ${String(report.externalWriteAttempted)}.`,
        `- External write performed: ${String(report.externalWritePerformed)}.`,
        `- External write outcome: ${report.externalWriteOutcome}.`,
        `- Read-only reconciliation required: ${String(report.readonlyReconciliationRequired)}.`,
        '',
        '## Target',
        '',
        `- Account: ${report.target.accountLabel} (${report.target.accountId}).`,
        `- Worker: \`${report.target.productionWorker}\`.`,
        `- Existing Pages project that must remain untouched in this phase: \`${report.target.pagesProject}\`.`,
        `- Domains that must not move in this phase: ${report.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        '- Required runtime state claim: `CHECKOUT_ENABLED=false` from `wrangler.toml`.',
        '',
        '## Names This Runner Loads',
        '',
        ...(recoveryMode ? ['- Recovery loads no names; this list is the read-back allowlist.'] : report.requiredSecretNames.map((name) => `- \`${name}\``)),
        '',
        '## Evidence To Review First',
        '',
        `- Runtime read-only: ${toRelativeOrFallback(report.latestRuntimeReadonlyPath, 'outputs/launch-cloudflare-production-runtime-readonly/<timestamp>/summary.json')}`,
        `- No-write preflight: ${toRelativeOrFallback(report.latestPreflightSummaryPath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/summary.json')}`,
        `- Variable matrix: ${toRelativeOrFallback(report.latestVariableMatrixPath, 'outputs/launch-cloudflare-production-runtime-cutover-preflight/<timestamp>/cloudflare-production-worker-variable-matrix.md')}`,
        `- Cutover manifest: ${toRelativeOrFallback(report.latestCutoverManifestPath, 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/cloudflare-production-runtime-cutover-manifest.json')}`,
        `- Secret-name approval request: ${toRelativeOrFallback(report.latestSecretsApprovalPath, 'outputs/launch-cloudflare-production-runtime-cutover/<timestamp>/approval-request-worker-secrets.md')}`,
        `- Phase-1 runner summary: ${toRelativeOrFallback(report.latestPhaseOneRunnerPath, 'outputs/launch-cloudflare-production-worker-phase1/<timestamp>/summary.md')}`,
        '',
        '## Commands Encoded In This Runner',
        '',
        '```bash',
        commands.whoami.display,
        commands.deploymentsList.display,
        commands.secretListBefore.display,
        'pnpm --config.verify-deps-before-run=false exec wrangler versions view VERSION_ID --name espanolhonesto --json',
        ...(recoveryMode ? [] : [
            commands.activeBuild.display,
            commands.activeDeployDryRun.display,
            'pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --config wrangler.toml --env production',
            commands.secretListAfter.display,
            commands.deploymentsListAfter.display,
            commands.activeDeploy.display,
            commands.deploymentsListAfterActive.display,
        ]),
        '# Automatic bootstrap compensation only when required:',
        commands.bootstrapBuildForCompensation.display,
        commands.bootstrapDeployForCompensation.display,
        '```',
        '',
        '## How To Execute Later',
        '',
        'Only after the production Worker exists and the exact approval is provided for the exact target/resource/scope:',
        '',
        '```powershell',
        `$env:${report.approvalEnvVar}='${artifactApprovalSentence.replace(/'/g, "''")}'`,
        '# Required in the same approved execution so identity/version/Supabase attestation cannot be deferred:',
        `$env:${directWorkerUrlEnvVar}='https://<direct-worker-url>'`,
        `pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-secrets -- ${artifactExecutionFlag}`,
        '```',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the production Worker does not exist or belongs to a different account.',
        '- Stop if any required value is missing from the secure env source.',
        '- Stop if any secret value appears in terminal, logs, screenshots, captures or output files.',
        '- Stop if Wrangler asks to attach/move custom domains, change DNS, delete Pages, enable checkout or perform a Stripe write.',
        '- Stop if direct Worker probes are blank, old Pages content, wrong-account content or checkout-enabled output.',
        '',
    ].join('\n')}\n`;

    const approvalGate = `${[
        '# Cloudflare Production Worker Secrets And Active Deploy Approval Gate',
        '',
        'This file is not approval. It documents the exact gate required before the secret-name commands can execute.',
        '',
        `- Environment variable: \`${report.approvalEnvVar}\`.`,
        `- Required flag: \`${artifactExecutionFlag}\`.`,
        `- Required exact direct probe env: \`${directWorkerUrlEnvVar}\`.`,
        `- Secure production env-file selector: \`${envFileEnvVar}\` (defaults to ignored \`.env.production\`).`,
        `- Execute requested in this run: ${String(report.executeRequested)}.`,
        `- Approval matched in this run: ${String(report.approvalMatched)}.`,
        `- External write performed in this run: ${String(report.externalWritePerformed)}.`,
        `- External write attempted in this run: ${String(report.externalWriteAttempted)}.`,
        `- External write outcome: ${report.externalWriteOutcome}.`,
        `- Read-only reconciliation required: ${String(report.readonlyReconciliationRequired)}.`,
        '',
        '## Exact Approval Sentence',
        '',
        artifactApprovalSentence,
        '',
        '## Allowed Scope After Match',
        '',
        '- Verify production Worker deployments list read-only.',
        '- List existing Worker secret names read-only.',
        recoveryMode
            ? '- Do not load or change any secret; use the inventory only as an exact read-back allowlist.'
            : '- Load only the required Worker secret/var names from the approved secure environment source using Wrangler stdin.',
        '- List Worker secret names again and verify names only.',
        recoveryMode
            ? '- Deploy only a clean inert bootstrap as conditional compensation after fresh readbacks cannot prove a safe state.'
            : '- Build the active web package from a clean dist root and validate/dry-run its exact resolved config.',
        ...(recoveryMode ? [] : ['- Deploy only `dist/server/wrangler.json` with checkout false and no custom-domain attachment.']),
        '- Probe the exact workers.dev URL and verify the active identity/version/Supabase HMAC attestation before the run can close.',
        '- If the active deploy or verification fails or is ambiguous, rebuild/redeploy the inert bootstrap automatically and prove bootstrap health, 503 and HMAC state.',
        '',
        '## Forbidden Scope',
        '',
        ...forbiddenScopeLines().map((line) => `- ${line}`),
        '',
    ].join('\n')}\n`;

    const rollbackAfterSecrets = `${[
        '# Cloudflare Production Worker Active Deploy Rollback',
        '',
        'The exact approval explicitly includes an automatic compensating web-bootstrap redeploy if the active deploy or verification fails or becomes ambiguous.',
        '',
        '## If Plan Mode Ran Only',
        '',
        '- No rollback is required; this package generated local evidence only.',
        '- Keep `espanolhonesto.com` and `www.espanolhonesto.com` on the existing Pages project.',
        '',
        '## If A Required Name Was Missing Or Wrong',
        '',
        '- Keep domains on Pages.',
        '- Correct only the affected Worker secret/var name under a separate exact approval.',
        '- Rerun this runner and verify names only.',
        '',
        '## If Active Deploy Or Direct Verification Fails',
        '',
        '- Do not move domains.',
        '- Keep checkout disabled.',
        '- The runner must immediately run `build:production:bootstrap` and deploy only its resolved `dist/server/wrangler.json --keep-vars`.',
        '- Treat rollback as proven only after a new version passes bootstrap health, application 503 and authenticated HMAC attestation.',
        '- If compensation cannot be proven, stop with remote state ambiguous and require manual reconciliation.',
        '',
        '## If A Domain Was Accidentally Moved Elsewhere',
        '',
        '- Treat this as out of scope for this phase and stop.',
        '- Reattach domains to the previously safe Cloudflare target only under a separate domain rollback approval.',
        '- Do not delete the Pages project during rollback.',
        '',
    ].join('\n')}\n`;

    const manualEvidenceAfterSecrets = `${[
        'pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Cloudflare production web Worker final secrets and active deploy completed: required names are present and the direct active identity/version/Supabase HMAC attestation passed with checkout disabled before domain work."',
        `  --environment "Cloudflare account ${report.target.accountId}; Worker ${report.target.productionWorker}; active workers.dev only; checkout false; domains not moved"`,
        '  --owner Alin',
        `  --evidence "command_output=../../${toRelative(report.summaryPath)}::Worker secrets runner summary reviewed; replace placeholder after actual approved execution"`,
        `  --evidence "command_output=../../${toRelative(report.commandManifestPath)}::command manifest reviewed; no secret values stored"`,
        `  --evidence "command_output=../../${toRelative(report.approvalGatePath)}::approval gate reviewed for exact target and forbidden scope"`,
        '  --evidence "manual_note=Replace this note with the actual non-secret verification: post-write secret-list capture path and direct Worker URL probe result. Do not include secret values."',
        '',
        '# Add --write only after the approved phase has actually run and the placeholder note is replaced.',
        '',
    ].join(' \\\n')}`;

    return {
        commandManifest,
        executionPlan,
        approvalGate,
        rollbackAfterSecrets,
        manualEvidenceAfterSecrets,
        summary: renderSummary(report),
    };
}

function renderSummary(report: RunnerReport): string {
    const lines = [
        '# Cloudflare Production Worker Secrets And Active Deploy Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Generated: ${report.endedAt}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write outcome: ${report.externalWriteOutcome}`,
        `- Read-only reconciliation required: ${String(report.readonlyReconciliationRequired)}`,
        `- Command manifest: ${toRelative(report.commandManifestPath)}`,
        `- Execution plan: ${toRelative(report.executionPlanPath)}`,
        `- Approval gate: ${toRelative(report.approvalGatePath)}`,
        `- Rollback: ${toRelative(report.rollbackAfterSecretsPath)}`,
        `- Manual evidence template: ${toRelative(report.manualEvidenceAfterSecretsPath)}`,
        '',
        reconcileRequested
            ? 'This recovery runs only with the separate initial-environment approval and `--reconcile-approved`. It performs fresh readbacks first, never writes secrets and can deploy only the inert bootstrap when safe remote state is otherwise unproven.'
            : 'This runner is plan-only unless both the exact approval environment variable and the `--execute-approved` flag are present. In plan mode it does not call Cloudflare, deploy, move domains, change DNS or write secrets. Approved mode keeps checkout false, deploys only the resolved active package and automatically compensates to the inert bootstrap if active state is not proven.',
        '',
        '## Target',
        '',
        `- Account: ${report.target.accountLabel} (${report.target.accountId}).`,
        `- Worker: \`${report.target.productionWorker}\`.`,
        `- Domains not moved in this phase: ${report.target.customDomains.map((domain) => `\`${domain}\``).join(', ')}.`,
        `- Required names: ${report.requiredSecretNames.length}.`,
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
            '| Status | Command | Writes Cloudflare | Path |',
            '| --- | --- | --- | --- |',
            ...report.captures.map((capture) => `| ${capture.status} | ${escapeCell(capture.display)} | ${String(capture.writesCloudflare)} | ${escapeCell(toRelative(capture.path))} |`),
            '',
        );
    }

    if (report.probes.length > 0) {
        lines.push(
            '## Direct Worker Probes',
            '',
            '| Status | URL | HTTP | Bytes | Path |',
            '| --- | --- | ---: | ---: | --- |',
            ...report.probes.map((probe) => `| ${probe.status} | ${escapeCell(probe.url)} | ${probe.httpStatus ?? 'none'} | ${probe.bytes} | ${escapeCell(toRelative(probe.path))} |`),
            '',
        );
    }

    return `${lines.join('\n')}\n`;
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const required = [
        'External write performed',
        reconcileRequested ? reconciliationApprovalEnvVar : approvalEnvVar,
        reconcileRequested ? exactReconciliationApprovalSentence : exactApprovalSentence,
        '## Names This Runner Loads',
        'direct Worker',
        'No domain move',
        'No DNS change',
        'No Pages deletion',
        'No secret value printing',
        reconcileRequested
            ? 'Recovery loads no names'
            : 'pnpm --config.verify-deps-before-run=false exec wrangler secret put SECRET_NAME --config wrangler.toml --env production',
        'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production --format json',
        reconcileRequested
            ? 'pnpm --config.verify-deps-before-run=false exec wrangler versions view VERSION_ID --name espanolhonesto --json'
            : 'pnpm --config.verify-deps-before-run=false run build:production:release',
        'pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
        'compensating web-bootstrap redeploy',
        'externalWriteOutcome',
        'readonlyReconciliationRequired',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const unsafeSecretSnippets = [
        'sk_live_',
        'sk_test_',
        'whsec_',
        'sb_secret_',
        '-----BEGIN ' + 'PRIVATE KEY-----',
        'AIza',
    ].filter((snippet) => combined.includes(snippet));
    const unsafe = [...unsafeSecretSnippets];

    return {
        status: missing.length === 0 && unsafe.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_posture',
        message: missing.length === 0 && unsafe.length === 0
            ? 'Generated Worker secret-name artifacts preserve the approval gate, command scope and no-secret/no-domain-move posture.'
            : 'Generated Worker secret-name artifacts are missing gate/scope facts or include unsafe snippets.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...unsafe.map((snippet) => `unsafe=${snippet}`),
        ],
    };
}

function buildStaticCommands(): Record<string, CommandSpec> & {
    whoami: CommandSpec;
    deploymentsList: CommandSpec;
    deploymentsListAfter: CommandSpec;
    deploymentsListAfterActive: CommandSpec;
    deploymentsListAfterCompensation: CommandSpec;
    secretListBefore: CommandSpec;
    secretListAfter: CommandSpec;
    activeBuild: CommandSpec;
    activeDeployDryRun: CommandSpec;
    activeDeploy: CommandSpec;
    bootstrapBuildForCompensation: CommandSpec;
    bootstrapDeployForCompensation: CommandSpec;
} {
    return {
        whoami: {
            id: 'wrangler-whoami-production-secrets',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler whoami --json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'whoami', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        deploymentsList: {
            id: 'wrangler-deployments-list-production',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanolhonesto', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        deploymentsListAfter: {
            id: 'wrangler-deployments-list-production-before-active-deploy',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanolhonesto', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        deploymentsListAfterActive: {
            id: 'wrangler-deployments-list-production-after-active-deploy',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanolhonesto', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        deploymentsListAfterCompensation: {
            id: 'wrangler-deployments-list-production-after-bootstrap-compensation',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name espanolhonesto --json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', 'espanolhonesto', '--json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        secretListBefore: {
            id: 'wrangler-secret-list-production-before',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production --format json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--config', 'wrangler.toml', '--env', 'production', '--format', 'json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        secretListAfter: {
            id: 'wrangler-secret-list-production-after',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production --format json',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--config', 'wrangler.toml', '--env', 'production', '--format', 'json'],
            timeoutMs: 120000,
            writesCloudflare: false,
        },
        activeBuild: {
            id: 'pnpm-build-production-active-web',
            display: 'pnpm --config.verify-deps-before-run=false run build:production:release',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'run', 'build:production:release'],
            timeoutMs: 240000,
            writesCloudflare: false,
        },
        activeDeployDryRun: {
            id: 'wrangler-active-web-deploy-dry-run',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--dry-run'],
            timeoutMs: 180000,
            writesCloudflare: false,
        },
        activeDeploy: {
            id: 'wrangler-active-web-deploy',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--keep-vars'],
            timeoutMs: 180000,
            writesCloudflare: true,
        },
        bootstrapBuildForCompensation: {
            id: 'pnpm-build-production-bootstrap-compensation',
            display: 'pnpm --config.verify-deps-before-run=false run build:production:bootstrap',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'run', 'build:production:bootstrap'],
            timeoutMs: 240000,
            writesCloudflare: false,
        },
        bootstrapDeployForCompensation: {
            id: 'wrangler-bootstrap-web-compensating-deploy',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --keep-vars',
            bin: pnpmCommand(),
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--keep-vars'],
            timeoutMs: 180000,
            writesCloudflare: true,
        },
    };
}

function buildSecretPutCommand(name: string): CommandSpec {
    return {
        id: `wrangler-secret-put-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        display: `pnpm --config.verify-deps-before-run=false exec wrangler secret put ${name} --config wrangler.toml --env production`,
        bin: pnpmCommand(),
        args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'put', name, '--config', 'wrangler.toml', '--env', 'production'],
        timeoutMs: 120000,
        writesCloudflare: true,
    };
}

function buildVersionViewCommand(id: string, versionId: string): CommandSpec {
    return {
        id,
        display: `pnpm --config.verify-deps-before-run=false exec wrangler versions view ${versionId} --name ${target.productionWorker} --json`,
        bin: pnpmCommand(),
        args: [
            '--config.verify-deps-before-run=false',
            'exec',
            'wrangler',
            'versions',
            'view',
            versionId,
            '--name',
            target.productionWorker,
            '--json',
        ],
        timeoutMs: 120000,
        writesCloudflare: false,
    };
}

function buildSecretListCommand(id: string): CommandSpec {
    return {
        id,
        display: 'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production --format json',
        bin: pnpmCommand(),
        args: [
            '--config.verify-deps-before-run=false',
            'exec',
            'wrangler',
            'secret',
            'list',
            '--config',
            'wrangler.toml',
            '--env',
            'production',
            '--format',
            'json',
        ],
        timeoutMs: 120000,
        writesCloudflare: false,
    };
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function forbiddenScopeLines(): string[] {
    return [
        'No domain move.',
        'No DNS change.',
        'No Pages deletion.',
        'No route change.',
        'No custom-domain attachment.',
        'No `CHECKOUT_ENABLED=true`.',
        'No secret value printing or storage in outputs.',
        'No Stripe API write, real checkout session or real payment; Stripe Live is inspected read-only only.',
        'No Supabase, Google, Resend, Sentry, Turnstile or GitHub writes.',
        'No Fulfillment Worker deploy or enable; it must remain in production_bootstrap.',
        'No Google service-account key loading into the Astro web Worker; those names stay on the fulfillment Worker boundary.',
    ];
}

function extractSecretNames(captureText: string): Set<string> {
    const names = new Set<string>();
    const jsonMatch = captureText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as Array<{ name?: string }>;
            for (const item of parsed) {
                if (item.name) names.add(item.name);
            }
        } catch {
            // Fall through to text matching.
        }
    }

    for (const name of requiredSecretNames) {
        if (captureText.includes(name)) names.add(name);
    }
    return names;
}

function secretValueFor(name: string): string | null {
    const value = process.env[name]?.trim();
    if (value) return value;
    if (name === 'EMAIL_FROM') return process.env.RESEND_FROM_EMAIL?.trim() || null;
    if (name === 'RESEND_FROM_EMAIL') return process.env.EMAIL_FROM?.trim() || null;
    return null;
}

function isPlaceholderValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return normalized.includes('replace-me') ||
        normalized.includes('changeme') ||
        normalized.includes('placeholder') ||
        normalized.includes('todo') ||
        normalized === 'your-key-here' ||
        normalized === 'test';
}

function normalizeDirectWorkerUrl(value: string | undefined): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    try {
        const url = new URL(trimmed);
        if (
            url.protocol !== 'https:'
            || url.hostname !== productionDirectWorkerHost
            || url.username
            || url.password
            || url.port
        ) return null;
        url.pathname = '/';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function normalizeOrigin(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function supabaseProjectRef(value: string | null): string | null {
    if (!value) return null;
    try {
        return /^([a-z0-9]+)\.supabase\.co$/iu.exec(new URL(value).hostname)?.[1] ?? null;
    } catch {
        return null;
    }
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function readIfExists(filePath: string): string | null {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function readJsonIfExists<T>(filePath: string | null): T | null {
    if (!filePath || !existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8')) as T;
    } catch {
        return null;
    }
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
    const privateKeyPattern = new RegExp(
        '-----BEGIN [A-Z ]+' + 'PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]+' + 'PRIVATE KEY-----',
        'g'
    );

    let sanitized = value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(privateKeyPattern, '[redacted-private-key]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{20,}/g, 'sk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]{20,}/g, 'whsec_[redacted]')
        .replace(/sb_secret_[A-Za-z0-9_-]{20,}/g, 'sb_secret_[redacted]')
        .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza[redacted]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/g, 're_[redacted]')
        .replace(/(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/giu, '$1://[redacted-user]:[redacted-password]@')
        .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [redacted]');

    const knownValues = new Set([
        ...requiredSecretNames.map((name) => secretValueFor(name)),
        process.env.CLOUDFLARE_API_TOKEN?.trim() || null,
    ]);
    for (const knownValue of knownValues) {
        if (knownValue) {
            sanitized = sanitized.replaceAll(knownValue, '[redacted-known-value]');
        }
    }
    return sanitized;
}

function sanitizeError(error: Error): string {
    return sanitizeOutput(error.message).replace(/\r?\n/g, ' ').slice(0, 500);
}
