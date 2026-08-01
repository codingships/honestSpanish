import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { getCrmContactDetail, getCrmContactDetailByContactId } from '../../src/lib/crm/contact-detail';

function createQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };

    return chain;
}

function createClient(tableQueries: Record<string, any | any[]>) {
    const queues = new Map(
        Object.entries(tableQueries).map(([table, queries]) => [
            table,
            Array.isArray(queries) ? [...queries] : [queries],
        ])
    );

    return {
        from: vi.fn((table: string) => {
            const queue = queues.get(table);
            if (!queue || queue.length === 0) {
                throw new Error(`Unexpected table ${table}`);
            }
            return queue.shift();
        }),
    };
}

describe('getCrmContactDetail', () => {
    it('labels the CRM attribution window without claiming pre-capture history', () => {
        const page = readFileSync('src/pages/[lang]/campus/admin/crm/contact/[id].astro', 'utf8');

        expect(page).toContain('Primer origen observado');
        expect(page).toContain('Ultima atribucion capturada');
        expect(page).toContain('No reconstruye visitas anteriores a esta captura.');
        expect(page).toContain('Atribucion pendiente de migracion');
    });

    it('keeps operational history available when CRM tables are not migrated yet', async () => {
        const supportTicket = {
            id: 'ticket-1',
            issue_type: 'calendar',
            issue_title: 'Cambio de clase',
            status: 'open',
            created_at: '2026-06-24T08:00:00.000Z',
        };
        const session = {
            id: 'session-1',
            scheduled_at: '2026-06-24T10:00:00.000Z',
            status: 'scheduled',
            duration_minutes: 50,
            created_at: '2026-06-20T10:00:00.000Z',
            teacher: { full_name: 'Teacher One', email: 'teacher@example.com' },
        };
        const client = createClient({
            support_tickets: createQuery({ data: [supportTicket], error: null }),
            sessions: createQuery({ data: [session], error: null }),
            crm_contacts: createQuery({
                data: null,
                error: { code: '42P01', message: 'relation "crm_contacts" does not exist' },
            }),
        });

        const detail = await getCrmContactDetail(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
        });

        expect(detail.isReady).toBe(false);
        expect(detail.contact).toBeNull();
        expect(detail.supportTickets).toEqual([supportTicket]);
        expect(detail.sessions).toEqual([session]);
        expect(detail.opportunities).toEqual([]);
        expect(detail.tasks).toEqual([]);
        expect(detail.activities).toEqual([]);
        expect(detail.consents).toEqual([]);
    });

    it('treats PostgREST schema-cache misses as CRM not migrated yet', async () => {
        const client = createClient({
            support_tickets: createQuery({ data: [], error: null }),
            sessions: createQuery({ data: [], error: null }),
            crm_contacts: createQuery({
                data: null,
                error: {
                    code: 'PGRST205',
                    message: "Could not find the table 'public.crm_contacts' in the schema cache",
                },
            }),
        });

        const detail = await getCrmContactDetail(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
        });

        expect(detail).toMatchObject({
            isReady: false,
            contact: null,
            opportunities: [],
            tasks: [],
            activities: [],
            consents: [],
            supportTickets: [],
            sessions: [],
        });
    });

    it('loads the CRM contact, pipeline, tasks and activity timeline when CRM exists', async () => {
        const contact = {
            id: 'contact-1',
            profile_id: 'student-1',
            primary_email: 'student@example.com',
            full_name: 'Student One',
            phone: null,
            preferred_language: 'es',
            timezone: 'Europe/Madrid',
            country: null,
            lifecycle_stage: 'customer',
            source: 'profile',
            source_path: null,
            owner_id: null,
            last_contacted_at: null,
            next_follow_up_at: null,
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
        };
        const opportunity = {
            id: 'opportunity-1',
            stage: 'qualified',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Conversation',
            availability: 'Mornings',
            lost_reason: null,
            opened_at: '2026-06-20T10:00:00.000Z',
            closed_at: null,
            preferred_package_id: null,
            packages: null,
        };
        const task = {
            id: 'task-1',
            title: 'Review progress',
            task_type: 'review',
            priority: 'normal',
            status: 'open',
            due_at: '2026-06-25T10:00:00.000Z',
            completed_at: null,
            created_at: '2026-06-20T10:00:00.000Z',
        };
        const activity = {
            id: 'activity-1',
            activity_type: 'system',
            subject: 'Cuenta de alumno creada',
            body: null,
            occurred_at: '2026-06-20T10:00:00.000Z',
            related_entity_type: 'profile',
            related_entity_id: 'student-1',
            metadata: {},
        };
        const consent = {
            id: 'consent-1',
            channel: 'email',
            purpose: 'sales_follow_up',
            legal_basis: 'consent',
            source: 'lead_capture',
            proof: 'Lead form accepted privacy policy',
            notice_version: 'privacy-v1',
            captured_at: '2026-06-20T10:00:00.000Z',
            opted_out_at: null,
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
        };
        const client = createClient({
            support_tickets: createQuery({ data: [], error: null }),
            sessions: createQuery({ data: [], error: null }),
            crm_contacts: createQuery({ data: contact, error: null }),
            crm_opportunities: createQuery({ data: [opportunity], error: null }),
            crm_tasks: createQuery({ data: [task], error: null }),
            crm_activities: createQuery({ data: [activity], error: null }),
            crm_consents: createQuery({ data: [consent], error: null }),
            acquisition_attribution_events: [
                createQuery({ data: [], error: null }),
                createQuery({ data: [], error: null }),
            ],
        });

        const detail = await getCrmContactDetail(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
        });

        expect(detail.isReady).toBe(true);
        expect(detail.contact).toEqual(contact);
        expect(detail.opportunities).toEqual([opportunity]);
        expect(detail.tasks).toEqual([task]);
        expect(detail.activities).toEqual([activity]);
        expect(detail.consents).toEqual([consent]);
        expect(client.from).toHaveBeenCalledWith('crm_opportunities');
        expect(client.from).toHaveBeenCalledWith('crm_tasks');
        expect(client.from).toHaveBeenCalledWith('crm_activities');
        expect(client.from).toHaveBeenCalledWith('crm_consents');
    });

    it('loads a central CRM contact detail for leads without a profile account', async () => {
        const contact = {
            id: 'contact-1',
            profile_id: null,
            primary_email: 'lead@example.com',
            full_name: 'Lead One',
            phone: null,
            preferred_language: 'es',
            timezone: 'America/New_York',
            country: 'US',
            lifecycle_stage: 'lead',
            source: 'lead_capture',
            source_path: '/es',
            owner_id: null,
            last_contacted_at: null,
            next_follow_up_at: null,
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
        };
        const opportunity = {
            id: 'opportunity-1',
            stage: 'new',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Work',
            availability: 'Evenings',
            lost_reason: null,
            opened_at: '2026-06-20T10:00:00.000Z',
            closed_at: null,
            preferred_package_id: null,
            packages: null,
        };
        const client = createClient({
            crm_contacts: createQuery({ data: contact, error: null }),
            crm_opportunities: createQuery({ data: [opportunity], error: null }),
            crm_tasks: createQuery({ data: [], error: null }),
            crm_activities: createQuery({ data: [], error: null }),
            crm_consents: createQuery({ data: [], error: null }),
            acquisition_attribution_events: [
                createQuery({ data: [], error: null }),
                createQuery({ data: [], error: null }),
            ],
        });

        const detail = await getCrmContactDetailByContactId(client as any, {
            contactId: contact.id,
        });

        expect(detail.isReady).toBe(true);
        expect(detail.contact).toEqual(contact);
        expect(detail.opportunities).toEqual([opportunity]);
        expect(detail.supportTickets).toEqual([]);
        expect(detail.sessions).toEqual([]);
        expect(client.from).not.toHaveBeenCalledWith('support_tickets');
        expect(client.from).not.toHaveBeenCalledWith('sessions');
    });

    it('loads at most twelve recent attribution events and labels the visible window boundaries', async () => {
        const contact = {
            id: 'contact-1',
            profile_id: null,
            primary_email: 'lead@example.com',
            lifecycle_stage: 'lead',
        };
        const latest = {
            id: 'event-latest',
            request_id: '10000000-0000-4000-8000-000000000001',
            event_kind: 'checkout_start',
            contact_id: contact.id,
            lead_id: null,
            checkout_intent_id: 'checkout-1',
            landing_path: '/en',
            referrer_kind: 'external',
            referrer_host: 'google.com',
            referrer_path: null,
            entry_language: 'en',
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: 'move_to_spain',
            utm_term: null,
            utm_content: null,
            captured_at: '2026-08-01T12:00:00.000Z',
            created_at: '2026-08-01T12:00:00.000Z',
        };
        const earliestVisible = {
            ...latest,
            id: 'event-earliest-visible',
            event_kind: 'application_submit',
            captured_at: '2026-08-01T10:00:00.000Z',
        };
        const attributionQuery = createQuery({ data: [latest, earliestVisible], error: null });
        const earliestQuery = createQuery({ data: [earliestVisible], error: null });
        const client = createClient({
            crm_contacts: createQuery({ data: contact, error: null }),
            crm_opportunities: createQuery({ data: [], error: null }),
            crm_tasks: createQuery({ data: [], error: null }),
            crm_activities: createQuery({ data: [], error: null }),
            crm_consents: createQuery({ data: [], error: null }),
            acquisition_attribution_events: [attributionQuery, earliestQuery],
        });

        const detail = await getCrmContactDetailByContactId(client as any, { contactId: contact.id });

        expect(attributionQuery.limit).toHaveBeenCalledWith(12);
        expect(earliestQuery.limit).toHaveBeenCalledWith(1);
        expect(attributionQuery.order).toHaveBeenNthCalledWith(1, 'captured_at', { ascending: false });
        expect(attributionQuery.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
        expect(earliestQuery.order).toHaveBeenNthCalledWith(1, 'captured_at', { ascending: true });
        expect(earliestQuery.order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
        expect(detail.acquisitionAttributionReady).toBe(true);
        expect(detail.acquisitionAttributionEvents).toEqual([latest, earliestVisible]);
        expect(detail.latestCapturedAttribution).toEqual(latest);
        expect(detail.firstObservedAttribution).toEqual(earliestVisible);
    });

    it('keeps the CRM detail usable when attribution has not been migrated', async () => {
        const contact = {
            id: 'contact-1',
            profile_id: null,
            primary_email: 'lead@example.com',
            lifecycle_stage: 'lead',
        };
        const client = createClient({
            crm_contacts: createQuery({ data: contact, error: null }),
            crm_opportunities: createQuery({ data: [], error: null }),
            crm_tasks: createQuery({ data: [], error: null }),
            crm_activities: createQuery({ data: [], error: null }),
            crm_consents: createQuery({ data: [], error: null }),
            acquisition_attribution_events: createQuery({
                data: null,
                error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' },
            }),
        });

        const detail = await getCrmContactDetailByContactId(client as any, { contactId: contact.id });

        expect(detail.isReady).toBe(true);
        expect(detail.contact).toEqual(contact);
        expect(detail.acquisitionAttributionReady).toBe(false);
        expect(detail.acquisitionAttributionEvents).toEqual([]);
    });
});
