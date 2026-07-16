import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseMixedJsonOutput } from '../ci/verify-cloudflare-identity';
import {
    acquireNormalWorkerWriteExecutionLock,
    acquireWorkerWriteReconciliationLock,
    assertWorkerWriteExecutionLockOwned,
    classifyWorkerWriteProviderResult,
    findUnresolvedWorkerWriteCheckpoints,
    persistCanonicalWorkerWriteCheckpoint,
    persistWorkerWriteCheckpointAtomically,
    reconcileWorkerWriteCheckpoint,
    reconcileWorkerWriteCheckpointToSafeState,
    releaseWorkerWriteExecutionLock,
    requireRecoverableWorkerWriteExecutionLock,
    resolveCanonicalWorkerWriteCheckpoint,
    startWorkerWriteCheckpoint,
    type ProcessLiveness,
    type ProviderProcessResult,
    type WorkerWriteCheckpoint,
    type WorkerWriteIntent,
    type WorkerWriteLockOwner,
} from './cloudflare-production-worker-safety';

export interface OneShotCloudflareWriteGuard {
    scope: string;
    runId: string;
    evidenceDirectory: string;
    pendingDirectory: string;
    resolvedDirectory: string;
    lockDirectory: string;
    reconciliationLockDirectory: string;
    owner: WorkerWriteLockOwner;
    nextSequence: number;
}

export type OneShotCloudflareReconciliationStatus = 'not_needed' | 'reconciled' | 'blocked';

export interface OneShotCloudflareReconciliationResult {
    status: OneShotCloudflareReconciliationStatus;
    scope: string;
    checkpointCount: number;
    lockOnly: boolean;
    reason: string;
}

export type OneShotCloudflareReadbackResult =
    | 'intended_state_proven'
    | 'safe_state_proven'
    | 'not_proven';

export interface OneShotCloudflareReconciliationOptions {
    /**
     * Must perform only fresh read-only provider observations. It must never
     * retry, compensate or otherwise mutate the provider. For a lock-only
     * post-write crash, the callback receives the latest resolved checkpoint
     * from the lock owner's run. A lock opened before any checkpoint needs no
     * provider readback because write-ahead persistence precedes every write.
     */
    readback: (
        checkpoint: WorkerWriteCheckpoint | null,
    ) => Promise<OneShotCloudflareReadbackResult | boolean> | OneShotCloudflareReadbackResult | boolean;
    /** Test seam. Production callers must rely on the default OS liveness probe. */
    livenessProbe?: (ownerPid: number) => ProcessLiveness;
}

interface OneShotCloudflareWriteStatePaths {
    scope: string;
    stateRoot: string;
    pendingDirectory: string;
    resolvedDirectory: string;
    lockDirectory: string;
    reconciliationLockDirectory: string;
}

function safeScope(value: string): string {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    if (!normalized) throw new Error('Cloudflare write scope is invalid.');
    return normalized;
}

export function openOneShotCloudflareWriteGuard(
    scope: string,
    evidenceDirectory: string,
): OneShotCloudflareWriteGuard {
    const state = oneShotCloudflareWriteStatePaths(scope);
    const {
        scope: normalizedScope,
        pendingDirectory,
        resolvedDirectory,
        lockDirectory,
        reconciliationLockDirectory,
    } = state;
    const unresolved = findUnresolvedWorkerWriteCheckpoints(pendingDirectory);
    if (unresolved.length > 0) {
        throw new Error(`Cloudflare write scope ${normalizedScope} has unresolved write checkpoints; fresh read-only reconciliation is required.`);
    }
    const runId = randomUUID();
    const owner = acquireNormalWorkerWriteExecutionLock(
        lockDirectory,
        reconciliationLockDirectory,
        runId,
    );
    return {
        scope: normalizedScope,
        runId,
        evidenceDirectory,
        pendingDirectory,
        resolvedDirectory,
        lockDirectory,
        reconciliationLockDirectory,
        owner,
        nextSequence: 1,
    };
}

/**
 * Reconciles a crashed one-shot write using fresh readbacks only.
 *
 * This function deliberately never invokes the original provider mutation.
 * A caller must stop the current execution whenever the result is not
 * `not_needed`; even a successful reconciliation is a terminal recovery-only
 * action for that process. A later, separately gated invocation may decide
 * whether another distinct mutation is still required.
 */
