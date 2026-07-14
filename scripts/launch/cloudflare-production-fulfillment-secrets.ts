import * as dotenv from 'dotenv';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';
import { verifyCloudflareWhoamiOutput } from '../ci/verify-cloudflare-identity';

type CheckStatus = 'ok' | 'warning' | 'failed';

type Check = {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
};

type CommandSpec = {
    id: string;
    display: string;
    args: string[];
    writesCloudflare: boolean;
};

type CommandCapture = {
    id: string;
    display: string;
    outputPath: string;
    exitCode: number | null;
    status: CheckStatus;
    writesCloudflare: boolean;
};

const target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    worker: 'espanol-honesto-fulfillment-production',
    config: 'workers/fulfillment/wrangler.toml',
    directHost: 'espanol-honesto-fulfillment-production.alindev95.workers.dev',
    supabaseRef: 'vkkahxsybhbutszerawz',
    site: 'https://espanolhonesto.com',
    identity: 'espanol-honesto-fulfillment-production',
} as const;

const approvalEnvVar = 'CLOUDFLARE_FULFILLMENT_SECRETS_APPROVAL';
const directUrlEnvVar = 'CLOUDFLARE_FULFILLMENT_DIRECT_URL';
const envFileEnvVar = 'CLOUDFLARE_FULFILLMENT_ENV_FILE';
const exactApprovalSentence = 'Apruebo configurar/verificar solo los secrets del Cloudflare Fulfillment Worker production inerte `espanol-honesto-fulfillment-production` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, despues de validar el bootstrap, Supabase production `vkkahxsybhbutszerawz` y la URL directa exacta, usando Google/Resend/Supabase desde el origen seguro aprobado, sin imprimir ni guardar valores, manteniendo `FULFILLMENT_RUNTIME_MODE=bootstrap`, email desactivado y cron vacio, sin enviar emails, sin ejecutar jobs, sin tocar el Worker web, sin mover dominios y sin cambiar DNS.';
const executeRequested = process.argv.includes('--execute-approved');

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

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-fulfillment-secrets', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const checks: Check[] = [
    validatePackageScript(),
    validateWranglerConfig(),
];
const captures: CommandCapture[] = [];
let externalWritePerformed = false;
let externalWriteAttempted = false;

if (executeRequested && checks.some((check) => check.status === 'failed')) {
    checks.push({
        status: 'failed',
        name: 'initial_validation_gate',
        message: 'Initial local validation failed; no Cloudflare command was run.',
        details: ['externalWriteAttempted=false'],
    });
} else if (executeRequested) {
    const envFile = process.env[envFileEnvVar]?.trim() || '.env.production';
    dotenv.config({ path: envFile, override: false, quiet: true });
    await executeApproved();
} else {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_external_write',
        message: 'Plan mode generated a separate Fulfillment Worker production secret/config/email package without calling Cloudflare.',
        details: ['executeRequested=false', 'externalWritePerformed=false', `futureGate=${approvalEnvVar}`],
    });
}

const status = checks.some((check) => check.status === 'failed')
    ? 'FAILED'
    : checks.some((check) => check.status === 'warning')
        ? 'WARNING'
        : 'OK';
const endedAt = new Date();
const summaryJson = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    status,
    outputDir,
    executeRequested,
    externalWritePerformed,
    externalWriteAttempted,
    checks,
    captures: captures.map((capture) => ({
        ...capture,
        outputPath: relative(capture.outputPath),
    })),
    approvalGatePath: path.join(outputDir, 'approval-gate.md'),
    executionPlanPath: path.join(outputDir, 'execution-plan.md'),
    commandManifestPath: path.join(outputDir, 'command-manifest.json'),
    summaryPath: path.join(outputDir, 'summary.md'),
};

