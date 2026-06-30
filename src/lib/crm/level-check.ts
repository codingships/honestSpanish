import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../types/database.types';
import type { LeadCaptureForCrm } from './lead-capture';

type AdminSupabaseClient = SupabaseClient<Database>;
type CrmActivityInsert = Database['public']['Tables']['crm_activities']['Insert'];
type CrmTaskInsert = Database['public']['Tables']['crm_tasks']['Insert'];

export interface LevelCheckCrmInput {
    lead: LeadCaptureForCrm;
    contactId: string;
    opportunityId: string | null;
    summary: string;
    metadata: Json;
    receivedAt: string;
}

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === '42P01'
        || error?.message?.includes('crm_') === true
        || error?.message?.includes('does not exist') === true
        || error?.message?.includes('schema cache') === true;
}

function addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

const rawLevelCheckMetadataKeys = new Set([
    'audio_url',
    'audioUrl',
    'document_url',
    'documentUrl',
    'level_check_context',
    'levelCheckContext',
    'raw_context',
    'rawContext',
    'video_url',
    'videoUrl',
    'written_sample',
    'writtenSample',
]);

function sanitizeLevelCheckMetadata(value: Json | undefined): Json | undefined {
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeLevelCheckMetadata(item))
            .filter((item): item is Json => item !== undefined);
    }

    if (value && typeof value === 'object') {
        const sanitized: { [key: string]: Json | undefined } = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            if (rawLevelCheckMetadataKeys.has(key)) continue;
            const safeValue = sanitizeLevelCheckMetadata(nestedValue as Json | undefined);
            if (safeValue !== undefined) sanitized[key] = safeValue;
        }
        return sanitized;
    }

    return value;
}

function asRecord(value: Json | undefined): Record<string, Json | undefined> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, Json | undefined>;
}

async function ensureLevelCheckActivity(
    supabaseAdmin: AdminSupabaseClient,
    input: LevelCheckCrmInput
) {
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_activities')
        .select('id')
        .eq('contact_id', input.contactId)
        .eq('activity_type', 'system')
        .eq('related_entity_type', 'level_check')
        .eq('related_entity_id', input.lead.id)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return null;
        throw findError;
    }

    if (existing?.id) {
        const { error } = await supabaseAdmin
            .from('crm_activities')
            .update({
                body: input.summary,
                occurred_at: input.receivedAt,
                metadata: input.metadata,
            })
            .eq('id', existing.id);

        if (error) {
            if (isMissingCrmTable(error)) return null;
            throw error;
        }

        return existing.id;
    }

    const activity: CrmActivityInsert = {
        contact_id: input.contactId,
        opportunity_id: input.opportunityId,
        activity_type: 'system',
        subject: 'Lightweight level check received',
        body: input.summary,
        occurred_at: input.receivedAt,
        created_at: input.receivedAt,
        metadata: input.metadata,
        related_entity_type: 'level_check',
        related_entity_id: input.lead.id,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_activities')
        .insert(activity)
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return null;
        throw error;
    }

    return data?.id ?? null;
}

async function ensureLevelCheckReviewTask(
    supabaseAdmin: AdminSupabaseClient,
    input: LevelCheckCrmInput
) {
    const receivedAtDate = new Date(input.receivedAt);
    const dueAt = Number.isNaN(receivedAtDate.getTime())
        ? addHours(new Date(), 24)
        : addHours(receivedAtDate, 24);
    const metadata: Json = {
        ...asRecord(input.metadata),
        sla_hours: 24,
        source: 'level_check',
        shared_owner_queue: true,
        email: input.lead.email.toLowerCase(),
        summary: input.summary,
        received_at: input.receivedAt,
    };

    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_tasks')
        .select('id')
        .eq('contact_id', input.contactId)
        .eq('task_type', 'review')
        .eq('related_entity_type', 'level_check')
        .eq('related_entity_id', input.lead.id)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return null;
        throw findError;
    }

    if (existing?.id) {
        const { error } = await supabaseAdmin
            .from('crm_tasks')
            .update({
                status: 'open',
                due_at: dueAt,
                updated_at: input.receivedAt,
                metadata,
            })
            .eq('id', existing.id);

        if (error) {
            if (isMissingCrmTable(error)) return null;
            throw error;
        }

        return existing.id;
    }

    const task: CrmTaskInsert = {
        contact_id: input.contactId,
        opportunity_id: input.opportunityId,
        title: 'Review lightweight level check',
        task_type: 'review',
        priority: 'high',
        due_at: dueAt,
        related_entity_type: 'level_check',
        related_entity_id: input.lead.id,
        metadata,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_tasks')
        .insert(task)
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return null;
        throw error;
    }

    return data?.id ?? null;
}

export async function recordLevelCheckInCrm(
    supabaseAdmin: AdminSupabaseClient,
    input: LevelCheckCrmInput
) {
    const safeInput = {
        ...input,
        metadata: sanitizeLevelCheckMetadata(input.metadata) ?? {},
    };
    const [activityId, taskId] = await Promise.all([
        ensureLevelCheckActivity(supabaseAdmin, safeInput),
        ensureLevelCheckReviewTask(supabaseAdmin, safeInput),
    ]);

    return { status: 'recorded' as const, activityId, taskId };
}

export async function recordLevelCheckInCrmSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: LevelCheckCrmInput
) {
    try {
        return await recordLevelCheckInCrm(supabaseAdmin, input);
    } catch (error) {
        console.error('[LevelCheckCrm] Could not record level check in CRM:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}
