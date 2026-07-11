import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Stripe from 'stripe';
import type { Database } from '../../src/types/database.types';
import {
    STAGING_FULFILLMENT_ORIGIN,
    STAGING_WEB_ORIGIN,
    verifyDeployedStagingRuntime,
} from '../smoke/deployed-runtime-safety';
import {
    assertExclusiveLifecycleWebhookDestination,
    assertInitialPaymentPreserved,
    assertCheckpointClockWindow,
    assertLifecyclePhaseTransition,
    assertLifecyclePreflight,
    assertResumePhaseState,
    buildRefundPlan,
    FAILING_PAYMENT_METHOD,
    INVOICE_UPCOMING_BOUNDARY_MARGIN_SECONDS,
    LIFECYCLE_CONFIRMATION_ENV,
    RECOVERY_PAYMENT_METHOD,
    sanitizeLifecycleText,
    STAGING_SUPABASE_PROJECT_REF,
    STRIPE_API_VERSION,
    invoiceUpcomingBoundary,
    isLifecyclePhase,
    lifecyclePhaseIndex,
    validateLifecycleEnvironment,
    type CanonicalLifecycleEvidence,
    type LifecyclePhase,
    type LifecyclePreflightSnapshot,
} from './staging-billing-lifecycle-safety';

type StepStatus = 'ok' | 'failed';
type EvidenceValue = string | number | boolean | null;

interface EvidenceStep {
    name: string;
    status: StepStatus;
    at: string;
    message: string;
    details?: Record<string, EvidenceValue>;
}

interface LifecycleReport {
    schemaVersion: 1;
    status: 'OK' | 'FAILED';
    mode: 'preflight-only' | 'lifecycle' | 'lifecycle-resume';
    startedAt: string;
    endedAt: string;
    outputDir: string;
    scope: {
        supabaseProjectRef: string;
        stripeAccountId: string | null;
        stripeMode: 'test';
        productionExcluded: true;
    };
    resources: {
        checkoutSessionId: string | null;
        subscriptionId: string | null;
        testClockId: string | null;
        initialInvoiceId: string | null;
        initialPaymentIntentId: string | null;
        renewalInvoiceId: string | null;
        recoveredPaymentIntentId: string | null;
        partialRefundId: string | null;
        finalRefundId: string | null;
    };
    mutationGate: {
        environmentVariable: string;
        sessionBound: true;
        authorized: boolean;
    };
    checkpoint: {
        path: string | null;
        phase: LifecyclePhase | null;
        resumeRequested: boolean;
    };
    steps: EvidenceStep[];
    error: string | null;
    canonicalEvidence: CanonicalLifecycleEvidence | null;
    documentation: string[];
}

type LocalSubscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'student_id' | 'status' | 'stripe_subscription_id' | 'stripe_invoice_id'
>;

type LocalPayment = Pick<
    Database['public']['Tables']['payments']['Row'],
    'id' | 'student_id' | 'subscription_id' | 'amount' | 'currency' | 'status' | 'stripe_payment_intent_id' | 'stripe_invoice_id' | 'amount_refunded' | 'stripe_refund_id'
>;

interface PreflightResult {
    accountId: string;
    sessionId: string;
    userId: string;
    customerId: string;
    subscriptionId: string;
    testClockId: string;
    initialInvoiceId: string;
    initialPaymentIntentId: string;
    initialChargeId: string;
    initialCheckoutEventId: string;
    initialInvoicePaidEventId: string;
    initialPaymentId: string;
    localSubscriptionId: string;
    subscriptionPeriodEnd: number;
    subscriptionStatus: string;
    localSubscriptionStatus: string;
    initialPeriodEnd: number;
    testClockFrozenTime: number;
    lifecycleWebhookEndpointId: string;
    emailDailyUsed: number;
    emailMonthlyUsed: number;
    webVersionId: string;
    fulfillmentVersionId: string;
}

interface LifecycleCheckpoint {
    schemaVersion: 1;
    updatedAt: string;
    phase: LifecyclePhase;
    supabaseProjectRef: typeof STAGING_SUPABASE_PROJECT_REF;
    stripeAccountId: string;
    checkoutSessionId: string;
    customerId: string;
    subscriptionId: string;
    testClockId: string;
    initialInvoiceId: string;
    initialPaymentIntentId: string;
    initialPeriodEnd: number;
    initialClockFrozenTime: number;
    initialCheckoutEventId: string;
    initialInvoicePaidEventId: string;
    failurePaymentMethodId?: string;
    recoveryPaymentMethodId?: string;
    upcomingBaselineEventIds?: string[];
    upcomingEventId?: string;
    renewalInvoiceId?: string;
    renewalFailedEventId?: string;
    recoveredPaymentIntentId?: string;
    renewalPaidEventId?: string;
    cancellationPeriodEnd?: number;
    cancellationEventId?: string;
    partialRefundId?: string;
    partialRefundEventId?: string;
    finalRefundId?: string;
    finalRefundEventId?: string;
}

const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-staging-billing-lifecycle',
    stamp(startedAt)
);
mkdirSync(outputDir, { recursive: true });

const preflightOnly = process.argv.includes('--preflight-only');
const resumeRequested = process.argv.includes('--resume');
let timeoutMs = 180_000;
const report: LifecycleReport = {
    schemaVersion: 1,
    status: 'FAILED',
    mode: preflightOnly ? 'preflight-only' : resumeRequested ? 'lifecycle-resume' : 'lifecycle',
    startedAt: startedAt.toISOString(),
    endedAt: startedAt.toISOString(),
    outputDir,
    scope: {
        supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
        stripeAccountId: null,
        stripeMode: 'test',
        productionExcluded: true,
    },
    resources: {
        checkoutSessionId: null,
        subscriptionId: null,
        testClockId: null,
        initialInvoiceId: null,
        initialPaymentIntentId: null,
        renewalInvoiceId: null,
        recoveredPaymentIntentId: null,
        partialRefundId: null,
        finalRefundId: null,
    },
    mutationGate: {
        environmentVariable: LIFECYCLE_CONFIRMATION_ENV,
        sessionBound: true,
        authorized: false,
    },
    checkpoint: {
        path: null,
        phase: null,
        resumeRequested,
    },
    steps: [],
    error: null,
    canonicalEvidence: null,
    documentation: [
        'https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage',
        'https://docs.stripe.com/testing?testing-method=payment-methods',
        'https://docs.stripe.com/api/invoices/pay',
        'https://docs.stripe.com/api/refunds/create',
    ],
};

await main();

async function main(): Promise<void> {
    try {
        dotenv.config({ path: '.env.staging', override: true, quiet: true });
        timeoutMs = boundedInteger(
            argumentValue('--timeout-ms') ?? String(timeoutMs),
            30_000,
            300_000,
            '--timeout-ms'
        );

        const checkoutSessionId = argumentValue('--checkout-session')
            ?? process.env.STAGING_BILLING_CHECKOUT_SESSION_ID
            ?? process.env.SMOKE_COMPLETED_CHECKOUT_SESSION_ID;
        const validated = validateLifecycleEnvironment({
            stripeSecretKey: process.env.STRIPE_SECRET_KEY,
            stripePublishableKey: process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY,
            stripeExpectedAccountId: process.env.STRIPE_EXPECTED_ACCOUNT_ID,
            publicAppEnvironment: process.env.PUBLIC_APP_ENV,
            supabaseUrl: process.env.PUBLIC_SUPABASE_URL,
            supabaseExpectedProjectRef: process.env.SUPABASE_EXPECTED_PROJECT_REF,
            supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            checkoutSessionId,
            confirmation: process.env[LIFECYCLE_CONFIRMATION_ENV],
        }, { preflightOnly });
        report.resources.checkoutSessionId = validated.checkoutSessionId;
        const checkpointFile = checkpointPath(validated.checkoutSessionId);
        report.checkpoint.path = checkpointFile;
        const checkpointExists = existsSync(checkpointFile);
        const resumeCheckpoint = resumeRequested
            ? readCheckpointForResume(validated.checkoutSessionId, validated.stripeExpectedAccountId)
            : null;
        if (!preflightOnly && !resumeRequested && checkpointExists) {
            throw new Error('A lifecycle checkpoint already exists. Re-run with --resume after reviewing it.');
        }
        report.mutationGate.authorized = !preflightOnly;
        addStep('environment_guard', 'Staging-only Stripe and Supabase environment guards passed.', {
            supabaseProjectRef: validated.supabaseProjectRef,
            stripeMode: 'test',
            preflightOnly,
        });

        const stripe = new Stripe(requiredEnv('STRIPE_SECRET_KEY'), {
            apiVersion: STRIPE_API_VERSION,
            maxNetworkRetries: 2,
            timeout: 30_000,
        });
        const supabase = createClient<Database>(
            requiredEnv('PUBLIC_SUPABASE_URL'),
            requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
            { auth: { autoRefreshToken: false, persistSession: false } }
        );

        const preflight = await runReadOnlyPreflight(
            stripe,
            supabase,
            validated.checkoutSessionId,
            validated.stripeExpectedAccountId,
            resumeCheckpoint
        );
        report.scope.stripeAccountId = preflight.accountId;
        report.resources.subscriptionId = preflight.subscriptionId;
        report.resources.testClockId = preflight.testClockId;
        report.resources.initialInvoiceId = preflight.initialInvoiceId;
        report.resources.initialPaymentIntentId = preflight.initialPaymentIntentId;
        addStep('readonly_preflight', 'Checkout, Test Clock, Stripe ownership and local reconciliation passed.', {
            stripeAccountId: preflight.accountId,
            checkoutSessionId: preflight.sessionId,
            subscriptionId: preflight.subscriptionId,
            testClockId: preflight.testClockId,
            checkoutCompletedEventId: preflight.initialCheckoutEventId,
            initialInvoicePaidEventId: preflight.initialInvoicePaidEventId,
            initialWebhookProcessingStatus: 'succeeded',
            lifecycleWebhookEndpointId: preflight.lifecycleWebhookEndpointId,
            targetStudentAllowlisted: true,
            emailDailyUsed: preflight.emailDailyUsed,
            emailMonthlyUsed: preflight.emailMonthlyUsed,
            deployedRuntimeAttested: true,
            webVersionId: preflight.webVersionId,
            fulfillmentVersionId: preflight.fulfillmentVersionId,
        });

        if (preflightOnly) {
            report.status = 'OK';
            return;
        }

        // This message is intentionally emitted only after the complete read-only
        // preflight and immediately before the first external mutation.
        console.log([
            '[launch:staging-billing-lifecycle] Preflight OK.',
            `Stripe test account ${preflight.accountId};`,
            `subscription ${preflight.subscriptionId};`,
            `Test Clock ${preflight.testClockId};`,
            `Supabase staging ${STAGING_SUPABASE_PROJECT_REF}.`,
            'Production/live mode is excluded.',
        ].join(' '));

        let checkpoint = initializeCheckpoint(preflight, resumeCheckpoint);
        report.checkpoint.phase = checkpoint.phase;
        if (resumeRequested) {
            addStep('checkpoint_resume', 'Loaded a bounded checkpoint after local and external read-only identity validation.', {
                phase: checkpoint.phase,
                checkpointIdentityVerified: true,
            });
        }
        checkpoint = await executeLifecycle(stripe, supabase, preflight, checkpoint);
        report.checkpoint.phase = checkpoint.phase;
        await assertFinalLifecycleState(stripe, supabase, preflight, checkpoint);
        report.canonicalEvidence = buildCanonicalEvidence(preflight, checkpoint);
        report.status = 'OK';
    } catch (error) {
        const message = sanitizeLifecycleText(error instanceof Error ? error.message : error);
        report.error = message;
        report.steps.push({
            name: 'failure',
            status: 'failed',
            at: new Date().toISOString(),
            message,
        });
        process.exitCode = 1;
    } finally {
        report.endedAt = new Date().toISOString();
        writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
        writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
        console.log(`[launch:staging-billing-lifecycle] Status: ${report.status}`);
        console.log(`[launch:staging-billing-lifecycle] Summary: ${path.join(outputDir, 'summary.md')}`);
    }
}

