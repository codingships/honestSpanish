import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    executionLockMayBeReleased,
    orchestrateRollbackDrill,
    type PhaseOutcome,
    type ProviderOutcome,
    type ReadbackOutcome,
    type RollbackDrillPhase,
} from './cloudflare-staging-fulfillment-rollback-drill-orchestrator';
import {
    createExternalWriteReceipt,
    markExternalWriteAmbiguous,
    markExternalWriteAttemptStarted,
    markExternalWriteConfirmed,
    requireReadonlyReconciliation,
    type ExternalWritePerformed,
    type ExternalWriteReceiptState,
} from './external-write-receipt';
import {
    STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV,
    STAGING_FULFILLMENT_ROLLBACK_TARGET,
    buildApprovalSnapshot,
    discoverRollbackVersions,
    exactRollbackApproval,
    parseMixedWranglerJson,
    parseVersionShape,
    rollbackWranglerArgs,
    snapshotSha256,
    validateHealthIdentity,
    validateVersionCompatibility,
    type HealthIdentity,
    type QueueDeliverySnapshot,
    type RollbackVersions,
    type VersionShape,
} from './cloudflare-staging-fulfillment-rollback-drill-shared';

type RunnerStatus =
    | 'READY_FOR_APPROVAL'
    | 'BLOCKED'
    | 'BLOCKED_NO_TOKEN'
    | 'DRILL_EXECUTED_AND_CURRENT_RESTORED'
    | 'DRILL_FAILED_BUT_CURRENT_RESTORED'
    | 'RESTORATION_UNPROVEN';

type WritePhase =
    | 'normalize_queue_active'
    | 'disable_cron'
    | 'pause_queue'
    | 'rollback_previous'
    | 'restore_current'
    | 'restore_cron'
    | 'resume_queue'
    | 'compensate_disable_cron'
    | 'compensate_pause_queue';

interface CommandCapture {
    id: string;
    readOnly: boolean;
    command: string;
    exitCode: number | null;
    stdoutSha256: string;
    stderrSha256: string;
}

interface ApiCapture {
    id: string;
    readOnly: boolean;
    method: 'GET' | 'PATCH' | 'PUT';
    path: string;
    attempt: number;
    maxAttempts: number;
    httpStatus: number | null;
    success: boolean;
    responseSha256?: string;
    retryScheduled?: boolean;
    retryReason?: 'transport_or_timeout' | 'retryable_http_status';
}

interface WriteReceipt {
    phase: WritePhase;
    target: string;
    mechanism: 'wrangler' | 'cloudflare-api';
    startedAt: string;
    completedAt?: string;
    state: ExternalWriteReceiptState;
}

interface PreflightEvidence {
    label: string;
    valid: boolean;
    errors: string[];
    versions?: RollbackVersions;
    currentShape?: VersionShape;
    previousShape?: VersionShape;
    health?: HealthIdentity;
    queue?: QueueDeliverySnapshot;
    cronSchedules?: string[];
    snapshot?: Record<string, unknown>;
    snapshotSha256?: string;
    approval?: string;
}

interface ActiveVerification {
    expectedVersionId: string;
    deploymentMatched: boolean;
    healthMatched: boolean;
    attempts: number;
}

interface RunnerReport {
    schemaVersion: 3;
    startedAt: string;
    endedAt: string;
    mode: 'plan-readonly' | 'execute-approved';
    status: RunnerStatus;
    target: typeof STAGING_FULFILLMENT_ROLLBACK_TARGET;
    externalWriteAttempted: boolean;
    externalWritePerformed: ExternalWritePerformed;
    originalCurrentRestored: boolean;
    cronDisabledVerified: boolean;
    cronRestoredVerified: boolean;
    queuePauseVerified: boolean;
    queueResumeVerified: boolean;
    isolationRetainedOnRestoreFailure: boolean;
    manualReconciliationRequired: boolean;
    approvalEnv: string;
    approvalMatched: boolean;
    exactApproval?: string;
    preflights: PreflightEvidence[];
    rollbackVerification?: ActiveVerification;
    restorationVerification?: ActiveVerification;
    errors: string[];
    commands: CommandCapture[];
    apiCalls: ApiCapture[];
    writeReceipts: WriteReceipt[];
    orchestrationOutcomes: PhaseOutcome[];
    artifacts: {
        summaryJson: string;
        summaryMarkdown: string;
        manifest: string;
        approval: string;
        writeReceipts: string;
        executionLock: string;
    };
}

interface ApiResult {
    ok: boolean;
    status: number;
    payload: Record<string, unknown>;
    rawSha256: string;
}

const EXPECTED_CRON = '0 * * * *';
const CLOUDFLARE_GET_RETRY_DELAYS_MS = [250, 1_000] as const;
const WRANGLER_SCOPE_ARGS = [
    '--config', 'workers/fulfillment/wrangler.toml',
    '--env', 'staging',
    '--install-skills=false',
];
const invokedScriptPath = process.argv[1];
const invokedDirectly = Boolean(
    invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href,
);
const startedAt = new Date();
const executeApproved = invokedDirectly ? parseMode(process.argv.slice(2)) : false;
const outputRoot = path.join(process.cwd(), 'outputs', 'launch-cloudflare-staging-fulfillment-rollback-drill');
const outputDir = path.join(outputRoot, startedAt.toISOString().replace(/[:.]/gu, '-'));

