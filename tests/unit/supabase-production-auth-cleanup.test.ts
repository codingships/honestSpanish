import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FIXTURE_CLEANUP_PATHS,
    FIXTURE_CLEANUP_TARGET,
    sha256,
    stableJson,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    PRODUCTION_AUTH_CLEANUP_TARGET,
    PRODUCTION_AUTH_FREEZE_CUTOFF,
    PRODUCTION_AUTH_INERT_CONFIRMATION,
    PRODUCTION_AUTH_OUTPUT_FILES,
    approvalEnvForPhase,
    buildAuthCleanupApproval,
    buildQuarantineUntil,
    hashIdentitySet,
    sanitizeAuthCleanupOutput,
    selectAuthQuarantineConfig,
    validateAuthPreflightEvidence,
    validateAuthReducedReceipt,
    validateCheckpoint,
    validateCleanupInputs,
    type AuthCleanupCheckpoint,
    type AuthPreflightEvidence,
    type AuthReducedReceipt,
    type ProductionAuthDatabaseAggregate,
} from '../../scripts/launch/supabase-production-auth-cleanup-shared';
import {
    classifyReadiness,
    isRetryableSupabaseAdminError,
    parseProductionAuthCleanupArgs,
} from '../../scripts/launch/supabase-production-auth-cleanup';

const runnerSource = readFileSync('scripts/launch/supabase-production-auth-cleanup.ts', 'utf8');
const temporaryDirectories: string[] = [];

afterEach(() => {
    while (temporaryDirectories.length > 0) {
        rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true });
    }
});

