import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const jsonHeaders = { 'Content-Type': 'application/json' };

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const url = new URL(context.request.url);
    const ticketId = url.searchParams.get('ticketId');
    const rawEventLimit = url.searchParams.get('eventLimit');
    const eventLimit = rawEventLimit === null ? 20 : Number(rawEventLimit);
    const rawBeforeSequence = url.searchParams.get('beforeSequence');
    const beforeSequence = rawBeforeSequence === null ? null : Number(rawBeforeSequence);

    if (!ticketId || !z.string().uuid().safeParse(ticketId).success
        || !Number.isSafeInteger(eventLimit) || eventLimit < 1 || eventLimit > 50
        || (beforeSequence !== null
            && (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1))) {
        return jsonResponse({ error: 'Invalid history pagination' }, 400);
    }

    const { data, error } = await supabase.rpc('get_my_support_ticket_events', {
        p_ticket_id: ticketId,
        p_limit: eventLimit + 1,
        p_before_sequence: beforeSequence,
    });

    if (error) {
        if (error.code === 'P0002' || error.message?.includes('support_ticket_not_found')) {
            return jsonResponse({ error: 'Support ticket not found' }, 404);
        }
        console.error('[SupportTickets] Could not load ticket history:', error);
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
};
