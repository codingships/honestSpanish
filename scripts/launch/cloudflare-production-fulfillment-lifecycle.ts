import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';
import { parseMixedJsonOutput, verifyCloudflareWhoamiOutput } from '../ci/verify-cloudflare-identity';
import {
    PRODUCTION_QUEUE_TARGET,
    classifyQueueInventory,
    queueRowsInPage,
} from './cloudflare-production-queue-shared';
import {
    classifyExistingCloudflareWorkerState,
    validateProductionQueueRuntimeReadback,
    validateProductionQueueVersionBinding,
    type ProductionQueueRuntimeMode,
} from './cloudflare-production-queue-runtime';
import {
    PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_ENV,
    PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE,
    buildProductionEnablePrewriteEvidence,
    createProductionEnablePendingCheckpoint,
    markProductionEnableCheckpointAmbiguous,
    markProductionEnableCheckpointCompensated,
    markProductionEnableCheckpointCompensationStarted,
    markProductionEnableCheckpointProven,
    productionEnableStartupAction,
    runGuardedEnableMutation,
    validateProductionEnablePrewriteEvidence,
    type ProductionEnableCheckpoint,
    type ProductionEnableQueueReadiness,
    type ProductionEnableStripeReadiness,
} from './cloudflare-production-fulfillment-lifecycle-shared';
import {
    acquireProductionEnableLock,
    assertProductionEnableLockOwnership,
    persistProductionEnableCheckpointCas,
    readProductionEnableCheckpoint,
    releaseProductionEnableLock,
} from './cloudflare-production-fulfillment-enable-state';
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    createOneShotCloudflareDeployTag,
    openOneShotCloudflareWriteGuard,
    reconcileOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
    workerDeployCheckpointMatchesCurrentVersion,
    workerVersionTagFromView,
} from './cloudflare-production-one-shot-write';
import { parseCloudflareCronSchedulesResponse } from './cloudflare-cron-schedules-response';
import { inspectStripeLiveReadiness } from './stripe-live-readiness';
import {
    requestAllowlistedCloudflareAccount,
    runCloudflareWranglerFromKeyring,
    withCloudflareWranglerOAuth,
} from './cloudflare-wrangler-oauth';

type Phase = 'bootstrap' | 'enable';
type CheckStatus = 'ok' | 'failed';
type Check = { status: CheckStatus; name: string; message: string; details: string[] };
type CommandSpec = { id: string; display: string; args: string[]; writesCloudflare: boolean };
type CommandCapture = CommandSpec & {
    status: CheckStatus;
    exitCode: number | null;
    outputPath: string;
    stdout: string;
    stderr: string;
};
type QueueReadinessResult = { checks: Check[]; readiness: ProductionEnableQueueReadiness | null };
type StripeReadinessResult = { check: Check; readiness: ProductionEnableStripeReadiness | null };

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
    : PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_ENV;
const directUrlEnvVar = 'CLOUDFLARE_FULFILLMENT_DIRECT_URL';
const envFileEnvVar = 'CLOUDFLARE_FULFILLMENT_ENV_FILE';
const exactApprovalSentence = phase === 'bootstrap'
    ? 'Apruebo crear o reemplazar solo el Cloudflare Fulfillment Worker production `espanol-honesto-fulfillment-production` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` usando el entorno Wrangler `production_bootstrap`, con jobs, email y cron desactivados, antes de desplegar el Worker web, sin ejecutar jobs, sin enviar emails, sin tocar dominios, DNS, Pages, Supabase, Google, Resend ni Stripe.'
    : PRODUCTION_FULFILLMENT_ENABLE_APPROVAL_SENTENCE;
const initialApprovalValue = process.env[approvalEnvVar]?.trim() ?? '';

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', `launch-cloudflare-production-fulfillment-${phase}`, stamp(startedAt));
const enablePrewriteEvidencePath = path.join(outputDir, 'enable-prewrite-evidence.json');
const enableCheckpointPath = path.join(
    process.cwd(),
    'outputs',
    'launch-cloudflare-production-fulfillment-enable',
    'checkpoint.json',
);
const enableLockPath = path.join(
    process.cwd(),
    'outputs',
    'launch-cloudflare-production-fulfillment-enable',
    'execution.lock',
);
const enableLockOwnerId = randomUUID();
mkdirSync(outputDir, { recursive: true });

const checks: Check[] = [
    validatePackageScripts(),
    validateWranglerConfig(),
];
const captures: CommandCapture[] = [];
let externalWriteAttempted = false;
let externalWritePerformed: boolean | 'unknown' = false;
let enableCheckpoint: ProductionEnableCheckpoint | null = null;
let enableLockHeld = false;

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
    const localGate = validateExecutionEnvironment();
    checks.push(localGate);
    if (localGate.status !== 'failed') {
        try {
            await withCloudflareWranglerOAuth({
                accountId: target.accountId,
                consume: executeApproved,
            });
        } catch (error) {
            checks.push(failed(
                'secure_cloudflare_oauth_gate',
                'Wrangler could not attest the encrypted OAuth keyring and exact Cloudflare account.',
                [safeError(error), 'externalWriteAttempted=false'],
            ));
        }
    }
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
    enablePrewriteEvidencePath: existsSync(enablePrewriteEvidencePath)
        ? relative(enablePrewriteEvidencePath)
        : null,
    enableCheckpointPath: relative(enableCheckpointPath),
    enableCheckpointStatus: enableCheckpoint?.status ?? null,
    enableCheckpointRevision: enableCheckpoint?.revision ?? null,
    enableLockPath: relative(enableLockPath),
    enableLockHeld,
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
    const whoami = runCommand(command('whoami', ['whoami', '--json'], false));
    captures.push(whoami);
    checks.push(commandCheck(whoami));
    if (whoami.status === 'failed') return;

    try {
        const identity = verifyCloudflareWhoamiOutput(whoami.stdout, target.accountId);
        checks.push(ok('remote_account_pre_write_gate', 'Structured Wrangler identity proves exactly one match for the approved Cloudflare account.', [
            `accountId=${identity.expectedAccountId}`,
            `matchedAccountCount=${identity.matchedAccountCount}`,
        ]));
    } catch (error) {
        checks.push(failed('remote_account_pre_write_gate', 'Wrangler identity does not prove exactly one match for the approved account; no write may start.', [
            `error=${safeError(error)}`,
            'externalWriteAttempted=false',
        ]));
        return;
    }

    if (phase === 'bootstrap') {
        await executeBootstrap();
        return;
    }
    let lockAcquisition: ReturnType<typeof acquireProductionEnableLock>;
    try {
        lockAcquisition = acquireProductionEnableLock({
            lockPath: enableLockPath,
            ownerId: enableLockOwnerId,
        });
    } catch (error) {
        checks.push(failed('enable_execution_lock', 'Canonical production enable lifecycle lock is invalid or could not be acquired safely; no checkpoint or Cloudflare write may start.', [
            `error=${safeError(error)}`,
            'externalWriteAttempted=false',
        ]));
        return;
    }
    if (!lockAcquisition.acquired) {
        checks.push(failed('enable_execution_lock', 'Another production fulfillment enable owner holds the canonical lifecycle lock; no checkpoint or Cloudflare write may start.', [
            `reason=${lockAcquisition.reason}`,
            `ownerPid=${lockAcquisition.existing.pid}`,
            `ownerHost=${lockAcquisition.existing.hostname}`,
            'externalWriteAttempted=false',
        ]));
        return;
    }
    enableLockHeld = true;
    checks.push(ok('enable_execution_lock', 'This process exclusively owns the canonical production enable lifecycle lock.', [
        `lock=${relative(enableLockPath)}`,
        `staleOwnerRecovered=${String(lockAcquisition.staleOwnerRecovered)}`,
    ]));
    try {
        if (!await reconcileEnableCheckpointAtStartup()) return;
        await executeEnable();
    } finally {
        try {
            releaseProductionEnableLock(enableLockPath, enableLockOwnerId);
            checks.push(ok('enable_execution_lock_released', 'Canonical production enable lifecycle lock was released by its exact owner.', []));
        } catch (error) {
            checks.push(failed('enable_execution_lock_release', 'Canonical production enable lifecycle lock could not be released safely; later runs must fail closed or recover the stale owner.', [
                `error=${safeError(error)}`,
            ]));
        }
        enableLockHeld = false;
    }
}

