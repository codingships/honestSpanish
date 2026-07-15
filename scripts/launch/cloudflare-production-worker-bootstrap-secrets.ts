import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';
import { verifyCloudflareWhoamiOutput } from '../ci/verify-cloudflare-identity';
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    openOneShotCloudflareWriteGuard,
    reconcileOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
} from './cloudflare-production-one-shot-write';

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
    latestPhaseOneSummaryPath: string | null;
    checks: Check[];
    captures: CommandCapture[];
    outputDir: string;
    summaryPath: string;
    approvalGatePath: string;
    executionPlanPath: string;
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

const latestPhaseOneSummaryPath = latestGeneratedPathMatching(
    'launch-cloudflare-production-worker-phase1',
    'summary.md',
    ['- Status: OK', '- Execute requested: true', '- External write performed: true', '| ok | web_bootstrap_health_after_deploy |'],
);
const commands = buildCommands();
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
let externalWritePerformedState: boolean | 'unknown' = false;

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
        if (inputCheck.status === 'ok') checks.push(...await runApprovedExecution());
    } else {
        checks.push({
            status: 'ok',
            name: 'plan_mode_no_external_write',
            message: 'Plan mode generated the minimal bootstrap-secret gate without calling Cloudflare.',
            details: ['executeRequested=false', 'externalWriteAttempted=false', `futureGate=${approvalEnvVar}`],
        });
    }

    const report = createReport();
    const rendered = renderArtifacts(report);
    writeFileSync(report.summaryPath, rendered.summary, 'utf8');
    writeFileSync(report.approvalGatePath, rendered.approvalGate, 'utf8');
    writeFileSync(report.executionPlanPath, rendered.executionPlan, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');

    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Status: ${report.status}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Closure: ${report.closureStatus}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] External write attempted: ${report.externalWriteAttempted}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] External write performed: ${report.externalWritePerformed}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Summary: ${report.summaryPath}`);
    console.log(`[launch:cloudflare-production-worker-bootstrap-secrets] Approval gate: ${report.approvalGatePath}`);

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
        latestPhaseOneSummaryPath,
        checks,
        captures,
        outputDir,
        summaryPath: path.join(outputDir, 'summary.md'),
        approvalGatePath: path.join(outputDir, 'approval-gate.md'),
        executionPlanPath: path.join(outputDir, 'execution-plan.md'),
    };
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
    const summary = latestPhaseOneSummaryPath ? readIfExists(latestPhaseOneSummaryPath) : null;
    const required = [
        '- Status: OK',
        '- Execute requested: true',
        '- External write performed: true',
        '| ok | web_bootstrap_health_after_deploy |',
    ];
    const missing = summary ? required.filter((snippet) => !summary.includes(snippet)) : required;
    return {
        status: missing.length === 0 ? 'ok' : executeRequested ? 'failed' : 'warning',
        name: 'phase1_web_bootstrap_before_secrets',
        message: missing.length === 0
            ? 'Latest phase-1 evidence records an executed inert web bootstrap before minimal secret loading.'
            : executeRequested
                ? 'Executed phase-1 bootstrap evidence is required before any secret write.'
                : 'Phase-1 has not yet been executed; this plan remains ready but execution will be gated.',
        details: missing.length === 0
            ? [`summary=${latestPhaseOneSummaryPath}`]
            : [`summary=${latestPhaseOneSummaryPath ?? 'missing'}`, ...missing.map((item) => `missing=${item}`)],
    };
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

    const reconciliation = await reconcileOneShotCloudflareWriteGuard(
        'web-bootstrap-hmac-secret',
        outputDir,
        {
            readback: async (checkpoint) => {
                if (checkpoint && checkpoint.commandId !== 'web-bootstrap-secret-put-internal-job-secret') return false;
                const secretShape = validateRemoteSecretShape(
                    captures.find((capture) => capture.id === commands.secretsBefore.id),
                    true,
                );
                executionChecks.push(secretShape);
                if (secretShape.status === 'failed') return false;
                const versionCapture = captures.find((capture) => capture.id === commands.deploymentsBefore.id);
                const versionId = versionCapture ? deploymentVersionId(versionCapture) : null;
                if (!versionId) return false;
                const attestation = await attestBootstrap(versionId);
                executionChecks.push(attestation);
                return attestation.status === 'ok';
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

    for (const command of [commands.secretsAfter, commands.deploymentsAfter]) {
        const capture = runCommand(command);
        captures.push(capture);
        executionChecks.push(checkForCapture(capture));
        if (capture.status === 'failed') {
            recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
            return executionChecks;
        }
    }

    const secretShape = validateRemoteSecretShape(
        captures.find((capture) => capture.id === commands.secretsAfter.id),
        true,
    );
    executionChecks.push(secretShape);
    if (secretShape.status === 'failed') {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        return executionChecks;
    }

    const versionCapture = captures.find((capture) => capture.id === commands.deploymentsAfter.id);
    const versionId = versionCapture ? deploymentVersionId(versionCapture) : null;
    if (!versionId) {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        executionChecks.push({
            status: 'failed',
            name: 'post_write_deployment_version',
            message: 'A fresh deployed version could not be read after the secret writes.',
            details: ['versionId=missing'],
        });
        return executionChecks;
    }

    const routeChecks = await probeBootstrapRoutes('post_write');
    executionChecks.push(...routeChecks);
    if (routeChecks.some((check) => check.status === 'failed')) {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        return executionChecks;
    }
    const attestation = await attestBootstrap(versionId);
    executionChecks.push(attestation);
    writeCheckpoint = recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, attestation.status === 'ok');
    if (attestation.status === 'failed') return executionChecks;
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
    try {
        const healthResponse = await fetch(`${target.directUrl}/health`, {
            redirect: 'manual',
            signal: AbortSignal.timeout(20_000),
        });
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
            details: [`httpStatus=${healthResponse.status}`, `runtimeMode=${String(health.runtimeMode ?? 'missing')}`],
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
                details: [`route=${route.method} ${route.path}`, `httpStatus=${response.status}`, `errorCode=${errorCode}`, `inertHeaders=${String(headersAreInert)}`],
            });
        }

        const attestationGet = await fetch(`${target.directUrl}/api/internal/runtime-attestation`, {
            method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20_000),
        });
        results.push({
            status: attestationGet.status === 404 ? 'ok' : 'failed',
            name: `web_bootstrap_attestation_get_hidden_${phase}`,
            message: 'The allowed diagnostic attestation path must expose only authenticated POST; GET remains 404.',
            details: [`httpStatus=${attestationGet.status}`],
        });
    } catch (error) {
        results.push({
            status: 'failed',
            name: `web_bootstrap_route_probe_${phase}`,
            message: 'Direct bootstrap route probes failed or timed out.',
            details: [sanitizeError(error instanceof Error ? error : new Error(String(error)))],
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
        const envelope = await response.json() as RuntimeAttestationEnvelope;
        identity = envelope.workerIdentity ?? 'missing';
        version = envelope.workerVersionId ?? 'missing';
        const config = await buildRuntimeAttestationConfig('web', {
            INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
            SUPABASE_EXPECTED_PROJECT_REF: target.supabaseRef,
            WORKER_IDENTITY: target.worker,
            WORKER_VERSION_ID: expectedVersionId,
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
        verified = response.status === 200
            && envelope.workerIdentity === target.worker
            && envelope.workerVersionId === expectedVersionId
            && providersAbsent
            && await verifyRuntimeAttestation(envelope, {
                config,
                nonce,
                role: 'web',
                schema: RUNTIME_ATTESTATION_SCHEMA,
            }, process.env.INTERNAL_JOB_SECRET ?? '');
    } catch {
        verified = false;
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

function buildCommands(): Record<string, CommandSpec> & {
    whoami: CommandSpec;
    deploymentsBefore: CommandSpec;
    secretsBefore: CommandSpec;
    secretsAfter: CommandSpec;
    deploymentsAfter: CommandSpec;
} {
    const pnpm = pnpmCommand();
    const read = (id: string, display: string, args: string[]): CommandSpec => ({
        id,
        display,
        bin: pnpm,
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
        bin: pnpmCommand(),
        args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'put', name, '--config', 'wrangler.toml', '--env', 'production_bootstrap'],
        timeoutMs: 120_000,
        writesCloudflare: true,
    };
}

function runCommand(command: CommandSpec, input?: string): CommandCapture {
    if (command.writesCloudflare) externalWriteAttempted = true;
    const result = spawnSync(command.bin, command.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        input,
        shell: process.platform === 'win32',
        timeout: command.timeoutMs,
        windowsHide: true,
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

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
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
    return /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(text)?.[1] ?? null;
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

function latestGeneratedPathMatching(folderName: string, fileName: string, snippets: readonly string[]): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;
    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();
    return candidates.find((candidate) => {
        const contents = readFileSync(candidate, 'utf8');
        return snippets.every((snippet) => contents.includes(snippet));
    }) ?? null;
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
