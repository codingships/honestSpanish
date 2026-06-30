import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '../../types/database.types';

type AdminSupabaseClient = SupabaseClient<Database>;

export type CrmContactRecord = Tables<'crm_contacts'>;
export type CrmOpportunityRecord = Pick<
  Tables<'crm_opportunities'>,
  | 'id'
  | 'stage'
  | 'interest'
  | 'current_level'
  | 'learning_goal'
  | 'availability'
  | 'lost_reason'
  | 'opened_at'
  | 'closed_at'
  | 'preferred_package_id'
> & {
  packages: Pick<Tables<'packages'>, 'name' | 'display_name'> | null;
};

export type CrmTaskRecord = Pick<
  Tables<'crm_tasks'>,
  'id' | 'assigned_to' | 'title' | 'task_type' | 'priority' | 'status' | 'due_at' | 'completed_at' | 'created_at'
>;

export type CrmActivityRecord = Pick<
  Tables<'crm_activities'>,
  | 'id'
  | 'activity_type'
  | 'subject'
  | 'body'
  | 'occurred_at'
  | 'related_entity_type'
  | 'related_entity_id'
  | 'metadata'
>;

export type CrmConsentRecord = Pick<
  Tables<'crm_consents'>,
  | 'id'
  | 'channel'
  | 'purpose'
  | 'legal_basis'
  | 'source'
  | 'proof'
  | 'notice_version'
  | 'captured_at'
  | 'opted_out_at'
  | 'created_at'
  | 'updated_at'
>;

export type CrmSupportTicketRecord = Pick<
  Tables<'support_tickets'>,
  'id' | 'issue_type' | 'issue_title' | 'status' | 'created_at'
>;

export type CrmSessionRecord = Pick<
  Tables<'sessions'>,
  'id' | 'scheduled_at' | 'status' | 'duration_minutes' | 'created_at'
> & {
  teacher: Pick<Tables<'profiles'>, 'full_name' | 'email'> | null;
};

export interface CrmContactDetail {
  isReady: boolean;
  contact: CrmContactRecord | null;
  opportunities: CrmOpportunityRecord[];
  tasks: CrmTaskRecord[];
  activities: CrmActivityRecord[];
  consents: CrmConsentRecord[];
  supportTickets: CrmSupportTicketRecord[];
  sessions: CrmSessionRecord[];
}

export const emptyCrmContactDetail: CrmContactDetail = {
  isReady: false,
  contact: null,
  opportunities: [],
  tasks: [],
  activities: [],
  consents: [],
  supportTickets: [],
  sessions: [],
};

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42P01' || error?.message?.includes('does not exist') === true;
}

async function loadSupportTickets(supabase: AdminSupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from('support_tickets')
    .select('id, issue_type, issue_title, status, created_at')
    .eq('user_id', profileId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }

  return (data ?? []) as CrmSupportTicketRecord[];
}

