import { createHash } from 'node:crypto';
import path from 'node:path';

export const GOOGLE_PRODUCTION_CLEANUP_APPROVAL_ENV = 'GOOGLE_PRODUCTION_DRIVE_FIXTURE_CLEANUP_APPROVAL';
export const GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV = 'GOOGLE_PRODUCTION_DRIVE_EXPECTED_COUNT';
export const GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV = 'GOOGLE_PRODUCTION_DRIVE_EXPECTED_FINGERPRINT';
export const GOOGLE_PRODUCTION_RECOVERY_DIR_ENV = 'GOOGLE_PRODUCTION_CLEANUP_RECOVERY_DIR';
export const GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT = 110;
export const GOOGLE_PRODUCTION_RECOVERY_STATE_SCHEMA_VERSION = 1;

export interface DriveChildSnapshot {
    id: string;
    mimeType: string;
    createdTime: string;
}

export interface DriveChildrenAggregate {
    total: number;
    folders: number;
    nonFolders: number;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
    fingerprintSha256: string;
}

export interface GoogleProductionCleanupRecoveryState {
    schemaVersion: typeof GOOGLE_PRODUCTION_RECOVERY_STATE_SCHEMA_VERSION;
    environment: 'production';
    rootFingerprintSha256: string;
    rawIdsPersisted: false;
    baseline: {
        total: typeof GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT;
        folders: typeof GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT;
        nonFolders: 0;
        fingerprintSha256: string;
        childIdentityFingerprintsSha256: string;
        childIdentityFingerprints: string[];
    };
    status: 'WRITE_IN_PROGRESS' | 'EMPTY_VERIFIED';
    createdAt: string;
    updatedAt: string;
    writeSequence: number;
    previousStateSha256: string | null;
    pendingChildFingerprintSha256: string | null;
    activeChildrenLastObserved: number;
    movedToTrashDerived: number;
    permanentlyDeleted: 0;
    stateSha256: string;
}

export interface GoogleProductionRecoveryReconciliation {
    valid: boolean;
    errors: string[];
    activeChildren: number;
    movedToTrashDerived: number;
    unrecognizedChildFingerprints: string[];
}

export type GoogleProductionRecoveryDisposition = 'CAN_START_CANONICAL_BASELINE'
    | 'RECOVERY_READY'
    | 'RECOVERED_EMPTY'
    | 'PARTIAL_STATE_UNATTESTED'
    | 'ALREADY_CLEAN_UNATTESTED'
    | 'BLOCKED';

export interface GoogleProductionRecoveryEvaluation {
    disposition: GoogleProductionRecoveryDisposition;
    errors: string[];
    reconciliation: GoogleProductionRecoveryReconciliation | null;
}

export function driveChildrenAggregate(children: DriveChildSnapshot[]): DriveChildrenAggregate {
    const normalized = children
        .map((child) => ({
            id: child.id.trim(),
            mimeType: child.mimeType.trim() || 'unknown',
            createdTime: child.createdTime.trim() || 'unknown',
        }))
        .sort((left, right) => (
            left.id.localeCompare(right.id)
            || left.mimeType.localeCompare(right.mimeType)
            || left.createdTime.localeCompare(right.createdTime)
        ));
    const timestamps = normalized
        .map((child) => child.createdTime)
        .filter((value) => value !== 'unknown')
        .sort();
    const folders = normalized.filter((child) => child.mimeType === 'application/vnd.google-apps.folder').length;

    return {
        total: normalized.length,
        folders,
        nonFolders: normalized.length - folders,
        oldestCreatedAt: timestamps[0] ?? null,
        newestCreatedAt: timestamps.at(-1) ?? null,
        fingerprintSha256: createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex'),
    };
}

