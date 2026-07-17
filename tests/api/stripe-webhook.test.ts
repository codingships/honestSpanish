import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    accountRetrieve: vi.fn(),
    constructEventAsync: vi.fn(),
    subscriptionRetrieve: vi.fn(),
    invoicePaymentList: vi.fn(),
    refundList: vi.fn(),
}));

const supabaseMocks = vi.hoisted(() => ({
    createSupabaseAdminClient: vi.fn(),
}));

const fulfillmentMocks = vi.hoisted(() => ({
    enqueueWelcomeFulfillment: vi.fn(),
    enqueueRenewalNotice: vi.fn(),
    triggerFulfillmentProcessing: vi.fn(),
}));

const crmMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn().mockResolvedValue({ status: 'created' }),
}));

const studentId = '10000000-0000-4000-8000-000000000001';
const packageId = '20000000-0000-4000-8000-000000000002';
const packagePriceId = '30000000-0000-4000-8000-000000000003';
const opportunityId = '40000000-0000-4000-8000-000000000004';
const checkoutIntentId = '50000000-0000-4000-8000-000000000005';

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        accounts: {
            retrieve: stripeMocks.accountRetrieve,
        },
        webhooks: {
            constructEventAsync: stripeMocks.constructEventAsync,
        },
        subscriptions: {
            retrieve: stripeMocks.subscriptionRetrieve,
        },
        invoicePayments: {
            list: stripeMocks.invoicePaymentList,
        },
        refunds: {
            list: stripeMocks.refundList,
        },
    },
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: supabaseMocks.createSupabaseAdminClient,
}));

vi.mock('../../src/lib/fulfillment/queue', () => ({
    enqueueWelcomeFulfillment: fulfillmentMocks.enqueueWelcomeFulfillment,
    enqueueRenewalNotice: fulfillmentMocks.enqueueRenewalNotice,
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    triggerFulfillmentProcessing: fulfillmentMocks.triggerFulfillmentProcessing,
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    recordCrmActivityForProfileSafe: crmMocks.recordCrmActivityForProfileSafe,
}));

function webhookContext(signature: string | null = 't=123,v1=test') {
    return {
        request: {
            text: vi.fn().mockResolvedValue('{"id":"evt_1"}'),
            headers: {
                get: vi.fn((name: string) => name.toLowerCase() === 'stripe-signature' ? signature : null),
            },
        },
        locals: {},
    };
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'evt_checkout_1',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_1',
                metadata: {
                    userId: studentId,
                    packageId,
                    packagePriceId,
                    crmOpportunityId: opportunityId,
                    checkoutIntentId,
                    priceId: 'price_1m',
                    legalPolicyVersion: 'mutable-stripe-copy',
                    termsAcceptedAt: '2026-07-09T09:00:00.000Z',
                },
                created: 1783677600,
                customer: 'cus_checkout_1',
                subscription: 'sub_1',
                invoice: 'in_1',
                amount_total: 12000,
                currency: 'eur',
                payment_status: 'paid',
                // Subscription-mode Checkout Sessions do not expose the invoice PaymentIntent here.
                payment_intent: null,
                ...overrides,
            },
        },
    };
}

function expiredCheckoutEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'evt_checkout_expired_1',
        type: 'checkout.session.expired',
        livemode: false,
        data: {
            object: {
                id: 'cs_expired_1',
                livemode: false,
                metadata: {
                    userId: studentId,
                    packagePriceId,
                    crmOpportunityId: opportunityId,
                    checkoutIntentId,
                },
                ...overrides,
            },
        },
    };
}

function refundEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: 'evt_refund_1',
        type: 'charge.refunded',
        livemode: false,
        data: {
            object: {
                id: 'ch_1',
                payment_intent: 'pi_1',
                amount: 12000,
                amount_refunded: 3000,
                currency: 'eur',
                livemode: false,
                refunds: { data: [] },
                ...overrides,
            },
        },
    };
}

function stripeRefund(overrides: Record<string, unknown> = {}) {
    return {
        id: 're_1',
        object: 'refund',
        amount: 3000,
        charge: 'ch_1',
        created: 1783677600,
        currency: 'eur',
        payment_intent: 'pi_1',
        status: 'succeeded',
        ...overrides,
    };
}

function createProcessedWebhookFinalizationQuery() {
    const chain: any = {};
    chain.eq = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.maybeSingle = vi.fn().mockResolvedValue({
        data: { stripe_event_id: 'evt_claimed' },
        error: null,
    });
    return chain;
}

function makeDuplicateSupabase() {
    const processedMaybeSingle = vi.fn().mockResolvedValue({
        data: { processing_status: 'succeeded' },
        error: null,
    });
    const processedInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') {
            return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                insert: processedInsert,
                maybeSingle: processedMaybeSingle,
            };
        }
        throw new Error(`Unexpected table ${table}`);
    });
    return { client: { from }, processedInsert, processedMaybeSingle };
}

function makeExpiredCheckoutSupabase(
    intent: Record<string, unknown> | null = {
        id: checkoutIntentId,
        opportunity_id: opportunityId,
        student_id: studentId,
        package_price_id: packagePriceId,
        stripe_checkout_session_id: 'cs_expired_1',
        status: 'open',
    }
) {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedFinalization = createProcessedWebhookFinalizationQuery();
    const processedUpdate = vi.fn().mockReturnValue(processedFinalization);
    const intentQuery: any = {};
    intentQuery.select = vi.fn(() => intentQuery);
    intentQuery.eq = vi.fn(() => intentQuery);
    intentQuery.maybeSingle = vi.fn().mockResolvedValue({ data: intent, error: null });
    const releaseExpiredIntent = vi.fn().mockResolvedValue({
        data: intent ? { ...intent, status: 'expired' } : null,
        error: null,
    });
    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') {
            return { insert: processedInsert, update: processedUpdate };
        }
        if (table === 'checkout_intents') return intentQuery;
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        client: { from, rpc: releaseExpiredIntent },
        processedUpdate,
        intentQuery,
        releaseExpiredIntent,
    };
}

