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
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    openOneShotCloudflareWriteGuard,
    reconcileOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
} from './cloudflare-production-one-shot-write';

type CheckStatus = 'ok' | 'failed';

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
} as const;

const approvalEnvVar = 'CLOUDFLARE_FULFILLMENT_BOOTSTRAP_SECRETS_APPROVAL';
const directUrlEnvVar = 'CLOUDFLARE_FULFILLMENT_DIRECT_URL';
const envFileEnvVar = 'CLOUDFLARE_FULFILLMENT_BOOTSTRAP_ENV_FILE';
const exactApprovalSentence = 'Apruebo configurar/verificar unicamente `INTERNAL_JOB_SECRET` en el Cloudflare Fulfillment Worker production inerte `espanol-honesto-fulfillment-production` de la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`, usando `production_bootstrap`, despues de validar la cuenta, el Worker, la URL directa, el bloqueo 503 y cron vacio; no autorizo cargar Supabase, Google, Resend, email, cron ni otros secrets, no autorizo jobs, emails, deploy activo, Worker web, dominios ni DNS.';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar]?.trim() === exactApprovalSentence;

const requiredSecretNames = [
    'INTERNAL_JOB_SECRET',
] as const;

const explicitlyWithheldSecretNames = [
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'RESEND_FROM_EMAIL',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'CRON_SECRET',
] as const;
const requiredSecretNameSet = new Set<string>(requiredSecretNames);
const explicitlyWithheldSecretNameSet = new Set<string>(explicitlyWithheldSecretNames);

const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-cloudflare-production-fulfillment-bootstrap-secrets',
    stamp(startedAt),
);
mkdirSync(outputDir, { recursive: true });

const checks: Check[] = [validatePackageScript(), validateWranglerConfig()];
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
let externalWritePerformed: boolean | 'unknown' = false;

if (executeRequested && checks.some((check) => check.status === 'failed')) {
    checks.push(failed('initial_validation_gate', 'Local safety validation failed; no Cloudflare command ran.', [
        'externalWriteAttempted=false',
    ]));
} else if (executeRequested && !approvalMatched) {
    checks.push(failed('exact_approval_gate', 'Execution was requested without the exact pre-loaded approval.', [
        `env=${approvalEnvVar}`,
        'approvalMatchedBeforeEnvFile=false',
        'externalWriteAttempted=false',
    ]));
} else if (executeRequested) {
    dotenv.config({
        path: process.env[envFileEnvVar]?.trim() || '.env.production',
        override: false,
        quiet: true,
    });
    await runApprovedExecution();
} else {
    checks.push(ok('plan_mode_no_external_write', 'Plan mode generated local evidence only.', [
        'executeRequested=false',
        'externalWritePerformed=false',
        `futureGate=${approvalEnvVar}`,
    ]));
}

const status = checks.some((check) => check.status === 'failed') ? 'FAILED' : 'OK';
const summary = renderSummary(status);
writeFileSync(path.join(outputDir, 'approval-gate.md'), renderApprovalGate(), 'utf8');
writeFileSync(path.join(outputDir, 'execution-plan.md'), renderExecutionPlan(), 'utf8');
writeFileSync(path.join(outputDir, 'command-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target,
    executeRequested,
    approvalMatched,
    externalWriteAttempted,
    externalWritePerformed,
    approvalEnvVar,
    directUrlEnvVar,
    envFileEnvVar,
    requiredSecretNames,
    explicitlyWithheldSecretNames,
    commands: captures.map((capture) => ({
        id: capture.id,
        display: capture.display,
        writesCloudflare: capture.writesCloudflare,
        status: capture.status,
        outputPath: relative(capture.outputPath),
    })),
}, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    executeRequested,
    approvalMatched,
    externalWriteAttempted,
    externalWritePerformed,
    target,
    checks,
    captures: captures.map((capture) => ({ ...capture, outputPath: relative(capture.outputPath) })),
}, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), summary, 'utf8');

