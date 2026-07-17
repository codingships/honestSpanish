export const STAGING_SUPABASE_PROJECT_REF = 'mzjyvmlxfpzdfdjzxxyj';
export const STRIPE_API_VERSION = '2026-02-25.clover' as const;
export const FAILING_PAYMENT_METHOD = 'pm_card_chargeCustomerFail';
export const RECOVERY_PAYMENT_METHOD = 'pm_card_visa';
export const LIFECYCLE_CONFIRMATION_ENV = 'STAGING_BILLING_LIFECYCLE_CONFIRMATION';
export const UPCOMING_NOTICE_CONFIRMATION_ENV = 'STAGING_BILLING_UPCOMING_NOTICE_15_DAY_CONFIRMATION';
export const INVOICE_UPCOMING_NOTICE_DAYS = 15;
export const INVOICE_UPCOMING_NOTICE_SECONDS = INVOICE_UPCOMING_NOTICE_DAYS * 24 * 60 * 60;
export const INVOICE_UPCOMING_BOUNDARY_MARGIN_SECONDS = 60;
export const RENEWAL_FINALIZATION_OFFSET_SECONDS = 7_200;
export const STAGING_STRIPE_WEBHOOK_ENDPOINT_URL = 'https://staging.espanolhonesto.com/api/stripe-webhook';
export const LIFECYCLE_WEBHOOK_EVENT_TYPES = [
    'checkout.session.completed',
    'invoice.upcoming',
    'invoice.payment_failed',
    'invoice.paid',
    'customer.subscription.deleted',
    'charge.refunded',
] as const;
export const LIFECYCLE_PHASES = [
    'initial_verified',
    'upcoming_baseline_captured',
    'upcoming_before_boundary_verified',
    'warmup_renewal_preserved',
    'transition_notice_verified',
    'recovery_upcoming_baseline_captured',
    'recovery_upcoming_before_boundary_verified',
    'upcoming_observed',
    'failure_payment_method_set',
    'renewal_failed',
    'renewal_recovered',
    'cancellation_scheduled',
    'cancellation_completed',
    'partial_refund_completed',
    'complete',
] as const;
export type LifecyclePhase = typeof LIFECYCLE_PHASES[number];
export type LifecycleStrategy = 'first_period' | 'second_period_recovery';

const CHECKOUT_SESSION_PATTERN = /^cs_test_[A-Za-z0-9_]+$/;
const CUSTOMER_PATTERN = /^cus_[A-Za-z0-9_]+$/;
const SUBSCRIPTION_PATTERN = /^sub_[A-Za-z0-9_]+$/;
const INVOICE_PATTERN = /^in_[A-Za-z0-9_]+$/;
const PAYMENT_INTENT_PATTERN = /^pi_[A-Za-z0-9_]+$/;
const TEST_CLOCK_PATTERN = /^clock_[A-Za-z0-9_]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface LifecycleEnvironmentInput {
    stripeSecretKey?: string;
    stripePublishableKey?: string;
    stripeExpectedAccountId?: string;
    publicAppEnvironment?: string;
    supabaseUrl?: string;
    supabaseExpectedProjectRef?: string;
    supabaseServiceRoleKey?: string;
    checkoutSessionId?: string;
    confirmation?: string;
}

export interface ValidatedLifecycleEnvironment {
    checkoutSessionId: string;
    stripeExpectedAccountId: string;
    supabaseProjectRef: string;
}

export interface LifecyclePreflightSnapshot {
    expectedStripeAccountId: string;
    actualStripeAccountId: string;
    checkoutSessionId: string;
    checkoutSessionLivemode: boolean;
    checkoutSessionMode: string | null;
    checkoutSessionStatus: string | null;
    checkoutPaymentStatus: string;
    checkoutCurrency: string | null;
    checkoutAmountTotal: number | null;
    checkoutCustomerId: string;
    checkoutSubscriptionId: string;
    checkoutInvoiceId: string;
    checkoutUserId: string;
    checkoutClientReferenceId: string | null;
    checkoutPackagePriceId: string;
    customerId: string;
    customerLivemode: boolean;
    customerDeleted: boolean;
    customerMetadataUserId: string | null;
    customerMetadataSource: string | null;
    customerTestClockId: string;
    subscriptionId: string;
    subscriptionLivemode: boolean;
    subscriptionStatus: string;
    subscriptionCustomerId: string;
    subscriptionMetadataUserId: string | null;
    subscriptionTestClockId: string;
    subscriptionCollectionMethod: string;
    subscriptionCancelAtPeriodEnd: boolean;
    subscriptionPeriodEnd: number;
    testClockId: string;
    testClockLivemode: boolean;
    testClockStatus: string;
    testClockFrozenTime: number;
    testClockDeletesAfter: number;
    nowUnix: number;
    testClockCustomerIds: string[];
    customerSubscriptionIds: string[];
    customerSubscriptionScheduleIds: string[];
    checkoutIntentStatus: string;
    checkoutIntentSessionId: string | null;
    checkoutIntentCustomerId: string | null;
    checkoutIntentStudentId: string;
    checkoutIntentPackagePriceId: string;
    localProfileCustomerId: string | null;
    localSubscriptionId: string;
    localSubscriptionStatus: string;
    localSubscriptionStudentId: string;
    localSubscriptionStripeId: string | null;
    localSubscriptionInvoiceId: string | null;
    localInitialPaymentStatus: string;
    localInitialPaymentStudentId: string;
    localInitialPaymentSubscriptionId: string | null;
    localInitialPaymentInvoiceId: string | null;
    localInitialPaymentIntentId: string | null;
    localInitialPaymentAmount: number;
    localInitialPaymentCurrency: string;
    localInitialPaymentAmountRefunded: number;
    initialStripeInvoiceStatus: string | null;
    initialStripeInvoiceCustomerId: string;
    initialStripeInvoiceSubscriptionId: string;
    initialStripeInvoiceAmountPaid: number;
    initialStripeInvoiceCurrency: string;
    initialStripeInvoicePeriodEnd: number;
    initialInvoicePaymentStatus: string;
    initialInvoicePaymentLivemode: boolean;
    initialInvoicePaymentInvoiceId: string;
    initialInvoicePaymentAmountPaid: number | null;
    initialInvoicePaymentAmountRequested: number;
    initialInvoicePaymentCurrency: string;
    initialInvoicePaymentIntentId: string;
    initialStripePaymentIntentId: string;
    initialStripePaymentIntentLivemode: boolean;
    initialStripePaymentIntentStatus: string;
    initialStripePaymentIntentCustomerId: string;
    initialStripePaymentIntentAmount: number;
    initialStripePaymentIntentAmountReceived: number;
    initialStripePaymentIntentCurrency: string;
    initialStripePaymentIntentLatestChargeId: string;
    initialStripeChargeId: string;
    initialStripeChargeLivemode: boolean;
    initialStripeChargeStatus: string;
    initialStripeChargePaid: boolean;
    initialStripeChargeCustomerId: string;
    initialStripeChargePaymentIntentId: string;
    initialStripeChargeAmount: number;
    initialStripeChargeCurrency: string;
    initialStripeChargeRefunded: boolean;
    initialStripeChargeAmountRefunded: number;
}

