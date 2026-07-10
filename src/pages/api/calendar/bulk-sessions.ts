import type { APIRoute } from 'astro';
import { normalizeClassDurationMinutes } from '../../../lib/class-duration';
import { checkTeacherAvailabilitySlots } from '../../../lib/calendar/availability';
import { compareDateKeys, normalizeDateInputToDateKey } from '../../../lib/calendar/madrid-time';
import { normalizeManualMeetingLink } from '../../../lib/calendar/meeting-link';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { recordFirstClassScheduledSafe } from '../../../lib/crm/onboarding';
import { enqueueBulkSessionFulfillment } from '../../../lib/fulfillment/queue';
import {
    checkTeacherAvailabilityViaInternalService,
    isInternalJobServiceConfigured,
    triggerFulfillmentProcessing,
} from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { shouldDisableExternalIntegrations } from '../../../lib/external-integrations';

const ISO_DATE_TIME_WITH_ZONE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-](\d{2}):(\d{2}))$/;

function isValidDateString(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }

    const match = ISO_DATE_TIME_WITH_ZONE_PATTERN.exec(value);
    if (!match) {
        return false;
    }

    const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, zoneRaw, offsetHourRaw, offsetMinuteRaw] = match;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const second = Number(secondRaw ?? '0');
    const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;

    if (month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59) {
        return false;
    }

    if (zoneRaw !== 'Z' && (Number(offsetHourRaw) > 23 || Number(offsetMinuteRaw) > 59)) {
        return false;
    }

    return !Number.isNaN(new Date(value).getTime());
}

function findEarliestScheduledSession<T extends { scheduled_at: string | null }>(sessions: T[]) {
    return sessions.reduce<T | null>((earliest, session) => {
        if (!session.scheduled_at) return earliest;
        if (!earliest?.scheduled_at) return session;
        return new Date(session.scheduled_at).getTime() < new Date(earliest.scheduled_at).getTime()
            ? session
            : earliest;
    }, null);
}

