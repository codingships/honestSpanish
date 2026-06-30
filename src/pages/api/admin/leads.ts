import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import {
    loadLeadCaptureForCrm,
    recordLeadEmailOutInCrmSafe,
    syncLeadCaptureToCrmSafe,
} from '../../../lib/crm/lead-capture';
import {
    sendLevelCheckInviteEmail,
    sendMissingInfoEmail,
    sendProposalNextStepEmail,
} from '../../../lib/email';
import { getSiteUrl } from '../../../lib/site-url';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Json, Tables, TablesUpdate } from '../../../types/database.types';

// Forzamos Node.js runtime para compatibilidad Edge/Serverless en Astro 5
export const config = {
    runtime: 'nodejs'
};

const jsonHeaders = { 'Content-Type': 'application/json' };
const leadStatuses = ['new', 'contacted', 'discarded'] as const;
const crmOpportunityStages = ['new', 'to_contact', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'nurture'] as const;
const salesEmailTemplates = ['missing_info', 'proposal_next_step'] as const;
type LeadStatus = typeof leadStatuses[number];
type CrmOpportunityStage = typeof crmOpportunityStages[number];
type SalesEmailTemplate = typeof salesEmailTemplates[number];
type Lead = Tables<'leads'>;
type LeadSummaryRecord = Pick<Lead, 'id' | 'status' | 'interest' | 'current_level' | 'preferred_package' | 'source_path' | 'created_at'>;
type LeadCrmOpportunity = Pick<
    Tables<'crm_opportunities'>,
    'id' | 'legacy_lead_id' | 'stage' | 'contact_id' | 'opened_at' | 'closed_at' | 'current_level' | 'learning_goal' | 'availability'
> & {
    packages: Pick<Tables<'packages'>, 'name' | 'display_name'> | null;
    crm_contacts: Pick<Tables<'crm_contacts'>, 'id' | 'lifecycle_stage' | 'next_follow_up_at' | 'last_contacted_at'> | null;
};
type LeadOpportunitySummaryRecord = Pick<Tables<'crm_opportunities'>, 'legacy_lead_id' | 'stage'>;

interface SummaryItem {
    label: string;
    count: number;
}

interface SourcePerformanceItem {
    sourcePath: string;
    total: number;
    contacted: number;
    qualified: number;
    won: number;
}

interface LeadPipelineSummary {
    totalLeads: number;
    contactedLeads: number;
    discardedLeads: number;
    qualifiedLeadCount: number;
    activePipelineCount: number;
    wonOpportunities: number;
    lostOpportunities: number;
    contactedRate: number;
    wonRate: number;
    topSourcePaths: SummaryItem[];
    topInterests: SummaryItem[];
    topPreferredPackages: SummaryItem[];
    levelSummary: SummaryItem[];
    pipelineStageSummary: SummaryItem[];
    sourcePerformance: SourcePerformanceItem[];
}

const updateLeadSchema = z.object({
    action: z.literal('lead_status').optional(),
    leadId: z.string().uuid(),
    newStatus: z.enum(leadStatuses),
});

const updateOpportunityStageSchema = z.object({
    action: z.literal('opportunity_stage'),
    opportunityId: z.string().uuid(),
    newStage: z.enum(crmOpportunityStages),
});

const sendLevelCheckSchema = z.object({
    action: z.literal('send_level_check'),
    leadId: z.string().uuid(),
});

const reviewLevelCheckSchema = z.object({
    action: z.literal('review_level_check'),
    leadId: z.string().uuid(),
});

const sendSalesEmailSchema = z.object({
    action: z.literal('send_sales_email'),
    leadId: z.string().uuid(),
    template: z.enum(salesEmailTemplates),
});

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === '42P01' || error?.message?.includes('crm_') === true;
}

function isMissingLevelCheckColumn(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return message.includes('level_check_') && (error?.code === 'PGRST204' || error?.code === '42703' || error?.code === undefined);
}

function buildLeadStatusUpdate(status: LeadStatus, now: string, options: { clearLevelCheckRaw?: boolean } = {}): TablesUpdate<'leads'> {
    const update: TablesUpdate<'leads'> = {
        status,
        updated_at: now,
    };

    if (status === 'discarded' || options.clearLevelCheckRaw) {
        update.level_check_context = {};
        update.level_check_raw_cleared_at = now;
    }

    return update;
}

function mapLeadStatusToCrm(status: LeadStatus) {
    if (status === 'contacted') {
        return {
            opportunityStage: 'contacted',
            contactLifecycle: 'qualified',
            activitySubject: 'Lead marcado como contactado',
        };
    }

    if (status === 'discarded') {
        return {
            opportunityStage: 'lost',
            contactLifecycle: 'lost',
            activitySubject: 'Lead descartado',
        };
    }

    return {
        opportunityStage: 'new',
        contactLifecycle: 'lead',
        activitySubject: 'Lead reabierto',
    };
}

function mapOpportunityStageToLeadStatus(stage: CrmOpportunityStage): LeadStatus {
    if (stage === 'lost') return 'discarded';
    if (stage === 'new' || stage === 'to_contact') return 'new';
    return 'contacted';
}

function mapOpportunityStageToContactLifecycle(stage: CrmOpportunityStage) {
    if (stage === 'won') return 'customer';
    if (stage === 'lost') return 'lost';
    if (stage === 'qualified' || stage === 'proposal') return 'qualified';
    return 'lead';
}

function preferredLeadLanguage(lang: string | null | undefined): 'es' | 'en' | 'ru' {
    return lang === 'es' || lang === 'ru' ? lang : 'en';
}