async function executeBootstrap(): Promise<void> {
    const existingState = await verifyExistingFulfillmentBootstrapBeforeDeploy();
    checks.push(...existingState);
    if (existingState.some((check) => check.status === 'failed')) return;
    const prewriteDeployments = captures.find((capture) =>
        capture.id === 'fulfillment-bootstrap-existing-deployments-preflight');
    const observedVersionId = prewriteDeployments ? deploymentVersionId(prewriteDeployments) : null;

    const reconciliation = await reconcileOneShotCloudflareWriteGuard(
        'fulfillment-bootstrap-deploy',
        outputDir,
        {
            readback: (checkpoint) => {
                if (
                    !checkpoint
                    || checkpoint.commandId !== 'fulfillment-bootstrap-deploy'
                    || !checkpoint.intent
                    || checkpoint.intent.kind !== 'cloudflare-worker-deploy'
                    || !observedVersionId
                ) return false;
                const finalGate = existingState.findLast((check) => check.name === 'bootstrap_existing_state_pre_write_gate');
                if (finalGate?.status !== 'ok' || finalGate.details.includes('existingState=absent')) return false;
                const versionView = runCommand(versionViewCommand(
                    'fulfillment-bootstrap-version-view-reconciliation',
                    observedVersionId,
                ));
                captures.push(versionView);
                checks.push(commandCheck(versionView));
                if (versionView.status === 'failed') return false;
                const versionTag = workerVersionTagFromView(versionView.stdout, observedVersionId);
                return workerDeployCheckpointMatchesCurrentVersion(checkpoint, {
                        accountId: target.accountId,
                        worker: target.worker,
                        environment: 'production_bootstrap',
                        deployTag: checkpoint.intent.deployTag,
                    }, observedVersionId, versionTag);
            },
        },
    );
    if (reconciliation.status !== 'not_needed') {
        checks.push(reconciliation.status === 'reconciled'
            ? ok('bootstrap_deploy_readonly_reconciliation', 'Fresh inert Worker/Cron/Queue readbacks proved the interrupted bootstrap deploy; checkpoint and stale lock were cleared without redeploying.', [
                `checkpointCount=${reconciliation.checkpointCount}`,
                `lockOnly=${String(reconciliation.lockOnly)}`,
                'deployRetried=false',
            ])
            : failed('bootstrap_deploy_readonly_reconciliation', 'Fresh readbacks did not prove the interrupted bootstrap deploy; checkpoint/lock remain fail-closed and no deploy was retried.', [
                `reason=${reconciliation.reason}`,
                'deployRetried=false',
            ]));
        return;
    }

    const dryRun = runCommand(deployCommand('fulfillment-bootstrap-dry-run', 'production_bootstrap', true));
    captures.push(dryRun);
    checks.push(commandCheck(dryRun));
    if (dryRun.status === 'failed') return;

    let writeGuard: ReturnType<typeof openOneShotCloudflareWriteGuard>;
    try {
        writeGuard = openOneShotCloudflareWriteGuard('fulfillment-bootstrap-deploy', outputDir);
        checks.push(ok('bootstrap_write_lock', 'Durable one-shot write guard is held and no unresolved bootstrap deploy checkpoint exists.', []));
    } catch (error) {
        checks.push(failed('bootstrap_write_lock', 'An unresolved bootstrap write or lock blocks a new deploy until read-only reconciliation.', [
            safeError(error),
            'externalWriteAttempted=false',
        ]));
        return;
    }
    const guardedPrewriteDeployments = runCommand(deploymentsCommand(
        'fulfillment-bootstrap-deployments-immediately-before-deploy',
    ));
    captures.push(guardedPrewriteDeployments);
    const guardedWorkerAbsent = captureIsWorkerNotFound(guardedPrewriteDeployments);
    const prewriteVersionId = guardedPrewriteDeployments.status === 'ok'
        ? deploymentVersionId(guardedPrewriteDeployments)
        : null;
    const initialWorkerAbsent = existingState
        .findLast((check) => check.name === 'bootstrap_existing_state_pre_write_gate')
        ?.details.includes('existingState=absent') ?? false;
    const prewriteStateStable = initialWorkerAbsent
        ? guardedWorkerAbsent
        : guardedPrewriteDeployments.status === 'ok'
            && Boolean(prewriteVersionId)
            && prewriteVersionId === observedVersionId;
    checks.push(prewriteStateStable
        ? ok('bootstrap_guarded_prewrite_version_identity', 'The exact pre-write fulfillment version or absence was recaptured under the one-shot guard and still matches the validated inert preflight.', [
            `prewriteVersionId=${prewriteVersionId ?? 'absent'}`,
            `workerAbsent=${String(guardedWorkerAbsent)}`,
            'capturedUnderWriteGuard=true',
        ])
        : failed('bootstrap_guarded_prewrite_version_identity', 'The fulfillment Worker changed or became ambiguous before the guarded checkpoint; deploy is blocked.', [
            `initialVersionId=${observedVersionId ?? 'absent'}`,
            `guardedVersionId=${prewriteVersionId ?? 'absent'}`,
            `initialWorkerAbsent=${String(initialWorkerAbsent)}`,
            `guardedWorkerAbsent=${String(guardedWorkerAbsent)}`,
        ]));
    if (!prewriteStateStable) {
        closeOneShotCloudflareWriteGuard(writeGuard);
        return;
    }
    const deployTag = createOneShotCloudflareDeployTag(writeGuard, 'fulfillment-bootstrap');
    let writeCheckpoint = beginOneShotCloudflareWrite(writeGuard, 'fulfillment-bootstrap-deploy', {
        kind: 'cloudflare-worker-deploy',
        accountId: target.accountId,
        worker: target.worker,
        environment: 'production_bootstrap',
        prewriteVersionId,
        deployTag,
    });
    externalWriteAttempted = true;
    externalWritePerformed = 'unknown';
    const deploy = runCommand(deployCommand(
        'fulfillment-bootstrap-deploy',
        'production_bootstrap',
        false,
        deployTag,
    ));
    writeCheckpoint = recordOneShotCloudflareProviderResult(writeGuard, writeCheckpoint, {
        exitCode: deploy.exitCode,
        timedOut: deploy.exitCode === null,
        errorPresent: deploy.status === 'failed',
    });
    captures.push(deploy);
    checks.push(commandCheck(deploy));
    if (deploy.status === 'failed') return;

    const deployments = runCommand(deploymentsCommand('fulfillment-bootstrap-deployments-after'));
    captures.push(deployments);
    checks.push(commandCheck(deployments));
    const versionId = deploymentVersionId(deployments);
    if (deployments.status === 'failed' || !versionId) {
        checks.push(failed('bootstrap_version_gate', 'The deployed bootstrap version could not be proven.', [`targetWorker=${target.worker}`]));
        return;
    }
    const versionView = runCommand(versionViewCommand(
        'fulfillment-bootstrap-version-view-after-deploy',
        versionId,
    ));
    captures.push(versionView);
    checks.push(commandCheck(versionView));
    if (versionView.status === 'failed') {
        recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, false);
        return;
    }
    const currentVersionTag = workerVersionTagFromView(versionView.stdout, versionId);

    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) return;
    const health = await healthProbe(directUrl, 'bootstrap');
    const blocked = await disabledOperationProbe(directUrl);
    const cron = await cronScheduleProbe('bootstrap');
    const queueBinding = queueVersionBindingProbe(versionId, 'bootstrap', 'after-bootstrap-deploy');
    const queueRuntime = await productionQueueRuntimeProbe('bootstrap');
    checks.push(health, blocked, cron, queueBinding, queueRuntime);
    const versionMatchesIntent = workerDeployCheckpointMatchesCurrentVersion(writeCheckpoint, {
        accountId: target.accountId,
        worker: target.worker,
        environment: 'production_bootstrap',
        deployTag,
    }, versionId, currentVersionTag);
    checks.push(versionMatchesIntent
        ? ok('bootstrap_deploy_version_changed', 'The deployed version differs from the exact pre-write active version bound into the checkpoint.', [
            `versionId=${versionId}`,
            `deployTagMatched=${String(currentVersionTag === deployTag)}`,
        ])
        : failed('bootstrap_deploy_version_changed', 'The current version is unchanged or does not match the checkpoint target; an older bootstrap cannot satisfy this deploy.', [
            `currentVersionId=${versionId}`,
            `prewriteVersionId=${prewriteVersionId ?? 'absent'}`,
        ]));
    const proven = versionMatchesIntent
        && [health, blocked, cron, queueBinding, queueRuntime].every((check) => check.status === 'ok');
    writeCheckpoint = recordOneShotCloudflareReadback(writeGuard, writeCheckpoint, proven);
    if (!proven) {
        checks.push(failed('bootstrap_deploy_readback', 'Bootstrap deploy returned but exact inert version/Cron/Queue state is not proven; checkpoint and lock remain unresolved.', [
            `checkpointStage=${writeCheckpoint.stage}`,
            'externalWritePerformed=unknown',
        ]));
        return;
    }
    closeOneShotCloudflareWriteGuard(writeGuard);
    externalWritePerformed = true;
    checks.push(ok('bootstrap_deploy_readback', 'Bootstrap deployment is proven inert and its durable write checkpoint is resolved.', [
        `versionId=${versionId}`,
        'queueBindings=absent',
        'cronCount=0',
    ]));
}