export interface RefundPlan {
    partialAmount: number;
    remainingAmount: number;
}

export interface LifecycleWebhookEndpointSnapshot {
    id: string;
    url: string;
    status: string;
    enabledEvents: string[];
}

export interface TransitionNoticeJobCandidate {
    id: string;
    jobType: string;
    status: string;
    subscriptionId: string | null;
    studentId: string | null;
    dedupeKey: string | null;
    lastError: string | null;
    payload: unknown;
}

export interface TransitionNoticeBudgetUsage {
    dailyUsed: number;
    monthlyUsed: number;
}

export interface CanonicalLifecycleEvidence {
    schemaVersion: 2;
    status: 'complete';
    strategy: LifecycleStrategy;
    stripeAccountId: string;
    supabaseProjectRef: typeof STAGING_SUPABASE_PROJECT_REF;
    checkoutSessionId: string;
    customerId: string;
    subscriptionId: string;
    initialInvoiceId: string;
    initialPaymentIntentId: string;
    warmup: {
        invoiceId: string;
        paymentIntentId: string;
        invoicePaidEventId: string;
        periodEnd: number;
    } | null;
    transitionNotice: {
        eventId: string;
        jobId: string;
        dedupeKey: string;
        invoicePeriodEnd: number;
        jobFingerprint: string;
        budgetBeforeBoundary: TransitionNoticeBudgetUsage;
        budgetAfterBoundary: TransitionNoticeBudgetUsage;
    } | null;
    renewalInvoiceId: string;
    recoveredPaymentIntentId: string;
    partialRefundId: string;
    finalRefundId: string;
    webhookEventIds: {
        checkoutCompleted: string;
        initialInvoicePaid: string;
        upcoming: string;
        renewalFailed: string;
        renewalPaid: string;
        cancellation: string;
        partialRefund: string;
        finalRefund: string;
    };
    finalState: {
        stripeSubscriptionStatus: 'canceled';
        localSubscriptionStatus: 'cancelled';
        recoveredPaymentStatus: 'refunded';
        recoveredChargeFullyRefunded: true;
        initialPaymentPreserved: true;
        warmupPaymentPreserved: true | null;
        transitionNoticePreserved: true | null;
        processedWebhookEvents: 'succeeded';
    };
}

export interface CanonicalLifecycleReportSummary {
    schemaVersion: 1;
    status: 'OK';
    mode: 'lifecycle' | 'lifecycle-resume';
    outputDir: string;
    scope: {
        supabaseProjectRef: typeof STAGING_SUPABASE_PROJECT_REF;
        stripeAccountId: string;
        stripeMode: 'test';
        productionExcluded: true;
    };
    resources: {
        checkoutSessionId: string;
        subscriptionId: string;
        initialInvoiceId: string;
        initialPaymentIntentId: string;
        warmupInvoiceId: string | null;
        warmupPaymentIntentId: string | null;
        transitionNoticeEventId: string | null;
        transitionNoticeJobId: string | null;
        renewalInvoiceId: string;
        recoveredPaymentIntentId: string;
        partialRefundId: string;
        finalRefundId: string;
    };
    mutationGate: {
        authorized: true;
        sessionBound: true;
        upcomingNotice15DayAuthorized: boolean;
    };
    checkpoint: {
        phase: 'complete';
    };
    error: null;
    canonicalEvidence: CanonicalLifecycleEvidence;
}

export function lifecycleConfirmationForSession(sessionId: string): string {
    if (!CHECKOUT_SESSION_PATTERN.test(sessionId)) {
        throw new Error('Lifecycle confirmation requires a cs_test_ Checkout Session ID.');
    }
    return `I_CONFIRM_STAGING_BILLING_LIFECYCLE:${sessionId}`;
}

export function upcomingNoticeConfirmationForSession(sessionId: string): string {
    if (!CHECKOUT_SESSION_PATTERN.test(sessionId)) {
        throw new Error('Upcoming-notice confirmation requires a cs_test_ Checkout Session ID.');
    }
    return `I_CONFIRM_STRIPE_UPCOMING_RENEWAL_EVENTS_15_DAYS:${sessionId}`;
}

export function assertUpcomingNoticeConfigurationConfirmation(input: {
    checkoutSessionId: string;
    confirmation?: string;
}): void {
    if (input.confirmation !== upcomingNoticeConfirmationForSession(input.checkoutSessionId)) {
        throw new Error(
            `Second-period recovery blocked. Set ${UPCOMING_NOTICE_CONFIRMATION_ENV} to the exact session-bound 15-day confirmation.`
        );
    }
}

export function assertLegacySecondPeriodRecoveryCheckpoint(input: {
    schemaVersion: number;
    phase: unknown;
    currentFrozenTime: number;
    initialPeriodEnd: number;
    upcomingBaselineEventIds: unknown;
    hasPostUpcomingMutationEvidence: boolean;
}): void {
    const baseline = input.upcomingBaselineEventIds;
    if (
        input.schemaVersion !== 1
        || input.phase !== 'upcoming_before_boundary_verified'
        || input.currentFrozenTime !== invoiceUpcomingBoundary(input.initialPeriodEnd)
        || !Array.isArray(baseline)
        || baseline.length !== 0
        || baseline.some((eventId) => typeof eventId !== 'string' || !/^evt_[A-Za-z0-9_]+$/u.test(eventId))
        || input.hasPostUpcomingMutationEvidence
    ) {
        throw new Error('Legacy checkpoint is not the exact safe second-period recovery checkpoint.');
    }
}

export function requireSingleTransitionNoticeEventId(input: {
    baselineEventIds: readonly string[];
    currentEventIds: readonly string[];
}): string {
    for (const [label, ids] of [
        ['baseline', input.baselineEventIds],
        ['current', input.currentEventIds],
    ] as const) {
        if (
            new Set(ids).size !== ids.length
            || ids.some((eventId) => !/^evt_[A-Za-z0-9_]+$/u.test(eventId))
        ) {
            throw new Error(`Transition notice ${label} event set is invalid.`);
        }
    }
    const current = new Set(input.currentEventIds);
    if (input.baselineEventIds.some((eventId) => !current.has(eventId))) {
        throw new Error('Transition notice baseline is not contained in the current event set.');
    }
    const baseline = new Set(input.baselineEventIds);
    const transitionEventIds = input.currentEventIds.filter((eventId) => !baseline.has(eventId));
    if (transitionEventIds.length !== 1) {
        throw new Error('Second-period recovery requires exactly one late transition invoice.upcoming event.');
    }
    return transitionEventIds[0];
}

