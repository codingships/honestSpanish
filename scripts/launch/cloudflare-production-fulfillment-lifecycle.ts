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

type Phase = 'bootstrap' | 'enable';
type CheckStatus = 'ok' | 'failed';
type Check = { status: CheckStatus; name: string; message: string; details: string[] };
type CommandSpec = { id: string; display: string; args: string[]; writesCloudflare: boolean };
type CommandCapture = CommandSpec & { status: CheckStatus; exitCode: number | null; outputPath: string };

const target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    worker: 'espanol-honesto-fulfillment-production',
    webWorker: 'espanolhonesto',
    webIdentity: 'espanolhonesto',
    webDirectUrl: 'https://espanolhonesto.alindev95.workers.dev/',
    config: 'workers/fulfillment/wrangler.toml',
    directHost: 'espanol-honesto-fulfillment-production.alindev95.workers.dev',
    identity: 'espanol-honesto-fulfillment-production',
    supabaseRef: 'vkkahxsybhbutszerawz',
    site: 'https://espanolhonesto.com',
} as const;

const requiredSecretNames = [
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INTERNAL_JOB_SECRET',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
] as const;

const requiredWebAttestationNames = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INTERNAL_JOB_SECRET',
    'FULFILLMENT_WORKER_URL',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
] as const;

const phase = process.argv[2] as Phase | undefined;
if (phase !== 'bootstrap' && phase !== 'enable') {
    throw new Error('Usage: cloudflare-production-fulfillment-lifecycle.ts <bootstrap|enable> [--execute-approved]');
}

const executeRequested = process.argv.includes('--execute-approved');
const approvalEnvVar = phase === 'bootstrap'
    ? 'CLOUDFLARE_FULFILLMENT_BOOTSTRAP_APPROVAL'
    : 'CLOUDFLARE_FULFILLMENT_ENABLE_APPROVAL';
const directUrlEnvVar = 'CLOUDFLARE_FULFILLMENT_DIRECT_URL';
const envFileEnvVar = 'CLOUDFLARE_FULFILLMENT_ENV_FILE';
const exactApprovalSentence = phase === 'bootstrap'
    ? 'Apruebo crear o reemplazar solo el Cloudflare Fulfillment Worker production `espanol-honesto-fulfillment-production` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando el entorno Wrangler `production_bootstrap`, con jobs, email y cron desactivados, antes de desplegar el Worker web, sin ejecutar jobs, sin enviar emails, sin tocar dominios, DNS, Pages, Supabase, Google, Resend ni Stripe.'
    : 'Apruebo habilitar finalmente el Cloudflare Fulfillment Worker production `espanol-honesto-fulfillment-production` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando el entorno Wrangler `production`, despues de verificar el bootstrap inerte, el Worker web production, todos los secrets requeridos y la atestacion autenticada; este deploy activa jobs, email live y el cron horario, sin tocar dominios, DNS, Pages ni Stripe.';

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', `launch-cloudflare-production-fulfillment-${phase}`, stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const checks: Check[] = [
    validatePackageScripts(),
    validateWranglerConfig(),
    ...(phase === 'enable' ? [validateWebSecretsEvidence()] : []),
];
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
let externalWritePerformed = false;

if (!executeRequested) {
    checks.push(ok('plan_mode_no_external_write', 'Plan mode generated the gated lifecycle package without calling Cloudflare.', [
        'executeRequested=false',
        'externalWriteAttempted=false',
        `futureGate=${approvalEnvVar}`,
    ]));
} else if (checks.some((check) => check.status === 'failed')) {
    checks.push(failed('initial_validation_gate', 'Initial local validation failed; no read or write command was run.', [
        'externalWriteAttempted=false',
    ]));
} else {
    if (phase === 'enable') {
        dotenv.config({ path: process.env[envFileEnvVar]?.trim() || '.env.production', override: false, quiet: true });
    }
    await executeApproved();
}

const status = checks.some((check) => check.status === 'failed') ? 'FAILED' : 'OK';
writeFileSync(path.join(outputDir, 'approval-gate.md'), renderApprovalGate(), 'utf8');
writeFileSync(path.join(outputDir, 'command-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    phase,
    generatedAt: new Date().toISOString(),
    target,
    executeRequested,
    externalWriteAttempted,
    externalWritePerformed,
    approvalEnvVar,
    directUrlEnvVar,
    captures: captures.map((capture) => ({
        id: capture.id,
        command: capture.display,
        status: capture.status,
        exitCode: capture.exitCode,
        writesCloudflare: capture.writesCloudflare,
        outputPath: relative(capture.outputPath),
    })),
}, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(status), 'utf8');