function buildDiagnosticUrl(context: APIContext, lead: Pick<Lead, 'lang' | 'email'>) {
    const requestOrigin = new URL(context.request.url).origin;
    const diagnosticUrl = new URL(`${getSiteUrl(requestOrigin)}/${preferredLeadLanguage(lead.lang)}/diagnostico`);
    if (lead.email) {
        diagnosticUrl.searchParams.set('email', lead.email.trim().toLowerCase());
    }
    return diagnosticUrl.toString();
}

function addHoursIso(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function salesEmailSubject(template: SalesEmailTemplate) {
    return template === 'missing_info'
        ? 'A little more context - Espanol Honesto'
        : 'Suggested next step - Espanol Honesto';
}

function salesEmailOpportunityStage(template: SalesEmailTemplate): CrmOpportunityStage {
    return template === 'proposal_next_step' ? 'proposal' : 'contacted';
}

function addDaysIso(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function countBy<T>(items: T[], getLabel: (item: T) => string): SummaryItem[] {
    const counts = new Map<string, number>();

    for (const item of items) {
        const label = getLabel(item).trim() || 'Sin dato';
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'es'))
        .slice(0, 5);
}

function toPercent(value: number, total: number) {
    return total > 0 ? Math.round((value / total) * 100) : 0;
}

function isContactedStage(stage: string | null | undefined) {
    return !!stage && !['new', 'to_contact'].includes(stage);
}

function isQualifiedStage(stage: string | null | undefined) {
    return !!stage && ['qualified', 'proposal', 'won'].includes(stage);
}

function isAllowedSalesLegalBasis(legalBasis: string | null | undefined) {
    return legalBasis === 'consent'
        || legalBasis === 'contract'
        || legalBasis === 'prior_customer_similar_services'
        || legalBasis === 'legitimate_interest';
}

async function verifySalesFollowUpConsent(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    contactId: string
) {
    const { data: latestConsent, error } = await supabaseAdmin
        .from('crm_consents')
        .select('id, legal_basis, opted_out_at, captured_at, created_at')
        .eq('contact_id', contactId)
        .eq('channel', 'email')
        .eq('purpose', 'sales_follow_up')
        .order('captured_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        if (isMissingCrmTable(error)) {
            return jsonResponse({
                error: 'CRM consent tracking is not migrated yet',
                reason: 'crm_consent_not_ready',
            }, 409);
        }
        console.error('[AdminLeads] Could not verify sales follow-up consent:', error);
        return jsonResponse({ error: 'Could not verify sales follow-up consent' }, 500);
    }

    if (latestConsent?.opted_out_at) {
        return jsonResponse({
            error: 'Contact is opted out for sales follow-up by email',
            reason: 'consent_opted_out',
            channel: 'email',
            purpose: 'sales_follow_up',
        }, 409);
    }

    if (!isAllowedSalesLegalBasis(latestConsent?.legal_basis)) {
        return jsonResponse({
            error: 'Manual review required before sales follow-up email',
            reason: latestConsent ? 'manual_review_consent' : 'missing_consent',
            channel: 'email',
            purpose: 'sales_follow_up',
        }, 409);
    }

    return null;
}

function buildLeadPipelineSummary(
    leads: LeadSummaryRecord[],
    opportunities: LeadOpportunitySummaryRecord[]
): LeadPipelineSummary {
    const opportunityByLeadId = new Map(
        opportunities
            .filter((opportunity) => opportunity.legacy_lead_id)
            .map((opportunity) => [opportunity.legacy_lead_id as string, opportunity])
    );
    const sourcePerformance = new Map<string, SourcePerformanceItem>();
    let contactedLeads = 0;
    let qualifiedLeadCount = 0;
    let wonOpportunities = 0;
    let lostOpportunities = 0;

    for (const lead of leads) {
        const opportunity = opportunityByLeadId.get(lead.id);
        const stage = opportunity?.stage;
        const sourcePath = lead.source_path || 'Sin ruta';
        const source = sourcePerformance.get(sourcePath) ?? {
            sourcePath,
            total: 0,
            contacted: 0,
            qualified: 0,
            won: 0,
        };

        source.total += 1;
        if (lead.status === 'contacted' || isContactedStage(stage)) {
            contactedLeads += 1;
            source.contacted += 1;
        }
        if (isQualifiedStage(stage)) {
            qualifiedLeadCount += 1;
            source.qualified += 1;
        }
        if (stage === 'won') {
            wonOpportunities += 1;
            source.won += 1;
        }
        if (stage === 'lost') {
            lostOpportunities += 1;
        }

        sourcePerformance.set(sourcePath, source);
    }

    const activePipelineCount = opportunities.filter((opportunity) => !['won', 'lost'].includes(opportunity.stage)).length;

    return {
        totalLeads: leads.length,
        contactedLeads,
        discardedLeads: leads.filter((lead) => lead.status === 'discarded').length,
        qualifiedLeadCount,
        activePipelineCount,
        wonOpportunities,
        lostOpportunities,
        contactedRate: toPercent(contactedLeads, leads.length),
        wonRate: toPercent(wonOpportunities, leads.length),
        topSourcePaths: countBy(leads, (lead) => lead.source_path || 'Sin ruta'),
        topInterests: countBy(leads, (lead) => lead.interest || 'Sin interes'),
        topPreferredPackages: countBy(leads, (lead) => lead.preferred_package || 'Sin plan'),
        levelSummary: countBy(leads, (lead) => lead.current_level || 'Sin nivel'),
        pipelineStageSummary: countBy(opportunities, (opportunity) => opportunity.stage || 'Sin etapa'),
        sourcePerformance: Array.from(sourcePerformance.values())
            .sort((left, right) => (
                right.won - left.won
                || right.qualified - left.qualified
                || right.contacted - left.contacted
                || right.total - left.total
                || left.sourcePath.localeCompare(right.sourcePath, 'es')
            ))
            .slice(0, 5),
    };
}

