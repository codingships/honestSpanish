import type { APIContext } from 'astro';
import type Stripe from 'stripe';
import { INITIAL_INDIVIDUAL_OFFER, PACKAGE_CURRENCY } from './package-pricing';
import { stripe } from './stripe';
import { assertStripeRuntimeAccount } from './stripe-runtime-guard';
import { createSupabaseAdminClient } from './supabase-admin';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

type DatabaseError = {
    code?: string;
    message?: string;
};

export type CheckoutV2RescheduleOperation = {
    id: string;
    request_id: string;
    session_id: string;
    subscription_id: string;
    cycle_id: string;
    actor_id: string;
    operation_kind: 'single_session' | 'provisional_anchor';
    old_scheduled_at: string;
    new_scheduled_at: string;
    expected_anchor_revision: number;
    target_stripe_anchor_at: string | null;
    observed_stripe_anchor_at: string | null;
    stripe_mutation_started_at: string | null;
    status: 'requested' | 'applied' | 'failed' | 'manual_review';
    last_error: string | null;
    applied_at: string | null;
    created_at: string;
    updated_at: string;
};

type LocalSubscription = {
    id: string;
    student_id: string;
    package_price_id: string;
    checkout_intent_id: string;
    contract_schema_version: number;
    status: string;
    stripe_subscription_id: string | null;
};

type LocalCheckoutIntent = {
    id: string;
    student_id: string;
    package_price_id: string;
    stripe_customer_id: string | null;
};

type LocalPackagePrice = {
    id: string;
    stripe_account_id: string | null;
    stripe_livemode: boolean;
    stripe_product_id: string | null;
};

type LocalPriceSnapshot = {
    package_price_id: string;
    recurring_stripe_price_id: string;
    recurring_amount_cents: number;
    currency: string;
    recurring_interval_unit: string;
    recurring_interval_count: number;
    stripe_account_id: string;
    stripe_livemode: boolean;
};

export type CheckoutV2RescheduleResult = {
    operationId: string;
    operationKind: CheckoutV2RescheduleOperation['operation_kind'];
    replayed: boolean;
};

export type CheckoutV2RescheduleErrorCode =
    | 'RESCHEDULE_FORBIDDEN'
    | 'RESCHEDULE_NOT_FOUND'
    | 'RESCHEDULE_CONFLICT'
    | 'RESCHEDULE_REQUIRES_REVIEW'
    | 'RESCHEDULE_RETRYABLE';

export class CheckoutV2RescheduleError extends Error {
    constructor(
        public readonly code: CheckoutV2RescheduleErrorCode,
        public readonly status: 403 | 404 | 409 | 503,
    ) {
        super(code);
        this.name = 'CheckoutV2RescheduleError';
    }
}

class StripeMutationBeginError extends Error {
    constructor(
        public readonly boundaryMayHaveCommitted: boolean,
        public readonly causeError: CheckoutV2RescheduleError,
    ) {
        super(causeError.message);
        this.name = 'StripeMutationBeginError';
    }
}

class LocalStripeContractPreflightError extends Error {
    constructor(public readonly retryable: boolean) {
        super(retryable ? 'local_stripe_contract_unavailable' : 'local_stripe_contract_invalid');
        this.name = 'LocalStripeContractPreflightError';
    }
}

type RpcResult<T> = Promise<{ data: T | null; error: DatabaseError | null }>;
type RescheduleRpc = (
    name:
        | 'prepare_checkout_v2_reschedule'
        | 'begin_checkout_v2_reschedule_stripe_mutation'
        | 'apply_checkout_v2_reschedule'
        | 'mark_checkout_v2_reschedule_outcome',
    args: Record<string, unknown>,
) => RpcResult<CheckoutV2RescheduleOperation>;

const STRIPE_CONFIRMED_AT_PREVIOUS_ANCHOR = 'stripe_confirmed_at_previous_anchor';

