import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import {
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseMixedJsonOutput } from '../ci/verify-cloudflare-identity';
import {
    createExternalWriteReceipt,
    markExternalWriteAttemptStarted,
    markExternalWriteAmbiguous,
    markExternalWriteConfirmed,
    markExternalWriteSafeStateProven,
    requireReadonlyReconciliation,
    type ExternalWriteOutcome,
    type ExternalWritePerformed,
    type ExternalWriteReceiptState,
} from './external-write-receipt';

export const forbiddenGoogleWebBindingNames = [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
] as const;

export const productionBootstrapSecretNames = ['INTERNAL_JOB_SECRET'] as const;

export const productionActiveProviderBindingNames = [
    'ADMIN_EMAIL',
    'CRON_SECRET',
    'EMAIL_FROM',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'FULFILLMENT_WORKER_URL',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'SENTRY_DSN',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SUPABASE_EXPECTED_PROJECT_REF',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPPORT_ALERT_EMAIL',
    'TURNSTILE_SECRET_KEY',
] as const;

export const productionCanonicalInertProviderBindingNames = {
    web: [
        'FULFILLMENT_WORKER_URL',
        'SUPABASE_EXPECTED_PROJECT_REF',
    ],
    fulfillment: [
        'SUPABASE_EXPECTED_PROJECT_REF',
    ],
} as const satisfies Record<'web' | 'fulfillment', readonly string[]>;

export type WorkerWriteCheckpointStage =
    | 'write_ahead'
    | 'provider_succeeded_needs_readback'
    | 'provider_outcome_ambiguous'
    | 'readback_proven'
    | 'readback_failed'
    | 'recovery_safe_state_proven';

export interface WorkerWriteCheckpoint {
    schemaVersion: 1;
    runId: string;
    sequence: number;
    revision: number;
    commandId: string;
    stage: WorkerWriteCheckpointStage;
    recordedAt: string;
    receipt: ExternalWriteReceiptState;
    intent?: WorkerWriteIntent;
}

export interface WorkerWriteIntent {
    kind: 'cloudflare-worker-deploy';
    accountId: string;
    worker: string;
    environment: string;
    prewriteVersionId: string | null;
    deployTag: string;
}

export interface WorkerWriteReceiptSummary {
    externalWriteAttempted: boolean;
    externalWritePerformed: ExternalWritePerformed;
    externalWriteOutcome: ExternalWriteOutcome;
    readonlyReconciliationRequired: boolean;
}

export interface ProviderProcessResult {
    exitCode: number | null;
    timedOut: boolean;
    errorPresent: boolean;
}

export interface WorkerWriteLockOwner {
    schemaVersion: 1;
    lockId: string;
    runId: string;
    ownerHost: string;
    ownerPid: number;
    acquiredAt: string;
    state: 'locked_until_all_readbacks_proven';
}

export type ProcessLiveness = 'alive' | 'dead' | 'unknown';

type JsonRecord = Record<string, unknown>;

export function captureInitialApprovalSentence(
    environment: NodeJS.ProcessEnv,
    name: string,
): string {
    return environment[name]?.trim() ?? '';
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseExactSecretInventory(source: string): string[] {
    const parsed = parseMixedJsonOutput(source);
    if (!Array.isArray(parsed)) throw new Error('Cloudflare secret inventory must be a JSON array.');

    const names: string[] = [];
    for (const entry of parsed) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) {
            throw new Error('Cloudflare secret inventory contains a malformed entry.');
        }
        names.push(entry.name);
    }
    if (new Set(names).size !== names.length) throw new Error('Cloudflare secret inventory contains duplicate names.');
    return names.sort();
}

export function assertExactSecretInventory(source: string, expectedNames: readonly string[]): string[] {
    const actual = parseExactSecretInventory(source);
    const expected = [...expectedNames].sort();
    if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
        throw new Error(`Cloudflare secret inventory mismatch: actual=${actual.join(',') || 'none'} expected=${expected.join(',') || 'none'}.`);
    }
    return actual;
}

export function productionBootstrapSecretInventoryErrors(
    workerVisible: boolean,
    names: readonly string[],
): string[] {
    const actual = [...names].sort();
    const expected = [...productionBootstrapSecretNames];
    if (new Set(actual).size !== actual.length) return ['bootstrap secret inventory contains duplicate names'];
    if (!workerVisible) {
        return actual.length === 0
            ? []
            : [`secret inventory exists without a visible production Worker: ${actual.join(',')}`];
    }
    return actual.length === expected.length && actual.every((name, index) => name === expected[index])
        ? []
        : [`bootstrap secret inventory must be exactly ${expected.join(',')}; actual=${actual.join(',') || 'none'}`];
}

