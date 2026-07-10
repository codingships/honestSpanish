import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMock = vi.hoisted(() => ({
    prices: {
        retrieve: vi.fn(),
    },
    checkout: {
        sessions: {
            create: vi.fn(),
        },
    },
    customers: {
        create: vi.fn(),
    },
}));

const privateProfileMock = vi.hoisted(() => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: stripeMock,
}));

vi.mock('../../src/lib/profiles-private', () => privateProfileMock);

vi.mock('../../src/lib/site-url', () => ({
    getSiteUrl: vi.fn(() => 'https://example.test'),
}));

const runtimeEnvMock = vi.hoisted(() => ({
    readRuntimeEnv: vi.fn((key: string): string | undefined => key === 'CHECKOUT_ENABLED' ? 'true' : undefined),
}));

vi.mock('../../src/lib/runtime-env', () => runtimeEnvMock);

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/create-checkout',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

const acceptedPolicies = {
    adultConfirmed: true,
    termsAccepted: true,
    serviceStartRequested: true,
};

const makeThenableQuery = <T,>(result: T) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: T) => unknown) => Promise.resolve(result).then(resolve),
});

const makeSupabase = ({
    user = { id: 'student-1', email: 'student@example.com' },
    profile = { id: 'student-1' },
    activeSubscription = null,
    packages = [
        {
            id: 'package-1',
            stripe_price_1m: 'price_valid_1m',
            stripe_price_3m: 'price_valid_3m',
            stripe_price_6m: 'price_valid_6m',
        },
    ],
}: {
    user?: { id: string; email: string } | null;
    profile?: { id: string } | null;
    activeSubscription?: { id: string } | null;
    packages?: Array<Record<string, string | null>>;
} = {}) => {
    const packageQuery = makeThenableQuery({ data: packages, error: null });
    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table === 'profiles') {
                return makeThenableQuery({ data: profile, error: profile ? null : { message: 'missing' } });
            }
            if (table === 'subscriptions') {
                return makeThenableQuery({ data: activeSubscription, error: null });
            }
            if (table === 'packages') return packageQuery;
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { supabase, packageQuery };
};

const setSupabase = async (mockSupabase: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
};

describe('POST /api/create-checkout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        stripeMock.prices.retrieve.mockResolvedValue({ active: true, recurring: { interval: 'month' } });
        stripeMock.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.test/session' });
        stripeMock.customers.create.mockResolvedValue({ id: 'cus_test_123' });
        privateProfileMock.getPrivateProfile.mockResolvedValue({ stripe_customer_id: 'cus_existing_123' });
        privateProfileMock.upsertPrivateProfile.mockResolvedValue(undefined);
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => key === 'CHECKOUT_ENABLED' ? 'true' : undefined);
    });

    it('fails closed before touching Supabase or Stripe when checkout is not explicitly enabled', async () => {
        runtimeEnvMock.readRuntimeEnv.mockReturnValue(undefined);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext({ priceId: 'price_valid_1m' }) as any);

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ error: 'Checkout is disabled' });
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it('lets the final-window override disable checkout even when the configured default is true', async () => {
        runtimeEnvMock.readRuntimeEnv.mockImplementation((key: string) => {
            if (key === 'CHECKOUT_ENABLED_OVERRIDE') return 'false';
            if (key === 'CHECKOUT_ENABLED') return 'true';
            return undefined;
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext({ ...acceptedPolicies, priceId: 'price_valid_1m' }) as any);

        expect(response.status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it('rejects missing priceId before touching Stripe', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext(acceptedPolicies) as any);

        expect(response.status).toBe(400);
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    });

    it('rejects malformed priceId before querying packages or Stripe', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext({ ...acceptedPolicies, priceId: 'price_valid_1m,packages.eq.true' }) as any);

        expect(response.status).toBe(400);
        expect(supabase.from).not.toHaveBeenCalled();
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    });

    it('rejects authenticated checkout when the local package catalog does not contain the price', async () => {
        const { supabase, packageQuery } = makeSupabase({ packages: [] });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext({ ...acceptedPolicies, priceId: 'price_unknown' }) as any);

        expect(response.status).toBe(400);
        expect(packageQuery).not.toHaveProperty('or');
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    });

    it('creates checkout for an active local package price and normalizes unsupported lang to es', async () => {
        const { supabase, packageQuery } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext({ ...acceptedPolicies, priceId: 'price_valid_3m', lang: '../admin' }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://checkout.stripe.test/session' });
        expect(packageQuery).not.toHaveProperty('or');
        expect(stripeMock.prices.retrieve).toHaveBeenCalledWith('price_valid_3m');
        expect(stripeMock.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'subscription',
            payment_method_types: ['card'],
            allow_promotion_codes: false,
            customer: 'cus_existing_123',
            success_url: 'https://example.test/es/campus?payment=success',
            cancel_url: 'https://example.test/es/#pricing',
            metadata: expect.objectContaining({
                priceId: 'price_valid_3m',
                lang: 'es',
                adultConfirmed: 'true',
                termsAccepted: 'true',
                serviceStartRequested: 'true',
                legalPolicyVersion: '2026-07-10',
            }),
        }));
    });

    it('rejects checkout unless all adult and legal confirmations are explicit booleans', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(makeContext({
            priceId: 'price_valid_1m',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: 'true',
        }) as any);

        expect(response.status).toBe(400);
        expect(supabase.from).not.toHaveBeenCalled();
        expect(stripeMock.prices.retrieve).not.toHaveBeenCalled();
    });
});