describe('Supabase production Auth cleanup runner', () => {
    it('is plan-only by default and requires distinct execution/resume gates', () => {
        expect(parseProductionAuthCleanupArgs([])).toMatchObject({ mode: 'plan', executeApproved: false });
        expect(parseProductionAuthCleanupArgs([
            'preflight',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
        ])).toMatchObject({ mode: 'preflight', executeApproved: false });
        expect(parseProductionAuthCleanupArgs([
            'delete',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
            '--evidence', 'preflight.json',
            '--execute-approved',
        ])).toMatchObject({ mode: 'delete', executeApproved: true });
        expect(() => parseProductionAuthCleanupArgs([
            'resume-delete',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
            '--evidence', 'preflight.json',
            '--execute-approved',
        ])).toThrow('--checkpoint');
        expect(() => parseProductionAuthCleanupArgs([
            'finalize',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
            '--evidence', 'preflight.json',
            '--auth-reduced-receipt', 'reduced.json',
            '--execute-approved',
        ])).toThrow('--rollout-receipt');
        expect(() => parseProductionAuthCleanupArgs(['plan', '--execute-approved'])).toThrow();
    });

    it('hashes only complete UUID sets in stable order and never needs persisted identities', () => {
        const first = '11111111-1111-4111-8111-111111111111';
        const second = '22222222-2222-4222-8222-222222222222';
        expect(hashIdentitySet([first, second])).toBe(hashIdentitySet([second, first]));
        expect(hashIdentitySet([])).toMatch(/^[a-f0-9]{64}$/u);
        expect(() => hashIdentitySet([first, first])).toThrow('duplicate');
        expect(() => hashIdentitySet(['not-a-uuid'])).toThrow('invalid UUID');
    });

    it('validates the exact v2 public cleanup receipt against the real manifest and backup', () => {
        const directory = makeTempDir();
        const completedAt = new Date().toISOString();
        const backup = validBackupReceipt(new Date(Date.now() - 60_000).toISOString());
        const backupPath = path.join(directory, 'backup.json');
        writeFileSync(backupPath, stableJson(backup), 'utf8');
        const backupHash = sha256(readFileSync(backupPath));
        const manifest = JSON.parse(readFileSync(FIXTURE_CLEANUP_PATHS.manifest, 'utf8')) as {
            sql: { execute: { sha256: string } };
        };
        const publicReceipt = {
            schemaVersion: 2,
            status: 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED',
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            completedAt,
            aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
            approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
            backupReceiptSha256: backupHash,
            executeSqlSha256: manifest.sql.execute.sha256,
            freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
            postconditions: {
                authUsers: 138,
                profiles: 0,
                profilesPrivate: 0,
                legacyJobsTableAbsent: true,
                supportTickets: 0,
                packages: 4,
            },
            packagesPreserved: ['group', 'standard', 'hybrid', 'bootcamp'],
            localPackageStripeFieldsCleared: true,
            inactiveEssentialDeleted: true,
            externalStripeGoogleStorage: 'UNTOUCHED',
            authNextStep: 'SEPARATE_AUTH_REDUCTION_REQUIRED',
        };
        const cleanupPath = path.join(directory, 'cleanup.json');
        writeFileSync(cleanupPath, stableJson(publicReceipt), 'utf8');

        expect(validateCleanupInputs({ backupReceiptPath: backupPath, publicCleanupReceiptPath: cleanupPath })).toMatchObject({
            ok: true,
            errors: [],
            value: { backupReceiptSha256: backupHash },
        });
        writeFileSync(cleanupPath, stableJson({ ...publicReceipt, targetProjectRef: 'wrong' }), 'utf8');
        expect(validateCleanupInputs({ backupReceiptPath: backupPath, publicCleanupReceiptPath: cleanupPath })).toMatchObject({ ok: false });
    });

    it('requires signup disabled and a JWT expiry no greater than one hour', () => {
        expect(selectAuthQuarantineConfig({ disable_signup: true, jwt_exp: 3600 })).toMatchObject({
            ok: true,
            value: { jwtExpirySeconds: 3600, jwtExpirySource: 'management_api' },
        });
        expect(selectAuthQuarantineConfig({ disable_signup: true })).toMatchObject({
            ok: true,
            value: { jwtExpirySeconds: 3600, jwtExpirySource: 'conservative_default' },
        });
        expect(selectAuthQuarantineConfig({ disable_signup: false, jwt_exp: 3600 })).toMatchObject({ ok: false });
        expect(selectAuthQuarantineConfig({ disable_signup: true, jwt_exp: 7200 })).toMatchObject({ ok: false });
        expect(buildQuarantineUntil('2026-07-12T12:00:00.000Z', 3600)).toBe('2026-07-12T13:05:00.000Z');
    });

    it('classifies only the four explicit initial/resume/finalize states', () => {
        expect(classifyReadiness(state())).toBe('INITIAL_DELETE_READY');
        expect(classifyReadiness(state({ users: 54, candidates: 52, checkpointProvided: true }))).toBe('RESUME_DELETE_READY');
        expect(classifyReadiness(state({
            users: 2,
            candidates: 0,
            authReducedReceiptProvided: true,
            rolloutReceiptProvided: true,
            finalSchemaReady: true,
            quarantineElapsed: true,
        }))).toBe('FINALIZE_READY');
        expect(classifyReadiness(state({
            users: 2,
            candidates: 0,
            profiles: 2,
            profilesPrivate: 1,
            checkpointProvided: true,
            authReducedReceiptProvided: true,
            rolloutReceiptProvided: true,
            finalSchemaReady: true,
            quarantineElapsed: true,
        }))).toBe('RESUME_FINALIZE_READY');
        expect(classifyReadiness(state({ users: 139, candidates: 137 }))).toBe('BLOCKED');
        expect(classifyReadiness(state({
            users: 2,
            candidates: 0,
            authReducedReceiptProvided: true,
            rolloutReceiptProvided: true,
            finalSchemaReady: true,
            quarantineElapsed: false,
        }))).toBe('BLOCKED');
    });

    it('binds approvals to fresh evidence, receipts, aggregate set hashes and each phase env', () => {
        const hash = 'a'.repeat(64);
        const approval = buildAuthCleanupApproval({
            phase: 'resume-delete',
            evidenceSha256: hash,
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
            preservedSetSha256: hash,
            candidateCount: 12,
            candidateSetSha256: hash,
            checkpointSha256: hash,
        });
        expect(approval).toContain(`target=${PRODUCTION_AUTH_CLEANUP_TARGET.projectRef}`);
        expect(approval).toContain('phase=resume-delete');
        expect(approval).toContain('candidate_count=12');
        expect(approval).toContain('outbound_email=FORBIDDEN');
        expect(approval).toContain('storage=UNTOUCHED_ZERO_OWNERSHIP_REQUIRED');
        expect(approval).toContain('google_drive=UNTOUCHED_110_FIXTURE_FOLDERS_OBSERVED');
        const finalizeApproval = buildAuthCleanupApproval({
            phase: 'finalize',
            evidenceSha256: hash,
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
            preservedSetSha256: hash,
            candidateCount: 0,
            candidateSetSha256: hash,
            authReducedReceiptSha256: hash,
            rolloutReceiptSha256: hash,
            quarantineUntil: '2026-07-12T13:05:00.000Z',
        });
        expect(finalizeApproval).toContain('hard_delete=FORBIDDEN');
        expect(finalizeApproval).toContain('passwords=UNCHANGED_ALREADY_QUARANTINED');
        expect(finalizeApproval).toContain(`production_rollout=${hash}`);
        expect(approvalEnvForPhase('delete')).not.toBe(approvalEnvForPhase('resume-delete'));
        expect(approvalEnvForPhase('finalize')).not.toBe(approvalEnvForPhase('resume-finalize'));
        expect(PRODUCTION_AUTH_INERT_CONFIRMATION).toContain('checkout=DISABLED');
    });

    it('validates aggregate-only checkpoints and the rollout-consumable quarantine receipt', () => {
        const hash = 'b'.repeat(64);
        const checkpoint = validCheckpoint(hash);
        expect(validateCheckpoint(checkpoint, {
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
        })).toMatchObject({ ok: true, errors: [] });
        expect(validateCheckpoint({ ...checkpoint, remainingCandidateCount: 5 }, {
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
        })).toMatchObject({ ok: false });

        const reduced = validReducedReceipt(hash);
        expect(validateAuthReducedReceipt(reduced, {
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
            preservedSetSha256: hash,
        })).toMatchObject({ ok: true, errors: [] });
        expect(validateAuthReducedReceipt({ ...reduced, resetEmailsSent: true }, {
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
        })).toMatchObject({ ok: false });
    });

    it('requires fresh aggregate preflight evidence and all rollout/quarantine gates for finalize', () => {
        const evidence = validEvidence();
        expect(validateAuthPreflightEvidence(evidence, 'delete')).toMatchObject({ ok: true, errors: [] });
        expect(validateAuthPreflightEvidence({ ...evidence, createdAt: '2026-01-01T00:00:00.000Z' }, 'delete')).toMatchObject({ ok: false });

        const finalize = {
            ...evidence,
            readiness: 'FINALIZE_READY',
            approvalPhase: 'finalize',
            auth: { ...evidence.auth, users: 2, candidates: 0 },
            database: { ...evidence.database, finalSchemaReady: true },
            authReducedReceiptSha256: 'c'.repeat(64),
            rolloutReceiptSha256: 'd'.repeat(64),
            quarantineUntil: new Date(Date.now() - 1_000).toISOString(),
            quarantineElapsed: true,
        } satisfies AuthPreflightEvidence;
        expect(validateAuthPreflightEvidence(finalize, 'finalize')).toMatchObject({ ok: true, errors: [] });
        expect(validateAuthPreflightEvidence({ ...finalize, rolloutReceiptSha256: null }, 'finalize')).toMatchObject({ ok: false });
    });

    it('retries only bounded transient Admin API failures', () => {
        for (const status of [429, 500, 502, 503, 504]) expect(isRetryableSupabaseAdminError({ status })).toBe(true);
        for (const status of [400, 401, 403, 404, 409]) expect(isRetryableSupabaseAdminError({ status })).toBe(false);
        expect(isRetryableSupabaseAdminError(new Error('network'))).toBe(false);
    });

    it('redacts all identity and secret material before an error can be persisted', () => {
        const unsafe = [
            '11111111-1111-4111-8111-111111111111',
            'owner@example.test',
            'postgresql://postgres:secret@db.example.test/postgres',
            'Bearer sbp_fixture-token',
            'password=super-secret',
        ].join(' | ');
        const safe = sanitizeAuthCleanupOutput(unsafe);
        expect(safe).not.toContain('11111111');
        expect(safe).not.toContain('owner@example.test');
        expect(safe).not.toContain('super-secret');
        expect(safe).toContain('[redacted-uuid]');
        expect(safe).toContain('[redacted-email]');
    });

    it('hard-deletes sequentially, rotates unknown passwords and never sends email or touches external providers', () => {
        expect(runnerSource).toContain('deleteUser(candidate.id, false)');
        expect(runnerSource).toContain("randomBytes(48).toString('base64url')");
        expect(runnerSource).toContain('password: randomPassword');
        expect(runnerSource).toContain('default_transaction_read_only=on');
        expect(runnerSource).toContain("status: 'PARTIAL_FAILURE'");
        expect(runnerSource).toContain('PRODUCTION_AUTH_OUTPUT_FILES.reducedReceipt');
        expect(runnerSource).toContain('PRODUCTION_AUTH_OUTPUT_FILES.finalReceipt');
        expect(runnerSource).toContain('PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED');
        expect(runnerSource).toContain('sentryProductionHardeningEvidenceSha256');
        expect(runnerSource).toContain('livePreflightSqlSha256');
        expect(runnerSource).not.toMatch(/resetPasswordForEmail|generateLink|inviteUserByEmail|signInWithOtp/iu);
        expect(runnerSource).not.toMatch(/googleapis|new\s+Stripe|stripe\.customers|storage\.from\([^)]*\)\.(?:remove|upload|update)/iu);
        expect(runnerSource).not.toMatch(/DELETE\s+FROM\s+auth\.|DELETE\s+FROM\s+storage\./iu);
    });
});

