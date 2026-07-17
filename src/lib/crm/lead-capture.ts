import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../types/database.types';

type AdminSupabaseClient = SupabaseClient<Database>;
type LeadRow = Database['public']['Tables']['leads']['Row'];
type CrmContactInsert = Database['public']['Tables']['crm_contacts']['Insert'];
type CrmContactUpdate = Database['public']['Tables']['crm_contacts']['Update'];
type CrmOpportunityInsert = Database['public']['Tables']['crm_opportunities']['Insert'];
type CrmOpportunityUpdate = Database['public']['Tables']['crm_opportunities']['Update'];
type CrmTaskInsert = Database['public']['Tables']['crm_tasks']['Insert'];
type CrmConsentInsert = Database['public']['Tables']['crm_consents']['Insert'];
type CrmConsentUpdate = Database['public']['Tables']['crm_consents']['Update'];
type CrmActivityInsert = Database['public']['Tables']['crm_activities']['Insert'];

export type LeadCaptureForCrm = Pick<
    LeadRow,
    | 'id'
    | 'email'
    | 'name'
    | 'interest'
    | 'current_level'
    | 'learning_goal'
    | 'availability'
    | 'preferred_package'
    | 'source_path'
    | 'lang'
    | 'spoken_languages'
    | 'is_russian_speaker'
    | 'consent_given'
    | 'status'
    | 'created_at'
    | 'updated_at'
    | 'crm_contact_id'
    | 'crm_opportunity_id'
>;

type LeadCaptureFallbackRow = Omit<
    LeadCaptureForCrm,
    'preferred_package' | 'spoken_languages' | 'is_russian_speaker' | 'crm_contact_id' | 'crm_opportunity_id'
>;

export type LeadCaptureCrmSyncResult =
    | { status: 'synced'; contactId: string; opportunityId: string | null; taskId: string | null }
    | { status: 'skipped'; reason: string };

const leadSelect = [
    'id',
    'email',
    'name',
    'interest',
    'current_level',
    'learning_goal',
    'availability',
    'preferred_package',
    'source_path',
    'lang',
    'spoken_languages',
    'is_russian_speaker',
    'consent_given',
    'status',
    'created_at',
    'updated_at',
    'crm_contact_id',
    'crm_opportunity_id',
].join(', ');

const fallbackLeadSelect = [
    'id',
    'email',
    'name',
    'interest',
    'current_level',
    'learning_goal',
    'availability',
    'source_path',
    'lang',
    'consent_given',
    'status',
    'created_at',
    'updated_at',
].join(', ');

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === '42P01'
        || error?.message?.includes('crm_') === true
        || error?.message?.includes('does not exist') === true
        || error?.message?.includes('schema cache') === true;
}

function isMissingOptionalLeadColumn(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return error?.code === 'PGRST204'
        || error?.code === '42703'
        || message.includes('preferred_package')
        || message.includes('spoken_languages')
        || message.includes('is_russian_speaker')
        || message.includes('crm_contact_id')
        || message.includes('crm_opportunity_id');
}

function asPreferredLanguage(value: string | null): 'es' | 'en' | 'ru' {
    return value === 'en' || value === 'ru' ? value : 'es';
}

function addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

async function findPackageId(
    supabaseAdmin: AdminSupabaseClient,
    preferredPackage: string | null
) {
    if (!preferredPackage) return null;

    const { data, error } = await supabaseAdmin
        .from('packages')
        .select('id')
        .eq('name', preferredPackage)
        .maybeSingle();

    if (error) {
        console.error('[LeadCaptureCrm] Could not resolve preferred package:', error);
        return null;
    }

    return data?.id ?? null;
}

