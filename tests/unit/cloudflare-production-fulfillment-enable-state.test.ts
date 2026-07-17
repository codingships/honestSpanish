import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
    ProductionEnableCheckpointCasError,
    ProductionEnableCheckpointTransitionError,
    ProductionEnableLockOwnershipError,
    acquireProductionEnableLock,
    persistProductionEnableCheckpointCas,
    readProductionEnableCheckpoint,
    releaseProductionEnableLock,
} from '../../scripts/launch/cloudflare-production-fulfillment-enable-state';
import {
    createProductionEnablePendingCheckpoint,
    markProductionEnableCheckpointAmbiguous,
    markProductionEnableCheckpointCompensationStarted,
    markProductionEnableCheckpointProven,
    type ProductionEnableCheckpoint,
} from '../../scripts/launch/cloudflare-production-fulfillment-lifecycle-shared';

const stateModuleUrl = pathToFileURL(resolve('scripts/launch/cloudflare-production-fulfillment-enable-state.ts')).href;
const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ownerC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Cloudflare production fulfillment enable canonical state', () => {
    it('allows exactly one winner when two real processes contend for the canonical lock', async () => {
        const directory = temporaryDirectory();
        const lockPath = join(directory, 'execution.lock');
        const startAt = Date.now() + 600;
        const [left, right] = await Promise.all([
            runLockChild(lockPath, ownerA, startAt),
            runLockChild(lockPath, ownerB, startAt),
        ]);

        expect([left, right].filter((result) => result.acquired)).toHaveLength(1);
        expect([left, right].filter((result) => !result.acquired)).toHaveLength(1);
        const winner = [left, right].find((result) => result.acquired);
        expect(winner?.lock?.ownerId).toMatch(/^(?:aaaaaaaa|bbbbbbbb)-/u);
        if (winner?.lock) releaseProductionEnableLock(lockPath, winner.lock.ownerId);
    }, 15_000);

    it('does not steal an old lock while its local owner PID is still alive', async () => {
        const directory = temporaryDirectory();
        const lockPath = join(directory, 'execution.lock');
        const first = acquireProductionEnableLock({
            lockPath,
            ownerId: ownerA,
            acquiredAt: '2026-07-13T00:00:00.000Z',
        });
        expect(first.acquired).toBe(true);

        const contender = await runLockChild(lockPath, ownerB, Date.now(), 0);
        expect(contender).toMatchObject({ acquired: false, reason: 'held_by_live_local_owner' });
        releaseProductionEnableLock(lockPath, ownerA);
    }, 15_000);

    it('recovers a dead same-host owner by atomic quarantine without losing its pending checkpoint', async () => {
        const directory = temporaryDirectory();
        const lockPath = join(directory, 'execution.lock');
        const checkpointPath = join(directory, 'checkpoint.json');
        const deadOwner = await runLockChild(
            lockPath,
            ownerA,
            Date.now(),
            0,
            '2026-07-13T00:00:00.000Z',
            checkpointPath,
        );
        expect(deadOwner.acquired).toBe(true);
        const pending = pendingCheckpoint();
        expect(readProductionEnableCheckpoint(checkpointPath)).toEqual(pending);

        const recovered = acquireProductionEnableLock({ lockPath, ownerId: ownerB, staleAfterMs: 0 });
        expect(recovered).toMatchObject({ acquired: true, staleOwnerRecovered: true });
        if (!recovered.acquired) throw new Error('Expected recovered lock');
        expect(readProductionEnableCheckpoint(checkpointPath)).toEqual(pending);
        releaseProductionEnableLock(lockPath, ownerB);
    }, 15_000);

    it('rejects stale-owner writes and one of two interleaved CAS branches', () => {
        const directory = temporaryDirectory();
        const lockPath = join(directory, 'execution.lock');
        const checkpointPath = join(directory, 'checkpoint.json');
        const acquired = acquireProductionEnableLock({ lockPath, ownerId: ownerA });
        expect(acquired.acquired).toBe(true);

        const pending = pendingCheckpoint();
        persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerA,
            expected: null,
            next: pending,
        });
        const staleSnapshot = structuredClone(pending);
        const ambiguous = markProductionEnableCheckpointAmbiguous(
            pending,
            'FIRST_INTERLEAVED_BRANCH',
            '2026-07-13T10:00:01.000Z',
        );
        persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerA,
            expected: pending,
            next: ambiguous,
        });
        const bytesAfterFirstBranch = readFileSync(checkpointPath, 'utf8');

        const losingBranch = markProductionEnableCheckpointProven(
            staleSnapshot,
            '33333333-3333-4333-8333-333333333333',
            '2026-07-13T10:00:02.000Z',
        );
        expect(() => persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerA,
            expected: staleSnapshot,
            next: losingBranch,
        })).toThrow(ProductionEnableCheckpointCasError);
        expect(() => persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerB,
            expected: ambiguous,
            next: markProductionEnableCheckpointAmbiguous(
                ambiguous,
                'STALE_OWNER_BRANCH',
                '2026-07-13T10:00:03.000Z',
            ),
        })).toThrow(ProductionEnableLockOwnershipError);
        expect(readFileSync(checkpointPath, 'utf8')).toBe(bytesAfterFirstBranch);
        releaseProductionEnableLock(lockPath, ownerA);
    });

    it('never replaces an active checkpoint with a new attempt and fails closed on remote/corrupt locks', () => {
        const directory = temporaryDirectory();
        const lockPath = join(directory, 'execution.lock');
        const checkpointPath = join(directory, 'checkpoint.json');
        acquireProductionEnableLock({ lockPath, ownerId: ownerA });
        const pending = pendingCheckpoint();
        persistProductionEnableCheckpointCas({ checkpointPath, lockPath, ownerId: ownerA, expected: null, next: pending });
        const foreignAttempt = createProductionEnablePendingCheckpoint({
            attemptId: ownerC,
            now: '2026-07-13T10:00:05.000Z',
            prewriteEvidenceSha256: 'c'.repeat(64),
            previousRevision: pending.revision,
        });
        expect(() => persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerA,
            expected: pending,
            next: foreignAttempt,
        })).toThrow(ProductionEnableCheckpointTransitionError);
        releaseProductionEnableLock(lockPath, ownerA);

        acquireProductionEnableLock({
            lockPath,
            ownerId: ownerB,
            hostname: 'unverifiable-remote-host',
            pid: 999_999,
            acquiredAt: '2026-07-13T00:00:00.000Z',
        });
        expect(acquireProductionEnableLock({
            lockPath,
            ownerId: ownerC,
            staleAfterMs: 0,
            isProcessAlive: () => false,
        })).toMatchObject({ acquired: false, reason: 'held_by_unverifiable_remote_owner' });
        releaseProductionEnableLock(lockPath, ownerB);

        writeFileSync(lockPath, '{not-json', 'utf8');
        expect(() => acquireProductionEnableLock({ lockPath, ownerId: ownerC, staleAfterMs: 0 }))
            .toThrow('missing or unreadable');
    });

    it('keeps compensationAttempted monotonic within one CAS attempt', () => {
        const directory = temporaryDirectory();
        const lockPath = join(directory, 'execution.lock');
        const checkpointPath = join(directory, 'checkpoint.json');
        acquireProductionEnableLock({ lockPath, ownerId: ownerA });
        const pending = pendingCheckpoint();
        persistProductionEnableCheckpointCas({ checkpointPath, lockPath, ownerId: ownerA, expected: null, next: pending });
        const compensationStarted = markProductionEnableCheckpointCompensationStarted(
            pending,
            '2026-07-13T10:00:01.000Z',
        );
        persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerA,
            expected: pending,
            next: compensationStarted,
        });
        const regressed = markProductionEnableCheckpointAmbiguous(
            compensationStarted,
            'ILLEGAL_REGRESSION',
            '2026-07-13T10:00:02.000Z',
        );
        regressed.compensationAttempted = false;
        expect(() => persistProductionEnableCheckpointCas({
            checkpointPath,
            lockPath,
            ownerId: ownerA,
            expected: compensationStarted,
            next: regressed,
        })).toThrow('cannot move from true to false');
        expect(readProductionEnableCheckpoint(checkpointPath)).toEqual(compensationStarted);
        releaseProductionEnableLock(lockPath, ownerA);
    });
});

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'production-enable-state-'));
    directories.push(directory);
    return directory;
}

