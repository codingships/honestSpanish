import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('../../src/lib/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }));

const crmMocks = vi.hoisted(() => ({ record: vi.fn().mockResolvedValue({ status: 'created' }) }));
const emailMocks = vi.hoisted(() => ({ send: vi.fn().mockResolvedValue(true) }));
vi.mock('../../src/lib/crm/activity-sync', () => ({ recordCrmActivityForProfileSafe: crmMocks.record }));
vi.mock('../../src/lib/email', () => ({ sendSupportTicketUpdatedEmail: emailMocks.send }));

const adminId = '10000000-0000-4000-8000-000000000001';
const studentId = '10000000-0000-4000-8000-000000000002';
const ticketId = '10000000-0000-4000-8000-000000000003';
const requestId = '10000000-0000-4000-8000-000000000004';
const expectedUpdatedAt = '2026-08-02T05:00:00.000Z';

function roleClient(role: string | null, user: { id: string } | null = { id: adminId }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
    };
    return { auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from: vi.fn(() => chain) };
}

function awaitableQuery(result: Record<string, unknown>) {
    const chain: any = {
        select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(), lt: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue(result), limit: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
}

function getContext(query = 'status=open&priority=all&assignee=all&page=1&pageSize=25') {
    return { request: { url: `http://localhost:4321/api/admin/support-tickets?${query}` }, cookies: {} };
}

function postContext(body: Record<string, unknown>, origin: string | null = 'http://localhost:4321') {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/support-tickets',
            headers: { get: vi.fn((name: string) => name === 'Origin' ? origin : null) },
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: {},
    };
}