export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const supabaseAdmin = createSupabaseAdminClient();
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

    let body: Record<string, unknown>;
    try {
        body = await context.request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    const { studentId, teacherId, sessions: scheduledDates, durationMinutes: rawDurationMinutes, meetLink, autoCreateMeeting = true } = body;
    const durationMinutes = normalizeClassDurationMinutes(rawDurationMinutes);
    const safeMeetLink = normalizeManualMeetingLink(meetLink);
    const shouldAutoCreateMeeting = typeof autoCreateMeeting === 'boolean' ? autoCreateMeeting : true;
    const externalIntegrationsDisabled = shouldDisableExternalIntegrations();

    if (!safeMeetLink.ok) {
        return new Response(JSON.stringify({ error: safeMeetLink.error }), { status: 400 });
    }

    if (typeof studentId !== 'string' || !studentId.trim() || !scheduledDates || !Array.isArray(scheduledDates) || scheduledDates.length === 0) {
        return new Response(JSON.stringify({ error: 'studentId and an array of sessions dates are required' }), { status: 400 });
    }

    // Prevent DoS: limit bulk size
    if (scheduledDates.length > 50) {
        return new Response(JSON.stringify({ error: 'Maximum 50 sessions per request' }), { status: 400 });
    }

    if (!scheduledDates.every(isValidDateString)) {
        return new Response(JSON.stringify({ error: 'sessions must contain valid ISO date strings' }), { status: 400 });
    }

    if (profile.role === 'admin' && (typeof teacherId !== 'string' || !teacherId.trim())) {
        return new Response(JSON.stringify({ error: 'teacherId is required for admin scheduling' }), { status: 400 });
    }

    const finalTeacherId = profile.role === 'admin' ? (teacherId as string).trim() : user.id;

    // IDOR Protection: verify teacher owns this student
    if (profile.role !== 'admin') {
        const { data: assignment } = await supabase
            .from('student_teachers')
            .select('id')
            .eq('teacher_id', user.id)
            .eq('student_id', studentId.trim())
            .single();

        if (!assignment) {
            return new Response(JSON.stringify({ error: 'Student not assigned to you' }), { status: 403 });
        }
    }

    // Verificar suscripción y saldo
    const { data: targetStudentProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', studentId.trim())
        .maybeSingle();

    if (targetStudentProfile?.role !== 'student') {
        return new Response(JSON.stringify({ error: 'studentId must belong to a student profile' }), { status: 400 });
    }

    if (profile.role === 'admin') {
        const { data: targetTeacherProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', finalTeacherId)
            .maybeSingle();

        if (targetTeacherProfile?.role !== 'teacher') {
            return new Response(JSON.stringify({ error: 'teacherId must belong to a teacher profile' }), { status: 400 });
        }
    }

    const { data: subscription } = await supabase
        .from('subscriptions')
        .select('id, sessions_used, sessions_total, ends_at')
        .eq('student_id', studentId.trim())
        .eq('status', 'active')
        .gte('ends_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!subscription) {
        return new Response(JSON.stringify({ error: 'Student has no active subscription' }), { status: 400 });
    }

    const subscriptionEndDateKey = normalizeDateInputToDateKey(subscription.ends_at);
    if (!subscriptionEndDateKey) {
        return new Response(JSON.stringify({ error: 'Subscription end date is invalid' }), { status: 500 });
    }

    const hasSessionAfterSubscriptionEnd = scheduledDates.some((dateStr) => {
        const scheduledDateKey = normalizeDateInputToDateKey(dateStr);
        return scheduledDateKey !== null && compareDateKeys(scheduledDateKey, subscriptionEndDateKey) > 0;
    });

    if (hasSessionAfterSubscriptionEnd) {
        return new Response(JSON.stringify({
            error: 'Sessions cannot be scheduled after the subscription end date',
        }), { status: 400 });
    }

    const sessionsUsed = subscription.sessions_used ?? 0;
    const sessionsTotal = subscription.sessions_total ?? 0;
    const shouldRecordFirstClass = sessionsUsed === 0;

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

    if (!externalIntegrationsDisabled && teacherEmail && !isInternalJobServiceConfigured(context)) {
        return new Response(JSON.stringify({
            error: 'Calendar availability service is not configured'
        }), { status: 503 });
    }

    // 1. VERIFICAR TODOS LOS CONFLICTOS ANTES DE INSERTAR NINGUNO (Atomicidad lógica)
    // Recopilar promesas para verificar conflictos en BBDD y en Google Calendar de forma concurrente
    const conflictChecks = scheduledDates.map(async (dateStr: string) => {
        const scheduledDate = new Date(dateStr);
        const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

        // A. Verificar en BBDD
        const { data: conflictingSessions } = await supabase
            .from('sessions')
            .select('id')
            .eq('teacher_id', finalTeacherId)
            .neq('status', 'cancelled')
            .gte('scheduled_at', scheduledDate.toISOString())
            .lt('scheduled_at', endTime.toISOString());

        if (conflictingSessions && conflictingSessions.length > 0) {
            return {
                hasConflict: true,
                message: `Conflicto detectado en Campus el ${scheduledDate.toLocaleDateString()} a las ${scheduledDate.toLocaleTimeString()}. El profesor ya tiene una clase.`
            };
        }

        // B. Verificar en Google Calendar
        if (!externalIntegrationsDisabled && teacherEmail) {
            let isFree = false;
            try {
                isFree = await checkTeacherAvailabilityViaInternalService(context, {
                    teacherEmail,
                    startTime: scheduledDate.toISOString(),
                    endTime: endTime.toISOString(),
                });
            } catch (availabilityError) {
                console.error('[BulkSessions] Availability check failed:', availabilityError);
                return {
                    hasConflict: true,
                    message: 'Cannot verify teacher availability right now',
                    status: 503
                };
            }

            if (!isFree) {
                return {
                    hasConflict: true,
                    message: `Conflicto en Google Calendar del profesor el ${scheduledDate.toLocaleDateString()} a las ${scheduledDate.toLocaleTimeString()}.`,
                    status: 409
                };
            }
        }

        return { hasConflict: false };
    });

    // Ejecutar todas las verificaciones
    const results = await Promise.all(conflictChecks);

    // Si AL MENOS UNA falla, abortamos todo el proceso de agendamiento
    const firstConflict = results.find(r => r.hasConflict);
    if (firstConflict) {
        return new Response(JSON.stringify({
            error: firstConflict.message
        }), { status: firstConflict.status || 409 });
    }

    const campusAvailability = await checkTeacherAvailabilitySlots(supabaseAdmin, {
        teacherId: finalTeacherId,
        scheduledAts: scheduledDates,
        durationMinutes,
    });

    if (!campusAvailability.ok) {
        return new Response(JSON.stringify({ error: campusAvailability.error }), { status: campusAvailability.status });
    }

    // 2. INSERTAR TODAS LAS SESIONES EN BBDD
    const sessionsToInsert = scheduledDates.map((dateStr: string) => ({
        subscription_id: subscription.id,
        student_id: studentId.trim(),
        teacher_id: finalTeacherId,
        scheduled_at: dateStr,
        duration_minutes: durationMinutes,
        meet_link: safeMeetLink.value,
        status: 'scheduled' as const,
    }));

    const { data: createdSessions, error: insertError } = await supabaseAdmin
        .from('sessions')
        .insert(sessionsToInsert)
        .select(`
            *,
            student:profiles!sessions_student_id_fkey(id, full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
        `);

    if (insertError || !createdSessions) {
        if (insertError?.code === '23P01') {
            return new Response(JSON.stringify({ error: 'One or more time slots are no longer available' }), { status: 409 });
        }
        return new Response(JSON.stringify({ error: insertError?.message || 'Error inserting sessions' }), { status: 500 });
    }

    // 3. ACTUALIZAR SALDO
    const { data: updatedSub, error: quotaUpdateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ sessions_used: sessionsUsed + scheduledDates.length })
        .eq('id', subscription.id)
        .eq('sessions_used', sessionsUsed)
        .select('id')
        .single();

    if (!updatedSub) {
        if (quotaUpdateError) {
            console.error('[BulkSessions] Failed to consume subscription quota:', quotaUpdateError);
        }
        // Concurrency abort
        const createdIds = createdSessions.map((s: { id: string }) => s.id);
        await supabaseAdmin.from('sessions').update({ status: 'cancelled' }).in('id', createdIds);
        return new Response(JSON.stringify({ error: 'Concurrency error: No sessions remaining in subscription' }), { status: 409 });
    }

    await Promise.all(createdSessions.map((session) => recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: session.student_id,
        email: session.student?.email ?? null,
        fullName: session.student?.full_name ?? null,
        actorId: user.id,
        lifecycleStage: 'customer',
        source: 'calendar_bulk',
        activityType: 'class',
        subject: 'Clase programada',
        body: session.teacher?.full_name || session.teacher?.email || null,
        occurredAt: session.scheduled_at,
        relatedEntityType: 'session_scheduled',
        relatedEntityId: session.id,
        metadata: {
            session_id: session.id,
            teacher_id: session.teacher_id,
            scheduled_at: session.scheduled_at,
            duration_minutes: session.duration_minutes,
            status: session.status,
        },
    })));

    const firstScheduledSession = shouldRecordFirstClass ? findEarliestScheduledSession(createdSessions) : null;
    if (firstScheduledSession) {
        await recordFirstClassScheduledSafe(supabaseAdmin, {
            profileId: firstScheduledSession.student_id,
            email: firstScheduledSession.student?.email ?? null,
            fullName: firstScheduledSession.student?.full_name ?? null,
            subscriptionId: subscription.id,
            sessionId: firstScheduledSession.id,
            teacherId: firstScheduledSession.teacher_id,
            scheduledAt: firstScheduledSession.scheduled_at,
        });
    }

    let fulfillment: 'queued' | 'fallback' | 'skipped' = 'skipped';
    if (!externalIntegrationsDisabled) {
        const fulfillmentQueued = await enqueueBulkSessionFulfillment(supabaseAdmin, createdSessions, {
            autoCreateMeeting: shouldAutoCreateMeeting,
            sendEmail: true,
        });

        fulfillment = fulfillmentQueued ? 'queued' : 'skipped';
        if (fulfillmentQueued) {
            triggerFulfillmentProcessing(context, 3);
        }
    }

    return new Response(JSON.stringify({
        message: `Successfully scheduled ${scheduledDates.length} sessions`,
        sessions: createdSessions,
        fulfillment,
    }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};
