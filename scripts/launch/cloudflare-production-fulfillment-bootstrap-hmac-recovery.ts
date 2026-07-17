import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    openOneShotCloudflareWriteGuard,
    reconcileOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
} from './cloudflare-production-one-shot-write';
import {
    findUnresolvedWorkerWriteCheckpoints,
    requireRecoverableWorkerWriteExecutionLock,
    type WorkerWriteCheckpoint,
    type WorkerWriteLockOwner,
} from './cloudflare-production-worker-safety';
import { parseCloudflareCronSchedulesResponse } from './cloudflare-cron-schedules-response';
import { newestWorkerDeploymentVersionId } from './cloudflare-deployment-order';
import {
    retryCloudflareReadonlyEvidence,
    type CloudflareReadonlyAttemptResult,
} from './cloudflare-readonly-retry';
import {
    requestAllowlistedCloudflareAccount,
    withCloudflareWranglerOAuth,
} from './cloudflare-wrangler-oauth';

type CheckStatus = 'ok' | 'failed';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CloudflareEnvelope {
    success?: unknown;
    result?: unknown;
    errors?: unknown;
}

interface HttpObservation {
    status: number;
    body: unknown;
}

export interface RecoveryRemoteProof {
    versionId: string;
    secretNames: string[];
    bindingNames: string[];
}

export type RecoverySecretInventory =
    | { state: 'empty'; names: [] }
    | { state: 'exact_hmac'; names: ['INTERNAL_JOB_SECRET'] }
    | { state: 'forbidden'; names: string[]; reason: string };

const target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    worker: 'espanol-honesto-fulfillment-production',
    directUrl: 'https://espanol-honesto-fulfillment-production.alindev95.workers.dev',
    originalScope: 'fulfillment-bootstrap-hmac-secret',
    recoveryScope: 'fulfillment-bootstrap-hmac-secret-recovery-delete',
} as const;

const approvalEnvVar = 'CLOUDFLARE_FULFILLMENT_BOOTSTRAP_HMAC_RECOVERY_APPROVAL';
const exactApprovalSentence = 'Autorizo recuperar unicamente el HMAC bootstrap fallido del Worker `espanol-honesto-fulfillment-production` en la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44`: borrar `INTERNAL_JOB_SECRET` como maximo una vez solo si es el unico secreto, no borrar nada si ya esta vacio, no reintentar el DELETE, probar version vigente, bindings provider-free, health bootstrap, operacion 503 y Cron 0, reconciliar `fulfillment-bootstrap-hmac-secret` mediante `safe_state_proven` y detenerse sin ejecutar D-E ni activar production.';
const executeRequested = process.argv.includes('--execute-approved');
const approvalMatched = process.env[approvalEnvVar]?.trim() === exactApprovalSentence;
const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-cloudflare-production-fulfillment-bootstrap-hmac-recovery',
    stamp(startedAt),
);

const allowedBindingsWithoutHmac = new Set([
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
]);

const requiredBindings = [
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
] as const;

export function classifyRecoverySecretNames(value: unknown): RecoverySecretInventory {
    if (!Array.isArray(value)) return { state: 'forbidden', names: [], reason: 'secret inventory is not an array' };
    const names: string[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name) {
            return { state: 'forbidden', names, reason: 'secret inventory contains a malformed entry' };
        }
        names.push(entry.name);
    }
    if (new Set(names).size !== names.length) {
        return { state: 'forbidden', names, reason: 'secret inventory contains duplicate names' };
    }
    if (names.length === 0) return { state: 'empty', names: [] };
    if (names.length === 1 && names[0] === 'INTERNAL_JOB_SECRET') {
        return { state: 'exact_hmac', names: ['INTERNAL_JOB_SECRET'] };
    }
    return { state: 'forbidden', names, reason: 'secret inventory contains an unexpected name' };
}