async function requireAdmin(context: APIContext) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: jsonResponse({ error: 'Unauthorized' }, 401), user: null };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'admin') {
        return { error: jsonResponse({ error: 'Forbidden. Admin privileges required.' }, 403), user: null };
    }

    return { error: null, user };
}

async function logAudit(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        entityId: string;
        before?: Json | null;
        after?: Json | null;
        action?: string;
        entityType?: string;
    }
) {
    const { error } = await supabaseAdmin
        .from('admin_audit_log')
        .insert({
            admin_id: input.adminId,
            action: input.action ?? 'lead.update',
            entity_type: input.entityType ?? 'lead',
            entity_id: input.entityId,
            before: input.before ?? null,
            after: input.after ?? null,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminLeads] Failed to write audit log:', error);
    }
}

async function closeLeadRelatedTasks(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { leadId: string; completedAt: string; relatedEntityTypes: string[] }
) {
    if (input.relatedEntityTypes.length === 0) return;

    const { error } = await supabaseAdmin
        .from('crm_tasks')
        .update({
            status: 'done',
            completed_at: input.completedAt,
            updated_at: input.completedAt,
        })
        .in('related_entity_type', input.relatedEntityTypes)
        .eq('related_entity_id', input.leadId)
        .in('status', ['open', 'snoozed']);

    if (error && !isMissingCrmTable(error)) {
        throw error;
    }
}

async function closeInitialLeadReviewTasks(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { leadId: string; completedAt: string }
) {
    await closeLeadRelatedTasks(supabaseAdmin, {
        leadId: input.leadId,
        completedAt: input.completedAt,
        relatedEntityTypes: ['lead'],
    });
}

async function closeTerminalLeadTasks(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { leadId: string; completedAt: string }
) {
    await closeLeadRelatedTasks(supabaseAdmin, {
        leadId: input.leadId,
        completedAt: input.completedAt,
        relatedEntityTypes: ['lead', 'level_check', 'lead_sales_follow_up'],
    });
}

async function closeOpportunityNurtureTasks(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { opportunityId: string; completedAt: string }
) {
    const { error } = await supabaseAdmin
        .from('crm_tasks')
        .update({
            status: 'done',
            completed_at: input.completedAt,
            updated_at: input.completedAt,
        })
        .eq('related_entity_type', 'crm_opportunity')
        .eq('related_entity_id', input.opportunityId)
        .in('status', ['open', 'snoozed']);

    if (error && !isMissingCrmTable(error)) {
        throw error;
    }
}

async function ensureSalesEmailFollowUpTask(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        leadId: string;
        contactId: string;
        opportunityId: string | null;
        template: SalesEmailTemplate;
        dueAt: string;
        now: string;
    }
) {
    const relatedEntityType = 'lead_sales_follow_up';
    const { data: existingTask, error: findError } = await supabaseAdmin
        .from('crm_tasks')
        .select('id')
        .eq('contact_id', input.contactId)
        .eq('task_type', 'email')
        .eq('related_entity_type', relatedEntityType)
        .eq('related_entity_id', input.leadId)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (findError) {
        if (isMissingCrmTable(findError)) return;
        throw findError;
    }

    const taskPayload = {
        assigned_to: input.adminId,
        status: 'open',
        due_at: input.dueAt,
        updated_at: input.now,
        metadata: {
            action: 'sales_email_follow_up',
            template: input.template,
            follow_up_hours: 24,
            lead_id: input.leadId,
        },
    };

    const result = existingTask?.id
        ? await supabaseAdmin
            .from('crm_tasks')
            .update(taskPayload)
            .eq('id', existingTask.id)
        : await supabaseAdmin
            .from('crm_tasks')
            .insert({
                contact_id: input.contactId,
                opportunity_id: input.opportunityId,
                assigned_to: input.adminId,
                title: input.template === 'proposal_next_step'
                    ? 'Follow up after proposal email'
                    : 'Follow up after missing-info email',
                task_type: 'email',
                priority: input.template === 'proposal_next_step' ? 'high' : 'normal',
                due_at: input.dueAt,
                related_entity_type: relatedEntityType,
                related_entity_id: input.leadId,
                metadata: taskPayload.metadata,
            });

    if (result.error && !isMissingCrmTable(result.error)) {
        throw result.error;
    }
}