async function executeLifecycle(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    preflight: PreflightResult,
    initialCheckpoint: LifecycleCheckpoint
): Promise<LifecycleCheckpoint> {
    let checkpoint = initialCheckpoint;
    const beforeUpcomingBoundary = invoiceUpcomingBoundary(preflight.initialPeriodEnd)
        - INVOICE_UPCOMING_BOUNDARY_MARGIN_SECONDS;
    const upcomingBoundary = invoiceUpcomingBoundary(preflight.initialPeriodEnd);

    if (phaseBefore(checkpoint.phase, 'upcoming_baseline_captured')) {
        const baselineIds = await captureMatchingEventIds(
            stripe,
            'invoice.upcoming',
            (event) => eventInvoiceSubscriptionId(event) === preflight.subscriptionId
        );
        if (baselineIds.size > 0) {
            throw new Error('Cannot prove the 15-day boundary because invoice.upcoming already exists for the target subscription.');
        }
        checkpoint = saveCheckpoint(checkpoint, 'upcoming_baseline_captured', {
            upcomingBaselineEventIds: [...baselineIds].sort(),
        });
    }

    const upcomingBaseline = new Set(requiredCheckpointArray(checkpoint.upcomingBaselineEventIds, 'upcoming baseline'));
    if (phaseBefore(checkpoint.phase, 'upcoming_before_boundary_verified')) {
        await advanceClockTo(
            stripe,
            preflight,
            beforeUpcomingBoundary,
            'upcoming-before-15-day-boundary',
            timeoutMs
        );
        await assertNoNewStripeEvent(
            stripe,
            'invoice.upcoming',
            upcomingBaseline,
            (event) => eventInvoiceSubscriptionId(event) === preflight.subscriptionId,
            8_000
        );
        checkpoint = saveCheckpoint(checkpoint, 'upcoming_before_boundary_verified');
        addStep('invoice_upcoming_before_boundary', 'No invoice.upcoming event existed one minute before the 15-day boundary.', {
            clockTarget: beforeUpcomingBoundary,
            noticeDays: 15,
            eventObserved: false,
        });
    }

    let upcomingEvent: Stripe.Event;
    if (phaseBefore(checkpoint.phase, 'upcoming_observed')) {
        await advanceClockTo(
            stripe,
            preflight,
            upcomingBoundary,
            'upcoming-at-15-day-boundary',
            timeoutMs
        );
        upcomingEvent = await waitForStripeEvent(
            stripe,
            'invoice.upcoming',
            upcomingBaseline,
            (event) => eventInvoiceSubscriptionId(event) === preflight.subscriptionId,
            timeoutMs
        );
        await waitForProcessedWebhookSucceeded(supabase, upcomingEvent, timeoutMs);
        await waitForRenewalNoticeJob(supabase, preflight, upcomingEvent, timeoutMs);
        checkpoint = saveCheckpoint(checkpoint, 'upcoming_observed', { upcomingEventId: upcomingEvent.id });
        addStep('invoice_upcoming', 'Crossed exactly the configured 15-day boundary and verified successful renewal-notice delivery.', {
            eventId: upcomingEvent.id,
            clockTarget: upcomingBoundary,
            webhookProcessingStatus: 'succeeded',
            renewalNoticeDeliveryStatus: 'succeeded',
        });
    } else {
        upcomingEvent = await requireCheckpointEvent(
            stripe,
            checkpoint.upcomingEventId,
            'invoice.upcoming',
            (event) => eventInvoiceSubscriptionId(event) === preflight.subscriptionId
        );
        await waitForProcessedWebhookSucceeded(supabase, upcomingEvent, timeoutMs);
        await waitForRenewalNoticeJob(supabase, preflight, upcomingEvent, timeoutMs);
    }

    if (phaseBefore(checkpoint.phase, 'failure_payment_method_set')) {
        const failurePaymentMethodId = await ensureDefaultPaymentMethod(
            stripe,
            preflight,
            FAILING_PAYMENT_METHOD,
            'failure'
        );
        checkpoint = saveCheckpoint(checkpoint, 'failure_payment_method_set', { failurePaymentMethodId });
        addStep('failure_payment_method', 'Attached and selected the attachable failure PaymentMethod after upcoming evidence.', {
            paymentMethodId: failurePaymentMethodId,
            customerDefaultVerified: true,
            subscriptionDefaultVerified: true,
        });
    } else if (
        phaseBefore(checkpoint.phase, 'renewal_recovered')
        && ['past_due', 'unpaid'].includes(preflight.subscriptionStatus)
    ) {
        const failurePaymentMethodId = await ensureDefaultPaymentMethod(
            stripe,
            preflight,
            FAILING_PAYMENT_METHOD,
            'failure'
        );
        checkpoint = saveCheckpoint(checkpoint, checkpoint.phase, { failurePaymentMethodId });
    }

    let renewalInvoice: Stripe.Invoice;
    let failedEvent: Stripe.Event;
    if (phaseBefore(checkpoint.phase, 'renewal_failed')) {
        await advanceClockTo(
            stripe,
            preflight,
            preflight.initialPeriodEnd,
            'renewal-boundary',
            timeoutMs
        );
        await advanceClockTo(
            stripe,
            preflight,
            preflight.initialPeriodEnd + 7_200,
            'renewal-finalization',
            timeoutMs
        );
        renewalInvoice = await waitForValue(
            'renewal invoice payment failure',
            async () => findRenewalInvoice(stripe, preflight.subscriptionId, preflight.initialInvoiceId),
            (invoice): invoice is Stripe.Invoice => Boolean(
                invoice
                && invoice.status === 'open'
                && (invoice.amount_remaining ?? 0) > 0
                && (invoice.attempt_count ?? 0) >= 1
            ),
            timeoutMs
        );
        failedEvent = await waitForStripeEvent(
            stripe,
            'invoice.payment_failed',
            new Set(),
            (event) => stripeEventObjectId(event) === renewalInvoice.id,
            timeoutMs
        );
        await waitForProcessedWebhookSucceeded(supabase, failedEvent, timeoutMs);
        const failedLocalPayment = await waitForLocalPayment(
            supabase,
            renewalInvoice.id,
            (payment) => payment.status === 'failed',
            timeoutMs
        );
        await waitForLocalSubscriptionStatus(supabase, preflight.subscriptionId, 'paused', timeoutMs);
        const failedSubscription = await waitForValue(
            'Stripe subscription past_due/unpaid state',
            () => stripe.subscriptions.retrieve(preflight.subscriptionId),
            (subscription) => ['past_due', 'unpaid'].includes(subscription.status),
            timeoutMs
        );
        report.resources.renewalInvoiceId = renewalInvoice.id;
        checkpoint = saveCheckpoint(checkpoint, 'renewal_failed', {
            renewalInvoiceId: renewalInvoice.id,
            renewalFailedEventId: failedEvent.id,
        });
        addStep('renewal_failure', 'Real renewal failed and its webhook succeeded before local pause evidence was accepted.', {
            invoiceId: renewalInvoice.id,
            eventId: failedEvent.id,
            webhookProcessingStatus: 'succeeded',
            stripeStatus: failedSubscription.status,
            localPaymentStatus: failedLocalPayment.status,
            localSubscriptionStatus: 'paused',
        });
    } else {
        renewalInvoice = await stripe.invoices.retrieve(
            requiredCheckpointValue(checkpoint.renewalInvoiceId, 'renewal invoice')
        );
        failedEvent = await requireCheckpointEvent(
            stripe,
            checkpoint.renewalFailedEventId,
            'invoice.payment_failed',
            (event) => stripeEventObjectId(event) === renewalInvoice.id
        );
        await waitForProcessedWebhookSucceeded(supabase, failedEvent, timeoutMs);
        report.resources.renewalInvoiceId = renewalInvoice.id;
    }

    let recoveredInvoice: Stripe.Invoice;
    let recoveredPaymentIntentId: string;
    let paidEvent: Stripe.Event;
    if (phaseBefore(checkpoint.phase, 'renewal_recovered')) {
        const recoveryPaymentMethodId = await ensureDefaultPaymentMethod(
            stripe,
            preflight,
            RECOVERY_PAYMENT_METHOD,
            'recovery'
        );
        if (renewalInvoice.status !== 'paid') {
            await stripe.invoices.pay(renewalInvoice.id, {
                payment_method: recoveryPaymentMethodId,
                off_session: true,
            }, {
                idempotencyKey: idempotencyKey(preflight.sessionId, 'pay-renewal'),
            });
        }
        checkpoint = { ...checkpoint, recoveryPaymentMethodId };
        recoveredInvoice = await waitForValue(
            'renewal invoice recovery',
            () => stripe.invoices.retrieve(renewalInvoice.id),
            (invoice) => invoice.status === 'paid' && invoice.amount_paid > 1,
            timeoutMs
        );
        paidEvent = await waitForStripeEvent(
            stripe,
            'invoice.paid',
            new Set(),
            (event) => stripeEventObjectId(event) === renewalInvoice.id,
            timeoutMs
        );
        await waitForProcessedWebhookSucceeded(supabase, paidEvent, timeoutMs);
        const recoveredLocalPayment = await waitForLocalPayment(
            supabase,
            renewalInvoice.id,
            (payment) => payment.status === 'succeeded' && payment.amount_refunded === 0,
            timeoutMs
        );
        await waitForLocalSubscriptionStatus(supabase, preflight.subscriptionId, 'active', timeoutMs);
        await waitForValue(
            'Stripe subscription recovery',
            () => stripe.subscriptions.retrieve(preflight.subscriptionId),
            (subscription) => subscription.status === 'active',
            timeoutMs
        );
        recoveredPaymentIntentId = await requirePaidInvoicePaymentIntentId(stripe, renewalInvoice.id);
        if (
            recoveredLocalPayment.stripe_payment_intent_id !== recoveredPaymentIntentId
            || recoveredLocalPayment.amount !== recoveredInvoice.amount_paid
        ) {
            throw new Error('Recovered local payment does not match the paid renewal invoice.');
        }
        checkpoint = saveCheckpoint(checkpoint, 'renewal_recovered', {
            recoveryPaymentMethodId: checkpoint.recoveryPaymentMethodId,
            recoveredPaymentIntentId,
            renewalPaidEventId: paidEvent.id,
        });
        addStep('renewal_recovery', 'Retried the same invoice and verified the paid webhook before accepting active state.', {
            invoiceId: renewalInvoice.id,
            eventId: paidEvent.id,
            paymentIntentId: recoveredPaymentIntentId,
            webhookProcessingStatus: 'succeeded',
            localSubscriptionStatus: 'active',
        });
    } else {
        recoveredInvoice = await stripe.invoices.retrieve(renewalInvoice.id);
        if (recoveredInvoice.status !== 'paid' || recoveredInvoice.amount_paid <= 1) {
            throw new Error('Checkpoint says renewal_recovered but the renewal invoice is not paid.');
        }
        recoveredPaymentIntentId = requiredCheckpointValue(
            checkpoint.recoveredPaymentIntentId,
            'recovered PaymentIntent'
        );
        paidEvent = await requireCheckpointEvent(
            stripe,
            checkpoint.renewalPaidEventId,
            'invoice.paid',
            (event) => stripeEventObjectId(event) === renewalInvoice.id
        );
        await waitForProcessedWebhookSucceeded(supabase, paidEvent, timeoutMs);
    }
    report.resources.recoveredPaymentIntentId = recoveredPaymentIntentId;

    const refundPlan = buildRefundPlan({
        initialPaymentIntentId: preflight.initialPaymentIntentId,
        recoveredPaymentIntentId,
        recoveredAmount: recoveredInvoice.amount_paid,
    });

    let cancellationPeriodEnd: number;
    if (phaseBefore(checkpoint.phase, 'cancellation_scheduled')) {
        const current = await stripe.subscriptions.retrieve(preflight.subscriptionId);
        if (current.status === 'canceled') {
            throw new Error('Resume cannot prove cancel_at_period_end scheduling because the subscription is already canceled.');
        }
        const cancellationScheduled = current.cancel_at_period_end
            ? current
            : await stripe.subscriptions.update(preflight.subscriptionId, {
                cancel_at_period_end: true,
            }, {
                idempotencyKey: idempotencyKey(preflight.sessionId, 'schedule-cancellation'),
            });
        cancellationPeriodEnd = subscriptionPeriodEnd(cancellationScheduled);
        if (!cancellationScheduled.cancel_at_period_end) {
            throw new Error('Stripe did not schedule cancellation at period end.');
        }
        checkpoint = saveCheckpoint(checkpoint, 'cancellation_scheduled', { cancellationPeriodEnd });
        addStep('cancellation_scheduled', 'Scheduled cancellation at the recovered subscription period end.', {
            cancelAtPeriodEnd: true,
            periodEnd: cancellationPeriodEnd,
        });
    } else {
        cancellationPeriodEnd = requiredCheckpointInteger(
            checkpoint.cancellationPeriodEnd,
            'cancellation period end'
        );
    }

    let deletedEvent: Stripe.Event;
    if (phaseBefore(checkpoint.phase, 'cancellation_completed')) {
        const current = await stripe.subscriptions.retrieve(preflight.subscriptionId);
        if (current.status !== 'canceled') {
            await advanceClockTo(
                stripe,
                preflight,
                cancellationPeriodEnd + 60,
                'cancellation-boundary',
                timeoutMs
            );
        }
        await waitForValue(
            'Stripe subscription cancellation',
            () => stripe.subscriptions.retrieve(preflight.subscriptionId),
            (subscription) => subscription.status === 'canceled',
            timeoutMs
        );
        deletedEvent = await waitForStripeEvent(
            stripe,
            'customer.subscription.deleted',
            new Set(),
            (event) => stripeEventObjectId(event) === preflight.subscriptionId,
            timeoutMs
        );
        await waitForProcessedWebhookSucceeded(supabase, deletedEvent, timeoutMs);
        await waitForLocalSubscriptionStatus(supabase, preflight.subscriptionId, 'cancelled', timeoutMs);
        checkpoint = saveCheckpoint(checkpoint, 'cancellation_completed', {
            cancellationEventId: deletedEvent.id,
        });
        addStep('cancellation_completed', 'Crossed period end and verified the cancellation webhook before local cancellation.', {
            eventId: deletedEvent.id,
            webhookProcessingStatus: 'succeeded',
            localSubscriptionStatus: 'cancelled',
        });
    } else {
        deletedEvent = await requireCheckpointEvent(
            stripe,
            checkpoint.cancellationEventId,
            'customer.subscription.deleted',
            (event) => stripeEventObjectId(event) === preflight.subscriptionId
        );
        await waitForProcessedWebhookSucceeded(supabase, deletedEvent, timeoutMs);
    }

    let partialRefundId: string;
    let partialRefundEvent: Stripe.Event;
    if (phaseBefore(checkpoint.phase, 'partial_refund_completed')) {
        const recoveredCharge = await retrievePaymentIntentCharge(stripe, recoveredPaymentIntentId);
        if (recoveredCharge.amount_refunded === 0) {
            const partialRefund = await stripe.refunds.create({
                payment_intent: recoveredPaymentIntentId,
                amount: refundPlan.partialAmount,
                metadata: {
                    app_environment: 'staging',
                    lifecycle_checkout_session: preflight.sessionId,
                    lifecycle_phase: 'partial',
                },
            }, {
                idempotencyKey: idempotencyKey(preflight.sessionId, 'partial-refund'),
            });
            partialRefundId = partialRefund.id;
            await waitForRefundSucceeded(stripe, partialRefund.id, timeoutMs);
        } else if (recoveredCharge.amount_refunded === refundPlan.partialAmount) {
            partialRefundId = await findRefundIdByAmount(stripe, recoveredPaymentIntentId, refundPlan.partialAmount);
        } else {
            throw new Error('Recovered renewal has an unexpected refund amount; automatic resume is unsafe.');
        }
        partialRefundEvent = await waitForStripeEvent(
            stripe,
            'charge.refunded',
            new Set(),
            (event) => eventChargePaymentIntentId(event) === recoveredPaymentIntentId
                && eventChargeAmountRefunded(event) === refundPlan.partialAmount,
            timeoutMs
        );
        await waitForProcessedWebhookSucceeded(supabase, partialRefundEvent, timeoutMs);
        const partialLocalPayment = await waitForLocalPayment(
            supabase,
            renewalInvoice.id,
            (payment) => payment.status === 'succeeded'
                && payment.amount_refunded === refundPlan.partialAmount,
            timeoutMs
        );
        await assertInitialPaymentStillPreserved(stripe, supabase, preflight);
        checkpoint = saveCheckpoint(checkpoint, 'partial_refund_completed', {
            partialRefundId,
            partialRefundEventId: partialRefundEvent.id,
        });
        report.resources.partialRefundId = partialRefundId;
        addStep('partial_refund', 'Partially refunded only the recovered renewal after its webhook succeeded.', {
            refundId: partialRefundId,
            eventId: partialRefundEvent.id,
            webhookProcessingStatus: 'succeeded',
            amountRefunded: partialLocalPayment.amount_refunded,
            initialPaymentPreserved: true,
        });
    } else {
        partialRefundId = requiredCheckpointValue(checkpoint.partialRefundId, 'partial refund');
        partialRefundEvent = await requireCheckpointEvent(
            stripe,
            checkpoint.partialRefundEventId,
            'charge.refunded',
            (event) => eventChargePaymentIntentId(event) === recoveredPaymentIntentId
                && eventChargeAmountRefunded(event) === refundPlan.partialAmount
        );
        await waitForProcessedWebhookSucceeded(supabase, partialRefundEvent, timeoutMs);
        report.resources.partialRefundId = partialRefundId;
    }

    if (phaseBefore(checkpoint.phase, 'complete')) {
        const recoveredCharge = await retrievePaymentIntentCharge(stripe, recoveredPaymentIntentId);
        let finalRefundId: string;
        if (recoveredCharge.amount_refunded === refundPlan.partialAmount) {
            const finalRefund = await stripe.refunds.create({
                payment_intent: recoveredPaymentIntentId,
                amount: refundPlan.remainingAmount,
                metadata: {
                    app_environment: 'staging',
                    lifecycle_checkout_session: preflight.sessionId,
                    lifecycle_phase: 'remaining',
                },
            }, {
                idempotencyKey: idempotencyKey(preflight.sessionId, 'remaining-refund'),
            });
            finalRefundId = finalRefund.id;
            await waitForRefundSucceeded(stripe, finalRefund.id, timeoutMs);
        } else if (recoveredCharge.amount_refunded === recoveredInvoice.amount_paid) {
            finalRefundId = await findRefundIdByAmount(
                stripe,
                recoveredPaymentIntentId,
                refundPlan.remainingAmount,
                partialRefundId
            );
        } else {
            throw new Error('Recovered renewal is not at the exact partial-refund checkpoint.');
        }
        const finalRefundEvent = await waitForStripeEvent(
            stripe,
            'charge.refunded',
            new Set(),
            (event) => eventChargePaymentIntentId(event) === recoveredPaymentIntentId
                && eventChargeAmountRefunded(event) === recoveredInvoice.amount_paid,
            timeoutMs
        );
        await waitForProcessedWebhookSucceeded(supabase, finalRefundEvent, timeoutMs);
        const fullyRefundedLocalPayment = await waitForLocalPayment(
            supabase,
            renewalInvoice.id,
            (payment) => payment.status === 'refunded'
                && payment.amount_refunded === recoveredInvoice.amount_paid,
            timeoutMs
        );
        await assertRecoveredChargeRefunded(stripe, recoveredPaymentIntentId, recoveredInvoice.amount_paid);
        await assertInitialPaymentStillPreserved(stripe, supabase, preflight);
        checkpoint = saveCheckpoint(checkpoint, 'complete', {
            finalRefundId,
            finalRefundEventId: finalRefundEvent.id,
        });
        report.resources.finalRefundId = finalRefundId;
        addStep('full_refund', 'Refunded the remaining renewal after webhook success and preserved the initial payment.', {
            refundId: finalRefundId,
            eventId: finalRefundEvent.id,
            webhookProcessingStatus: 'succeeded',
            amountRefunded: fullyRefundedLocalPayment.amount_refunded,
            initialPaymentPreserved: true,
        });
    } else {
        report.resources.finalRefundId = requiredCheckpointValue(checkpoint.finalRefundId, 'final refund');
        const finalEvent = await requireCheckpointEvent(
            stripe,
            checkpoint.finalRefundEventId,
            'charge.refunded',
            (event) => eventChargePaymentIntentId(event) === recoveredPaymentIntentId
                && eventChargeAmountRefunded(event) === recoveredInvoice.amount_paid
        );
        await waitForProcessedWebhookSucceeded(supabase, finalEvent, timeoutMs);
        await assertInitialPaymentStillPreserved(stripe, supabase, preflight);
    }

    return checkpoint;
}

