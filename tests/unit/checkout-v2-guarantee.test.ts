import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    accountRetrieve: vi.fn(),
    subscriptionRetrieve: vi.fn(),
    subscriptionCancel: vi.fn(),
    paymentIntentRetrieve: vi.fn(),
    invoiceRetrieve: vi.fn(),
    invoicePaymentsList: vi.fn(),
    refundsList: vi.fn(),
    refundsRetrieve: vi.fn(),
    refundsCreate: vi.fn(),
}));
const supabaseMocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        accounts: { retrieve: stripeMocks.accountRetrieve },
        subscriptions: { retrieve: stripeMocks.subscriptionRetrieve, cancel: stripeMocks.subscriptionCancel },
        paymentIntents: { retrieve: stripeMocks.paymentIntentRetrieve },
        invoices: { retrieve: stripeMocks.invoiceRetrieve },
        invoicePayments: { list: stripeMocks.invoicePaymentsList },
        refunds: {
            list: stripeMocks.refundsList,
            retrieve: stripeMocks.refundsRetrieve,
            create: stripeMocks.refundsCreate,
        },
    },
}));
vi.mock('../../src/lib/supabase-admin', () => ({ createSupabaseAdminClient: supabaseMocks.create }));
vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => ({
        PUBLIC_APP_ENV: 'staging',
        NODE_ENV: 'production',
        STRIPE_EXPECTED_ACCOUNT_ID: 'acct_test',
        STRIPE_SECRET_KEY: 'sk_test_guarantee',
    } as Record<string, string>)[key]),
}));

const actorId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const subscriptionId = '30000000-0000-4000-8000-000000000003';
const operationId = '40000000-0000-4000-8000-000000000004';
const cycleId = '50000000-0000-4000-8000-000000000005';
const paymentId = '60000000-0000-4000-8000-000000000006';
const packagePriceId = '70000000-0000-4000-8000-000000000007';
const checkoutIntentId = '80000000-0000-4000-8000-000000000008';
const sessionIds = [
    '90000000-0000-4000-8000-000000000009',
    'a0000000-0000-4000-8000-00000000000a',
    'b0000000-0000-4000-8000-00000000000b',
    'c0000000-0000-4000-8000-00000000000c',
];

function testContext(): Pick<APIContext, 'locals'> {
    return {
        locals: {
            cfContext: {
                waitUntil: vi.fn(),
                passThroughOnException: vi.fn(),
                props: {},
            } as unknown as APIContext['locals']['cfContext'],
        },
    };
}

function operation(status = 'requested', overrides: Record<string, unknown> = {}) {
    return {
        id: operationId,
        request_id: requestId,
        subscription_id: subscriptionId,
        cycle_id: cycleId,
        payment_id: paymentId,
        actor_id: actorId,
        first_session_id: sessionIds[0],
        second_session_id: sessionIds[1],
        third_session_id: sessionIds[2],
        fourth_session_id: sessionIds[3],
        stripe_customer_id: 'cus_guarantee',
        stripe_subscription_id: 'sub_guarantee',
        stripe_invoice_id: 'in_guarantee',
        stripe_payment_intent_id: 'pi_guarantee',
        gross_amount_cents: 25_900,
        refund_amount_cents: 19_425,
        currency: 'eur',
        status,
        lease_token: null,
        lease_expires_at: null,
        cancellation_started_at: null,
        stripe_cancelled_at: null,
        terminated_at: null,
        refund_started_at: null,
        stripe_refund_id: null,
        refund_status: null,
        refund_created_at: null,
        refunded_at: null,
        last_error: null,
        created_at: '2026-08-01T09:00:00.000Z',
        updated_at: '2026-08-01T09:00:00.000Z',
        ...overrides,
    };
}

function remoteSubscription(status = 'trialing', comment: string | null = null) {
    return {
        id: 'sub_guarantee',
        livemode: false,
        customer: 'cus_guarantee',
        latest_invoice: 'in_guarantee',
        status,
        canceled_at: status === 'canceled' ? Math.floor(Date.now() / 1000) : null,
        cancellation_details: { comment },
        metadata: {
            contractSchemaVersion: '2',
            userId: actorId,
            checkoutIntentId,
            packagePriceId,
        },
        items: { data: [{
            quantity: 1,
            price: {
                id: 'price_recurring', type: 'recurring', unit_amount: 25_900,
                currency: 'eur', livemode: false, product: 'prod_guarantee',
                recurring: { interval: 'day', interval_count: 28 },
            },
        }] },
    };
}