async function verifyExistingFulfillmentBootstrapBeforeDeploy(): Promise<Check[]> {
    const result: Check[] = [];
    const deployments = runCommand(deploymentsCommand('fulfillment-bootstrap-existing-deployments-preflight'));
    const secretList = runCommand(command(
        'fulfillment-bootstrap-existing-secret-list-preflight',
        ['secret', 'list', '--config', target.config, '--env', 'production_bootstrap', '--format', 'json'],
        false,
    ));
    captures.push(deployments, secretList);
    const existingWorkerState = classifyExistingCloudflareWorkerState(
        { succeeded: deployments.status === 'ok', explicitlyNotFound: captureIsWorkerNotFound(deployments) },
        { succeeded: secretList.status === 'ok', explicitlyNotFound: captureIsWorkerNotFound(secretList) },
    );
    if (existingWorkerState === 'unknown') {
        result.push(commandCheck(deployments), commandCheck(secretList));
        result.push(failed('bootstrap_existing_state_pre_write_gate', 'Existing fulfillment Worker state is absent only partially, unreadable or ambiguous; deploy is blocked.', [
            'existingState=unknown',
            'externalWriteAttempted=false',
        ]));
        return result;
    }

    const inertQueue = await productionQueueRuntimeProbe('bootstrap');
    result.push(inertQueue);
    if (inertQueue.status === 'failed') {
        result.push(failed('bootstrap_existing_state_pre_write_gate', 'Production Queue resources are missing, attached, paused, backlogged or unreadable; bootstrap deploy is blocked before any write.', [
            `existingState=${existingWorkerState}`,
            'externalWriteAttempted=false',
        ]));
        return result;
    }

    if (existingWorkerState === 'absent') {
        result.push(ok('bootstrap_existing_state_pre_write_gate', 'Fresh reads prove the exact fulfillment Worker is absent, so bootstrap cannot preserve prior remote vars or secrets.', [
            `worker=${target.worker}`,
            'existingState=absent',
            'queueRuntime=bootstrap-inert',
        ]));
        return result;
    }
    result.push(commandCheck(deployments), commandCheck(secretList));

    const versionId = deploymentVersionId(deployments);
    const inventory = exactBootstrapSecretInventory(secretList.stdout);
    const providerBindings = versionId
        ? bootstrapProviderBindingProbe(versionId)
        : failed('bootstrap_existing_provider_binding_inventory', 'Existing Worker version ID is missing.', []);
    result.push(inventory.check, providerBindings);
    if (!versionId || inventory.check.status === 'failed' || providerBindings.status === 'failed') {
        result.push(failed('bootstrap_existing_state_pre_write_gate', 'Existing fulfillment Worker is not proven to be provider-free HMAC-only bootstrap; deploy is blocked.', [
            'externalWriteAttempted=false',
        ]));
        return result;
    }

    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) {
        result.push(failed('bootstrap_existing_state_pre_write_gate', 'Exact direct URL is unavailable for existing-state attestation.', []));
        return result;
    }
    const health = await healthProbe(directUrl, 'bootstrap');
    const blocked = await disabledOperationProbe(directUrl);
    const cron = await cronScheduleProbe('bootstrap');
    const queueBinding = queueVersionBindingProbe(versionId, 'bootstrap', 'existing-bootstrap-preflight');
    result.push(health, blocked, cron, queueBinding);
    if (inventory.hasHmac) result.push(await runtimeAttestation(directUrl, versionId, 'bootstrap'));
    const proven = result.every((check) => check.status === 'ok');
    result.push(proven
        ? ok('bootstrap_existing_state_pre_write_gate', 'Existing Worker is freshly proven as inert provider-free bootstrap, so --keep-vars cannot retain unknown provider state.', [
            `versionId=${versionId}`,
            `secretInventory=${inventory.hasHmac ? 'INTERNAL_JOB_SECRET' : 'empty'}`,
            'providerBindings=absent',
            'queueBindings=absent',
        ])
        : failed('bootstrap_existing_state_pre_write_gate', 'Existing Worker failed fresh bootstrap/503/Cron/Queue/HMAC proof; deploy is blocked.', [
            'externalWriteAttempted=false',
        ]));
    return result;
}

function exactBootstrapSecretInventory(source: string): { check: Check; hasHmac: boolean } {
    try {
        const parsed = parseMixedJsonOutput(source);
        if (!Array.isArray(parsed)) throw new Error('Secret inventory is not an array.');
        const names = parsed.map((entry) => {
            const name = asRecord(entry).name;
            if (typeof name !== 'string' || !name) throw new Error('Secret inventory contains a malformed entry.');
            return name;
        });
        if (new Set(names).size !== names.length) throw new Error('Secret inventory contains duplicates.');
        const unexpected = names.filter((name) => name !== 'INTERNAL_JOB_SECRET');
        const valid = unexpected.length === 0 && names.length <= 1;
        return {
            hasHmac: names.includes('INTERNAL_JOB_SECRET'),
            check: valid
                ? ok('bootstrap_existing_exact_secret_inventory', 'Existing remote secret inventory is empty or exactly HMAC-only.', [
                    `names=${names.join(',') || 'none'}`,
                ])
                : failed('bootstrap_existing_exact_secret_inventory', 'Existing remote secret inventory contains a provider or unexpected name.', [
                    `unexpected=${unexpected.join(',') || 'none'}`,
                ]),
        };
    } catch (error) {
        return {
            hasHmac: false,
            check: failed('bootstrap_existing_exact_secret_inventory', 'Existing remote secret inventory is unparseable or ambiguous.', [safeError(error)]),
        };
    }
}