export function validateProviderFreeVersion(
    value: unknown,
    expectedVersionId: string,
    expectHmac: boolean,
): { ok: true; names: string[] } | { ok: false; reason: string; names: string[] } {
    if (!isRecord(value) || value.id !== expectedVersionId) {
        return { ok: false, reason: 'version detail identity mismatch', names: [] };
    }
    const resources = isRecord(value.resources) ? value.resources : null;
    if (!resources || !Array.isArray(resources.bindings)) {
        return { ok: false, reason: 'version binding inventory is missing', names: [] };
    }
    const names: string[] = [];
    for (const binding of resources.bindings) {
        if (!isRecord(binding) || typeof binding.name !== 'string' || !binding.name) {
            return { ok: false, reason: 'version binding inventory is malformed', names };
        }
        names.push(binding.name);
    }
    if (new Set(names).size !== names.length) {
        return { ok: false, reason: 'version binding inventory contains duplicates', names };
    }
    const allowed = new Set(allowedBindingsWithoutHmac);
    if (expectHmac) allowed.add('INTERNAL_JOB_SECRET');
    const unexpected = names.filter((name) => !allowed.has(name));
    if (unexpected.length > 0) {
        return { ok: false, reason: `unexpected bindings: ${unexpected.join(',')}`, names };
    }
    const missing = requiredBindings.filter((name) => !names.includes(name));
    if (missing.length > 0) {
        return { ok: false, reason: `missing inert bindings: ${missing.join(',')}`, names };
    }
    if (names.includes('INTERNAL_JOB_SECRET') !== expectHmac) {
        return { ok: false, reason: `INTERNAL_JOB_SECRET presence mismatch: expected=${String(expectHmac)}`, names };
    }
    return { ok: true, names };
}

export function recoveryCheckpointMismatch(
    checkpoint: WorkerWriteCheckpoint,
    lockOwner: WorkerWriteLockOwner,
): string | null {
    if (checkpoint.commandId !== 'fulfillment-bootstrap-secret-put-internal-job-secret') {
        return `unexpected pending command: ${checkpoint.commandId}`;
    }
    if (checkpoint.runId !== lockOwner.runId) {
        return `pending checkpoint run ${checkpoint.runId} does not own lock run ${lockOwner.runId}`;
    }
    const receipt = checkpoint.receipt;
    if (checkpoint.sequence !== 1
        || checkpoint.revision !== 2
        || checkpoint.stage !== 'readback_failed'
        || receipt.externalWriteAttempted !== true
        || receipt.externalWritePerformed !== true
        || receipt.externalWriteOutcome !== 'confirmed_succeeded_needs_readonly_reconciliation'
        || receipt.readonlyReconciliationRequired !== true) {
        return 'pending checkpoint is not the exact confirmed C write awaiting read-only reconciliation';
    }
    return null;
}

export function recoveryDeleteCheckpointMismatch(checkpoint: WorkerWriteCheckpoint | null): string | null {
    if (!checkpoint) return 'recovery-delete checkpoint is missing';
    if (checkpoint.commandId !== 'delete-fulfillment-bootstrap-internal-job-secret') {
        return `unexpected recovery-delete command: ${checkpoint.commandId}`;
    }
    if (checkpoint.sequence !== 1 || checkpoint.intent !== undefined) {
        return 'recovery-delete checkpoint shape is not the exact single-secret deletion';
    }
    return null;
}

