import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
        if (key === 'PUBLIC_SITE_URL') return 'https://staging.example.test';
        if (key === 'PUBLIC_TURNSTILE_SITE_KEY') return 'real-staging-site-key';
        if (key === 'TURNSTILE_SECRET_KEY') return 'turnstile-test-secret';
        if (key === 'CHECKOUT_HOLD_FINGERPRINT_SECRET') return '0123456789abcdef0123456789abcdef';
        if (key === 'STRIPE_EXPECTED_ACCOUNT_ID') return 'acct_test';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_example';
        return undefined;
    }),
}));
const turnstileFetchMock = vi.hoisted(() => vi.fn());

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

function expiredConflictIntent(input: {
    id: string;
    customerId: string;
    studentId?: string;
}) {
    return {
        ...checkoutIntent,
        id: input.id,
        student_id: input.studentId ?? `student-${input.id.slice(-1)}`,
        stripe_customer_id: input.customerId,
        expires_at: '2020-01-01T02:00:00.000Z',
        stripe_session_expires_at: '2020-01-01T01:00:00.000Z',
    };
}

function expiredConflictHold(input: {
    id: string;
    intent: ReturnType<typeof expiredConflictIntent>;
    slotId: string;
    fingerprintCharacter: string;
}) {
    return {
        id: input.id,
        checkout_intent_id: input.intent.id,
        slot_id: input.slotId,
        status: 'held',
        expires_at: input.intent.expires_at,
        hold_fingerprint: `v1:${input.fingerprintCharacter.repeat(64)}`,
    };
}

const policies = {
    adultConfirmed: true,
    termsAccepted: true,
    serviceStartRequested: true,
    withdrawalLossAcknowledged: true,
    'cf-turnstile-response': 'turnstile-token',
};

