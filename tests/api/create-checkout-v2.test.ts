import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMock = vi.hoisted(() => ({
    accounts: { retrieve: vi.fn() },
    prices: { retrieve: vi.fn() },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), list: vi.fn() } },
    customers: {
        create: vi.fn(),
        retrieve: vi.fn(),
        retrieveCashBalance: vi.fn(),
    },
}));
const privateProfileMock = vi.hoisted(() => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));
const customerMock = vi.hoisted(() => ({ validatedStripeCustomerId: vi.fn() }));
const runtimeEnvMock = vi.hoisted(() => ({
    readRuntimeEnv: vi.fn((key: string): string | undefined => {
        if (key === 'CHECKOUT_ENABLED') return 'true';
        if (key === 'PUBLIC_APP_ENV') return 'staging';
        if (key === 'STRIPE_EXPECTED_ACCOUNT_ID') return 'acct_test';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_example';
        return undefined;
    }),
}));

vi.mock('../../src/lib/stripe', () => ({ stripe: stripeMock }));
vi.mock('../../src/lib/profiles-private', () => privateProfileMock);
vi.mock('../../src/lib/stripe-customer', () => customerMock);
vi.mock('../../src/lib/runtime-env', () => runtimeEnvMock);
vi.mock('../../src/lib/site-url', () => ({ getSiteUrl: vi.fn(() => 'https://staging.example.test') }));
vi.mock('../../src/lib/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('../../src/lib/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }));

const slotPublicId = '10000000-0000-4000-8000-000000000001';
const slotId = '20000000-0000-4000-8000-000000000001';
const packageId = '30000000-0000-4000-8000-000000000001';
const packagePriceId = '40000000-0000-4000-8000-000000000001';
const checkoutIntentId = '50000000-0000-4000-8000-000000000001';
const opportunityId = '60000000-0000-4000-8000-000000000001';
const firstClassAt = '2099-08-01T16:00:00.000Z';
const renewalAnchorAt = '2099-08-29T16:00:00.000Z';

const slot = {
    id: slotId,
    public_id: slotPublicId,
    package_id: packageId,
    teacher_id: '70000000-0000-4000-8000-000000000001',
    status: 'available',
    contract_schema_version: 2,
    first_occurrence_at: firstClassAt,
    timezone_name: 'Europe/Madrid',
    weekday: 1,
    local_start_time: '18:00:00',
    published_at: '2099-07-01T10:00:00.000Z',
    sold_subscription_id: null,
};
const packageRow = {
    id: packageId,
    name: 'individual_4x50_28d',
    catalog_version: 2,
    is_active: true,
    is_publicly_listed: true,
    contract_schema_version: 2,
    amount_cents: 25900,
    billing_interval_unit: 'day',
    billing_interval_count: 28,
    sessions_per_period: 4,
    class_duration_minutes: 50,
};
const packagePrice = {
    id: packagePriceId,
    package_id: packageId,
    package_key: 'individual_4x50_28d',
    catalog_version: 2,
    status: 'active',
    contract_schema_version: 2,
    amount_cents: 25900,
    currency: 'eur',
    billing_interval_unit: 'day',
    billing_interval_count: 28,
    sessions_per_period: 4,
    class_duration_minutes: 50,
    stripe_account_id: 'acct_test',
    stripe_livemode: false,
    stripe_product_id: 'prod_v2',
    stripe_price_id: 'price_recurring_28d',
};
const priceSnapshot = {
    package_price_id: packagePriceId,
    initial_stripe_price_id: 'price_initial_259',
    recurring_stripe_price_id: 'price_recurring_28d',
    initial_amount_cents: 25900,
    recurring_amount_cents: 25900,
    currency: 'eur',
    recurring_interval_unit: 'day',
    recurring_interval_count: 28,
    stripe_account_id: 'acct_test',
    stripe_livemode: false,
};
const checkoutIntent = {
    id: checkoutIntentId,
    opportunity_id: opportunityId,
    contact_id: '80000000-0000-4000-8000-000000000001',
    student_id: 'student-1',
    package_price_id: packagePriceId,
    lang: 'en',
    legal_policy_version: '2026-07-31',
    policy_accepted_at: '2099-07-01T12:00:00.000Z',
    site_url: 'https://staging.example.test',
    status: 'creating',
    stripe_checkout_session_id: null,
    stripe_customer_id: null,
    stripe_session_expires_at: '2099-07-31T12:00:00.000Z',
    expires_at: '2099-07-31T12:05:00.000Z',
    completed_at: null,
    created_at: '2099-07-01T12:00:00.000Z',
    updated_at: '2099-07-01T12:00:00.000Z',
};
const policies = {
    adultConfirmed: true,
    termsAccepted: true,
    serviceStartRequested: true,
    withdrawalLossAcknowledged: true,
};

