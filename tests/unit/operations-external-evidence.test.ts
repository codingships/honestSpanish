import { describe, expect, it } from 'vitest';
import {
    canSupersedeStaleOperationsExternalCheck,
    recognizeOperationsExternalEvidence,
    type OperationsExternalEvidenceInput,
} from '../../scripts/launch/operations-external-evidence';

const NOW = new Date('2026-07-12T12:00:00.000Z');

describe('operations_external machine evidence recognition', () => {
    it('recognizes only the complete correlated staging evidence set and ignores a newer plan-only smoke pack', () => {
        const input = validInput();
        input.stagingSmokeRuns.unshift(evidence('newer-plan.json', {
            status: 'OK',
            startedAt: '2026-07-12T09:05:21.845Z',
            endedAt: '2026-07-12T09:05:21.855Z',
            closureStatus: 'PLAN_ONLY_READY',
            executeRequested: false,
            approvalMatched: false,
            externalWriteCommandStarted: false,
            checks: [],
        }));

        const result = recognizeOperationsExternalEvidence(input);

        expect(result).toMatchObject({
            status: 'proven',
            verifiedAt: '2026-07-12T08:52:35.162Z',
            missing: [],
        });
        expect(result.evidencePaths).toEqual([
            'executed-runner.json',
            'real-smoke.json',
            'staging-operations.json',
            'resend-readonly.json',
            'billing-lifecycle.json',
            'operations-audit.json',
        ]);
    });

    it('does not fall back to an older successful execution after a newer executed failure', () => {
        const input = validInput();
        input.stagingSmokeRuns.unshift(evidence('newer-failed-execution.json', {
            ...input.stagingSmokeRuns[0].data,
            status: 'FAILED',
            startedAt: '2026-07-12T10:00:00.000Z',
            endedAt: '2026-07-12T10:01:00.000Z',
        }));

        const result = recognizeOperationsExternalEvidence(input);

        expect(result.status).toBe('incomplete');
        expect(result.missing).toContain('fresh exact executed staging smoke runner');
        expect(result.missing).toContain('correlated complete real environment smoke with cleanup');
    });

    it('fails closed if checkout was not blocked or smoke cleanup was incomplete', () => {
        const checkoutOpen = validInput();
        checkoutOpen.realEnvironmentSmokes[0].data.checkout = {
            ...checkoutOpen.realEnvironmentSmokes[0].data.checkout,
            status: 200,
        };
        expect(recognizeOperationsExternalEvidence(checkoutOpen).status).toBe('incomplete');

        const cleanupFailed = validInput();
        cleanupFailed.realEnvironmentSmokes[0].data.cleanup = {
            ...cleanupFailed.realEnvironmentSmokes[0].data.cleanup,
            ok: false,
        };
        expect(recognizeOperationsExternalEvidence(cleanupFailed).status).toBe('incomplete');
    });

    it('fails closed for production-linked or incomplete billing evidence', () => {
        const input = validInput();
        input.stagingBillingRuns[0].data.scope = {
            ...input.stagingBillingRuns[0].data.scope,
            productionExcluded: false,
        };

        const result = recognizeOperationsExternalEvidence(input);

        expect(result.status).toBe('incomplete');
        expect(result.missing).toContain('fresh complete Stripe-test staging billing lifecycle');
    });

    it('supersedes only an older pending/blocked row and never a newer human decision', () => {
        const recognition = recognizeOperationsExternalEvidence(validInput());

        expect(canSupersedeStaleOperationsExternalCheck({
            status: 'blocked',
            owner: 'Alin/Codex',
            verifiedAt: '2026-07-10T09:20:47.802Z',
            environment: 'staging',
        }, recognition)).toBe(true);
        expect(canSupersedeStaleOperationsExternalCheck({
            status: 'blocked',
            owner: 'Alin',
            verifiedAt: '2026-07-12T11:00:00.000Z',
            environment: 'staging',
        }, recognition)).toBe(false);
        expect(canSupersedeStaleOperationsExternalCheck({
            status: 'accepted_risk',
            owner: 'Alin',
            verifiedAt: '2026-07-10T09:20:47.802Z',
            environment: 'staging',
        }, recognition)).toBe(false);
        expect(canSupersedeStaleOperationsExternalCheck({
            status: 'blocked',
            owner: '',
            verifiedAt: '2026-07-10T09:20:47.802Z',
            environment: 'staging',
        }, recognition)).toBe(false);
    });
});