export async function reconcileOneShotCloudflareWriteGuard(
    scope: string,
    evidenceDirectory: string,
    options: OneShotCloudflareReconciliationOptions,
): Promise<OneShotCloudflareReconciliationResult> {
    const state = oneShotCloudflareWriteStatePaths(scope);
    let unresolved: WorkerWriteCheckpoint[];
    try {
        unresolved = findUnresolvedWorkerWriteCheckpoints(state.pendingDirectory);
    } catch (error) {
        return blockedReconciliation(state.scope, 0, false, `checkpoint-read-failed:${safeError(error)}`);
    }
    const executionLockExists = existsSync(state.lockDirectory);
    const reconciliationLockExists = existsSync(state.reconciliationLockDirectory);
    if (unresolved.length === 0 && !executionLockExists && !reconciliationLockExists) {
        return {
            status: 'not_needed',
            scope: state.scope,
            checkpointCount: 0,
            lockOnly: false,
            reason: 'no-pending-checkpoint-or-execution-lock',
        };
    }

    let reconciliationOwner: WorkerWriteLockOwner | null = null;
    let recoveredExecutionOwner: WorkerWriteLockOwner | null = null;
    let result: OneShotCloudflareReconciliationResult = blockedReconciliation(
        state.scope,
        unresolved.length,
        unresolved.length === 0,
        'reconciliation-not-completed',
    );

    try {
        reconciliationOwner = acquireWorkerWriteReconciliationLock(
            state.reconciliationLockDirectory,
            randomUUID(),
            options.livenessProbe,
        );
        result = await reconcileOneShotStateUnderLock();
    } catch (error) {
        result = blockedReconciliation(
            state.scope,
            unresolved.length,
            unresolved.length === 0,
            `reconciliation-lock-or-state-failed:${safeError(error)}`,
        );
    }
    if (reconciliationOwner) {
        try {
            releaseWorkerWriteExecutionLock(state.reconciliationLockDirectory, reconciliationOwner);
        } catch (error) {
            result = blockedReconciliation(
                state.scope,
                unresolved.length,
                unresolved.length === 0,
                `reconciliation-lock-release-failed:${safeError(error)}`,
            );
        }
    }
    return result;

    async function reconcileOneShotStateUnderLock(): Promise<OneShotCloudflareReconciliationResult> {
        // Re-read after acquiring the reconciliation lock. A normal writer is
        // now excluded, and a concurrent recovery cannot change canonical
        // checkpoints underneath this process.
        unresolved = findUnresolvedWorkerWriteCheckpoints(state.pendingDirectory);
        if (existsSync(state.lockDirectory)) {
            recoveredExecutionOwner = requireRecoverableWorkerWriteExecutionLock(
                state.lockDirectory,
                undefined,
                options.livenessProbe,
            );
        }

        let lockOnlyPrewrite = false;
        let targets: Array<{ checkpoint: WorkerWriteCheckpoint; pending: boolean }>;
        if (unresolved.length > 0) {
            targets = unresolved.map((checkpoint) => ({ checkpoint, pending: true }));
        } else if (recoveredExecutionOwner) {
            const resolvedForOwner = findUnresolvedWorkerWriteCheckpoints(state.resolvedDirectory)
                .filter((checkpoint) => checkpoint.runId === recoveredExecutionOwner?.runId)
                .sort((left, right) => right.sequence - left.sequence || right.revision - left.revision);
            lockOnlyPrewrite = resolvedForOwner.length === 0;
            targets = lockOnlyPrewrite
                ? []
                : [{ checkpoint: resolvedForOwner[0], pending: false }];
        } else {
            targets = [];
        }

        let safeStateCheckpointCount = 0;
        for (const target of targets) {
            const checkpoint = target.checkpoint;
            let readbackResult: OneShotCloudflareReadbackResult = 'not_proven';
            try {
                readbackResult = normalizeReadbackResult(await options.readback(checkpoint));
            } catch (error) {
                return blockedReconciliation(
                    state.scope,
                    unresolved.length,
                    unresolved.length === 0,
                    `readback-failed:${safeError(error)}`,
                );
            }

            if (readbackResult === 'not_proven') {
                if (target.pending) {
                    const failedReadback = reconcileWorkerWriteCheckpoint(checkpoint, false);
                    persistCanonicalWorkerWriteCheckpoint(state.pendingDirectory, failedReadback);
                    persistWorkerWriteCheckpointAtomically(evidenceDirectory, failedReadback);
                }
                return blockedReconciliation(
                    state.scope,
                    unresolved.length,
                    unresolved.length === 0,
                    `intended-state-not-proven:${checkpoint.commandId}`,
                );
            }

            if (readbackResult === 'safe_state_proven') safeStateCheckpointCount += 1;
            if (target.pending) {
                const proven = readbackResult === 'safe_state_proven'
                    ? reconcileWorkerWriteCheckpointToSafeState(checkpoint)
                    : reconcileWorkerWriteCheckpoint(checkpoint, true);
                persistCanonicalWorkerWriteCheckpoint(state.pendingDirectory, proven);
                persistWorkerWriteCheckpointAtomically(evidenceDirectory, proven);
                resolveCanonicalWorkerWriteCheckpoint(
                    state.pendingDirectory,
                    state.resolvedDirectory,
                    proven,
                );
            }
        }

        const remaining = findUnresolvedWorkerWriteCheckpoints(state.pendingDirectory);
        if (remaining.length > 0) {
            return blockedReconciliation(
                state.scope,
                remaining.length,
                false,
                'pending-checkpoints-remain-after-readback',
            );
        }

        if (recoveredExecutionOwner) {
            // Revalidate owner identity and definite process death immediately
            // before the only destructive local action (lock removal).
            assertWorkerWriteExecutionLockOwned(state.lockDirectory, recoveredExecutionOwner);
            requireRecoverableWorkerWriteExecutionLock(
                state.lockDirectory,
                undefined,
                options.livenessProbe,
            );
            releaseWorkerWriteExecutionLock(state.lockDirectory, recoveredExecutionOwner);
            recoveredExecutionOwner = null;
        }

        return {
            status: 'reconciled',
            scope: state.scope,
            checkpointCount: unresolved.length,
            lockOnly: unresolved.length === 0,
            reason: lockOnlyPrewrite
                ? 'stale-prewrite-lock-had-no-checkpoint-or-provider-write'
                : reconciliationLockExists && unresolved.length === 0 && !executionLockExists
                    ? 'stale-reconciliation-lock-had-no-pending-write'
                    : safeStateCheckpointCount > 0
                        ? 'fresh-readback-proved-safe-state'
                        : 'fresh-readback-proved-intended-state',
        };
    }
}

