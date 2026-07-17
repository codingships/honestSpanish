import { createHash, randomUUID } from 'node:crypto';
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
import { hostname } from 'node:os';
import path from 'node:path';

export type StripeCutoverProcessLiveness = 'alive' | 'dead' | 'unknown';
export type StripeCutoverStatePhase =
    | 'write_ahead'
    | 'provider_succeeded_needs_readback'
    | 'provider_outcome_ambiguous'
    | 'resolved_target'
    | 'resolved_previous';

export interface StripeCutoverIntent {
    accountIdSha256: string;
    endpointIdSha256: string;
    priorUrl: string;
    targetUrl: string;
    enabledEvents: string[];
    approvalSentenceSha256: string;
}

export interface StripeCutoverObservation {
    url: string;
    livemode: boolean;
    status: string | null;
    enabledEvents: string[];
}

export interface StripeCutoverPersistentState extends StripeCutoverIntent {
    schemaVersion: 1;
    scopeHash: string;
    revision: number;
    runId: string;
    phase: StripeCutoverStatePhase;
    providerOutcome: 'not_started' | 'succeeded' | 'ambiguous' | 'reconciled';
    updatedAt: string;
}

interface StripeCutoverLockOwner {
    schemaVersion: 1;
    lockId: string;
    runId: string;
    ownerHostSha256: string;
    ownerPid: number;
    acquiredAt: string;
}

interface StripeCutoverStatePaths {
    scopeRoot: string;
    journalDirectory: string;
    recoveryJournalDirectory: string;
    executionLockDirectory: string;
    reconciliationLockDirectory: string;
}

export interface StripeCutoverStateOptions {
    stateRoot?: string;
    livenessProbe?: (pid: number) => StripeCutoverProcessLiveness;
    ownerPid?: number;
    ownerHost?: string;
}

export interface StripeCutoverExecutionGuard {
    scopeHash: string;
    paths: StripeCutoverStatePaths;
    owner: StripeCutoverLockOwner;
}

export interface StripeCutoverRecoverySession {
    scopeHash: string;
    paths: StripeCutoverStatePaths;
    pendingState: StripeCutoverPersistentState;
    executionOwner: StripeCutoverLockOwner | null;
    reconciliationOwner: StripeCutoverLockOwner;
    livenessProbe: (pid: number) => StripeCutoverProcessLiveness;
    ownerHostSha256: string;
}

export type StripeCutoverRecoveryStart =
    | { status: 'not_needed'; reason: string }
    | { status: 'terminal_lock_only_recovered'; reason: string }
    | { status: 'blocked'; reason: string }
    | { status: 'readback_required'; reason: string; session: StripeCutoverRecoverySession };

export interface StripeCutoverRecoveryResult {
    status: 'resolved_target' | 'resolved_previous' | 'ambiguous';
    terminal: true;
    reason: string;
    state: StripeCutoverPersistentState;
}

const unresolvedPhases = new Set<StripeCutoverStatePhase>([
    'write_ahead',
    'provider_succeeded_needs_readback',
    'provider_outcome_ambiguous',
]);

export function stripeCutoverScopeHash(accountIdSha256: string, endpointIdSha256: string): string {
    assertSha256(accountIdSha256, 'accountIdSha256');
    assertSha256(endpointIdSha256, 'endpointIdSha256');
    return sha256Hex(`${accountIdSha256}:${endpointIdSha256}`);
}

export function openStripeCutoverExecutionGuard(
    scopeHash: string,
    runId: string,
    options: StripeCutoverStateOptions = {},
): StripeCutoverExecutionGuard {
    assertSha256(scopeHash, 'scopeHash');
    const paths = statePaths(scopeHash, options.stateRoot);
    const latest = readLatestStripeCutoverState(paths);
    if (latest && unresolvedPhases.has(latest.phase)) {
        throw new Error('Stripe webhook cutover has an unresolved write-ahead state; recovery GET is required.');
    }
    if (existsSync(paths.reconciliationLockDirectory)) {
        throw new Error('Stripe webhook cutover reconciliation is active or unresolved.');
    }
    if (existsSync(paths.executionLockDirectory)) {
        throw new Error('Stripe webhook cutover execution is active or requires recovery.');
    }

    const owner = acquireLock(paths.executionLockDirectory, runId, options);
    try {
        if (existsSync(paths.reconciliationLockDirectory)) {
            throw new Error('A reconciliation lock appeared during Stripe execution lock acquisition.');
        }
        const latestAfterLock = readLatestStripeCutoverState(paths);
        if (latestAfterLock && unresolvedPhases.has(latestAfterLock.phase)) {
            throw new Error('An unresolved Stripe write state appeared during execution lock acquisition.');
        }
        return { scopeHash, paths, owner };
    } catch (error) {
        releaseLock(paths.executionLockDirectory, owner);
        throw error;
    }
}

