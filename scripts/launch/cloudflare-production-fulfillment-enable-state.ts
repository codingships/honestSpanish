import { randomUUID } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { hostname as localHostname } from 'node:os';
import path from 'node:path';
import { PRODUCTION_QUEUE_TARGET } from './cloudflare-production-queue-shared';
import {
    validateProductionEnableCheckpoint,
    type ProductionEnableCheckpoint,
} from './cloudflare-production-fulfillment-lifecycle-shared';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class ProductionEnableLockOwnershipError extends Error {}
export class ProductionEnableCheckpointCasError extends Error {}
export class ProductionEnableCheckpointTransitionError extends Error {}

export interface ProductionEnableLockRecord {
    schemaVersion: 1;
    kind: 'cloudflare-production-fulfillment-enable-lock';
    ownerId: string;
    pid: number;
    hostname: string;
    acquiredAt: string;
    targetAccountId: typeof PRODUCTION_QUEUE_TARGET.accountId;
    targetWorker: typeof PRODUCTION_QUEUE_TARGET.worker;
}

export type ProductionEnableLockAcquisition =
    | { acquired: true; lock: ProductionEnableLockRecord; staleOwnerRecovered: boolean }
    | {
        acquired: false;
        reason: 'held_by_live_local_owner' | 'held_by_recent_dead_local_owner' | 'held_by_unverifiable_remote_owner';
        existing: ProductionEnableLockRecord;
    };

interface AcquireOptions {
    lockPath: string;
    ownerId: string;
    pid?: number;
    hostname?: string;
    acquiredAt?: string;
    staleAfterMs?: number;
    isProcessAlive?: (pid: number) => boolean;
}

export function acquireProductionEnableLock(options: AcquireOptions): ProductionEnableLockAcquisition {
    const lock = buildLockRecord(options);
    const isProcessAlive = options.isProcessAlive ?? processIsAlive;
    const staleAfterMs = options.staleAfterMs ?? 30_000;
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) {
        throw new Error('Production enable lock stale threshold is invalid');
    }
    const quarantinedPaths: string[] = [];
    let staleOwnerRecovered = false;
    mkdirSync(path.dirname(options.lockPath), { recursive: true });

    try {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            try {
                writeFileSync(options.lockPath, `${JSON.stringify(lock, null, 2)}\n`, {
                    encoding: 'utf8',
                    flag: 'wx',
                    flush: true,
                });
                return { acquired: true, lock, staleOwnerRecovered };
            } catch (error) {
                if (!isErrorCode(error, 'EEXIST')) throw error;
            }

            const existing = readProductionEnableLock(options.lockPath);
            if (normalizeHostname(existing.hostname) !== normalizeHostname(lock.hostname)) {
                return {
                    acquired: false,
                    reason: 'held_by_unverifiable_remote_owner',
                    existing,
                };
            }
            if (isProcessAlive(existing.pid)) {
                return { acquired: false, reason: 'held_by_live_local_owner', existing };
            }
            const lockAgeMs = Date.now() - Date.parse(existing.acquiredAt);
            if (lockAgeMs < staleAfterMs) {
                return { acquired: false, reason: 'held_by_recent_dead_local_owner', existing };
            }

            const quarantinePath = `${options.lockPath}.stale.${existing.ownerId}.${lock.ownerId}`;
            try {
                renameSync(options.lockPath, quarantinePath);
                quarantinedPaths.push(quarantinePath);
                const quarantined = readProductionEnableLock(quarantinePath);
                if (!sameLock(quarantined, existing)) {
                    throw new Error('Quarantined production enable lock changed during stale-owner recovery');
                }
                staleOwnerRecovered = true;
            } catch (error) {
                if (isErrorCode(error, 'ENOENT')) continue;
                throw error;
            }
        }
    } finally {
        for (const quarantinePath of quarantinedPaths) rmSync(quarantinePath, { force: true });
    }

    throw new Error('Production enable lock acquisition did not converge safely');
}

