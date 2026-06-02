import type { APIRoute } from 'astro';
import { normalizeClassDurationMinutes } from '../../../lib/class-duration';
import { runAfterResponse } from '../../../lib/cloudflare-runtime';
import { enqueueBulkSessionFulfillment, processDueFulfillmentJobs } from '../../../lib/fulfillment/jobs';
import { fulfillSessionBatch } from '../../../lib/fulfillment/session-fulfillment';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { shouldDisableExternalIntegrations } from '../../../lib/external-integrations';

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
    const { studentId, teacherId, sessions: scheduledDates, durationMinutes: rawDurationMinutes, meetLink, autoCreateMeeting = true } = body;
    const durationMinutes = normalizeClassDurationMinutes(rawDurationMinutes);
    const externalIntegrationsDisabled = shouldDisableExternalIntegrations();

    if (!studentId || !scheduledDates || !Array.isArray(scheduledDates) || scheduledDates.length === 0) {
        return new Response(JSON.stringify({ error: 'studentId and an array of sessions dates are required' }), { status: 400 });
    }

    // Prevent DoS: limit bulk size
    if (scheduledDates.length > 50) {
        return new Response(JSON.stringify({ error: 'Maximum 50 sessions per request' }), { status: 400 });
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
    const checkTeacherAvailability = externalIntegrationsDisabled
        ? null
        : (await import('../../../lib/google/calendar')).checkTeacherAvailability;

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
        if (!externalIntegrationsDisabled && teacherEmail && checkTeacherAvailability) {
            let isFree = false;
            try {
                isFree = await checkTeacherAvailability(teacherEmail, scheduledDate, endTime);
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
        await supabase.from('sessions').update({ status: 'cancelled' }).in('id', createdIds);
        return new Response(JSON.stringify({ error: 'Concurrency error: No sessions remaining in subscription' }), { status: 409 });
    }

    let fulfillment: 'queued' | 'fallback' | 'skipped' = 'skipped';
    if (!externalIntegrationsDisabled) {
        const fulfillmentQueued = await enqueueBulkSessionFulfillment(supabaseAdmin, createdSessions, {
            autoCreateMeeting,
            sendEmail: true,
        });

        fulfillment = fulfillmentQueued ? 'queued' : 'fallback';
        runAfterResponse(
            context,
            fulfillmentQueued
                ? processDueFulfillmentJobs({ limit: 3, supabaseAdmin })
                : fulfillSessionBatch(supabaseAdmin, createdSessions.map((session) => session.id), {
                    autoCreateMeeting,
                    sendEmail: true,
                })
        );
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
