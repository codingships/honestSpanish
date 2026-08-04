import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stripe } from './stripe';
import type { StripeRuntimeContext } from './stripe-runtime-guard';
import type { Database, Json } from '../types/database.types';

export type StripeFeePayment = Pick<
    Database['public']['Tables']['payments']['Row'],
    'id' | 'amount' | 'amount_refunded' | 'currency' | 'status' | 'stripe_payment_intent_id'
>;

export type StripeFeeClient = Pick<
    Stripe,
    'paymentIntents' | 'charges' | 'refunds' | 'balanceTransactions'
>;

type BalanceTransactionSnapshot = {
    amount_cents: number;
    balance_type: string;
    currency: string;
    fee_cents: number;
    net_cents: number;
    reporting_category: string;
    source_id: string;
    source_kind: 'charge' | 'refund';
    stripe_balance_transaction_id: string;
    stripe_created_at: string;
    stripe_type: string;
};

type ReconciliationInput = {
    payment: StripeFeePayment;
    runtime: StripeRuntimeContext;
    supabaseAdmin: SupabaseClient<Database>;
    stripeClient?: StripeFeeClient;
    now?: () => Date;
};

export type StripeFeeReconciliationOutcome =
    | { status: 'reconciled'; paymentId: string; transactionCount: number }
    | { status: 'pending'; paymentId: string; code: string };

export class StripeFeeReconciliationError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = 'StripeFeeReconciliationError';
        this.code = code;
    }
}

function fail(code: string): never {
    throw new StripeFeeReconciliationError(code);
}

function objectId(value: string | { id: string } | null | undefined): string | null {
    if (typeof value === 'string') return value;
    return value?.id ?? null;
}

function requireSafeInteger(value: unknown, code: string): number {
    if (!Number.isSafeInteger(value)) fail(code);
    return value as number;
}

function requireBoundedText(value: unknown, code: string): string {
    if (
        typeof value !== 'string'
        || value.length < 1
        || value.length > 80
        || value.trim() !== value
        || [...value].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
        })
    ) {
        fail(code);
    }
    return value;
}

async function stripeRead<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof StripeFeeReconciliationError) throw error;
        fail('stripe_fee_remote_unavailable');
    }
}

async function resolveBalanceTransaction(
    value: string | Stripe.BalanceTransaction | null,
    client: StripeFeeClient,
): Promise<Stripe.BalanceTransaction> {
    if (!value) fail('stripe_fee_balance_transaction_missing');
    if (typeof value !== 'string') return value;
    return stripeRead(() => client.balanceTransactions.retrieve(value));
}

function balanceTransactionSnapshot(
    transaction: Stripe.BalanceTransaction,
    input: {
        sourceKind: 'charge' | 'refund';
        sourceId: string;
        expectedAmount: number;
        currency: string;
        observedAtSeconds: number;
    },
): BalanceTransactionSnapshot {
    if (!/^txn_[A-Za-z0-9_]+$/.test(transaction.id)) {
        fail('stripe_fee_balance_transaction_identity_invalid');
    }
    if (objectId(transaction.source) !== input.sourceId) {
        fail('stripe_fee_balance_transaction_source_conflict');
    }

    const amount = requireSafeInteger(transaction.amount, 'stripe_fee_balance_transaction_amount_invalid');
    const fee = requireSafeInteger(transaction.fee, 'stripe_fee_balance_transaction_fee_invalid');
    const net = requireSafeInteger(transaction.net, 'stripe_fee_balance_transaction_net_invalid');
    const created = requireSafeInteger(transaction.created, 'stripe_fee_balance_transaction_time_invalid');
    if (
        amount !== input.expectedAmount
        || Math.abs(amount) > 1_000_000_000_000
        || Math.abs(fee) > 1_000_000_000_000
        || Math.abs(net) > 1_000_000_000_000
        || net !== amount - fee
    ) {
        fail('stripe_fee_balance_transaction_amount_conflict');
    }
    if (transaction.currency.toLowerCase() !== input.currency || transaction.exchange_rate !== null) {
        fail('stripe_fee_balance_transaction_currency_conflict');
    }
    if (created <= 0 || created > input.observedAtSeconds + 300) {
        fail('stripe_fee_balance_transaction_time_invalid');
    }

    return {
        amount_cents: amount,
        balance_type: requireBoundedText(transaction.balance_type, 'stripe_fee_balance_type_invalid'),
        currency: input.currency,
        fee_cents: fee,
        net_cents: net,
        reporting_category: requireBoundedText(
            transaction.reporting_category,
            'stripe_fee_reporting_category_invalid',
        ),
        source_id: input.sourceId,
        source_kind: input.sourceKind,
        stripe_balance_transaction_id: transaction.id,
        stripe_created_at: new Date(created * 1000).toISOString(),
        stripe_type: requireBoundedText(transaction.type, 'stripe_fee_balance_transaction_type_invalid'),
    };
}