function makeTempDir(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'eh-auth-cleanup-'));
    temporaryDirectories.push(directory);
    return directory;
}

function validBackupReceipt(createdAt: string) {
    return {
        schemaVersion: 1,
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        createdAt,
        backupCompleted: true,
        artifactStoredOutsideRepository: true,
        atRestProtection: 'windows_efs',
        atRestProtectionVerified: true,
        artifactSha256: 'a'.repeat(64),
        includedSchemas: ['public', 'auth'],
        verification: 'dump_hash_recorded',
        restoreProcedureReviewed: true,
        limitationsAcknowledged: [
            'storage_objects_not_included',
            'external_stripe_google_not_included',
            'selected_schemas_only',
        ],
    };
}

function state(overrides: Partial<Parameters<typeof classifyReadiness>[0]> = {}): Parameters<typeof classifyReadiness>[0] {
    return {
        users: 138,
        candidates: 136,
        profiles: 0,
        profilesPrivate: 0,
        checkpointProvided: false,
        authReducedReceiptProvided: false,
        rolloutReceiptProvided: false,
        finalSchemaReady: false,
        quarantineElapsed: false,
        ...overrides,
    };
}

function aggregate(): ProductionAuthDatabaseAggregate {
    return {
        counts: { 'public.profiles': 0, 'public.profiles_private': 0, 'public.packages': 4 },
        profileRoles: { admin: 0, teacher: 0, student: 0, other: 0 },
        nonMinimalProfiles: null,
        nonMinimalProfilesPrivate: null,
        profileCrmSyncTriggerCount: 0,
        finalSchemaReady: false,
        finalSchemaFacts: {},
        fixtureRows: 0,
        storageOwnedObjects: 0,
        authSessions: 3,
        authRefreshTokens: 3,
    };
}

