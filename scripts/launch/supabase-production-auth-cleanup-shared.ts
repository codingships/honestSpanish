import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    FIXTURE_CLEANUP_PATHS,
    FIXTURE_CLEANUP_TARGET,
    loadAndValidateFixtureCleanupManifest,
    sha256,
    stableJson,
    validateBackupReceipt,
    type BackupReceipt,
    type FixtureCleanupManifest,
} from './production-fixture-cleanup-shared';

export const PRODUCTION_AUTH_CLEANUP_TARGET = {
    environment: 'production' as const,
    projectRef: 'vkkahxsybhbutszerawz',
    expectedInitialAuthUsers: 138,
    expectedPreservedUsers: 2,
    expectedFixtureStudents: 136,
} as const;

export const PRODUCTION_AUTH_FREEZE_CUTOFF = '2026-07-02T18:29:27.580Z';
export const PRODUCTION_AUTH_EVIDENCE_MAX_AGE_MS = 30 * 60 * 1_000;
export const PRODUCTION_AUTH_QUARANTINE_SKEW_SECONDS = 5 * 60;
export const PRODUCTION_AUTH_DEFAULT_JWT_EXPIRY_SECONDS = 60 * 60;
export const PRODUCTION_AUTH_MAX_JWT_EXPIRY_SECONDS = 60 * 60;
export const PRODUCTION_AUTH_INERT_CONFIRMATION_ENV = 'SUPABASE_PRODUCTION_AUTH_INERT_CONFIRMATION';
export const PRODUCTION_AUTH_INERT_CONFIRMATION = [
    'target=vkkahxsybhbutszerawz',
    'production_inert=true',
    'checkout=DISABLED',
    'signup=DISABLED',
    'no_traffic_until_quarantine_expiry=true',
].join(' | ');

export const PRODUCTION_AUTH_APPROVAL_ENVS = {
    delete: 'SUPABASE_PRODUCTION_AUTH_DELETE_APPROVAL',
    resumeDelete: 'SUPABASE_PRODUCTION_AUTH_RESUME_DELETE_APPROVAL',
    finalize: 'SUPABASE_PRODUCTION_AUTH_FINALIZE_APPROVAL',
    resumeFinalize: 'SUPABASE_PRODUCTION_AUTH_RESUME_FINALIZE_APPROVAL',
} as const;

export const PRODUCTION_AUTH_OUTPUT_FILES = {
    evidence: 'preflight-evidence.json',
    approval: 'exact-approval-required.txt',
    checkpoint: 'auth-cleanup-checkpoint.json',
    reducedReceipt: 'auth-reduced-quarantined-receipt.json',
    finalReceipt: 'auth-policy-receipt.json',
    summary: 'summary.json',
} as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

export type AuthCleanupPhase = 'delete' | 'resume-delete' | 'finalize' | 'resume-finalize';
export type AuthCleanupReadiness =
    | 'INITIAL_DELETE_READY'
    | 'RESUME_DELETE_READY'
    | 'FINALIZE_READY'
    | 'RESUME_FINALIZE_READY'
    | 'BLOCKED';

export interface PublicCleanupReceipt {
    schemaVersion: number;
    status: string;
    targetProjectRef: string;
    completedAt: string;
    aggregateSnapshotSha256: string;
    approvalScopeSha256: string;
    backupReceiptSha256: string;
    executeSqlSha256: string;
    freezeCutoff: string;
    postconditions: {
        authUsers: number;
        profiles: number;
        profilesPrivate: number;
        legacyJobsTableAbsent: boolean;
        supportTickets: number;
        packages: number;
    };
    packagesPreserved: string[];
    localPackageStripeFieldsCleared: boolean;
    inactiveEssentialDeleted: boolean;
    externalStripeGoogleStorage: string;
    authNextStep: string;
}

export interface ValidatedCleanupInputs {
    manifest: FixtureCleanupManifest;
    manifestSha256: string;
    backupReceipt: BackupReceipt;
    backupReceiptSha256: string;
    publicCleanupReceipt: PublicCleanupReceipt;
    publicCleanupReceiptSha256: string;
}