export function checkoutV2DatabaseFailure(error: DatabaseError | null): CheckoutV2RescheduleError {
    if (error?.code === '42501') {
        return new CheckoutV2RescheduleError('RESCHEDULE_FORBIDDEN', 403);
    }
    if (error?.code === 'P0002') {
        return new CheckoutV2RescheduleError('RESCHEDULE_NOT_FOUND', 404);
    }
    if (
        error?.code === '22023'
        || error?.code === '23505'
        || error?.code === '23514'
        || error?.code === '23P01'
        || error?.code === '40001'
        || error?.code === '57014'
    ) {
        return new CheckoutV2RescheduleError('RESCHEDULE_CONFLICT', 409);
    }
    return new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
}

function isMissingSingleRow(error: DatabaseError): boolean {
    return error.code === 'PGRST116';
}

function stripePreflightIsRetryable(error: unknown): boolean {
    if (!error || typeof error !== 'object') return true;
    const stripeError = error as {
        statusCode?: unknown;
        raw?: { statusCode?: unknown };
    };
    const statusCode = typeof stripeError.statusCode === 'number'
        ? stripeError.statusCode
        : typeof stripeError.raw?.statusCode === 'number'
            ? stripeError.raw.statusCode
            : null;
    if (statusCode === null) return true;
    return statusCode === 408
        || statusCode === 409
        || statusCode === 425
        || statusCode === 429
        || statusCode >= 500;
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function wholeSecondIso(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.0{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
    if (!match) return null;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetSign, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
    const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
    if (
        year < 1
        || month < 1 || month > 12
        || day < 1 || day > 31
        || hour > 23
        || minute > 59
        || second > 59
        || offsetHour > 14
        || (offsetHour === 14 && offsetMinute !== 0)
        || offsetMinute > 59
    ) return null;

    const civil = new Date(0);
    civil.setUTCFullYear(year, month - 1, day);
    civil.setUTCHours(hour, minute, second, 0);
    if (
        civil.getUTCFullYear() !== year
        || civil.getUTCMonth() !== month - 1
        || civil.getUTCDate() !== day
        || civil.getUTCHours() !== hour
        || civil.getUTCMinutes() !== minute
        || civil.getUTCSeconds() !== second
    ) return null;

    const offsetDirection = offsetSign === '+' ? 1 : offsetSign === '-' ? -1 : 0;
    const timestamp = civil.getTime()
        - offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
    if (!Number.isFinite(timestamp) || timestamp % 1000 !== 0) return null;
    const normalizedDate = new Date(timestamp);
    const normalizedYear = normalizedDate.getUTCFullYear();
    if (normalizedYear < 1 || normalizedYear > 9999) return null;
    return normalizedDate.toISOString();
}

function stripeProductId(product: string | Stripe.Product | Stripe.DeletedProduct): string {
    return typeof product === 'string' ? product : product.id;
}

function operationIsValid(
    value: unknown,
    expected: { requestId: string; sessionId: string; actorId: string; newScheduledAt: string },
): value is CheckoutV2RescheduleOperation {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const operation = value as Partial<CheckoutV2RescheduleOperation>;
    const kindIsValid = ['single_session', 'provisional_anchor'].includes(operation.operation_kind ?? '');
    const statusIsValid = ['requested', 'applied', 'failed', 'manual_review'].includes(operation.status ?? '');
    const oldScheduledAt = wholeSecondIso(operation.old_scheduled_at);
    const newScheduledAt = wholeSecondIso(operation.new_scheduled_at);
    const targetAnchorAt = wholeSecondIso(operation.target_stripe_anchor_at);
    const observedAnchorAt = wholeSecondIso(operation.observed_stripe_anchor_at);
    const mutationStartedAt = wholeSecondIso(operation.stripe_mutation_started_at);
    const appliedAt = wholeSecondIso(operation.applied_at);
    const createdAt = wholeSecondIso(operation.created_at);
    const updatedAt = wholeSecondIso(operation.updated_at);
    const lastErrorIsPresent = typeof operation.last_error === 'string'
        && operation.last_error.trim().length > 0;
    const expectedOldAnchorAt = oldScheduledAt === null
        ? null
        : wholeSecondIso(new Date(
            Date.parse(oldScheduledAt)
            + INITIAL_INDIVIDUAL_OFFER.billingIntervalCount * 24 * 60 * 60 * 1000,
        ).toISOString());
    const failedBeforeStripeMutation = mutationStartedAt === null
        && operation.observed_stripe_anchor_at === null
        && operation.last_error !== STRIPE_CONFIRMED_AT_PREVIOUS_ANCHOR;
    const failedAfterAuditedPreviousAnchorObservation = operation.operation_kind === 'provisional_anchor'
        && operation.last_error === STRIPE_CONFIRMED_AT_PREVIOUS_ANCHOR
        && expectedOldAnchorAt !== null
        && observedAnchorAt === expectedOldAnchorAt;
    const kindShapeIsValid = operation.operation_kind === 'provisional_anchor'
        ? targetAnchorAt !== null
        : operation.operation_kind === 'single_session'
            && operation.target_stripe_anchor_at === null
            && operation.observed_stripe_anchor_at === null
            && operation.stripe_mutation_started_at === null;
    const statusShapeIsValid = operation.status === 'requested'
        ? operation.observed_stripe_anchor_at === null
            && operation.applied_at === null
            && operation.last_error === null
        : operation.status === 'applied'
            ? appliedAt !== null
                && operation.last_error === null
                && (
                    operation.operation_kind === 'single_session'
                    || (
                        observedAnchorAt === targetAnchorAt
                        && mutationStartedAt !== null
                    )
                )
            : operation.status === 'failed'
                ? operation.applied_at === null
                    && lastErrorIsPresent
                    && (
                        failedBeforeStripeMutation
                        || failedAfterAuditedPreviousAnchorObservation
                    )
                : operation.status === 'manual_review'
                    && operation.operation_kind === 'provisional_anchor'
                    && operation.applied_at === null
                    && lastErrorIsPresent;

    return isUuid(operation.id)
        && operation.request_id === expected.requestId
        && operation.session_id === expected.sessionId
        && operation.actor_id === expected.actorId
        && newScheduledAt === expected.newScheduledAt
        && isUuid(operation.subscription_id)
        && isUuid(operation.cycle_id)
        && Number.isSafeInteger(operation.expected_anchor_revision)
        && (operation.expected_anchor_revision ?? 0) > 0
        && oldScheduledAt !== null
        && createdAt !== null
        && updatedAt !== null
        && (operation.stripe_mutation_started_at === null || mutationStartedAt !== null)
        && (operation.observed_stripe_anchor_at === null || observedAnchorAt !== null)
        && kindIsValid
        && statusIsValid
        && kindShapeIsValid
        && statusShapeIsValid;
}

async function prepareOperation(
    supabaseAdmin: SupabaseAdmin,
    input: { requestId: string; sessionId: string; actorId: string; newScheduledAt: string },
): Promise<CheckoutV2RescheduleOperation> {
    const rpc = supabaseAdmin.rpc as unknown as RescheduleRpc;
    const { data, error } = await rpc('prepare_checkout_v2_reschedule', {
        p_request_id: input.requestId,
        p_session_id: input.sessionId,
        p_actor_id: input.actorId,
        p_new_scheduled_at: input.newScheduledAt,
    });
    if (error) throw checkoutV2DatabaseFailure(error);
    if (!operationIsValid(data, input)) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }
    return data;
}

async function applyOperation(
    supabaseAdmin: SupabaseAdmin,
    operation: CheckoutV2RescheduleOperation,
    observedStripeAnchor: string | null,
): Promise<CheckoutV2RescheduleOperation> {
    const rpc = supabaseAdmin.rpc as unknown as RescheduleRpc;
    const { data, error } = await rpc('apply_checkout_v2_reschedule', {
        p_operation_id: operation.id,
        p_observed_stripe_anchor_at: observedStripeAnchor,
    });
    if (error) throw checkoutV2DatabaseFailure(error);
    if (
        !operationIsValid(data, {
            requestId: operation.request_id,
            sessionId: operation.session_id,
            actorId: operation.actor_id,
            newScheduledAt: wholeSecondIso(operation.new_scheduled_at) ?? '',
        })
        || data.id !== operation.id
        || data.request_id !== operation.request_id
        || data.session_id !== operation.session_id
        || data.subscription_id !== operation.subscription_id
        || data.operation_kind !== operation.operation_kind
        || data.status !== 'applied'
        || wholeSecondIso(data.new_scheduled_at) !== wholeSecondIso(operation.new_scheduled_at)
        || (
            observedStripeAnchor !== null
            && wholeSecondIso(data.observed_stripe_anchor_at) !== observedStripeAnchor
        )
    ) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }
    return data;
}

