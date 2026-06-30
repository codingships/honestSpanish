import type { APIRoute } from 'astro';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { recordFirstClassCancelledSafe, recordFirstClassCompletedSafe, recordNoShowFollowUpSafe } from '../../../lib/crm/onboarding';
import { enqueueSessionCancellation } from '../../../lib/fulfillment/queue';
import { triggerFulfillmentProcessing } from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Database } from '../../../types/database.types';

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

    let body: Record<string, unknown>;
    try {
        body = await context.request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }

    const { sessionId, action } = body;
    const cancellationReason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

    if (typeof sessionId !== 'string' || !sessionId.trim() || typeof action !== 'string' || !action.trim()) {
        return new Response(JSON.stringify({ error: 'Session ID and action are required' }), { status: 400 });
    }

    if (!['cancel', 'complete', 'no_show', 'update_notes'].includes(action)) {
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
    }

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

    const sessionData = session as typeof session & { calendar_event_id?: string | null };
    const isTeacher = session.teacher_id === user.id;
    const isStudent = session.student_id === user.id;
    const isAdmin = profile?.role === 'admin';

    if (!isTeacher && !isStudent && !isAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    if (action === 'cancel') {
        if (isStudent && !isAdmin && session.scheduled_at) {
            const hoursUntilClass = (new Date(session.scheduled_at).getTime() - Date.now()) / (1000 * 60 * 60);
            if (hoursUntilClass < 24) {
                return new Response(JSON.stringify({
                    error: 'Student cancellations require at least 24 hours notice.',
                }), { status: 409 });
            }
        }

        const cancelledAt = new Date().toISOString();
        const cancelledBy = isAdmin ? 'admin' : (isTeacher ? 'teacher' : 'student');
        const { data: cancelResult, error: updateError } = await supabase
            .from('sessions')
            .update({
                status: 'cancelled',
                cancellation_reason: cancellationReason,
                cancelled_at: cancelledAt,
                cancelled_by: user.id,
            })
            .eq('id', sessionId)
            .eq('status', 'scheduled')
            .select('id');

        if (updateError) {
            return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
        }

        if (!cancelResult || cancelResult.length === 0) {
            return new Response(JSON.stringify({ error: 'Session is already cancelled or completed' }), { status: 409 });
        }

        const supabaseAdmin = createSupabaseAdminClient();
        const subscription = Array.isArray(session.subscription) ? session.subscription[0] : session.subscription;
        let quotaRestoreAttempted = false;
        let quotaRestored = false;
        let previousSessionsUsed: number | null = null;
        let nextSessionsUsed: number | null = null;

        if (subscription) {
            const currentUsed = subscription.sessions_used ?? 0;
            previousSessionsUsed = currentUsed;
            if (currentUsed > 0) {
                quotaRestoreAttempted = true;
                nextSessionsUsed = currentUsed - 1;
                const { data: quotaRows, error: quotaError } = await supabaseAdmin
                    .from('subscriptions')
                    .update({ sessions_used: currentUsed - 1 })
                    .eq('id', subscription.id)
                    .eq('sessions_used', currentUsed)
                    .select('id');

                if (quotaError) {
                    console.error('[SessionAction] Could not restore subscription quota after cancellation:', quotaError);
                }
                quotaRestored = Array.isArray(quotaRows) ? quotaRows.length > 0 : Boolean(quotaRows);
            }
        }

        const fulfillmentQueued = await enqueueSessionCancellation(supabaseAdmin, {
            sessionId,
            subscriptionId: subscription?.id ?? null,
            studentId: session.student_id,
            cancelledBy,
            reason: cancellationReason,
        });

        if (fulfillmentQueued) {
            triggerFulfillmentProcessing(context, 3);
        }

        await recordCrmActivityForProfileSafe(supabaseAdmin, {
            profileId: session.student_id,
            email: session.student?.email ?? null,
            fullName: session.student?.full_name ?? null,
            actorId: user.id,
            lifecycleStage: 'customer',
            source: 'calendar',
            activityType: 'class',
            subject: 'Clase cancelada',
            body: cancellationReason,
            relatedEntityType: 'session_cancelled',
            relatedEntityId: sessionId,
            metadata: {
                session_id: sessionId,
                teacher_id: session.teacher_id,
                scheduled_at: session.scheduled_at,
                cancelled_by: cancelledBy,
                reason: cancellationReason,
                quota_restore_attempted: quotaRestoreAttempted,
                quota_restored: quotaRestored,
                previous_sessions_used: previousSessionsUsed,
                next_sessions_used: nextSessionsUsed,
            },
        });

        await recordFirstClassCancelledSafe(supabaseAdmin, {
            profileId: session.student_id,
            email: session.student?.email ?? null,
            fullName: session.student?.full_name ?? null,
            subscriptionId: session.subscription_id ?? subscription?.id ?? null,
            sessionId,
            teacherId: session.teacher_id,
            scheduledAt: session.scheduled_at,
            cancelledAt,
            cancelledBy,
            cancellationReason,
        });

        return new Response(JSON.stringify({
            success: true,
            fulfillment: fulfillmentQueued ? 'queued' : 'skipped',
            calendarEventQueued: Boolean(sessionData.calendar_event_id),
            quotaRestored,
        }), { status: 200 });
    }

    if (action === 'complete' || action === 'no_show' || action === 'update_notes') {
        if (!isTeacher && !isAdmin) {
            return new Response(JSON.stringify({ error: 'Forbidden. Only teachers and admins can modify session states.' }), { status: 403 });
        }

        if ((action === 'complete' || action === 'no_show') && session.status !== 'scheduled') {
            return new Response(JSON.stringify({ error: 'Only scheduled sessions can be completed or marked as no_show.' }), { status: 409 });
        }

        if ((action === 'complete' || action === 'no_show') && session.scheduled_at && new Date(session.scheduled_at) > new Date()) {
            return new Response(JSON.stringify({ error: 'Session has not started yet.' }), { status: 409 });
        }

        const stateChangedAt = new Date().toISOString();
        const updateData: Database['public']['Tables']['sessions']['Update'] = { updated_at: stateChangedAt };

        if (action === 'complete') {
            updateData.status = 'completed';
            updateData.completed_at = stateChangedAt;
        } else if (action === 'no_show') {
            updateData.status = 'no_show';
        }

        if (body.notes !== undefined) {
            if (body.notes !== null && typeof body.notes !== 'string') {
                return new Response(JSON.stringify({ error: 'notes must be a string' }), { status: 400 });
            }
            updateData.teacher_notes = body.notes ?? null;
        }

        if (body.report !== undefined) {
            if (body.report !== null && typeof body.report !== 'string') {
                return new Response(JSON.stringify({ error: 'report must be a string' }), { status: 400 });
            }
            updateData.post_class_report = body.report ?? null;
        }

        let updateQuery = supabase
            .from('sessions')
            .update(updateData)
            .eq('id', sessionId);

        if (action === 'complete' || action === 'no_show') {
            updateQuery = updateQuery.eq('status', 'scheduled');
        }

        const { data: updatedRows, error: updateError } = await updateQuery.select('id');

        if (updateError) {
            return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
        }

        if ((action === 'complete' || action === 'no_show') && (!updatedRows || updatedRows.length === 0)) {
            return new Response(JSON.stringify({ error: 'Session state changed before this action could be applied.' }), { status: 409 });
        }

        if (action === 'complete' || action === 'no_show' || body.notes !== undefined || body.report !== undefined) {
            const supabaseAdmin = createSupabaseAdminClient();
            const occurredAt = stateChangedAt;
            const subject = action === 'complete'
                ? 'Clase completada'
                : action === 'no_show'
                    ? 'Alumno no asistio'
                    : 'Notas de clase actualizadas';

            await recordCrmActivityForProfileSafe(supabaseAdmin, {
                profileId: session.student_id,
                email: session.student?.email ?? null,
                fullName: session.student?.full_name ?? null,
                actorId: user.id,
                lifecycleStage: 'customer',
                source: 'calendar',
                activityType: 'class',
                subject,
                body: typeof body.report === 'string'
                    ? body.report
                    : typeof body.notes === 'string'
                        ? body.notes
                        : null,
                occurredAt,
                relatedEntityType: action === 'complete'
                    ? 'session_completed'
                    : action === 'no_show'
                        ? 'session_no_show'
                        : 'session_notes_update',
                relatedEntityId: action === 'update_notes' ? `${sessionId}:${occurredAt}` : sessionId,
                metadata: {
                    session_id: sessionId,
                    teacher_id: session.teacher_id,
                    scheduled_at: session.scheduled_at,
                    action,
                    status: updateData.status ?? session.status,
                },
            });

            if (action === 'complete') {
                const subscription = Array.isArray(session.subscription) ? session.subscription[0] : session.subscription;
                await recordFirstClassCompletedSafe(supabaseAdmin, {
                    profileId: session.student_id,
                    email: session.student?.email ?? null,
                    fullName: session.student?.full_name ?? null,
                    subscriptionId: session.subscription_id ?? subscription?.id ?? null,
                    sessionId,
                    teacherId: session.teacher_id,
                    scheduledAt: session.scheduled_at,
                    completedAt: occurredAt,
                });
            } else if (action === 'no_show') {
                const subscription = Array.isArray(session.subscription) ? session.subscription[0] : session.subscription;
                await recordNoShowFollowUpSafe(supabaseAdmin, {
                    profileId: session.student_id,
                    email: session.student?.email ?? null,
                    fullName: session.student?.full_name ?? null,
                    subscriptionId: session.subscription_id ?? subscription?.id ?? null,
                    sessionId,
                    teacherId: session.teacher_id,
                    scheduledAt: session.scheduled_at,
                    noShowAt: occurredAt,
                });
            }
        }

        return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
};