async function syncLeadStatusToCrm(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; before: Lead; lead: Lead; newStatus: LeadStatus }
) {
    const statusMapping = mapLeadStatusToCrm(input.newStatus);
    const now = new Date().toISOString();

    let opportunityId = input.lead.crm_opportunity_id;
    let contactId = input.lead.crm_contact_id;

    if (!opportunityId || !contactId) {
        const { data: opportunity, error } = await supabaseAdmin
            .from('crm_opportunities')
            .select('id, contact_id')
            .eq('legacy_lead_id', input.lead.id)
            .maybeSingle();

        if (error) {
            if (isMissingCrmTable(error)) return;
            throw error;
        }

        opportunityId = opportunity?.id ?? opportunityId;
        contactId = opportunity?.contact_id ?? contactId;
    }

    if (!opportunityId || !contactId) return;

    const { error: opportunityError } = await supabaseAdmin
        .from('crm_opportunities')
        .update({
            stage: statusMapping.opportunityStage,
            closed_at: statusMapping.opportunityStage === 'lost' ? now : null,
            updated_at: now,
        })
        .eq('id', opportunityId);

    if (opportunityError) {
        if (isMissingCrmTable(opportunityError)) return;
        throw opportunityError;
    }

    const contactUpdate: TablesUpdate<'crm_contacts'> = {
        lifecycle_stage: statusMapping.contactLifecycle,
        updated_at: now,
    };

    if (input.newStatus === 'contacted') {
        contactUpdate.last_contacted_at = now;
    }

    const { error: contactError } = await supabaseAdmin
        .from('crm_contacts')
        .update(contactUpdate)
        .eq('id', contactId);

    if (contactError) {
        if (isMissingCrmTable(contactError)) return;
        throw contactError;
    }

    const { error: activityError } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: contactId,
            opportunity_id: opportunityId,
            actor_id: input.adminId,
            activity_type: 'system',
            subject: statusMapping.activitySubject,
            occurred_at: now,
            metadata: {
                previous_status: input.before.status,
                new_status: input.newStatus,
            },
            related_entity_type: 'lead',
            related_entity_id: input.lead.id,
        });

    if (activityError) {
        if (isMissingCrmTable(activityError)) return;
        throw activityError;
    }
}

async function attachCrmOpportunityData(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    leads: Lead[]
) {
    if (leads.length === 0) return [];

    const leadIds = leads.map((lead) => lead.id);
    const { data, error } = await supabaseAdmin
        .from('crm_opportunities')
        .select(`
            id,
            legacy_lead_id,
            stage,
            contact_id,
            opened_at,
            closed_at,
            current_level,
            learning_goal,
            availability,
            packages (
                name,
                display_name
            ),
            crm_contacts (
                id,
                lifecycle_stage,
                next_follow_up_at,
                last_contacted_at
            )
        `)
        .in('legacy_lead_id', leadIds);

    if (error) {
        if (isMissingCrmTable(error)) {
            return leads.map((lead) => ({ ...lead, crm_opportunity: null }));
        }
        throw error;
    }

    const opportunitiesByLeadId = new Map(
        ((data ?? []) as LeadCrmOpportunity[])
            .filter((opportunity) => opportunity.legacy_lead_id)
            .map((opportunity) => [opportunity.legacy_lead_id as string, opportunity])
    );

    return leads.map((lead) => ({
        ...lead,
        crm_opportunity: opportunitiesByLeadId.get(lead.id) ?? null,
    }));
}

async function loadLeadPipelineSummary(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
) {
    const { data: leads, error } = await supabaseAdmin
        .from('leads')
        .select('id, status, interest, current_level, preferred_package, source_path, created_at')
        .order('created_at', { ascending: false })
        .limit(500);

    if (error) {
        throw error;
    }

    const summaryLeads = (leads ?? []) as LeadSummaryRecord[];
    if (summaryLeads.length === 0) {
        return buildLeadPipelineSummary([], []);
    }

    const leadIds = summaryLeads.map((lead) => lead.id);
    const { data: opportunities, error: opportunityError } = await supabaseAdmin
        .from('crm_opportunities')
        .select('legacy_lead_id, stage')
        .in('legacy_lead_id', leadIds);

    if (opportunityError) {
        if (isMissingCrmTable(opportunityError)) {
            return buildLeadPipelineSummary(summaryLeads, []);
        }
        throw opportunityError;
    }

    return buildLeadPipelineSummary(summaryLeads, (opportunities ?? []) as LeadOpportunitySummaryRecord[]);
}