export function assertTransitionNoticeJobPattern(
    candidates: readonly TransitionNoticeJobCandidate[],
    expected: {
        jobId?: string;
        eventId: string;
        stripeInvoiceId: string | null;
        stripeSubscriptionId: string;
        localSubscriptionId: string;
        studentId: string;
        renewalAt: string;
        amountTotal: number;
        currency: string;
    },
): string {
    if (candidates.length !== 1) {
        throw new Error('Transition notice must have exactly one fulfillment job for the renewal dedupe key.');
    }
    const job = candidates[0];
    const payload = recordValue(job.payload, 'Transition notice job payload');
    const invoiceMatches = expected.stripeInvoiceId === null
        ? payload.stripeInvoiceId === undefined
        : payload.stripeInvoiceId === expected.stripeInvoiceId;
    if (
        !UUID_PATTERN.test(job.id)
        || (expected.jobId !== undefined && job.id !== expected.jobId)
        || job.jobType !== 'renewal_notice'
        || job.status !== 'succeeded'
        || job.subscriptionId !== expected.localSubscriptionId
        || job.studentId !== expected.studentId
        || job.dedupeKey !== `renewal_notice:${expected.stripeSubscriptionId}:${expected.renewalAt}`
        || job.lastError !== null
        || payload.stripeEventId !== expected.eventId
        || !invoiceMatches
        || payload.stripeSubscriptionId !== expected.stripeSubscriptionId
        || payload.subscriptionId !== expected.localSubscriptionId
        || payload.userId !== expected.studentId
        || payload.renewalAt !== expected.renewalAt
        || payload.cancelBy !== expected.renewalAt
        || payload.amountTotal !== expected.amountTotal
        || payload.currency !== expected.currency
    ) {
        throw new Error('Transition notice fulfillment job or payload is inconsistent with the late event.');
    }
    return job.id;
}

export function assertTransitionNoticeBudgetUnchanged(
    before: TransitionNoticeBudgetUsage,
    after: TransitionNoticeBudgetUsage,
): void {
    for (const usage of [before, after]) {
        if (
            !Number.isInteger(usage.dailyUsed)
            || usage.dailyUsed < 0
            || !Number.isInteger(usage.monthlyUsed)
            || usage.monthlyUsed < 0
        ) {
            throw new Error('Transition notice budget snapshot is invalid.');
        }
    }
    if (before.dailyUsed !== after.dailyUsed || before.monthlyUsed !== after.monthlyUsed) {
        throw new Error('Staging email budget increased while crossing the canonical 15-day boundary.');
    }
}

export function validateLifecycleEnvironment(
    input: LifecycleEnvironmentInput,
    options: { preflightOnly: boolean }
): ValidatedLifecycleEnvironment {
    if (!input.stripeSecretKey?.startsWith('sk_test_')) {
        throw new Error('STRIPE_SECRET_KEY must be an sk_test_ key. Live or unrecognized keys are forbidden.');
    }
    if (!input.stripePublishableKey?.startsWith('pk_test_')) {
        throw new Error('PUBLIC_STRIPE_PUBLISHABLE_KEY must be a pk_test_ key.');
    }
    if (!input.stripeExpectedAccountId?.startsWith('acct_')) {
        throw new Error('STRIPE_EXPECTED_ACCOUNT_ID must be explicitly configured.');
    }
    if (input.publicAppEnvironment !== 'staging') {
        throw new Error('PUBLIC_APP_ENV must be exactly staging.');
    }
    if (!input.supabaseServiceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for read-only reconciliation checks.');
    }

    const supabaseProjectRef = projectRefFromSupabaseUrl(input.supabaseUrl);
    if (supabaseProjectRef !== STAGING_SUPABASE_PROJECT_REF) {
        throw new Error(`PUBLIC_SUPABASE_URL must target staging project ${STAGING_SUPABASE_PROJECT_REF}.`);
    }
    if (input.supabaseExpectedProjectRef !== STAGING_SUPABASE_PROJECT_REF) {
        throw new Error(`SUPABASE_EXPECTED_PROJECT_REF must equal ${STAGING_SUPABASE_PROJECT_REF}.`);
    }
    if (!input.checkoutSessionId || !CHECKOUT_SESSION_PATTERN.test(input.checkoutSessionId)) {
        throw new Error('A completed cs_test_ Checkout Session ID is required.');
    }
    if (!options.preflightOnly) {
        const expectedConfirmation = lifecycleConfirmationForSession(input.checkoutSessionId);
        if (input.confirmation !== expectedConfirmation) {
            throw new Error(
                `Mutation blocked. Set ${LIFECYCLE_CONFIRMATION_ENV} to the exact session-bound confirmation.`
            );
        }
    }

    return {
        checkoutSessionId: input.checkoutSessionId,
        stripeExpectedAccountId: input.stripeExpectedAccountId,
        supabaseProjectRef,
    };
}

export function invoiceUpcomingBoundary(periodEnd: number): number {
    if (!Number.isInteger(periodEnd) || periodEnd <= 0) {
        throw new Error('Subscription period end is invalid.');
    }
    return periodEnd - INVOICE_UPCOMING_NOTICE_SECONDS;
}

export function testClockAdvanceIdempotencyScope(phase: string, target: number): string {
    if (!/^[a-z0-9-]+$/u.test(phase) || !Number.isInteger(target) || target <= 0) {
        throw new Error('Test Clock idempotency scope requires a safe phase and positive target timestamp.');
    }
    return `clock-${phase}-${target}`;
}

export function assertLifecyclePhaseTransition(current: LifecyclePhase, next: LifecyclePhase): void {
    if (lifecyclePhaseIndex(next) < lifecyclePhaseIndex(current)) {
        throw new Error('Refusing to move the lifecycle checkpoint backwards.');
    }
}