async function beginStripeMutation(
    supabaseAdmin: SupabaseAdmin,
    operation: CheckoutV2RescheduleOperation,
): Promise<CheckoutV2RescheduleOperation> {
    const rpc = supabaseAdmin.rpc as unknown as RescheduleRpc;
    let result: { data: CheckoutV2RescheduleOperation | null; error: DatabaseError | null };
    try {
        result = await rpc('begin_checkout_v2_reschedule_stripe_mutation', {
            p_operation_id: operation.id,
        });
    } catch {
        throw new StripeMutationBeginError(
            true,
            new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503),
        );
    }
    const { data, error } = result;
    if (error) {
        throw new StripeMutationBeginError(false, checkoutV2DatabaseFailure(error));
    }
    if (
        !operationIsValid(data, {
            requestId: operation.request_id,
            sessionId: operation.session_id,
            actorId: operation.actor_id,
            newScheduledAt: wholeSecondIso(operation.new_scheduled_at) ?? '',
        })
        || data.id !== operation.id
        || data.status !== 'requested'
        || !wholeSecondIso(data.stripe_mutation_started_at)
    ) {
        throw new StripeMutationBeginError(
            true,
            new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503),
        );
    }
    return data;
}

async function markOperationOutcome(
    supabaseAdmin: SupabaseAdmin,
    operation: CheckoutV2RescheduleOperation,
    status: 'failed' | 'manual_review',
    lastError: string,
    observedStripeAnchor?: string,
): Promise<CheckoutV2RescheduleOperation | null> {
    const rpc = supabaseAdmin.rpc as unknown as RescheduleRpc;
    try {
        const { data, error } = await rpc('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operation.id,
            p_status: status,
            p_last_error: lastError,
            ...(observedStripeAnchor === undefined
                ? {}
                : { p_observed_stripe_anchor_at: observedStripeAnchor }),
        });
        if (
            error
            || !operationIsValid(data, {
                requestId: operation.request_id,
                sessionId: operation.session_id,
                actorId: operation.actor_id,
                newScheduledAt: wholeSecondIso(operation.new_scheduled_at) ?? '',
            })
            || data.id !== operation.id
            || data.status !== status
            || data.last_error !== lastError
            || (
                observedStripeAnchor !== undefined
                && wholeSecondIso(data.observed_stripe_anchor_at) !== observedStripeAnchor
            )
        ) return null;
        return data;
    } catch {
        return null;
    }
}