export interface ValidationResult<T> {
    ok: boolean;
    errors: string[];
    value: T | null;
}

export interface AuthQuarantineConfig {
    disableSignup: boolean;
    jwtExpirySeconds: number;
    jwtExpirySource: 'management_api' | 'conservative_default';
}

export interface AuthCleanupCheckpoint {
    schemaVersion: 1;
    targetProjectRef: string;
    phase: AuthCleanupPhase;
    status: 'IN_PROGRESS' | 'PARTIAL_FAILURE' | 'AUTH_REDUCED_QUARANTINED' | 'FINALIZED';
    startedAt: string;
    updatedAt: string;
    publicCleanupReceiptSha256: string;
    backupReceiptSha256: string;
    freezeCutoff: string;
    preservedSetSha256: string;
    initialCandidateCount: number;
    initialCandidateSetSha256: string;
    remainingCandidateCount: number;
    remainingCandidateSetSha256: string;
    deletedCount: number;
    passwordRotationsCompleted: number;
    profilesFinalized: boolean;
    lastErrorCategory: string | null;
    externalWritePerformed: boolean;
}

export interface ProductionAuthDatabaseAggregate {
    counts: Record<string, number>;
    profileRoles: { admin: number; teacher: number; student: number; other: number };
    nonMinimalProfiles: number | null;
    nonMinimalProfilesPrivate: number | null;
    profileCrmSyncTriggerCount: number;
    finalSchemaReady: boolean;
    finalSchemaFacts: Record<string, boolean>;
    fixtureRows: number;
    storageOwnedObjects: number;
    authSessions: number;
    authRefreshTokens: number;
}

export interface AuthPreflightEvidence {
    schemaVersion: 1;
    status: 'READY';
    createdAt: string;
    targetProjectRef: string;
    readiness: Exclude<AuthCleanupReadiness, 'BLOCKED'>;
    approvalPhase: AuthCleanupPhase;
    publicCleanupReceiptSha256: string;
    backupReceiptSha256: string;
    manifestSha256: string;
    freezeCutoff: string;
    baselineProfileRoles: {
        admin: 1;
        teacher: 1;
        student: 136;
        source: 'cleanup_v2_manifest';
    };
    auth: {
        users: number;
        preserved: 2;
        candidates: number;
        preservedSetSha256: string;
        candidateSetSha256: string;
        newestCreatedAt: string;
        identitiesCreatedAfterFreeze: 0;
    };
    database: ProductionAuthDatabaseAggregate;
    configuration: AuthQuarantineConfig;
    checkpointSha256: string | null;
    authReducedReceiptSha256: string | null;
    rolloutReceiptSha256: string | null;
    quarantineUntil: string | null;
    quarantineElapsed: boolean;
    safety: {
        readOnly: true;
        noEmailsPersisted: true;
        noUuidsPersisted: true;
        outboundEmailsSent: false;
        externalWritePerformed: false;
        googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED';
    };
}

export interface AuthReducedReceipt {
    schemaVersion: 1;
    status: 'AUTH_REDUCED_QUARANTINED';
    targetProjectRef: string;
    completedAt: string;
    publicCleanupReceiptSha256: string;
    backupReceiptSha256: string;
    authUsers: 2;
    profiles: 0;
    fixtureStudents: 0;
    passwordsRotatedUnretained: true;
    quarantineUntil: string;
    storageObjectsTouched: false;
    externalProvidersTouched: false;
    preservedSetSha256: string;
    deletedCandidateSetSha256: string;
    freezeCutoff: string;
    jwtExpirySeconds: number;
    jwtExpirySource: AuthQuarantineConfig['jwtExpirySource'];
    refreshSessionsRemaining: 0;
    resetEmailsSent: false;
    googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED';
}

