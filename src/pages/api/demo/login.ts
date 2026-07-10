import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const prerender = false;

type DemoRole = 'student' | 'teacher' | 'admin';

const roles: DemoRole[] = ['student', 'teacher', 'admin'];
const langs = ['es', 'en', 'ru'];

type DemoLoginRequest = {
    role?: unknown;
    lang?: unknown;
};

export const POST: APIRoute = async (context) => {
    const { request } = context;
    const url = new URL(request.url);

    const enabled = getDemoLoginState(url.hostname);
    if (!enabled.ok) {
        return json({ error: enabled.message }, 403);
    }

    const body = await request.json().catch(() => ({})) as DemoLoginRequest;
    const role = typeof body.role === 'string' && roles.includes(body.role as DemoRole) ? body.role as DemoRole : null;
    const lang = typeof body.lang === 'string' && langs.includes(body.lang) ? body.lang : 'es';

    if (!role) {
        return json({ error: 'Rol de demo no valido.' }, 400);
    }

    if (role === 'admin' && !isLocalDemoHost(url.hostname)) {
        return json({ error: 'Login admin de demo desactivado fuera de localhost.' }, 403);
    }

    const credentials = getDemoCredentials(role);
    if (!credentials.email || !credentials.password) {
        return json({ error: `Faltan credenciales TEST_${role.toUpperCase()}_* en .env.test.` }, 500);
    }

    const supabase = createSupabaseServerClient(context);
    const { error } = await supabase.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
    });

    if (error) {
        return json({ error: `No se pudo iniciar sesion ${role}: ${error.message}` }, 401);
    }

    return json({ redirectTo: getRoleRedirect(role, lang) });
};

function getDemoLoginState(hostname: string): { ok: true } | { ok: false; message: string } {
    const isAllowedHost = isLocalDemoHost(hostname)
        || hostname.endsWith('.trycloudflare.com');

    if (!isAllowedHost) {
        return {
            ok: false,
            message: `Login de demo desactivado para este host (${hostname}). Usa localhost o el tunel trycloudflare.`,
        };
    }

    if (readFlag('DEMO_GUIDE_ENABLED') || readFlag('DEMO_GUIDE_LOGIN_ENABLED')) {
        return { ok: true };
    }

    return {
        ok: false,
        message: 'Login de demo desactivado. Arranca con pnpm dev:demo o define DEMO_GUIDE_LOGIN_ENABLED=true.',
    };
}

function isLocalDemoHost(hostname: string): boolean {
    return hostname === 'localhost'
        || hostname === '127.0.0.1'
        || hostname === '0.0.0.0'
        || hostname.endsWith('.localhost');
}

function getDemoCredentials(role: DemoRole): { email?: string; password?: string } {
    switch (role) {
        case 'admin':
            return {
                email: readEnv('TEST_ADMIN_EMAIL'),
                password: readEnv('TEST_ADMIN_PASSWORD'),
            };
        case 'teacher':
            return {
                email: readEnv('TEST_TEACHER_EMAIL'),
                password: readEnv('TEST_TEACHER_PASSWORD'),
            };
        case 'student':
        default:
            return {
                email: readEnv('TEST_STUDENT_EMAIL'),
                password: readEnv('TEST_STUDENT_PASSWORD'),
            };
    }
}

function readEnv(key: keyof ImportMetaEnv): string | undefined {
    const value = import.meta.env[key];
    const nodeEnv = typeof process !== 'undefined' ? process.env[key] : undefined;
    return typeof value === 'string' ? value || nodeEnv : nodeEnv;
}

function readFlag(key: keyof ImportMetaEnv): boolean {
    return readEnv(key) === 'true';
}

function getRoleRedirect(role: DemoRole, lang: string): string {
    switch (role) {
        case 'admin':
            return `/${lang}/campus/admin`;
        case 'teacher':
            return `/${lang}/campus/teacher`;
        case 'student':
        default:
            return `/${lang}/campus`;
    }
}

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
        },
    });
}
