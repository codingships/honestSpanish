import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { createClassDocument, getFileLink } from '../../../lib/google/drive';
import { createClassEvent } from '../../../lib/google/calendar';
import { sendClassConfirmationToBoth } from '../../../lib/email';


// GET: Obtener sesiones (Sin cambios, solo añadido tipado)
export const GET: APIRoute = async (context) => {
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

    const url = new URL(context.request.url);
    const studentId = url.searchParams.get('studentId');
    const teacherId = url.searchParams.get('teacherId');
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    // Supabase complex joins query
    let query = supabase
        .from('sessions')
        .select(`
            *,
            student:profiles!sessions_student_id_fkey(id, full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email),
            subscription:subscriptions(
                id,
                packages(name, display_name)
            )
        `)
        .order('scheduled_at', { ascending: true });

    if (profile?.role === 'student') {
        query = query.eq('student_id', user.id);
    } else if (profile?.role === 'teacher') {
        query = query.eq('teacher_id', user.id);
    }

    if (studentId && profile?.role !== 'student') query = query.eq('student_id', studentId);
    if (teacherId) query = query.eq('teacher_id', teacherId);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('scheduled_at', from);
    if (to) query = query.lte('scheduled_at', to);

    const { data, error } = await query;

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ sessions: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

// POST: Crear nueva sesión
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

    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await context.request.json();
    // 👇 1. Extraemos el flag autoCreateMeeting (default true por seguridad)
    const { studentId, teacherId, scheduledAt, durationMinutes = 60, meetLink, autoCreateMeeting = true } = body;

    if (!studentId || !scheduledAt) {
        return new Response(JSON.stringify({ error: 'studentId and scheduledAt are required' }), { status: 400 });
    }

    const finalTeacherId = profile.role === 'admin' && teacherId ? teacherId : user.id;

    // Verificar suscripción
    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('id, sessions_used, sessions_total')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .gte('ends_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!subscription) {
        return new Response(JSON.stringify({ error: 'Student has no active subscription' }), { status: 400 });
    }

    // Corrección: Si es null, usamos 0 como valor por defecto
    const sessionsUsed = subscription.sessions_used ?? 0;
    const sessionsTotal = subscription.sessions_total ?? 0;

    if (sessionsUsed >= sessionsTotal) {
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 400 });
    }

    // Verificar conflictos (BBDD Local)
    const scheduledDate = new Date(scheduledAt);
    const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

    const { data: conflictingSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('teacher_id', finalTeacherId)
        .neq('status', 'cancelled')
        .gte('scheduled_at', scheduledDate.toISOString())
        .lt('scheduled_at', endTime.toISOString());

    if (conflictingSessions && conflictingSessions.length > 0) {
        return new Response(JSON.stringify({ error: 'Time slot is not available' }), { status: 409 });
    }

    // Verificar conflictos (Google Calendar Real)
    // Extraemos el email del profesor para consultarlo en Calendar
    const { data: teacherProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', finalTeacherId)
        .single();

    if (teacherProfile && teacherProfile.email) {
        // Necesitamos importar checkTeacherAvailability al inicio del archivo
        const { checkTeacherAvailability } = await import('../../../lib/google/calendar');
        const isFree = await checkTeacherAvailability(teacherProfile.email, scheduledDate, endTime);

        if (!isFree) {
            return new Response(JSON.stringify({
                error: 'El profesor tiene un evento en Google Calendar a esta hora. Por favor, elige otro bloque.'
            }), { status: 409 }); // 409 Conflict
        }
    }

    // Crear la sesión
    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .insert({
            subscription_id: subscription.id,
            student_id: studentId,
            teacher_id: finalTeacherId,
            scheduled_at: scheduledAt,
            duration_minutes: durationMinutes,
            meet_link: meetLink || null, // Guardamos el link manual si existe
            status: 'scheduled'
        })
        .select(`
            *,
            student:profiles!sessions_student_id_fkey(id, full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
        `)
        .single();

    if (sessionError) {
        return new Response(JSON.stringify({ error: sessionError.message }), { status: 500 });
    }

    // Increment sessions_used — optimistic lock: only updates if value hasn't changed concurrently
    const { data: updatedSub } = await supabase
        .from('subscriptions')
        .update({ sessions_used: sessionsUsed + 1 })
        .eq('id', subscription.id)
        .eq('sessions_used', sessionsUsed)
        .select('id')
        .single();

    if (!updatedSub) {
        // Another concurrent request already used the last session — cancel this one
        await supabase
            .from('sessions')
            .update({ status: 'cancelled' })
            .eq('id', session.id);
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 409 });
    }

    // 👇 2. Pasamos el flag a la función background
    createClassDocumentForSession(supabase, session, studentId, finalTeacherId, autoCreateMeeting);

    return new Response(JSON.stringify({ session }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};

/**
 * Background Task: Drive Docs, Calendar & Email
 */
async function createClassDocumentForSession(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: any,
    studentId: string,
    teacherId: string,
    shouldAutoCreateMeeting: boolean // 👇 Nuevo parámetro
): Promise<void> {
    let documentResult: { documentId: string; documentLink: string } | null = null;
    let calendarResult: { eventId: string; meetLink: string; htmlLink: string } | null = null;
    let studentFolderLink: string | null = null;

    try {
        // Datos del estudiante
        const { data: student } = await supabase
            .from('profiles')
            .select('id, full_name, email, drive_folder_id, current_level')
            .eq('id', studentId)
            .single();

        // Datos del profesor
        const { data: teacher } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', teacherId)
            .single();

        const studentName = student?.full_name || student?.email?.split('@')[0] || 'Estudiante';
        const teacherName = teacher?.full_name || 'Profesor';
        const teacherEmail = teacher?.email || '';
        const studentEmail = student?.email || '';

        // 1. SIEMPRE creamos el Documento de Clase (Drive)
        // Es buena práctica tener registro documental aunque la clase sea manual
        if (student?.drive_folder_id) {
            try {
                const level = (student?.current_level || 'A2') as 'A2' | 'B1' | 'B2' | 'C1';
                const docResult = await createClassDocument({
                    studentName,
                    studentRootFolderId: student.drive_folder_id,
                    level,
                    classDate: new Date(session.scheduled_at),
                });

                if (docResult) {
                    documentResult = {
                        documentId: docResult.docId,
                        documentLink: docResult.docUrl,
                    };
                }
                studentFolderLink = await getFileLink(student.drive_folder_id);
            } catch (docError) {
                console.error('[Sessions] Error creating document:', docError);
            }
        }

        // 2. SOLO creamos evento en Google Calendar si el flag es TRUE
        if (shouldAutoCreateMeeting && studentEmail && teacherEmail) {
            try {
                const scheduledAt = new Date(session.scheduled_at);
                const endTime = new Date(scheduledAt.getTime() + (session.duration_minutes || 60) * 60000);

                calendarResult = await createClassEvent({
                    summary: `Clase de Español - ${studentName}`,
                    studentEmail,
                    teacherEmail,
                    startTime: scheduledAt,
                    endTime,
                    documentLink: documentResult?.documentLink,
                    studentFolderLink: studentFolderLink || undefined,
                });
                console.log(`[Sessions] Created calendar event: ${calendarResult.eventId}`);
            } catch (calError) {
                console.error('[Sessions] Error creating calendar event:', calError);
            }
        } else {
            console.log('[Sessions] Calendar event skipped (Manual mode or missing emails)');
        }

        // 3. Actualizamos la sesión en DB
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateData: Record<string, any> = {};

        if (documentResult) {
            updateData.drive_doc_id = documentResult.documentId;
            updateData.drive_doc_url = documentResult.documentLink;
        }

        if (calendarResult) {
            updateData.meet_link = calendarResult.meetLink;
            updateData.calendar_event_id = calendarResult.eventId;
        }

        if (Object.keys(updateData).length > 0) {
            await supabase.from('sessions').update(updateData).eq('id', session.id);
        }

        // 4. Enviamos Emails (SIEMPRE, usando el link automático O el manual)
        try {
            const scheduledAt = new Date(session.scheduled_at);
            const dateStr = scheduledAt.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = scheduledAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

            // 👇 Determinamos qué link enviar
            // Si hay calendarResult, usamos ese. Si no, usamos el que venía en la sesión (manual)
            const finalMeetLink = calendarResult?.meetLink || session.meet_link;

            await sendClassConfirmationToBoth(
                studentEmail,
                studentName,
                teacherEmail,
                teacherName,
                {
                    date: dateStr,
                    time: timeStr,
                    duration: session.duration_minutes || 60,
                    meetLink: finalMeetLink, // Puede ser null si es manual y no pusieron nada
                    documentLink: documentResult?.documentLink,
                }
            );
            console.log(`[Sessions] Confirmation emails sent`);
        } catch (emailError) {
            console.error('[Sessions] Error sending emails:', emailError);
        }

    } catch (error) {
        console.error('[Sessions] Critical error in background task:', error);
    }
}