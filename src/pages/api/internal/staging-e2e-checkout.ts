import type { APIRoute } from 'astro';
import { hasVerifiedAdultAccount } from '../../../lib/adult-account';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { readRuntimeEnv } from '../../../lib/runtime-env';
import {
    issueStagingE2ECheckoutGrant,
    isStagingE2ESyntheticEmail,
    STAGING_E2E_CHECKOUT_CONFIRMATION,
    STAGING_E2E_CHECKOUT_COOKIE,
    STAGING_E2E_CHECKOUT_MAX_AGE_SECONDS,
} from '../../../lib/staging-e2e-checkout';

const jsonHeaders = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
};
const stagingOrigin = 'https://staging.espanolhonesto.com';
const runIdPattern = /^[a-z0-9][a-z0-9-]{7,63}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function json(payload: Record<string, unknown>, status: number): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function sameCanonicalOrigin(context: Parameters<APIRoute>[0]): boolean {
    return new URL(context.request.url).origin === stagingOrigin
        && context.request.headers.get('Origin') === stagingOrigin
        && readRuntimeEnv('PUBLIC_SITE_URL', context) === stagingOrigin;
}

function clearGrantCookie(context: Parameters<APIRoute>[0]): void {
    context.cookies.set(STAGING_E2E_CHECKOUT_COOKIE, '', {
        httpOnly: true,
        maxAge: 0,
        path: '/',
        sameSite: 'strict',
        secure: true,
    });
}

export const DELETE: APIRoute = async (context) => {
    if (!sameCanonicalOrigin(context)) return json({ error: 'Not found' }, 404);
    clearGrantCookie(context);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
};

export const POST: APIRoute = async (context) => {
    if (!sameCanonicalOrigin(context)) return json({ error: 'Not found' }, 404);
    if (context.request.headers.get('X-Staging-E2E-Confirmation') !== STAGING_E2E_CHECKOUT_CONFIRMATION) {
        return json({ error: 'Forbidden' }, 403);
    }

    const server = createSupabaseServerClient(context);
    const { data: { user }, error: authError } = await server.auth.getUser();
    if (authError || !user?.email || !user.email_confirmed_at) return json({ error: 'Unauthorized' }, 401);

    const admin = createSupabaseAdminClient();
    const { data: actor, error: actorError } = await admin
        .from('profiles')
        .select('id, role, email')
        .eq('id', user.id)
        .maybeSingle();
    const expectedAdminEmail = readRuntimeEnv('TEST_ADMIN_EMAIL', context)?.trim().toLowerCase();
    if (
        actorError
        || !actor
        || actor.role !== 'admin'
        || !expectedAdminEmail
        || user.email.trim().toLowerCase() !== expectedAdminEmail
        || actor.email?.trim().toLowerCase() !== expectedAdminEmail
    ) return json({ error: 'Forbidden' }, 403);

    let body: { runId?: unknown; slotPublicId?: unknown; studentId?: unknown };
    try {
        body = await context.request.json() as {
            runId?: unknown;
            slotPublicId?: unknown;
            studentId?: unknown;
        };
    } catch {
        return json({ error: 'Invalid request' }, 400);
    }
    if (
        typeof body.studentId !== 'string'
        || !uuidPattern.test(body.studentId)
        || typeof body.slotPublicId !== 'string'
        || !uuidPattern.test(body.slotPublicId)
        || typeof body.runId !== 'string'
        || !runIdPattern.test(body.runId)
    ) return json({ error: 'Invalid request' }, 400);

    const [{ data: target, error: targetError }, { data: targetAuth, error: targetAuthError }] = await Promise.all([
        admin
            .from('profiles')
            .select('id, role, email, adult_confirmed, adult_confirmed_at, age_policy_version')
            .eq('id', body.studentId)
            .maybeSingle(),
        admin.auth.admin.getUserById(body.studentId),
    ]);
    const targetEmail = target?.email?.trim().toLowerCase();
    if (
        targetError
        || targetAuthError
        || !target
        || target.role !== 'student'
        || !targetEmail
        || !isStagingE2ESyntheticEmail(targetEmail)
        || !hasVerifiedAdultAccount(target)
        || targetAuth.user?.email?.trim().toLowerCase() !== targetEmail
        || !targetAuth.user.email_confirmed_at
    ) return json({ error: 'Synthetic student is not eligible' }, 409);

    const grant = await issueStagingE2ECheckoutGrant({
        context,
        email: targetEmail,
        runId: body.runId,
        slotPublicId: body.slotPublicId,
        studentId: body.studentId,
    });
    if (!grant) return json({ error: 'Staging checkout lane is unavailable' }, 503);

    context.cookies.set(STAGING_E2E_CHECKOUT_COOKIE, grant.token, {
        httpOnly: true,
        maxAge: STAGING_E2E_CHECKOUT_MAX_AGE_SECONDS,
        path: '/',
        sameSite: 'strict',
        secure: true,
    });
    return json({ expiresAt: grant.expiresAt }, 201);
};