async function updateOpportunityStage(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; opportunityId: string; newStage: CrmOpportunityStage }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('crm_opportunities')
        .select('id, contact_id, legacy_lead_id, stage')
        .eq('id', input.opportunityId)
        .single();

    if (beforeError || !before) {
        if (isMissingCrmTable(beforeError)) {
            return { error: jsonResponse({ error: 'CRM pipeline is not migrated yet' }, 409), opportunity: null };
        }
        return { error: jsonResponse({ error: 'CRM opportunity not found' }, 404), opportunity: null };
    }

    const now = new Date().toISOString();
    const { data: opportunity, error: updateError } = await supabaseAdmin
        .from('crm_opportunities')
        .update({
            stage: input.newStage,
            closed_at: input.newStage === 'won' || input.newStage === 'lost' ? now : null,
            updated_at: now,
        })
        .eq('id', input.opportunityId)
        .select(`
            id,
            legacy_lead_id,
            stage,
            contact_id,
            opened_at,
            closed_at,
            current_level,
            learning_goal,
            availability,
            packages (
                name,
                display_name
            ),
            crm_contacts (
                id,
                lifecycle_stage,
                next_follow_up_at,
                last_contacted_at
            )
        `)
        .single();

    if (updateError || !opportunity) {
        console.error('[AdminLeads] Could not update CRM opportunity stage:', updateError);
        return { error: jsonResponse({ error: 'Could not update CRM opportunity stage' }, 500), opportunity: null };
    }

    const nurtureFollowUpAt = input.newStage === 'nurture' ? addDaysIso(new Date(now), 7) : null;
    const contactUpdate: TablesUpdate<'crm_contacts'> = {
        lifecycle_stage: mapOpportunityStageToContactLifecycle(input.newStage),
        updated_at: now,
    };
    if (['contacted', 'qualified', 'proposal'].includes(input.newStage)) {
        contactUpdate.last_contacted_at = now;
    }
    if (nurtureFollowUpAt) {
        contactUpdate.next_follow_up_at = nurtureFollowUpAt;
    }

    const { error: contactError } = await supabaseAdmin
        .from('crm_contacts')
        .update(contactUpdate)
        .eq('id', before.contact_id);

    if (contactError) {
        console.error('[AdminLeads] Could not sync CRM contact after stage change:', contactError);
        return { error: jsonResponse({ error: 'Opportunity updated but contact sync failed' }, 500), opportunity: null };
    }

    if (before.legacy_lead_id) {
        const nextLeadStatus = mapOpportunityStageToLeadStatus(input.newStage);
        let leadUpdate = await supabaseAdmin
            .from('leads')
            .update(buildLeadStatusUpdate(nextLeadStatus, now, {
                clearLevelCheckRaw: input.newStage === 'won',
            }))
            .eq('id', before.legacy_lead_id);

        if (leadUpdate.error && isMissingLevelCheckColumn(leadUpdate.error)) {
            leadUpdate = await supabaseAdmin
                .from('leads')
                .update({ status: nextLeadStatus, updated_at: now })
                .eq('id', before.legacy_lead_id);
        }

        if (leadUpdate.error) {
            console.error('[AdminLeads] Could not sync legacy lead after stage change:', leadUpdate.error);
            return { error: jsonResponse({ error: 'Opportunity updated but lead sync failed' }, 500), opportunity: null };
        }

        if (nextLeadStatus === 'discarded' || input.newStage === 'won') {
            try {
                await closeTerminalLeadTasks(supabaseAdmin, {
                    leadId: before.legacy_lead_id,
                    completedAt: now,
                });
            } catch (error) {
                console.error('[AdminLeads] Could not close terminal lead tasks after opportunity closure:', error);
                return { error: jsonResponse({ error: 'Opportunity updated but lead task cleanup failed' }, 500), opportunity: null };
            }
        } else if (nextLeadStatus === 'contacted') {
            try {
                await closeInitialLeadReviewTasks(supabaseAdmin, {
                    leadId: before.legacy_lead_id,
                    completedAt: now,
                });
            } catch (error) {
                console.error('[AdminLeads] Could not close initial lead review task after opportunity progress:', error);
                return { error: jsonResponse({ error: 'Opportunity updated but lead review task cleanup failed' }, 500), opportunity: null };
            }
        }
    }

    if (before.stage === 'nurture' && input.newStage !== 'nurture') {
        try {
            await closeOpportunityNurtureTasks(supabaseAdmin, {
                opportunityId: before.id,
                completedAt: now,
            });
        } catch (error) {
            console.error('[AdminLeads] Could not close nurture follow-up task after opportunity resumed:', error);
            return { error: jsonResponse({ error: 'Opportunity updated but nurture task cleanup failed' }, 500), opportunity: null };
        }
    }

    if (input.newStage === 'nurture' && nurtureFollowUpAt) {
        const existingTask = await supabaseAdmin
            .from('crm_tasks')
            .select('id')
            .eq('opportunity_id', before.id)
            .eq('related_entity_type', 'crm_opportunity')
            .eq('related_entity_id', before.id)
            .in('status', ['open', 'snoozed'])
            .maybeSingle();

        if (existingTask.error) {
            if (isMissingCrmTable(existingTask.error)) return { error: null, opportunity: opportunity as LeadCrmOpportunity };
            console.error('[AdminLeads] Could not load nurture follow-up task:', existingTask.error);
            return { error: jsonResponse({ error: 'Opportunity updated but follow-up task lookup failed' }, 500), opportunity: null };
        }

        const followUpTask = existingTask.data?.id
            ? await supabaseAdmin
                .from('crm_tasks')
                .update({
                    assigned_to: input.adminId,
                    status: 'open',
                    due_at: nurtureFollowUpAt,
                    updated_at: now,
                })
                .eq('id', existingTask.data.id)
            : await supabaseAdmin
                .from('crm_tasks')
                .insert({
                    contact_id: before.contact_id,
                    opportunity_id: before.id,
                    assigned_to: input.adminId,
                    title: 'Revisar lead pospuesto',
                    task_type: 'review',
                    priority: 'normal',
                    due_at: nurtureFollowUpAt,
                    related_entity_type: 'crm_opportunity',
                    related_entity_id: before.id,
                    metadata: {
                        action: 'nurture_follow_up',
                        stage: 'nurture',
                        legacy_lead_id: before.legacy_lead_id,
                        follow_up_days: 7,
                    },
                });

        if (followUpTask.error) {
            if (isMissingCrmTable(followUpTask.error)) return { error: null, opportunity: opportunity as LeadCrmOpportunity };
            console.error('[AdminLeads] Could not create nurture follow-up task:', followUpTask.error);
            return { error: jsonResponse({ error: 'Opportunity updated but follow-up task failed' }, 500), opportunity: null };
        }
    }

    const { error: activityError } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: before.contact_id,
            opportunity_id: before.id,
            actor_id: input.adminId,
            activity_type: 'system',
            subject: 'Etapa de oportunidad actualizada',
            occurred_at: now,
            metadata: {
                previous_stage: before.stage,
                new_stage: input.newStage,
                legacy_lead_id: before.legacy_lead_id,
                next_follow_up_at: nurtureFollowUpAt,
            },
            related_entity_type: 'crm_opportunity',
            related_entity_id: before.id,
        });

    if (activityError) {
        console.error('[AdminLeads] Could not write CRM activity after stage change:', activityError);
        return { error: jsonResponse({ error: 'Opportunity updated but CRM activity failed' }, 500), opportunity: null };
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        entityId: before.id,
        before: before as Json,
        after: opportunity as Json,
        action: 'crm_opportunity.stage.update',
        entityType: 'crm_opportunity',
    });

    return { error: null, opportunity: opportunity as LeadCrmOpportunity };
}

