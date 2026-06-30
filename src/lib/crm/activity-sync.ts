import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../types/database.types';

type AdminSupabaseClient = SupabaseClient<Database>;
type CrmActivityInsert = Database['public']['Tables']['crm_activities']['Insert'];
type CrmContactInsert = Database['public']['Tables']['crm_contacts']['Insert'];
type CrmLifecycleStage = 'lead' | 'qualified' | 'customer' | 'alumni' | 'inactive' | 'lost';
type CrmActivityType = 'note' | 'email_in' | 'email_out' | 'call' | 'whatsapp' | 'meeting' | 'support' | 'payment' | 'class' | 'system';

interface RecordCrmActivityInput {
    profileId: string | null | undefined;
    email?: string | null;
    fullName?: string | null;
    actorId?: string | null;
    lifecycleStage?: CrmLifecycleStage;
    source?: string | null;
    sourcePath?: string | null;
    activityType: CrmActivityType;
    subject: string;
    body?: string | null;
    occurredAt?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    metadata?: Json;
}

interface EnsureCrmContactForProfileInput {
    profileId: string | null | undefined;
    email?: string | null;
    fullName?: string | null;
    lifecycleStage?: CrmLifecycleStage;
    source?: string | null;
    sourcePath?: string | null;
}

interface ProfileLookup {
    id: string;
    email: string | null;
    full_name: string | null;
    role: string | null;
}

export interface RecordCrmActivityResult {
    status: 'created' | 'duplicate' | 'skipped';
    activityId?: string;
    reason?: string;
}

export type EnsureCrmContactResult =
    | { status: 'ready'; contactId: string }
    | { status: 'skipped'; reason: string };

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === '42P01' || error?.message?.includes('crm_') === true || error?.message?.includes('does not exist') === true;
}

function defaultLifecycleStage(profileRole: string | null | undefined, requested?: CrmLifecycleStage): CrmLifecycleStage {
    if (requested) return requested;
    return profileRole === 'student' ? 'customer' : 'lead';
}

async function loadProfile(
    supabaseAdmin: AdminSupabaseClient,
    profileId: string
): Promise<ProfileLookup | null> {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, role')
        .eq('id', profileId)
        .maybeSingle();

    if (error) {
        console.error('[CrmActivitySync] Could not load profile:', error);
        return null;
    }

    return data as ProfileLookup | null;
}

