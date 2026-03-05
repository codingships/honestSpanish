export const config = {
    runtime: 'nodejs'
};
import type { APIRoute } from 'astro';
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

    try {
        // Create Supabase client with request cookies
        const supabase = createSupabaseServerClient(context);

        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();

        if (userError || !user) {
            console.log('[post-login] No user found, redirecting to login');
            return redirect(`/${safeLang}/login`);
        }

        // Get user role from profiles table
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (profileError) {
            console.log('[post-login] Error fetching profile:', profileError.message);
            // Default to student dashboard if profile fetch fails
            return redirect(`/${safeLang}/campus`);
        }

        const role = profile?.role || 'student';
        console.log('[post-login] User role:', role, '-> redirecting');

        // Redirect based on role
        switch (role) {
            case 'admin':
                return redirect(`/${safeLang}/campus/admin`);
            case 'teacher':
                return redirect(`/${safeLang}/campus/teacher`);
            case 'student':
            default:
                return redirect(`/${safeLang}/campus`);
        }
    } catch (error) {
        console.error('[post-login] Error:', error);
        return redirect(`/${safeLang}/campus`);
    }
};