const report: RunnerReport = {
    schemaVersion: 3,
    startedAt: startedAt.toISOString(),
    endedAt: startedAt.toISOString(),
    mode: executeApproved ? 'execute-approved' : 'plan-readonly',
    status: 'BLOCKED',
    target: STAGING_FULFILLMENT_ROLLBACK_TARGET,
    externalWriteAttempted: false,
    externalWritePerformed: false,
    originalCurrentRestored: false,
    cronDisabledVerified: false,
    cronRestoredVerified: false,
    queuePauseVerified: false,
    queueResumeVerified: false,
    isolationRetainedOnRestoreFailure: false,
    manualReconciliationRequired: false,
    approvalEnv: STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV,
    approvalMatched: false,
    preflights: [],
    errors: [],
    commands: [],
    apiCalls: [],
    writeReceipts: [],
    orchestrationOutcomes: [],
    artifacts: {
        summaryJson: path.join(outputDir, 'summary.json'),
        summaryMarkdown: path.join(outputDir, 'summary.md'),
        manifest: path.join(outputDir, 'rollback-drill-manifest.json'),
        approval: path.join(outputDir, 'exact-approval-required.txt'),
        writeReceipts: path.join(outputDir, 'write-receipts.json'),
        executionLock: path.join(outputRoot, '.execution-lock.json'),
    },
};
const commandOutput = new Map<string, string>();

if (invokedDirectly) {
    mkdirSync(outputDir, { recursive: true });
    persistWriteReceipts();
    await run();
}

async function run(): Promise<void> {
    try {
        if (!cloudflareToken()) {
            report.status = 'BLOCKED_NO_TOKEN';
            report.errors.push('CLOUDFLARE_API_TOKEN is required in process memory for exact Queue, metrics and Cron API reads; it is never logged or persisted.');
            return;
        }

        const initial = await runLivePreflight('preflight_initial');
        report.preflights.push(initial);
        if (!initial.valid || !initial.approval || !initial.versions || !initial.snapshotSha256) {
            report.errors.push(...initial.errors);
            return;
        }
        report.exactApproval = initial.approval;
        writeFileSync(report.artifacts.approval, `${initial.approval}\n`, 'utf8');

        if (!executeApproved) {
            report.status = 'READY_FOR_APPROVAL';
            return;
        }
        if (existsSync(report.artifacts.executionLock)) {
            report.errors.push('A durable rollback-drill execution lock already exists; reconcile it read-only before any retry.');
            return;
        }

        report.approvalMatched = process.env[STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV] === initial.approval;
        if (!report.approvalMatched) {
            report.errors.push(`Exact ${STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV} value mismatch.`);
            return;
        }

        const beforeWrite = await runLivePreflight('preflight_before_write');
        report.preflights.push(beforeWrite);
        if (!beforeWrite.valid
            || beforeWrite.snapshotSha256 !== initial.snapshotSha256
            || beforeWrite.approval !== initial.approval
            || !beforeWrite.versions) {
            report.errors.push(...beforeWrite.errors, 'Live pre-write semantic snapshot changed or could not be revalidated.');
            return;
        }
        if (!isSafeCronWindow(new Date())) {
            report.errors.push('Safe Cron window closed before the first write; no write was attempted.');
            return;
        }

        acquireExecutionLock(initial.versions, initial.snapshotSha256);
        report.manualReconciliationRequired = true;
        persistWriteReceipts();
        const orchestration = await orchestrateRollbackDrill({
            runPhase: (phase) => runActualPhase(phase, initial.versions as RollbackVersions),
        });
        report.originalCurrentRestored = orchestration.currentRestored;
        report.cronRestoredVerified = orchestration.cronRestored;
        report.queueResumeVerified = orchestration.queueResumed;
        report.isolationRetainedOnRestoreFailure = orchestration.isolationRetainedOnRestoreFailure;
        report.manualReconciliationRequired = orchestration.manualReconciliationRequired;
        report.orchestrationOutcomes = orchestration.outcomes;
        report.errors.push(...orchestration.outcomes
            .filter((outcome) => outcome.error)
            .map((outcome) => `${outcome.phase}: ${outcome.error}`));

        if (!orchestration.restorationProven) {
            report.status = 'RESTORATION_UNPROVEN';
            report.errors.push('Original version, hourly Cron and active Queue delivery are not all proven; the durable lock remains.');
            if (!orchestration.isolationRetainedOnRestoreFailure) {
                report.errors.push('Fault invariant violated: Cron OFF, Queue paused and zero backlog are not proven after incomplete restoration.');
            } else {
                report.errors.push('Incomplete restoration was compensated and Cron/Queue isolation is proven; the durable lock remains for reconciliation.');
            }
        } else if (orchestration.forwardPathProven) {
            report.status = 'DRILL_EXECUTED_AND_CURRENT_RESTORED';
        } else {
            report.status = 'DRILL_FAILED_BUT_CURRENT_RESTORED';
            report.errors.push('The forward rollback path failed after a write. Current version, Cron and Queue are triple-proven restored, but the durable lock remains pending manual reconciliation.');
        }
        if (executionLockMayBeReleased(orchestration)) {
            releaseExecutionLock();
        }
    } catch (error) {
        report.errors.push(safeError(error));
        report.status = report.externalWriteAttempted ? 'RESTORATION_UNPROVEN' : report.status;
    } finally {
        finalizeReport();
    }
}

