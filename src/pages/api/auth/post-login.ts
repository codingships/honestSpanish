export const config = {
    runtime: 'nodejs'
};
import type { APIRoute } from 'astro';
import { ADULT_ATTESTATION_REQUIRED_QUERY, hasVerifiedAdultAccount } from '../../../lib/adult-account';
import {
    appendAuthReturnTo,
    resolveAuthReturnToForRole,
    sanitizeAuthReturnTo,
} from '../../../lib/auth-return-to';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

export const prerender = false;

/**
 * Post-login redirect endpoint
 * Handles role-based redirection server-side to avoid client-side redirect issues
 */
export const GET: APIRoute = async (context) => {
    const { request, redirect } = context;

    // Get language from query params
    const url = new URL(request.url);
    const lang = url.searchParams.get('lang') || 'es';

    // Validate language
    const validLangs = ['es', 'en', 'ru'];
    const safeLang = validLangs.includes(lang) ? lang : 'es';
    const returnTo = sanitizeAuthReturnTo(url.searchParams.get('returnTo'));

    try {
        // Create Supabase client with request cookies
        const supabase = createSupabaseServerClient(context);

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            console.log('[post-login] No user found, redirecting to login');
            return redirect(appendAuthReturnTo(`/${safeLang}/login`, returnTo));
        }

        // Get user role from profiles table
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, adult_confirmed, adult_confirmed_at, age_policy_version')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            console.log('[post-login] Missing account profile');
            await supabase.auth.signOut({ scope: 'local' });
            return redirect(appendAuthReturnTo(
                `/${safeLang}/login?error=${ADULT_ATTESTATION_REQUIRED_QUERY}`,
                returnTo,
            ));
        }

        const role = profile?.role || 'student';
        const roleReturnTo = resolveAuthReturnToForRole(returnTo, role, safeLang);

        if (role === 'student' && !hasVerifiedAdultAccount(profile)) {
            console.log('[post-login] Student must complete adult self-attestation');
            return redirect(appendAuthReturnTo(`/${safeLang}/adult-confirmation`, roleReturnTo));
        }

        console.log('[post-login] User role:', role, '-> redirecting');

        // Redirect based on role
        switch (role) {
            case 'admin':
                return redirect(roleReturnTo ?? `/${safeLang}/campus/admin`);
            case 'teacher':
                return redirect(roleReturnTo ?? `/${safeLang}/campus/teacher`);
            case 'student':
                return redirect(roleReturnTo ?? `/${safeLang}/campus`);
            default:
                return redirect(`/${safeLang}/campus`);
        }
    } catch (error) {
        console.error('[post-login] Error:', error);
        return redirect(`/${safeLang}/campus`);
    }
};