async function main(): Promise<void> {
    mkdirSync(outputDir, { recursive: true });
    const checks: Check[] = [];
    let externalWriteAttempted = false;
    let externalWritePerformed: boolean | 'unknown' = false;
    let closure = 'BLOCKED_BY_GATE_OR_EVIDENCE';

    const finish = (): void => {
        const status = checks.some((check) => check.status === 'failed') ? 'FAILED' : 'OK';
        const report = {
            schemaVersion: 1,
            startedAt: startedAt.toISOString(),
            endedAt: new Date().toISOString(),
            status,
            closure,
            executeRequested,
            approvalMatched,
            externalWriteAttempted,
            externalWritePerformed,
            target,
            checks,
        };
        writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
        console.log(`[launch:cloudflare-production-fulfillment-bootstrap-hmac-recovery] Status: ${status}`);
        console.log(`[launch:cloudflare-production-fulfillment-bootstrap-hmac-recovery] Closure: ${closure}`);
        console.log(`[launch:cloudflare-production-fulfillment-bootstrap-hmac-recovery] External write attempted: ${String(externalWriteAttempted)}`);
        console.log(`[launch:cloudflare-production-fulfillment-bootstrap-hmac-recovery] External write performed: ${String(externalWritePerformed)}`);
        console.log(`[launch:cloudflare-production-fulfillment-bootstrap-hmac-recovery] Summary: ${path.join(outputDir, 'summary.md')}`);
        if (status === 'FAILED') process.exitCode = 1;
    };

    try {
        if (!executeRequested) {
            checks.push(ok('plan_only', 'Recovery plan generated without reading Cloudflare or mutating anything.', [
                `futureGate=${approvalEnvVar}`,
                'futureFlag=--execute-approved',
            ]));
            closure = 'PLAN_ONLY_READY';
            return;
        }
        if (!approvalMatched) {
            checks.push(failed('exact_approval_gate', 'Exact recovery approval did not match.', ['externalWriteAttempted=false']));
            return;
        }
        if (process.env.CLOUDFLARE_ACCOUNT_ID?.trim() !== target.accountId) {
            checks.push(failed('execution_environment_gate', 'The exact Cloudflare account is missing.', [
                `account=${target.accountId}`,
            ]));
            return;
        }
        checks.push(ok('exact_approval_gate', 'Exact terminal recovery approval matched.', [
            `account=${target.accountId}`,
            `worker=${target.worker}`,
            'deleteRetry=false',
            'D-E=forbidden',
        ]));

        await withCloudflareWranglerOAuth({
            accountId: target.accountId,
            consume: async () => {
        const staleRecovery = await reconcileOneShotCloudflareWriteGuard(
            target.recoveryScope,
            outputDir,
            {
                readback: async (checkpoint) => {
                    if (recoveryDeleteCheckpointMismatch(checkpoint)) return 'not_proven';
                    const proof = await retryRemoteProof('either', null);
                    if (proof.state !== 'proven') return 'not_proven';
                    return proof.value.secretNames.length === 0
                        ? 'intended_state_proven'
                        : 'safe_state_proven';
                },
            },
        );
        if (staleRecovery.status !== 'not_needed') {
            checks.push(staleRecovery.status === 'reconciled'
                ? ok('stale_recovery_delete_reconciled', 'A prior recovery-delete checkpoint was reconciled read-only; this run stops terminally.', [
                    `reason=${staleRecovery.reason}`,
                    'deleteRetried=false',
                ])
                : failed('stale_recovery_delete_reconciled', 'A prior recovery-delete checkpoint remains ambiguous.', [
                    `reason=${staleRecovery.reason}`,
                    'deleteRetried=false',
                ]));
            closure = staleRecovery.status === 'reconciled' ? 'RECOVERY_DELETE_RECONCILED_STOP' : closure;
            return;
        }

        const originalState = validateOriginalPendingState();
        checks.push(originalState);
        if (originalState.status === 'failed') return;

        const preflight = await retryRemoteProof('either', null);
        checks.push(retryCheck('remote_preflight', preflight));
        if (preflight.state !== 'proven') return;
        const before = preflight.value;
        const inventory = before.secretNames.length === 0 ? 'empty' : 'exact_hmac';

        const recoveryGuard = openOneShotCloudflareWriteGuard(target.recoveryScope, outputDir);
        let recoveryGuardClosed = false;
        try {
            const guardedPreflight = await retryRemoteProof('either', null);
            checks.push(retryCheck('guarded_remote_preflight', guardedPreflight));
            if (guardedPreflight.state !== 'proven') return;
            const guardedInventory = guardedPreflight.value.secretNames.length === 0 ? 'empty' : 'exact_hmac';
            if (guardedInventory !== inventory || guardedPreflight.value.versionId !== before.versionId) {
                checks.push(failed('guarded_state_identity', 'Remote state changed between preflight and the recovery guard.', [
                    `inventoryBefore=${inventory}`,
                    `inventoryGuarded=${guardedInventory}`,
                    `versionBefore=${before.versionId}`,
                    `versionGuarded=${guardedPreflight.value.versionId}`,
                ]));
                return;
            }
            checks.push(ok('guarded_state_identity', 'Remote pre-delete state is stable under the recovery guard.', [
                `inventory=${inventory}`,
                `version=${before.versionId}`,
            ]));

            if (inventory === 'exact_hmac') {
                const deleteCommandId = 'delete-fulfillment-bootstrap-internal-job-secret';
                let checkpoint = beginOneShotCloudflareWrite(recoveryGuard, deleteCommandId);
                externalWriteAttempted = true;
                externalWritePerformed = 'unknown';
                let deleteResult: HttpObservation;
                try {
                    deleteResult = await cloudflareRequest('DELETE',
                        `/accounts/${target.accountId}/workers/scripts/${encodeURIComponent(target.worker)}/secrets/INTERNAL_JOB_SECRET`);
                } catch (error) {
                    checkpoint = recordOneShotCloudflareProviderResult(recoveryGuard, checkpoint, {
                        exitCode: null,
                        timedOut: isAbort(error),
                        errorPresent: true,
                    });
                    checks.push(failed('single_secret_delete', 'The single authorized DELETE had an ambiguous transport outcome and was not retried.', [
                        `checkpointStage=${checkpoint.stage}`,
                        `error=${safeError(error)}`,
                        'deleteRetried=false',
                    ]));
                    return;
                }
                const deleteSucceeded = deleteResult.status === 200
                    && isRecord(deleteResult.body)
                    && deleteResult.body.success === true;
                checkpoint = recordOneShotCloudflareProviderResult(recoveryGuard, checkpoint, {
                    exitCode: deleteSucceeded ? 0 : 1,
                    timedOut: false,
                    errorPresent: !deleteSucceeded,
                });
                checks.push(deleteSucceeded
                    ? ok('single_secret_delete', 'The exact HMAC secret DELETE succeeded once and was not retried.', [
                        `httpStatus=${deleteResult.status}`,
                        'deleteCount=1',
                        'deleteRetried=false',
                    ])
                    : failed('single_secret_delete', 'The exact HMAC secret DELETE failed and was not retried.', [
                        `httpStatus=${deleteResult.status}`,
                        `checkpointStage=${checkpoint.stage}`,
                        'deleteCount=1',
                        'deleteRetried=false',
                    ]));
                if (!deleteSucceeded) return;

                const postDelete = await retryRemoteProof('empty', before.versionId);
                checks.push(retryCheck('post_delete_remote_proof', postDelete));
                checkpoint = recordOneShotCloudflareReadback(recoveryGuard, checkpoint, postDelete.state === 'proven');
                if (postDelete.state !== 'proven') return;
                externalWritePerformed = true;
            } else {
                checks.push(ok('empty_inventory_no_delete', 'Secret inventory was already empty; no DELETE was sent.', [
                    'deleteCount=0',
                    'deleteRetried=false',
                ]));
            }

            const originalReconciliation = await reconcileOneShotCloudflareWriteGuard(
                target.originalScope,
                outputDir,
                {
                    readback: async (checkpoint) => {
                        if (!checkpoint || checkpoint.commandId !== 'fulfillment-bootstrap-secret-put-internal-job-secret') {
                            return 'not_proven';
                        }
                        const proof = await retryRemoteProof('empty', null);
                        checks.push(retryCheck('original_scope_safe_state_readback', proof));
                        return proof.state === 'proven' ? 'safe_state_proven' : 'not_proven';
                    },
                },
            );
            checks.push(originalReconciliation.status === 'reconciled'
                && originalReconciliation.reason === 'fresh-readback-proved-safe-state'
                ? ok('original_scope_safe_state_reconciliation', 'The failed C checkpoint was reconciled to the exact safe pre-write state.', [
                    `checkpointCount=${originalReconciliation.checkpointCount}`,
                    `reason=${originalReconciliation.reason}`,
                ])
                : failed('original_scope_safe_state_reconciliation', 'The failed C checkpoint was not reconciled to safe_state_proven.', [
                    `status=${originalReconciliation.status}`,
                    `reason=${originalReconciliation.reason}`,
                ]));
            if (checks.at(-1)?.status === 'failed') return;

            closeOneShotCloudflareWriteGuard(recoveryGuard);
            recoveryGuardClosed = true;
            closure = 'SAFE_STATE_RECONCILED_STOP';
            checks.push(ok('terminal_stop_before_d_e', 'Recovery closed only the approved HMAC lock and stops before D-E.', [
                'DExecuted=false',
                'EExecuted=false',
                'productionActive=false',
            ]));
        } finally {
            if (!recoveryGuardClosed) {
                checks.push(ok('recovery_guard_fail_closed', 'Recovery guard remains closed because terminal proof did not finish.', [
                    `scope=${target.recoveryScope}`,
                ]));
            }
        }
            },
        });
    } catch (error) {
        checks.push(failed('unexpected_recovery_error', 'Recovery stopped on an unexpected error.', [safeError(error)]));
    } finally {
        finish();
    }
}

