import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    RC_PRODUCTION_INERT_BLOCKER_ID,
    assessRcProductionInertEvidence,
} from '../../scripts/launch/rc-production-inert-evidence';
import {
    classifyWorkerWriteProviderResult,
    reconcileWorkerWriteCheckpoint,
    startWorkerWriteCheckpoint,
} from '../../scripts/launch/cloudflare-production-worker-safety';

const now = new Date('2026-07-15T12:00:00.000Z');
const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('computed RC production-inert evidence', () => {
    it('blocks with one computed RC check when canonical production preparation is absent', () => {
        const root = temporaryOutputs();
        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(false);
        expect(assessment.blocker?.id).toBe(RC_PRODUCTION_INERT_BLOCKER_ID);
        expect(assessment.requirements.filter((requirement) => requirement.status === 'open').map(({ id }) => id)).toEqual([
            'cloudflare_bootstrap_hmac',
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('closes only a hash-bound Cloudflare + Supabase inert preparation chain', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(true);
        expect(assessment.blocker).toBeNull();
        expect(assessment.requirements.every((requirement) => requirement.status === 'closed')).toBe(true);
        expect(assessment.latestEvidenceAt).toBe('2026-07-15T11:05:00.000Z');
    });

    it('accepts a read-only Cloudflare reconciliation that re-attests the same HMAC-only bootstrap', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root, { cloudflareReconciled: true });

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(true);
        expect(assessment.blocker).toBeNull();
    });

    it('keeps Cloudflare open after a newer ambiguous write until a later reconciliation', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-30-00-000Z',
            'summary.json',
            {
                ...cloudflareClosure(false, false),
                endedAt: '2026-07-15T11:30:00.000Z',
                status: 'FAILED',
                closureStatus: 'BLOCKED_BY_GATE_OR_EVIDENCE',
                externalWriteAttempted: true,
                externalWritePerformed: 'unknown',
                checks: [{ status: 'failed', name: 'bootstrap_hmac_write_checkpoint_resolved' }],
            },
        );

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);

        writeEvidence(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-40-00-000Z',
            'summary.json',
            {
                ...cloudflareClosure(false, true),
                endedAt: '2026-07-15T11:40:00.000Z',
            },
        );

        expect(assessRcProductionInertEvidence(root, now).ready).toBe(true);
    });

    it('keeps Cloudflare open when a crash leaves canonical write state without a summary', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        const stateRoot = path.join(
            root,
            'launch-cloudflare-production-write-state',
            'web-bootstrap-hmac-secret',
        );
        const pending = path.join(stateRoot, 'write-checkpoints-pending');
        mkdirSync(pending, { recursive: true });
        mkdirSync(path.join(stateRoot, 'execution.lock'), { recursive: true });
        writeFileSync(path.join(pending, 'crashed-write.json'), '{}\n', 'utf8');

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(openRequirementIds(assessment)).toEqual(['cloudflare_bootstrap_hmac']);
        expect(assessment.requirements[0]?.reason).toContain('pending checkpoint or lock');
    });

    it('keeps Cloudflare open when a resolved checkpoint is newer than its summary until later reconciliation', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeResolvedCloudflareCheckpoint(root, '2026-07-15T11:20:00.000Z');

        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'cloudflare_bootstrap_hmac',
        ]);

        writeEvidence(
            root,
            'launch-cloudflare-production-worker-bootstrap-secrets',
            '2026-07-15T11-30-00-000Z',
            'summary.json',
            {
                ...cloudflareClosure(false, true),
                startedAt: '2026-07-15T11:29:00.000Z',
                endedAt: '2026-07-15T11:30:00.000Z',
            },
        );

        expect(assessRcProductionInertEvidence(root, now).ready).toBe(true);
    });

    it('rejects plan-only Cloudflare evidence and broken Supabase receipt bindings', () => {
        const cloudflareRoot = temporaryOutputs();
        writeCompleteEvidenceChain(cloudflareRoot, { cloudflarePlanOnly: true });
        expect(openRequirementIds(assessRcProductionInertEvidence(cloudflareRoot, now))).toContain('cloudflare_bootstrap_hmac');

        const supabaseRoot = temporaryOutputs();
        const chain = writeCompleteEvidenceChain(supabaseRoot);
        const tamperedAvailability = {
            ...chain.availability,
            authPolicyReceiptSha256: 'f'.repeat(64),
        };
        writeEvidence(
            supabaseRoot,
            'launch-production-availability',
            '2026-07-15T11-06-00-000Z',
            'production-availability-receipt.json',
            tamperedAvailability,
        );
        rmSync(chain.availabilityPath);

        const assessment = assessRcProductionInertEvidence(supabaseRoot, now);
        expect(openRequirementIds(assessment)).toEqual(expect.arrayContaining([
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]));
    });

    it('requires a post-preparation GET proving signup remains closed', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root, { omitPostPreparationAuthInert: true });

        const missing = assessRcProductionInertEvidence(root, now);
        expect(openRequirementIds(missing)).toEqual(['supabase_auth_inert_after_preparation']);

        writeEvidence(
            root,
            'launch-supabase-auth-config-preflight',
            '2026-07-15T11-05-00-000Z',
            'auth-inert-receipt.json',
            authInertReceipt('2026-07-15T11:05:00.000Z', { disable_signup: false, mailer_autoconfirm: false }),
        );
        expect(openRequirementIds(assessRcProductionInertEvidence(root, now))).toEqual([
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('does not combine an older complete chain with a newer unfinished rollout', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        const newerAuth = writeEvidence(
            root,
            'launch-supabase-auth-config-preflight',
            '2026-07-15T11-10-00-000Z',
            'auth-inert-receipt.json',
            authInertReceipt('2026-07-15T11:10:00.000Z'),
        );
        writeEvidence(
            root,
            'launch-supabase-production-rollout-runner',
            '2026-07-15T11-20-00-000Z',
            'production-rollout-receipt.json',
            rolloutReceipt(newerAuth.sha256, '2026-07-15T11:20:00.000Z'),
        );

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(false);
        expect(openRequirementIds(assessment)).toEqual([
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('does not fall back when the newest rollout has a broken Auth-inert binding', () => {
        const root = temporaryOutputs();
        writeCompleteEvidenceChain(root);
        writeEvidence(
            root,
            'launch-supabase-production-rollout-runner',
            '2026-07-15T11-20-00-000Z',
            'production-rollout-receipt.json',
            rolloutReceipt('f'.repeat(64), '2026-07-15T11:20:00.000Z'),
        );

        const assessment = assessRcProductionInertEvidence(root, now);

        expect(assessment.ready).toBe(false);
        expect(openRequirementIds(assessment)).toEqual([
            'supabase_production_rollout',
            'supabase_auth_finalized',
            'supabase_production_availability',
            'supabase_auth_inert_after_preparation',
        ]);
    });

    it('wires the computed blocker into status and therefore into the RC gate', () => {
        const status = readFileSync('scripts/launch/status.ts', 'utf8');
        const releaseCandidate = readFileSync('scripts/launch/release-candidate.ts', 'utf8');

        expect(status).toContain('assessRcProductionInertEvidence(outputsRoot, startedAt)');
        expect(status).toContain('...productionInertOpenChecks');
        expect(status).toContain('RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS');
        expect(status).toContain('production inert RC evidence');
        expect(releaseCandidate).toContain('const readiness = statusSummary?.summary.releaseCandidateReadiness ?? null');
        expect(releaseCandidate).toContain("'RC_READY_WITH_FINAL_BLOCKERS'");
    });
});

function writeCompleteEvidenceChain(root: string, options: {
    cloudflarePlanOnly?: boolean;
    cloudflareReconciled?: boolean;
    omitPostPreparationAuthInert?: boolean;
} = {}): { availability: Record<string, unknown>; availabilityPath: string } {
    const initialAuth = writeEvidence(
        root,
        'launch-supabase-auth-config-preflight',
        '2026-07-15T10-00-00-000Z',
        'auth-inert-receipt.json',
        authInertReceipt('2026-07-15T10:00:00.000Z'),
    );
    const rollout = writeEvidence(
        root,
        'launch-supabase-production-rollout-runner',
        '2026-07-15T10-20-00-000Z',
        'production-rollout-receipt.json',
        rolloutReceipt(initialAuth.sha256),
    );
    const authPolicy = writeEvidence(
        root,
        'launch-supabase-production-auth-cleanup',
        '2026-07-15T10-50-00-000Z',
        'auth-policy-receipt.json',
        finalAuthPolicyReceipt(rollout.sha256),
    );
    const availability = availabilityReceipt(authPolicy.sha256);
    const availabilityEvidence = writeEvidence(
        root,
        'launch-production-availability',
        '2026-07-15T11-00-00-000Z',
        'production-availability-receipt.json',
        availability,
    );
    if (!options.omitPostPreparationAuthInert) {
        writeEvidence(
            root,
            'launch-supabase-auth-config-preflight',
            '2026-07-15T11-05-00-000Z',
            'auth-inert-receipt.json',
            authInertReceipt('2026-07-15T11:05:00.000Z'),
        );
    }
    writeEvidence(
        root,
        'launch-cloudflare-production-worker-bootstrap-secrets',
        '2026-07-15T10-40-00-000Z',
        'summary.json',
        cloudflareClosure(options.cloudflarePlanOnly === true, options.cloudflareReconciled === true),
    );
    return { availability, availabilityPath: availabilityEvidence.file };
}

function cloudflareClosure(planOnly: boolean, reconciled: boolean): Record<string, unknown> {
    const closureStatus = planOnly
        ? 'PLAN_ONLY_READY'
        : reconciled
            ? 'RECONCILED_STOP'
            : 'EXECUTED_AND_ATTESTED';
    return {
        schemaVersion: 1,
        startedAt: '2026-07-15T10:39:00.000Z',
        endedAt: '2026-07-15T10:40:00.000Z',
        status: planOnly ? 'WARNING' : 'OK',
        closureStatus,
        executeRequested: !planOnly,
        approvalMatched: !planOnly,
        externalWriteAttempted: !planOnly,
        externalWritePerformed: !planOnly && !reconciled,
        target: {
            accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
            worker: 'espanolhonesto',
            environment: 'production_bootstrap',
            supabaseRef: 'vkkahxsybhbutszerawz',
        },
        requiredSecretNames: ['INTERNAL_JOB_SECRET'],
        checks: planOnly ? [] : [
            'phase1_web_bootstrap_before_secrets',
            'minimal_bootstrap_secret_shape_after_write',
            'direct_web_bootstrap_hmac_attestation',
            reconciled
                ? 'bootstrap_hmac_readonly_reconciliation'
                : 'bootstrap_hmac_write_checkpoint_resolved',
        ].map((name) => ({ status: 'ok', name })),
    };
}

function authInertReceipt(
    observedAt: string,
    flags = { disable_signup: true, mailer_autoconfirm: false },
): Record<string, unknown> {
    return {
        schemaVersion: 1,
        receiptKind: 'supabase_production_auth_inert_readonly',
        status: 'AUTH_INERT_VERIFIED',
        target: { environment: 'production', projectRef: 'vkkahxsybhbutszerawz' },
        flags,
        observedAt,
        source: 'supabase_management_api',
        requestMethod: 'GET',
        externalWritePerformed: false,
    };
}

function rolloutReceipt(
    authInertEvidenceSha256: string,
    completedAt = '2026-07-15T10:20:00.000Z',
): Record<string, unknown> {
    const hashes = Object.fromEntries([
        'scopeSha256',
        'allowlistSha256',
        'migrationManifestSha256',
        'preflightEvidenceSha256',
        'historyReconciliationManifestSha256',
        'historyReconciliationSnapshotSha256',
        'liveHistoryReconciliationSqlSha256',
        'liveHistoryReconciliationSnapshotSha256',
        'backupReceiptSha256',
        'backupArtifactSha256',
        'backupArtifactVerificationSha256',
        'publicCleanupReceiptSha256',
        'authReducedQuarantinedReceiptSha256',
        'googleFixturePolicyEvidenceSha256',
        'stagingHardeningEvidenceSha256',
        'sentryProductionHardeningEvidenceSha256',
        'livePreflightSqlSha256',
        'finalVerifySqlSha256',
    ].map((key, index) => [key, (index % 10).toString().repeat(64)]));
    return {
        schemaVersion: 1,
        status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED',
        targetProjectRef: 'vkkahxsybhbutszerawz',
        completedAt,
        ...hashes,
        authInertEvidenceSha256,
        through: 'deferred_rc_hardening',
        migrationCount: 25,
        finalVerificationPassed: true,
        stagingOnlyMigrationAbsent: true,
        stagingOnlyVersions: ['20260710150000', '20260713161300'],
        checkoutRemainedDisabledByOperatorAttestation: true,
        authFinalizeRequired: true,
    };
}

function finalAuthPolicyReceipt(productionRolloutReceiptSha256: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        targetProjectRef: 'vkkahxsybhbutszerawz',
        status: 'CLOSED_AND_VERIFIED',
        closedAt: '2026-07-15T10:50:00.000Z',
        mode: 'preserve_admin_teacher',
        authUsersRemaining: 2,
        publicProfilesRemaining: 2,
        publicProfilesPrivateRemaining: 2,
        profileRoles: { admin: 1, teacher: 1, student: 0 },
        fixtureStudentsRemaining: 0,
        storageObjectsTouched: false,
        externalProvidersTouched: false,
        passwordsRotatedUnretained: true,
        sessionsInvalidatedOrExpired: true,
        resetEmailsSent: false,
        backupReceiptSha256: '1'.repeat(64),
        publicCleanupReceiptSha256: '2'.repeat(64),
        authReducedReceiptSha256: '3'.repeat(64),
        productionRolloutReceiptSha256,
        preservedSetSha256: '4'.repeat(64),
        freezeCutoff: '2026-07-02T18:29:27.580Z',
        quarantineUntil: '2026-07-15T10:45:00.000Z',
        googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
    };
}

function availabilityReceipt(authPolicyReceiptSha256: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        status: 'SEEDED_AND_VERIFIED',
        targetProjectRef: 'vkkahxsybhbutszerawz',
        authPolicyReceiptSha256,
        schedule: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '09:00:00',
            endTime: '18:00:00',
        })),
        timezone: 'Europe/Madrid',
        externalProvidersTouched: false,
        verifiedAt: '2026-07-15T11:00:00.000Z',
    };
}

