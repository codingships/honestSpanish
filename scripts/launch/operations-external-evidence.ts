import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface Check {
    status?: CheckStatus;
    name?: string;
    details?: string[];
}

interface TimedSummary {
    status?: string;
    startedAt?: string;
    endedAt?: string;
}

interface StagingSmokeRunnerSummary extends TimedSummary {
    closureStatus?: string;
    baseUrl?: string;
    executeRequested?: boolean;
    approvalMatched?: boolean;
    externalWriteCommandStarted?: boolean;
    checks?: Check[];
}

interface RealEnvironmentSmokeSummary {
    ok?: boolean;
    failedSections?: unknown[];
    executionError?: unknown;
    timestamp?: string;
    remoteSchema?: Record<string, unknown>;
    notes?: Record<string, unknown>;
    drive?: Record<string, unknown>;
    checkout?: Record<string, unknown>;
    webhook?: Record<string, unknown>;
    billingLifecycle?: Record<string, unknown>;
    schedulingLifecycle?: Record<string, unknown>;
    adminJobs?: Record<string, unknown>;
    cleanup?: Record<string, unknown>;
}

interface StagingOperationsSummary extends TimedSummary {
    targetWorkerUrl?: string;
    includedWrangler?: boolean;
    checks?: Check[];
}

interface ResendReadonlySummary extends TimedSummary {
    checks?: Check[];
}

interface StagingBillingSummary extends TimedSummary {
    mode?: string;
    scope?: Record<string, unknown>;
    steps?: Array<Record<string, unknown>>;
    canonicalEvidence?: Record<string, unknown>;
}

interface OperationsAuditSummary extends TimedSummary {
    findings?: Array<{
        status?: CheckStatus;
        area?: string;
    }>;
}

interface EvidenceFile<T> {
    file: string;
    data: T;
}

export interface OperationsExternalRecognition {
    status: 'proven' | 'incomplete';
    verifiedAt: string | null;
    evidencePaths: string[];
    missing: string[];
}

export interface OperationsExternalEvidenceInput {
    stagingSmokeRuns: Array<EvidenceFile<StagingSmokeRunnerSummary>>;
    realEnvironmentSmokes: Array<EvidenceFile<RealEnvironmentSmokeSummary>>;
    stagingOperationsRuns: Array<EvidenceFile<StagingOperationsSummary>>;
    resendReadonlyRuns: Array<EvidenceFile<ResendReadonlySummary>>;
    stagingBillingRuns: Array<EvidenceFile<StagingBillingSummary>>;
    operationsAuditRuns: Array<EvidenceFile<OperationsAuditSummary>>;
    now: Date;
}

export interface OperationsExternalManualCheck {
    status?: string;
    owner?: string;
    verifiedAt?: string;
    environment?: string;
}

const STAGING_WEB_URL = 'https://staging.espanolhonesto.com';
const STAGING_FULFILLMENT_URL = 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev';
const STAGING_SUPABASE_PROJECT = 'mzjyvmlxfpzdfdjzxxyj';
const STAGING_STRIPE_ACCOUNT = 'acct_1TruqOC22M3erP0j';
const CLOUDFLARE_ACCOUNT = 'd1a22bcf6477ff2ff31d2bfb83084e44';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const RUNNER_CHECKS = [
    'staging_smoke_env_source_shape',
    'exact_approval_gate',
    'cloudflare_staging_account_worker_preflight',
    'all_preconditions_before_writes',
    'staging_smoke_command',
    'generated_artifact_secret_and_scope_posture',
];

const OPERATIONS_CHECKS = [
    'worker_health',
    'internal_route_auth',
    'worker_cron_config',
    'wrangler_whoami',
    'wrangler_deployments_status',
    'wrangler_version_view',
    'wrangler_deployments_list',
    'wrangler_secret_list',
];

