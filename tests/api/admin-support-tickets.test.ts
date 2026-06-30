import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const crmMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn().mockResolvedValue({ status: 'created' }),
}));

const emailMocks = vi.hoisted(() => ({
    sendSupportTicketUpdatedEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    recordCrmActivityForProfileSafe: crmMocks.recordCrmActivityForProfileSafe,
}));

vi.mock('../../src/lib/email', () => ({
    sendSupportTicketUpdatedEmail: emailMocks.sendSupportTicketUpdatedEmail,
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

function createAwaitableQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    return chain;
}

function createSingleQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function createAdminClientForList(tickets: unknown[] = []) {
    const supportQuery = createAwaitableQuery({ data: tickets, error: null });
    const client = {
        from: vi.fn((table: string) => {
            if (table !== 'support_tickets') throw new Error(`Unexpected table ${table}`);
            return supportQuery;
        }),
    };
    return { client, supportQuery };
}

function createAdminClientForUpdate(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    profile: Record<string, unknown> | null = {
        email: 'student@example.com',
        full_name: 'Student One',
        preferred_language: 'en',
    }
) {
    const beforeQuery = createSingleQuery({ data: before, error: null });
    const updateQuery = createSingleQuery({ data: after, error: null });
    const profileQuery = createSingleQuery({ data: profile, error: profile ? null : { message: 'missing' } });
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const supportQueries = [beforeQuery, updateQuery];
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'support_tickets') return supportQueries.shift();
            if (table === 'admin_audit_log') return { insert: auditInsert };
            if (table === 'profiles') return profileQuery;
            throw new Error(`Unexpected table ${table}`);
        }),
    };
    return { client, beforeQuery, updateQuery, profileQuery, auditInsert };
}

function getContext(path = '/api/admin/support-tickets?status=open&limit=25') {
    return {
        request: {
            url: `http://localhost:4321${path}`,
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function postContext(body: Record<string, unknown>) {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/support-tickets',
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/admin/support-tickets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        emailMocks.sendSupportTicketUpdatedEmail.mockResolvedValue(true);
    });

    it('rejects non-admin users before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { GET } = await import('../../src/pages/api/admin/support-tickets');
        const response = await GET(getContext() as any);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('lets admins list support tickets with a status filter and limit cap', async () => {
        const ticket = { id: 'ticket-1', status: 'open', issue_title: 'No Meet link' };
        const { client, supportQuery } = createAdminClientForList([ticket]);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/support-tickets');
        const response = await GET(getContext('/api/admin/support-tickets?status=open&limit=999') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.tickets).toEqual([ticket]);
        expect(supportQuery.eq).toHaveBeenCalledWith('status', 'open');
        expect(supportQuery.limit).toHaveBeenCalledWith(100);
    });

    it('uses the default page size when the support ticket limit is invalid', async () => {
        const { client, supportQuery } = createAdminClientForList([]);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/support-tickets');
        const response = await GET(getContext('/api/admin/support-tickets?limit=-5') as any);

        expect(response.status).toBe(200);
        expect(supportQuery.limit).toHaveBeenCalledWith(50);
    });

    it('updates tickets and writes an admin audit log', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000001',
            user_id: 'student-1',
            status: 'open',
            issue_title: 'No veo el enlace',
            issue_type: 'missing-meet-link',
            message: 'No encuentro el enlace de clase.',
            admin_notes: null,
        };
        const after = {
            ...before,
            status: 'closed',
            admin_notes: 'Resolved after contacting the student.',
        };
        const { client, updateQuery, auditInsert } = createAdminClientForUpdate(before, after);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/support-tickets');
        const response = await POST(postContext({
            ticketId: before.id,
            status: 'closed',
            adminNotes: 'Resolved after contacting the student.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.ticket).toEqual(after);
        expect(body.userEmailSent).toBe(true);
        expect(updateQuery.update).toHaveBeenCalledWith({
            status: 'closed',
            admin_notes: 'Resolved after contacting the student.',
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'support_ticket.update',
            entity_type: 'support_ticket',
            entity_id: before.id,
            before,
            after,
        }));
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(client, expect.objectContaining({
            profileId: 'student-1',
            actorId: 'admin-1',
            activityType: 'support',
            relatedEntityType: 'support_ticket_update',
            relatedEntityId: `${before.id}:closed`,
        }));
        expect(emailMocks.sendSupportTicketUpdatedEmail).toHaveBeenCalledWith('student@example.com', expect.objectContaining({
            recipientName: 'Student One',
            issueTitle: 'No veo el enlace',
            ticketId: before.id,
            status: 'closed',
            adminNote: 'Resolved after contacting the student.',
            supportUrl: 'http://localhost:4321/en/campus/support',
        }));
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(client, expect.objectContaining({
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            actorId: 'admin-1',
            activityType: 'email_out',
            subject: 'Support request updated - Espanol Honesto',
            relatedEntityType: 'support_ticket_update_email',
            relatedEntityId: `${before.id}:closed`,
        }));
    });

    it('keeps admin ticket updates when the student support email is not accepted', async () => {
        emailMocks.sendSupportTicketUpdatedEmail.mockResolvedValue(false);
        const before = {
            id: '00000000-0000-4000-8000-000000000002',
            user_id: 'student-2',
            status: 'triaged',
            issue_title: 'Document access',
            issue_type: 'materials',
            message: 'I cannot open the folder.',
            admin_notes: null,
        };
        const after = {
            ...before,
            status: 'closed',
            admin_notes: 'Folder access was restored.',
        };
        const { client } = createAdminClientForUpdate(before, after);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/support-tickets');
        const response = await POST(postContext({
            ticketId: before.id,
            status: 'closed',
            adminNotes: 'Folder access was restored.',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.ticket).toEqual(after);
        expect(body.userEmailSent).toBe(false);
        expect(emailMocks.sendSupportTicketUpdatedEmail).toHaveBeenCalled();
        expect(crmMocks.recordCrmActivityForProfileSafe).not.toHaveBeenCalledWith(client, expect.objectContaining({
            activityType: 'email_out',
            relatedEntityType: 'support_ticket_update_email',
        }));
    });

    it('rejects invalid admin ticket updates', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { POST } = await import('../../src/pages/api/admin/support-tickets');
        const response = await POST(postContext({
            ticketId: 'not-a-uuid',
            status: 'deleted',
        }) as any);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });
});
