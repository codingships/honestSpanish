import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { disableProductionReleaseSentryUpload } from '../../scripts/dev/production-release-safety';
import {
    acquireWorkerWriteExecutionLock,
    acquireNormalWorkerWriteExecutionLock,
    acquireWorkerWriteReconciliationLock,
    assertExactSecretInventory,
    assertNoGoogleWebBindings,
    captureInitialApprovalSentence,
    classifyWorkerWriteProviderResult,
    findUnresolvedWorkerWriteCheckpoints,
    forbiddenGoogleWebBindingNames,
    persistCanonicalWorkerWriteCheckpoint,
    persistWorkerWriteCheckpointAtomically,
    reconcileWorkerWriteCheckpoint,
    reconcileWorkerWriteCheckpointToSafeState,
    readWorkerWriteExecutionLock,
    releaseWorkerWriteExecutionLock,
    requireRecoverableWorkerWriteExecutionLock,
    resolveCanonicalWorkerWriteCheckpoint,
    startWorkerWriteCheckpoint,
    summarizeWorkerWriteCheckpoints,
} from '../../scripts/launch/cloudflare-production-worker-safety';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';

function versionView(bindings: Array<{ name: string; type: string }>): string {
    return JSON.stringify({
        id: VERSION_ID,
        resources: { bindings },
    });
}