export function productionInertBindingNameErrors(
    kind: 'web' | 'fulfillment',
    names: readonly string[],
): string[] {
    const errors: string[] = [];
    const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
    if (duplicates.length > 0) errors.push(`duplicate binding names: ${duplicates.join(',')}`);
    const canonicalInertNames = new Set<string>(productionCanonicalInertProviderBindingNames[kind]);
    const activeProviders = productionActiveProviderBindingNames.filter((name) =>
        names.includes(name) && !canonicalInertNames.has(name));
    if (activeProviders.length > 0) {
        errors.push(`active provider bindings must be absent from inert ${kind}: ${activeProviders.join(',')}`);
    }
    if (kind === 'fulfillment' && names.includes('FULFILLMENT_QUEUE')) {
        errors.push('FULFILLMENT_QUEUE must be absent from inert fulfillment');
    }
    return errors;
}

export function parseVersionBindingNames(source: string, expectedVersionId: string): string[] {
    const parsed = parseMixedJsonOutput(source);
    if (!isRecord(parsed) || parsed.id !== expectedVersionId) {
        throw new Error('Cloudflare version view does not match the exact expected version.');
    }
    const resources = parsed.resources;
    if (!isRecord(resources) || !Array.isArray(resources.bindings)) {
        throw new Error('Cloudflare version view is missing its binding inventory.');
    }

    const names: string[] = [];
    for (const binding of resources.bindings) {
        if (!isRecord(binding) || typeof binding.name !== 'string' || !binding.name.trim()) {
            throw new Error('Cloudflare version view contains a malformed binding.');
        }
        names.push(binding.name);
    }
    if (new Set(names).size !== names.length) throw new Error('Cloudflare version view contains duplicate binding names.');
    return names.sort();
}

export function assertNoGoogleWebBindings(source: string, expectedVersionId: string): string[] {
    const names = parseVersionBindingNames(source, expectedVersionId);
    const forbidden = forbiddenGoogleWebBindingNames.filter((name) => names.includes(name));
    if (forbidden.length > 0) {
        throw new Error(`Forbidden Google bindings are present on the web Worker: ${forbidden.join(',')}.`);
    }
    return names;
}

export function startWorkerWriteCheckpoint(
    commandId: string,
    sequence: number,
    runId: string,
    intent?: WorkerWriteIntent,
    now = new Date(),
): WorkerWriteCheckpoint {
    return {
        schemaVersion: 1,
        runId,
        sequence,
        revision: 0,
        commandId,
        stage: 'write_ahead',
        recordedAt: now.toISOString(),
        receipt: markExternalWriteAttemptStarted(createExternalWriteReceipt()),
        ...(intent ? { intent } : {}),
    };
}

export function classifyWorkerWriteProviderResult(
    checkpoint: WorkerWriteCheckpoint,
    result: ProviderProcessResult,
    now = new Date(),
): WorkerWriteCheckpoint {
    const succeeded = result.exitCode === 0 && !result.timedOut && !result.errorPresent;
    const receipt = succeeded
        ? requireReadonlyReconciliation(markExternalWriteConfirmed(checkpoint.receipt, true))
        : markExternalWriteAmbiguous(checkpoint.receipt);
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        stage: succeeded ? 'provider_succeeded_needs_readback' : 'provider_outcome_ambiguous',
        recordedAt: now.toISOString(),
        receipt,
    };
}

export function reconcileWorkerWriteCheckpoint(
    checkpoint: WorkerWriteCheckpoint,
    intendedStateProven: boolean,
    now = new Date(),
): WorkerWriteCheckpoint {
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        stage: intendedStateProven ? 'readback_proven' : 'readback_failed',
        recordedAt: now.toISOString(),
        receipt: intendedStateProven
            ? markExternalWriteConfirmed(checkpoint.receipt, true)
            : requireReadonlyReconciliation(checkpoint.receipt),
    };
}

export function reconcileWorkerWriteCheckpointToSafeState(
    checkpoint: WorkerWriteCheckpoint,
    now = new Date(),
): WorkerWriteCheckpoint {
    return {
        ...checkpoint,
        revision: checkpoint.revision + 1,
        stage: 'recovery_safe_state_proven',
        recordedAt: now.toISOString(),
        receipt: markExternalWriteSafeStateProven(checkpoint.receipt),
    };
}

