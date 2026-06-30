import type { SupabaseClient } from '@supabase/supabase-js';
import { createClassEvent } from '../google/calendar';
import { createClassDocument, getFileLink } from '../google/drive';
import { getPrivateProfiles } from '../profiles-private';
import { sendClassConfirmation } from '../email';
import { recordClassEmailOutInCrmSafe } from '../crm/class-email';
import { DEFAULT_CLASS_DURATION_MINUTES } from '../class-duration';
import type { Database } from '../../types/database.types';

type ProfileJoin = {
    id: string;
    full_name?: string | null;
    email?: string | null;
};

type SessionWithJoins = Database['public']['Tables']['sessions']['Row'] & {
    student?: ProfileJoin | ProfileJoin[] | null;
    teacher?: ProfileJoin | ProfileJoin[] | null;
};

type ProcessedClass = {
    session: SessionWithJoins;
    date: Date;
    meetLink?: string | null;
    documentLink?: string | null;
};

type FulfillmentOptions = {
    autoCreateMeeting?: boolean;
    sendEmail?: boolean;
};

function one<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatClassDate(date: Date): string {
    return date.toLocaleDateString('es-ES', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function formatClassTime(date: Date): string {
    return date.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

async function sendConfirmationOrThrow(
    studentEmail: string,
    studentName: string,
    teacherEmail: string,
    teacherName: string,
    classDetails: {
        date: string;
        time: string;
        duration: number;
        meetLink?: string | null;
        documentLink?: string | null;
    }
) {
    const studentSent = await sendClassConfirmation(studentEmail, {
        recipientName: studentName,
        isTeacher: false,
        otherPartyName: teacherName,
        ...classDetails,
        meetLink: classDetails.meetLink ?? undefined,
        documentLink: classDetails.documentLink ?? undefined,
    });

    const teacherSent = await sendClassConfirmation(teacherEmail, {
        recipientName: teacherName,
        isTeacher: true,
        otherPartyName: studentName,
        ...classDetails,
        meetLink: classDetails.meetLink ?? undefined,
        documentLink: classDetails.documentLink ?? undefined,
    });

    if (!studentSent || !teacherSent) {
        throw new Error('Resend did not accept one or more class confirmation emails');
    }
}

async function loadSessions(
    supabaseAdmin: SupabaseClient<Database>,
    sessionIds: string[]
): Promise<SessionWithJoins[]> {
    const uniqueIds = [...new Set(sessionIds.filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const { data, error } = await supabaseAdmin
        .from('sessions')
        .select(`
            *,
            student:profiles!sessions_student_id_fkey(id, full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
        `)
        .in('id', uniqueIds);

    if (error) {
        throw error;
    }

    const order = new Map(uniqueIds.map((id, index) => [id, index]));
    return ((data ?? []) as SessionWithJoins[]).sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    );
}

async function createArtifactsForSession(
    supabaseAdmin: SupabaseClient<Database>,
    session: SessionWithJoins,
    options: Required<FulfillmentOptions>,
    privateProfiles: Awaited<ReturnType<typeof getPrivateProfiles>>
): Promise<ProcessedClass | null> {
    if (!session.scheduled_at) return null;

    const student = one(session.student);
    const teacher = one(session.teacher);
    const studentName = student?.full_name || student?.email?.split('@')[0] || 'Estudiante';
    const studentEmail = student?.email || '';
    const teacherEmail = teacher?.email || '';
    const studentPrivate = privateProfiles.get(session.student_id);

    let documentLink = session.drive_doc_url;
    let documentId = session.drive_doc_id;
    let studentFolderLink: string | null = null;

    if (studentPrivate?.drive_folder_id) {
        if (!documentId || !documentLink) {
            const level = (studentPrivate.current_level || 'A2') as 'A2' | 'B1' | 'B2' | 'C1';
            const docResult = await createClassDocument({
                studentName,
                studentRootFolderId: studentPrivate.drive_folder_id,
                level,
                classDate: new Date(session.scheduled_at),
            });

            if (docResult) {
                documentId = docResult.docId;
                documentLink = docResult.docUrl;
            }
        }

        studentFolderLink = await getFileLink(studentPrivate.drive_folder_id);
    }

    let meetLink = session.meet_link;
    let calendarEventId = session.calendar_event_id;

    if (options.autoCreateMeeting && !calendarEventId && studentEmail && teacherEmail) {
        const scheduledAt = new Date(session.scheduled_at);
        const durationMinutes = session.duration_minutes || DEFAULT_CLASS_DURATION_MINUTES;
        const endTime = new Date(scheduledAt.getTime() + durationMinutes * 60000);

        const calendarResult = await createClassEvent({
            summary: `Clase de Español - ${studentName}`,
            studentEmail,
            teacherEmail,
            startTime: scheduledAt,
            endTime,
            documentLink: documentLink ?? undefined,
            studentFolderLink: studentFolderLink ?? undefined,
        });

        meetLink = calendarResult.meetLink;
        calendarEventId = calendarResult.eventId;
    }

    const updateData: Database['public']['Tables']['sessions']['Update'] = {};
    if (documentId && documentId !== session.drive_doc_id) updateData.drive_doc_id = documentId;
    if (documentLink && documentLink !== session.drive_doc_url) updateData.drive_doc_url = documentLink;
    if (meetLink && meetLink !== session.meet_link) updateData.meet_link = meetLink;
    if (calendarEventId && calendarEventId !== session.calendar_event_id) updateData.calendar_event_id = calendarEventId;

    if (Object.keys(updateData).length > 0) {
        const { error } = await supabaseAdmin
            .from('sessions')
            .update(updateData)
            .eq('id', session.id);

        if (error) {
            throw error;
        }
    }

    return {
        session,
        date: new Date(session.scheduled_at),
        meetLink,
        documentLink,
    };
}

export async function fulfillSingleSession(
    supabaseAdmin: SupabaseClient<Database>,
    sessionId: string,
    options: FulfillmentOptions = {}
) {
    const sessions = await loadSessions(supabaseAdmin, [sessionId]);
    if (sessions.length === 0) {
        throw new Error(`Session ${sessionId} not found`);
    }

    const privateProfiles = await getPrivateProfiles(
        sessions.map((session) => session.student_id),
        supabaseAdmin
    );

    const effectiveOptions = {
        autoCreateMeeting: options.autoCreateMeeting ?? true,
        sendEmail: options.sendEmail ?? true,
    };

    const processedClass = await createArtifactsForSession(
        supabaseAdmin,
        sessions[0],
        effectiveOptions,
        privateProfiles
    );

    if (!processedClass || !effectiveOptions.sendEmail) return;

    const session = sessions[0];
    const student = one(session.student);
    const teacher = one(session.teacher);
    if (!student?.email || !teacher?.email) {
        throw new Error(`Session ${session.id} is missing student or teacher email`);
    }

    const classDetails = {
        date: formatClassDate(processedClass.date),
        time: formatClassTime(processedClass.date),
        duration: session.duration_minutes || DEFAULT_CLASS_DURATION_MINUTES,
        meetLink: processedClass.meetLink,
        documentLink: processedClass.documentLink,
    };

    await sendConfirmationOrThrow(
        student.email,
        student.full_name || student.email.split('@')[0] || 'Estudiante',
        teacher.email,
        teacher.full_name || 'Profesor',
        classDetails
    );

    await recordClassEmailOutInCrmSafe(supabaseAdmin, {
        template: 'class_confirmation',
        sessionId: session.id,
        studentId: student.id || session.student_id,
        studentEmail: student.email,
        studentName: student.full_name,
        teacherId: teacher.id || session.teacher_id,
        teacherEmail: teacher.email,
        teacherName: teacher.full_name,
        subscriptionId: session.subscription_id,
        scheduledAt: session.scheduled_at,
        durationMinutes: classDetails.duration,
        dateLabel: classDetails.date,
        timeLabel: classDetails.time,
        meetLink: classDetails.meetLink,
        documentLink: classDetails.documentLink,
        source: 'session_fulfillment',
    });
}

export async function fulfillSessionBatch(
    supabaseAdmin: SupabaseClient<Database>,
    sessionIds: string[],
    options: FulfillmentOptions = {}
) {
    const sessions = await loadSessions(supabaseAdmin, sessionIds);
    if (sessions.length === 0) {
        throw new Error('No sessions found for batch fulfillment');
    }

    const privateProfiles = await getPrivateProfiles(
        sessions.map((session) => session.student_id),
        supabaseAdmin
    );

    const effectiveOptions = {
        autoCreateMeeting: options.autoCreateMeeting ?? true,
        sendEmail: options.sendEmail ?? true,
    };

    const processedClasses: ProcessedClass[] = [];
    for (const session of sessions) {
        const processedClass = await createArtifactsForSession(
            supabaseAdmin,
            session,
            effectiveOptions,
            privateProfiles
        );
        if (processedClass) processedClasses.push(processedClass);
    }

    if (!effectiveOptions.sendEmail || processedClasses.length === 0) return;

    const firstSession = sessions[0];
    const student = one(firstSession.student);
    const teacher = one(firstSession.teacher);
    if (!student?.email || !teacher?.email) {
        throw new Error('Batch fulfillment is missing student or teacher email');
    }

    const firstClass = processedClasses.sort((a, b) => a.date.getTime() - b.date.getTime())[0];
    const classDetails = {
        date: `${formatClassDate(firstClass.date)} (+ ${processedClasses.length - 1} clases agendadas)`,
        time: formatClassTime(firstClass.date),
        duration: firstSession.duration_minutes || DEFAULT_CLASS_DURATION_MINUTES,
        meetLink: firstClass.meetLink,
        documentLink: firstClass.documentLink,
    };

    await sendConfirmationOrThrow(
        student.email,
        student.full_name || student.email.split('@')[0] || 'Estudiante',
        teacher.email,
        teacher.full_name || 'Profesor',
        classDetails
    );

    const batchSessionIds = processedClasses.map((processedClass) => processedClass.session.id);
    await Promise.all(processedClasses.map((processedClass) => recordClassEmailOutInCrmSafe(supabaseAdmin, {
        template: 'class_confirmation',
        sessionId: processedClass.session.id,
        studentId: student.id || processedClass.session.student_id,
        studentEmail: student.email,
        studentName: student.full_name,
        teacherId: teacher.id || processedClass.session.teacher_id,
        teacherEmail: teacher.email,
        teacherName: teacher.full_name,
        subscriptionId: processedClass.session.subscription_id,
        scheduledAt: processedClass.session.scheduled_at,
        durationMinutes: processedClass.session.duration_minutes || DEFAULT_CLASS_DURATION_MINUTES,
        dateLabel: formatClassDate(processedClass.date),
        timeLabel: formatClassTime(processedClass.date),
        meetLink: processedClass.meetLink,
        documentLink: processedClass.documentLink,
        source: 'bulk_session_fulfillment',
        extraMetadata: {
            batch_size: processedClasses.length,
            batch_session_ids: batchSessionIds,
        },
    })));
}