console.log(`[launch:cloudflare-production-fulfillment-${phase}] Status: ${status}`);
console.log(`[launch:cloudflare-production-fulfillment-${phase}] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:cloudflare-production-fulfillment-${phase}] External write performed: ${String(externalWritePerformed)}`);
console.log(`[launch:cloudflare-production-fulfillment-${phase}] Summary: ${path.join(outputDir, 'summary.md')}`);
if (status === 'FAILED') process.exit(1);

async function executeApproved(): Promise<void> {
    const localGate = validateExecutionEnvironment();
    checks.push(localGate);
    if (localGate.status === 'failed') return;

    const whoami = runCommand(command('whoami', ['whoami', '--json'], false));
    captures.push(whoami);
    checks.push(commandCheck(whoami));
    if (whoami.status === 'failed') return;

    const accountMatched = captureText(whoami).includes(target.accountId);
    checks.push(accountMatched
        ? ok('remote_account_pre_write_gate', 'Wrangler is authenticated to the exact approved Cloudflare account.', [`accountId=${target.accountId}`])
        : failed('remote_account_pre_write_gate', 'Wrangler account does not match; no write may start.', ['externalWriteAttempted=false']));
    if (!accountMatched) return;

    if (phase === 'bootstrap') await executeBootstrap();
    else await executeEnable();
}

async function executeBootstrap(): Promise<void> {
    const dryRun = runCommand(deployCommand('fulfillment-bootstrap-dry-run', 'production_bootstrap', true));
    captures.push(dryRun);
    checks.push(commandCheck(dryRun));
    if (dryRun.status === 'failed') return;

    externalWriteAttempted = true;
    const deploy = runCommand(deployCommand('fulfillment-bootstrap-deploy', 'production_bootstrap', false));
    captures.push(deploy);
    checks.push(commandCheck(deploy));
    if (deploy.status === 'failed') return;
    externalWritePerformed = true;

    const deployments = runCommand(deploymentsCommand('fulfillment-bootstrap-deployments-after'));
    captures.push(deployments);
    checks.push(commandCheck(deployments));
    const versionId = deploymentVersionId(deployments);
    if (deployments.status === 'failed' || !versionId) {
        checks.push(failed('bootstrap_version_gate', 'The deployed bootstrap version could not be proven.', [`targetWorker=${target.worker}`]));
        return;
    }

    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) return;
    checks.push(await healthProbe(directUrl, 'bootstrap'));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await disabledOperationProbe(directUrl));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await cronScheduleProbe('bootstrap'));
}

