import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database.types';
import { sendClassRescheduled } from '../email';
import { updateCalendarEvent } from '../google/calendar';
import { DEFAULT_CLASS_DURATION_MINUTES } from '../class-duration';
import {
    FulfillmentEffectError,
    runFulfillmentCalendarPatchEffect,
} from './effects';
import { FulfillmentDependencyPendingError } from './dependency';
import type { FulfillmentJobPayload, FulfillmentJobRow } from './queue';

type ProfileJoin = {
    id: string;
    email?: string | null;
    full_name?: string | null;
    preferred_language?: string | null;
};

type RescheduleSession = Pick<
    Database['public']['Tables']['sessions']['Row'],
    | 'id'
    | 'student_id'
    | 'teacher_id'
    | 'scheduled_at'
    | 'duration_minutes'
    | 'calendar_event_id'
    | 'meet_link'
    | 'drive_doc_url'
    | 'status'
> & {
    student?: ProfileJoin | ProfileJoin[] | null;
    teacher?: ProfileJoin | ProfileJoin[] | null;
};

export { FulfillmentDependencyPendingError } from './dependency';

function one<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function locale(value: unknown): 'es' | 'en' | 'ru' {
    return value === 'es' || value === 'ru' ? value : 'en';
}

function requiredDate(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`session_reschedule requires ${field}`);
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new Error(`session_reschedule requires a valid ${field}`);
    }
    return date;
}

function effectContext(
    supabaseAdmin: SupabaseClient<Database>,
    job: FulfillmentJobRow,
    effectKey: string,
) {
    if (!job.locked_by) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_INVALID_CONTEXT', true);
    }
    return {
        effectKey,
        jobId: job.id,
        leaseOwner: job.locked_by,
        supabaseAdmin,
    };
}

async function loadSession(
    supabaseAdmin: SupabaseClient<Database>,
    sessionId: string,
): Promise<RescheduleSession> {
    const { data, error } = await supabaseAdmin
        .from('sessions')
        .select(`
            id,
            student_id,
            teacher_id,
            scheduled_at,
            duration_minutes,
            calendar_event_id,
            meet_link,
            drive_doc_url,
            status,
            student:profiles!sessions_student_id_fkey(id, full_name, email, preferred_language),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email, preferred_language)
        `)
        .eq('id', sessionId)
        .single();
    if (error || !data) throw error ?? new Error('Session not found for reschedule fulfillment');
    return data as unknown as RescheduleSession;
}

export async function processSessionReschedule(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload,
    job: FulfillmentJobRow,
): Promise<void> {
    const sessionId = payload.sessionId || job.session_id;
    const operationIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!sessionId || !payload.operationId || !operationIdPattern.test(payload.operationId)) {
        throw new Error('session_reschedule requires sessionId and operationId');
    }
    if (job.session_id && job.session_id !== sessionId) {
        throw new Error('session_reschedule session identity mismatch');
    }
    const previousDate = requiredDate(payload.previousScheduledAt, 'previousScheduledAt');
    const scheduledDate = requiredDate(payload.scheduledAt, 'scheduledAt');
    if (previousDate.getTime() === scheduledDate.getTime()) {
        throw new Error('session_reschedule requires a changed date');
    }

    let session = await loadSession(supabaseAdmin, sessionId);
    if (session.status !== 'scheduled') {
        console.info(JSON.stringify({
            event: 'session_reschedule_job_obsolete',
            operationId: payload.operationId,
            reason: 'session_no_longer_scheduled',
            sessionId,
        }));
        return;
    }
    if (!session.scheduled_at || new Date(session.scheduled_at).getTime() !== scheduledDate.getTime()) {
        console.info(JSON.stringify({
            event: 'session_reschedule_job_obsolete',
            operationId: payload.operationId,
            reason: 'newer_schedule_persisted',
            sessionId,
        }));
        return;
    }
    const duration = session.duration_minutes || DEFAULT_CLASS_DURATION_MINUTES;
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('session_reschedule requires a valid session duration');
    }

    if (!session.calendar_event_id) {
        throw new FulfillmentDependencyPendingError('session_reschedule_waiting_for_calendar_event');
    }

    const eventId = session.calendar_event_id;
    const endTime = new Date(scheduledDate.getTime() + duration * 60_000);
    await runFulfillmentCalendarPatchEffect(
        effectContext(supabaseAdmin, job, 'calendar.session_reschedule'),
        {
            eventId,
            operationId: payload.operationId,
            previousScheduledAt: previousDate.toISOString(),
            scheduledAt: scheduledDate.toISOString(),
        },
        () => updateCalendarEvent(eventId, {
            startTime: scheduledDate,
            endTime,
            operationId: payload.operationId,
        }),
    );

    session = await loadSession(supabaseAdmin, sessionId);
    if (session.status !== 'scheduled') {
        console.info(JSON.stringify({
            event: 'session_reschedule_notification_obsolete',
            operationId: payload.operationId,
            reason: 'session_no_longer_scheduled_after_calendar_effect',
            sessionId,
        }));
        return;
    }
    if (!session.scheduled_at || new Date(session.scheduled_at).getTime() !== scheduledDate.getTime()) {
        console.info(JSON.stringify({
            event: 'session_reschedule_notification_obsolete',
            operationId: payload.operationId,
            reason: 'newer_schedule_persisted_after_calendar_effect',
            sessionId,
        }));
        return;
    }

    if (payload.sendEmail === false) return;
    const student = one(session.student);
    const teacher = one(session.teacher);
    if (!student?.email || !teacher?.email) {
        throw new Error('Session reschedule email is missing student or teacher email');
    }
    const common = {
        previousScheduledAt: previousDate.toISOString(),
        scheduledAt: scheduledDate.toISOString(),
        duration,
        meetLink: session.meet_link ?? undefined,
        documentLink: session.drive_doc_url ?? undefined,
    };
    const studentSent = await sendClassRescheduled(student.email, {
        locale: locale(student.preferred_language),
        recipientName: student.full_name || student.email.split('@')[0] || 'Student',
        isTeacher: false,
        otherPartyName: teacher.full_name || 'Teacher',
        ...common,
    }, {
        fulfillmentEffect: effectContext(supabaseAdmin, job, 'email.class_rescheduled.student'),
    });
    const teacherSent = await sendClassRescheduled(teacher.email, {
        locale: locale(teacher.preferred_language),
        recipientName: teacher.full_name || teacher.email.split('@')[0] || 'Teacher',
        isTeacher: true,
        otherPartyName: student.full_name || 'Student',
        ...common,
    }, {
        fulfillmentEffect: effectContext(supabaseAdmin, job, 'email.class_rescheduled.teacher'),
    });
    if (!studentSent || !teacherSent) {
        throw new Error('Resend did not accept one or more reschedule emails');
    }
}
