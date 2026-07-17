import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMock = vi.hoisted(() => ({
    accounts: {
        retrieve: vi.fn(),
    },
    billingPortal: {
        configurations: {
            retrieve: vi.fn(),
        },
        sessions: {
            create: vi.fn(),
        },
    },
    customers: {
        retrieve: vi.fn(),
        update: vi.fn(),
    },
}));

const privateProfileMock = vi.hoisted(() => ({
    getPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: stripeMock,
}));

const runtimeGuardMock = vi.hoisted(() => ({
    assertStripeRuntimeAccount: vi.fn(),
}));

vi.mock('../../src/lib/stripe-runtime-guard', () => runtimeGuardMock);

vi.mock('../../src/lib/runtime-env', () => ({
    requireRuntimeEnv: vi.fn((key: string) => {
        if (key === 'STRIPE_PORTAL_CONFIGURATION_ID') return 'bpc_test_safe';
        throw new Error(`Missing ${key}`);
    }),
}));

vi.mock('../../src/lib/profiles-private', () => privateProfileMock);

vi.mock('../../src/lib/site-url', () => ({
    getSiteUrl: vi.fn(() => 'https://example.test'),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeSupabase = (user: { id: string; email: string } | null = { id: 'student-1', email: 'student@example.com' }) => ({
    auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
});

const makeContext = (referer = '') => ({
    request: {
        headers: {
            get: vi.fn((header: string) => header.toLowerCase() === 'referer' ? referer : null),
        },
        url: 'http://localhost:4321/api/account/create-portal-session',
    },
    cookies: { get: vi.fn(), set: vi.fn() },
});

async function setSupabase(mockSupabase: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
}

describe('POST /api/account/create-portal-session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        privateProfileMock.getPrivateProfile.mockResolvedValue({
            stripe_customer_id: 'cus_test_123',
            stripe_customer_account_id: 'acct_test',
            stripe_customer_livemode: false,
        });
        stripeMock.accounts.retrieve.mockResolvedValue({ id: 'acct_test', country: 'US' });
        stripeMock.customers.retrieve.mockResolvedValue({
            id: 'cus_test_123',
            deleted: false,
            email: 'student@example.com',
            metadata: { supabase_user_id: 'student-1' },
        });
        stripeMock.billingPortal.configurations.retrieve.mockResolvedValue({
            id: 'bpc_test_safe',
            active: true,
            features: {
                payment_method_update: { enabled: true },
                invoice_history: { enabled: true },
                subscription_cancel: { enabled: true, mode: 'at_period_end' },
                subscription_update: { enabled: false },
            },
        });
        runtimeGuardMock.assertStripeRuntimeAccount.mockReturnValue({
            accountId: 'acct_test',
            appEnvironment: 'test',
            livemode: false,
        });
        stripeMock.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test/session' });
    });

    it('rejects unauthenticated users before loading private profile data or Stripe', async () => {
        await setSupabase(makeSupabase(null));

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(makeContext() as any);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
        expect(privateProfileMock.getPrivateProfile).not.toHaveBeenCalled();
        expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it('rejects users without a Stripe customer id', async () => {
        await setSupabase(makeSupabase());
        privateProfileMock.getPrivateProfile.mockResolvedValue({});

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(makeContext() as any);

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'No Stripe customer found' });
        expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it('creates a portal session with the configured site URL and referer language only', async () => {
        await setSupabase(makeSupabase());

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(makeContext('https://evil.example/ru/campus/account') as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ url: 'https://billing.stripe.test/session' });
        expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith({
            customer: 'cus_test_123',
            configuration: 'bpc_test_safe',
            return_url: 'https://example.test/ru/campus/account',
        });
        expect(runtimeGuardMock.assertStripeRuntimeAccount).toHaveBeenCalledWith(
            expect.any(Object),
            { id: 'acct_test', country: 'US' },
        );
    });

    it('falls back to Spanish for unsupported referer paths', async () => {
        await setSupabase(makeSupabase());

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        await POST(makeContext('https://example.test/admin') as any);

        expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
            configuration: 'bpc_test_safe',
            return_url: 'https://example.test/es/campus/account',
        }));
    });

    it('fails closed before creating a portal session for the wrong Stripe environment', async () => {
        await setSupabase(makeSupabase());
        runtimeGuardMock.assertStripeRuntimeAccount.mockImplementationOnce(() => {
            throw new Error('wrong Stripe account');
        });

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(makeContext('/es/campus/account') as any);

        expect(response.status).toBe(500);
        expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    });

    it('returns a controlled 500 when Stripe portal creation fails', async () => {
        await setSupabase(makeSupabase());
        stripeMock.billingPortal.sessions.create.mockRejectedValue(new Error('stripe unavailable'));

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(makeContext('/en/campus/account') as any);

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    });

    it('fails closed when the configured portal does not expose invoice history', async () => {
        await setSupabase(makeSupabase());
        stripeMock.billingPortal.configurations.retrieve.mockResolvedValueOnce({
            active: true,
            features: {
                payment_method_update: { enabled: true },
                invoice_history: { enabled: false },
                subscription_cancel: { enabled: true, mode: 'at_period_end' },
                subscription_update: { enabled: false },
            },
        });

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(makeContext('/es/campus/account') as any);

        expect(response.status).toBe(500);
        expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
    });
});