async function sendLevelCheckInvite(
    context: APIContext,
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; leadId: string }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', input.leadId)
        .single();

    if (beforeError || !before) {
        return { error: jsonResponse({ error: 'Lead not found' }, 404), lead: null };
    }

    const preflight = await supabaseAdmin
        .from('leads')
        .select('level_check_status')
        .eq('id', input.leadId)
        .single();

    if (preflight.error) {
        if (isMissingLevelCheckColumn(preflight.error)) {
            return { error: jsonResponse({ error: 'Level check fields are not migrated yet' }, 409), lead: null };
        }
        console.error('[AdminLeads] Could not verify level check fields:', preflight.error);
        return { error: jsonResponse({ error: 'Could not verify level check readiness' }, 500), lead: null };
    }

    if (!before.email) {
        return { error: jsonResponse({ error: 'Lead has no email' }, 400), lead: null };
    }

    const diagnosticUrl = buildDiagnosticUrl(context, before as Lead);
    const sent = await sendLevelCheckInviteEmail(before.email, {
        recipientName: before.name ?? undefined,
        diagnosticUrl,
    });

    if (!sent) {
        return { error: jsonResponse({ error: 'Could not send level check invite' }, 502), lead: null };
    }

    const now = new Date().toISOString();
    const { data: lead, error: updateError } = await supabaseAdmin
        .from('leads')
        .update({
            level_check_status: 'sent',
            updated_at: now,
        } satisfies TablesUpdate<'leads'>)
        .eq('id', input.leadId)
        .select('*')
        .single();

    if (updateError || !lead) {
        console.error('[AdminLeads] Could not mark level check as sent:', updateError);
        return { error: jsonResponse({ error: 'Invite sent but lead status update failed' }, 500), lead: null };
    }

    const crmLead = await loadLeadCaptureForCrm(supabaseAdmin, before.email.toLowerCase()).catch((error) => {
        console.error('[AdminLeads] Could not reload lead after level check invite:', error);
        return null;
    });
    const crmSync = crmLead ? await syncLeadCaptureToCrmSafe(supabaseAdmin, crmLead) : null;

    if (crmLead && crmSync?.status === 'synced') {
        await recordLeadEmailOutInCrmSafe(supabaseAdmin, {
            lead: crmLead,
            contactId: crmSync.contactId,
            opportunityId: crmSync.opportunityId,
            subject: 'A few level questions - Espanol Honesto',
            template: 'level_check_invite',
        });
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        entityId: input.leadId,
        before: before as Json,
        after: lead as Json,
        action: 'lead.level_check.send',
    });

    return { error: null, lead: lead as Lead, diagnosticUrl };
}

async function markLevelCheckReviewed(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; leadId: string }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', input.leadId)
        .single();

    if (beforeError || !before) {
        return { error: jsonResponse({ error: 'Lead not found' }, 404), lead: null };
    }

    if (before.level_check_status !== 'received') {
        return { error: jsonResponse({ error: 'Level check is not ready to review' }, 409), lead: null };
    }

    const now = new Date().toISOString();
    const { data: lead, error: updateError } = await supabaseAdmin
        .from('leads')
        .update({
            level_check_status: 'reviewed',
            level_check_context: {},
            level_check_raw_cleared_at: now,
            level_check_reviewed_at: now,
            updated_at: now,
        } satisfies TablesUpdate<'leads'>)
        .eq('id', input.leadId)
        .select('*')
        .single();

    if (updateError || !lead) {
        if (isMissingLevelCheckColumn(updateError)) {
            return { error: jsonResponse({ error: 'Level check fields are not migrated yet' }, 409), lead: null };
        }
        console.error('[AdminLeads] Could not mark level check as reviewed:', updateError);
        return { error: jsonResponse({ error: 'Could not mark level check as reviewed' }, 500), lead: null };
    }

    const taskUpdate = await supabaseAdmin
        .from('crm_tasks')
        .update({
            status: 'done',
            completed_at: now,
            updated_at: now,
        })
        .eq('related_entity_type', 'level_check')
        .eq('related_entity_id', input.leadId)
        .in('status', ['open', 'snoozed']);

    if (taskUpdate.error && !isMissingCrmTable(taskUpdate.error)) {
        console.error('[AdminLeads] Could not close level check review task:', taskUpdate.error);
    }

    const contactId = before.crm_contact_id ?? lead.crm_contact_id;
    const opportunityId = before.crm_opportunity_id ?? lead.crm_opportunity_id;
    if (contactId) {
        const activity = await supabaseAdmin
            .from('crm_activities')
            .insert({
                contact_id: contactId,
                opportunity_id: opportunityId,
                actor_id: input.adminId,
                activity_type: 'system',
                subject: 'Lightweight level check reviewed',
                body: lead.level_check_summary,
                occurred_at: now,
                metadata: {
                    action: 'review_level_check',
                    raw_context_cleared: true,
                    level_check_status: 'reviewed',
                    level_check_reviewed_at: now,
                    level_check_raw_cleared_at: now,
                },
                related_entity_type: 'level_check',
                related_entity_id: input.leadId,
            });

        if (activity.error && !isMissingCrmTable(activity.error)) {
            console.error('[AdminLeads] Could not write level check reviewed activity:', activity.error);
        }
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        entityId: input.leadId,
        before: before as Json,
        after: lead as Json,
        action: 'lead.level_check.review',
    });

    return { error: null, lead: lead as Lead };
}

