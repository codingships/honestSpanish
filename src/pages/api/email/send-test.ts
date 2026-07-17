import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import {
    buildEmailPreview,
    emailPreviewLocales,
    emailPreviewTypes,
    isEmailPreviewLocale,
    isEmailPreviewType,
    sendEmailPreview,
} from '../../../lib/email/previews';
import { describeEmailSendError } from '../../../lib/email/errors';

const sendTestSchema = z.object({
    type: z.enum(emailPreviewTypes),
    email: z.string().trim().email(),
    locale: z.enum(emailPreviewLocales).optional(),
});

async function requireAdmin(context: Parameters<APIRoute>[0]) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return { error: 'Unauthorized', status: 401 as const };
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (!profile || profile.role !== 'admin') {
        return { error: 'Forbidden', status: 403 as const };
    }

    return { user };
}

function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if ('error' in auth) return json({ error: auth.error }, auth.status);

    const type = new URL(context.request.url).searchParams.get('type') || 'welcome';
    const locale = new URL(context.request.url).searchParams.get('locale') || 'en';
    if (!isEmailPreviewType(type)) {
        return json({ error: `Invalid type. Must be one of: ${emailPreviewTypes.join(', ')}` }, 400);
    }
    if (!isEmailPreviewLocale(locale)) {
        return json({ error: `Invalid locale. Must be one of: ${emailPreviewLocales.join(', ')}` }, 400);
    }

    return json(buildEmailPreview(type, locale));
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if ('error' in auth) return json({ error: auth.error }, auth.status);

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = sendTestSchema.safeParse(rawBody);
    if (!parsed.success) {
        return json({ error: 'Invalid email test payload' }, 400);
    }

    try {
        const success = await sendEmailPreview(
            parsed.data.type,
            parsed.data.email,
            parsed.data.locale ?? 'en',
        );
        return json({
            success,
            message: success
                ? `Test email (${parsed.data.type}) sent to ${parsed.data.email}`
                : 'Failed to send email',
        }, success ? 200 : 500);
    } catch (error) {
        console.error('[EmailTest] Error sending preview:', describeEmailSendError(error));
        return json({ error: 'Failed to send test email' }, 500);
    }
};
