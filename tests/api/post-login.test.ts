import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    single: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => ({
        auth: {
            getUser: mocks.getUser,
        },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: mocks.single,
        })),
    })),
}));

function contextFor(lang: string) {
    const redirects: string[] = [];
    return {
        request: {
            url: `http://localhost:4321/api/auth/post-login?lang=${encodeURIComponent(lang)}`,
        },
        redirect: vi.fn((path: string) => {
            redirects.push(path);
            return new Response(null, { status: 302, headers: { Location: path } });
        }),
        redirects,
    };
}

describe('/api/auth/post-login', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUser.mockResolvedValue({
            data: { user: { id: 'user-1', email: 'user@example.com' } },
            error: null,
        });
        mocks.single.mockResolvedValue({ data: { role: 'student' }, error: null });
    });

    it.each([
        ['admin', '/es/campus/admin'],
        ['teacher', '/es/campus/teacher'],
        ['student', '/es/campus'],
        ['unexpected', '/es/campus'],
    ])('redirects %s profiles to the expected campus area', async (role, expectedPath) => {
        mocks.single.mockResolvedValue({ data: { role }, error: null });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('es');
        const response = await GET(context as any);

        expect(response.status).toBe(302);
        expect(context.redirect).toHaveBeenCalledWith(expectedPath);
    });

    it('normalizes unsupported language values before redirecting', async () => {
        mocks.single.mockResolvedValue({ data: { role: 'admin' }, error: null });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('https://evil.example/admin');
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith('/es/campus/admin');
    });

    it('redirects unauthenticated users back to the localized login page', async () => {
        mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('ru');
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith('/ru/login');
        expect(mocks.single).not.toHaveBeenCalled();
    });

    it('falls back to the student campus when the profile cannot be loaded', async () => {
        mocks.single.mockResolvedValue({ data: null, error: { message: 'missing profile' } });

        const { GET } = await import('../../src/pages/api/auth/post-login');
        const context = contextFor('en');
        await GET(context as any);

        expect(context.redirect).toHaveBeenCalledWith('/en/campus');
    });
});