console.log(`[launch:cloudflare-production-fulfillment-bootstrap-secrets] Status: ${status}`);
console.log(`[launch:cloudflare-production-fulfillment-bootstrap-secrets] External write performed: ${String(externalWritePerformed)}`);
console.log(`[launch:cloudflare-production-fulfillment-bootstrap-secrets] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:cloudflare-production-fulfillment-bootstrap-secrets] Summary: ${path.join(outputDir, 'summary.md')}`);

if (status === 'FAILED') process.exit(1);

async function runApprovedExecution(): Promise<void> {
    const localGate = validateExecutionEnvironment();
    checks.push(localGate);
    if (localGate.status === 'failed') return;

    const commandSet = commands();
    for (const command of [commandSet.whoami, commandSet.deployments, commandSet.secretList]) {
        const capture = runCommand(command);
        captures.push(capture);
        checks.push(commandCheck(capture));
        if (capture.status === 'failed') return;
    }

    const whoami = captureById(commandSet.whoami.id);
    const deployments = captureById(commandSet.deployments.id);
    const secretListBefore = captureById(commandSet.secretList.id);
    const versionBefore = deploymentVersionId(deployments);
    let accountMatched = false;
    let identityError = 'none';
    try {
        verifyCloudflareWhoamiOutput(captureText(whoami), target.accountId);
        accountMatched = true;
    } catch (error) {
        identityError = safeError(error);
    }
    const remoteTargetOk = accountMatched && Boolean(versionBefore);
    checks.push(remoteTargetOk
        ? ok('remote_target_pre_write_gate', 'Read-only evidence proves the exact account, Worker and version.', [
            `account=${target.accountId}`,
            `worker=${target.worker}`,
            `version=${versionBefore}`,
        ])
        : failed('remote_target_pre_write_gate', 'Exact remote account/Worker/version was not proven.', [
            `accountMatched=${String(accountMatched)}`,
            `identityError=${identityError}`,
            'externalWriteAttempted=false',
        ]));
    if (!remoteTargetOk || !versionBefore || !secretListBefore) return;

    const beforeShape = validateMinimalSecretShape(secretListBefore, false, 'before_write');
    checks.push(beforeShape);
    if (beforeShape.status === 'failed') return;

    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) return;
    for (const probe of [await directHealthProbe(directUrl), await disabledOperationProbe(directUrl), await noCronProbe()]) {
        checks.push(probe);
        if (probe.status === 'failed') return;
    }

    const reconciliation = await reconcileOneShotCloudflareWriteGuard(
        'fulfillment-bootstrap-hmac-secret',
        outputDir,
        {
            readback: async (checkpoint) => {
                if (checkpoint && checkpoint.commandId !== 'fulfillment-bootstrap-secret-put-internal-job-secret') return false;
                const secretShape = validateMinimalSecretShape(secretListBefore, true, 'reconciliation');
                checks.push(secretShape);
                if (secretShape.status === 'failed') return false;
                const attestation = await directRuntimeAttestation(directUrl, versionBefore);
                checks.push(attestation);
                return attestation.status === 'ok';
            },
        },
    );
    if (reconciliation.status !== 'not_needed') {
        checks.push(reconciliation.status === 'reconciled'
            ? ok('bootstrap_hmac_readonly_reconciliation', 'Fresh secret-name and HMAC readbacks proved the interrupted secret write; checkpoint and stale lock were cleared without repeating secret put.', [
                `checkpointCount=${reconciliation.checkpointCount}`,
                `lockOnly=${String(reconciliation.lockOnly)}`,
                'secretPutRetried=false',
            ])
            : failed('bootstrap_hmac_readonly_reconciliation', 'Fresh readbacks did not prove the interrupted HMAC write; checkpoint/lock remain fail-closed and secret put was not retried.', [
                `reason=${reconciliation.reason}`,
                'secretPutRetried=false',
            ]));
        return;
    }

    let writeGuard: ReturnType<typeof openOneShotCloudflareWriteGuard>;
    try {
        writeGuard = openOneShotCloudflareWriteGuard('fulfillment-bootstrap-hmac-secret', outputDir);
    } catch (error) {
        checks.push(failed('bootstrap_hmac_write_lock', 'An unresolved HMAC write or lock blocks retry until read-only reconciliation.', [
            safeError(error),
            'externalWriteAttempted=false',
        ]));
        return;
    }
    const name = requiredSecretNames[0];
    const command = secretPutCommand(name);
    let writeCheckpoint = beginOneShotCloudflareWrite(writeGuard, command.id);
    externalWriteAttempted = true;
    externalWritePerformed = 'unknown';
    const capture = runCommand(command, `${secretValue(name)}\n`);
    writeCheckpoint = recordOneShotCloudflareProviderResult(writeGuard, writeCheckpoint, {
        exitCode: capture.exitCode,
        timedOut: capture.exitCode === null,
        errorPresent: capture.status === 'failed',
    });
    captures.push(capture);
    checks.push(commandCheck(capture));
    if (capture.status === 'failed') return;

    const secretListAfter = runCommand({ ...commandSet.secretList, id: 'fulfillment-bootstrap-secret-list-after' });
    captures.push(secretListAfter);
    checks.push(commandCheck(secretListAfter));
    if (secretListAfter.status === 'failed') {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        return;
    }
    const afterShape = validateMinimalSecretShape(secretListAfter, true, 'after_write');
    checks.push(afterShape);
    if (afterShape.status === 'failed') {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        return;
    }

    const deploymentsAfter = runCommand({ ...commandSet.deployments, id: 'fulfillment-bootstrap-deployments-after-secret' });
    captures.push(deploymentsAfter);
    checks.push(commandCheck(deploymentsAfter));
    const versionAfter = deploymentVersionId(deploymentsAfter);
    if (deploymentsAfter.status === 'failed' || !versionAfter) {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        checks.push(failed('post_write_deployment_version', 'The version created by the minimal secret write was not proven.', []));
        return;
    }

    for (const probe of [
        await directHealthProbe(directUrl),
        await disabledOperationProbe(directUrl),
        await directRuntimeAttestation(directUrl, versionAfter),
        await noCronProbe(),
    ]) {
        checks.push(probe);
        if (probe.status === 'failed') {
            recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
            return;
        }
    }
    writeCheckpoint = recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, true);
    closeOneShotCloudflareWriteGuard(writeGuard);
    externalWritePerformed = true;
    checks.push(ok('bootstrap_hmac_write_checkpoint_resolved', 'The HMAC-only secret write is proven remotely and its durable checkpoint is resolved.', [
        `checkpointStage=${writeCheckpoint.stage}`,
    ]));
}

