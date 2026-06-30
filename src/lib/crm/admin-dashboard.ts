import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '../../types/database.types';

type AdminSupabaseClient = SupabaseClient<Database>;
type CrmActivity = Tables<'crm_activities'>;
type CrmOpportunity = Tables<'crm_opportunities'>;
type CrmTask = Tables<'crm_tasks'>;
type Lead = Tables<'leads'>;
type Payment = Tables<'payments'>;
type Profile = Tables<'profiles'>;
type Session = Tables<'sessions'>;
type Subscription = Tables<'subscriptions'>;
type SupportTicket = Tables<'support_tickets'>;

type CrmContactSummary = Pick<Tables<'crm_contacts'>, 'id' | 'primary_email' | 'full_name' | 'profile_id'>;
type CampusProfileSummary = Pick<Profile, 'id' | 'email' | 'full_name'>;

export type CrmDashboardActivity = Pick<
  CrmActivity,
  'id' | 'activity_type' | 'subject' | 'occurred_at' | 'related_entity_type' | 'related_entity_id'
> & {
  crm_contacts: CrmContactSummary | null;
};

export type CrmDashboardOpportunity = Pick<
  CrmOpportunity,
  'id' | 'stage' | 'interest' | 'current_level' | 'opened_at'
> & {
  crm_contacts: CrmContactSummary | null;
};

export type CrmDashboardTask = Pick<CrmTask, 'id' | 'contact_id' | 'title' | 'task_type' | 'priority' | 'due_at' | 'status'> & {
  assigned_to: string | null;
  crm_contacts: CrmContactSummary | null;
};

export type CrmDashboardLead = Pick<
  Lead,
  'id' | 'name' | 'email' | 'interest' | 'current_level' | 'availability' | 'status' | 'created_at' | 'crm_contact_id' | 'crm_opportunity_id'
>;

export type CrmDashboardSupportTicket = Pick<
  SupportTicket,
  'id' | 'issue_title' | 'issue_type' | 'status' | 'created_at' | 'user_id'
> & {
  user: (CampusProfileSummary & Pick<Profile, 'role'>) | null;
};

export type CrmDashboardFailedPayment = Pick<
  Payment,
  'id' | 'amount' | 'currency' | 'status' | 'created_at' | 'student_id'
> & {
  profiles: CampusProfileSummary | null;
};

export type CrmDashboardEndingSubscription = Pick<
  Subscription,
  'id' | 'student_id' | 'ends_at' | 'status' | 'sessions_used' | 'sessions_total'
> & {
  profiles: CampusProfileSummary | null;
  packages: Pick<Tables<'packages'>, 'name' | 'display_name' | 'price_monthly'> | null;
};

export type CrmDashboardTodaySession = Pick<
  Session,
  'id' | 'scheduled_at' | 'status' | 'duration_minutes' | 'student_id' | 'teacher_id'
> & {
  student: CampusProfileSummary | null;
  teacher: CampusProfileSummary | null;
};

export type CrmDashboardRetentionRiskLevel = 'urgent' | 'high' | 'watch';

export interface CrmDashboardRetentionRisk {
  studentId: string;
  profile: CampusProfileSummary | null;
  score: number;
  level: CrmDashboardRetentionRiskLevel;
  reasons: string[];
  revenueAtRiskCents: number;
  failedPaymentCount: number;
  openSupportTicketCount: number;
  endingSubscriptionCount: number;
  nearestSubscriptionEndsAt: string | null;
  latestSignalAt: string | null;
}

export interface CrmDashboardRetentionRiskSummary {
  atRiskContacts: number;
  highRiskContacts: number;
  revenueAtRiskCents: number;
}

export interface CrmDashboardCommercialPulse {
  staleNewLeads: number;
  levelChecksSent: number;
  levelChecksReceived: number;
  proposalOpportunities: number;
  postponedOpportunities: number;
  salesFollowUpPending: number;
  levelCheckReviewPending: number;
  firstClassPending: number;
  noShowFollowUpPending: number;
}