export function assertProductionEnableLockOwnership(lockPath: string, ownerId: string): ProductionEnableLockRecord {
    const lock = readProductionEnableLock(lockPath);
    if (lock.ownerId !== ownerId) {
        throw new ProductionEnableLockOwnershipError('Production enable lock ownership does not match this process');
    }
    return lock;
}

export function releaseProductionEnableLock(lockPath: string, ownerId: string): void {
    assertProductionEnableLockOwnership(lockPath, ownerId);
    const releasePath = `${lockPath}.release.${ownerId}`;
    renameSync(lockPath, releasePath);
    try {
        const released = readProductionEnableLock(releasePath);
        if (released.ownerId !== ownerId) {
            throw new ProductionEnableLockOwnershipError('Production enable lock ownership changed during release');
        }
    } finally {
        rmSync(releasePath, { force: true });
    }
}

export function readProductionEnableCheckpoint(checkpointPath: string): ProductionEnableCheckpoint | null {
    if (!existsSync(checkpointPath)) return null;
    const parsed = JSON.parse(readFileSync(checkpointPath, 'utf8')) as unknown;
    const validation = validateProductionEnableCheckpoint(parsed);
    if (!validation.ok) throw new Error(`Invalid enable checkpoint: ${validation.errors.join(', ')}`);
    return parsed as ProductionEnableCheckpoint;
}

export function persistProductionEnableCheckpointCas(input: {
    checkpointPath: string;
    lockPath: string;
    ownerId: string;
    expected: ProductionEnableCheckpoint | null;
    next: ProductionEnableCheckpoint;
}): void {
    assertProductionEnableLockOwnership(input.lockPath, input.ownerId);
    const nextValidation = validateProductionEnableCheckpoint(input.next);
    if (!nextValidation.ok) throw new Error(`Invalid next enable checkpoint: ${nextValidation.errors.join(', ')}`);
    if (input.expected) {
        const expectedValidation = validateProductionEnableCheckpoint(input.expected);
        if (!expectedValidation.ok) throw new Error(`Invalid expected enable checkpoint: ${expectedValidation.errors.join(', ')}`);
    }

    assertCheckpointCasTransition(input.expected, input.next);
    assertCheckpointMatches(input.checkpointPath, input.expected);
    mkdirSync(path.dirname(input.checkpointPath), { recursive: true });
    const temporaryPath = `${input.checkpointPath}.${process.pid}.${input.ownerId}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporaryPath, `${JSON.stringify(input.next, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            flush: true,
        });
        assertProductionEnableLockOwnership(input.lockPath, input.ownerId);
        assertCheckpointMatches(input.checkpointPath, input.expected);
        renameSync(temporaryPath, input.checkpointPath);
    } finally {
        if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
    }
}

function assertCheckpointCasTransition(
    expected: ProductionEnableCheckpoint | null,
    next: ProductionEnableCheckpoint,
): void {
    const expectedRevision = expected?.revision ?? 0;
    if (next.revision !== expectedRevision + 1) {
        throw new ProductionEnableCheckpointTransitionError('Enable checkpoint CAS revision is not the exact successor');
    }
    if (!expected) {
        if (next.status !== 'pending') throw new ProductionEnableCheckpointTransitionError('The first enable checkpoint must be pending');
        return;
    }
    if (next.attemptId !== expected.attemptId) {
        if (expected.status !== 'compensated' || next.status !== 'pending' || next.compensationAttempted) {
            throw new ProductionEnableCheckpointTransitionError('A new enable attempt may replace only a compensated checkpoint');
        }
        return;
    }
    if (expected.status === 'compensated') {
        throw new ProductionEnableCheckpointTransitionError('A compensated checkpoint accepts only a distinct new pending attempt');
    }
    if (expected.status === 'proven' && next.status !== 'ambiguous') {
        throw new ProductionEnableCheckpointTransitionError('A proven checkpoint may transition only to ambiguous after fresh remote divergence');
    }
    if (expected.compensationAttempted && !next.compensationAttempted) {
        throw new ProductionEnableCheckpointTransitionError('Enable checkpoint compensationAttempted cannot move from true to false');
    }
    if (Date.parse(next.updatedAt) < Date.parse(expected.updatedAt)) {
        throw new ProductionEnableCheckpointTransitionError('Enable checkpoint updatedAt cannot move backwards');
    }
    for (const field of [
        'startedAt',
        'targetAccountId',
        'targetWorker',
        'approvalSentenceSha256',
        'prewriteEvidenceSha256',
    ] as const) {
        if (next[field] !== expected[field]) {
            throw new ProductionEnableCheckpointTransitionError(`Enable checkpoint immutable field changed: ${field}`);
        }
    }
}