const RESEND_CHECKS = ['domains_list', 'logs_list', 'emails_list'];
const BILLING_STEPS = [
    'upcoming_notice_configuration_gate',
    'environment_guard',
    'readonly_preflight',
    'checkpoint_resume',
    'partial_refund',
    'full_refund',
    'final_state_revalidation',
];
const OPERATIONS_AUDIT_AREAS = [
    'Cloudflare fulfillment Worker',
    'fulfillment job recovery',
    'observability and alert policy',
    'Supabase Free backup/export runbook',
    'operations runbook',
];

export function readOperationsExternalEvidence(
    outputsRoot: string,
    now = new Date(),
): OperationsExternalRecognition {
    return recognizeOperationsExternalEvidence({
        stagingSmokeRuns: readCandidates<StagingSmokeRunnerSummary>(outputsRoot, 'launch-staging-smoke-rehearsal-runner'),
        realEnvironmentSmokes: readCandidates<RealEnvironmentSmokeSummary>(outputsRoot, 'real-env-smoke'),
        stagingOperationsRuns: readCandidates<StagingOperationsSummary>(outputsRoot, 'launch-staging-operations-preflight'),
        resendReadonlyRuns: readCandidates<ResendReadonlySummary>(outputsRoot, 'resend-readonly-evidence'),
        stagingBillingRuns: readCandidates<StagingBillingSummary>(outputsRoot, 'launch-staging-billing-lifecycle'),
        operationsAuditRuns: readCandidates<OperationsAuditSummary>(outputsRoot, 'launch-operations'),
        now,
    });
}

export function recognizeOperationsExternalEvidence(
    input: OperationsExternalEvidenceInput,
): OperationsExternalRecognition {
    const missing: string[] = [];
    const latestExecutedRunner = input.stagingSmokeRuns.find((candidate) => candidate.data.executeRequested === true) ?? null;
    const runner = latestExecutedRunner && validRunner(latestExecutedRunner.data, input.now)
        ? latestExecutedRunner
        : null;

    if (!runner) missing.push('fresh exact executed staging smoke runner');

    const realSmoke = runner
        ? input.realEnvironmentSmokes.find((candidate) => validRealSmoke(candidate.data, runner.data)) ?? null
        : null;
    if (!realSmoke) missing.push('correlated complete real environment smoke with cleanup');

    const latestOperations = input.stagingOperationsRuns[0] ?? null;
    const operations = latestOperations && validStagingOperations(latestOperations.data, input.now)
        ? latestOperations
        : null;
    if (!operations) missing.push('fresh exact staging fulfillment operations preflight');

    const latestResend = input.resendReadonlyRuns[0] ?? null;
    const resend = latestResend && validResendReadonly(latestResend.data, input.now)
        ? latestResend
        : null;
    if (!resend) missing.push('fresh Resend domain/log/email visibility');

    const latestBilling = input.stagingBillingRuns[0] ?? null;
    const billing = latestBilling && validStagingBilling(latestBilling.data, input.now)
        ? latestBilling
        : null;
    if (!billing) missing.push('fresh complete Stripe-test staging billing lifecycle');

    const latestOperationsAudit = input.operationsAuditRuns[0] ?? null;
    const operationsAudit = latestOperationsAudit && validOperationsAudit(latestOperationsAudit.data, input.now)
        ? latestOperationsAudit
        : null;
    if (!operationsAudit) missing.push('fresh operations/observability/backup runbook audit');

    const evidence: Array<EvidenceFile<unknown>> = [];
    for (const candidate of [runner, realSmoke, operations, resend, billing, operationsAudit]) {
        if (candidate) evidence.push(candidate);
    }
    const evidencePaths = evidence.map((candidate) => candidate.file);
    const verifiedAt = evidence.length > 0
        ? latestIso(evidence.map((candidate) => evidenceTimestamp(candidate.data)))
        : null;

    return {
        status: missing.length === 0 ? 'proven' : 'incomplete',
        verifiedAt,
        evidencePaths,
        missing,
    };
}

