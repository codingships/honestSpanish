import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import {
    ADMIN_EMAIL_PREVIEW_CACHE_CONTROL,
    ADMIN_EMAIL_PREVIEW_CSP,
} from '../../../lib/security-headers';
import {
    buildEmailPreview,
    emailPreviewLocales,
    emailPreviewTypes,
    isEmailPreviewLocale,
    isEmailPreviewType,
} from '../../../lib/email/previews';

function html(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: {
            'Cache-Control': ADMIN_EMAIL_PREVIEW_CACHE_CONTROL,
            'Content-Security-Policy': ADMIN_EMAIL_PREVIEW_CSP,
            'Content-Type': 'text/html; charset=utf-8',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'Referrer-Policy': 'no-referrer',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN',
        },
    });
}

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return html('<p>Unauthorized</p>', 401);

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (!profile || profile.role !== 'admin') return html('<p>Forbidden</p>', 403);

    const searchParams = new URL(context.request.url).searchParams;
    const type = searchParams.get('type') || 'welcome';
    const locale = searchParams.get('locale') || 'en';
    if (!isEmailPreviewType(type)) {
        return html(
            `<p>Invalid type. Must be one of: ${emailPreviewTypes.join(', ')}</p>`,
            400,
        );
    }
    if (!isEmailPreviewLocale(locale)) {
        return html(
            `<p>Invalid locale. Must be one of: ${emailPreviewLocales.join(', ')}</p>`,
            400,
        );
    }

    return html(buildEmailPreview(type, locale).html);
};
