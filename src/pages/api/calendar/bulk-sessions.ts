import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { createClassDocument, getFileLink } from '../../../lib/google/drive';
import { createClassEvent } from '../../../lib/google/calendar';
import { sendClassConfirmationToBoth } from '../../../lib/email';

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
    const { studentId, teacherId, sessions: scheduledDates, durationMinutes = 60, meetLink } = body;

    if (!studentId || !scheduledDates || !Array.isArray(scheduledDates) || scheduledDates.length === 0) {
        return new Response(JSON.stringify({ error: 'studentId and an array of sessions dates are required' }), { status: 400 });
    }

    const finalTeacherId = profile.role === 'admin' && teacherId ? teacherId : user.id;

    // Verificar suscripción y saldo
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

    const sessionsUsed = subscription.sessions_used ?? 0;
    const sessionsTotal = subscription.sessions_total ?? 0;

    if (sessionsUsed + scheduledDates.length > sessionsTotal) {
        return new Response(JSON.stringify({
            error: `Not enough sessions remaining. Tried to schedule ${scheduledDates.length}, but only ${sessionsTotal - sessionsUsed} available.`
        }), { status: 400 });
    }

    const teacherProfileResult = await supabase
        .from('profiles')
        .select('email')
        .eq('id', finalTeacherId)
        .single();
    const teacherEmail = teacherProfileResult.data?.email;
    const { checkTeacherAvailability } = await import('../../../lib/google/calendar');

    // 1. VERIFICAR TODOS LOS CONFLICTOS ANTES DE INSERTAR NINGUNO (Atomicidad lógica)
    for (const dateStr of scheduledDates) {
        const scheduledDate = new Date(dateStr);
        const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

        // BBDD Conflict
        const { data: conflictingSessions } = await supabase
            .from('sessions')
            .select('id')
            .eq('teacher_id', finalTeacherId)
            .neq('status', 'cancelled')
            .gte('scheduled_at', scheduledDate.toISOString())
            .lt('scheduled_at', endTime.toISOString());

        if (conflictingSessions && conflictingSessions.length > 0) {
            return new Response(JSON.stringify({
                error: `Conflicto detectado el ${scheduledDate.toLocaleDateString()} a las ${scheduledDate.toLocaleTimeString()}. Hay una clase existente.`
            }), { status: 409 });
        }

        // Google Calendar Conflict
        if (teacherEmail) {
            const isFree = await checkTeacherAvailability(teacherEmail, scheduledDate, endTime);
            if (!isFree) {
                return new Response(JSON.stringify({
                    error: `Conflicto en Google Calendar del profesor el ${scheduledDate.toLocaleDateString()} a las ${scheduledDate.toLocaleTimeString()}.`
                }), { status: 409 });
            }
        }
    }

    // 2. INSERTAR TODAS LAS SESIONES EN BBDD
    const sessionsToInsert = scheduledDates.map((dateStr: string) => ({
        subscription_id: subscription.id,
        student_id: studentId,
        teacher_id: finalTeacherId,
        scheduled_at: dateStr,
        duration_minutes: durationMinutes,
        meet_link: meetLink || null,
        status: 'scheduled'
    }));

    const { data: createdSessions, error: insertError } = await supabase
        .from('sessions')
        .insert(sessionsToInsert)
        .select(`
            *,
            student:profiles!sessions_student_id_fkey(id, full_name, email, drive_folder_id, current_level),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
        `);

    if (insertError || !createdSessions) {
        return new Response(JSON.stringify({ error: insertError?.message || 'Error inserting sessions' }), { status: 500 });
    }

    // 3. ACTUALIZAR SALDO
    const { data: updatedSub } = await supabase
        .from('subscriptions')
        .update({ sessions_used: sessionsUsed + scheduledDates.length })
        .eq('id', subscription.id)
        .eq('sessions_used', sessionsUsed)
        .select('id')
        .single();

    if (!updatedSub) {
        // Concurrency abort
        const createdIds = createdSessions.map((s: { id: string }) => s.id);
        await supabase.from('sessions').update({ status: 'cancelled' }).in('id', createdIds);
        return new Response(JSON.stringify({ error: 'Concurrency error: No sessions remaining in subscription' }), { status: 409 });
    }

    // 4. LANZAR PROCESAMIENTO EN SEGUNDO PLANO
    processBulkBackgroundTasks(supabase, createdSessions);

    return new Response(JSON.stringify({
        message: `Successfully scheduled ${scheduledDates.length} sessions`,
        sessions: createdSessions
    }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};

/**
 * Procesa la creación de Carpetas y Eventos de Google iterativamente en la lambda de fondo.
 * IMPORTANTE: Hacemos pausas entre peticiones a Google para no superar el rate limit de Google Drive API.
 */
async function processBulkBackgroundTasks(supabase: any, sessions: any[]) {
    console.log(`[Sessions] Starting bulk background processing for ${sessions.length} sessions...`);

    // We send just ONE summary email at the very end rather than spamming the user with 24 individual emails.
    if (sessions.length === 0) return;

    const studentInfo = sessions[0].student;
    const teacherInfo = sessions[0].teacher;

    const studentEmail = studentInfo?.email;
    const studentName = studentInfo?.full_name || studentEmail?.split('@')[0] || 'Estudiante';
    const teacherEmail = teacherInfo?.email;
    const teacherName = teacherInfo?.full_name || 'Profesor';

    let studentFolderLink: string | null = null;
    if (studentInfo?.drive_folder_id) {
        try {
            studentFolderLink = await getFileLink(studentInfo.drive_folder_id);
        } catch (e) { console.error('Error fetching drive folder link', e); }
    }

    const processedClasses = [];

    for (const session of sessions) {
        let documentResult: { docId: string; docUrl: string } | null = null;
        let calendarResult: { eventId: string; meetLink: string; htmlLink: string } | null = null;

        try {
            // 1. Documento de Drive
            if (studentInfo?.drive_folder_id) {
                const level = (studentInfo.current_level || 'A2') as 'A2' | 'B1' | 'B2' | 'C1';
                documentResult = await createClassDocument({
                    studentName,
                    studentRootFolderId: studentInfo.drive_folder_id,
                    level,
                    classDate: new Date(session.scheduled_at),
                });
            }

            // 2. Evento Google Calendar
            if (studentEmail && teacherEmail) {
                const scheduledAt = new Date(session.scheduled_at);
                const endTime = new Date(scheduledAt.getTime() + (session.duration_minutes || 60) * 60000);

                calendarResult = await createClassEvent({
                    summary: `Clase de Español - ${studentName}`,
                    studentEmail,
                    teacherEmail,
                    startTime: scheduledAt,
                    endTime,
                    documentLink: documentResult?.docUrl,
                    studentFolderLink: studentFolderLink || undefined,
                });
            }

            // 3. Update BBDD with final links
            const updateData: Record<string, any> = {};
            if (documentResult) {
                updateData.drive_doc_id = documentResult.docId;
                updateData.drive_doc_url = documentResult.docUrl;
            }
            if (calendarResult) {
                updateData.meet_link = calendarResult.meetLink;
                updateData.calendar_event_id = calendarResult.eventId;
            }

            if (Object.keys(updateData).length > 0) {
                await supabase.from('sessions').update(updateData).eq('id', session.id);
            }

            processedClasses.push({
                date: new Date(session.scheduled_at),
                meetLink: calendarResult?.meetLink || session.meet_link,
                documentLink: documentResult?.docUrl
            });

            // Rate limit sleep (1 second between iterations to respect Google API quotas)
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error(`[Sessions] Error processing session ${session.id}:`, error);
        }
    }

    // 4. Enviar un ÚNICO Email de resumen al alumno y profesor
    /* 
       For now, we'll send a simplified email with just the first class link to avoid a massive email block. 
       In a real production environment, you'd create a specific email template in Resend for "Bulk Classes booked", 
       but for now we reuse the single confirmation template but phrasing it clearly if possible, or just send the first one.
    */
    if (processedClasses.length > 0 && studentEmail && teacherEmail) {
        try {
            const firstClass = processedClasses.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
            const dateStr = firstClass.date.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
            const timeStr = firstClass.date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

            // Reusing existing template
            await sendClassConfirmationToBoth(
                studentEmail,
                studentName,
                teacherEmail,
                teacherName,
                {
                    date: dateStr + ` (+ ${processedClasses.length - 1} clases agendadas)`,
                    time: timeStr,
                    duration: sessions[0].duration_minutes || 60,
                    meetLink: firstClass.meetLink,
                    documentLink: firstClass.documentLink,
                }
            );
            console.log(`[Sessions] Bulk confirmation emails sent successfully.`);
        } catch (emailError) {
            console.error('[Sessions] Error sending bulk summary email:', emailError);
        }
    }
}
