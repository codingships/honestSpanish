import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Json } from '../../../types/database.types';

const jsonHeaders = { 'Content-Type': 'application/json' };
const ticketStatuses = ['open', 'triaged', 'closed'] as const;
const ticketPriorities = ['low', 'normal', 'high', 'urgent'] as const;

const updateTicketSchema = z.object({
    requestId: z.string().uuid(),
    ticketId: z.string().uuid(),
    expectedStatus: z.enum(ticketStatuses),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    status: z.enum(ticketStatuses).optional(),
    priority: z.enum(ticketPriorities).optional(),
    assignmentIsSet: z.boolean().default(false),
    assignedAdminId: z.string().uuid().nullable().optional(),
    messageKind: z.enum(['internal_note', 'public_reply']).optional(),
    message: z.string().trim().min(1).max(4000).optional(),
}).superRefine((value, context) => {
    if (Boolean(value.messageKind) !== Boolean(value.message)) {
        context.addIssue({ code: 'custom', message: 'Message kind and body must be provided together' });
    }
    if (!value.status && !value.priority && !value.assignmentIsSet && !value.message) {
        context.addIssue({ code: 'custom', message: 'Mutation has no effect' });
    }
});

type TicketStatus = typeof ticketStatuses[number];
type TicketPriority = typeof ticketPriorities[number];
type MutationResult = {
    ticket: {
        id: string;
        user_id: string;
        issue_type: string;
        issue_title: string;
        status: TicketStatus;
        priority: TicketPriority;
    };
    event: { id: string; event_type: string; body: string | null };
    replayed: boolean;
    notifyStudent: boolean;
    publicMessage: string | null;
};

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function normalizeLocale(value: string | null | undefined): 'es' | 'en' | 'ru' {
    return value === 'es' || value === 'ru' ? value : 'en';
}