export function releaseStripeCutoverPrewriteGuard(guard: StripeCutoverExecutionGuard): void {
    assertLockOwned(guard.paths.executionLockDirectory, guard.owner);
    const latest = readLatestStripeCutoverState(guard.paths);
    if (latest?.runId === guard.owner.runId && unresolvedPhases.has(latest.phase)) {
        throw new Error('Cannot release Stripe execution guard with an unresolved write state.');
    }
    releaseLock(guard.paths.executionLockDirectory, guard.owner);
}

export function persistStripeCutoverWriteAhead(
    guard: StripeCutoverExecutionGuard,
    intent: StripeCutoverIntent,
): StripeCutoverPersistentState {
    assertLockOwned(guard.paths.executionLockDirectory, guard.owner);
    validateIntent(intent);
    if (stripeCutoverScopeHash(intent.accountIdSha256, intent.endpointIdSha256) !== guard.scopeHash) {
        throw new Error('Stripe cutover intent identity does not match the execution scope.');
    }
    const latest = readLatestStripeCutoverState(guard.paths);
    if (latest && unresolvedPhases.has(latest.phase)) {
        throw new Error('Stripe cutover write-ahead refused because an unresolved state already exists.');
    }
    return appendState(guard.paths, {
        ...intent,
        schemaVersion: 1,
        scopeHash: guard.scopeHash,
        revision: (latest?.revision ?? 0) + 1,
        runId: guard.owner.runId,
        phase: 'write_ahead',
        providerOutcome: 'not_started',
        updatedAt: new Date().toISOString(),
    });
}

export function markStripeCutoverProviderResult(
    guard: StripeCutoverExecutionGuard,
    current: StripeCutoverPersistentState,
    outcome: 'succeeded' | 'ambiguous',
): StripeCutoverPersistentState {
    assertLockOwned(guard.paths.executionLockDirectory, guard.owner);
    assertLatestState(guard.paths, current);
    return appendState(guard.paths, {
        ...current,
        revision: current.revision + 1,
        phase: outcome === 'succeeded' ? 'provider_succeeded_needs_readback' : 'provider_outcome_ambiguous',
        providerOutcome: outcome,
        updatedAt: new Date().toISOString(),
    });
}

export function resolveStripeCutoverExecution(
    guard: StripeCutoverExecutionGuard,
    current: StripeCutoverPersistentState,
    resolution: 'resolved_target' | 'resolved_previous',
): StripeCutoverPersistentState {
    assertLockOwned(guard.paths.executionLockDirectory, guard.owner);
    assertLatestState(guard.paths, current);
    const resolved = appendState(guard.paths, {
        ...current,
        revision: current.revision + 1,
        phase: resolution,
        providerOutcome: 'reconciled',
        updatedAt: new Date().toISOString(),
    });
    releaseLock(guard.paths.executionLockDirectory, guard.owner);
    return resolved;
}

export function beginStripeCutoverRecovery(
    scopeHash: string,
    runId: string,
    options: StripeCutoverStateOptions = {},
): StripeCutoverRecoveryStart {
    assertSha256(scopeHash, 'scopeHash');
    const paths = statePaths(scopeHash, options.stateRoot);
    const latest = readLatestStripeCutoverState(paths);
    const executionLockExists = existsSync(paths.executionLockDirectory);
    const reconciliationLockExists = existsSync(paths.reconciliationLockDirectory);
    if ((!latest || !unresolvedPhases.has(latest.phase)) && !executionLockExists && !reconciliationLockExists) {
        return { status: 'not_needed', reason: 'no-unresolved-state-or-lock' };
    }

    const livenessProbe = options.livenessProbe ?? processLiveness;
    const ownerHostSha256 = sha256Hex(options.ownerHost ?? hostname());
    let reconciliationOwner: StripeCutoverLockOwner;
    try {
        if (existsSync(paths.reconciliationLockDirectory)) {
            const staleReconciliationOwner = requireDefinitelyDeadLock(
                paths.reconciliationLockDirectory,
                ownerHostSha256,
                livenessProbe,
            );
            releaseLock(paths.reconciliationLockDirectory, staleReconciliationOwner);
        }
        reconciliationOwner = acquireLock(paths.reconciliationLockDirectory, runId, options);
    } catch (error) {
        return { status: 'blocked', reason: `reconciliation-lock:${safeError(error)}` };
    }

    try {
        const pendingState = readLatestStripeCutoverState(paths);
        let executionOwner: StripeCutoverLockOwner | null = null;
        if (existsSync(paths.executionLockDirectory)) {
            executionOwner = requireDefinitelyDeadLock(
                paths.executionLockDirectory,
                ownerHostSha256,
                livenessProbe,
            );
        }

        if (!pendingState || !unresolvedPhases.has(pendingState.phase)) {
            appendRecoveryEvent(paths, scopeHash, runId, 'stale-prewrite-lock-recovered');
            if (executionOwner) releaseLock(paths.executionLockDirectory, executionOwner);
            releaseLock(paths.reconciliationLockDirectory, reconciliationOwner);
            return {
                status: 'terminal_lock_only_recovered',
                reason: 'stale pre-write lock had no unresolved write-ahead state',
            };
        }

        if (executionOwner && executionOwner.runId !== pendingState.runId) {
            throw new Error('Execution lock owner and unresolved Stripe state belong to different runs.');
        }

        return {
            status: 'readback_required',
            reason: 'unresolved write state requires one GET-only readback',
            session: {
                scopeHash,
                paths,
                pendingState,
                executionOwner,
                reconciliationOwner,
                livenessProbe,
                ownerHostSha256,
            },
        };
    } catch (error) {
        tryReleaseReconciliation(paths, reconciliationOwner);
        return { status: 'blocked', reason: `recovery-state:${safeError(error)}` };
    }
}