async function ensureLeadContact(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    now: string
) {
    const email = lead.email.toLowerCase();
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id')
        .eq('primary_email', email)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw findError;
    }

    if (existing?.id) {
        const updates: CrmContactUpdate = {
            preferred_language: asPreferredLanguage(lead.lang),
            source: 'lead_form',
            source_path: lead.source_path,
            updated_at: now,
        };
        if (lead.name) updates.full_name = lead.name;

        const { error: updateError } = await supabaseAdmin
            .from('crm_contacts')
            .update(updates)
            .eq('id', existing.id);

        if (updateError) {
            if (isMissingCrmTable(updateError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw updateError;
        }

        return { status: 'ready' as const, contactId: existing.id };
    }

    const contact: CrmContactInsert = {
        primary_email: email,
        full_name: lead.name,
        preferred_language: asPreferredLanguage(lead.lang),
        lifecycle_stage: 'lead',
        source: 'lead_form',
        source_path: lead.source_path,
        created_at: lead.created_at ?? now,
        updated_at: now,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_contacts')
        .insert(contact)
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        if (error.code === '23505') {
            const retry = await supabaseAdmin
                .from('crm_contacts')
                .select('id')
                .eq('primary_email', email)
                .maybeSingle();
            if (retry.error) throw retry.error;
            if (retry.data?.id) return { status: 'ready' as const, contactId: retry.data.id };
        }
        throw error;
    }

    return data?.id
        ? { status: 'ready' as const, contactId: data.id }
        : { status: 'skipped' as const, reason: 'missing_contact_id' };
}

async function ensureLeadOpportunity(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    contactId: string,
    now: string
) {
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_opportunities')
        .select('id, stage')
        .eq('legacy_lead_id', lead.id)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw findError;
    }

    const preferredPackageId = await findPackageId(supabaseAdmin, lead.preferred_package);

    if (existing?.id) {
        const updates: CrmOpportunityUpdate = {
            contact_id: contactId,
            interest: lead.interest,
            current_level: lead.current_level,
            learning_goal: lead.learning_goal,
            availability: lead.availability,
            preferred_package_id: preferredPackageId,
            updated_at: now,
        };

        const { error: updateError } = await supabaseAdmin
            .from('crm_opportunities')
            .update(updates)
            .eq('id', existing.id);

        if (updateError) {
            if (isMissingCrmTable(updateError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
            throw updateError;
        }

        return { status: 'ready' as const, opportunityId: existing.id };
    }

    const opportunity: CrmOpportunityInsert = {
        contact_id: contactId,
        legacy_lead_id: lead.id,
        stage: 'new',
        interest: lead.interest,
        current_level: lead.current_level,
        learning_goal: lead.learning_goal,
        availability: lead.availability,
        preferred_package_id: preferredPackageId,
        opened_at: lead.created_at ?? now,
        created_at: lead.created_at ?? now,
        updated_at: now,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_opportunities')
        .insert(opportunity)
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw error;
    }

    return data?.id
        ? { status: 'ready' as const, opportunityId: data.id }
        : { status: 'skipped' as const, reason: 'missing_opportunity_id' };
}

async function linkLeadToCrm(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    contactId: string,
    opportunityId: string | null
) {
    if (lead.crm_contact_id === contactId && lead.crm_opportunity_id === opportunityId) return;

    const { error } = await supabaseAdmin
        .from('leads')
        .update({
            crm_contact_id: contactId,
            crm_opportunity_id: opportunityId,
            updated_at: new Date().toISOString(),
        })
        .eq('id', lead.id);

    if (error && !isMissingOptionalLeadColumn(error)) throw error;
}

async function ensureLeadConsent(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    contactId: string,
    now: string
) {
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_consents')
        .select('id, opted_out_at')
        .eq('contact_id', contactId)
        .eq('channel', 'email')
        .eq('purpose', 'sales_follow_up')
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return;
        throw findError;
    }

    if (existing?.opted_out_at) return;

    const consentValues: CrmConsentInsert = {
        contact_id: contactId,
        channel: 'email',
        purpose: 'sales_follow_up',
        legal_basis: lead.consent_given ? 'consent' : 'manual_review_required',
        source: 'lead_form',
        proof: lead.source_path,
        captured_at: lead.created_at ?? now,
        updated_at: now,
    };

    if (existing?.id) {
        const { error } = await supabaseAdmin
            .from('crm_consents')
            .update(consentValues satisfies CrmConsentUpdate)
            .eq('id', existing.id);
        if (error && !isMissingCrmTable(error)) throw error;
        return;
    }

    const { error } = await supabaseAdmin
        .from('crm_consents')
        .insert(consentValues);

    if (error && !isMissingCrmTable(error)) throw error;
}

async function ensureApplicationActivity(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    contactId: string,
    opportunityId: string | null,
    now: string
) {
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_activities')
        .select('id')
        .eq('contact_id', contactId)
        .eq('activity_type', 'system')
        .eq('related_entity_type', 'lead')
        .eq('related_entity_id', lead.id)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return;
        throw findError;
    }

    if (existing?.id) return;

    const metadata: Json = {
        interest: lead.interest,
        current_level: lead.current_level,
        availability: lead.availability,
        preferred_package: lead.preferred_package,
        spoken_languages: lead.spoken_languages,
        is_russian_speaker: lead.is_russian_speaker,
        source_path: lead.source_path,
    };

    const activity: CrmActivityInsert = {
        contact_id: contactId,
        opportunity_id: opportunityId,
        activity_type: 'system',
        subject: 'Solicitud de plaza recibida',
        body: lead.learning_goal,
        occurred_at: lead.created_at ?? now,
        metadata,
        related_entity_type: 'lead',
        related_entity_id: lead.id,
        created_at: lead.created_at ?? now,
    };

    const { error } = await supabaseAdmin
        .from('crm_activities')
        .insert(activity);

    if (error && !isMissingCrmTable(error)) throw error;
}

