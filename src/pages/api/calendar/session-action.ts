import type { APIRoute } from 'astro';
import { recordCrmActivityForProfileSafe } from '../../../lib/crm/activity-sync';
import { recordFirstClassCancelledSafe, recordFirstClassCompletedSafe, recordNoShowFollowUpSafe } from '../../../lib/crm/onboarding';
import { triggerFulfillmentProcessing } from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Database, Json } from '../../../types/database.types';

const NO_SHOW_GRACE_PERIOD_MS = 15 * 60 * 1000;

const isRescheduleStateConflict = (error: { code?: string; message?: string } | null): boolean => (
    error?.code === '40001'
    || (
        error?.code === '23505'
        && error.message?.includes('checkout_v2_reschedule_subscription_has_pending_operation') === true
    )
);

const isGuaranteeStateConflict = (error: { code?: string; message?: string } | null): boolean => (
    error?.message?.includes('checkout_v2_guarantee_') === true
    && (
        error.code === '23505'
        || error.code === '23514'
        || error.code === '40001'
        || error.code === '55000'
    )
);

const teacherCompensationErrorResponse = (
    error: { code?: string; message?: string } | null,
): Response | null => {
    if (error?.code === '40001' && error.message === 'teacher_compensation_state_conflicts') {
        return new Response(JSON.stringify({
            error: 'Session compensation conflicts with the current state. Refresh and try again.',
        }), { status: 409 });
    }

    if (error?.code === '55000' && error.message === 'teacher_compensation_precondition_missing') {
        return new Response(JSON.stringify({
            error: 'Teacher compensation is not configured for this session. Contact an administrator before trying again.',
        }), { status: 503 });
    }

    return null;
};

const isSessionReport = (value: unknown): value is Json => {
    return value === null || typeof value === 'string' || (typeof value === 'object' && !Array.isArray(value));
};