function bootstrapProviderBindingProbe(expectedVersionId: string): Check {
    const capture = runCommand(command(
        'fulfillment-bootstrap-existing-version-bindings-preflight',
        ['versions', 'view', expectedVersionId, '--name', target.worker, '--json'],
        false,
    ));
    captures.push(capture);
    if (capture.status === 'failed') {
        return failed('bootstrap_existing_provider_binding_inventory', 'Existing Worker version bindings could not be read.', [
            `capture=${relative(capture.outputPath)}`,
        ]);
    }
    try {
        const version = asRecord(parseMixedJsonOutput(capture.stdout));
        if (version.id !== expectedVersionId) throw new Error('Version view ID mismatch.');
        const resources = asRecord(version.resources);
        if (!Array.isArray(resources.bindings)) throw new Error('Version view binding inventory is missing.');
        const allowed = new Set([
            'CF_VERSION_METADATA',
            'NODE_ENV',
            'PUBLIC_APP_ENV',
            'SUPABASE_EXPECTED_PROJECT_REF',
            'WORKER_IDENTITY',
            'PUBLIC_SITE_URL',
            'CHECKOUT_ENABLED',
            'CHECKOUT_ENABLED_OVERRIDE',
            'FULFILLMENT_RUNTIME_MODE',
            'EMAIL_DELIVERY_MODE',
            'EMAIL_DAILY_RECIPIENT_LIMIT',
            'EMAIL_MONTHLY_RECIPIENT_LIMIT',
            'INTERNAL_JOB_SECRET',
        ]);
        const names = resources.bindings.map((binding) => asRecord(binding).name);
        if (names.some((name) => typeof name !== 'string')) throw new Error('Version view contains a malformed binding name.');
        const unexpected = (names as string[]).filter((name) => !allowed.has(name));
        return unexpected.length === 0
            ? ok('bootstrap_existing_provider_binding_inventory', 'Existing version binding inventory contains only the exact inert bootstrap allowlist.', [
                `bindingCount=${names.length}`,
            ])
            : failed('bootstrap_existing_provider_binding_inventory', 'Existing version binding inventory contains a provider or unknown binding.', [
                `unexpected=${unexpected.join(',')}`,
            ]);
    } catch (error) {
        return failed('bootstrap_existing_provider_binding_inventory', 'Existing Worker version binding inventory is unparseable or ambiguous.', [safeError(error)]);
    }
}

function captureIsWorkerNotFound(capture: CommandCapture): boolean {
    return capture.status === 'failed'
        && /code:\s*10007|script_not_found|worker[^\n]*(?:not found|does not exist)|does not exist on your account/iu
            .test(`${capture.stdout}\n${capture.stderr}`);
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

    const queueReadiness = readFreshProductionQueueReadiness();
    checks.push(...queueReadiness.checks);
    if (!queueReadiness.readiness) return;
    const inertQueueBeforeEnable = await productionQueueRuntimeProbe('bootstrap');
    checks.push(inertQueueBeforeEnable);
    if (inertQueueBeforeEnable.status === 'failed') return;

    const stripeReadiness = await readFreshStripeLiveReadiness();
    checks.push(stripeReadiness.check);
    if (!stripeReadiness.readiness) return;

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
    const bootstrapQueueBinding = queueVersionBindingProbe(freshFulfillmentVersion, 'bootstrap', 'immediately-before-enable');
    checks.push(bootstrapQueueBinding);
    if (bootstrapQueueBinding.status === 'failed') return;
    checks.push(await webRuntimeAttestation(freshWebVersion));
    if (checks.at(-1)?.status === 'failed') return;

    const prewriteEvidence = buildProductionEnablePrewriteEvidence({
        generatedAt: new Date().toISOString(),
        queue: queueReadiness.readiness,
        stripe: stripeReadiness.readiness,
        stripeAccountId: secretValue('STRIPE_EXPECTED_ACCOUNT_ID'),
        stripePortalConfigurationId: secretValue('STRIPE_PORTAL_CONFIGURATION_ID'),
        fulfillmentBootstrapVersion: freshFulfillmentVersion,
        webVersion: freshWebVersion,
    });
    const evidenceValidation = validateProductionEnablePrewriteEvidence(prewriteEvidence, {
        now: new Date(),
        stripeAccountId: secretValue('STRIPE_EXPECTED_ACCOUNT_ID'),
        stripePortalConfigurationId: secretValue('STRIPE_PORTAL_CONFIGURATION_ID'),
    });
    checks.push(evidenceValidation.ok
        ? ok('structured_enable_prewrite_evidence', 'Fresh Queue, Stripe and version evidence is strictly validated and approval-bound immediately before enable.', [
            `evidence=${relative(enablePrewriteEvidencePath)}`,
            `queue=${PRODUCTION_QUEUE_TARGET.queue}`,
            `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}`,
            'externalWriteAttempted=false',
        ])
        : failed('structured_enable_prewrite_evidence', 'Fresh Queue/Stripe evidence did not pass strict approval-bound validation; active deploy is blocked.', evidenceValidation.errors));
    if (!evidenceValidation.ok) return;
    const evidenceJson = `${JSON.stringify(prewriteEvidence, null, 2)}\n`;
    writeFileSync(enablePrewriteEvidencePath, evidenceJson, 'utf8');
    const pendingCheckpoint = createProductionEnablePendingCheckpoint({
        attemptId: randomUUID(),
        now: new Date().toISOString(),
        prewriteEvidenceSha256: createHash('sha256').update(evidenceJson).digest('hex'),
        previousRevision: enableCheckpoint?.revision,
    });

    try {
        await runGuardedEnableMutation<string, string>({
            persistPending: () => {
                persistEnableCheckpoint(pendingCheckpoint, enableCheckpoint);
                enableCheckpoint = pendingCheckpoint;
                externalWriteAttempted = true;
                externalWritePerformed = 'unknown';
                checks.push(ok('active_enable_write_ahead_checkpoint', 'Durable pending checkpoint was persisted before the active deploy command.', [
                    `checkpoint=${relative(enableCheckpointPath)}`,
                    `evidenceSha256=${pendingCheckpoint.prewriteEvidenceSha256}`,
                ]));
            },
            deployAndVerifyActive: async () => {
                assertEnableMutationOwnership('active deploy');
                const deploy = runCommand(deployCommand('fulfillment-active-deploy', 'production', false));
                captures.push(deploy);
                checks.push(commandCheck(deploy));
                if (deploy.status !== 'ok') return null;
                externalWritePerformed = true;
                const afterDeployments = runCommand(deploymentsCommand('fulfillment-active-deployments-after'));
                captures.push(afterDeployments);
                checks.push(commandCheck(afterDeployments));
                const afterVersionId = deploymentVersionId(afterDeployments);
                const versionCheck = afterDeployments.status === 'ok' && Boolean(afterVersionId && afterVersionId !== freshFulfillmentVersion)
                    ? ok('active_version_gate', 'A distinct active fulfillment version is deployed.', ['versionChanged=true'])
                    : failed('active_version_gate', 'A distinct active fulfillment version could not be proven after deploy.', [
                        `versionPresent=${String(Boolean(afterVersionId))}`,
                        `versionChanged=${String(Boolean(afterVersionId && afterVersionId !== freshFulfillmentVersion))}`,
                    ]);
                checks.push(versionCheck);
                if (versionCheck.status !== 'ok' || !afterVersionId) return null;
                const activeHealth = await healthProbe(directUrl, 'active');
                const activeAttestation = await runtimeAttestation(directUrl, afterVersionId, 'active');
                const activeCron = await cronScheduleProbe('active');
                const activeQueueBinding = queueVersionBindingProbe(afterVersionId, 'active', 'after-enable');
                const activeQueueRuntime = await productionQueueRuntimeProbe('active');
                checks.push(activeHealth, activeAttestation, activeCron, activeQueueBinding, activeQueueRuntime);
                return [activeHealth, activeAttestation, activeCron, activeQueueBinding, activeQueueRuntime]
                    .every((check) => check.status === 'ok')
                    ? afterVersionId
                    : null;
            },
            markProven: (activeVersionId) => {
                const current = requireEnableCheckpoint();
                const next = markProductionEnableCheckpointProven(
                    current,
                    activeVersionId,
                    new Date().toISOString(),
                );
                persistEnableCheckpoint(next, current);
                enableCheckpoint = next;
                externalWritePerformed = true;
            },
            compensateAndVerify: () => compensateToBootstrap(directUrl),
            markCompensated: (bootstrapVersionId) => {
                const current = requireEnableCheckpoint();
                const next = markProductionEnableCheckpointCompensated(
                    current,
                    bootstrapVersionId,
                    new Date().toISOString(),
                );
                persistEnableCheckpoint(next, current);
                enableCheckpoint = next;
                externalWritePerformed = true;
            },
            markAmbiguous: (errorCategory) => {
                const current = requireEnableCheckpoint();
                const next = markProductionEnableCheckpointAmbiguous(
                    current,
                    errorCategory,
                    new Date().toISOString(),
                );
                persistEnableCheckpoint(next, current);
                enableCheckpoint = next;
                externalWritePerformed = 'unknown';
                checks.push(failed('active_deploy_state_ambiguous', 'Active deploy and compensating bootstrap could not be proven; durable checkpoint requires reconciliation.', [
                    `checkpoint=${relative(enableCheckpointPath)}`,
                    `errorCategory=${errorCategory}`,
                ]));
            },
        });
    } catch (error) {
        if (enableCheckpoint && enableCheckpoint.status !== 'proven' && enableCheckpoint.status !== 'compensated') {
            if (enableCheckpoint.status === 'pending') {
                const current = enableCheckpoint;
                const next = markProductionEnableCheckpointAmbiguous(
                    current,
                    'CHECKPOINT_OR_GUARD_PERSISTENCE_EXCEPTION',
                    new Date().toISOString(),
                );
                try {
                    persistEnableCheckpoint(next, current);
                    enableCheckpoint = next;
                } catch {
                    // The current durable checkpoint remains the recovery gate.
                }
            }
            externalWriteAttempted = true;
            externalWritePerformed = 'unknown';
        }
        checks.push(failed('guarded_enable_mutation_exception', 'Guarded enable mutation raised unexpectedly; launch remains blocked and checkpoint reconciliation is required.', [
            `error=${safeError(error)}`,
            `checkpoint=${relative(enableCheckpointPath)}`,
        ]));
    }
}