export function assertCheckpointClockWindow(input: {
    phase: LifecyclePhase;
    currentFrozenTime: number;
    initialFrozenTime: number;
    initialPeriodEnd: number;
    strategy?: LifecycleStrategy;
    warmupPeriodEnd?: number;
}): void {
    const boundary = invoiceUpcomingBoundary(input.initialPeriodEnd);
    const beforeBoundary = boundary - INVOICE_UPCOMING_BOUNDARY_MARGIN_SECONDS;
    if (
        !Number.isInteger(input.currentFrozenTime)
        || !Number.isInteger(input.initialFrozenTime)
        || input.currentFrozenTime < input.initialFrozenTime
        || input.initialFrozenTime >= beforeBoundary
    ) {
        throw new Error('Checkpoint Test Clock time is invalid.');
    }

    const strategy = input.strategy ?? 'first_period';
    if (strategy === 'second_period_recovery') {
        const warmupFinalization = input.initialPeriodEnd + RENEWAL_FINALIZATION_OFFSET_SECONDS;
        if (input.phase === 'upcoming_before_boundary_verified') {
            if (![boundary, input.initialPeriodEnd, warmupFinalization].includes(input.currentFrozenTime)) {
                throw new Error('Recovery checkpoint has an ambiguous first-renewal Test Clock position.');
            }
            return;
        }
        if (!Number.isInteger(input.warmupPeriodEnd) || (input.warmupPeriodEnd ?? 0) <= input.initialPeriodEnd) {
            throw new Error('Recovery checkpoint is missing a valid warm-up period end.');
        }
        const recoveryBoundary = invoiceUpcomingBoundary(input.warmupPeriodEnd as number);
        const recoveryBeforeBoundary = recoveryBoundary - INVOICE_UPCOMING_BOUNDARY_MARGIN_SECONDS;
        if (recoveryBeforeBoundary <= warmupFinalization) {
            throw new Error('Recovery checkpoint warm-up period cannot prove a second 15-day boundary.');
        }
        if (input.phase === 'warmup_renewal_preserved' || input.phase === 'transition_notice_verified') {
            if (input.currentFrozenTime !== warmupFinalization) {
                throw new Error('Warm-up/transition checkpoint has an ambiguous Test Clock position.');
            }
            return;
        }
        if (input.phase === 'recovery_upcoming_baseline_captured') {
            if (![warmupFinalization, recoveryBeforeBoundary].includes(input.currentFrozenTime)) {
                throw new Error('Recovery upcoming baseline checkpoint has an ambiguous Test Clock position.');
            }
            return;
        }
        if (input.phase === 'recovery_upcoming_before_boundary_verified') {
            if (![recoveryBeforeBoundary, recoveryBoundary + 1].includes(input.currentFrozenTime)) {
                throw new Error('Recovery pre-boundary checkpoint has an ambiguous Test Clock position.');
            }
            return;
        }
        if (lifecyclePhaseIndex(input.phase) < lifecyclePhaseIndex('warmup_renewal_preserved')) {
            throw new Error('Second-period recovery cannot resume from an earlier checkpoint phase.');
        }
        if (input.currentFrozenTime < recoveryBoundary + 1) {
            throw new Error('Post-upcoming recovery checkpoint is behind the second 15-day boundary.');
        }
        return;
    }

    if (input.phase === 'initial_verified') {
        if (input.currentFrozenTime !== input.initialFrozenTime) {
            throw new Error('Initial checkpoint does not allow any Test Clock advancement.');
        }
        return;
    }
    if (input.phase === 'upcoming_baseline_captured') {
        if (![input.initialFrozenTime, beforeBoundary].includes(input.currentFrozenTime)) {
            throw new Error('Upcoming baseline checkpoint has an ambiguous Test Clock position.');
        }
        return;
    }
    if (input.phase === 'upcoming_before_boundary_verified') {
        if (![beforeBoundary, boundary].includes(input.currentFrozenTime)) {
            throw new Error('Pre-boundary checkpoint has an ambiguous Test Clock position.');
        }
        return;
    }
    if (input.currentFrozenTime < boundary) {
        throw new Error('Post-upcoming checkpoint is behind the documented 15-day boundary.');
    }
}

export function assertExclusiveLifecycleWebhookDestination(
    endpoints: LifecycleWebhookEndpointSnapshot[],
): string {
    const requiredEvents = new Set<string>(LIFECYCLE_WEBHOOK_EVENT_TYPES);
    const relevant = endpoints.filter((endpoint) => {
        if (endpoint.status !== 'enabled') return false;
        return endpoint.enabledEvents.includes('*')
            || endpoint.enabledEvents.some((eventType) => requiredEvents.has(eventType));
    });
    if (relevant.length !== 1) {
        throw new Error('Exactly one enabled webhook destination may receive lifecycle events.');
    }

    const endpoint = relevant[0];
    if (endpoint.url !== STAGING_STRIPE_WEBHOOK_ENDPOINT_URL) {
        throw new Error('Lifecycle webhook destination is not the exact staging endpoint.');
    }
    const coversAllEvents = endpoint.enabledEvents.includes('*')
        || LIFECYCLE_WEBHOOK_EVENT_TYPES.every((eventType) => endpoint.enabledEvents.includes(eventType));
    if (!coversAllEvents) {
        throw new Error('The exact staging webhook destination does not cover every lifecycle event.');
    }
    if (!/^we_[A-Za-z0-9_]+$/u.test(endpoint.id)) {
        throw new Error('Lifecycle webhook destination ID is invalid.');
    }
    return endpoint.id;
}

export function assertResumePhaseState(input: {
    phase: LifecyclePhase;
    stripeSubscriptionStatus: string;
    localSubscriptionStatus: string;
    cancelAtPeriodEnd: boolean;
}): void {
    const state = `${input.stripeSubscriptionStatus}:${input.localSubscriptionStatus}:${String(input.cancelAtPeriodEnd)}`;
    const failedStates = new Set(['past_due:paused:false', 'unpaid:paused:false']);
    const active = state === 'active:active:false';
    const cancellationScheduled = state === 'active:active:true';
    const cancelled = input.stripeSubscriptionStatus === 'canceled'
        && input.localSubscriptionStatus === 'cancelled';

    switch (input.phase) {
        case 'initial_verified':
        case 'upcoming_baseline_captured':
        case 'upcoming_before_boundary_verified':
        case 'warmup_renewal_preserved':
        case 'transition_notice_verified':
        case 'recovery_upcoming_baseline_captured':
        case 'recovery_upcoming_before_boundary_verified':
        case 'upcoming_observed':
            if (!active) throw new Error('Resume state is inconsistent with the pre-renewal checkpoint phase.');
            return;
        case 'failure_payment_method_set':
            if (!active && !failedStates.has(state)) {
                throw new Error('Resume state is inconsistent with the failure-method checkpoint phase.');
            }
            return;
        case 'renewal_failed':
            if (!failedStates.has(state) && !active) {
                throw new Error('Resume state is inconsistent with the failed-renewal checkpoint phase.');
            }
            return;
        case 'renewal_recovered':
            if (!active && !cancellationScheduled) {
                throw new Error('Resume state is inconsistent with the recovered-renewal checkpoint phase.');
            }
            return;
        case 'cancellation_scheduled':
            if (!cancellationScheduled && !cancelled) {
                throw new Error('Resume state is inconsistent with the cancellation-scheduled checkpoint phase.');
            }
            return;
        case 'cancellation_completed':
        case 'partial_refund_completed':
        case 'complete':
            if (!cancelled) throw new Error('Resume state is inconsistent with the terminal cancellation phase.');
    }
}