async function closeOperationAndThrow(
    supabaseAdmin: SupabaseAdmin,
    operation: CheckoutV2RescheduleOperation,
    status: 'failed' | 'manual_review',
    lastError: string,
    error: CheckoutV2RescheduleError,
): Promise<never> {
    await markOperationOutcome(supabaseAdmin, operation, status, lastError);
    throw error;
}

async function loadLocalStripeContract(
    supabaseAdmin: SupabaseAdmin,
    operation: CheckoutV2RescheduleOperation,
): Promise<{
    subscription: LocalSubscription;
    packagePrice: LocalPackagePrice;
    snapshot: LocalPriceSnapshot;
    checkoutIntent: LocalCheckoutIntent;
}> {
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .select('id, student_id, package_price_id, checkout_intent_id, contract_schema_version, status, stripe_subscription_id')
        .eq('id', operation.subscription_id)
        .single() as unknown as { data: LocalSubscription | null; error: DatabaseError | null };
    if (subscriptionError) {
        throw new LocalStripeContractPreflightError(!isMissingSingleRow(subscriptionError));
    }
    if (
        !subscription
        || subscription.id !== operation.subscription_id
        || subscription.contract_schema_version !== 2
        || !['active', 'paused'].includes(subscription.status)
        || !subscription.checkout_intent_id
        || !subscription.stripe_subscription_id
    ) throw new LocalStripeContractPreflightError(false);

    const [
        { data: packagePrice, error: packagePriceError },
        { data: snapshot, error: snapshotError },
        { data: checkoutIntent, error: checkoutIntentError },
    ] = await Promise.all([
        supabaseAdmin
            .from('package_prices')
            .select('id, stripe_account_id, stripe_livemode, stripe_product_id')
            .eq('id', subscription.package_price_id)
            .single() as unknown as Promise<{ data: LocalPackagePrice | null; error: DatabaseError | null }>,
        supabaseAdmin
            .from('checkout_v2_price_snapshots')
            .select('package_price_id, recurring_stripe_price_id, recurring_amount_cents, currency, recurring_interval_unit, recurring_interval_count, stripe_account_id, stripe_livemode')
            .eq('package_price_id', subscription.package_price_id)
            .single() as unknown as Promise<{ data: LocalPriceSnapshot | null; error: DatabaseError | null }>,
        supabaseAdmin
            .from('checkout_intents')
            .select('id, student_id, package_price_id, stripe_customer_id')
            .eq('id', subscription.checkout_intent_id)
            .single() as unknown as Promise<{ data: LocalCheckoutIntent | null; error: DatabaseError | null }>,
    ]);
    const localReadErrors = [packagePriceError, snapshotError, checkoutIntentError]
        .filter((error): error is DatabaseError => error !== null);
    if (localReadErrors.length > 0) {
        throw new LocalStripeContractPreflightError(
            localReadErrors.some((error) => !isMissingSingleRow(error)),
        );
    }
    if (
        !packagePrice
        || !snapshot
        || !checkoutIntent
        || packagePrice.id !== subscription.package_price_id
        || snapshot.package_price_id !== subscription.package_price_id
        || checkoutIntent.id !== subscription.checkout_intent_id
        || checkoutIntent.student_id !== subscription.student_id
        || checkoutIntent.package_price_id !== subscription.package_price_id
        || !checkoutIntent.stripe_customer_id
    ) throw new LocalStripeContractPreflightError(false);

    return { subscription, packagePrice, snapshot, checkoutIntent };
}