describe('/api/admin/support-tickets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crmMocks.record.mockResolvedValue({ status: 'created' });
        emailMocks.send.mockResolvedValue(true);
    });

    it('rejects cross-origin and originless mutations before auth or privileged access', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/support-tickets');
        const mutation = { requestId, ticketId, expectedStatus: 'open', expectedUpdatedAt, status: 'triaged' };

        expect((await POST(postContext(mutation, 'https://example.test') as never)).status).toBe(403);
        expect((await POST(postContext(mutation, null) as never)).status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects a non-admin before constructing the service client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('student') as never);
        const { GET } = await import('../../src/pages/api/admin/support-tickets');
        expect((await GET(getContext() as never)).status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('applies server-side filters, count and page bounds and returns admins', async () => {
        const supportQuery = awaitableQuery({ data: [{ id: ticketId }], error: null, count: 26 });
        const adminsQuery = awaitableQuery({ data: [{ id: adminId, full_name: 'Admin', email: 'admin@test.invalid' }], error: null });
        const client = { from: vi.fn((table: string) => table === 'support_tickets' ? supportQuery : adminsQuery) };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { GET } = await import('../../src/pages/api/admin/support-tickets');
        const response = await GET(getContext(`status=triaged&priority=high&assignee=${adminId}&page=2&pageSize=25`) as never);
        const body = await response.json() as {
            pagination: { page: number; pageSize: number; total: number; totalPages: number };
            admins: unknown[];
        };

        expect(response.status).toBe(200);
        expect(supportQuery.eq).toHaveBeenCalledWith('status', 'triaged');
        expect(supportQuery.eq).toHaveBeenCalledWith('priority', 'high');
        expect(supportQuery.eq).toHaveBeenCalledWith('assigned_admin_id', adminId);
        expect(supportQuery.range).toHaveBeenCalledWith(25, 49);
        expect(supportQuery.select.mock.calls[0][0]).not.toContain('support_ticket_events');
        expect(body.pagination).toEqual({ page: 2, pageSize: 25, total: 26, totalPages: 2 });
        expect(body.admins).toHaveLength(1);
    });

    it('loads one ticket history page on demand with a stable sequence cursor', async () => {
        const historyQuery = awaitableQuery({ data: [
            { id: 'event-3', ticket_id: ticketId, sequence: 3, event_type: 'public_reply' },
            { id: 'event-2', ticket_id: ticketId, sequence: 2, event_type: 'internal_note' },
        ], error: null });
        const client = { from: vi.fn(() => historyQuery) };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { GET } = await import('../../src/pages/api/admin/support-tickets');
        const response = await GET(getContext(`ticketId=${ticketId}&eventLimit=1&beforeSequence=4`) as never);
        const body = await response.json() as {
            events: Array<{ sequence: number }>;
            hasMore: boolean;
            nextBeforeSequence: number | null;
        };

        expect(response.status).toBe(200);
        expect(client.from).toHaveBeenCalledWith('support_ticket_events');
        expect(historyQuery.eq).toHaveBeenCalledWith('ticket_id', ticketId);
        expect(historyQuery.lt).toHaveBeenCalledWith('sequence', 4);
        expect(historyQuery.order).toHaveBeenCalledWith('sequence', { ascending: false });
        expect(historyQuery.limit).toHaveBeenCalledWith(2);
        expect(body).toEqual({
            events: [expect.objectContaining({ sequence: 3 })],
            hasMore: true,
            nextBeforeSequence: 3,
        });
    });

    it('uses the atomic RPC and sends only the public response to the student', async () => {
        const result = {
            ticket: { id: ticketId, user_id: studentId, issue_type: 'payment', issue_title: 'Payment', status: 'closed', priority: 'high', assigned_admin_id: adminId, updated_at: '2026-08-02T05:01:00.000Z' },
            event: { id: '10000000-0000-4000-8000-000000000005', event_type: 'public_reply', body: 'Public answer' },
            replayed: false, notifyStudent: true, publicMessage: 'Public answer',
        };
        const rpc = vi.fn().mockResolvedValue({ data: result, error: null });
        const profileQuery: any = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { email: 'student@test.invalid', full_name: 'Student', preferred_language: 'en' }, error: null }) };
        const client = { rpc, from: vi.fn(() => profileQuery) };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { POST } = await import('../../src/pages/api/admin/support-tickets');
        const response = await POST(postContext({
            requestId, ticketId, expectedStatus: 'triaged', expectedUpdatedAt, status: 'closed', priority: 'high',
            assignmentIsSet: true, assignedAdminId: adminId, messageKind: 'public_reply', message: 'Public answer',
        }) as never);

        expect(response.status).toBe(200);
        expect(rpc).toHaveBeenCalledWith('admin_mutate_support_ticket', {
            p_request_id: requestId, p_ticket_id: ticketId, p_admin_id: adminId,
            p_expected_status: 'triaged', p_expected_updated_at: expectedUpdatedAt,
            p_new_status: 'closed', p_new_priority: 'high',
            p_assignment_is_set: true, p_assigned_admin_id: adminId,
            p_message_kind: 'public_reply', p_message_body: 'Public answer',
        });
        expect(emailMocks.send).toHaveBeenCalledWith('student@test.invalid', expect.objectContaining({ adminNote: 'Public answer' }));
        expect(crmMocks.record).toHaveBeenCalledWith(client, expect.objectContaining({ relatedEntityId: result.event.id, body: 'Public answer' }));
    });

    it('does not resend email or CRM activity for an exact replay', async () => {
        const client = { rpc: vi.fn().mockResolvedValue({ data: {
            ticket: { id: ticketId, user_id: studentId, issue_type: 'payment', issue_title: 'Payment', status: 'closed', priority: 'normal', assigned_admin_id: null, updated_at: '2026-08-02T05:01:00.000Z' },
            event: { id: '10000000-0000-4000-8000-000000000005', event_type: 'admin_update', body: null },
            replayed: true, notifyStudent: true, publicMessage: null,
        }, error: null }), from: vi.fn() };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
        const { POST } = await import('../../src/pages/api/admin/support-tickets');
        const response = await POST(postContext({ requestId, ticketId, expectedStatus: 'triaged', expectedUpdatedAt, status: 'closed' }) as never);
        expect(response.status).toBe(200);
        expect(emailMocks.send).not.toHaveBeenCalled();
        expect(crmMocks.record).not.toHaveBeenCalled();
    });

    it('rejects invalid filters and mutations before any write', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        const { GET, POST } = await import('../../src/pages/api/admin/support-tickets');
        expect((await GET(getContext('priority=impossible') as never)).status).toBe(400);
        expect((await POST(postContext({ ticketId, status: 'closed' }) as never)).status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });
});