async function findContact(
    supabaseAdmin: AdminSupabaseClient,
    input: { profileId: string; email: string | null }
) {
    const { data: contactByProfile, error: profileError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id')
        .eq('profile_id', input.profileId)
        .maybeSingle();

    if (profileError) {
        if (isMissingCrmTable(profileError)) return { missingCrm: true, contactId: null };
        throw profileError;
    }

    if (contactByProfile?.id) return { missingCrm: false, contactId: contactByProfile.id };

    if (!input.email) return { missingCrm: false, contactId: null };

    const { data: contactByEmail, error: emailError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id')
        .eq('primary_email', input.email.toLowerCase())
        .maybeSingle();

    if (emailError) {
        if (isMissingCrmTable(emailError)) return { missingCrm: true, contactId: null };
        throw emailError;
    }

    return { missingCrm: false, contactId: contactByEmail?.id ?? null };
}

async function createContact(
    supabaseAdmin: AdminSupabaseClient,
    input: {
        profileId: string;
        email: string;
        fullName: string | null;
        lifecycleStage: CrmLifecycleStage;
        source: string | null;
        sourcePath: string | null;
    }
) {
    const contact: CrmContactInsert = {
        profile_id: input.profileId,
        primary_email: input.email.toLowerCase(),
        full_name: input.fullName,
        lifecycle_stage: input.lifecycleStage,
        source: input.source,
        source_path: input.sourcePath,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_contacts')
        .insert(contact)
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return { missingCrm: true, contactId: null };
        if (error.code === '23505') {
            const existing = await findContact(supabaseAdmin, {
                profileId: input.profileId,
                email: input.email,
            });
            return existing;
        }
        throw error;
    }

    return { missingCrm: false, contactId: data?.id ?? null };
}

async function activityAlreadyExists(
    supabaseAdmin: AdminSupabaseClient,
    input: {
        contactId: string;
        activityType: CrmActivityType;
        relatedEntityType?: string | null;
        relatedEntityId?: string | null;
    }
) {
    if (!input.relatedEntityType || !input.relatedEntityId) return false;

    const { data, error } = await supabaseAdmin
        .from('crm_activities')
        .select('id')
        .eq('contact_id', input.contactId)
        .eq('activity_type', input.activityType)
        .eq('related_entity_type', input.relatedEntityType)
        .eq('related_entity_id', input.relatedEntityId)
        .maybeSingle();

    if (error) {
        if (isMissingCrmTable(error)) return false;
        throw error;
    }

    return Boolean(data?.id);
}

export async function ensureCrmContactForProfile(
    supabaseAdmin: AdminSupabaseClient,
    input: EnsureCrmContactForProfileInput
): Promise<EnsureCrmContactResult> {
    if (!input.profileId) return { status: 'skipped', reason: 'missing_profile_id' };

    const profile = input.email && input.fullName !== undefined
        ? null
        : await loadProfile(supabaseAdmin, input.profileId);
    const email = (input.email || profile?.email || '').toLowerCase();
    if (!email) return { status: 'skipped', reason: 'missing_email' };

    const fullName = input.fullName !== undefined ? input.fullName : profile?.full_name ?? null;
    const found = await findContact(supabaseAdmin, { profileId: input.profileId, email });
    if (found.missingCrm) return { status: 'skipped', reason: 'crm_not_migrated' };

    const contactResult = found.contactId
        ? found
        : await createContact(supabaseAdmin, {
            profileId: input.profileId,
            email,
            fullName,
            lifecycleStage: defaultLifecycleStage(profile?.role, input.lifecycleStage),
            source: input.source ?? 'system',
            sourcePath: input.sourcePath ?? null,
        });

    if (contactResult.missingCrm) return { status: 'skipped', reason: 'crm_not_migrated' };
    if (!contactResult.contactId) return { status: 'skipped', reason: 'missing_contact' };

    return { status: 'ready', contactId: contactResult.contactId };
}

export async function recordCrmActivityForProfile(
    supabaseAdmin: AdminSupabaseClient,
    input: RecordCrmActivityInput
): Promise<RecordCrmActivityResult> {
    const contactResult = await ensureCrmContactForProfile(supabaseAdmin, input);
    if (contactResult.status !== 'ready') return contactResult;

    const duplicate = await activityAlreadyExists(supabaseAdmin, {
        contactId: contactResult.contactId,
        activityType: input.activityType,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
    });

    if (duplicate) return { status: 'duplicate', reason: 'activity_already_recorded' };

    const activity: CrmActivityInsert = {
        contact_id: contactResult.contactId,
        actor_id: input.actorId ?? null,
        activity_type: input.activityType,
        subject: input.subject,
        body: input.body ?? null,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        metadata: input.metadata ?? {},
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
    };

    const { data, error } = await supabaseAdmin
        .from('crm_activities')
        .insert(activity)
        .select('id')
        .single();

    if (error) {
        if (isMissingCrmTable(error)) return { status: 'skipped', reason: 'crm_not_migrated' };
        throw error;
    }

    return { status: 'created', activityId: data?.id };
}

export async function recordCrmActivityForProfileSafe(
    supabaseAdmin: AdminSupabaseClient,
    input: RecordCrmActivityInput
): Promise<RecordCrmActivityResult> {
    try {
        return await recordCrmActivityForProfile(supabaseAdmin, input);
    } catch (error) {
        console.error('[CrmActivitySync] Could not record CRM activity:', error);
        return { status: 'skipped', reason: 'record_failed' };
    }
}