export function validateCanonicalLifecycleReport(
    value: unknown,
    expected: {
        checkoutSessionId: string;
        stripeAccountId: string;
    },
): CanonicalLifecycleReportSummary {
    const report = recordValue(value, 'Lifecycle evidence report');
    const scope = recordValue(report.scope, 'Lifecycle evidence scope');
    const resources = recordValue(report.resources, 'Lifecycle evidence resources');
    const mutationGate = recordValue(report.mutationGate, 'Lifecycle evidence mutation gate');
    const checkpoint = recordValue(report.checkpoint, 'Lifecycle evidence checkpoint');
    const evidence = recordValue(report.canonicalEvidence, 'Canonical lifecycle evidence');
    const eventIds = recordValue(evidence.webhookEventIds, 'Canonical lifecycle webhook events');
    const finalState = recordValue(evidence.finalState, 'Canonical lifecycle final state');
    const strategy = evidence.strategy;
    const isSecondPeriodRecovery = strategy === 'second_period_recovery';
    const warmup = evidence.warmup === null
        ? null
        : recordValue(evidence.warmup, 'Canonical lifecycle warm-up evidence');
    const transitionNotice = evidence.transitionNotice === null
        ? null
        : recordValue(evidence.transitionNotice, 'Canonical lifecycle transition-notice evidence');
    const transitionBudgetBefore = transitionNotice === null
        ? null
        : recordValue(transitionNotice.budgetBeforeBoundary, 'Transition-notice budget before boundary');
    const transitionBudgetAfter = transitionNotice === null
        ? null
        : recordValue(transitionNotice.budgetAfterBoundary, 'Transition-notice budget after boundary');

    const requiredResourcePatterns: Array<[unknown, RegExp, string]> = [
        [resources.checkoutSessionId, CHECKOUT_SESSION_PATTERN, 'report Checkout Session'],
        [resources.subscriptionId, SUBSCRIPTION_PATTERN, 'report subscription'],
        [resources.initialInvoiceId, INVOICE_PATTERN, 'report initial invoice'],
        [resources.initialPaymentIntentId, PAYMENT_INTENT_PATTERN, 'report initial PaymentIntent'],
        [resources.renewalInvoiceId, INVOICE_PATTERN, 'report renewal invoice'],
        [resources.recoveredPaymentIntentId, PAYMENT_INTENT_PATTERN, 'report recovered PaymentIntent'],
        [resources.partialRefundId, /^re_[A-Za-z0-9_]+$/u, 'report partial refund'],
        [resources.finalRefundId, /^re_[A-Za-z0-9_]+$/u, 'report final refund'],
        [evidence.customerId, CUSTOMER_PATTERN, 'evidence customer'],
    ];
    for (const [candidate, pattern, label] of requiredResourcePatterns) {
        if (typeof candidate !== 'string' || !pattern.test(candidate)) {
            throw new Error(`Canonical lifecycle evidence has an invalid ${label}.`);
        }
    }
    if (isSecondPeriodRecovery) {
        const requiredWarmupPatterns: Array<[unknown, RegExp, string]> = [
            [resources.warmupInvoiceId, INVOICE_PATTERN, 'report warm-up invoice'],
            [resources.warmupPaymentIntentId, PAYMENT_INTENT_PATTERN, 'report warm-up PaymentIntent'],
            [warmup?.invoiceId, INVOICE_PATTERN, 'evidence warm-up invoice'],
            [warmup?.paymentIntentId, PAYMENT_INTENT_PATTERN, 'evidence warm-up PaymentIntent'],
            [warmup?.invoicePaidEventId, /^evt_[A-Za-z0-9_]+$/u, 'evidence warm-up invoice.paid event'],
            [resources.transitionNoticeEventId, /^evt_[A-Za-z0-9_]+$/u, 'report transition invoice.upcoming event'],
            [resources.transitionNoticeJobId, UUID_PATTERN, 'report transition renewal-notice job'],
            [transitionNotice?.eventId, /^evt_[A-Za-z0-9_]+$/u, 'evidence transition invoice.upcoming event'],
            [transitionNotice?.jobId, UUID_PATTERN, 'evidence transition renewal-notice job'],
            [transitionNotice?.jobFingerprint, /^[a-f0-9]{64}$/u, 'evidence transition job fingerprint'],
        ];
        for (const [candidate, pattern, label] of requiredWarmupPatterns) {
            if (typeof candidate !== 'string' || !pattern.test(candidate)) {
                throw new Error(`Canonical lifecycle evidence has an invalid ${label}.`);
            }
        }
        if (!Number.isInteger(warmup?.periodEnd) || (warmup?.periodEnd as number) <= 0) {
            throw new Error('Canonical lifecycle evidence has an invalid warm-up period end.');
        }
        if (
            transitionNotice === null
            || !Number.isInteger(transitionNotice.invoicePeriodEnd)
            || (transitionNotice.invoicePeriodEnd as number) <= 0
            || (transitionNotice.invoicePeriodEnd as number) >= (warmup?.periodEnd as number)
            || transitionNotice.dedupeKey !== `renewal_notice:${evidence.subscriptionId}:${new Date((warmup?.periodEnd as number) * 1000).toISOString()}`
            || transitionBudgetBefore === null
            || transitionBudgetAfter === null
        ) {
            throw new Error('Canonical lifecycle evidence has an invalid transition notice.');
        }
        assertTransitionNoticeBudgetUnchanged({
            dailyUsed: transitionBudgetBefore.dailyUsed as number,
            monthlyUsed: transitionBudgetBefore.monthlyUsed as number,
        }, {
            dailyUsed: transitionBudgetAfter.dailyUsed as number,
            monthlyUsed: transitionBudgetAfter.monthlyUsed as number,
        });
    }
    for (const [name, eventId] of Object.entries(eventIds)) {
        if (typeof eventId !== 'string' || !/^evt_[A-Za-z0-9_]+$/u.test(eventId)) {
            throw new Error(`Canonical lifecycle evidence has an invalid ${name} event.`);
        }
    }
    const requiredEventNames = [
        'checkoutCompleted',
        'initialInvoicePaid',
        'upcoming',
        'renewalFailed',
        'renewalPaid',
        'cancellation',
        'partialRefund',
        'finalRefund',
    ];
    if (Object.keys(eventIds).length !== requiredEventNames.length
        || requiredEventNames.some((name) => !(name in eventIds))
        || new Set(Object.values(eventIds)).size !== requiredEventNames.length) {
        throw new Error('Canonical lifecycle evidence does not contain the exact webhook event set.');
    }
    if (isSecondPeriodRecovery && Object.values(eventIds).includes(warmup?.invoicePaidEventId)) {
        throw new Error('Canonical lifecycle warm-up event must be distinct from the target webhook event set.');
    }
    if (isSecondPeriodRecovery && Object.values(eventIds).includes(transitionNotice?.eventId)) {
        throw new Error('Canonical lifecycle transition event must be distinct from the target webhook event set.');
    }
    if (isSecondPeriodRecovery && transitionNotice?.eventId === warmup?.invoicePaidEventId) {
        throw new Error('Canonical lifecycle transition event must differ from the warm-up invoice.paid event.');
    }

    const evidenceMatches = report.schemaVersion === 1
        && report.status === 'OK'
        && (report.mode === 'lifecycle' || report.mode === 'lifecycle-resume')
        && typeof report.outputDir === 'string'
        && report.error === null
        && scope.supabaseProjectRef === STAGING_SUPABASE_PROJECT_REF
        && scope.stripeAccountId === expected.stripeAccountId
        && scope.stripeMode === 'test'
        && scope.productionExcluded === true
        && mutationGate.authorized === true
        && mutationGate.sessionBound === true
        && (isSecondPeriodRecovery
            ? mutationGate.upcomingNotice15DayAuthorized === true
            : mutationGate.upcomingNotice15DayAuthorized === false)
        && checkpoint.phase === 'complete'
        && resources.checkoutSessionId === expected.checkoutSessionId
        && evidence.schemaVersion === 2
        && evidence.status === 'complete'
        && (strategy === 'first_period' || isSecondPeriodRecovery)
        && evidence.stripeAccountId === expected.stripeAccountId
        && evidence.supabaseProjectRef === STAGING_SUPABASE_PROJECT_REF
        && evidence.checkoutSessionId === expected.checkoutSessionId
        && evidence.subscriptionId === resources.subscriptionId
        && evidence.initialInvoiceId === resources.initialInvoiceId
        && evidence.initialPaymentIntentId === resources.initialPaymentIntentId
        && (isSecondPeriodRecovery
            ? warmup !== null
                && warmup.invoiceId === resources.warmupInvoiceId
                && warmup.paymentIntentId === resources.warmupPaymentIntentId
                && warmup.paymentIntentId !== evidence.initialPaymentIntentId
                && warmup.paymentIntentId !== evidence.recoveredPaymentIntentId
                && warmup.invoiceId !== evidence.initialInvoiceId
                && warmup.invoiceId !== evidence.renewalInvoiceId
                && finalState.warmupPaymentPreserved === true
                && transitionNotice !== null
                && transitionNotice.eventId === resources.transitionNoticeEventId
                && transitionNotice.jobId === resources.transitionNoticeJobId
                && finalState.transitionNoticePreserved === true
            : warmup === null
                && resources.warmupInvoiceId === null
                && resources.warmupPaymentIntentId === null
                && finalState.warmupPaymentPreserved === null
                && transitionNotice === null
                && resources.transitionNoticeEventId === null
                && resources.transitionNoticeJobId === null
                && finalState.transitionNoticePreserved === null)
        && evidence.renewalInvoiceId === resources.renewalInvoiceId
        && evidence.recoveredPaymentIntentId === resources.recoveredPaymentIntentId
        && evidence.partialRefundId === resources.partialRefundId
        && evidence.finalRefundId === resources.finalRefundId
        && evidence.initialPaymentIntentId !== evidence.recoveredPaymentIntentId
        && evidence.partialRefundId !== evidence.finalRefundId
        && finalState.stripeSubscriptionStatus === 'canceled'
        && finalState.localSubscriptionStatus === 'cancelled'
        && finalState.recoveredPaymentStatus === 'refunded'
        && finalState.recoveredChargeFullyRefunded === true
        && finalState.initialPaymentPreserved === true
        && finalState.processedWebhookEvents === 'succeeded';
    if (!evidenceMatches) {
        throw new Error('Canonical lifecycle evidence does not match the exact completed staging lifecycle.');
    }
    return value as CanonicalLifecycleReportSummary;
}

