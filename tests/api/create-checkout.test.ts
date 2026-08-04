import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/types/database.types';
import { CHECKOUT_TERMS_VERSION } from '../../src/lib/legal-policy';

const stripeMock = vi.hoisted(() => ({
    accounts: { retrieve: vi.fn() },
    prices: { retrieve: vi.fn() },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), list: vi.fn() } },
    customers: {
        create: vi.fn(),
        retrieve: vi.fn(),
        retrieveCashBalance: vi.fn(),
        update: vi.fn(),
    },
}));
const privateProfileMock = vi.hoisted(() => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));
const approvalMock = vi.hoisted(() => ({ findCheckoutApproval: vi.fn() }));
const runtimeEnvMock = vi.hoisted(() => ({
    readRuntimeEnv: vi.fn((key: string): string | undefined => {
        if (key === 'CHECKOUT_ENABLED') return 'true';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_example';
        if (key === 'PUBLIC_APP_ENV') return 'test';
        if (key === 'E2E_RUNTIME_ISOLATED') return 'true';
        if (key === 'E2E_DISABLE_EXTERNAL_INTEGRATIONS') return 'true';
        if (key === 'E2E_TARGET_SUPABASE_REF') return 'placeholder';
        return undefined;
    }),
}));
const stagingGrantMock = vi.hoisted(() => ({
    readStagingE2ECheckoutGrant: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/stripe', () => ({ stripe: stripeMock }));
vi.mock('../../src/lib/profiles-private', () => privateProfileMock);
vi.mock('../../src/lib/checkout-approval', () => approvalMock);
vi.mock('../../src/lib/site-url', () => ({ getSiteUrl: vi.fn(() => 'https://example.test') }));
vi.mock('../../src/lib/runtime-env', () => runtimeEnvMock);
vi.mock('../../src/lib/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('../../src/lib/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock('../../src/lib/staging-e2e-checkout', () => stagingGrantMock);

const packageId = '10000000-0000-4000-8000-000000000001';
const packagePriceId = '20000000-0000-4000-8000-000000000001';
const opportunityId = '30000000-0000-4000-8000-000000000001';
const checkoutIntentId = '40000000-0000-4000-8000-000000000001';

const packagePrice = {
    id: packagePriceId,
    package_id: packageId,
    catalog_version: 1,
    package_key: 'standard',
    display_name: { es: 'Estándar' },
    duration_months: 3,
    amount_cents: 27000,
    currency: 'eur',
    sessions_per_month: 4,
    sessions_per_period: 12,
    has_group_session: false,
    has_dual_teacher: false,
    stripe_account_id: 'acct_test',
    stripe_livemode: false,
    stripe_product_id: 'prod_standard',
    stripe_price_id: 'price_valid_3m',
    status: 'active',
    activated_at: '2026-07-10T20:00:00.000Z',
    retired_at: null,
    created_by: null,
    created_at: '2026-07-10T20:00:00.000Z',
};

const pkg = {
    id: packageId,
    catalog_version: 1,
    name: 'standard',
    display_name: { es: 'Estándar' },
    price_monthly: 10000,
    sessions_per_month: 4,
    has_group_session: false,
    has_dual_teacher: false,
    stripe_product_id: 'prod_standard',
    stripe_price_1m: 'price_valid_1m',
    stripe_price_3m: 'price_valid_3m',
    stripe_price_6m: 'price_valid_6m',
    is_active: true,
    created_at: null,
    updated_at: null,
};

const stripePrice = {
    id: 'price_valid_3m',
    active: true,
    unit_amount: 27000,
    currency: 'eur',
    product: 'prod_standard',
    recurring: { interval: 'month', interval_count: 3 },
    livemode: false,
};

const checkoutIntent: Database['public']['Tables']['checkout_intents']['Row'] = {
    id: checkoutIntentId,
    opportunity_id: opportunityId,
    contact_id: 'contact-1',
    student_id: 'student-1',
    package_price_id: packagePriceId,
    lang: 'es',
    legal_policy_version: '2026-08-01',
    policy_accepted_at: '2099-07-10T20:00:00.000Z',
    site_url: 'https://example.test',
    status: 'creating',
    stripe_checkout_session_id: null,
    stripe_customer_id: null,
    stripe_session_expires_at: '2099-07-10T21:00:00.000Z',
    expires_at: '2099-07-10T22:00:00.000Z',
    completed_at: null,
    created_at: '2099-07-10T20:00:00.000Z',
    updated_at: '2099-07-10T20:00:00.000Z',
};

const acceptedPolicies = {
    policyVersion: CHECKOUT_TERMS_VERSION,
    adultConfirmed: true,
    termsAccepted: true,
    serviceStartRequested: true,
    withdrawalLossAcknowledged: true,
};

function createdCheckoutSession(
    params: Record<string, any>,
    overrides: Record<string, unknown> = {},
) {
    const lineItems = params.line_items as Array<{ price: string; quantity: number }>;
    return {
        id: 'cs_test_approved',
        status: 'open',
        mode: params.mode,
        livemode: false,
        customer: params.customer,
        client_reference_id: params.client_reference_id,
        amount_subtotal: 27000,
        amount_total: 27000,
        currency: 'eur',
        discounts: [],
        total_details: {
            amount_discount: 0,
            amount_shipping: 0,
            amount_tax: 0,
        },
        allow_promotion_codes: false,
        adaptive_pricing: { enabled: false },
        automatic_tax: { enabled: false },
        payment_method_types: ['card'],
        metadata: params.metadata,
        line_items: {
            data: lineItems.map((lineItem) => ({
                quantity: lineItem.quantity,
                price: { id: lineItem.price },
            })),
        },
        url: 'https://checkout.stripe.test/session',
        ...overrides,
    };
}

function query(result: { data: unknown; error: unknown }) {
    return {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
}

function makeClients(options: {
    user?: Record<string, unknown> | null;
    activeSubscription?: Record<string, unknown> | null;
    packagePriceResult?: { data: unknown; error: unknown };
    packageResult?: { data: unknown; error: unknown };
} = {}) {
    const user = options.user === undefined ? {
        id: 'student-1',
        email: 'student@example.com',
        email_confirmed_at: '2026-07-10T19:00:00.000Z',
    } : options.user;
    const profileQuery = query({
        data: user ? { id: user.id, role: user.role ?? 'student' } : null,
        error: user ? null : { message: 'missing' },
    });
    const subscriptionQuery = query({ data: options.activeSubscription ?? null, error: null });
    const server = {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
        from: vi.fn((table: string) => {
            if (table === 'profiles') return profileQuery;
            if (table === 'subscriptions') return subscriptionQuery;
            throw new Error(`Unexpected server table ${table}`);
        }),
    };
    const packagePriceQuery = query(options.packagePriceResult ?? { data: packagePrice, error: null });
    const packageQuery = query(options.packageResult ?? { data: pkg, error: null });
    const checkoutIntentQuery = query({ data: { id: checkoutIntentId }, error: null });
    const admin = {
        rpc: vi.fn(async (rpcName: string, args: Record<string, unknown>) => {
            if (rpcName === 'snapshot_checkout_intent_customer') {
                return {
                    data: {
                        ...checkoutIntent,
                        id: args.p_intent_id,
                        stripe_customer_id: args.p_stripe_customer_id,
                    },
                    error: null,
                };
            }
            return { data: checkoutIntent, error: null };
        }),
        from: vi.fn((table: string) => {
            if (table === 'package_prices') return packagePriceQuery;
            if (table === 'packages') return packageQuery;
            if (table === 'checkout_intents') return checkoutIntentQuery;
            throw new Error(`Unexpected admin table ${table}`);
        }),
    };
    return { server, admin, packagePriceQuery, packageQuery, checkoutIntentQuery };
}

function context(body: Record<string, unknown> = {}) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/create-checkout',
        },
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

describe('POST /api/create-checkout', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.resetModules();
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'CHECKOUT_ENABLED') return 'true';
            if (key === 'STRIPE_SECRET_KEY') return 'sk_test_example';
            if (key === 'PUBLIC_APP_ENV') return 'test';
            if (key === 'E2E_RUNTIME_ISOLATED') return 'true';
            if (key === 'E2E_DISABLE_EXTERNAL_INTEGRATIONS') return 'true';
            if (key === 'E2E_TARGET_SUPABASE_REF') return 'placeholder';
            return undefined;
        });
        approvalMock.findCheckoutApproval.mockResolvedValue({
            opportunityId,
            packageId,
            contactId: 'contact-1',
            approvedAt: '2026-07-10T20:00:00.000Z',
        });
        stripeMock.accounts.retrieve.mockResolvedValue({
            id: 'acct_test',
            country: 'US',
            details_submitted: false,
            charges_enabled: false,
            payouts_enabled: false,
        });
        stripeMock.prices.retrieve.mockResolvedValue(stripePrice);
        stripeMock.checkout.sessions.create.mockImplementation(async (params) => (
            createdCheckoutSession(params)
        ));
        stripeMock.checkout.sessions.retrieve.mockResolvedValue(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_valid_3m', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_valid_3m',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }));
        stripeMock.checkout.sessions.list.mockResolvedValue({ data: [], has_more: false });
        stripeMock.customers.create.mockResolvedValue({ id: 'cus_test_123' });
        stripeMock.customers.update.mockResolvedValue({ id: 'cus_existing_123' });
        stripeMock.customers.retrieve.mockImplementation(async (customerId: string) => ({
            id: customerId,
            deleted: false,
            email: 'student@example.com',
            balance: 0,
            invoice_credit_balance: {},
            livemode: false,
            metadata: { supabase_user_id: 'student-1' },
        }));
        stripeMock.customers.retrieveCashBalance.mockImplementation(async (customerId: string) => ({
            customer: customerId,
            available: {},
            livemode: false,
        }));
        privateProfileMock.getPrivateProfile.mockResolvedValue({
            stripe_customer_id: 'cus_existing_123',
            stripe_customer_account_id: 'acct_test',
            stripe_customer_livemode: false,
        });
        privateProfileMock.upsertPrivateProfile.mockResolvedValue(undefined);
    });

    it('fails closed before touching Supabase or Stripe when checkout is not enabled', async () => {
        runtimeEnvMock.readRuntimeEnv.mockReturnValue(undefined);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ priceId: 'price_valid_3m' }) as any);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: 'Checkout is disabled',
            errorCode: 'CHECKOUT_DISABLED',
        });
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('accepts only the student bound to an authenticated staging E2E grant', async () => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'PUBLIC_APP_ENV') return 'staging';
            return undefined;
        });
        stagingGrantMock.readStagingE2ECheckoutGrant.mockResolvedValueOnce({
            email: 'delivered+hs-stg-test-user@resend.dev',
            runId: 'journey-student-mismatch',
            slotPublicId: packageId,
            studentId: '90000000-0000-4000-8000-000000000009',
        });
        const { server, admin } = makeClients();
        server.auth.getUser.mockResolvedValue({
            data: {
                user: {
                    id: '90000000-0000-4000-8000-000000000001',
                    email: 'delivered+hs-stg-test-user@resend.dev',
                    email_confirmed_at: '2026-08-02T00:00:00.000Z',
                },
            },
            error: null,
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, slotPublicId: packageId }) as any);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({ errorCode: 'ACCOUNT_NOT_ELIGIBLE' });
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('rejects a staging E2E grant after the bound student email changes', async () => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'PUBLIC_APP_ENV') return 'staging';
            return undefined;
        });
        stagingGrantMock.readStagingE2ECheckoutGrant.mockResolvedValueOnce({
            email: 'delivered+hs-stg-original@resend.dev',
            runId: 'journey-email-mismatch',
            slotPublicId: packageId,
            studentId: '90000000-0000-4000-8000-000000000001',
        });
        const { server, admin } = makeClients();
        server.auth.getUser.mockResolvedValue({
            data: {
                user: {
                    id: '90000000-0000-4000-8000-000000000001',
                    email: 'delivered+hs-stg-changed@resend.dev',
                    email_confirmed_at: '2026-08-02T00:00:00.000Z',
                },
            },
            error: null,
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, slotPublicId: packageId }) as any);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({ errorCode: 'ACCOUNT_NOT_ELIGIBLE' });
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('rejects a staging E2E grant for a different slot', async () => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'PUBLIC_APP_ENV') return 'staging';
            return undefined;
        });
        stagingGrantMock.readStagingE2ECheckoutGrant.mockResolvedValueOnce({
            email: 'delivered+hs-stg-test-user@resend.dev',
            runId: 'journey-slot-mismatch',
            slotPublicId: '90000000-0000-4000-8000-000000000009',
            studentId: 'student-1',
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, slotPublicId: packageId }) as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ errorCode: 'SLOT_UNAVAILABLE' });
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    });

    it('dispatches the v2 contract instead of reopening legacy checkout in staging', async () => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'CHECKOUT_ENABLED') return 'true';
            if (key === 'PUBLIC_APP_ENV') return 'staging';
            return undefined;
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);

        await expect(response.json()).resolves.toEqual({ error: 'A valid slotPublicId is required' });
        expect(response.status).toBe(400);
        expect(createSupabaseServerClient).toHaveBeenCalledOnce();
        expect(server.from).not.toHaveBeenCalled();
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('keeps production checkout closed while the legal identity is provisional', async () => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'CHECKOUT_ENABLED') return 'true';
            if (key === 'PUBLIC_APP_ENV') return 'production';
            return undefined;
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, slotPublicId: packageId }) as any);

        await expect(response.json()).resolves.toEqual({
            error: 'Checkout is disabled',
            errorCode: 'CHECKOUT_DISABLED',
        });
        expect(response.status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(server.from).not.toHaveBeenCalled();
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it.each([undefined, 'real-project-ref'])('keeps legacy isolated and dispatches v2 for target %s', async (targetRef) => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'CHECKOUT_ENABLED') return 'true';
            if (key === 'PUBLIC_APP_ENV') return 'test';
            if (key === 'E2E_RUNTIME_ISOLATED') return 'true';
            if (key === 'E2E_DISABLE_EXTERNAL_INTEGRATIONS') return 'true';
            if (key === 'E2E_TARGET_SUPABASE_REF') return targetRef;
            return undefined;
        });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);

        await expect(response.json()).resolves.toEqual({ error: 'A valid slotPublicId is required' });
        expect(response.status).toBe(400);
        expect(createSupabaseServerClient).toHaveBeenCalledOnce();
        expect(server.from).not.toHaveBeenCalled();
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('rejects malformed requests before reading billing data', async () => {
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const missing = await POST(context(acceptedPolicies) as any);
        expect(missing.status).toBe(400);
        const malformed = await POST(context({ ...acceptedPolicies, priceId: 'bad,price' }) as any);
        expect(malformed.status).toBe(400);
        expect(admin.from).not.toHaveBeenCalled();
    });

    it('requires an authenticated account with a confirmed email', async () => {
        const { server, admin } = makeClients({
            user: { id: 'student-1', email: 'student@example.com', email_confirmed_at: null },
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: 'A confirmed email is required before payment',
            errorCode: 'ACCOUNT_NOT_ELIGIBLE',
        });
        expect(admin.from).not.toHaveBeenCalled();
    });

    it('allows only student profiles to purchase a plan', async () => {
        const { server, admin } = makeClients({
            user: {
                id: 'teacher-1',
                email: 'teacher@example.com',
                email_confirmed_at: '2026-07-10T19:00:00.000Z',
                role: 'teacher',
            },
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({
            error: 'Only student accounts can purchase a plan',
            errorCode: 'ACCOUNT_NOT_ELIGIBLE',
        });
        expect(admin.from).not.toHaveBeenCalled();
    });

    it('blocks a second checkout while a subscription is active, pending or paused', async () => {
        const { server, admin } = makeClients({ activeSubscription: { id: 'subscription-1' } });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);
        expect(response.status).toBe(409);
        expect(admin.from).not.toHaveBeenCalled();
    });

    it.each(['group', 'hybrid'])('blocks the %s package before Stripe while its operational promise is unavailable', async (packageKey) => {
        const { server, admin } = makeClients({
            packageResult: { data: { ...pkg, name: packageKey, has_group_session: true }, error: null },
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);
        const body = await response.json() as { error?: string };

        expect(response.status).toBe(409);
        expect(body.error).toMatch(/additional group or teacher operations/i);
        expect(approvalMock.findCheckoutApproval).not.toHaveBeenCalled();
        expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('rejects a price that is not an active immutable catalog offer', async () => {
        const { server, admin } = makeClients({
            packagePriceResult: { data: null, error: { message: 'missing' } },
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_unknown' }) as any);
        expect(response.status).toBe(400);
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    });

    it('rejects a valid catalog price when the individual package approval is absent', async () => {
        approvalMock.findCheckoutApproval.mockResolvedValue(null);
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);
        expect(response.status).toBe(403);
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it.each([
        ['amount', { unit_amount: 999 }],
        ['currency', { currency: 'usd' }],
        ['product', { product: 'prod_wrong' }],
        ['interval', { recurring: { interval: 'year', interval_count: 3 } }],
        ['interval count', { recurring: { interval: 'month', interval_count: 1 } }],
        ['mode', { livemode: true }],
        ['active flag', { active: false }],
    ])('fails before Customer creation when Stripe %s differs from the approved offer', async (_label, override) => {
        stripeMock.prices.retrieve.mockResolvedValue({ ...stripePrice, ...override });
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({ ...acceptedPolicies, priceId: 'price_valid_3m' }) as any);
        expect(response.status).toBe(409);
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('creates only the approved recurring Checkout and records immutable metadata', async () => {
        const { server, admin, checkoutIntentQuery } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
            lang: '../admin',
        }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.test/session' });
        expect(admin.rpc).toHaveBeenCalledWith('claim_checkout_intent', {
            p_opportunity_id: opportunityId,
            p_contact_id: 'contact-1',
            p_student_id: 'student-1',
            p_package_price_id: packagePriceId,
            p_lang: 'es',
            p_legal_policy_version: '2026-08-01',
            p_site_url: 'https://example.test',
        });
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                mode: 'subscription',
                locale: 'es',
                customer: 'cus_existing_123',
                client_reference_id: 'student-1',
                success_url: 'https://example.test/es/campus?payment=success',
                cancel_url: 'https://example.test/es/campus/account',
                line_items: [{ price: 'price_valid_3m', quantity: 1 }],
                adaptive_pricing: { enabled: false },
                metadata: expect.objectContaining({
                    priceId: 'price_valid_3m',
                    packageId,
                    packagePriceId,
                    crmOpportunityId: opportunityId,
                    checkoutIntentId,
                    durationMonths: '3',
                    sessionsPerPeriod: '12',
                    lang: 'es',
                    legalPolicyVersion: '2026-08-01',
                }),
                expires_at: Math.floor(Date.parse(checkoutIntent.stripe_session_expires_at) / 1000),
                expand: ['line_items.data.price'],
            }),
            { idempotencyKey: `checkout-intent:${checkoutIntentId}` },
        );
        expect(admin.rpc).toHaveBeenCalledWith('snapshot_checkout_intent_customer', {
            p_intent_id: checkoutIntentId,
            p_stripe_customer_id: 'cus_existing_123',
        });
        const snapshotCallIndex = admin.rpc.mock.calls.findIndex(([name]) => (
            name === 'snapshot_checkout_intent_customer'
        ));
        expect(admin.rpc.mock.invocationCallOrder[snapshotCallIndex]).toBeLessThan(
            stripeMock.checkout.sessions.create.mock.invocationCallOrder[0],
        );
        expect(checkoutIntentQuery.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'open',
            stripe_checkout_session_id: 'cs_test_approved',
        }));
    });

    it.each([
        ['subtotal', { amount_subtotal: 26000 }],
        ['total', { amount_total: 26000 }],
        ['currency', { currency: 'usd' }],
        ['adaptive pricing', { adaptive_pricing: { enabled: true } }],
        ['discount collection', { discounts: [{ id: 'di_test' }] }],
        ['discount total', {
            total_details: { amount_discount: 1000, amount_shipping: 0, amount_tax: 0 },
        }],
    ])('does not expose Checkout when its computed %s changes the approved charge', async (_label, override) => {
        stripeMock.checkout.sessions.create.mockImplementationOnce(async (params) => (
            createdCheckoutSession(params, override)
        ));
        const { server, admin, checkoutIntentQuery } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(checkoutIntentQuery.update).not.toHaveBeenCalled();
    });

    it.each([
        ['legacy invoice balance', { customerBalance: -500, invoiceBalances: {}, cashBalances: {} }],
        ['currency invoice credit', { customerBalance: 0, invoiceBalances: { eur: 500 }, cashBalances: {} }],
        ['cash balance', { customerBalance: 0, invoiceBalances: {}, cashBalances: { eur: 500 } }],
    ])('does not create Checkout for a Customer with %s', async (_label, balances) => {
        stripeMock.customers.retrieve.mockImplementation(async (customerId: string) => ({
            id: customerId,
            deleted: false,
            email: 'student@example.com',
            balance: balances.customerBalance,
            invoice_credit_balance: balances.invoiceBalances,
            livemode: false,
            metadata: { supabase_user_id: 'student-1' },
        }));
        stripeMock.customers.retrieveCashBalance.mockImplementation(async (customerId: string) => ({
            customer: customerId,
            available: balances.cashBalances,
            livemode: false,
        }));
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'snapshot_checkout_intent_customer',
            expect.any(Object),
        );
    });

    it('does not create a second duration while the student has a checkout intent open', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: { ...checkoutIntent, package_price_id: 'different-package-price' },
            error: null,
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('blocks a second purchase while a completed intent still awaits CRM conversion', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: {
                ...checkoutIntent,
                status: 'completed',
                stripe_checkout_session_id: 'cs_test_paid',
                stripe_customer_id: 'cus_existing_123',
                completed_at: '2026-07-10T20:30:00.000Z',
            },
            error: null,
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenCalledTimes(1);
    });

    it('returns the same still-open Stripe Session for an intent retry', async () => {
        const { server, admin, checkoutIntentQuery } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: {
                ...checkoutIntent,
                status: 'open',
                stripe_checkout_session_id: 'cs_test_approved',
                stripe_customer_id: 'cus_existing_123',
            },
            error: null,
        });
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
            lang: 'en',
        }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.test/session' });
        expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(
            'cs_test_approved',
            { expand: ['line_items.data.price'] },
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(checkoutIntentQuery.update).not.toHaveBeenCalled();
    });

    it('rejects a stored Stripe Session that does not match the approved offer', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: {
                ...checkoutIntent,
                status: 'open',
                stripe_checkout_session_id: 'cs_test_approved',
                stripe_customer_id: 'cus_existing_123',
            },
            error: null,
        });
        stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_other', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_other',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenCalledTimes(1);
    });

    it('refuses to recover a stored Session when Stripe enabled adaptive pricing', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: {
                ...checkoutIntent,
                status: 'open',
                stripe_checkout_session_id: 'cs_test_approved',
                stripe_customer_id: 'cus_existing_123',
            },
            error: null,
        });
        stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_valid_3m', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_valid_3m',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }, {
            adaptive_pricing: { enabled: true },
        }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('releases an expired Stripe Session and creates a replacement intent safely', async () => {
        const replacementIntent = {
            ...checkoutIntent,
            id: '40000000-0000-4000-8000-000000000002',
        };
        const { server, admin } = makeClients();
        admin.rpc
            .mockResolvedValueOnce({
                data: {
                ...checkoutIntent,
                status: 'open',
                stripe_checkout_session_id: 'cs_test_expired',
                stripe_customer_id: 'cus_existing_123',
            },
                error: null,
            })
            .mockResolvedValueOnce({
                data: { ...checkoutIntent, status: 'expired' },
                error: null,
            })
            .mockResolvedValueOnce({ data: replacementIntent, error: null });
        stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_valid_3m', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_valid_3m',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }, {
            id: 'cs_test_expired',
            status: 'expired',
            url: null,
        }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenNthCalledWith(2, 'release_expired_checkout_intent', {
            p_intent_id: checkoutIntentId,
            p_stripe_checkout_session_id: 'cs_test_expired',
        });
        expect(admin.rpc).toHaveBeenNthCalledWith(3, 'claim_checkout_intent', expect.any(Object));
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.any(Object),
            { idempotencyKey: `checkout-intent:${replacementIntent.id}` },
        );
    });

    it('does not release a completed Checkout Session while its webhook is reconciling', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: {
                ...checkoutIntent,
                status: 'open',
                stripe_checkout_session_id: 'cs_test_complete',
                stripe_customer_id: 'cus_existing_123',
            },
            error: null,
        });
        stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_valid_3m', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_valid_3m',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }, {
            id: 'cs_test_complete',
            status: 'complete',
            url: null,
        }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(admin.rpc).toHaveBeenCalledTimes(1);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('reuses the same idempotent Session after a crash left only the Customer snapshot', async () => {
        const { server, admin } = makeClients();
        admin.rpc.mockResolvedValueOnce({
            data: { ...checkoutIntent, stripe_customer_id: 'cus_existing_123' },
            error: null,
        });
        stripeMock.checkout.sessions.create.mockImplementationOnce(async (params) => (
            createdCheckoutSession(params, { id: 'cs_test_after_crash' })
        ));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(200);
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenCalledWith('snapshot_checkout_intent_customer', {
            p_intent_id: checkoutIntentId,
            p_stripe_customer_id: 'cus_existing_123',
        });
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.any(Object),
            { idempotencyKey: `checkout-intent:${checkoutIntentId}` },
        );
    });

    it('paginates every Customer Session and reuses an orphan found on a later page', async () => {
        const expiredCreatingIntent = {
            ...checkoutIntent,
            stripe_customer_id: 'cus_existing_123',
            stripe_session_expires_at: '2026-07-10T19:00:00.000Z',
            expires_at: '2026-07-10T20:00:00.000Z',
        };
        const { server, admin, checkoutIntentQuery } = makeClients();
        admin.rpc.mockImplementation(async (rpcName: string, args: Record<string, unknown>) => {
            if (rpcName === 'claim_checkout_intent') {
                return { data: expiredCreatingIntent, error: null };
            }
            if (rpcName === 'snapshot_checkout_intent_customer') {
                return {
                    data: { ...expiredCreatingIntent, stripe_customer_id: args.p_stripe_customer_id },
                    error: null,
                };
            }
            throw new Error(`Unexpected RPC ${rpcName}`);
        });
        stripeMock.checkout.sessions.list
            .mockResolvedValueOnce({
                data: [{ id: 'cs_test_unrelated', metadata: { checkoutIntentId: 'other-intent' } }],
                has_more: true,
            })
            .mockResolvedValueOnce({
                data: [{ id: 'cs_test_recovered', metadata: { checkoutIntentId } }],
                has_more: false,
            });
        stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_valid_3m', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_valid_3m',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }, { id: 'cs_test_recovered' }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(200);
        expect(stripeMock.checkout.sessions.list).toHaveBeenNthCalledWith(1, {
            customer: 'cus_existing_123',
            limit: 100,
        });
        expect(stripeMock.checkout.sessions.list).toHaveBeenNthCalledWith(2, {
            customer: 'cus_existing_123',
            limit: 100,
            starting_after: 'cs_test_unrelated',
        });
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_abandoned_checkout_intent',
            expect.any(Object),
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(checkoutIntentQuery.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'open',
            stripe_checkout_session_id: 'cs_test_recovered',
        }));
    });

    it('releases an expired creating intent only after exhaustive Stripe absence, then opens a new purchase', async () => {
        const expiredCreatingIntent = {
            ...checkoutIntent,
            stripe_customer_id: 'cus_existing_123',
            stripe_session_expires_at: '2026-07-10T19:00:00.000Z',
            expires_at: '2026-07-10T20:00:00.000Z',
        };
        const replacementIntent = {
            ...checkoutIntent,
            id: '40000000-0000-4000-8000-000000000002',
        };
        const { server, admin } = makeClients();
        let claimCount = 0;
        admin.rpc.mockImplementation(async (rpcName: string, args: Record<string, unknown>) => {
            if (rpcName === 'claim_checkout_intent') {
                claimCount += 1;
                return { data: claimCount === 1 ? expiredCreatingIntent : replacementIntent, error: null };
            }
            if (rpcName === 'snapshot_checkout_intent_customer') {
                const intent = args.p_intent_id === replacementIntent.id
                    ? replacementIntent
                    : expiredCreatingIntent;
                return {
                    data: { ...intent, stripe_customer_id: args.p_stripe_customer_id },
                    error: null,
                };
            }
            if (rpcName === 'release_abandoned_checkout_intent') {
                return { data: { ...expiredCreatingIntent, status: 'expired' }, error: null };
            }
            throw new Error(`Unexpected RPC ${rpcName}`);
        });
        stripeMock.checkout.sessions.list
            .mockResolvedValueOnce({
                data: [{ id: 'cs_test_unrelated', metadata: { checkoutIntentId: 'other-intent' } }],
                has_more: true,
            })
            .mockResolvedValueOnce({ data: [], has_more: false });
        stripeMock.checkout.sessions.create.mockImplementationOnce(async (params) => (
            createdCheckoutSession(params, { id: 'cs_test_new_purchase' })
        ));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(200);
        expect(stripeMock.checkout.sessions.list).toHaveBeenCalledTimes(2);
        expect(admin.rpc).toHaveBeenCalledWith('release_abandoned_checkout_intent', {
            p_intent_id: checkoutIntentId,
            p_stripe_customer_id: 'cus_existing_123',
        });
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({ checkoutIntentId: replacementIntent.id }),
            }),
            { idempotencyKey: `checkout-intent:${replacementIntent.id}` },
        );
    });

    it('fails closed without releasing when Stripe pagination exceeds the recovery bound', async () => {
        const expiredCreatingIntent = {
            ...checkoutIntent,
            stripe_customer_id: 'cus_existing_123',
            stripe_session_expires_at: '2026-07-10T19:00:00.000Z',
            expires_at: '2026-07-10T20:00:00.000Z',
        };
        const { server, admin } = makeClients();
        admin.rpc.mockImplementation(async (rpcName: string, args: Record<string, unknown>) => {
            if (rpcName === 'claim_checkout_intent') {
                return { data: expiredCreatingIntent, error: null };
            }
            if (rpcName === 'snapshot_checkout_intent_customer') {
                return {
                    data: { ...expiredCreatingIntent, stripe_customer_id: args.p_stripe_customer_id },
                    error: null,
                };
            }
            throw new Error(`Unexpected RPC ${rpcName}`);
        });
        stripeMock.checkout.sessions.list.mockImplementation(async () => {
            const pageNumber = stripeMock.checkout.sessions.list.mock.calls.length;
            return {
                data: [{
                    id: `cs_test_page_${pageNumber}`,
                    metadata: { checkoutIntentId: 'other-intent' },
                }],
                has_more: true,
            };
        });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(500);
        expect(stripeMock.checkout.sessions.list).toHaveBeenCalledTimes(100);
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_abandoned_checkout_intent',
            expect.any(Object),
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('never releases a complete orphan discovered by exhaustive recovery', async () => {
        const expiredCreatingIntent = {
            ...checkoutIntent,
            stripe_customer_id: 'cus_existing_123',
            stripe_session_expires_at: '2026-07-10T19:00:00.000Z',
            expires_at: '2026-07-10T20:00:00.000Z',
        };
        const { server, admin } = makeClients();
        admin.rpc.mockImplementation(async (rpcName: string, args: Record<string, unknown>) => {
            if (rpcName === 'claim_checkout_intent') {
                return { data: expiredCreatingIntent, error: null };
            }
            if (rpcName === 'snapshot_checkout_intent_customer') {
                return {
                    data: { ...expiredCreatingIntent, stripe_customer_id: args.p_stripe_customer_id },
                    error: null,
                };
            }
            throw new Error(`Unexpected RPC ${rpcName}`);
        });
        stripeMock.checkout.sessions.list.mockResolvedValueOnce({
            data: [{ id: 'cs_test_complete_orphan', metadata: { checkoutIntentId } }],
            has_more: false,
        });
        stripeMock.checkout.sessions.retrieve.mockResolvedValueOnce(createdCheckoutSession({
            mode: 'subscription',
            customer: 'cus_existing_123',
            client_reference_id: 'student-1',
            line_items: [{ price: 'price_valid_3m', quantity: 1 }],
            metadata: {
                userId: 'student-1',
                priceId: 'price_valid_3m',
                packageId,
                packagePriceId,
                crmOpportunityId: opportunityId,
                checkoutIntentId,
            },
        }, {
            id: 'cs_test_complete_orphan',
            status: 'complete',
            url: null,
        }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_abandoned_checkout_intent',
            expect.any(Object),
        );
        expect(admin.rpc).not.toHaveBeenCalledWith(
            'release_expired_checkout_intent',
            expect.any(Object),
        );
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('replaces one orphaned idempotent Session that expired before its ID was persisted', async () => {
        const replacementIntent = {
            ...checkoutIntent,
            id: '40000000-0000-4000-8000-000000000002',
        };
        const { server, admin } = makeClients();
        let claimCount = 0;
        admin.rpc.mockImplementation(async (rpcName: string, args: Record<string, unknown>) => {
            if (rpcName === 'claim_checkout_intent') {
                claimCount += 1;
                return { data: claimCount === 1 ? checkoutIntent : replacementIntent, error: null };
            }
            if (rpcName === 'snapshot_checkout_intent_customer') {
                const intent = args.p_intent_id === replacementIntent.id ? replacementIntent : checkoutIntent;
                return {
                    data: { ...intent, stripe_customer_id: args.p_stripe_customer_id },
                    error: null,
                };
            }
            if (rpcName === 'release_expired_checkout_intent') {
                return { data: { ...checkoutIntent, status: 'expired' }, error: null };
            }
            throw new Error(`Unexpected RPC ${rpcName}`);
        });
        stripeMock.checkout.sessions.create
            .mockImplementationOnce(async (params) => createdCheckoutSession(params, {
                id: 'cs_test_orphan_expired',
                status: 'expired',
                url: null,
            }))
            .mockImplementationOnce(async (params) => createdCheckoutSession(params, {
                id: 'cs_test_replacement',
            }));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.test/session' });
        expect(admin.rpc).toHaveBeenCalledWith('release_expired_checkout_intent', {
            p_intent_id: checkoutIntentId,
            p_stripe_checkout_session_id: 'cs_test_orphan_expired',
        });
        expect(stripeMock.checkout.sessions.create).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                metadata: expect.objectContaining({ checkoutIntentId }),
            }),
            { idempotencyKey: `checkout-intent:${checkoutIntentId}` },
        );
        expect(stripeMock.checkout.sessions.create).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                metadata: expect.objectContaining({ checkoutIntentId: replacementIntent.id }),
            }),
            { idempotencyKey: `checkout-intent:${replacementIntent.id}` },
        );
    });

    it('never releases a completed Session returned by idempotent creation', async () => {
        const { server, admin } = makeClients();
        stripeMock.checkout.sessions.create.mockImplementationOnce(async (params) => (
            createdCheckoutSession(params, {
                id: 'cs_test_completed_orphan',
                status: 'complete',
                url: null,
            })
        ));
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(409);
        expect(admin.rpc).toHaveBeenCalledTimes(2);
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it('creates and stores a missing Stripe Customer idempotently before checkout', async () => {
        privateProfileMock.getPrivateProfile.mockResolvedValue(null);
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');

        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
        }) as any);

        expect(response.status).toBe(200);
        expect(stripeMock.customers.create).toHaveBeenCalledWith({
            email: 'student@example.com',
            metadata: { supabase_user_id: 'student-1' },
        }, {
            idempotencyKey: 'customer:test:student-1',
        });
        expect(privateProfileMock.upsertPrivateProfile).toHaveBeenCalledWith('student-1', {
            stripe_customer_id: 'cus_test_123',
            stripe_customer_account_id: 'acct_test',
            stripe_customer_livemode: false,
        });
    });

    it.each([
        ['adult confirmation', { adultConfirmed: 'true' }],
        ['terms acceptance', { termsAccepted: 'true' }],
        ['early service request', { serviceStartRequested: 'true' }],
        ['withdrawal-loss acknowledgement', { withdrawalLossAcknowledged: 'true' }],
    ])('requires %s to be the explicit boolean true', async (_label, override) => {
        const { server, admin } = makeClients();
        await installClients(server, admin);
        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(context({
            ...acceptedPolicies,
            priceId: 'price_valid_3m',
            ...override,
        }) as any);
        expect(response.status).toBe(400);
        expect(admin.from).not.toHaveBeenCalled();
    });
});