function supportUrlForLocale(locale: 'es' | 'en' | 'ru', requestUrl: string) {
    return `${new URL(requestUrl).origin}/${locale}/campus/support`;
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

function mutationErrorStatus(message: string | undefined): number {
    if (message?.includes('not_found')) return 404;
    if (message?.includes('state_conflict') || message?.includes('request_id_conflicts')) return 409;
    if (message?.includes('not_admin')) return 403;
    if (message?.includes('invalid') || message?.includes('no_effect')) return 400;
    return 500;
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const ticketId = url.searchParams.get('ticketId');

    if (ticketId !== null) {
        if (!z.string().uuid().safeParse(ticketId).success) {
            return jsonResponse({ error: 'Invalid ticket id' }, 400);
        }

        const rawEventLimit = url.searchParams.get('eventLimit');
        const eventLimit = rawEventLimit === null ? 20 : Number(rawEventLimit);
        const rawBeforeSequence = url.searchParams.get('beforeSequence');
        const beforeSequence = rawBeforeSequence === null ? null : Number(rawBeforeSequence);
        if (!Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > 50
            || (beforeSequence !== null
                && (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1))) {
            return jsonResponse({ error: 'Invalid history pagination' }, 400);
        }

        const supabaseAdmin = createSupabaseAdminClient();
        let historyQuery = supabaseAdmin
            .from('support_ticket_events')
            .select('id, ticket_id, sequence, event_type, visibility, body, metadata, actor_id, created_at')
            .eq('ticket_id', ticketId)
            .order('sequence', { ascending: false });
        if (beforeSequence !== null) historyQuery = historyQuery.lt('sequence', beforeSequence);

        const { data, error } = await historyQuery.limit(eventLimit + 1);
        if (error) {
            console.error('[AdminSupportTickets] Could not load ticket history:', error);
            return jsonResponse({ error: 'Could not load support ticket history' }, 500);
        }

        const rows = data ?? [];
        const events = rows.slice(0, eventLimit);
        const hasMore = rows.length > eventLimit;
        return jsonResponse({
            events,
            hasMore,
            nextBeforeSequence: hasMore && events.length > 0
                ? events[events.length - 1].sequence
                : null,
        });
    }

    const status = url.searchParams.get('status') ?? 'open';
    const priority = url.searchParams.get('priority') ?? 'all';
    const assignee = url.searchParams.get('assignee') ?? 'all';
    const parsedPage = Number(url.searchParams.get('page') ?? 1);
    const parsedPageSize = Number(url.searchParams.get('pageSize') ?? 25);
    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const pageSize = Math.min(Number.isInteger(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 25, 100);

    if (status !== 'all' && !ticketStatuses.includes(status as TicketStatus)) {
        return jsonResponse({ error: 'Invalid status filter' }, 400);
    }
    if (priority !== 'all' && !ticketPriorities.includes(priority as TicketPriority)) {
        return jsonResponse({ error: 'Invalid priority filter' }, 400);
    }
    if (assignee !== 'all' && assignee !== 'unassigned' && !z.string().uuid().safeParse(assignee).success) {
        return jsonResponse({ error: 'Invalid assignee filter' }, 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    let query = supabaseAdmin
        .from('support_tickets')
        .select(`
            id, user_id, issue_type, issue_title, message, page_url, user_agent,
            status, priority, assigned_admin_id, created_at, updated_at,
            user:profiles!support_tickets_user_id_fkey(id, full_name, email, role),
            assigned_admin:profiles!support_tickets_assigned_admin_id_fkey(id, full_name, email)
        `, { count: 'exact' })
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false });

    if (status !== 'all') query = query.eq('status', status);
    if (priority !== 'all') query = query.eq('priority', priority);
    if (assignee === 'unassigned') query = query.is('assigned_admin_id', null);
    else if (assignee !== 'all') query = query.eq('assigned_admin_id', assignee);

    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.range(start, start + pageSize - 1);
    if (error) {
        console.error('[AdminSupportTickets] Could not load tickets:', error);
        return jsonResponse({ error: 'Could not load support tickets' }, 500);
    }

    const { data: admins, error: adminsError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'admin')
        .order('full_name', { ascending: true });

    if (adminsError) {
        console.error('[AdminSupportTickets] Could not load admins:', adminsError);
        return jsonResponse({ error: 'Could not load support administrators' }, 500);
    }

    return jsonResponse({
        tickets: data ?? [],
        admins: admins ?? [],
        pagination: { page, pageSize, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / pageSize) },
    });
};

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) return jsonResponse({ error: 'Forbidden' }, 403);

    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = updateTicketSchema.safeParse(rawBody);
    if (!parsed.success) return jsonResponse({ error: 'Invalid support ticket update' }, 400);

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('admin_mutate_support_ticket', {
        p_request_id: parsed.data.requestId,
        p_ticket_id: parsed.data.ticketId,
        p_admin_id: auth.user.id,
        p_expected_status: parsed.data.expectedStatus,
        p_expected_updated_at: parsed.data.expectedUpdatedAt,
        p_new_status: parsed.data.status ?? null,
        p_new_priority: parsed.data.priority ?? null,
        p_assignment_is_set: parsed.data.assignmentIsSet,
        p_assigned_admin_id: parsed.data.assignmentIsSet ? (parsed.data.assignedAdminId ?? null) : null,
        p_message_kind: parsed.data.messageKind ?? null,
        p_message_body: parsed.data.message ?? null,
    });

    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
        const message = error?.message;
        console.error('[AdminSupportTickets] Atomic mutation failed:', error);
        return jsonResponse({ error: 'Could not update support ticket' }, mutationErrorStatus(message));
    }

    const result = data as unknown as MutationResult;
    let userEmailSent = false;
    let notificationRisk: string | null = null;

    // A replay never resends. Delivery is deliberately best-effort: a crash after the
    // database commit can lose this email, but retrying cannot duplicate it.
    if (!result.replayed && result.notifyStudent) {
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('email, full_name, preferred_language')
            .eq('id', result.ticket.user_id)
            .single();

        if (profileError || !profile?.email) {
            notificationRisk = 'student_profile_unavailable';
        } else {
            try {
                const { sendSupportTicketUpdatedEmail } = await import('../../../lib/email');
                userEmailSent = await sendSupportTicketUpdatedEmail(profile.email, {
                    recipientName: profile.full_name ?? undefined,
                    issueTitle: result.ticket.issue_title,
                    ticketId: result.ticket.id,
                    status: result.ticket.status,
                    adminNote: result.publicMessage,
                    supportUrl: supportUrlForLocale(normalizeLocale(profile.preferred_language), context.request.url),
                });
                if (!userEmailSent) notificationRisk = 'provider_did_not_accept';
            } catch (emailError) {
                notificationRisk = 'delivery_failed_after_commit';
                console.error('[AdminSupportTickets] Mutation committed but email failed:', emailError);
            }
        }
    }

    if (!result.replayed) {
        await recordCrmActivityForProfileSafe(supabaseAdmin, {
            profileId: result.ticket.user_id,
            actorId: auth.user.id,
            source: 'support_admin',
            activityType: 'support',
            subject: `Ticket de soporte ${result.ticket.status}: ${result.ticket.issue_title}`,
            body: result.publicMessage,
            relatedEntityType: 'support_ticket_event',
            relatedEntityId: result.event.id,
            metadata: {
                ticket_id: result.ticket.id,
                issue_type: result.ticket.issue_type,
                status: result.ticket.status,
                priority: result.ticket.priority,
                event_type: result.event.event_type,
            } as Json,
        });
    }

    return jsonResponse({
        ticket: result.ticket,
        event: result.event,
        replayed: result.replayed,
        userEmailSent,
        notificationRisk,
    });
};