describe('Cloudflare production web write safety', () => {
    it('captures approval from the initial process environment and ignores later dotenv-like mutation', () => {
        const environment: NodeJS.ProcessEnv = { APPROVAL: ' initial approval ' };
        const captured = captureInitialApprovalSentence(environment, 'APPROVAL');
        environment.APPROVAL = 'replacement loaded later';
        expect(captured).toBe('initial approval');
        expect(captured).not.toBe(environment.APPROVAL);
    });

    it('requires an exact secret allowlist and rejects every Google name', () => {
        const expected = ['INTERNAL_JOB_SECRET', 'STRIPE_SECRET_KEY'];
        expect(assertExactSecretInventory(JSON.stringify(expected.map((name) => ({ name }))), expected)).toEqual(expected);

        for (const name of forbiddenGoogleWebBindingNames) {
            expect(() => assertExactSecretInventory(JSON.stringify([
                { name: 'INTERNAL_JOB_SECRET' },
                { name },
            ]), ['INTERNAL_JOB_SECRET'])).toThrow(/inventory mismatch/i);
        }
        expect(() => assertExactSecretInventory(JSON.stringify([
            { name: 'INTERNAL_JOB_SECRET' },
            { name: 'UNEXPECTED_SECRET' },
        ]), ['INTERNAL_JOB_SECRET'])).toThrow(/inventory mismatch/i);
    });

    it('rejects Google in the exact remote version for secret and plain bindings', () => {
        expect(assertNoGoogleWebBindings(versionView([
            { name: 'INTERNAL_JOB_SECRET', type: 'secret_text' },
            { name: 'PUBLIC_APP_ENV', type: 'plain_text' },
        ]), VERSION_ID)).toEqual(['INTERNAL_JOB_SECRET', 'PUBLIC_APP_ENV']);

        for (const name of forbiddenGoogleWebBindingNames) {
            for (const type of ['secret_text', 'plain_text', 'json']) {
                expect(() => assertNoGoogleWebBindings(versionView([
                    { name: 'INTERNAL_JOB_SECRET', type: 'secret_text' },
                    { name, type },
                ]), VERSION_ID)).toThrow(name);
            }
        }
        expect(() => assertNoGoogleWebBindings(versionView([]), '22222222-2222-4222-8222-222222222222'))
            .toThrow(/exact expected version/i);
    });

    it('persists the unknown write-ahead checkpoint atomically before provider classification', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'worker-write-checkpoint-'));
        try {
            const checkpoint = startWorkerWriteCheckpoint('secret-put-INTERNAL_JOB_SECRET', 1, 'test-run');
            const checkpointPath = persistWorkerWriteCheckpointAtomically(directory, checkpoint);
            expect(existsSync(checkpointPath)).toBe(true);
            expect(JSON.parse(readFileSync(checkpointPath, 'utf8'))).toMatchObject({
                stage: 'write_ahead',
                receipt: {
                    externalWriteAttempted: true,
                    externalWritePerformed: 'unknown',
                    readonlyReconciliationRequired: true,
                },
            });
            expect(readdirSync(directory).some((name) => name.endsWith('.tmp'))).toBe(false);
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });

    for (const commandId of ['secret-put-STRIPE_SECRET_KEY', 'active-deploy', 'bootstrap-compensation']) {
        it.each([
            ['timeout', { exitCode: null, timedOut: true, errorPresent: true }],
            ['spawn error', { exitCode: null, timedOut: false, errorPresent: true }],
            ['non-zero provider result', { exitCode: 1, timedOut: false, errorPresent: false }],
        ])(`keeps ${commandId} unknown after %s until a readback proves state`, (_label, providerResult) => {
            const started = startWorkerWriteCheckpoint(commandId, 1, 'fault-run');
            const classified = classifyWorkerWriteProviderResult(started, providerResult);
            expect(classified.stage).toBe('provider_outcome_ambiguous');
            expect(summarizeWorkerWriteCheckpoints([classified])).toMatchObject({
                externalWritePerformed: 'unknown',
                externalWriteOutcome: 'ambiguous_needs_readonly_reconciliation',
                readonlyReconciliationRequired: true,
            });

            const failedReadback = reconcileWorkerWriteCheckpoint(classified, false);
            expect(summarizeWorkerWriteCheckpoints([failedReadback]).externalWritePerformed).toBe('unknown');

            const provenReadback = reconcileWorkerWriteCheckpoint(classified, true);
            expect(summarizeWorkerWriteCheckpoints([provenReadback])).toMatchObject({
                externalWritePerformed: true,
                externalWriteOutcome: 'confirmed_succeeded',
                readonlyReconciliationRequired: false,
            });
        });
    }

    it('keeps a successful provider call reconciliation-pending until exact readback', () => {
        const started = startWorkerWriteCheckpoint('active-deploy', 1, 'success-run');
        const providerReturned = classifyWorkerWriteProviderResult(started, {
            exitCode: 0,
            timedOut: false,
            errorPresent: false,
        });
        expect(summarizeWorkerWriteCheckpoints([providerReturned])).toMatchObject({
            externalWritePerformed: true,
            externalWriteOutcome: 'confirmed_succeeded_needs_readonly_reconciliation',
            readonlyReconciliationRequired: true,
        });

        const proven = reconcileWorkerWriteCheckpoint(providerReturned, true);
        expect(summarizeWorkerWriteCheckpoints([proven]).readonlyReconciliationRequired).toBe(false);
    });

    it('blocks a restarted writer until canonical read-back reconciliation resolves the prior run', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'worker-write-restart-'));
        const pending = path.join(root, 'pending');
        const resolved = path.join(root, 'resolved');
        const lock = path.join(root, 'write.lock');
        const recoveryLock = path.join(root, 'recovery.lock');
        try {
            const firstOwner = acquireWorkerWriteExecutionLock(lock, 'first-run');
            const started = startWorkerWriteCheckpoint('active-deploy', 1, 'first-run');
            persistCanonicalWorkerWriteCheckpoint(pending, started);
            const ambiguous = classifyWorkerWriteProviderResult(started, {
                exitCode: null,
                timedOut: true,
                errorPresent: true,
            });
            persistCanonicalWorkerWriteCheckpoint(pending, ambiguous);

            expect(findUnresolvedWorkerWriteCheckpoints(pending)).toMatchObject([{
                runId: 'first-run',
                stage: 'provider_outcome_ambiguous',
            }]);
            expect(() => acquireWorkerWriteExecutionLock(lock, 'restarted-run')).toThrow();
            expect(requireRecoverableWorkerWriteExecutionLock(
                lock,
                hostname(),
                () => 'dead',
            )).toEqual(firstOwner);
            const recoveryOwner = acquireWorkerWriteReconciliationLock(recoveryLock, 'recovery-run');
            expect(() => acquireWorkerWriteReconciliationLock(recoveryLock, 'concurrent-recovery')).toThrow();

            const proven = reconcileWorkerWriteCheckpointToSafeState(ambiguous);
            persistCanonicalWorkerWriteCheckpoint(pending, proven);
            resolveCanonicalWorkerWriteCheckpoint(pending, resolved, proven);
            expect(findUnresolvedWorkerWriteCheckpoints(pending)).toEqual([]);
            expect(summarizeWorkerWriteCheckpoints([proven])).toMatchObject({
                externalWritePerformed: 'unknown',
                externalWriteOutcome: 'historical_outcome_unknown_safe_state_proven',
                readonlyReconciliationRequired: false,
            });
            releaseWorkerWriteExecutionLock(lock, firstOwner);
            expect(() => acquireNormalWorkerWriteExecutionLock(
                lock,
                recoveryLock,
                'interleaved-normal-run',
            )).toThrow(/reconciliation lock/i);
            releaseWorkerWriteExecutionLock(recoveryLock, recoveryOwner);
            acquireNormalWorkerWriteExecutionLock(lock, recoveryLock, 'restarted-run');
            expect(existsSync(lock)).toBe(true);
            expect(readdirSync(root).some((name) => name.endsWith('.tmp'))).toBe(false);
            expect(readdirSync(pending).some((name) => name.endsWith('.tmp'))).toBe(false);
        } finally {
            rmSync(root, { force: true, recursive: true });
        }
    });

    it('never deletes a replacement lock when an old owner releases late', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'worker-write-owner-cas-'));
        const lock = path.join(root, 'write.lock');
        try {
            const oldOwner = acquireWorkerWriteExecutionLock(lock, 'old-run');
            releaseWorkerWriteExecutionLock(lock, oldOwner);
            const replacementOwner = acquireWorkerWriteExecutionLock(lock, 'replacement-run');

            expect(() => releaseWorkerWriteExecutionLock(lock, oldOwner)).toThrow(/ownership changed/i);
            expect(readWorkerWriteExecutionLock(lock)).toEqual(replacementOwner);
        } finally {
            rmSync(root, { force: true, recursive: true });
        }
    });

    it('permits recovery only for the same host with a definitely dead owner PID', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'worker-write-recoverable-owner-'));
        const lock = path.join(root, 'write.lock');
        try {
            const owner = acquireWorkerWriteExecutionLock(lock, 'interrupted-run');
            expect(() => requireRecoverableWorkerWriteExecutionLock(lock)).toThrow(/liveness is alive/i);
            expect(() => requireRecoverableWorkerWriteExecutionLock(
                lock,
                'different-host',
                () => 'dead',
            )).toThrow(/different host/i);
            expect(() => requireRecoverableWorkerWriteExecutionLock(
                lock,
                hostname(),
                () => 'unknown',
            )).toThrow(/requires definitely dead/i);
            expect(requireRecoverableWorkerWriteExecutionLock(
                lock,
                hostname(),
                () => 'dead',
            )).toEqual(owner);
            releaseWorkerWriteExecutionLock(lock, owner);
        } finally {
            rmSync(root, { force: true, recursive: true });
        }
    });

    it('disables every credential path that can upload Sentry sourcemaps', () => {
        const environment: NodeJS.ProcessEnv = {
            CI: 'true',
            SENTRY_UPLOAD_SOURCEMAPS: 'true',
            SENTRY_AUTH_TOKEN: 'adversarial-token',
            SENTRY_ORG: 'adversarial-org',
            SENTRY_PROJECT: 'adversarial-project',
            PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1',
        };
        disableProductionReleaseSentryUpload(environment);
        expect(environment).toMatchObject({
            CI: 'true',
            SENTRY_UPLOAD_SOURCEMAPS: 'false',
            SENTRY_AUTH_TOKEN: '',
            SENTRY_ORG: '',
            SENTRY_PROJECT: '',
            PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1',
        });
    });
});
