import type { APIContext } from 'astro';
import type Stripe from 'stripe';
import { PACKAGE_CURRENCY, VERSIONED_CONTRACT_SCHEMA_VERSION } from './package-pricing';
import { stripe } from './stripe';
import { assertStripeRuntimeAccount } from './stripe-runtime-guard';
import { createSupabaseAdminClient } from './supabase-admin';

const GUARANTEE_OPERATION_METADATA_KEY = 'guaranteeOperationId';
const REFUND_PAGE_SIZE = 100;
const REFUND_MAX_PAGES = 10;

class IncoherentStripeRefundListError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'IncoherentStripeRefundListError';
    }
}

class LocalGuaranteeContractError extends Error {
    constructor(public readonly retryable: boolean) {
        super(retryable ? 'local_contract_unavailable' : 'local_contract_incoherent');
        this.name = 'LocalGuaranteeContractError';
    }
}

type DatabaseError = { code?: string; message?: string };

export type CheckoutV2GuaranteePublicStatus =
    | 'not_started'
    | 'eligible'
    | 'closed'
    | 'processing'
    | 'refund_pending'
    | 'refunded'
    | 'retryable'
    | 'manual_review';

export type CheckoutV2GuaranteeResult = {
    subscriptionId: string | null;
    cycleId: string | null;
    status: CheckoutV2GuaranteePublicStatus;
    refundAmountCents: number;
    currency: string;
    sessionsTotal: number;
    sessionsConsumed: number;
    sessionsRefundable: number;
    operationId: string | null;
    reason: string | null;
};

export type CheckoutV2GuaranteeOperation = {
    id: string;
    request_id: string;
    subscription_id: string;
    cycle_id: string;
    payment_id: string;
    actor_id: string;
    first_session_id: string;
    second_session_id: string;
    third_session_id: string | null;
    fourth_session_id: string | null;
    package_price_id: string;
    cycle_number: number;
    sessions_total: number;
    sessions_consumed: number;
    session_base_amount_cents: number;
    session_remainder_units: number;
    stripe_customer_id: string;
    stripe_subscription_id: string;
    stripe_invoice_id: string;
    stripe_payment_intent_id: string;
    gross_amount_cents: number;
    refund_amount_cents: number;
    currency: string;
    status: 'requested' | 'processing' | 'refund_pending' | 'refunded' | 'retryable' | 'manual_review';
    lease_token: string | null;
    lease_expires_at: string | null;
    cancellation_started_at: string | null;
    stripe_cancelled_at: string | null;
    terminated_at: string | null;
    refund_started_at: string | null;
    stripe_refund_id: string | null;
    refund_status: string | null;
    refund_created_at: string | null;
    refunded_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
};

type GuaranteeStateRow = Partial<CheckoutV2GuaranteeOperation> & {
    state?: CheckoutV2GuaranteePublicStatus;
    operation_id?: string | null;
    reason?: string | null;
    sessions_refundable?: number;
};

type LocalSubscription = {
    id: string;
    student_id: string;
    package_price_id: string;
    checkout_intent_id: string;
    contract_schema_version: number;
    status: string;
    stripe_subscription_id: string;
    stripe_invoice_id: string;
};

type LocalCheckoutIntent = {
    id: string;
    student_id: string;
    package_price_id: string;
    stripe_customer_id: string;
};

type LocalPackagePrice = {
    id: string;
    stripe_account_id: string;
    stripe_livemode: boolean;
    stripe_product_id: string;
};

type LocalPriceSnapshot = {
    package_price_id: string;
    initial_amount_cents: number;
    initial_stripe_price_id: string;
    recurring_amount_cents: number;
    recurring_stripe_price_id: string;
    recurring_interval_count: number;
    recurring_interval_unit: string;
    sessions_per_period: number;
    session_base_amount_cents: number;
    session_remainder_units: number;
    currency: string;
    stripe_account_id: string;
    stripe_livemode: boolean;
};

type LocalPayment = {
    id: string;
    student_id: string;
    subscription_id: string;
    amount: number;
    currency: string;
    status: string;
    stripe_invoice_id: string;
    stripe_payment_intent_id: string;
};

type LocalStripeContract = {
    subscription: LocalSubscription;
    checkoutIntent: LocalCheckoutIntent;
    packagePrice: LocalPackagePrice;
    snapshot: LocalPriceSnapshot;
    payment: LocalPayment;
};

type RpcResult<T> = Promise<{ data: T | null; error: DatabaseError | null }>;
type GuaranteeRpc = (name: string, args: Record<string, unknown>) => RpcResult<unknown>;
type GuaranteeAdmin = ReturnType<typeof createSupabaseAdminClient> & { rpc: GuaranteeRpc };
type GuaranteeOperationQuery = {
    select(columns: string): GuaranteeOperationQuery;
    eq(column: string, value: unknown): GuaranteeOperationQuery;
    single(): Promise<{ data: CheckoutV2GuaranteeOperation | null; error: DatabaseError | null }>;
};

function guaranteeOperations(admin: GuaranteeAdmin): GuaranteeOperationQuery {
    return (admin as unknown as { from(relation: string): GuaranteeOperationQuery })
        .from('checkout_v2_guarantee_operations');
}

export type CheckoutV2GuaranteeErrorCode =
    | 'GUARANTEE_CLOSED'
    | 'GUARANTEE_FORBIDDEN'
    | 'GUARANTEE_NOT_FOUND'
    | 'GUARANTEE_REQUIRES_REVIEW'
    | 'GUARANTEE_RETRYABLE';

export class CheckoutV2GuaranteeError extends Error {
    constructor(
        public readonly code: CheckoutV2GuaranteeErrorCode,
        public readonly status: 202 | 403 | 404 | 409 | 503,
        public readonly guarantee: CheckoutV2GuaranteeResult,
    ) {
        super(code);
        this.name = 'CheckoutV2GuaranteeError';
    }
}