async function sendSalesFollowUpEmail(
    context: APIContext,
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; leadId: string; template: SalesEmailTemplate }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', input.leadId)
        .single();

    if (beforeError || !before) {
        return { error: jsonResponse({ error: 'Lead not found' }, 404), lead: null };
    }

    if (before.status === 'discarded') {
        return { error: jsonResponse({ error: 'Discarded leads must be reopened before sending follow-up' }, 409), lead: null };
    }

    if (!before.email) {
        return { error: jsonResponse({ error: 'Lead has no email' }, 400), lead: null };
    }

    const crmLead = await loadLeadCaptureForCrm(supabaseAdmin, before.email.toLowerCase()).catch((error) => {
        console.error('[AdminLeads] Could not reload lead before sales follow-up:', error);
        return null;
    });
    const crmSync = crmLead ? await syncLeadCaptureToCrmSafe(supabaseAdmin, crmLead) : null;
    if (!crmLead || crmSync?.status !== 'synced') {
        return {
            error: jsonResponse({
                error: 'CRM consent could not be verified before follow-up',
                reason: crmSync?.status === 'skipped' ? crmSync.reason : 'missing_crm_contact',
            }, 409),
            lead: null,
        };
    }

    const consentError = await verifySalesFollowUpConsent(supabaseAdmin, crmSync.contactId);
    if (consentError) {
        return { error: consentError, lead: null };
    }

    const diagnosticUrl = buildDiagnosticUrl(context, before as Lead);
    const sent = input.template === 'missing_info'
        ? await sendMissingInfoEmail(before.email, {
            recipientName: before.name ?? undefined,
            diagnosticUrl,
        })
        : await sendProposalNextStepEmail(before.email, {
            recipientName: before.name ?? undefined,
            planRecommendation: before.level_check_plan_recommendation ?? before.preferred_package ?? null,
        });

    if (!sent) {
        return { error: jsonResponse({ error: 'Could not send follow-up email' }, 502), lead: null };
    }

    const now = new Date().toISOString();
    let lead = before as Lead;

    if (before.status !== 'contacted') {
        const { data: updatedLead, error: updateError } = await supabaseAdmin
            .from('leads')
            .update({
                status: 'contacted',
                updated_at: now,
            } satisfies TablesUpdate<'leads'>)
            .eq('id', input.leadId)
            .select('*')
            .single();

        if (updateError || !updatedLead) {
            console.error('[AdminLeads] Follow-up sent but lead status update failed:', updateError);
            return { error: jsonResponse({ error: 'Email sent but lead status update failed' }, 500), lead: null };
        }

        lead = updatedLead as Lead;
    }

    if (crmLead && crmSync?.status === 'synced') {
        await recordLeadEmailOutInCrmSafe(supabaseAdmin, {
            lead: crmLead,
            contactId: crmSync.contactId,
            opportunityId: crmSync.opportunityId,
            subject: salesEmailSubject(input.template),
            template: input.template,
        });

        const nextFollowUpAt = addHoursIso(new Date(now), 24);
        const contactUpdate = await supabaseAdmin
            .from('crm_contacts')
            .update({
                lifecycle_stage: 'qualified',
                last_contacted_at: now,
                next_follow_up_at: nextFollowUpAt,
                updated_at: now,
            })
            .eq('id', crmSync.contactId);

        if (contactUpdate.error && !isMissingCrmTable(contactUpdate.error)) {
            console.error('[AdminLeads] Could not update contact after sales email:', contactUpdate.error);
        }

        if (crmSync.opportunityId) {
            const opportunityUpdate = await supabaseAdmin
                .from('crm_opportunities')
                .update({
                    stage: salesEmailOpportunityStage(input.template),
                    closed_at: null,
                    updated_at: now,
                })
                .eq('id', crmSync.opportunityId);

            if (opportunityUpdate.error && !isMissingCrmTable(opportunityUpdate.error)) {
                console.error('[AdminLeads] Could not update opportunity after sales email:', opportunityUpdate.error);
            }
        }

        try {
            await ensureSalesEmailFollowUpTask(supabaseAdmin, {
                adminId: input.adminId,
                leadId: input.leadId,
                contactId: crmSync.contactId,
                opportunityId: crmSync.opportunityId,
                template: input.template,
                dueAt: nextFollowUpAt,
                now,
            });
        } catch (error) {
            console.error('[AdminLeads] Could not create follow-up task after sales email:', error);
            return { error: jsonResponse({ error: 'Email sent but follow-up task failed' }, 500), lead: null };
        }
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        entityId: input.leadId,
        before: before as Json,
        after: lead as Json,
        action: `lead.sales_email.${input.template}.send`,
    });

    return { error: null, lead, template: input.template };
}

// [GET] Listar todos los leads capturados (Requerido: Rol 'admin')
export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const status = url.searchParams.get('status');
    const parsedLimit = Number(url.searchParams.get('limit') || 100);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100, 100);
    const supabaseAdmin = createSupabaseAdminClient();

    // Extracción de datos (ordenados por fecha descendente, los más nuevos arriba)
    let query = supabaseAdmin
        .from('leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (status && status !== 'all') {
        if (!leadStatuses.includes(status as typeof leadStatuses[number])) {
            return jsonResponse({ error: 'Invalid status filter' }, 400);
        }
        const statusFilter = status as typeof leadStatuses[number];
        query = query.eq('status', statusFilter);
    }

    const { data: leads, error } = await query;

    if (error) {
        console.error('[AdminLeads] Could not load leads:', error);
        return jsonResponse({ error: 'Could not load leads' }, 500);
    }

    try {
        const [enrichedLeads, summary] = await Promise.all([
            attachCrmOpportunityData(supabaseAdmin, (leads ?? []) as Lead[]),
            loadLeadPipelineSummary(supabaseAdmin),
        ]);
        return jsonResponse({ leads: enrichedLeads, summary });
    } catch (crmError) {
        console.error('[AdminLeads] Could not attach CRM opportunity data:', crmError);
        return jsonResponse({ error: 'Could not load CRM pipeline data' }, 500);
    }
};