async function loadSessions(supabase: AdminSupabaseClient, profileId: string) {
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      scheduled_at,
      status,
      duration_minutes,
      created_at,
      teacher:profiles!sessions_teacher_id_fkey (
        full_name,
        email
      )
    `)
    .eq('student_id', profileId)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .limit(10);

  if (error) throw error;

  return (data ?? []) as CrmSessionRecord[];
}

async function loadContact(
  supabase: AdminSupabaseClient,
  input: { profileId: string; email: string }
) {
  const { data: contactByProfile, error: profileError } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('profile_id', input.profileId)
    .maybeSingle();

  if (profileError) {
    if (isMissingTable(profileError)) return { isReady: false, contact: null };
    throw profileError;
  }

  if (contactByProfile) {
    return { isReady: true, contact: contactByProfile as CrmContactRecord };
  }

  const { data: contactByEmail, error: emailError } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('primary_email', input.email.toLowerCase())
    .maybeSingle();

  if (emailError) {
    if (isMissingTable(emailError)) return { isReady: false, contact: null };
    throw emailError;
  }

  return {
    isReady: true,
    contact: (contactByEmail ?? null) as CrmContactRecord | null,
  };
}

async function loadContactById(
  supabase: AdminSupabaseClient,
  contactId: string
) {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select('*')
    .eq('id', contactId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { isReady: false, contact: null };
    throw error;
  }

  return {
    isReady: true,
    contact: (data ?? null) as CrmContactRecord | null,
  };
}

async function loadCrmDataForContact(
  supabase: AdminSupabaseClient,
  contactId: string,
  baseDetail: CrmContactDetail
): Promise<CrmContactDetail> {
  const [opportunities, tasks, activities, consents] = await Promise.all([
    supabase
      .from('crm_opportunities')
      .select(`
        id,
        stage,
        interest,
        current_level,
        learning_goal,
        availability,
        lost_reason,
        opened_at,
        closed_at,
        preferred_package_id,
        packages (
          name,
          display_name
        )
      `)
      .eq('contact_id', contactId)
      .order('opened_at', { ascending: false }),
    supabase
      .from('crm_tasks')
      .select('id, assigned_to, title, task_type, priority, status, due_at, completed_at, created_at')
      .eq('contact_id', contactId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(12),
    supabase
      .from('crm_activities')
      .select('id, activity_type, subject, body, occurred_at, related_entity_type, related_entity_id, metadata')
      .eq('contact_id', contactId)
      .order('occurred_at', { ascending: false })
      .limit(15),
    supabase
      .from('crm_consents')
      .select('id, channel, purpose, legal_basis, source, proof, notice_version, captured_at, opted_out_at, created_at, updated_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false }),
  ]);

  const firstError = [opportunities.error, tasks.error, activities.error, consents.error].find(Boolean);
  if (firstError) {
    if (isMissingTable(firstError)) return { ...baseDetail, isReady: false };
    throw firstError;
  }

  return {
    ...baseDetail,
    opportunities: (opportunities.data ?? []) as CrmOpportunityRecord[],
    tasks: (tasks.data ?? []) as CrmTaskRecord[],
    activities: (activities.data ?? []) as CrmActivityRecord[],
    consents: (consents.data ?? []) as CrmConsentRecord[],
  };
}

export async function getCrmContactDetail(
  supabase: AdminSupabaseClient,
  input: { profileId: string; email: string }
): Promise<CrmContactDetail> {
  const [supportTickets, sessions, contactResult] = await Promise.all([
    loadSupportTickets(supabase, input.profileId),
    loadSessions(supabase, input.profileId),
    loadContact(supabase, input),
  ]);

  const baseDetail = {
    ...emptyCrmContactDetail,
    isReady: contactResult.isReady,
    contact: contactResult.contact,
    supportTickets,
    sessions,
  };

  if (!contactResult.isReady || !contactResult.contact) {
    return baseDetail;
  }

  return loadCrmDataForContact(supabase, contactResult.contact.id, baseDetail);
}

export async function getCrmContactDetailByContactId(
  supabase: AdminSupabaseClient,
  input: { contactId: string }
): Promise<CrmContactDetail> {
  const contactResult = await loadContactById(supabase, input.contactId);
  const profileId = contactResult.contact?.profile_id ?? null;
  const [supportTickets, sessions]: [CrmSupportTicketRecord[], CrmSessionRecord[]] = profileId
    ? await Promise.all([
      loadSupportTickets(supabase, profileId),
      loadSessions(supabase, profileId),
    ])
    : [[], []];

  const baseDetail = {
    ...emptyCrmContactDetail,
    isReady: contactResult.isReady,
    contact: contactResult.contact,
    supportTickets,
    sessions,
  };

  if (!contactResult.isReady || !contactResult.contact) {
    return baseDetail;
  }

  return loadCrmDataForContact(supabase, contactResult.contact.id, baseDetail);
}