async function listChargeRefunds(client: StripeFeeClient, chargeId: string): Promise<Stripe.Refund[]> {
    const refunds: Stripe.Refund[] = [];
    let startingAfter: string | undefined;

    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
        const page = await stripeRead(() => client.refunds.list({
            charge: chargeId,
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
            expand: ['data.balance_transaction'],
        }));
        if (page.data.length === 0 && page.has_more) {
            fail('stripe_fee_refund_pagination_invalid');
        }
        refunds.push(...page.data);
        if (refunds.length > 1000) fail('stripe_fee_refund_limit_exceeded');
        if (!page.has_more) return refunds;
        startingAfter = page.data.at(-1)?.id;
        if (!startingAfter) fail('stripe_fee_refund_pagination_invalid');
    }

    fail('stripe_fee_refund_limit_exceeded');
}

async function collectStripeFeeSnapshot(input: ReconciliationInput): Promise<{
    chargeId: string;
    observedAt: string;
    transactions: BalanceTransactionSnapshot[];
}> {
    const client = input.stripeClient ?? stripe;
    const payment = input.payment;
    const currency = payment.currency?.toLowerCase() ?? '';
    const paymentIntentId = payment.stripe_payment_intent_id;
    const amount = requireSafeInteger(payment.amount, 'stripe_fee_local_payment_invalid');
    const amountRefunded = requireSafeInteger(payment.amount_refunded, 'stripe_fee_local_payment_invalid');
    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payment.id)
        || !paymentIntentId
        || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)
        || !['succeeded', 'refunded'].includes(payment.status ?? '')
        || amount <= 0
        || amountRefunded < 0
        || amountRefunded > amount
        || currency !== 'eur'
    ) {
        fail('stripe_fee_local_payment_invalid');
    }

    const observedDate = input.now?.() ?? new Date();
    const observedAtSeconds = Math.floor(observedDate.getTime() / 1000);
    if (!Number.isSafeInteger(observedAtSeconds) || observedAtSeconds <= 0) {
        fail('stripe_fee_observation_time_invalid');
    }
    const observedAt = new Date(observedAtSeconds * 1000).toISOString();

    const paymentIntent = await stripeRead(() => client.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction'],
    }));
    if (
        paymentIntent.id !== paymentIntentId
        || paymentIntent.livemode !== input.runtime.livemode
        || paymentIntent.status !== 'succeeded'
        || paymentIntent.currency.toLowerCase() !== currency
        || paymentIntent.amount_received !== amount
    ) {
        fail('stripe_fee_payment_intent_conflict');
    }

    const chargeId = objectId(paymentIntent.latest_charge);
    if (!chargeId || !/^ch_[A-Za-z0-9_]+$/.test(chargeId)) {
        fail('stripe_fee_charge_missing');
    }
    const charge = await stripeRead(() => client.charges.retrieve(chargeId, {
        expand: ['balance_transaction'],
    }));
    if (
        charge.id !== chargeId
        || objectId(charge.payment_intent) !== paymentIntentId
        || charge.livemode !== input.runtime.livemode
        || charge.status !== 'succeeded'
        || !charge.paid
        || !charge.captured
        || charge.disputed
        || charge.currency.toLowerCase() !== currency
        || requireSafeInteger(charge.amount, 'stripe_fee_charge_amount_invalid') !== amount
        || requireSafeInteger(charge.amount_captured, 'stripe_fee_charge_amount_invalid') !== amount
        || requireSafeInteger(charge.amount_refunded, 'stripe_fee_charge_amount_invalid') !== amountRefunded
        || charge.refunded !== (amountRefunded === amount)
    ) {
        fail('stripe_fee_charge_conflict');
    }
    if (
        charge.application !== null
        || charge.application_fee !== null
        || charge.application_fee_amount !== null
        || charge.on_behalf_of !== null
        || charge.source_transfer !== null
        || charge.transfer_data !== null
    ) {
        fail('stripe_fee_charge_topology_conflict');
    }

    const chargeBalance = await resolveBalanceTransaction(charge.balance_transaction, client);
    const transactions: BalanceTransactionSnapshot[] = [balanceTransactionSnapshot(chargeBalance, {
        sourceKind: 'charge',
        sourceId: charge.id,
        expectedAmount: amount,
        currency,
        observedAtSeconds,
    })];

    const refunds = await listChargeRefunds(client, charge.id);
    let succeededRefundAmount = 0;
    for (const refund of refunds) {
        if (
            !/^re_[A-Za-z0-9_]+$/.test(refund.id)
            || objectId(refund.charge) !== charge.id
            || objectId(refund.payment_intent) !== paymentIntentId
            || refund.currency.toLowerCase() !== currency
            || requireSafeInteger(refund.amount, 'stripe_fee_refund_amount_invalid') <= 0
            || requireSafeInteger(refund.created, 'stripe_fee_refund_time_invalid') <= 0
        ) {
            fail('stripe_fee_refund_conflict');
        }
        if (refund.status === 'pending' || refund.status === 'requires_action') {
            fail('stripe_fee_refund_pending');
        }
        if (refund.status === 'failed' || refund.status === 'canceled') continue;
        if (refund.status !== 'succeeded') fail('stripe_fee_refund_status_invalid');

        succeededRefundAmount += refund.amount;
        if (!Number.isSafeInteger(succeededRefundAmount) || succeededRefundAmount > amount) {
            fail('stripe_fee_refund_amount_conflict');
        }
        const refundBalance = await resolveBalanceTransaction(refund.balance_transaction, client);
        transactions.push(balanceTransactionSnapshot(refundBalance, {
            sourceKind: 'refund',
            sourceId: refund.id,
            expectedAmount: -refund.amount,
            currency,
            observedAtSeconds,
        }));
    }
    if (succeededRefundAmount !== amountRefunded) {
        fail('stripe_fee_refund_amount_conflict');
    }

    transactions.sort((left, right) => (
        (left.source_kind === right.source_kind ? 0 : left.source_kind === 'charge' ? -1 : 1)
        || left.stripe_created_at.localeCompare(right.stripe_created_at)
        || left.source_id.localeCompare(right.source_id)
    ));
    return { chargeId: charge.id, observedAt, transactions };
}