async function assertFinalLifecycleState(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    preflight: PreflightResult,
    checkpoint: LifecycleCheckpoint
): Promise<void> {
    if (checkpoint.phase !== 'complete') {
        throw new Error('Lifecycle cannot report OK before reaching the complete checkpoint phase.');
    }

    const renewalInvoiceId = requiredCheckpointValue(checkpoint.renewalInvoiceId, 'renewal invoice');
    const recoveredPaymentIntentId = requiredCheckpointValue(
        checkpoint.recoveredPaymentIntentId,
        'recovered PaymentIntent'
    );
    const stripeSubscription = await stripe.subscriptions.retrieve(preflight.subscriptionId);
    if (stripeSubscription.status !== 'canceled') {
        throw new Error('Final Stripe subscription state is not canceled.');
    }

    const localSubscription = await waitForLocalSubscriptionStatus(
        supabase,
        preflight.subscriptionId,
        'cancelled',
        timeoutMs
    );
    if (
        localSubscription.id !== preflight.localSubscriptionId
        || localSubscription.student_id !== preflight.userId
    ) {
        throw new Error('Final local subscription ownership does not match the lifecycle target.');
    }

    const renewalInvoice = await stripe.invoices.retrieve(renewalInvoiceId);
    if (
        renewalInvoice.status !== 'paid'
        || renewalInvoice.amount_paid <= 1
        || invoiceSubscriptionId(renewalInvoice) !== preflight.subscriptionId
        || stripeObjectId(renewalInvoice.customer) !== preflight.customerId
    ) {
        throw new Error('Final renewal invoice state or ownership is invalid.');
    }
    const paidPaymentIntentId = await requirePaidInvoicePaymentIntentId(stripe, renewalInvoiceId);
    if (paidPaymentIntentId !== recoveredPaymentIntentId) {
        throw new Error('Final renewal InvoicePayment does not match the recovered PaymentIntent.');
    }

    const recoveredLocalPayment = await waitForLocalPayment(
        supabase,
        renewalInvoiceId,
        (payment) => payment.status === 'refunded'
            && payment.amount_refunded === payment.amount
            && payment.amount === renewalInvoice.amount_paid
            && payment.currency === renewalInvoice.currency
            && payment.stripe_payment_intent_id === recoveredPaymentIntentId
            && payment.subscription_id === preflight.localSubscriptionId
            && payment.student_id === preflight.userId,
        timeoutMs
    );
    await assertRecoveredChargeRefunded(
        stripe,
        recoveredPaymentIntentId,
        recoveredLocalPayment.amount
    );
    await assertInitialPaymentStillPreserved(stripe, supabase, preflight);

    addStep('final_state_revalidation', 'Revalidated all final Stripe and Supabase lifecycle outcomes before reporting OK.', {
        stripeSubscriptionStatus: 'canceled',
        localSubscriptionStatus: 'cancelled',
        recoveredLocalPaymentStatus: 'refunded',
        recoveredAmountRefunded: recoveredLocalPayment.amount_refunded,
        recoveredChargeFullyRefunded: true,
        initialPaymentPreserved: true,
    });
}