async function ensureReviewTask(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    contactId: string,
    opportunityId: string | null,
    nowDate: Date
) {
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_tasks')
        .select('id')
        .eq('contact_id', contactId)
        .eq('task_type', 'review')
        .eq('related_entity_type', 'lead')
        .eq('related_entity_id', lead.id)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return null;
        throw findError;
    }

    if (existing?.id) return existing.id;

    const task: CrmTaskInsert = {
        contact_id: contactId,
        opportunity_id: opportunityId,
        title: 'Revisar solicitud de plaza en menos de 24h',
        task_type: 'review',
        priority: 'high',
        due_at: addHours(nowDate, 24),
        related_entity_type: 'lead',
        related_entity_id: lead.id,
        metadata: {
            sla_hours: 24,
            sla_target: 'first_human_response',
            source: 'lead_capture',
            source_path: lead.source_path,
            shared_owner_queue: true,
            owner_model: 'founder_shared_queue',
            manual_assignment_required: true,
            next_decision: 'qualify_propose_nurture_or_lost',
            email: lead.email.toLowerCase(),
            interest: lead.interest,
            current_level: lead.current_level,
            preferred_package: lead.preferred_package,
            availability: lead.availability,
            spoken_languages: lead.spoken_languages,
            is_russian_speaker: lead.is_russian_speaker,
        },
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

export async function loadLeadCaptureForCrm(
    supabaseAdmin: AdminSupabaseClient,
    normalizedEmail: string
): Promise<LeadCaptureForCrm | null> {
    const { data, error } = await supabaseAdmin
        .from('leads')
        .select(leadSelect)
        .eq('email', normalizedEmail)
        .maybeSingle();

    if (!error) return data as LeadCaptureForCrm | null;

    if (!isMissingOptionalLeadColumn(error)) throw error;

    const fallback = await supabaseAdmin
        .from('leads')
        .select(fallbackLeadSelect)
        .eq('email', normalizedEmail)
        .maybeSingle();

    if (fallback.error) throw fallback.error;
    if (!fallback.data) return null;

    const fallbackLead = fallback.data as unknown as LeadCaptureFallbackRow;
    return {
        ...fallbackLead,
        preferred_package: null,
        spoken_languages: [],
        is_russian_speaker: false,
        crm_contact_id: null,
        crm_opportunity_id: null,
    };
}

export async function syncLeadCaptureToCrm(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm,
    nowDate = new Date()
): Promise<LeadCaptureCrmSyncResult> {
    if (!lead.email) return { status: 'skipped', reason: 'missing_email' };

    const now = nowDate.toISOString();
    const contact = await ensureLeadContact(supabaseAdmin, lead, now);
    if (contact.status !== 'ready') return contact;

    const opportunity = await ensureLeadOpportunity(supabaseAdmin, lead, contact.contactId, now);
    if (opportunity.status !== 'ready') return opportunity;

    await linkLeadToCrm(supabaseAdmin, lead, contact.contactId, opportunity.opportunityId);
    await ensureLeadConsent(supabaseAdmin, lead, contact.contactId, now);
    await ensureApplicationActivity(supabaseAdmin, lead, contact.contactId, opportunity.opportunityId, now);
    const taskId = await ensureReviewTask(supabaseAdmin, lead, contact.contactId, opportunity.opportunityId, nowDate);

    return {
        status: 'synced',
        contactId: contact.contactId,
        opportunityId: opportunity.opportunityId,
        taskId,
    };
}

export async function syncLeadCaptureToCrmSafe(
    supabaseAdmin: AdminSupabaseClient,
    lead: LeadCaptureForCrm
): Promise<LeadCaptureCrmSyncResult> {
    try {
        return await syncLeadCaptureToCrm(supabaseAdmin, lead);
    } catch (error) {
        console.error('[LeadCaptureCrm] Could not sync lead capture into CRM:', error);
        return { status: 'skipped', reason: 'sync_failed' };
    }
}

export async function recordLeadEmailOutInCrm(
    supabaseAdmin: AdminSupabaseClient,
    input: {
        lead: LeadCaptureForCrm;
        contactId: string;
        opportunityId: string | null;
        subject: string;
        template: string;
    }
) {
    const now = new Date().toISOString();
    const { data: existing, error: findError } = await supabaseAdmin
        .from('crm_activities')
        .select('id')
        .eq('contact_id', input.contactId)
        .eq('activity_type', 'email_out')
        .eq('body', input.template)
        .eq('related_entity_type', 'lead')
        .eq('related_entity_id', input.lead.id)
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw findError;
    }

    if (existing?.id) return { status: 'duplicate' as const, activityId: existing.id };

    const { data, error } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: input.contactId,
            opportunity_id: input.opportunityId,
            activity_type: 'email_out',
            subject: input.subject,
            body: input.template,
            occurred_at: now,
            created_at: now,
            metadata: {
                automated: true,
                template: input.template,
                purpose: 'transactional',
            },
            related_entity_type: 'lead',
            related_entity_id: input.lead.id,
        })
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return { status: 'skipped' as const, reason: 'crm_not_migrated' };
        throw error;
    }

    return { status: 'created' as const, activityId: data?.id };
}

export async function recordLeadEmailOutInCrmSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: {
        lead: LeadCaptureForCrm;
        contactId: string;
        opportunityId: string | null;
        subject: string;
        template: string;
    }
) {
    try {
        return await recordLeadEmailOutInCrm(supabaseAdmin, input);
    } catch (error) {
        console.error('[LeadCaptureCrm] Could not record lead email activity:', error);
        return { status: 'skipped' as const, reason: 'record_failed' };
    }
}
