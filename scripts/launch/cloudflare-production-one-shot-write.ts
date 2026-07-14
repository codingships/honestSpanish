import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
    acquireNormalWorkerWriteExecutionLock,
    assertWorkerWriteExecutionLockOwned,
    classifyWorkerWriteProviderResult,
    findUnresolvedWorkerWriteCheckpoints,
    persistCanonicalWorkerWriteCheckpoint,
    persistWorkerWriteCheckpointAtomically,
    reconcileWorkerWriteCheckpoint,
    releaseWorkerWriteExecutionLock,
    resolveCanonicalWorkerWriteCheckpoint,
    startWorkerWriteCheckpoint,
    type ProviderProcessResult,
    type WorkerWriteCheckpoint,
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

function safeScope(value: string): string {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    if (!normalized) throw new Error('Cloudflare write scope is invalid.');
    return normalized;
}

export function openOneShotCloudflareWriteGuard(
    scope: string,
    evidenceDirectory: string,
): OneShotCloudflareWriteGuard {
    const normalizedScope = safeScope(scope);
    const stateRoot = path.join(
        process.cwd(),
        'outputs',
        'launch-cloudflare-production-write-state',
        normalizedScope,
    );
    const pendingDirectory = path.join(stateRoot, 'write-checkpoints-pending');
    const resolvedDirectory = path.join(stateRoot, 'write-checkpoints-resolved');
    const lockDirectory = path.join(stateRoot, 'execution.lock');
    const reconciliationLockDirectory = path.join(stateRoot, 'reconciliation.lock');
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

export function beginOneShotCloudflareWrite(
    guard: OneShotCloudflareWriteGuard,
    commandId: string,
): WorkerWriteCheckpoint {
    assertWorkerWriteExecutionLockOwned(guard.lockDirectory, guard.owner);
    const checkpoint = startWorkerWriteCheckpoint(commandId, guard.nextSequence, guard.runId);
    guard.nextSequence += 1;
    persistOneShotCheckpoint(guard, checkpoint);
    return checkpoint;
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