function query(result: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
}

function createdSession(params: Record<string, any>, overrides: Record<string, unknown> = {}) {
    return {
        id: 'cs_test_v2',
        status: 'open',
        mode: 'subscription',
        livemode: false,
        customer: params.customer,
        client_reference_id: params.client_reference_id,
        amount_subtotal: 25900,
        amount_total: 25900,
        currency: 'eur',
        discounts: [],
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        allow_promotion_codes: false,
        adaptive_pricing: { enabled: false },
        automatic_tax: { enabled: false },
        payment_method_types: ['card'],
        metadata: params.metadata,
        line_items: {
            data: params.line_items.map((item: { price: string; quantity: number }) => ({
                quantity: item.quantity,
                price: { id: item.price },
            })),
        },
        url: 'https://checkout.stripe.test/v2',
        ...overrides,
    };
}

function makeClients() {
    const profileQuery = query({ data: { id: 'student-1', role: 'student', full_name: 'Test Student' }, error: null });
    const subscriptionQuery = query({ data: null, error: null });
    const server = {
        auth: { getUser: vi.fn().mockResolvedValue({
            data: { user: { id: 'student-1', email: 'student@example.com', email_confirmed_at: '2026-08-01T10:00:00Z' } },
            error: null,
        }) },
        from: vi.fn((table: string) => {
            if (table === 'profiles') return profileQuery;
            if (table === 'subscriptions') return subscriptionQuery;
            throw new Error(`Unexpected server table ${table}`);
        }),
    };
    const slotQuery = query({ data: slot, error: null });
    const packageQuery = query({ data: packageRow, error: null });
    const packagePriceQuery = query({ data: packagePrice, error: null });
    const snapshotQuery = query({ data: priceSnapshot, error: null });
    const intentQuery = query({ data: { id: checkoutIntentId }, error: null });
    const admin = {
        rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
            if (name === 'claim_direct_checkout_intent_for_slot') return { data: checkoutIntent, error: null };
            if (name === 'snapshot_checkout_intent_customer') {
                return { data: { ...checkoutIntent, stripe_customer_id: args.p_stripe_customer_id }, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        }),
        from: vi.fn((table: string) => {
            if (table === 'bookable_slots') return slotQuery;
            if (table === 'packages') return packageQuery;
            if (table === 'package_prices') return packagePriceQuery;
            if (table === 'checkout_v2_price_snapshots') return snapshotQuery;
            if (table === 'checkout_intents') return intentQuery;
            throw new Error(`Unexpected admin table ${table}`);
        }),
    };
    return { server, admin };
}

function context(body: Record<string, unknown>) {
    return {
        request: { json: vi.fn().mockResolvedValue(body), url: 'https://staging.example.test/api/create-checkout' },
        cookies: { set: vi.fn(), get: vi.fn() },
        locals: {},
    };
}

async function installClients(server: unknown, admin: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
    vi.mocked(createSupabaseServerClient).mockReturnValue(server as any);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
}

