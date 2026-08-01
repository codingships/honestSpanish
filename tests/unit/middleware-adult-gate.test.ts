import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runtimeEnv: {} as Record<string, string | undefined>,
    getUser: vi.fn(),
    signOut: vi.fn(),
    single: vi.fn(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.runtimeEnv[key]),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => ({
        auth: {
            getUser: mocks.getUser,
            signOut: mocks.signOut,
        },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: mocks.single,
        })),
    })),
}));

function middlewareContext(path: string) {
    return {
        request: new Request(`https://example.com${path}`),
        redirect: vi.fn((location: string) => new Response(null, {
            status: 302,
            headers: { Location: location },
        })),
    };
}

describe('campus adult-account middleware gate', () => {
    const slotPublicId = '10000000-0000-4000-8000-000000000001';
    const englishReturnTo = `/en?checkoutSlot=${slotPublicId}#planes`;
    const spanishReturnTo = `/es?checkoutSlot=${slotPublicId}#planes`;

    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mocks.runtimeEnv)) delete mocks.runtimeEnv[key];
        mocks.runtimeEnv.PUBLIC_APP_ENV = 'test';
        mocks.getUser.mockResolvedValue({
            data: { user: { id: 'user-1' } },
            error: null,
        });
        mocks.signOut.mockResolvedValue({ error: null });
        mocks.single.mockResolvedValue({
            data: {
                role: 'student',
                adult_confirmed: true,
                adult_confirmed_at: '2026-07-10T10:00:00.000Z',
                age_policy_version: '2026-07-10',
            },
            error: null,
        });
    });

    it('allows an authenticated account with complete persisted evidence into campus', async () => {
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/es/campus');
        const next = vi.fn().mockResolvedValue(new Response('ok'));

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(200);
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.signOut).not.toHaveBeenCalled();
    });

    it('routes an existing student to the server-backed confirmation flow when evidence is absent', async () => {
        mocks.single.mockResolvedValue({
            data: {
                role: 'student',
                adult_confirmed: false,
                adult_confirmed_at: null,
                age_policy_version: null,
            },
            error: null,
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/en/campus/classes');
        const next = vi.fn();

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/en/adult-confirmation');
        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('routes an unattested student from login to confirmation without signing out', async () => {
        mocks.single.mockResolvedValue({
            data: {
                role: 'student',
                adult_confirmed: true,
                adult_confirmed_at: null,
                age_policy_version: '2026-07-10',
            },
            error: null,
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/ru/login');
        const next = vi.fn();

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/ru/adult-confirmation');
        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('returns an authenticated verified student from login to a safe public destination', async () => {
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext(`/en/login?returnTo=${encodeURIComponent(englishReturnTo)}`);
        const next = vi.fn();

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(englishReturnTo);
        expect(next).not.toHaveBeenCalled();
    });

    it('does not let a safe public return override an authenticated internal role destination', async () => {
        mocks.single.mockResolvedValue({
            data: {
                role: 'admin',
                adult_confirmed: false,
                adult_confirmed_at: null,
                age_policy_version: null,
            },
            error: null,
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext(`/es/login?returnTo=${encodeURIComponent(spanishReturnTo)}`);
        const next = vi.fn();

        const response = await onRequest(context as any, next) as Response;

        expect(response.headers.get('Location')).toBe('/es/campus/admin');
        expect(next).not.toHaveBeenCalled();
    });

    it.each(['teacher', 'admin'])('does not apply the student consumer gate to internal %s accounts', async (role) => {
        mocks.single.mockResolvedValue({
            data: {
                role,
                adult_confirmed: false,
                adult_confirmed_at: null,
                age_policy_version: null,
            },
            error: null,
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext(`/es/campus/${role}`);
        const next = vi.fn().mockResolvedValue(new Response('ok'));

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(200);
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.signOut).not.toHaveBeenCalled();
    });

    it('blocks every application route while production is in bootstrap mode', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/es/login');
        const next = vi.fn();

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(503);
        expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
        await expect(response.json()).resolves.toEqual({ errorCode: 'WEB_RUNTIME_BOOTSTRAP' });
        expect(next).not.toHaveBeenCalled();
        expect(mocks.getUser).not.toHaveBeenCalled();
    });

    it.each(['/health', '/api/internal/runtime-attestation'])(
        'allows only the bootstrap diagnostic route %s',
        async (path) => {
            Object.assign(mocks.runtimeEnv, {
                PUBLIC_APP_ENV: 'production',
                WEB_RUNTIME_MODE: 'bootstrap',
            });
            const { onRequest } = await import('../../src/middleware');
            const context = middlewareContext(path);
            const next = vi.fn().mockResolvedValue(new Response('diagnostic'));

            const response = await onRequest(context as any, next) as Response;

            expect(response.status).toBe(200);
            expect(next).toHaveBeenCalledOnce();
            expect(mocks.getUser).not.toHaveBeenCalled();
        },
    );

    it('adds the global robots header to a public staging response', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/es');
        const next = vi.fn().mockResolvedValue(new Response('<html></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }));

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('X-Frame-Options')).toBe('DENY');
        expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('adds the global robots header to a staging redirect created by the auth gate', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
        });
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/es/campus');
        const next = vi.fn();

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/es/login');
        expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow, noarchive');
        expect(next).not.toHaveBeenCalled();
    });

    it('does not add the staging robots header to active production responses', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/es');
        const next = vi.fn().mockResolvedValue(new Response('<html></html>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }));

        const response = await onRequest(context as any, next) as Response;

        expect(response.status).toBe(200);
        expect(response.headers.has('X-Robots-Tag')).toBe(false);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.getUser).not.toHaveBeenCalled();
    });

    it('forces no-store caching on hosted API responses', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/api/example');
        const next = vi.fn().mockResolvedValue(new Response('{}', {
            headers: { 'Cache-Control': 'public, max-age=3600' },
        }));

        const response = await onRequest(context as any, next) as Response;

        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('forces private no-store caching on authenticated and recovery pages', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { onRequest } = await import('../../src/middleware');
        const context = middlewareContext('/es/campus');

        const response = await onRequest(context as any, vi.fn()) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    });

    it('normalizes the production environment before enforcing bootstrap mode', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: ' Production ',
            WEB_RUNTIME_MODE: 'bootstrap',
        });
        const { onRequest } = await import('../../src/middleware');
        const next = vi.fn();

        const response = await onRequest(middlewareContext('/es') as any, next) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ errorCode: 'WEB_RUNTIME_BOOTSTRAP' });
        expect(next).not.toHaveBeenCalled();
    });

    it.each([undefined, 'prodcution'])(
        'fails closed when the hosted environment contract is invalid (%s)',
        async (appEnvironment) => {
            if (appEnvironment) mocks.runtimeEnv.PUBLIC_APP_ENV = appEnvironment;
            else delete mocks.runtimeEnv.PUBLIC_APP_ENV;
            const { onRequest } = await import('../../src/middleware');
            const next = vi.fn();

            const response = await onRequest(middlewareContext('/es') as any, next) as Response;

            expect(response.status).toBe(503);
            await expect(response.json()).resolves.toEqual({ errorCode: 'PUBLIC_APP_ENV_INVALID' });
            expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
            expect(response.headers.get('Cache-Control')).toContain('no-store');
            expect(next).not.toHaveBeenCalled();
        },
    );

    it.each(['/es//login', '//es/login'])(
        'keeps normalized login redirects private and non-cacheable for %s',
        async (path) => {
            Object.assign(mocks.runtimeEnv, {
                PUBLIC_APP_ENV: 'production',
                WEB_RUNTIME_MODE: 'active',
            });
            mocks.single.mockResolvedValue({
                data: {
                    role: 'admin',
                    adult_confirmed: false,
                    adult_confirmed_at: null,
                    age_policy_version: null,
                },
                error: null,
            });
            const { onRequest } = await import('../../src/middleware');

            const response = await onRequest(middlewareContext(path) as any, vi.fn()) as Response;

            expect(response.status).toBe(302);
            expect(response.headers.get('Location')).toBe('/es/campus/admin');
            expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        },
    );

    it('does not treat a longer unknown path as the login page', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const next = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));

        const response = await onRequest(middlewareContext('/es/login/extra') as any, next) as Response;

        expect(response.status).toBe(404);
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(response.headers.has('Cache-Control')).toBe(false);
    });

    it('does not let encoded localized route segments bypass the authentication gate', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
        const { onRequest } = await import('../../src/middleware');
        const next = vi.fn();

        const response = await onRequest(
            middlewareContext('/es/%63ampus/admin') as any,
            next,
        ) as Response;

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe('/es/login');
        expect(next).not.toHaveBeenCalled();
    });

    it('does not decode a localized route segment twice', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const next = vi.fn().mockResolvedValue(new Response('not found', { status: 404 }));

        const response = await onRequest(
            middlewareContext('/es/%2563ampus/admin') as any,
            next,
        ) as Response;

        expect(response.status).toBe(404);
        expect(next).toHaveBeenCalledOnce();
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(response.headers.has('Cache-Control')).toBe(false);
    });

    it('applies API cache controls to encoded route segments', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const next = vi.fn().mockResolvedValue(new Response('{}'));

        const response = await onRequest(
            middlewareContext('/%61pi/example') as any,
            next,
        ) as Response;

        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
    });

    it('preserves the isolated same-origin policy for the authenticated email preview frame', async () => {
        Object.assign(mocks.runtimeEnv, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
        });
        const { onRequest } = await import('../../src/middleware');
        const next = vi.fn().mockResolvedValue(new Response('<html></html>', {
            headers: {
                'Cache-Control': 'private, no-store',
                'Referrer-Policy': 'no-referrer',
            },
        }));

        const response = await onRequest(
            middlewareContext('/api/email/preview-frame?type=welcome') as any,
            next,
        ) as Response;

        expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
        expect(response.headers.get('Cache-Control')).toBe('private, no-store, no-cache, must-revalidate');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
        expect(response.headers.get('Content-Security-Policy')).toContain("style-src 'unsafe-inline'");
    });
});