function buildCanonicalEvidence(
    preflight: PreflightResult,
    checkpoint: LifecycleCheckpoint,
): CanonicalLifecycleEvidence {
    if (checkpoint.phase !== 'complete') {
        throw new Error('Canonical lifecycle evidence requires the complete checkpoint.');
    }
    return {
        schemaVersion: 1,
        status: 'complete',
        stripeAccountId: preflight.accountId,
        supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
        checkoutSessionId: preflight.sessionId,
        customerId: preflight.customerId,
        subscriptionId: preflight.subscriptionId,
        initialInvoiceId: preflight.initialInvoiceId,
        initialPaymentIntentId: preflight.initialPaymentIntentId,
        renewalInvoiceId: requiredCheckpointValue(checkpoint.renewalInvoiceId, 'renewal invoice'),
        recoveredPaymentIntentId: requiredCheckpointValue(
            checkpoint.recoveredPaymentIntentId,
            'recovered PaymentIntent',
        ),
        partialRefundId: requiredCheckpointValue(checkpoint.partialRefundId, 'partial refund'),
        finalRefundId: requiredCheckpointValue(checkpoint.finalRefundId, 'final refund'),
        webhookEventIds: {
            checkoutCompleted: checkpoint.initialCheckoutEventId,
            initialInvoicePaid: checkpoint.initialInvoicePaidEventId,
            upcoming: requiredCheckpointValue(checkpoint.upcomingEventId, 'invoice.upcoming event'),
            renewalFailed: requiredCheckpointValue(checkpoint.renewalFailedEventId, 'renewal failure event'),
            renewalPaid: requiredCheckpointValue(checkpoint.renewalPaidEventId, 'renewal paid event'),
            cancellation: requiredCheckpointValue(checkpoint.cancellationEventId, 'cancellation event'),
            partialRefund: requiredCheckpointValue(checkpoint.partialRefundEventId, 'partial refund event'),
            finalRefund: requiredCheckpointValue(checkpoint.finalRefundEventId, 'final refund event'),
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
}

function readCheckpointForResume(sessionId: string, expectedAccountId: string): LifecycleCheckpoint {
    const file = checkpointPath(sessionId);
    if (!existsSync(file)) {
        throw new Error('--resume requires an existing lifecycle checkpoint; widened fresh preflight is forbidden.');
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as LifecycleCheckpoint;
    if (
        parsed.schemaVersion !== 1
        || !isLifecyclePhase(parsed.phase)
        || parsed.supabaseProjectRef !== STAGING_SUPABASE_PROJECT_REF
        || parsed.stripeAccountId !== expectedAccountId
        || parsed.checkoutSessionId !== sessionId
        || !Number.isInteger(parsed.initialClockFrozenTime)
        || parsed.initialClockFrozenTime <= 0
    ) {
        throw new Error('Lifecycle checkpoint header is invalid for --resume.');
    }
    return parsed;
}

function initializeCheckpoint(
    preflight: PreflightResult,
    resumeCheckpoint: LifecycleCheckpoint | null
): LifecycleCheckpoint {
    if (resumeCheckpoint) {
        validateCheckpoint(resumeCheckpoint, preflight);
        assertCheckpointClockWindow({
            phase: resumeCheckpoint.phase,
            currentFrozenTime: preflight.testClockFrozenTime,
            initialFrozenTime: resumeCheckpoint.initialClockFrozenTime,
            initialPeriodEnd: resumeCheckpoint.initialPeriodEnd,
        });
        report.checkpoint.phase = resumeCheckpoint.phase;
        return resumeCheckpoint;
    }
    const checkpoint: LifecycleCheckpoint = {
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        phase: 'initial_verified',
        supabaseProjectRef: STAGING_SUPABASE_PROJECT_REF,
        stripeAccountId: preflight.accountId,
        checkoutSessionId: preflight.sessionId,
        customerId: preflight.customerId,
        subscriptionId: preflight.subscriptionId,
        testClockId: preflight.testClockId,
        initialInvoiceId: preflight.initialInvoiceId,
        initialPaymentIntentId: preflight.initialPaymentIntentId,
        initialPeriodEnd: preflight.initialPeriodEnd,
        initialClockFrozenTime: preflight.testClockFrozenTime,
        initialCheckoutEventId: preflight.initialCheckoutEventId,
        initialInvoicePaidEventId: preflight.initialInvoicePaidEventId,
    };
    writeCheckpointAtomic(checkpoint);
    report.checkpoint.phase = checkpoint.phase;
    return checkpoint;
}

function saveCheckpoint(
    current: LifecycleCheckpoint,
    phase: LifecyclePhase,
    updates: Partial<LifecycleCheckpoint> = {}
): LifecycleCheckpoint {
    assertLifecyclePhaseTransition(current.phase, phase);
    const next: LifecycleCheckpoint = {
        ...current,
        ...updates,
        schemaVersion: 1,
        phase,
        updatedAt: new Date().toISOString(),
    };
    validateCheckpoint(next, {
        accountId: current.stripeAccountId,
        sessionId: current.checkoutSessionId,
        customerId: current.customerId,
        subscriptionId: current.subscriptionId,
        testClockId: current.testClockId,
        initialInvoiceId: current.initialInvoiceId,
        initialPaymentIntentId: current.initialPaymentIntentId,
        initialPeriodEnd: current.initialPeriodEnd,
        initialCheckoutEventId: current.initialCheckoutEventId,
        initialInvoicePaidEventId: current.initialInvoicePaidEventId,
    });
    writeCheckpointAtomic(next);
    report.checkpoint.phase = next.phase;
    return next;
}

function validateCheckpoint(
    checkpoint: LifecycleCheckpoint,
    expected: Pick<
        PreflightResult,
        'accountId' | 'sessionId' | 'customerId' | 'subscriptionId' | 'testClockId' | 'initialInvoiceId' | 'initialPaymentIntentId' | 'initialPeriodEnd' | 'initialCheckoutEventId' | 'initialInvoicePaidEventId'
    >
): void {
    if (
        checkpoint.schemaVersion !== 1
        || !isLifecyclePhase(checkpoint.phase)
        || checkpoint.supabaseProjectRef !== STAGING_SUPABASE_PROJECT_REF
        || checkpoint.stripeAccountId !== expected.accountId
        || checkpoint.checkoutSessionId !== expected.sessionId
        || checkpoint.customerId !== expected.customerId
        || checkpoint.subscriptionId !== expected.subscriptionId
        || checkpoint.testClockId !== expected.testClockId
        || checkpoint.initialInvoiceId !== expected.initialInvoiceId
        || checkpoint.initialPaymentIntentId !== expected.initialPaymentIntentId
        || checkpoint.initialPeriodEnd !== expected.initialPeriodEnd
        || !Number.isInteger(checkpoint.initialClockFrozenTime)
        || checkpoint.initialClockFrozenTime <= 0
        || checkpoint.initialCheckoutEventId !== expected.initialCheckoutEventId
        || checkpoint.initialInvoicePaidEventId !== expected.initialInvoicePaidEventId
    ) {
        throw new Error('Lifecycle checkpoint identity does not match the read-only preflight.');
    }
}

function writeCheckpointAtomic(checkpoint: LifecycleCheckpoint): void {
    const file = checkpointPath(checkpoint.checkoutSessionId);
    mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    writeFileSync(temporary, JSON.stringify(checkpoint, null, 2), 'utf8');
    renameSync(temporary, file);
}

function checkpointPath(sessionId: string): string {
    return path.join(
        process.cwd(),
        'outputs',
        'launch-staging-billing-lifecycle',
        'checkpoints',
        `${sessionId}.json`
    );
}

function phaseBefore(actual: LifecyclePhase, expected: LifecyclePhase): boolean {
    return lifecyclePhaseIndex(actual) < lifecyclePhaseIndex(expected);
}

async function runReadOnlyPreflight(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    checkoutSessionId: string,
    expectedAccountId: string,
    resumeCheckpoint: LifecycleCheckpoint | null,
): Promise<PreflightResult> {
    const account = await stripe.accounts.retrieve();
    if (account.id !== expectedAccountId) throw new Error('Stripe account mismatch.');
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
    const customerId = requiredStripeId(session.customer, 'Checkout customer');
    const subscriptionId = requiredStripeId(session.subscription, 'Checkout subscription');
    const initialInvoiceId = requiredStripeId(session.invoice, 'Checkout invoice');
    const customerResponse = await stripe.customers.retrieve(customerId);
    const customerDeleted = 'deleted' in customerResponse && customerResponse.deleted === true;
    if (customerDeleted) throw new Error('Checkout customer is deleted.');
    const customer = customerResponse as Stripe.Customer;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const customerTestClockId = requiredStripeId(customer.test_clock, 'Customer Test Clock');
    const subscriptionTestClockId = requiredStripeId(subscription.test_clock, 'Subscription Test Clock');
    const testClock = await stripe.testHelpers.testClocks.retrieve(customerTestClockId);
    const subscriptionEnd = subscriptionPeriodEnd(subscription);
    const initialInvoice = await stripe.invoices.retrieve(initialInvoiceId);
    const initialPeriodEnd = invoicePeriodEnd(initialInvoice);
    const initialInvoicePayment = await requireSinglePaidInvoicePayment(stripe, initialInvoiceId);
    const initialPaymentIntentId = requiredStripeId(
        initialInvoicePayment.payment.payment_intent,
        'Initial InvoicePayment PaymentIntent'
    );
    const initialPaymentIntent = await stripe.paymentIntents.retrieve(initialPaymentIntentId);
    const initialChargeId = requiredStripeId(initialPaymentIntent.latest_charge, 'Initial PaymentIntent charge');
    const initialCharge = await stripe.charges.retrieve(initialChargeId);

    const testClockCustomers: Stripe.Customer[] = [];
    for await (const candidate of stripe.customers.list({ test_clock: testClock.id, limit: 100 })) {
        testClockCustomers.push(candidate);
    }
    const customerSubscriptions: Stripe.Subscription[] = [];
    for await (const candidate of stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
    })) {
        customerSubscriptions.push(candidate);
    }
    const customerSubscriptionSchedules: Stripe.SubscriptionSchedule[] = [];
    for await (const candidate of stripe.subscriptionSchedules.list({ customer: customerId, limit: 100 })) {
        customerSubscriptionSchedules.push(candidate);
    }

    const checkoutUserId = session.metadata?.userId ?? '';
    const checkoutPackagePriceId = session.metadata?.packagePriceId ?? '';
    const { data: checkoutIntent, error: checkoutIntentError } = await supabase
        .from('checkout_intents')
        .select('status, stripe_checkout_session_id, stripe_customer_id, student_id, package_price_id')
        .eq('stripe_checkout_session_id', checkoutSessionId)
        .limit(1)
        .maybeSingle();
    if (checkoutIntentError || !checkoutIntent) {
        throw checkoutIntentError ?? new Error('Completed checkout intent was not found locally.');
    }

    const { data: localSubscription, error: subscriptionError } = await supabase
        .from('subscriptions')
        .select('id, student_id, status, stripe_subscription_id, stripe_invoice_id')
        .eq('stripe_subscription_id', subscriptionId)
        .limit(1)
        .maybeSingle();
    if (subscriptionError || !localSubscription) {
        throw subscriptionError ?? new Error('Stripe subscription was not reconciled locally.');
    }

    const { data: localInitialPayment, error: initialPaymentError } = await supabase
        .from('payments')
        .select('id, student_id, subscription_id, amount, currency, status, stripe_payment_intent_id, stripe_invoice_id, amount_refunded, stripe_refund_id')
        .eq('stripe_invoice_id', initialInvoiceId)
        .limit(1)
        .maybeSingle();
    if (initialPaymentError || !localInitialPayment) {
        throw initialPaymentError ?? new Error('Initial Stripe invoice was not reconciled locally.');
    }

    const [profilePrivateResult, studentProfileResult] = await Promise.all([
        supabase
            .from('profiles_private')
            .select('stripe_customer_id, stripe_customer_account_id, stripe_customer_livemode')
            .eq('profile_id', checkoutUserId)
            .limit(1)
            .maybeSingle(),
        supabase
            .from('profiles')
            .select('id, email, role')
            .eq('id', checkoutUserId)
            .limit(1)
            .maybeSingle(),
    ]);
    const { data: profilePrivate, error: profilePrivateError } = profilePrivateResult;
    if (profilePrivateError || !profilePrivate) {
        throw profilePrivateError ?? new Error('Private profile billing snapshot was not found.');
    }
    const { data: studentProfile, error: studentProfileError } = studentProfileResult;
    if (studentProfileError || !studentProfile?.email || studentProfile.role !== 'student') {
        throw studentProfileError ?? new Error('Lifecycle target is not an emailable staging student.');
    }
    if (
        profilePrivate.stripe_customer_account_id !== expectedAccountId
        || profilePrivate.stripe_customer_livemode !== false
    ) {
        throw new Error('Private profile Stripe account/mode snapshot mismatch.');
    }

    const snapshot: LifecyclePreflightSnapshot = {
        expectedStripeAccountId: expectedAccountId,
        actualStripeAccountId: account.id,
        checkoutSessionId: session.id,
        checkoutSessionLivemode: session.livemode,
        checkoutSessionMode: session.mode,
        checkoutSessionStatus: session.status,
        checkoutPaymentStatus: session.payment_status,
        checkoutCurrency: session.currency,
        checkoutAmountTotal: session.amount_total,
        checkoutCustomerId: customerId,
        checkoutSubscriptionId: subscriptionId,
        checkoutInvoiceId: initialInvoiceId,
        checkoutUserId,
        checkoutClientReferenceId: session.client_reference_id,
        checkoutPackagePriceId,
        customerId: customer.id,
        customerLivemode: customer.livemode,
        customerDeleted,
        customerMetadataUserId: customer.metadata.supabase_user_id ?? null,
        customerMetadataSource: customer.metadata.source ?? null,
        customerTestClockId,
        subscriptionId: subscription.id,
        subscriptionLivemode: subscription.livemode,
        subscriptionStatus: subscription.status,
        subscriptionCustomerId: requiredStripeId(subscription.customer, 'Subscription customer'),
        subscriptionMetadataUserId: subscription.metadata.userId ?? null,
        subscriptionTestClockId,
        subscriptionCollectionMethod: subscription.collection_method,
        subscriptionCancelAtPeriodEnd: subscription.cancel_at_period_end,
        subscriptionPeriodEnd: subscriptionEnd,
        testClockId: testClock.id,
        testClockLivemode: testClock.livemode,
        testClockStatus: testClock.status,
        testClockFrozenTime: testClock.frozen_time,
        testClockDeletesAfter: testClock.deletes_after,
        nowUnix: Math.floor(Date.now() / 1000),
        testClockCustomerIds: testClockCustomers.map((candidate) => candidate.id),
        customerSubscriptionIds: customerSubscriptions.map((candidate) => candidate.id),
        customerSubscriptionScheduleIds: customerSubscriptionSchedules.map((candidate) => candidate.id),
        checkoutIntentStatus: checkoutIntent.status,
        checkoutIntentSessionId: checkoutIntent.stripe_checkout_session_id,
        checkoutIntentCustomerId: checkoutIntent.stripe_customer_id,
        checkoutIntentStudentId: checkoutIntent.student_id,
        checkoutIntentPackagePriceId: checkoutIntent.package_price_id,
        localProfileCustomerId: profilePrivate.stripe_customer_id,
        localSubscriptionId: localSubscription.id,
        localSubscriptionStatus: localSubscription.status ?? 'pending',
        localSubscriptionStudentId: localSubscription.student_id,
        localSubscriptionStripeId: localSubscription.stripe_subscription_id,
        localSubscriptionInvoiceId: localSubscription.stripe_invoice_id,
        localInitialPaymentStatus: localInitialPayment.status ?? 'pending',
        localInitialPaymentStudentId: localInitialPayment.student_id,
        localInitialPaymentSubscriptionId: localInitialPayment.subscription_id,
        localInitialPaymentInvoiceId: localInitialPayment.stripe_invoice_id,
        localInitialPaymentIntentId: localInitialPayment.stripe_payment_intent_id,
        localInitialPaymentAmount: localInitialPayment.amount,
        localInitialPaymentCurrency: localInitialPayment.currency ?? '',
        localInitialPaymentAmountRefunded: localInitialPayment.amount_refunded,
        initialStripeInvoiceStatus: initialInvoice.status,
        initialStripeInvoiceCustomerId: requiredStripeId(initialInvoice.customer, 'Initial invoice customer'),
        initialStripeInvoiceSubscriptionId: invoiceSubscriptionId(initialInvoice),
        initialStripeInvoiceAmountPaid: initialInvoice.amount_paid,
        initialStripeInvoiceCurrency: initialInvoice.currency,
        initialStripeInvoicePeriodEnd: initialPeriodEnd,
        initialInvoicePaymentStatus: initialInvoicePayment.status,
        initialInvoicePaymentLivemode: initialInvoicePayment.livemode,
        initialInvoicePaymentInvoiceId: requiredStripeId(initialInvoicePayment.invoice, 'InvoicePayment invoice'),
        initialInvoicePaymentAmountPaid: initialInvoicePayment.amount_paid,
        initialInvoicePaymentAmountRequested: initialInvoicePayment.amount_requested,
        initialInvoicePaymentCurrency: initialInvoicePayment.currency,
        initialInvoicePaymentIntentId: initialPaymentIntentId,
        initialStripePaymentIntentId: initialPaymentIntent.id,
        initialStripePaymentIntentLivemode: initialPaymentIntent.livemode,
        initialStripePaymentIntentStatus: initialPaymentIntent.status,
        initialStripePaymentIntentCustomerId: requiredStripeId(
            initialPaymentIntent.customer,
            'Initial PaymentIntent customer'
        ),
        initialStripePaymentIntentAmount: initialPaymentIntent.amount,
        initialStripePaymentIntentAmountReceived: initialPaymentIntent.amount_received,
        initialStripePaymentIntentCurrency: initialPaymentIntent.currency,
        initialStripePaymentIntentLatestChargeId: initialChargeId,
        initialStripeChargeId: initialCharge.id,
        initialStripeChargeLivemode: initialCharge.livemode,
        initialStripeChargeStatus: initialCharge.status,
        initialStripeChargePaid: initialCharge.paid,
        initialStripeChargeCustomerId: requiredStripeId(initialCharge.customer, 'Initial charge customer'),
        initialStripeChargePaymentIntentId: requiredStripeId(
            initialCharge.payment_intent,
            'Initial charge PaymentIntent'
        ),
        initialStripeChargeAmount: initialCharge.amount,
        initialStripeChargeCurrency: initialCharge.currency,
        initialStripeChargeRefunded: initialCharge.refunded,
        initialStripeChargeAmountRefunded: initialCharge.amount_refunded,
    };
    assertLifecyclePreflight(snapshot, { resume: resumeCheckpoint !== null });
    if (resumeCheckpoint) {
        assertResumePhaseState({
            phase: resumeCheckpoint.phase,
            stripeSubscriptionStatus: subscription.status,
            localSubscriptionStatus: localSubscription.status ?? 'pending',
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
    }

    const targetStudentEmail = normalizeEmail(studentProfile.email);
    const expectedStudentEmail = normalizeEmail(requiredEnv('TEST_STUDENT_EMAIL'));
    if (targetStudentEmail !== expectedStudentEmail) {
        throw new Error('Lifecycle Checkout owner is not the exact allowlisted staging student.');
    }
    const runtimeVerification = await verifyDeployedStagingRuntime({
        baseOrigin: STAGING_WEB_ORIGIN,
        env: process.env,
        expectedWebCheckoutOverride: 'false',
        fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
        roleEmails: [
            requiredEnv('TEST_ADMIN_EMAIL'),
            requiredEnv('TEST_TEACHER_EMAIL'),
            requiredEnv('TEST_STUDENT_EMAIL'),
        ],
    });
    const webhookEndpointId = await assertLifecycleWebhookDestinations(stripe);
    const emailBudget = await readEmailBudgetUsage(supabase);
    const upcomingAlreadyDelivered = resumeCheckpoint !== null
        && !phaseBefore(resumeCheckpoint.phase, 'upcoming_observed');
    if (!upcomingAlreadyDelivered && (emailBudget.dailyUsed >= 10 || emailBudget.monthlyUsed >= 100)) {
        throw new Error('Staging Resend recipient budget has no room for the renewal notice.');
    }

    const initialCheckoutEvent = await waitForStripeEvent(
        stripe,
        'checkout.session.completed',
        new Set(),
        (event) => stripeEventObjectId(event) === session.id,
        timeoutMs
    );
    await waitForProcessedWebhookSucceeded(supabase, initialCheckoutEvent, timeoutMs);
    const initialInvoicePaidEvent = await waitForStripeEvent(
        stripe,
        'invoice.paid',
        new Set(),
        (event) => stripeEventObjectId(event) === initialInvoice.id,
        timeoutMs
    );
    await waitForProcessedWebhookSucceeded(supabase, initialInvoicePaidEvent, timeoutMs);

    return {
        accountId: account.id,
        sessionId: session.id,
        userId: checkoutUserId,
        customerId,
        subscriptionId,
        testClockId: testClock.id,
        initialInvoiceId,
        initialPaymentIntentId,
        initialChargeId,
        initialCheckoutEventId: initialCheckoutEvent.id,
        initialInvoicePaidEventId: initialInvoicePaidEvent.id,
        initialPaymentId: localInitialPayment.id,
        localSubscriptionId: localSubscription.id,
        subscriptionPeriodEnd: subscriptionEnd,
        subscriptionStatus: subscription.status,
        localSubscriptionStatus: localSubscription.status ?? 'pending',
        initialPeriodEnd,
        testClockFrozenTime: testClock.frozen_time,
        lifecycleWebhookEndpointId: webhookEndpointId,
        emailDailyUsed: emailBudget.dailyUsed,
        emailMonthlyUsed: emailBudget.monthlyUsed,
        webVersionId: runtimeVerification.webVersionId,
        fulfillmentVersionId: runtimeVerification.fulfillmentVersionId,
    };
}

async function assertLifecycleWebhookDestinations(stripe: Stripe): Promise<string> {
    const endpoints: Array<{
        id: string;
        url: string;
        status: string;
        enabledEvents: string[];
    }> = [];
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
        endpoints.push({
            id: endpoint.id,
            url: endpoint.url,
            status: endpoint.status,
            enabledEvents: [...endpoint.enabled_events],
        });
    }
    return assertExclusiveLifecycleWebhookDestination(endpoints);
}

async function readEmailBudgetUsage(
    supabase: SupabaseClient<Database>,
): Promise<{ dailyUsed: number; monthlyUsed: number }> {
    const now = new Date();
    const dayStart = now.toISOString().slice(0, 10);
    const monthStart = `${dayStart.slice(0, 7)}-01`;
    const { data, error } = await supabase
        .from('email_recipient_budget_usage')
        .select('period_kind, period_start, recipient_count')
        .eq('budget_scope', 'nonproduction')
        .in('period_kind', ['day', 'month']);
    if (error) throw error;
    const dailyUsed = data?.find((row) => row.period_kind === 'day' && row.period_start === dayStart)
        ?.recipient_count ?? 0;
    const monthlyUsed = data?.find((row) => row.period_kind === 'month' && row.period_start === monthStart)
        ?.recipient_count ?? 0;
    if (!Number.isInteger(dailyUsed) || dailyUsed < 0 || !Number.isInteger(monthlyUsed) || monthlyUsed < 0) {
        throw new Error('Staging email budget usage is invalid.');
    }
    return { dailyUsed, monthlyUsed };
}

async function setDefaultPaymentMethod(
    stripe: Stripe,
    preflight: PreflightResult,
    testPaymentMethod: string,
    phase: 'failure' | 'recovery'
): Promise<string> {
    const attached = await stripe.paymentMethods.attach(testPaymentMethod, {
        customer: preflight.customerId,
    }, {
        idempotencyKey: idempotencyKey(preflight.sessionId, `${phase}-attach`),
    });
    if (requiredStripeId(attached.customer, 'Attached PaymentMethod customer') !== preflight.customerId) {
        throw new Error('Attached PaymentMethod belongs to a different customer.');
    }

    await stripe.customers.update(preflight.customerId, {
        invoice_settings: { default_payment_method: attached.id },
    }, {
        idempotencyKey: idempotencyKey(preflight.sessionId, `${phase}-customer-default`),
    });
    await stripe.subscriptions.update(preflight.subscriptionId, {
        default_payment_method: attached.id,
    }, {
        idempotencyKey: idempotencyKey(preflight.sessionId, `${phase}-subscription-default`),
    });

    const customerResponse = await stripe.customers.retrieve(preflight.customerId);
    if ('deleted' in customerResponse && customerResponse.deleted) {
        throw new Error('Customer was deleted while setting the default PaymentMethod.');
    }
    const customer = customerResponse as Stripe.Customer;
    const subscription = await stripe.subscriptions.retrieve(preflight.subscriptionId);
    if (
        requiredStripeId(customer.invoice_settings.default_payment_method, 'Customer default PaymentMethod') !== attached.id
        || requiredStripeId(subscription.default_payment_method, 'Subscription default PaymentMethod') !== attached.id
    ) {
        throw new Error('PaymentMethod default verification failed.');
    }
    return attached.id;
}

async function ensureDefaultPaymentMethod(
    stripe: Stripe,
    preflight: PreflightResult,
    testPaymentMethod: typeof FAILING_PAYMENT_METHOD | typeof RECOVERY_PAYMENT_METHOD,
    phase: 'failure' | 'recovery'
): Promise<string> {
    const customerResponse = await stripe.customers.retrieve(preflight.customerId);
    if ('deleted' in customerResponse && customerResponse.deleted) {
        throw new Error('Target customer was deleted during lifecycle resume.');
    }
    const customer = customerResponse as Stripe.Customer;
    const subscription = await stripe.subscriptions.retrieve(preflight.subscriptionId);
    const customerDefault = stripeObjectId(customer.invoice_settings.default_payment_method);
    const subscriptionDefault = stripeObjectId(subscription.default_payment_method);
    if (customerDefault && customerDefault === subscriptionDefault) {
        const paymentMethod = await stripe.paymentMethods.retrieve(customerDefault);
        const expectedLast4 = testPaymentMethod === FAILING_PAYMENT_METHOD ? '0341' : '4242';
        if (
            stripeObjectId(paymentMethod.customer) === preflight.customerId
            && paymentMethod.type === 'card'
            && paymentMethod.card?.last4 === expectedLast4
        ) {
            return paymentMethod.id;
        }
    }
    return setDefaultPaymentMethod(stripe, preflight, testPaymentMethod, phase);
}

async function advanceClockTo(
    stripe: Stripe,
    preflight: PreflightResult,
    target: number,
    phase: string,
    timeout: number
): Promise<Stripe.TestHelpers.TestClock> {
    const before = await stripe.testHelpers.testClocks.retrieve(preflight.testClockId);
    if (before.status !== 'ready') throw new Error(`Test Clock is not ready before ${phase}.`);
    if (before.livemode) throw new Error('Live Test Clock mutation is forbidden.');
    if (target <= before.frozen_time) return before;

    await stripe.testHelpers.testClocks.advance(preflight.testClockId, {
        frozen_time: target,
    }, {
        idempotencyKey: idempotencyKey(preflight.sessionId, `clock-${phase}`),
    });
    return waitForValue(
        `Test Clock ${phase}`,
        async () => {
            const clock = await stripe.testHelpers.testClocks.retrieve(preflight.testClockId);
            if (clock.status === 'internal_failure') {
                throw new Error(`Test Clock entered internal_failure during ${phase}.`);
            }
            return clock;
        },
        (clock) => clock.status === 'ready' && clock.frozen_time >= target,
        timeout
    );
}

async function captureMatchingEventIds(
    stripe: Stripe,
    type: string,
    predicate: (event: Stripe.Event) => boolean
): Promise<Set<string>> {
    const events = await stripe.events.list({ type, limit: 100 });
    return new Set(events.data.filter(predicate).map((event) => event.id));
}

async function findStripeEvent(
    stripe: Stripe,
    type: string,
    baseline: Set<string>,
    predicate: (event: Stripe.Event) => boolean
): Promise<Stripe.Event | null> {
    const events = await stripe.events.list({ type, limit: 100 });
    return events.data.find((event) => !baseline.has(event.id) && predicate(event)) ?? null;
}

async function waitForStripeEvent(
    stripe: Stripe,
    type: string,
    baseline: Set<string>,
    predicate: (event: Stripe.Event) => boolean,
    timeout: number
): Promise<Stripe.Event> {
    return waitForValue(
        `${type} event`,
        () => findStripeEvent(stripe, type, baseline, predicate),
        (event): event is Stripe.Event => Boolean(event),
        timeout
    );
}

async function assertNoNewStripeEvent(
    stripe: Stripe,
    type: string,
    baseline: Set<string>,
    predicate: (event: Stripe.Event) => boolean,
    observationMs: number
): Promise<void> {
    const deadline = Date.now() + observationMs;
    while (Date.now() < deadline) {
        const event = await findStripeEvent(stripe, type, baseline, predicate);
        if (event) throw new Error(`${type} arrived before the documented 15-day boundary.`);
        await delay(1_000);
    }
}

async function waitForProcessedWebhookSucceeded(
    supabase: SupabaseClient<Database>,
    event: Stripe.Event,
    timeout: number
): Promise<void> {
    await waitForValue(
        `processed webhook ${event.id}`,
        async () => {
            const { data, error } = await supabase
                .from('processed_webhook_events')
                .select('stripe_event_id, event_type, processing_status, processing_error, processed_at')
                .eq('stripe_event_id', event.id)
                .maybeSingle();
            if (error) throw error;
            if (data && data.event_type !== event.type) {
                throw new Error('Processed webhook event type does not match Stripe.');
            }
            return data;
        },
        (row) => row?.processing_status === 'succeeded'
            && row.processing_error === null
            && Boolean(row.processed_at),
        timeout
    );
}

async function waitForRenewalNoticeJob(
    supabase: SupabaseClient<Database>,
    preflight: PreflightResult,
    upcomingEvent: Stripe.Event,
    timeout: number
): Promise<void> {
    const invoice = upcomingEvent.data.object as Stripe.Invoice;
    const renewalAt = new Date(preflight.initialPeriodEnd * 1000).toISOString();
    const dedupeKey = `renewal_notice:${preflight.subscriptionId}:${renewalAt}`;
    await waitForValue(
        'durable renewal_notice fulfillment job',
        async () => {
            const { data, error } = await supabase
                .from('fulfillment_jobs')
                .select('id, job_type, status, subscription_id, student_id, dedupe_key, payload, last_error')
                .eq('job_type', 'renewal_notice')
                .eq('dedupe_key', dedupeKey)
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            if (data?.status === 'cancelled') {
                throw new Error('The durable renewal_notice job was cancelled.');
            }
            return data;
        },
        (job) => {
            if (!job || job.status !== 'succeeded' || job.last_error !== null) return false;
            const payload = jsonRecord(job.payload);
            return job.job_type === 'renewal_notice'
                && job.subscription_id === preflight.localSubscriptionId
                && job.student_id === preflight.userId
                && job.dedupe_key === dedupeKey
                && payload.stripeEventId === upcomingEvent.id
                && payload.stripeSubscriptionId === preflight.subscriptionId
                && payload.subscriptionId === preflight.localSubscriptionId
                && payload.renewalAt === renewalAt
                && payload.cancelBy === renewalAt
                && payload.amountTotal === Math.max(0, invoice.amount_due ?? invoice.total ?? 0)
                && payload.currency === (invoice.currency ?? 'eur');
        },
        timeout
    );
}

async function requireCheckpointEvent(
    stripe: Stripe,
    eventId: string | undefined,
    expectedType: string,
    predicate: (event: Stripe.Event) => boolean
): Promise<Stripe.Event> {
    const event = await stripe.events.retrieve(requiredCheckpointValue(eventId, `${expectedType} event`));
    if (event.type !== expectedType || !predicate(event)) {
        throw new Error(`Checkpoint ${expectedType} event does not match the target resource.`);
    }
    return event;
}

function requiredCheckpointValue(value: string | undefined, label: string): string {
    if (!value) throw new Error(`Lifecycle checkpoint is missing ${label}.`);
    return value;
}

function requiredCheckpointInteger(value: number | undefined, label: string): number {
    if (!Number.isInteger(value) || (value ?? 0) <= 0) {
        throw new Error(`Lifecycle checkpoint has invalid ${label}.`);
    }
    return value as number;
}

function requiredCheckpointArray(value: string[] | undefined, label: string): string[] {
    if (!Array.isArray(value)) throw new Error(`Lifecycle checkpoint is missing ${label}.`);
    return value;
}

function jsonRecord(value: Database['public']['Tables']['fulfillment_jobs']['Row']['payload']): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function findRenewalInvoice(
    stripe: Stripe,
    subscriptionId: string,
    initialInvoiceId: string
): Promise<Stripe.Invoice | null> {
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 100 });
    return invoices.data
        .filter((invoice) => invoice.id !== initialInvoiceId && invoice.billing_reason === 'subscription_cycle')
        .sort((left, right) => right.created - left.created)[0] ?? null;
}