export function isLifecyclePhase(value: unknown): value is LifecyclePhase {
    return typeof value === 'string' && (LIFECYCLE_PHASES as readonly string[]).includes(value);
}

export function lifecyclePhaseIndex(value: LifecyclePhase): number {
    return LIFECYCLE_PHASES.indexOf(value);
}

export function assertLifecyclePreflight(
    snapshot: LifecyclePreflightSnapshot,
    options: { resume?: boolean } = {}
): void {
    const resume = options.resume === true;
    assertEqual(snapshot.actualStripeAccountId, snapshot.expectedStripeAccountId, 'Stripe account mismatch');
    assertPattern(snapshot.checkoutSessionId, CHECKOUT_SESSION_PATTERN, 'Checkout Session must be cs_test_');
    assertFalse(snapshot.checkoutSessionLivemode, 'Checkout Session must be in test mode');
    assertEqual(snapshot.checkoutSessionMode, 'subscription', 'Checkout Session must be a subscription');
    assertEqual(snapshot.checkoutSessionStatus, 'complete', 'Checkout Session must be complete');
    assertEqual(snapshot.checkoutPaymentStatus, 'paid', 'Checkout Session must be paid');
    assertEqual(snapshot.checkoutCurrency, 'eur', 'Checkout Session currency must be EUR');
    assertPositiveInteger(snapshot.checkoutAmountTotal, 'Checkout Session amount must be a positive integer');
    if ((snapshot.checkoutAmountTotal ?? 0) <= 1) {
        throw new Error('Checkout Session amount must allow a partial and remaining refund.');
    }

    assertPattern(snapshot.checkoutCustomerId, CUSTOMER_PATTERN, 'Checkout customer ID is invalid');
    assertPattern(snapshot.checkoutSubscriptionId, SUBSCRIPTION_PATTERN, 'Checkout subscription ID is invalid');
    assertPattern(snapshot.checkoutInvoiceId, INVOICE_PATTERN, 'Checkout invoice ID is invalid');
    assertNonEmpty(snapshot.checkoutUserId, 'Checkout metadata userId is required');
    assertNonEmpty(snapshot.checkoutPackagePriceId, 'Checkout metadata packagePriceId is required');
    assertEqual(snapshot.checkoutClientReferenceId, snapshot.checkoutUserId, 'Checkout user ownership mismatch');

    assertEqual(snapshot.customerId, snapshot.checkoutCustomerId, 'Customer does not belong to Checkout');
    assertFalse(snapshot.customerLivemode, 'Customer must be in test mode');
    assertFalse(snapshot.customerDeleted, 'Customer is deleted');
    assertEqual(snapshot.customerMetadataUserId, snapshot.checkoutUserId, 'Customer metadata ownership mismatch');
    assertEqual(
        snapshot.customerMetadataSource,
        'staging-checkout-bootstrap',
        'Customer is not the owned staging checkout bootstrap customer'
    );
    assertPattern(snapshot.customerTestClockId, TEST_CLOCK_PATTERN, 'Customer has no Test Clock');

    assertEqual(snapshot.subscriptionId, snapshot.checkoutSubscriptionId, 'Subscription does not belong to Checkout');
    assertFalse(snapshot.subscriptionLivemode, 'Subscription must be in test mode');
    if (resume) {
        if (!['active', 'past_due', 'unpaid', 'canceled'].includes(snapshot.subscriptionStatus)) {
            throw new Error('Subscription is outside the resumable lifecycle states.');
        }
    } else {
        assertEqual(snapshot.subscriptionStatus, 'active', 'Subscription must start active');
    }
    assertEqual(snapshot.subscriptionCustomerId, snapshot.customerId, 'Subscription customer mismatch');
    assertEqual(snapshot.subscriptionMetadataUserId, snapshot.checkoutUserId, 'Subscription metadata ownership mismatch');
    assertEqual(snapshot.subscriptionTestClockId, snapshot.customerTestClockId, 'Subscription Test Clock mismatch');
    assertEqual(snapshot.subscriptionCollectionMethod, 'charge_automatically', 'Subscription must charge automatically');
    if (!resume) {
        assertFalse(snapshot.subscriptionCancelAtPeriodEnd, 'Subscription is already scheduled for cancellation');
    }
    assertPositiveInteger(snapshot.subscriptionPeriodEnd, 'Subscription period end is invalid');

    assertEqual(snapshot.testClockId, snapshot.customerTestClockId, 'Retrieved Test Clock mismatch');
    assertFalse(snapshot.testClockLivemode, 'Test Clock must not be live');
    assertEqual(snapshot.testClockStatus, 'ready', 'Test Clock must be ready');
    assertPositiveInteger(snapshot.testClockFrozenTime, 'Test Clock frozen time is invalid');
    const upcomingBoundary = invoiceUpcomingBoundary(snapshot.subscriptionPeriodEnd);
    if (
        !resume
        && upcomingBoundary <= snapshot.testClockFrozenTime + INVOICE_UPCOMING_BOUNDARY_MARGIN_SECONDS
    ) {
        throw new Error('Test Clock cannot prove the documented 15-day invoice.upcoming boundary.');
    }
    if (snapshot.testClockDeletesAfter <= snapshot.nowUnix + 3_600) {
        throw new Error('Test Clock expires too soon for the lifecycle run.');
    }
    assertExactIds(
        snapshot.testClockCustomerIds,
        [snapshot.customerId],
        'Test Clock must contain exactly the target bootstrap customer'
    );
    assertExactIds(
        snapshot.customerSubscriptionIds,
        [snapshot.subscriptionId],
        'Bootstrap customer must contain exactly the target subscription'
    );
    assertExactIds(
        snapshot.customerSubscriptionScheduleIds,
        [],
        'Bootstrap customer must not contain subscription schedules'
    );

    assertEqual(snapshot.checkoutIntentStatus, 'completed', 'Checkout intent must be reconciled as completed');
    assertEqual(snapshot.checkoutIntentSessionId, snapshot.checkoutSessionId, 'Checkout intent session mismatch');
    assertEqual(snapshot.checkoutIntentCustomerId, snapshot.customerId, 'Checkout intent customer mismatch');
    assertEqual(snapshot.checkoutIntentStudentId, snapshot.checkoutUserId, 'Checkout intent student mismatch');
    assertEqual(
        snapshot.checkoutIntentPackagePriceId,
        snapshot.checkoutPackagePriceId,
        'Checkout intent immutable offer mismatch'
    );
    assertEqual(snapshot.localProfileCustomerId, snapshot.customerId, 'Local profile customer mismatch');

    assertNonEmpty(snapshot.localSubscriptionId, 'Local subscription ID is required');
    if (resume) {
        if (!['active', 'paused', 'cancelled'].includes(snapshot.localSubscriptionStatus)) {
            throw new Error('Local subscription is outside the resumable lifecycle states.');
        }
    } else {
        assertEqual(snapshot.localSubscriptionStatus, 'active', 'Local subscription must be active initially');
    }
    assertEqual(snapshot.localSubscriptionStudentId, snapshot.checkoutUserId, 'Local subscription owner mismatch');
    assertEqual(snapshot.localSubscriptionStripeId, snapshot.subscriptionId, 'Local Stripe subscription mismatch');
    if (resume) {
        assertPattern(snapshot.localSubscriptionInvoiceId ?? '', INVOICE_PATTERN, 'Local Stripe invoice is invalid');
    } else {
        assertEqual(snapshot.localSubscriptionInvoiceId, snapshot.checkoutInvoiceId, 'Local initial invoice mismatch');
    }

    assertEqual(snapshot.localInitialPaymentStatus, 'succeeded', 'Initial local payment must have succeeded');
    assertEqual(snapshot.localInitialPaymentStudentId, snapshot.checkoutUserId, 'Initial payment owner mismatch');
    assertEqual(
        snapshot.localInitialPaymentSubscriptionId,
        snapshot.localSubscriptionId,
        'Initial local payment subscription mismatch'
    );
    assertEqual(snapshot.localInitialPaymentInvoiceId, snapshot.checkoutInvoiceId, 'Initial payment invoice mismatch');
    assertPattern(
        snapshot.localInitialPaymentIntentId ?? '',
        PAYMENT_INTENT_PATTERN,
        'Initial payment has no PaymentIntent'
    );
    assertEqual(
        snapshot.localInitialPaymentAmount,
        snapshot.checkoutAmountTotal,
        'Initial local payment amount mismatch'
    );
    assertEqual(snapshot.localInitialPaymentCurrency, 'eur', 'Initial local payment currency mismatch');
    assertEqual(snapshot.localInitialPaymentAmountRefunded, 0, 'Initial payment is already refunded');

    assertEqual(snapshot.initialStripeInvoiceStatus, 'paid', 'Initial Stripe invoice must be paid');
    assertEqual(snapshot.initialStripeInvoiceCustomerId, snapshot.customerId, 'Initial Stripe invoice customer mismatch');
    assertEqual(
        snapshot.initialStripeInvoiceSubscriptionId,
        snapshot.subscriptionId,
        'Initial Stripe invoice subscription mismatch'
    );
    assertEqual(
        snapshot.initialStripeInvoiceAmountPaid,
        snapshot.checkoutAmountTotal,
        'Initial Stripe invoice amount mismatch'
    );
    assertEqual(snapshot.initialStripeInvoiceCurrency, 'eur', 'Initial Stripe invoice currency mismatch');
    assertPositiveInteger(snapshot.initialStripeInvoicePeriodEnd, 'Initial Stripe invoice period end is invalid');
    if (!resume) {
        assertEqual(
            snapshot.initialStripeInvoicePeriodEnd,
            snapshot.subscriptionPeriodEnd,
            'Initial invoice and fresh subscription period end mismatch'
        );
    }
    assertEqual(snapshot.initialInvoicePaymentStatus, 'paid', 'Initial InvoicePayment must be paid');
    assertFalse(snapshot.initialInvoicePaymentLivemode, 'Initial InvoicePayment must be in test mode');
    assertEqual(
        snapshot.initialInvoicePaymentInvoiceId,
        snapshot.checkoutInvoiceId,
        'Initial InvoicePayment invoice mismatch'
    );
    assertEqual(
        snapshot.initialInvoicePaymentAmountPaid,
        snapshot.checkoutAmountTotal,
        'Initial InvoicePayment paid amount mismatch'
    );
    assertEqual(
        snapshot.initialInvoicePaymentAmountRequested,
        snapshot.checkoutAmountTotal,
        'Initial InvoicePayment requested amount mismatch'
    );
    assertEqual(snapshot.initialInvoicePaymentCurrency, 'eur', 'Initial InvoicePayment currency mismatch');
    assertPattern(
        snapshot.initialInvoicePaymentIntentId,
        PAYMENT_INTENT_PATTERN,
        'Initial InvoicePayment has no PaymentIntent'
    );
    assertEqual(
        snapshot.initialInvoicePaymentIntentId,
        snapshot.localInitialPaymentIntentId,
        'Initial InvoicePayment and local PaymentIntent mismatch'
    );
    assertEqual(
        snapshot.initialStripePaymentIntentId,
        snapshot.initialInvoicePaymentIntentId,
        'Initial Stripe PaymentIntent mismatch'
    );
    assertFalse(snapshot.initialStripePaymentIntentLivemode, 'Initial PaymentIntent must be in test mode');
    assertEqual(snapshot.initialStripePaymentIntentStatus, 'succeeded', 'Initial PaymentIntent must have succeeded');
    assertEqual(
        snapshot.initialStripePaymentIntentCustomerId,
        snapshot.customerId,
        'Initial PaymentIntent customer mismatch'
    );
    assertEqual(
        snapshot.initialStripePaymentIntentAmount,
        snapshot.checkoutAmountTotal,
        'Initial PaymentIntent requested amount mismatch'
    );
    assertEqual(
        snapshot.initialStripePaymentIntentAmountReceived,
        snapshot.checkoutAmountTotal,
        'Initial PaymentIntent amount mismatch'
    );
    assertEqual(snapshot.initialStripePaymentIntentCurrency, 'eur', 'Initial PaymentIntent currency mismatch');
    assertPattern(
        snapshot.initialStripePaymentIntentLatestChargeId,
        /^ch_[A-Za-z0-9_]+$/,
        'Initial PaymentIntent latest charge is invalid'
    );
    assertEqual(
        snapshot.initialStripeChargeId,
        snapshot.initialStripePaymentIntentLatestChargeId,
        'Initial Stripe charge mismatch'
    );
    assertFalse(snapshot.initialStripeChargeLivemode, 'Initial Stripe charge must be in test mode');
    assertEqual(snapshot.initialStripeChargeStatus, 'succeeded', 'Initial Stripe charge must have succeeded');
    if (!snapshot.initialStripeChargePaid) throw new Error('Initial Stripe charge is not paid.');
    assertEqual(snapshot.initialStripeChargeCustomerId, snapshot.customerId, 'Initial Stripe charge customer mismatch');
    assertEqual(
        snapshot.initialStripeChargePaymentIntentId,
        snapshot.initialStripePaymentIntentId,
        'Initial Stripe charge PaymentIntent mismatch'
    );
    assertEqual(snapshot.initialStripeChargeAmount, snapshot.checkoutAmountTotal, 'Initial Stripe charge amount mismatch');
    assertEqual(snapshot.initialStripeChargeCurrency, 'eur', 'Initial Stripe charge currency mismatch');
    assertFalse(snapshot.initialStripeChargeRefunded, 'Initial Stripe charge is already refunded');
    assertEqual(snapshot.initialStripeChargeAmountRefunded, 0, 'Initial Stripe charge has a refunded amount');
}

