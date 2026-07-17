import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';
import { parseMixedJsonOutput, verifyCloudflareWhoamiOutput } from '../ci/verify-cloudflare-identity';
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    openOneShotCloudflareWriteGuard,
    reconcileOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
} from './cloudflare-production-one-shot-write';
import { newestWorkerDeploymentVersionId } from './cloudflare-deployment-order';
import {
    isRetryableCloudflareReadonlyError,
    isRetryableCloudflareReadonlyStatus,
    retryCloudflareReadonlyEvidence,
    type CloudflareReadonlyAttemptResult,
    type CloudflareReadonlyRetryResult,
} from './cloudflare-readonly-retry';
import {
    buildCloudflareProductionInertCompositeEvidence,
    readCloudflareProductionInertCompositeEvidence,
    type CloudflareProductionInertEvidenceValidation,
} from './cloudflare-production-inert-composite-evidence';
import {
    runCloudflareWranglerFromKeyring,
    withCloudflareWranglerOAuth,
} from './cloudflare-wrangler-oauth';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CommandSpec {
    id: string;
    display: string;
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
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    closureStatus: 'PLAN_ONLY_READY' | 'EXECUTED_AND_ATTESTED' | 'RECONCILED_STOP' | 'BLOCKED_BY_GATE_OR_EVIDENCE';
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: boolean | 'unknown';
    target: typeof target;
    requiredSecretNames: readonly string[];
    explicitlyWithheldSecretNames: readonly string[];
    latestPhaseOneCompositeEvidencePath: string | null;
    checks: Check[];
    captures: CommandCapture[];
    outputDir: string;
    summaryPath: string;
    approvalGatePath: string;
    executionPlanPath: string;
    compositeEvidencePath: string;
}

const target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    worker: 'espanolhonesto',
    environment: 'production_bootstrap',
    directUrl: 'https://espanolhonesto.alindev95.workers.dev',
    supabaseRef: 'vkkahxsybhbutszerawz',
    fulfillmentUrl: 'https://espanol-honesto-fulfillment-production.alindev95.workers.dev',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
} as const;

const approvalEnvVar = 'CLOUDFLARE_WORKER_BOOTSTRAP_SECRETS_APPROVAL';
const envFileEnvVar = 'CLOUDFLARE_WORKER_BOOTSTRAP_ENV_FILE';
const exactApprovalSentence = 'Apruebo cargar/verificar unicamente `INTERNAL_JOB_SECRET` en el entorno Cloudflare `production_bootstrap` del Worker web `espanolhonesto`, cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, solo para autenticar y firmar la atestacion HMAC, manteniendo todas las rutas de aplicacion en 503, checkout y email desactivados, y atestiguando `WEB_RUNTIME_MODE=bootstrap` con Supabase URL, anon y service role, Stripe, Resend, Turnstile, cron y level-check ausentes, sin tocar fulfillment, dominios, DNS ni Pages.';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar] === exactApprovalSentence;

const requiredSecretNames = [
    // Required only because the authenticated HMAC attestation endpoint must
    // prove the deployed version/configuration. It is not an app-operation key.
    'INTERNAL_JOB_SECRET',
] as const;

const explicitlyWithheldSecretNames = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_SENTRY_DSN',
    'SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
] as const;

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-worker-bootstrap-secrets', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const compositeEvidencePath = path.join(outputDir, 'production-inert-web-fulfillment-evidence.json');

const latestPhaseOneCompositeEvidencePath = latestGeneratedPath(
    'launch-cloudflare-production-worker-phase1',
    'production-inert-web-fulfillment-evidence.json',
);
const commands = buildCommands();
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
let externalWritePerformedState: boolean | 'unknown' = false;
let attestedWebVersionId: string | null = null;
let acceptedPhaseOneEvidenceSha256: string | null = null;

const checks: Check[] = [
    validatePackageAndSource(),
    validateWranglerBootstrap(),
    validateRuntimeInertnessSource(),
    validateFinalRouteSeparation(),
    validateLatestPhaseOneEvidence(),
];

await main();

