import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { ensureCrmContactForProfile } from '../../../../lib/crm/activity-sync';
import { createSupabaseAdminClient } from '../../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../../lib/supabase-server';
import type { Database, Json } from '../../../../types/database.types';

type CrmTaskInsert = Database['public']['Tables']['crm_tasks']['Insert'];
type CrmTaskUpdate = Database['public']['Tables']['crm_tasks']['Update'];
type CrmConsentInsert = Database['public']['Tables']['crm_consents']['Insert'];
type CrmConsentUpdate = Database['public']['Tables']['crm_consents']['Update'];
type CrmContactUpdate = Database['public']['Tables']['crm_contacts']['Update'];
type LeadStatus = Database['public']['Enums']['lead_status'];
type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export const config = {
    runtime: 'nodejs',
};

const jsonHeaders = { 'Content-Type': 'application/json' };
const taskTypes = ['email', 'call', 'whatsapp', 'review', 'admin'] as const;
const priorities = ['low', 'normal', 'high', 'urgent'] as const;
const taskStatuses = ['open', 'done', 'snoozed', 'cancelled'] as const;
const communicationTypes = ['email_in', 'email_out', 'call', 'whatsapp'] as const;
const communicationDirections = ['inbound', 'outbound'] as const;
const consentChannels = ['email', 'phone', 'whatsapp'] as const;
const consentPurposes = ['transactional', 'support', 'marketing', 'sales_follow_up'] as const;
const legalBases = ['consent', 'contract', 'prior_customer_similar_services', 'legitimate_interest', 'manual_review_required'] as const;
const crmOpportunityStages = ['new', 'to_contact', 'contacted', 'qualified', 'proposal', 'won', 'lost', 'nurture'] as const;
const taskSelect = 'id, contact_id, opportunity_id, assigned_to, title, task_type, priority, status, due_at, completed_at, related_entity_type, related_entity_id, metadata, created_at, updated_at';
const consentSelect = 'id, contact_id, channel, purpose, legal_basis, source, proof, notice_version, captured_at, opted_out_at, created_at, updated_at';
const opportunitySelect = 'id, contact_id, legacy_lead_id, stage, interest, current_level, learning_goal, availability, lost_reason, opened_at, closed_at, preferred_package_id, updated_at';
type CrmOpportunityStage = typeof crmOpportunityStages[number];
type CommunicationOpportunitySnapshot = {
    id: string;
    contact_id: string;
    legacy_lead_id: string | null;
    stage: CrmOpportunityStage;
};

const createTaskSchema = z.object({
    action: z.literal('create_task'),
    contactId: z.string().uuid(),
    opportunityId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(240),
    taskType: z.enum(taskTypes).default('review'),
    priority: z.enum(priorities).default('normal'),
    dueAt: z.string().datetime().nullable().optional(),
});

const createNoteSchema = z.object({
    action: z.literal('create_note'),
    contactId: z.string().uuid(),
    opportunityId: z.string().uuid().nullable().optional(),
    subject: z.string().trim().max(160).nullable().optional(),
    body: z.string().trim().min(1).max(5000),
});

const createCommunicationSchema = z.object({
    action: z.literal('create_communication'),
    contactId: z.string().uuid(),
    opportunityId: z.string().uuid().nullable().optional(),
    communicationType: z.enum(communicationTypes),
    direction: z.enum(communicationDirections).default('outbound'),
    purpose: z.enum(consentPurposes).default('sales_follow_up'),
    subject: z.string().trim().max(160).nullable().optional(),
    body: z.string().trim().min(1).max(5000),
    occurredAt: z.string().datetime().nullable().optional(),
    consentOverrideReason: z.string().trim().max(1000).nullable().optional(),
});

const upsertConsentSchema = z.object({
    action: z.literal('upsert_consent'),
    contactId: z.string().uuid(),
    channel: z.enum(consentChannels),
    purpose: z.enum(consentPurposes),
    legalBasis: z.enum(legalBases),
    source: z.string().trim().max(160).nullable().optional(),
    proof: z.string().trim().max(1000).nullable().optional(),
    noticeVersion: z.string().trim().max(80).nullable().optional(),
    capturedAt: z.string().datetime().nullable().optional(),
});

const optOutConsentSchema = z.object({
    action: z.literal('opt_out_consent'),
    consentId: z.string().uuid(),
    reason: z.string().trim().max(1000).nullable().optional(),
});

const completeTaskSchema = z.object({
    action: z.literal('complete_task'),
    taskId: z.string().uuid(),
});

const claimTaskSchema = z.object({
    action: z.literal('claim_task'),
    taskId: z.string().uuid(),
});

const snoozeTaskSchema = z.object({
    action: z.literal('snooze_task'),
    taskId: z.string().uuid(),
    dueAt: z.string().datetime(),
});

const cancelTaskSchema = z.object({
    action: z.literal('cancel_task'),
    taskId: z.string().uuid(),
});

const updateTaskSchema = z.object({
    action: z.literal('update_task'),
    taskId: z.string().uuid(),
    title: z.string().trim().min(1).max(240).optional(),
    taskType: z.enum(taskTypes).optional(),
    priority: z.enum(priorities).optional(),
    status: z.enum(taskStatuses).optional(),
    dueAt: z.string().datetime().nullable().optional(),
}).refine((value) => (
    value.title !== undefined
    || value.taskType !== undefined
    || value.priority !== undefined
    || value.status !== undefined
    || value.dueAt !== undefined
), { message: 'At least one task field must be provided' });