export function canSupersedeStaleOperationsExternalCheck(
    check: OperationsExternalManualCheck,
    recognition: OperationsExternalRecognition,
): boolean {
    if (recognition.status !== 'proven' || !recognition.verifiedAt) return false;
    if (check.status !== 'pending' && check.status !== 'blocked') return false;
    if (!check.owner?.trim() || !check.environment?.trim() || !check.verifiedAt) return false;

    const manualTimestamp = Date.parse(check.verifiedAt);
    const machineTimestamp = Date.parse(recognition.verifiedAt);
    return Number.isFinite(manualTimestamp)
        && Number.isFinite(machineTimestamp)
        && manualTimestamp < machineTimestamp;
}

function validRunner(summary: StagingSmokeRunnerSummary, now: Date): boolean {
    if (
        summary.status !== 'OK'
        || summary.closureStatus !== 'EXECUTED_AND_NEEDS_REVIEW'
        || summary.baseUrl !== STAGING_WEB_URL
        || summary.executeRequested !== true
        || summary.approvalMatched !== true
        || summary.externalWriteCommandStarted !== true
        || !isFresh(summary.endedAt, now)
        || !hasExactOkChecks(summary.checks, RUNNER_CHECKS)
    ) return false;

    return checkHasDetails(summary.checks, 'staging_smoke_env_source_shape', [
        'stripeSecretMode=test',
        'exactRoleAllowlist=true',
        'emailDailyLimitAtOrBelowResendFreeCap=true',
        'emailMonthlyLimitAtOrBelowResendFreeCap=true',
    ]) && checkHasDetails(summary.checks, 'exact_approval_gate', [
        `SMOKE_BASE_URL=${STAGING_WEB_URL}`,
        'CHECKOUT_ENABLED_OVERRIDE=false-throughout',
    ]) && checkHasDetails(summary.checks, 'cloudflare_staging_account_worker_preflight', [
        `account=${CLOUDFLARE_ACCOUNT}`,
        'worker=espanolhonesto-staging',
        'accountMatched=true',
        'deploymentIdentified=true',
        'stagingConfigExact=true',
    ]) && checkHasDetails(summary.checks, 'all_preconditions_before_writes', [
        'exitCode=0',
        'CHECKOUT_ENABLED_OVERRIDE=false',
        'externalWriteCommandStarted=false',
    ]) && checkHasDetails(summary.checks, 'staging_smoke_command', [
        'exitCode=0',
        'cloudflareWritesStarted=false',
        'writeChildHardTimeout=false',
    ]);
}