function validateOriginalPendingState(): Check {
    try {
        const stateRoot = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-write-state', target.originalScope);
        const pendingDirectory = path.join(stateRoot, 'write-checkpoints-pending');
        const lockDirectory = path.join(stateRoot, 'execution.lock');
        if (!existsSync(lockDirectory)) throw new Error('original execution.lock is missing');
        const pending = findUnresolvedWorkerWriteCheckpoints(pendingDirectory);
        if (pending.length !== 1) throw new Error(`expected one logical pending checkpoint, found ${pending.length}`);
        const checkpoint = pending[0];
        const lockOwner = requireRecoverableWorkerWriteExecutionLock(lockDirectory);
        const mismatch = recoveryCheckpointMismatch(checkpoint, lockOwner);
        if (mismatch) throw new Error(mismatch);
        const receipt = checkpoint.receipt;
        return ok('original_pending_state', 'The exact failed C checkpoint and dead-owner lock are recoverable.', [
            `commandId=${checkpoint.commandId}`,
            `stage=${checkpoint.stage}`,
            `runIdMatched=${String(checkpoint.runId === lockOwner.runId)}`,
            `externalWriteOutcome=${receipt.externalWriteOutcome}`,
            'logicalCheckpointCount=1',
        ]);
    } catch (error) {
        return failed('original_pending_state', 'The local failed C state is missing, live, foreign or ambiguous.', [safeError(error)]);
    }
}