async function main(): Promise<void> {
    if (executeRequested && checks.some((check) => check.status === 'failed')) {
        checks.push({
            status: 'failed',
            name: 'initial_validation_gate',
            message: 'Local bootstrap validation failed; no Cloudflare command can run.',
            details: ['externalWriteAttempted=false'],
        });
    } else if (executeRequested && !approvalMatched) {
        checks.push({
            status: 'failed',
            name: 'exact_approval_gate',
            message: 'Execution was requested without the exact bootstrap-secret approval sentence.',
            details: [`env=${approvalEnvVar}`, 'externalWriteAttempted=false'],
        });
    } else if (executeRequested) {
        dotenv.config({
            path: process.env[envFileEnvVar]?.trim() || '.env.production',
            override: false,
            quiet: true,
        });
        const inputCheck = validateExecutionInputs();
        checks.push(inputCheck);
        if (inputCheck.status === 'ok') {
            try {
                await withCloudflareWranglerOAuth({
                    accountId: target.accountId,
                    consume: async () => {
                        checks.push(...await runApprovedExecution());
                    },
                });
            } catch {
                checks.push({
                    status: 'failed',
                    name: 'cloudflare_oauth_keyring_gate',
                    message: 'The encrypted Wrangler OAuth session could not run the approved bootstrap-secret operation.',
                    details: ['credentialSource=wrangler_keyring', 'externalWriteState=unchanged_or_checkpointed'],
                });
            }
        }
    } else {
        checks.push({
            status: 'ok',
            name: 'plan_mode_no_external_write',
            message: 'Plan mode generated the minimal bootstrap-secret gate without calling Cloudflare.',
            details: ['executeRequested=false', 'externalWriteAttempted=false', `futureGate=${approvalEnvVar}`],
        });
    }

    const closureMayEmitEvidence = executeRequested && !checks.some((check) => check.status === 'failed');
    const finalUpstreamValidation = latestPhaseOneEvidenceValidation(new Date());
    const finalUpstreamStable = finalUpstreamValidation.valid
        && Boolean(finalUpstreamValidation.sha256)
        && finalUpstreamValidation.sha256 === acceptedPhaseOneEvidenceSha256;
    if (closureMayEmitEvidence) {
        checks.push(attestedWebVersionId && finalUpstreamStable && finalUpstreamValidation.value
            ? {
                status: 'ok',
                name: 'production_inert_composite_evidence_inputs',
                message: 'Fresh structured phase-1 evidence and the exact HMAC-attested web version are ready for final composite closure.',
                details: [
                    `webVersionId=${attestedWebVersionId}`,
                    `fulfillmentVersionId=${finalUpstreamValidation.value.fulfillment.versionId}`,
                    `sourceCompositeSha256=${finalUpstreamValidation.sha256}`,
                ],
            }
            : {
                status: 'failed',
                name: 'production_inert_composite_evidence_inputs',
                message: 'Web bootstrap-secret closure lacks a fresh exact web+fulfillment version binding.',
                details: [
                    `webVersionId=${attestedWebVersionId ?? 'missing'}`,
                    `upstreamValid=${String(finalUpstreamValidation.valid)}`,
                    `upstreamHashStable=${String(finalUpstreamStable)}`,
                    ...finalUpstreamValidation.errors.map((error) => `upstreamError=${error}`),
                ],
            });
    }

    let report = createReport();
    let rendered = renderArtifacts(report);
    persistArtifacts(report, rendered);
    if (report.status === 'OK'
        && ['EXECUTED_AND_ATTESTED', 'RECONCILED_STOP'].includes(report.closureStatus)
        && attestedWebVersionId
        && latestPhaseOneCompositeEvidencePath
        && finalUpstreamStable
        && finalUpstreamValidation.value) {
        try {
            const evidence = buildCloudflareProductionInertCompositeEvidence({
                stage: 'web_hmac_closed',
                generatedAt: report.endedAt,
                webVersionId: attestedWebVersionId,
                fulfillmentVersionId: finalUpstreamValidation.value.fulfillment.versionId,
                sourceSummaryPath: path.join(outputDir, 'summary.json'),
                upstreamEvidencePath: latestPhaseOneCompositeEvidencePath,
            });
            writeFileSync(compositeEvidencePath, JSON.stringify(evidence, null, 2), 'utf8');
        } catch (error) {
            rmSync(compositeEvidencePath, { force: true });
            checks.push({
                status: 'failed',
                name: 'production_inert_composite_evidence_persistence',
                message: 'Final web+fulfillment evidence could not be built and persisted; closure is fail-closed.',
                details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
            });
            report = createReport();
            rendered = renderArtifacts(report);
            persistArtifacts(report, rendered);
        }
    }

    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Status: ${report.status}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Closure: ${report.closureStatus}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] External write attempted: ${report.externalWriteAttempted}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Summary: ${report.summaryPath}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Approval gate: ${report.approvalGatePath}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Composite evidence: ${report.compositeEvidencePath}`);

    if (report.status === 'FAILED') process.exit(1);
}

function createReport(): Report {
    const status = statusFor(checks);
    const reconciliationCompleted = checks.some((check) =>
        check.name === 'bootstrap_hmac_readonly_reconciliation' && check.status === 'ok');
    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        closureStatus: status === 'FAILED'
            ? 'BLOCKED_BY_GATE_OR_EVIDENCE'
            : reconciliationCompleted
                ? 'RECONCILED_STOP'
            : executeRequested
                ? 'EXECUTED_AND_ATTESTED'
                : 'PLAN_ONLY_READY',
        executeRequested,
        approvalMatched,
        externalWriteAttempted,
        externalWritePerformed: externalWritePerformedState,
        target,
        requiredSecretNames,
        explicitlyWithheldSecretNames,
        latestPhaseOneCompositeEvidencePath,
        checks,
        captures,
        outputDir,
        summaryPath: path.join(outputDir, 'summary.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        executionPlanPath: path.join(outputDir, 'execution-plan.md'),
        compositeEvidencePath,
    };
}

function persistArtifacts(report: Report, rendered: ReturnType<typeof renderArtifacts>): void {
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');
    writeFileSync(report.approvalGatePath, rendered.approvalGate, 'utf8');
    writeFileSync(report.executionPlanPath, rendered.executionPlan, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
}

function validatePackageAndSource(): Check {
    const packageJson = readIfExists('package.json') ?? '';
    const source = readIfExists(path.join('scripts', 'launch', 'cloudflare-production-worker-bootstrap-secrets.ts')) ?? '';
    const required = [
        '"launch:cloudflare-production-worker-bootstrap-secrets": "tsx scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts"',
        approvalEnvVar,
        '--execute-approved',
        'initial_validation_gate',
        'externalWriteAttempted = true',
        '--env production_bootstrap',
        'direct_web_bootstrap_hmac_attestation',
    ];
    const missing = required.filter((snippet) => !(packageJson + source).includes(snippet));
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'bootstrap_secret_runner_source',
        message: missing.length === 0
            ? 'The pnpm command, exact approval gate, production_bootstrap target and HMAC proof are encoded in source.'
            : 'The bootstrap-secret runner is missing required source-level safeguards.',
        details: missing.length === 0 ? ['packageManager=pnpm@10.33.0'] : missing.map((item) => `missing=${item}`),
    };
}

function validateWranglerBootstrap(): Check {
    const wrangler = readIfExists('wrangler.toml') ?? '';
    const start = wrangler.indexOf('[env.production_bootstrap]');
    const end = wrangler.indexOf('[env.production]');
    const bootstrap = start >= 0 && end > start ? wrangler.slice(start, end) : '';
    const required = [
        'name = "espanolhonesto"',
        'WEB_RUNTIME_MODE = "bootstrap"',
        'SUPABASE_EXPECTED_PROJECT_REF = "vkkahxsybhbutszerawz"',
        'CHECKOUT_ENABLED = "false"',
        'CHECKOUT_ENABLED_OVERRIDE = "false"',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
        'service = "espanol-honesto-fulfillment-production"',
        '[env.production_bootstrap.assets]',
        'run_worker_first = true',
    ];
    const missing = required.filter((snippet) => !bootstrap.includes(snippet));
    for (const name of explicitlyWithheldSecretNames) {
        if (bootstrap.includes(name)) missing.push(`forbidden=${name}`);
    }
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'wrangler_production_bootstrap',
        message: missing.length === 0
            ? 'Wrangler production_bootstrap is exact-name, inert and free of active-provider bindings.'
            : 'Wrangler production_bootstrap is missing inert config or contains a withheld provider binding.',
        details: missing.length === 0 ? ['runtime=bootstrap', 'checkout=false', 'email=disabled/0'] : missing,
    };
}

function validateRuntimeInertnessSource(): Check {
    const middleware = readIfExists(path.join('src', 'middleware.ts')) ?? '';
    const health = readIfExists(path.join('src', 'pages', 'health.ts')) ?? '';
    const attestation = readIfExists(path.join('src', 'lib', 'runtime-attestation.ts')) ?? '';
    const route = readIfExists(path.join('src', 'pages', 'api', 'internal', 'runtime-attestation.ts')) ?? '';
    const build = readIfExists(path.join('scripts', 'dev', 'build-production-bootstrap.ts')) ?? '';
    const required = [
        [build, "const ALLOWED_PATHS = new Set(['/health', '/api/internal/runtime-attestation'])"],
        [build, "config.main = wrapperName"],
        [build, 'assets.run_worker_first=true'],
        [build, 'validateBootstrapBundle(distRoot, sourceCredentialValues)'],
        [middleware, "'/health'"],
        [middleware, "'/api/internal/runtime-attestation'"],
        [middleware, "'WEB_RUNTIME_BOOTSTRAP'"],
        [middleware, 'status: 503'],
        [health, "runtimeMode === 'bootstrap' || runtimeMode === 'active'"],
        [attestation, 'const stripeConfigured = webRole && ['],
        [attestation, '].some((key) => Boolean(value(env, key)))'],
        [attestation, 'webRuntimeMode'],
        [route, "'WEB_RUNTIME_MODE'"],
    ] as const;
    const missing = required.filter(([source, snippet]) => !source.includes(snippet)).map(([, snippet]) => snippet);
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'bootstrap_runtime_inertness_source',
        message: missing.length === 0
            ? 'Middleware blocks app routes while health and authenticated HMAC attestation distinguish bootstrap from active.'
            : 'Runtime source does not fully prove bootstrap route blocking and mode-bound attestation.',
        details: missing.length === 0 ? ['appRoutes=503', 'diagnostics=/health + HMAC attestation'] : missing.map((item) => `missing=${item}`),
    };
}

function validateFinalRouteSeparation(): Check {
    const packageJson = readIfExists('package.json') ?? '';
    const finalBuild = readIfExists(path.join('scripts', 'dev', 'build-production-release.ts')) ?? '';
    const finalSecrets = readIfExists(path.join('scripts', 'launch', 'cloudflare-production-worker-secrets.ts')) ?? '';
    const required = [
        '"build:production:release": "tsx scripts/dev/build-production-release.ts"',
        '"launch:cloudflare-production-worker-secrets": "tsx scripts/launch/cloudflare-production-worker-secrets.ts"',
    ];
    const missing = required.filter((snippet) => !packageJson.includes(snippet));
    if (!finalBuild.includes("process.env.WEB_RUNTIME_MODE = 'active'")) missing.push('active production build remains distinct');
    if (!finalSecrets.includes('fresh_stripe_live_readiness_pre_write_gate')) missing.push('final Stripe Live gate remains distinct');
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'final_live_route_preserved',
        message: missing.length === 0
            ? 'The existing active build and Stripe Live secret runner remain final-only and are not called here.'
            : 'The final active/legal/Stripe Live route is not clearly preserved.',
        details: missing.length === 0 ? ['bootstrapDoesNotRequireLegalOrStripeLive=true', 'activeStillRequiresLegalAndStripeLive=true'] : missing,
    };
}

function validateLatestPhaseOneEvidence(): Check {
    const validation = latestPhaseOneEvidenceValidation(new Date());
    const correctStage = validation.valid && validation.value?.stage === 'phase1_web_deployed';
    const valid = correctStage && Boolean(validation.sha256);
    if (valid) acceptedPhaseOneEvidenceSha256 = validation.sha256;
    return {
        status: valid ? 'ok' : executeRequested ? 'failed' : 'warning',
        name: 'phase1_web_fulfillment_composite_before_secrets',
        message: valid
            ? 'Fresh structured phase-1 evidence binds the exact inert web deployment to its directly attested fulfillment version.'
            : executeRequested
                ? 'Fresh version-bound phase-1 web+fulfillment evidence is required before any secret write.'
                : 'Phase-1 composite evidence is absent or stale; plan mode remains non-writing.',
        details: valid && validation.value
            ? [
                `evidence=${latestPhaseOneCompositeEvidencePath}`,
                `sourceCompositeSha256=${validation.sha256}`,
                `webVersionId=${validation.value.web.versionId}`,
                `fulfillmentVersionId=${validation.value.fulfillment.versionId}`,
                'maxAgeMs=300000',
                'sequence=Cloudflare C-D-E immediately before launch:status',
            ]
            : [
                `evidence=${latestPhaseOneCompositeEvidencePath ?? 'missing'}`,
                `stage=${validation.value?.stage ?? 'missing'}`,
                ...validation.errors.map((error) => `error=${error}`),
            ],
    };
}

function latestPhaseOneEvidenceValidation(now: Date): CloudflareProductionInertEvidenceValidation {
    if (!latestPhaseOneCompositeEvidencePath) {
        return {
            valid: false,
            errors: ['Phase-1 composite evidence is missing.'],
            value: null,
            sha256: null,
        };
    }
    return readCloudflareProductionInertCompositeEvidence(latestPhaseOneCompositeEvidencePath, { now });
}

function validateExecutionInputs(): Check {
    const missing: string[] = [];
    if (process.env.CLOUDFLARE_ACCOUNT_ID?.trim() !== target.accountId) missing.push(`CLOUDFLARE_ACCOUNT_ID=${target.accountId}`);
    for (const name of requiredSecretNames) {
        const value = process.env[name]?.trim();
        if (!value || isPlaceholderValue(value)) missing.push(name);
    }
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'bootstrap_secret_execution_inputs',
        message: missing.length === 0
            ? 'Secure inputs identify the exact Cloudflare account and the single HMAC-only bootstrap secret.'
            : 'The Cloudflare account or HMAC-only bootstrap secret is missing or invalid.',
        details: missing.length === 0
            ? [`account=${target.accountId}`, `secretCount=${requiredSecretNames.length}`, 'SupabaseRuntimeCredentials=withheld']
            : missing.map((item) => `missingOrInvalid=${item}`),
    };
}

async function runApprovedExecution(): Promise<Check[]> {
    const executionChecks: Check[] = [{
        status: 'ok',
        name: 'exact_approval_gate',
        message: 'Exact bootstrap-secret approval matched; only the minimal production_bootstrap sequence may run.',
        details: [`env=${approvalEnvVar}`, `worker=${target.worker}`, `environment=${target.environment}`],
    }];

    for (const command of [commands.whoami, commands.deploymentsBefore, commands.secretsBefore]) {
        const capture = runCommand(command);
        captures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') return executionChecks;
    }

    const targetCheck = validateRemoteTarget(captures);
    executionChecks.push(targetCheck);
    if (targetCheck.status === 'failed') return executionChecks;

    const preSecretShape = validateRemoteSecretShape(captures.at(-1), false);
    executionChecks.push(preSecretShape);
    if (preSecretShape.status === 'failed') return executionChecks;

    const preWriteProbes = await probeBootstrapRoutes('pre_write');
    executionChecks.push(...preWriteProbes);
    if (preWriteProbes.some((check) => check.status === 'failed')) return executionChecks;

    const immediatePhaseOne = latestPhaseOneEvidenceValidation(new Date());
    const immediatePhaseOneValid = immediatePhaseOne.valid
        && immediatePhaseOne.value?.stage === 'phase1_web_deployed'
        && Boolean(immediatePhaseOne.sha256)
        && immediatePhaseOne.sha256 === acceptedPhaseOneEvidenceSha256;
    executionChecks.push({
        status: immediatePhaseOneValid ? 'ok' : 'failed',
        name: 'phase1_composite_immediately_before_secret_write',
        message: immediatePhaseOneValid
            ? 'The five-minute phase-1 web+fulfillment receipt was revalidated immediately before the one-shot HMAC path.'
            : 'The phase-1 receipt is missing, stale or invalid immediately before the one-shot HMAC path; no write may start.',
        details: immediatePhaseOneValid && immediatePhaseOne.value
            ? [
                `sourceCompositeSha256=${immediatePhaseOne.sha256}`,
                'sourceCompositeHashStable=true',
                `webVersionId=${immediatePhaseOne.value.web.versionId}`,
                `fulfillmentVersionId=${immediatePhaseOne.value.fulfillment.versionId}`,
                'maxAgeMs=300000',
            ]
            : [
                `sourceCompositeHashStable=${String(immediatePhaseOne.sha256 === acceptedPhaseOneEvidenceSha256)}`,
                ...immediatePhaseOne.errors.map((error) => `error=${error}`),
            ],
    });
    if (!immediatePhaseOneValid) return executionChecks;

    const reconciliation = await reconcileOneShotCloudflareWriteGuard(
        'web-bootstrap-hmac-secret',
        outputDir,
        {
            readback: async (checkpoint) => {
                if (checkpoint && checkpoint.commandId !== 'web-bootstrap-secret-put-internal-job-secret') return false;
                const versionCapture = captures.find((capture) => capture.id === commands.deploymentsBefore.id);
                const versionId = versionCapture ? deploymentVersionId(versionCapture) : null;
                if (!versionId) return false;
                const readback = await retryWebBootstrapSecretEvidence(versionId, false, 'reconciliation', executionChecks);
                if (readback.state === 'proven') attestedWebVersionId = readback.value;
                return readback.state === 'proven';
            },
        },
    );
    if (reconciliation.status !== 'not_needed') {
        executionChecks.push(reconciliation.status === 'reconciled'
            ? {
                status: 'ok',
                name: 'bootstrap_hmac_readonly_reconciliation',
                message: 'Fresh secret-name and version-bound HMAC readbacks proved the interrupted web secret write; checkpoint and stale lock were cleared without repeating secret put.',
                details: [`checkpointCount=${reconciliation.checkpointCount}`, `lockOnly=${String(reconciliation.lockOnly)}`, 'secretPutRetried=false'],
            }
            : {
                status: 'failed',
                name: 'bootstrap_hmac_readonly_reconciliation',
                message: 'Fresh readbacks did not prove the interrupted web HMAC write; checkpoint/lock remain fail-closed and secret put was not retried.',
                details: [`reason=${reconciliation.reason}`, 'secretPutRetried=false'],
            });
        return executionChecks;
    }

    let writeGuard: ReturnType<typeof openOneShotCloudflareWriteGuard>;
    try {
        writeGuard = openOneShotCloudflareWriteGuard('web-bootstrap-hmac-secret', outputDir);
    } catch (error) {
        executionChecks.push({
            status: 'failed',
            name: 'bootstrap_hmac_write_lock',
            message: 'An unresolved HMAC write or lock blocks retry until read-only reconciliation.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error))), 'externalWriteAttempted=false'],
        });
        return executionChecks;
    }
    const name = requiredSecretNames[0];
    const value = process.env[name]?.trim() ?? '';
    const secretCommand = buildSecretPutCommand(name);
    let writeCheckpoint = beginOneShotCloudflareWrite(writeGuard, secretCommand.id);
    externalWriteAttempted = true;
    externalWritePerformedState = 'unknown';
    const secretCapture = runCommand(secretCommand, `${value}\n`);
    writeCheckpoint = recordOneShotCloudflareProviderResult(writeGuard, writeCheckpoint, {
        exitCode: secretCapture.exitCode,
        timedOut: secretCapture.exitCode === null,
        errorPresent: secretCapture.status === 'failed',
    });
    captures.push(secretCapture);
    executionChecks.push(checkForCapture(secretCapture));
    if (secretCapture.status === 'failed') return executionChecks;

    const prewriteVersionCapture = captures.find((capture) => capture.id === commands.deploymentsBefore.id);
    const prewriteVersionId = prewriteVersionCapture ? deploymentVersionId(prewriteVersionCapture) : null;
    if (!prewriteVersionId) {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        executionChecks.push({
            status: 'failed',
            name: 'post_write_prewrite_version',
            message: 'The pre-secret Worker version is unavailable; version change cannot be proven.',
            details: ['versionId=missing'],
        });
        return executionChecks;
    }
    const postWriteReadback = await retryWebBootstrapSecretEvidence(
        prewriteVersionId,
        true,
        'post-write',
        executionChecks,
    );
    const postWriteProven = postWriteReadback.state === 'proven';
    writeCheckpoint = recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, postWriteProven);
    if (!postWriteProven) return executionChecks;
    attestedWebVersionId = postWriteReadback.value;
    closeOneShotCloudflareWriteGuard(writeGuard);
    externalWritePerformedState = true;
    executionChecks.push({
        status: 'ok',
        name: 'bootstrap_hmac_write_checkpoint_resolved',
        message: 'The exact HMAC-only secret write is proven remotely and its durable checkpoint is resolved.',
        details: [`checkpointStage=${writeCheckpoint.stage}`],
    });
    return executionChecks;
}

async function retryWebBootstrapSecretEvidence(
    referenceVersionId: string,
    requireChangedVersion: boolean,
    phase: 'reconciliation' | 'post-write',
    executionChecks: Check[],
): Promise<CloudflareReadonlyRetryResult<string>> {
    let latestChecks: Check[] = [];
    const result = await retryCloudflareReadonlyEvidence({
        operation: 'attestation',
        read: async ({ attempt }) => {
            const attemptChecks: Check[] = [];
            latestChecks = attemptChecks;
            const suffix = `${phase}-attempt-${attempt}`;
            const secretCapture = runCommand({ ...commands.secretsAfter, id: `web-secrets-${suffix}` });
            captures.push(secretCapture);
            if (secretCapture.status === 'failed') {
                attemptChecks.push(checkForCapture(secretCapture));
                return readonlyCaptureFailure(secretCapture, 'Web secret-name readback failed.');
            }
            const parsedSecrets = extractSecretNames(readIfExists(secretCapture.path) ?? '');
            const requiredSet = new Set<string>(requiredSecretNames);
            const unexpected = [...parsedSecrets.names].filter((name) => !requiredSet.has(name));
            if (!parsedSecrets.parsed || unexpected.length > 0) {
                attemptChecks.push(validateRemoteSecretShape(secretCapture, true));
                return { state: 'definitive_failure', reason: 'Web secret inventory is malformed or unexpected.' } as const;
            }
            if (!parsedSecrets.names.has('INTERNAL_JOB_SECRET')) {
                attemptChecks.push(validateRemoteSecretShape(secretCapture, true));
                return { state: 'retryable', reason: 'Web INTERNAL_JOB_SECRET is not visible yet.' } as const;
            }
            attemptChecks.push(validateRemoteSecretShape(secretCapture, true));

            const deploymentCapture = runCommand({ ...commands.deploymentsAfter, id: `web-deployments-${suffix}` });
            captures.push(deploymentCapture);
            if (deploymentCapture.status === 'failed') {
                attemptChecks.push(checkForCapture(deploymentCapture));
                return readonlyCaptureFailure(deploymentCapture, 'Web deployment readback failed.');
            }
            const versionId = deploymentVersionId(deploymentCapture);
            if (!versionId) {
                attemptChecks.push({ status: 'failed', name: 'post_write_deployment_version', message: 'Web deployment readback is malformed.', details: [] });
                return { state: 'definitive_failure', reason: 'Web deployment readback is malformed.' } as const;
            }
            if (requireChangedVersion && versionId === referenceVersionId) {
                attemptChecks.push({
                    status: 'failed',
                    name: 'post_write_deployment_version',
                    message: 'Cloudflare still reports the pre-secret web version.',
                    details: [`version=${versionId}`, 'readonlyOutcome=retryable'],
                });
                return { state: 'retryable', reason: 'Cloudflare still reports the pre-secret web version.' } as const;
            }

            const routeChecks = await probeBootstrapRoutes('post_write');
            const attestation = await attestBootstrap(versionId);
            attemptChecks.push(...routeChecks, attestation);
            const failure = classifyReadonlyChecks([...routeChecks, attestation]);
            return failure ?? { state: 'proven', value: versionId } as const;
        },
    });
    executionChecks.push(...latestChecks);
    executionChecks.push(result.state === 'proven'
        ? {
            status: 'ok', name: 'web_bootstrap_hmac_bounded_readback',
            message: 'Bounded readbacks proved the exact HMAC-only inert web bootstrap.',
            details: [
                `versionId=${result.value}`,
                `attempts=${result.attempts}`,
                `delaysMs=${result.delaysMs.join(',') || 'none'}`,
                'secretPutRetried=false',
            ],
        }
        : {
            status: 'failed', name: 'web_bootstrap_hmac_bounded_readback',
            message: 'Bounded readbacks did not prove the exact HMAC-only inert web bootstrap.',
            details: [`state=${result.state}`, `attempts=${result.attempts}`, `reason=${result.reason}`, 'secretPutRetried=false'],
        });
    return result;
}

function validateRemoteTarget(reportCaptures: CommandCapture[]): Check {
    const whoami = readIfExists(reportCaptures.find((capture) => capture.id === commands.whoami.id)?.path ?? '') ?? '';
    const deployments = reportCaptures.find((capture) => capture.id === commands.deploymentsBefore.id);
    let accountMatched = false;
    let identityError = 'none';
    try {
        verifyCloudflareWhoamiOutput(whoami, target.accountId);
        accountMatched = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() === target.accountId;
    } catch (error) {
        identityError = sanitizeError(error instanceof Error ? error : new Error(String(error)));
    }
    const versionPresent = Boolean(deployments && deploymentVersionId(deployments));
    return {
        status: accountMatched && versionPresent ? 'ok' : 'failed',
        name: 'remote_target_pre_write_gate',
        message: accountMatched && versionPresent
            ? 'Fresh read-only Wrangler evidence proves the exact account, Worker and an existing deployed bootstrap version.'
            : 'Fresh read-only Wrangler evidence did not prove the exact target before secret writes.',
        details: [`accountMatched=${String(accountMatched)}`, `deploymentVersionPresent=${String(versionPresent)}`, `identityError=${identityError}`],
    };
}

function validateRemoteSecretShape(capture: CommandCapture | undefined, requireMinimal: boolean): Check {
    const parsed = extractSecretNames(capture ? readIfExists(capture.path) ?? '' : '');
    const requiredSet = new Set<string>(requiredSecretNames);
    const missing = requireMinimal ? requiredSecretNames.filter((name) => !parsed.names.has(name)) : [];
    const forbidden = explicitlyWithheldSecretNames.filter((name) => parsed.names.has(name));
    const unexpected = [...parsed.names].filter((name) => !requiredSet.has(name));
    const safe = parsed.parsed && missing.length === 0 && forbidden.length === 0 && unexpected.length === 0;
    return {
        status: safe ? 'ok' : 'failed',
        name: requireMinimal ? 'minimal_bootstrap_secret_shape_after_write' : 'minimal_bootstrap_secret_shape_before_write',
        message: safe
            ? requireMinimal
                ? 'Remote secret list contains exactly the single HMAC-only bootstrap name.'
                : 'Remote secret list contains no name outside the minimal bootstrap allowlist.'
            : 'Remote secret list is unparseable, incomplete or contains a withheld/unexpected name.',
        details: [
            `parsed=${String(parsed.parsed)}`,
            `secretCount=${parsed.names.size}`,
            `missing=${missing.join(',') || 'none'}`,
            `forbidden=${forbidden.join(',') || 'none'}`,
            `unexpected=${unexpected.join(',') || 'none'}`,
        ],
    };
}

async function probeBootstrapRoutes(phase: 'pre_write' | 'post_write'): Promise<Check[]> {
    const results: Check[] = [];
    let httpStatus: number | null = null;
    try {
        const healthResponse = await fetch(`${target.directUrl}/health`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
        });
        httpStatus = healthResponse.status;
        const health = await healthResponse.json() as Record<string, unknown>;
        const healthy = healthResponse.status === 200
            && health.appEnvironment === 'production'
            && health.runtimeMode === 'bootstrap'
            && health.workerIdentity === target.worker
            && health.checkoutEnabled === false;
        results.push({
            status: healthy ? 'ok' : 'failed',
            name: `web_bootstrap_health_${phase}`,
            message: 'Direct health must prove the exact production bootstrap identity with checkout disabled.',
            details: [
                `httpStatus=${healthResponse.status}`,
                `runtimeMode=${String(health.runtimeMode ?? 'missing')}`,
                ...(healthy ? [] : [`readonlyOutcome=${isRetryableCloudflareReadonlyStatus(healthResponse.status) ? 'retryable' : 'definitive_failure'}`]),
            ],
        });

        const routes: Array<{ path: string; method: 'GET' | 'POST' }> = [
            { path: '/', method: 'GET' },
            { path: '/es', method: 'GET' },
            { path: '/es/campus', method: 'GET' },
            { path: '/robots.txt', method: 'GET' },
            { path: '/vite.svg', method: 'GET' },
            { path: '/favicon.png', method: 'GET' },
            { path: '/sitemap-index.xml', method: 'GET' },
            { path: bootstrapAssetProbePath(), method: 'GET' },
            { path: '/api/checkout', method: 'POST' },
        ];
        for (const route of routes) {
            const response = await fetch(`${target.directUrl}${route.path}`, {
                method: route.method,
                headers: route.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
                body: route.method === 'POST' ? '{}' : undefined,
                redirect: 'manual',
                signal: AbortSignal.timeout(20_000),
            });
            httpStatus = response.status;
            let errorCode = 'invalid-body';
            try {
                errorCode = String((await response.json() as { errorCode?: unknown }).errorCode ?? 'missing');
            } catch {
                // Store only the non-secret classification.
            }
            const headersAreInert = response.headers.get('Cache-Control') === 'no-store'
                && (response.headers.get('X-Robots-Tag') ?? '').includes('noindex');
            results.push({
                status: response.status === 503 && errorCode === 'WEB_RUNTIME_BOOTSTRAP' && headersAreInert ? 'ok' : 'failed',
                name: `web_bootstrap_route_503_${phase}_${route.method.toLowerCase()}_${route.path.replace(/[^a-z0-9]+/giu, '_') || 'root'}`,
                message: 'All representative application route classes must remain 503 while bootstrap is inert.',
                details: [
                    `route=${route.method} ${route.path}`,
                    `httpStatus=${response.status}`,
                    `errorCode=${errorCode}`,
                    `inertHeaders=${String(headersAreInert)}`,
                    ...(response.status === 503 && errorCode === 'WEB_RUNTIME_BOOTSTRAP' && headersAreInert
                        ? []
                        : [`readonlyOutcome=${response.status !== 503 && isRetryableCloudflareReadonlyStatus(response.status) ? 'retryable' : 'definitive_failure'}`]),
                ],
            });
        }

        const attestationGet = await fetch(`${target.directUrl}/api/internal/runtime-attestation`, {
            method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        });
        httpStatus = attestationGet.status;
        results.push({
            status: attestationGet.status === 404 ? 'ok' : 'failed',
            name: `web_bootstrap_attestation_get_hidden_${phase}`,
            message: 'The allowed diagnostic attestation path must expose only authenticated POST; GET remains 404.',
            details: [
                `httpStatus=${attestationGet.status}`,
                ...(attestationGet.status === 404 ? [] : [`readonlyOutcome=${isRetryableCloudflareReadonlyStatus(attestationGet.status) ? 'retryable' : 'definitive_failure'}`]),
            ],
        });
    } catch (error) {
        results.push({
            status: 'failed',
            name: `web_bootstrap_route_probe_${phase}`,
            message: 'Direct bootstrap route probes failed or timed out.',
            details: [
                sanitizeError(error instanceof Error ? error : new Error(String(error))),
                `readonlyOutcome=${readonlyErrorIsRetryable(error, httpStatus) ? 'retryable' : 'definitive_failure'}`,
            ],
        });
    }
    return results;
}

function bootstrapAssetProbePath(): string {
    const assetRoot = path.join(process.cwd(), 'dist', 'client', '_astro');
    if (!existsSync(assetRoot)) return '/_astro/bootstrap-probe.js';
    const firstAsset = readdirSync(assetRoot, { withFileTypes: true })
        .find((entry) => entry.isFile());
    return firstAsset ? `/_astro/${encodeURIComponent(firstAsset.name)}` : '/_astro/bootstrap-probe.js';
}

async function attestBootstrap(expectedVersionId: string): Promise<Check> {
    const nonce = randomUUID();
    let httpStatus: number | null = null;
    let verified = false;
    let identity = 'missing';
    let version = 'missing';
    try {
        const response = await fetch(`${target.directUrl}/api/internal/runtime-attestation`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.INTERNAL_JOB_SECRET ?? ''}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nonce }),
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
        });
        httpStatus = response.status;
        if (isRetryableCloudflareReadonlyStatus(response.status, [401])) {
            return {
                status: 'failed', name: 'direct_web_bootstrap_hmac_attestation',
                message: 'Web runtime attestation has not propagated yet.',
                details: [`httpStatus=${response.status}`, 'readonlyOutcome=retryable'],
            };
        }
        if (response.status !== 200) {
            return {
                status: 'failed', name: 'direct_web_bootstrap_hmac_attestation',
                message: 'Web runtime attestation returned a definitive HTTP failure.',
                details: [`httpStatus=${response.status}`, 'readonlyOutcome=definitive_failure'],
            };
        }
        const envelope = await response.json() as RuntimeAttestationEnvelope;
        identity = envelope.workerIdentity ?? 'missing';
        version = envelope.workerVersionId ?? 'missing';
        const observedVersionId = typeof envelope.workerVersionId === 'string' ? envelope.workerVersionId : '';
        const config = await buildRuntimeAttestationConfig('web', {
            INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
            SUPABASE_EXPECTED_PROJECT_REF: target.supabaseRef,
            WORKER_IDENTITY: target.worker,
            WORKER_VERSION_ID: observedVersionId,
            FULFILLMENT_WORKER_URL: target.fulfillmentUrl,
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            EMAIL_DELIVERY_MODE: 'disabled',
            EMAIL_DAILY_RECIPIENT_LIMIT: '0',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
        });
        const providersAbsent = config.webRuntimeMode === 'bootstrap'
            && config.stripeBoundary === 'absent'
            && config.stripeSecretKeyFingerprint === 'absent'
            && config.stripePublishableKeyFingerprint === 'absent'
            && config.stripeWebhookSecretFingerprint === 'absent'
            && config.resendApiKeyFingerprint === 'absent'
            && config.resendSenderFingerprint === 'absent'
            && config.supabaseUrlFingerprint === 'absent'
            && config.supabaseAnonFingerprint === 'absent'
            && config.supabaseServiceRoleFingerprint === 'absent'
            && config.turnstileSiteKeyFingerprint === 'absent'
            && config.turnstileSecretFingerprint === 'absent'
            && config.cronSecretFingerprint === 'absent'
            && config.levelCheckSecretFingerprint === 'absent';
        const cryptographicallyVerified = envelope.workerIdentity === target.worker
            && providersAbsent
            && await verifyRuntimeAttestation(envelope, {
                config,
                nonce,
                role: 'web',
                schema: RUNTIME_ATTESTATION_SCHEMA,
            }, process.env.INTERNAL_JOB_SECRET ?? '');
        if (!cryptographicallyVerified) {
            return {
                status: 'failed', name: 'direct_web_bootstrap_hmac_attestation',
                message: 'A 200 web attestation was cryptographically invalid or had the wrong identity/configuration.',
                details: [`httpStatus=${response.status}`, `workerIdentity=${identity}`, 'readonlyOutcome=definitive_failure'],
            };
        }
        if (observedVersionId !== expectedVersionId) {
            return {
                status: 'failed', name: 'direct_web_bootstrap_hmac_attestation',
                message: 'A valid web attestation still reports the previous Worker version.',
                details: [`workerVersion=${version}`, `expectedVersion=${expectedVersionId}`, 'readonlyOutcome=retryable'],
            };
        }
        verified = true;
    } catch (error) {
        verified = false;
        return {
            status: 'failed', name: 'direct_web_bootstrap_hmac_attestation',
            message: 'Web runtime attestation failed.',
            details: [
                sanitizeError(error instanceof Error ? error : new Error(String(error))),
                `readonlyOutcome=${readonlyErrorIsRetryable(error, httpStatus, [401]) ? 'retryable' : 'definitive_failure'}`,
            ],
        };
    }

    return {
        status: verified ? 'ok' : 'failed',
        name: 'direct_web_bootstrap_hmac_attestation',
        message: verified
            ? 'Fresh HMAC attestation binds the exact deployed version to WEB_RUNTIME_MODE=bootstrap with Supabase runtime credentials and all active providers absent.'
            : 'Fresh HMAC attestation did not prove the exact inert/minimal bootstrap configuration.',
        details: [
            `httpStatus=${httpStatus ?? 'none'}`,
            `workerIdentity=${identity}`,
            `webVersionId=${expectedVersionId}`,
            `workerVersionMatched=${String(version === expectedVersionId)}`,
            'webRuntimeMode=bootstrap',
            'stripeBoundary=absent',
            'resendApiKeyFingerprint=absent',
            'supabaseUrlFingerprint=absent',
            'supabaseAnonFingerprint=absent',
            'supabaseServiceRoleFingerprint=absent',
            'turnstileSiteKeyFingerprint=absent',
            'turnstileSecretFingerprint=absent',
            'cronSecretFingerprint=absent',
            'levelCheckSecretFingerprint=absent',
            `proofVerified=${String(verified)}`,
        ],
    };
}

function classifyReadonlyChecks(checkList: readonly Check[]): CloudflareReadonlyAttemptResult<never> | null {
    const failures = checkList.filter((check) => check.status === 'failed');
    if (failures.length === 0) return null;
    const retryable = failures.every((check) => check.details.includes('readonlyOutcome=retryable'));
    return retryable
        ? { state: 'retryable', reason: failures.map((check) => check.name).join(',') }
        : { state: 'definitive_failure', reason: failures.map((check) => check.name).join(',') };
}

function readonlyCaptureFailure(capture: CommandCapture, reason: string): CloudflareReadonlyAttemptResult<never> {
    const output = readIfExists(capture.path) ?? '';
    const retryable = capture.exitCode === null
        || /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH)\b|fetch failed|network error|timed out|too many requests|(?:http(?: status)?|status(?: code)?|code)\s*[=:]?\s*(?:429|5\d\d)\b/iu.test(output);
    return retryable ? { state: 'retryable', reason } : { state: 'definitive_failure', reason };
}

function readonlyErrorIsRetryable(
    error: unknown,
    httpStatus: number | null,
    additionalStatuses: readonly number[] = [],
): boolean {
    return (httpStatus !== null && isRetryableCloudflareReadonlyStatus(httpStatus, additionalStatuses))
        || isRetryableCloudflareReadonlyError(error);
}

function buildCommands(): Record<string, CommandSpec> & {
    whoami: CommandSpec;
    deploymentsBefore: CommandSpec;
    secretsBefore: CommandSpec;
    secretsAfter: CommandSpec;
    deploymentsAfter: CommandSpec;
} {
    const read = (id: string, display: string, args: string[]): CommandSpec => ({
        id,
        display,
        args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', ...args],
        timeoutMs: 120_000,
        writesCloudflare: false,
    });
    return {
        whoami: read('wrangler-whoami-bootstrap-secrets', 'pnpm --config.verify-deps-before-run=false exec wrangler whoami --json', ['whoami', '--json']),
        deploymentsBefore: read('web-deployments-before-bootstrap-secrets', `pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name ${target.worker} --json`, ['deployments', 'list', '--name', target.worker, '--json']),
        secretsBefore: read('web-secrets-before-bootstrap-secrets', 'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production_bootstrap --format json', ['secret', 'list', '--config', 'wrangler.toml', '--env', 'production_bootstrap', '--format', 'json']),
        secretsAfter: read('web-secrets-after-bootstrap-secrets', 'pnpm --config.verify-deps-before-run=false exec wrangler secret list --config wrangler.toml --env production_bootstrap --format json', ['secret', 'list', '--config', 'wrangler.toml', '--env', 'production_bootstrap', '--format', 'json']),
        deploymentsAfter: read('web-deployments-after-bootstrap-secrets', `pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name ${target.worker} --json`, ['deployments', 'list', '--name', target.worker, '--json']),
    };
}

function buildSecretPutCommand(name: string): CommandSpec {
    return {
        id: `web-bootstrap-secret-put-${name.toLowerCase().replace(/_/g, '-')}`,
        display: `pnpm --config.verify-deps-before-run=false exec wrangler secret put ${name} --config wrangler.toml --env production_bootstrap`,
        args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'put', name, '--config', 'wrangler.toml', '--env', 'production_bootstrap'],
        timeoutMs: 120_000,
        writesCloudflare: true,
    };
}

function runCommand(command: CommandSpec, input?: string): CommandCapture {
    if (command.writesCloudflare) externalWriteAttempted = true;
    const result = runCloudflareWranglerFromKeyring(scopedWranglerArgs(command.args), {
        input,
        timeoutMs: command.timeoutMs,
    });
    const exitCode = result.status;
    const status: CheckStatus = exitCode === 0 && !result.error ? 'ok' : 'failed';
    const capturePath = path.join(outputDir, `${command.id}.txt`);
    writeFileSync(capturePath, [
        `command=${command.display}`,
        `writesCloudflare=${String(command.writesCloudflare)}`,
        `exitCode=${String(exitCode)}`,
        `error=${result.error ? sanitizeError(result.error) : 'none'}`,
        '',
        '## stdout',
        '',
        sanitizeOutput(String(result.stdout ?? '')) || '(empty)',
        '',
        '## stderr',
        '',
        sanitizeOutput(String(result.stderr ?? '')) || '(empty)',
        '',
    ].join('\n'), 'utf8');
    return { id: command.id, display: command.display, path: capturePath, exitCode, status, writesCloudflare: command.writesCloudflare };
}

function scopedWranglerArgs(args: readonly string[]): string[] {
    const prefix = ['--config.verify-deps-before-run=false', 'exec', 'wrangler'];
    if (!prefix.every((value, index) => args[index] === value)) {
        throw new Error('Refusing a command outside the scoped Wrangler command boundary.');
    }
    return args.slice(prefix.length);
}

function checkForCapture(capture: CommandCapture): Check {
    return {
        status: capture.status,
        name: `command_${capture.id}`,
        message: capture.status === 'ok' ? `Command completed: ${capture.display}` : `Command failed: ${capture.display}`,
        details: [`capture=${capture.path}`, `exitCode=${String(capture.exitCode)}`, `writesCloudflare=${String(capture.writesCloudflare)}`],
    };
}

function deploymentVersionId(capture: CommandCapture): string | null {
    const text = readIfExists(capture.path) ?? '';
    try {
        return newestWorkerDeploymentVersionId(parseMixedJsonOutput(text));
    } catch {
        return null;
    }
}

function extractSecretNames(text: string): { names: Set<string>; parsed: boolean } {
    const names = new Set<string>();
    const match = text.match(/\[\s*\{[\s\S]*?\}\s*\]/u) ?? text.match(/\[\s*\]/u);
    if (!match) return { names, parsed: false };
    try {
        const parsed = JSON.parse(match[0]) as Array<{ name?: unknown }>;
        if (!Array.isArray(parsed)) return { names, parsed: false };
        for (const item of parsed) if (typeof item?.name === 'string' && item.name) names.add(item.name);
        return { names, parsed: true };
    } catch {
        return { names, parsed: false };
    }
}

function renderArtifacts(report: Report): { summary: string; approvalGate: string; executionPlan: string } {
    const checkRows = report.checks.map((check) =>
        `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / ') || '-')} |`,
    );
    const captureRows = report.captures.map((capture) =>
        `| ${capture.status} | ${escapeCell(capture.display)} | ${String(capture.writesCloudflare)} | ${escapeCell(toRelative(capture.path))} |`,
    );
    const summary = `${[
        '# Cloudflare Production Web Bootstrap Secrets Summary',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closureStatus}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Target: account ${target.accountId}; Worker ${target.worker}; environment ${target.environment}`,
        '',
        'This runner is plan-only without the exact approval and `--execute-approved`. It never loads active/final provider secrets.',
        '',
        '## Minimal Secret Set',
        '',
        ...requiredSecretNames.map((name) => `- \`${name}\``),
        '',
        '`INTERNAL_JOB_SECRET` is included only because it authenticates and signs the runtime HMAC attestation.',
        '',
        '## Explicitly Withheld Until Final Activation',
        '',
        ...explicitlyWithheldSecretNames.map((name) => `- \`${name}\``),
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...checkRows,
        ...(captureRows.length > 0 ? [
            '', '## Captures', '',
            '| Status | Command | Writes Cloudflare | Path |',
            '| --- | --- | --- | --- |',
            ...captureRows,
        ] : []),
        '',
    ].join('\n')}\n`;

    const approvalGate = `${[
        '# Cloudflare Production Web Bootstrap Secrets Approval Gate',
        '',
        'This file documents the gate; it is not itself approval.',
        '',
        `- Environment variable: \`${approvalEnvVar}\`.`,
        '- Required flag: `--execute-approved`.',
        `- Secure input file selector: \`${envFileEnvVar}\` (defaults to ignored \`.env.production\`).`,
        `- Account: \`${target.accountId}\`.`,
        `- Worker/environment: \`${target.worker}\` / \`${target.environment}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Allowed',
        '',
        '- Fresh read-only account, deployment and secret-name checks.',
        '- Write exactly `INTERNAL_JOB_SECRET` via Wrangler stdin.',
        '- Fresh health, representative route 503 and authenticated HMAC attestation.',
        '',
        '## Forbidden',
        '',
        '- No service-role, Stripe, Resend, Turnstile, cron or level-check secret.',
        '- No fulfillment write, active build, legal-data substitution or Stripe Live prerequisite.',
        '- No domain, DNS, route, Pages, checkout or email activation.',
        '- No secret value in logs, captures, outputs or screenshots.',
        '',
    ].join('\n')}\n`;

    const executionPlan = `${[
        '# Cloudflare Production Web Bootstrap Secrets Execution Plan',
        '',
        '1. Execute and verify `pnpm launch:cloudflare-production-worker-phase1` under its separate approval.',
        '2. Review this plan and exact target. Confirm that remote secret names are empty or already exactly `INTERNAL_JOB_SECRET`.',
        '3. Supply the exact approval sentence and run:',
        '',
        '```powershell',
        `$env:${approvalEnvVar}='${exactApprovalSentence.replace(/'/g, "''")}'`,
        'pnpm launch:cloudflare-production-worker-bootstrap-secrets -- --execute-approved',
        '```',
        '',
        '4. Accept closure only when the post-write list is exactly `INTERNAL_JOB_SECRET`, all representative app routes remain `503 WEB_RUNTIME_BOOTSTRAP`, and HMAC binds the new deployment version to bootstrap with Supabase runtime credentials and all active providers absent.',
        '5. Keep the existing `pnpm launch:cloudflare-production-worker-secrets` route untouched for the final active/legal/Stripe Live window.',
        '',
    ].join('\n')}\n`;
    return { summary, approvalGate, executionPlan };
}

function statusFor(checkList: Check[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function isPlaceholderValue(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return !normalized
        || normalized.includes('replace-me')
        || normalized.includes('changeme')
        || normalized.includes('placeholder')
        || normalized === 'test';
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse()[0] ?? null;
}

function readIfExists(filePath: string): string | null {
    return filePath && existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function toRelative(filePath: string): string {
    return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function sanitizeOutput(value: string): string {
    const privateKeyBlock = new RegExp('-{5}BEGIN\\s+PRIVATE\\s+KEY-{5}[\\s\\S]*?-{5}END\\s+PRIVATE\\s+KEY-{5}', 'g');
    return value
        .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, 'sk_[redacted]')
        .replace(/pk_(?:live|test)_[A-Za-z0-9_-]+/g, 'pk_[redacted]')
        .replace(/whsec_[A-Za-z0-9_-]+/g, 'whsec_[redacted]')
        .replace(/re_[A-Za-z0-9_-]+/g, 're_[redacted]')
        .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_[redacted]')
        .replace(privateKeyBlock, '[private-key-redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [redacted]');
}

function sanitizeError(error: Error): string {
    return sanitizeOutput(error.message).replace(/\r?\n/g, ' ');
}