function makeCheckoutSupabase() {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedFinalization = createProcessedWebhookFinalizationQuery();
    const processedUpdate = vi.fn().mockReturnValue(processedFinalization);
    const packagePriceSingle = vi.fn().mockResolvedValue({
        data: {
            id: packagePriceId,
            package_id: packageId,
            package_key: 'standard',
            display_name: { es: 'Estándar', en: 'Standard', ru: 'Стандартный' },
            duration_months: 1,
            amount_cents: 12000,
            currency: 'eur',
            sessions_per_period: 4,
            stripe_product_id: 'prod_standard',
            stripe_price_id: 'price_1m',
            stripe_account_id: 'acct_test',
            stripe_livemode: false,
        },
        error: null,
    });
    const packagePriceQuery: any = {};
    packagePriceQuery.select = vi.fn(() => packagePriceQuery);
    packagePriceQuery.eq = vi.fn(() => packagePriceQuery);
    packagePriceQuery.single = packagePriceSingle;

    const packageSingle = vi.fn().mockResolvedValue({
        data: { id: packageId, name: 'standard' },
        error: null,
    });
    const packageQuery: any = {};
    packageQuery.select = vi.fn(() => packageQuery);
    packageQuery.eq = vi.fn(() => packageQuery);
    packageQuery.single = packageSingle;

    const subscriptionInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
                data: {
                    id: 'local-subscription-1',
                    student_id: studentId,
                    package_id: packageId,
                    package_price_id: packagePriceId,
                    starts_at: '2026-07-10',
                    ends_at: '2026-08-10',
                    sessions_total: 4,
                    contracted_sessions_per_period: 4,
                },
                error: null,
            }),
        }),
    });
    const subscriptionLookup: any = {};
    subscriptionLookup.select = vi.fn(() => subscriptionLookup);
    subscriptionLookup.eq = vi.fn(() => subscriptionLookup);
    subscriptionLookup.limit = vi.fn(() => subscriptionLookup);
    subscriptionLookup.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    const paymentLookup: any = {};
    paymentLookup.select = vi.fn(() => paymentLookup);
    paymentLookup.eq = vi.fn(() => paymentLookup);
    paymentLookup.order = vi.fn(() => paymentLookup);
    paymentLookup.limit = vi.fn(() => paymentLookup);
    paymentLookup.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const paymentSingle = vi.fn().mockResolvedValue({ data: { id: 'payment-1' }, error: null });
    const paymentSelect = vi.fn().mockReturnValue({ single: paymentSingle });
    const paymentInsert = vi.fn().mockReturnValue({ select: paymentSelect });
    const paymentUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEq });
    const welcomeJobLookup: any = {};
    welcomeJobLookup.select = vi.fn(() => welcomeJobLookup);
    welcomeJobLookup.eq = vi.fn(() => welcomeJobLookup);
    welcomeJobLookup.limit = vi.fn(() => welcomeJobLookup);
    welcomeJobLookup.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    const opportunityMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: opportunityId },
        error: null,
    });
    const opportunityMutation: any = {};
    opportunityMutation.eq = vi.fn(() => opportunityMutation);
    opportunityMutation.is = vi.fn(() => opportunityMutation);
    opportunityMutation.select = vi.fn(() => opportunityMutation);
    opportunityMutation.maybeSingle = opportunityMaybeSingle;
    const opportunityUpdate = vi.fn(() => opportunityMutation);
    const completeCheckoutIntent = vi.fn().mockResolvedValue({
        data: {
            id: checkoutIntentId,
            stripe_checkout_session_id: 'cs_1',
            stripe_customer_id: 'cus_checkout_1',
            legal_policy_version: '2026-07-10',
            policy_accepted_at: '2026-07-10T10:00:00.000Z',
        },
        error: null,
    });

    let subscriptionFromCalls = 0;
    let paymentFromCalls = 0;

    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') {
            return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                insert: processedInsert,
                update: processedUpdate,
            };
        }
        if (table === 'package_prices') return packagePriceQuery;
        if (table === 'packages') return packageQuery;
        if (table === 'crm_opportunities') return { update: opportunityUpdate };
        if (table === 'payments') {
            paymentFromCalls += 1;
            return paymentFromCalls === 1
                ? paymentLookup
                : { insert: paymentInsert, update: paymentUpdate };
        }
        if (table === 'fulfillment_jobs') return welcomeJobLookup;
        if (table === 'subscriptions') {
            subscriptionFromCalls += 1;
            return subscriptionFromCalls === 1
                ? subscriptionLookup
                : { insert: subscriptionInsert };
        }
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        client: { from, rpc: completeCheckoutIntent },
        processedInsert,
        processedUpdate,
        processedUpdateEq: processedFinalization.eq,
        processedFinalization,
        packagePriceQuery,
        packagePriceSingle,
        packageQuery,
        packageSingle,
        subscriptionLookup,
        subscriptionInsert,
        paymentLookup,
        paymentInsert,
        paymentUpdate,
        paymentUpdateEq,
        paymentSelect,
        paymentSingle,
        welcomeJobLookup,
        opportunityUpdate,
        opportunityMutation,
        opportunityMaybeSingle,
        completeCheckoutIntent,
    };
}

function makeRetryableCheckoutSupabase(
    status: 'failed' | 'processing',
    createdAt: string | null,
    reclaimSucceeds = true
) {
    const checkout = makeCheckoutSupabase();
    const processedInsert = vi.fn().mockResolvedValue({ error: { code: '23505' } });

    const stateLookup: any = {};
    stateLookup.eq = vi.fn(() => stateLookup);
    stateLookup.maybeSingle = vi.fn().mockResolvedValue({
        data: { processing_status: status, created_at: createdAt },
        error: null,
    });

    const reclaim: any = {};
    reclaim.eq = vi.fn(() => reclaim);
    reclaim.is = vi.fn(() => reclaim);
    reclaim.select = vi.fn(() => reclaim);
    reclaim.maybeSingle = vi.fn().mockResolvedValue({
        data: reclaimSucceeds ? { stripe_event_id: 'evt_checkout_1' } : null,
        error: null,
    });

    const processedFinalization = createProcessedWebhookFinalizationQuery();
    const processedUpdate = vi.fn((payload: { processing_status?: string; created_at?: string }) => (
        payload.processing_status === 'processing' && payload.created_at
            ? reclaim
            : processedFinalization
    ));
    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') {
            return {
                insert: processedInsert,
                select: vi.fn(() => stateLookup),
                update: processedUpdate,
            };
        }
        return checkout.client.from(table);
    });

    return {
        ...checkout,
        client: { from, rpc: checkout.completeCheckoutIntent },
        processedInsert,
        processedUpdate,
        reclaim,
        markSucceededEq: processedFinalization.eq,
    };
}