export function summarizeWorkerWriteCheckpoints(
    checkpoints: readonly WorkerWriteCheckpoint[],
): WorkerWriteReceiptSummary {
    if (checkpoints.length === 0) {
        return {
            externalWriteAttempted: false,
            externalWritePerformed: false,
            externalWriteOutcome: 'not_attempted',
            readonlyReconciliationRequired: false,
        };
    }

    const unknown = checkpoints.some((checkpoint) => checkpoint.receipt.externalWritePerformed === 'unknown');
    const performed = checkpoints.some((checkpoint) => checkpoint.receipt.externalWritePerformed === true);
    const readonlyReconciliationRequired = checkpoints.some(
        (checkpoint) => checkpoint.receipt.readonlyReconciliationRequired,
    );
    return {
        externalWriteAttempted: true,
        externalWritePerformed: performed ? true : unknown ? 'unknown' : false,
        externalWriteOutcome: unknown
            ? readonlyReconciliationRequired
                ? 'ambiguous_needs_readonly_reconciliation'
                : 'historical_outcome_unknown_safe_state_proven'
            : readonlyReconciliationRequired
                ? 'confirmed_succeeded_needs_readonly_reconciliation'
                : performed
                    ? 'confirmed_succeeded'
                    : 'confirmed_failed',
        readonlyReconciliationRequired,
    };
}

export function persistWorkerWriteCheckpointAtomically(
    directory: string,
    checkpoint: WorkerWriteCheckpoint,
): string {
    mkdirSync(directory, { recursive: true });
    const safeId = checkpoint.commandId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    const safeRunId = checkpoint.runId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    const fileName = [
        safeRunId,
        String(checkpoint.sequence).padStart(3, '0'),
        safeId,
        `r${checkpoint.revision}`,
        checkpoint.stage,
        'json',
    ].join('.');
    const finalPath = path.join(directory, fileName);
    writeNewJsonAtomically(finalPath, checkpoint);
    return finalPath;
}

export function persistCanonicalWorkerWriteCheckpoint(
    pendingDirectory: string,
    checkpoint: WorkerWriteCheckpoint,
): string {
    return persistWorkerWriteCheckpointAtomically(pendingDirectory, checkpoint);
}

export function resolveCanonicalWorkerWriteCheckpoint(
    pendingDirectory: string,
    resolvedDirectory: string,
    checkpoint: WorkerWriteCheckpoint,
): string[] {
    mkdirSync(resolvedDirectory, { recursive: true });
    if (!existsSync(pendingDirectory)) return [];
    const safeRunId = checkpoint.runId.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    const prefix = `${safeRunId}.${String(checkpoint.sequence).padStart(3, '0')}.`;
    const moved: string[] = [];
    for (const entry of readdirSync(pendingDirectory)) {
        if (!entry.startsWith(prefix) || !entry.endsWith('.json')) continue;
        const source = path.join(pendingDirectory, entry);
        const destination = path.join(resolvedDirectory, entry);
        if (existsSync(destination)) {
            if (readFileSync(source, 'utf8') !== readFileSync(destination, 'utf8')) {
                throw new Error(`Resolved Cloudflare checkpoint collision for ${entry}.`);
            }
            rmSync(source);
        } else {
            renameSync(source, destination);
        }
        moved.push(destination);
    }
    fsyncDirectoryBestEffort(pendingDirectory);
    fsyncDirectoryBestEffort(resolvedDirectory);
    return moved;
}

export function findUnresolvedWorkerWriteCheckpoints(
    pendingDirectory: string,
): WorkerWriteCheckpoint[] {
    if (!existsSync(pendingDirectory)) return [];
    const latest = new Map<string, WorkerWriteCheckpoint>();
    for (const entry of readdirSync(pendingDirectory)) {
        if (!entry.endsWith('.json')) continue;
        const parsed = JSON.parse(readFileSync(path.join(pendingDirectory, entry), 'utf8')) as WorkerWriteCheckpoint;
        if (
            parsed.schemaVersion !== 1
            || typeof parsed.runId !== 'string' || !parsed.runId.trim()
            || !Number.isSafeInteger(parsed.sequence) || parsed.sequence < 1
            || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0
            || typeof parsed.commandId !== 'string' || !parsed.commandId.trim()
            || !isCheckpointStage(parsed.stage)
            || !isExternalWriteReceipt(parsed.receipt)
            || (parsed.intent !== undefined && !isWorkerWriteIntent(parsed.intent))
        ) throw new Error('Canonical Cloudflare write checkpoint is malformed.');
        const key = `${parsed.runId}:${parsed.sequence}`;
        const current = latest.get(key);
        if (!current || parsed.revision > current.revision) latest.set(key, parsed);
    }
    // Presence in the canonical pending directory is itself unresolved. This
    // deliberately keeps a crash between the proven revision write and its
    // move-to-resolved operation recoverable and fail-closed.
    return [...latest.values()];
}