export function finishStripeCutoverRecovery(
    session: StripeCutoverRecoverySession,
    observation: StripeCutoverObservation,
): StripeCutoverRecoveryResult {
    assertLockOwned(session.paths.reconciliationLockDirectory, session.reconciliationOwner);
    assertLatestState(session.paths, session.pendingState);
    const invariant = observation.livemode === false
        && observation.status === 'enabled'
        && sameStringSet(observation.enabledEvents, session.pendingState.enabledEvents);
    const targetProven = invariant && observation.url === session.pendingState.targetUrl;
    const previousProven = invariant && observation.url === session.pendingState.priorUrl;

    if (!targetProven && !previousProven) {
        const ambiguous = appendState(session.paths, {
            ...session.pendingState,
            revision: session.pendingState.revision + 1,
            phase: 'provider_outcome_ambiguous',
            providerOutcome: 'ambiguous',
            updatedAt: new Date().toISOString(),
        });
        releaseLock(session.paths.reconciliationLockDirectory, session.reconciliationOwner);
        return {
            status: 'ambiguous',
            terminal: true,
            reason: 'GET readback proved neither the exact target nor the exact previous state',
            state: ambiguous,
        };
    }

    const resolution = targetProven ? 'resolved_target' : 'resolved_previous';
    const resolved = appendState(session.paths, {
        ...session.pendingState,
        revision: session.pendingState.revision + 1,
        phase: resolution,
        providerOutcome: 'reconciled',
        updatedAt: new Date().toISOString(),
    });
    if (session.executionOwner) {
        requireDefinitelyDeadLock(
            session.paths.executionLockDirectory,
            session.ownerHostSha256,
            session.livenessProbe,
        );
        releaseLock(session.paths.executionLockDirectory, session.executionOwner);
    }
    releaseLock(session.paths.reconciliationLockDirectory, session.reconciliationOwner);
    return {
        status: resolution,
        terminal: true,
        reason: targetProven
            ? 'GET readback proved the exact target state'
            : 'GET readback proved the exact previous state',
        state: resolved,
    };
}

export function blockStripeCutoverRecovery(
    session: StripeCutoverRecoverySession,
): StripeCutoverPersistentState {
    assertLockOwned(session.paths.reconciliationLockDirectory, session.reconciliationOwner);
    assertLatestState(session.paths, session.pendingState);
    const ambiguous = appendState(session.paths, {
        ...session.pendingState,
        revision: session.pendingState.revision + 1,
        phase: 'provider_outcome_ambiguous',
        providerOutcome: 'ambiguous',
        updatedAt: new Date().toISOString(),
    });
    releaseLock(session.paths.reconciliationLockDirectory, session.reconciliationOwner);
    return ambiguous;
}

export function readStripeCutoverState(
    scopeHash: string,
    options: StripeCutoverStateOptions = {},
): StripeCutoverPersistentState | null {
    assertSha256(scopeHash, 'scopeHash');
    return readLatestStripeCutoverState(statePaths(scopeHash, options.stateRoot));
}