async function requirePaidInvoicePaymentIntentId(stripe: Stripe, invoiceId: string): Promise<string> {
    const invoicePayment = await requireSinglePaidInvoicePayment(stripe, invoiceId);
    return requiredStripeId(invoicePayment.payment.payment_intent, 'Paid renewal PaymentIntent');
}

async function requireSinglePaidInvoicePayment(
    stripe: Stripe,
    invoiceId: string
): Promise<Stripe.InvoicePayment> {
    const invoicePayments = await stripe.invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 100 });
    const paidPaymentIntents = invoicePayments.data.filter((candidate) => (
        candidate.status === 'paid'
        && candidate.payment.type === 'payment_intent'
        && candidate.payment.payment_intent
    ));
    if (paidPaymentIntents.length !== 1) {
        throw new Error('Invoice must have exactly one paid InvoicePayment backed by a PaymentIntent.');
    }
    return paidPaymentIntents[0];
}

async function waitForLocalPayment(
    supabase: SupabaseClient<Database>,
    invoiceId: string,
    predicate: (payment: LocalPayment) => boolean,
    timeout: number
): Promise<LocalPayment> {
    return waitForValue(
        `local payment for ${invoiceId}`,
        async () => {
            const { data, error } = await supabase
                .from('payments')
                .select('id, student_id, subscription_id, amount, currency, status, stripe_payment_intent_id, stripe_invoice_id, amount_refunded, stripe_refund_id')
                .eq('stripe_invoice_id', invoiceId)
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            return data as LocalPayment | null;
        },
        (payment): payment is LocalPayment => Boolean(payment && predicate(payment)),
        timeout
    );
}