export function acquireWorkerWriteExecutionLock(
    lockDirectory: string,
    runId: string,
    ownerPid = process.pid,
    ownerHost = hostname(),
): WorkerWriteLockOwner {
    mkdirSync(path.dirname(lockDirectory), { recursive: true });
    const owner: WorkerWriteLockOwner = {
        schemaVersion: 1,
        lockId: randomUUID(),
        runId,
        ownerHost,
        ownerPid,
        acquiredAt: new Date().toISOString(),
        state: 'locked_until_all_readbacks_proven',
    };
    let createdLockDirectory = false;
    try {
        mkdirSync(lockDirectory);
        createdLockDirectory = true;
        writeNewJsonAtomically(workerWriteLockOwnerPath(lockDirectory), owner);
        fsyncDirectoryBestEffort(lockDirectory);
        fsyncDirectoryBestEffort(path.dirname(lockDirectory));
        return owner;
    } catch (error) {
        // Never remove a directory created by another contender. The atomic
        // mkdir is the lock claim; its owner file can legitimately be absent
        // for a few instructions while the winning process persists it.
        if (createdLockDirectory && existsSync(lockDirectory)) {
            rmSync(lockDirectory, { force: true, recursive: true });
        }
        throw error;
    }
}

export function acquireWorkerWriteReconciliationLock(
    lockDirectory: string,
    runId: string,
    livenessProbe?: (ownerPid: number) => ProcessLiveness,
): WorkerWriteLockOwner {
    if (existsSync(lockDirectory)) {
        const staleOwner = requireRecoverableWorkerWriteExecutionLock(
            lockDirectory,
            undefined,
            livenessProbe,
        );
        releaseWorkerWriteExecutionLock(lockDirectory, staleOwner);
    }
    return acquireWorkerWriteExecutionLock(lockDirectory, runId);
}

export function acquireNormalWorkerWriteExecutionLock(
    lockDirectory: string,
    reconciliationLockDirectory: string,
    runId: string,
): WorkerWriteLockOwner {
    if (existsSync(reconciliationLockDirectory)) {
        throw new Error('A reconciliation lock blocks normal Cloudflare writes.');
    }
    const owner = acquireWorkerWriteExecutionLock(lockDirectory, runId);
    if (existsSync(reconciliationLockDirectory)) {
        releaseWorkerWriteExecutionLock(lockDirectory, owner);
        throw new Error('A reconciliation lock appeared during normal Cloudflare lock acquisition.');
    }
    return owner;
}

export function readWorkerWriteExecutionLock(lockDirectory: string): WorkerWriteLockOwner {
    const parsed = JSON.parse(readFileSync(workerWriteLockOwnerPath(lockDirectory), 'utf8')) as unknown;
    if (!isWorkerWriteLockOwner(parsed)) throw new Error('Cloudflare write lock owner is malformed.');
    return parsed;
}

export function assertWorkerWriteExecutionLockOwned(
    lockDirectory: string,
    expectedOwner: WorkerWriteLockOwner,
): WorkerWriteLockOwner {
    const actualOwner = readWorkerWriteExecutionLock(lockDirectory);
    if (!sameWorkerWriteLockOwner(actualOwner, expectedOwner)) {
        throw new Error(`Cloudflare write lock ownership changed; expected run ${expectedOwner.runId}.`);
    }
    return actualOwner;
}

export function requireRecoverableWorkerWriteExecutionLock(
    lockDirectory: string,
    expectedHost = hostname(),
    livenessProbe: (ownerPid: number) => ProcessLiveness = processLiveness,
): WorkerWriteLockOwner {
    const owner = readWorkerWriteExecutionLock(lockDirectory);
    if (owner.ownerHost !== expectedHost) {
        throw new Error(`Cloudflare write lock belongs to a different host: ${owner.ownerHost}.`);
    }
    const liveness = livenessProbe(owner.ownerPid);
    if (liveness !== 'dead') {
        throw new Error(`Cloudflare write lock PID liveness is ${liveness}; recovery requires definitely dead.`);
    }
    return owner;
}