async function executeEnable(): Promise<void> {
    const beforeDeployments = runCommand(deploymentsCommand('fulfillment-bootstrap-deployments-before-enable'));
    const webDeployments = runCommand(command(
        'web-production-deployments-before-enable',
        ['deployments', 'list', '--name', target.webWorker, '--json'],
        false,
    ));
    const secretList = runCommand(command(
        'fulfillment-secret-list-before-enable',
        ['secret', 'list', '--config', target.config, '--env', 'production_bootstrap', '--format', 'json'],
        false,
    ));
    captures.push(beforeDeployments, webDeployments, secretList);
    checks.push(commandCheck(beforeDeployments), commandCheck(webDeployments), commandCheck(secretList));
    if ([beforeDeployments, webDeployments, secretList].some((capture) => capture.status === 'failed')) return;

    const beforeVersionId = deploymentVersionId(beforeDeployments);
    const webVersionId = deploymentVersionId(webDeployments);
    const missingSecretNames = requiredSecretNames.filter((name) => !captureText(secretList).includes(name));
    const sequenceReady = Boolean(beforeVersionId && webVersionId) && missingSecretNames.length === 0;
    checks.push(sequenceReady
        ? ok('bootstrap_web_secrets_pre_enable_gate', 'Bootstrap, web Worker and all required fulfillment secret names exist before enable.', [
            `bootstrapVersion=${beforeVersionId}`,
            `webVersion=${webVersionId}`,
            `secretNameCount=${requiredSecretNames.length}`,
        ])
        : failed('bootstrap_web_secrets_pre_enable_gate', 'Required bootstrap/web/secrets sequence is incomplete; active deploy is blocked.', [
            `bootstrapVersionPresent=${String(Boolean(beforeVersionId))}`,
            `webVersionPresent=${String(Boolean(webVersionId))}`,
            `missingSecretNames=${missingSecretNames.join(', ') || 'none'}`,
        ]));
    if (!sequenceReady || !beforeVersionId) return;

    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) return;
    checks.push(await healthProbe(directUrl, 'bootstrap'));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await disabledOperationProbe(directUrl));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await cronScheduleProbe('bootstrap'));
    if (checks.at(-1)?.status === 'failed') return;

    const dryRun = runCommand(deployCommand('fulfillment-active-dry-run', 'production', true));
    captures.push(dryRun);
    checks.push(commandCheck(dryRun));
    if (dryRun.status === 'failed') return;

    // Re-read and attest both remote Workers after every other preflight, so
    // the versions proven here are the ones immediately preceding the write.
    const freshFulfillment = runCommand(deploymentsCommand('fulfillment-bootstrap-version-immediately-before-enable'));
    const freshWeb = runCommand(command(
        'web-production-version-immediately-before-enable',
        ['deployments', 'list', '--name', target.webWorker, '--json'],
        false,
    ));
    captures.push(freshFulfillment, freshWeb);
    checks.push(commandCheck(freshFulfillment), commandCheck(freshWeb));
    if (freshFulfillment.status === 'failed' || freshWeb.status === 'failed') return;
    const freshFulfillmentVersion = deploymentVersionId(freshFulfillment);
    const freshWebVersion = deploymentVersionId(freshWeb);
    if (!freshFulfillmentVersion || !freshWebVersion) {
        checks.push(failed('fresh_dual_worker_version_gate', 'Both immediately pre-write Worker versions must be proven.', [
            `fulfillmentVersionPresent=${String(Boolean(freshFulfillmentVersion))}`,
            `webVersionPresent=${String(Boolean(freshWebVersion))}`,
        ]));
        return;
    }
    checks.push(await runtimeAttestation(directUrl, freshFulfillmentVersion, 'bootstrap'));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await webRuntimeAttestation(freshWebVersion));
    if (checks.at(-1)?.status === 'failed') return;

    externalWriteAttempted = true;
    const deploy = runCommand(deployCommand('fulfillment-active-deploy', 'production', false));
    captures.push(deploy);
    checks.push(commandCheck(deploy));
    let activeStateProven = false;
    if (deploy.status === 'ok') {
        externalWritePerformed = true;
        const afterDeployments = runCommand(deploymentsCommand('fulfillment-active-deployments-after'));
        captures.push(afterDeployments);
        checks.push(commandCheck(afterDeployments));
        const afterVersionId = deploymentVersionId(afterDeployments);
        const versionCheck = afterDeployments.status === 'ok' && Boolean(afterVersionId && afterVersionId !== freshFulfillmentVersion)
            ? ok('active_version_gate', 'A distinct active fulfillment version is deployed.', [`versionChanged=true`])
            : failed('active_version_gate', 'A distinct active fulfillment version could not be proven after deploy.', [
                `versionPresent=${String(Boolean(afterVersionId))}`,
                `versionChanged=${String(Boolean(afterVersionId && afterVersionId !== freshFulfillmentVersion))}`,
            ]);
        checks.push(versionCheck);
        if (versionCheck.status === 'ok' && afterVersionId) {
            const activeHealth = await healthProbe(directUrl, 'active');
            const activeAttestation = await runtimeAttestation(directUrl, afterVersionId, 'active');
            const activeCron = await cronScheduleProbe('active');
            checks.push(activeHealth, activeAttestation, activeCron);
            activeStateProven = [activeHealth, activeAttestation, activeCron].every((check) => check.status === 'ok');
        }
    }

    if (!activeStateProven) {
        await compensateToBootstrap(directUrl);
    }
}

function validatePackageScripts(): Check {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
    const expected = {
        'launch:cloudflare-production-fulfillment-bootstrap': 'tsx scripts/launch/cloudflare-production-fulfillment-lifecycle.ts bootstrap',
        'launch:cloudflare-production-fulfillment-enable': 'tsx scripts/launch/cloudflare-production-fulfillment-lifecycle.ts enable',
    };
    const missing = Object.entries(expected)
        .filter(([name, commandValue]) => packageJson.scripts?.[name] !== commandValue)
        .map(([name]) => name);
    return missing.length === 0
        ? ok('package_scripts', 'Package exposes separate bootstrap and final-enable commands.', Object.keys(expected))
        : failed('package_scripts', 'Fulfillment lifecycle scripts are missing or ambiguous.', missing);
}