async function runActualPhase(
    phase: RollbackDrillPhase,
    versions: RollbackVersions,
): Promise<PhaseOutcome> {
    try {
        switch (phase) {
            case 'disable_cron': {
                await executeScheduleWrite('disable_cron', []);
                report.cronDisabledVerified = schedulesEqual(await readSchedules('after_disable_cron'), []);
                if (report.cronDisabledVerified) confirmWriteByReadback('disable_cron');
                return phaseOutcome(phase, report.cronDisabledVerified ? 'proven' : 'failed');
            }
            case 'normalize_queue_active': {
                await executeQueueDeliveryWrite('normalize_queue_active', false);
                await verifyQueueRuntime(false, 'after_normalize_queue_active');
                confirmWriteByReadback('normalize_queue_active');
                return phaseOutcome(phase, 'proven');
            }
            case 'pause_queue': {
                await executeQueueDeliveryWrite('pause_queue', true);
                const pausedQueue = await readQueueState('after_pause_queue');
                const backlog = await readQueueBacklog('after_pause_queue_metrics');
                report.queuePauseVerified = pausedQueue.deliveryPaused === true && backlog === 0;
                if (report.queuePauseVerified) confirmWriteByReadback('pause_queue');
                return phaseOutcome(phase, report.queuePauseVerified ? 'proven' : 'failed');
            }
            case 'verify_isolation': {
                await verifyIsolationBeforeRollback(versions.currentVersionId);
                return {
                    phase,
                    writeAttempted: false,
                    provider: 'not_applicable',
                    readback: 'proven',
                };
            }
            case 'rollback_previous': {
                executeWranglerWrite(
                    'rollback_previous',
                    versions.previousVersionId,
                    rollbackWranglerArgs(versions.previousVersionId),
                );
                report.rollbackVerification = await verifyActiveVersion('after_rollback_previous', versions.previousVersionId);
                const proven = report.rollbackVerification.deploymentMatched
                    && report.rollbackVerification.healthMatched;
                if (proven) confirmWriteByReadback('rollback_previous');
                return phaseOutcome(phase, proven ? 'proven' : 'failed');
            }
            case 'restore_current': {
                executeWranglerWrite(
                    'restore_current',
                    versions.currentVersionId,
                    rollbackWranglerArgs(versions.currentVersionId),
                );
                report.restorationVerification = await verifyActiveVersion('after_restore_current', versions.currentVersionId);
                const proven = report.restorationVerification.deploymentMatched
                    && report.restorationVerification.healthMatched;
                if (proven) confirmWriteByReadback('restore_current');
                return phaseOutcome(phase, proven ? 'proven' : 'failed');
            }
            case 'restore_cron': {
                await executeScheduleWrite('restore_cron', [{ cron: EXPECTED_CRON }]);
                const proven = schedulesEqual(await readSchedules('after_restore_cron'), [EXPECTED_CRON]);
                if (proven) confirmWriteByReadback('restore_cron');
                return phaseOutcome(phase, proven ? 'proven' : 'failed');
            }
            case 'resume_queue': {
                await executeQueueDeliveryWrite('resume_queue', false);
                await verifyQueueRuntime(false, 'after_resume_queue');
                confirmWriteByReadback('resume_queue');
                return phaseOutcome(phase, 'proven');
            }
            case 'verify_isolation_after_restore_failure': {
                await verifyCronQueueIsolation('after_restore_current_failure');
                return readOnlyPhaseOutcome(phase, 'proven');
            }
            case 'compensate_disable_cron': {
                await executeScheduleWrite('compensate_disable_cron', []);
                const proven = schedulesEqual(await readSchedules('after_compensate_disable_cron'), []);
                if (proven) confirmWriteByReadback('compensate_disable_cron');
                return phaseOutcome(phase, proven ? 'proven' : 'failed');
            }
            case 'compensate_pause_queue': {
                await executeQueueDeliveryWrite('compensate_pause_queue', true);
                await verifyQueueRuntime(true, 'after_compensate_pause_queue');
                confirmWriteByReadback('compensate_pause_queue');
                return phaseOutcome(phase, 'proven');
            }
            case 'verify_compensated_isolation': {
                await verifyCronQueueIsolation('after_compensated_isolation');
                return readOnlyPhaseOutcome(phase, 'proven');
            }
        }
    } catch (error) {
        return phaseOutcome(phase, 'ambiguous', safeError(error));
    }
}

function readOnlyPhaseOutcome(
    phase: 'verify_isolation' | 'verify_isolation_after_restore_failure' | 'verify_compensated_isolation',
    readback: ReadbackOutcome,
    error?: string,
): PhaseOutcome {
    return {
        phase,
        writeAttempted: false,
        provider: 'not_applicable',
        readback,
        ...(error ? { error } : {}),
    };
}

function phaseOutcome(
    phase: RollbackDrillPhase,
    readback: ReadbackOutcome,
    error?: string,
): PhaseOutcome {
    const receipt = [...report.writeReceipts].reverse()
        .find((candidate) => candidate.phase === phase);
    const provider = providerOutcome(receipt);
    return {
        phase,
        writeAttempted: Boolean(receipt),
        provider,
        readback,
        ...(error ? { error } : {}),
    };
}

function providerOutcome(receipt: WriteReceipt | undefined): ProviderOutcome {
    if (!receipt) return 'not_applicable';
    if (receipt.state.readonlyReconciliationRequired
        || receipt.state.externalWritePerformed === 'unknown') return 'ambiguous';
    return receipt.state.externalWritePerformed ? 'succeeded' : 'failed';
}