export function buildRefundPlan(input: {
    initialPaymentIntentId: string;
    warmupPaymentIntentId?: string;
    recoveredPaymentIntentId: string;
    recoveredAmount: number;
}): RefundPlan {
    assertPattern(input.initialPaymentIntentId, PAYMENT_INTENT_PATTERN, 'Initial PaymentIntent is invalid');
    if (input.warmupPaymentIntentId !== undefined) {
        assertPattern(input.warmupPaymentIntentId, PAYMENT_INTENT_PATTERN, 'Warm-up PaymentIntent is invalid');
    }
    assertPattern(input.recoveredPaymentIntentId, PAYMENT_INTENT_PATTERN, 'Recovered PaymentIntent is invalid');
    if (input.initialPaymentIntentId === input.recoveredPaymentIntentId) {
        throw new Error('Recovered renewal PaymentIntent must differ from the preserved initial PaymentIntent.');
    }
    if (
        input.warmupPaymentIntentId !== undefined
        && (
            input.warmupPaymentIntentId === input.initialPaymentIntentId
            || input.warmupPaymentIntentId === input.recoveredPaymentIntentId
        )
    ) {
        throw new Error('Initial, warm-up and recovered renewal PaymentIntents must differ.');
    }
    assertPositiveInteger(input.recoveredAmount, 'Recovered payment amount must be a positive integer');
    if (input.recoveredAmount <= 1) {
        throw new Error('Recovered payment amount cannot demonstrate partial then complete refund.');
    }

    const partialAmount = Math.max(1, Math.floor(input.recoveredAmount / 2));
    const remainingAmount = input.recoveredAmount - partialAmount;
    if (remainingAmount <= 0) {
        throw new Error('Refund plan has no remaining amount.');
    }
    return { partialAmount, remainingAmount };
}