export interface FinalAuthPolicyReceipt {
    schemaVersion: 1;
    targetProjectRef: string;
    status: 'CLOSED_AND_VERIFIED';
    closedAt: string;
    mode: 'preserve_admin_teacher';
    authUsersRemaining: 2;
    publicProfilesRemaining: 2;
    publicProfilesPrivateRemaining: 2;
    profileRoles: { admin: 1; teacher: 1; student: 0 };
    fixtureStudentsRemaining: 0;
    storageObjectsTouched: false;
    externalProvidersTouched: false;
    passwordsRotatedUnretained: true;
    sessionsInvalidatedOrExpired: true;
    resetEmailsSent: false;
    backupReceiptSha256: string;
    publicCleanupReceiptSha256: string;
    authReducedReceiptSha256: string;
    productionRolloutReceiptSha256: string;
    preservedSetSha256: string;
    freezeCutoff: string;
    quarantineUntil: string;
    googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED';
}

export interface ApprovalBinding {
    phase: AuthCleanupPhase;
    evidenceSha256: string;
    publicCleanupReceiptSha256: string;
    backupReceiptSha256: string;
    preservedSetSha256: string;
    candidateCount: number;
    candidateSetSha256: string;
    checkpointSha256?: string | null;
    authReducedReceiptSha256?: string | null;
    rolloutReceiptSha256?: string | null;
    quarantineUntil?: string | null;
}

export function hashIdentitySet(values: readonly string[]): string {
    const normalized = values.map((value) => value.trim().toLowerCase()).sort();
    if (normalized.some((value) => !UUID_PATTERN.test(value))) {
        throw new Error('Identity set contains an invalid UUID.');
    }
    if (new Set(normalized).size !== normalized.length) {
        throw new Error('Identity set contains duplicate UUIDs.');
    }
    return createHash('sha256').update(stableJson(normalized)).digest('hex');
}

export function validateCleanupInputs(input: {
    backupReceiptPath: string;
    publicCleanupReceiptPath: string;
    root?: string;
}): ValidationResult<ValidatedCleanupInputs> {
    const root = input.root ?? process.cwd();
    const errors: string[] = [];
    const manifestValidation = loadAndValidateFixtureCleanupManifest(root);
    if (!manifestValidation.ok || !manifestValidation.value) {
        return {
            ok: false,
            errors: manifestValidation.errors.map((error) => `Manifest: ${error}`),
            value: null,
        };
    }

    const backup = readJsonFile(input.backupReceiptPath, 'Backup receipt', errors);
    const cleanup = readJsonFile(input.publicCleanupReceiptPath, 'Public cleanup receipt', errors);
    if (!backup || !cleanup) return { ok: false, errors, value: null };

    const publicReceipt = cleanup.value as unknown as PublicCleanupReceipt;
    const cleanupCompletedAt = new Date(publicReceipt.completedAt);
    const backupValidation = validateBackupReceipt(
        backup.value,
        Number.isFinite(cleanupCompletedAt.getTime()) ? cleanupCompletedAt : new Date(0),
    );
    errors.push(...backupValidation.errors.map((error) => `Backup receipt: ${error}`));

    const manifest = manifestValidation.value;
    if (publicReceipt.schemaVersion !== 2) errors.push('Public cleanup receipt schemaVersion must be 2.');
    if (publicReceipt.status !== 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED') {
        errors.push('Public cleanup receipt status mismatch.');
    }
    if (publicReceipt.targetProjectRef !== PRODUCTION_AUTH_CLEANUP_TARGET.projectRef) {
        errors.push('Public cleanup receipt target mismatch.');
    }
    validateTimestamp(publicReceipt.completedAt, 'Public cleanup completion', errors);
    if (publicReceipt.aggregateSnapshotSha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) {
        errors.push('Public cleanup aggregate snapshot mismatch.');
    }
    if (publicReceipt.approvalScopeSha256 !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) {
        errors.push('Public cleanup approval scope mismatch.');
    }
    if (publicReceipt.backupReceiptSha256 !== backup.sha256) {
        errors.push('Public cleanup receipt is not bound to the supplied backup receipt.');
    }
    if (publicReceipt.executeSqlSha256 !== manifest.sql.execute.sha256) {
        errors.push('Public cleanup execute SQL hash mismatch.');
    }
    if (publicReceipt.freezeCutoff !== PRODUCTION_AUTH_FREEZE_CUTOFF) {
        errors.push('Public cleanup freeze cutoff mismatch.');
    }
    if (publicReceipt.postconditions?.authUsers !== PRODUCTION_AUTH_CLEANUP_TARGET.expectedInitialAuthUsers
        || publicReceipt.postconditions?.profiles !== 0
        || publicReceipt.postconditions?.profilesPrivate !== 0
        || publicReceipt.postconditions?.legacyJobsTableAbsent !== true
        || publicReceipt.postconditions?.supportTickets !== 0
        || publicReceipt.postconditions?.packages !== 4) {
        errors.push('Public cleanup postconditions are incomplete.');
    }
    if (stableJson([...(publicReceipt.packagesPreserved ?? [])].sort())
        !== stableJson(['bootcamp', 'group', 'hybrid', 'standard'])) {
        errors.push('Public cleanup canonical packages mismatch.');
    }
    if (!publicReceipt.localPackageStripeFieldsCleared || !publicReceipt.inactiveEssentialDeleted) {
        errors.push('Public cleanup package cleanup is incomplete.');
    }
    if (publicReceipt.externalStripeGoogleStorage !== 'UNTOUCHED'
        || publicReceipt.authNextStep !== 'SEPARATE_AUTH_REDUCTION_REQUIRED') {
        errors.push('Public cleanup external/Auth boundary mismatch.');
    }
    const roles = (manifest as FixtureCleanupManifest & {
        expectedBaseline?: { profileRoles?: { admin?: number; teacher?: number; student?: number } };
    }).expectedBaseline?.profileRoles;
    if (roles?.admin !== 1 || roles?.teacher !== 1 || roles?.student !== 136) {
        errors.push('Manifest profile-role baseline is not exactly admin=1, teacher=1, student=136.');
    }

    if (!backupValidation.value) return { ok: false, errors, value: null };
    const manifestBytes = readFileSync(path.join(root, FIXTURE_CLEANUP_PATHS.manifest));
    return {
        ok: errors.length === 0,
        errors,
        value: errors.length === 0 ? {
            manifest,
            manifestSha256: sha256(manifestBytes),
            backupReceipt: backupValidation.value,
            backupReceiptSha256: backup.sha256,
            publicCleanupReceipt: publicReceipt,
            publicCleanupReceiptSha256: cleanup.sha256,
        } : null,
    };
}