function query(result: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
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
        rpc: vi.fn(async (
            name: string,
            args: Record<string, unknown>,
        ): Promise<{ data: unknown; error: unknown }> => {
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
        clientAddress: '203.0.113.10',
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

async function expectCheckoutError(
    response: Response,
    status: 403 | 409,
    error: string,
    errorCode: string,
) {
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error, errorCode });
}

describe('Checkout contract v2', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.resetModules();
        vi.stubGlobal('fetch', turnstileFetchMock);
        turnstileFetchMock.mockResolvedValue(new Response(JSON.stringify({
            success: true,
            action: 'checkout_hold',
            hostname: 'staging.example.test',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
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

    afterEach(() => {
        vi.unstubAllGlobals();
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
            p_hold_fingerprint: expect.stringMatching(/^v1:[0-9a-f]{64}$/u),
        });
        const claim = admin.rpc.mock.calls.find(([name]) => name === 'claim_direct_checkout_intent_for_slot');
        expect(JSON.stringify(claim?.[1])).not.toContain('203.0.113.10');
        const siteverifyRequest = turnstileFetchMock.mock.calls[0]?.[1];
        expect(turnstileFetchMock.mock.calls[0]?.[0]).toBe(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        );
        expect(siteverifyRequest?.method).toBe('POST');
        expect(siteverifyRequest?.body).toBeInstanceOf(URLSearchParams);
        expect((siteverifyRequest?.body as URLSearchParams).get('secret')).toBe('turnstile-test-secret');
        expect((siteverifyRequest?.body as URLSearchParams).get('remoteip')).toBe('203.0.113.10');
        expect((siteverifyRequest?.body as URLSearchParams).get('response')).toBe('turnstile-token');
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

    it('returns a stable code when the authenticated account is not eligible', async () => {
        const { server, admin } = makeClients();
        server.auth.getUser.mockResolvedValue({
            data: { user: { id: 'student-1', email: 'student@example.com', email_confirmed_at: null } },
            error: null,
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        await expectCheckoutError(
            response,
            403,
            'A confirmed email is required before payment',
            'ACCOUNT_NOT_ELIGIBLE',
        );
        expect(admin.from).not.toHaveBeenCalled();
    });

    it('returns a stable code for an active subscription', async () => {
        const active = makeClients();
        const activeServerFrom = active.server.from.getMockImplementation()!;
        active.server.from.mockImplementation((table: string) => (
            table === 'subscriptions'
                ? query({ data: { id: 'subscription-active' }, error: null })
                : activeServerFrom(table)
        ));
        await installClients(active.server, active.admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const activeResponse = await POST(context({ ...policies, slotPublicId }) as any);
        await expectCheckoutError(
            activeResponse,
            409,
            'Ya tienes una suscripción activa o pendiente',
            'ACTIVE_SUBSCRIPTION',
        );

    });

    it('returns a different stable code for an unavailable slot', async () => {
        const unavailable = makeClients();
        const unavailableAdminFrom = unavailable.admin.from.getMockImplementation()!;
        unavailable.admin.from.mockImplementation((table: string) => (
            table === 'bookable_slots'
                ? query({ data: null, error: { message: 'not found' } })
                : unavailableAdminFrom(table)
        ));
        await installClients(unavailable.server, unavailable.admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const unavailableResponse = await POST(context({ ...policies, slotPublicId }) as any);
        await expectCheckoutError(
            unavailableResponse,
            409,
            'This place is not available for checkout',
            'SLOT_UNAVAILABLE',
        );
    });

    it('does not reconcile an unavailable checkout provider as a hold conflict', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockImplementation(async (name: string) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                return { data: null, error: { message: 'upstream connection timed out', code: 'PGRST000' } };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
            error: 'Checkout is temporarily unavailable',
            errorCode: 'CHECKOUT_PROVIDER_UNAVAILABLE',
        });
        expect(admin.from).not.toHaveBeenCalledWith('bookable_slot_holds');
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('classifies a direct-checkout CRM identity conflict as an ineligible account', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockImplementation(async (name: string) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                return {
                    data: null,
                    error: { message: 'direct_checkout_contact_identity_conflicts', code: '23505' },
                };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        await expectCheckoutError(
            response,
            403,
            'The student account cannot claim this checkout',
            'ACCOUNT_NOT_ELIGIBLE',
        );
        expect(admin.from).not.toHaveBeenCalledWith('bookable_slot_holds');
    });

    it.each([
        [
            'CHECKOUT_RECONCILING',
            { ...checkoutIntent, status: 'completed' },
            'Payment is being reconciled for the existing checkout',
        ],
        [
            'CHECKOUT_IN_PROGRESS',
            { ...checkoutIntent, package_price_id: '40000000-0000-4000-8000-000000000099' },
            'You already have another checkout in progress',
        ],
    ])('returns %s for an existing checkout state', async (errorCode, intent, error) => {
        const { server, admin } = makeClients();
        admin.rpc.mockImplementation(async (name: string) => {
            if (name === 'claim_direct_checkout_intent_for_slot') return { data: intent, error: null };
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        await expectCheckoutError(response, 409, error, errorCode);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('returns a distinct code when a Stripe Customer balance changes the purchase', async () => {
        stripeMock.customers.retrieve.mockResolvedValueOnce({
            id: 'cus_v2', deleted: false, livemode: false, balance: 100, invoice_credit_balance: {},
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        await expectCheckoutError(
            response,
            409,
            'The Stripe Customer has a balance that changes this purchase',
            'CUSTOMER_BALANCE_CONFLICT',
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('rejects a reused Stripe Customer with an active discount', async () => {
        stripeMock.customers.retrieve.mockResolvedValueOnce({
            id: 'cus_v2',
            deleted: false,
            livemode: false,
            balance: 0,
            invoice_credit_balance: {},
            discount: { id: 'di_legacy' },
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        await expectCheckoutError(
            response,
            409,
            'The Stripe Customer has a discount that changes this purchase',
            'CUSTOMER_DISCOUNT_CONFLICT',
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('returns the same idempotent Checkout Session when another request records it first', async () => {
        const { server, admin } = makeClients();
        const concurrentIntentQuery = query({
            data: {
                id: checkoutIntentId,
                status: 'open',
                stripe_customer_id: 'cus_v2',
                stripe_checkout_session_id: 'cs_test_v2',
            },
            error: null,
        });
        concurrentIntentQuery.single.mockResolvedValueOnce({
            data: null,
            error: { message: 'The result contains 0 rows' },
        });
        const originalFrom = admin.from.getMockImplementation()!;
        admin.from.mockImplementation((table: string) => (
            table === 'checkout_intents' ? concurrentIntentQuery : originalFrom(table)
        ));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.test/v2' });
        expect(concurrentIntentQuery.maybeSingle).toHaveBeenCalledTimes(1);
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('returns a stable configuration code for an invalid checkout expiry', async () => {
        const invalidIntent = { ...checkoutIntent, expires_at: 'not-a-date' };
        const { server, admin } = makeClients();
        admin.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === 'claim_direct_checkout_intent_for_slot') return { data: invalidIntent, error: null };
            if (name === 'snapshot_checkout_intent_customer') {
                return { data: { ...invalidIntent, stripe_customer_id: args.p_stripe_customer_id }, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        await expectCheckoutError(
            response,
            409,
            'Checkout reservation has an invalid expiry',
            'CHECKOUT_CONFIGURATION_ERROR',
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('proves an expired intent has no Stripe Session, releases its hold and retries safely', async () => {
        const staleIntent = {
            ...checkoutIntent,
            expires_at: '2020-01-01T02:00:00.000Z',
            stripe_session_expires_at: '2020-01-01T01:00:00.000Z',
        };
        const replacementIntent = {
            ...checkoutIntent,
            id: '50000000-0000-4000-8000-000000000002',
        };
        const { server, admin } = makeClients();
        const originalFrom = admin.from.getMockImplementation()!;
        admin.from.mockImplementation((table: string) => (
            table === 'checkout_intents'
                ? query({ data: { id: replacementIntent.id }, error: null })
                : originalFrom(table)
        ));
        let claimCount = 0;
        admin.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                claimCount += 1;
                return { data: claimCount === 1 ? staleIntent : replacementIntent, error: null };
            }
            if (name === 'snapshot_checkout_intent_customer') {
                const intent = args.p_intent_id === staleIntent.id ? staleIntent : replacementIntent;
                return { data: { ...intent, stripe_customer_id: args.p_stripe_customer_id }, error: null };
            }
            if (name === 'release_abandoned_checkout_intent') {
                return { data: { ...staleIntent, status: 'expired' }, error: null };
            }
            if (name === 'release_bookable_slot_hold') {
                return { data: { checkout_intent_id: staleIntent.id, status: 'expired' }, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenCalledWith('release_abandoned_checkout_intent', {
            p_intent_id: staleIntent.id,
            p_stripe_customer_id: 'cus_v2',
        });
        expect(admin.rpc).toHaveBeenCalledWith('release_bookable_slot_hold', {
            p_checkout_intent_id: staleIntent.id,
            p_reason: 'checkout_abandoned_without_stripe_session',
        });
        expect(claimCount).toBe(2);
        expect(stripeMock.checkout.sessions.list).toHaveBeenCalledTimes(2);
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.any(Object),
            { idempotencyKey: `checkout-intent:${replacementIntent.id}` },
        );
    });

    it('reconciles a conflicting expired hold after proving its Customer has no Stripe Session', async () => {
        const staleConflictingIntent = {
            ...checkoutIntent,
            id: '50000000-0000-4000-8000-000000000099',
            student_id: 'other-student',
            stripe_customer_id: 'cus_stale',
            expires_at: '2020-01-01T02:00:00.000Z',
            stripe_session_expires_at: '2020-01-01T01:00:00.000Z',
        };
        const staleHold = {
            id: '90000000-0000-4000-8000-000000000001',
            checkout_intent_id: staleConflictingIntent.id,
            slot_id: slotId,
            status: 'held',
            expires_at: staleConflictingIntent.expires_at,
            hold_fingerprint: `v1:${'a'.repeat(64)}`,
        };
        const { server, admin } = makeClients();
        const originalFrom = admin.from.getMockImplementation()!;
        let checkoutIntentReads = 0;
        admin.from.mockImplementation((table: string) => {
            if (table === 'bookable_slot_holds') return query({ data: staleHold, error: null });
            if (table === 'checkout_intents') {
                checkoutIntentReads += 1;
                return checkoutIntentReads === 1
                    ? query({ data: staleConflictingIntent, error: null })
                    : query({ data: { id: checkoutIntent.id }, error: null });
            }
            return originalFrom(table);
        });
        let claimCount = 0;
        admin.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                claimCount += 1;
                return claimCount === 1
                    ? { data: null, error: { message: 'checkout_hold_fingerprint_already_active' } }
                    : { data: checkoutIntent, error: null };
            }
            if (name === 'release_abandoned_checkout_intent') {
                return { data: { ...staleConflictingIntent, status: 'expired' }, error: null };
            }
            if (name === 'release_bookable_slot_hold') {
                return { data: { ...staleHold, status: 'expired' }, error: null };
            }
            if (name === 'snapshot_checkout_intent_customer') {
                return { data: { ...checkoutIntent, stripe_customer_id: args.p_stripe_customer_id }, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

        expect(response.status).toBe(200);
        expect(claimCount).toBe(2);
        expect(admin.rpc).toHaveBeenCalledWith('release_abandoned_checkout_intent', {
            p_intent_id: staleConflictingIntent.id,
            p_stripe_customer_id: 'cus_stale',
        });
        expect(stripeMock.checkout.sessions.list).toHaveBeenCalledWith({
            customer: 'cus_stale',
            limit: 100,
        });
    });

    it.each(['open', 'complete'] as const)(
        'fails closed without releasing a conflicting hold whose Stripe Session is still %s',
        async (sessionStatus) => {
            const staleIntent = expiredConflictIntent({
                id: '50000000-0000-4000-8000-000000000090',
                customerId: 'cus_conflict_active',
            });
            const staleHold = expiredConflictHold({
                id: '90000000-0000-4000-8000-000000000090',
                intent: staleIntent,
                slotId,
                fingerprintCharacter: 'c',
            });
            const session = {
                id: 'cs_conflict_active',
                status: sessionStatus,
                livemode: false,
                customer: staleIntent.stripe_customer_id,
                metadata: { checkoutIntentId: staleIntent.id },
            };
            stripeMock.checkout.sessions.list.mockResolvedValue({ data: [session], has_more: false });
            stripeMock.checkout.sessions.retrieve.mockResolvedValue(session);

            const { server, admin } = makeClients();
            const originalFrom = admin.from.getMockImplementation()!;
            admin.from.mockImplementation((table: string) => {
                if (table === 'bookable_slot_holds') return query({ data: staleHold, error: null });
                if (table === 'checkout_intents') return query({ data: staleIntent, error: null });
                return originalFrom(table);
            });
            admin.rpc.mockImplementation(async (name: string) => {
                if (name === 'claim_direct_checkout_intent_for_slot') {
                    return { data: null, error: { message: 'checkout_hold_fingerprint_already_active' } };
                }
                throw new Error(`Unexpected RPC ${name}`);
            });
            await installClients(server, admin);
            const { POST } = await import('../../src/pages/api/create-checkout');

            const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

            expect(response.status).toBe(409);
            await expect(response.json()).resolves.toEqual({
                error: 'Could not reserve this place for checkout',
                errorCode: 'HOLD_CONFLICT',
            });
            expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(session.id);
            expect(admin.rpc).toHaveBeenCalledTimes(1);
            expect(admin.rpc).not.toHaveBeenCalledWith(
                'release_expired_checkout_intent',
                expect.anything(),
            );
            expect(admin.rpc).not.toHaveBeenCalledWith(
                'release_abandoned_checkout_intent',
                expect.anything(),
            );
            expect(admin.rpc).not.toHaveBeenCalledWith(
                'release_bookable_slot_hold',
                expect.anything(),
            );
            expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        },
    );

    it('fails closed when more than one Stripe Session matches the conflicting intent', async () => {
        const staleIntent = expiredConflictIntent({
            id: '50000000-0000-4000-8000-000000000091',
            customerId: 'cus_conflict_multiple',
        });
        const staleHold = expiredConflictHold({
            id: '90000000-0000-4000-8000-000000000091',
            intent: staleIntent,
            slotId,
            fingerprintCharacter: 'd',
        });
        stripeMock.checkout.sessions.list.mockResolvedValue({
            data: [
                { id: 'cs_conflict_first', metadata: { checkoutIntentId: staleIntent.id } },
                { id: 'cs_conflict_second', metadata: { checkoutIntentId: staleIntent.id } },
            ],
            has_more: false,
        });

        const { server, admin } = makeClients();
        const originalFrom = admin.from.getMockImplementation()!;
        admin.from.mockImplementation((table: string) => {
            if (table === 'bookable_slot_holds') return query({ data: staleHold, error: null });
            if (table === 'checkout_intents') return query({ data: staleIntent, error: null });
            return originalFrom(table);
        });
        admin.rpc.mockImplementation(async (name: string) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                return { data: null, error: { message: 'checkout_hold_fingerprint_already_active' } };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Could not reserve this place for checkout',
            errorCode: 'HOLD_CONFLICT',
        });
        expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenCalledTimes(1);
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_expired_checkout_intent',
            expect.anything(),
        );
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_abandoned_checkout_intent',
            expect.anything(),
        );
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_bookable_slot_hold',
            expect.anything(),
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('retries the claim only after distinct slot and fingerprint conflicts both reconcile', async () => {
        const slotConflictIntent = expiredConflictIntent({
            id: '50000000-0000-4000-8000-000000000092',
            customerId: 'cus_slot_conflict',
        });
        const fingerprintConflictIntent = expiredConflictIntent({
            id: '50000000-0000-4000-8000-000000000093',
            customerId: 'cus_fingerprint_conflict',
        });
        const slotConflictHold = expiredConflictHold({
            id: '90000000-0000-4000-8000-000000000092',
            intent: slotConflictIntent,
            slotId,
            fingerprintCharacter: 'e',
        });
        const fingerprintConflictHold = expiredConflictHold({
            id: '90000000-0000-4000-8000-000000000093',
            intent: fingerprintConflictIntent,
            slotId: '20000000-0000-4000-8000-000000000099',
            fingerprintCharacter: 'f',
        });

        const { server, admin } = makeClients();
        const originalFrom = admin.from.getMockImplementation()!;
        let holdLookupCount = 0;
        let intentLookupCount = 0;
        admin.from.mockImplementation((table: string) => {
            if (table === 'bookable_slot_holds') {
                const hold = holdLookupCount === 0 ? slotConflictHold : fingerprintConflictHold;
                holdLookupCount += 1;
                return query({ data: hold, error: null });
            }
            if (table === 'checkout_intents') {
                if (intentLookupCount < 2) {
                    const intent = intentLookupCount === 0 ? slotConflictIntent : fingerprintConflictIntent;
                    intentLookupCount += 1;
                    return query({ data: intent, error: null });
                }
                return originalFrom(table);
            }
            return originalFrom(table);
        });
        let claimCount = 0;
        admin.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                claimCount += 1;
                return claimCount === 1
                    ? { data: null, error: { message: 'bookable_slot_is_held' } }
                    : { data: checkoutIntent, error: null };
            }
            if (name === 'release_abandoned_checkout_intent') {
                const intent = args.p_intent_id === slotConflictIntent.id
                    ? slotConflictIntent
                    : fingerprintConflictIntent;
                return { data: { ...intent, status: 'expired' }, error: null };
            }
            if (name === 'release_bookable_slot_hold') {
                return { data: { checkout_intent_id: args.p_checkout_intent_id, status: 'expired' }, error: null };
            }
            if (name === 'snapshot_checkout_intent_customer') {
                return { data: { ...checkoutIntent, stripe_customer_id: args.p_stripe_customer_id }, error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

        expect(response.status).toBe(200);
        expect(claimCount).toBe(2);
        expect(holdLookupCount).toBe(2);
        expect(intentLookupCount).toBe(2);
        expect(admin.rpc.mock.calls
            .filter(([name]) => name === 'release_abandoned_checkout_intent')
            .map(([, args]) => args.p_intent_id))
            .toEqual([slotConflictIntent.id, fingerprintConflictIntent.id]);
        expect(admin.rpc.mock.calls
            .filter(([name]) => name === 'release_bookable_slot_hold')
            .map(([, args]) => args.p_checkout_intent_id))
            .toEqual([slotConflictIntent.id, fingerprintConflictIntent.id]);
    });

    it('does not inspect or release a fingerprint conflict after slot-conflict reconciliation fails', async () => {
        const slotConflictIntent = expiredConflictIntent({
            id: '50000000-0000-4000-8000-000000000094',
            customerId: 'cus_slot_conflict_active',
        });
        const fingerprintConflictIntent = expiredConflictIntent({
            id: '50000000-0000-4000-8000-000000000095',
            customerId: 'cus_fingerprint_conflict_waiting',
        });
        const slotConflictHold = expiredConflictHold({
            id: '90000000-0000-4000-8000-000000000094',
            intent: slotConflictIntent,
            slotId,
            fingerprintCharacter: '1',
        });
        const fingerprintConflictHold = expiredConflictHold({
            id: '90000000-0000-4000-8000-000000000095',
            intent: fingerprintConflictIntent,
            slotId: '20000000-0000-4000-8000-000000000098',
            fingerprintCharacter: '2',
        });
        const activeSession = {
            id: 'cs_slot_conflict_active',
            status: 'open',
            livemode: false,
            customer: slotConflictIntent.stripe_customer_id,
            metadata: { checkoutIntentId: slotConflictIntent.id },
        };
        stripeMock.checkout.sessions.list
            .mockResolvedValueOnce({ data: [activeSession], has_more: false })
            .mockResolvedValueOnce({ data: [], has_more: false });
        stripeMock.checkout.sessions.retrieve.mockResolvedValue(activeSession);

        const { server, admin } = makeClients();
        const originalFrom = admin.from.getMockImplementation()!;
        let holdLookupCount = 0;
        let intentLookupCount = 0;
        admin.from.mockImplementation((table: string) => {
            if (table === 'bookable_slot_holds') {
                const hold = holdLookupCount === 0 ? slotConflictHold : fingerprintConflictHold;
                holdLookupCount += 1;
                return query({ data: hold, error: null });
            }
            if (table === 'checkout_intents') {
                const intent = intentLookupCount === 0 ? slotConflictIntent : fingerprintConflictIntent;
                intentLookupCount += 1;
                return query({ data: intent, error: null });
            }
            return originalFrom(table);
        });
        admin.rpc.mockImplementation(async (name: string) => {
            if (name === 'claim_direct_checkout_intent_for_slot') {
                return { data: null, error: { message: 'bookable_slot_is_held' } };
            }
            throw new Error(`Unexpected RPC ${name}`);
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId, lang: 'en' }) as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Could not reserve this place for checkout',
            errorCode: 'HOLD_CONFLICT',
        });
        expect(holdLookupCount).toBe(2);
        expect(intentLookupCount).toBe(1);
        expect(stripeMock.checkout.sessions.list).toHaveBeenCalledTimes(1);
        expect(admin.rpc).toHaveBeenCalledTimes(1);
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_abandoned_checkout_intent',
            expect.objectContaining({ p_intent_id: fingerprintConflictIntent.id }),
        );
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_bookable_slot_hold',
            expect.objectContaining({ p_checkout_intent_id: fingerprintConflictIntent.id }),
        );
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
        await expect(response.json()).resolves.toEqual({
            error: 'Stripe prices do not match the approved offer',
            errorCode: 'OFFER_CONFIGURATION_ERROR',
        });
        expect(admin.rpc).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it.each([
        ['a rejected token', { success: false, 'error-codes': ['invalid-input-response'] }],
        ['a replayed token', { success: false, 'error-codes': ['timeout-or-duplicate'] }],
        ['the wrong action', { success: true, action: 'lead_capture', hostname: 'staging.example.test' }],
        ['the wrong hostname', { success: true, action: 'checkout_hold', hostname: 'example.test' }],
    ])('rejects %s before Stripe or the reservation RPC', async (_label, siteverifyPayload) => {
        turnstileFetchMock.mockResolvedValueOnce(new Response(JSON.stringify(siteverifyPayload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Checkout verification failed' });
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['a missing token', undefined],
        ['an oversized token', 'x'.repeat(2049)],
    ])('rejects %s without calling Siteverify, Stripe or the reservation RPC', async (_label, token) => {
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...policies,
            slotPublicId,
            'cf-turnstile-response': token,
        }) as any);

        expect(response.status).toBe(400);
        expect(turnstileFetchMock).not.toHaveBeenCalled();
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('fails closed when Siteverify is unavailable before Stripe or the reservation RPC', async () => {
        turnstileFetchMock.mockRejectedValueOnce(new Error('network unavailable'));
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...policies, slotPublicId }) as any);

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
            error: 'Checkout verification is temporarily unavailable',
        });
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it.each([
        ['staging', 'the client address is absent', 'address'],
        ['production', 'the client address is absent', 'address'],
        ['staging', 'the configured site URL is absent', 'site-url'],
        ['staging', 'the Turnstile site key is absent', 'turnstile-site-key'],
        ['staging', 'the Turnstile secret is absent', 'turnstile'],
        ['staging', 'the fingerprint secret is absent', 'fingerprint'],
        ['staging', 'the fingerprint secret is too short', 'short-fingerprint'],
    ])('fails closed in hosted %s when %s', async (appEnvironment, _label, missing) => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string): string | undefined => {
            if (key === 'CHECKOUT_ENABLED') return 'true';
            if (key === 'PUBLIC_APP_ENV') return appEnvironment;
            if (key === 'PUBLIC_SITE_URL') return missing === 'site-url'
                ? undefined
                : 'https://staging.example.test';
            if (key === 'PUBLIC_TURNSTILE_SITE_KEY') {
                return missing === 'turnstile-site-key' ? undefined : 'real-staging-site-key';
            }
            if (key === 'TURNSTILE_SECRET_KEY') return missing === 'turnstile' ? undefined : 'turnstile-test-secret';
            if (key === 'CHECKOUT_HOLD_FINGERPRINT_SECRET') {
                if (missing === 'fingerprint') return undefined;
                if (missing === 'short-fingerprint') return 'too-short';
                return '0123456789abcdef0123456789abcdef';
            }
            if (key === 'STRIPE_EXPECTED_ACCOUNT_ID') return 'acct_test';
            if (key === 'STRIPE_SECRET_KEY') return 'sk_test_example';
            return undefined;
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const requestContext = context({ ...policies, slotPublicId });
        if (missing === 'address') delete (requestContext as { clientAddress?: string }).clientAddress;

        const response = await POST(requestContext as any);

        expect(response.status).toBe(503);
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalled();
    });
});