describe('Checkout contract v2', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.resetModules();
        customerMock.validatedStripeCustomerId.mockResolvedValue('cus_v2');
        privateProfileMock.getPrivateProfile.mockResolvedValue({
            stripe_customer_id: 'cus_v2',
            stripe_customer_account_id: 'acct_test',
            stripe_customer_livemode: false,
        });
        privateProfileMock.upsertPrivateProfile.mockResolvedValue(undefined);
        stripeMock.accounts.retrieve.mockResolvedValue({ id: 'acct_test', country: 'ES' });
        stripeMock.prices.retrieve
            .mockResolvedValueOnce({
                id: 'price_initial_259', active: true, type: 'one_time', recurring: null,
                unit_amount: 25900, currency: 'eur', livemode: false, product: 'prod_v2',
            })
            .mockResolvedValueOnce({
                id: 'price_recurring_28d', active: true, type: 'recurring',
                recurring: { interval: 'day', interval_count: 28 }, unit_amount: 25900,
                currency: 'eur', livemode: false, product: 'prod_v2',
            });
        stripeMock.customers.retrieve.mockResolvedValue({
            id: 'cus_v2', deleted: false, livemode: false, balance: 0, invoice_credit_balance: {},
        });
        stripeMock.customers.retrieveCashBalance.mockResolvedValue({
            customer: 'cus_v2', livemode: false, available: {},
        });
        stripeMock.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false });
        stripeMock.checkout.sessions.create.mockImplementation(async (params) => createdSession(params));
    });

    it('resolves the offer server-side and creates exactly one initial charge plus the future 28-day subscription', async () => {
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.test/v2' });
        expect(admin.rpc).toHaveBeenCalledWith('claim_direct_checkout_intent_for_slot', {
            p_student_id: 'student-1',
            p_primary_email: 'student@example.com',
            p_full_name: 'Test Student',
            p_package_price_id: packagePriceId,
            p_lang: 'en',
            p_legal_policy_version: '2026-07-31',
            p_site_url: 'https://staging.example.test',
            p_slot_public_id: slotPublicId,
        });
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'subscription',
            customer: 'cus_v2',
            line_items: [
                { price: 'price_initial_259', quantity: 1 },
                { price: 'price_recurring_28d', quantity: 1 },
            ],
            allow_promotion_codes: false,
            adaptive_pricing: { enabled: false },
            automatic_tax: { enabled: false },
            subscription_data: expect.objectContaining({
                proration_behavior: 'none',
                trial_end: Math.floor(Date.parse(renewalAnchorAt) / 1000),
                metadata: expect.objectContaining({
                    contractSchemaVersion: '2',
                    slotPublicId,
                    firstClassAt,
                    renewalAnchorAt,
                    initialPriceId: 'price_initial_259',
                    recurringPriceId: 'price_recurring_28d',
                }),
            }),
        }), { idempotencyKey: `checkout-intent:${checkoutIntentId}` });
    });

    it('does not trust a client price and requires the public slot identifier', async () => {
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, priceId: 'price_initial_259' }) as any);

        expect(response.status).toBe(400);
        expect(admin.from).not.toHaveBeenCalled();
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    });

    it('fails before reserving the slot when either remote Stripe Price contradicts the snapshot', async () => {
        stripeMock.prices.retrieve
            .mockReset()
            .mockResolvedValueOnce({
                id: 'price_initial_259', active: true, type: 'one_time', recurring: null,
                unit_amount: 25900, currency: 'eur', livemode: false, product: 'prod_v2',
            })
            .mockResolvedValueOnce({
                id: 'price_recurring_28d', active: true, type: 'recurring',
                recurring: { interval: 'month', interval_count: 1 }, unit_amount: 25900,
                currency: 'eur', livemode: false, product: 'prod_v2',
            });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        expect(response.status).toBe(409);
        expect(admin.rpc).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });
});
