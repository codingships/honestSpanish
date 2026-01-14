import type { APIRoute } from 'astro';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { createClassDocument } from '../../../lib/google/class-document';
import { getStudentFolderStructure } from '../../../lib/google/student-folder';
import { createClassEvent } from '../../../lib/google/calendar';
import { getFileLink } from '../../../lib/google/drive';
import { sendClassConfirmationToBoth } from '../../../lib/email';

// GET: Obtener sesiones
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

    // Filtros según rol
    if (profile?.role === 'student') {
        query = query.eq('student_id', user.id);
    } else if (profile?.role === 'teacher') {
        query = query.eq('teacher_id', user.id);
    }
    // Admin puede ver todo

    // Filtros opcionales
    if (studentId && profile?.role !== 'student') {
        query = query.eq('student_id', studentId);
    }
    if (teacherId) {
        query = query.eq('teacher_id', teacherId);
    }
    if (status) {
        query = query.eq('status', status);
    }
    if (from) {
        query = query.gte('scheduled_at', from);
    }
    if (to) {
        query = query.lte('scheduled_at', to);
    }

    const { data, error } = await query;

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ sessions: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

// POST: Crear nueva sesión (programar clase)
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

    // Solo teacher o admin pueden crear sesiones
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const body = await context.request.json();
    const { studentId, teacherId, scheduledAt, durationMinutes = 60, meetLink } = body;

    if (!studentId || !scheduledAt) {
        return new Response(JSON.stringify({ error: 'studentId and scheduledAt are required' }), { status: 400 });
    }

    // Determinar el profesor
    const finalTeacherId = profile.role === 'admin' && teacherId ? teacherId : user.id;

    // Verificar que el estudiante tiene suscripción activa con sesiones disponibles
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

    if (subscription.sessions_used >= subscription.sessions_total) {
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 400 });
    }

    // Verificar que el slot está disponible (no hay otra sesión)
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
        return new Response(JSON.stringify({ error: 'Time slot is not available' }), { status: 400 });
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
            meet_link: meetLink || null,
            status: 'scheduled'
        })
        .select()
        .single();

    if (sessionError) {
        return new Response(JSON.stringify({ error: sessionError.message }), { status: 500 });
    }

    // Create class document in Google Drive (non-blocking)
    createClassDocumentForSession(supabase, session, studentId, finalTeacherId);

    return new Response(JSON.stringify({ session }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};

/**
 * Create class document and calendar event for a scheduled session
 * Runs in background, doesn't block session creation
 */
async function createClassDocumentForSession(
    supabase: any,
    session: any,
    studentId: string,
    teacherId: string
): Promise<void> {
    let documentResult: { documentId: string; documentLink: string } | null = null;
    let calendarResult: { eventId: string; meetLink: string; htmlLink: string } | null = null;
    let studentFolderLink: string | null = null;

    try {
        // Get student data
        const { data: student } = await supabase
            .from('profiles')
            .select('id, full_name, email, drive_folder_id')
            .eq('id', studentId)
            .single();

        // Get teacher data
        const { data: teacher } = await supabase
            .from('profiles')
            .select('full_name, email')
            .eq('id', teacherId)
            .single();

        const studentName = student?.full_name || student?.email?.split('@')[0] || 'Estudiante';
        const teacherName = teacher?.full_name || 'Profesor';
        const teacherEmail = teacher?.email || '';
        const studentEmail = student?.email || '';
        const level = 'A1'; // TODO: Get from student profile or subscription

        // 1. Create class document if student has Drive folder
        if (student?.drive_folder_id) {
            try {
                // Get folder structure
                const folderStructure = await getStudentFolderStructure(
                    student.drive_folder_id,
                    studentName,
                    level
                );

                if (folderStructure) {
                    // Create class document
                    documentResult = await createClassDocument({
                        studentId,
                        studentName,
                        teacherName,
                        level,
                        classDate: new Date(session.scheduled_at),
                        exercisesFolderId: folderStructure.exercisesFolderId,
                        indexDocId: folderStructure.indexDocId || '',
                    });
                    console.log(`[Sessions] Created document for session ${session.id}: ${documentResult.documentId}`);
                }

                // Get student folder link
                studentFolderLink = await getFileLink(student.drive_folder_id);
            } catch (docError) {
                console.error('[Sessions] Error creating document (continuing with calendar):',
                    docError instanceof Error ? docError.message : 'Unknown error');
            }
        } else {
            console.log('[Sessions] Student has no Drive folder, skipping document creation');
        }

        // 2. Create Calendar event with Meet
        if (studentEmail && teacherEmail) {
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
                console.log(`[Sessions] Created calendar event for session ${session.id}: ${calendarResult.eventId}`);
            } catch (calError) {
                console.error('[Sessions] Error creating calendar event:',
                    calError instanceof Error ? calError.message : 'Unknown error');
            }
        } else {
            console.log('[Sessions] Missing email(s), skipping calendar event');
        }

        // 3. Update session with all gathered info
        const updateData: Record<string, any> = {};

        if (documentResult) {
            updateData.drive_doc_id = documentResult.documentId;
            updateData.drive_doc_link = documentResult.documentLink;
        }

        if (calendarResult) {
            updateData.meet_link = calendarResult.meetLink;
            updateData.google_calendar_event_id = calendarResult.eventId;
            updateData.google_meet_link = calendarResult.meetLink;
        }

        if (Object.keys(updateData).length > 0) {
            const { error: updateError } = await supabase
                .from('sessions')
                .update(updateData)
                .eq('id', session.id);

            if (updateError) {
                console.error('[Sessions] Error updating session:', updateError);
            } else {
                console.log(`[Sessions] Updated session ${session.id} with Google integration data`);
            }
        }

        // Send confirmation emails to both student and teacher
        try {
            const scheduledAt = new Date(session.scheduled_at);
            const dateStr = scheduledAt.toLocaleDateString('es-ES', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            const timeStr = scheduledAt.toLocaleTimeString('es-ES', {
                hour: '2-digit',
                minute: '2-digit'
            });

            await sendClassConfirmationToBoth(
                studentEmail,
                studentName,
                teacherEmail,
                teacherName,
                {
                    date: dateStr,
                    time: timeStr,
                    duration: session.duration_minutes || 60,
                    meetLink: calendarResult?.meetLink,
                    documentLink: documentResult?.documentLink,
                }
            );
            console.log(`[Sessions] Confirmation emails sent for session ${session.id}`);
        } catch (emailError) {
            console.error('[Sessions] Error sending confirmation emails (non-blocking):',
                emailError instanceof Error ? emailError.message : 'Unknown error');
        }

    } catch (error) {
        // Log error but don't fail - session is already created
        console.error('[Sessions] Error in Google integration (non-blocking):',
            error instanceof Error ? error.message : 'Unknown error');
    }
}