export function releaseWorkerWriteExecutionLock(
    lockDirectory: string,
    expectedOwner: WorkerWriteLockOwner,
): void {
    assertWorkerWriteExecutionLockOwned(lockDirectory, expectedOwner);
    const releaseClaim = path.join(lockDirectory, '.release-claim');
    mkdirSync(releaseClaim);
    assertWorkerWriteExecutionLockOwned(lockDirectory, expectedOwner);

    const releasedDirectory = `${lockDirectory}.released.${expectedOwner.lockId}.${randomUUID()}`;
    renameSync(lockDirectory, releasedDirectory);
    const movedOwner = readWorkerWriteExecutionLock(releasedDirectory);
    if (!sameWorkerWriteLockOwner(movedOwner, expectedOwner)) {
        throw new Error(`Refusing to delete a replaced Cloudflare write lock for run ${expectedOwner.runId}.`);
    }
    rmSync(releasedDirectory, { force: true, recursive: true });
    fsyncDirectoryBestEffort(path.dirname(lockDirectory));
}

function writeNewJsonAtomically(finalPath: string, value: unknown): void {
    const temporaryPath = `${finalPath}.${randomUUID()}.tmp`;
    let descriptor: number | null = null;
    try {
        descriptor = openSync(temporaryPath, 'wx');
        writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;
        renameSync(temporaryPath, finalPath);
        fsyncDirectoryBestEffort(path.dirname(finalPath));
    } finally {
        if (descriptor !== null) closeSync(descriptor);
        rmSync(temporaryPath, { force: true });
    }
}

function isCheckpointStage(value: unknown): value is WorkerWriteCheckpointStage {
    return [
        'write_ahead',
        'provider_succeeded_needs_readback',
        'provider_outcome_ambiguous',
        'readback_proven',
        'readback_failed',
        'recovery_safe_state_proven',
    ].includes(String(value));
}

function isExternalWriteReceipt(value: unknown): value is ExternalWriteReceiptState {
    if (!isRecord(value)) return false;
    const outcomes: ExternalWriteOutcome[] = [
        'not_attempted',
        'confirmed_succeeded',
        'confirmed_failed',
        'ambiguous_needs_readonly_reconciliation',
        'historical_outcome_unknown_safe_state_proven',
        'confirmed_succeeded_needs_readonly_reconciliation',
    ];
    return value.externalWriteAttempted === true
        && [true, false, 'unknown'].includes(value.externalWritePerformed as boolean | string)
        && outcomes.includes(value.externalWriteOutcome as ExternalWriteOutcome)
        && typeof value.readonlyReconciliationRequired === 'boolean';
}

function isWorkerWriteIntent(value: unknown): value is WorkerWriteIntent {
    if (!isRecord(value)) return false;
    return value.kind === 'cloudflare-worker-deploy'
        && typeof value.accountId === 'string' && /^[0-9a-f]{32}$/iu.test(value.accountId)
        && typeof value.worker === 'string' && Boolean(value.worker.trim())
        && typeof value.environment === 'string' && Boolean(value.environment.trim())
        && typeof value.deployTag === 'string'
        && /^eh-rc-[a-z0-9-]+-[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value.deployTag)
        && (value.prewriteVersionId === null
            || (typeof value.prewriteVersionId === 'string'
                && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(value.prewriteVersionId)));
}

function workerWriteLockOwnerPath(lockDirectory: string): string {
    return path.join(lockDirectory, 'owner.json');
}

function isWorkerWriteLockOwner(value: unknown): value is WorkerWriteLockOwner {
    if (!isRecord(value)) return false;
    return value.schemaVersion === 1
        && typeof value.lockId === 'string' && /^[0-9a-f-]{36}$/iu.test(value.lockId)
        && typeof value.runId === 'string' && Boolean(value.runId.trim())
        && typeof value.ownerHost === 'string' && Boolean(value.ownerHost.trim())
        && Number.isSafeInteger(value.ownerPid) && Number(value.ownerPid) > 0
        && typeof value.acquiredAt === 'string' && !Number.isNaN(Date.parse(value.acquiredAt))
        && value.state === 'locked_until_all_readbacks_proven';
}

function sameWorkerWriteLockOwner(left: WorkerWriteLockOwner, right: WorkerWriteLockOwner): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.lockId === right.lockId
        && left.runId === right.runId
        && left.ownerHost === right.ownerHost
        && left.ownerPid === right.ownerPid
        && left.acquiredAt === right.acquiredAt
        && left.state === right.state;
}

function processLiveness(ownerPid: number): ProcessLiveness {
    try {
        process.kill(ownerPid, 0);
        return 'alive';
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown';
    }
}

function fsyncDirectoryBestEffort(directory: string): void {
    let descriptor: number | null = null;
    try {
        descriptor = openSync(directory, 'r');
        fsyncSync(descriptor);
    } catch {
        // Windows may not permit opening a directory as a file descriptor.
        // The checkpoint file itself has already been fsynced; platforms that
        // support directory fsync also durably flush the rename metadata here.
    } finally {
        if (descriptor !== null) closeSync(descriptor);
    }
}
