import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    beginOneShotCloudflareWrite,
    closeOneShotCloudflareWriteGuard,
    openOneShotCloudflareWriteGuard,
    readResolvedOneShotCloudflareWriteCheckpoints,
    reconcileOneShotCloudflareWriteGuard,
    recordOneShotCloudflareProviderResult,
    recordOneShotCloudflareReadback,
    workerDeployCheckpointMatchesCurrentVersion,
    workerVersionTagFromView,
} from '../../scripts/launch/cloudflare-production-one-shot-write';
import { acquireWorkerWriteExecutionLock } from '../../scripts/launch/cloudflare-production-worker-safety';

const temporaryDirectories: string[] = [];

function workspace(): { root: string; evidence: string } {
    const root = mkdtempSync(path.join(tmpdir(), 'cloudflare-one-shot-write-'));
    temporaryDirectories.push(root);
    const evidence = path.join(root, 'evidence');
    mkdirSync(evidence, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    return { root, evidence };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('Cloudflare one-shot write guard', () => {
    it('persists write-ahead, requires provider reconciliation and releases only after proven readback', () => {
        const { evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('test-scope', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');

        expect(checkpoint.stage).toBe('write_ahead');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: 0,
            timedOut: false,
            errorPresent: false,
        });
        expect(checkpoint.stage).toBe('provider_succeeded_needs_readback');
        expect(() => closeOneShotCloudflareWriteGuard(guard)).toThrow('unresolved write checkpoints');

        checkpoint = recordOneShotCloudflareReadback(guard, checkpoint, true);
        expect(checkpoint.stage).toBe('readback_proven');
        expect(() => closeOneShotCloudflareWriteGuard(guard)).not.toThrow();
    });

    it('classifies timeout/error as ambiguous and blocks a blind retry', () => {
        const { evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('ambiguous-scope', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: null,
            timedOut: true,
            errorPresent: true,
        });

        expect(checkpoint.stage).toBe('provider_outcome_ambiguous');
        expect(checkpoint.receipt.externalWritePerformed).toBe('unknown');
        expect(() => openOneShotCloudflareWriteGuard('ambiguous-scope', evidence)).toThrow(
            'unresolved write checkpoints',
        );
    });

    it('reconciles a timed-out mutation only after a fresh readback proves the intended state', async () => {
        const { root, evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('timeout-recovery', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: null,
            timedOut: true,
            errorPresent: true,
        });
        const readback = vi.fn().mockResolvedValue('intended_state_proven');

        const result = await reconcileOneShotCloudflareWriteGuard('timeout-recovery', evidence, {
            readback,
            livenessProbe: () => 'dead',
        });

        expect(result).toMatchObject({
            status: 'reconciled',
            checkpointCount: 1,
            lockOnly: false,
        });
        expect(readback).toHaveBeenCalledOnce();
        expect(readback).toHaveBeenCalledWith(expect.objectContaining({
            commandId: 'provider-write',
            stage: 'provider_outcome_ambiguous',
        }));
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'timeout-recovery');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(false);
        expect(existsSync(path.join(stateRoot, 'reconciliation.lock'))).toBe(false);

        const nextGuard = openOneShotCloudflareWriteGuard('timeout-recovery', evidence);
        closeOneShotCloudflareWriteGuard(nextGuard);
    });

    it('resolves an ambiguous write when a fresh readback proves the exact safe pre-write state', async () => {
        const { root, evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('safe-state-recovery', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: 1,
            timedOut: false,
            errorPresent: true,
        });
        const readback = vi.fn().mockResolvedValue('safe_state_proven');

        const result = await reconcileOneShotCloudflareWriteGuard('safe-state-recovery', evidence, {
            readback,
            livenessProbe: () => 'dead',
        });

        expect(result).toMatchObject({
            status: 'reconciled',
            checkpointCount: 1,
            lockOnly: false,
            reason: 'fresh-readback-proved-safe-state',
        });
        expect(readback).toHaveBeenCalledOnce();
        const [resolved] = readResolvedOneShotCloudflareWriteCheckpoints('safe-state-recovery');
        expect(resolved).toMatchObject({
            commandId: 'provider-write',
            stage: 'recovery_safe_state_proven',
            receipt: {
                externalWritePerformed: 'unknown',
                externalWriteOutcome: 'historical_outcome_unknown_safe_state_proven',
                readonlyReconciliationRequired: false,
            },
        });
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'safe-state-recovery');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(false);
        expect(existsSync(path.join(stateRoot, 'reconciliation.lock'))).toBe(false);

        const nextGuard = openOneShotCloudflareWriteGuard('safe-state-recovery', evidence);
        closeOneShotCloudflareWriteGuard(nextGuard);
    });

    it('keeps checkpoint and execution lock closed when a readback does not prove the target', async () => {
        const { root, evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('failed-readback', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: 1,
            timedOut: false,
            errorPresent: true,
        });

        const result = await reconcileOneShotCloudflareWriteGuard('failed-readback', evidence, {
            readback: async () => 'not_proven' as const,
            livenessProbe: () => 'dead',
        });

        expect(result).toMatchObject({
            status: 'blocked',
            reason: 'intended-state-not-proven:provider-write',
        });
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'failed-readback');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(true);
        expect(existsSync(path.join(stateRoot, 'reconciliation.lock'))).toBe(false);
        expect(() => openOneShotCloudflareWriteGuard('failed-readback', evidence)).toThrow(
            'unresolved write checkpoints',
        );
    });

    it('fails closed on a readback timeout without retrying the provider mutation', async () => {
        const { root, evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('readback-timeout', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: null,
            timedOut: true,
            errorPresent: true,
        });
        const readback = vi.fn().mockRejectedValue(new Error('GET timed out'));

        const result = await reconcileOneShotCloudflareWriteGuard('readback-timeout', evidence, {
            readback,
            livenessProbe: () => 'dead',
        });

        expect(result.status).toBe('blocked');
        expect(result.reason).toContain('readback-failed:GET timed out');
        expect(readback).toHaveBeenCalledOnce();
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'readback-timeout');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(true);
        expect(existsSync(path.join(stateRoot, 'reconciliation.lock'))).toBe(false);
        expect(() => openOneShotCloudflareWriteGuard('readback-timeout', evidence)).toThrow(
            'unresolved write checkpoints',
        );
    });

    it('fails closed when a readback returns a value outside the tri-state contract', async () => {
        const { root, evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('invalid-readback-result', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: null,
            timedOut: true,
            errorPresent: true,
        });

        const result = await reconcileOneShotCloudflareWriteGuard('invalid-readback-result', evidence, {
            readback: async () => 'unexpected' as never,
            livenessProbe: () => 'dead',
        });

        expect(result.status).toBe('blocked');
        expect(result.reason).toContain('Unsupported one-shot Cloudflare readback result: unexpected');
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'invalid-readback-result');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(true);
        expect(() => openOneShotCloudflareWriteGuard('invalid-readback-result', evidence)).toThrow(
            'unresolved write checkpoints',
        );
    });

    it('recovers a lock-only crash only after a fresh phase readback', async () => {
        const { root, evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('lock-only', evidence);
        let checkpoint = beginOneShotCloudflareWrite(guard, 'provider-write');
        checkpoint = recordOneShotCloudflareProviderResult(guard, checkpoint, {
            exitCode: 0,
            timedOut: false,
            errorPresent: false,
        });
        recordOneShotCloudflareReadback(guard, checkpoint, true);
        const readback = vi.fn().mockResolvedValue(true);

        const result = await reconcileOneShotCloudflareWriteGuard('lock-only', evidence, {
            readback,
            livenessProbe: () => 'dead',
        });

        expect(result).toMatchObject({ status: 'reconciled', checkpointCount: 0, lockOnly: true });
        expect(readback).toHaveBeenCalledWith(expect.objectContaining({
            commandId: 'provider-write',
            stage: 'readback_proven',
        }));
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'lock-only');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(false);
    });

    it('clears a stale pre-write lock without requiring post-write state', async () => {
        const { root, evidence } = workspace();
        openOneShotCloudflareWriteGuard('prewrite-lock-only', evidence);
        const readback = vi.fn().mockResolvedValue(false);

        const result = await reconcileOneShotCloudflareWriteGuard('prewrite-lock-only', evidence, {
            readback,
            livenessProbe: () => 'dead',
        });

        expect(result).toMatchObject({
            status: 'reconciled',
            checkpointCount: 0,
            lockOnly: true,
            reason: 'stale-prewrite-lock-had-no-checkpoint-or-provider-write',
        });
        expect(readback).not.toHaveBeenCalled();
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'prewrite-lock-only');
        expect(existsSync(path.join(stateRoot, 'execution.lock'))).toBe(false);
    });

    it('recovers an orphaned reconciliation lock as a terminal local-only action', async () => {
        const { root, evidence } = workspace();
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'orphan-reconciliation');
        const reconciliationLock = path.join(stateRoot, 'reconciliation.lock');
        acquireWorkerWriteExecutionLock(reconciliationLock, 'orphaned-recovery', 900001);
        const readback = vi.fn().mockResolvedValue(false);

        const result = await reconcileOneShotCloudflareWriteGuard('orphan-reconciliation', evidence, {
            readback,
            livenessProbe: () => 'dead',
        });

        expect(result).toMatchObject({
            status: 'reconciled',
            checkpointCount: 0,
            lockOnly: true,
            reason: 'stale-reconciliation-lock-had-no-pending-write',
        });
        expect(readback).not.toHaveBeenCalled();
        expect(existsSync(reconciliationLock)).toBe(false);
    });

    it('keeps a live reconciliation lock fail-closed', async () => {
        const { root, evidence } = workspace();
        const stateRoot = path.join(root, 'outputs', 'launch-cloudflare-production-write-state', 'live-reconciliation');
        const reconciliationLock = path.join(stateRoot, 'reconciliation.lock');
        acquireWorkerWriteExecutionLock(reconciliationLock, 'live-recovery', 900002);
        const readback = vi.fn().mockResolvedValue(true);

        const result = await reconcileOneShotCloudflareWriteGuard('live-reconciliation', evidence, {
            readback,
            livenessProbe: () => 'alive',
        });

        expect(result.status).toBe('blocked');
        expect(result.reason).toContain('PID liveness is alive');
        expect(readback).not.toHaveBeenCalled();
        expect(existsSync(reconciliationLock)).toBe(true);
    });

    it('binds deploy reconciliation to a changed version carrying the exact unique deploy tag', () => {
        const { evidence } = workspace();
        const guard = openOneShotCloudflareWriteGuard('deploy-intent', evidence);
        const deployTag = 'eh-rc-web-bootstrap-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const checkpoint = beginOneShotCloudflareWrite(guard, 'deploy', {
            kind: 'cloudflare-worker-deploy',
            accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
            worker: 'espanolhonesto',
            environment: 'production_bootstrap',
            prewriteVersionId: '11111111-1111-4111-8111-111111111111',
            deployTag,
        });
        const expected = {
            accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
            worker: 'espanolhonesto',
            environment: 'production_bootstrap',
            deployTag,
        };

        // Exact changed version + exact tag proves this attempt.
        expect(workerDeployCheckpointMatchesCurrentVersion(
            checkpoint,
            expected,
            '22222222-2222-4222-8222-222222222222',
            deployTag,
        )).toBe(true);
        // A concurrent deployment has a different tag and cannot satisfy this checkpoint.
        expect(workerDeployCheckpointMatchesCurrentVersion(
            checkpoint,
            expected,
            '22222222-2222-4222-8222-222222222222',
            'eh-rc-web-bootstrap-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        )).toBe(false);
        expect(workerDeployCheckpointMatchesCurrentVersion(
            checkpoint,
            expected,
            '11111111-1111-4111-8111-111111111111',
            deployTag,
        )).toBe(false);
        expect(workerDeployCheckpointMatchesCurrentVersion(
            checkpoint,
            { ...expected, worker: 'another-worker' },
            '22222222-2222-4222-8222-222222222222',
            deployTag,
        )).toBe(false);
        expect(workerDeployCheckpointMatchesCurrentVersion(
            beginOneShotCloudflareWrite(guard, 'legacy-deploy-without-intent'),
            expected,
            '22222222-2222-4222-8222-222222222222',
            deployTag,
        )).toBe(false);
    });

    it('reads only the exact workers/tag annotation from the expected active version', () => {
        const versionId = '22222222-2222-4222-8222-222222222222';
        const deployTag = 'eh-rc-web-bootstrap-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const source = JSON.stringify({
            id: versionId,
            annotations: {
                'workers/tag': deployTag,
                'workers/message': 'untrusted free text',
            },
        });

        expect(workerVersionTagFromView(source, versionId)).toBe(deployTag);
        expect(workerVersionTagFromView(source, '33333333-3333-4333-8333-333333333333')).toBeNull();
        expect(workerVersionTagFromView(JSON.stringify({ id: versionId, annotations: {} }), versionId)).toBeNull();
    });

    it('does not invoke readback when no checkpoint or execution lock exists', async () => {
        const { evidence } = workspace();
        const readback = vi.fn().mockResolvedValue(true);

        const result = await reconcileOneShotCloudflareWriteGuard('clean-scope', evidence, { readback });

        expect(result.status).toBe('not_needed');
        expect(readback).not.toHaveBeenCalled();
    });

    it('wires recovery as a terminal readback-only branch before all five inert production writes', () => {
        const runners = [
            ['scripts/launch/cloudflare-production-queue-provision.ts', 'production-queue-provision', 'providerMutationRetried=false'],
            ['scripts/launch/cloudflare-production-fulfillment-lifecycle.ts', 'fulfillment-bootstrap-deploy', 'deployRetried=false'],
            ['scripts/launch/cloudflare-production-fulfillment-bootstrap-secrets.ts', 'fulfillment-bootstrap-hmac-secret', 'secretPutRetried=false'],
            ['scripts/launch/cloudflare-production-worker-phase1.ts', 'web-bootstrap-deploy', 'deployRetried=false'],
            ['scripts/launch/cloudflare-production-worker-bootstrap-secrets.ts', 'web-bootstrap-hmac-secret', 'secretPutRetried=false'],
        ] as const;

        for (const [runnerPath, scope, noRetryMarker] of runners) {
            const source = readFileSync(runnerPath, 'utf8');
            const reconciliationIndex = source.indexOf(`reconcileOneShotCloudflareWriteGuard(\n        '${scope}'`);
            const writerIndex = source.indexOf(`openOneShotCloudflareWriteGuard('${scope}'`);
            expect(reconciliationIndex, runnerPath).toBeGreaterThan(-1);
            expect(writerIndex, runnerPath).toBeGreaterThan(reconciliationIndex);
            const recoveryBranch = source.slice(reconciliationIndex, writerIndex);
            expect(recoveryBranch, runnerPath).toContain("reconciliation.status !== 'not_needed'");
            expect(recoveryBranch, runnerPath).toContain(noRetryMarker);
            expect(recoveryBranch, runnerPath).toContain('return');
        }
    });
});