function statePaths(scopeHash: string, rootOverride?: string): StripeCutoverStatePaths {
    const stateRoot = rootOverride ?? path.join(process.cwd(), 'outputs', 'launch-stripe-webhook-cutover-state');
    const scopeRoot = path.join(stateRoot, scopeHash);
    return {
        scopeRoot,
        journalDirectory: path.join(scopeRoot, 'state-journal'),
        recoveryJournalDirectory: path.join(scopeRoot, 'recovery-journal'),
        executionLockDirectory: path.join(scopeRoot, 'execution.lock'),
        reconciliationLockDirectory: path.join(scopeRoot, 'reconciliation.lock'),
    };
}

function appendState(
    paths: StripeCutoverStatePaths,
    state: StripeCutoverPersistentState,
): StripeCutoverPersistentState {
    validateState(state);
    mkdirSync(paths.journalDirectory, { recursive: true });
    const filename = [
        String(state.revision).padStart(8, '0'),
        state.runId.toLowerCase().replace(/[^a-z0-9-]/gu, '-'),
        state.phase,
        'json',
    ].join('.');
    writeNewJsonAtomically(path.join(paths.journalDirectory, filename), state);
    return state;
}

function appendRecoveryEvent(
    paths: StripeCutoverStatePaths,
    scopeHash: string,
    runId: string,
    result: string,
): void {
    mkdirSync(paths.recoveryJournalDirectory, { recursive: true });
    writeNewJsonAtomically(path.join(
        paths.recoveryJournalDirectory,
        `${new Date().toISOString().replace(/[:.]/gu, '-')}.${randomUUID()}.json`,
    ), {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        scopeHash,
        runId,
        result,
    });
}

function readLatestStripeCutoverState(paths: StripeCutoverStatePaths): StripeCutoverPersistentState | null {
    if (!existsSync(paths.journalDirectory)) return null;
    const entries = readdirSync(paths.journalDirectory).filter((entry) => entry.endsWith('.json')).sort();
    let latest: StripeCutoverPersistentState | null = null;
    for (const entry of entries) {
        const parsed = JSON.parse(readFileSync(path.join(paths.journalDirectory, entry), 'utf8')) as unknown;
        validateState(parsed);
        if (!latest || parsed.revision > latest.revision) latest = parsed;
    }
    return latest;
}

function assertLatestState(paths: StripeCutoverStatePaths, expected: StripeCutoverPersistentState): void {
    const latest = readLatestStripeCutoverState(paths);
    if (!latest || latest.revision !== expected.revision || latest.runId !== expected.runId || latest.phase !== expected.phase) {
        throw new Error('Stripe cutover persistent state changed unexpectedly.');
    }
}

function acquireLock(
    lockDirectory: string,
    runId: string,
    options: StripeCutoverStateOptions,
): StripeCutoverLockOwner {
    mkdirSync(path.dirname(lockDirectory), { recursive: true });
    const owner: StripeCutoverLockOwner = {
        schemaVersion: 1,
        lockId: randomUUID(),
        runId,
        ownerHostSha256: sha256Hex(options.ownerHost ?? hostname()),
        ownerPid: options.ownerPid ?? process.pid,
        acquiredAt: new Date().toISOString(),
    };
    let created = false;
    try {
        mkdirSync(lockDirectory);
        created = true;
        writeNewJsonAtomically(lockOwnerPath(lockDirectory), owner);
        return owner;
    } catch (error) {
        if (created && existsSync(lockDirectory)) rmSync(lockDirectory, { recursive: true, force: true });
        throw error;
    }
}

function requireDefinitelyDeadLock(
    lockDirectory: string,
    expectedHostSha256: string,
    livenessProbe: (pid: number) => StripeCutoverProcessLiveness,
): StripeCutoverLockOwner {
    const owner = readLockOwner(lockDirectory);
    if (owner.ownerHostSha256 !== expectedHostSha256) {
        throw new Error('Stripe cutover lock belongs to another host; liveness is unknown.');
    }
    const liveness = livenessProbe(owner.ownerPid);
    if (liveness !== 'dead') {
        throw new Error(`Stripe cutover lock PID liveness is ${liveness}; recovery requires definitely dead.`);
    }
    return owner;
}

function releaseLock(lockDirectory: string, expected: StripeCutoverLockOwner): void {
    assertLockOwned(lockDirectory, expected);
    const claim = path.join(lockDirectory, '.release-claim');
    mkdirSync(claim);
    assertLockOwned(lockDirectory, expected);
    const released = `${lockDirectory}.released.${expected.lockId}.${randomUUID()}`;
    renameSync(lockDirectory, released);
    const moved = readLockOwner(released);
    if (!sameLockOwner(moved, expected)) throw new Error('Refusing to release a replaced Stripe cutover lock.');
    rmSync(released, { recursive: true, force: true });
}