function stripeSubscriptionMatchesContract(input: {
    stripeSubscription: Stripe.Subscription;
    stripeSubscriptionId: string;
    studentId: string;
    checkoutIntent: LocalCheckoutIntent;
    runtimeAccountId: string;
    runtimeLivemode: boolean;
    packagePrice: LocalPackagePrice;
    snapshot: LocalPriceSnapshot;
}): boolean {
    const item = input.stripeSubscription.items.data[0];
    const price = item?.price;
    return input.stripeSubscription.id === input.stripeSubscriptionId
        && input.stripeSubscription.livemode === input.runtimeLivemode
        && input.stripeSubscription.status === 'trialing'
        && input.stripeSubscription.metadata?.contractSchemaVersion === '2'
        && input.stripeSubscription.metadata?.userId === input.studentId
        && input.stripeSubscription.metadata?.checkoutIntentId === input.checkoutIntent.id
        && input.stripeSubscription.metadata?.packagePriceId === input.checkoutIntent.package_price_id
        && (
            typeof input.stripeSubscription.customer === 'string'
                ? input.stripeSubscription.customer
                : input.stripeSubscription.customer.id
        ) === input.checkoutIntent.stripe_customer_id
        && input.stripeSubscription.items.data.length === 1
        && item.quantity === 1
        && price.id === input.snapshot.recurring_stripe_price_id
        && price.type === 'recurring'
        && price.unit_amount === INITIAL_INDIVIDUAL_OFFER.amountCents
        && price.currency === PACKAGE_CURRENCY
        && price.livemode === input.runtimeLivemode
        && price.recurring?.interval === 'day'
        && price.recurring.interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
        && stripeProductId(price.product) === input.packagePrice.stripe_product_id
        && input.packagePrice.stripe_account_id === input.runtimeAccountId
        && input.packagePrice.stripe_livemode === input.runtimeLivemode
        && input.snapshot.stripe_account_id === input.runtimeAccountId
        && input.snapshot.stripe_livemode === input.runtimeLivemode
        && input.snapshot.recurring_amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
        && input.snapshot.currency === PACKAGE_CURRENCY
        && input.snapshot.recurring_interval_unit === 'day'
        && input.snapshot.recurring_interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount;
}

