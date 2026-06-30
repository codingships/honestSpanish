import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    ensureCrmContactForProfile: vi.fn(),
}));

function createRoleClient(role: string | null, user: { id: string; email: string } | null = { id: 'admin-1', email: 'admin@example.com' }) {
    const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: 'missing' } }),
    };

    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn(() => profileChain),
    };
}

function createInsertQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function createSingleQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function createMaybeSingleQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function createUpdateQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function postContext(body: Record<string, unknown>) {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/crm/contact-actions',
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/admin/crm/contact-actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects non-admin users before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_note',
            contactId: '10000000-0000-4000-8000-000000000001',
            body: 'Follow up next week.',
        }) as any);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('creates CRM tasks assigned to the admin and writes audit log', async () => {
        const task = {
            id: 'task-1',
            title: 'Enviar propuesta',
            task_type: 'email',
            priority: 'high',
            status: 'open',
            due_at: '2026-06-25T10:00:00.000Z',
            completed_at: null,
            created_at: '2026-06-24T10:00:00.000Z',
        };
        const taskInsert = createInsertQuery({ data: task, error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_tasks') return taskInsert;
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_task',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            title: 'Enviar propuesta',
            taskType: 'email',
            priority: 'high',
            dueAt: '2026-06-25T10:00:00.000Z',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(201);
        expect(body.task).toEqual(task);
        expect(taskInsert.insert).toHaveBeenCalledWith({
            contact_id: '10000000-0000-4000-8000-000000000001',
            opportunity_id: '20000000-0000-4000-8000-000000000001',
            assigned_to: 'admin-1',
            title: 'Enviar propuesta',
            task_type: 'email',
            priority: 'high',
            due_at: '2026-06-25T10:00:00.000Z',
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_task.create',
            entity_type: 'crm_task',
            entity_id: task.id,
            after: task,
        }));
    });

    it('creates CRM notes as timeline activities and writes audit log', async () => {
        const activity = {
            id: 'activity-1',
            activity_type: 'note',
            subject: 'Nota interna',
            body: 'Prefiere contacto por email.',
            occurred_at: '2026-06-24T10:00:00.000Z',
            related_entity_type: 'crm_contact',
            related_entity_id: '10000000-0000-4000-8000-000000000001',
            metadata: {},
        };
        const activityInsert = createInsertQuery({ data: activity, error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_activities') return activityInsert;
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_note',
            contactId: '10000000-0000-4000-8000-000000000001',
            body: 'Prefiere contacto por email.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(201);
        expect(body.activity).toEqual(activity);
        expect(activityInsert.insert).toHaveBeenCalledWith({
            contact_id: '10000000-0000-4000-8000-000000000001',
            opportunity_id: null,
            actor_id: 'admin-1',
            activity_type: 'note',
            subject: 'Nota interna',
            body: 'Prefiere contacto por email.',
            metadata: {},
            related_entity_type: 'crm_contact',
            related_entity_id: '10000000-0000-4000-8000-000000000001',
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_activity.note.create',
            entity_type: 'crm_activity',
            entity_id: activity.id,
            after: activity,
        }));
    });

    it('records outbound CRM communication when the latest consent allows it', async () => {
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000001',
            contact_id: '10000000-0000-4000-8000-000000000001',
            legacy_lead_id: '50000000-0000-4000-8000-000000000001',
            stage: 'to_contact',
        };
        const consent = {
            id: '40000000-0000-4000-8000-000000000010',
            legal_basis: 'prior_customer_similar_services',
            opted_out_at: null,
            captured_at: '2026-06-20T10:00:00.000Z',
            created_at: '2026-06-20T10:00:00.000Z',
        };
        const activity = {
            id: '90000000-0000-4000-8000-000000000010',
            activity_type: 'email_out',
            subject: 'Propuesta de plan',
            body: 'Le envie propuesta tras la llamada.',
            occurred_at: '2026-06-24T10:00:00.000Z',
            related_entity_type: 'crm_contact',
            related_entity_id: '10000000-0000-4000-8000-000000000001',
            metadata: {
                action: 'create_communication',
                channel: 'email',
                direction: 'outbound',
                purpose: 'sales_follow_up',
                consent_checked: true,
                consent_id: consent.id,
                consent_legal_basis: consent.legal_basis,
                consent_override_reason: null,
                next_follow_up_at: '2026-06-25T12:00:00.000Z',
                opportunity_stage_before: opportunityBefore.stage,
                opportunity_stage_after: 'contacted',
                manual_log: true,
            },
        };
        const consentLookup = createMaybeSingleQuery({ data: consent, error: null });
        const opportunityLookup = createSingleQuery({ data: opportunityBefore, error: null });
        const opportunityUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const activityInsert = createInsertQuery({ data: activity, error: null });
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const opportunityQueries = [opportunityLookup, opportunityUpdate];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_consents') return consentLookup;
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_activities') return activityInsert;
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_communication',
            contactId: '10000000-0000-4000-8000-000000000001',
            opportunityId: '20000000-0000-4000-8000-000000000001',
            communicationType: 'email_out',
            direction: 'outbound',
            purpose: 'sales_follow_up',
            subject: 'Propuesta de plan',
            body: 'Le envie propuesta tras la llamada.',
            occurredAt: '2026-06-24T10:00:00.000Z',
            consentOverrideReason: null,
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(201);
        expect(body.activity).toEqual(activity);
        expect(consentLookup.eq).toHaveBeenCalledWith('contact_id', '10000000-0000-4000-8000-000000000001');
        expect(consentLookup.eq).toHaveBeenCalledWith('channel', 'email');
        expect(consentLookup.eq).toHaveBeenCalledWith('purpose', 'sales_follow_up');
        expect(consentLookup.order).toHaveBeenCalledWith('captured_at', { ascending: false, nullsFirst: false });
        expect(consentLookup.order).toHaveBeenCalledWith('created_at', { ascending: false });
        expect(consentLookup.limit).toHaveBeenCalledWith(1);
        expect(activityInsert.insert).toHaveBeenCalledWith({
            contact_id: '10000000-0000-4000-8000-000000000001',
            opportunity_id: '20000000-0000-4000-8000-000000000001',
            actor_id: 'admin-1',
            activity_type: 'email_out',
            subject: 'Propuesta de plan',
            body: 'Le envie propuesta tras la llamada.',
            occurred_at: '2026-06-24T10:00:00.000Z',
            metadata: expect.objectContaining({
                action: 'create_communication',
                channel: 'email',
                direction: 'outbound',
                purpose: 'sales_follow_up',
                consent_checked: true,
                consent_id: consent.id,
                consent_legal_basis: consent.legal_basis,
                consent_override_reason: null,
                next_follow_up_at: expect.any(String),
                opportunity_stage_before: opportunityBefore.stage,
                opportunity_stage_after: 'contacted',
                manual_log: true,
            }),
            related_entity_type: 'crm_contact',
            related_entity_id: '10000000-0000-4000-8000-000000000001',
        });
        expect(contactUpdate.update).toHaveBeenCalledWith({
            last_contacted_at: '2026-06-24T10:00:00.000Z',
            next_follow_up_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(contactUpdate.eq).toHaveBeenCalledWith('id', '10000000-0000-4000-8000-000000000001');
        expect(opportunityLookup.eq).toHaveBeenCalledWith('id', opportunityBefore.id);
        expect(opportunityUpdate.update).toHaveBeenCalledWith({
            stage: 'contacted',
            updated_at: expect.any(String),
        });
        expect(opportunityUpdate.eq).toHaveBeenCalledWith('id', opportunityBefore.id);
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(leadUpdate.eq).toHaveBeenCalledWith('id', opportunityBefore.legacy_lead_id);
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_activity.communication.create',
            entity_type: 'crm_activity',
            entity_id: activity.id,
            after: activity,
        }));
    });

    it('blocks outbound CRM communication when the latest consent is opted out', async () => {
        const consentLookup = createMaybeSingleQuery({
            data: {
                id: '40000000-0000-4000-8000-000000000011',
                legal_basis: 'consent',
                opted_out_at: '2026-06-24T09:00:00.000Z',
                captured_at: '2026-06-20T10:00:00.000Z',
                created_at: '2026-06-20T10:00:00.000Z',
            },
            error: null,
        });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_consents') return consentLookup;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_communication',
            contactId: '10000000-0000-4000-8000-000000000001',
            communicationType: 'email_out',
            direction: 'outbound',
            purpose: 'sales_follow_up',
            body: 'Seguimiento comercial tras opt-out.',
            consentOverrideReason: 'Lo hablamos por telefono.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(409);
        expect(body).toMatchObject({
            error: 'Contact is opted out for this channel and purpose',
            reason: 'consent_opted_out',
            channel: 'email',
            purpose: 'sales_follow_up',
        });
        expect(client.from).toHaveBeenCalledTimes(1);
    });

    it('completes CRM tasks, writes timeline activity and audits the change', async () => {
        const before = {
            id: '30000000-0000-4000-8000-000000000001',
            contact_id: '10000000-0000-4000-8000-000000000001',
            opportunity_id: '20000000-0000-4000-8000-000000000001',
            assigned_to: 'admin-1',
            title: 'Enviar propuesta',
            task_type: 'email',
            priority: 'high',
            status: 'open',
            due_at: '2026-06-25T10:00:00.000Z',
            completed_at: null,
            created_at: '2026-06-24T10:00:00.000Z',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const after = {
            ...before,
            status: 'done',
            completed_at: '2026-06-24T12:00:00.000Z',
            updated_at: '2026-06-24T12:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const taskQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'complete_task',
            taskId: before.id,
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.task).toEqual(after);
        expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'done',
            completed_at: expect.any(String),
        }));
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            opportunity_id: before.opportunity_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Tarea completada',
            body: before.title,
            related_entity_type: 'crm_task',
            related_entity_id: before.id,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_task.complete',
            entity_type: 'crm_task',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('claims shared CRM tasks for the current admin and records the handoff', async () => {
        const before = {
            id: '30000000-0000-4000-8000-000000000020',
            contact_id: '10000000-0000-4000-8000-000000000020',
            opportunity_id: '20000000-0000-4000-8000-000000000020',
            assigned_to: null,
            title: 'Revisar solicitud de plaza en menos de 24h',
            task_type: 'review',
            priority: 'high',
            status: 'open',
            due_at: '2026-06-25T10:00:00.000Z',
            completed_at: null,
            related_entity_type: 'lead',
            related_entity_id: '00000000-0000-4000-8000-000000000020',
            metadata: { shared_owner_queue: true },
            created_at: '2026-06-24T10:00:00.000Z',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const after = {
            ...before,
            assigned_to: 'admin-1',
            updated_at: '2026-06-24T12:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const taskQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'claim_task',
            taskId: before.id,
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.task).toEqual(after);
        expect(updateQuery.update).toHaveBeenCalledWith({
            assigned_to: 'admin-1',
        });
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            opportunity_id: before.opportunity_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Tarea asignada',
            body: before.title,
            related_entity_type: 'crm_task',
            related_entity_id: before.id,
            metadata: expect.objectContaining({
                action: 'claim_task',
                task_id: before.id,
                status: 'open',
                due_at: before.due_at,
            }),
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_task.claim',
            entity_type: 'crm_task',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('snoozes CRM tasks to a future due date', async () => {
        const before = {
            id: '30000000-0000-4000-8000-000000000002',
            contact_id: '10000000-0000-4000-8000-000000000001',
            opportunity_id: null,
            assigned_to: 'admin-1',
            title: 'Revisar disponibilidad',
            task_type: 'review',
            priority: 'normal',
            status: 'open',
            due_at: '2026-06-24T10:00:00.000Z',
            completed_at: null,
            created_at: '2026-06-24T10:00:00.000Z',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const after = {
            ...before,
            status: 'snoozed',
            due_at: '2026-06-25T09:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const taskQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'snooze_task',
            taskId: before.id,
            dueAt: '2026-06-25T09:00:00.000Z',
        }) as any);

        expect(response.status).toBe(200);
        expect(updateQuery.update).toHaveBeenCalledWith({
            status: 'snoozed',
            due_at: '2026-06-25T09:00:00.000Z',
            completed_at: null,
        });
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            subject: 'Tarea aplazada',
            related_entity_id: before.id,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'crm_task.snooze',
            before,
            after,
        }));
    });

    it('edits CRM task title, type, priority and due date', async () => {
        const before = {
            id: '30000000-0000-4000-8000-000000000003',
            contact_id: '10000000-0000-4000-8000-000000000001',
            opportunity_id: null,
            assigned_to: 'admin-1',
            title: 'Vieja tarea',
            task_type: 'review',
            priority: 'normal',
            status: 'open',
            due_at: null,
            completed_at: null,
            created_at: '2026-06-24T10:00:00.000Z',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const after = {
            ...before,
            title: 'Enviar email',
            task_type: 'email',
            priority: 'urgent',
            due_at: '2026-06-26T09:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const taskQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'update_task',
            taskId: before.id,
            title: 'Enviar email',
            taskType: 'email',
            priority: 'urgent',
            dueAt: '2026-06-26T09:00:00.000Z',
        }) as any);

        expect(response.status).toBe(200);
        expect(updateQuery.update).toHaveBeenCalledWith({
            title: 'Enviar email',
            task_type: 'email',
            priority: 'urgent',
            due_at: '2026-06-26T09:00:00.000Z',
        });
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            subject: 'Tarea actualizada',
            related_entity_id: before.id,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'crm_task.update',
            before,
            after,
        }));
    });

    it('updates CRM opportunity stage from the contact file and syncs lead, contact, timeline and audit', async () => {
        const before = {
            id: '20000000-0000-4000-8000-000000000001',
            contact_id: '10000000-0000-4000-8000-000000000001',
            legacy_lead_id: '00000000-0000-4000-8000-000000000001',
            stage: 'new',
        };
        const after = {
            ...before,
            stage: 'qualified',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            lost_reason: null,
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            preferred_package_id: null,
            updated_at: '2026-06-24T12:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const nurtureTaskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const taskQueries = [taskUpdate, nurtureTaskUpdate];
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'update_opportunity_stage',
            opportunityId: before.id,
            newStage: 'qualified',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.opportunity).toEqual(after);
        expect(updateQuery.update).toHaveBeenCalledWith({
            stage: 'qualified',
            closed_at: null,
            updated_at: expect.any(String),
        });
        expect(contactUpdate.update).toHaveBeenCalledWith({
            lifecycle_stage: 'qualified',
            last_contacted_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(contactUpdate.eq).toHaveBeenCalledWith('id', before.contact_id);
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(leadUpdate.eq).toHaveBeenCalledWith('id', before.legacy_lead_id);
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.legacy_lead_id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            opportunity_id: before.id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Etapa de oportunidad actualizada',
            related_entity_type: 'crm_opportunity',
            related_entity_id: before.id,
            metadata: {
                action: 'update_opportunity_stage',
                previous_stage: 'new',
                new_stage: 'qualified',
                legacy_lead_id: before.legacy_lead_id,
                next_follow_up_at: null,
            },
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_opportunity.stage.update',
            entity_type: 'crm_opportunity',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('creates a follow-up task when an opportunity is postponed to nurture', async () => {
        const before = {
            id: '20000000-0000-4000-8000-000000000021',
            contact_id: '10000000-0000-4000-8000-000000000021',
            legacy_lead_id: '00000000-0000-4000-8000-000000000021',
            stage: 'proposal',
        };
        const after = {
            ...before,
            stage: 'nurture',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Wants to wait until September',
            availability: 'September',
            lost_reason: null,
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            preferred_package_id: null,
            updated_at: '2026-06-24T12:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskLookup = createMaybeSingleQuery({ data: null, error: null });
        const taskInsert = {
            insert: vi.fn().mockResolvedValue({ error: null }),
        };
        const initialReviewTaskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const taskQueries = [initialReviewTaskUpdate, taskLookup, taskInsert];
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'update_opportunity_stage',
            opportunityId: before.id,
            newStage: 'nurture',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.opportunity).toEqual(after);
        expect(contactUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
            lifecycle_stage: 'lead',
            next_follow_up_at: expect.any(String),
            updated_at: expect.any(String),
        }));
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(initialReviewTaskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(initialReviewTaskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead']);
        expect(initialReviewTaskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.legacy_lead_id);
        expect(initialReviewTaskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskLookup.eq).toHaveBeenCalledWith('related_entity_type', 'crm_opportunity');
        expect(taskLookup.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            opportunity_id: before.id,
            assigned_to: 'admin-1',
            title: 'Revisar lead pospuesto',
            task_type: 'review',
            priority: 'normal',
            due_at: expect.any(String),
            related_entity_type: 'crm_opportunity',
            related_entity_id: before.id,
            metadata: expect.objectContaining({
                action: 'nurture_follow_up',
                stage: 'nurture',
                legacy_lead_id: before.legacy_lead_id,
                follow_up_days: 7,
            }),
        }));
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            opportunity_id: before.id,
            metadata: expect.objectContaining({
                action: 'update_opportunity_stage',
                previous_stage: 'proposal',
                new_stage: 'nurture',
                next_follow_up_at: expect.any(String),
            }),
        }));
    });

    it('closes a postponed-opportunity follow-up task when the opportunity resumes', async () => {
        const before = {
            id: '20000000-0000-4000-8000-000000000022',
            contact_id: '10000000-0000-4000-8000-000000000022',
            legacy_lead_id: '00000000-0000-4000-8000-000000000022',
            stage: 'nurture',
        };
        const after = {
            ...before,
            stage: 'proposal',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Ready after summer',
            availability: 'September afternoons',
            lost_reason: null,
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            preferred_package_id: null,
            updated_at: '2026-06-24T12:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const nurtureTaskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const taskQueries = [taskUpdate, nurtureTaskUpdate];
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'update_opportunity_stage',
            opportunityId: before.id,
            newStage: 'proposal',
        }) as any);

        expect(response.status).toBe(200);
        expect(contactUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
            lifecycle_stage: 'qualified',
            last_contacted_at: expect.any(String),
            updated_at: expect.any(String),
        }));
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.legacy_lead_id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(nurtureTaskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(nurtureTaskUpdate.eq).toHaveBeenCalledWith('related_entity_type', 'crm_opportunity');
        expect(nurtureTaskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.id);
        expect(nurtureTaskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                action: 'update_opportunity_stage',
                previous_stage: 'nurture',
                new_stage: 'proposal',
                next_follow_up_at: null,
            }),
        }));
    });

    it('marks won opportunities as contacted leads and clears terminal lead work from the contact file', async () => {
        const before = {
            id: '20000000-0000-4000-8000-000000000023',
            contact_id: '10000000-0000-4000-8000-000000000023',
            legacy_lead_id: '00000000-0000-4000-8000-000000000023',
            stage: 'proposal',
        };
        const after = {
            ...before,
            stage: 'won',
            interest: 'general',
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            lost_reason: null,
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: '2026-06-26T10:00:00.000Z',
            preferred_package_id: null,
            updated_at: '2026-06-24T12:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'update_opportunity_stage',
            opportunityId: before.id,
            newStage: 'won',
        }) as any);

        expect(response.status).toBe(200);
        expect(contactUpdate.update).toHaveBeenCalledWith({
            lifecycle_stage: 'customer',
            updated_at: expect.any(String),
        });
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            level_check_context: {},
            level_check_raw_cleared_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(leadUpdate.eq).toHaveBeenCalledWith('id', before.legacy_lead_id);
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead', 'level_check', 'lead_sales_follow_up']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.legacy_lead_id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            opportunity_id: before.id,
            metadata: expect.objectContaining({
                action: 'update_opportunity_stage',
                previous_stage: 'proposal',
                new_stage: 'won',
                next_follow_up_at: null,
            }),
        }));
    });

    it('creates an urgent CRM recovery task for a failed payment and links it to the payment', async () => {
        const payment = {
            id: '50000000-0000-4000-8000-000000000001',
            student_id: '60000000-0000-4000-8000-000000000001',
            amount: 12000,
            currency: 'eur',
            status: 'failed',
            created_at: '2026-06-24T10:00:00.000Z',
            description: 'June payment failed',
            stripe_invoice_id: 'in_123',
            stripe_payment_intent_id: 'pi_123',
            profiles: {
                id: '60000000-0000-4000-8000-000000000001',
                email: 'student@example.com',
                full_name: 'Ana Alumna',
                role: 'student',
            },
        };
        const task = {
            id: '30000000-0000-4000-8000-000000000010',
            contact_id: '10000000-0000-4000-8000-000000000010',
            opportunity_id: null,
            assigned_to: 'admin-1',
            title: 'Recuperar pago fallido',
            task_type: 'email',
            priority: 'urgent',
            status: 'open',
            due_at: '2026-06-24T12:00:00.000Z',
            completed_at: null,
            related_entity_type: 'payment',
            related_entity_id: payment.id,
            metadata: {},
            created_at: '2026-06-24T11:00:00.000Z',
            updated_at: '2026-06-24T11:00:00.000Z',
        };
        const paymentQuery = createSingleQuery({ data: payment, error: null });
        const existingTaskQuery: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        const taskInsert = createInsertQuery({ data: task, error: null });
        const taskQueries = [existingTaskQuery, taskInsert];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'payments') return paymentQuery;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { ensureCrmContactForProfile } = await import('../../src/lib/crm/activity-sync');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: task.contact_id,
        });

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_payment_recovery_task',
            paymentId: payment.id,
            dueAt: '2026-06-24T12:00:00.000Z',
            note: 'Contactar antes de pausar definitivamente.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(201);
        expect(body).toMatchObject({ task, existing: false });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: payment.student_id,
            email: payment.profiles.email,
            fullName: payment.profiles.full_name,
            lifecycleStage: 'customer',
            source: 'payment_recovery',
            sourcePath: '/campus/admin/payments',
        });
        expect(existingTaskQuery.eq).toHaveBeenCalledWith('related_entity_type', 'payment');
        expect(existingTaskQuery.eq).toHaveBeenCalledWith('related_entity_id', payment.id);
        expect(existingTaskQuery.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: task.contact_id,
            assigned_to: 'admin-1',
            title: expect.stringContaining('Recuperar pago fallido'),
            task_type: 'email',
            priority: 'urgent',
            due_at: '2026-06-24T12:00:00.000Z',
            related_entity_type: 'payment',
            related_entity_id: payment.id,
            metadata: expect.objectContaining({
                action: 'create_payment_recovery_task',
                payment_id: payment.id,
                amount: payment.amount,
                currency: payment.currency,
                stripe_invoice_id: payment.stripe_invoice_id,
                stripe_payment_intent_id: payment.stripe_payment_intent_id,
                note: 'Contactar antes de pausar definitivamente.',
            }),
        }));
        expect(contactUpdate.update).toHaveBeenCalledWith({
            next_follow_up_at: '2026-06-24T12:00:00.000Z',
            updated_at: expect.any(String),
        });
        expect(contactUpdate.eq).toHaveBeenCalledWith('id', task.contact_id);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: task.contact_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Tarea de recuperacion de pago creada',
            body: 'Contactar antes de pausar definitivamente.',
            related_entity_type: 'payment',
            related_entity_id: payment.id,
            metadata: expect.objectContaining({
                task_id: task.id,
                payment_id: payment.id,
            }),
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_payment_recovery_task.create',
            entity_type: 'payment',
            entity_id: payment.id,
            after: expect.objectContaining({
                payment_id: payment.id,
                task_id: task.id,
                due_at: '2026-06-24T12:00:00.000Z',
            }),
        }));
    });

    it('creates a CRM renewal task for an active subscription and links it to the subscription', async () => {
        const subscription = {
            id: '80000000-0000-4000-8000-000000000001',
            student_id: '60000000-0000-4000-8000-000000000002',
            status: 'active',
            ends_at: '2026-06-30',
            sessions_used: 8,
            sessions_total: 10,
            duration_months: 1,
            stripe_subscription_id: 'sub_123',
            stripe_invoice_id: 'in_456',
            profiles: {
                id: '60000000-0000-4000-8000-000000000002',
                email: 'renewal@example.com',
                full_name: 'Elena Renovacion',
                role: 'student',
            },
            packages: {
                name: 'intensive',
                display_name: { es: 'Intensivo' },
            },
        };
        const task = {
            id: '30000000-0000-4000-8000-000000000011',
            contact_id: '10000000-0000-4000-8000-000000000011',
            opportunity_id: null,
            assigned_to: 'admin-1',
            title: 'Preparar renovacion de suscripcion',
            task_type: 'email',
            priority: 'high',
            status: 'open',
            due_at: '2026-06-25T10:00:00.000Z',
            completed_at: null,
            related_entity_type: 'subscription',
            related_entity_id: subscription.id,
            metadata: {},
            created_at: '2026-06-24T11:00:00.000Z',
            updated_at: '2026-06-24T11:00:00.000Z',
        };
        const subscriptionQuery = createSingleQuery({ data: subscription, error: null });
        const existingTaskQuery: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
        const taskInsert = createInsertQuery({ data: task, error: null });
        const taskQueries = [existingTaskQuery, taskInsert];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'subscriptions') return subscriptionQuery;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { ensureCrmContactForProfile } = await import('../../src/lib/crm/activity-sync');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: task.contact_id,
        });

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'create_subscription_renewal_task',
            subscriptionId: subscription.id,
            dueAt: '2026-06-25T10:00:00.000Z',
            note: 'Confirmar si quiere renovar antes de que termine el plan.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(201);
        expect(body).toMatchObject({ task, existing: false });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: subscription.student_id,
            email: subscription.profiles.email,
            fullName: subscription.profiles.full_name,
            lifecycleStage: 'customer',
            source: 'subscription_renewal',
            sourcePath: '/campus/admin',
        });
        expect(existingTaskQuery.eq).toHaveBeenCalledWith('related_entity_type', 'subscription');
        expect(existingTaskQuery.eq).toHaveBeenCalledWith('related_entity_id', subscription.id);
        expect(existingTaskQuery.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: task.contact_id,
            assigned_to: 'admin-1',
            title: expect.stringContaining('Preparar renovacion de suscripcion'),
            task_type: 'email',
            priority: expect.stringMatching(/high|urgent|normal/),
            due_at: '2026-06-25T10:00:00.000Z',
            related_entity_type: 'subscription',
            related_entity_id: subscription.id,
            metadata: expect.objectContaining({
                action: 'create_subscription_renewal_task',
                subscription_id: subscription.id,
                subscription_status: subscription.status,
                ends_at: subscription.ends_at,
                days_remaining: expect.any(Number),
                sessions_used: subscription.sessions_used,
                sessions_total: subscription.sessions_total,
                duration_months: subscription.duration_months,
                package_name: subscription.packages.name,
                stripe_subscription_id: subscription.stripe_subscription_id,
                stripe_invoice_id: subscription.stripe_invoice_id,
                note: 'Confirmar si quiere renovar antes de que termine el plan.',
            }),
        }));
        expect(contactUpdate.update).toHaveBeenCalledWith({
            next_follow_up_at: '2026-06-25T10:00:00.000Z',
            updated_at: expect.any(String),
        });
        expect(contactUpdate.eq).toHaveBeenCalledWith('id', task.contact_id);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: task.contact_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Tarea de renovacion creada',
            body: 'Confirmar si quiere renovar antes de que termine el plan.',
            related_entity_type: 'subscription',
            related_entity_id: subscription.id,
            metadata: expect.objectContaining({
                task_id: task.id,
                subscription_id: subscription.id,
            }),
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_subscription_renewal_task.create',
            entity_type: 'subscription',
            entity_id: subscription.id,
            after: expect.objectContaining({
                subscription_id: subscription.id,
                task_id: task.id,
                due_at: '2026-06-25T10:00:00.000Z',
            }),
        }));
    });

    it('registers CRM consent, writes timeline activity and audits the change', async () => {
        const consent = {
            id: '40000000-0000-4000-8000-000000000001',
            contact_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            purpose: 'sales_follow_up',
            legal_basis: 'consent',
            source: 'lead_capture',
            proof: 'Accepted privacy policy in lead form.',
            notice_version: 'privacy-v1',
            captured_at: '2026-06-24T10:00:00.000Z',
            opted_out_at: null,
            created_at: '2026-06-24T10:00:00.000Z',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const activeLookup = createMaybeSingleQuery({ data: null, error: null });
        const consentInsert = createInsertQuery({ data: consent, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const consentQueries = [activeLookup, consentInsert];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_consents') return consentQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'upsert_consent',
            contactId: consent.contact_id,
            channel: 'email',
            purpose: 'sales_follow_up',
            legalBasis: 'consent',
            source: 'lead_capture',
            proof: 'Accepted privacy policy in lead form.',
            noticeVersion: 'privacy-v1',
            capturedAt: '2026-06-24T10:00:00.000Z',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(201);
        expect(body.consent).toEqual(consent);
        expect(activeLookup.eq).toHaveBeenCalledWith('contact_id', consent.contact_id);
        expect(activeLookup.eq).toHaveBeenCalledWith('channel', 'email');
        expect(activeLookup.eq).toHaveBeenCalledWith('purpose', 'sales_follow_up');
        expect(activeLookup.is).toHaveBeenCalledWith('opted_out_at', null);
        expect(consentInsert.insert).toHaveBeenCalledWith({
            contact_id: consent.contact_id,
            channel: 'email',
            purpose: 'sales_follow_up',
            legal_basis: 'consent',
            source: 'lead_capture',
            proof: 'Accepted privacy policy in lead form.',
            notice_version: 'privacy-v1',
            captured_at: '2026-06-24T10:00:00.000Z',
            opted_out_at: null,
        });
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: consent.contact_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Consentimiento registrado',
            related_entity_type: 'crm_consent',
            related_entity_id: consent.id,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_consent.upsert',
            entity_type: 'crm_consent',
            entity_id: consent.id,
            before: null,
            after: consent,
        }));
    });

    it('updates existing CRM consent instead of creating another active consent', async () => {
        const before = {
            id: '40000000-0000-4000-8000-000000000002',
            contact_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            purpose: 'sales_follow_up',
            legal_basis: 'manual_review_required',
            source: 'lead_capture',
            proof: null,
            notice_version: 'privacy-v1',
            captured_at: '2026-06-20T10:00:00.000Z',
            opted_out_at: null,
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
        };
        const after = {
            ...before,
            legal_basis: 'prior_customer_similar_services',
            source: 'admin_review',
            proof: 'Former student, similar service follow-up.',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const activeLookup = createMaybeSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const consentQueries = [activeLookup, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_consents') return consentQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'upsert_consent',
            contactId: before.contact_id,
            channel: 'email',
            purpose: 'sales_follow_up',
            legalBasis: 'prior_customer_similar_services',
            source: 'admin_review',
            proof: 'Former student, similar service follow-up.',
            noticeVersion: 'privacy-v1',
            capturedAt: before.captured_at,
        }) as any);

        expect(response.status).toBe(200);
        expect(updateQuery.update).toHaveBeenCalledWith({
            contact_id: before.contact_id,
            channel: 'email',
            purpose: 'sales_follow_up',
            legal_basis: 'prior_customer_similar_services',
            source: 'admin_review',
            proof: 'Former student, similar service follow-up.',
            notice_version: 'privacy-v1',
            captured_at: before.captured_at,
            opted_out_at: null,
        });
        expect(updateQuery.eq).toHaveBeenCalledWith('id', before.id);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            subject: 'Consentimiento actualizado',
            related_entity_id: before.id,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'crm_consent.upsert',
            before,
            after,
        }));
    });

    it('records opt-out for CRM consent, writes timeline activity and audits the change', async () => {
        const before = {
            id: '40000000-0000-4000-8000-000000000003',
            contact_id: '10000000-0000-4000-8000-000000000001',
            channel: 'email',
            purpose: 'marketing',
            legal_basis: 'consent',
            source: 'admin_review',
            proof: 'Accepted newsletter.',
            notice_version: 'privacy-v1',
            captured_at: '2026-06-20T10:00:00.000Z',
            opted_out_at: null,
            created_at: '2026-06-20T10:00:00.000Z',
            updated_at: '2026-06-20T10:00:00.000Z',
        };
        const after = {
            ...before,
            proof: 'Requested no marketing.',
            opted_out_at: '2026-06-24T10:00:00.000Z',
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createUpdateQuery({ data: after, error: null });
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const consentQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_consents') return consentQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/crm/contact-actions');
        const response = await POST(postContext({
            action: 'opt_out_consent',
            consentId: before.id,
            reason: 'Requested no marketing.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.consent).toEqual(after);
        expect(updateQuery.update).toHaveBeenCalledWith({
            opted_out_at: expect.any(String),
            proof: 'Requested no marketing.',
        });
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.contact_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Opt-out registrado',
            related_entity_type: 'crm_consent',
            related_entity_id: before.id,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_consent.opt_out',
            entity_type: 'crm_consent',
            entity_id: before.id,
            before,
            after,
        }));
    });
});