async function reconcileEnableCheckpointAtStartup(): Promise<boolean> {
    let checkpoint: ProductionEnableCheckpoint | null;
    try {
        checkpoint = readProductionEnableCheckpoint(enableCheckpointPath);
    } catch (error) {
        externalWriteAttempted = true;
        externalWritePerformed = 'unknown';
        checks.push(failed('enable_checkpoint_validation', 'Existing enable checkpoint is invalid; no new write or no-write claim is allowed.', [
            `checkpoint=${relative(enableCheckpointPath)}`,
            `error=${safeError(error)}`,
        ]));
        return false;
    }
    if (!checkpoint) return true;
    enableCheckpoint = checkpoint;
    const startupAction = productionEnableStartupAction(checkpoint);

    if (startupAction === 'allow_new_attempt') {
        checks.push(ok('enable_checkpoint_reconciled', 'Previous enable attempt has a proven compensated bootstrap; a fresh approved attempt may run.', [
            `checkpoint=${relative(enableCheckpointPath)}`,
            `bootstrapVersion=${checkpoint.compensatedBootstrapVersionId}`,
            `revision=${checkpoint.revision}`,
        ]));
        return true;
    }

    externalWriteAttempted = true;
    externalWritePerformed = 'unknown';
    checks.push(ok('enable_checkpoint_reconciliation_required', 'Unfinished enable checkpoint found; remote state is reconciled before any new active attempt.', [
        `status=${checkpoint.status}`,
        `startupAction=${startupAction}`,
        `compensationAttempted=${String(checkpoint.compensationAttempted)}`,
        `checkpoint=${relative(enableCheckpointPath)}`,
        'externalWritePerformed=unknown',
    ]));
    const directUrl = normalizeDirectUrl(process.env[directUrlEnvVar]);
    if (!directUrl) {
        const next = markProductionEnableCheckpointAmbiguous(checkpoint, 'RECONCILIATION_DIRECT_URL_INVALID', new Date().toISOString());
        let persistenceError: string | null = null;
        try {
            persistEnableCheckpoint(next, checkpoint);
            enableCheckpoint = next;
        } catch (error) {
            persistenceError = safeError(error);
        }
        checks.push(failed('enable_checkpoint_reconciliation', 'Pending enable cannot be reconciled without the exact direct URL.', [
            ...(persistenceError ? [`checkpointPersistenceError=${persistenceError}`] : []),
        ]));
        return false;
    }

    if (startupAction === 'verify_proven_active') {
        const deployments = runCommand(deploymentsCommand('fulfillment-proven-version-fresh-readback'));
        captures.push(deployments);
        checks.push(commandCheck(deployments));
        const versionId = deployments.status === 'ok' ? deploymentVersionId(deployments) : null;
        const versionReadback = deployments.status === 'ok'
            && Boolean(versionId)
            && versionId === checkpoint.activeVersionId;
        const activeHealth = await healthProbe(directUrl, 'active');
        const activeAttestation = await runtimeAttestation(directUrl, checkpoint.activeVersionId!, 'active');
        const activeCron = await cronScheduleProbe('active');
        const activeQueueBinding = queueVersionBindingProbe(checkpoint.activeVersionId!, 'active', 'proven-checkpoint-readback');
        const activeQueueRuntime = await productionQueueRuntimeProbe('active');
        checks.push(
            versionReadback
                ? ok('proven_checkpoint_version_readback', 'Fresh Cloudflare readback matches the exact version stored by the proven checkpoint.', [
                    `activeVersion=${checkpoint.activeVersionId}`,
                ])
                : failed('proven_checkpoint_version_readback', 'Fresh Cloudflare readback diverges from the proven checkpoint version.', [
                    `storedVersion=${checkpoint.activeVersionId}`,
                    `remoteVersion=${versionId ?? 'unproven'}`,
                ]),
            activeHealth,
            activeAttestation,
            activeCron,
            activeQueueBinding,
            activeQueueRuntime,
        );
        if (versionReadback && [activeHealth, activeAttestation, activeCron, activeQueueBinding, activeQueueRuntime]
            .every((check) => check.status === 'ok')) {
            externalWritePerformed = true;
            checks.push(ok('enable_checkpoint_already_proven', 'Fresh version, health, HMAC and Cron readback still prove the exact active checkpoint; duplicate deployment is blocked.', [
                `activeVersion=${checkpoint.activeVersionId}`,
                `checkpoint=${relative(enableCheckpointPath)}`,
            ]));
            return false;
        }

        const ambiguous = markProductionEnableCheckpointAmbiguous(
            checkpoint,
            'PROVEN_REMOTE_READBACK_DIVERGED',
            new Date().toISOString(),
        );
        try {
            persistEnableCheckpoint(ambiguous, checkpoint);
            enableCheckpoint = ambiguous;
            checkpoint = ambiguous;
        } catch (error) {
            checks.push(failed('proven_checkpoint_divergence_persistence', 'Remote proven-state divergence could not be committed as ambiguous; compensation is blocked by checkpoint CAS.', [
                `error=${safeError(error)}`,
            ]));
            return false;
        }
        checks.push(failed('proven_checkpoint_remote_divergence', 'Historical proven state diverged from fresh remote readback; checkpoint is ambiguous and compensation requires this exact approved execution.', [
            `checkpointRevision=${checkpoint.revision}`,
        ]));
    }

    if (startupAction === 'compensate_only') {
        checks.push(ok('enable_checkpoint_compensation_is_monotonic', 'A prior compensation attempt exists; startup skips every active-proven path and continues only toward bootstrap compensation.', [
            `checkpointRevision=${checkpoint.revision}`,
        ]));
    } else if (startupAction === 'reconcile_active_then_compensate') {
        try {
            const deployments = runCommand(deploymentsCommand('fulfillment-deployments-startup-reconciliation'));
            captures.push(deployments);
            checks.push(commandCheck(deployments));
            const versionId = deployments.status === 'ok' ? deploymentVersionId(deployments) : null;
            if (versionId) {
                const activeHealth = await healthProbe(directUrl, 'active');
                const activeAttestation = await runtimeAttestation(directUrl, versionId, 'active');
                const activeCron = await cronScheduleProbe('active');
                const activeQueueBinding = queueVersionBindingProbe(versionId, 'active', 'startup-reconciliation');
                const activeQueueRuntime = await productionQueueRuntimeProbe('active');
                checks.push(activeHealth, activeAttestation, activeCron, activeQueueBinding, activeQueueRuntime);
                if ([activeHealth, activeAttestation, activeCron, activeQueueBinding, activeQueueRuntime]
                    .every((check) => check.status === 'ok')) {
                    const proven = markProductionEnableCheckpointProven(checkpoint, versionId, new Date().toISOString());
                    persistEnableCheckpoint(proven, checkpoint);
                    enableCheckpoint = proven;
                    externalWritePerformed = true;
                    checks.push(ok('enable_checkpoint_reconciled_active', 'Startup reconciliation proves the prior active deployment; duplicate write is blocked.', [
                        `activeVersion=${versionId}`,
                    ]));
                    return false;
                }
            }
        } catch (error) {
            checks.push(failed('enable_checkpoint_active_reconciliation_exception', 'Active-state reconciliation raised unexpectedly; compensating bootstrap is still attempted.', [
                `error=${safeError(error)}`,
            ]));
        }
    }

    try {
        const bootstrapVersionId = await compensateToBootstrap(directUrl);
        if (bootstrapVersionId) {
            const current = requireEnableCheckpoint();
            const compensated = markProductionEnableCheckpointCompensated(
                current,
                bootstrapVersionId,
                new Date().toISOString(),
            );
            persistEnableCheckpoint(compensated, current);
            enableCheckpoint = compensated;
            externalWritePerformed = true;
            checks.push(ok('enable_checkpoint_reconciled_compensated', 'Startup reconciliation restored and proved bootstrap; this recovery run stops before a new active attempt.', [
                `bootstrapVersion=${bootstrapVersionId}`,
            ]));
            return false;
        }
        const current = requireEnableCheckpoint();
        const ambiguous = markProductionEnableCheckpointAmbiguous(
            current,
            'STARTUP_RECONCILIATION_AND_COMPENSATION_NOT_PROVEN',
            new Date().toISOString(),
        );
        persistEnableCheckpoint(ambiguous, current);
        enableCheckpoint = ambiguous;
    } catch (error) {
        const current = requireEnableCheckpoint();
        const ambiguous = markProductionEnableCheckpointAmbiguous(
            current,
            'STARTUP_RECONCILIATION_EXCEPTION',
            new Date().toISOString(),
        );
        try {
            persistEnableCheckpoint(ambiguous, current);
            enableCheckpoint = ambiguous;
        } catch {
            // Preserve the previously durable pending/ambiguous checkpoint.
        }
        checks.push(failed('enable_checkpoint_reconciliation_exception', 'Startup reconciliation failed unexpectedly; no new active deploy is allowed.', [
            `error=${safeError(error)}`,
        ]));
    }
    externalWritePerformed = 'unknown';
    return false;
}