async function waitForLocalSubscriptionStatus(
    supabase: SupabaseClient<Database>,
    stripeSubscriptionId: string,
    expectedStatus: string,
    timeout: number
): Promise<LocalSubscription> {
    return waitForValue(
        `local subscription ${expectedStatus}`,
        async () => {
            const { data, error } = await supabase
                .from('subscriptions')
                .select('id, student_id, status, stripe_subscription_id, stripe_invoice_id')
                .eq('stripe_subscription_id', stripeSubscriptionId)
                .limit(1)
                .maybeSingle();
            if (error) throw error;
            return data as LocalSubscription | null;
        },
        (subscription): subscription is LocalSubscription => subscription?.status === expectedStatus,
        timeout
    );
}

async function waitForRefundSucceeded(stripe: Stripe, refundId: string, timeout: number): Promise<Stripe.Refund> {
    return waitForValue(
        `refund ${refundId}`,
        () => stripe.refunds.retrieve(refundId),
        (refund) => refund.status === 'succeeded',
        timeout
    );
}

async function retrievePaymentIntentCharge(stripe: Stripe, paymentIntentId: string): Promise<Stripe.Charge> {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.livemode) throw new Error('Lifecycle PaymentIntent unexpectedly belongs to live mode.');
    const chargeId = requiredStripeId(paymentIntent.latest_charge, 'Lifecycle PaymentIntent charge');
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.livemode || stripeObjectId(charge.payment_intent) !== paymentIntentId) {
        throw new Error('Lifecycle charge ownership/mode mismatch.');
    }
    return charge;
}

