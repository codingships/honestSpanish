import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    constructEvent: vi.fn(),
    subscriptionRetrieve: vi.fn(),
    invoicePaymentList: vi.fn(),
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

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        webhooks: {
            constructEvent: stripeMocks.constructEvent,
        },
        subscriptions: {
            retrieve: stripeMocks.subscriptionRetrieve,
        },
        invoicePayments: {
            list: stripeMocks.invoicePaymentList,
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
                    userId: 'student-1',
                    priceId: 'price_1m',
                    legalPolicyVersion: '2026-07-10',
                    termsAcceptedAt: '2026-07-10T10:00:00.000Z',
                },
                created: 1783677600,
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

function makeCheckoutSupabase() {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const processedUpdate = vi.fn().mockReturnValue({ eq: processedUpdateEq });
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
                data: {
                    id: 'local-subscription-1',
                    student_id: 'student-1',
                    package_id: 'package-1',
                    starts_at: '2026-07-10',
                    ends_at: '2026-08-10',
                    sessions_total: 4,
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
        if (table === 'packages') return { select: packagesSelect };
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
        client: { from },
        processedInsert,
        processedUpdate,
        processedUpdateEq,
        packagesSelect,
        subscriptionLookup,
        subscriptionInsert,
        paymentLookup,
        paymentInsert,
        paymentUpdate,
        paymentUpdateEq,
        paymentSelect,
        paymentSingle,
        welcomeJobLookup,
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

    const markSucceededEq = vi.fn().mockResolvedValue({ error: null });
    const processedUpdate = vi.fn((payload: { processing_status?: string; created_at?: string }) => (
        payload.processing_status === 'processing' && payload.created_at
            ? reclaim
            : { eq: markSucceededEq }
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
        client: { from },
        processedInsert,
        processedUpdate,
        reclaim,
        markSucceededEq,
    };
}

function makeRefundSupabase(directPaymentIntentMatch = true) {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const processedUpdate = vi.fn().mockReturnValue({ eq: processedUpdateEq });
    const payment = {
        id: 'payment-1',
        student_id: 'student-1',
        subscription_id: 'subscription-1',
        amount: 12000,
        amount_refunded: 0,
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
        client: { from },
        processedUpdate,
        paymentLookups,
        paymentUpdate,
        paymentUpdateEq,
    };
}

function makeRenewalSupabase() {
    const processedInsert = vi.fn().mockResolvedValue({ error: null });
    const processedUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const processedUpdate = vi.fn().mockReturnValue({ eq: processedUpdateEq });

    const subscriptionLookup: any = {};
    subscriptionLookup.select = vi.fn(() => subscriptionLookup);
    subscriptionLookup.eq = vi.fn(() => subscriptionLookup);
    subscriptionLookup.order = vi.fn(() => subscriptionLookup);
    subscriptionLookup.limit = vi.fn(() => subscriptionLookup);
    subscriptionLookup.maybeSingle = vi.fn().mockResolvedValue({
        data: {
            id: 'local-subscription-1',
            student_id: 'student-1',
            package_id: 'package-1',
            sessions_total: 12,
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

    const packageSingle = vi.fn().mockResolvedValue({
        data: { sessions_per_month: 4 },
        error: null,
    });
    const packageEq = vi.fn().mockReturnValue({ single: packageSingle });
    const packageSelect = vi.fn().mockReturnValue({ eq: packageEq });

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
        if (table === 'packages') return { select: packageSelect };
        if (table === 'payments') {
            paymentCalls += 1;
            return paymentCalls === 1
                ? paymentLookup
                : { insert: paymentInsert, update: paymentUpdate };
        }
        throw new Error(`Unexpected table ${table}`);
    });

    return {
        client: { from },
        processedUpdate,
        subscriptionLookup,
        subscriptionUpdate,
        subscriptionUpdateEq,
        paymentInsert,
        paymentLookup,
        paymentUpdate,
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
            status: 'active',
            cancel_at_period_end: false,
            metadata: {
                userId: 'student-1',
                priceId: 'price_1m',
            },
            items: {
                data: [{
                    current_period_end: Math.floor(Date.parse('2099-11-10T00:00:00.000Z') / 1000),
                    price: {
                        recurring: { interval: 'month', interval_count: 3 },
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
        stripeMocks.constructEvent.mockImplementation(() => {
            throw new Error('Firma Invalida');
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toContain('Webhook Error');
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
        stripeMocks.constructEvent.mockReturnValue({
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

    it('atomically reclaims a failed event and resumes idempotently from existing side effects', async () => {
        const retry = makeRetryableCheckoutSupabase('failed', '2026-07-10T09:00:00.000Z');
        retry.subscriptionLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'local-subscription-1',
                student_id: 'student-1',
                package_id: 'package-1',
                starts_at: '2026-07-09',
                ends_at: '2026-08-09',
                sessions_total: 4,
            },
            error: null,
        });
        retry.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: { id: 'payment-1' },
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
        expect(retry.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
            stripe_invoice_id: 'in_1',
            stripe_payment_intent_id: 'pi_1',
        }));
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
        stripeMocks.constructEvent.mockReturnValue(checkoutEvent({
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
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'succeeded',
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
        expect(stripeMocks.invoicePaymentList).toHaveBeenCalledWith({
            invoice: 'in_1',
            status: 'paid',
        });
        expect(checkoutSupabase.paymentSelect).toHaveBeenCalledWith('id');
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(checkoutSupabase.client, expect.objectContaining({
            profileId: 'student-1',
            lifecycleStage: 'customer',
            activityType: 'payment',
            subject: 'Pago inicial recibido',
            relatedEntityType: 'payment',
            relatedEntityId: 'payment-1',
        }));
        expect(fulfillmentMocks.enqueueWelcomeFulfillment).toHaveBeenCalledWith(checkoutSupabase.client, {
            userId: 'student-1',
            packageId: 'package-1',
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

    it('marks a claimed event failed when checkout processing throws', async () => {
        const checkoutSupabase = makeCheckoutSupabase();
        checkoutSupabase.packagesSelect.mockResolvedValueOnce({ data: null, error: { message: 'db unavailable' } });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(checkoutSupabase.client);
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);
        const body = await readJson(response);

        expect(response.status).toBe(500);
        expect(body.error).toBe('Webhook processing failed');
        expect(checkoutSupabase.processedUpdate).toHaveBeenCalledWith(expect.objectContaining({
            processing_status: 'failed',
            processing_error: expect.stringContaining('Package lookup failed'),
        }));
    });

    it('records a paid renewal using the InvoicePayment PaymentIntent mapping', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.constructEvent.mockReturnValue({
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
                            metadata: { userId: 'student-1' },
                            subscription: 'sub_1',
                        },
                    },
                    amount_paid: 27000,
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
        expect(renewalSupabase.subscriptionUpdate).toHaveBeenCalledWith({
            ends_at: '2099-11-10',
            sessions_total: 12,
            sessions_used: 0,
            status: 'active',
            stripe_subscription_id: 'sub_1',
            stripe_invoice_id: 'in_renewal',
        });
        expect(renewalSupabase.subscriptionUpdateEq).toHaveBeenCalledWith('id', 'local-subscription-1');
        expect(renewalSupabase.paymentInsert).toHaveBeenCalledWith(expect.objectContaining({
            student_id: 'student-1',
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

    it('enqueues one durable renewal notice from invoice.upcoming without requiring an invoice ID', async () => {
        const renewalSupabase = makeRenewalSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        const invoicePeriodEnd = Math.floor(Date.parse('2099-08-10T00:00:00.000Z') / 1000);
        stripeMocks.constructEvent.mockReturnValue({
            id: 'evt_invoice_upcoming_1',
            type: 'invoice.upcoming',
            data: {
                object: {
                    parent: {
                        type: 'subscription_details',
                        subscription_details: {
                            metadata: { userId: 'student-1' },
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
                userId: 'student-1',
                packageId: 'package-1',
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
            metadata: { userId: 'student-1' },
            items: { data: [] },
        });
        stripeMocks.constructEvent.mockReturnValue({
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
        expect(renewalSupabase.subscriptionLookup.maybeSingle).not.toHaveBeenCalled();
    });

    it('does not reset quota when retrying a renewal invoice that was already applied', async () => {
        const renewalSupabase = makeRenewalSupabase();
        renewalSupabase.subscriptionLookup.maybeSingle.mockResolvedValueOnce({
            data: {
                id: 'local-subscription-1',
                student_id: 'student-1',
                package_id: 'package-1',
                sessions_total: 12,
                duration_months: 3,
                ends_at: '2099-11-10',
                status: 'active',
                stripe_subscription_id: 'sub_1',
                stripe_invoice_id: 'in_renewal',
            },
            error: null,
        });
        renewalSupabase.paymentLookup.maybeSingle.mockResolvedValueOnce({
            data: { id: 'renewal-payment-1' },
            error: null,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(renewalSupabase.client);
        stripeMocks.constructEvent.mockReturnValue({
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
                            metadata: { userId: 'student-1' },
                            subscription: 'sub_1',
                        },
                    },
                    amount_paid: 27000,
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
        expect(renewalSupabase.subscriptionUpdate).not.toHaveBeenCalled();
        expect(renewalSupabase.paymentInsert).not.toHaveBeenCalled();
        expect(renewalSupabase.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({
            stripe_invoice_id: 'in_renewal',
            stripe_payment_intent_id: 'pi_renewal',
            status: 'succeeded',
        }));
    });

    it('synchronizes partial Stripe refunds without marking the whole payment refunded', async () => {
        const refundSupabase = makeRefundSupabase();
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEvent.mockReturnValue({
            id: 'evt_refund_1',
            type: 'charge.refunded',
            data: {
                object: {
                    id: 'ch_1',
                    payment_intent: 'pi_1',
                    amount: 12000,
                    amount_refunded: 3000,
                    refunds: { data: [{ id: 're_1', created: 1783677600 }] },
                },
            },
        });
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        const response = await POST(webhookContext() as any);

        expect(response.status).toBe(200);
        expect(refundSupabase.paymentUpdate).toHaveBeenCalledWith({
            amount_refunded: 3000,
            stripe_refund_id: 're_1',
            refunded_at: '2026-07-10T10:00:00.000Z',
            status: 'succeeded',
        });
        expect(refundSupabase.paymentUpdateEq).toHaveBeenCalledWith('id', 'payment-1');
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

    it('synchronizes a full refund through the InvoicePayment invoice fallback', async () => {
        const refundSupabase = makeRefundSupabase(false);
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(refundSupabase.client);
        stripeMocks.constructEvent.mockReturnValue({
            id: 'evt_refund_full_1',
            type: 'charge.refunded',
            data: {
                object: {
                    id: 'ch_full_1',
                    payment_intent: 'pi_legacy',
                    amount: 12000,
                    amount_refunded: 12000,
                    refunds: { data: [{ id: 're_full_1', created: 1783677600 }] },
                },
            },
        });
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
        expect(refundSupabase.paymentUpdate).toHaveBeenCalledWith({
            amount_refunded: 12000,
            stripe_refund_id: 're_full_1',
            refunded_at: '2026-07-10T10:00:00.000Z',
            status: 'refunded',
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
});