writeFileSync(path.join(outputDir, 'approval-gate.md'), renderApprovalGate(), 'utf8');
writeFileSync(path.join(outputDir, 'execution-plan.md'), renderExecutionPlan(), 'utf8');
writeFileSync(path.join(outputDir, 'command-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target,
    executeRequested,
    externalWritePerformed,
    externalWriteAttempted,
    approvalEnvVar,
    directUrlEnvVar,
    envFileEnvVar,
    requiredSecretNames,
    commandShapes: [
        commands().whoami.display,
        commands().deployments.display,
        commands().secretList.display,
        secretPutCommand('SECRET_NAME').display,
    ],
    captures: captures.map((capture) => ({
        id: capture.id,
        command: capture.display,
        exitCode: capture.exitCode,
        status: capture.status,
        writesCloudflare: capture.writesCloudflare,
        outputPath: relative(capture.outputPath),
    })),
}, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summaryJson, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(status), 'utf8');

console.log(`[launch:cloudflare-production-fulfillment-secrets] Status: ${status}`);
console.log(`[launch:cloudflare-production-fulfillment-secrets] External write performed: ${String(externalWritePerformed)}`);
console.log(`[launch:cloudflare-production-fulfillment-secrets] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:cloudflare-production-fulfillment-secrets] Summary: ${path.join(outputDir, 'summary.md')}`);

if (checks.some((check) => check.status === 'failed')) process.exit(1);

async function executeApproved(): Promise<void> {
    const localGate = validateExecutionEnvironment();
    checks.push(localGate);
    if (localGate.status === 'failed') return;

    const staticCommands = commands();
    for (const command of [staticCommands.whoami, staticCommands.deployments, staticCommands.secretList]) {
        const capture = runCommand(command);
        captures.push(capture);
        checks.push(commandCheck(capture));
        if (capture.status === 'failed') return;
    }

    const whoami = captures.find((capture) => capture.id === staticCommands.whoami.id);
    const deployments = captures.find((capture) => capture.id === staticCommands.deployments.id);
    const versionId = deploymentVersionId(deployments);
    let accountMatched = false;
    let identityError = 'none';
    try {
        verifyCloudflareWhoamiOutput(captureText(whoami), target.accountId);
        accountMatched = true;
    } catch (error) {
        identityError = safeError(error);
    }
    const remoteGate: Check = {
        status: accountMatched && Boolean(versionId) ? 'ok' : 'failed',
        name: 'remote_target_pre_write_gate',
        message: accountMatched && Boolean(versionId)
            ? 'Read-only preflight proves the exact Cloudflare account, Fulfillment Worker and deployed version before secret writes.'
            : 'Read-only preflight did not prove the exact account/Worker/version; no secret write may start.',
        details: [
            `accountMatched=${String(accountMatched)}`,
            `targetWorker=${target.worker}`,
            `deploymentVersionPresent=${String(Boolean(versionId))}`,
            `identityError=${identityError}`,
        ],
    };
    checks.push(remoteGate);
    if (remoteGate.status === 'failed' || !versionId) return;

    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) return;
    checks.push(await directHealthProbe(directUrl));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await disabledOperationProbe(directUrl));
    if (checks.at(-1)?.status === 'failed') return;

    for (const name of requiredSecretNames) {
        const command = secretPutCommand(name);
        externalWriteAttempted = true;
        const capture = runCommand(command, `${secretValue(name)}\n`);
        captures.push(capture);
        checks.push(commandCheck(capture));
        if (capture.status === 'failed') return;
        externalWritePerformed = true;
    }

    const after = runCommand({ ...staticCommands.secretList, id: 'fulfillment-secret-list-after' });
    captures.push(after);
    checks.push(commandCheck(after));
    if (after.status === 'failed') return;
    const missingAfter = requiredSecretNames.filter((name) => !captureText(after).includes(name));
    checks.push({
        status: missingAfter.length === 0 ? 'ok' : 'failed',
        name: 'required_secret_names_present_after_write',
        message: missingAfter.length === 0
            ? 'All required Fulfillment Worker secret names are present after the approved writes.'
            : 'One or more Fulfillment Worker secret names are absent after the write phase.',
        details: missingAfter.length === 0 ? [`nameCount=${requiredSecretNames.length}`] : missingAfter.map((name) => `missing=${name}`),
    });
    if (missingAfter.length > 0) return;

    const deploymentsAfter = runCommand({ ...staticCommands.deployments, id: 'fulfillment-deployments-after-secrets' });
    captures.push(deploymentsAfter);
    checks.push(commandCheck(deploymentsAfter));
    if (deploymentsAfter.status === 'failed') return;
    const postWriteVersionId = deploymentVersionId(deploymentsAfter);
    if (!postWriteVersionId) {
        checks.push({
            status: 'failed',
            name: 'post_write_deployment_version',
            message: 'The final deployed Fulfillment Worker version could not be proven after secret writes.',
            details: [`targetWorker=${target.worker}`],
        });
        return;
    }

    checks.push(await directHealthProbe(directUrl));
    if (checks.at(-1)?.status === 'failed') return;
    checks.push(await directRuntimeAttestation(directUrl, postWriteVersionId));
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
        return {
            status: blocked ? 'ok' : 'failed',
            name: 'bootstrap_operational_block_pre_write',
            message: blocked
                ? 'Bootstrap rejects operational calls before secret writes.'
                : 'Bootstrap operational guard is not proven; no secret write may start.',
            details: [`httpStatus=${response.status}`],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'bootstrap_operational_block_pre_write',
            message: 'Bootstrap operational probe failed; no secret write may start.',
            details: [safeError(error)],
        };
    }
}

