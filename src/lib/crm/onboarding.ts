import type { SupabaseClient } from '@supabase/supabase-js';
import { ensureCrmContactForProfile } from './activity-sync';
import type { Database, Json } from '../../types/database.types';

type AdminSupabaseClient = SupabaseClient<Database>;
type CrmTaskInsert = Database['public']['Tables']['crm_tasks']['Insert'];
type CrmActivityInsert = Database['public']['Tables']['crm_activities']['Insert'];

export interface PostPaymentOnboardingInput {
    profileId: string;
    email: string | null;
    fullName: string | null;
    subscriptionId?: string | null;
    packageId: string;
    packageName: string;
    driveFolderUrl?: string | null;
    occurredAt?: string | null;
}

export interface FirstClassCompletedInput {
    profileId: string;
    email: string | null;
    fullName: string | null;
    subscriptionId?: string | null;
    sessionId: string;
    teacherId?: string | null;
    scheduledAt?: string | null;
    completedAt?: string | null;
}

export interface FirstClassScheduledInput {
    profileId: string;
    email: string | null;
    fullName: string | null;
    subscriptionId?: string | null;
    sessionId: string;
    teacherId?: string | null;
    scheduledAt?: string | null;
    occurredAt?: string | null;
}

export interface FirstClassCancelledInput {
    profileId: string;
    email: string | null;
    fullName: string | null;
    subscriptionId?: string | null;
    sessionId: string;
    teacherId?: string | null;
    scheduledAt?: string | null;
    cancelledAt?: string | null;
    cancelledBy?: 'admin' | 'teacher' | 'student' | null;
    cancellationReason?: string | null;
}

export interface NoShowFollowUpInput {
    profileId: string;
    email: string | null;
    fullName: string | null;
    subscriptionId?: string | null;
    sessionId: string;
    teacherId?: string | null;
    scheduledAt?: string | null;
    noShowAt?: string | null;
}

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === '42P01'
        || error?.message?.includes('crm_') === true
        || error?.message?.includes('does not exist') === true;
}

function addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function parseOccurredAt(value: string | null | undefined) {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function asRecord(value: Json | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...(value as Record<string, unknown>) };
}

