import type { APIRoute } from 'astro';
import { appendAuthReturnTo, sanitizeAuthReturnTo } from '../../../lib/auth-return-to';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const supportedLanguages = new Set(['es', 'en', 'ru']);

function safeLanguage(value: string | null): string {
    return value && supportedLanguages.has(value) ? value : 'es';
}

function privateRedirect(location: string): Response {
    return new Response(null, {
        status: 303,
        headers: {
            Location: location,
            'Cache-Control': 'private, no-store',
        },
    });
}

export const GET: APIRoute = async (context) => {
    const url = new URL(context.request.url);
    const lang = safeLanguage(url.searchParams.get('lang'));
    const returnTo = sanitizeAuthReturnTo(url.searchParams.get('returnTo'));
    const failureLocation = appendAuthReturnTo(`/${lang}/login?error=confirmation-failed`, returnTo);
    const code = url.searchParams.get('code')?.trim();

    if (!code) {
        return privateRedirect(failureLocation);
    }

    try {
        const supabase = createSupabaseServerClient(context);
        const { error } = await supabase.auth.exchangeCodeForSession(code);

        if (error) {
            console.error('[auth-confirm] Confirmation code exchange failed');
            return privateRedirect(failureLocation);
        }

        return privateRedirect(appendAuthReturnTo(`/api/auth/post-login?lang=${lang}`, returnTo));
    } catch {
        console.error('[auth-confirm] Confirmation code exchange failed');
        return privateRedirect(failureLocation);
    }
};
