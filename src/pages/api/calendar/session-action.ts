import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { cancelClassEvent } from '../../../lib/google/calendar';

export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    const body = await context.request.json();
    const { sessionId, action, notes, reason } = body;

    if (!sessionId || !action) {
        return new Response(JSON.stringify({ error: 'sessionId and action are required' }), { status: 400 });
    }

    // Obtener la sesión
    const { data: session } = await supabase
        .from('sessions')
        .select('*, subscription:subscriptions(id, sessions_used), google_calendar_event_id')
        .eq('id', sessionId)
        .single();

    if (!session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
    }

    // Verificar permisos
    const canModify =
        profile?.role === 'admin' ||
        (profile?.role === 'teacher' && session.teacher_id === user.id) ||
        (profile?.role === 'student' && session.student_id === user.id && action === 'cancel');

    if (!canModify) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const updateData: any = { updated_at: new Date().toISOString() };
    let shouldUpdateSessionCount = false;
    let shouldCancelCalendarEvent = false;

    switch (action) {
        case 'complete':
            if (profile?.role === 'student') {
                return new Response(JSON.stringify({ error: 'Students cannot mark sessions as complete' }), { status: 403 });
            }
            updateData.status = 'completed';
            updateData.completed_at = new Date().toISOString();
            if (notes) updateData.teacher_notes = notes;
            shouldUpdateSessionCount = true;
            break;

        case 'cancel':
            // Verificar tiempo de antelación (24 horas para estudiantes)
            if (profile?.role === 'student') {
                const sessionTime = new Date(session.scheduled_at);
                const now = new Date();
                const hoursUntilSession = (sessionTime.getTime() - now.getTime()) / (1000 * 60 * 60);

                if (hoursUntilSession < 24) {
                    return new Response(JSON.stringify({
                        error: 'Sessions must be cancelled at least 24 hours in advance'
                    }), { status: 400 });
                }
            }
            updateData.status = 'cancelled';
            updateData.cancelled_at = new Date().toISOString();
            updateData.cancelled_by = user.id;
            if (reason) updateData.cancellation_reason = reason;
            shouldCancelCalendarEvent = true;
            break;

        case 'no_show':
            if (profile?.role === 'student') {
                return new Response(JSON.stringify({ error: 'Students cannot mark no-show' }), { status: 403 });
            }
            updateData.status = 'no_show';
            updateData.completed_at = new Date().toISOString();
            shouldUpdateSessionCount = true; // No-show cuenta como sesión usada
            break;

        case 'update_notes':
            if (profile?.role === 'student') {
                return new Response(JSON.stringify({ error: 'Students cannot update notes' }), { status: 403 });
            }
            updateData.teacher_notes = notes || '';
            break;

        default:
            return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
    }

    // Actualizar sesión
    const { error: updateError } = await supabase
        .from('sessions')
        .update(updateData)
        .eq('id', sessionId);

    if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
    }

    // Actualizar contador de sesiones si es necesario
    if (shouldUpdateSessionCount && session.subscription) {
        await supabase
            .from('subscriptions')
            .update({
                sessions_used: (session.subscription.sessions_used || 0) + 1
            })
            .eq('id', session.subscription.id);
    }

    // Cancelar evento de Calendar si es necesario
    if (shouldCancelCalendarEvent && session.google_calendar_event_id) {
        try {
            const cancelled = await cancelClassEvent(session.google_calendar_event_id);
            if (cancelled) {
                console.log(`[SessionAction] Cancelled calendar event ${session.google_calendar_event_id}`);
            } else {
                console.log(`[SessionAction] Failed to cancel calendar event (non-blocking)`);
            }
        } catch (error) {
            console.error('[SessionAction] Error cancelling calendar event (non-blocking):',
                error instanceof Error ? error.message : 'Unknown error');
        }
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