async function runLivePreflight(label: string): Promise<PreflightEvidence> {
    const errors: string[] = [];
    try {
        if (!isSafeCronWindow(new Date())) errors.push('Rollback drill must start between minutes 10 and 49, away from the hourly Cron boundary.');
        const ambientAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
        if (ambientAccount && ambientAccount !== STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId) {
            errors.push('Ambient CLOUDFLARE_ACCOUNT_ID does not match the exact staging account.');
        }

        const whoami = runWranglerJson(`${label}_whoami`, ['whoami', '--json']);
        const whoamiObject = asRecord(whoami);
        const accounts = asArray(whoamiObject.accounts).map(asRecord);
        if (whoamiObject.loggedIn !== true
            || !accounts.some((account) => account.id === STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId)) {
            errors.push('Wrangler whoami did not prove access to the exact Cloudflare account.');
        }

        const queue = await readQueueState(`${label}_queue`);
        if (queue.deliveryPaused === true) errors.push('Queue is already paused; do not normalize an unexplained paused state.');
        const backlog = await readQueueBacklog(`${label}_metrics`);
        if (backlog !== 0) errors.push(`Queue backlog must be exactly 0; observed ${backlog}.`);
        queue.backlogMessages = backlog;
        const cronSchedules = await readSchedules(`${label}_schedules`);
        if (!schedulesEqual(cronSchedules, [EXPECTED_CRON])) errors.push('Staging Worker must have exactly the hourly Cron before the drill.');

        const status = runWranglerJson(`${label}_deployments_status`, [
            'deployments', 'status', '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--json',
        ]);
        const deployments = runWranglerJson(`${label}_deployments_list`, [
            'deployments', 'list', '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--json',
        ]);
        const versions = discoverRollbackVersions(status, deployments);
        const currentShape = parseVersionShape(runWranglerJson(`${label}_current_version_view`, [
            'versions', 'view', versions.currentVersionId, '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--json',
        ]), versions.currentVersionId);
        const previousShape = parseVersionShape(runWranglerJson(`${label}_previous_version_view`, [
            'versions', 'view', versions.previousVersionId, '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--json',
        ]), versions.previousVersionId);
        errors.push(...validateVersionCompatibility(currentShape, previousShape).errors);
        const health = await probeHealth();
        errors.push(...validateHealthIdentity(health));

        const snapshot = buildApprovalSnapshot({ versions, currentShape, previousShape, health, queue, cronSchedules });
        const hash = snapshotSha256(snapshot);
        return {
            label,
            valid: errors.length === 0,
            errors,
            versions,
            currentShape,
            previousShape,
            health,
            queue,
            cronSchedules,
            snapshot,
            snapshotSha256: hash,
            approval: exactRollbackApproval(versions, hash),
        };
    } catch (error) {
        errors.push(safeError(error));
        return { label, valid: false, errors };
    }
}

async function readQueueState(id: string): Promise<QueueDeliverySnapshot> {
    const result = await cloudflareGetWithRetry(id, queuePath());
    if (!result.ok) throw new Error(`Cloudflare Queue read ${id} failed.`);
    const queue = asRecord(result.payload.result);
    const producers = asArray(queue.producers).map(asRecord);
    const consumers = asArray(queue.consumers).map(asRecord);
    const producerNames = workerNames(producers);
    const consumerNames = workerNames(consumers);
    if (queue.queue_id !== STAGING_FULFILLMENT_ROLLBACK_TARGET.queueId
        || queue.queue_name !== STAGING_FULFILLMENT_ROLLBACK_TARGET.queue
        || queue.producers_total_count !== 1
        || queue.consumers_total_count !== 1
        || producerNames.length !== 1
        || producerNames[0] !== STAGING_FULFILLMENT_ROLLBACK_TARGET.worker
        || consumerNames.length !== 1
        || consumerNames[0] !== STAGING_FULFILLMENT_ROLLBACK_TARGET.worker) {
        throw new Error('Cloudflare Queue identity or exact producer/consumer shape mismatch.');
    }
    const rawPaused = asRecord(queue.settings).delivery_paused;
    if (rawPaused !== undefined && typeof rawPaused !== 'boolean') throw new Error('Queue delivery_paused has an invalid API shape.');
    return {
        schemaVersion: 1,
        source: 'cloudflare-api-readonly',
        capturedAt: new Date().toISOString(),
        accountId: STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId,
        queueId: STAGING_FULFILLMENT_ROLLBACK_TARGET.queueId,
        queueName: STAGING_FULFILLMENT_ROLLBACK_TARGET.queue,
        deliveryPaused: typeof rawPaused === 'boolean' ? rawPaused : 'absent_requires_normalization',
        producerWorkerNames: producerNames,
        consumerWorkerNames: consumerNames,
    };
}

async function readQueueBacklog(id: string): Promise<number> {
    const result = await cloudflareGetWithRetry(id, `${queuePath()}/metrics`);
    if (!result.ok) throw new Error(`Cloudflare Queue metrics read ${id} failed.`);
    const count = asRecord(result.payload.result).backlog_count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error('Queue backlog_count is invalid.');
    return count;
}

async function verifyQueueRuntime(expectedPaused: boolean, id: string): Promise<void> {
    const queue = await readQueueState(`${id}_queue`);
    const backlog = await readQueueBacklog(`${id}_metrics`);
    if (backlog !== 0) throw new Error(`Queue backlog changed during drill: ${backlog}.`);
    if (expectedPaused && queue.deliveryPaused !== true) throw new Error('Queue is not explicitly paused.');
    if (!expectedPaused && queue.deliveryPaused !== false) {
        throw new Error('Queue active state is not explicit in readback; absence is not treated as false.');
    }
}