async function findRefundIdByAmount(
    stripe: Stripe,
    paymentIntentId: string,
    amount: number,
    excludeId?: string
): Promise<string> {
    const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
    const matches = refunds.data
        .filter((refund) => refund.id !== excludeId && refund.status === 'succeeded' && refund.amount === amount)
        .sort((left, right) => right.created - left.created);
    if (matches.length !== 1) {
        throw new Error('Could not identify exactly one succeeded refund for the resumable phase.');
    }
    return matches[0].id;
}

async function assertRecoveredChargeRefunded(
    stripe: Stripe,
    paymentIntentId: string,
    expectedAmount: number
): Promise<void> {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.livemode) throw new Error('Recovered PaymentIntent unexpectedly belongs to live mode.');
    const chargeId = requiredStripeId(paymentIntent.latest_charge, 'Recovered PaymentIntent charge');
    const charge = await stripe.charges.retrieve(chargeId);
    if (
        charge.livemode
        || stripeObjectId(charge.payment_intent) !== paymentIntentId
        || charge.amount !== expectedAmount
        || !charge.refunded
        || charge.amount_refunded !== charge.amount
    ) {
        throw new Error('Recovered renewal charge is not fully refunded.');
    }
}

async function assertInitialPaymentStillPreserved(
    stripe: Stripe,
    supabase: SupabaseClient<Database>,
    preflight: PreflightResult
): Promise<void> {
    const { data: payment, error } = await supabase
        .from('payments')
        .select('status, amount_refunded, stripe_payment_intent_id')
        .eq('id', preflight.initialPaymentId)
        .single();
    if (error || !payment) throw error ?? new Error('Initial local payment disappeared.');
    if (payment.stripe_payment_intent_id !== preflight.initialPaymentIntentId) {
        throw new Error('Initial local PaymentIntent changed.');
    }
    assertInitialPaymentPreserved({
        status: payment.status ?? 'pending',
        amountRefunded: payment.amount_refunded,
    });

    const paymentIntent = await stripe.paymentIntents.retrieve(preflight.initialPaymentIntentId);
    if (paymentIntent.livemode) throw new Error('Initial PaymentIntent unexpectedly belongs to live mode.');
    const chargeId = requiredStripeId(paymentIntent.latest_charge, 'Initial PaymentIntent charge');
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.refunded || charge.amount_refunded !== 0) {
        throw new Error('Initial Stripe charge was refunded.');
    }
}

