import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    signOut: vi.fn(),
    single: vi.fn(),
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

function contextFor(lang: string, returnTo?: string) {
    const redirects: string[] = [];
    const url = new URL('http://localhost:4321/api/auth/post-login');
    url.searchParams.set('lang', lang);
    if (returnTo) url.searchParams.set('returnTo', returnTo);
    return {
        request: {
            url: url.toString(),
        },
        redirect: vi.fn((path: string) => {
            redirects.push(path);
            return new Response(null, { status: 302, headers: { Location: path } });
        }),
        redirects,
    };
}

describe('/api/auth/post-login', () => {
    const slotPublicId = '10000000-0000-4000-8000-000000000001';
    const englishReturnTo = `/en?checkoutSlot=${slotPublicId}#planes`;
    const spanishReturnTo = `/es?checkoutSlot=${slotPublicId}#planes`;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUser.mockResolvedValue({
            data: { user: { id: 'user-1', email: 'user@example.com' } },
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

    it.each([
        ['admin', '/es/campus/admin'],
        ['teacher', '/es/campus/teacher'],
        ['student', '/es/campus'],
        ['unexpected', '/es/campus'],
    ])('redirects %s profiles to the expected campus area', async (role, expectedPath) => {
        mocks.single.mockResolvedValue({
            data: {
                role,
                adult_confirmed: true,
                adult_confirmed_at: '2026-07-10T10:00:00.000Z',
                age_policy_version: '2026-07-10',
            },
            error: null,
        });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es');
        const response = await GET(context as any);

        expect(response.status).toBe(302);
        expect(context.redirect).toHaveBeenCalledWith(expectedPath);
    });

    it('normalizes unsupported language values before redirecting', async () => {
        mocks.single.mockResolvedValue({
            data: {
                role: 'admin',
                adult_confirmed: true,
                adult_confirmed_at: '2026-07-10T10:00:00.000Z',
                age_policy_version: '2026-07-10',
            },
            error: null,
        });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('https://evil.example/admin');
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith('/es/campus/admin');
    });

    it('returns only a verified student to an allowlisted public destination', async () => {
        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('en', englishReturnTo);
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith(
            englishReturnTo,
        );
    });

    it.each([
        'https://evil.example/es',
        '//evil.example/es',
        '/es/campus/admin',
        '/es/%63ampus/admin',
        '/es/login',
    ])('ignores unsafe or role-incompatible return destination %s', async (returnTo) => {
        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es', returnTo);
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith('/es/campus');
    });

    it.each([
        ['student', '/es/campus/classes?view=upcoming', '/es/campus/classes?view=upcoming'],
        ['teacher', '/es/campus/teacher/calendar?week=next', '/es/campus/teacher/calendar?week=next'],
        ['admin', '/es/campus/admin/packages?tab=drafts', '/es/campus/admin/packages?tab=drafts'],
        ['teacher', '/es/campus/account', '/es/campus/account'],
        ['admin', '/es/campus/support', '/es/campus/support'],
    ])('returns a %s to a compatible campus destination', async (role, returnTo, expected) => {
        mocks.single.mockResolvedValue({
            data: {
                role,
                adult_confirmed: true,
                adult_confirmed_at: '2026-07-10T10:00:00.000Z',
                age_policy_version: '2026-07-10',
            },
            error: null,
        });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es', returnTo);
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith(expected);
    });

    it.each([
        ['admin', '/es/campus/admin'],
        ['teacher', '/es/campus/teacher'],
    ])('does not override the %s role destination with a public return', async (role, expected) => {
        mocks.single.mockResolvedValue({
            data: {
                role,
                adult_confirmed: true,
                adult_confirmed_at: '2026-07-10T10:00:00.000Z',
                age_policy_version: '2026-07-10',
            },
            error: null,
        });
        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es', spanishReturnTo);
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith(expected);
    });

    it('redirects unauthenticated users back to the localized login page', async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('ru');
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith('/ru/login');
        expect(mocks.single).not.toHaveBeenCalled();
    });

    it('preserves a safe destination while sending an unauthenticated user back to login', async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('en', englishReturnTo);
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith(
            `/en/login?returnTo=${encodeURIComponent(englishReturnTo)}`,
        );
    });

    it('blocks the campus and clears the local session when the profile cannot be loaded', async () => {
        mocks.single.mockResolvedValue({ data: null, error: { message: 'missing profile' } });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('en');
        await GET(context as any);

        expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
        expect(context.redirect).toHaveBeenCalledWith('/en/login?error=adult-attestation-required');
    });

    it('blocks accounts whose persisted adult attestation is incomplete', async () => {
        mocks.single.mockResolvedValue({
            data: {
                role: 'student',
                adult_confirmed: true,
                adult_confirmed_at: null,
                age_policy_version: '2026-07-10',
            },
            error: null,
        });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es');
        await GET(context as any);

        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(context.redirect).toHaveBeenCalledWith('/es/adult-confirmation');
    });

    it('preserves a safe destination through adult confirmation', async () => {
        mocks.single.mockResolvedValue({
            data: {
                role: 'student',
                adult_confirmed: true,
                adult_confirmed_at: null,
                age_policy_version: '2026-07-10',
            },
            error: null,
        });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es', spanishReturnTo);
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith(
            `/es/adult-confirmation?returnTo=${encodeURIComponent(spanishReturnTo)}`,
        );
    });

    it.each([
        ['teacher', '/es/campus/teacher'],
        ['admin', '/es/campus/admin'],
    ])('keeps internal %s accounts operational without the student consumer attestation', async (role, expectedPath) => {
        mocks.single.mockResolvedValue({
            data: {
                role,
                adult_confirmed: false,
                adult_confirmed_at: null,
                age_policy_version: null,
            },
            error: null,
        });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es');
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith(expectedPath);
        expect(mocks.signOut).not.toHaveBeenCalled();
    });
});