function isUuid(value: unknown): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function normalizeCheckoutV2GuaranteeSubscriptionId(value: unknown): string | null {
    return isUuid(value) ? value : null;
}

export function normalizeCheckoutV2GuaranteeRequest(value: unknown): {
    requestId: string;
    subscriptionId: string;
} | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const input = value as { requestId?: unknown; subscriptionId?: unknown };
    if (!isUuid(input.requestId) || !isUuid(input.subscriptionId)) return null;
    return { requestId: input.requestId, subscriptionId: input.subscriptionId };
}

function oneRow(value: unknown): GuaranteeStateRow | null {
    const row = Array.isArray(value) ? value[0] : value;
    return row && typeof row === 'object' && !Array.isArray(row)
        ? row as GuaranteeStateRow
        : null;
}

function publicStatus(row: GuaranteeStateRow): CheckoutV2GuaranteePublicStatus {
    if (row.state) return row.state;
    if (row.status === 'requested' || row.status === 'processing') return 'processing';
    if (row.status === 'refund_pending') return 'refund_pending';
    if (row.status === 'refunded') return 'refunded';
    if (row.status === 'retryable') return 'retryable';
    if (row.status === 'manual_review') return 'manual_review';
    return 'not_started';
}

function toPublicResult(row: GuaranteeStateRow | null, subscriptionId: string | null): CheckoutV2GuaranteeResult {
    const sessionsTotal = Number.isSafeInteger(row?.sessions_total) ? row?.sessions_total ?? 0 : 0;
    const sessionsConsumed = Number.isSafeInteger(row?.sessions_consumed) ? row?.sessions_consumed ?? 0 : 0;
    const derivedRefundable = Math.max(sessionsTotal - sessionsConsumed, 0);
    return {
        subscriptionId: typeof row?.subscription_id === 'string' ? row.subscription_id : subscriptionId,
        cycleId: typeof row?.cycle_id === 'string' ? row.cycle_id : null,
        status: row ? publicStatus(row) : 'not_started',
        refundAmountCents: typeof row?.refund_amount_cents === 'number'
            ? row.refund_amount_cents
            : 0,
        currency: typeof row?.currency === 'string' ? row.currency.toLowerCase() : PACKAGE_CURRENCY,
        sessionsTotal,
        sessionsConsumed,
        sessionsRefundable: Number.isSafeInteger(row?.sessions_refundable)
            ? row?.sessions_refundable ?? 0
            : derivedRefundable,
        operationId: typeof row?.id === 'string'
            ? row.id
            : typeof row?.operation_id === 'string'
                ? row.operation_id
                : null,
        reason: typeof row?.reason === 'string'
            ? row.reason
            : typeof row?.last_error === 'string'
                ? row.last_error
                : null,
    };
}

function databaseFailure(error: DatabaseError | null, subscriptionId: string, operation?: GuaranteeStateRow | null): CheckoutV2GuaranteeError {
    const result = toPublicResult(operation ?? null, subscriptionId);
    if (error?.code === '42501') {
        result.reason = 'GUARANTEE_FORBIDDEN';
        return new CheckoutV2GuaranteeError('GUARANTEE_FORBIDDEN', 403, result);
    }
    if (error?.code === 'P0002') {
        result.reason = 'GUARANTEE_NOT_FOUND';
        return new CheckoutV2GuaranteeError('GUARANTEE_NOT_FOUND', 404, result);
    }
    if (
        error?.message?.includes('checkout_v2_guarantee_requires_manual_review') === true
        || error?.message?.includes('checkout_v2_guarantee_review_') === true
    ) {
        result.status = 'manual_review';
        result.reason = 'GUARANTEE_REQUIRES_REVIEW';
        return new CheckoutV2GuaranteeError('GUARANTEE_REQUIRES_REVIEW', 202, result);
    }
    if (
        error?.message?.includes('checkout_v2_guarantee_closed') === true
        || error?.message?.includes('checkout_v2_guarantee_not_eligible') === true
        || error?.message?.includes('checkout_v2_guarantee_state_changed') === true
        || error?.message?.includes('checkout_v2_guarantee_request_id_conflicts') === true
    ) {
        result.status = 'closed';
        result.reason = 'GUARANTEE_CLOSED';
        return new CheckoutV2GuaranteeError('GUARANTEE_CLOSED', 409, result);
    }
    result.status = 'retryable';
    result.reason = 'GUARANTEE_RETRYABLE';
    return new CheckoutV2GuaranteeError('GUARANTEE_RETRYABLE', 503, result);
}

async function callRpc(
    admin: GuaranteeAdmin,
    name: string,
    args: Record<string, unknown>,
    subscriptionId: string,
    fallbackOperation: GuaranteeStateRow | null = null,
): Promise<GuaranteeStateRow> {
    const { data, error } = await admin.rpc(name, args);
    const row = oneRow(data);
    if (error) throw databaseFailure(error, subscriptionId, row ?? fallbackOperation);
    if (!row) throw databaseFailure(null, subscriptionId);
    return row;
}

export async function getCheckoutV2GuaranteeState(input: {
    actorId: string;
    subscriptionId: string;
}): Promise<CheckoutV2GuaranteeResult> {
    if (!isUuid(input.actorId) || !isUuid(input.subscriptionId)) {
        throw databaseFailure({ code: '22023' }, input.subscriptionId);
    }
    const admin = createSupabaseAdminClient() as GuaranteeAdmin;
    const row = await callRpc(admin, 'get_checkout_v2_guarantee_state', {
        p_subscription_id: input.subscriptionId,
        p_actor_id: input.actorId,
    }, input.subscriptionId);
    return toPublicResult(row, input.subscriptionId);
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
}