function writeEvidence(
    root: string,
    outputName: string,
    directoryName: string,
    fileName: string,
    value: Record<string, unknown>,
): { file: string; sha256: string } {
    const directory = path.join(root, outputName, directoryName);
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, fileName);
    const source = `${JSON.stringify(value, null, 2)}\n`;
    writeFileSync(file, source, 'utf8');
    return { file, sha256: createHash('sha256').update(source).digest('hex') };
}

function writeResolvedCloudflareCheckpoint(root: string, recordedAt: string): void {
    const stateDirectory = path.join(
        root,
        'launch-cloudflare-production-write-state',
        'web-bootstrap-hmac-secret',
        'write-checkpoints-resolved',
    );
    mkdirSync(stateDirectory, { recursive: true });
    let checkpoint = startWorkerWriteCheckpoint(
        'put-internal-job-secret',
        1,
        '11111111-1111-4111-8111-111111111111',
        undefined,
        new Date('2026-07-15T11:18:00.000Z'),
    );
    checkpoint = classifyWorkerWriteProviderResult(checkpoint, {
        exitCode: 0,
        timedOut: false,
        errorPresent: false,
    }, new Date('2026-07-15T11:19:00.000Z'));
    checkpoint = reconcileWorkerWriteCheckpoint(checkpoint, true, new Date(recordedAt));
    writeFileSync(path.join(stateDirectory, 'resolved.json'), `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function temporaryOutputs(): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'eh-rc-production-inert-'));
    temporaryDirectories.push(directory);
    return directory;
}

function openRequirementIds(assessment: ReturnType<typeof assessRcProductionInertEvidence>): string[] {
    return assessment.requirements
        .filter((requirement) => requirement.status === 'open')
        .map((requirement) => requirement.id);
}
