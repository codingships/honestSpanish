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
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mocks.runtimeEnv)) delete mocks.runtimeEnv[key];
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
});