function subscriptionHasAnchor(subscription: Stripe.Subscription, targetAnchorUnix: number): boolean {
    return subscription.trial_end === targetAnchorUnix;
}

function subscriptionHasAnchorMetadata(
    subscription: Stripe.Subscription,
    firstClassAt: string,
    renewalAnchorAt: string,
    operationId?: string,
): boolean {
    return wholeSecondIso(subscription.metadata.firstClassAt) === firstClassAt
        && wholeSecondIso(subscription.metadata.renewalAnchorAt) === renewalAnchorAt
        && (
            operationId === undefined
            || subscription.metadata.rescheduleOperationId === operationId
        );
}

async function reconcileStripeAnchor(
    context: Pick<APIContext, 'locals'>,
    supabaseAdmin: SupabaseAdmin,
    operation: CheckoutV2RescheduleOperation,
): Promise<string> {
    const targetAnchorIso = wholeSecondIso(operation.target_stripe_anchor_at);
    const mutationAlreadyStarted = wholeSecondIso(operation.stripe_mutation_started_at) !== null;
    const externalMutationMayExist = operation.status === 'manual_review' || mutationAlreadyStarted;
    const closeForInvalidLocalState = (reason: string) => closeOperationAndThrow(
        supabaseAdmin,
        operation,
        externalMutationMayExist ? 'manual_review' : 'failed',
        reason,
        new CheckoutV2RescheduleError(
            externalMutationMayExist ? 'RESCHEDULE_REQUIRES_REVIEW' : 'RESCHEDULE_CONFLICT',
            409,
        ),
    );
    if (!targetAnchorIso) return closeForInvalidLocalState('invalid_target_anchor');
    const targetAnchorUnix = Math.floor(Date.parse(targetAnchorIso) / 1000);
    const oldScheduledAt = wholeSecondIso(operation.old_scheduled_at);
    const newScheduledAt = wholeSecondIso(operation.new_scheduled_at);
    if (!oldScheduledAt || !newScheduledAt) {
        return closeForInvalidLocalState('invalid_operation_timestamps');
    }
    const renewalPeriodMs = INITIAL_INDIVIDUAL_OFFER.billingIntervalCount * 24 * 60 * 60 * 1000;
    const expectedOldAnchorUnix = Math.floor((Date.parse(oldScheduledAt) + renewalPeriodMs) / 1000);
    if (targetAnchorUnix !== Math.floor((Date.parse(newScheduledAt) + renewalPeriodMs) / 1000)) {
        return closeForInvalidLocalState('invalid_operation_period');
    }
    const expectedOldAnchorIso = new Date(expectedOldAnchorUnix * 1000).toISOString();
    let localContract: Awaited<ReturnType<typeof loadLocalStripeContract>>;
    try {
        localContract = await loadLocalStripeContract(supabaseAdmin, operation);
    } catch (error) {
        if (!(error instanceof LocalStripeContractPreflightError) || error.retryable) {
            throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
        }
        return closeForInvalidLocalState('local_contract_preflight_failed');
    }
    const { subscription, packagePrice, snapshot, checkoutIntent } = localContract;
    const stripeSubscriptionId = subscription.stripe_subscription_id;
    if (!stripeSubscriptionId) {
        return closeForInvalidLocalState('stripe_subscription_identity_missing');
    }

    let account;
    let remoteBefore;
    try {
        [account, remoteBefore] = await Promise.all([
            stripe.accounts.retrieve(),
            stripe.subscriptions.retrieve(stripeSubscriptionId),
        ]);
    } catch (error) {
        if (stripePreflightIsRetryable(error)) {
            throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
        }
        return closeForInvalidLocalState('stripe_preflight_failed');
    }
    let runtime;
    try {
        runtime = assertStripeRuntimeAccount(context, account);
    } catch {
        return closeForInvalidLocalState('stripe_runtime_guard_failed');
    }
    if (!stripeSubscriptionMatchesContract({
        stripeSubscription: remoteBefore,
        stripeSubscriptionId,
        studentId: subscription.student_id,
        checkoutIntent,
        runtimeAccountId: runtime.accountId,
        runtimeLivemode: runtime.livemode,
        packagePrice,
        snapshot,
    })) return closeForInvalidLocalState('stripe_contract_preflight_failed');

    const remoteAlreadyAtTarget = subscriptionHasAnchor(remoteBefore, targetAnchorUnix);
    const remoteExactlyAtTarget = remoteAlreadyAtTarget
        && subscriptionHasAnchorMetadata(
            remoteBefore,
            newScheduledAt,
            targetAnchorIso,
            operation.id,
        );
    const remoteExactlyAtOldAnchor = subscriptionHasAnchor(remoteBefore, expectedOldAnchorUnix)
        && subscriptionHasAnchorMetadata(remoteBefore, oldScheduledAt, expectedOldAnchorIso);

    if (operation.status === 'manual_review') {
        if (remoteExactlyAtTarget) return targetAnchorIso;
        if (remoteExactlyAtOldAnchor) {
            const closedOperation = await markOperationOutcome(
                supabaseAdmin,
                operation,
                'failed',
                STRIPE_CONFIRMED_AT_PREVIOUS_ANCHOR,
                expectedOldAnchorIso,
            );
            if (!closedOperation) {
                throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
            }
            throw new CheckoutV2RescheduleError('RESCHEDULE_CONFLICT', 409);
        }
        throw new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409);
    }

    if (remoteExactlyAtTarget) {
        if (!mutationAlreadyStarted) {
            return closeOperationAndThrow(
                supabaseAdmin,
                operation,
                'manual_review',
                'stripe_target_precedes_local_mutation_boundary',
                new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
            );
        }
        return targetAnchorIso;
    }
    if (remoteAlreadyAtTarget || !remoteExactlyAtOldAnchor) {
        return closeOperationAndThrow(
            supabaseAdmin,
            operation,
            'manual_review',
            'stripe_anchor_or_metadata_diverged',
            new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
        );
    }

    const createdAt = wholeSecondIso(operation.created_at);
    if (!createdAt || Date.now() >= Date.parse(createdAt) + 15 * 60_000) {
        return closeOperationAndThrow(
            supabaseAdmin,
            operation,
            mutationAlreadyStarted ? 'manual_review' : 'failed',
            mutationAlreadyStarted
                ? 'started_operation_expired_before_convergence'
                : 'operation_expired_before_stripe_mutation',
            new CheckoutV2RescheduleError(
                mutationAlreadyStarted ? 'RESCHEDULE_REQUIRES_REVIEW' : 'RESCHEDULE_CONFLICT',
                409,
            ),
        );
    }

    let begunOperation: CheckoutV2RescheduleOperation;
    try {
        begunOperation = await beginStripeMutation(supabaseAdmin, operation);
    } catch (error) {
        const beginError = error instanceof StripeMutationBeginError ? error : null;
        const boundaryMayHaveCommitted = beginError?.boundaryMayHaveCommitted ?? true;
        return closeOperationAndThrow(
            supabaseAdmin,
            operation,
            boundaryMayHaveCommitted || externalMutationMayExist ? 'manual_review' : 'failed',
            'stripe_mutation_boundary_rejected',
            boundaryMayHaveCommitted || externalMutationMayExist
                ? new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409)
                : beginError?.causeError
                    ?? (error instanceof CheckoutV2RescheduleError
                        ? error
                        : new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503)),
        );
    }

    try {
        await stripe.subscriptions.update(stripeSubscriptionId, {
            trial_end: targetAnchorUnix,
            proration_behavior: 'none',
            metadata: {
                ...remoteBefore.metadata,
                firstClassAt: newScheduledAt,
                renewalAnchorAt: targetAnchorIso,
                rescheduleOperationId: begunOperation.id,
            },
        }, {
            idempotencyKey: `checkout-v2-reschedule:${begunOperation.id}`,
        });
    } catch {
        let recovered;
        try {
            recovered = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        } catch {
            return closeOperationAndThrow(
                supabaseAdmin,
                begunOperation,
                'manual_review',
                'stripe_update_acceptance_unknown',
                new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
            );
        }
        if (
            stripeSubscriptionMatchesContract({
                stripeSubscription: recovered,
                stripeSubscriptionId,
                studentId: subscription.student_id,
                checkoutIntent,
                runtimeAccountId: runtime.accountId,
                runtimeLivemode: runtime.livemode,
                packagePrice,
                snapshot,
            })
            && subscriptionHasAnchor(recovered, targetAnchorUnix)
            && subscriptionHasAnchorMetadata(
                recovered,
                newScheduledAt,
                targetAnchorIso,
                begunOperation.id,
            )
        ) return targetAnchorIso;
        return closeOperationAndThrow(
            supabaseAdmin,
            begunOperation,
            'manual_review',
            'stripe_update_did_not_converge',
            new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
        );
    }

    let observed;
    try {
        observed = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    } catch {
        return closeOperationAndThrow(
            supabaseAdmin,
            begunOperation,
            'manual_review',
            'stripe_update_observation_unknown',
            new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
        );
    }
    if (
        !stripeSubscriptionMatchesContract({
            stripeSubscription: observed,
            stripeSubscriptionId,
            studentId: subscription.student_id,
            checkoutIntent,
            runtimeAccountId: runtime.accountId,
            runtimeLivemode: runtime.livemode,
            packagePrice,
            snapshot,
        })
        || !subscriptionHasAnchor(observed, targetAnchorUnix)
        || !subscriptionHasAnchorMetadata(
            observed,
            newScheduledAt,
            targetAnchorIso,
            begunOperation.id,
        )
    ) return closeOperationAndThrow(
        supabaseAdmin,
        begunOperation,
        'manual_review',
        'stripe_update_observation_diverged',
        new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
    );
    return targetAnchorIso;
}