function persistEnableCheckpoint(
    checkpoint: ProductionEnableCheckpoint,
    expected: ProductionEnableCheckpoint | null,
): void {
    persistProductionEnableCheckpointCas({
        checkpointPath: enableCheckpointPath,
        lockPath: enableLockPath,
        ownerId: enableLockOwnerId,
        expected,
        next: checkpoint,
    });
}

function assertEnableMutationOwnership(operation: string): void {
    if (!enableLockHeld) throw new Error(`Production enable lock is not held before ${operation}`);
    assertProductionEnableLockOwnership(enableLockPath, enableLockOwnerId);
}

function requireEnableCheckpoint(): ProductionEnableCheckpoint {
    if (!enableCheckpoint) throw new Error('Enable checkpoint is missing after write intent');
    return enableCheckpoint;
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

function validateExecutionEnvironment(): Check {
    const mismatches = [
        initialApprovalValue === exactApprovalSentence ? null : `${approvalEnvVar} (initial process environment only)`,
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() === target.accountId ? null : 'CLOUDFLARE_ACCOUNT_ID',
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
            /^sk_live_[A-Za-z0-9]+$/u.test(secretValue('STRIPE_SECRET_KEY')) ? null : 'STRIPE_SECRET_KEY must be live',
            /^pk_live_[A-Za-z0-9]+$/u.test(secretValue('PUBLIC_STRIPE_PUBLISHABLE_KEY')) ? null : 'PUBLIC_STRIPE_PUBLISHABLE_KEY must be live',
            /^acct_[A-Za-z0-9]+$/u.test(secretValue('STRIPE_EXPECTED_ACCOUNT_ID')) ? null : 'STRIPE_EXPECTED_ACCOUNT_ID',
            /^bpc_[A-Za-z0-9]+$/u.test(secretValue('STRIPE_PORTAL_CONFIGURATION_ID')) ? null : 'STRIPE_PORTAL_CONFIGURATION_ID',
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
            'approvalSource=initial_process_environment_only',
            'externalWriteAttempted=false',
        ])
        : failed('execution_environment_gate', 'Approval or exact target inputs do not match; no Cloudflare write may start.', [
            `mismatches=${failures.join(', ')}`,
            'externalWriteAttempted=false',
        ]);
}

function readFreshProductionQueueReadiness(): QueueReadinessResult {
    const resultChecks: Check[] = [];
    const inventoryOutputs: string[] = [];
    let pagesRead = 0;
    let paginationCompleted = false;

    for (let page = 1; page <= 500; page += 1) {
        const capture = runCommand(command(
            `production-queue-inventory-immediately-before-enable-page-${page}`,
            ['queues', 'list', '--page', String(page)],
            false,
        ));
        captures.push(capture);
        resultChecks.push(commandCheck(capture));
        pagesRead = page;
        if (capture.status === 'failed') return { checks: resultChecks, readiness: null };
        inventoryOutputs.push(capture.stdout, capture.stderr);
        if (queueRowsInPage(capture.stdout) === 0) {
            paginationCompleted = true;
            break;
        }
    }

    if (!paginationCompleted) {
        resultChecks.push(failed('fresh_production_queue_inventory_pre_enable', 'Queue inventory pagination did not terminate safely; active deploy is blocked.', [
            `pagesRead=${pagesRead}`,
            'externalWriteAttempted=false',
        ]));
        return { checks: resultChecks, readiness: null };
    }

    const inventory = classifyQueueInventory(inventoryOutputs.join('\n'));
    const exactInventory = inventory.queueCount === 1 && inventory.deadLetterQueueCount === 1;
    resultChecks.push(exactInventory
        ? ok('fresh_production_queue_inventory_pre_enable', 'Fresh full inventory contains exactly one production Queue and one DLQ.', [
            `queue=${PRODUCTION_QUEUE_TARGET.queue}`,
            `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}`,
            `pagesRead=${pagesRead}`,
        ])
        : failed('fresh_production_queue_inventory_pre_enable', 'Fresh full inventory does not contain each exact production Queue name once; active deploy is blocked.', [
            `queueCount=${inventory.queueCount}`,
            `dlqCount=${inventory.deadLetterQueueCount}`,
            `pagesRead=${pagesRead}`,
            'externalWriteAttempted=false',
        ]));
    if (!exactInventory) return { checks: resultChecks, readiness: null };

    const queueInfo = runCommand(command(
        'production-queue-info-immediately-before-enable',
        ['queues', 'info', PRODUCTION_QUEUE_TARGET.queue],
        false,
    ));
    const deadLetterQueueInfo = runCommand(command(
        'production-dlq-info-immediately-before-enable',
        ['queues', 'info', PRODUCTION_QUEUE_TARGET.deadLetterQueue],
        false,
    ));
    captures.push(queueInfo, deadLetterQueueInfo);
    resultChecks.push(commandCheck(queueInfo), commandCheck(deadLetterQueueInfo));
    const infoVerified = queueInfo.status === 'ok' && deadLetterQueueInfo.status === 'ok';
    resultChecks.push(infoVerified
        ? ok('fresh_production_queue_info_pre_enable', 'Fresh exact-name Queue and DLQ info reads succeeded immediately before enable.', [
            `queue=${PRODUCTION_QUEUE_TARGET.queue}`,
            `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}`,
            'writesCloudflare=false',
        ])
        : failed('fresh_production_queue_info_pre_enable', 'Exact-name Queue or DLQ info could not be proven; active deploy is blocked.', [
            `queueInfo=${queueInfo.status}`,
            `dlqInfo=${deadLetterQueueInfo.status}`,
            'externalWriteAttempted=false',
        ]));
    if (!infoVerified) return { checks: resultChecks, readiness: null };

    return {
        checks: resultChecks,
        readiness: {
            observedAt: new Date().toISOString(),
            pagesRead,
            queueCount: 1,
            deadLetterQueueCount: 1,
            queueInfoVerified: true,
            deadLetterQueueInfoVerified: true,
        },
    };
}