function validateExecutionEnvironment(): Check {
    const secret = secretValue('INTERNAL_JOB_SECRET');
    const mismatches = [
        approvalMatched ? null : approvalEnvVar,
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() === target.accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
        process.env.PUBLIC_APP_ENV?.trim() === 'production' ? null : 'PUBLIC_APP_ENV',
        process.env.SUPABASE_EXPECTED_PROJECT_REF?.trim() === target.supabaseRef ? null : 'SUPABASE_EXPECTED_PROJECT_REF',
        process.env.WORKER_IDENTITY?.trim() === target.worker ? null : 'WORKER_IDENTITY',
        normalizeOrigin(process.env.PUBLIC_SITE_URL) === target.site ? null : 'PUBLIC_SITE_URL',
        normalizeDirectUrl(process.env[directUrlEnvVar]) ? null : directUrlEnvVar,
        process.env.CLOUDFLARE_API_TOKEN?.trim() ? null : 'CLOUDFLARE_API_TOKEN',
        secret && !isPlaceholder(secret) ? null : 'INTERNAL_JOB_SECRET',
    ].filter((value): value is string => Boolean(value));
    return mismatches.length === 0
        ? ok('execution_environment_gate', 'Only the exact HMAC bootstrap input and target facts are required.', [
            'requiredSecretNames=INTERNAL_JOB_SECRET',
            `withheld=${explicitlyWithheldSecretNames.join(',')}`,
        ])
        : failed('execution_environment_gate', 'Approval, HMAC input, remote-read token or target facts are incomplete.', [
            `mismatches=${mismatches.join(',') || 'none'}`,
            'externalWritePerformed=false',
        ]);
}

