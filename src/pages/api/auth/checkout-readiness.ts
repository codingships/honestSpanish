import type { APIRoute } from 'astro';
import { hasVerifiedAdultAccount } from '../../../lib/adult-account';
import { isUnauthenticatedAuthError } from '../../../lib/auth-session';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const privateHeaders = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff',
};

function json(errorCode: string, status: number, retryAfter?: string): Response {
    const headers = new Headers(privateHeaders);
    if (retryAfter) headers.set('Retry-After', retryAfter);
    return new Response(JSON.stringify({ errorCode }), { status, headers });
}

export const GET: APIRoute = async (context) => {
    try {
        const supabase = createSupabaseServerClient(context);
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError && !isUnauthenticatedAuthError(authError)) {
            console.error('[checkout-readiness] Authentication check failed');
            return json('ACCOUNT_CHECK_UNAVAILABLE', 503, '5');
        }
        if (!user || authError) return json('AUTH_REQUIRED', 401);
        if (!user.email || !user.email_confirmed_at) {
            return json('ACCOUNT_NOT_ELIGIBLE', 403);
        }

        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, adult_confirmed, adult_confirmed_at, age_policy_version')
            .eq('id', user.id)
            .maybeSingle();

        if (profileError) {
            console.error('[checkout-readiness] Profile check failed');
            return json('ACCOUNT_CHECK_UNAVAILABLE', 503, '5');
        }
        if (!profile || profile.role !== 'student') {
            return json('ACCOUNT_NOT_ELIGIBLE', 403);
        }
        if (!hasVerifiedAdultAccount(profile)) {
            return json('ADULT_ATTESTATION_REQUIRED', 409);
        }

        return new Response(null, {
            status: 204,
            headers: {
                'Cache-Control': privateHeaders['Cache-Control'],
                'Vary': privateHeaders.Vary,
                'X-Content-Type-Options': privateHeaders['X-Content-Type-Options'],
            },
        });
    } catch {
        console.error('[checkout-readiness] Account check unavailable');
        return json('ACCOUNT_CHECK_UNAVAILABLE', 503, '5');
    }
};