async function waitForValue<T, U extends T>(
    label: string,
    read: () => Promise<T>,
    predicate: (value: T) => value is U,
    timeout: number
): Promise<U>;
async function waitForValue<T>(
    label: string,
    read: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeout: number
): Promise<T>;
async function waitForValue<T>(
    label: string,
    read: () => Promise<T>,
    predicate: (value: T) => boolean,
    timeout: number
): Promise<T> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await read();
        if (predicate(value)) return value;
        await delay(2_000);
    }
    throw new Error(`${label} did not converge within the configured timeout.`);
}

function stripeEventObjectId(event: Stripe.Event): string | null {
    const object = event.data.object as { id?: string };
    return object.id ?? null;
}

function eventInvoiceSubscriptionId(event: Stripe.Event): string | null {
    const invoice = event.data.object as Stripe.Invoice;
    const current = invoice.parent?.subscription_details?.subscription;
    if (current) return stripeObjectId(current);
    const legacy = invoice as unknown as { subscription?: string | { id: string } | null };
    return stripeObjectId(legacy.subscription);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string {
    const current = invoice.parent?.subscription_details?.subscription;
    if (current) return requiredStripeId(current, 'Invoice subscription');
    const legacy = invoice as unknown as { subscription?: string | { id: string } | null };
    return requiredStripeId(legacy.subscription, 'Invoice subscription');
}

function invoicePeriodEnd(invoice: Stripe.Invoice): number {
    const periodEnds = invoice.lines.data
        .map((line) => line.period?.end)
        .filter((value): value is number => Number.isInteger(value) && (value ?? 0) > 0);
    if (periodEnds.length === 0) throw new Error('Initial invoice has no valid line period end.');
    return Math.max(...periodEnds);
}

function eventChargePaymentIntentId(event: Stripe.Event): string | null {
    const charge = event.data.object as Stripe.Charge;
    return stripeObjectId(charge.payment_intent);
}

function eventChargeAmountRefunded(event: Stripe.Event): number | null {
    const charge = event.data.object as Stripe.Charge;
    return Number.isInteger(charge.amount_refunded) ? charge.amount_refunded : null;
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription): number {
    const periodEnds = subscription.items.data.map((item) => item.current_period_end);
    if (periodEnds.length === 0 || periodEnds.some((value) => !Number.isInteger(value) || value <= 0)) {
        throw new Error('Subscription has no valid item current_period_end.');
    }
    const uniquePeriodEnds = new Set(periodEnds);
    if (uniquePeriodEnds.size !== 1) {
        throw new Error('Subscription items do not share one cancellation period end.');
    }
    return periodEnds[0] as number;
}

function requiredStripeId(value: string | { id: string } | null | undefined, label: string): string {
    const id = stripeObjectId(value);
    if (!id) throw new Error(`${label} is missing.`);
    return id;
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
    if (typeof value === 'string') return value;
    return value?.id ?? null;
}

function idempotencyKey(sessionId: string, phase: string): string {
    return `staging-billing-lifecycle:${sessionId}:${phase}`;
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

function addStep(name: string, message: string, details?: Record<string, EvidenceValue>): void {
    report.steps.push({ name, status: 'ok', at: new Date().toISOString(), message, details });
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is missing.`);
    return value;
}

function argumentValue(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    return value;
}

function boundedInteger(value: string, min: number, max: number, label: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${label} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function renderMarkdown(value: LifecycleReport): string {
    const lines = [
        '# Staging Stripe Billing Lifecycle Evidence',
        '',
        `- Status: ${value.status}`,
        `- Mode: ${value.mode}`,
        `- Started: ${value.startedAt}`,
        `- Ended: ${value.endedAt}`,
        `- Supabase project: ${value.scope.supabaseProjectRef}`,
        `- Stripe account: ${value.scope.stripeAccountId ?? 'not verified'}`,
        '- Stripe mode: test',
        '- Production/live mode: excluded',
        `- Checkout Session: ${value.resources.checkoutSessionId ?? 'not verified'}`,
        `- Subscription: ${value.resources.subscriptionId ?? 'not verified'}`,
        `- Test Clock: ${value.resources.testClockId ?? 'not verified'}`,
        `- Checkpoint: ${value.checkpoint.path ?? 'not initialized'}`,
        `- Checkpoint phase: ${value.checkpoint.phase ?? 'not initialized'}`,
        `- Resume requested: ${value.checkpoint.resumeRequested}`,
        '',
        '## Safety Scope',
        '',
        'The runner loads `.env.staging`, rejects non-test Stripe keys and non-staging Supabase projects, proves the initial invoice through InvoicePayment, PaymentIntent and Charge, verifies Test Clock exclusivity, captures the existing-event baseline before any Stripe mutation, tests the exact 15-day upcoming boundary, and requires every observed webhook to finish with `processing_status=succeeded`. It does not create synthetic webhook events, touch Cloudflare, delete the Test Clock, refund the initial payment, print secrets, or store customer email addresses.',
        '',
        'Resume is bounded and fail-closed: checkpoints are written atomically and bound to the exact account/session/customer/subscription/clock. `--resume` refuses to run without an existing validated checkpoint, accepts only the exact phase-specific Test Clock crash windows around the 15-day boundary, and refuses cancellation state where prior scheduling can no longer be proven.',
        '',
        '## Steps',
        '',
        '| Status | Step | Message | Evidence |',
        '| --- | --- | --- | --- |',
    ];
    for (const step of value.steps) {
        const details = step.details
            ? Object.entries(step.details).map(([key, detail]) => `${key}=${String(detail)}`).join(' / ')
            : '';
        lines.push(`| ${step.status} | ${escapeCell(step.name)} | ${escapeCell(step.message)} | ${escapeCell(details)} |`);
    }
    if (value.error) lines.push('', '## Error', '', sanitizeLifecycleText(value.error), '');
    lines.push(
        '',
        '## Resulting Resources',
        '',
        `- Initial invoice: ${value.resources.initialInvoiceId ?? 'not observed'}`,
        `- Initial PaymentIntent (preserved): ${value.resources.initialPaymentIntentId ?? 'not observed'}`,
        `- Renewal invoice: ${value.resources.renewalInvoiceId ?? 'not observed'}`,
        `- Recovered renewal PaymentIntent: ${value.resources.recoveredPaymentIntentId ?? 'not observed'}`,
        `- Partial refund: ${value.resources.partialRefundId ?? 'not observed'}`,
        `- Remaining refund: ${value.resources.finalRefundId ?? 'not observed'}`,
        '',
        'No secret values or customer email addresses are included in this report.',
        ''
    );
    return `${lines.join('\n')}\n`;
}

function escapeCell(value: string): string {
    return sanitizeLifecycleText(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}