function validateWranglerConfig(): Check {
    const source = existsSync(target.config) ? readFileSync(target.config, 'utf8') : '';
    const required = [
        '[env.production_bootstrap]',
        'name = "espanol-honesto-fulfillment-production"',
        '[env.production_bootstrap.triggers]',
        'FULFILLMENT_RUNTIME_MODE = "bootstrap"',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
        '[env.production]',
        '[env.production.triggers]',
        'FULFILLMENT_RUNTIME_MODE = "active"',
        'EMAIL_DELIVERY_MODE = "live"',
        'crons = ["0 * * * *"]',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    const bootstrapSection = section(source, '[env.production_bootstrap.triggers]', '[env.production_bootstrap.vars]');
    if (!bootstrapSection.includes('crons = []')) missing.push('[env.production_bootstrap.triggers] crons = []');
    const bootstrapVars = section(source, '[env.production_bootstrap.vars]', '[env.production_bootstrap.version_metadata]');
    for (const snippet of [
        'FULFILLMENT_RUNTIME_MODE = "bootstrap"',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
    ]) if (!bootstrapVars.includes(snippet)) missing.push(`[env.production_bootstrap.vars] ${snippet}`);
    const activeTriggers = section(source, '[env.production.triggers]', '[env.production.vars]');
    if (!activeTriggers.includes('crons = ["0 * * * *"]')) missing.push('[env.production.triggers] crons = ["0 * * * *"]');
    const activeVars = section(source, '[env.production.vars]', '[env.production.version_metadata]');
    for (const snippet of [
        'FULFILLMENT_RUNTIME_MODE = "active"',
        'EMAIL_DELIVERY_MODE = "live"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "80"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "2400"',
    ]) if (!activeVars.includes(snippet)) missing.push(`[env.production.vars] ${snippet}`);
    return missing.length === 0
        ? ok('wrangler_lifecycle_config', 'Wrangler defines an inert exact-name bootstrap and a separate active production environment.', [target.config])
        : failed('wrangler_lifecycle_config', 'Wrangler lifecycle configuration is incomplete.', missing.map((item) => `missing=${item}`));
}

function validateWebSecretsEvidence(): Check {
    const summaryPath = latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'summary.md');
    if (!summaryPath) {
        return failed('web_secrets_before_fulfillment_enable', 'Executed web secret/attestation evidence is required before fulfillment enable.', [
            'run=pnpm launch:cloudflare-production-worker-secrets -- --execute-approved',
        ]);
    }
    const summary = readFileSync(summaryPath, 'utf8');
    const required = [
        '- Status: OK',
        '- Execute requested: true',
        '- External write performed: true',
        '| ok | fresh_stripe_live_readiness_pre_write_gate |',
        '| ok | direct_worker_runtime_attestation |',
    ];
    const missing = required.filter((snippet) => !summary.includes(snippet));
    return missing.length === 0
        ? ok('web_secrets_before_fulfillment_enable', 'Latest web evidence proves secrets, fresh Stripe gate and runtime attestation before fulfillment enable.', [`summary=${summaryPath}`])
        : failed('web_secrets_before_fulfillment_enable', 'Web secret/attestation evidence is incomplete; fulfillment enable remains blocked.', missing.map((snippet) => `missing=${snippet}`));
}