function assertCheckpointMatches(
    checkpointPath: string,
    expected: ProductionEnableCheckpoint | null,
): void {
    const current = readProductionEnableCheckpoint(checkpointPath);
    if (canonicalJson(current) !== canonicalJson(expected)) {
        throw new ProductionEnableCheckpointCasError('Enable checkpoint CAS mismatch; refusing to overwrite current state');
    }
}

function readProductionEnableLock(lockPath: string): ProductionEnableLockRecord {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as unknown;
    } catch (error) {
        throw new Error(`Production enable lock is missing or unreadable: ${safeError(error)}`);
    }
    const validation = validateLockRecord(parsed);
    if (validation.length > 0) throw new Error(`Invalid production enable lock: ${validation.join(', ')}`);
    return parsed as ProductionEnableLockRecord;
}

function validateLockRecord(value: unknown): string[] {
    if (!isRecord(value)) return ['lock must be an object'];
    const errors: string[] = [];
    if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
    if (value.kind !== 'cloudflare-production-fulfillment-enable-lock') errors.push('kind is invalid');
    if (!UUID_PATTERN.test(String(value.ownerId ?? ''))) errors.push('ownerId is invalid');
    if (!Number.isSafeInteger(value.pid) || Number(value.pid) < 1) errors.push('pid is invalid');
    if (typeof value.hostname !== 'string' || value.hostname.trim() === '') errors.push('hostname is invalid');
    if (typeof value.acquiredAt !== 'string' || !Number.isFinite(Date.parse(value.acquiredAt))) errors.push('acquiredAt is invalid');
    if (value.targetAccountId !== PRODUCTION_QUEUE_TARGET.accountId) errors.push('target account is invalid');
    if (value.targetWorker !== PRODUCTION_QUEUE_TARGET.worker) errors.push('target Worker is invalid');
    return errors;
}

function buildLockRecord(options: AcquireOptions): ProductionEnableLockRecord {
    const lock: ProductionEnableLockRecord = {
        schemaVersion: 1,
        kind: 'cloudflare-production-fulfillment-enable-lock',
        ownerId: options.ownerId,
        pid: options.pid ?? process.pid,
        hostname: (options.hostname ?? localHostname()).trim(),
        acquiredAt: options.acquiredAt ?? new Date().toISOString(),
        targetAccountId: PRODUCTION_QUEUE_TARGET.accountId,
        targetWorker: PRODUCTION_QUEUE_TARGET.worker,
    };
    const errors = validateLockRecord(lock);
    if (errors.length > 0) throw new Error(`Invalid production enable lock request: ${errors.join(', ')}`);
    return lock;
}

function processIsAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return !isErrorCode(error, 'ESRCH');
    }
}

function sameLock(left: ProductionEnableLockRecord, right: ProductionEnableLockRecord): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function normalizeHostname(value: string): string {
    return value.trim().toLocaleLowerCase('en-US');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
    return isRecord(error) && error.code === code;
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
}