export function selectAuthQuarantineConfig(payload: unknown): ValidationResult<AuthQuarantineConfig> {
    if (!isRecord(payload) || typeof payload.disable_signup !== 'boolean') {
        return { ok: false, errors: ['Auth config response is missing disable_signup.'], value: null };
    }
    const errors: string[] = [];
    if (!payload.disable_signup) errors.push('Supabase production signup is not disabled.');

    let jwtExpirySeconds = PRODUCTION_AUTH_DEFAULT_JWT_EXPIRY_SECONDS;
    let jwtExpirySource: AuthQuarantineConfig['jwtExpirySource'] = 'conservative_default';
    if (typeof payload.jwt_exp === 'number' && Number.isInteger(payload.jwt_exp)) {
        jwtExpirySeconds = payload.jwt_exp;
        jwtExpirySource = 'management_api';
    }
    if (jwtExpirySeconds < 60 || jwtExpirySeconds > PRODUCTION_AUTH_MAX_JWT_EXPIRY_SECONDS) {
        errors.push(`JWT expiry must be between 60 and ${PRODUCTION_AUTH_MAX_JWT_EXPIRY_SECONDS} seconds.`);
    }
    return {
        ok: errors.length === 0,
        errors,
        value: errors.length === 0 ? { disableSignup: true, jwtExpirySeconds, jwtExpirySource } : null,
    };
}

export function buildQuarantineUntil(completedAt: string, jwtExpirySeconds: number): string {
    const timestamp = Date.parse(completedAt);
    if (!Number.isFinite(timestamp)) throw new Error('Completion timestamp is invalid.');
    if (!Number.isInteger(jwtExpirySeconds) || jwtExpirySeconds < 60
        || jwtExpirySeconds > PRODUCTION_AUTH_MAX_JWT_EXPIRY_SECONDS) {
        throw new Error('JWT expiry is outside the approved range.');
    }
    return new Date(timestamp + (jwtExpirySeconds + PRODUCTION_AUTH_QUARANTINE_SKEW_SECONDS) * 1_000).toISOString();
}