const updateOpportunityStageSchema = z.object({
    action: z.literal('update_opportunity_stage'),
    opportunityId: z.string().uuid(),
    newStage: z.enum(crmOpportunityStages),
});

const createPaymentRecoveryTaskSchema = z.object({
    action: z.literal('create_payment_recovery_task'),
    paymentId: z.string().uuid(),
    dueAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
});

const createSubscriptionRenewalTaskSchema = z.object({
    action: z.literal('create_subscription_renewal_task'),
    subscriptionId: z.string().uuid(),
    dueAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
});

function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function isMissingCrmTable(error: { code?: string; message?: string } | null | undefined) {
    return error?.code === '42P01'
        || error?.message?.includes('crm_') === true
        || error?.message?.includes('does not exist') === true;
}

function isMissingLevelCheckColumn(error: { code?: string; message?: string } | null | undefined) {
    const message = error?.message ?? '';
    return message.includes('level_check_') && (error?.code === 'PGRST204' || error?.code === '42703' || error?.code === undefined);
}

function buildLeadStatusUpdate(status: LeadStatus, now: string, options: { clearLevelCheckRaw?: boolean } = {}): LeadUpdate {
    const update: LeadUpdate = {
        status,
        updated_at: now,
    };

    if (status === 'discarded' || options.clearLevelCheckRaw) {
        update.level_check_context = {};
        update.level_check_raw_cleared_at = now;
    }

    return update;
}

function mapOpportunityStageToLeadStatus(stage: CrmOpportunityStage) {
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

function channelForCommunication(type: (typeof communicationTypes)[number]) {
    if (type === 'call') return 'phone';
    if (type === 'whatsapp') return 'whatsapp';
    return 'email';
}

function directionForCommunication(
    type: (typeof communicationTypes)[number],
    direction: (typeof communicationDirections)[number]
) {
    if (type === 'email_in') return 'inbound';
    if (type === 'email_out') return 'outbound';
    return direction;
}

function subjectForCommunication(
    type: (typeof communicationTypes)[number],
    direction: (typeof communicationDirections)[number],
    subject?: string | null
) {
    if (subject?.trim()) return subject.trim();
    if (type === 'email_in') return 'Email recibido';
    if (type === 'email_out') return 'Email enviado';
    if (type === 'call') return direction === 'inbound' ? 'Llamada recibida' : 'Llamada realizada';
    return direction === 'inbound' ? 'WhatsApp recibido' : 'WhatsApp enviado';
}

function requiresConsentCheck(
    direction: (typeof communicationDirections)[number],
    purpose: (typeof consentPurposes)[number]
) {
    return direction === 'outbound' && (purpose === 'sales_follow_up' || purpose === 'marketing');
}

function shouldSyncSalesFollowUp(
    direction: (typeof communicationDirections)[number],
    purpose: (typeof consentPurposes)[number]
) {
    return direction === 'outbound' && purpose === 'sales_follow_up';
}

function shouldMoveOpportunityToContacted(stage: string | null | undefined) {
    return stage === 'new' || stage === 'to_contact';
}

function isAllowedLegalBasis(legalBasis: string | null | undefined) {
    return legalBasis === 'consent'
        || legalBasis === 'contract'
        || legalBasis === 'prior_customer_similar_services'
        || legalBasis === 'legitimate_interest';
}

function daysUntilDate(value: string) {
    const end = new Date(value);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

function addDaysIso(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function renewalPriority(endsAt: string) {
    const days = daysUntilDate(endsAt);
    if (days <= 3) return 'urgent';
    if (days <= 14) return 'high';
    return 'normal';
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
    input: { adminId: string; action: string; entityType: string; entityId: string; before?: Json | null; after?: Json | null }
) {
    const { error } = await supabaseAdmin
        .from('admin_audit_log')
        .insert({
            admin_id: input.adminId,
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId,
            before: input.before ?? null,
            after: input.after ?? null,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminCrmContactActions] Failed to write audit log:', error);
    }
}

async function writeTaskActivity(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        task: { id: string; contact_id: string; opportunity_id: string | null; title: string; status: string; due_at: string | null };
        subject: string;
        action: string;
    }
) {
    const { error } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: input.task.contact_id,
            opportunity_id: input.task.opportunity_id,
            actor_id: input.adminId,
            activity_type: 'system',
            subject: input.subject,
            body: input.task.title,
            metadata: {
                action: input.action,
                task_id: input.task.id,
                status: input.task.status,
                due_at: input.task.due_at,
            },
            related_entity_type: 'crm_task',
            related_entity_id: input.task.id,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminCrmContactActions] Failed to write CRM task activity:', error);
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

async function writeConsentActivity(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        consent: {
            id: string;
            contact_id: string;
            channel: string;
            purpose: string;
            legal_basis: string;
            opted_out_at: string | null;
        };
        subject: string;
        action: string;
    }
) {
    const { error } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: input.consent.contact_id,
            actor_id: input.adminId,
            activity_type: 'system',
            subject: input.subject,
            body: `${input.consent.channel} / ${input.consent.purpose}`,
            metadata: {
                action: input.action,
                consent_id: input.consent.id,
                channel: input.consent.channel,
                purpose: input.consent.purpose,
                legal_basis: input.consent.legal_basis,
                opted_out_at: input.consent.opted_out_at,
            },
            related_entity_type: 'crm_consent',
            related_entity_id: input.consent.id,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminCrmContactActions] Failed to write CRM consent activity:', error);
    }
}