export function assertInitialPaymentPreserved(payment: {
    status: string;
    amountRefunded: number;
}): void {
    assertEqual(payment.status, 'succeeded', 'Initial payment status changed');
    assertEqual(payment.amountRefunded, 0, 'Initial payment was refunded');
}

export function sanitizeLifecycleText(value: unknown): string {
    return String(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
        .replace(/\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9_]+\b/g, '[redacted-stripe-key]')
        .replace(/\bwhsec_[A-Za-z0-9_]+\b/g, '[redacted-webhook-secret]')
        .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, '[redacted-supabase-key]')
        .replace(/\beyJ[A-Za-z0-9._-]+\b/g, '[redacted-token]');
}

function projectRefFromSupabaseUrl(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(new URL(value).hostname);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} is invalid.`);
    }
    return value as Record<string, unknown>;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
    if (actual !== expected) throw new Error(message);
}

function assertFalse(value: boolean, message: string): void {
    if (value) throw new Error(message);
}

function assertNonEmpty(value: string | null, message: string): void {
    if (!value) throw new Error(message);
}

function assertPattern(value: string, pattern: RegExp, message: string): void {
    if (!pattern.test(value)) throw new Error(message);
}

function assertExactIds(actual: string[], expected: string[], message: string): void {
    const normalizedActual = [...new Set(actual)].sort();
    const normalizedExpected = [...new Set(expected)].sort();
    if (
        normalizedActual.length !== normalizedExpected.length
        || normalizedActual.some((value, index) => value !== normalizedExpected[index])
    ) {
        throw new Error(message);
    }
}

function assertPositiveInteger(value: number | null, message: string): void {
    if (!Number.isInteger(value) || (value ?? 0) <= 0) throw new Error(message);
}
