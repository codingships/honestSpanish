import type { APIRoute } from 'astro';
import { z } from 'zod';
import { describeEmailSendError } from '../../../lib/email/errors';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { deliverEmail, sendSupportTicketReceivedEmail } from '../../../lib/email';
import { readRuntimeEnv } from '../../../lib/runtime-env';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Json } from '../../../types/database.types';

const supportAlertSchema = z.object({
    issueId: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/i),
    issueTitle: z.string().trim().min(3).max(120),
    message: z.string().trim().min(5).max(2000),
    pageUrl: z.string().trim().max(500).optional(),
    locale: z.enum(['es', 'en', 'ru']).default('es'),
});

function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return true;

    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function normalizePageUrl(value: string | undefined, requestUrl: string): string | null {
    if (!value) return null;

    try {
        const base = new URL(requestUrl).origin;
        const url = new URL(value, base);
        return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
        return null;
    }
}

function supportUrlForLocale(locale: 'es' | 'en' | 'ru', requestUrl: string) {
    const base = new URL(requestUrl).origin;
    return `${base}/${locale}/campus/support`;
}

async function sendSupportAlertEmail(input: {
    ticketId: string;
    issueTitle: string;
    message: string;
    pageUrl: string | null;
    profile: { email: string; full_name: string | null; role: string | null };
    userAgent: string | null;
}) {
    const to = readRuntimeEnv('SUPPORT_ALERT_EMAIL') ||
        readRuntimeEnv('ADMIN_EMAIL') ||
        'alejandro@espanolhonesto.com';
    const subjectTitle = input.issueTitle.replace(/[\r\n]+/g, ' ').slice(0, 90);
    const html = `
        <h2>Nuevo aviso de soporte</h2>
        <p><strong>Tipo:</strong> ${escapeHtml(input.issueTitle)}</p>
        <p><strong>Ticket:</strong> ${escapeHtml(input.ticketId)}</p>
        <p><strong>Usuario:</strong> ${escapeHtml(input.profile.full_name || '-')} (${escapeHtml(input.profile.email)})</p>
        <p><strong>Rol:</strong> ${escapeHtml(input.profile.role || '-')}</p>
        <p><strong>Pagina:</strong> ${escapeHtml(input.pageUrl || '-')}</p>
        <p><strong>User agent:</strong> ${escapeHtml(input.userAgent || '-')}</p>
        <hr />
        <p style="white-space: pre-wrap;">${escapeHtml(input.message)}</p>
    `;

    const result = await deliverEmail({
        to: [to],
        subject: `Soporte Espanol Honesto: ${subjectTitle}`,
        html,
        source: 'support_internal_alert',
    });

    if (!result.ok) {
        throw result.error ?? new Error(result.reason);
    }
}

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) {
        return json({ error: 'Forbidden' }, 403);
    }

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = supportAlertSchema.safeParse(rawBody);
    if (!parsed.success) {
        return json({ error: 'Invalid support alert payload' }, 400);
    }

    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('id', user.id)
        .single();

    if (profileError || !profile) {
        return json({ error: 'Profile not found' }, 404);
    }

    const userAgent = context.request.headers.get('User-Agent');
    const pageUrl = normalizePageUrl(parsed.data.pageUrl, context.request.url);
    const supportContext: Json = {
        locale: parsed.data.locale,
        profile: {
            email: profile.email,
            full_name: profile.full_name,
            role: profile.role,
        },
        request: {
            page_url: pageUrl,
            user_agent: userAgent,
        },
    };

    const ticketId = crypto.randomUUID();
    const { error: insertError } = await supabase
        .from('support_tickets')
        .insert({
            id: ticketId,
            user_id: user.id,
            issue_type: parsed.data.issueId,
            issue_title: parsed.data.issueTitle,
            message: parsed.data.message,
            page_url: pageUrl,
            user_agent: userAgent,
            context: supportContext,
        });

    if (insertError) {
        console.error('[SupportAlert] Could not create support ticket:', insertError);
        return json({ error: 'Could not create support ticket' }, 500);
    }

    const supabaseAdmin = createSupabaseAdminClient();

    await recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: user.id,
        email: profile.email,
        fullName: profile.full_name,
        actorId: user.id,
        source: 'support',
        sourcePath: pageUrl,
        activityType: 'support',
        subject: `Ticket de soporte creado: ${parsed.data.issueTitle}`,
        body: parsed.data.message,
        relatedEntityType: 'support_ticket_created',
        relatedEntityId: ticketId,
        metadata: {
            issue_type: parsed.data.issueId,
            page_url: pageUrl,
            locale: parsed.data.locale,
        },
    });

    let userEmailSent = true;
    try {
        userEmailSent = await sendSupportTicketReceivedEmail(profile.email, {
            recipientName: profile.full_name ?? undefined,
            issueTitle: parsed.data.issueTitle,
            ticketId,
            supportUrl: supportUrlForLocale(parsed.data.locale, context.request.url),
        });

        if (userEmailSent) {
            await recordCrmActivityForProfileSafe(supabaseAdmin, {
                profileId: user.id,
                email: profile.email,
                fullName: profile.full_name,
                actorId: user.id,
                source: 'support',
                sourcePath: pageUrl,
                activityType: 'email_out',
                subject: 'Support request received - Espanol Honesto',
                body: 'support_ticket_received',
                relatedEntityType: 'support_ticket_acknowledgement',
                relatedEntityId: ticketId,
                metadata: {
                    automated: true,
                    purpose: 'transactional',
                    template: 'support_ticket_received',
                    issue_type: parsed.data.issueId,
                    page_url: pageUrl,
                    locale: parsed.data.locale,
                },
            });
        }
    } catch (error) {
        userEmailSent = false;
        console.error('[SupportAlert] Ticket created but user acknowledgement failed:', describeEmailSendError(error));
    }

    let internalAlertSent = true;
    try {
        await sendSupportAlertEmail({
            ticketId,
            issueTitle: parsed.data.issueTitle,
            message: parsed.data.message,
            pageUrl,
            profile,
            userAgent,
        });
    } catch (error) {
        internalAlertSent = false;
        console.error('[SupportAlert] Ticket created but email alert failed:', describeEmailSendError(error));
    }

    return json({
        success: true,
        ticketId,
        emailSent: internalAlertSent,
        internalAlertSent,
        userEmailSent,
    });
};