function validateExecutionEnvironment(): Check {
    const mismatches = [
        process.env[approvalEnvVar]?.trim() === exactApprovalSentence ? null : approvalEnvVar,
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() === target.accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
        process.env.CLOUDFLARE_API_TOKEN?.trim() ? null : 'CLOUDFLARE_API_TOKEN',
        normalizeDirectUrl(process.env[directUrlEnvVar]) ? null : directUrlEnvVar,
    ];
    if (phase === 'enable') {
        const dailyLimit = Number(process.env.EMAIL_DAILY_RECIPIENT_LIMIT);
        const monthlyLimit = Number(process.env.EMAIL_MONTHLY_RECIPIENT_LIMIT);
        mismatches.push(
            process.env.PUBLIC_APP_ENV?.trim() === 'production' ? null : 'PUBLIC_APP_ENV',
            process.env.SUPABASE_EXPECTED_PROJECT_REF?.trim() === target.supabaseRef ? null : 'SUPABASE_EXPECTED_PROJECT_REF',
            process.env.WORKER_IDENTITY?.trim() === target.identity ? null : 'WORKER_IDENTITY',
            normalizeOrigin(process.env.PUBLIC_SITE_URL) === target.site ? null : 'PUBLIC_SITE_URL',
            process.env.FULFILLMENT_RUNTIME_MODE?.trim() === 'active' ? null : 'FULFILLMENT_RUNTIME_MODE',
            process.env.EMAIL_DELIVERY_MODE?.trim() === 'live' ? null : 'EMAIL_DELIVERY_MODE',
            Number.isSafeInteger(dailyLimit) && dailyLimit > 0 && dailyLimit <= 80 ? null : 'EMAIL_DAILY_RECIPIENT_LIMIT',
            Number.isSafeInteger(monthlyLimit) && monthlyLimit > 0 && monthlyLimit <= 2400 ? null : 'EMAIL_MONTHLY_RECIPIENT_LIMIT',
            supabaseProjectRef(secretValue('PUBLIC_SUPABASE_URL')) === target.supabaseRef ? null : 'PUBLIC_SUPABASE_URL',
            mailbox(secretValue('EMAIL_FROM')) === mailbox(secretValue('RESEND_FROM_EMAIL'))
                && mailbox(secretValue('EMAIL_FROM'))?.endsWith('@espanolhonesto.com')
                ? null
                : 'EMAIL_FROM/RESEND_FROM_EMAIL',
            ...requiredSecretNames.map((name) => secretValue(name) && !isPlaceholder(secretValue(name)) ? null : name),
            ...requiredWebAttestationNames.map((name) => secretValue(name) && !isPlaceholder(secretValue(name)) ? null : `web:${name}`),
        );
    }
    const failures = mismatches.filter((value): value is string => Boolean(value));
    return failures.length === 0
        ? ok('execution_environment_gate', 'Exact approval, target and phase inputs match before any Cloudflare command.', [
            `phase=${phase}`,
            'externalWriteAttempted=false',
        ])
        : failed('execution_environment_gate', 'Approval or exact target inputs do not match; no Cloudflare write may start.', [
            `mismatches=${failures.join(', ')}`,
            'externalWriteAttempted=false',
        ]);
}

async function healthProbe(baseUrl: string, expectedMode: 'bootstrap' | 'active'): Promise<Check> {
    const url = new URL('/health', baseUrl).toString();
    try {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
        const body = await response.json() as { ok?: unknown; service?: unknown; operationMode?: unknown; workerIdentity?: unknown };
        const matched = response.status === 200
            && body.ok === true
            && body.service === 'fulfillment-worker'
            && body.operationMode === expectedMode
            && body.workerIdentity === target.identity;
        writeFileSync(path.join(outputDir, `health-${expectedMode}.txt`), [
            `url=${url}`,
            `httpStatus=${response.status}`,
            `operationMode=${String(body.operationMode ?? 'missing')}`,
            `workerIdentityMatched=${String(body.workerIdentity === target.identity)}`,
        ].join('\n'), 'utf8');
        return matched
            ? ok(`health_${expectedMode}`, `Direct health probe proves ${expectedMode} mode and exact identity.`, [`url=${url}`])
            : failed(`health_${expectedMode}`, `Direct health probe did not prove ${expectedMode} mode and exact identity.`, [`httpStatus=${response.status}`]);
    } catch (error) {
        return failed(`health_${expectedMode}`, 'Direct health probe failed.', [safeError(error)]);
    }
}

async function disabledOperationProbe(baseUrl: string): Promise<Check> {
    const url = new URL('/internal/jobs/process', baseUrl).toString();
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json() as { errorCode?: unknown };
        const blocked = response.status === 503 && body.errorCode === 'FULFILLMENT_DISABLED';
        return blocked
            ? ok('bootstrap_operational_block', 'Bootstrap rejects operational calls before auth and cannot process jobs.', [`httpStatus=${response.status}`])
            : failed('bootstrap_operational_block', 'Bootstrap did not prove the operational fail-closed guard.', [`httpStatus=${response.status}`]);
    } catch (error) {
        return failed('bootstrap_operational_block', 'Bootstrap operational probe failed.', [safeError(error)]);
    }
}