// [PUT] Actualizar el estado (status) de un lead específico en el CRM
async function updateLeadStatus(context: APIContext) {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsedLevelCheckSend = sendLevelCheckSchema.safeParse(rawBody);
    if (parsedLevelCheckSend.success) {
        const supabaseAdmin = createSupabaseAdminClient();
        const result = await sendLevelCheckInvite(context, supabaseAdmin, {
            adminId: auth.user.id,
            leadId: parsedLevelCheckSend.data.leadId,
        });

        if (result.error) return result.error;
        return jsonResponse({
            lead: result.lead,
            diagnosticUrl: result.diagnosticUrl,
            emailSent: true,
        });
    }

    const parsedLevelCheckReview = reviewLevelCheckSchema.safeParse(rawBody);
    if (parsedLevelCheckReview.success) {
        const supabaseAdmin = createSupabaseAdminClient();
        const result = await markLevelCheckReviewed(supabaseAdmin, {
            adminId: auth.user.id,
            leadId: parsedLevelCheckReview.data.leadId,
        });

        if (result.error) return result.error;
        return jsonResponse({ lead: result.lead });
    }

    const parsedSalesEmailSend = sendSalesEmailSchema.safeParse(rawBody);
    if (parsedSalesEmailSend.success) {
        const supabaseAdmin = createSupabaseAdminClient();
        const result = await sendSalesFollowUpEmail(context, supabaseAdmin, {
            adminId: auth.user.id,
            leadId: parsedSalesEmailSend.data.leadId,
            template: parsedSalesEmailSend.data.template,
        });

        if (result.error) return result.error;
        return jsonResponse({
            lead: result.lead,
            template: result.template,
            emailSent: true,
        });
    }

    const parsedOpportunityStage = updateOpportunityStageSchema.safeParse(rawBody);
    if (parsedOpportunityStage.success) {
        const supabaseAdmin = createSupabaseAdminClient();
        const result = await updateOpportunityStage(supabaseAdmin, {
            adminId: auth.user.id,
            opportunityId: parsedOpportunityStage.data.opportunityId,
            newStage: parsedOpportunityStage.data.newStage,
        });

        if (result.error) return result.error;
        return jsonResponse({ opportunity: result.opportunity });
    }

    const parsed = updateLeadSchema.safeParse(rawBody);
    if (!parsed.success) {
        return jsonResponse({ error: 'Invalid lead update' }, 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', parsed.data.leadId)
        .single();

    if (beforeError || !before) {
        return jsonResponse({ error: 'Lead not found' }, 404);
    }

    const now = new Date().toISOString();
    let updateResult = await supabaseAdmin
        .from('leads')
        .update(buildLeadStatusUpdate(parsed.data.newStatus, now))
        .eq('id', parsed.data.leadId)
        .select('*')
        .single();

    if (updateResult.error && isMissingLevelCheckColumn(updateResult.error)) {
        updateResult = await supabaseAdmin
            .from('leads')
            .update({ status: parsed.data.newStatus, updated_at: now })
            .eq('id', parsed.data.leadId)
            .select('*')
            .single();
    }

    const { data: lead, error: updateError } = updateResult;

    if (updateError || !lead) {
        console.error('[AdminLeads] Could not update lead:', updateError);
        return jsonResponse({ error: 'Could not update lead' }, 500);
    }

    if (before.status !== parsed.data.newStatus) {
        try {
            await syncLeadStatusToCrm(supabaseAdmin, {
                adminId: auth.user.id,
                before,
                lead,
                newStatus: parsed.data.newStatus,
            });
        } catch (error) {
            console.error('[AdminLeads] Could not sync lead status to CRM:', error);
            return jsonResponse({ error: 'Lead updated but CRM sync failed' }, 500);
        }
    }

    if (parsed.data.newStatus === 'discarded') {
        try {
            await closeTerminalLeadTasks(supabaseAdmin, {
                leadId: parsed.data.leadId,
                completedAt: now,
            });
        } catch (error) {
            console.error('[AdminLeads] Could not close terminal lead tasks after lead discard:', error);
            return jsonResponse({ error: 'Lead updated but lead task cleanup failed' }, 500);
        }
    } else if (parsed.data.newStatus === 'contacted') {
        try {
            await closeInitialLeadReviewTasks(supabaseAdmin, {
                leadId: parsed.data.leadId,
                completedAt: now,
            });
        } catch (error) {
            console.error('[AdminLeads] Could not close initial lead review task after lead contact:', error);
            return jsonResponse({ error: 'Lead updated but lead review task cleanup failed' }, 500);
        }
    }

    await logAudit(supabaseAdmin, {
        adminId: auth.user.id,
        entityId: parsed.data.leadId,
        before: before as Json,
        after: lead as Json,
    });

    return jsonResponse({ lead });
}

export const PUT: APIRoute = updateLeadStatus;
export const POST: APIRoute = updateLeadStatus;