function queueVersionBindingProbe(
    expectedVersionId: string,
    expectedMode: ProductionQueueRuntimeMode,
    label: string,
): Check {
    const capture = runCommand(command(
        `fulfillment-${label}-queue-binding-version-view`,
        ['versions', 'view', expectedVersionId, '--name', target.worker, '--json'],
        false,
    ));
    captures.push(capture);
    if (capture.status === 'failed') {
        return failed(`queue_version_binding_${expectedMode}_${label}`, 'The exact Worker version binding inventory could not be read.', [
            `capture=${relative(capture.outputPath)}`,
        ]);
    }
    const validation = validateProductionQueueVersionBinding(capture.stdout, expectedVersionId, expectedMode);
    return validation.ok
        ? ok(`queue_version_binding_${expectedMode}_${label}`, `The exact ${expectedMode} Worker version has the required Queue binding posture.`, [
            `versionId=${expectedVersionId}`,
            `expectedQueueBinding=${expectedMode === 'active' ? PRODUCTION_QUEUE_TARGET.queue : 'absent'}`,
        ])
        : failed(`queue_version_binding_${expectedMode}_${label}`, `The exact ${expectedMode} Worker version does not have the required Queue binding posture.`, validation.errors);
}

async function productionQueueRuntimeProbe(expectedMode: ProductionQueueRuntimeMode): Promise<Check> {
    try {
        const rows: unknown[] = [];
        let paginationComplete = false;
        for (let page = 1; page <= 500; page += 1) {
            const result = await cloudflareApiGetResult(`/accounts/${target.accountId}/queues?page=${page}&per_page=100`);
            if (!Array.isArray(result)) throw new Error('Cloudflare Queue inventory result is not an array.');
            rows.push(...result);
            if (result.length < 100) {
                paginationComplete = true;
                break;
            }
        }
        if (!paginationComplete) throw new Error('Cloudflare Queue inventory pagination did not terminate.');

        const records = rows.map(asRecord);
        const primaryMatches = records.filter((row) => queueResourceName(row) === PRODUCTION_QUEUE_TARGET.queue);
        const dlqMatches = records.filter((row) => queueResourceName(row) === PRODUCTION_QUEUE_TARGET.deadLetterQueue);
        if (primaryMatches.length !== 1 || dlqMatches.length !== 1) {
            throw new Error(`Exact Queue inventory mismatch: primary=${primaryMatches.length}, dlq=${dlqMatches.length}.`);
        }
        const primaryId = queueResourceId(primaryMatches[0]);
        const dlqId = queueResourceId(dlqMatches[0]);
        if (!primaryId || !dlqId) throw new Error('Exact Queue or DLQ ID is missing or invalid.');

        const [queueDetail, queueMetrics, dlqDetail, dlqMetrics] = await Promise.all([
            cloudflareApiGetResult(`/accounts/${target.accountId}/queues/${primaryId}`),
            cloudflareApiGetResult(`/accounts/${target.accountId}/queues/${primaryId}/metrics`),
            cloudflareApiGetResult(`/accounts/${target.accountId}/queues/${dlqId}`),
            cloudflareApiGetResult(`/accounts/${target.accountId}/queues/${dlqId}/metrics`),
        ]);
        const validation = validateProductionQueueRuntimeReadback({
            inventoryRows: rows,
            queueDetail,
            queueMetrics,
            deadLetterQueueDetail: dlqDetail,
            deadLetterQueueMetrics: dlqMetrics,
            expectedMode,
        });
        return validation.ok
            ? ok(`production_queue_runtime_${expectedMode}`, `Fresh Cloudflare API readback proves the exact ${expectedMode} Queue/DLQ/paused posture.`, [
                `queue=${PRODUCTION_QUEUE_TARGET.queue}`,
                `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}`,
                `queueId=${validation.queueId}`,
                `dlqId=${validation.deadLetterQueueId}`,
                'deliveryPaused=false',
                `attachments=${expectedMode === 'active' ? 'producer=1,consumer=1' : 'producer=0,consumer=0'}`,
                'backlog=0',
            ])
            : failed(`production_queue_runtime_${expectedMode}`, `Fresh Cloudflare API readback does not prove the exact ${expectedMode} Queue/DLQ/paused posture.`, validation.errors);
    } catch (error) {
        return failed(`production_queue_runtime_${expectedMode}`, 'Fresh Cloudflare Queue runtime readback failed closed.', [safeError(error)]);
    }
}