function earlierIso(left: string | null | undefined, right: string) {
    if (!left) return right;
    return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function relatedEntity(input: PostPaymentOnboardingInput) {
    return input.subscriptionId
        ? { type: 'subscription_onboarding', id: input.subscriptionId }
        : { type: 'profile_onboarding', id: input.profileId };
}

function onboardingRelatedEntity(input: Pick<FirstClassCompletedInput, 'profileId' | 'subscriptionId'>) {
    return input.subscriptionId
        ? { type: 'subscription_onboarding', id: input.subscriptionId }
        : { type: 'profile_onboarding', id: input.profileId };
}

function activationRelatedEntity(input: Pick<FirstClassCompletedInput, 'profileId' | 'subscriptionId'>) {
    return input.subscriptionId
        ? { type: 'subscription_activation', id: input.subscriptionId }
        : { type: 'profile_activation', id: input.profileId };
}

export async function recordPostPaymentOnboarding(
    supabaseAdmin: AdminSupabaseClient,
    input: PostPaymentOnboardingInput
) {
    const contact = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: input.profileId,
        email: input.email,
        fullName: input.fullName,
        lifecycleStage: 'customer',
        source: 'post_payment_onboarding',
        sourcePath: '/campus',
    });

    if (contact.status !== 'ready') return contact;

    const related = relatedEntity(input);
    const occurredAtDate = parseOccurredAt(input.occurredAt);
    const occurredAt = occurredAtDate.toISOString();
    const dueAt = addHours(occurredAtDate, 24);
    const metadata: Json = {
        activation_goal: 'first_class_scheduled',
        package_id: input.packageId,
        package_name: input.packageName,
        drive_folder_ready: Boolean(input.driveFolderUrl),
        drive_folder_url: input.driveFolderUrl ?? null,
        welcome_email_sent: true,
        manual_scheduling_required: true,
        materials_before_first_class: true,
        shared_owner_queue: true,
    };

    const existingTaskQuery = await supabaseAdmin
        .from('crm_tasks')
        .select('id, due_at, metadata')
        .eq('contact_id', contact.contactId)
        .eq('task_type', 'admin')
        .eq('related_entity_type', related.type)
        .eq('related_entity_id', related.id)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (existingTaskQuery.error) {
        if (isMissingCrmTable(existingTaskQuery.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw existingTaskQuery.error;
    }

    const existingTask = existingTaskQuery.data as { id: string; due_at: string | null; metadata: Json | null } | null;
    const existingMetadata = asRecord(existingTask?.metadata);
    const firstClassAlreadyScheduled = existingMetadata.first_class_scheduled === true;
    const nextDueAt = firstClassAlreadyScheduled && existingTask?.due_at
        ? existingTask.due_at
        : earlierIso(existingTask?.due_at, dueAt);
    const nextMetadata = {
        ...existingMetadata,
        ...(metadata as Record<string, unknown>),
    } as Json;

    let taskId = existingTask?.id ?? null;

    if (taskId) {
        const { error } = await supabaseAdmin
            .from('crm_tasks')
            .update({
                title: firstClassAlreadyScheduled
                    ? 'Prepare materials before first class'
                    : 'Coordinate first class and materials',
                status: 'open',
                due_at: nextDueAt,
                metadata: nextMetadata,
                updated_at: occurredAt,
            })
            .eq('id', taskId);

        if (error) {
            if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw error;
        }
    } else {
        const task: CrmTaskInsert = {
            contact_id: contact.contactId,
            title: 'Coordinate first class and materials',
            task_type: 'admin',
            priority: 'high',
            due_at: dueAt,
            related_entity_type: related.type,
            related_entity_id: related.id,
            metadata: nextMetadata,
        };

        const { data, error } = await supabaseAdmin
            .from('crm_tasks')
            .insert(task)
            .select('id')
            .single();

        if (error) {
            if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw error;
        }

        taskId = data?.id ?? null;
    }

    const activityAlreadyExists = await supabaseAdmin
        .from('crm_activities')
        .select('id')
        .eq('contact_id', contact.contactId)
        .eq('activity_type', 'system')
        .eq('related_entity_type', related.type)
        .eq('related_entity_id', related.id)
        .maybeSingle();

    if (activityAlreadyExists.error) {
        if (isMissingCrmTable(activityAlreadyExists.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw activityAlreadyExists.error;
    }

    if (!activityAlreadyExists.data?.id) {
        const activityBody = input.driveFolderUrl
            ? 'Welcome email sent, materials folder prepared, first class coordination pending.'
            : 'Welcome email sent, materials folder still needs preparation before the first class.';
        const activity: CrmActivityInsert = {
            contact_id: contact.contactId,
            activity_type: 'system',
            subject: 'Post-payment onboarding started',
            body: activityBody,
            occurred_at: occurredAt,
            metadata: {
                ...(nextMetadata as Record<string, unknown>),
                task_id: taskId,
            },
            related_entity_type: related.type,
            related_entity_id: related.id,
        };

        const { error } = await supabaseAdmin
            .from('crm_activities')
            .insert(activity);

        if (error) {
            if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw error;
        }
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
            lifecycle_stage: 'customer',
            next_follow_up_at: dueAt,
            updated_at: occurredAt,
        })
        .eq('id', contact.contactId);

    if (contactUpdateError && !isMissingCrmTable(contactUpdateError)) throw contactUpdateError;

    return { status: 'recorded' as const, contactId: contact.contactId, taskId };
}

export async function recordPostPaymentOnboardingSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: PostPaymentOnboardingInput
) {
    try {
        return await recordPostPaymentOnboarding(supabaseAdmin, input);
    } catch (error) {
        console.error('[CrmOnboarding] Could not record post-payment onboarding:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}

export async function recordFirstClassScheduled(
    supabaseAdmin: AdminSupabaseClient,
    input: FirstClassScheduledInput
) {
    const contact = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: input.profileId,
        email: input.email,
        fullName: input.fullName,
        lifecycleStage: 'customer',
        source: 'first_class_scheduled',
        sourcePath: '/campus',
    });

    if (contact.status !== 'ready') return contact;

    const occurredAt = parseOccurredAt(input.occurredAt).toISOString();
    const scheduledAt = parseOccurredAt(input.scheduledAt).toISOString();
    const related = onboardingRelatedEntity(input);

    const existingTaskQuery = await supabaseAdmin
        .from('crm_tasks')
        .select('id, due_at, metadata')
        .eq('contact_id', contact.contactId)
        .eq('task_type', 'admin')
        .eq('related_entity_type', related.type)
        .eq('related_entity_id', related.id)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (existingTaskQuery.error) {
        if (isMissingCrmTable(existingTaskQuery.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw existingTaskQuery.error;
    }

    const existingTask = existingTaskQuery.data as { id: string; due_at: string | null; metadata: Json | null } | null;
    const dueAt = earlierIso(existingTask?.due_at, scheduledAt);
    const metadata: Json = {
        ...asRecord(existingTask?.metadata),
        activation_goal: 'first_class_scheduled',
        first_class_scheduled: true,
        session_id: input.sessionId,
        subscription_id: input.subscriptionId ?? null,
        teacher_id: input.teacherId ?? null,
        scheduled_at: scheduledAt,
        materials_before_first_class: true,
        shared_owner_queue: true,
    };

    let taskId = existingTask?.id ?? null;

    if (taskId) {
        const { error } = await supabaseAdmin
            .from('crm_tasks')
            .update({
                title: 'Prepare materials before first class',
                status: 'open',
                due_at: dueAt,
                metadata,
                updated_at: occurredAt,
            })
            .eq('id', taskId);

        if (error) {
            if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw error;
        }
    } else {
        const task: CrmTaskInsert = {
            contact_id: contact.contactId,
            title: 'Prepare materials before first class',
            task_type: 'admin',
            priority: 'high',
            due_at: dueAt,
            related_entity_type: related.type,
            related_entity_id: related.id,
            metadata,
        };

        const { data, error } = await supabaseAdmin
            .from('crm_tasks')
            .insert(task)
            .select('id')
            .single();

        if (error) {
            if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw error;
        }

        taskId = data?.id ?? null;
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
            lifecycle_stage: 'customer',
            next_follow_up_at: dueAt,
            updated_at: occurredAt,
        })
        .eq('id', contact.contactId);

    if (contactUpdateError && !isMissingCrmTable(contactUpdateError)) throw contactUpdateError;

    return { status: 'recorded' as const, contactId: contact.contactId, taskId };
}

export async function recordFirstClassScheduledSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: FirstClassScheduledInput
) {
    try {
        return await recordFirstClassScheduled(supabaseAdmin, input);
    } catch (error) {
        console.error('[CrmOnboarding] Could not record first class scheduling:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}

export async function recordFirstClassCancelled(
    supabaseAdmin: AdminSupabaseClient,
    input: FirstClassCancelledInput
) {
    const contact = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: input.profileId,
        email: input.email,
        fullName: input.fullName,
        lifecycleStage: 'customer',
        source: 'first_class_cancelled',
        sourcePath: '/campus',
    });

    if (contact.status !== 'ready') return contact;

    const cancelledAtDate = parseOccurredAt(input.cancelledAt);
    const cancelledAt = cancelledAtDate.toISOString();
    const dueAt = addHours(cancelledAtDate, 24);
    const related = onboardingRelatedEntity(input);

    const existingTaskQuery = await supabaseAdmin
        .from('crm_tasks')
        .select('id, metadata')
        .eq('contact_id', contact.contactId)
        .eq('task_type', 'admin')
        .eq('related_entity_type', related.type)
        .eq('related_entity_id', related.id)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (existingTaskQuery.error) {
        if (isMissingCrmTable(existingTaskQuery.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw existingTaskQuery.error;
    }

    const existingTask = existingTaskQuery.data as { id: string; metadata: Json | null } | null;
    if (!existingTask?.id) {
        return { status: 'skipped' as const, reason: 'no_open_onboarding_task' };
    }

    const existingMetadata = asRecord(existingTask.metadata);
    const trackedSessionId = typeof existingMetadata.session_id === 'string' ? existingMetadata.session_id : null;
    if (trackedSessionId && trackedSessionId !== input.sessionId) {
        return { status: 'skipped' as const, reason: 'different_onboarding_session' };
    }

    const metadata: Json = {
        ...existingMetadata,
        activation_goal: 'first_class_scheduled',
        first_class_scheduled: false,
        first_class_cancelled: true,
        reschedule_required: true,
        session_id: input.sessionId,
        cancelled_session_id: input.sessionId,
        subscription_id: input.subscriptionId ?? null,
        teacher_id: input.teacherId ?? null,
        scheduled_at: input.scheduledAt ?? null,
        cancelled_at: cancelledAt,
        cancelled_by: input.cancelledBy ?? null,
        cancellation_reason: input.cancellationReason ?? null,
        materials_before_first_class: true,
        shared_owner_queue: true,
    };

    const { error: taskUpdateError } = await supabaseAdmin
        .from('crm_tasks')
        .update({
            title: 'Reschedule first class and materials',
            status: 'open',
            due_at: dueAt,
            metadata,
            updated_at: cancelledAt,
        })
        .eq('id', existingTask.id);

    if (taskUpdateError) {
        if (isMissingCrmTable(taskUpdateError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw taskUpdateError;
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
            lifecycle_stage: 'customer',
            next_follow_up_at: dueAt,
            updated_at: cancelledAt,
        })
        .eq('id', contact.contactId);

    if (contactUpdateError && !isMissingCrmTable(contactUpdateError)) throw contactUpdateError;

    return { status: 'recorded' as const, contactId: contact.contactId, taskId: existingTask.id };
}

export async function recordFirstClassCancelledSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: FirstClassCancelledInput
) {
    try {
        return await recordFirstClassCancelled(supabaseAdmin, input);
    } catch (error) {
        console.error('[CrmOnboarding] Could not record first class cancellation:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}

export async function recordFirstClassCompleted(
    supabaseAdmin: AdminSupabaseClient,
    input: FirstClassCompletedInput
) {
    const contact = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: input.profileId,
        email: input.email,
        fullName: input.fullName,
        lifecycleStage: 'customer',
        source: 'first_class_completed',
        sourcePath: '/campus',
    });

    if (contact.status !== 'ready') return contact;

    const completedAtDate = parseOccurredAt(input.completedAt);
    const completedAt = completedAtDate.toISOString();
    const onboardingRelated = onboardingRelatedEntity(input);
    const activationRelated = activationRelatedEntity(input);
    const activityIdempotencyKey = `crm:first-class-completed:activity:${activationRelated.type}:${activationRelated.id}`;

    const taskQuery = await supabaseAdmin
        .from('crm_tasks')
        .select('id')
        .eq('contact_id', contact.contactId)
        .eq('task_type', 'admin')
        .eq('related_entity_type', onboardingRelated.type)
        .eq('related_entity_id', onboardingRelated.id)
        .in('status', ['open', 'snoozed']);

    if (taskQuery.error) {
        if (isMissingCrmTable(taskQuery.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw taskQuery.error;
    }

    const closedTaskIds = (taskQuery.data ?? []).map((task) => task.id);

    if (closedTaskIds.length > 0) {
        const { error } = await supabaseAdmin
            .from('crm_tasks')
            .update({
                status: 'done',
                completed_at: completedAt,
                updated_at: completedAt,
            })
            .in('id', closedTaskIds);

        if (error) {
            if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw error;
        }
    }

    const activity: CrmActivityInsert = {
        contact_id: contact.contactId,
        activity_type: 'system',
        subject: 'First class completed',
        body: 'Student completed the first class; onboarding activation achieved.',
        occurred_at: completedAt,
        metadata: {
            activation_goal: 'first_class_completed',
            session_id: input.sessionId,
            subscription_id: input.subscriptionId ?? null,
            teacher_id: input.teacherId ?? null,
            scheduled_at: input.scheduledAt ?? null,
            completed_at: completedAt,
            closed_onboarding_task_ids: closedTaskIds,
        },
        related_entity_type: activationRelated.type,
        related_entity_id: activationRelated.id,
        idempotency_key: activityIdempotencyKey,
    };

    const { error: activityError } = await supabaseAdmin
        .from('crm_activities')
        .upsert(activity, {
            onConflict: 'idempotency_key',
            ignoreDuplicates: true,
        });

    if (activityError) {
        if (isMissingCrmTable(activityError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw activityError;
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
            lifecycle_stage: 'customer',
            last_contacted_at: completedAt,
            next_follow_up_at: null,
            updated_at: completedAt,
        })
        .eq('id', contact.contactId);

    if (contactUpdateError && !isMissingCrmTable(contactUpdateError)) throw contactUpdateError;

    return { status: 'recorded' as const, contactId: contact.contactId, closedTaskIds };
}

export async function recordFirstClassCompletedSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: FirstClassCompletedInput
) {
    try {
        return await recordFirstClassCompleted(supabaseAdmin, input);
    } catch (error) {
        console.error('[CrmOnboarding] Could not record first class completion:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}

export async function recordNoShowFollowUp(
    supabaseAdmin: AdminSupabaseClient,
    input: NoShowFollowUpInput
) {
    const contact = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: input.profileId,
        email: input.email,
        fullName: input.fullName,
        lifecycleStage: 'customer',
        source: 'class_no_show',
        sourcePath: '/campus',
    });

    if (contact.status !== 'ready') return contact;

    const noShowAtDate = parseOccurredAt(input.noShowAt);
    const noShowAt = noShowAtDate.toISOString();
    const dueAt = addHours(noShowAtDate, 24);
    const relatedEntityType = 'session_no_show';
    const taskIdempotencyKey = `crm:no-show-follow-up:task:${input.sessionId}`;
    const activityIdempotencyKey = `crm:no-show-follow-up:activity:${input.sessionId}`;
    const metadata: Json = {
        action: 'no_show_follow_up',
        session_id: input.sessionId,
        subscription_id: input.subscriptionId ?? null,
        teacher_id: input.teacherId ?? null,
        scheduled_at: input.scheduledAt ?? null,
        no_show_at: noShowAt,
        follow_up_hours: 24,
        shared_owner_queue: true,
    };

    const task: CrmTaskInsert = {
        contact_id: contact.contactId,
        title: 'Follow up after missed class',
        task_type: 'email',
        priority: 'high',
        due_at: dueAt,
        related_entity_type: relatedEntityType,
        related_entity_id: input.sessionId,
        idempotency_key: taskIdempotencyKey,
        metadata,
    };

    const taskInsert = await supabaseAdmin
        .from('crm_tasks')
        .upsert(task, {
            onConflict: 'idempotency_key',
            ignoreDuplicates: true,
        });

    if (taskInsert.error) {
        if (isMissingCrmTable(taskInsert.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw taskInsert.error;
    }

    const existingTaskQuery = await supabaseAdmin
        .from('crm_tasks')
        .select('id')
        .eq('idempotency_key', taskIdempotencyKey)
        .maybeSingle();

    if (existingTaskQuery.error) {
        if (isMissingCrmTable(existingTaskQuery.error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw existingTaskQuery.error;
    }

    const existingTask = existingTaskQuery.data as { id: string } | null;
    const taskId = existingTask?.id ?? null;

    if (!taskId) {
        throw new Error('No-show follow-up task could not be loaded after idempotent creation');
    }

    const activity: CrmActivityInsert = {
        contact_id: contact.contactId,
        activity_type: 'system',
        subject: 'No-show follow-up task created',
        body: 'Student missed a scheduled class; manual follow-up is required.',
        occurred_at: noShowAt,
        metadata: {
            ...(metadata as Record<string, unknown>),
            task_id: taskId,
        },
        related_entity_type: relatedEntityType,
        related_entity_id: input.sessionId,
        idempotency_key: activityIdempotencyKey,
    };

    const { error: activityError } = await supabaseAdmin
        .from('crm_activities')
        .upsert(activity, {
            onConflict: 'idempotency_key',
            ignoreDuplicates: true,
        });

    if (activityError) {
        if (isMissingCrmTable(activityError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw activityError;
    }

    const { error: contactAlarmError } = await supabaseAdmin.rpc('refresh_crm_no_show_contact_alarm', {
        p_task_id: taskId,
        p_contact_id: contact.contactId,
        p_due_at: dueAt,
        p_occurred_at: noShowAt,
    });

    if (contactAlarmError) throw contactAlarmError;

    return { status: 'recorded' as const, contactId: contact.contactId, taskId };
}

export async function recordNoShowFollowUpSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: NoShowFollowUpInput
) {
    try {
        return await recordNoShowFollowUp(supabaseAdmin, input);
    } catch (error) {
        console.error('[CrmOnboarding] Could not record no-show follow-up:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}
