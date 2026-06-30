import type { APIRoute } from 'astro';
import { normalizeClassDurationMinutes } from '../../../lib/class-duration';
import { checkTeacherAvailabilitySlots } from '../../../lib/calendar/availability';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { recordFirstClassScheduledSafe } from '../../../lib/crm/onboarding';
import { enqueueSessionFulfillment } from '../../../lib/fulfillment/queue';
import {
    checkTeacherAvailabilityViaInternalService,
    isInternalJobServiceConfigured,
    triggerFulfillmentProcessing,
} from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { shouldDisableExternalIntegrations } from '../../../lib/external-integrations';


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
    // teacherId filter: only admins can query other teachers' sessions
    if (teacherId && profile?.role === 'admin') query = query.eq('teacher_id', teacherId);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('scheduled_at', from);
    if (to) query = query.lte('scheduled_at', to);

    const { data, error } = await query;

    if (error) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }

    return new Response(JSON.stringify({ sessions: data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
};

// POST: Crear nueva sesión
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

    const body = await context.request.json();
    const { studentId, teacherId, scheduledAt, durationMinutes: rawDurationMinutes, meetLink, autoCreateMeeting = true } = body;
    const durationMinutes = normalizeClassDurationMinutes(rawDurationMinutes);
    const externalIntegrationsDisabled = shouldDisableExternalIntegrations();

    if (!studentId || !scheduledAt) {
        return new Response(JSON.stringify({ error: 'studentId and scheduledAt are required' }), { status: 400 });
    }

    if (profile.role === 'admin' && !teacherId) {
        return new Response(JSON.stringify({ error: 'teacherId is required for admin scheduling' }), { status: 400 });
    }

    const finalTeacherId = profile.role === 'admin' && teacherId ? teacherId : user.id;

    // IDOR Protection: verify teacher owns this student
    if (profile.role !== 'admin') {
        const { data: assignment } = await supabase
            .from('student_teachers')
            .select('id')
            .eq('teacher_id', user.id)
            .eq('student_id', studentId)
            .single();

        if (!assignment) {
            return new Response(JSON.stringify({ error: 'Student not assigned to you' }), { status: 403 });
        }
    }

    // Verificar suscripción
    const { data: targetStudentProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', studentId)
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
    const shouldRecordFirstClass = sessionsUsed === 0;

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

    const campusAvailability = await checkTeacherAvailabilitySlots(supabaseAdmin, {
        teacherId: finalTeacherId,
        scheduledAts: [scheduledAt],
        durationMinutes,
    });

    if (!campusAvailability.ok) {
        return new Response(JSON.stringify({ error: campusAvailability.error }), { status: campusAvailability.status });
    }

    // Verificar conflictos (Google Calendar Real)
    // Extraemos el email del profesor para consultarlo en Calendar
    const { data: teacherProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', finalTeacherId)
        .single();

    if (!externalIntegrationsDisabled && teacherProfile && teacherProfile.email) {
        if (!isInternalJobServiceConfigured(context)) {
            return new Response(JSON.stringify({
                error: 'Calendar availability service is not configured'
            }), { status: 503 });
        }

        let isFree = false;
        try {
            isFree = await checkTeacherAvailabilityViaInternalService(context, {
                teacherEmail: teacherProfile.email,
                startTime: scheduledDate.toISOString(),
                endTime: endTime.toISOString(),
            });
        } catch (availabilityError) {
            console.error('[Sessions] Availability check failed:', availabilityError);
            return new Response(JSON.stringify({
                error: 'Cannot verify teacher availability right now'
            }), { status: 503 });
        }

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
        if (sessionError.code === '23P01') {
            return new Response(JSON.stringify({ error: 'Time slot is not available' }), { status: 409 });
        }
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }

    // Increment sessions_used — optimistic lock: only updates if value hasn't changed concurrently
    const { data: updatedSub, error: quotaUpdateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ sessions_used: sessionsUsed + 1 })
        .eq('id', subscription.id)
        .eq('sessions_used', sessionsUsed)
        .select('id')
        .single();

    if (!updatedSub) {
        if (quotaUpdateError) {
            console.error('[Sessions] Failed to consume subscription quota:', quotaUpdateError);
        }
        // Another concurrent request already used the last session — cancel this one
        await supabase
            .from('sessions')
            .update({ status: 'cancelled' })
            .eq('id', session.id);
        return new Response(JSON.stringify({ error: 'No sessions remaining in subscription' }), { status: 409 });
    }

    await recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: session.student_id,
        email: session.student?.email ?? null,
        fullName: session.student?.full_name ?? null,
        actorId: user.id,
        lifecycleStage: 'customer',
        source: 'calendar',
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
    });

    if (shouldRecordFirstClass) {
        await recordFirstClassScheduledSafe(supabaseAdmin, {
            profileId: session.student_id,
            email: session.student?.email ?? null,
            fullName: session.student?.full_name ?? null,
            subscriptionId: subscription.id,
            sessionId: session.id,
            teacherId: session.teacher_id,
            scheduledAt: session.scheduled_at,
        });
    }

    let fulfillment: 'queued' | 'fallback' | 'skipped' = 'skipped';
    if (!externalIntegrationsDisabled) {
        const fulfillmentQueued = await enqueueSessionFulfillment(supabaseAdmin, session, {
            autoCreateMeeting,
            sendEmail: true,
        });

        fulfillment = fulfillmentQueued ? 'queued' : 'skipped';
        if (fulfillmentQueued) {
            triggerFulfillmentProcessing(context, 3);
        }
    }

    return new Response(JSON.stringify({
        session,
        fulfillment,
    }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
    });
};