export function normalizeCheckoutV2RescheduleInput(value: unknown): {
    requestId: string;
    sessionId: string;
    newScheduledAt: string;
} | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const body = value as Record<string, unknown>;
    const newScheduledAt = wholeSecondIso(body.newScheduledAt);
    if (!isUuid(body.requestId) || !isUuid(body.sessionId) || !newScheduledAt) return null;
    return { requestId: body.requestId, sessionId: body.sessionId, newScheduledAt };
}

export async function rescheduleCheckoutV2(input: {
    context: Pick<APIContext, 'locals'>;
    actorId: string;
    requestId: string;
    sessionId: string;
    newScheduledAt: string;
}): Promise<CheckoutV2RescheduleResult> {
    const supabaseAdmin = createSupabaseAdminClient();
    const operation = await prepareOperation(supabaseAdmin, input);

    if (operation.status === 'applied') {
        return { operationId: operation.id, operationKind: operation.operation_kind, replayed: true };
    }
    if (operation.status === 'failed') {
        throw new CheckoutV2RescheduleError('RESCHEDULE_CONFLICT', 409);
    }
    if (operation.status === 'manual_review' && operation.operation_kind !== 'provisional_anchor') {
        throw new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409);
    }

    const observedStripeAnchor = operation.operation_kind === 'provisional_anchor'
        ? await reconcileStripeAnchor(input.context, supabaseAdmin, operation)
        : null;
    try {
        await applyOperation(supabaseAdmin, operation, observedStripeAnchor);
    } catch (error) {
        if (operation.status !== 'manual_review') {
            const possibleStripeMutation = operation.operation_kind === 'provisional_anchor';
            await markOperationOutcome(
                supabaseAdmin,
                operation,
                possibleStripeMutation ? 'manual_review' : 'failed',
                possibleStripeMutation
                    ? 'database_apply_failed_after_stripe_convergence'
                    : 'single_session_database_apply_failed',
            );
        }
        if (operation.operation_kind === 'provisional_anchor') {
            throw new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409);
        }
        throw error;
    }
    return { operationId: operation.id, operationKind: operation.operation_kind, replayed: false };
}
