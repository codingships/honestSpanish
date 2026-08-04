import type Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    reconcileStripePaymentFees,
    reconcileStripePaymentFeesBestEffort,
    type StripeFeeClient,
    type StripeFeePayment,
} from '../../src/lib/stripe-fee-reconciliation';

const paymentId = '70000000-0000-4000-8000-000000000001';
const observedAt = new Date('2026-08-04T10:00:00.000Z');
const runtime = { accountId: 'acct_fee_test', appEnvironment: 'test', livemode: false };

function balanceTransaction(overrides: Partial<Stripe.BalanceTransaction> = {}): Stripe.BalanceTransaction {
    return {
        id: 'txn_charge_1',
        object: 'balance_transaction',
        amount: 25900,
        available_on: 1785801600,
        balance_type: 'payments',
        created: 1785751200,
        currency: 'eur',
        description: null,
        exchange_rate: null,
        fee: 800,
        fee_details: [],
        net: 25100,
        reporting_category: 'charge',
        source: 'ch_fee_1',
        status: 'available',
        type: 'charge',
        ...overrides,
    };
}

function payment(overrides: Partial<StripeFeePayment> = {}): StripeFeePayment {
    return {
        id: paymentId,
        amount: 25900,
        amount_refunded: 19425,
        currency: 'eur',
        status: 'succeeded',
        stripe_payment_intent_id: 'pi_fee_1',
        ...overrides,
    };
}

function stripeClient(overrides: {
    charge?: Partial<Stripe.Charge>;
    refund?: Partial<Stripe.Refund> | null;
    paymentIntent?: Partial<Stripe.PaymentIntent>;
    balanceTransactions?: Record<string, Stripe.BalanceTransaction>;
} = {}): StripeFeeClient & { [key: string]: unknown } {
    const refund = overrides.refund === null ? null : {
        id: 're_fee_1',
        object: 'refund',
        amount: 19425,
        balance_transaction: 'txn_refund_1',
        charge: 'ch_fee_1',
        created: 1785754800,
        currency: 'eur',
        metadata: {},
        payment_intent: 'pi_fee_1',
        reason: 'requested_by_customer',
        receipt_number: null,
        source_transfer_reversal: null,
        status: 'succeeded',
        transfer_reversal: null,
        ...overrides.refund,
    } as Stripe.Refund;
    const transactions = overrides.balanceTransactions ?? {
        txn_charge_1: balanceTransaction(),
        txn_refund_1: balanceTransaction({
            id: 'txn_refund_1',
            amount: -19425,
            fee: -100,
            net: -19325,
            reporting_category: 'refund',
            source: 're_fee_1',
            type: 'refund',
        }),
    };
    return {
        paymentIntents: {
            retrieve: vi.fn().mockResolvedValue({
                id: 'pi_fee_1',
                livemode: false,
                status: 'succeeded',
                currency: 'eur',
                amount_received: 25900,
                latest_charge: 'ch_fee_1',
                ...overrides.paymentIntent,
            }),
        } as unknown as StripeFeeClient['paymentIntents'],
        charges: {
            retrieve: vi.fn().mockResolvedValue({
                id: 'ch_fee_1',
                payment_intent: 'pi_fee_1',
                livemode: false,
                status: 'succeeded',
                paid: true,
                captured: true,
                disputed: false,
                currency: 'eur',
                amount: 25900,
                amount_captured: 25900,
                amount_refunded: refund ? 19425 : 0,
                refunded: false,
                balance_transaction: 'txn_charge_1',
                application: null,
                application_fee: null,
                application_fee_amount: null,
                on_behalf_of: null,
                source_transfer: null,
                transfer_data: null,
                ...overrides.charge,
            }),
        } as unknown as StripeFeeClient['charges'],
        refunds: {
            list: vi.fn().mockResolvedValue({
                object: 'list',
                data: refund ? [refund] : [],
                has_more: false,
                url: '/v1/refunds',
            }),
        } as unknown as StripeFeeClient['refunds'],
        balanceTransactions: {
            retrieve: vi.fn((id: string) => Promise.resolve(transactions[id])),
        } as unknown as StripeFeeClient['balanceTransactions'],
    };
}

