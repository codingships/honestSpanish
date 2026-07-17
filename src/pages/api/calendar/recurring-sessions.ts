import type { APIRoute } from 'astro';
import { normalizeClassDurationMinutes } from '../../../lib/class-duration';
import { checkTeacherAvailabilitySlots } from '../../../lib/calendar/availability';
import { normalizeManualMeetingLink } from '../../../lib/calendar/meeting-link';
import {
    addDaysToDateKey,
    compareDateKeys,
    dayOfWeekForDateKey,
    madridDateTimeToUtcIso,
    normalizeDateInputToDateKey,
} from '../../../lib/calendar/madrid-time';
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

function isValidDateInput(value: unknown): value is string {
    return typeof value === 'string' && normalizeDateInputToDateKey(value) !== null;
}

function isValidTimeInput(value: unknown): value is string {
    return typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
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

/**
 * POST /api/calendar/recurring-sessions
 * Creates multiple sessions at a fixed day/time each week until endDate or subscription limit.
 * Uses direct DB operations (same pattern as bulk-sessions.ts) instead of HTTP self-fetch.
 */
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

    if (!profile || (profile.role !== 'admin' && profile.role !== 'teacher')) {
        return new Response(JSON.stringify({ error: 'Forbidden: only admin or teacher' }), { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
        body = await context.request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    const {
        studentId,
        teacherId,
        dayOfWeek,
        time,
        durationMinutes: rawDurationMinutes,
        startDate,
        endDate,
        meetLink,
        autoCreateMeeting = true,
    } = body;
    const durationMinutes = normalizeClassDurationMinutes(rawDurationMinutes);
    const safeMeetLink = normalizeManualMeetingLink(meetLink);
    const shouldAutoCreateMeeting = typeof autoCreateMeeting === 'boolean' ? autoCreateMeeting : true;
    const externalIntegrationsDisabled = shouldDisableExternalIntegrations();

    if (!safeMeetLink.ok) {
        return new Response(JSON.stringify({ error: safeMeetLink.error }), { status: 400 });
    }

    // Validate required fields
    if (typeof studentId !== 'string' || !studentId.trim() || dayOfWeek === undefined || !time || !startDate) {
        return new Response(JSON.stringify({
            error: 'Required: studentId, dayOfWeek, time, startDate'
        }), { status: 400 });
    }

    if (profile.role === 'admin' && (typeof teacherId !== 'string' || !teacherId.trim())) {
        return new Response(JSON.stringify({ error: 'teacherId is required for admin scheduling' }), { status: 400 });
    }

    if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        return new Response(JSON.stringify({ error: 'dayOfWeek must be 0-6' }), { status: 400 });
    }

    if (!isValidTimeInput(time)) {
        return new Response(JSON.stringify({ error: 'time must be HH:mm' }), { status: 400 });
    }

    if (!isValidDateInput(startDate) || (endDate !== undefined && endDate !== null && !isValidDateInput(endDate))) {
        return new Response(JSON.stringify({ error: 'startDate and endDate must be valid dates' }), { status: 400 });
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

    // Verify student has active subscription
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

    const sessionsUsed = subscription.sessions_used ?? 0;
    const sessionsTotal = subscription.sessions_total ?? 0;
    const sessionsRemaining = sessionsTotal - sessionsUsed;
    const shouldRecordFirstClass = sessionsUsed === 0;

    if (sessionsRemaining <= 0) {
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 400 });
    }

    const startDateKey = normalizeDateInputToDateKey(startDate);
    const subscriptionEndDateKey = normalizeDateInputToDateKey(subscription.ends_at);
    const endDateKey = typeof endDate === 'string' && endDate.trim()
        ? normalizeDateInputToDateKey(endDate)
        : subscriptionEndDateKey;

    if (!subscriptionEndDateKey) {
        return new Response(JSON.stringify({ error: 'Subscription end date is invalid' }), { status: 500 });
    }

    if (!startDateKey || !endDateKey) {
        return new Response(JSON.stringify({ error: 'startDate and endDate must be valid dates' }), { status: 400 });
    }

    if (compareDateKeys(endDateKey, subscriptionEndDateKey) > 0) {
        return new Response(JSON.stringify({
            error: 'Recurring sessions cannot be scheduled after the subscription end date',
        }), { status: 400 });
    }

    // Generate all ISO date strings for the given Madrid calendar day/time.
    const scheduledDates: string[] = [];
    let currentDateKey = startDateKey;

    // Find first occurrence of dayOfWeek on or after startDate
    while (dayOfWeekForDateKey(currentDateKey) !== dayOfWeek) {
        currentDateKey = addDaysToDateKey(currentDateKey, 1);
    }

    while (compareDateKeys(currentDateKey, endDateKey) <= 0 && scheduledDates.length < sessionsRemaining) {
        const scheduledAt = madridDateTimeToUtcIso(currentDateKey, time);
        if (!scheduledAt) {
            return new Response(JSON.stringify({ error: 'time must be HH:mm' }), { status: 400 });
        }
        scheduledDates.push(scheduledAt);
        currentDateKey = addDaysToDateKey(currentDateKey, 7);
    }

    if (scheduledDates.length === 0) {
        return new Response(JSON.stringify({
            error: 'No valid dates found in the given range for this day of week'
        }), { status: 400 });
    }

    // Check total quota
    if (sessionsUsed + scheduledDates.length > sessionsTotal) {
        return new Response(JSON.stringify({
            error: `Not enough sessions. Tried ${scheduledDates.length}, only ${sessionsRemaining} available.`
        }), { status: 400 });
    }

    // Get teacher email for Google Calendar checks
    const { data: teacherProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', finalTeacherId)
        .single();
    const teacherEmail = teacherProfile?.email;

    if (!externalIntegrationsDisabled && teacherEmail && !isInternalJobServiceConfigured(context)) {
        return new Response(JSON.stringify({
            error: 'Calendar availability service is not configured'
        }), { status: 503 });
    }

    // 1. VERIFY ALL CONFLICTS BEFORE INSERTING (atomicity)
    for (const dateStr of scheduledDates) {
        const scheduledDate = new Date(dateStr);
        const endTime = new Date(scheduledDate.getTime() + durationMinutes * 60000);

        // DB conflict check
        const { data: conflicts } = await supabase
            .from('sessions')
            .select('id')
            .eq('teacher_id', finalTeacherId)
            .neq('status', 'cancelled')
            .gte('scheduled_at', scheduledDate.toISOString())
            .lt('scheduled_at', endTime.toISOString());

        if (conflicts && conflicts.length > 0) {
            return new Response(JSON.stringify({
                error: `Conflicto en BBDD: ${scheduledDate.toLocaleDateString()} ${scheduledDate.toLocaleTimeString()}`
            }), { status: 409 });
        }

        // Google Calendar conflict check
        if (!externalIntegrationsDisabled && teacherEmail) {
            let isFree = false;
            try {
                isFree = await checkTeacherAvailabilityViaInternalService(context, {
                    teacherEmail,
                    startTime: scheduledDate.toISOString(),
                    endTime: endTime.toISOString(),
                });
            } catch (availabilityError) {
                console.error('[RecurringSessions] Availability check failed:', availabilityError);
                return new Response(JSON.stringify({
                    error: 'Cannot verify teacher availability right now'
                }), { status: 503 });
            }

            if (!isFree) {
                return new Response(JSON.stringify({
                    error: `Conflicto en Google Calendar: ${scheduledDate.toLocaleDateString()} ${scheduledDate.toLocaleTimeString()}`
                }), { status: 409 });
            }
        }
    }

    const campusAvailability = await checkTeacherAvailabilitySlots(supabaseAdmin, {
        teacherId: finalTeacherId,
        scheduledAts: scheduledDates,
        durationMinutes,
    });

    if (!campusAvailability.ok) {
        return new Response(JSON.stringify({ error: campusAvailability.error }), { status: campusAvailability.status });
    }

    // 2. BULK INSERT all sessions
    const sessionsToInsert = scheduledDates.map(dateStr => ({
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
            return new Response(JSON.stringify({ error: 'One or more recurring sessions overlap with an existing booking' }), { status: 409 });
        }
        return new Response(JSON.stringify({ error: insertError?.message || 'Error inserting sessions' }), { status: 500 });
    }

    // 3. OPTIMISTIC LOCK on quota
    const { data: updatedSub, error: quotaUpdateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ sessions_used: sessionsUsed + scheduledDates.length })
        .eq('id', subscription.id)
        .eq('sessions_used', sessionsUsed)
        .select('id')
        .single();

    if (!updatedSub) {
        if (quotaUpdateError) {
            console.error('[RecurringSessions] Failed to consume subscription quota:', quotaUpdateError);
        }
        // Concurrency abort — cancel all created sessions
        const createdIds = createdSessions.map(s => s.id);
        await supabaseAdmin.from('sessions').update({ status: 'cancelled' }).in('id', createdIds);
        return new Response(JSON.stringify({ error: 'Concurrency error: quota changed' }), { status: 409 });
    }

    await Promise.all(createdSessions.map((session) => recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: session.student_id,
        email: session.student?.email ?? null,
        fullName: session.student?.full_name ?? null,
        actorId: user.id,
        lifecycleStage: 'customer',
        source: 'calendar_recurring',
        activityType: 'class',
        subject: 'Clase recurrente programada',
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
        created: createdSessions.length,
        total_requested: scheduledDates.length,
        sessions: createdSessions,
        fulfillment,
    }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};
