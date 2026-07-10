import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const originalEnv = { ...process.env };

function context(body: unknown, url = 'http://localhost:4321/api/demo/login') {
    return {
        request: {
            url,
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/demo/login', () => {
    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.clearAllMocks();
    });

    it('rejects demo login outside the allowed local or tunnel hosts before touching Supabase', async () => {
        process.env.DEMO_GUIDE_LOGIN_ENABLED = 'true';
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context(
            { role: 'student', lang: 'es' },
            'https://www.espanolhonesto.com/api/demo/login'
        ) as any);
        const body = await readJson(response);

        expect(response.status).toBe(403);
        expect(body.error).toContain('Login de demo desactivado');
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it('rejects local demo login when demo flags are disabled', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context({ role: 'student', lang: 'es' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(403);
        expect(body.error).toContain('pnpm dev:demo');
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it('rejects invalid demo roles before reading credentials', async () => {
        process.env.DEMO_GUIDE_LOGIN_ENABLED = 'true';
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context({ role: 'owner', lang: 'es' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.error).toBe('Rol de demo no valido.');
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it('reports missing role credentials without calling Supabase auth', async () => {
        process.env.DEMO_GUIDE_LOGIN_ENABLED = 'true';
        delete process.env.TEST_TEACHER_EMAIL;
        delete process.env.TEST_TEACHER_PASSWORD;
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context({ role: 'teacher', lang: 'en' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(500);
        expect(body.error).toContain('TEST_TEACHER_*');
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it('rejects admin demo login on public tunnel hosts before touching Supabase', async () => {
        process.env.DEMO_GUIDE_LOGIN_ENABLED = 'true';
        process.env.TEST_ADMIN_EMAIL = 'admin@example.com';
        process.env.TEST_ADMIN_PASSWORD = 'secret-password';
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context(
            { role: 'admin', lang: 'es' },
            'https://demo.trycloudflare.com/api/demo/login'
        ) as any);
        const body = await readJson(response);

        expect(response.status).toBe(403);
        expect(body.error).toContain('Login admin de demo desactivado');
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
    });

    it('signs in with demo credentials and returns the role redirect', async () => {
        process.env.DEMO_GUIDE_LOGIN_ENABLED = 'true';
        process.env.TEST_TEACHER_EMAIL = 'teacher@example.com';
        process.env.TEST_TEACHER_PASSWORD = 'secret-password';
        const signInWithPassword = vi.fn().mockResolvedValue({ error: null });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue({
            auth: { signInWithPassword },
        } as any);
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context({ role: 'teacher', lang: 'en' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(signInWithPassword).toHaveBeenCalledWith({
            email: 'teacher@example.com',
            password: 'secret-password',
        });
        expect(body.redirectTo).toBe('/en/campus/teacher');
    });

    it('returns a controlled 401 when Supabase rejects the demo credentials', async () => {
        process.env.DEMO_GUIDE_LOGIN_ENABLED = 'true';
        process.env.TEST_ADMIN_EMAIL = 'admin@example.com';
        process.env.TEST_ADMIN_PASSWORD = 'wrong-password';
        const signInWithPassword = vi.fn().mockResolvedValue({ error: { message: 'Invalid login credentials' } });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue({
            auth: { signInWithPassword },
        } as any);
        const { POST } = await import('../../src/pages/api/demo/login');

        const response = await POST(context({ role: 'admin', lang: 'ru' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(401);
        expect(body.error).toContain('No se pudo iniciar sesion admin');
        expect(body.error).toContain('Invalid login credentials');
    });
});
