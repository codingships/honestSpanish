import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { cancelClassEvent } from '../../../lib/google/calendar';
import { sendClassCancelledToBoth } from '../../../lib/email';

// 👇 FIX 1: Forzamos Node.js para que funcionen las librerías de Google
export const config = {
    runtime: 'nodejs'
};

export const POST: APIRoute = async (context) => {
    // 👇 FIX 2: Inyectamos el tipo <Database>
    const supabase = createSupabaseServerClient(context);

    // Auth Check
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
    const { sessionId, action, reason } = body;

    if (!sessionId || !action) {
        return new Response(JSON.stringify({ error: 'Session ID and action are required' }), { status: 400 });
    }

    // 👇 FIX 3: Corregimos la query. Quitamos 'google_calendar_event_id' explícito
    // y confiamos en el '*' o usamos el nombre correcto 'calendar_event_id'.
    // También arreglamos el tipado de las relaciones.
    const { data: session, error: fetchError } = await supabase
        .from('sessions')
        .select(`
            *,
            student:profiles!sessions_student_id_fkey(full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(full_name, email),
            subscription:subscriptions(id, sessions_used)
        `)
        .eq('id', sessionId)
        .single();

    if (fetchError || !session) {
        return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
    }

    // Cast to access calendar_event_id which may not be in generated types yet
    const sessionData = session as typeof session & { calendar_event_id?: string | null };

    // Permission check
    const isTeacher = session.teacher_id === user.id;
    const isStudent = session.student_id === user.id;
    const isAdmin = profile?.role === 'admin';

    if (!isTeacher && !isStudent && !isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    if (action === 'cancel') {
        // 1. Update session status
        const { error: updateError } = await supabase
            .from('sessions')
            .update({
                status: 'cancelled',
                notes: reason ? `Cancelada: ${reason}` : 'Cancelada'
            })
            .eq('id', sessionId);

        if (updateError) {
            return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
        }

        // 2. Restore subscription usage (if needed)
        // 👇 FIX 4: Nullish coalescing para evitar error de 'possibly null'
        if (session.subscription) {
            // TypeScript a veces no infiere bien array vs objeto en joins, forzamos casting seguro
            const sub = Array.isArray(session.subscription) ? session.subscription[0] : session.subscription;

            if (sub) {
                const currentUsed = sub.sessions_used ?? 0;
                if (currentUsed > 0) {
                    await supabase
                        .from('subscriptions')
                        .update({ sessions_used: currentUsed - 1 })
                        .eq('id', sub.id);
                }
            }
        }

        // 3. Delete from Google Calendar
        // 👇 FIX 5: Usamos el nombre correcto de la columna: 'calendar_event_id'
        if (sessionData.calendar_event_id) {
            try {
                await cancelClassEvent(sessionData.calendar_event_id);

                // Clear event ID from session
                await supabase
                    .from('sessions')
                    .update({
                        calendar_event_id: null,
                        meet_link: null
                    })
                    .eq('id', sessionId);

            } catch (error) {
                console.error('Error deleting calendar event:', error);
            }
        }

        // 4. Send emails
        try {
            // Casting seguro para los profiles
            const student = Array.isArray(session.student) ? session.student[0] : session.student;
            const teacher = Array.isArray(session.teacher) ? session.teacher[0] : session.teacher;

            if (student?.email && teacher?.email && session.scheduled_at) {
                await sendClassCancelledToBoth(
                    student.email,
                    student.full_name || 'Estudiante',
                    teacher.email,
                    teacher.full_name || 'Profesor',
                    {
                        date: new Date(session.scheduled_at).toLocaleDateString(),
                        time: new Date(session.scheduled_at).toLocaleTimeString(),
                        reason: reason || 'Sin motivo especificado',
                        cancelledBy: isAdmin ? 'admin' : (isTeacher ? 'teacher' : 'student')
                    }
                );
            }
        } catch (error) {
            console.error('Error sending cancellation emails:', error);
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } else if (action === 'complete' || action === 'no_show' || action === 'update_notes') {
        // 👇 FIX 6: Security Fix (IDOR validation). 
        // Prevent students from marking their own classes as complete, no_show, or updating teacher notes.
        if (!isTeacher && !isAdmin) {
            return new Response(JSON.stringify({ error: 'Forbidden. Only teachers and admins can modify session states.' }), { status: 403 });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: any = { updated_at: new Date().toISOString() };

        if (action === 'complete') {
            updateData.status = 'completed';
            updateData.completed_at = new Date().toISOString();
        } else if (action === 'no_show') {
            updateData.status = 'no_show';
        }

        if (body.notes !== undefined) {
            updateData.teacher_notes = body.notes;
        }

        const { error: updateError } = await supabase
            .from('sessions')
            .update(updateData)
            .eq('id', sessionId);

        if (updateError) {
            return new Response(JSON.stringify({ error: updateError.message }), { status: 500 });
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
};