export interface CrmAdminDashboardSummary {
  isReady: boolean;
  newOpportunities: number;
  openOpportunities: number;
  dueTasks: number;
  todayTasks: number;
  newLeadCount: number;
  openSupportTicketCount: number;
  failedPaymentCount: number;
  todaySessionCount: number;
  urgentQueueCount: number;
  commercialPulse: CrmDashboardCommercialPulse;
  retentionRiskSummary: CrmDashboardRetentionRiskSummary;
  retentionRisks: CrmDashboardRetentionRisk[];
  recentActivities: CrmDashboardActivity[];
  priorityTasks: CrmDashboardTask[];
  newestOpportunities: CrmDashboardOpportunity[];
  newLeads: CrmDashboardLead[];
  openSupportTickets: CrmDashboardSupportTicket[];
  failedPayments: CrmDashboardFailedPayment[];
  endingSubscriptions: CrmDashboardEndingSubscription[];
  todaySessions: CrmDashboardTodaySession[];
}

export const emptyCrmAdminDashboardSummary: CrmAdminDashboardSummary = {
  isReady: false,
  newOpportunities: 0,
  openOpportunities: 0,
  dueTasks: 0,
  todayTasks: 0,
  newLeadCount: 0,
  openSupportTicketCount: 0,
  failedPaymentCount: 0,
  todaySessionCount: 0,
  urgentQueueCount: 0,
  commercialPulse: {
    staleNewLeads: 0,
    levelChecksSent: 0,
    levelChecksReceived: 0,
    proposalOpportunities: 0,
    postponedOpportunities: 0,
    salesFollowUpPending: 0,
    levelCheckReviewPending: 0,
    firstClassPending: 0,
    noShowFollowUpPending: 0,
  },
  retentionRiskSummary: {
    atRiskContacts: 0,
    highRiskContacts: 0,
    revenueAtRiskCents: 0,
  },
  retentionRisks: [],
  recentActivities: [],
  priorityTasks: [],
  newestOpportunities: [],
  newLeads: [],
  openSupportTickets: [],
  failedPayments: [],
  endingSubscriptions: [],
  todaySessions: [],
};

const openOpportunityStages = ['new', 'to_contact', 'contacted', 'qualified', 'proposal', 'nurture'];
const activeTaskStatuses = ['open', 'snoozed'];

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42P01'
    || error?.message?.includes('crm_') === true
    || error?.message?.includes('does not exist') === true;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  return date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function daysUntilDate(todayStart: Date, dateStr: string) {
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));
}

function riskLevel(score: number): CrmDashboardRetentionRiskLevel {
  if (score >= 80) return 'urgent';
  if (score >= 50) return 'high';
  return 'watch';
}