function validatePackageScript(): Check {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> };
    const expected = 'tsx scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts';
    const matches = packageJson.scripts?.['launch:cloudflare-production-fulfillment-bootstrap-secrets'] === expected;
    return matches
        ? ok('package_script', 'Package exposes the minimal fulfillment bootstrap secret runner.', [expected])
        : failed('package_script', 'The minimal fulfillment bootstrap secret package script is missing.', [expected]);
}

function validateWranglerConfig(): Check {
    const source = existsSync(target.config) ? readFileSync(target.config, 'utf8') : '';
    const bootstrapStart = source.indexOf('[env.production_bootstrap]');
    const activeStart = source.indexOf('[env.production]');
    const bootstrap = bootstrapStart >= 0 && activeStart > bootstrapStart
        ? source.slice(bootstrapStart, activeStart)
        : '';
    const required = [
        'name = "espanol-honesto-fulfillment-production"',
        'FULFILLMENT_RUNTIME_MODE = "bootstrap"',
        'EMAIL_DELIVERY_MODE = "disabled"',
        'EMAIL_DAILY_RECIPIENT_LIMIT = "0"',
        'EMAIL_MONTHLY_RECIPIENT_LIMIT = "0"',
        '[env.production_bootstrap.triggers]',
        'crons = []',
    ];
    const missing = required.filter((snippet) => !bootstrap.includes(snippet));
    return missing.length === 0
        ? ok('fulfillment_bootstrap_config', 'Wrangler keeps fulfillment runtime, email and cron inert.', [target.config])
        : failed('fulfillment_bootstrap_config', 'Wrangler bootstrap posture is incomplete.', missing.map((item) => `missing=${item}`));
}

function validateMinimalSecretShape(capture: CommandCapture, requireHmac: boolean, phase: string): Check {
    const checkName = phase === 'before_write'
        ? 'minimal_bootstrap_secret_shape_before_write'
        : 'minimal_bootstrap_secret_shape_after_write';
    const parsed = extractSecretNames(captureText(capture));
    const withheld = [...parsed.names].filter((name) => explicitlyWithheldSecretNameSet.has(name));
    const unexpected = [...parsed.names].filter((name) => !requiredSecretNameSet.has(name));
    const hmacPresent = parsed.names.has('INTERNAL_JOB_SECRET');
    const valid = parsed.parsed && withheld.length === 0 && unexpected.length === 0 && (!requireHmac || hmacPresent);
    return valid
        ? ok(checkName, 'Remote secret names remain HMAC-only.', [
            `secretCount=${parsed.names.size}`,
            `hmacPresent=${String(hmacPresent)}`,
            'providers=absent',
        ])
        : failed(checkName, 'Remote secret names are not the minimal bootstrap set.', [
            `parsed=${String(parsed.parsed)}`,
            `withheld=${withheld.join(',') || 'none'}`,
            `unexpected=${unexpected.join(',') || 'none'}`,
            `hmacPresent=${String(hmacPresent)}`,
        ]);
}

