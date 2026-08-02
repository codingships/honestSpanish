import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    maybeSingle: vi.fn(),
    from: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => ({
        auth: { getUser: mocks.getUser },
        from: mocks.from,
    })),
}));

function context() {
    return {
        request: new Request('https://staging.espanolhonesto.com/api/auth/checkout-readiness'),
        cookies: {
            has: vi.fn().mockReturnValue(false),
            get: vi.fn(),
            set: vi.fn(),
        },
    };
}

function eligibleUser() {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'student@example.com',
        email_confirmed_at: '2035-01-01T00:00:00.000Z',
    };
}

function profileResult(overrides: Record<string, unknown> = {}) {
    return {
        data: {
            role: 'student',
            adult_confirmed: true,
            adult_confirmed_at: '2035-01-01T00:00:00.000Z',
            age_policy_version: '2026-07-10',
            ...overrides,
        },
        error: null,
    };
}

describe('/api/auth/checkout-readiness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.getUser.mockResolvedValue({ data: { user: eligibleUser() }, error: null });
        mocks.maybeSingle.mockResolvedValue(profileResult());
        const query = {
            select: vi.fn(),
            eq: vi.fn(),
            maybeSingle: mocks.maybeSingle,
        };
        query.select.mockReturnValue(query);
        query.eq.mockReturnValue(query);
        mocks.from.mockReturnValue(query);
    });

    it('returns only a private 204 for an eligible authenticated student', async () => {
        const { GET } = await import('../../src/pages/api/auth/checkout-readiness');
        const response = await GET(context() as never) as Response;

        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('vary')).toBe('Cookie');
        expect(response.headers.get('content-type')).toBeNull();
        expect(mocks.from).toHaveBeenCalledWith('profiles');
    });

    it('requires login without exposing identity or querying a profile', async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { GET } = await import('../../src/pages/api/auth/checkout-readiness');
        const response = await GET(context() as never) as Response;
        const body = await response.text();

        expect(response.status).toBe(401);
        expect(JSON.parse(body)).toEqual({ errorCode: 'AUTH_REQUIRED' });
        expect(body).not.toContain('student@example.com');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(mocks.from).not.toHaveBeenCalled();
    });

    it('routes an authenticated student through adult confirmation before checkout terms', async () => {
        mocks.maybeSingle.mockResolvedValue(profileResult({ adult_confirmed: false }));
        const { GET } = await import('../../src/pages/api/auth/checkout-readiness');
        const response = await GET(context() as never) as Response;

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ errorCode: 'ADULT_ATTESTATION_REQUIRED' });
    });

    it.each([
        [{ ...eligibleUser(), email_confirmed_at: null }, profileResult()],
        [eligibleUser(), { data: null, error: null }],
        [eligibleUser(), profileResult({ role: 'teacher' })],
    ])('rejects an account that is not eligible for direct student checkout', async (user, profile) => {
        mocks.getUser.mockResolvedValue({ data: { user }, error: null });
        mocks.maybeSingle.mockResolvedValue(profile);
        const { GET } = await import('../../src/pages/api/auth/checkout-readiness');
        const response = await GET(context() as never) as Response;

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ errorCode: 'ACCOUNT_NOT_ELIGIBLE' });
    });

    it.each([
        [{ data: { user: null }, error: { status: 500, code: 'provider_unavailable' } }, profileResult()],
        [{ data: { user: eligibleUser() }, error: null }, { data: null, error: { code: 'PGRST000' } }],
    ])('fails closed and remains retryable when account verification is unavailable', async (auth, profile) => {
        mocks.getUser.mockResolvedValue(auth);
        mocks.maybeSingle.mockResolvedValue(profile);
        const { GET } = await import('../../src/pages/api/auth/checkout-readiness');
        const response = await GET(context() as never) as Response;

        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('5');
        await expect(response.json()).resolves.toEqual({ errorCode: 'ACCOUNT_CHECK_UNAVAILABLE' });
    });
});