export function readResolvedOneShotCloudflareWriteCheckpoints(
    scope: string,
): WorkerWriteCheckpoint[] {
    const state = oneShotCloudflareWriteStatePaths(scope);
    return findUnresolvedWorkerWriteCheckpoints(state.resolvedDirectory);
}

export function beginOneShotCloudflareWrite(
    guard: OneShotCloudflareWriteGuard,
    commandId: string,
    intent?: WorkerWriteIntent,
): WorkerWriteCheckpoint {
    assertWorkerWriteExecutionLockOwned(guard.lockDirectory, guard.owner);
    const checkpoint = startWorkerWriteCheckpoint(commandId, guard.nextSequence, guard.runId, intent);
    guard.nextSequence += 1;
    persistOneShotCheckpoint(guard, checkpoint);
    return checkpoint;
}

export function workerDeployCheckpointMatchesCurrentVersion(
    checkpoint: WorkerWriteCheckpoint,
    expected: Omit<WorkerWriteIntent, 'kind' | 'prewriteVersionId'>,
    currentVersionId: string | null,
    currentVersionTag: string | null,
): boolean {
    const intent = checkpoint.intent;
    if (!intent || intent.kind !== 'cloudflare-worker-deploy' || !currentVersionId || !currentVersionTag) return false;
    return intent.accountId === expected.accountId
        && intent.worker === expected.worker
        && intent.environment === expected.environment
        && intent.deployTag === expected.deployTag
        && currentVersionTag === intent.deployTag
        && currentVersionId !== intent.prewriteVersionId;
}