async function updateTask(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        taskId: string;
        updates: CrmTaskUpdate;
        auditAction: string;
        activitySubject: string;
        activityAction: string;
    }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('crm_tasks')
        .select(taskSelect)
        .eq('id', input.taskId)
        .single();

    if (beforeError || !before) {
        if (isMissingCrmTable(beforeError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        if (beforeError?.code === 'PGRST116') return jsonResponse({ error: 'CRM task not found' }, 404);
        console.error('[AdminCrmContactActions] Could not load CRM task:', beforeError);
        return jsonResponse({ error: 'Could not load CRM task' }, 500);
    }

    const { data: task, error } = await supabaseAdmin
        .from('crm_tasks')
        .update(input.updates)
        .eq('id', input.taskId)
        .select(taskSelect)
        .single();

    if (error || !task) {
        if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not update CRM task:', error);
        return jsonResponse({ error: 'Could not update CRM task' }, 500);
    }

    await writeTaskActivity(supabaseAdmin, {
        adminId: input.adminId,
        task,
        subject: input.activitySubject,
        action: input.activityAction,
    });

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: input.auditAction,
        entityType: 'crm_task',
        entityId: task.id,
        before: before as Json,
        after: task as Json,
    });

    return jsonResponse({ task });
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
        if (isMissingCrmTable(beforeError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        if (beforeError?.code === 'PGRST116') return jsonResponse({ error: 'CRM opportunity not found' }, 404);
        console.error('[AdminCrmContactActions] Could not load CRM opportunity:', beforeError);
        return jsonResponse({ error: 'Could not load CRM opportunity' }, 500);
    }

    const now = new Date().toISOString();
    const { data: opportunity, error: updateError } = await supabaseAdmin
        .from('crm_opportunities')
        .update({
            stage: input.newStage,
            closed_at: input.newStage === 'won' || input.newStage === 'lost' ? now : null,
            checkout_approved_at: null,
            updated_at: now,
        })
        .eq('id', input.opportunityId)
        .select(opportunitySelect)
        .single();

    if (updateError || !opportunity) {
        if (isMissingCrmTable(updateError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not update CRM opportunity:', updateError);
        return jsonResponse({ error: 'Could not update CRM opportunity' }, 500);
    }

    const nurtureFollowUpAt = input.newStage === 'nurture' ? addDaysIso(new Date(now), 7) : null;
    const contactUpdate: Database['public']['Tables']['crm_contacts']['Update'] = {
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
        if (isMissingCrmTable(contactError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not sync CRM contact after opportunity stage change:', contactError);
        return jsonResponse({ error: 'Opportunity updated but contact sync failed' }, 500);
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
            console.error('[AdminCrmContactActions] Could not sync legacy lead after opportunity stage change:', leadUpdate.error);
            return jsonResponse({ error: 'Opportunity updated but lead sync failed' }, 500);
        }

        if (nextLeadStatus === 'discarded' || input.newStage === 'won') {
            try {
                await closeTerminalLeadTasks(supabaseAdmin, {
                    leadId: before.legacy_lead_id,
                    completedAt: now,
                });
            } catch (error) {
                console.error('[AdminCrmContactActions] Could not close terminal lead tasks after opportunity closure:', error);
                return jsonResponse({ error: 'Opportunity updated but lead task cleanup failed' }, 500);
            }
        } else if (nextLeadStatus === 'contacted') {
            try {
                await closeInitialLeadReviewTasks(supabaseAdmin, {
                    leadId: before.legacy_lead_id,
                    completedAt: now,
                });
            } catch (error) {
                console.error('[AdminCrmContactActions] Could not close initial lead review task after opportunity progress:', error);
                return jsonResponse({ error: 'Opportunity updated but lead review task cleanup failed' }, 500);
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
            console.error('[AdminCrmContactActions] Could not close nurture follow-up task after opportunity resumed:', error);
            return jsonResponse({ error: 'Opportunity updated but nurture task cleanup failed' }, 500);
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
            if (isMissingCrmTable(existingTask.error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            console.error('[AdminCrmContactActions] Could not load nurture follow-up task:', existingTask.error);
            return jsonResponse({ error: 'Opportunity updated but follow-up task lookup failed' }, 500);
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
            if (isMissingCrmTable(followUpTask.error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            console.error('[AdminCrmContactActions] Could not create nurture follow-up task:', followUpTask.error);
            return jsonResponse({ error: 'Opportunity updated but follow-up task failed' }, 500);
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
                action: 'update_opportunity_stage',
                previous_stage: before.stage,
                new_stage: input.newStage,
                legacy_lead_id: before.legacy_lead_id,
                next_follow_up_at: nurtureFollowUpAt,
            },
            related_entity_type: 'crm_opportunity',
            related_entity_id: before.id,
        });

    if (activityError) {
        if (isMissingCrmTable(activityError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not write CRM opportunity activity:', activityError);
        return jsonResponse({ error: 'Opportunity updated but CRM activity failed' }, 500);
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: 'crm_opportunity.stage.update',
        entityType: 'crm_opportunity',
        entityId: before.id,
        before: before as Json,
        after: opportunity as Json,
    });

    return jsonResponse({ opportunity });
}

async function createPaymentRecoveryTask(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; paymentId: string; dueAt?: string | null; note?: string | null }
) {
    const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .select(`
            id,
            student_id,
            amount,
            currency,
            status,
            created_at,
            description,
            stripe_invoice_id,
            stripe_payment_intent_id,
            profiles!payments_student_id_fkey (
                id,
                email,
                full_name,
                role
            )
        `)
        .eq('id', input.paymentId)
        .single();

    if (paymentError || !payment) {
        if (paymentError?.code === 'PGRST116') return jsonResponse({ error: 'Payment not found' }, 404);
        console.error('[AdminCrmContactActions] Could not load failed payment:', paymentError);
        return jsonResponse({ error: 'Could not load payment' }, 500);
    }

    if (payment.status !== 'failed') {
        return jsonResponse({ error: 'Only failed payments can create recovery tasks' }, 409);
    }

    const profile = Array.isArray(payment.profiles) ? payment.profiles[0] : payment.profiles;
    const contactResult = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: payment.student_id,
        email: profile?.email ?? null,
        fullName: profile?.full_name ?? null,
        lifecycleStage: 'customer',
        source: 'payment_recovery',
        sourcePath: '/campus/admin/payments',
    });

    if (contactResult.status !== 'ready') {
        return jsonResponse({ error: 'CRM contact is not available', reason: contactResult.reason }, contactResult.reason === 'crm_not_migrated' ? 409 : 400);
    }

    const { data: existingTask, error: existingError } = await supabaseAdmin
        .from('crm_tasks')
        .select(taskSelect)
        .eq('related_entity_type', 'payment')
        .eq('related_entity_id', payment.id)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (existingError) {
        if (isMissingCrmTable(existingError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not check existing payment recovery task:', existingError);
        return jsonResponse({ error: 'Could not check payment recovery task' }, 500);
    }

    if (existingTask) {
        return jsonResponse({ task: existingTask, existing: true });
    }

    const dueAt = input.dueAt ?? new Date().toISOString();
    const amount = new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: (payment.currency || 'eur').toUpperCase(),
    }).format((payment.amount ?? 0) / 100);
    const title = `Recuperar pago fallido (${amount})`;
    const metadata: Json = {
        action: 'create_payment_recovery_task',
        payment_id: payment.id,
        payment_status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        payment_created_at: payment.created_at,
        stripe_invoice_id: payment.stripe_invoice_id,
        stripe_payment_intent_id: payment.stripe_payment_intent_id,
        note: input.note ?? null,
    };

    const taskInsert: CrmTaskInsert = {
        contact_id: contactResult.contactId,
        assigned_to: input.adminId,
        title,
        task_type: 'email',
        priority: 'urgent',
        due_at: dueAt,
        related_entity_type: 'payment',
        related_entity_id: payment.id,
        metadata,
    };

    const { data: task, error: taskError } = await supabaseAdmin
        .from('crm_tasks')
        .insert(taskInsert)
        .select(taskSelect)
        .single();

    if (taskError || !task) {
        if (isMissingCrmTable(taskError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not create payment recovery task:', taskError);
        return jsonResponse({ error: 'Could not create payment recovery task' }, 500);
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
            next_follow_up_at: dueAt,
            updated_at: new Date().toISOString(),
        })
        .eq('id', contactResult.contactId);

    if (contactUpdateError && !isMissingCrmTable(contactUpdateError)) {
        console.error('[AdminCrmContactActions] Could not update contact follow-up after payment recovery task:', contactUpdateError);
    }

    const { error: activityError } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: contactResult.contactId,
            actor_id: input.adminId,
            activity_type: 'system',
            subject: 'Tarea de recuperacion de pago creada',
            body: input.note || title,
            metadata: {
                ...(metadata as Record<string, unknown>),
                task_id: task.id,
            },
            related_entity_type: 'payment',
            related_entity_id: payment.id,
        });

    if (activityError) {
        if (isMissingCrmTable(activityError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not write payment recovery activity:', activityError);
        return jsonResponse({ error: 'Task created but CRM activity failed' }, 500);
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: 'crm_payment_recovery_task.create',
        entityType: 'payment',
        entityId: payment.id,
        after: {
            payment_id: payment.id,
            task_id: task.id,
            due_at: dueAt,
            note: input.note ?? null,
        },
    });

    return jsonResponse({ task, existing: false }, 201);
}

async function createSubscriptionRenewalTask(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; subscriptionId: string; dueAt?: string | null; note?: string | null }
) {
    const { data: subscription, error: subscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .select(`
            id,
            student_id,
            status,
            ends_at,
            sessions_used,
            sessions_total,
            duration_months,
            stripe_subscription_id,
            stripe_invoice_id,
            profiles!subscriptions_student_id_fkey (
                id,
                email,
                full_name,
                role
            ),
            packages (
                name,
                display_name
            )
        `)
        .eq('id', input.subscriptionId)
        .single();

    if (subscriptionError || !subscription) {
        if (subscriptionError?.code === 'PGRST116') return jsonResponse({ error: 'Subscription not found' }, 404);
        console.error('[AdminCrmContactActions] Could not load subscription for renewal:', subscriptionError);
        return jsonResponse({ error: 'Could not load subscription' }, 500);
    }

    if (subscription.status !== 'active') {
        return jsonResponse({ error: 'Only active subscriptions can create renewal tasks' }, 409);
    }

    const profile = Array.isArray(subscription.profiles) ? subscription.profiles[0] : subscription.profiles;
    const contactResult = await ensureCrmContactForProfile(supabaseAdmin, {
        profileId: subscription.student_id,
        email: profile?.email ?? null,
        fullName: profile?.full_name ?? null,
        lifecycleStage: 'customer',
        source: 'subscription_renewal',
        sourcePath: '/campus/admin',
    });

    if (contactResult.status !== 'ready') {
        return jsonResponse({ error: 'CRM contact is not available', reason: contactResult.reason }, contactResult.reason === 'crm_not_migrated' ? 409 : 400);
    }

    const { data: existingTask, error: existingError } = await supabaseAdmin
        .from('crm_tasks')
        .select(taskSelect)
        .eq('related_entity_type', 'subscription')
        .eq('related_entity_id', subscription.id)
        .in('status', ['open', 'snoozed'])
        .maybeSingle();

    if (existingError) {
        if (isMissingCrmTable(existingError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not check existing subscription renewal task:', existingError);
        return jsonResponse({ error: 'Could not check subscription renewal task' }, 500);
    }

    if (existingTask) {
        return jsonResponse({ task: existingTask, existing: true });
    }

    const dueAt = input.dueAt ?? new Date().toISOString();
    const packageRecord = Array.isArray(subscription.packages) ? subscription.packages[0] : subscription.packages;
    const packageName = packageRecord?.name ?? 'plan';
    const daysRemaining = daysUntilDate(subscription.ends_at);
    const title = `Preparar renovacion de suscripcion (${daysRemaining} dias)`;
    const metadata: Json = {
        action: 'create_subscription_renewal_task',
        subscription_id: subscription.id,
        subscription_status: subscription.status,
        ends_at: subscription.ends_at,
        days_remaining: daysRemaining,
        sessions_reserved: subscription.sessions_used,
        sessions_total: subscription.sessions_total,
        duration_months: subscription.duration_months,
        package_name: packageName,
        stripe_subscription_id: subscription.stripe_subscription_id,
        stripe_invoice_id: subscription.stripe_invoice_id,
        note: input.note ?? null,
    };

    const taskInsert: CrmTaskInsert = {
        contact_id: contactResult.contactId,
        assigned_to: input.adminId,
        title,
        task_type: 'email',
        priority: renewalPriority(subscription.ends_at),
        due_at: dueAt,
        related_entity_type: 'subscription',
        related_entity_id: subscription.id,
        metadata,
    };

    const { data: task, error: taskError } = await supabaseAdmin
        .from('crm_tasks')
        .insert(taskInsert)
        .select(taskSelect)
        .single();

    if (taskError || !task) {
        if (isMissingCrmTable(taskError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not create subscription renewal task:', taskError);
        return jsonResponse({ error: 'Could not create subscription renewal task' }, 500);
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
            next_follow_up_at: dueAt,
            updated_at: new Date().toISOString(),
        })
        .eq('id', contactResult.contactId);

    if (contactUpdateError && !isMissingCrmTable(contactUpdateError)) {
        console.error('[AdminCrmContactActions] Could not update contact follow-up after subscription renewal task:', contactUpdateError);
    }

    const { error: activityError } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: contactResult.contactId,
            actor_id: input.adminId,
            activity_type: 'system',
            subject: 'Tarea de renovacion creada',
            body: input.note || title,
            metadata: {
                ...(metadata as Record<string, unknown>),
                task_id: task.id,
            },
            related_entity_type: 'subscription',
            related_entity_id: subscription.id,
        });

    if (activityError) {
        if (isMissingCrmTable(activityError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not write subscription renewal activity:', activityError);
        return jsonResponse({ error: 'Task created but CRM activity failed' }, 500);
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: 'crm_subscription_renewal_task.create',
        entityType: 'subscription',
        entityId: subscription.id,
        after: {
            subscription_id: subscription.id,
            task_id: task.id,
            due_at: dueAt,
            days_remaining: daysRemaining,
            note: input.note ?? null,
        },
    });

    return jsonResponse({ task, existing: false }, 201);
}

async function upsertConsent(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        contactId: string;
        channel: (typeof consentChannels)[number];
        purpose: (typeof consentPurposes)[number];
        legalBasis: (typeof legalBases)[number];
        source?: string | null;
        proof?: string | null;
        noticeVersion?: string | null;
        capturedAt?: string | null;
    }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('crm_consents')
        .select(consentSelect)
        .eq('contact_id', input.contactId)
        .eq('channel', input.channel)
        .eq('purpose', input.purpose)
        .is('opted_out_at', null)
        .maybeSingle();

    if (beforeError) {
        if (isMissingCrmTable(beforeError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not load CRM consent:', beforeError);
        return jsonResponse({ error: 'Could not load CRM consent' }, 500);
    }

    const consentValues = {
        contact_id: input.contactId,
        channel: input.channel,
        purpose: input.purpose,
        legal_basis: input.legalBasis,
        source: input.source || null,
        proof: input.proof || null,
        notice_version: input.noticeVersion || null,
        captured_at: input.capturedAt || new Date().toISOString(),
        opted_out_at: null,
    };

    const query = before
        ? supabaseAdmin
            .from('crm_consents')
            .update(consentValues satisfies CrmConsentUpdate)
            .eq('id', before.id)
            .select(consentSelect)
            .single()
        : supabaseAdmin
            .from('crm_consents')
            .insert(consentValues satisfies CrmConsentInsert)
            .select(consentSelect)
            .single();

    const { data: consent, error } = await query;

    if (error || !consent) {
        if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not save CRM consent:', error);
        return jsonResponse({ error: 'Could not save CRM consent' }, 500);
    }

    await writeConsentActivity(supabaseAdmin, {
        adminId: input.adminId,
        consent,
        subject: before ? 'Consentimiento actualizado' : 'Consentimiento registrado',
        action: 'upsert_consent',
    });

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: 'crm_consent.upsert',
        entityType: 'crm_consent',
        entityId: consent.id,
        before: (before ?? null) as Json | null,
        after: consent as Json,
    });

    return jsonResponse({ consent }, before ? 200 : 201);
}

async function optOutConsent(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; consentId: string; reason?: string | null }
) {
    const { data: before, error: beforeError } = await supabaseAdmin
        .from('crm_consents')
        .select(consentSelect)
        .eq('id', input.consentId)
        .single();

    if (beforeError || !before) {
        if (isMissingCrmTable(beforeError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        if (beforeError?.code === 'PGRST116') return jsonResponse({ error: 'CRM consent not found' }, 404);
        console.error('[AdminCrmContactActions] Could not load CRM consent:', beforeError);
        return jsonResponse({ error: 'Could not load CRM consent' }, 500);
    }

    const updates: CrmConsentUpdate = {
        opted_out_at: new Date().toISOString(),
    };

    if (input.reason) {
        updates.proof = input.reason;
    }

    const { data: consent, error } = await supabaseAdmin
        .from('crm_consents')
        .update(updates)
        .eq('id', input.consentId)
        .select(consentSelect)
        .single();

    if (error || !consent) {
        if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not opt out CRM consent:', error);
        return jsonResponse({ error: 'Could not opt out CRM consent' }, 500);
    }

    await writeConsentActivity(supabaseAdmin, {
        adminId: input.adminId,
        consent,
        subject: 'Opt-out registrado',
        action: 'opt_out_consent',
    });

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: 'crm_consent.opt_out',
        entityType: 'crm_consent',
        entityId: consent.id,
        before: before as Json,
        after: consent as Json,
    });

    return jsonResponse({ consent });
}

async function createCommunication(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        contactId: string;
        opportunityId?: string | null;
        communicationType: (typeof communicationTypes)[number];
        direction: (typeof communicationDirections)[number];
        purpose: (typeof consentPurposes)[number];
        subject?: string | null;
        body: string;
        occurredAt?: string | null;
        consentOverrideReason?: string | null;
    }
) {
    const direction = directionForCommunication(input.communicationType, input.direction);
    const channel = channelForCommunication(input.communicationType);
    const consentCheckRequired = requiresConsentCheck(direction, input.purpose);
    const shouldSyncSales = shouldSyncSalesFollowUp(direction, input.purpose);
    let latestConsent: {
        id: string;
        legal_basis: string;
        opted_out_at: string | null;
    } | null = null;
    let opportunityBefore: CommunicationOpportunitySnapshot | null = null;

    if (consentCheckRequired) {
        const { data, error } = await supabaseAdmin
            .from('crm_consents')
            .select('id, legal_basis, opted_out_at, captured_at, created_at')
            .eq('contact_id', input.contactId)
            .eq('channel', channel)
            .eq('purpose', input.purpose)
            .order('captured_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            console.error('[AdminCrmContactActions] Could not load latest CRM consent:', error);
            return jsonResponse({ error: 'Could not load CRM consent' }, 500);
        }

        latestConsent = data;

        if (latestConsent?.opted_out_at) {
            return jsonResponse({
                error: 'Contact is opted out for this channel and purpose',
                reason: 'consent_opted_out',
                channel,
                purpose: input.purpose,
            }, 409);
        }

        const hasAllowedLegalBasis = isAllowedLegalBasis(latestConsent?.legal_basis);
        if (!hasAllowedLegalBasis && !input.consentOverrideReason?.trim()) {
            return jsonResponse({
                error: 'Manual review required before outbound communication',
                reason: latestConsent ? 'manual_review_consent' : 'missing_consent',
                channel,
                purpose: input.purpose,
            }, 409);
        }
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const now = new Date().toISOString();
    const nextFollowUpAt = shouldSyncSales ? addDaysIso(new Date(now), 1) : null;

    if (shouldSyncSales && input.opportunityId) {
        const { data, error } = await supabaseAdmin
            .from('crm_opportunities')
            .select('id, contact_id, legacy_lead_id, stage')
            .eq('id', input.opportunityId)
            .single();

        if (error || !data) {
            if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            if (error?.code === 'PGRST116') return jsonResponse({ error: 'CRM opportunity not found' }, 404);
            console.error('[AdminCrmContactActions] Could not load CRM opportunity for communication sync:', error);
            return jsonResponse({ error: 'Could not load CRM opportunity' }, 500);
        }

        opportunityBefore = {
            id: data.id,
            contact_id: data.contact_id,
            legacy_lead_id: data.legacy_lead_id,
            stage: data.stage as CrmOpportunityStage,
        };
    }

    const subject = subjectForCommunication(input.communicationType, direction, input.subject);
    const metadata: Json = {
        action: 'create_communication',
        channel,
        direction,
        purpose: input.purpose,
        consent_checked: consentCheckRequired,
        consent_id: latestConsent?.id ?? null,
        consent_legal_basis: latestConsent?.legal_basis ?? null,
        consent_override_reason: input.consentOverrideReason?.trim() || null,
        next_follow_up_at: nextFollowUpAt,
        opportunity_stage_before: opportunityBefore?.stage ?? null,
        opportunity_stage_after: opportunityBefore && shouldMoveOpportunityToContacted(opportunityBefore.stage)
            ? 'contacted'
            : opportunityBefore?.stage ?? null,
        manual_log: true,
    };

    const { data: activity, error } = await supabaseAdmin
        .from('crm_activities')
        .insert({
            contact_id: input.contactId,
            opportunity_id: input.opportunityId ?? null,
            actor_id: input.adminId,
            activity_type: input.communicationType,
            subject,
            body: input.body,
            occurred_at: occurredAt,
            metadata,
            related_entity_type: 'crm_contact',
            related_entity_id: input.contactId,
        })
        .select('id, activity_type, subject, body, occurred_at, related_entity_type, related_entity_id, metadata')
        .single();

    if (error || !activity) {
        if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not create CRM communication:', error);
        return jsonResponse({ error: 'Could not create CRM communication' }, 500);
    }

    const contactUpdates: CrmContactUpdate = {
        last_contacted_at: occurredAt,
        updated_at: now,
    };
    if (nextFollowUpAt) {
        contactUpdates.next_follow_up_at = nextFollowUpAt;
    }

    const { error: contactUpdateError } = await supabaseAdmin
        .from('crm_contacts')
        .update(contactUpdates)
        .eq('id', input.contactId);

    if (contactUpdateError) {
        if (isMissingCrmTable(contactUpdateError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
        console.error('[AdminCrmContactActions] Could not update contact after communication:', contactUpdateError);
        return jsonResponse({ error: 'Communication logged but contact sync failed' }, 500);
    }

    if (opportunityBefore && shouldMoveOpportunityToContacted(opportunityBefore.stage)) {
        const { error: opportunityUpdateError } = await supabaseAdmin
            .from('crm_opportunities')
            .update({
                stage: 'contacted',
                checkout_approved_at: null,
                updated_at: now,
            })
            .eq('id', opportunityBefore.id);

        if (opportunityUpdateError) {
            if (isMissingCrmTable(opportunityUpdateError)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            console.error('[AdminCrmContactActions] Could not sync opportunity after communication:', opportunityUpdateError);
            return jsonResponse({ error: 'Communication logged but opportunity sync failed' }, 500);
        }

        if (opportunityBefore.legacy_lead_id) {
            const { error: leadUpdateError } = await supabaseAdmin
                .from('leads')
                .update({
                    status: 'contacted',
                    updated_at: now,
                })
                .eq('id', opportunityBefore.legacy_lead_id);

            if (leadUpdateError) {
                console.error('[AdminCrmContactActions] Could not sync lead after communication:', leadUpdateError);
                return jsonResponse({ error: 'Communication logged but lead sync failed' }, 500);
            }
        }
    }

    await logAudit(supabaseAdmin, {
        adminId: input.adminId,
        action: 'crm_activity.communication.create',
        entityType: 'crm_activity',
        entityId: activity.id,
        after: activity as Json,
    });

    return jsonResponse({ activity }, 201);
}

export const POST: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const taskInput = createTaskSchema.safeParse(rawBody);
    if (taskInput.success) {
        const { data: task, error } = await supabaseAdmin
            .from('crm_tasks')
            .insert({
                contact_id: taskInput.data.contactId,
                opportunity_id: taskInput.data.opportunityId ?? null,
                assigned_to: auth.user.id,
                title: taskInput.data.title,
                task_type: taskInput.data.taskType,
                priority: taskInput.data.priority,
                due_at: taskInput.data.dueAt ?? null,
            })
            .select('id, title, task_type, priority, status, due_at, completed_at, created_at')
            .single();

        if (error || !task) {
            if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            console.error('[AdminCrmContactActions] Could not create CRM task:', error);
            return jsonResponse({ error: 'Could not create CRM task' }, 500);
        }

        await logAudit(supabaseAdmin, {
            adminId: auth.user.id,
            action: 'crm_task.create',
            entityType: 'crm_task',
            entityId: task.id,
            after: task as Json,
        });

        return jsonResponse({ task }, 201);
    }

    const claimInput = claimTaskSchema.safeParse(rawBody);
    if (claimInput.success) {
        return updateTask(supabaseAdmin, {
            adminId: auth.user.id,
            taskId: claimInput.data.taskId,
            updates: {
                assigned_to: auth.user.id,
            },
            auditAction: 'crm_task.claim',
            activitySubject: 'Tarea asignada',
            activityAction: 'claim_task',
        });
    }

    const completeInput = completeTaskSchema.safeParse(rawBody);
    if (completeInput.success) {
        return updateTask(supabaseAdmin, {
            adminId: auth.user.id,
            taskId: completeInput.data.taskId,
            updates: {
                status: 'done',
                completed_at: new Date().toISOString(),
            },
            auditAction: 'crm_task.complete',
            activitySubject: 'Tarea completada',
            activityAction: 'complete_task',
        });
    }

    const snoozeInput = snoozeTaskSchema.safeParse(rawBody);
    if (snoozeInput.success) {
        return updateTask(supabaseAdmin, {
            adminId: auth.user.id,
            taskId: snoozeInput.data.taskId,
            updates: {
                status: 'snoozed',
                due_at: snoozeInput.data.dueAt,
                completed_at: null,
            },
            auditAction: 'crm_task.snooze',
            activitySubject: 'Tarea aplazada',
            activityAction: 'snooze_task',
        });
    }

    const cancelInput = cancelTaskSchema.safeParse(rawBody);
    if (cancelInput.success) {
        return updateTask(supabaseAdmin, {
            adminId: auth.user.id,
            taskId: cancelInput.data.taskId,
            updates: {
                status: 'cancelled',
                completed_at: null,
            },
            auditAction: 'crm_task.cancel',
            activitySubject: 'Tarea cancelada',
            activityAction: 'cancel_task',
        });
    }

    const updateInput = updateTaskSchema.safeParse(rawBody);
    if (updateInput.success) {
        const updates: CrmTaskUpdate = {};
        if (updateInput.data.title !== undefined) updates.title = updateInput.data.title;
        if (updateInput.data.taskType !== undefined) updates.task_type = updateInput.data.taskType;
        if (updateInput.data.priority !== undefined) updates.priority = updateInput.data.priority;
        if (updateInput.data.dueAt !== undefined) updates.due_at = updateInput.data.dueAt;
        if (updateInput.data.status !== undefined) {
            updates.status = updateInput.data.status;
            updates.completed_at = updateInput.data.status === 'done' ? new Date().toISOString() : null;
        }

        return updateTask(supabaseAdmin, {
            adminId: auth.user.id,
            taskId: updateInput.data.taskId,
            updates,
            auditAction: 'crm_task.update',
            activitySubject: 'Tarea actualizada',
            activityAction: 'update_task',
        });
    }

    const opportunityStageInput = updateOpportunityStageSchema.safeParse(rawBody);
    if (opportunityStageInput.success) {
        return updateOpportunityStage(supabaseAdmin, {
            adminId: auth.user.id,
            opportunityId: opportunityStageInput.data.opportunityId,
            newStage: opportunityStageInput.data.newStage,
        });
    }

    const paymentRecoveryTaskInput = createPaymentRecoveryTaskSchema.safeParse(rawBody);
    if (paymentRecoveryTaskInput.success) {
        return createPaymentRecoveryTask(supabaseAdmin, {
            adminId: auth.user.id,
            paymentId: paymentRecoveryTaskInput.data.paymentId,
            dueAt: paymentRecoveryTaskInput.data.dueAt ?? null,
            note: paymentRecoveryTaskInput.data.note ?? null,
        });
    }

    const subscriptionRenewalTaskInput = createSubscriptionRenewalTaskSchema.safeParse(rawBody);
    if (subscriptionRenewalTaskInput.success) {
        return createSubscriptionRenewalTask(supabaseAdmin, {
            adminId: auth.user.id,
            subscriptionId: subscriptionRenewalTaskInput.data.subscriptionId,
            dueAt: subscriptionRenewalTaskInput.data.dueAt ?? null,
            note: subscriptionRenewalTaskInput.data.note ?? null,
        });
    }

    const consentInput = upsertConsentSchema.safeParse(rawBody);
    if (consentInput.success) {
        return upsertConsent(supabaseAdmin, {
            adminId: auth.user.id,
            contactId: consentInput.data.contactId,
            channel: consentInput.data.channel,
            purpose: consentInput.data.purpose,
            legalBasis: consentInput.data.legalBasis,
            source: consentInput.data.source ?? null,
            proof: consentInput.data.proof ?? null,
            noticeVersion: consentInput.data.noticeVersion ?? null,
            capturedAt: consentInput.data.capturedAt ?? null,
        });
    }

    const optOutInput = optOutConsentSchema.safeParse(rawBody);
    if (optOutInput.success) {
        return optOutConsent(supabaseAdmin, {
            adminId: auth.user.id,
            consentId: optOutInput.data.consentId,
            reason: optOutInput.data.reason ?? null,
        });
    }

    const communicationInput = createCommunicationSchema.safeParse(rawBody);
    if (communicationInput.success) {
        return createCommunication(supabaseAdmin, {
            adminId: auth.user.id,
            contactId: communicationInput.data.contactId,
            opportunityId: communicationInput.data.opportunityId ?? null,
            communicationType: communicationInput.data.communicationType,
            direction: communicationInput.data.direction,
            purpose: communicationInput.data.purpose,
            subject: communicationInput.data.subject ?? null,
            body: communicationInput.data.body,
            occurredAt: communicationInput.data.occurredAt ?? null,
            consentOverrideReason: communicationInput.data.consentOverrideReason ?? null,
        });
    }

    const noteInput = createNoteSchema.safeParse(rawBody);
    if (noteInput.success) {
        const { data: activity, error } = await supabaseAdmin
            .from('crm_activities')
            .insert({
                contact_id: noteInput.data.contactId,
                opportunity_id: noteInput.data.opportunityId ?? null,
                actor_id: auth.user.id,
                activity_type: 'note',
                subject: noteInput.data.subject || 'Nota interna',
                body: noteInput.data.body,
                metadata: {},
                related_entity_type: 'crm_contact',
                related_entity_id: noteInput.data.contactId,
            })
            .select('id, activity_type, subject, body, occurred_at, related_entity_type, related_entity_id, metadata')
            .single();

        if (error || !activity) {
            if (isMissingCrmTable(error)) return jsonResponse({ error: 'CRM is not migrated yet' }, 409);
            console.error('[AdminCrmContactActions] Could not create CRM note:', error);
            return jsonResponse({ error: 'Could not create CRM note' }, 500);
        }

        await logAudit(supabaseAdmin, {
            adminId: auth.user.id,
            action: 'crm_activity.note.create',
            entityType: 'crm_activity',
            entityId: activity.id,
            after: activity as Json,
        });

        return jsonResponse({ activity }, 201);
    }

    return jsonResponse({ error: 'Invalid CRM contact action' }, 400);
};