function validRealSmoke(summary: RealEnvironmentSmokeSummary, runner: StagingSmokeRunnerSummary): boolean {
    if (!timestampWithin(summary.timestamp, runner.startedAt, runner.endedAt)) return false;
    if (summary.ok !== true || summary.executionError !== null || (summary.failedSections?.length ?? 1) !== 0) return false;

    return matches(summary.remoteSchema, {
        profilesPrivateAvailable: true,
        profilesStillExposeLegacyPrivateColumns: false,
    }) && matches(summary.notes, { attempted: true, ok: true, status: 200 })
        && matches(summary.drive, {
            attempted: true,
            ok: true,
            publicLinkPermissionBeforeLink: true,
            linkStatus: 200,
            publicLinkPermissionPreserved: true,
            explicitGooglePermissionGranted: true,
        })
        && matches(summary.checkout, {
            ok: true,
            verificationMode: 'completed-checkout-readonly',
            status: 403,
            completedCheckoutVerified: true,
            checkoutIntentRecorded: true,
            cleanupStatus: 'completed-checkout-evidence-preserved',
        })
        && matches(summary.webhook, {
            ok: true,
            verificationMode: 'real-checkout-readonly',
            checkoutIntentCompleted: true,
            subscriptionsCreated: 1,
            paymentsCreated: 1,
            crmOpportunityConverted: true,
        })
        && matches(summary.billingLifecycle, {
            ok: true,
            verificationMode: 'canonical-lifecycle-evidence',
            canonicalEvidenceVerified: true,
            processedWebhookEventsSucceeded: true,
            renewalPaymentFullyRefunded: true,
            initialPaymentPreserved: true,
            stripeSubscriptionStatus: 'canceled',
            packagePriceMatched: true,
            paymentStatus: 'refunded',
        })
        && matches(summary.schedulingLifecycle, {
            attempted: true,
            ok: true,
            initialScheduleStatus: 201,
            initialConfirmationJobStatus: 'succeeded',
            conflictStatus: 409,
            cancelStatus: 200,
            cancellationJobStatus: 'succeeded',
            eventMissingAfterCancel: true,
            completeStatus: 200,
            completedSessionStatus: 'completed',
            noShowStatus: 200,
            noShowSessionStatus: 'no_show',
            reminderUnauthorizedStatus: 401,
            reminderAuthorizedStatus: 200,
            reminderFailedCount: 0,
            reminderMarkedSent: true,
            teacherDashboardStatus: 200,
            teacherCalendarStatus: 200,
            adminCalendarStatus: 200,
            cleanupCancelStatus: 200,
            cleanupStatus: 'deleted_sessions_subscription_and_google_artifacts',
        })
        && matches(summary.adminJobs, {
            attempted: true,
            ok: true,
            adminJobsPageStatus: 200,
            failedListStatus: 200,
            failedListContainsJob: true,
            retryStatus: 200,
            retriedStatus: 'pending',
            retryAuditLogged: true,
            pendingListStatus: 200,
            pendingListContainsJob: true,
            cancelStatus: 200,
            cancelledStatus: 'cancelled',
            cancelAuditLogged: true,
            cleanupStatus: 'deleted_job_and_audit_rows',
        })
        && matches(summary.cleanup, {
            ok: true,
            completedCheckoutEvidencePreserved: true,
            profileStateRestored: true,
            reusableStudentPreserved: true,
            temporaryTeacherAvailabilityCreated: true,
            temporaryTeacherAvailabilityDeleted: true,
        });
}

function validStagingOperations(summary: StagingOperationsSummary, now: Date): boolean {
    return summary.status === 'OK'
        && summary.targetWorkerUrl === STAGING_FULFILLMENT_URL
        && summary.includedWrangler === true
        && isFresh(summary.endedAt, now)
        && hasExactOkChecks(summary.checks, OPERATIONS_CHECKS)
        && checkHasDetails(summary.checks, 'worker_health', [
            `url=${STAGING_FULFILLMENT_URL}/health`,
            'status=200',
            'service=fulfillment-worker',
            'runtime=cloudflare-workers',
        ])
        && checkHasDetails(summary.checks, 'internal_route_auth', ['status=401'])
        && checkHasDetails(summary.checks, 'wrangler_version_view', ['exitCode=0'])
        && checkHasDetails(summary.checks, 'wrangler_secret_list', ['exitCode=0']);
}

function validResendReadonly(summary: ResendReadonlySummary, now: Date): boolean {
    return summary.status === 'OK'
        && isFresh(summary.endedAt, now)
        && hasExactOkChecks(summary.checks, RESEND_CHECKS);
}