async function readSchedules(id: string): Promise<string[]> {
    const result = await cloudflareGetWithRetry(id, schedulesPath());
    if (!result.ok) throw new Error(`Cloudflare Cron schedules read ${id} failed.`);
    return asArray(asRecord(result.payload.result).schedules)
        .map(asRecord)
        .map((schedule) => stringValue(schedule.cron))
        .filter(Boolean)
        .sort();
}

async function executeQueueDeliveryWrite(
    phase: 'normalize_queue_active' | 'pause_queue' | 'resume_queue' | 'compensate_pause_queue',
    paused: boolean,
): Promise<boolean> {
    return executeApiWrite(phase, STAGING_FULFILLMENT_ROLLBACK_TARGET.queue, 'PATCH', queuePath(), {
        queue_name: STAGING_FULFILLMENT_ROLLBACK_TARGET.queue,
        settings: { delivery_paused: paused },
    });
}

async function executeScheduleWrite(
    phase: 'disable_cron' | 'restore_cron' | 'compensate_disable_cron',
    schedules: Array<{ cron: string }>,
): Promise<boolean> {
    return executeApiWrite(phase, STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, 'PUT', schedulesPath(), schedules);
}

async function executeApiWrite(
    phase: WritePhase,
    target: string,
    method: 'PATCH' | 'PUT',
    apiPath: string,
    body: unknown,
): Promise<boolean> {
    const receipt = beginWrite(phase, target, 'cloudflare-api');
    try {
        const result = await cloudflareRequestOnce(phase, method, apiPath, false, body, 1, 1);
        receipt.completedAt = new Date().toISOString();
        receipt.state = result.ok
            ? requireReadonlyReconciliation(markExternalWriteConfirmed(receipt.state, true))
            : markExternalWriteConfirmed(receipt.state, false);
        persistWriteReceipts();
        refreshAggregateWriteState();
        return result.ok;
    } catch (error) {
        receipt.completedAt = new Date().toISOString();
        receipt.state = markExternalWriteAmbiguous(receipt.state);
        persistWriteReceipts();
        refreshAggregateWriteState();
        report.errors.push(safeError(error));
        return false;
    }
}

function executeWranglerWrite(phase: 'rollback_previous' | 'restore_current', target: string, args: string[]): CommandCapture {
    const receipt = beginWrite(phase, target, 'wrangler');
    const capture = runWrangler(phase, args, false);
    receipt.completedAt = new Date().toISOString();
    receipt.state = capture.exitCode === 0
        ? requireReadonlyReconciliation(markExternalWriteConfirmed(receipt.state, true))
        : markExternalWriteAmbiguous(receipt.state);
    persistWriteReceipts();
    refreshAggregateWriteState();
    return capture;
}

function beginWrite(phase: WritePhase, target: string, mechanism: 'wrangler' | 'cloudflare-api'): WriteReceipt {
    const receipt: WriteReceipt = {
        phase,
        target,
        mechanism,
        startedAt: new Date().toISOString(),
        state: markExternalWriteAttemptStarted(createExternalWriteReceipt()),
    };
    report.writeReceipts.push(receipt);
    report.externalWriteAttempted = true;
    report.externalWritePerformed = 'unknown';
    persistWriteReceipts();
    return receipt;
}

function confirmWriteByReadback(phase: WritePhase): void {
    const receipt = [...report.writeReceipts].reverse().find((candidate) => candidate.phase === phase);
    if (!receipt) throw new Error(`Missing write receipt for ${phase}.`);
    receipt.state = markExternalWriteConfirmed(receipt.state, true);
    persistWriteReceipts();
    refreshAggregateWriteState();
}

export async function cloudflareGetWithRetry(
    id: string,
    apiPath: string,
    wait: (milliseconds: number) => Promise<void> = delay,
): Promise<ApiResult> {
    return retryCloudflareReadonlyGet(
        (attempt, maxAttempts) => cloudflareRequestOnce(
            id,
            'GET',
            apiPath,
            true,
            undefined,
            attempt,
            maxAttempts,
        ),
        wait,
    );
}

export async function retryCloudflareReadonlyGet<T extends { status: number }>(
    request: (attempt: number, maxAttempts: number) => Promise<T>,
    wait: (milliseconds: number) => Promise<void>,
): Promise<T> {
    const maxAttempts = CLOUDFLARE_GET_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const result = await request(attempt, maxAttempts);
            const retryableStatus = result.status === 429 || result.status >= 500;
            if (!retryableStatus || attempt === maxAttempts) return result;
        } catch (error) {
            const retryableError = error instanceof TypeError
                || (error instanceof Error && error.name === 'AbortError');
            if (!retryableError || attempt === maxAttempts) throw error;
        }
        const retryDelay = CLOUDFLARE_GET_RETRY_DELAYS_MS[attempt - 1];
        if (retryDelay === undefined) {
            throw new Error('Cloudflare read-only GET retry delay is missing.');
        }
        await wait(retryDelay);
    }
    throw new Error('Cloudflare read-only GET retry loop ended without a result.');
}