function tryReleaseReconciliation(paths: StripeCutoverStatePaths, owner: StripeCutoverLockOwner): void {
    try {
        releaseLock(paths.reconciliationLockDirectory, owner);
    } catch {
        // Fail closed: a lock that cannot be proven owned remains in place.
    }
}

function assertLockOwned(lockDirectory: string, expected: StripeCutoverLockOwner): void {
    const actual = readLockOwner(lockDirectory);
    if (!sameLockOwner(actual, expected)) throw new Error('Stripe cutover lock ownership changed.');
}

function readLockOwner(lockDirectory: string): StripeCutoverLockOwner {
    const parsed = JSON.parse(readFileSync(lockOwnerPath(lockDirectory), 'utf8')) as unknown;
    if (!isLockOwner(parsed)) throw new Error('Stripe cutover lock owner is malformed.');
    return parsed;
}

function lockOwnerPath(lockDirectory: string): string {
    return path.join(lockDirectory, 'owner.json');
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
    } finally {
        if (descriptor !== null) closeSync(descriptor);
        rmSync(temporaryPath, { force: true });
    }
}

function validateState(value: unknown): asserts value is StripeCutoverPersistentState {
    if (!isRecord(value)
        || value.schemaVersion !== 1
        || !isSha256(value.scopeHash)
        || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
        || typeof value.runId !== 'string' || !value.runId
        || !isPhase(value.phase)
        || !['not_started', 'succeeded', 'ambiguous', 'reconciled'].includes(String(value.providerOutcome))
        || typeof value.updatedAt !== 'string') {
        throw new Error('Stripe cutover persistent state is malformed.');
    }
    const state = value as unknown as StripeCutoverPersistentState;
    validateIntent(state);
    if (stripeCutoverScopeHash(state.accountIdSha256, state.endpointIdSha256) !== state.scopeHash) {
        throw new Error('Stripe cutover persistent state identity hash is inconsistent.');
    }
}

function validateIntent(intent: StripeCutoverIntent): void {
    assertSha256(intent.accountIdSha256, 'accountIdSha256');
    assertSha256(intent.endpointIdSha256, 'endpointIdSha256');
    assertSha256(intent.approvalSentenceSha256, 'approvalSentenceSha256');
    if (!isStrictWebhookUrl(intent.priorUrl) || !isStrictWebhookUrl(intent.targetUrl)) {
        throw new Error('Stripe cutover persistent URLs must be strict webhook URLs.');
    }
    if (!Array.isArray(intent.enabledEvents) || intent.enabledEvents.length === 0
        || intent.enabledEvents.some((event) => typeof event !== 'string' || !event)
        || new Set(intent.enabledEvents).size !== intent.enabledEvents.length) {
        throw new Error('Stripe cutover persistent event set is invalid.');
    }
}

function isStrictWebhookUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && !url.port && !url.username && !url.password && !url.search && !url.hash
            && url.pathname === '/api/stripe-webhook';
    } catch {
        return false;
    }
}

function processLiveness(pid: number): StripeCutoverProcessLiveness {
    try {
        process.kill(pid, 0);
        return 'alive';
    } catch (error) {
        return isRecord(error) && error.code === 'ESRCH' ? 'dead' : 'unknown';
    }
}

function isLockOwner(value: unknown): value is StripeCutoverLockOwner {
    return isRecord(value)
        && value.schemaVersion === 1
        && typeof value.lockId === 'string' && Boolean(value.lockId)
        && typeof value.runId === 'string' && Boolean(value.runId)
        && isSha256(value.ownerHostSha256)
        && Number.isSafeInteger(value.ownerPid) && Number(value.ownerPid) > 0
        && typeof value.acquiredAt === 'string' && Boolean(value.acquiredAt);
}

function sameLockOwner(left: StripeCutoverLockOwner, right: StripeCutoverLockOwner): boolean {
    return left.lockId === right.lockId
        && left.runId === right.runId
        && left.ownerHostSha256 === right.ownerHostSha256
        && left.ownerPid === right.ownerPid
        && left.acquiredAt === right.acquiredAt;
}

function isPhase(value: unknown): value is StripeCutoverStatePhase {
    return [
        'write_ahead',
        'provider_succeeded_needs_readback',
        'provider_outcome_ambiguous',
        'resolved_target',
        'resolved_previous',
    ].includes(String(value));
}

function sameStringSet(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((item) => right.includes(item));
}

function assertSha256(value: string, label: string): void {
    if (!isSha256(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