function validateExecutionEnvironment(): Check {
    const approvalMatched = process.env[approvalEnvVar]?.trim() === exactApprovalSentence;
    const missingNames = requiredSecretNames.filter((name) => !secretValue(name));
    const placeholders = requiredSecretNames.filter((name) => isPlaceholder(secretValue(name)));
    const dailyLimit = Number(process.env.EMAIL_DAILY_RECIPIENT_LIMIT);
    const monthlyLimit = Number(process.env.EMAIL_MONTHLY_RECIPIENT_LIMIT);
    const fromAddress = mailbox(secretValue('EMAIL_FROM'));
    const resendFromAddress = mailbox(secretValue('RESEND_FROM_EMAIL'));
    const mismatches = [
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() === target.accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
        process.env.SUPABASE_EXPECTED_PROJECT_REF?.trim() === target.supabaseRef ? null : 'SUPABASE_EXPECTED_PROJECT_REF',
        supabaseProjectRef(secretValue('PUBLIC_SUPABASE_URL')) === target.supabaseRef ? null : 'PUBLIC_SUPABASE_URL',
        process.env.PUBLIC_APP_ENV?.trim() === 'production' ? null : 'PUBLIC_APP_ENV',
        process.env.WORKER_IDENTITY?.trim() === target.identity ? null : 'WORKER_IDENTITY',
        normalizeOrigin(process.env.PUBLIC_SITE_URL) === target.site ? null : 'PUBLIC_SITE_URL',
        process.env.EMAIL_DELIVERY_MODE?.trim() === 'live' ? null : 'EMAIL_DELIVERY_MODE',
        Number.isSafeInteger(dailyLimit) && dailyLimit > 0 && dailyLimit <= 80 ? null : 'EMAIL_DAILY_RECIPIENT_LIMIT',
        Number.isSafeInteger(monthlyLimit) && monthlyLimit > 0 && monthlyLimit <= 2400 ? null : 'EMAIL_MONTHLY_RECIPIENT_LIMIT',
        fromAddress && fromAddress === resendFromAddress && fromAddress.endsWith('@espanolhonesto.com') ? null : 'EMAIL_FROM/RESEND_FROM_EMAIL',
        normalizeDirectUrl(process.env[directUrlEnvVar]) ? null : directUrlEnvVar,
    ].filter((value): value is string => Boolean(value));
    const ok = approvalMatched && missingNames.length === 0 && placeholders.length === 0 && mismatches.length === 0;

    return {
        status: ok ? 'ok' : 'failed',
        name: 'execution_environment_gate',
        message: ok
            ? 'Exact approval and account/ref/site/env/email/direct-URL identities match before any Cloudflare write.'
            : 'Approval, source values or account/ref/site/env/email/direct-URL identities are incomplete; no Cloudflare write may run.',
        details: [
            `approvalMatched=${String(approvalMatched)}`,
            `missingNames=${missingNames.join(', ') || 'none'}`,
            `placeholderNames=${placeholders.join(', ') || 'none'}`,
            `targetMismatches=${mismatches.join(', ') || 'none'}`,
            'externalWritePerformed=false',
        ],
    };
}