export function validateAuthReducedReceipt(
    raw: unknown,
    expected: {
        publicCleanupReceiptSha256: string;
        backupReceiptSha256: string;
        preservedSetSha256?: string;
    },
): ValidationResult<AuthReducedReceipt> {
    if (!isRecord(raw)) return { ok: false, errors: ['Auth-reduced receipt must be an object.'], value: null };
    const value = raw as unknown as AuthReducedReceipt;
    const errors: string[] = [];
    if (value.schemaVersion !== 1) errors.push('Auth-reduced receipt schemaVersion must be 1.');
    if (value.status !== 'AUTH_REDUCED_QUARANTINED') errors.push('Auth-reduced receipt status mismatch.');
    if (value.targetProjectRef !== PRODUCTION_AUTH_CLEANUP_TARGET.projectRef) errors.push('Auth-reduced target mismatch.');
    validateTimestamp(value.completedAt, 'Auth-reduced completion', errors);
    if (!Number.isFinite(Date.parse(value.quarantineUntil))) errors.push('Auth quarantine expiry timestamp is invalid.');
    if (Date.parse(value.quarantineUntil) <= Date.parse(value.completedAt)) errors.push('Auth quarantine must end after completion.');
    if (value.publicCleanupReceiptSha256 !== expected.publicCleanupReceiptSha256) errors.push('Auth-reduced public cleanup binding mismatch.');
    if (value.backupReceiptSha256 !== expected.backupReceiptSha256) errors.push('Auth-reduced backup binding mismatch.');
    if (value.authUsers !== 2 || value.profiles !== 0 || value.fixtureStudents !== 0) errors.push('Auth-reduced aggregate counts mismatch.');
    if (!value.passwordsRotatedUnretained || value.refreshSessionsRemaining !== 0) errors.push('Credential/session quarantine is incomplete.');
    if (value.storageObjectsTouched !== false || value.externalProvidersTouched !== false) errors.push('Auth-reduced exclusions mismatch.');
    if (value.resetEmailsSent !== false || value.googleDriveFixtureFolders !== 'UNTOUCHED_110_OBSERVED') errors.push('Auth-reduced email/Drive exclusions mismatch.');
    if (value.freezeCutoff !== PRODUCTION_AUTH_FREEZE_CUTOFF) errors.push('Auth-reduced freeze cutoff mismatch.');
    if (!SHA256_PATTERN.test(value.preservedSetSha256) || !SHA256_PATTERN.test(value.deletedCandidateSetSha256)) {
        errors.push('Auth-reduced identity set hashes are invalid.');
    }
    if (expected.preservedSetSha256 && value.preservedSetSha256 !== expected.preservedSetSha256) {
        errors.push('Auth-reduced preserved-set hash mismatch.');
    }
    if (!Number.isInteger(value.jwtExpirySeconds) || value.jwtExpirySeconds < 60
        || value.jwtExpirySeconds > PRODUCTION_AUTH_MAX_JWT_EXPIRY_SECONDS) {
        errors.push('Auth-reduced JWT expiry is invalid.');
    } else if (Number.isFinite(Date.parse(value.completedAt))
        && value.quarantineUntil !== buildQuarantineUntil(value.completedAt, value.jwtExpirySeconds)) {
        errors.push('Auth-reduced quarantine expiry does not equal JWT TTL plus safety skew.');
    }
    return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function validateCheckpoint(
    raw: unknown,
    expected: {
        publicCleanupReceiptSha256: string;
        backupReceiptSha256: string;
    },
): ValidationResult<AuthCleanupCheckpoint> {
    if (!isRecord(raw)) return { ok: false, errors: ['Checkpoint must be an object.'], value: null };
    const value = raw as unknown as AuthCleanupCheckpoint;
    const errors: string[] = [];
    if (value.schemaVersion !== 1) errors.push('Checkpoint schemaVersion must be 1.');
    if (value.targetProjectRef !== PRODUCTION_AUTH_CLEANUP_TARGET.projectRef) errors.push('Checkpoint target mismatch.');
    if (!['delete', 'resume-delete', 'finalize', 'resume-finalize'].includes(value.phase)) errors.push('Checkpoint phase is invalid.');
    if (!['IN_PROGRESS', 'PARTIAL_FAILURE', 'AUTH_REDUCED_QUARANTINED', 'FINALIZED'].includes(value.status)) errors.push('Checkpoint status is invalid.');
    validateTimestamp(value.startedAt, 'Checkpoint start', errors);
    validateTimestamp(value.updatedAt, 'Checkpoint update', errors);
    if (value.publicCleanupReceiptSha256 !== expected.publicCleanupReceiptSha256) errors.push('Checkpoint public cleanup binding mismatch.');
    if (value.backupReceiptSha256 !== expected.backupReceiptSha256) errors.push('Checkpoint backup binding mismatch.');
    if (value.freezeCutoff !== PRODUCTION_AUTH_FREEZE_CUTOFF) errors.push('Checkpoint freeze cutoff mismatch.');
    for (const hash of [value.preservedSetSha256, value.initialCandidateSetSha256, value.remainingCandidateSetSha256]) {
        if (!SHA256_PATTERN.test(hash)) errors.push('Checkpoint contains an invalid set hash.');
    }
    if (!Number.isInteger(value.initialCandidateCount) || value.initialCandidateCount !== 136) errors.push('Checkpoint initial candidate count must be 136.');
    if (!Number.isInteger(value.remainingCandidateCount) || value.remainingCandidateCount < 0 || value.remainingCandidateCount > 136) errors.push('Checkpoint remaining candidate count is invalid.');
    if (value.deletedCount !== value.initialCandidateCount - value.remainingCandidateCount) errors.push('Checkpoint deleted count is inconsistent.');
    if (!Number.isInteger(value.passwordRotationsCompleted) || value.passwordRotationsCompleted < 0 || value.passwordRotationsCompleted > 2) errors.push('Checkpoint password rotation count is invalid.');
    return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function validateAuthPreflightEvidence(
    raw: unknown,
    expectedPhase: AuthCleanupPhase,
    now = new Date(),
): ValidationResult<AuthPreflightEvidence> {
    if (!isRecord(raw)) return { ok: false, errors: ['Auth preflight evidence must be an object.'], value: null };
    const value = raw as unknown as AuthPreflightEvidence;
    const errors: string[] = [];
    if (value.schemaVersion !== 1 || value.status !== 'READY') errors.push('Auth preflight evidence status/schema mismatch.');
    if (value.targetProjectRef !== PRODUCTION_AUTH_CLEANUP_TARGET.projectRef) errors.push('Auth preflight target mismatch.');
    if (!evidenceIsFresh(value.createdAt, now)) errors.push('Auth preflight evidence is stale or future-dated.');
    if (value.approvalPhase !== expectedPhase) errors.push('Auth preflight phase mismatch.');
    const expectedReadiness: Record<AuthCleanupPhase, AuthPreflightEvidence['readiness']> = {
        delete: 'INITIAL_DELETE_READY',
        'resume-delete': 'RESUME_DELETE_READY',
        finalize: 'FINALIZE_READY',
        'resume-finalize': 'RESUME_FINALIZE_READY',
    };
    if (value.readiness !== expectedReadiness[expectedPhase]) errors.push('Auth preflight readiness mismatch.');
    for (const hash of [
        value.publicCleanupReceiptSha256,
        value.backupReceiptSha256,
        value.manifestSha256,
        value.auth?.preservedSetSha256,
        value.auth?.candidateSetSha256,
    ]) {
        if (!SHA256_PATTERN.test(hash ?? '')) errors.push('Auth preflight contains an invalid binding hash.');
    }
    if (value.freezeCutoff !== PRODUCTION_AUTH_FREEZE_CUTOFF) errors.push('Auth preflight freeze cutoff mismatch.');
    if (value.baselineProfileRoles?.admin !== 1 || value.baselineProfileRoles?.teacher !== 1
        || value.baselineProfileRoles?.student !== 136
        || value.baselineProfileRoles?.source !== 'cleanup_v2_manifest') {
        errors.push('Auth preflight role baseline is not bound to the cleanup v2 manifest.');
    }
    if (value.auth?.preserved !== 2 || value.auth?.identitiesCreatedAfterFreeze !== 0) errors.push('Auth preflight preserved/freeze aggregate mismatch.');
    if (value.database?.storageOwnedObjects !== 0 || value.database?.fixtureRows !== 0) errors.push('Auth preflight database exclusions are not clean.');
    if (!value.configuration?.disableSignup
        || value.configuration.jwtExpirySeconds > PRODUCTION_AUTH_MAX_JWT_EXPIRY_SECONDS) {
        errors.push('Auth preflight inert configuration is invalid.');
    }
    if (value.safety?.readOnly !== true || value.safety?.noEmailsPersisted !== true
        || value.safety?.noUuidsPersisted !== true || value.safety?.outboundEmailsSent !== false
        || value.safety?.externalWritePerformed !== false) {
        errors.push('Auth preflight safety assertions are incomplete.');
    }
    if (expectedPhase === 'delete' && (value.auth.users !== 138 || value.auth.candidates !== 136)) {
        errors.push('Initial Auth delete preflight must observe 138 users and 136 candidates.');
    }
    if (expectedPhase === 'resume-delete' && (value.auth.users < 2 || value.auth.users > 138
        || value.auth.candidates < 0 || value.auth.candidates > 136 || !value.checkpointSha256)) {
        errors.push('Resume Auth delete preflight aggregates/checkpoint are invalid.');
    }
    if ((expectedPhase === 'finalize' || expectedPhase === 'resume-finalize')
        && (value.auth.users !== 2 || value.auth.candidates !== 0
            || !value.database.finalSchemaReady || !value.authReducedReceiptSha256
            || !value.rolloutReceiptSha256 || !value.quarantineElapsed)) {
        errors.push('Finalize preflight lacks the completed rollout/quarantine gates.');
    }
    return { ok: errors.length === 0, errors, value: errors.length === 0 ? value : null };
}

export function buildAuthCleanupApproval(binding: ApprovalBinding): string {
    assertSha(binding.evidenceSha256, 'evidence');
    assertSha(binding.publicCleanupReceiptSha256, 'public cleanup receipt');
    assertSha(binding.backupReceiptSha256, 'backup receipt');
    assertSha(binding.preservedSetSha256, 'preserved set');
    assertSha(binding.candidateSetSha256, 'candidate set');
    if (binding.checkpointSha256) assertSha(binding.checkpointSha256, 'checkpoint');
    if (binding.authReducedReceiptSha256) assertSha(binding.authReducedReceiptSha256, 'auth-reduced receipt');
    if (binding.rolloutReceiptSha256) assertSha(binding.rolloutReceiptSha256, 'production rollout receipt');
    const phaseLabel: Record<AuthCleanupPhase, string> = {
        delete: 'REDUCIR AUTH PRODUCCION Y CUARENTENAR CREDENCIALES',
        'resume-delete': 'REANUDAR REDUCCION AUTH PRODUCCION Y CUARENTENAR CREDENCIALES',
        finalize: 'FINALIZAR PERFILES AUTH PRODUCCION TRAS CUARENTENA',
        'resume-finalize': 'REANUDAR FINALIZACION DE PERFILES AUTH PRODUCCION',
    };
    const isDeletePhase = binding.phase === 'delete' || binding.phase === 'resume-delete';
    return [
        `AUTORIZO ${phaseLabel[binding.phase]}`,
        `target=${PRODUCTION_AUTH_CLEANUP_TARGET.projectRef}`,
        `phase=${binding.phase}`,
        `evidence=${binding.evidenceSha256}`,
        `public_cleanup=${binding.publicCleanupReceiptSha256}`,
        `backup=${binding.backupReceiptSha256}`,
        `preserved_set=${binding.preservedSetSha256}`,
        `candidate_count=${binding.candidateCount}`,
        `candidate_set=${binding.candidateSetSha256}`,
        `checkpoint=${binding.checkpointSha256 ?? '<none>'}`,
        `auth_reduced=${binding.authReducedReceiptSha256 ?? '<none>'}`,
        `production_rollout=${binding.rolloutReceiptSha256 ?? '<none>'}`,
        `quarantine_until=${binding.quarantineUntil ?? '<created-after-rotation>'}`,
        `freeze_cutoff=${PRODUCTION_AUTH_FREEZE_CUTOFF}`,
        'preserve=TEST_ADMIN_EMAIL,TEST_TEACHER_EMAIL',
        `hard_delete=${isDeletePhase ? 'sequential_with_stop_on_partial_failure' : 'FORBIDDEN'}`,
        `passwords=${isDeletePhase ? 'random_unretained' : 'UNCHANGED_ALREADY_QUARANTINED'}`,
        'signup=DISABLED',
        'checkout=DISABLED',
        'outbound_email=FORBIDDEN',
        'password_reset=FORBIDDEN',
        'storage=UNTOUCHED_ZERO_OWNERSHIP_REQUIRED',
        'google_drive=UNTOUCHED_110_FIXTURE_FOLDERS_OBSERVED',
        'stripe=UNTOUCHED',
        'production_must_remain_inert_until_quarantine_expiry=true',
    ].join(' | ');
}

export function approvalEnvForPhase(phase: AuthCleanupPhase): string {
    if (phase === 'delete') return PRODUCTION_AUTH_APPROVAL_ENVS.delete;
    if (phase === 'resume-delete') return PRODUCTION_AUTH_APPROVAL_ENVS.resumeDelete;
    if (phase === 'finalize') return PRODUCTION_AUTH_APPROVAL_ENVS.finalize;
    return PRODUCTION_AUTH_APPROVAL_ENVS.resumeFinalize;
}

export function evidenceIsFresh(createdAt: string, now = new Date()): boolean {
    const timestamp = Date.parse(createdAt);
    const age = now.getTime() - timestamp;
    return Number.isFinite(timestamp) && age >= -FUTURE_CLOCK_SKEW_MS && age <= PRODUCTION_AUTH_EVIDENCE_MAX_AGE_MS;
}

export function sanitizeAuthCleanupOutput(value: string): string {
    return value
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, '[redacted-uuid]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, 'postgresql://[redacted]')
        .replace(/(?:sbp_|sb_secret_|eyJ)[A-Za-z0-9._~-]+/giu, '[redacted-secret]')
        .replace(/Bearer\s+[^\s'"<>]+/giu, 'Bearer [redacted]')
        .replace(/(password|service_role|supabase_db_url|supabase_access_token)\s*[=:]\s*[^\s'"<>]+/giu, '$1=[redacted]');
}

export function readJsonEvidence<T>(filePath: string): { value: T; sha256: string } {
    const bytes = readFileSync(path.resolve(filePath));
    return { value: JSON.parse(bytes.toString('utf8')) as T, sha256: sha256(bytes) };
}

export function isSha256(value: string): boolean {
    return SHA256_PATTERN.test(value);
}

function readJsonFile(
    filePath: string,
    label: string,
    errors: string[],
): { value: unknown; sha256: string } | null {
    const absolutePath = path.resolve(filePath);
    if (!existsSync(absolutePath)) {
        errors.push(`${label} file does not exist.`);
        return null;
    }
    try {
        const bytes = readFileSync(absolutePath);
        return { value: JSON.parse(bytes.toString('utf8')) as unknown, sha256: sha256(bytes) };
    } catch {
        errors.push(`${label} is not valid JSON.`);
        return null;
    }
}

function validateTimestamp(raw: string, label: string, errors: string[]): void {
    const timestamp = Date.parse(raw);
    if (!Number.isFinite(timestamp)) errors.push(`${label} timestamp is invalid.`);
    else if (timestamp > Date.now() + FUTURE_CLOCK_SKEW_MS) errors.push(`${label} timestamp is in the future.`);
}

function assertSha(value: string, label: string): void {
    if (!SHA256_PATTERN.test(value)) throw new Error(`${label} SHA-256 is invalid.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
