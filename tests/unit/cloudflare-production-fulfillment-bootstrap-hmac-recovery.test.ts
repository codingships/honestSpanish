import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    classifyRecoverySecretNames,
    recoveryCheckpointMismatch,
    recoveryDeleteCheckpointMismatch,
    validateProviderFreeVersion,
} from '../../scripts/launch/cloudflare-production-fulfillment-bootstrap-hmac-recovery';
import type {
    WorkerWriteCheckpoint,
    WorkerWriteLockOwner,
} from '../../scripts/launch/cloudflare-production-worker-safety';

const versionId = '597d23c1-d8ac-4db3-9d1f-ed228dba13df';
const inertBindings = [
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
];

function version(names: string[]) {
    return {
        id: versionId,
        resources: { bindings: names.map((name) => ({ name })) },
    };
}

describe('Cloudflare fulfillment bootstrap HMAC recovery', () => {
    it('classifies only empty or the exact singleton HMAC inventory as recoverable', () => {
        expect(classifyRecoverySecretNames([])).toEqual({ state: 'empty', names: [] });
        expect(classifyRecoverySecretNames([{ name: 'INTERNAL_JOB_SECRET' }])).toEqual({
            state: 'exact_hmac',
            names: ['INTERNAL_JOB_SECRET'],
        });
        expect(classifyRecoverySecretNames([{ name: 'RESEND_API_KEY' }])).toMatchObject({ state: 'forbidden' });
        expect(classifyRecoverySecretNames([
            { name: 'INTERNAL_JOB_SECRET' },
            { name: 'INTERNAL_JOB_SECRET' },
        ])).toMatchObject({ state: 'forbidden', reason: expect.stringContaining('duplicate') });
        expect(classifyRecoverySecretNames([{ nope: true }])).toMatchObject({ state: 'forbidden' });
        expect(classifyRecoverySecretNames({ result: [] })).toMatchObject({ state: 'forbidden' });
    });

    it('proves the exact provider-free binding allowlist with and without HMAC', () => {
        expect(validateProviderFreeVersion(version(inertBindings), versionId, false)).toEqual({
            ok: true,
            names: inertBindings,
        });
        expect(validateProviderFreeVersion(
            version([...inertBindings, 'INTERNAL_JOB_SECRET']),
            versionId,
            true,
        )).toEqual({ ok: true, names: [...inertBindings, 'INTERNAL_JOB_SECRET'] });
        expect(validateProviderFreeVersion(
            version([...inertBindings, 'RESEND_API_KEY']),
            versionId,
            false,
        )).toMatchObject({ ok: false, reason: expect.stringContaining('unexpected') });
        expect(validateProviderFreeVersion(version(inertBindings.slice(1)), versionId, false))
            .toMatchObject({ ok: false, reason: expect.stringContaining('missing') });
        expect(validateProviderFreeVersion(version(inertBindings), '00000000-0000-0000-0000-000000000000', false))
            .toMatchObject({ ok: false, reason: expect.stringContaining('identity') });
    });

    it('keeps the DELETE singular and outside the bounded retry helper', () => {
        const source = readFileSync(
            'scripts/launch/cloudflare-production-fulfillment-bootstrap-hmac-recovery.ts',
            'utf8',
        );
        expect(source.match(/cloudflareRequest\(token, 'DELETE'/gu)).toHaveLength(1);
        expect(source).toContain("beginOneShotCloudflareWrite(recoveryGuard, deleteCommandId)");
        expect(source).toContain("'deleteRetried=false'");
        expect(source).toContain("retryCloudflareReadonlyEvidence<RecoveryRemoteProof>");
        expect(source).not.toMatch(/retryCloudflareReadonlyEvidence[\s\S]{0,1000}method:\s*'DELETE'/u);
    });

    it('requires safe_state_proven and a terminal stop before D-E', () => {
        const source = readFileSync(
            'scripts/launch/cloudflare-production-fulfillment-bootstrap-hmac-recovery.ts',
            'utf8',
        );
        expect(source.indexOf('const staleRecovery = await reconcileOneShotCloudflareWriteGuard('))
            .toBeLessThan(source.indexOf('const originalState = validateOriginalPendingState();'));
        expect(source).toContain("return proof.state === 'proven' ? 'safe_state_proven' : 'not_proven'");
        expect(source).toContain("originalReconciliation.reason === 'fresh-readback-proved-safe-state'");
        expect(source).toContain("closure = 'SAFE_STATE_RECONCILED_STOP'");
        expect(source).toContain("'DExecuted=false'");
        expect(source).toContain("'EExecuted=false'");
        expect(source).not.toContain('launch:cloudflare-production-worker-phase1');
        expect(source).not.toContain('launch:cloudflare-production-worker-bootstrap-secrets');
    });

    it('requires the exact failed C checkpoint to match its dead lock owner and confirmed receipt', () => {
        const runId = '3629e93f-77ba-468d-af26-219544602d83';
        const checkpoint: WorkerWriteCheckpoint = {
            schemaVersion: 1,
            runId,
            sequence: 1,
            revision: 2,
            commandId: 'fulfillment-bootstrap-secret-put-internal-job-secret',
            stage: 'readback_failed',
            recordedAt: '2026-07-15T18:13:14.171Z',
            receipt: {
                externalWriteAttempted: true,
                externalWritePerformed: true,
                externalWriteOutcome: 'confirmed_succeeded_needs_readonly_reconciliation',
                readonlyReconciliationRequired: true,
            },
        };
        const owner: WorkerWriteLockOwner = {
            schemaVersion: 1,
            lockId: '0df9ecb8-a341-4c3b-bb00-7d8a428b1eb5',
            runId,
            ownerHost: 'test-host',
            ownerPid: 31576,
            acquiredAt: '2026-07-15T18:13:05.970Z',
            state: 'locked_until_all_readbacks_proven',
        };

        expect(recoveryCheckpointMismatch(checkpoint, owner)).toBeNull();
        expect(recoveryCheckpointMismatch({ ...checkpoint, runId: 'foreign-run' }, owner))
            .toContain('does not own lock');
        expect(recoveryCheckpointMismatch({ ...checkpoint, stage: 'provider_outcome_ambiguous' }, owner))
            .toContain('not the exact confirmed C write');
        expect(recoveryCheckpointMismatch({
            ...checkpoint,
            receipt: { ...checkpoint.receipt, externalWritePerformed: 'unknown' },
        }, owner)).toContain('not the exact confirmed C write');
    });

    it('reconciles only the exact recovery DELETE checkpoint', () => {
        const checkpoint: WorkerWriteCheckpoint = {
            schemaVersion: 1,
            runId: 'recovery-run',
            sequence: 1,
            revision: 1,
            commandId: 'delete-fulfillment-bootstrap-internal-job-secret',
            stage: 'provider_succeeded_needs_readback',
            recordedAt: '2026-07-15T18:30:00.000Z',
            receipt: {
                externalWriteAttempted: true,
                externalWritePerformed: true,
                externalWriteOutcome: 'confirmed_succeeded_needs_readonly_reconciliation',
                readonlyReconciliationRequired: true,
            },
        };

        expect(recoveryDeleteCheckpointMismatch(checkpoint)).toBeNull();
        expect(recoveryDeleteCheckpointMismatch(null)).toContain('missing');
        expect(recoveryDeleteCheckpointMismatch({ ...checkpoint, commandId: 'foreign-command' }))
            .toContain('unexpected recovery-delete command');
        expect(recoveryDeleteCheckpointMismatch({ ...checkpoint, sequence: 2 }))
            .toContain('not the exact single-secret deletion');
    });

    it('does not require or log an HMAC value for recovery', () => {
        const source = readFileSync(
            'scripts/launch/cloudflare-production-fulfillment-bootstrap-hmac-recovery.ts',
            'utf8',
        );
        expect(source).not.toContain('process.env.INTERNAL_JOB_SECRET');
        expect(source).not.toContain('secret put');
        expect(source).toContain('CLOUDFLARE_API_TOKEN');
    });
});