function validEvidence(): AuthPreflightEvidence {
    const hash = 'a'.repeat(64);
    return {
        schemaVersion: 1,
        status: 'READY',
        createdAt: new Date().toISOString(),
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        readiness: 'INITIAL_DELETE_READY',
        approvalPhase: 'delete',
        publicCleanupReceiptSha256: hash,
        backupReceiptSha256: hash,
        manifestSha256: hash,
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
        baselineProfileRoles: {
            admin: 1,
            teacher: 1,
            student: 136,
            source: 'cleanup_v2_manifest',
        },
        auth: {
            users: 138,
            preserved: 2,
            candidates: 136,
            preservedSetSha256: hash,
            candidateSetSha256: hash,
            newestCreatedAt: PRODUCTION_AUTH_FREEZE_CUTOFF,
            identitiesCreatedAfterFreeze: 0,
        },
        database: aggregate(),
        configuration: { disableSignup: true, jwtExpirySeconds: 3600, jwtExpirySource: 'management_api' },
        checkpointSha256: null,
        authReducedReceiptSha256: null,
        rolloutReceiptSha256: null,
        quarantineUntil: null,
        quarantineElapsed: false,
        safety: {
            readOnly: true,
            noEmailsPersisted: true,
            noUuidsPersisted: true,
            outboundEmailsSent: false,
            externalWritePerformed: false,
            googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
        },
    };
}

function validCheckpoint(hash: string): AuthCleanupCheckpoint {
    return {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        phase: 'resume-delete',
        status: 'PARTIAL_FAILURE',
        startedAt: new Date(Date.now() - 10_000).toISOString(),
        updatedAt: new Date().toISOString(),
        publicCleanupReceiptSha256: hash,
        backupReceiptSha256: hash,
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
        preservedSetSha256: hash,
        initialCandidateCount: 136,
        initialCandidateSetSha256: hash,
        remainingCandidateCount: 12,
        remainingCandidateSetSha256: hash,
        deletedCount: 124,
        passwordRotationsCompleted: 0,
        profilesFinalized: false,
        lastErrorCategory: 'EXTERNAL_OPERATION_FAILED_REDACTED',
        externalWritePerformed: true,
    };
}

function validReducedReceipt(hash: string): AuthReducedReceipt {
    const completedAt = new Date(Date.now() - 60_000).toISOString();
    return {
        schemaVersion: 1,
        status: 'AUTH_REDUCED_QUARANTINED',
        targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
        completedAt,
        publicCleanupReceiptSha256: hash,
        backupReceiptSha256: hash,
        authUsers: 2,
        profiles: 0,
        fixtureStudents: 0,
        passwordsRotatedUnretained: true,
        quarantineUntil: new Date(Date.parse(completedAt) + 3_900_000).toISOString(),
        storageObjectsTouched: false,
        externalProvidersTouched: false,
        preservedSetSha256: hash,
        deletedCandidateSetSha256: hash,
        freezeCutoff: PRODUCTION_AUTH_FREEZE_CUTOFF,
        jwtExpirySeconds: 3600,
        jwtExpirySource: 'management_api',
        refreshSessionsRemaining: 0,
        resetEmailsSent: false,
        googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
    };
}