async function runtimeAttestation(
    baseUrl: string,
    expectedVersionId: string,
    expectedMode: 'bootstrap' | 'active',
): Promise<Check> {
    const url = new URL('/internal/runtime-attestation', baseUrl).toString();
    const nonce = randomUUID();
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${secretValue('INTERNAL_JOB_SECRET')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce }),
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const envelope = await response.json() as RuntimeAttestationEnvelope;
        const active = expectedMode === 'active';
        const config = await buildRuntimeAttestationConfig('fulfillment', {
            ...Object.fromEntries(requiredSecretNames.map((name) => [name, secretValue(name)])),
            PUBLIC_APP_ENV: 'production',
            SUPABASE_EXPECTED_PROJECT_REF: target.supabaseRef,
            WORKER_IDENTITY: target.identity,
            WORKER_VERSION_ID: expectedVersionId,
            PUBLIC_SITE_URL: target.site,
            FULFILLMENT_RUNTIME_MODE: expectedMode,
            EMAIL_DELIVERY_MODE: active ? 'live' : 'disabled',
            EMAIL_DAILY_RECIPIENT_LIMIT: active ? '80' : '0',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: active ? '2400' : '0',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });
        const verified = response.status === 200
            && envelope.workerIdentity === target.identity
            && envelope.workerVersionId === expectedVersionId
            && await verifyRuntimeAttestation(envelope, {
                config,
                nonce,
                role: 'fulfillment',
                schema: RUNTIME_ATTESTATION_SCHEMA,
            }, secretValue('INTERNAL_JOB_SECRET'));
        return verified
            ? ok(`attestation_${expectedMode}`, `Authenticated attestation proves exact ${expectedMode} runtime configuration.`, [
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
                `supabaseExpectedProjectRef=${target.supabaseRef}`,
            ])
            : failed(`attestation_${expectedMode}`, `Authenticated attestation did not prove exact ${expectedMode} runtime configuration.`, [
                `httpStatus=${response.status}`,
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
            ]);
    } catch (error) {
        return failed(`attestation_${expectedMode}`, 'Authenticated runtime attestation failed.', [safeError(error)]);
    }
}

async function webRuntimeAttestation(expectedVersionId: string): Promise<Check> {
    const url = new URL('/api/internal/runtime-attestation', target.webDirectUrl).toString();
    const nonce = randomUUID();
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${secretValue('INTERNAL_JOB_SECRET')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ nonce }),
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const envelope = await response.json() as RuntimeAttestationEnvelope;
        const config = await buildRuntimeAttestationConfig('web', {
            ...Object.fromEntries(requiredWebAttestationNames.map((name) => [name, secretValue(name)])),
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
            SUPABASE_EXPECTED_PROJECT_REF: target.supabaseRef,
            WORKER_IDENTITY: target.webIdentity,
            WORKER_VERSION_ID: expectedVersionId,
            PUBLIC_SITE_URL: target.site,
            EMAIL_DELIVERY_MODE: 'live',
            EMAIL_DAILY_RECIPIENT_LIMIT: '80',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '2400',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });
        const verified = response.status === 200
            && envelope.workerIdentity === target.webIdentity
            && envelope.workerVersionId === expectedVersionId
            && await verifyRuntimeAttestation(envelope, {
                config,
                nonce,
                role: 'web',
                schema: RUNTIME_ATTESTATION_SCHEMA,
            }, secretValue('INTERNAL_JOB_SECRET'));
        return verified
            ? ok('fresh_web_runtime_attestation_pre_enable', 'Fresh HMAC attestation proves the exact web Worker version/config immediately before enable.', [
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
                `supabaseExpectedProjectRef=${target.supabaseRef}`,
            ])
            : failed('fresh_web_runtime_attestation_pre_enable', 'Fresh web Worker HMAC attestation failed; active fulfillment write is blocked.', [
                `httpStatus=${response.status}`,
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
            ]);
    } catch (error) {
        return failed('fresh_web_runtime_attestation_pre_enable', 'Fresh web Worker HMAC attestation failed; active fulfillment write is blocked.', [safeError(error)]);
    }
}