async function cloudflareApiGetResult(apiPath: string): Promise<unknown> {
    if (!isAllowlistedQueueGetPath(apiPath)) throw new Error('Cloudflare Queue GET path is outside the exact allowlist.');
    const response = await requestAllowlistedCloudflareAccount(apiPath, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json() as { success?: unknown; result?: unknown };
    if (response.status !== 200 || body.success !== true) throw new Error(`Cloudflare Queue GET failed with HTTP ${response.status}.`);
    return body.result;
}

function isAllowlistedQueueGetPath(apiPath: string): boolean {
    const accountPrefix = `/accounts/${target.accountId}`;
    return new RegExp(`^${escapeRegExp(accountPrefix)}/queues\\?page=\\d+&per_page=100$`, 'u').test(apiPath)
        || new RegExp(`^${escapeRegExp(accountPrefix)}/queues/[0-9a-f]{32}(?:/metrics)?$`, 'iu').test(apiPath);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function queueResourceName(value: Record<string, unknown>): string {
    return typeof value.queue_name === 'string'
        ? value.queue_name
        : typeof value.name === 'string'
            ? value.name
            : '';
}

function queueResourceId(value: Record<string, unknown>): string | null {
    const candidate = typeof value.queue_id === 'string'
        ? value.queue_id
        : typeof value.id === 'string'
            ? value.id
            : '';
    return /^[0-9a-f]{32}$/iu.test(candidate) ? candidate : null;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

async function readFreshStripeLiveReadiness(): Promise<StripeReadinessResult> {
    try {
        const stripe = new Stripe(secretValue('STRIPE_SECRET_KEY'), {
            maxNetworkRetries: 0,
            timeout: 20_000,
        });
        const readiness = await inspectStripeLiveReadiness(
            stripe,
            secretValue('STRIPE_EXPECTED_ACCOUNT_ID'),
            secretValue('STRIPE_PORTAL_CONFIGURATION_ID'),
        );
        const observedAt = new Date().toISOString();
        return {
            check: readiness.ok
                ? ok('fresh_stripe_live_readiness_immediately_before_enable', 'Fresh read-only Stripe Live proof matches the exact account, ES/EUR readiness, Portal and webhook immediately before enable.', [
                    `accountMatched=${String(readiness.facts.accountMatched)}`,
                    `accountReady=${String(readiness.facts.accountReady)}`,
                    `country=${readiness.facts.country}`,
                    `currency=${readiness.facts.currency}`,
                    `portalMatched=${String(readiness.facts.portalMatched)}`,
                    `webhookMatched=${String(readiness.facts.webhookMatched)}`,
                    `enabledWebhookCount=${readiness.facts.enabledWebhookCount}`,
                    'writesStripe=false',
                ])
                : failed('fresh_stripe_live_readiness_immediately_before_enable', 'Fresh Stripe Live readiness did not match; active fulfillment deploy is blocked.', readiness.failures.map((failure) => `failure=${failure}`)),
            readiness: readiness.ok ? { observedAt, readiness } : null,
        };
    } catch {
        return {
            check: failed('fresh_stripe_live_readiness_immediately_before_enable', 'Fresh Stripe Live readiness could not be proven; active fulfillment deploy is blocked.', [
                'failure=stripe_readonly_probe_unavailable',
                'externalWriteAttempted=false',
            ]),
            readiness: null,
        };
    }
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
    const apiPath = `/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}/schedules`;
    try {
        const response = await requestAllowlistedCloudflareAccount(apiPath, {
            redirect: 'error',
            signal: AbortSignal.timeout(20_000),
        });
        const body = await response.json() as unknown;
        const parsed = parseCloudflareCronSchedulesResponse(body);
        const schedules = parsed?.schedules;
        const matched = response.status === 200
            && schedules !== undefined
            && (expectedMode === 'bootstrap'
                ? schedules.length === 0
                : schedules.length === 1 && schedules[0]?.cron === '0 * * * *');
        return matched
            ? ok(`cron_${expectedMode}`, `Remote Cron Trigger state matches ${expectedMode}.`, [
                `scheduleCount=${schedules?.length ?? 'unknown'}`,
                `expected=${expectedMode === 'bootstrap' ? 'none' : '0 * * * *'}`,
            ])
            : failed(`cron_${expectedMode}`, `Remote Cron Trigger state does not match ${expectedMode}.`, [
                `httpStatus=${response.status}`,
                `scheduleCount=${schedules?.length ?? 'unknown'}`,
            ]);
    } catch (error) {
        return failed(`cron_${expectedMode}`, 'Remote Cron Trigger state could not be proven.', [safeError(error)]);
    }
}

async function compensateToBootstrap(directUrl: string): Promise<string | null> {
    checks.push(failed('active_enable_not_proven', 'Active deployment failed or its final state is ambiguous; compensating bootstrap rollback is mandatory.', []));
    const current = requireEnableCheckpoint();
    const compensationStarted = markProductionEnableCheckpointCompensationStarted(
        current,
        new Date().toISOString(),
    );
    try {
        persistEnableCheckpoint(compensationStarted, current);
        enableCheckpoint = compensationStarted;
    } catch (error) {
        checks.push(failed('compensation_checkpoint_transition', 'Could not persist the compensation-started transition; rollback is not launched because a restart must never mistake an in-flight compensation for active proven.', [
            `error=${safeError(error)}`,
        ]));
        throw error;
    }
    externalWriteAttempted = true;
    externalWritePerformed = 'unknown';
    assertEnableMutationOwnership('compensating bootstrap rollback');
    const rollback = runCommand(deployCommand('fulfillment-compensating-bootstrap-rollback', 'production_bootstrap', false));
    captures.push(rollback);
    checks.push(commandCheck(rollback));
    if (rollback.status !== 'ok') {
        checks.push(failed('active_deploy_state_ambiguous', 'Compensating bootstrap rollback failed or timed out; remote fulfillment state is ambiguous.', [
            'manualStopRequired=true',
        ]));
        return null;
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
        return null;
    }

    const health = await healthProbe(directUrl, 'bootstrap');
    const blocked = await disabledOperationProbe(directUrl);
    const attestation = await runtimeAttestation(directUrl, versionId, 'bootstrap');
    const cron = await cronScheduleProbe('bootstrap');
    const queueBinding = queueVersionBindingProbe(versionId, 'bootstrap', 'after-compensation');
    const queueRuntime = await productionQueueRuntimeProbe('bootstrap');
    checks.push(health, blocked, attestation, cron, queueBinding, queueRuntime);
    const proven = [health, blocked, attestation, cron, queueBinding, queueRuntime]
        .every((check) => check.status === 'ok');
    checks.push(proven
        ? ok('compensating_bootstrap_rollback_proven', 'Compensating rollback restored a version-bound bootstrap with operations blocked, no Cron Trigger and all Queue attachments detached.', [
            `versionId=${versionId}`,
            'operationMode=bootstrap',
            'operationalHttpStatus=503',
            'cronCount=0',
            'queueProducerCount=0',
            'queueConsumerCount=0',
        ])
        : failed('active_deploy_state_ambiguous', 'Compensating rollback ran but bootstrap/503/HMAC/no-cron state is not fully proven.', [
            'manualStopRequired=true',
        ]));
    return proven ? versionId : null;
}

function command(id: string, wranglerArgs: string[], writesCloudflare: boolean): CommandSpec {
    return {
        id,
        display: `pnpm --config.verify-deps-before-run=false exec wrangler ${wranglerArgs.join(' ')}`,
        args: ['--config.verify-deps-before-run=false', 'exec', 'wrangler', ...wranglerArgs],
        writesCloudflare,
    };
}

function deployCommand(
    id: string,
    environment: 'production_bootstrap' | 'production',
    dryRun: boolean,
    deployTag?: string,
): CommandSpec {
    return command(id, [
        'deploy', '--config', target.config, '--env', environment,
        ...(dryRun ? ['--dry-run'] : ['--keep-vars']),
        ...(deployTag ? ['--tag', deployTag] : []),
    ], !dryRun);
}

function deploymentsCommand(id: string): CommandSpec {
    return command(id, ['deployments', 'list', '--name', target.worker, '--json'], false);
}

function versionViewCommand(id: string, versionId: string): CommandSpec {
    return command(id, ['versions', 'view', versionId, '--name', target.worker, '--json'], false);
}

function runCommand(spec: CommandSpec): CommandCapture {
    const result = runCloudflareWranglerFromKeyring(scopedWranglerArgs(spec.args), {
        timeoutMs: 180_000,
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
    return {
        ...spec,
        status,
        exitCode: result.status,
        outputPath,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function scopedWranglerArgs(args: readonly string[]): string[] {
    const prefix = ['--config.verify-deps-before-run=false', 'exec', 'wrangler'];
    if (!prefix.every((value, index) => args[index] === value)) {
        throw new Error('Refusing a command outside the scoped Wrangler command boundary.');
    }
    return args.slice(prefix.length);
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

function section(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    return startIndex >= 0 ? source.slice(startIndex, endIndex >= 0 ? endIndex : undefined) : '';
}

function sanitize(value: string): string {
    let sanitized = value
        .replace(new RegExp('-----BEGIN [A-Z ]+' + 'PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]+' + 'PRIVATE KEY-----', 'gu'), '[redacted-private-key]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]');
    for (const secret of requiredSecretNames.map(secretValue)) {
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
        '- Queue inventory and info are read-only; no Queue create, delete, purge, pause, resume or consumer command is allowed.',
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
        `- Structured enable prewrite evidence: ${existsSync(enablePrewriteEvidencePath) ? relative(enablePrewriteEvidencePath) : 'not generated'}`,
        `- Durable enable checkpoint: ${relative(enableCheckpointPath)}`,
        `- Enable checkpoint status: ${enableCheckpoint?.status ?? 'none'}`,
        `- Enable checkpoint revision: ${enableCheckpoint?.revision ?? 'none'}`,
        `- Canonical enable lock: ${relative(enableLockPath)}`,
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