function exactRefund(status = 'succeeded') {
    return {
        id: 're_guarantee',
        payment_intent: 'pi_guarantee',
        amount: 19_425,
        currency: 'eur',
        status,
        created: Math.floor(Date.now() / 1000),
        metadata: {
            guaranteeOperationId: operationId,
            subscriptionId,
            paymentId,
            contractSchemaVersion: '2',
        },
    };
}

function query(result: { data: unknown; error: unknown }) {
    const value: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) value[method] = vi.fn(() => value);
    value.single = vi.fn().mockResolvedValue(result);
    value.maybeSingle = vi.fn().mockResolvedValue(result);
    return value;
}

function successfulAdmin(input: {
    claimLease?: 'caller' | 'other' | 'expired';
    preparedStatus?: string;
    tableStatus?: string;
    claimError?: { code: string; message: string };
    terminationError?: { code: string; message: string };
    operationOverrides?: Record<string, unknown>;
} = {}) {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        const worker = String(args.p_worker_token ?? '');
        if (name === 'get_checkout_v2_guarantee_state') return { data: null, error: null };
        if (name === 'prepare_checkout_v2_guarantee') return { data: operation(input.preparedStatus), error: null };
        if (name === 'claim_checkout_v2_guarantee' && input.claimError) {
            return { data: null, error: input.claimError };
        }
        if (name === 'claim_checkout_v2_guarantee') return {
            data: operation('processing', {
                lease_token: input.claimLease === 'other' ? 'd0000000-0000-4000-8000-00000000000d' : worker,
                lease_expires_at: new Date(Date.now() + (input.claimLease === 'expired' ? -60_000 : 60_000)).toISOString(),
            }),
            error: null,
        };
        const leased = {
            lease_token: worker,
            lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
        if (name === 'begin_checkout_v2_guarantee_cancellation') return {
            data: operation('processing', { ...leased, cancellation_started_at: new Date().toISOString() }), error: null,
        };
        if (name === 'apply_checkout_v2_guarantee_termination' && input.terminationError) {
            return { data: null, error: input.terminationError };
        }
        if (name === 'apply_checkout_v2_guarantee_termination') return {
            data: operation('processing', {
                ...leased,
                cancellation_started_at: new Date().toISOString(),
                stripe_cancelled_at: args.p_stripe_cancelled_at,
                terminated_at: new Date().toISOString(),
            }),
            error: null,
        };
        if (name === 'begin_checkout_v2_guarantee_refund') return {
            data: operation('processing', {
                ...leased,
                cancellation_started_at: new Date().toISOString(),
                stripe_cancelled_at: new Date().toISOString(),
                terminated_at: new Date().toISOString(),
                refund_started_at: new Date().toISOString(),
            }),
            error: null,
        };
        if (name === 'observe_checkout_v2_guarantee_refund') {
            const refundStatus = String(args.p_refund_status);
            const observedStatus = refundStatus === 'succeeded'
                ? 'refunded'
                : ['pending', 'requires_action'].includes(refundStatus)
                    ? 'refund_pending'
                    : 'manual_review';
            return {
                data: operation(observedStatus, {
                    stripe_refund_id: args.p_stripe_refund_id,
                    refund_status: args.p_refund_status,
                    refund_created_at: args.p_refund_created_at,
                    last_error: ['failed', 'canceled'].includes(refundStatus)
                        ? `stripe_refund_${refundStatus}`
                        : null,
                }),
                error: null,
            };
        }
        if (name === 'mark_checkout_v2_guarantee_outcome') return {
            data: operation(String(args.p_status), { last_error: args.p_error }), error: null,
        };
        if (name === 'resolve_checkout_v2_guarantee_review') return {
            data: operation('retryable', input.operationOverrides), error: null,
        };
        throw new Error(`Unexpected RPC ${name}`);
    });
    const from = vi.fn((table: string) => {
        const rows: Record<string, unknown> = {
            subscriptions: {
                id: subscriptionId, student_id: actorId, package_price_id: packagePriceId,
                checkout_intent_id: checkoutIntentId, contract_schema_version: 2, status: 'active',
                stripe_subscription_id: 'sub_guarantee', stripe_invoice_id: 'in_guarantee',
            },
            checkout_intents: {
                id: checkoutIntentId, student_id: actorId, package_price_id: packagePriceId,
                stripe_customer_id: 'cus_guarantee',
            },
            package_prices: {
                id: packagePriceId, stripe_account_id: 'acct_test', stripe_livemode: false,
                stripe_product_id: 'prod_guarantee',
            },
            checkout_v2_price_snapshots: {
                package_price_id: packagePriceId, initial_amount_cents: 25_900,
                initial_stripe_price_id: 'price_initial', recurring_amount_cents: 25_900,
                recurring_stripe_price_id: 'price_recurring', recurring_interval_count: 28,
                recurring_interval_unit: 'day', currency: 'eur', stripe_account_id: 'acct_test',
                stripe_livemode: false,
            },
            payments: {
                id: paymentId, student_id: actorId, subscription_id: subscriptionId,
                amount: 25_900, currency: 'eur', status: 'succeeded', stripe_invoice_id: 'in_guarantee',
                stripe_payment_intent_id: 'pi_guarantee',
            },
            checkout_v2_guarantee_operations: operation(
                input.tableStatus ?? input.preparedStatus,
                input.operationOverrides,
            ),
        };
        return query({ data: rows[table], error: null });
    });
    return { rpc, from };
}