function validStagingBilling(summary: StagingBillingSummary, now: Date): boolean {
    const canonical = summary.canonicalEvidence;
    const finalState = isRecord(canonical?.finalState) ? canonical.finalState : null;
    const stepNames = new Set((summary.steps ?? [])
        .filter((step) => step.status === 'ok')
        .map((step) => String(step.name ?? '')));

    return summary.status === 'OK'
        && summary.mode === 'lifecycle-resume'
        && isFresh(summary.endedAt, now)
        && matches(summary.scope, {
            supabaseProjectRef: STAGING_SUPABASE_PROJECT,
            stripeAccountId: STAGING_STRIPE_ACCOUNT,
            stripeMode: 'test',
            productionExcluded: true,
        })
        && BILLING_STEPS.every((name) => stepNames.has(name))
        && matches(canonical, {
            status: 'complete',
            strategy: 'second_period_recovery',
            stripeAccountId: STAGING_STRIPE_ACCOUNT,
            supabaseProjectRef: STAGING_SUPABASE_PROJECT,
        })
        && matches(finalState, {
            stripeSubscriptionStatus: 'canceled',
            localSubscriptionStatus: 'cancelled',
            recoveredPaymentStatus: 'refunded',
            recoveredChargeFullyRefunded: true,
            initialPaymentPreserved: true,
            warmupPaymentPreserved: true,
            transitionNoticePreserved: true,
            processedWebhookEvents: 'succeeded',
        });
}

function validOperationsAudit(summary: OperationsAuditSummary, now: Date): boolean {
    const okAreas = new Set((summary.findings ?? [])
        .filter((finding) => finding.status === 'ok')
        .map((finding) => finding.area));
    return summary.status === 'OK'
        && isFresh(summary.endedAt, now)
        && OPERATIONS_AUDIT_AREAS.every((area) => okAreas.has(area));
}

function readCandidates<T>(outputsRoot: string, folderName: string): Array<EvidenceFile<T>> {
    const root = path.join(outputsRoot, folderName);
    if (!existsSync(root)) return [];

    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, 'summary.json'))
        .filter((file) => existsSync(file))
        .sort((a, b) => path.dirname(b).localeCompare(path.dirname(a)))
        .flatMap((file) => {
            try {
                return [{ file, data: JSON.parse(readFileSync(file, 'utf8')) as T }];
            } catch {
                return [];
            }
        });
}

function hasExactOkChecks(checks: Check[] | undefined, requiredNames: string[]): boolean {
    const okNames = new Set((checks ?? [])
        .filter((check) => check.status === 'ok')
        .map((check) => check.name));
    return requiredNames.every((name) => okNames.has(name));
}

function checkHasDetails(checks: Check[] | undefined, name: string, requiredDetails: string[]): boolean {
    const details = new Set((checks ?? []).find((check) => check.name === name && check.status === 'ok')?.details ?? []);
    return requiredDetails.every((detail) => details.has(detail));
}

function matches(value: unknown, expected: Record<string, unknown>): boolean {
    if (!isRecord(value)) return false;
    return Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFresh(value: unknown, now: Date): boolean {
    if (typeof value !== 'string') return false;
    const timestamp = Date.parse(value);
    const nowTime = now.getTime();
    return Number.isFinite(timestamp) && timestamp <= nowTime && nowTime - timestamp <= MAX_AGE_MS;
}

function timestampWithin(value: unknown, start: unknown, end: unknown): boolean {
    if (typeof value !== 'string' || typeof start !== 'string' || typeof end !== 'string') return false;
    const timestamp = Date.parse(value);
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    return [timestamp, startTime, endTime].every(Number.isFinite)
        && timestamp >= startTime
        && timestamp <= endTime;
}

function evidenceTimestamp(value: unknown): string | null {
    if (!isRecord(value)) return null;
    for (const field of ['endedAt', 'timestamp']) {
        if (typeof value[field] === 'string' && Number.isFinite(Date.parse(value[field] as string))) {
            return value[field] as string;
        }
    }
    return null;
}

function latestIso(values: Array<string | null>): string | null {
    const timestamps = values
        .filter((value): value is string => Boolean(value))
        .map((value) => ({ value, timestamp: Date.parse(value) }))
        .filter(({ timestamp }) => Number.isFinite(timestamp))
        .sort((a, b) => b.timestamp - a.timestamp);
    return timestamps[0]?.value ?? null;
}
