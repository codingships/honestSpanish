import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { sendSupportTicketUpdatedEmail } from '../../../lib/email';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Json } from '../../../types/database.types';

const jsonHeaders = { 'Content-Type': 'application/json' };
const ticketStatuses = ['open', 'triaged', 'closed'] as const;

const updateTicketSchema = z.object({
    ticketId: z.string().uuid(),
    status: z.enum(ticketStatuses),
    adminNotes: z.string().trim().max(2000).optional(),
});

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function normalizeLocale(value: string | null | undefined): 'es' | 'en' | 'ru' {
    return value === 'es' || value === 'ru' ? value : 'en';
}

function supportUrlForLocale(locale: 'es' | 'en' | 'ru', requestUrl: string) {
    const base = new URL(requestUrl).origin;
    return `${base}/${locale}/campus/support`;
}

function shouldNotifyStudent(before: { status?: string | null; admin_notes?: string | null }, after: { status?: string | null; admin_notes?: string | null }) {
    return before.status !== after.status || (Boolean(after.admin_notes?.trim()) && before.admin_notes !== after.admin_notes);
}

async function requireAdmin(context: APIContext) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: jsonResponse({ error: 'Unauthorized' }, 401), user: null };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'admin') {
        return { error: jsonResponse({ error: 'Forbidden' }, 403), user: null };
    }

    return { error: null, user };
}

async function logAudit(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; entityId: string; before?: Json | null; after?: Json | null }
) {
    const { error } = await supabaseAdmin
        .from('admin_audit_log')
        .insert({
            admin_id: input.adminId,
            action: 'support_ticket.update',
            entity_type: 'support_ticket',
            entity_id: input.entityId,
            before: input.before ?? null,
            after: input.after ?? null,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminSupportTickets] Failed to write audit log:', error);
    }
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const status = url.searchParams.get('status');
    const parsedLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 50, 100);
    const supabaseAdmin = createSupabaseAdminClient();

    let query = supabaseAdmin
        .from('support_tickets')
        .select(`
            *,
            user:profiles!support_tickets_user_id_fkey(id, full_name, email, role)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (status && status !== 'all') {
        if (!ticketStatuses.includes(status as typeof ticketStatuses[number])) {
            return jsonResponse({ error: 'Invalid status filter' }, 400);
        }
        query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) {
        console.error('[AdminSupportTickets] Could not load tickets:', error);
        return jsonResponse({ error: 'Could not load support tickets' }, 500);
    }

    return jsonResponse({ tickets: data ?? [] });
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = updateTicketSchema.safeParse(rawBody);
    if (!parsed.success) {
        return jsonResponse({ error: 'Invalid support ticket update' }, 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('support_tickets')
        .select('*')
        .eq('id', parsed.data.ticketId)
        .single();

    if (beforeError || !before) {
        return jsonResponse({ error: 'Ticket not found' }, 404);
    }

    const { data: ticket, error } = await supabaseAdmin
        .from('support_tickets')
        .update({
            status: parsed.data.status,
            admin_notes: parsed.data.adminNotes ?? before.admin_notes,
        })
        .eq('id', parsed.data.ticketId)
        .select('*')
        .single();

    if (error || !ticket) {
        console.error('[AdminSupportTickets] Could not update ticket:', error);
        return jsonResponse({ error: 'Could not update support ticket' }, 500);
    }

    await logAudit(supabaseAdmin, {
        adminId: auth.user.id,
        entityId: parsed.data.ticketId,
        before: before as Json,
        after: ticket as Json,
    });

    await recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: ticket.user_id,
        actorId: auth.user.id,
        source: 'support_admin',
        activityType: 'support',
        subject: `Ticket de soporte ${ticket.status}: ${ticket.issue_title}`,
        body: ticket.admin_notes || ticket.message || null,
        relatedEntityType: 'support_ticket_update',
        relatedEntityId: `${ticket.id}:${ticket.status}`,
        metadata: {
            ticket_id: ticket.id,
            issue_type: ticket.issue_type,
            status: ticket.status,
            previous_status: before.status,
        },
    });

    let userEmailSent = false;
    if (shouldNotifyStudent(before, ticket)) {
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('email, full_name, preferred_language')
            .eq('id', ticket.user_id)
            .single();

        if (profileError || !profile?.email) {
            console.error('[AdminSupportTickets] Could not load ticket owner for support update email:', profileError);
        } else {
            const supportUrl = supportUrlForLocale(normalizeLocale(profile.preferred_language), context.request.url);
            try {
                userEmailSent = await sendSupportTicketUpdatedEmail(profile.email, {
                    recipientName: profile.full_name ?? undefined,
                    issueTitle: ticket.issue_title,
                    ticketId: ticket.id,
                    status: ticket.status,
                    adminNote: ticket.admin_notes,
                    supportUrl,
                });

                if (userEmailSent) {
                    await recordCrmActivityForProfileSafe(supabaseAdmin, {
                        profileId: ticket.user_id,
                        email: profile.email,
                        fullName: profile.full_name,
                        actorId: auth.user.id,
                        source: 'support_admin',
                        sourcePath: supportUrl,
                        activityType: 'email_out',
                        subject: 'Support request updated - Espanol Honesto',
                        body: 'support_ticket_updated',
                        relatedEntityType: 'support_ticket_update_email',
                        relatedEntityId: `${ticket.id}:${ticket.status}`,
                        metadata: {
                            automated: false,
                            purpose: 'transactional',
                            template: 'support_ticket_updated',
                            ticket_id: ticket.id,
                            issue_type: ticket.issue_type,
                            status: ticket.status,
                            previous_status: before.status,
                            admin_note_included: Boolean(ticket.admin_notes?.trim()),
                        },
                    });
                }
            } catch (emailError) {
                userEmailSent = false;
                console.error('[AdminSupportTickets] Ticket updated but support update email failed:', emailError);
            }
        }
    }

    return jsonResponse({ ticket, userEmailSent });
};