async function retryRemoteProof(
    expectedSecrets: 'either' | 'empty',
    requireVersionChangeFrom: string | null,
) {
    return retryCloudflareReadonlyEvidence<RecoveryRemoteProof>({
        operation: 'readback',
        read: () => readRemoteProofAttempt(expectedSecrets, requireVersionChangeFrom),
    });
}

async function readRemoteProofAttempt(
    expectedSecrets: 'either' | 'empty',
    requireVersionChangeFrom: string | null,
): Promise<CloudflareReadonlyAttemptResult<RecoveryRemoteProof>> {
    try {
        const encodedWorker = encodeURIComponent(target.worker);
        const [deployments, secrets, schedules, health, operation] = await Promise.all([
            cloudflareRequest('GET', `/accounts/${target.accountId}/workers/scripts/${encodedWorker}/deployments`),
            cloudflareRequest('GET', `/accounts/${target.accountId}/workers/scripts/${encodedWorker}/secrets`),
            cloudflareRequest('GET', `/accounts/${target.accountId}/workers/scripts/${encodedWorker}/schedules`),
            directRequest('GET', `${target.directUrl}/health`),
            directRequest('POST', `${target.directUrl}/internal/jobs/process`, {}),
        ]);
        const retryableStatus = [deployments, secrets, schedules, health]
            .find((response) => response.status === 429 || response.status >= 500)
            ?? (operation.status === 429 || operation.status >= 500 && operation.status !== 503
                ? operation
                : undefined);
        if (retryableStatus) return { state: 'retryable', reason: `transient HTTP ${retryableStatus.status}` };

        if (deployments.status !== 200 || !isCloudflareSuccess(deployments.body)
            || secrets.status !== 200 || !isCloudflareSuccess(secrets.body)
            || schedules.status !== 200 || !isCloudflareSuccess(schedules.body)) {
            return { state: 'definitive_failure', reason: 'Cloudflare account/Worker readback failed' };
        }
        const deploymentResult = asEnvelope(deployments.body).result;
        const deploymentRows = isRecord(deploymentResult) ? deploymentResult.deployments : null;
        const versionId = newestWorkerDeploymentVersionId(deploymentRows);
        if (!versionId) return { state: 'definitive_failure', reason: 'current deployment version is ambiguous' };
        if (requireVersionChangeFrom && versionId === requireVersionChangeFrom) {
            return { state: 'retryable', reason: 'secret deletion deployment has not become current yet' };
        }

        const inventory = classifyRecoverySecretNames(asEnvelope(secrets.body).result);
        if (inventory.state === 'forbidden') {
            return { state: 'definitive_failure', reason: inventory.reason };
        }
        if (expectedSecrets === 'empty' && inventory.state === 'exact_hmac') {
            return { state: 'retryable', reason: 'INTERNAL_JOB_SECRET is still visible after delete' };
        }

        const parsedCron = parseCloudflareCronSchedulesResponse(schedules.body);
        if (!parsedCron) return { state: 'definitive_failure', reason: 'Cron response is malformed' };
        if (parsedCron.schedules.length !== 0) return { state: 'definitive_failure', reason: 'Cron is present' };

        if (health.status === 404) return { state: 'retryable', reason: 'health route is not propagated yet' };
        const healthBody = isRecord(health.body) ? health.body : null;
        if (health.status !== 200 || !healthBody || healthBody.ok !== true
            || healthBody.operationMode !== 'bootstrap' || healthBody.workerIdentity !== target.worker) {
            return { state: 'definitive_failure', reason: 'health did not prove the exact bootstrap Worker' };
        }
        const operationBody = isRecord(operation.body) ? operation.body : null;
        if (operation.status !== 503 || !operationBody || operationBody.errorCode !== 'FULFILLMENT_DISABLED') {
            return { state: 'definitive_failure', reason: 'operational route is not blocked with FULFILLMENT_DISABLED' };
        }

        const version = await cloudflareRequest(
            'GET',
            `/accounts/${target.accountId}/workers/scripts/${encodedWorker}/versions/${encodeURIComponent(versionId)}`,
        );
        if (version.status === 404 || version.status === 429 || version.status >= 500) {
            return { state: 'retryable', reason: `version detail is transient: HTTP ${version.status}` };
        }
        if (version.status !== 200 || !isCloudflareSuccess(version.body)) {
            return { state: 'definitive_failure', reason: 'version detail readback failed' };
        }
        const expectHmac = inventory.state === 'exact_hmac';
        const providerProof = validateProviderFreeVersion(asEnvelope(version.body).result, versionId, expectHmac);
        if (providerProof.ok === false) {
            if (expectedSecrets === 'empty' && providerProof.names.includes('INTERNAL_JOB_SECRET')) {
                return { state: 'retryable', reason: 'version binding inventory still contains INTERNAL_JOB_SECRET' };
            }
            return { state: 'definitive_failure', reason: providerProof.reason };
        }
        return {
            state: 'proven',
            value: {
                versionId,
                secretNames: inventory.names,
                bindingNames: providerProof.names,
            },
        };
    } catch (error) {
        if (isAbort(error) || error instanceof TypeError) {
            return { state: 'retryable', reason: `transport_or_timeout:${safeError(error)}` };
        }
        return { state: 'definitive_failure', reason: safeError(error) };
    }
}

