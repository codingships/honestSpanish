import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    assertInitialPaymentPreserved,
    assertCheckpointClockWindow,
    assertExclusiveLifecycleWebhookDestination,
    assertLifecyclePhaseTransition,
    assertLifecyclePreflight,
    assertResumePhaseState,
    buildRefundPlan,
    FAILING_PAYMENT_METHOD,
    INVOICE_UPCOMING_NOTICE_DAYS,
    invoiceUpcomingBoundary,
    isLifecyclePhase,
    lifecycleConfirmationForSession,
    RECOVERY_PAYMENT_METHOD,
    sanitizeLifecycleText,
    STAGING_SUPABASE_PROJECT_REF,
    STRIPE_API_VERSION,
    STAGING_STRIPE_WEBHOOK_ENDPOINT_URL,
    validateCanonicalLifecycleReport,
    validateLifecycleEnvironment,
    type LifecyclePreflightSnapshot,
} from '../../scripts/launch/staging-billing-lifecycle-safety';

const runnerSource = readFileSync('scripts/launch/staging-billing-lifecycle-runner.ts', 'utf8');
const safetySource = readFileSync('scripts/launch/staging-billing-lifecycle-safety.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

const sessionId = 'cs_test_safeLifecycleSession';
const userId = '0f03f0bf-a300-4adc-9c91-147a3157821b';

function validEnvironment() {
    return {
        stripeSecretKey: 'sk_test_example',
        stripePublishableKey: 'pk_test_example',
        stripeExpectedAccountId: 'acct_staging',
        publicAppEnvironment: 'staging',
        supabaseUrl: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
        supabaseExpectedProjectRef: STAGING_SUPABASE_PROJECT_REF,
        supabaseServiceRoleKey: 'test-service-role-shape',
        checkoutSessionId: sessionId,
        confirmation: lifecycleConfirmationForSession(sessionId),
    };
}

function validPreflight(): LifecyclePreflightSnapshot {
    return {
        expectedStripeAccountId: 'acct_staging',
        actualStripeAccountId: 'acct_staging',
        checkoutSessionId: sessionId,
        checkoutSessionLivemode: false,
        checkoutSessionMode: 'subscription',
        checkoutSessionStatus: 'complete',
        checkoutPaymentStatus: 'paid',
        checkoutCurrency: 'eur',
        checkoutAmountTotal: 10_000,
        checkoutCustomerId: 'cus_safe',
        checkoutSubscriptionId: 'sub_safe',
        checkoutInvoiceId: 'in_initial',
        checkoutUserId: userId,
        checkoutClientReferenceId: userId,
        checkoutPackagePriceId: 'ba82d91e-a46d-4e19-bc15-e1b9191f1cee',
        customerId: 'cus_safe',
        customerLivemode: false,
        customerDeleted: false,
        customerMetadataUserId: userId,
        customerMetadataSource: 'staging-checkout-bootstrap',
        customerTestClockId: 'clock_safe',
        subscriptionId: 'sub_safe',
        subscriptionLivemode: false,
        subscriptionStatus: 'active',
        subscriptionCustomerId: 'cus_safe',
        subscriptionMetadataUserId: userId,
        subscriptionTestClockId: 'clock_safe',
        subscriptionCollectionMethod: 'charge_automatically',
        subscriptionCancelAtPeriodEnd: false,
        subscriptionPeriodEnd: 2_100_000_000,
        testClockId: 'clock_safe',
        testClockLivemode: false,
        testClockStatus: 'ready',
        testClockFrozenTime: 2_090_000_000,
        testClockDeletesAfter: 2_110_000_000,
        nowUnix: 2_090_000_000,
        testClockCustomerIds: ['cus_safe'],
        customerSubscriptionIds: ['sub_safe'],
        customerSubscriptionScheduleIds: [],
        checkoutIntentStatus: 'completed',
        checkoutIntentSessionId: sessionId,
        checkoutIntentCustomerId: 'cus_safe',
        checkoutIntentStudentId: userId,
        checkoutIntentPackagePriceId: 'ba82d91e-a46d-4e19-bc15-e1b9191f1cee',
        localProfileCustomerId: 'cus_safe',
        localSubscriptionId: 'b00de8df-2b96-4554-bda5-d9fd71472ec6',
        localSubscriptionStatus: 'active',
        localSubscriptionStudentId: userId,
        localSubscriptionStripeId: 'sub_safe',
        localSubscriptionInvoiceId: 'in_initial',
        localInitialPaymentStatus: 'succeeded',
        localInitialPaymentStudentId: userId,
        localInitialPaymentSubscriptionId: 'b00de8df-2b96-4554-bda5-d9fd71472ec6',
        localInitialPaymentInvoiceId: 'in_initial',
        localInitialPaymentIntentId: 'pi_initial',
        localInitialPaymentAmount: 10_000,
        localInitialPaymentCurrency: 'eur',
        localInitialPaymentAmountRefunded: 0,
        initialStripeInvoiceStatus: 'paid',
        initialStripeInvoiceCustomerId: 'cus_safe',
        initialStripeInvoiceSubscriptionId: 'sub_safe',
        initialStripeInvoiceAmountPaid: 10_000,
        initialStripeInvoiceCurrency: 'eur',
        initialStripeInvoicePeriodEnd: 2_100_000_000,
        initialInvoicePaymentStatus: 'paid',
        initialInvoicePaymentLivemode: false,
        initialInvoicePaymentInvoiceId: 'in_initial',
        initialInvoicePaymentAmountPaid: 10_000,
        initialInvoicePaymentAmountRequested: 10_000,
        initialInvoicePaymentCurrency: 'eur',
        initialInvoicePaymentIntentId: 'pi_initial',
        initialStripePaymentIntentId: 'pi_initial',
        initialStripePaymentIntentLivemode: false,
        initialStripePaymentIntentStatus: 'succeeded',
        initialStripePaymentIntentCustomerId: 'cus_safe',
        initialStripePaymentIntentAmount: 10_000,
        initialStripePaymentIntentAmountReceived: 10_000,
        initialStripePaymentIntentCurrency: 'eur',
        initialStripePaymentIntentLatestChargeId: 'ch_initial',
        initialStripeChargeId: 'ch_initial',
        initialStripeChargeLivemode: false,
        initialStripeChargeStatus: 'succeeded',
        initialStripeChargePaid: true,
        initialStripeChargeCustomerId: 'cus_safe',
        initialStripeChargePaymentIntentId: 'pi_initial',
        initialStripeChargeAmount: 10_000,
        initialStripeChargeCurrency: 'eur',
        initialStripeChargeRefunded: false,
        initialStripeChargeAmountRefunded: 0,
    };
}

function canonicalLifecycleReport() {
    const canonicalEvidence = {
        schemaVersion: 1,
        status: 'complete',
        stripeAccountId: 'acct_staging',
        supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
        checkoutSessionId: sessionId,
        customerId: 'cus_safe',
        subscriptionId: 'sub_safe',
        initialInvoiceId: 'in_initial',
        initialPaymentIntentId: 'pi_initial',
        renewalInvoiceId: 'in_renewal',
        recoveredPaymentIntentId: 'pi_recovered',
        partialRefundId: 're_partial',
        finalRefundId: 're_final',
        webhookEventIds: {
            checkoutCompleted: 'evt_checkout',
            initialInvoicePaid: 'evt_initial_paid',
            upcoming: 'evt_upcoming',
            renewalFailed: 'evt_failed',
            renewalPaid: 'evt_recovered',
            cancellation: 'evt_cancelled',
            partialRefund: 'evt_partial_refund',
            finalRefund: 'evt_final_refund',
        },
        finalState: {
            stripeSubscriptionStatus: 'canceled',
            localSubscriptionStatus: 'cancelled',
            recoveredPaymentStatus: 'refunded',
            recoveredChargeFullyRefunded: true,
            initialPaymentPreserved: true,
            processedWebhookEvents: 'succeeded',
        },
    };
    return {
        schemaVersion: 1,
        status: 'OK',
        mode: 'lifecycle',
        outputDir: 'outputs/launch-staging-billing-lifecycle/2026-07-11T00-00-00-000Z',
        scope: {
            supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
            stripeAccountId: 'acct_staging',
            stripeMode: 'test',
            productionExcluded: true,
        },
        resources: {
            checkoutSessionId: sessionId,
            subscriptionId: 'sub_safe',
            initialInvoiceId: 'in_initial',
            initialPaymentIntentId: 'pi_initial',
            renewalInvoiceId: 'in_renewal',
            recoveredPaymentIntentId: 'pi_recovered',
            partialRefundId: 're_partial',
            finalRefundId: 're_final',
        },
        mutationGate: { authorized: true, sessionBound: true },
        checkpoint: { phase: 'complete' },
        error: null,
        canonicalEvidence,
    };
}

describe('staging billing lifecycle safety', () => {
    it('binds mutation approval to one cs_test_ session and accepts preflight without approval', () => {
        expect(lifecycleConfirmationForSession(sessionId)).toBe(
            `I_CONFIRM_STAGING_BILLING_LIFECYCLE:${sessionId}`
        );
        expect(validateLifecycleEnvironment(validEnvironment(), { preflightOnly: false })).toEqual({
            checkoutSessionId: sessionId,
            stripeExpectedAccountId: 'acct_staging',
            supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
        });
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            confirmation: undefined,
        }, { preflightOnly: true })).not.toThrow();
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            confirmation: 'I_CONFIRM_STAGING_BILLING_LIFECYCLE:cs_test_other',
        }, { preflightOnly: false })).toThrow(/Mutation blocked/);
    });

    it('rejects live Stripe keys, the wrong account shape and any non-staging Supabase project', () => {
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            stripeSecretKey: 'sk_live_forbidden',
        }, { preflightOnly: false })).toThrow(/sk_test_/);
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            stripePublishableKey: 'pk_live_forbidden',
        }, { preflightOnly: false })).toThrow(/pk_test_/);
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            stripeExpectedAccountId: '',
        }, { preflightOnly: false })).toThrow(/STRIPE_EXPECTED_ACCOUNT_ID/);
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            supabaseUrl: 'https://productionref.supabase.co',
        }, { preflightOnly: false })).toThrow(STAGING_SUPABASE_PROJECT_REF);
        expect(() => validateLifecycleEnvironment({
            ...validEnvironment(),
            publicAppEnvironment: 'production',
        }, { preflightOnly: false })).toThrow(/exactly staging/);
    });

    it('requires a completed paid owned subscription on one ready test clock with local reconciliation', () => {
        expect(() => assertLifecyclePreflight(validPreflight())).not.toThrow();

        for (const mutation of [
            { checkoutSessionLivemode: true },
            { checkoutSessionStatus: 'open' },
            { checkoutPaymentStatus: 'unpaid' },
            { actualStripeAccountId: 'acct_other' },
            { testClockStatus: 'advancing' },
            { subscriptionTestClockId: 'clock_other' },
            { customerMetadataUserId: 'another-user' },
            { customerMetadataSource: 'unowned' },
            { testClockCustomerIds: ['cus_safe', 'cus_other'] },
            { customerSubscriptionIds: ['sub_safe', 'sub_other'] },
            { customerSubscriptionScheduleIds: ['sub_sched_1'] },
            { localSubscriptionStatus: 'paused' },
            { localInitialPaymentAmountRefunded: 1 },
            { initialInvoicePaymentIntentId: 'pi_other' },
            { initialInvoicePaymentAmountPaid: 9_999 },
            { initialStripePaymentIntentAmount: 9_999 },
            { initialStripePaymentIntentAmountReceived: 9_999 },
            { initialStripeChargeAmountRefunded: 1 },
        ] satisfies Array<Partial<LifecyclePreflightSnapshot>>) {
            expect(() => assertLifecyclePreflight({ ...validPreflight(), ...mutation })).toThrow();
        }
    });

    it('proves the exact 15-day upcoming boundary and permits only bounded resume states', () => {
        expect(INVOICE_UPCOMING_NOTICE_DAYS).toBe(15);
        expect(invoiceUpcomingBoundary(2_100_000_000)).toBe(2_098_704_000);
        expect(() => assertLifecyclePreflight({
            ...validPreflight(),
            testClockFrozenTime: invoiceUpcomingBoundary(2_100_000_000) - 59,
        })).toThrow(/15-day/);

        expect(() => assertLifecyclePreflight({
            ...validPreflight(),
            subscriptionStatus: 'canceled',
            subscriptionCancelAtPeriodEnd: true,
            subscriptionPeriodEnd: 2_200_000_000,
            testClockFrozenTime: 2_199_000_000,
            localSubscriptionStatus: 'cancelled',
            localSubscriptionInvoiceId: 'in_renewal',
        }, { resume: true })).not.toThrow();
        expect(() => assertLifecyclePreflight({
            ...validPreflight(),
            subscriptionStatus: 'incomplete_expired',
        }, { resume: true })).toThrow(/resumable/);

        const initialFrozenTime = 2_090_000_000;
        const initialPeriodEnd = 2_100_000_000;
        const boundary = invoiceUpcomingBoundary(initialPeriodEnd);
        const beforeBoundary = boundary - 60;
        expect(() => assertCheckpointClockWindow({
            phase: 'initial_verified',
            currentFrozenTime: initialFrozenTime,
            initialFrozenTime,
            initialPeriodEnd,
        })).not.toThrow();
        expect(() => assertCheckpointClockWindow({
            phase: 'initial_verified',
            currentFrozenTime: initialFrozenTime + 1,
            initialFrozenTime,
            initialPeriodEnd,
        })).toThrow(/does not allow any Test Clock advancement/);
        expect(() => assertCheckpointClockWindow({
            phase: 'initial_verified',
            currentFrozenTime: beforeBoundary,
            initialFrozenTime: beforeBoundary,
            initialPeriodEnd,
        })).toThrow(/time is invalid/);
        for (const currentFrozenTime of [initialFrozenTime, beforeBoundary]) {
            expect(() => assertCheckpointClockWindow({
                phase: 'upcoming_baseline_captured',
                currentFrozenTime,
                initialFrozenTime,
                initialPeriodEnd,
            })).not.toThrow();
        }
        expect(() => assertCheckpointClockWindow({
            phase: 'upcoming_baseline_captured',
            currentFrozenTime: boundary,
            initialFrozenTime,
            initialPeriodEnd,
        })).toThrow(/ambiguous/);
        for (const currentFrozenTime of [beforeBoundary, boundary]) {
            expect(() => assertCheckpointClockWindow({
                phase: 'upcoming_before_boundary_verified',
                currentFrozenTime,
                initialFrozenTime,
                initialPeriodEnd,
            })).not.toThrow();
        }
        expect(() => assertCheckpointClockWindow({
            phase: 'upcoming_before_boundary_verified',
            currentFrozenTime: boundary + 1,
            initialFrozenTime,
            initialPeriodEnd,
        })).toThrow(/ambiguous/);
        expect(() => assertCheckpointClockWindow({
            phase: 'upcoming_observed',
            currentFrozenTime: boundary,
            initialFrozenTime,
            initialPeriodEnd,
        })).not.toThrow();
        expect(() => assertCheckpointClockWindow({
            phase: 'upcoming_observed',
            currentFrozenTime: beforeBoundary,
            initialFrozenTime,
            initialPeriodEnd,
        })).toThrow(/behind/);
        expect(() => assertLifecyclePhaseTransition('renewal_failed', 'renewal_recovered')).not.toThrow();
        expect(() => assertLifecyclePhaseTransition('renewal_recovered', 'renewal_failed')).toThrow(/backwards/);
        expect(isLifecyclePhase('partial_refund_completed')).toBe(true);
        expect(isLifecyclePhase('arbitrary')).toBe(false);
    });

    it('allowlists exactly one enabled staging webhook destination for every lifecycle event', () => {
        const exactEndpoint = {
            id: 'we_staging',
            url: STAGING_STRIPE_WEBHOOK_ENDPOINT_URL,
            status: 'enabled',
            enabledEvents: ['*'],
        };
        expect(assertExclusiveLifecycleWebhookDestination([exactEndpoint])).toBe('we_staging');
        expect(() => assertExclusiveLifecycleWebhookDestination([
            exactEndpoint,
            { ...exactEndpoint, id: 'we_old', url: 'https://old.example.test/api/stripe-webhook' },
        ])).toThrow(/Exactly one/);
        expect(() => assertExclusiveLifecycleWebhookDestination([
            { ...exactEndpoint, url: 'https://old.example.test/api/stripe-webhook' },
        ])).toThrow(/exact staging/);
        expect(() => assertExclusiveLifecycleWebhookDestination([
            { ...exactEndpoint, enabledEvents: ['invoice.paid'] },
        ])).toThrow(/does not cover every/);
    });

    it('requires phase-specific external state before any resumed mutation', () => {
        expect(() => assertResumePhaseState({
            phase: 'renewal_failed',
            stripeSubscriptionStatus: 'past_due',
            localSubscriptionStatus: 'paused',
            cancelAtPeriodEnd: false,
        })).not.toThrow();
        expect(() => assertResumePhaseState({
            phase: 'renewal_failed',
            stripeSubscriptionStatus: 'active',
            localSubscriptionStatus: 'active',
            cancelAtPeriodEnd: false,
        })).not.toThrow();
        expect(() => assertResumePhaseState({
            phase: 'renewal_failed',
            stripeSubscriptionStatus: 'canceled',
            localSubscriptionStatus: 'cancelled',
            cancelAtPeriodEnd: false,
        })).toThrow(/failed-renewal/);
        expect(() => assertResumePhaseState({
            phase: 'cancellation_scheduled',
            stripeSubscriptionStatus: 'active',
            localSubscriptionStatus: 'active',
            cancelAtPeriodEnd: false,
        })).toThrow(/cancellation-scheduled/);
        expect(() => assertResumePhaseState({
            phase: 'complete',
            stripeSubscriptionStatus: 'canceled',
            localSubscriptionStatus: 'cancelled',
            cancelAtPeriodEnd: false,
        })).not.toThrow();
    });

    it('accepts only a canonical complete lifecycle report bound to the exact account and session', () => {
        const valid = canonicalLifecycleReport();
        expect(validateCanonicalLifecycleReport(valid, {
            checkoutSessionId: sessionId,
            stripeAccountId: 'acct_staging',
        }).canonicalEvidence.finalState.processedWebhookEvents).toBe('succeeded');
        expect(() => validateCanonicalLifecycleReport({
            ...valid,
            status: 'FAILED',
        }, {
            checkoutSessionId: sessionId,
            stripeAccountId: 'acct_staging',
        })).toThrow(/does not match/);
        expect(() => validateCanonicalLifecycleReport({
            ...valid,
            canonicalEvidence: {
                ...valid.canonicalEvidence,
                webhookEventIds: {
                    ...valid.canonicalEvidence.webhookEventIds,
                    finalRefund: valid.canonicalEvidence.webhookEventIds.partialRefund,
                },
            },
        }, {
            checkoutSessionId: sessionId,
            stripeAccountId: 'acct_staging',
        })).toThrow(/exact webhook event set/);
    });

    it('builds partial and remaining refunds only for the recovered renewal PaymentIntent', () => {
        expect(FAILING_PAYMENT_METHOD).toBe('pm_card_chargeCustomerFail');
        expect(RECOVERY_PAYMENT_METHOD).toBe('pm_card_visa');
        expect(STRIPE_API_VERSION).toBe('2026-02-25.clover');
        expect(buildRefundPlan({
            initialPaymentIntentId: 'pi_initial',
            recoveredPaymentIntentId: 'pi_renewal',
            recoveredAmount: 9_999,
        })).toEqual({ partialAmount: 4_999, remainingAmount: 5_000 });
        expect(() => buildRefundPlan({
            initialPaymentIntentId: 'pi_same',
            recoveredPaymentIntentId: 'pi_same',
            recoveredAmount: 10_000,
        })).toThrow(/must differ/);
        expect(() => assertInitialPaymentPreserved({ status: 'succeeded', amountRefunded: 0 })).not.toThrow();
        expect(() => assertInitialPaymentPreserved({ status: 'refunded', amountRefunded: 10_000 })).toThrow();
    });

    it('redacts email addresses, Stripe keys, webhook secrets and token-shaped values', () => {
        const sanitized = sanitizeLifecycleText(
            'student@example.com sk_test_abc pk_live_xyz whsec_secret sb_secret_value eyJheader.payload.signature'
        );
        expect(sanitized).not.toContain('student@example.com');
        expect(sanitized).not.toContain('sk_test_abc');
        expect(sanitized).not.toContain('pk_live_xyz');
        expect(sanitized).not.toContain('whsec_secret');
        expect(sanitized).not.toContain('sb_secret_value');
        expect(sanitized).not.toContain('eyJheader.payload.signature');
    });

    it('keeps the executable behind preflight, test helpers and evidence without synthetic events', () => {
        expect(packageJson).toContain('launch:staging-billing-lifecycle');
        expect(packageJson).toContain('launch:staging-billing-lifecycle:preflight');
        expect(packageJson).toContain('launch:staging-billing-lifecycle:resume');
        expect(runnerSource).toContain("dotenv.config({ path: '.env.staging'");
        expect(runnerSource.indexOf('runReadOnlyPreflight(')).toBeLessThan(
            runnerSource.indexOf('setDefaultPaymentMethod(')
        );

        for (const snippet of [
            'stripe.testHelpers.testClocks.advance',
            'stripe.customers.list({ test_clock:',
            "stripe.subscriptions.list({",
            'stripe.subscriptionSchedules.list({ customer:',
            'requireSinglePaidInvoicePayment',
            'initialPaymentIntent.amount_received',
            'initialCharge.amount_refunded',
            "from('processed_webhook_events')",
            "processing_status === 'succeeded'",
            'waitForProcessedWebhookSucceeded(supabase, initialCheckoutEvent',
            'waitForProcessedWebhookSucceeded(supabase, initialInvoicePaidEvent',
            'assertLifecycleWebhookDestinations',
            'verifyDeployedStagingRuntime',
            "requiredEnv('TEST_STUDENT_EMAIL')",
            "from('email_recipient_budget_usage')",
            "from('fulfillment_jobs')",
            "job_type === 'renewal_notice'",
            "job.status !== 'succeeded'",
            'job.last_error !== null',
            "renewalNoticeDeliveryStatus: 'succeeded'",
            'invoiceUpcomingBoundary',
            'upcoming-before-15-day-boundary',
            'assertNoNewStripeEvent',
            "process.argv.includes('--resume')",
            'readCheckpointForResume',
            "'--resume requires an existing lifecycle checkpoint",
            'resumeCheckpoint !== null',
            'assertCheckpointClockWindow',
            'assertResumePhaseState',
            'writeCheckpointAtomic',
            'renameSync(temporary, file)',
            "'invoice.upcoming'",
            "'invoice.payment_failed'",
            'stripe.invoices.pay',
            'cancel_at_period_end: true',
            'stripe.refunds.create',
            'assertInitialPaymentStillPreserved',
            'assertFinalLifecycleState',
            'buildCanonicalEvidence',
            'report.canonicalEvidence = buildCanonicalEvidence',
            "stripeSubscription.status !== 'canceled'",
            "payment.status === 'refunded'",
            'payment.amount_refunded === payment.amount',
            "'charge.refunded'",
            'launch-staging-billing-lifecycle',
            'summary.json',
            'summary.md',
        ]) {
            expect(runnerSource).toContain(snippet);
        }
        expect(safetySource).toContain('pm_card_chargeCustomerFail');
        expect(safetySource).toContain('pm_card_visa');
        expect(runnerSource.indexOf('captureMatchingEventIds(')).toBeLessThan(
            runnerSource.indexOf('ensureDefaultPaymentMethod(')
        );

        for (const forbidden of [
            'stripe.events.create',
            'stripe.testHelpers.testClocks.del',
            'webhookEndpoints.create',
            'webhookEndpoints.update',
            'paymentIntents.create',
            'sk_live_',
            'pk_live_',
        ]) {
            expect(runnerSource).not.toContain(forbidden);
        }
    });
});