async function cloudflareRequestOnce(
    id: string,
    method: 'GET' | 'PATCH' | 'PUT',
    apiPath: string,
    readOnly: boolean,
    body?: unknown,
    attempt = 1,
    maxAttempts = 1,
): Promise<ApiResult> {
    const capture: ApiCapture = {
        id,
        readOnly,
        method,
        path: apiPath,
        attempt,
        maxAttempts,
        httpStatus: null,
        success: false,
    };
    report.apiCalls.push(capture);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
            method,
            signal: controller.signal,
            headers: {
                authorization: `Bearer ${cloudflareToken()}`,
                accept: 'application/json',
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const raw = await response.text();
        capture.httpStatus = response.status;
        capture.responseSha256 = sha256(raw);
        const retryableReadStatus = readOnly
            && method === 'GET'
            && (response.status === 429 || response.status >= 500);
        if (retryableReadStatus) {
            if (attempt < maxAttempts) {
                capture.retryScheduled = true;
                capture.retryReason = 'retryable_http_status';
            }
            return { ok: false, status: response.status, payload: {}, rawSha256: sha256(raw) };
        }
        const payload = asRecord(JSON.parse(raw));
        const ok = response.ok && payload.success === true;
        capture.success = ok;
        return { ok, status: response.status, payload, rawSha256: sha256(raw) };
    } catch (error) {
        if (readOnly
            && method === 'GET'
            && attempt < maxAttempts
            && (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError'))) {
            capture.retryScheduled = true;
            capture.retryReason = 'transport_or_timeout';
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

async function verifyActiveVersion(label: string, expectedVersionId: string): Promise<ActiveVerification> {
    let deploymentMatched = false;
    let healthMatched = false;
    let attempts = 0;
    for (attempts = 1; attempts <= 8; attempts += 1) {
        try {
            const status = runWranglerJson(`${label}_status_${attempts}`, [
                'deployments', 'status', '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--json',
            ]);
            const beforeHealth = statusHasExactFullTrafficVersion(status, expectedVersionId);
            healthMatched = validateHealthIdentity(await probeHealth()).length === 0;
            const statusAfterHealth = runWranglerJson(`${label}_status_after_health_${attempts}`, [
                'deployments', 'status', '--name', STAGING_FULFILLMENT_ROLLBACK_TARGET.worker, '--json',
            ]);
            deploymentMatched = beforeHealth && statusHasExactFullTrafficVersion(statusAfterHealth, expectedVersionId);
            if (deploymentMatched && healthMatched) break;
        } catch {
            deploymentMatched = false;
            healthMatched = false;
        }
        await delay(2_000);
    }
    return { expectedVersionId, deploymentMatched, healthMatched, attempts };
}

async function verifyIsolationBeforeRollback(currentVersionId: string): Promise<void> {
    const current = await verifyActiveVersion('isolation_before_rollback', currentVersionId);
    const queue = await readQueueState('isolation_before_rollback_queue');
    const backlog = await readQueueBacklog('isolation_before_rollback_metrics');
    const schedules = await readSchedules('isolation_before_rollback_schedules');
    if (!current.deploymentMatched
        || !current.healthMatched
        || queue.deliveryPaused !== true
        || backlog !== 0
        || !schedulesEqual(schedules, [])) {
        throw new Error('Pre-rollback isolation revalidation failed; rollback is forbidden and restoration must run.');
    }
}

async function verifyCronQueueIsolation(label: string): Promise<void> {
    const queue = await readQueueState(`${label}_queue`);
    const backlog = await readQueueBacklog(`${label}_metrics`);
    const schedules = await readSchedules(`${label}_schedules`);
    if (queue.deliveryPaused !== true
        || backlog !== 0
        || !schedulesEqual(schedules, [])) {
        throw new Error('Cron OFF, Queue paused and zero backlog isolation is not explicitly proven.');
    }
}

function runWranglerJson(id: string, args: string[]): unknown {
    const capture = runWrangler(id, args, true);
    if (capture.exitCode !== 0) throw new Error(`Read-only Wrangler command ${id} failed.`);
    const raw = commandOutput.get(id);
    commandOutput.delete(id);
    if (!raw) throw new Error(`Read-only Wrangler command ${id} returned no output.`);
    return parseMixedWranglerJson(raw);
}

function runWrangler(id: string, args: string[], readOnly: boolean): CommandCapture {
    const childEnv: NodeJS.ProcessEnv = {
        ...minimalWranglerEnvironment(),
        CI: 'true',
        FORCE_COLOR: '0',
        WRANGLER_SEND_METRICS: 'false',
        CLOUDFLARE_ACCOUNT_ID: STAGING_FULFILLMENT_ROLLBACK_TARGET.accountId,
    };
    delete childEnv[STAGING_FULFILLMENT_ROLLBACK_APPROVAL_ENV];
    delete childEnv.CLOUDFLARE_API_TOKEN;
    const scopedArgs = [...args, ...WRANGLER_SCOPE_ARGS];
    const pnpmArgs = ['pnpm', '--config.verify-deps-before-run=false', 'exec', 'wrangler', ...scopedArgs];
    const result = spawnSync(corepackCommand(), pnpmArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: childEnv,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32',
        windowsHide: true,
        timeout: readOnly ? 60_000 : 120_000,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const capture: CommandCapture = {
        id,
        readOnly,
        command: `corepack pnpm --config.verify-deps-before-run=false exec wrangler ${scopedArgs.join(' ')}`,
        exitCode: result.status,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
    };
    report.commands.push(capture);
    if (readOnly && result.status === 0) commandOutput.set(id, stdout.trim());
    return capture;
}

async function probeHealth(): Promise<HealthIdentity> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(`${STAGING_FULFILLMENT_ROLLBACK_TARGET.directUrl}/health`, {
            method: 'GET',
            redirect: 'error',
            signal: controller.signal,
            headers: { accept: 'application/json' },
        });
        const value = asRecord(await response.json());
        return {
            httpStatus: response.status,
            ok: value.ok === true,
            service: stringValue(value.service),
            runtime: stringValue(value.runtime),
            operationMode: stringValue(value.operationMode),
            workerIdentity: stringValue(value.workerIdentity),
        };
    } finally {
        clearTimeout(timeout);
    }
}

function acquireExecutionLock(versions: RollbackVersions, semanticSnapshotSha256: string): void {
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(report.artifacts.executionLock, `${JSON.stringify({
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        accountId: report.target.accountId,
        worker: report.target.worker,
        queue: report.target.queue,
        currentVersionId: versions.currentVersionId,
        previousVersionId: versions.previousVersionId,
        semanticSnapshotSha256,
        recovery: 'Restore current version, hourly Cron and active Queue delivery; verify read-only before removing lock.',
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function releaseExecutionLock(): void {
    if (existsSync(report.artifacts.executionLock)) unlinkSync(report.artifacts.executionLock);
}

function persistWriteReceipts(): void {
    persistJsonAtomic(report.artifacts.writeReceipts, {
        schemaVersion: 1,
        target: report.target,
        receipts: report.writeReceipts,
        manualReconciliationRequired: report.manualReconciliationRequired,
        manualReconciliation: report.manualReconciliationRequired
            ? 'Keep the durable execution lock; review every write receipt and live readback before an explicit, separate lock removal.'
            : null,
        recoveryOrder: [
            'restore_current',
            'restore_cron',
            'resume_queue',
            'if restore is incomplete: compensate_disable_cron',
            'compensate_pause_queue',
            'verify Cron OFF + Queue paused + backlog zero read-only',
        ],
    });
}

function refreshAggregateWriteState(): void {
    const needsReconciliation = report.writeReceipts.some((receipt) => receipt.state.readonlyReconciliationRequired);
    const states = report.writeReceipts.map((receipt) => receipt.state.externalWritePerformed);
    report.externalWritePerformed = needsReconciliation || states.includes('unknown')
        ? 'unknown'
        : states.includes(true) ? true : false;
}

function finalizeReport(): void {
    report.endedAt = new Date().toISOString();
    if (!report.exactApproval) {
        writeFileSync(report.artifacts.approval, 'UNAVAILABLE: exact read-only preflight did not produce an approvable snapshot.\n', 'utf8');
    }
    const manifest = {
        schemaVersion: 3,
        generatedAt: report.endedAt,
        target: report.target,
        mode: report.mode,
        status: report.status,
        scope: {
            allowedReads: ['Wrangler whoami/deployments/versions', 'Cloudflare Queue GET', 'Queue metrics GET', 'Cron schedules GET', 'direct /health'],
            onlyAllowedWritesInOrder: [
                'disable Cron',
                'normalize Queue active',
                'pause Queue',
                'rollback previous',
                'restore current',
                'restore hourly Cron',
                'resume Queue',
                'conditional compensation: disable Cron',
                'conditional compensation: pause Queue',
            ],
            forbidden: ['job endpoints', 'Queue purge/delete/create', 'Queue consumer mutation', 'secrets', 'domains', 'DNS', 'Pages', 'production', 'other Workers or Queues'],
        },
        approval: {
            env: report.approvalEnv,
            matched: report.approvalMatched,
            exactSentence: report.exactApproval ?? null,
            sentenceSha256: report.exactApproval ? sha256(report.exactApproval) : null,
        },
        preflightSnapshots: report.preflights.map((preflight) => ({
            label: preflight.label,
            valid: preflight.valid,
            semanticSnapshotSha256: preflight.snapshotSha256 ?? null,
            currentVersionId: preflight.versions?.currentVersionId ?? null,
            previousVersionId: preflight.versions?.previousVersionId ?? null,
            queueDeliveryPaused: preflight.queue?.deliveryPaused ?? null,
            cronSchedules: preflight.cronSchedules ?? [],
        })),
        restoration: {
            originalCurrentRestored: report.originalCurrentRestored,
            cronRestoredVerified: report.cronRestoredVerified,
            queueResumeVerified: report.queueResumeVerified,
            isolationRetainedOnRestoreFailure: report.isolationRetainedOnRestoreFailure,
            manualReconciliationRequired: report.manualReconciliationRequired,
        },
        commands: report.commands,
        apiCalls: report.apiCalls,
        writeReceiptPath: relative(report.artifacts.writeReceipts),
        durableLockPresent: existsSync(report.artifacts.executionLock),
        noRawProviderOutputStored: true,
        noSecretValuesStored: true,
    };
    const summaryJson = JSON.stringify(report, null, 2);
    const manifestJson = JSON.stringify(manifest, null, 2);
    const summaryMarkdown = renderSummary(report);
    assertNoSecrets([summaryJson, manifestJson, summaryMarkdown, report.exactApproval ?? '']);
    writeFileSync(report.artifacts.summaryJson, `${summaryJson}\n`, 'utf8');
    writeFileSync(report.artifacts.manifest, `${manifestJson}\n`, 'utf8');
    writeFileSync(report.artifacts.summaryMarkdown, summaryMarkdown, 'utf8');
    persistWriteReceipts();
    console.log(`[launch:cloudflare-staging-fulfillment-rollback-drill] Status: ${report.status}`);
    console.log(`[launch:cloudflare-staging-fulfillment-rollback-drill] External write performed: ${String(report.externalWritePerformed)}`);
    console.log(`[launch:cloudflare-staging-fulfillment-rollback-drill] Summary: ${report.artifacts.summaryMarkdown}`);
    if (report.status !== 'READY_FOR_APPROVAL' && report.status !== 'DRILL_EXECUTED_AND_CURRENT_RESTORED') process.exitCode = 1;
}

function renderSummary(value: RunnerReport): string {
    const initial = value.preflights[0];
    return [
        '# Cloudflare Staging Fulfillment Rollback Drill',
        '',
        `- Status: ${value.status}`,
        `- Mode: ${value.mode}`,
        `- Account: ${value.target.accountId}`,
        `- Worker: ${value.target.worker}`,
        `- Queue: ${value.target.queue} (${value.target.queueId})`,
        `- Current version: ${initial?.versions?.currentVersionId ?? 'unproven'}`,
        `- Previous distinct version: ${initial?.versions?.previousVersionId ?? 'unproven'}`,
        `- Semantic snapshot SHA-256: ${initial?.snapshotSha256 ?? 'unavailable'}`,
        `- External write attempted/performed: ${value.externalWriteAttempted}/${String(value.externalWritePerformed)}`,
        `- Current/Cron/Queue restored: ${value.originalCurrentRestored}/${value.cronRestoredVerified}/${value.queueResumeVerified}`,
        `- Fail-closed isolation after incomplete restore: ${value.isolationRetainedOnRestoreFailure}`,
        `- Manual reconciliation required: ${value.manualReconciliationRequired}`,
        '',
        '## Safety Boundary',
        '',
        'Plan mode uses only GET/health and Wrangler read commands. It requires `CLOUDFLARE_API_TOKEN` in process memory because Wrangler does not expose Queue `delivery_paused`; the token is removed from Wrangler children and never logged or persisted.',
        '',
        'Approved execution persists a write-ahead receipt before every change, normalizes Queue delivery active, removes the exact hourly Cron, pauses the Queue, rolls back, and then restores current version, Cron and Queue. If Cron or Queue restoration is not proven, conditional compensation disables Cron and pauses Queue again, then verifies Cron OFF, Queue paused and zero backlog. A durable lock survives process termination and is removed only when the forward drill and all three normal final states are proven; any failed phase keeps it for manual reconciliation.',
        '',
        'Cloudflare may omit default `delivery_paused=false` from GET. Absence is recorded as unknown and never interpreted as false. Every PATCH remains reconciliation-pending until GET returns the explicit intended boolean; if Cloudflare omits it, execution stops fail-closed and keeps the durable lock.',
        '',
        '## Errors',
        '',
        ...(value.errors.length > 0 ? value.errors.map((error) => `- ${error}`) : ['- None.']),
        '',
        'The checklist remains open until an approved run ends `DRILL_EXECUTED_AND_CURRENT_RESTORED`.',
        '',
    ].join('\n');
}

function workerNames(bindings: Array<Record<string, unknown>>): string[] {
    return bindings
        .filter((binding) => binding.type === 'worker')
        .map((binding) => stringValue(binding.script) || stringValue(binding.script_name))
        .filter(Boolean)
        .sort();
}

function schedulesEqual(actual: string[], expected: string[]): boolean {
    return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function statusHasExactFullTrafficVersion(value: unknown, expectedVersionId: string): boolean {
    const versions = asArray(asRecord(value).versions).map(asRecord);
    if (versions.length !== 1) return false;
    const percentage = typeof versions[0].percentage === 'number' ? versions[0].percentage : Number(versions[0].percentage);
    return versions[0].version_id === expectedVersionId && percentage === 100;
}

function isSafeCronWindow(date: Date): boolean {
    const minute = date.getUTCMinutes();
    return minute >= 10 && minute <= 49;
}

function queuePath(): string {
    return `/accounts/${report.target.accountId}/queues/${report.target.queueId}`;
}

function schedulesPath(): string {
    return `/accounts/${report.target.accountId}/workers/scripts/${encodeURIComponent(report.target.worker)}/schedules`;
}

function cloudflareToken(): string {
    return process.env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
}

function minimalWranglerEnvironment(): NodeJS.ProcessEnv {
    const allowed = [
        'APPDATA',
        'COMSPEC',
        'HOME',
        'LOCALAPPDATA',
        'NODE_OPTIONS',
        'PATH',
        'PATHEXT',
        'PNPM_HOME',
        'SYSTEMDRIVE',
        'SYSTEMROOT',
        'TEMP',
        'TMP',
        'USERPROFILE',
        'WINDIR',
    ];
    return Object.fromEntries(allowed
        .map((name) => [name, process.env[name]])
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function persistJsonAtomic(targetPath: string, value: unknown): void {
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flush: true });
    renameSync(temporaryPath, targetPath);
}

function parseMode(args: string[]): boolean {
    if (args.length === 0) return false;
    if (args.length === 1 && args[0] === '--execute-approved') return true;
    throw new Error('Only the optional --execute-approved flag is accepted.');
}

function assertNoSecrets(values: string[]): void {
    const combined = values.join('\n');
    const forbidden = [
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
        /\b(?:sk_live|sk_test|whsec)_[A-Za-z0-9]{16,}\b/u,
        /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/iu,
        /\bpostgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/iu,
        /\bAIza[0-9A-Za-z_-]{30,}\b/u,
    ];
    if (forbidden.some((pattern) => pattern.test(combined))) throw new Error('Refusing to write evidence containing a secret-like value.');
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    return message
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, 'Bearer [redacted]')
        .replace(/(?:sk_live|sk_test|whsec)_[A-Za-z0-9]+/gu, '[redacted]')
        .slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function relative(value: string): string {
    return path.relative(process.cwd(), value).replace(/\\/gu, '/');
}

function corepackCommand(): string {
    return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