async function cloudflareRequest(
    method: 'GET' | 'DELETE',
    apiPath: string,
): Promise<HttpObservation> {
    const response = await requestAllowlistedCloudflareAccount(apiPath, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, body: await response.json() as unknown };
}

async function directRequest(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
): Promise<HttpObservation> {
    const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
    });
    let parsed: unknown = null;
    try {
        parsed = await response.json() as unknown;
    } catch {
        parsed = null;
    }
    return { status: response.status, body: parsed };
}

function retryCheck(name: string, result: Awaited<ReturnType<typeof retryRemoteProof>>): Check {
    return result.state === 'proven'
        ? ok(name, 'Bounded read-only Cloudflare proof succeeded.', [
            `attempts=${result.attempts}`,
            `version=${result.value.versionId}`,
            `secretCount=${result.value.secretNames.length}`,
            `bindingCount=${result.value.bindingNames.length}`,
        ])
        : failed(name, 'Bounded read-only Cloudflare proof did not close.', [
            `state=${result.state}`,
            `attempts=${result.attempts}`,
            `reason=${result.reason}`,
            `exhausted=${String(result.exhausted)}`,
        ]);
}

function renderSummary(report: {
    status: string;
    closure: string;
    executeRequested: boolean;
    approvalMatched: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: boolean | 'unknown';
    checks: Check[];
}): string {
    return [
        '# Cloudflare fulfillment bootstrap HMAC recovery',
        '',
        `- Status: ${report.status}`,
        `- Closure: ${report.closure}`,
        `- Execute requested: ${String(report.executeRequested)}`,
        `- Approval matched: ${String(report.approvalMatched)}`,
        `- External write attempted: ${String(report.externalWriteAttempted)}`,
        `- External write performed: ${String(report.externalWritePerformed)}`,
        `- Account: ${target.accountId}`,
        `- Worker: ${target.worker}`,
        '',
        '| Status | Check | Message |',
        '|---|---|---|',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${check.message} ${check.details.join('; ')} |`),
        '',
    ].join('\n');
}

function isCloudflareSuccess(value: unknown): boolean {
    return isRecord(value) && value.success === true;
}

function asEnvelope(value: unknown): CloudflareEnvelope {
    return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function failed(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown): boolean {
    return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function stamp(value: Date): string {
    return value.toISOString().replace(/[:.]/g, '-');
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    await main();
}
