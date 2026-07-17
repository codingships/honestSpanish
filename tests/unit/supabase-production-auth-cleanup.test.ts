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
    beginAuthRequarantineRotation,
    buildAuthCleanupApproval,
    buildQuarantineUntil,
    confirmAuthRequarantineRotation,
    hashIdentitySet,
    hashRoleBoundIdentitySet,
    sanitizeAuthCleanupOutput,
    selectAuthQuarantineConfig,
    validateAuthPreflightEvidence,
    validateAuthRequarantineReceipt,
    validateAuthReducedReceipt,
    validateCheckpoint,
    validateCleanupInputs,
    type AuthCleanupCheckpoint,
    type AuthPreflightEvidence,
    type AuthReducedReceipt,
    type AuthRequarantineReceipt,
    type AuthRequarantineCheckpoint,
    type ProductionAuthDatabaseAggregate,
} from '../../scripts/launch/supabase-production-auth-cleanup-shared';
import {
    classifyReadiness,
    acquireRequarantineOneShotLock,
    isRetryableSupabaseAdminError,
    parseProductionAuthCleanupArgs,
    validateRequarantineLedgerDirectory,
    validateRolloutPreservationPolicyBinding,
} from '../../scripts/launch/supabase-production-auth-cleanup';
import { readAuthPolicyEvidence } from '../../scripts/launch/supabase-production-rollout-runner-shared';

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
        expect(parseProductionAuthCleanupArgs([
            'requarantine-preflight',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
            '--auth-reduced-receipt', 'prior.json',
        ])).toMatchObject({ mode: 'requarantine-preflight', executeApproved: false });
        expect(parseProductionAuthCleanupArgs([
            're-quarantine',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
            '--auth-reduced-receipt', 'prior.json',
            '--evidence', 'preflight.json',
            '--execute-approved',
        ])).toMatchObject({ mode: 're-quarantine', executeApproved: true });
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
        expect(() => parseProductionAuthCleanupArgs([
            're-quarantine',
            '--backup-receipt', 'backup.json',
            '--public-cleanup-receipt', 'cleanup.json',
            '--evidence', 'preflight.json',
            '--execute-approved',
        ])).toThrow('--auth-reduced-receipt');
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

    it('binds preserved identities to their admin and teacher roles', () => {
        const adminId = '11111111-1111-4111-8111-111111111111';
        const teacherId = '22222222-2222-4222-8222-222222222222';
        const roleBinding = hashRoleBoundIdentitySet(adminId, teacherId);
        expect(roleBinding).toMatch(/^[a-f0-9]{64}$/u);
        expect(hashRoleBoundIdentitySet(adminId.toUpperCase(), ` ${teacherId} `)).toBe(roleBinding);
        expect(hashRoleBoundIdentitySet(teacherId, adminId)).not.toBe(roleBinding);
        expect(() => hashRoleBoundIdentitySet(adminId, adminId)).toThrow('distinct admin and teacher');
        expect(() => hashRoleBoundIdentitySet('not-a-uuid', teacherId)).toThrow('invalid UUID');
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
            authInertEvidenceSha256: 'e'.repeat(64),
            preservationPolicySha256: 'f'.repeat(64),
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

    it('requires the Auth-finalize rollout receipt to preserve the exact public-cleanup policy binding', () => {
        const policySha256 = 'f'.repeat(64);
        expect(validateRolloutPreservationPolicyBinding({
            preservationPolicySha256: policySha256,
        }, policySha256)).toEqual([]);
        expect(validateRolloutPreservationPolicyBinding({}, policySha256)).toContain(
            'Production rollout preservationPolicySha256 must be a lowercase SHA-256.',
        );
        expect(validateRolloutPreservationPolicyBinding({
            preservationPolicySha256: 'e'.repeat(64),
        }, policySha256)).toContain(
            'Production rollout preservation-policy binding does not match the public-cleanup receipt.',
        );
        expect(validateRolloutPreservationPolicyBinding({
            preservationPolicySha256: policySha256,
        }, 'not-a-sha')).toContain('Expected cleanup preservation-policy SHA-256 is invalid.');
        expect(runnerSource).toContain('value.preservationPolicySha256');
        expect(runnerSource).toContain('cleanup.publicCleanupReceipt.preservationPolicySha256');
    });

    it('requires signup and mailer autoconfirm disabled and a JWT expiry no greater than one hour', () => {
        expect(selectAuthQuarantineConfig({ disable_signup: true, mailer_autoconfirm: false, jwt_exp: 3600 })).toMatchObject({
            ok: true,
            value: { mailerAutoconfirm: false, jwtExpirySeconds: 3600, jwtExpirySource: 'management_api' },
        });
        expect(selectAuthQuarantineConfig({ disable_signup: true, mailer_autoconfirm: false })).toMatchObject({
            ok: true,
            value: { jwtExpirySeconds: 3600, jwtExpirySource: 'conservative_default' },
        });
        expect(selectAuthQuarantineConfig({ disable_signup: false, mailer_autoconfirm: false, jwt_exp: 3600 })).toMatchObject({ ok: false });
        expect(selectAuthQuarantineConfig({ disable_signup: true, mailer_autoconfirm: true, jwt_exp: 3600 })).toMatchObject({ ok: false });
        expect(selectAuthQuarantineConfig({ disable_signup: true, jwt_exp: 3600 })).toMatchObject({ ok: false });
        expect(selectAuthQuarantineConfig({ disable_signup: true, mailer_autoconfirm: false, jwt_exp: 7200 })).toMatchObject({ ok: false });
        expect(buildQuarantineUntil('2026-07-12T12:00:00.000Z', 3600)).toBe('2026-07-12T13:05:00.000Z');
    });

    it('classifies only the explicit initial/resume/finalize/re-quarantine states', () => {
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
        expect(classifyReadiness(state({
            users: 2,
            candidates: 0,
            authReducedReceiptProvided: true,
            requarantineRequested: true,
        }))).toBe('REQUARANTINE_READY');
        expect(classifyReadiness(state({
            users: 3,
            candidates: 1,
            authReducedReceiptProvided: true,
            requarantineRequested: true,
        }))).toBe('BLOCKED');
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
        const requarantineApproval = buildAuthCleanupApproval({
            phase: 're-quarantine',
            evidenceSha256: hash,
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
            preservedSetSha256: hash,
            candidateCount: 0,
            candidateSetSha256: hash,
            authReducedReceiptSha256: hash,
            quarantineUntil: '2026-07-12T13:05:00.000Z',
        });
        expect(requarantineApproval).toContain('phase=re-quarantine');
        expect(requarantineApproval).toContain(`auth_reduced=${hash}`);
        expect(requarantineApproval).toContain('hard_delete=FORBIDDEN');
        expect(requarantineApproval).toContain('passwords=random_unretained_again_for_exact_two');
        expect(requarantineApproval).toContain('refresh_sessions=ASSERT_ABSENT_AFTER_PASSWORD_ROTATION_WITH_ZERO_SESSION_READBACK');
        expect(approvalEnvForPhase('delete')).not.toBe(approvalEnvForPhase('resume-delete'));
        expect(approvalEnvForPhase('finalize')).not.toBe(approvalEnvForPhase('resume-finalize'));
        expect(approvalEnvForPhase('re-quarantine')).not.toBe(approvalEnvForPhase('delete'));
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

        const priorHash = 'c'.repeat(64);
        const completedAt = new Date().toISOString();
        const requarantined: AuthRequarantineReceipt = {
            ...reduced,
            completedAt,
            quarantineUntil: buildQuarantineUntil(completedAt, 3600),
            requarantine: true,
            preflightEvidenceSha256: 'e'.repeat(64),
            previousAuthReducedReceiptSha256: priorHash,
            passwordRotationsCompleted: 2,
            authSessionsObservedBefore: 3,
            refreshSessionsObservedBefore: 3,
            authSessionsRemaining: 0,
            refreshSessionsAbsentAndVerified: true,
            refreshSessionVerificationMethod: 'PASSWORD_ROTATION_WITH_ZERO_SESSION_READBACK',
        };
        expect(validateAuthRequarantineReceipt(requarantined, {
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
            preservedSetSha256: hash,
            preflightEvidenceSha256: 'e'.repeat(64),
            previousAuthReducedReceiptSha256: priorHash,
        })).toMatchObject({ ok: true, errors: [] });
        expect(validateAuthRequarantineReceipt({
            ...requarantined,
            previousAuthReducedReceiptSha256: 'd'.repeat(64),
        }, {
            publicCleanupReceiptSha256: hash,
            backupReceiptSha256: hash,
            preservedSetSha256: hash,
            preflightEvidenceSha256: 'e'.repeat(64),
            previousAuthReducedReceiptSha256: priorHash,
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

        const requarantine = {
            ...evidence,
            readiness: 'REQUARANTINE_READY',
            approvalPhase: 're-quarantine',
            auth: { ...evidence.auth, users: 2, candidates: 0 },
            authReducedReceiptSha256: 'e'.repeat(64),
            quarantineUntil: new Date(Date.now() - 1_000).toISOString(),
            quarantineElapsed: true,
        } satisfies AuthPreflightEvidence;
        expect(validateAuthPreflightEvidence(requarantine, 're-quarantine')).toMatchObject({ ok: true, errors: [] });
        expect(validateAuthPreflightEvidence({
            ...requarantine,
            database: { ...requarantine.database, counts: { ...requarantine.database.counts, 'public.profiles': 1 } },
        }, 're-quarantine')).toMatchObject({ ok: false });
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

    it('scopes the Management API credential to the exact production Auth config read', () => {
        const authReadStart = runnerSource.indexOf('async function getAuthQuarantineConfig()');
        const authReadEnd = runnerSource.indexOf('function collectDatabaseAggregate(', authReadStart);
        const authReadSource = runnerSource.slice(authReadStart, authReadEnd);

        expect(authReadStart).toBeGreaterThan(-1);
        expect(authReadEnd).toBeGreaterThan(authReadStart);
        expect(authReadSource).toContain('withSupabaseAuthManagementClient(');
        expect(authReadSource).toContain('PRODUCTION_AUTH_CLEANUP_TARGET.projectRef');
        expect(authReadSource).toContain('client.getAuthConfig()');
        expect(authReadSource).not.toContain('patchAuthConfig');
        expect(runnerSource).not.toContain('SUPABASE_ACCESS_TOKEN');
        expect(runnerSource).not.toContain('managementToken');
        expect(runnerSource).not.toMatch(/Authorization\s*:\s*[`'"]Bearer/iu);
    });

    it('re-quarantines only the exact preserved pair with write-ahead state and zero-session readback', () => {
        const start = runnerSource.indexOf('async function runRequarantinePhase(');
        const end = runnerSource.indexOf('async function runFinalizePhase(', start);
        const source = runnerSource.slice(start, end);
        const oneShot = source.indexOf('acquireRequarantineOneShotLock(evidenceInput.sha256, prior.sha256, ledgerRoot)');
        const writeAhead = source.indexOf('beginAuthRequarantineRotation(checkpoint');
        const update = source.indexOf('client.auth.admin.updateUserById(user.id, { password: randomPassword })');
        const postRead = source.indexOf('const after = await collectLiveState');
        const receipt = source.indexOf('const receipt: AuthRequarantineReceipt');

        expect(start).toBeGreaterThan(-1);
        expect(oneShot).toBeLessThan(writeAhead);
        expect(writeAhead).toBeLessThan(update);
        expect(update).toBeLessThan(postRead);
        expect(postRead).toBeLessThan(receipt);
        expect(source).toContain('after.database.authSessions !== 0');
        expect(source).toContain('after.database.authRefreshTokens !== 0');
        expect(source).toContain('previousAuthReducedReceiptSha256: prior.sha256');
        expect(source).toContain('acquireRequarantineOneShotLock(evidenceInput.sha256, prior.sha256, ledgerRoot)');
        expect(source).toContain('validateRequarantineLedgerDirectory(');
        expect(source).toContain('usersDeleted: 0');
        expect(source).not.toContain('deleteUser(');
        expect(source).not.toMatch(/resetPasswordForEmail|generateLink|inviteUserByEmail|signInWithOtp/iu);
        expect(source).not.toMatch(/googleapis|new\s+Stripe|storage\.from/iu);
    });

    it('keeps confirmed writes monotonic when the second rotation becomes pending or fails', () => {
        const startedAt = new Date().toISOString();
        const base: AuthRequarantineCheckpoint = {
            schemaVersion: 1,
            targetProjectRef: PRODUCTION_AUTH_CLEANUP_TARGET.projectRef,
            status: 'IN_PROGRESS',
            startedAt,
            updatedAt: startedAt,
            previousAuthReducedReceiptSha256: 'a'.repeat(64),
            publicCleanupReceiptSha256: 'b'.repeat(64),
            backupReceiptSha256: 'c'.repeat(64),
            preservedSetSha256: 'd'.repeat(64),
            passwordRotationsAttempted: 0,
            passwordRotationsCompleted: 0,
            externalWritePerformed: false,
            pendingWriteAttempt: false,
            lastErrorCategory: null,
        };
        const firstPending = beginAuthRequarantineRotation(base, new Date().toISOString());
        expect(firstPending).toMatchObject({
            passwordRotationsAttempted: 1,
            passwordRotationsCompleted: 0,
            externalWritePerformed: false,
            pendingWriteAttempt: true,
        });
        const firstConfirmed = confirmAuthRequarantineRotation(firstPending, new Date().toISOString());
        const secondPending = beginAuthRequarantineRotation(firstConfirmed, new Date().toISOString());
        expect(secondPending).toMatchObject({
            passwordRotationsAttempted: 2,
            passwordRotationsCompleted: 1,
            externalWritePerformed: true,
            pendingWriteAttempt: true,
        });
        expect(() => beginAuthRequarantineRotation(secondPending, new Date().toISOString())).toThrow('pending');
    });

    it('consumes each exact evidence/prior-receipt pair once in the durable ledger', () => {
        const ledger = makeTempDir();
        const validatedLedger = validateRequarantineLedgerDirectory(ledger);
        expect(() => validateRequarantineLedgerDirectory('relative-ledger')).toThrow('absolute path');
        expect(() => validateRequarantineLedgerDirectory(path.join(process.cwd(), 'outputs', 'ledger')))
            .toThrow('outside the repository');
        const evidence = 'a'.repeat(64);
        const prior = 'b'.repeat(64);
        const firstPath = acquireRequarantineOneShotLock(evidence, prior, validatedLedger);
        expect(JSON.parse(readFileSync(firstPath, 'utf8'))).toMatchObject({
            status: 'REQUARANTINE_APPROVAL_CONSUMED_ONE_SHOT',
            evidenceSha256: evidence,
            priorReceiptSha256: prior,
        });
        expect(() => acquireRequarantineOneShotLock(evidence, prior, validatedLedger)).toThrow('already consumed');
        expect(() => acquireRequarantineOneShotLock('c'.repeat(64), prior, validatedLedger)).not.toThrow();
        expect(() => acquireRequarantineOneShotLock(evidence, 'd'.repeat(64), validatedLedger)).not.toThrow();
    });

    it('emits rollout-consumable receipts and chains a second re-quarantine to the first', () => {
        const directory = makeTempDir();
        const bindingHash = 'a'.repeat(64);
        const initialPriorHash = 'b'.repeat(64);
        const firstCompletedAt = new Date(Date.now() - 60_000).toISOString();
        const first: AuthRequarantineReceipt = {
            ...validReducedReceipt(bindingHash),
            completedAt: firstCompletedAt,
            quarantineUntil: buildQuarantineUntil(firstCompletedAt, 3600),
            requarantine: true,
            preflightEvidenceSha256: 'c'.repeat(64),
            previousAuthReducedReceiptSha256: initialPriorHash,
            passwordRotationsCompleted: 2,
            authSessionsObservedBefore: 0,
            refreshSessionsObservedBefore: 0,
            authSessionsRemaining: 0,
            refreshSessionsAbsentAndVerified: true,
            refreshSessionVerificationMethod: 'PASSWORD_ROTATION_WITH_ZERO_SESSION_READBACK',
        };
        const firstPath = path.join(directory, 'first-requarantine.json');
        writeFileSync(firstPath, stableJson(first), 'utf8');
        const firstHash = sha256(readFileSync(firstPath));
        expect(validateAuthRequarantineReceipt(first, {
            publicCleanupReceiptSha256: bindingHash,
            backupReceiptSha256: bindingHash,
            preservedSetSha256: bindingHash,
            preflightEvidenceSha256: 'c'.repeat(64),
            previousAuthReducedReceiptSha256: initialPriorHash,
        })).toMatchObject({ ok: true });
        expect(readAuthPolicyEvidence(firstPath, bindingHash, new Date(), bindingHash)).toMatchObject({ valid: true });
        const adversarialMutations: Array<Record<string, unknown>> = [
            { requarantine: false },
            { preflightEvidenceSha256: 'not-a-sha' },
            { previousAuthReducedReceiptSha256: 'not-a-sha' },
            { passwordRotationsCompleted: 1 },
            { authSessionsObservedBefore: -1 },
            { refreshSessionsObservedBefore: 1.5 },
            { authSessionsRemaining: 1 },
            { refreshSessionsAbsentAndVerified: false },
            { refreshSessionVerificationMethod: 'CLAIMED_REVOKED_WITHOUT_API' },
        ];
        for (const [index, mutation] of adversarialMutations.entries()) {
            const invalidPath = path.join(directory, `invalid-requarantine-${index}.json`);
            writeFileSync(invalidPath, stableJson({ ...first, ...mutation }), 'utf8');
            expect(readAuthPolicyEvidence(invalidPath, bindingHash, new Date(), bindingHash)).toMatchObject({
                valid: false,
                errors: expect.arrayContaining([expect.stringContaining('extended receipt/chaining shape')]),
            });
        }

        const secondCompletedAt = new Date().toISOString();
        const second: AuthRequarantineReceipt = {
            ...first,
            completedAt: secondCompletedAt,
            quarantineUntil: buildQuarantineUntil(secondCompletedAt, 3600),
            preflightEvidenceSha256: 'd'.repeat(64),
            previousAuthReducedReceiptSha256: firstHash,
        };
        const secondPath = path.join(directory, 'second-requarantine.json');
        writeFileSync(secondPath, stableJson(second), 'utf8');
        expect(validateAuthRequarantineReceipt(second, {
            publicCleanupReceiptSha256: bindingHash,
            backupReceiptSha256: bindingHash,
            preservedSetSha256: bindingHash,
            preflightEvidenceSha256: 'd'.repeat(64),
            previousAuthReducedReceiptSha256: firstHash,
        })).toMatchObject({ ok: true });
        expect(readAuthPolicyEvidence(secondPath, bindingHash, new Date(), bindingHash)).toMatchObject({ valid: true });
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
        receiptKind: 'supabase_production_logical_backup',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        authInertEvidenceSha256: 'e'.repeat(64),
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        createdAt,
        method: 'logical_dump',
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
            'custom_role_passwords_not_included',
            'external_stripe_google_not_included',
            'selected_schemas_only',
        ],
        backupFormat: 'pg_dump_custom',
        archiveListVerified: true,
        archiveRequiredTableDataVerified: true,
        archiveTocEntryCount: 42,
        artifactBytes: 1_024,
        artifactPathRecorded: false,
        toolVersions: { pgDump: 'pg_dump 17', pgRestore: 'pg_restore 17' },
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
        configuration: {
            disableSignup: true,
            mailerAutoconfirm: false,
            jwtExpirySeconds: 3600,
            jwtExpirySource: 'management_api',
        },
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