describe('Checkout V2 guarantee saga', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stripeMocks.accountRetrieve.mockResolvedValue({ id: 'acct_test', country: 'ES' });
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription());
        stripeMocks.paymentIntentRetrieve.mockResolvedValue({
            id: 'pi_guarantee', livemode: false, status: 'succeeded', amount: 25_900,
            amount_received: 25_900, currency: 'eur', customer: 'cus_guarantee',
        });
        stripeMocks.invoiceRetrieve.mockResolvedValue({
            id: 'in_guarantee', livemode: false, status: 'paid', total: 25_900,
            amount_paid: 25_900, customer: 'cus_guarantee', currency: 'eur',
            parent: { subscription_details: { subscription: 'sub_guarantee' } },
        });
        stripeMocks.invoicePaymentsList.mockResolvedValue({
            data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_guarantee' } }],
        });
        stripeMocks.refundsList.mockResolvedValue({ data: [], has_more: false });
        stripeMocks.refundsRetrieve.mockResolvedValue(exactRefund());
        stripeMocks.subscriptionCancel.mockResolvedValue(remoteSubscription(
            'canceled', `checkout-v2-guarantee:${operationId}`,
        ));
        stripeMocks.refundsCreate.mockResolvedValue(exactRefund());
    });

    it('maps the get-state RPC state and operation_id fields exactly', async () => {
        const admin = successfulAdmin();
        (admin.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            data: [{
                subscription_id: subscriptionId,
                state: 'eligible',
                refund_amount_cents: 19_425,
                currency: 'eur',
                operation_id: operationId,
                reason: 'eligible',
            }],
            error: null,
        });
        supabaseMocks.create.mockReturnValue(admin);
        const { getCheckoutV2GuaranteeState } = await import('../../src/lib/checkout-v2-guarantee');
        await expect(getCheckoutV2GuaranteeState({ actorId, subscriptionId })).resolves.toEqual({
            subscriptionId,
            status: 'eligible',
            refundAmountCents: 19_425,
            currency: 'eur',
            operationId,
            reason: 'eligible',
        });
    });

    it('cancels, terminates locally and creates the exact refund with one stable key', async () => {
        const admin = successfulAdmin();
        supabaseMocks.create.mockReturnValue(admin);
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');
        const result = await runCheckoutV2Guarantee({ context: testContext(), actorId, requestId, subscriptionId });

        expect(result.status).toBe('refunded');
        expect(stripeMocks.subscriptionCancel).toHaveBeenCalledWith('sub_guarantee', {
            invoice_now: false,
            prorate: false,
            cancellation_details: { comment: `checkout-v2-guarantee:${operationId}` },
        });
        expect(stripeMocks.refundsCreate).toHaveBeenCalledWith(expect.objectContaining({
            payment_intent: 'pi_guarantee', amount: 19_425, reason: 'requested_by_customer',
            metadata: expect.objectContaining({ paymentId }),
        }), { idempotencyKey: `checkout-v2-guarantee-refund:${operationId}` });
    });

    it('moves to manual review if a concurrent renewal changed latest_invoice', async () => {
        const admin = successfulAdmin();
        supabaseMocks.create.mockReturnValue(admin);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce({
            ...remoteSubscription(),
            latest_invoice: 'in_concurrent_renewal',
        });
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        });

        expect(result).toMatchObject({ status: 'manual_review', operationId });
        expect(stripeMocks.subscriptionCancel).not.toHaveBeenCalled();
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });

    it('recovers an accepted subscription cancellation after a network timeout', async () => {
        const admin = successfulAdmin();
        supabaseMocks.create.mockReturnValue(admin);
        stripeMocks.subscriptionCancel.mockRejectedValueOnce(new Error('socket closed'));
        stripeMocks.subscriptionRetrieve
            .mockResolvedValueOnce(remoteSubscription())
            .mockResolvedValueOnce(remoteSubscription('canceled', `checkout-v2-guarantee:${operationId}`));
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        });

        expect(result.status).toBe('refunded');
        expect(stripeMocks.subscriptionCancel).toHaveBeenCalledOnce();
        expect(stripeMocks.refundsCreate).toHaveBeenCalledOnce();
    });

    it('recovers the exact refund after create acceptance becomes unknown', async () => {
        const admin = successfulAdmin();
        supabaseMocks.create.mockReturnValue(admin);
        const refund = exactRefund();
        stripeMocks.refundsCreate.mockRejectedValueOnce(new Error('socket closed'));
        stripeMocks.refundsList
            .mockResolvedValueOnce({ data: [], has_more: false })
            .mockResolvedValueOnce({ data: [], has_more: false })
            .mockResolvedValueOnce({ data: [refund], has_more: false });
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        });

        expect(result.status).toBe('refunded');
        expect(stripeMocks.refundsCreate).toHaveBeenCalledOnce();
    });

    it('moves a deterministic refund creation rejection to manual review', async () => {
        const admin = successfulAdmin();
        supabaseMocks.create.mockReturnValue(admin);
        stripeMocks.refundsCreate.mockRejectedValueOnce({ statusCode: 400 });
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        });

        expect(result).toMatchObject({ status: 'manual_review', operationId });
        expect(admin.rpc).toHaveBeenCalledWith('mark_checkout_v2_guarantee_outcome', expect.objectContaining({
            p_status: 'manual_review',
            p_error: 'refund_create_rejected',
        }));
    });

    it('fails retryably before all Stripe reads and writes when another worker owns the lease', async () => {
        const admin = successfulAdmin({ claimLease: 'other' });
        supabaseMocks.create.mockReturnValue(admin);
        const { runCheckoutV2Guarantee, CheckoutV2GuaranteeError } = await import('../../src/lib/checkout-v2-guarantee');
        const outcome = runCheckoutV2Guarantee({ context: testContext(), actorId, requestId, subscriptionId });
        await expect(outcome).rejects.toBeInstanceOf(CheckoutV2GuaranteeError);
        await expect(outcome).rejects.toMatchObject({ status: 503, guarantee: { status: 'retryable' } });
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionCancel).not.toHaveBeenCalled();
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });

    it('does not let an expired worker continue to Stripe or mark an outcome', async () => {
        const admin = successfulAdmin({ claimLease: 'expired' });
        supabaseMocks.create.mockReturnValue(admin);
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');
        await expect(runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        })).rejects.toMatchObject({ status: 503, guarantee: { status: 'retryable' } });
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'mark_checkout_v2_guarantee_outcome',
            expect.anything(),
        );
    });

    it('maps lease and post-cancellation 40001 conflicts to retryable with the same operation', async () => {
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');
        const claimAdmin = successfulAdmin({
            claimError: { code: '40001', message: 'checkout_v2_guarantee_claim_is_not_active' },
        });
        supabaseMocks.create.mockReturnValueOnce(claimAdmin);
        await expect(runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        })).rejects.toMatchObject({
            status: 503,
            guarantee: { status: 'retryable', operationId },
        });

        const terminationAdmin = successfulAdmin({
            terminationError: { code: '40001', message: 'checkout_v2_guarantee_termination_state_conflicts' },
        });
        supabaseMocks.create.mockReturnValueOnce(terminationAdmin);
        await expect(runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        })).rejects.toMatchObject({
            status: 503,
            guarantee: { status: 'retryable', operationId },
        });
        expect(stripeMocks.subscriptionCancel).toHaveBeenCalled();
    });

    it('moves to manual review for a foreign refund racing between preflight and refund creation', async () => {
        const admin = successfulAdmin();
        supabaseMocks.create.mockReturnValue(admin);
        stripeMocks.refundsList
            .mockResolvedValueOnce({ data: [], has_more: false })
            .mockResolvedValueOnce({
                data: [{
                    ...exactRefund(),
                    id: 're_unrelated',
                    metadata: { guaranteeOperationId: 'd0000000-0000-4000-8000-00000000000d' },
                }],
                has_more: false,
            });
        const { runCheckoutV2Guarantee } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await runCheckoutV2Guarantee({
            context: testContext(), actorId, requestId, subscriptionId,
        });

        expect(result).toMatchObject({ status: 'manual_review', operationId });
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenCalledWith('mark_checkout_v2_guarantee_outcome', expect.objectContaining({
            p_worker_token: expect.any(String),
            p_status: 'manual_review',
            p_error: 'refund_reconciliation_incoherent',
        }));
    });

    it('resolves an evidence-free closed ticket and resumes the same durable operation', async () => {
        const admin = successfulAdmin({ tableStatus: 'manual_review', preparedStatus: 'retryable' });
        supabaseMocks.create.mockReturnValue(admin);
        const { resolveCheckoutV2GuaranteeReview } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await resolveCheckoutV2GuaranteeReview({
            context: testContext(), operationId, adminId: actorId, reason: 'The preflight mismatch was corrected.',
        });

        expect(result).toMatchObject({ status: 'refunded', operationId });
        expect(admin.rpc).toHaveBeenCalledWith('resolve_checkout_v2_guarantee_review', {
            p_operation_id: operationId,
            p_admin_id: actorId,
            p_reason: 'The preflight mismatch was corrected.',
        });
        expect(admin.rpc).toHaveBeenCalledWith('prepare_checkout_v2_guarantee', {
            p_request_id: requestId,
            p_subscription_id: subscriptionId,
            p_actor_id: actorId,
        });
        expect(stripeMocks.refundsCreate).toHaveBeenCalledOnce();
    });

    it.each(['failed', 'canceled'])('does not reset a manual review with a %s refund', async (refundStatus) => {
        const admin = successfulAdmin({
            preparedStatus: 'manual_review',
            operationOverrides: {
                stripe_refund_id: 're_guarantee',
                refund_status: refundStatus,
                refund_created_at: new Date().toISOString(),
                refund_started_at: new Date().toISOString(),
                terminated_at: new Date().toISOString(),
                last_error: `stripe_refund_${refundStatus}`,
            },
        });
        supabaseMocks.create.mockReturnValue(admin);
        const { resolveCheckoutV2GuaranteeReview } = await import('../../src/lib/checkout-v2-guarantee');

        await expect(resolveCheckoutV2GuaranteeReview({
            context: testContext(), operationId, adminId: actorId, reason: 'Reviewed by support.',
        })).rejects.toMatchObject({
            status: 202,
            guarantee: { status: 'manual_review', operationId },
        });
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'resolve_checkout_v2_guarantee_review',
            expect.anything(),
        );
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });

    it.each(['pending', 'succeeded'])('reconciles an exact %s refund without another external write', async (status) => {
        const opOverrides = {
            stripe_refund_id: 're_guarantee',
            refund_status: status,
            refund_created_at: new Date().toISOString(),
            refund_started_at: new Date().toISOString(),
            terminated_at: new Date().toISOString(),
            last_error: 'awaiting_manual_reconciliation',
        };
        const admin = successfulAdmin({ preparedStatus: 'manual_review', operationOverrides: opOverrides });
        supabaseMocks.create.mockReturnValue(admin);
        const refund = exactRefund(status);
        stripeMocks.refundsRetrieve.mockResolvedValueOnce(refund);
        stripeMocks.refundsList.mockResolvedValueOnce({ data: [refund], has_more: false });
        const { reconcileCheckoutV2GuaranteeRefundOperation } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await reconcileCheckoutV2GuaranteeRefundOperation({
            context: testContext(), operationId,
        });

        expect(result.status).toBe(status === 'succeeded' ? 'refunded' : 'refund_pending');
        expect(admin.rpc).toHaveBeenCalledWith('observe_checkout_v2_guarantee_refund', expect.objectContaining({
            p_operation_id: operationId,
            p_stripe_refund_id: 're_guarantee',
            p_refund_status: status,
        }));
        expect(stripeMocks.subscriptionCancel).not.toHaveBeenCalled();
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });

    it.each(['failed', 'canceled'])('observes an exact %s refund but performs no external write', async (status) => {
        const opOverrides = {
            stripe_refund_id: 're_guarantee',
            refund_status: status,
            refund_created_at: new Date().toISOString(),
            refund_started_at: new Date().toISOString(),
            terminated_at: new Date().toISOString(),
            last_error: `stripe_refund_${status}`,
        };
        const admin = successfulAdmin({ preparedStatus: 'manual_review', operationOverrides: opOverrides });
        supabaseMocks.create.mockReturnValue(admin);
        const refund = exactRefund(status);
        stripeMocks.refundsRetrieve.mockResolvedValueOnce(refund);
        stripeMocks.refundsList.mockResolvedValueOnce({ data: [refund], has_more: false });
        const { reconcileCheckoutV2GuaranteeRefundOperation } = await import('../../src/lib/checkout-v2-guarantee');

        const result = await reconcileCheckoutV2GuaranteeRefundOperation({
            context: testContext(), operationId,
        });

        expect(result.status).toBe('manual_review');
        expect(admin.rpc).toHaveBeenCalledWith('observe_checkout_v2_guarantee_refund', expect.objectContaining({
            p_refund_status: status,
        }));
        expect(stripeMocks.subscriptionCancel).not.toHaveBeenCalled();
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });

    it('rejects a foreign refund during manual reconciliation without observing it', async () => {
        const opOverrides = {
            stripe_refund_id: 're_guarantee',
            refund_status: 'pending',
            refund_created_at: new Date().toISOString(),
            refund_started_at: new Date().toISOString(),
            terminated_at: new Date().toISOString(),
            last_error: 'awaiting_manual_reconciliation',
        };
        const admin = successfulAdmin({ preparedStatus: 'manual_review', operationOverrides: opOverrides });
        supabaseMocks.create.mockReturnValue(admin);
        const refund = exactRefund('pending');
        stripeMocks.refundsRetrieve.mockResolvedValueOnce(refund);
        stripeMocks.refundsList.mockResolvedValueOnce({
            data: [{ ...refund, id: 're_foreign', metadata: {} }],
            has_more: false,
        });
        const { reconcileCheckoutV2GuaranteeRefundOperation } = await import('../../src/lib/checkout-v2-guarantee');

        await expect(reconcileCheckoutV2GuaranteeRefundOperation({
            context: testContext(), operationId,
        })).rejects.toMatchObject({
            status: 202,
            guarantee: { status: 'manual_review', operationId },
        });
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'observe_checkout_v2_guarantee_refund',
            expect.anything(),
        );
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });

    it.each(['succeeded', 'failed', 'canceled'])('observes authoritative %s instead of a stale pending webhook snapshot', async (currentStatus) => {
        const admin = successfulAdmin({
            tableStatus: 'manual_review',
            operationOverrides: {
                stripe_refund_id: 're_guarantee',
                refund_status: currentStatus,
                refund_created_at: new Date().toISOString(),
                refund_started_at: new Date().toISOString(),
                terminated_at: new Date().toISOString(),
                last_error: 'awaiting_webhook_reconciliation',
            },
        });
        supabaseMocks.create.mockReturnValue(admin);
        const staleEvent = exactRefund('pending');
        stripeMocks.refundsRetrieve.mockResolvedValueOnce({ ...staleEvent, status: currentStatus });
        const { observeCheckoutV2GuaranteeRefundFromWebhook } = await import('../../src/lib/checkout-v2-guarantee');

        await expect(observeCheckoutV2GuaranteeRefundFromWebhook({ refund: staleEvent as never }))
            .resolves.toBe(true);
        expect(admin.rpc).toHaveBeenCalledWith('observe_checkout_v2_guarantee_refund', expect.objectContaining({
            p_refund_status: currentStatus,
        }));
        expect(stripeMocks.refundsCreate).not.toHaveBeenCalled();
    });
});