function makeRefundSupabase(directPaymentIntentMatch = true) {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedFinalization = createProcessedWebhookFinalizationQuery();
    const processedUpdate = vi.fn().mockReturnValue(processedFinalization);
    const payment = {
        id: 'payment-1',
        student_id: 'student-1',
        subscription_id: 'subscription-1',
        amount: 12000,
        amount_refunded: 0,
        currency: 'eur',
        status: 'succeeded',
    };
    const lookupRows = directPaymentIntentMatch ? [payment] : [null, payment];
    const paymentLookups = lookupRows.map((data) => {
        const lookup: any = {};
        lookup.select = vi.fn(() => lookup);
        lookup.eq = vi.fn(() => lookup);
        lookup.order = vi.fn(() => lookup);
        lookup.limit = vi.fn(() => lookup);
        lookup.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
        return lookup;
    });
    const paymentUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEq });
    const refundRpc = vi.fn().mockImplementation((
        _name: string,
        args: { p_amount_refunded: number; p_stripe_refund_id: string; p_refunded_at: string }
    ) => ({
        data: {
            ...payment,
            amount_refunded: args.p_amount_refunded,
            stripe_refund_id: args.p_stripe_refund_id,
            refunded_at: args.p_refunded_at,
            status: args.p_amount_refunded >= payment.amount ? 'refunded' : payment.status,
        },
        error: null,
    }));
    let paymentCalls = 0;
    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') {
            return { insert: processedInsert, update: processedUpdate };
        }
        if (table === 'payments') {
            const lookup = paymentLookups[paymentCalls];
            paymentCalls += 1;
            return lookup ?? { update: paymentUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        client: { from, rpc: refundRpc },
        processedUpdate,
        paymentLookups,
        paymentUpdate,
        paymentUpdateEq,
        refundRpc,
    };
}

function makeRenewalSupabase() {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedFinalization = createProcessedWebhookFinalizationQuery();
    const processedUpdate = vi.fn().mockReturnValue(processedFinalization);

    const subscriptionLookup: any = {};
    subscriptionLookup.select = vi.fn(() => subscriptionLookup);
    subscriptionLookup.eq = vi.fn(() => subscriptionLookup);
    subscriptionLookup.order = vi.fn(() => subscriptionLookup);
    subscriptionLookup.limit = vi.fn(() => subscriptionLookup);
    subscriptionLookup.maybeSingle = vi.fn().mockResolvedValue({
        data: {
            id: 'local-subscription-1',
            student_id: studentId,
            package_id: packageId,
            package_price_id: packagePriceId,
            sessions_total: 12,
            contracted_sessions_per_period: 12,
            duration_months: 3,
            ends_at: '2099-08-10',
            status: 'active',
            stripe_subscription_id: 'sub_1',
            stripe_invoice_id: 'in_initial',
        },
        error: null,
    });
    const subscriptionUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const subscriptionUpdate = vi.fn().mockReturnValue({ eq: subscriptionUpdateEq });

    const packagePriceQuery = createSingleQueryForWebhook({
        data: {
            id: packagePriceId,
            package_key: 'standard',
            display_name: { es: 'Estándar', en: 'Standard', ru: 'Стандартный' },
            stripe_price_id: 'price_3m',
            stripe_product_id: 'prod_standard',
            stripe_account_id: 'acct_test',
            amount_cents: 27000,
            currency: 'eur',
            stripe_livemode: false,
            duration_months: 3,
        },
        error: null,
    });

    const paymentSingle = vi.fn().mockResolvedValue({ data: { id: 'renewal-payment-1' }, error: null });
    const paymentSelect = vi.fn().mockReturnValue({ single: paymentSingle });
    const paymentInsert = vi.fn().mockReturnValue({ select: paymentSelect });
    const paymentUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const paymentUpdate = vi.fn().mockReturnValue({ eq: paymentUpdateEq });
    const paymentLookup: any = {};
    paymentLookup.select = vi.fn(() => paymentLookup);
    paymentLookup.eq = vi.fn(() => paymentLookup);
    paymentLookup.order = vi.fn(() => paymentLookup);
    paymentLookup.limit = vi.fn(() => paymentLookup);
    paymentLookup.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

    let subscriptionCalls = 0;
    let paymentCalls = 0;
    const renewalRpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') {
            return { insert: processedInsert, update: processedUpdate };
        }
        if (table === 'subscriptions') {
            subscriptionCalls += 1;
            return subscriptionCalls === 1
                ? subscriptionLookup
                : { update: subscriptionUpdate };
        }
        if (table === 'package_prices') return packagePriceQuery;
        if (table === 'payments') {
            paymentCalls += 1;
            return paymentCalls === 1
                ? paymentLookup
                : { insert: paymentInsert, update: paymentUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        client: { from, rpc: renewalRpc },
        processedUpdate,
        subscriptionLookup,
        subscriptionUpdate,
        subscriptionUpdateEq,
        paymentInsert,
        paymentLookup,
        paymentUpdate,
        renewalRpc,
        packagePriceQuery,
    };
}

function createSingleQueryForWebhook(result: { data: unknown; error: unknown }) {
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.single = vi.fn().mockResolvedValue(result);
    return query;
}

function renewalStripeSubscription(overrides: Record<string, unknown> = {}) {
    return {
        status: 'active',
        cancel_at_period_end: false,
        metadata: { userId: studentId },
        items: {
            data: [{
                quantity: 1,
                current_period_end: Math.floor(Date.parse('2099-11-10T00:00:00.000Z') / 1000),
                price: {
                    id: 'price_3m',
                    product: 'prod_standard',
                    unit_amount: 27000,
                    currency: 'eur',
                    livemode: false,
                    recurring: { interval: 'month', interval_count: 3 },
                },
            }],
        },
        ...overrides,
    };
}

