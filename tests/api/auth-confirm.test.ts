import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    exchangeCodeForSession: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => ({
        auth: {
            exchangeCodeForSession: mocks.exchangeCodeForSession,
        },
    })),
}));

function contextFor(search = '') {
    return {
        request: new Request(`http://localhost:4321/api/auth/confirm${search}`),
        cookies: {
            has: vi.fn().mockReturnValue(false),
            get: vi.fn(),
            set: vi.fn(),
        },
    };
}

describe('/api/auth/confirm', () => {
    const slotPublicId = '10000000-0000-4000-8000-000000000001';
    const englishReturnTo = `/en?checkoutSlot=${slotPublicId}#planes`;
    const russianReturnTo = `/ru?checkoutSlot=${slotPublicId}#planes`;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    });

    it('exchanges a PKCE code and redirects only to the localized internal post-login route', async () => {
        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor('?code=valid-code&lang=en') as any);

        expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('valid-code');
        expect(response.status).toBe(303);
        expect(response.headers.get('location')).toBe('/api/auth/post-login?lang=en');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('preserves an allowlisted destination through a successful code exchange', async () => {
        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor(
            `?code=valid-code&lang=en&returnTo=${encodeURIComponent(englishReturnTo)}`,
        ) as any);

        expect(response.headers.get('location')).toBe(
            `/api/auth/post-login?lang=en&returnTo=${encodeURIComponent(englishReturnTo)}`,
        );
    });

    it('allowlists the locale and ignores redirect-like input', async () => {
        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor('?code=valid-code&lang=https%3A%2F%2Fevil.example') as any);

        expect(response.headers.get('location')).toBe('/api/auth/post-login?lang=es');
    });

    it.each([
        'https%3A%2F%2Fevil.example%2Fes',
        '%2F%2Fevil.example%2Fes',
        '%2Fes%2Fcampus%2Fadmin',
        '%2Fes%2F%2563ampus%2Fadmin',
        '%2Fes%3FcheckoutSlot%3Dnot-a-uuid%23planes',
    ])('drops unsafe return input %s', async (returnTo) => {
        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor(`?code=valid-code&lang=es&returnTo=${returnTo}`) as any);

        expect(response.headers.get('location')).toBe('/api/auth/post-login?lang=es');
    });

    it('returns a generic localized login error when the code is absent', async () => {
        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor('?lang=ru') as any);

        expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
        expect(response.headers.get('location')).toBe('/ru/login?error=confirmation-failed');
        expect(await response.text()).toBe('');
    });

    it('keeps an allowlisted destination when confirmation must be retried', async () => {
        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor(
            `?lang=ru&returnTo=${encodeURIComponent(russianReturnTo)}`,
        ) as any);

        expect(response.headers.get('location')).toBe(
            `/ru/login?error=confirmation-failed&returnTo=${encodeURIComponent(russianReturnTo)}`,
        );
    });

    it('does not expose provider error details when the exchange fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.exchangeCodeForSession.mockResolvedValue({
            data: {},
            error: { message: 'sensitive provider detail', code: 'bad_code_verifier' },
        });

        const { GET } = await import('../../src/pages/api/auth/confirm');
        const response = await GET(contextFor('?code=expired&lang=es') as any);

        expect(response.headers.get('location')).toBe('/es/login?error=confirmation-failed');
        expect(response.headers.get('location')).not.toContain('sensitive');
        expect(consoleError).toHaveBeenCalledWith('[auth-confirm] Confirmation code exchange failed');
    });
});