const formatReportForActivityBody = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return null;

    return JSON.stringify(value);
};

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
            subscription:subscriptions(id, sessions_used, contract_schema_version)
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

    const supabaseAdmin = createSupabaseAdminClient();

    const fixFirstV2AnchorIfApplicable = async (): Promise<boolean> => {
        const subscription = Array.isArray(session.subscription) ? session.subscription[0] : session.subscription;
        if (!subscription?.id || subscription.contract_schema_version !== 2) return true;

        const { data: billingState, error: billingError } = await supabaseAdmin
            .from('checkout_v2_billing_state')
            .select('subscription_id, first_session_id, first_class_at, anchor_state, anchor_fixed_at')
            .eq('subscription_id', subscription.id)
            .maybeSingle();
        if (billingError) return false;
        if (!billingState || billingState.first_session_id !== sessionId) return true;
        if (billingState.anchor_state === 'fixed') {
            return billingState.anchor_fixed_at === billingState.first_class_at;
        }

        const { data: fixedState, error: fixError } = await supabaseAdmin.rpc('fix_checkout_v2_billing_anchor', {
            p_subscription_id: subscription.id,
            p_fixed_at: billingState.first_class_at,
        });
        return !fixError
            && fixedState?.anchor_state === 'fixed'
            && fixedState.anchor_fixed_at === billingState.first_class_at;
    };

    if (action === 'cancel') {
        const cancelledBy = isAdmin ? 'admin' : (isTeacher ? 'teacher' : 'student');
        const { data: cancelRows, error: updateError } = await supabaseAdmin.rpc('cancel_scheduled_session', {
            p_session_id: sessionId,
            p_cancelled_by: user.id,
            p_cancelled_by_role: cancelledBy,
            p_cancellation_reason: cancellationReason,
        });

        if (updateError) {
            const compensationResponse = teacherCompensationErrorResponse(updateError);
            if (compensationResponse) return compensationResponse;
            if (isGuaranteeStateConflict(updateError)) {
                return new Response(JSON.stringify({
                    error: 'Session change conflicts with a guarantee operation in progress.',
                }), { status: 409 });
            }
            if (isRescheduleStateConflict(updateError)) {
                return new Response(JSON.stringify({
                    error: 'Session change conflicts with a reschedule in progress.',
                }), { status: 409 });
            }
            console.error('[SessionAction] Atomic session cancellation failed:', updateError);
            return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
        }

        const cancelResult = cancelRows?.[0];
        if (!cancelResult) {
            return new Response(JSON.stringify({ error: 'Session is already cancelled or completed' }), { status: 409 });
        }

        const subscription = Array.isArray(session.subscription) ? session.subscription[0] : session.subscription;
        const cancelledAt = cancelResult.cancelled_at;
        const lateStudentCancellation = cancelResult.late_student_cancellation;
        const quotaRestoreAttempted = cancelResult.quota_restore_attempted;
        const quotaRestored = cancelResult.quota_restored;
        const previousSessionsUsed = cancelResult.previous_sessions_used;
        const nextSessionsUsed = cancelResult.next_sessions_used;
        const hoursUntilClass = cancelResult.hours_until_class;
        const subscriptionId = cancelResult.subscription_id ?? subscription?.id ?? null;

        triggerFulfillmentProcessing(context, 3);

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
                late_student_cancellation: lateStudentCancellation,
                hours_until_class: hoursUntilClass,
            },
        });

        await recordFirstClassCancelledSafe(supabaseAdmin, {
            profileId: session.student_id,
            email: session.student?.email ?? null,
            fullName: session.student?.full_name ?? null,
            subscriptionId: session.subscription_id ?? subscriptionId,
            sessionId,
            teacherId: session.teacher_id,
            scheduledAt: session.scheduled_at,
            cancelledAt,
            cancelledBy,
            cancellationReason,
        });

        return new Response(JSON.stringify({
            success: true,
            fulfillment: 'queued',
            calendarEventQueued: Boolean(sessionData.calendar_event_id),
            quotaRestored,
            quotaConsumed: lateStudentCancellation,
        }), { status: 200 });
    }

    if (action === 'complete' || action === 'no_show' || action === 'update_notes') {
        if (!isTeacher && !isAdmin) {
            return new Response(JSON.stringify({ error: 'Forbidden. Only teachers and admins can modify session states.' }), { status: 403 });
        }

        if (action === 'complete' && session.status === 'completed') {
            if (!await fixFirstV2AnchorIfApplicable()) {
                return new Response(JSON.stringify({ error: 'Billing anchor could not be fixed.' }), { status: 503 });
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        if ((action === 'complete' || action === 'no_show') && session.status !== 'scheduled') {
            return new Response(JSON.stringify({ error: 'Only scheduled sessions can be completed or marked as no_show.' }), { status: 409 });
        }

        if ((action === 'complete' || action === 'no_show') && session.scheduled_at && new Date(session.scheduled_at) > new Date()) {
            return new Response(JSON.stringify({ error: 'Session has not started yet.' }), { status: 409 });
        }

        if (action === 'complete' && session.scheduled_at) {
            const durationMinutes = Number.isInteger(session.duration_minutes) && session.duration_minutes > 0
                ? session.duration_minutes
                : 50;
            const completionAvailableAt = new Date(session.scheduled_at).getTime() + durationMinutes * 60_000;
            if (Date.now() < completionAvailableAt) {
                return new Response(JSON.stringify({ error: 'Session cannot be completed before its scheduled end.' }), { status: 409 });
            }
        }

        if (action === 'no_show' && session.scheduled_at) {
            const noShowAvailableAt = new Date(session.scheduled_at).getTime() + NO_SHOW_GRACE_PERIOD_MS;
            if (Date.now() < noShowAvailableAt) {
                return new Response(JSON.stringify({
                    error: 'A no-show can only be recorded 15 minutes after the scheduled start time.',
                }), { status: 409 });
            }
        }

        const stateChangedAt = new Date().toISOString();
        const updateData: Database['public']['Tables']['sessions']['Update'] = { updated_at: stateChangedAt };

        if (action === 'complete') {
            updateData.status = 'completed';
            updateData.completed_at = stateChangedAt;
        } else if (action === 'no_show') {
            updateData.status = 'no_show';
            updateData.no_show_at = stateChangedAt;
        }

        if (body.notes !== undefined) {
            if (body.notes !== null && typeof body.notes !== 'string') {
                return new Response(JSON.stringify({ error: 'notes must be a string' }), { status: 400 });
            }
            updateData.teacher_notes = body.notes ?? null;
        }

        let reportActivityBody: string | null = null;
        if (body.report !== undefined) {
            if (!isSessionReport(body.report)) {
                return new Response(JSON.stringify({ error: 'report must be a string or object' }), { status: 400 });
            }
            updateData.post_class_report = body.report ?? null;
            reportActivityBody = formatReportForActivityBody(body.report);
        }

        let updateQuery = supabaseAdmin
            .from('sessions')
            .update(updateData)
            .eq('id', sessionId);

        if (action === 'complete' || action === 'no_show') {
            updateQuery = updateQuery.eq('status', 'scheduled');
        }

        const { data: updatedRows, error: updateError } = await updateQuery.select('id');

        if (updateError) {
            const compensationResponse = teacherCompensationErrorResponse(updateError);
            if (compensationResponse) return compensationResponse;
            if (isGuaranteeStateConflict(updateError)) {
                return new Response(JSON.stringify({
                    error: 'Session change conflicts with a guarantee operation in progress.',
                }), { status: 409 });
            }
            if (isRescheduleStateConflict(updateError)) {
                return new Response(JSON.stringify({
                    error: 'Session change conflicts with a reschedule in progress.',
                }), { status: 409 });
            }
            return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
        }

        if ((action === 'complete' || action === 'no_show') && (!updatedRows || updatedRows.length === 0)) {
            return new Response(JSON.stringify({ error: 'Session state changed before this action could be applied.' }), { status: 409 });
        }

        if (action === 'complete' || action === 'no_show' || body.notes !== undefined || body.report !== undefined) {
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
                body: reportActivityBody
                    ?? (typeof body.notes === 'string'
                        ? body.notes
                        : null),
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
                if (!await fixFirstV2AnchorIfApplicable()) {
                    return new Response(JSON.stringify({ error: 'Billing anchor could not be fixed.' }), { status: 503 });
                }
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