export function createOneShotCloudflareDeployTag(
    guard: OneShotCloudflareWriteGuard,
    label: string,
): string {
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    if (!safeLabel) throw new Error('Cloudflare deploy tag label is invalid.');
    return `eh-rc-${safeLabel}-${guard.runId}`;
}

export function workerVersionTagFromView(
    source: string,
    expectedVersionId: string,
): string | null {
    let parsed: unknown;
    try {
        parsed = parseMixedJsonOutput(source);
    } catch {
        return null;
    }
    if (!isRecord(parsed) || parsed.id !== expectedVersionId || !isRecord(parsed.annotations)) return null;
    const tag = parsed.annotations['workers/tag'];
    return typeof tag === 'string' && tag.trim() ? tag.trim() : null;
}

export function recordOneShotCloudflareProviderResult(
    guard: OneShotCloudflareWriteGuard,
    checkpoint: WorkerWriteCheckpoint,
    result: ProviderProcessResult,
): WorkerWriteCheckpoint {
    assertWorkerWriteExecutionLockOwned(guard.lockDirectory, guard.owner);
    const next = classifyWorkerWriteProviderResult(checkpoint, result);
    persistOneShotCheckpoint(guard, next);
    return next;
}

export function recordOneShotCloudflareReadback(
    guard: OneShotCloudflareWriteGuard,
    checkpoint: WorkerWriteCheckpoint,
    intendedStateProven: boolean,
): WorkerWriteCheckpoint {
    assertWorkerWriteExecutionLockOwned(guard.lockDirectory, guard.owner);
    const next = reconcileWorkerWriteCheckpoint(checkpoint, intendedStateProven);
    persistOneShotCheckpoint(guard, next);
    if (intendedStateProven) {
        resolveCanonicalWorkerWriteCheckpoint(guard.pendingDirectory, guard.resolvedDirectory, next);
    }
    return next;
}

export function closeOneShotCloudflareWriteGuard(guard: OneShotCloudflareWriteGuard): void {
    assertWorkerWriteExecutionLockOwned(guard.lockDirectory, guard.owner);
    const unresolved = findUnresolvedWorkerWriteCheckpoints(guard.pendingDirectory);
    if (unresolved.length > 0) {
        throw new Error(`Cloudflare write scope ${guard.scope} still has unresolved write checkpoints; lock remains closed.`);
    }
    releaseWorkerWriteExecutionLock(guard.lockDirectory, guard.owner);
}

function persistOneShotCheckpoint(
    guard: OneShotCloudflareWriteGuard,
    checkpoint: WorkerWriteCheckpoint,
): void {
    persistCanonicalWorkerWriteCheckpoint(guard.pendingDirectory, checkpoint);
    persistWorkerWriteCheckpointAtomically(guard.evidenceDirectory, checkpoint);
}

function oneShotCloudflareWriteStatePaths(scope: string): OneShotCloudflareWriteStatePaths {
    const normalizedScope = safeScope(scope);
    const stateRoot = path.join(
        process.cwd(),
        'outputs',
        'launch-cloudflare-production-write-state',
        normalizedScope,
    );
    return {
        scope: normalizedScope,
        stateRoot,
        pendingDirectory: path.join(stateRoot, 'write-checkpoints-pending'),
        resolvedDirectory: path.join(stateRoot, 'write-checkpoints-resolved'),
        lockDirectory: path.join(stateRoot, 'execution.lock'),
        reconciliationLockDirectory: path.join(stateRoot, 'reconciliation.lock'),
    };
}

function blockedReconciliation(
    scope: string,
    checkpointCount: number,
    lockOnly: boolean,
    reason: string,
): OneShotCloudflareReconciliationResult {
    return { status: 'blocked', scope, checkpointCount, lockOnly, reason };
}

function normalizeReadbackResult(
    result: OneShotCloudflareReadbackResult | boolean,
): OneShotCloudflareReadbackResult {
    if (result === true) return 'intended_state_proven';
    if (result === false) return 'not_proven';
    if (
        result === 'intended_state_proven'
        || result === 'safe_state_proven'
        || result === 'not_proven'
    ) return result;
    throw new Error(`Unsupported one-shot Cloudflare readback result: ${String(result)}`);
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