async function cronScheduleProbe(expectedMode: 'bootstrap' | 'active'): Promise<Check> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}/schedules`;
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${secretValue('CLOUDFLARE_API_TOKEN')}` },
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json() as { success?: unknown; result?: Array<{ cron?: unknown }> };
        const schedules = Array.isArray(body.result) ? body.result : [];
        const matched = response.status === 200
            && body.success === true
            && (expectedMode === 'bootstrap'
                ? schedules.length === 0
                : schedules.length === 1 && schedules[0]?.cron === '0 * * * *');
        return matched
            ? ok(`cron_${expectedMode}`, `Remote Cron Trigger state matches ${expectedMode}.`, [
                `scheduleCount=${schedules.length}`,
                `expected=${expectedMode === 'bootstrap' ? 'none' : '0 * * * *'}`,
            ])
            : failed(`cron_${expectedMode}`, `Remote Cron Trigger state does not match ${expectedMode}.`, [
                `httpStatus=${response.status}`,
                `scheduleCount=${schedules.length}`,
            ]);
    } catch (error) {
        return failed(`cron_${expectedMode}`, 'Remote Cron Trigger state could not be proven.', [safeError(error)]);
    }
}

async function compensateToBootstrap(directUrl: string): Promise<void> {
    checks.push(failed('active_enable_not_proven', 'Active deployment failed or its final state is ambiguous; compensating bootstrap rollback is mandatory.', []));
    externalWriteAttempted = true;
    const rollback = runCommand(deployCommand('fulfillment-compensating-bootstrap-rollback', 'production_bootstrap', false));
    captures.push(rollback);
    checks.push(commandCheck(rollback));
    if (rollback.status !== 'ok') {
        checks.push(failed('active_deploy_state_ambiguous', 'Compensating bootstrap rollback failed or timed out; remote fulfillment state is ambiguous.', [
            'manualStopRequired=true',
        ]));
        return;
    }
    externalWritePerformed = true;

    const deployments = runCommand(deploymentsCommand('fulfillment-bootstrap-deployments-after-compensation'));
    captures.push(deployments);
    checks.push(commandCheck(deployments));
    const versionId = deploymentVersionId(deployments);
    if (deployments.status !== 'ok' || !versionId) {
        checks.push(failed('active_deploy_state_ambiguous', 'Rollback command returned but its deployed bootstrap version is not proven.', [
            'manualStopRequired=true',
        ]));
        return;
    }

    const health = await healthProbe(directUrl, 'bootstrap');
    const blocked = await disabledOperationProbe(directUrl);
    const attestation = await runtimeAttestation(directUrl, versionId, 'bootstrap');
    const cron = await cronScheduleProbe('bootstrap');
    checks.push(health, blocked, attestation, cron);
    const proven = [health, blocked, attestation, cron].every((check) => check.status === 'ok');
    checks.push(proven
        ? ok('compensating_bootstrap_rollback_proven', 'Compensating rollback restored a version-bound bootstrap with operations blocked and no Cron Trigger.', [
            `versionId=${versionId}`,
            'operationMode=bootstrap',
            'operationalHttpStatus=503',
            'cronCount=0',
        ])
        : failed('active_deploy_state_ambiguous', 'Compensating rollback ran but bootstrap/503/HMAC/no-cron state is not fully proven.', [
            'manualStopRequired=true',
        ]));
}

function command(id: string, wranglerArgs: string[], writesCloudflare: boolean): CommandSpec {
    return {
        id,
        display: `corepack pnpm --config.verify-deps-before-run=false exec wrangler ${wranglerArgs.join(' ')}`,
        args: ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', ...wranglerArgs],
        writesCloudflare,
    };
}

function deployCommand(id: string, environment: 'production_bootstrap' | 'production', dryRun: boolean): CommandSpec {
    return command(id, [
        'deploy', '--config', target.config, '--env', environment,
        ...(dryRun ? ['--dry-run'] : ['--keep-vars']),
    ], !dryRun);
}

function deploymentsCommand(id: string): CommandSpec {
    return command(id, ['deployments', 'list', '--name', target.worker, '--json'], false);
}