export async function reconcileStripePaymentFees(
    input: ReconciliationInput,
): Promise<Database['public']['Tables']['stripe_payment_fee_reconciliations']['Row']> {
    const snapshot = await collectStripeFeeSnapshot(input);
    const { data, error } = await input.supabaseAdmin.rpc('reconcile_stripe_payment_fees', {
        p_payment_id: input.payment.id,
        p_stripe_account_id: input.runtime.accountId,
        p_stripe_livemode: input.runtime.livemode,
        p_charge_id: snapshot.chargeId,
        p_amount_refunded_cents: input.payment.amount_refunded,
        p_transactions: snapshot.transactions as unknown as Json,
        p_observed_at: snapshot.observedAt,
    });
    if (error || !data || data.status !== 'reconciled') {
        fail('stripe_fee_database_write_failed');
    }
    return data;
}

function safeErrorCode(error: unknown): string {
    return error instanceof StripeFeeReconciliationError
        ? error.code
        : 'stripe_fee_reconciliation_failed';
}

export async function reconcileStripePaymentFeesBestEffort(
    input: ReconciliationInput,
): Promise<StripeFeeReconciliationOutcome> {
    try {
        const row = await reconcileStripePaymentFees(input);
        return {
            status: 'reconciled',
            paymentId: input.payment.id,
            transactionCount: row.reconciled_transaction_count,
        };
    } catch (error) {
        const code = safeErrorCode(error);
        const observedAtSeconds = Math.floor((input.now?.() ?? new Date()).getTime() / 1000);
        const attemptedAt = new Date(observedAtSeconds * 1000).toISOString();
        let pendingStateRecorded = false;
        try {
            const { error: pendingError } = await input.supabaseAdmin.rpc(
                'mark_stripe_payment_fee_reconciliation_pending',
                {
                    p_payment_id: input.payment.id,
                    p_stripe_account_id: input.runtime.accountId,
                    p_stripe_livemode: input.runtime.livemode,
                    p_error_code: code,
                    p_attempted_at: attemptedAt,
                },
            );
            pendingStateRecorded = !pendingError;
        } catch {
            pendingStateRecorded = false;
        }
        console.warn('[Stripe fees] Reconciliation deferred', {
            code,
            pendingStateRecorded,
        });
        return { status: 'pending', paymentId: input.payment.id, code };
    }
}