export function resourceFingerprint(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function driveChildIdentityFingerprint(child: DriveChildSnapshot): string {
    return resourceFingerprint(JSON.stringify(normalizeDriveChild(child)));
}

export function buildGoogleProductionCleanupRecoveryState(input: {
    rootFingerprint: string;
    children: DriveChildSnapshot[];
    now: Date;
}): GoogleProductionCleanupRecoveryState {
    const aggregate = driveChildrenAggregate(input.children);
    if (aggregate.total !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT
        || aggregate.folders !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT
        || aggregate.nonFolders !== 0) {
        throw new Error(`Recovery baseline must contain exactly ${GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT} direct folders.`);
    }
    if (!isSha256(input.rootFingerprint)) throw new Error('Recovery root fingerprint must be a lowercase SHA-256 fingerprint.');
    const childIdentityFingerprints = input.children.map(driveChildIdentityFingerprint).sort();
    if (new Set(childIdentityFingerprints).size !== childIdentityFingerprints.length) {
        throw new Error('Recovery baseline contains duplicate child identity fingerprints.');
    }
    const timestamp = input.now.toISOString();
    return hashRecoveryState({
        schemaVersion: GOOGLE_PRODUCTION_RECOVERY_STATE_SCHEMA_VERSION,
        environment: 'production',
        rootFingerprintSha256: input.rootFingerprint,
        rawIdsPersisted: false,
        baseline: {
            total: GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
            folders: GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
            nonFolders: 0,
            fingerprintSha256: aggregate.fingerprintSha256,
            childIdentityFingerprintsSha256: fingerprintSet(childIdentityFingerprints),
            childIdentityFingerprints,
        },
        status: 'WRITE_IN_PROGRESS',
        createdAt: timestamp,
        updatedAt: timestamp,
        writeSequence: 0,
        previousStateSha256: null,
        pendingChildFingerprintSha256: null,
        activeChildrenLastObserved: GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
        movedToTrashDerived: 0,
        permanentlyDeleted: 0,
    });
}

export function advanceGoogleProductionCleanupRecoveryState(input: {
    state: GoogleProductionCleanupRecoveryState;
    currentChildren: DriveChildSnapshot[];
    now: Date;
    pendingChildFingerprintSha256?: string | null;
    markEmptyVerified?: boolean;
}): GoogleProductionCleanupRecoveryState {
    const reconciliation = reconcileGoogleProductionCleanupRecoveryState({
        state: input.state,
        rootFingerprint: input.state.rootFingerprintSha256,
        currentChildren: input.currentChildren,
    });
    if (!reconciliation.valid) {
        throw new Error(`Recovery state cannot advance: ${reconciliation.errors.join(' / ')}`);
    }
    const pending = input.pendingChildFingerprintSha256 ?? null;
    if (pending && !input.state.baseline.childIdentityFingerprints.includes(pending)) {
        throw new Error('Pending child fingerprint is outside the approved recovery baseline.');
    }
    if (input.markEmptyVerified && reconciliation.activeChildren !== 0) {
        throw new Error('Recovery state cannot be marked empty while active children remain.');
    }
    return hashRecoveryState({
        ...withoutRecoveryStateHash(input.state),
        status: input.markEmptyVerified ? 'EMPTY_VERIFIED' : 'WRITE_IN_PROGRESS',
        updatedAt: input.now.toISOString(),
        writeSequence: input.state.writeSequence + 1,
        previousStateSha256: input.state.stateSha256,
        pendingChildFingerprintSha256: input.markEmptyVerified ? null : pending,
        activeChildrenLastObserved: reconciliation.activeChildren,
        movedToTrashDerived: reconciliation.movedToTrashDerived,
    });
}

export function reconcileGoogleProductionCleanupRecoveryState(input: {
    state: GoogleProductionCleanupRecoveryState;
    rootFingerprint: string;
    currentChildren: DriveChildSnapshot[];
}): GoogleProductionRecoveryReconciliation {
    const errors = validateRecoveryStateShape(input.state);
    if (input.state.rootFingerprintSha256 !== input.rootFingerprint) {
        errors.push('Recovery state root fingerprint does not match the current production root.');
    }
    const currentAggregate = driveChildrenAggregate(input.currentChildren);
    if (currentAggregate.nonFolders !== 0) {
        errors.push(`Current recovery snapshot contains ${currentAggregate.nonFolders} non-folder direct children.`);
    }
    const approved = new Set(input.state.baseline.childIdentityFingerprints);
    const currentFingerprints = input.currentChildren.map(driveChildIdentityFingerprint);
    const duplicateCurrent = currentFingerprints.length - new Set(currentFingerprints).size;
    if (duplicateCurrent !== 0) errors.push('Current recovery snapshot contains duplicate child identities.');
    const unrecognizedChildFingerprints = currentFingerprints.filter((fingerprint) => !approved.has(fingerprint));
    if (unrecognizedChildFingerprints.length > 0) {
        errors.push(`Current recovery snapshot contains ${unrecognizedChildFingerprints.length} child identities outside the approved baseline.`);
    }
    if (currentAggregate.total > GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
        errors.push('Current recovery snapshot exceeds the canonical fixture baseline.');
    }
    if (input.state.status === 'EMPTY_VERIFIED' && currentAggregate.total !== 0) {
        errors.push('Recovery state claims EMPTY_VERIFIED but active direct children are present.');
    }
    return {
        valid: errors.length === 0,
        errors,
        activeChildren: currentAggregate.total,
        movedToTrashDerived: GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT - currentAggregate.total,
        unrecognizedChildFingerprints,
    };
}

export function evaluateGoogleProductionCleanupRecoverySnapshot(input: {
    state: GoogleProductionCleanupRecoveryState | null;
    rootFingerprint: string;
    currentChildren: DriveChildSnapshot[];
}): GoogleProductionRecoveryEvaluation {
    const aggregate = driveChildrenAggregate(input.currentChildren);
    if (aggregate.nonFolders !== 0) {
        return {
            disposition: 'BLOCKED',
            errors: [`Current snapshot contains ${aggregate.nonFolders} non-folder direct children.`],
            reconciliation: null,
        };
    }
    const state = input.state;
    if (!state) {
        if (aggregate.total === GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
            return { disposition: 'CAN_START_CANONICAL_BASELINE', errors: [], reconciliation: null };
        }
        if (aggregate.total === 0) {
            return {
                disposition: 'ALREADY_CLEAN_UNATTESTED',
                errors: ['An empty root without durable baseline evidence cannot emit a rollout receipt.'],
                reconciliation: null,
            };
        }
        if (aggregate.total < GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
            return {
                disposition: 'PARTIAL_STATE_UNATTESTED',
                errors: ['A partial root without durable baseline evidence cannot be approved as a new snapshot.'],
                reconciliation: null,
            };
        }
        return {
            disposition: 'BLOCKED',
            errors: ['The current root exceeds the canonical 110-folder fixture baseline.'],
            reconciliation: null,
        };
    }
    const reconciliation = reconcileGoogleProductionCleanupRecoveryState({ ...input, state });
    if (!reconciliation.valid) {
        return { disposition: 'BLOCKED', errors: reconciliation.errors, reconciliation };
    }
    return {
        disposition: reconciliation.activeChildren === 0 ? 'RECOVERED_EMPTY' : 'RECOVERY_READY',
        errors: [],
        reconciliation,
    };
}

export function buildGoogleFixturePolicyEvidence(input: {
    state: GoogleProductionCleanupRecoveryState;
    currentChildren: DriveChildSnapshot[];
    completedAt: Date;
    recoveredAfterInterruptedRun: boolean;
}): Record<string, unknown> {
    const reconciliation = reconcileGoogleProductionCleanupRecoveryState({
        state: input.state,
        rootFingerprint: input.state.rootFingerprintSha256,
        currentChildren: input.currentChildren,
    });
    if (!reconciliation.valid || reconciliation.activeChildren !== 0 || input.state.status !== 'EMPTY_VERIFIED') {
        throw new Error(`Google fixture policy evidence requires a valid EMPTY_VERIFIED recovery state: ${reconciliation.errors.join(' / ')}`);
    }
    return {
        schemaVersion: 2,
        environment: 'production',
        status: 'TRASHED_AND_VERIFIED',
        completedAt: input.completedAt.toISOString(),
        observedActiveRootChildrenBefore: GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
        observedFoldersBefore: GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
        activeRootChildrenAfter: 0,
        permanentlyDeleted: 0,
        rootIdStored: false,
        baselineFingerprintSha256: input.state.baseline.fingerprintSha256,
        recoveryStateSha256: input.state.stateSha256,
        recoveredAfterInterruptedRun: input.recoveredAfterInterruptedRun,
    };
}

export function validateGoogleProductionRecoveryApproval(input: {
    state: GoogleProductionCleanupRecoveryState;
    expectedCount: string | undefined;
    expectedFingerprint: string | undefined;
}): string[] {
    const errors: string[] = [];
    const parsedCount = Number(input.expectedCount);
    if (parsedCount !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
        errors.push(`${GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV} must remain ${GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT} during recovery`);
    }
    if (input.expectedFingerprint !== input.state.baseline.fingerprintSha256) {
        errors.push(`${GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV} must match the original approved baseline during recovery`);
    }
    return errors;
}

export function isGoogleProductionCleanupRecoveryState(value: unknown): value is GoogleProductionCleanupRecoveryState {
    return validateRecoveryStateShape(value).length === 0;
}

export function validateGoogleProductionRecoveryDirectory(
    rawValue: string | undefined,
    repositoryRoot = process.cwd(),
): { valid: boolean; resolvedPath: string | null; reason: string } {
    const value = rawValue?.trim();
    if (!value) {
        return { valid: false, resolvedPath: null, reason: `${GOOGLE_PRODUCTION_RECOVERY_DIR_ENV} is missing` };
    }
    if (!path.isAbsolute(value)) {
        return { valid: false, resolvedPath: null, reason: `${GOOGLE_PRODUCTION_RECOVERY_DIR_ENV} must be an absolute path` };
    }
    const root = path.resolve(repositoryRoot);
    const resolvedPath = path.resolve(value);
    const relative = path.relative(root, resolvedPath);
    const outsideRepository = relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    if (!outsideRepository) {
        return {
            valid: false,
            resolvedPath: null,
            reason: `${GOOGLE_PRODUCTION_RECOVERY_DIR_ENV} must resolve outside the repository`,
        };
    }
    return { valid: true, resolvedPath, reason: 'absolute recovery directory outside repository' };
}

export function buildGoogleProductionCleanupApproval(input: {
    rootFingerprint: string;
    childCount: number;
    childFingerprint: string;
}): string {
    return `Autorizo mover a la papelera, sin borrado permanente, unicamente los ${input.childCount} hijos directos activos de la carpeta raiz de Google Drive de produccion cuya huella SHA-256 es \`${input.rootFingerprint}\`, siempre que la huella agregada exacta de esos hijos siga siendo \`${input.childFingerprint}\`; autorizo la verificacion read-only posterior. No autorizo tocar la carpeta raiz, la plantilla, permisos, Calendar, staging, Supabase, Stripe, Resend, Cloudflare, DNS, dominios ni otros archivos.`;
}

export function validateExpectedSnapshot(input: {
    aggregate: DriveChildrenAggregate;
    expectedCount: string | undefined;
    expectedFingerprint: string | undefined;
}): string[] {
    const errors: string[] = [];
    const parsedCount = Number(input.expectedCount);
    if (!input.expectedCount || !Number.isSafeInteger(parsedCount) || parsedCount < 1) {
        errors.push(`${GOOGLE_PRODUCTION_EXPECTED_COUNT_ENV} must be a positive integer`);
    } else if (parsedCount !== input.aggregate.total) {
        errors.push(`expected child count ${parsedCount} does not match current count ${input.aggregate.total}`);
    }
    if (!input.expectedFingerprint || !/^[a-f0-9]{64}$/u.test(input.expectedFingerprint)) {
        errors.push(`${GOOGLE_PRODUCTION_EXPECTED_FINGERPRINT_ENV} must be a lowercase SHA-256 fingerprint`);
    } else if (input.expectedFingerprint !== input.aggregate.fingerprintSha256) {
        errors.push('expected child fingerprint does not match the current Drive snapshot');
    }
    if (input.aggregate.nonFolders !== 0) {
        errors.push(`current Drive snapshot contains ${input.aggregate.nonFolders} non-folder direct children`);
    }
    return errors;
}

function normalizeDriveChild(child: DriveChildSnapshot): DriveChildSnapshot {
    return {
        id: child.id.trim(),
        mimeType: child.mimeType.trim() || 'unknown',
        createdTime: child.createdTime.trim() || 'unknown',
    };
}

function fingerprintSet(values: string[]): string {
    return resourceFingerprint(JSON.stringify([...values].sort()));
}

function hashRecoveryState(
    value: Omit<GoogleProductionCleanupRecoveryState, 'stateSha256'>,
): GoogleProductionCleanupRecoveryState {
    return {
        ...value,
        stateSha256: resourceFingerprint(JSON.stringify(value)),
    };
}

function withoutRecoveryStateHash(
    value: GoogleProductionCleanupRecoveryState,
): Omit<GoogleProductionCleanupRecoveryState, 'stateSha256'> {
    const copy: Partial<GoogleProductionCleanupRecoveryState> = { ...value };
    delete copy.stateSha256;
    return copy as Omit<GoogleProductionCleanupRecoveryState, 'stateSha256'>;
}

function validateRecoveryStateShape(value: unknown): string[] {
    const errors: string[] = [];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Recovery state is not an object.'];
    const state = value as Partial<GoogleProductionCleanupRecoveryState>;
    if (state.schemaVersion !== GOOGLE_PRODUCTION_RECOVERY_STATE_SCHEMA_VERSION
        || state.environment !== 'production'
        || state.rawIdsPersisted !== false) {
        errors.push('Recovery state identity or privacy contract is invalid.');
    }
    if (!isSha256(state.rootFingerprintSha256)) errors.push('Recovery state root fingerprint is invalid.');
    const baseline = state.baseline;
    if (!baseline
        || baseline.total !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT
        || baseline.folders !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT
        || baseline.nonFolders !== 0) {
        errors.push('Recovery state baseline is not exactly 110 direct folders.');
    }
    const childFingerprints = baseline?.childIdentityFingerprints;
    if (!Array.isArray(childFingerprints)
        || childFingerprints.length !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT
        || childFingerprints.some((fingerprint) => !isSha256(fingerprint))
        || new Set(childFingerprints).size !== childFingerprints.length) {
        errors.push('Recovery state child fingerprint allowlist is invalid.');
    } else if (baseline?.childIdentityFingerprintsSha256 !== fingerprintSet(childFingerprints)) {
        errors.push('Recovery state child fingerprint allowlist hash is invalid.');
    }
    if (!isSha256(baseline?.fingerprintSha256)) errors.push('Recovery state baseline fingerprint is invalid.');
    if (!['WRITE_IN_PROGRESS', 'EMPTY_VERIFIED'].includes(state.status ?? '')) errors.push('Recovery state status is invalid.');
    if (!Number.isSafeInteger(state.writeSequence) || (state.writeSequence ?? -1) < 0) errors.push('Recovery state write sequence is invalid.');
    if (state.writeSequence === 0 && state.previousStateSha256 !== null) {
        errors.push('Initial recovery state must not reference a previous state.');
    }
    if ((state.writeSequence ?? 0) > 0 && !isSha256(state.previousStateSha256)) {
        errors.push('Recovery state chain fingerprint is invalid.');
    }
    if (!Number.isSafeInteger(state.activeChildrenLastObserved)
        || (state.activeChildrenLastObserved ?? -1) < 0
        || (state.activeChildrenLastObserved ?? Number.MAX_SAFE_INTEGER) > GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
        errors.push('Recovery state active child count is invalid.');
    }
    if (!Number.isSafeInteger(state.movedToTrashDerived)
        || (state.movedToTrashDerived ?? -1) < 0
        || (state.movedToTrashDerived ?? Number.MAX_SAFE_INTEGER) > GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT
        || (state.activeChildrenLastObserved ?? 0) + (state.movedToTrashDerived ?? 0) !== GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
        errors.push('Recovery state derived move count is invalid.');
    }
    if (state.permanentlyDeleted !== 0) errors.push('Recovery state permanent-delete contract is invalid.');
    if (state.pendingChildFingerprintSha256 !== null
        && !isSha256(state.pendingChildFingerprintSha256)) {
        errors.push('Recovery state pending child fingerprint is invalid.');
    }
    if (state.pendingChildFingerprintSha256
        && !childFingerprints?.includes(state.pendingChildFingerprintSha256)) {
        errors.push('Recovery state pending child is outside the approved baseline.');
    }
    if (!isTimestamp(state.createdAt) || !isTimestamp(state.updatedAt)) errors.push('Recovery state timestamps are invalid.');
    if (!isSha256(state.stateSha256)) {
        errors.push('Recovery state integrity fingerprint is missing.');
    } else if (resourceFingerprint(JSON.stringify(withoutRecoveryStateHash(state as GoogleProductionCleanupRecoveryState))) !== state.stateSha256) {
        errors.push('Recovery state integrity fingerprint does not match.');
    }
    return errors;
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function isTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
