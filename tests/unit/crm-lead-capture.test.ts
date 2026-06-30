import { describe, expect, it, vi } from 'vitest';
import {
    loadLeadCaptureForCrm,
    recordLeadEmailOutInCrm,
    syncLeadCaptureToCrm,
    type LeadCaptureForCrm,
} from '../../src/lib/crm/lead-capture';

type QueryResult = { data: unknown; error: unknown };

function createQuery(result: QueryResult, recorder?: {
    inserts?: unknown[];
    updates?: unknown[];
}) {
    const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        is: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        insert: vi.fn((value: unknown) => {
            recorder?.inserts?.push(value);
            return query;
        }),
        update: vi.fn((value: unknown) => {
            recorder?.updates?.push(value);
            return query;
        }),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    return query;
}

function createClient(queues: Record<string, any[]>) {
    return {
        from: vi.fn((table: string) => {
            const query = queues[table]?.shift();
            if (!query) throw new Error(`Unexpected table query: ${table}`);
            return query;
        }),
    };
}

const lead: LeadCaptureForCrm = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'Future.Student@Example.COM',
    name: 'Future Student',
    interest: 'general',
    current_level: 'b1',
    learning_goal: 'Work meetings and everyday life in Spain',
    availability: 'Weekday afternoons',
    preferred_package: 'hybrid',
    source_path: '/en',
    lang: 'en',
    spoken_languages: ['ru', 'en'],
    is_russian_speaker: true,
    consent_given: true,
    status: 'new',
    created_at: '2026-06-25T09:00:00.000Z',
    updated_at: '2026-06-25T09:00:00.000Z',
    crm_contact_id: null,
    crm_opportunity_id: null,
};