function reconciledRow() {
    return {
        payment_id: paymentId,
        stripe_payment_intent_id: 'pi_fee_1',
        status: 'reconciled',
        stripe_account_id: 'acct_fee_test',
        stripe_livemode: false,
        reconciled_amount_refunded_cents: 19425,
        reconciled_transaction_count: 2,
        last_error_code: null,
        last_attempted_at: observedAt.toISOString(),
        reconciled_at: observedAt.toISOString(),
        created_at: observedAt.toISOString(),
        updated_at: observedAt.toISOString(),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('Stripe fee reconciliation', () => {
    it('persists one authoritative charge and every succeeded refund balance transaction', async () => {
        const client = stripeClient();
        const rpc = vi.fn().mockResolvedValue({ data: reconciledRow(), error: null });

        const result = await reconcileStripePaymentFees({
            payment: payment(),
            runtime,
            stripeClient: client,
            supabaseAdmin: { rpc } as never,
            now: () => observedAt,
        });

        expect(result.status).toBe('reconciled');
        expect(rpc).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenCalledWith('reconcile_stripe_payment_fees', {
            p_payment_id: paymentId,
            p_stripe_account_id: 'acct_fee_test',
            p_stripe_livemode: false,
            p_charge_id: 'ch_fee_1',
            p_amount_refunded_cents: 19425,
            p_observed_at: observedAt.toISOString(),
            p_transactions: [
                expect.objectContaining({
                    source_kind: 'charge',
                    source_id: 'ch_fee_1',
                    amount_cents: 25900,
                    fee_cents: 800,
                    net_cents: 25100,
                }),
                expect.objectContaining({
                    source_kind: 'refund',
                    source_id: 're_fee_1',
                    amount_cents: -19425,
                    fee_cents: -100,
                    net_cents: -19325,
                }),
            ],
        });
    });

    it('fails closed when Stripe and the local refund total differ, then records a safe pending state', async () => {
        const client = stripeClient({
            charge: { amount_refunded: 19000 },
        });
        const rpc = vi.fn().mockResolvedValue({ data: { status: 'pending' }, error: null });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const result = await reconcileStripePaymentFeesBestEffort({
            payment: payment(),
            runtime,
            stripeClient: client,
            supabaseAdmin: { rpc } as never,
            now: () => observedAt,
        });

        expect(result).toEqual({
            status: 'pending',
            paymentId,
            code: 'stripe_fee_charge_conflict',
        });
        expect(rpc).toHaveBeenCalledOnce();
        expect(rpc).toHaveBeenCalledWith('mark_stripe_payment_fee_reconciliation_pending', {
            p_payment_id: paymentId,
            p_stripe_account_id: 'acct_fee_test',
            p_stripe_livemode: false,
            p_error_code: 'stripe_fee_charge_conflict',
            p_attempted_at: observedAt.toISOString(),
        });
        expect(warn).toHaveBeenCalledWith('[Stripe fees] Reconciliation deferred', {
            code: 'stripe_fee_charge_conflict',
            pendingStateRecorded: true,
        });
    });

    it('does not publish a fee while a refund is still pending', async () => {
        const client = stripeClient({ refund: { status: 'pending' } });
        const rpc = vi.fn().mockResolvedValue({ data: { status: 'pending' }, error: null });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const result = await reconcileStripePaymentFeesBestEffort({
            payment: payment(),
            runtime,
            stripeClient: client,
            supabaseAdmin: { rpc } as never,
            now: () => observedAt,
        });

        expect(result).toMatchObject({ status: 'pending', code: 'stripe_fee_refund_pending' });
        expect(rpc).not.toHaveBeenCalledWith('reconcile_stripe_payment_fees', expect.anything());
    });

    it('returns pending and records it when the authoritative database write fails', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce({ data: null, error: { code: '40001' } })
            .mockResolvedValueOnce({ data: { status: 'pending' }, error: null });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const result = await reconcileStripePaymentFeesBestEffort({
            payment: payment(),
            runtime,
            stripeClient: stripeClient(),
            supabaseAdmin: { rpc } as never,
            now: () => observedAt,
        });

        expect(result).toMatchObject({
            status: 'pending',
            code: 'stripe_fee_database_write_failed',
        });
        expect(rpc).toHaveBeenNthCalledWith(2, 'mark_stripe_payment_fee_reconciliation_pending', expect.objectContaining({
            p_error_code: 'stripe_fee_database_write_failed',
        }));
    });
});