function validInput(): OperationsExternalEvidenceInput {
    return {
        now: NOW,
        stagingSmokeRuns: [evidence('executed-runner.json', runnerSummary())],
        realEnvironmentSmokes: [evidence('real-smoke.json', realSmokeSummary())],
        stagingOperationsRuns: [evidence('staging-operations.json', stagingOperationsSummary())],
        resendReadonlyRuns: [evidence('resend-readonly.json', resendReadonlySummary())],
        stagingBillingRuns: [evidence('billing-lifecycle.json', stagingBillingSummary())],
        operationsAuditRuns: [evidence('operations-audit.json', operationsAuditSummary())],
    };
}

function runnerSummary() {
    return {
        status: 'OK',
        startedAt: '2026-07-12T08:49:24.788Z',
        endedAt: '2026-07-12T08:50:41.286Z',
        closureStatus: 'EXECUTED_AND_NEEDS_REVIEW',
        baseUrl: 'https://staging.espanolhonesto.com',
        executeRequested: true,
        approvalMatched: true,
        externalWriteCommandStarted: true,
        checks: [
            check('staging_smoke_env_source_shape', [
                'stripeSecretMode=test',
                'exactRoleAllowlist=true',
                'emailDailyLimitAtOrBelowResendFreeCap=true',
                'emailMonthlyLimitAtOrBelowResendFreeCap=true',
            ]),
            check('exact_approval_gate', [
                'SMOKE_BASE_URL=https://staging.espanolhonesto.com',
                'CHECKOUT_ENABLED_OVERRIDE=false-throughout',
            ]),
            check('cloudflare_staging_account_worker_preflight', [
                'account=d1a22bcf6477ff2ff31d2bfb83084e44',
                'worker=espanolhonesto-staging',
                'accountMatched=true',
                'deploymentIdentified=true',
                'stagingConfigExact=true',
            ]),
            check('all_preconditions_before_writes', [
                'exitCode=0',
                'CHECKOUT_ENABLED_OVERRIDE=false',
                'externalWriteCommandStarted=false',
            ]),
            check('staging_smoke_command', [
                'exitCode=0',
                'cloudflareWritesStarted=false',
                'writeChildHardTimeout=false',
            ]),
            check('generated_artifact_secret_and_scope_posture'),
        ],
    };
}

function realSmokeSummary() {
    return {
        ok: true,
        failedSections: [],
        executionError: null,
        timestamp: '2026-07-12T08:49:35.568Z',
        remoteSchema: { profilesPrivateAvailable: true, profilesStillExposeLegacyPrivateColumns: false },
        notes: { attempted: true, ok: true, status: 200 },
        drive: {
            attempted: true,
            ok: true,
            publicLinkPermissionBeforeLink: true,
            linkStatus: 200,
            publicLinkPermissionPreserved: true,
            explicitGooglePermissionGranted: true,
        },
        checkout: {
            ok: true,
            verificationMode: 'completed-checkout-readonly',
            status: 403,
            completedCheckoutVerified: true,
            checkoutIntentRecorded: true,
            cleanupStatus: 'completed-checkout-evidence-preserved',
        },
        webhook: {
            ok: true,
            verificationMode: 'real-checkout-readonly',
            checkoutIntentCompleted: true,
            subscriptionsCreated: 1,
            paymentsCreated: 1,
            crmOpportunityConverted: true,
        },
        billingLifecycle: {
            ok: true,
            verificationMode: 'canonical-lifecycle-evidence',
            canonicalEvidenceVerified: true,
            processedWebhookEventsSucceeded: true,
            renewalPaymentFullyRefunded: true,
            initialPaymentPreserved: true,
            stripeSubscriptionStatus: 'canceled',
            packagePriceMatched: true,
            paymentStatus: 'refunded',
        },
        schedulingLifecycle: {
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
        },
        adminJobs: {
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
        },
        cleanup: {
            ok: true,
            completedCheckoutEvidencePreserved: true,
            profileStateRestored: true,
            reusableStudentPreserved: true,
            temporaryTeacherAvailabilityCreated: true,
            temporaryTeacherAvailabilityDeleted: true,
        },
    };
}