function validatePackageScript(): Check {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
    const expected = 'tsx scripts/launch/cloudflare-production-fulfillment-secrets.ts';
    const ok = packageJson.scripts?.['launch:cloudflare-production-fulfillment-secrets'] === expected;
    return {
        status: ok ? 'ok' : 'failed',
        name: 'package_script',
        message: ok ? 'Package exposes the dedicated Fulfillment production secret runner.' : 'Dedicated package script is missing.',
        details: ['launch:cloudflare-production-fulfillment-secrets'],
    };
}

function validateWranglerConfig(): Check {
    const source = existsSync(target.config) ? readFileSync(target.config, 'utf8') : '';
    const required = [
        'name = "espanol-honesto-fulfillment-env-required"',
        '[env.production_bootstrap]',
        'name = "espanol-honesto-fulfillment-production"',
        'NODE_ENV = "production"',
        'PUBLIC_APP_ENV = "production"',
        'SUPABASE_EXPECTED_PROJECT_REF = "vkkahxsybhbutszerawz"',
        'WORKER_IDENTITY = "espanol-honesto-fulfillment-production"',
        'PUBLIC_SITE_URL = "https://espanolhonesto.com"',
        'FULFILLMENT_RUNTIME_MODE = "bootstrap"',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
        'CHECKOUT_ENABLED = "false"',
        '[env.production_bootstrap.triggers]',
        'crons = []',
        '[env.production]',
        'FULFILLMENT_RUNTIME_MODE = "active"',
        'EMAIL_DELIVERY_MODE = "live"',
        'crons = ["0 * * * *"]',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'fulfillment_production_config',
        message: missing.length === 0
            ? 'Fulfillment config keeps the secret-loading phase on the inert bootstrap and separates final active email/cron.'
            : 'Fulfillment production config is incomplete or its base name is unsafe.',
        details: missing.length === 0 ? [target.config] : missing.map((snippet) => `missing=${snippet}`),
    };
}

async function directHealthProbe(baseUrl: string): Promise<Check> {
    const url = new URL('/health', baseUrl).toString();
    try {
        const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000) });
        const body = await response.json() as { ok?: unknown; service?: unknown; operationMode?: unknown; workerIdentity?: unknown };
        const ok = response.status === 200
            && body.ok === true
            && body.service === 'fulfillment-worker'
            && body.operationMode === 'bootstrap'
            && body.workerIdentity === target.identity;
        writeFileSync(path.join(outputDir, 'direct-health-probe.txt'), [
            `url=${url}`,
            `httpStatus=${response.status}`,
            `serviceMatched=${String(body.service === 'fulfillment-worker')}`,
            `operationMode=${String(body.operationMode ?? 'missing')}`,
            `workerIdentityMatched=${String(body.workerIdentity === target.identity)}`,
            `status=${ok ? 'ok' : 'failed'}`,
        ].join('\n'), 'utf8');
        return {
            status: ok ? 'ok' : 'failed',
            name: 'direct_fulfillment_health_probe',
            message: ok ? 'Direct Fulfillment Worker health probe passed.' : 'Direct Fulfillment Worker health probe failed.',
            details: [`url=${url}`, `httpStatus=${response.status}`],
        };
    } catch (error) {
        return { status: 'failed', name: 'direct_fulfillment_health_probe', message: 'Direct health probe failed.', details: [safeError(error)] };
    }
}