function pendingCheckpoint(): ProductionEnableCheckpoint {
    return createProductionEnablePendingCheckpoint({
        attemptId: '11111111-1111-4111-8111-111111111111',
        now: '2026-07-13T10:00:00.000Z',
        prewriteEvidenceSha256: 'a'.repeat(64),
    });
}

interface ChildLockResult {
    acquired: boolean;
    reason?: string;
    lock?: { ownerId: string; pid: number };
}

async function runLockChild(
    lockPath: string,
    ownerId: string,
    startAt: number,
    staleAfterMs = 30_000,
    acquiredAt?: string,
    checkpointPath?: string,
): Promise<ChildLockResult> {
    const source = [
        `const module = await import(${JSON.stringify(stateModuleUrl)});`,
        'const delay = Number(process.env.LOCK_START_AT) - Date.now();',
        'if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));',
        'const result = module.acquireProductionEnableLock({',
        '  lockPath: process.env.LOCK_PATH,',
        '  ownerId: process.env.LOCK_OWNER_ID,',
        '  staleAfterMs: Number(process.env.LOCK_STALE_AFTER_MS),',
        '  acquiredAt: process.env.LOCK_ACQUIRED_AT || undefined,',
        '});',
        'if (result.acquired && process.env.LOCK_CHECKPOINT_PATH) {',
        `  const shared = await import(${JSON.stringify(pathToFileURL(resolve('scripts/launch/cloudflare-production-fulfillment-lifecycle-shared.ts')).href)});`,
        "  const checkpoint = shared.createProductionEnablePendingCheckpoint({ attemptId: '11111111-1111-4111-8111-111111111111', now: '2026-07-13T10:00:00.000Z', prewriteEvidenceSha256: 'a'.repeat(64) });",
        '  module.persistProductionEnableCheckpointCas({ checkpointPath: process.env.LOCK_CHECKPOINT_PATH, lockPath: process.env.LOCK_PATH, ownerId: process.env.LOCK_OWNER_ID, expected: null, next: checkpoint });',
        '}',
        'process.stdout.write(JSON.stringify(result));',
    ].join('\n');
    return new Promise((resolveChild, rejectChild) => {
        const child = spawn(process.execPath, [
            '--import',
            'tsx',
            '--input-type=module',
            '--eval',
            source,
        ], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                LOCK_PATH: lockPath,
                LOCK_OWNER_ID: ownerId,
                LOCK_START_AT: String(startAt),
                LOCK_STALE_AFTER_MS: String(staleAfterMs),
                LOCK_ACQUIRED_AT: acquiredAt ?? '',
                LOCK_CHECKPOINT_PATH: checkpointPath ?? '',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.stdout.on('error', rejectChild);
        child.stderr.on('error', rejectChild);
        const childEvents = child as unknown as {
            once(event: 'error', listener: (error: Error) => void): void;
            once(event: 'exit', listener: (code: number | null) => void): void;
        };
        childEvents.once('error', rejectChild);
        childEvents.once('exit', (code) => {
            if (code !== 0) {
                rejectChild(new Error(`Lock child failed (${String(code)}): ${stderr}`));
                return;
            }
            try {
                resolveChild(JSON.parse(stdout) as ChildLockResult);
            } catch (error) {
                rejectChild(new Error(`Lock child returned invalid JSON: ${stderr || String(error)}`));
            }
        });
    });
}