function recurringInvoice(overrides: Record<string, unknown> = {}) {
    return {
        id: 'in_renewal',
        billing_reason: 'subscription_cycle',
        parent: {
            type: 'subscription_details',
            quote_details: null,
            subscription_details: {
                metadata: {},
                subscription: 'sub_1',
            },
        },
        amount_paid: 27000,
        amount_due: 27000,
        total: 27000,
        currency: 'eur',
        ...overrides,
    };
}

function invoiceEvent(type: 'invoice.paid' | 'invoice.payment_failed' | 'invoice.upcoming', object: Record<string, unknown>) {
    return {
        id: `evt_${type.replaceAll('.', '_')}`,
        type,
        data: { object },
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('POST /api/stripe-webhook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test_secret_key_123');
        vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
        vi.stubEnv('PUBLIC_APP_ENV', 'test');
        stripeMocks.accountRetrieve.mockResolvedValue({ id: 'acct_test', country: 'US' });
        stripeMocks.constructEventAsync.mockResolvedValue(checkoutEvent());
        stripeMocks.subscriptionRetrieve.mockResolvedValue({
            customer: 'cus_checkout_1',
            status: 'active',
            cancel_at_period_end: false,
            metadata: {
                userId: studentId,
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
                priceId: 'price_1m',
            },
            items: {
                data: [{
                    quantity: 1,
                    current_period_start: Math.floor(Date.parse('2026-07-10T00:00:00.000Z') / 1000),
                    current_period_end: Math.floor(Date.parse('2026-08-10T00:00:00.000Z') / 1000),
                    price: {
                        id: 'price_1m',
                        active: true,
                        unit_amount: 12000,
                        currency: 'eur',
                        product: 'prod_standard',
                        livemode: false,
                        recurring: { interval: 'month', interval_count: 1 },
                    },
                }],
            },
        });
        stripeMocks.invoicePaymentList.mockResolvedValue({
            data: [{
                id: 'ip_1',
                status: 'paid',
                is_default: true,
                invoice: 'in_1',
                payment: {
                    type: 'payment_intent',
                    payment_intent: 'pi_1',
                },
            }],
        });
        stripeMocks.refundList.mockResolvedValue({ data: [], has_more: false });
        fulfillmentMocks.enqueueWelcomeFulfillment.mockResolvedValue(true);
        fulfillmentMocks.enqueueRenewalNotice.mockResolvedValue(true);
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(makeCheckoutSupabase().client);
    });

    it('returns 400 when missing Stripe-Signature header', async () => {
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext(null) as any);

        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toContain('Missing stripe-signature header');
    });

    it('returns 400 on webhook signature verification failure', async () => {
        stripeMocks.constructEventAsync.mockRejectedValue(new Error('Firma Invalida'));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toContain('Webhook Error');
    });

    it('verifies the raw payload with the async Web Crypto-compatible Stripe API', async () => {
        const duplicate = makeDuplicateSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(duplicate.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.constructEventAsync).toHaveBeenCalledWith(
            '{"id":"evt_1"}',
            't=123,v1=test',
            'test_secret_key_123',
        );
    });

    it('acknowledges duplicate events without running payment handlers again', async () => {
        const { client, processedInsert, processedMaybeSingle } = makeDuplicateSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.received).toBe(true);
        expect(processedInsert).toHaveBeenCalledWith(expect.objectContaining({
            stripe_event_id: 'evt_checkout_1',
            processing_status: 'processing',
        }));
        expect(processedMaybeSingle).toHaveBeenCalled();
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
        expect(fulfillmentMocks.enqueueWelcomeFulfillment).not.toHaveBeenCalled();
    });

    it('does not enqueue a second renewal notice for a duplicate upcoming-invoice event', async () => {
        const duplicate = makeDuplicateSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(duplicate.client);
        stripeMocks.constructEventAsync.mockResolvedValue({
            id: 'evt_upcoming_duplicate',
            type: 'invoice.upcoming',
            data: { object: {} },
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(fulfillmentMocks.enqueueRenewalNotice).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
    });

    it('releases the exact local checkout intent when its Stripe Session expires', async () => {
        const expired = makeExpiredCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(expired.client);
        stripeMocks.constructEventAsync.mockResolvedValue(expiredCheckoutEvent());
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(expired.intentQuery.eq).toHaveBeenCalledWith('id', checkoutIntentId);
        expect(expired.releaseExpiredIntent).toHaveBeenCalledWith('release_expired_checkout_intent', {
            p_intent_id: checkoutIntentId,
            p_stripe_checkout_session_id: 'cs_expired_1',
        });
        expect(expired.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('ignores an expired foreign Checkout Session only after proving no local intent exists', async () => {
        const expired = makeExpiredCheckoutSupabase(null);
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(expired.client);
        stripeMocks.constructEventAsync.mockResolvedValue(expiredCheckoutEvent({ metadata: {} }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(expired.intentQuery.eq).toHaveBeenCalledWith('stripe_checkout_session_id', 'cs_expired_1');
        expect(expired.releaseExpiredIntent).not.toHaveBeenCalled();
    });

    it('fails for retry when an expired local Checkout Session is missing app metadata', async () => {
        const expired = makeExpiredCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(expired.client);
        stripeMocks.constructEventAsync.mockResolvedValue(expiredCheckoutEvent({ metadata: {} }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(expired.releaseExpiredIntent).not.toHaveBeenCalled();
        expect(expired.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('authorization metadata'),
        }));
    });

    it('rejects an expired Checkout Session from the wrong Stripe mode', async () => {
        const expired = makeExpiredCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(expired.client);
        stripeMocks.constructEventAsync.mockResolvedValue(expiredCheckoutEvent({ livemode: true }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(expired.intentQuery.maybeSingle).not.toHaveBeenCalled();
        expect(expired.releaseExpiredIntent).not.toHaveBeenCalled();
    });

    it('atomically reclaims a failed event and resumes idempotently from existing side effects', async () => {
        const retry = makeRetryableCheckoutSupabase('failed', '2026-07-10T09:00:00.000Z');
        retry.subscriptionLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'local-subscription-1',
                student_id: studentId,
                package_id: packageId,
                package_price_id: packagePriceId,
                starts_at: '2026-07-09',
                ends_at: '2026-08-09',
                sessions_total: 4,
                contracted_sessions_per_period: 4,
            },
            error: null,
        });
        retry.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'payment-1',
                student_id: studentId,
                subscription_id: 'local-subscription-1',
                amount: 12000,
                currency: 'eur',
                status: 'succeeded',
                stripe_payment_intent_id: 'pi_1',
            },
            error: null,
        });
        retry.welcomeJobLookup.maybeSingle.mockResolvedValueOnce({
            data: { id: 'welcome-job-1' },
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(retry.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(retry.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'processing',
            processing_error: null,
            created_at: expect.any(String),
        }));
        expect(retry.subscriptionInsert).not.toHaveBeenCalled();
        expect(retry.paymentInsert).not.toHaveBeenCalled();
        expect(retry.paymentUpdate).toHaveBeenCalledWith({
            description: 'standard - 1 month(s) - Initial',
        });
        expect(fulfillmentMocks.enqueueWelcomeFulfillment).not.toHaveBeenCalled();
        expect(retry.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('reclaims a processing event after its ten-minute lease expires', async () => {
        const retry = makeRetryableCheckoutSupabase('processing', '2000-01-01T00:00:00.000Z');
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(retry.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(retry.reclaim.eq).toHaveBeenCalledWith('created_at', '2000-01-01T00:00:00.000Z');
        expect(retry.subscriptionInsert).toHaveBeenCalled();
        expect(retry.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('keeps a fresh processing claim exclusive', async () => {
        const retry = makeRetryableCheckoutSupabase('processing', new Date().toISOString());
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(retry.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(retry.processedUpdate).not.toHaveBeenCalled();
        expect(retry.subscriptionInsert).not.toHaveBeenCalled();
        expect(stripeMocks.invoicePaymentList).not.toHaveBeenCalled();
    });

    it('does not activate quota for a checkout session that is not paid', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(checkoutEvent({
            payment_status: 'unpaid',
        }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(checkoutSupabase.subscriptionInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.paymentInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.processedInsert).toHaveBeenCalledWith(expect.objectContaining({
            stripe_event_id: 'evt_checkout_1',
            event_type: 'checkout.session.completed',
            processing_status: 'processing',
        }));
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('fails closed when checkout metadata contradicts the paid Stripe Price', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(checkoutEvent({
            metadata: {
                userId: studentId,
                priceId: 'not-a-price-id',
            },
        }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(checkoutSupabase.packagePriceSingle).not.toHaveBeenCalled();
        expect(checkoutSupabase.subscriptionInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.paymentInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('metadata Price does not match'),
        }));
    });

    it.each([
        ['Checkout Session', { customer: 'cus_other_session' }, 'cus_checkout_1'],
        ['Stripe subscription', {}, 'cus_other_subscription'],
    ])('fails closed when the %s Customer differs from the authorized checkout Customer', async (
        _source,
        sessionOverrides,
        subscriptionCustomer,
    ) => {
        const checkoutSupabase = makeCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(checkoutEvent(sessionOverrides));
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce({
            customer: subscriptionCustomer,
            status: 'active',
            metadata: {
                userId: studentId,
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
                priceId: 'price_1m',
            },
            items: { data: [] },
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(checkoutSupabase.completeCheckoutIntent).not.toHaveBeenCalled();
        expect(checkoutSupabase.subscriptionInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('Customer'),
        }));
    });

    it('fails closed when the completion RPC does not return the snapshotted Customer', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        checkoutSupabase.completeCheckoutIntent.mockResolvedValueOnce({
            data: {
                id: checkoutIntentId,
                stripe_checkout_session_id: 'cs_1',
                stripe_customer_id: 'cus_other',
            },
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(checkoutSupabase.subscriptionInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.paymentInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('authorized checkout intent'),
        }));
    });

    it('creates subscription, payment and welcome fulfillment for checkout completion', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.received).toBe(true);
        expect(checkoutSupabase.subscriptionInsert).toHaveBeenCalledWith(expect.objectContaining({
            student_id: studentId,
            package_id: packageId,
            package_price_id: packagePriceId,
            duration_months: 1,
            sessions_total: 4,
            contracted_sessions_per_period: 4,
            stripe_subscription_id: 'sub_1',
            stripe_invoice_id: 'in_1',
        }));
        expect(checkoutSupabase.paymentInsert).toHaveBeenCalledWith(expect.objectContaining({
            student_id: studentId,
            subscription_id: 'local-subscription-1',
            amount: 12000,
            status: 'succeeded',
            stripe_invoice_id: 'in_1',
            stripe_payment_intent_id: 'pi_1',
        }));
        expect(stripeMocks.invoicePaymentList).toHaveBeenCalledWith({
            invoice: 'in_1',
            status: 'paid',
        });
        expect(checkoutSupabase.paymentSelect).toHaveBeenCalledWith('id');
        expect(checkoutSupabase.completeCheckoutIntent).toHaveBeenCalledWith('complete_checkout_intent', {
            p_intent_id: checkoutIntentId,
            p_opportunity_id: opportunityId,
            p_student_id: studentId,
            p_package_price_id: packagePriceId,
            p_stripe_checkout_session_id: 'cs_1',
            p_stripe_customer_id: 'cus_checkout_1',
        });
        expect(checkoutSupabase.opportunityUpdate).toHaveBeenCalledWith(expect.objectContaining({
            stage: 'won',
            converted_subscription_id: 'local-subscription-1',
            checkout_approved_at: null,
        }));
        expect(checkoutSupabase.opportunityMutation.eq).toHaveBeenCalledWith('id', opportunityId);
        expect(checkoutSupabase.opportunityMutation.eq).toHaveBeenCalledWith('preferred_package_id', packageId);
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(checkoutSupabase.client, expect.objectContaining({
            profileId: studentId,
            lifecycleStage: 'customer',
            activityType: 'payment',
            subject: 'Pago inicial recibido',
            relatedEntityType: 'payment',
            relatedEntityId: 'payment-1',
        }));
        expect(fulfillmentMocks.enqueueWelcomeFulfillment).toHaveBeenCalledWith(checkoutSupabase.client, {
            userId: studentId,
            packageId,
            packageKey: 'standard',
            packageDisplayName: { es: 'Estándar', en: 'Standard', ru: 'Стандартный' },
            subscriptionId: 'local-subscription-1',
            durationMonths: 1,
            startsAt: expect.any(String),
            endsAt: expect.any(String),
            sessionsTotal: 4,
            amountTotal: 12000,
            currency: 'eur',
            legalPolicyVersion: '2026-07-10',
            policyAcceptedAt: '2026-07-10T10:00:00.000Z',
        });
        expect(fulfillmentMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(expect.any(Object), 5);
        expect(checkoutSupabase.processedInsert).toHaveBeenCalledWith(expect.objectContaining({
            stripe_event_id: 'evt_checkout_1',
            event_type: 'checkout.session.completed',
            processing_status: 'processing',
        }));
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('does not mark an event succeeded after losing its processing lease', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        checkoutSupabase.processedFinalization.maybeSingle.mockResolvedValueOnce({
            data: null,
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(checkoutEvent());
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(checkoutSupabase.processedFinalization.eq).toHaveBeenCalledWith(
            'processing_status',
            'processing',
        );
        expect(checkoutSupabase.processedFinalization.eq).toHaveBeenCalledWith(
            'created_at',
            expect.any(String),
        );
    });

    it('marks a claimed event failed when checkout processing throws', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        checkoutSupabase.packagePriceSingle.mockResolvedValueOnce({
            data: null,
            error: { message: 'db unavailable' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);
        const body = await readJson(response);

        expect(response.status).toBe(500);
        expect(body.error).toBe('Webhook processing failed');
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('package price history'),
        }));
    });

    it('records a paid renewal using the InvoicePayment PaymentIntent mapping', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({ metadata: {} }));
        stripeMocks.constructEventAsync.mockResolvedValue({
            id: 'evt_invoice_paid_1',
            type: 'invoice.paid',
            data: {
                object: {
                    id: 'in_renewal',
                    billing_reason: 'subscription_cycle',
                    parent: {
                        type: 'subscription_details',
                        quote_details: null,
                        subscription_details: {
                            metadata: {},
                            subscription: 'sub_1',
                        },
                    },
                    amount_paid: 27000,
                    total: 27000,
                    currency: 'eur',
                },
            },
        });
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                id: 'ip_renewal',
                status: 'paid',
                is_default: true,
                invoice: 'in_renewal',
                payment: {
                    type: 'payment_intent',
                    payment_intent: 'pi_renewal',
                },
            }],
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.invoicePaymentList).toHaveBeenCalledWith({
            invoice: 'in_renewal',
            status: 'paid',
        });
        expect(renewalSupabase.renewalRpc).toHaveBeenCalledWith('apply_subscription_renewal', {
            p_subscription_id: 'local-subscription-1',
            p_stripe_subscription_id: 'sub_1',
            p_stripe_invoice_id: 'in_renewal',
            p_new_ends_at: '2099-11-10',
        });
        expect(renewalSupabase.paymentInsert).toHaveBeenCalledWith(expect.objectContaining({
            student_id: studentId,
            subscription_id: 'local-subscription-1',
            amount: 27000,
            status: 'succeeded',
            stripe_invoice_id: 'in_renewal',
            stripe_payment_intent_id: 'pi_renewal',
        }));
        expect(renewalSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('uses the local subscription owner for a failed invoice without user metadata', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({
            status: 'past_due',
            metadata: {},
        }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent(
            'invoice.payment_failed',
            recurringInvoice({ amount_paid: 0 })
        ));
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                status: 'open',
                payment: { type: 'payment_intent', payment_intent: 'pi_failed' },
            }],
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(renewalSupabase.paymentInsert).toHaveBeenCalledWith(expect.objectContaining({
            student_id: studentId,
            subscription_id: 'local-subscription-1',
            amount: 27000,
            status: 'failed',
            stripe_payment_intent_id: 'pi_failed',
        }));
        expect(renewalSupabase.subscriptionUpdate).toHaveBeenCalledWith({
            status: 'paused',
            stripe_subscription_id: 'sub_1',
        });
    });

    it('fails closed when invoice user metadata contradicts the local subscription owner', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({
            metadata: { userId: '90000000-0000-4000-8000-000000000009' },
        }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent('invoice.paid', recurringInvoice()));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(renewalSupabase.packagePriceQuery.single).not.toHaveBeenCalled();
        expect(renewalSupabase.paymentInsert).not.toHaveBeenCalled();
        expect(renewalSupabase.renewalRpc).not.toHaveBeenCalled();
    });

    it('ignores a foreign paid invoice only after finding no local subscription or app metadata', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.subscriptionLookup.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({ metadata: {} }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent('invoice.paid', recurringInvoice()));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.invoicePaymentList).not.toHaveBeenCalled();
        expect(renewalSupabase.packagePriceQuery.single).not.toHaveBeenCalled();
        expect(renewalSupabase.paymentInsert).not.toHaveBeenCalled();
    });

    it('fails for retry when an upcoming invoice has app metadata but no local subscription', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.subscriptionLookup.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({
            metadata: { packagePriceId },
        }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent('invoice.upcoming', recurringInvoice()));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(fulfillmentMocks.enqueueRenewalNotice).not.toHaveBeenCalled();
        expect(renewalSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('No managed subscription'),
        }));
    });

    it('allows a coherent failed-to-succeeded retry without rewriting invoice identity', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'renewal-payment-1',
                student_id: studentId,
                subscription_id: 'local-subscription-1',
                amount: 27000,
                currency: 'eur',
                status: 'failed',
                stripe_payment_intent_id: 'pi_renewal',
            },
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({ metadata: {} }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent('invoice.paid', recurringInvoice()));
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                status: 'paid',
                payment: { type: 'payment_intent', payment_intent: 'pi_renewal' },
            }],
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(renewalSupabase.paymentUpdate).toHaveBeenCalledWith({
            description: '3-month renewal',
            status: 'succeeded',
        });
        expect(renewalSupabase.renewalRpc).toHaveBeenCalled();
    });

    it('rejects an existing invoice row with incompatible immutable payment data', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'renewal-payment-1',
                student_id: studentId,
                subscription_id: 'local-subscription-1',
                amount: 26000,
                currency: 'eur',
                status: 'succeeded',
                stripe_payment_intent_id: 'pi_renewal',
            },
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({ metadata: {} }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent('invoice.paid', recurringInvoice()));
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                status: 'paid',
                payment: { type: 'payment_intent', payment_intent: 'pi_renewal' },
            }],
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(renewalSupabase.paymentUpdate).not.toHaveBeenCalled();
        expect(renewalSupabase.renewalRpc).not.toHaveBeenCalled();
    });

    it('rejects an existing invoice row linked to a different PaymentIntent', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'renewal-payment-1',
                student_id: studentId,
                subscription_id: 'local-subscription-1',
                amount: 27000,
                currency: 'eur',
                status: 'succeeded',
                stripe_payment_intent_id: 'pi_different',
            },
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({ metadata: {} }));
        stripeMocks.constructEventAsync.mockResolvedValue(invoiceEvent('invoice.paid', recurringInvoice()));
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                status: 'paid',
                payment: { type: 'payment_intent', payment_intent: 'pi_renewal' },
            }],
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(renewalSupabase.paymentUpdate).not.toHaveBeenCalled();
        expect(renewalSupabase.renewalRpc).not.toHaveBeenCalled();
    });

    it('enqueues one durable renewal notice from invoice.upcoming without requiring an invoice ID', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription({ metadata: {} }));
        const invoicePeriodEnd = Math.floor(Date.parse('2099-08-10T00:00:00.000Z') / 1000);
        stripeMocks.constructEventAsync.mockResolvedValue({
            id: 'evt_invoice_upcoming_1',
            type: 'invoice.upcoming',
            data: {
                object: {
                    parent: {
                        type: 'subscription_details',
                        subscription_details: {
                            metadata: {},
                            subscription: 'sub_1',
                        },
                    },
                    period_end: invoicePeriodEnd,
                    amount_due: 27000,
                    currency: 'eur',
                },
            },
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(fulfillmentMocks.enqueueRenewalNotice).toHaveBeenCalledTimes(1);
        expect(fulfillmentMocks.enqueueRenewalNotice).toHaveBeenCalledWith(
            renewalSupabase.client,
            expect.objectContaining({
                stripeEventId: 'evt_invoice_upcoming_1',
                stripeInvoiceId: undefined,
                stripeSubscriptionId: 'sub_1',
                userId: studentId,
                packageId,
                packageKey: 'standard',
                packageDisplayName: { es: 'Estándar', en: 'Standard', ru: 'Стандартный' },
                subscriptionId: 'local-subscription-1',
                renewalAt: '2099-11-10T00:00:00.000Z',
                cancelBy: '2099-11-10T00:00:00.000Z',
                durationMonths: 3,
                amountTotal: 27000,
                currency: 'eur',
            })
        );
        expect(fulfillmentMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(expect.any(Object), 5);
        expect(renewalSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('does not send an upcoming notice when Stripe will cancel at period end', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce({
            status: 'active',
            cancel_at_period_end: true,
            metadata: { userId: studentId },
            items: { data: [] },
        });
        stripeMocks.constructEventAsync.mockResolvedValue({
            id: 'evt_invoice_upcoming_cancelled',
            type: 'invoice.upcoming',
            data: {
                object: {
                    parent: {
                        type: 'subscription_details',
                        subscription_details: { subscription: 'sub_1' },
                    },
                    period_end: Math.floor(Date.parse('2099-11-10T00:00:00.000Z') / 1000),
                    amount_due: 27000,
                    currency: 'eur',
                },
            },
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(fulfillmentMocks.enqueueRenewalNotice).not.toHaveBeenCalled();
        expect(renewalSupabase.subscriptionLookup.maybeSingle).toHaveBeenCalledTimes(1);
    });

    it('does not reset quota when retrying a renewal invoice that was already applied', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.subscriptionLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'local-subscription-1',
                student_id: studentId,
                package_id: packageId,
                package_price_id: packagePriceId,
                sessions_total: 12,
                contracted_sessions_per_period: 12,
                duration_months: 3,
                ends_at: '2099-11-10',
                status: 'active',
                stripe_subscription_id: 'sub_1',
                stripe_invoice_id: 'in_renewal',
            },
            error: null,
        });
        renewalSupabase.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'renewal-payment-1',
                student_id: studentId,
                subscription_id: 'local-subscription-1',
                amount: 27000,
                currency: 'eur',
                status: 'succeeded',
                stripe_payment_intent_id: 'pi_renewal',
            },
            error: null,
        });
        renewalSupabase.renewalRpc.mockResolvedValueOnce({ data: false, error: null });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValueOnce(renewalStripeSubscription());
        stripeMocks.constructEventAsync.mockResolvedValue({
            id: 'evt_invoice_paid_retry',
            type: 'invoice.paid',
            data: {
                object: {
                    id: 'in_renewal',
                    billing_reason: 'subscription_cycle',
                    parent: {
                        type: 'subscription_details',
                        quote_details: null,
                        subscription_details: {
                            metadata: { userId: studentId },
                            subscription: 'sub_1',
                        },
                    },
                    amount_paid: 27000,
                    total: 27000,
                    currency: 'eur',
                },
            },
        });
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                id: 'ip_renewal',
                status: 'paid',
                is_default: true,
                invoice: 'in_renewal',
                payment: {
                    type: 'payment_intent',
                    payment_intent: 'pi_renewal',
                },
            }],
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(renewalSupabase.renewalRpc).toHaveBeenCalledWith('apply_subscription_renewal', expect.objectContaining({
            p_stripe_invoice_id: 'in_renewal',
        }));
        expect(renewalSupabase.paymentInsert).not.toHaveBeenCalled();
        expect(renewalSupabase.paymentUpdate).toHaveBeenCalledWith({
            description: '3-month renewal',
        });
    });

    it('uses the charge-filtered Refunds API when the Dahlia charge expansion is empty', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [stripeRefund()],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.refundList).toHaveBeenCalledWith({
            charge: 'ch_1',
            limit: 100,
        });
        expect(refundSupabase.refundRpc).toHaveBeenCalledWith('reconcile_stripe_refund', {
            p_payment_id: 'payment-1',
            p_amount_refunded: 3000,
            p_stripe_refund_id: 're_1',
            p_refunded_at: '2026-07-10T10:00:00.000Z',
        });
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(
            refundSupabase.client,
            expect.objectContaining({
                profileId: 'student-1',
                subject: 'Reembolso parcial',
                metadata: expect.objectContaining({ amount_refunded: 3000, status: 'partially_refunded' }),
            }),
        );
        expect(refundSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
        }));
    });

    it('paginates beyond a partial expansion and resolves the second cumulative refund', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent({
            amount_refunded: 5000,
            refunds: { data: [{ id: 're_second', created: 1783677660 }] },
        }));
        stripeMocks.refundList
            .mockResolvedValueOnce({
                data: [stripeRefund({
                    id: 're_second',
                    amount: 3000,
                    created: 1783677660,
                })],
                has_more: true,
            })
            .mockResolvedValueOnce({
                data: [stripeRefund({
                    id: 're_first',
                    amount: 2000,
                    created: 1783677600,
                })],
                has_more: false,
            });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.refundList).toHaveBeenNthCalledWith(2, {
            charge: 'ch_1',
            limit: 100,
            starting_after: 're_second',
        });
        expect(refundSupabase.refundRpc).toHaveBeenCalledWith('reconcile_stripe_refund', {
            p_payment_id: 'payment-1',
            p_amount_refunded: 5000,
            p_stripe_refund_id: 're_second',
            p_refunded_at: '2026-07-10T10:01:00.000Z',
        });
    });

    it('orders same-second refunds by identifier before selecting the cumulative prefix', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent({ amount_refunded: 12000 }));
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [
                stripeRefund({ id: 're_z', amount: 9000 }),
                stripeRefund({ id: 're_a', amount: 3000 }),
            ],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(refundSupabase.refundRpc).toHaveBeenCalledWith(
            'reconcile_stripe_refund',
            expect.objectContaining({
                p_amount_refunded: 12000,
                p_stripe_refund_id: 're_z',
            }),
        );
    });

    it('fails closed when the cumulative amount lands inside a same-second refund cohort', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [
                stripeRefund({ id: 're_z', amount: 9000 }),
                stripeRefund({ id: 're_a', amount: 3000 }),
            ],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(refundSupabase.refundRpc).not.toHaveBeenCalled();
        expect(refundSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
        }));
    });

    it('excludes non-succeeded refunds from the authoritative cumulative amount', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [
                stripeRefund({ id: 're_pending', amount: 9000, status: 'pending' }),
                stripeRefund({ id: 're_succeeded' }),
            ],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(refundSupabase.refundRpc).toHaveBeenCalledWith(
            'reconcile_stripe_refund',
            expect.objectContaining({ p_stripe_refund_id: 're_succeeded' }),
        );
    });

    it('synchronizes a full refund through the InvoicePayment invoice fallback', async () => {
        const refundSupabase = makeRefundSupabase(false);
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent({
            id: 'ch_full_1',
            payment_intent: 'pi_legacy',
            amount_refunded: 12000,
            refunds: { data: [{ id: 're_full_1', created: 1783677600 }] },
        }));
        stripeMocks.invoicePaymentList.mockResolvedValueOnce({
            data: [{
                id: 'ip_legacy',
                status: 'paid',
                is_default: true,
                invoice: 'in_legacy',
                payment: {
                    type: 'payment_intent',
                    payment_intent: 'pi_legacy',
                },
            }],
        });
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [stripeRefund({
                id: 're_full_1',
                amount: 12000,
                charge: 'ch_full_1',
                payment_intent: 'pi_legacy',
            })],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(refundSupabase.paymentLookups[0].eq).toHaveBeenCalledWith(
            'stripe_payment_intent_id',
            'pi_legacy'
        );
        expect(stripeMocks.invoicePaymentList).toHaveBeenCalledWith({
            status: 'paid',
            payment: {
                type: 'payment_intent',
                payment_intent: 'pi_legacy',
            },
        });
        expect(refundSupabase.paymentLookups[1].eq).toHaveBeenCalledWith(
            'stripe_invoice_id',
            'in_legacy'
        );
        expect(refundSupabase.refundRpc).toHaveBeenCalledWith('reconcile_stripe_refund', {
            p_payment_id: 'payment-1',
            p_amount_refunded: 12000,
            p_stripe_refund_id: 're_full_1',
            p_refunded_at: '2026-07-10T10:00:00.000Z',
        });
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(
            refundSupabase.client,
            expect.objectContaining({
                profileId: 'student-1',
                subject: 'Pago reembolsado',
                metadata: expect.objectContaining({ amount_refunded: 12000, status: 'refunded' }),
            }),
        );
    });

    it.each([
        ['currency', { currency: 'usd' }],
        ['charge', { charge: 'ch_other' }],
        ['PaymentIntent', { payment_intent: 'pi_other' }],
    ])('fails closed when the authoritative refund has an incompatible %s', async (_field, overrides) => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [stripeRefund(overrides)],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(refundSupabase.refundRpc).not.toHaveBeenCalled();
        expect(refundSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
        }));
    });

    it('fails closed when the refunded charge mode differs from the verified runtime', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent({ livemode: true }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(stripeMocks.refundList).not.toHaveBeenCalled();
        expect(refundSupabase.refundRpc).not.toHaveBeenCalled();
    });

    it('fails closed when succeeded refunds have no exact cumulative match', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        stripeMocks.refundList.mockResolvedValueOnce({
            data: [stripeRefund({ amount: 2999 })],
            has_more: false,
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(refundSupabase.refundRpc).not.toHaveBeenCalled();
    });

    it('fails closed when bounded pagination returns a duplicate refund identifier', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        stripeMocks.refundList
            .mockResolvedValueOnce({
                data: [stripeRefund()],
                has_more: true,
            })
            .mockResolvedValueOnce({
                data: [stripeRefund()],
                has_more: false,
            });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(500);
        expect(refundSupabase.refundRpc).not.toHaveBeenCalled();
    });

    it('keeps refund reconciliation idempotent when the webhook event was already processed', async () => {
        const duplicate = makeDuplicateSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(duplicate.client);
        stripeMocks.constructEventAsync.mockResolvedValue(refundEvent());
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.refundList).not.toHaveBeenCalled();
        expect(crmMocks.recordCrmActivityForProfileSafe).not.toHaveBeenCalled();
    });
});