function stripeProductId(value: string | Stripe.Product | Stripe.DeletedProduct): string {
    return typeof value === 'string' ? value : value.id;
}

function stripeErrorIsRetryable(error: unknown): boolean {
    if (!error || typeof error !== 'object') return true;
    const candidate = error as { statusCode?: unknown; raw?: { statusCode?: unknown } };
    const status = typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : typeof candidate.raw?.statusCode === 'number'
            ? candidate.raw.statusCode
            : null;
    return status === null || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function loadLocalContract(admin: GuaranteeAdmin, operation: CheckoutV2GuaranteeOperation): Promise<LocalStripeContract> {
    const subscriptionResponse = await admin
        .from('subscriptions')
        .select('id, student_id, package_price_id, checkout_intent_id, contract_schema_version, status, stripe_subscription_id, stripe_invoice_id')
        .eq('id', operation.subscription_id)
        .single() as unknown as { data: LocalSubscription | null; error: DatabaseError | null };
    if (subscriptionResponse.error) {
        throw new LocalGuaranteeContractError(subscriptionResponse.error.code !== 'PGRST116');
    }
    if (!subscriptionResponse.data) throw new LocalGuaranteeContractError(false);
    const subscription = subscriptionResponse.data;

    const [intentResponse, packageResponse, snapshotResponse, paymentResponse] = await Promise.all([
        admin.from('checkout_intents').select('id, student_id, package_price_id, stripe_customer_id')
            .eq('id', subscription.checkout_intent_id).single(),
        admin.from('package_prices').select('id, stripe_account_id, stripe_livemode, stripe_product_id')
            .eq('id', subscription.package_price_id).single(),
        admin.from('checkout_v2_price_snapshots')
            .select('package_price_id, initial_amount_cents, initial_stripe_price_id, recurring_amount_cents, recurring_stripe_price_id, recurring_interval_count, recurring_interval_unit, sessions_per_period, session_base_amount_cents, session_remainder_units, currency, stripe_account_id, stripe_livemode')
            .eq('package_price_id', subscription.package_price_id).single(),
        admin.from('payments')
            .select('id, student_id, subscription_id, amount, currency, status, stripe_invoice_id, stripe_payment_intent_id')
            .eq('id', operation.payment_id)
            .eq('subscription_id', subscription.id)
            .eq('stripe_invoice_id', operation.stripe_invoice_id)
            .eq('stripe_payment_intent_id', operation.stripe_payment_intent_id)
            .order('created_at', { ascending: true }).limit(1).maybeSingle(),
    ]) as unknown as [
        { data: LocalCheckoutIntent | null; error: DatabaseError | null },
        { data: LocalPackagePrice | null; error: DatabaseError | null },
        { data: LocalPriceSnapshot | null; error: DatabaseError | null },
        { data: LocalPayment | null; error: DatabaseError | null },
    ];
    if (intentResponse.error || packageResponse.error || snapshotResponse.error || paymentResponse.error) {
        const errors = [intentResponse.error, packageResponse.error, snapshotResponse.error, paymentResponse.error]
            .filter((error): error is DatabaseError => Boolean(error));
        throw new LocalGuaranteeContractError(errors.some((error) => error.code !== 'PGRST116'));
    }
    if (!intentResponse.data || !packageResponse.data || !snapshotResponse.data || !paymentResponse.data) {
        throw new LocalGuaranteeContractError(false);
    }
    return {
        subscription,
        checkoutIntent: intentResponse.data,
        packagePrice: packageResponse.data,
        snapshot: snapshotResponse.data,
        payment: paymentResponse.data,
    };
}

function operationIsValid(value: GuaranteeStateRow, expected: { subscriptionId: string; actorId: string }): value is CheckoutV2GuaranteeOperation {
    const sessionsTotal = value.sessions_total;
    const sessionsConsumed = value.sessions_consumed;
    const baseAmount = value.session_base_amount_cents;
    const remainder = value.session_remainder_units;
    const grossAmount = value.gross_amount_cents;
    const refundAmount = value.refund_amount_cents;
    const hasValidAllocation = Number.isSafeInteger(sessionsTotal)
        && Number.isSafeInteger(sessionsConsumed)
        && Number.isSafeInteger(baseAmount)
        && Number.isSafeInteger(remainder)
        && Number.isSafeInteger(grossAmount)
        && Number.isSafeInteger(refundAmount)
        && (sessionsTotal ?? 0) >= 2
        && (sessionsTotal ?? 0) <= 200
        && (sessionsConsumed ?? 0) >= 1
        && (sessionsConsumed ?? 0) < (sessionsTotal ?? 0)
        && (baseAmount ?? 0) > 0
        && (remainder ?? -1) >= 0
        && (remainder ?? 0) < (sessionsTotal ?? 0)
        && grossAmount === (baseAmount ?? 0) * (sessionsTotal ?? 0) + (remainder ?? 0)
        && refundAmount === (baseAmount ?? 0) * ((sessionsTotal ?? 0) - (sessionsConsumed ?? 0))
            + Math.max((remainder ?? 0) - (sessionsConsumed ?? 0), 0);
    return isUuid(value.id)
        && isUuid(value.request_id)
        && value.subscription_id === expected.subscriptionId
        && isUuid(value.cycle_id)
        && isUuid(value.payment_id)
        && value.actor_id === expected.actorId
        && isUuid(value.first_session_id)
        && isUuid(value.second_session_id)
        && ((sessionsTotal ?? 0) < 3 ? value.third_session_id == null : isUuid(value.third_session_id))
        && ((sessionsTotal ?? 0) < 4 ? value.fourth_session_id == null : isUuid(value.fourth_session_id))
        && isUuid(value.package_price_id)
        && Number.isSafeInteger(value.cycle_number)
        && (value.cycle_number ?? 0) > 0
        && typeof value.stripe_customer_id === 'string'
        && typeof value.stripe_subscription_id === 'string'
        && typeof value.stripe_invoice_id === 'string'
        && typeof value.stripe_payment_intent_id === 'string'
        && hasValidAllocation
        && typeof value.currency === 'string'
        && /^[a-z]{3}$/.test(value.currency.toLowerCase())
        && ['requested', 'processing', 'refund_pending', 'refunded', 'retryable', 'manual_review'].includes(value.status ?? '');
}

function hasActiveLease(operation: CheckoutV2GuaranteeOperation, workerToken: string): boolean {
    const expiresAt = operation.lease_expires_at ? Date.parse(operation.lease_expires_at) : Number.NaN;
    return operation.lease_token === workerToken
        && Number.isFinite(expiresAt)
        && expiresAt > Date.now();
}

function requireActiveLease(operation: CheckoutV2GuaranteeOperation, workerToken: string): void {
    if (hasActiveLease(operation, workerToken)) return;
    const result = toPublicResult(operation, operation.subscription_id);
    result.status = 'retryable';
    result.reason = 'GUARANTEE_RETRYABLE';
    throw new CheckoutV2GuaranteeError('GUARANTEE_RETRYABLE', 503, result);
}

function localContractMatches(operation: CheckoutV2GuaranteeOperation, contract: LocalStripeContract): boolean {
    const { subscription, checkoutIntent, packagePrice, snapshot, payment } = contract;
    const expectedGrossAmount = operation.cycle_number === 1
        ? snapshot.initial_amount_cents
        : snapshot.recurring_amount_cents;
    return subscription.id === operation.subscription_id
        && subscription.student_id === operation.actor_id
        && subscription.package_price_id === operation.package_price_id
        && subscription.contract_schema_version === VERSIONED_CONTRACT_SCHEMA_VERSION
        && subscription.stripe_subscription_id === operation.stripe_subscription_id
        && (
            operation.cycle_number > 1
            || subscription.stripe_invoice_id === operation.stripe_invoice_id
        )
        && checkoutIntent.id === subscription.checkout_intent_id
        && checkoutIntent.student_id === operation.actor_id
        && checkoutIntent.package_price_id === subscription.package_price_id
        && checkoutIntent.stripe_customer_id === operation.stripe_customer_id
        && packagePrice.id === subscription.package_price_id
        && snapshot.package_price_id === subscription.package_price_id
        && snapshot.sessions_per_period === operation.sessions_total
        && snapshot.session_base_amount_cents === operation.session_base_amount_cents
        && snapshot.session_remainder_units === operation.session_remainder_units
        && expectedGrossAmount === operation.gross_amount_cents
        && snapshot.currency.toLowerCase() === operation.currency
        && ['day', 'week', 'month', 'year'].includes(snapshot.recurring_interval_unit)
        && Number.isSafeInteger(snapshot.recurring_interval_count)
        && snapshot.recurring_interval_count > 0
        && payment.id === operation.payment_id
        && payment.student_id === operation.actor_id
        && payment.subscription_id === operation.subscription_id
        && payment.amount === operation.gross_amount_cents
        && payment.currency.toLowerCase() === operation.currency
        && payment.status === 'succeeded'
        && payment.stripe_invoice_id === operation.stripe_invoice_id
        && payment.stripe_payment_intent_id === operation.stripe_payment_intent_id;
}

function remoteSubscriptionMatches(
    operation: CheckoutV2GuaranteeOperation,
    contract: LocalStripeContract,
    remote: Stripe.Subscription,
    accountId: string,
    livemode: boolean,
): boolean {
    const item = remote.items.data[0];
    const price = item?.price;
    return remote.id === operation.stripe_subscription_id
        && remote.livemode === livemode
        && ['trialing', 'active', 'canceled'].includes(remote.status)
        && stripeObjectId(remote.customer) === operation.stripe_customer_id
        && stripeObjectId(remote.latest_invoice) === operation.stripe_invoice_id
        && remote.metadata.contractSchemaVersion === String(VERSIONED_CONTRACT_SCHEMA_VERSION)
        && remote.metadata.userId === operation.actor_id
        && remote.metadata.checkoutIntentId === contract.checkoutIntent.id
        && remote.metadata.packagePriceId === contract.packagePrice.id
        && remote.items.data.length === 1
        && item.quantity === 1
        && price?.id === contract.snapshot.recurring_stripe_price_id
        && price.type === 'recurring'
        && price.unit_amount === contract.snapshot.recurring_amount_cents
        && price.currency.toLowerCase() === operation.currency
        && price.livemode === livemode
        && price.recurring?.interval === contract.snapshot.recurring_interval_unit
        && price.recurring.interval_count === contract.snapshot.recurring_interval_count
        && stripeProductId(price.product) === contract.packagePrice.stripe_product_id
        && contract.packagePrice.stripe_account_id === accountId
        && contract.packagePrice.stripe_livemode === livemode
        && contract.snapshot.stripe_account_id === accountId
        && contract.snapshot.stripe_livemode === livemode;
}

async function invoicePaymentIntentId(invoiceId: string): Promise<string | null> {
    const mappings = await stripe.invoicePayments.list({ invoice: invoiceId });
    const matches = mappings.data.filter((row) => row.payment.type === 'payment_intent');
    if (matches.length !== 1) return null;
    return stripeObjectId(matches[0].payment.payment_intent);
}

function paymentIntentMatches(
    operation: CheckoutV2GuaranteeOperation,
    intent: Stripe.PaymentIntent,
    livemode: boolean,
): boolean {
    return intent.id === operation.stripe_payment_intent_id
        && intent.livemode === livemode
        && intent.status === 'succeeded'
        && intent.amount === operation.gross_amount_cents
        && intent.amount_received === operation.gross_amount_cents
        && intent.currency.toLowerCase() === operation.currency
        && stripeObjectId(intent.customer) === operation.stripe_customer_id;
}

function invoiceMatches(
    operation: CheckoutV2GuaranteeOperation,
    invoice: Stripe.Invoice,
    livemode: boolean,
): boolean {
    return invoice.id === operation.stripe_invoice_id
        && invoice.livemode === livemode
        && invoice.status === 'paid'
        && invoice.total === operation.gross_amount_cents
        && invoice.amount_paid === operation.gross_amount_cents
        && stripeObjectId(invoice.customer) === operation.stripe_customer_id
        && invoice.currency.toLowerCase() === operation.currency
        && stripeObjectId(invoice.parent?.subscription_details?.subscription) === operation.stripe_subscription_id;
}

async function listPaymentIntentRefunds(paymentIntentId: string): Promise<Stripe.Refund[]> {
    const refunds: Stripe.Refund[] = [];
    const identifiers = new Set<string>();
    let startingAfter: string | undefined;
    for (let page = 0; page < REFUND_MAX_PAGES; page += 1) {
        const response = await stripe.refunds.list({
            payment_intent: paymentIntentId,
            limit: REFUND_PAGE_SIZE,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const refund of response.data) {
            if (!refund.id || identifiers.has(refund.id)) throw new IncoherentStripeRefundListError('ambiguous_refund_list');
            identifiers.add(refund.id);
            refunds.push(refund);
        }
        if (!response.has_more) return refunds;
        startingAfter = response.data.at(-1)?.id;
        if (!startingAfter) throw new IncoherentStripeRefundListError('ambiguous_refund_pagination');
    }
    throw new IncoherentStripeRefundListError('refund_pagination_limit');
}

function exactGuaranteeRefund(operation: CheckoutV2GuaranteeOperation, refund: Stripe.Refund): boolean {
    const metadata = refund.metadata;
    return stripeObjectId(refund.payment_intent) === operation.stripe_payment_intent_id
        && refund.amount === operation.refund_amount_cents
        && refund.currency.toLowerCase() === operation.currency
        && ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(refund.status ?? '')
        && Number.isSafeInteger(refund.created)
        && refund.created > 0
        && metadata?.[GUARANTEE_OPERATION_METADATA_KEY] === operation.id
        && metadata?.subscriptionId === operation.subscription_id
        && metadata?.paymentId === operation.payment_id
        && metadata?.contractSchemaVersion === String(VERSIONED_CONTRACT_SCHEMA_VERSION);
}

function classifyRefunds(operation: CheckoutV2GuaranteeOperation, refunds: Stripe.Refund[]): Stripe.Refund | null {
    const exact = refunds.filter((refund) => exactGuaranteeRefund(operation, refund));
    if (refunds.some((refund) => !exactGuaranteeRefund(operation, refund)) || exact.length > 1) {
        throw new Error('unrelated_or_ambiguous_refund');
    }
    return exact[0] ?? null;
}

async function markOutcome(
    admin: GuaranteeAdmin,
    operation: CheckoutV2GuaranteeOperation,
    workerToken: string,
    status: 'retryable' | 'manual_review',
    reason: string,
): Promise<CheckoutV2GuaranteeResult> {
    const row = await callRpc(admin, 'mark_checkout_v2_guarantee_outcome', {
        p_operation_id: operation.id,
        p_worker_token: workerToken,
        p_status: status,
        p_error: reason,
    }, operation.subscription_id, operation);
    return toPublicResult(row, operation.subscription_id);
}

async function observeRefund(
    admin: GuaranteeAdmin,
    operation: CheckoutV2GuaranteeOperation,
    refund: Stripe.Refund,
): Promise<CheckoutV2GuaranteeResult> {
    const row = await callRpc(admin, 'observe_checkout_v2_guarantee_refund', {
        p_operation_id: operation.id,
        p_stripe_refund_id: refund.id,
        p_refund_status: refund.status,
        p_refund_created_at: new Date(refund.created * 1000).toISOString(),
        p_amount_cents: refund.amount,
        p_currency: refund.currency.toLowerCase(),
        p_stripe_payment_intent_id: stripeObjectId(refund.payment_intent),
    }, operation.subscription_id, operation);
    return toPublicResult(row, operation.subscription_id);
}

function isCanceledSubscription(subscription: Stripe.Subscription, operation: CheckoutV2GuaranteeOperation): boolean {
    return subscription.status === 'canceled'
        && typeof subscription.canceled_at === 'number'
        && subscription.canceled_at > 0
        && subscription.cancellation_details?.comment === `checkout-v2-guarantee:${operation.id}`;
}

export async function runCheckoutV2Guarantee(input: {
    context: Pick<APIContext, 'locals'>;
    actorId: string;
    requestId: string;
    subscriptionId: string;
}): Promise<CheckoutV2GuaranteeResult> {
    const admin = createSupabaseAdminClient() as GuaranteeAdmin;
    let row = await callRpc(admin, 'prepare_checkout_v2_guarantee', {
        p_request_id: input.requestId,
        p_subscription_id: input.subscriptionId,
        p_actor_id: input.actorId,
    }, input.subscriptionId);
    if (!operationIsValid(row, input)) throw databaseFailure({ code: '23514' }, input.subscriptionId, row);
    let operation = row;
    if (operation.status === 'refunded' || operation.status === 'manual_review') {
        return toPublicResult(operation, input.subscriptionId);
    }

    const workerToken = crypto.randomUUID();
    row = await callRpc(admin, 'claim_checkout_v2_guarantee', {
        p_operation_id: operation.id,
        p_worker_token: workerToken,
    }, operation.subscription_id, operation);
    if (!operationIsValid(row, input)) throw databaseFailure({ code: '23514' }, input.subscriptionId, row);
    operation = row;
    requireActiveLease(operation, workerToken);

    let contract: LocalStripeContract;
    let account: Stripe.Account;
    let remoteSubscription: Stripe.Subscription;
    let paymentIntent: Stripe.PaymentIntent;
    let invoice: Stripe.Invoice;
    try {
        contract = await loadLocalContract(admin, operation);
        [account, remoteSubscription, paymentIntent, invoice] = await Promise.all([
            stripe.accounts.retrieve(),
            stripe.subscriptions.retrieve(operation.stripe_subscription_id),
            stripe.paymentIntents.retrieve(operation.stripe_payment_intent_id),
            stripe.invoices.retrieve(operation.stripe_invoice_id),
        ]);
    } catch (error) {
        if (error instanceof LocalGuaranteeContractError && !error.retryable) {
            return markOutcome(admin, operation, workerToken, 'manual_review', 'local_contract_preflight_failed');
        }
        if (stripeErrorIsRetryable(error)) return markOutcome(admin, operation, workerToken, 'retryable', 'preflight_temporarily_unavailable');
        return markOutcome(admin, operation, workerToken, 'manual_review', 'preflight_request_rejected');
    }

    let runtime;
    try {
        runtime = assertStripeRuntimeAccount(input.context, account);
    } catch {
        return markOutcome(admin, operation, workerToken, 'manual_review', 'stripe_runtime_guard_failed');
    }

    let invoiceIntentId: string | null;
    try {
        invoiceIntentId = await invoicePaymentIntentId(operation.stripe_invoice_id);
    } catch (error) {
        if (stripeErrorIsRetryable(error)) return markOutcome(admin, operation, workerToken, 'retryable', 'invoice_mapping_temporarily_unavailable');
        return markOutcome(admin, operation, workerToken, 'manual_review', 'invoice_mapping_rejected');
    }
    if (
        !localContractMatches(operation, contract)
        || !remoteSubscriptionMatches(operation, contract, remoteSubscription, runtime.accountId, runtime.livemode)
        || !paymentIntentMatches(operation, paymentIntent, runtime.livemode)
        || !invoiceMatches(operation, invoice, runtime.livemode)
        || invoiceIntentId !== operation.stripe_payment_intent_id
    ) return markOutcome(admin, operation, workerToken, 'manual_review', 'stripe_contract_preflight_failed');

    let refunds: Stripe.Refund[];
    try {
        refunds = await listPaymentIntentRefunds(operation.stripe_payment_intent_id);
    } catch (error) {
        if (error instanceof IncoherentStripeRefundListError) {
            return markOutcome(admin, operation, workerToken, 'manual_review', 'refund_preflight_incoherent');
        }
        if (stripeErrorIsRetryable(error)) return markOutcome(admin, operation, workerToken, 'retryable', 'refund_preflight_temporarily_unavailable');
        return markOutcome(admin, operation, workerToken, 'manual_review', 'refund_preflight_incoherent');
    }
    let refund: Stripe.Refund | null;
    try {
        refund = classifyRefunds(operation, refunds);
    } catch {
        return markOutcome(admin, operation, workerToken, 'manual_review', 'unrelated_or_ambiguous_refund');
    }

    if (refund) return observeRefund(admin, operation, refund);

    if (!isCanceledSubscription(remoteSubscription, operation)) {
        row = await callRpc(admin, 'begin_checkout_v2_guarantee_cancellation', {
            p_operation_id: operation.id,
            p_worker_token: workerToken,
        }, operation.subscription_id, operation);
        if (!operationIsValid(row, input)) throw databaseFailure({ code: '23514' }, input.subscriptionId, row);
        operation = row;
        requireActiveLease(operation, workerToken);
        try {
            remoteSubscription = await stripe.subscriptions.cancel(operation.stripe_subscription_id, {
                invoice_now: false,
                prorate: false,
                cancellation_details: { comment: `checkout-v2-guarantee:${operation.id}` },
            });
        } catch {
            try {
                remoteSubscription = await stripe.subscriptions.retrieve(operation.stripe_subscription_id);
            } catch {
                return markOutcome(admin, operation, workerToken, 'retryable', 'subscription_cancellation_acceptance_unknown');
            }
        }
        if (!remoteSubscriptionMatches(operation, contract, remoteSubscription, runtime.accountId, runtime.livemode)) {
            return markOutcome(admin, operation, workerToken, 'manual_review', 'subscription_after_cancellation_incoherent');
        }
        if (!isCanceledSubscription(remoteSubscription, operation)) {
            return markOutcome(admin, operation, workerToken, 'manual_review', 'subscription_cancellation_did_not_converge');
        }
    }

    const canceledAt = new Date((remoteSubscription.canceled_at as number) * 1000).toISOString();
    row = await callRpc(admin, 'apply_checkout_v2_guarantee_termination', {
        p_operation_id: operation.id,
        p_worker_token: workerToken,
        p_stripe_cancelled_at: canceledAt,
    }, operation.subscription_id, operation);
    if (!operationIsValid(row, input)) throw databaseFailure({ code: '23514' }, input.subscriptionId, row);
    operation = row;
    requireActiveLease(operation, workerToken);

    try {
        refunds = await listPaymentIntentRefunds(operation.stripe_payment_intent_id);
    } catch (error) {
        if (error instanceof IncoherentStripeRefundListError) {
            return markOutcome(admin, operation, workerToken, 'manual_review', 'refund_reconciliation_incoherent');
        }
        if (stripeErrorIsRetryable(error)) return markOutcome(admin, operation, workerToken, 'retryable', 'refund_reconciliation_temporarily_unavailable');
        return markOutcome(admin, operation, workerToken, 'manual_review', 'refund_reconciliation_incoherent');
    }
    try {
        refund = classifyRefunds(operation, refunds);
    } catch {
        return markOutcome(admin, operation, workerToken, 'manual_review', 'refund_reconciliation_incoherent');
    }
    if (refund) return observeRefund(admin, operation, refund);

    row = await callRpc(admin, 'begin_checkout_v2_guarantee_refund', {
        p_operation_id: operation.id,
        p_worker_token: workerToken,
    }, operation.subscription_id, operation);
    if (!operationIsValid(row, input)) throw databaseFailure({ code: '23514' }, input.subscriptionId, row);
    operation = row;
    requireActiveLease(operation, workerToken);

    try {
        refund = await stripe.refunds.create({
            payment_intent: operation.stripe_payment_intent_id,
            amount: operation.refund_amount_cents,
            reason: 'requested_by_customer',
            metadata: {
                guaranteeOperationId: operation.id,
                subscriptionId: operation.subscription_id,
                paymentId: operation.payment_id,
                contractSchemaVersion: String(VERSIONED_CONTRACT_SCHEMA_VERSION),
            },
        }, { idempotencyKey: `checkout-v2-guarantee-refund:${operation.id}` });
    } catch (createError) {
        try {
            refunds = await listPaymentIntentRefunds(operation.stripe_payment_intent_id);
        } catch (error) {
            if (error instanceof IncoherentStripeRefundListError) {
                return markOutcome(admin, operation, workerToken, 'manual_review', 'refund_reconciliation_incoherent');
            }
            return markOutcome(admin, operation, workerToken, 'retryable', 'refund_acceptance_unknown');
        }
        try {
            refund = classifyRefunds(operation, refunds);
        } catch {
            return markOutcome(admin, operation, workerToken, 'manual_review', 'unrelated_or_ambiguous_refund');
        }
        if (!refund) {
            return stripeErrorIsRetryable(createError)
                ? markOutcome(admin, operation, workerToken, 'retryable', 'refund_acceptance_unknown')
                : markOutcome(admin, operation, workerToken, 'manual_review', 'refund_create_rejected');
        }
    }
    if (!exactGuaranteeRefund(operation, refund)) {
        return markOutcome(admin, operation, workerToken, 'manual_review', 'created_refund_incoherent');
    }
    return observeRefund(admin, operation, refund);
}

export async function resumeCheckoutV2GuaranteeOperation(input: {
    context: Pick<APIContext, 'locals'>;
    operationId: string;
}): Promise<CheckoutV2GuaranteeResult> {
    if (!isUuid(input.operationId)) {
        throw databaseFailure({ code: '22023' }, '');
    }
    const admin = createSupabaseAdminClient() as GuaranteeAdmin;
    const { data, error } = await guaranteeOperations(admin)
        .select('*')
        .eq('id', input.operationId)
        .single() as unknown as { data: CheckoutV2GuaranteeOperation | null; error: DatabaseError | null };
    if (error || !data) throw databaseFailure(error ?? { code: 'P0002' }, '');
    const rawOperation: GuaranteeStateRow = data;
    if (!operationIsValid(rawOperation, { subscriptionId: data.subscription_id, actorId: data.actor_id })) {
        throw databaseFailure({ code: '23514' }, data.subscription_id, rawOperation);
    }
    if (rawOperation.status === 'manual_review' || rawOperation.status === 'refunded') {
        return toPublicResult(rawOperation, rawOperation.subscription_id);
    }
    return runCheckoutV2Guarantee({
        context: input.context,
        actorId: rawOperation.actor_id,
        requestId: rawOperation.request_id,
        subscriptionId: rawOperation.subscription_id,
    });
}

function operationError(
    operation: CheckoutV2GuaranteeOperation,
    status: 'retryable' | 'manual_review',
    reason: string,
): CheckoutV2GuaranteeError {
    const guarantee = toPublicResult(operation, operation.subscription_id);
    guarantee.status = status;
    guarantee.reason = reason;
    return new CheckoutV2GuaranteeError(
        status === 'retryable' ? 'GUARANTEE_RETRYABLE' : 'GUARANTEE_REQUIRES_REVIEW',
        status === 'retryable' ? 503 : 202,
        guarantee,
    );
}

async function loadGuaranteeOperationById(
    admin: GuaranteeAdmin,
    operationId: string,
): Promise<CheckoutV2GuaranteeOperation> {
    const { data, error } = await guaranteeOperations(admin)
        .select('*')
        .eq('id', operationId)
        .single();
    if (error || !data) throw databaseFailure(error ?? { code: 'P0002' }, '');
    const raw: GuaranteeStateRow = data;
    if (!operationIsValid(raw, { subscriptionId: data.subscription_id, actorId: data.actor_id })) {
        throw databaseFailure({ code: '23514', message: 'guarantee_operation_snapshot_invalid' }, data.subscription_id, raw);
    }
    return raw;
}

export async function resolveCheckoutV2GuaranteeReview(input: {
    context: Pick<APIContext, 'locals'>;
    operationId: string;
    adminId: string;
    reason: string;
}): Promise<CheckoutV2GuaranteeResult> {
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!isUuid(input.operationId) || !isUuid(input.adminId) || reason.length < 5 || reason.length > 2_000) {
        throw databaseFailure({ code: '22023', message: 'invalid_checkout_v2_guarantee_review_resolution' }, '');
    }
    const admin = createSupabaseAdminClient() as GuaranteeAdmin;
    const before = await loadGuaranteeOperationById(admin, input.operationId);
    if (before.status !== 'manual_review') {
        throw operationError(before, 'manual_review', 'GUARANTEE_REVIEW_REQUIRED');
    }
    if (
        before.stripe_refund_id
        || before.refund_status
        || before.refund_created_at
        || before.refunded_at
    ) {
        throw operationError(before, 'manual_review', 'GUARANTEE_REFUND_REQUIRES_MANUAL_RESOLUTION');
    }

    const resolved = await callRpc(admin, 'resolve_checkout_v2_guarantee_review', {
        p_operation_id: before.id,
        p_admin_id: input.adminId,
        p_reason: reason,
    }, before.subscription_id, before);
    if (
        !operationIsValid(resolved, { subscriptionId: before.subscription_id, actorId: before.actor_id })
        || resolved.id !== before.id
        || resolved.request_id !== before.request_id
        || resolved.status !== 'retryable'
    ) throw operationError(before, 'retryable', 'GUARANTEE_REVIEW_RESOLUTION_INCOHERENT');

    return runCheckoutV2Guarantee({
        context: input.context,
        actorId: resolved.actor_id,
        requestId: resolved.request_id,
        subscriptionId: resolved.subscription_id,
    });
}

export async function reconcileCheckoutV2GuaranteeRefundOperation(input: {
    context: Pick<APIContext, 'locals'>;
    operationId: string;
}): Promise<CheckoutV2GuaranteeResult> {
    if (!isUuid(input.operationId)) throw databaseFailure({ code: '22023' }, '');
    const admin = createSupabaseAdminClient() as GuaranteeAdmin;
    const operation = await loadGuaranteeOperationById(admin, input.operationId);
    if (operation.status === 'refunded') return toPublicResult(operation, operation.subscription_id);
    if (
        !['manual_review', 'refund_pending'].includes(operation.status)
        || !operation.stripe_refund_id
        || !operation.refund_started_at
        || !operation.terminated_at
    ) throw operationError(operation, 'manual_review', 'GUARANTEE_REFUND_RECONCILIATION_UNAVAILABLE');

    let account: Stripe.Account;
    let paymentIntent: Stripe.PaymentIntent;
    let retrievedRefund: Stripe.Refund;
    let refunds: Stripe.Refund[];
    try {
        [account, paymentIntent, retrievedRefund, refunds] = await Promise.all([
            stripe.accounts.retrieve(),
            stripe.paymentIntents.retrieve(operation.stripe_payment_intent_id),
            stripe.refunds.retrieve(operation.stripe_refund_id),
            listPaymentIntentRefunds(operation.stripe_payment_intent_id),
        ]);
    } catch (error) {
        if (error instanceof IncoherentStripeRefundListError) {
            throw operationError(operation, 'manual_review', 'GUARANTEE_REFUND_RECONCILIATION_INCOHERENT');
        }
        if (stripeErrorIsRetryable(error)) {
            throw operationError(operation, 'retryable', 'GUARANTEE_REFUND_RECONCILIATION_RETRYABLE');
        }
        throw operationError(operation, 'manual_review', 'GUARANTEE_REFUND_RECONCILIATION_INCOHERENT');
    }

    let runtime;
    try {
        runtime = assertStripeRuntimeAccount(input.context, account);
    } catch {
        throw operationError(operation, 'manual_review', 'GUARANTEE_STRIPE_RUNTIME_INCOHERENT');
    }
    if (!paymentIntentMatches(operation, paymentIntent, runtime.livemode)) {
        throw operationError(operation, 'manual_review', 'GUARANTEE_PAYMENT_INTENT_INCOHERENT');
    }

    let listedRefund: Stripe.Refund | null;
    try {
        listedRefund = classifyRefunds(operation, refunds);
    } catch {
        throw operationError(operation, 'manual_review', 'GUARANTEE_REFUND_RECONCILIATION_INCOHERENT');
    }
    if (
        !listedRefund
        || listedRefund.id !== operation.stripe_refund_id
        || retrievedRefund.id !== listedRefund.id
        || !exactGuaranteeRefund(operation, retrievedRefund)
        || retrievedRefund.status !== listedRefund.status
        || retrievedRefund.created !== listedRefund.created
    ) throw operationError(operation, 'manual_review', 'GUARANTEE_REFUND_RECONCILIATION_INCOHERENT');

    return observeRefund(admin, operation, retrievedRefund);
}

export async function observeCheckoutV2GuaranteeRefundFromWebhook(input: {
    refund: Stripe.Refund;
}): Promise<boolean> {
    const operationId = input.refund.metadata?.[GUARANTEE_OPERATION_METADATA_KEY];
    if (!isUuid(operationId)) return false;
    const subscriptionId = input.refund.metadata?.subscriptionId;
    if (!isUuid(subscriptionId)) throw new Error('Guarantee refund metadata is incomplete');
    const admin = createSupabaseAdminClient() as GuaranteeAdmin;
    const { data, error } = await guaranteeOperations(admin)
        .select('*')
        .eq('id', operationId)
        .eq('subscription_id', subscriptionId)
        .single() as unknown as { data: CheckoutV2GuaranteeOperation | null; error: DatabaseError | null };
    if (error || !data) throw error ?? new Error('Guarantee refund operation is missing');
    const state = data;
    if (!operationIsValid(state, { subscriptionId, actorId: state.actor_id ?? '' }) || state.id !== operationId) {
        throw new Error('Guarantee refund does not match a local operation');
    }
    if (!exactGuaranteeRefund(state, input.refund)) throw new Error('Guarantee refund is incoherent');
    const currentRefund = await stripe.refunds.retrieve(input.refund.id);
    if (
        currentRefund.id !== input.refund.id
        || currentRefund.created !== input.refund.created
        || currentRefund.amount !== input.refund.amount
        || currentRefund.currency.toLowerCase() !== input.refund.currency.toLowerCase()
        || stripeObjectId(currentRefund.payment_intent) !== stripeObjectId(input.refund.payment_intent)
        || !exactGuaranteeRefund(state, currentRefund)
    ) throw new Error('Guarantee refund authoritative state is incoherent');
    await observeRefund(admin, state, currentRefund);
    return true;
}