describe('lead capture CRM sync', () => {
    it('loads the CRM-ready lead payload with optional CRM columns', async () => {
        const leadQuery = createQuery({ data: lead, error: null });
        const client = createClient({ leads: [leadQuery] });

        const result = await loadLeadCaptureForCrm(client as any, 'future.student@example.com');

        expect(result).toEqual(lead);
        expect(leadQuery.select).toHaveBeenCalledWith(expect.stringContaining('crm_contact_id'));
        expect(leadQuery.eq).toHaveBeenCalledWith('email', 'future.student@example.com');
    });

    it('creates contact, opportunity, consent, timeline activity and a 24h review task', async () => {
        const inserts: unknown[] = [];
        const updates: unknown[] = [];
        const client = createClient({
            crm_contacts: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'contact-1' }, error: null }, { inserts }),
            ],
            crm_opportunities: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'opportunity-1' }, error: null }, { inserts }),
            ],
            packages: [
                createQuery({ data: { id: 'package-1' }, error: null }),
            ],
            leads: [
                createQuery({ data: null, error: null }, { updates }),
            ],
            crm_consents: [
                createQuery({ data: null, error: null }),
                createQuery({ data: null, error: null }, { inserts }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }),
                createQuery({ data: null, error: null }, { inserts }),
            ],
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-1' }, error: null }, { inserts }),
            ],
        });

        const result = await syncLeadCaptureToCrm(
            client as any,
            lead,
            new Date('2026-06-25T10:00:00.000Z')
        );

        expect(result).toEqual({
            status: 'synced',
            contactId: 'contact-1',
            opportunityId: 'opportunity-1',
            taskId: 'task-1',
        });
        expect(inserts).toEqual(expect.arrayContaining([
            expect.objectContaining({
                primary_email: 'future.student@example.com',
                lifecycle_stage: 'lead',
                source: 'lead_form',
            }),
            expect.objectContaining({
                contact_id: 'contact-1',
                legacy_lead_id: lead.id,
                stage: 'new',
                preferred_package_id: 'package-1',
            }),
            expect.objectContaining({
                contact_id: 'contact-1',
                channel: 'email',
                purpose: 'sales_follow_up',
                legal_basis: 'consent',
            }),
            expect.objectContaining({
                contact_id: 'contact-1',
                opportunity_id: 'opportunity-1',
                activity_type: 'system',
                subject: 'Solicitud de plaza recibida',
                related_entity_type: 'lead',
                related_entity_id: lead.id,
            }),
            expect.objectContaining({
                contact_id: 'contact-1',
                opportunity_id: 'opportunity-1',
                title: 'Revisar solicitud de plaza en menos de 24h',
                task_type: 'review',
                priority: 'high',
                due_at: '2026-06-26T10:00:00.000Z',
                related_entity_type: 'lead',
                related_entity_id: lead.id,
                metadata: expect.objectContaining({
                    sla_hours: 24,
                    sla_target: 'first_human_response',
                    source: 'lead_capture',
                    source_path: '/en',
                    shared_owner_queue: true,
                    owner_model: 'founder_shared_queue',
                    manual_assignment_required: true,
                    next_decision: 'qualify_propose_nurture_or_lost',
                    email: 'future.student@example.com',
                    interest: 'general',
                    current_level: 'b1',
                    preferred_package: 'hybrid',
                    availability: 'Weekday afternoons',
                    spoken_languages: ['ru', 'en'],
                    is_russian_speaker: true,
                }),
            }),
        ]));
        expect(updates).toEqual([expect.objectContaining({
            crm_contact_id: 'contact-1',
            crm_opportunity_id: 'opportunity-1',
        })]);
    });

    it('does not recreate sales follow-up consent after an opt-out', async () => {
        const inserts: unknown[] = [];
        const updates: unknown[] = [];
        const client = createClient({
            crm_contacts: [
                createQuery({ data: { id: 'contact-1' }, error: null }),
                createQuery({ data: null, error: null }, { updates }),
            ],
            crm_opportunities: [
                createQuery({ data: { id: 'opportunity-1', stage: 'contacted' }, error: null }),
                createQuery({ data: { id: 'opportunity-1' }, error: null }, { updates }),
            ],
            packages: [
                createQuery({ data: { id: 'package-1' }, error: null }),
            ],
            leads: [
                createQuery({ data: null, error: null }, { updates }),
            ],
            crm_consents: [
                createQuery({
                    data: {
                        id: 'consent-optout',
                        opted_out_at: '2026-06-25T12:00:00.000Z',
                    },
                    error: null,
                }, { inserts, updates }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }),
                createQuery({ data: null, error: null }, { inserts }),
            ],
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-1' }, error: null }, { inserts }),
            ],
        });

        const result = await syncLeadCaptureToCrm(
            client as any,
            { ...lead, crm_contact_id: 'contact-1', crm_opportunity_id: 'opportunity-1' },
            new Date('2026-06-25T10:00:00.000Z')
        );

        expect(result).toMatchObject({
            status: 'synced',
            contactId: 'contact-1',
            opportunityId: 'opportunity-1',
        });
        expect(inserts).not.toEqual(expect.arrayContaining([
            expect.objectContaining({
                contact_id: 'contact-1',
                channel: 'email',
                purpose: 'sales_follow_up',
            }),
        ]));
    });

    it('records automated lead confirmation emails as outbound CRM activity', async () => {
        const inserts: unknown[] = [];
        const findExistingEmailQuery = createQuery({ data: null, error: null });
        const client = createClient({
            crm_activities: [
                findExistingEmailQuery,
                createQuery({ data: { id: 'activity-1' }, error: null }, { inserts }),
            ],
        });

        const result = await recordLeadEmailOutInCrm(client as any, {
            lead,
            contactId: 'contact-1',
            opportunityId: 'opportunity-1',
            subject: 'Application received - Espanol Honesto',
            template: 'lead_welcome',
        });

        expect(result).toEqual({ status: 'created', activityId: 'activity-1' });
        expect(findExistingEmailQuery.eq).toHaveBeenCalledWith('body', 'lead_welcome');
        expect(inserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            opportunity_id: 'opportunity-1',
            activity_type: 'email_out',
            subject: 'Application received - Espanol Honesto',
            body: 'lead_welcome',
            related_entity_type: 'lead',
            related_entity_id: lead.id,
            metadata: {
                automated: true,
                template: 'lead_welcome',
                purpose: 'transactional',
            },
        })]);
    });
});