function runCommand(spec: CommandSpec): CommandCapture {
    const result = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', spec.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        timeout: 180_000,
        windowsHide: true,
        shell: process.platform === 'win32',
    });
    const status: CheckStatus = result.status === 0 && !result.error ? 'ok' : 'failed';
    const outputPath = path.join(outputDir, `${spec.id}.txt`);
    writeFileSync(outputPath, [
        `command=${spec.display}`,
        `writesCloudflare=${String(spec.writesCloudflare)}`,
        `exitCode=${String(result.status)}`,
        `status=${status}`,
        '', '# stdout', sanitize(result.stdout ?? ''), '', '# stderr', sanitize(result.stderr ?? ''),
    ].join('\n'), 'utf8');
    return { ...spec, status, exitCode: result.status, outputPath };
}

function commandCheck(capture: CommandCapture): Check {
    return capture.status === 'ok'
        ? ok(`command_${capture.id}`, 'Command completed.', [`writesCloudflare=${String(capture.writesCloudflare)}`])
        : failed(`command_${capture.id}`, 'Command failed or timed out.', [
            `writesCloudflare=${String(capture.writesCloudflare)}`,
            `capture=${relative(capture.outputPath)}`,
        ]);
}

function deploymentVersionId(capture: CommandCapture): string | null {
    return /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(captureText(capture))?.[1] ?? null;
}

function captureText(capture: CommandCapture): string {
    return existsSync(capture.outputPath) ? readFileSync(capture.outputPath, 'utf8') : '';
}

function normalizeDirectUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname === target.directHost && !url.port && !url.username && !url.password
            ? `${url.origin}/`
            : null;
    } catch {
        return null;
    }
}

function normalizeOrigin(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.origin : null;
    } catch {
        return null;
    }
}

function supabaseProjectRef(value: string): string | null {
    try {
        return /^([a-z0-9]+)\.supabase\.co$/iu.exec(new URL(value).hostname)?.[1] ?? null;
    } catch {
        return null;
    }
}

function secretValue(name: string): string {
    return process.env[name]?.trim() ?? '';
}

function isPlaceholder(value: string): boolean {
    return /replace[-_ ]?me|change[-_ ]?me|placeholder|your[-_ ]?key|^test$/iu.test(value);
}

function mailbox(value: string): string | null {
    const candidate = /<([^<>]+)>/u.exec(value)?.[1] ?? value;
    const normalized = candidate.trim().toLowerCase();
    return /^[^@\s]+@[^@\s]+$/u.test(normalized) ? normalized : null;
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;
    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left));
    for (const candidate of candidates) {
        const filePath = path.join(root, candidate, fileName);
        if (existsSync(filePath)) return filePath;
    }
    return null;
}

function section(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    return startIndex >= 0 ? source.slice(startIndex, endIndex >= 0 ? endIndex : undefined) : '';
}

function sanitize(value: string): string {
    let sanitized = value
        .replace(new RegExp('-----BEGIN [A-Z ]+' + 'PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]+' + 'PRIVATE KEY-----', 'gu'), '[redacted-private-key]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]');
    for (const secret of [process.env.CLOUDFLARE_API_TOKEN ?? '', ...requiredSecretNames.map(secretValue)]) {
        if (secret) sanitized = sanitized.replaceAll(secret, '[redacted-known-value]');
    }
    return sanitized;
}

function safeError(error: unknown): string {
    return sanitize(error instanceof Error ? error.message : String(error)).replace(/\r?\n/gu, ' ').slice(0, 400);
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function failed(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function relative(filePath: string): string {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}

function renderApprovalGate(): string {
    return `${[
        `# Cloudflare Fulfillment Production ${phase === 'bootstrap' ? 'Bootstrap' : 'Final Enable'} Approval Gate`,
        '',
        'This file is not approval.',
        '',
        `- Required flag: \`--execute-approved\`.`,
        `- Exact approval environment variable: \`${approvalEnvVar}\`.`,
        `- Exact target: \`${target.worker}\` in account \`${target.accountId}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Forbidden Scope',
        '',
        '- No domain, DNS, Pages or Stripe write.',
        '- No job, email or Google operation is invoked by this runner.',
        '- No secret value is stored in outputs.',
        '',
    ].join('\n')}\n`;
}

function renderSummary(status: string): string {
    return `${[
        `# Cloudflare Fulfillment Production ${phase} Summary`,
        '',
        `- Status: ${status}`,
        `- Execute requested: ${String(executeRequested)}`,
        `- External write attempted: ${String(externalWriteAttempted)}`,
        `- External write performed: ${String(externalWritePerformed)}`,
        `- Target account: ${target.accountId}`,
        `- Target Worker: ${target.worker}`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
    ].join('\n')}\n`;
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}