async function directRuntimeAttestation(baseUrl: string, expectedVersionId: string): Promise<Check> {
    const url = new URL('/internal/runtime-attestation', baseUrl).toString();
    const nonce = randomUUID();
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretValue('INTERNAL_JOB_SECRET')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nonce }),
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const raw = await response.text();
        const envelope = JSON.parse(raw) as RuntimeAttestationEnvelope;
        const config = await buildRuntimeAttestationConfig('fulfillment', {
            ...Object.fromEntries(requiredSecretNames.map((name) => [name, secretValue(name)])),
            PUBLIC_APP_ENV: 'production',
            SUPABASE_EXPECTED_PROJECT_REF: target.supabaseRef,
            WORKER_IDENTITY: target.identity,
            WORKER_VERSION_ID: expectedVersionId,
            PUBLIC_SITE_URL: target.site,
            FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            EMAIL_DELIVERY_MODE: 'disabled',
            EMAIL_DAILY_RECIPIENT_LIMIT: '0',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
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
        writeFileSync(path.join(outputDir, 'direct-runtime-attestation.txt'), [
            `url=${url}`,
            `httpStatus=${response.status}`,
            `workerIdentity=${envelope.workerIdentity ?? 'missing'}`,
            `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
            `supabaseExpectedProjectRef=${target.supabaseRef}`,
            `proofVerified=${String(verified)}`,
            '',
            'No secret value, attestation proof or response body is stored.',
        ].join('\n'), 'utf8');
        return {
            status: verified ? 'ok' : 'failed',
            name: 'direct_fulfillment_runtime_attestation',
            message: verified
                ? 'Direct probe attests the exact Fulfillment Worker identity, version and production Supabase configuration.'
                : 'Direct probe did not attest the exact Fulfillment Worker identity/version/Supabase configuration.',
            details: [
                `workerIdentity=${envelope.workerIdentity ?? 'missing'}`,
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
                `supabaseExpectedProjectRef=${target.supabaseRef}`,
            ],
        };
    } catch (error) {
        return { status: 'failed', name: 'direct_fulfillment_runtime_attestation', message: 'Direct runtime attestation failed.', details: [safeError(error)] };
    }
}

function commands(): { whoami: CommandSpec; deployments: CommandSpec; secretList: CommandSpec } {
    return {
        whoami: {
            id: 'wrangler-whoami',
            display: 'pnpm --config.verify-deps-before-run=false exec wrangler whoami --json',
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'whoami', '--json'],
            writesCloudflare: false,
        },
        deployments: {
            id: 'fulfillment-deployments-list',
            display: `pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name ${target.worker} --json`,
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', target.worker, '--json'],
            writesCloudflare: false,
        },
        secretList: {
            id: 'fulfillment-secret-list-before',
            display: `pnpm --config.verify-deps-before-run=false exec wrangler secret list --config ${target.config} --env production_bootstrap --format json`,
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--config', target.config, '--env', 'production_bootstrap', '--format', 'json'],
            writesCloudflare: false,
        },
    };
}

function secretPutCommand(name: string): CommandSpec {
    return {
        id: `fulfillment-secret-put-${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
        display: `pnpm --config.verify-deps-before-run=false exec wrangler secret put ${name} --config ${target.config} --env production_bootstrap`,
        args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'put', name, '--config', target.config, '--env', 'production_bootstrap'],
        writesCloudflare: true,
    };
}

function runCommand(command: CommandSpec, input?: string): CommandCapture {
    const result = spawnSync(pnpmCommand(), command.args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: process.env,
        input,
        timeout: 120_000,
        windowsHide: true,
        shell: process.platform === 'win32',
    });
    const stdout = sanitize(result.stdout ?? '');
    const stderr = sanitize(result.stderr ?? '');
    const status: CheckStatus = result.status === 0 && !result.error ? 'ok' : 'failed';
    const outputPath = path.join(outputDir, `${command.id}.txt`);
    writeFileSync(outputPath, [
        `command=${command.display}`,
        `writesCloudflare=${String(command.writesCloudflare)}`,
        `exitCode=${String(result.status)}`,
        `status=${status}`,
        '',
        '# stdout',
        stdout || '(empty)',
        '',
        '# stderr',
        stderr || '(empty)',
    ].join('\n'), 'utf8');
    return { id: command.id, display: command.display, outputPath, exitCode: result.status, status, writesCloudflare: command.writesCloudflare };
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function commandCheck(capture: CommandCapture): Check {
    return {
        status: capture.status,
        name: `command_${capture.id}`,
        message: capture.status === 'ok' ? 'Command completed.' : 'Command failed or timed out.',
        details: [`command=${capture.display}`, `writesCloudflare=${String(capture.writesCloudflare)}`, `capture=${relative(capture.outputPath)}`],
    };
}

function deploymentVersionId(capture: CommandCapture | undefined): string | null {
    return /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(captureText(capture))?.[1] ?? null;
}

function captureText(capture: CommandCapture | undefined): string {
    return capture && existsSync(capture.outputPath) ? readFileSync(capture.outputPath, 'utf8') : '';
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

function normalizeOrigin(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.origin : null;
    } catch {
        return null;
    }
}

function normalizeDirectUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== target.directHost || url.port || url.username || url.password) return null;
        return `${url.origin}/`;
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

function renderApprovalGate(): string {
    return `${[
        '# Cloudflare Fulfillment Worker Production Secrets Approval Gate',
        '',
        'This file is not approval.',
        '',
        `- Required flag: \`--execute-approved\`.`,
        `- Exact approval environment variable: \`${approvalEnvVar}\`.`,
        `- Dedicated secure env-file selector: \`${envFileEnvVar}\` (defaults to ignored \`.env.production\`).`,
        `- Required exact direct URL variable: \`${directUrlEnvVar}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Forbidden Scope',
        '',
        '- No deploy, Worker creation/deletion, route, domain, DNS or Pages write.',
        '- No web Worker secret write.',
        '- No email send, Google mutation, job processing, Supabase write or Stripe operation.',
        '- No secret value in output, logs, screenshots, shell history or repository files.',
        '',
    ].join('\n')}\n`;
}

function renderExecutionPlan(): string {
    return `${[
        '# Cloudflare Fulfillment Worker Production Secrets/Config/Email Plan',
        '',
        'This route is deliberately separate from the web Worker secret phase and from domain cutover.',
        '',
        '1. Confirm the exact-name `production_bootstrap` is deployed with runtime bootstrap, email disabled and no cron.',
        '2. Run Wrangler whoami/deployment/secret-list read-only checks for the exact account and Worker.',
        '3. After the exact gate only, load the allowlisted secret names via stdin.',
        '4. Verify names only; never read or store values from Cloudflare.',
        '5. Probe `/health` and verify the authenticated runtime attestation still says bootstrap/disabled after secret writes.',
        '6. Final email/jobs/cron activation requires the separate `pnpm launch:cloudflare-production-fulfillment-enable` gate.',
        '',
        `Plan command: \`pnpm launch:cloudflare-production-fulfillment-secrets\`.`,
        `Approved command: \`pnpm launch:cloudflare-production-fulfillment-secrets -- --execute-approved\`.`,
        '',
    ].join('\n')}\n`;
}

function renderSummary(status: string): string {
    return `${[
        '# Cloudflare Production Fulfillment Secrets Summary',
        '',
        `- Status: ${status}`,
        `- Execute requested: ${String(executeRequested)}`,
        `- External write performed: ${String(externalWritePerformed)}`,
        `- External write attempted: ${String(externalWriteAttempted)}`,
        `- Target account: ${target.accountId}`,
        `- Target Worker: ${target.worker}`,
        `- Config: ${target.config}`,
        '',
        'Plan mode is local-only. Execution requires the exact approval plus local and remote target validation before the first secret write.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
    ].join('\n')}\n`;
}

function sanitize(value: string): string {
    const privateKey = new RegExp('-----BEGIN [A-Z ]+' + 'PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]+' + 'PRIVATE KEY-----', 'gu');
    let sanitized = value
        .replace(privateKey, '[redacted-private-key]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{12,}/gu, 'sk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]{12,}/gu, 'whsec_[redacted]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{12,}/gu, 're_[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]');

    const knownValues = new Set([
        ...requiredSecretNames.map((name) => secretValue(name)),
        process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '',
    ]);
    for (const knownValue of knownValues) {
        if (knownValue) {
            sanitized = sanitized.replaceAll(knownValue, '[redacted-known-value]');
        }
    }
    return sanitized;
}

function safeError(error: unknown): string {
    return sanitize(error instanceof Error ? error.message : String(error)).replace(/\r?\n/gu, ' ').slice(0, 400);
}

function relative(filePath: string): string {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}