function stagingOperationsSummary() {
    return {
        status: 'OK',
        startedAt: '2026-07-11T23:20:32.764Z',
        endedAt: '2026-07-11T23:20:52.264Z',
        targetWorkerUrl: 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev',
        includedWrangler: true,
        checks: [
            check('worker_health', [
                'url=https://espanol-honesto-fulfillment-staging.alindev95.workers.dev/health',
                'status=200',
                'service=fulfillment-worker',
                'runtime=cloudflare-workers',
            ]),
            check('internal_route_auth', ['status=401']),
            check('worker_cron_config'),
            check('wrangler_whoami'),
            check('wrangler_deployments_status'),
            check('wrangler_version_view', ['exitCode=0']),
            check('wrangler_deployments_list'),
            check('wrangler_secret_list', ['exitCode=0']),
        ],
    };
}

function resendReadonlySummary() {
    return {
        status: 'OK',
        startedAt: '2026-07-10T10:36:16.890Z',
        endedAt: '2026-07-10T10:36:17.533Z',
        checks: [check('domains_list'), check('logs_list'), check('emails_list')],
    };
}

function stagingBillingSummary() {
    return {
        status: 'OK',
        mode: 'lifecycle-resume',
        startedAt: '2026-07-12T08:15:09.474Z',
        endedAt: '2026-07-12T08:15:32.604Z',
        scope: {
            supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
            stripeAccountId: 'acct_1TruqOC22M3erP0j',
            stripeMode: 'test',
            productionExcluded: true,
        },
        steps: [
            'upcoming_notice_configuration_gate',
            'environment_guard',
            'readonly_preflight',
            'checkpoint_resume',
            'partial_refund',
            'full_refund',
            'final_state_revalidation',
        ].map((name) => ({ name, status: 'ok' })),
        canonicalEvidence: {
            status: 'complete',
            strategy: 'second_period_recovery',
            stripeAccountId: 'acct_1TruqOC22M3erP0j',
            supabaseProjectRef: 'mzjyvmlxfpzdfdjzxxyj',
            finalState: {
                stripeSubscriptionStatus: 'canceled',
                localSubscriptionStatus: 'cancelled',
                recoveredPaymentStatus: 'refunded',
                recoveredChargeFullyRefunded: true,
                initialPaymentPreserved: true,
                warmupPaymentPreserved: true,
                transitionNoticePreserved: true,
                processedWebhookEvents: 'succeeded',
            },
        },
    };
}

function operationsAuditSummary() {
    return {
        status: 'OK',
        startedAt: '2026-07-12T08:52:35.157Z',
        endedAt: '2026-07-12T08:52:35.162Z',
        findings: [
            'Cloudflare fulfillment Worker',
            'fulfillment job recovery',
            'observability and alert policy',
            'Supabase Free backup/export runbook',
            'operations runbook',
        ].map((area) => ({ area, status: 'ok' as const })),
    };
}

function check(name: string, details: string[] = []) {
    return { name, status: 'ok' as const, details };
}

function evidence<T>(file: string, data: T) {
    return { file, data };
}