function latestIsoDate(current: string | null, candidate: string | null | undefined) {
  if (!candidate) return current;
  if (!current) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

function earliestIsoDate(current: string | null, candidate: string | null | undefined) {
  if (!candidate) return current;
  if (!current) return candidate;
  return new Date(candidate).getTime() < new Date(current).getTime() ? candidate : current;
}

function addRiskReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

function buildRetentionRisks(
  todayStart: Date,
  input: {
    failedPayments: CrmDashboardFailedPayment[];
    endingSubscriptions: CrmDashboardEndingSubscription[];
    openSupportTickets: CrmDashboardSupportTicket[];
  }
) {
  const riskByStudent = new Map<string, Omit<CrmDashboardRetentionRisk, 'level'>>();

  const ensureRisk = (studentId: string, profile: CampusProfileSummary | null) => {
    const existing = riskByStudent.get(studentId);
    if (existing) {
      if (!existing.profile && profile) existing.profile = profile;
      return existing;
    }

    const risk: Omit<CrmDashboardRetentionRisk, 'level'> = {
      studentId,
      profile,
      score: 0,
      reasons: [],
      revenueAtRiskCents: 0,
      failedPaymentCount: 0,
      openSupportTicketCount: 0,
      endingSubscriptionCount: 0,
      nearestSubscriptionEndsAt: null,
      latestSignalAt: null,
    };
    riskByStudent.set(studentId, risk);
    return risk;
  };

  for (const payment of input.failedPayments) {
    const risk = ensureRisk(payment.student_id, payment.profiles);
    risk.failedPaymentCount += 1;
    risk.score += risk.failedPaymentCount === 1 ? 60 : 15;
    risk.revenueAtRiskCents += payment.amount ?? 0;
    risk.latestSignalAt = latestIsoDate(risk.latestSignalAt, payment.created_at);
    addRiskReason(risk.reasons, 'Pago fallido');
  }

  for (const subscription of input.endingSubscriptions) {
    const risk = ensureRisk(subscription.student_id, subscription.profiles);
    const daysRemaining = daysUntilDate(todayStart, subscription.ends_at);
    risk.endingSubscriptionCount += 1;
    risk.score += daysRemaining <= 3 ? 35 : daysRemaining <= 7 ? 25 : 15;
    risk.revenueAtRiskCents += subscription.packages?.price_monthly ?? 0;
    risk.nearestSubscriptionEndsAt = earliestIsoDate(risk.nearestSubscriptionEndsAt, subscription.ends_at);
    risk.latestSignalAt = latestIsoDate(risk.latestSignalAt, subscription.ends_at);
    addRiskReason(risk.reasons, `Plan vence en ${daysRemaining} dias`);
  }

  for (const ticket of input.openSupportTickets) {
    if (!ticket.user_id || ticket.user?.role === 'teacher' || ticket.user?.role === 'admin') continue;
    const risk = ensureRisk(ticket.user_id, ticket.user);
    risk.openSupportTicketCount += 1;
    risk.score += ticket.status === 'open' ? 20 : 15;
    risk.latestSignalAt = latestIsoDate(risk.latestSignalAt, ticket.created_at);
    addRiskReason(risk.reasons, 'Soporte abierto');
  }

  const risks = Array.from(riskByStudent.values())
    .map((risk) => ({
      ...risk,
      score: Math.min(risk.score, 100),
      reasons: risk.reasons.slice(0, 3),
      level: riskLevel(Math.min(risk.score, 100)),
    }))
    .sort((a, b) => (
      b.score - a.score
      || b.revenueAtRiskCents - a.revenueAtRiskCents
      || new Date(b.latestSignalAt ?? 0).getTime() - new Date(a.latestSignalAt ?? 0).getTime()
    ))
    .slice(0, 5);

  return {
    risks,
    summary: {
      atRiskContacts: risks.length,
      highRiskContacts: risks.filter((risk) => risk.level === 'urgent' || risk.level === 'high').length,
      revenueAtRiskCents: risks.reduce((sum, risk) => sum + risk.revenueAtRiskCents, 0),
    },
  };
}

export async function getCrmAdminDashboardSummary(
  supabase: AdminSupabaseClient
): Promise<CrmAdminDashboardSummary> {
  const todayStart = startOfToday();
  const nowIso = new Date().toISOString();
  const todayStartIso = todayStart.toISOString();
  const tomorrowIso = endOfToday().toISOString();
  const endingSoonIso = addDays(todayStart, 14).toISOString();
  const staleLeadCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [
    newOpportunities,
    openOpportunities,
    dueTasks,
    todayTasks,
    proposalOpportunities,
    postponedOpportunities,
    salesFollowUpPending,
    levelCheckReviewPending,
    firstClassPending,
    noShowFollowUpPending,
    recentActivities,
    priorityTasks,
    newestOpportunities,
  ] = await Promise.all([
    supabase
      .from('crm_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'new'),
    supabase
      .from('crm_opportunities')
      .select('id', { count: 'exact', head: true })
      .in('stage', openOpportunityStages),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', activeTaskStatuses)
      .lte('due_at', nowIso),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', activeTaskStatuses)
      .lt('due_at', tomorrowIso),
    supabase
      .from('crm_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'proposal'),
    supabase
      .from('crm_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('stage', 'nurture'),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', activeTaskStatuses)
      .eq('related_entity_type', 'lead_sales_follow_up'),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', activeTaskStatuses)
      .eq('related_entity_type', 'level_check'),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', activeTaskStatuses)
      .in('related_entity_type', ['subscription_onboarding', 'profile_onboarding']),
    supabase
      .from('crm_tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', activeTaskStatuses)
      .eq('related_entity_type', 'session_no_show'),
    supabase
      .from('crm_activities')
      .select(`
        id,
        activity_type,
        subject,
        occurred_at,
        related_entity_type,
        related_entity_id,
        crm_contacts (
          id,
          profile_id,
          primary_email,
          full_name
        )
      `)
      .order('occurred_at', { ascending: false })
      .limit(5),
    supabase
      .from('crm_tasks')
      .select(`
        id,
        assigned_to,
        title,
        task_type,
        priority,
        due_at,
        status,
        crm_contacts (
          id,
          profile_id,
          primary_email,
          full_name
        )
      `)
      .in('status', activeTaskStatuses)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(5),
    supabase
      .from('crm_opportunities')
      .select(`
        id,
        stage,
        interest,
        current_level,
        opened_at,
        crm_contacts (
          id,
          profile_id,
          primary_email,
          full_name
        )
      `)
      .in('stage', openOpportunityStages)
      .order('opened_at', { ascending: false })
      .limit(5),
  ]);

  const firstError = [
    newOpportunities.error,
    openOpportunities.error,
    dueTasks.error,
    todayTasks.error,
    proposalOpportunities.error,
    postponedOpportunities.error,
    salesFollowUpPending.error,
    levelCheckReviewPending.error,
    firstClassPending.error,
    noShowFollowUpPending.error,
    recentActivities.error,
    priorityTasks.error,
    newestOpportunities.error,
  ].find(Boolean);

  let crmReady = true;
  let crmNewOpportunities = 0;
  let crmOpenOpportunities = 0;
  let crmDueTasks = 0;
  let crmTodayTasks = 0;
  let crmProposalOpportunities = 0;
  let crmPostponedOpportunities = 0;
  let crmSalesFollowUpPending = 0;
  let crmLevelCheckReviewPending = 0;
  let crmFirstClassPending = 0;
  let crmNoShowFollowUpPending = 0;
  let crmRecentActivities: CrmDashboardActivity[] = [];
  let crmPriorityTasks: CrmDashboardTask[] = [];
  let crmNewestOpportunities: CrmDashboardOpportunity[] = [];

  if (firstError) {
    if (isMissingCrmTable(firstError)) {
      crmReady = false;
    } else {
      throw firstError;
    }
  } else {
    crmNewOpportunities = newOpportunities.count ?? 0;
    crmOpenOpportunities = openOpportunities.count ?? 0;
    crmDueTasks = dueTasks.count ?? 0;
    crmTodayTasks = todayTasks.count ?? 0;
    crmProposalOpportunities = proposalOpportunities.count ?? 0;
    crmPostponedOpportunities = postponedOpportunities.count ?? 0;
    crmSalesFollowUpPending = salesFollowUpPending.count ?? 0;
    crmLevelCheckReviewPending = levelCheckReviewPending.count ?? 0;
    crmFirstClassPending = firstClassPending.count ?? 0;
    crmNoShowFollowUpPending = noShowFollowUpPending.count ?? 0;
    crmRecentActivities = (recentActivities.data ?? []) as CrmDashboardActivity[];
    crmPriorityTasks = (priorityTasks.data ?? []) as CrmDashboardTask[];
    crmNewestOpportunities = (newestOpportunities.data ?? []) as CrmDashboardOpportunity[];
  }

  const [
    newLeads,
    staleNewLeads,
    levelChecksSent,
    levelChecksReceived,
    openSupportTickets,
    failedPayments,
    endingSubscriptions,
    todaySessions,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id, name, email, interest, current_level, availability, status, created_at, crm_contact_id, crm_opportunity_id', { count: 'exact' })
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'new')
      .lte('created_at', staleLeadCutoffIso),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('level_check_status', 'sent'),
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('level_check_status', 'received'),
    supabase
      .from('support_tickets')
      .select(`
        id,
        issue_title,
        issue_type,
        status,
        created_at,
        user_id,
        user:profiles!support_tickets_user_id_fkey (
          id,
          full_name,
          email,
          role
        )
      `, { count: 'exact' })
      .in('status', ['open', 'triaged'])
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('payments')
      .select(`
        id,
        amount,
        currency,
        status,
        created_at,
        student_id,
        profiles!payments_student_id_fkey (
          id,
          full_name,
          email
        )
      `, { count: 'exact' })
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('subscriptions')
      .select(`
        id,
        student_id,
        ends_at,
        status,
        sessions_used,
        sessions_total,
        profiles!subscriptions_student_id_fkey (
          id,
          full_name,
          email
        ),
        packages (
          name,
          display_name,
          price_monthly
        )
      `)
      .eq('status', 'active')
      .gte('ends_at', todayStartIso)
      .lte('ends_at', endingSoonIso)
      .order('ends_at', { ascending: true })
      .limit(5),
    supabase
      .from('sessions')
      .select(`
        id,
        scheduled_at,
        status,
        duration_minutes,
        student_id,
        teacher_id,
        student:profiles!sessions_student_id_fkey (
          id,
          full_name,
          email
        ),
        teacher:profiles!sessions_teacher_id_fkey (
          id,
          full_name,
          email
        )
      `, { count: 'exact' })
      .eq('status', 'scheduled')
      .gte('scheduled_at', todayStartIso)
      .lt('scheduled_at', tomorrowIso)
      .order('scheduled_at', { ascending: true })
      .limit(8),
  ]);

  const operationalError = [
    newLeads.error,
    staleNewLeads.error,
    levelChecksSent.error,
    levelChecksReceived.error,
    openSupportTickets.error,
    failedPayments.error,
    endingSubscriptions.error,
    todaySessions.error,
  ].find(Boolean);

  if (operationalError) {
    if (!isMissingCrmTable(operationalError)) {
      throw operationalError;
    }
  }

  const leadQueue = operationalError ? [] : (newLeads.data ?? []) as CrmDashboardLead[];
  const newLeadCount = operationalError ? 0 : newLeads.count ?? leadQueue.length;
  const staleNewLeadCount = operationalError ? 0 : staleNewLeads.count ?? 0;
  const levelCheckSentCount = operationalError ? 0 : levelChecksSent.count ?? 0;
  const levelCheckReceivedCount = operationalError ? 0 : levelChecksReceived.count ?? 0;
  const supportQueue = operationalError ? [] : (openSupportTickets.data ?? []) as CrmDashboardSupportTicket[];
  const openSupportTicketCount = operationalError ? 0 : openSupportTickets.count ?? supportQueue.length;
  const failedPaymentQueue = operationalError ? [] : (failedPayments.data ?? []) as CrmDashboardFailedPayment[];
  const failedPaymentCount = operationalError ? 0 : failedPayments.count ?? failedPaymentQueue.length;
  const endingSubscriptionQueue = operationalError ? [] : (endingSubscriptions.data ?? []) as CrmDashboardEndingSubscription[];
  const todaySessionQueue = operationalError ? [] : (todaySessions.data ?? []) as CrmDashboardTodaySession[];
  const todaySessionCount = operationalError ? 0 : todaySessions.count ?? todaySessionQueue.length;
  const retentionRiskReport = buildRetentionRisks(todayStart, {
    failedPayments: failedPaymentQueue,
    endingSubscriptions: endingSubscriptionQueue,
    openSupportTickets: supportQueue,
  });

  return {
    isReady: crmReady,
    newOpportunities: crmNewOpportunities,
    openOpportunities: crmOpenOpportunities,
    dueTasks: crmDueTasks,
    todayTasks: crmTodayTasks,
    newLeadCount,
    openSupportTicketCount,
    failedPaymentCount,
    todaySessionCount,
    urgentQueueCount: crmDueTasks + newLeadCount + openSupportTicketCount + failedPaymentCount,
    commercialPulse: {
      staleNewLeads: staleNewLeadCount,
      levelChecksSent: levelCheckSentCount,
      levelChecksReceived: levelCheckReceivedCount,
      proposalOpportunities: crmProposalOpportunities,
      postponedOpportunities: crmPostponedOpportunities,
      salesFollowUpPending: crmSalesFollowUpPending,
      levelCheckReviewPending: crmLevelCheckReviewPending,
      firstClassPending: crmFirstClassPending,
      noShowFollowUpPending: crmNoShowFollowUpPending,
    },
    retentionRiskSummary: retentionRiskReport.summary,
    retentionRisks: retentionRiskReport.risks,
    recentActivities: crmRecentActivities,
    priorityTasks: crmPriorityTasks,
    newestOpportunities: crmNewestOpportunities,
    newLeads: leadQueue,
    openSupportTickets: supportQueue,
    failedPayments: failedPaymentQueue,
    endingSubscriptions: endingSubscriptionQueue,
    todaySessions: todaySessionQueue,
  };
}
