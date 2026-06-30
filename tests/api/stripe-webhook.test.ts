import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    constructEvent: vi.fn(),
    subscriptionRetrieve: vi.fn(),
}));

const supabaseMocks = vi.hoisted(() => ({
    createSupabaseAdminClient: vi.fn(),
}));

const fulfillmentMocks = vi.hoisted(() => ({
    enqueueWelcomeFulfillment: vi.fn(),
    triggerFulfillmentProcessing: vi.fn(),
}));

const crmMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn().mockResolvedValue({ status: 'created' }),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        webhooks: {
            constructEvent: stripeMocks.constructEvent,
        },
        subscriptions: {
            retrieve: stripeMocks.subscriptionRetrieve,
        },
    },
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: supabaseMocks.createSupabaseAdminClient,
}));

vi.mock('../../src/lib/fulfillment/queue', () => ({
    enqueueWelcomeFulfillment: fulfillmentMocks.enqueueWelcomeFulfillment,
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
                    userId: 'student-1',
                    priceId: 'price_1m',
                },
                subscription: 'sub_1',
                invoice: 'in_1',
                amount_total: 12000,
                currency: 'eur',
                payment_intent: 'pi_1',
                ...overrides,
            },
        },
    };
}

function makeDuplicateSupabase() {
    const processedInsert = vi.fn().mockResolvedValue({
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });
    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') return { insert: processedInsert };
        throw new Error(`Unexpected table ${table}`);
    });
    return { client: { from }, processedInsert };
}

function makeCheckoutSupabase() {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const packagesSelect = vi.fn().mockResolvedValue({
        data: [{
            id: 'package-1',
            name: 'standard',
            sessions_per_month: 4,
            stripe_price_1m: 'price_1m',
            stripe_price_3m: 'price_3m',
            stripe_price_6m: 'price_6m',
        }],
        error: null,
    });
    const subscriptionInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
                data: { id: 'local-subscription-1' },
                error: null,
            }),
        }),
    });
    const subscriptionUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const subscriptionUpdate = vi.fn().mockReturnValue({ eq: subscriptionUpdateEq });
    const paymentSingle = vi.fn().mockResolvedValue({ data: { id: 'payment-1' }, error: null });
    const paymentSelect = vi.fn().mockReturnValue({ single: paymentSingle });
    const paymentInsert = vi.fn().mockReturnValue({ select: paymentSelect });
    let subscriptionFromCalls = 0;

    const from = vi.fn((table: string) => {
        if (table === 'processed_webhook_events') return { insert: processedInsert };
        if (table === 'packages') return { select: packagesSelect };
        if (table === 'payments') return { insert: paymentInsert };
        if (table === 'subscriptions') {
            subscriptionFromCalls += 1;
            return subscriptionFromCalls === 1
                ? { insert: subscriptionInsert }
                : { update: subscriptionUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        client: { from },
        processedInsert,
        packagesSelect,
        subscriptionInsert,
        subscriptionUpdate,
        subscriptionUpdateEq,
        paymentInsert,
        paymentSelect,
        paymentSingle,
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('POST /api/stripe-webhook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test_secret_key_123');
        stripeMocks.constructEvent.mockReturnValue(checkoutEvent());
        stripeMocks.subscriptionRetrieve.mockResolvedValue({
            metadata: {
                userId: 'student-1',
                priceId: 'price_1m',
            },
        });
        fulfillmentMocks.enqueueWelcomeFulfillment.mockResolvedValue(true);
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
        stripeMocks.constructEvent.mockImplementation(() => {
            throw new Error('Firma Invalida');
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toContain('Webhook Error');
    });

    it('acknowledges duplicate events without running payment handlers again', async () => {
        const { client, processedInsert } = makeDuplicateSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.received).toBe(true);
        expect(processedInsert).toHaveBeenCalledWith({
            stripe_event_id: 'evt_checkout_1',
            event_type: 'checkout.session.completed',
        });
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
        expect(fulfillmentMocks.enqueueWelcomeFulfillment).not.toHaveBeenCalled();
    });

    it('ignores malformed checkout price metadata before package lookup', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        stripeMocks.constructEvent.mockReturnValue(checkoutEvent({
            metadata: {
                userId: 'student-1',
                priceId: 'not-a-price-id',
            },
            subscription: null,
        }));
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(checkoutSupabase.packagesSelect).not.toHaveBeenCalled();
        expect(checkoutSupabase.subscriptionInsert).not.toHaveBeenCalled();
        expect(checkoutSupabase.paymentInsert).not.toHaveBeenCalled();
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
            student_id: 'student-1',
            package_id: 'package-1',
            duration_months: 1,
            sessions_total: 4,
            stripe_subscription_id: 'sub_1',
            stripe_invoice_id: 'in_1',
        }));
        expect(checkoutSupabase.paymentInsert).toHaveBeenCalledWith(expect.objectContaining({
            student_id: 'student-1',
            subscription_id: 'local-subscription-1',
            amount: 12000,
            status: 'succeeded',
            stripe_invoice_id: 'in_1',
            stripe_payment_intent_id: 'pi_1',
        }));
        expect(checkoutSupabase.paymentSelect).toHaveBeenCalledWith('id');
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(checkoutSupabase.client, expect.objectContaining({
            profileId: 'student-1',
            lifecycleStage: 'customer',
            activityType: 'payment',
            subject: 'Pago inicial recibido',
            relatedEntityType: 'payment',
            relatedEntityId: 'payment-1',
        }));
        expect(checkoutSupabase.subscriptionUpdate).toHaveBeenCalledWith({
            stripe_subscription_id: 'sub_1',
        });
        expect(checkoutSupabase.subscriptionUpdateEq).toHaveBeenCalledWith('id', 'local-subscription-1');
        expect(fulfillmentMocks.enqueueWelcomeFulfillment).toHaveBeenCalledWith(checkoutSupabase.client, {
            userId: 'student-1',
            packageId: 'package-1',
            subscriptionId: 'local-subscription-1',
        });
        expect(fulfillmentMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(expect.any(Object), 5);
    });
});