async function directHealthProbe(baseUrl: string): Promise<Check> {
    try {
        const response = await fetch(new URL('/health', baseUrl), {
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json() as { ok?: unknown; operationMode?: unknown; workerIdentity?: unknown };
        const healthy = response.status === 200
            && body.ok === true
            && body.operationMode === 'bootstrap'
            && body.workerIdentity === target.worker;
        return healthy
            ? ok('direct_fulfillment_bootstrap_health', 'Direct health proves the exact inert fulfillment Worker.', [`httpStatus=${response.status}`])
            : failed('direct_fulfillment_bootstrap_health', 'Direct health did not prove the inert fulfillment Worker.', [`httpStatus=${response.status}`]);
    } catch (error) {
        return failed('direct_fulfillment_bootstrap_health', 'Direct health probe failed.', [safeError(error)]);
    }
}

async function disabledOperationProbe(baseUrl: string): Promise<Check> {
    try {
        const response = await fetch(new URL('/internal/jobs/process', baseUrl), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json() as { errorCode?: unknown };
        const blocked = response.status === 503 && body.errorCode === 'FULFILLMENT_DISABLED';
        return blocked
            ? ok('bootstrap_operational_block', 'Operational routes remain blocked before and after HMAC loading.', [`httpStatus=${response.status}`])
            : failed('bootstrap_operational_block', 'Operational route did not remain blocked.', [`httpStatus=${response.status}`]);
    } catch (error) {
        return failed('bootstrap_operational_block', 'Operational block probe failed.', [safeError(error)]);
    }
}

async function directRuntimeAttestation(baseUrl: string, expectedVersionId: string): Promise<Check> {
    const nonce = randomUUID();
    try {
        const response = await fetch(new URL('/internal/runtime-attestation', baseUrl), {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretValue('INTERNAL_JOB_SECRET')}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nonce }),
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const envelope = await response.json() as RuntimeAttestationEnvelope;
        const config = await buildRuntimeAttestationConfig('fulfillment', {
            INTERNAL_JOB_SECRET: secretValue('INTERNAL_JOB_SECRET'),
            PUBLIC_APP_ENV: 'production',
            SUPABASE_EXPECTED_PROJECT_REF: target.supabaseRef,
            WORKER_IDENTITY: target.worker,
            WORKER_VERSION_ID: expectedVersionId,
            PUBLIC_SITE_URL: target.site,
            FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            EMAIL_DELIVERY_MODE: 'disabled',
            EMAIL_DAILY_RECIPIENT_LIMIT: '0',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });
        const providersAbsent = config.googleBoundary === 'absent'
            && config.googleServiceAccountFingerprint === 'absent'
            && config.googlePrivateKeyFingerprint === 'absent'
            && config.googleAdminFingerprint === 'absent'
            && config.googleDriveRootFingerprint === 'absent'
            && config.googleTemplateFingerprint === 'absent'
            && config.supabaseUrlFingerprint === 'absent'
            && config.supabaseServiceRoleFingerprint === 'absent'
            && config.resendApiKeyFingerprint === 'absent'
            && config.resendAllowlistFingerprint === 'absent'
            && config.resendSenderFingerprint === 'absent'
            && config.cronSecretFingerprint === 'absent';
        const verified = response.status === 200
            && providersAbsent
            && envelope.workerVersionId === expectedVersionId
            && envelope.workerIdentity === target.worker
            && await verifyRuntimeAttestation(envelope, {
                config,
                nonce,
                role: 'fulfillment',
                schema: RUNTIME_ATTESTATION_SCHEMA,
            }, secretValue('INTERNAL_JOB_SECRET'));
        return verified
            ? ok('direct_fulfillment_bootstrap_hmac_attestation', 'Version-bound HMAC proves all active providers absent.', [
                `workerVersion=${expectedVersionId}`,
                'googleBoundary=absent',
                'supabase=absent',
                'resend=absent',
                'cronSecret=absent',
            ])
            : failed('direct_fulfillment_bootstrap_hmac_attestation', 'HMAC did not prove the exact provider-free bootstrap.', [
                `httpStatus=${response.status}`,
                `providersAbsent=${String(providersAbsent)}`,
                `workerVersionMatched=${String(envelope.workerVersionId === expectedVersionId)}`,
            ]);
    } catch (error) {
        return failed('direct_fulfillment_bootstrap_hmac_attestation', 'Runtime attestation failed.', [safeError(error)]);
    }
}

async function noCronProbe(): Promise<Check> {
    if (!process.env.CLOUDFLARE_API_TOKEN?.trim()) {
        return failed('fulfillment_bootstrap_no_cron', 'Remote Cron state cannot be proven without the Cloudflare API token.', [
            'verificationMode=remote_api_required',
            'configFallbackAccepted=false',
        ]);
    }
    try {
        const response = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}/schedules`,
            {
                headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
                redirect: 'error',
                signal: AbortSignal.timeout(20_000),
            },
        );
        const body = await response.json() as { success?: unknown; result?: unknown[] };
        const noCron = response.status === 200
            && body.success === true
            && Array.isArray(body.result)
            && body.result.length === 0;
        return noCron
            ? ok('fulfillment_bootstrap_no_cron', 'Cloudflare schedules API proves zero Cron Triggers.', ['scheduleCount=0'])
            : failed('fulfillment_bootstrap_no_cron', 'Zero Cron Triggers were not proven.', [`httpStatus=${response.status}`]);
    } catch (error) {
        return failed('fulfillment_bootstrap_no_cron', 'Cloudflare schedules probe failed.', [safeError(error)]);
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
            id: 'fulfillment-bootstrap-deployments-list',
            display: `pnpm --config.verify-deps-before-run=false exec wrangler deployments list --name ${target.worker} --json`,
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'deployments', 'list', '--name', target.worker, '--json'],
            writesCloudflare: false,
        },
        secretList: {
            id: 'fulfillment-bootstrap-secret-list-before',
            display: `pnpm --config.verify-deps-before-run=false exec wrangler secret list --config ${target.config} --env production_bootstrap --format json`,
            args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', 'secret', 'list', '--config', target.config, '--env', 'production_bootstrap', '--format', 'json'],
            writesCloudflare: false,
        },
    };
}

function secretPutCommand(name: (typeof requiredSecretNames)[number]): CommandSpec {
    return {
        id: `fulfillment-bootstrap-secret-put-${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
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
    const stdout = sanitize(String(result.stdout ?? ''));
    const stderr = sanitize(String(result.stderr ?? ''));
    const status: CheckStatus = result.status === 0 && !result.error ? 'ok' : 'failed';
    const outputPath = path.join(outputDir, `${command.id}.txt`);
    writeFileSync(outputPath, [
        `command=${command.display}`,
        `writesCloudflare=${String(command.writesCloudflare)}`,
        `exitCode=${String(result.status)}`,
        `status=${status}`,
        '',
        '## stdout',
        stdout || '(empty)',
        '',
        '## stderr',
        stderr || '(empty)',
    ].join('\n'), 'utf8');
    return { id: command.id, display: command.display, outputPath, exitCode: result.status, status, writesCloudflare: command.writesCloudflare };
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function validateSecretName(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function extractSecretNames(text: string): { parsed: boolean; names: Set<string> } {
    const names = new Set<string>();
    const json = text.match(/\[\s*\{[\s\S]*?\}\s*\]/u)?.[0] ?? text.match(/\[\s*\]/u)?.[0];
    if (!json) return { parsed: false, names };
    try {
        const parsed: unknown = JSON.parse(json);
        if (!Array.isArray(parsed)) return { parsed: false, names };
        for (const item of parsed) {
            if (item && typeof item === 'object' && 'name' in item && validateSecretName(item.name)) names.add(item.name);
        }
        return { parsed: true, names };
    } catch {
        return { parsed: false, names };
    }
}

function commandCheck(capture: CommandCapture): Check {
    return capture.status === 'ok'
        ? ok(`command_${capture.id}`, 'Command completed.', [`writesCloudflare=${String(capture.writesCloudflare)}`])
        : failed(`command_${capture.id}`, 'Command failed or timed out.', [
            `capture=${relative(capture.outputPath)}`,
            `writesCloudflare=${String(capture.writesCloudflare)}`,
        ]);
}

function captureById(id: string): CommandCapture | undefined {
    return captures.find((capture) => capture.id === id);
}

function captureText(capture: CommandCapture | undefined): string {
    return capture && existsSync(capture.outputPath) ? readFileSync(capture.outputPath, 'utf8') : '';
}

function deploymentVersionId(capture: CommandCapture | undefined): string | null {
    return /"version_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/iu.exec(captureText(capture))?.[1] ?? null;
}

function secretValue(name: (typeof requiredSecretNames)[number]): string {
    return process.env[name]?.trim() ?? '';
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

function normalizeOrigin(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.origin : null;
    } catch {
        return null;
    }
}

function isPlaceholder(value: string): boolean {
    return /replace[-_ ]?me|change[-_ ]?me|placeholder|your[-_ ]?key|^test$/iu.test(value);
}

function sanitize(value: string): string {
    let sanitized = value
        .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gu, '[redacted-private-key]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]');
    for (const raw of [
        secretValue('INTERNAL_JOB_SECRET'),
        process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '',
        ...explicitlyWithheldSecretNames.map((name) => process.env[name]?.trim() ?? ''),
    ]) {
        if (raw) sanitized = sanitized.replaceAll(raw, '[redacted-known-value]');
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

function renderApprovalGate(): string {
    return `${[
        '# Cloudflare Fulfillment Production Bootstrap Secret Approval Gate',
        '',
        'This file is not approval.',
        '',
        `- Required flag: \`--execute-approved\`.`,
        `- Exact approval variable: \`${approvalEnvVar}\`.`,
        `- Secure env-file selector: \`${envFileEnvVar}\`.`,
        `- Exact direct URL variable: \`${directUrlEnvVar}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        exactApprovalSentence,
        '',
        '## Allowed Secret Name',
        '',
        '- `INTERNAL_JOB_SECRET` only.',
        '',
        '## Explicitly Withheld Until Final Active Preparation',
        '',
        ...explicitlyWithheldSecretNames.map((name) => `- \`${name}\`.`),
        '',
        'No deploy, active runtime, jobs, email, Google, Supabase, Resend, web Worker, domain or DNS write is authorized.',
    ].join('\n')}\n`;
}

function renderExecutionPlan(): string {
    return `${[
        '# Minimal Fulfillment Bootstrap Secret Plan',
        '',
        '1. Prove the exact account, Worker, bootstrap health, operational 503 and zero Cron Triggers.',
        '2. Reject any remote secret name except an existing `INTERNAL_JOB_SECRET`.',
        '3. After the exact gate, write only `INTERNAL_JOB_SECRET` via stdin.',
        '4. Re-list names and require exactly the single HMAC secret.',
        '5. Re-probe health, 503, zero cron and a version-bound HMAC attestation.',
        '6. Require Supabase, Google, Resend, sender and cron-secret fingerprints to remain absent.',
        '',
        'Full provider secret loading stays in `pnpm launch:cloudflare-production-fulfillment-secrets` for final active preparation.',
    ].join('\n')}\n`;
}

function renderSummary(status: string): string {
    return `${[
        '# Cloudflare Production Fulfillment Bootstrap Secrets Summary',
        '',
        `- Status: ${status}`,
        `- Execute requested: ${String(executeRequested)}`,
        `- Approval matched before env-file load: ${String(approvalMatched)}`,
        `- External write performed: ${String(externalWritePerformed)}`,
        `- External write attempted: ${String(externalWriteAttempted)}`,
        `- Target account: ${target.accountId}`,
        `- Target Worker: ${target.worker}`,
        '- Allowed secret: INTERNAL_JOB_SECRET',
        '- Active providers: withheld',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
    ].join('\n')}\n`;
}

function relative(filePath: string): string {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(value: Date): string {
    return value.toISOString().replace(/[:.]/gu, '-');
}
