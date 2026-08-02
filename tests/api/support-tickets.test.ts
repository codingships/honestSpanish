import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({ createSupabaseServerClient: vi.fn() }));

const studentId = '20000000-0000-4000-8000-000000000001';
const ticketId = '20000000-0000-4000-8000-000000000002';

function context(query: string) {
    return {
        request: { url: `http://localhost:4321/api/support/tickets?${query}` },
        cookies: {},
    };
}

function client(user: { id: string } | null, rpc = vi.fn()) {
    return {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
        rpc,
    };
}

describe('/api/support/tickets', () => {
    beforeEach(() => vi.clearAllMocks());

    it('requires an authenticated student session', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const supabase = client(null);
        vi.mocked(createSupabaseServerClient).mockReturnValue(supabase as never);
        const { GET } = await import('../../src/pages/api/support/tickets');

        const response = await GET(context(`ticketId=${ticketId}`) as never);

        expect(response.status).toBe(401);
        expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('returns only one bounded page and advances its per-ticket sequence cursor', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: [
                { id: 'event-5', ticket_id: ticketId, sequence: 5, event_type: 'public_reply', body: 'Latest', created_at: '2026-08-02T05:05:00Z' },
                { id: 'event-3', ticket_id: ticketId, sequence: 3, event_type: 'public_reply', body: 'Earlier', created_at: '2026-08-02T05:03:00Z' },
                { id: 'event-1', ticket_id: ticketId, sequence: 1, event_type: 'created', body: 'Created', created_at: '2026-08-02T05:01:00Z' },
            ],
            error: null,
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(client({ id: studentId }, rpc) as never);
        const { GET } = await import('../../src/pages/api/support/tickets');

        const response = await GET(context(`ticketId=${ticketId}&eventLimit=2&beforeSequence=6`) as never);
        const body = await response.json() as {
            events: Array<{ id: string }>;
            hasMore: boolean;
            nextBeforeSequence: number | null;
        };

        expect(response.status).toBe(200);
        expect(rpc).toHaveBeenCalledWith('get_my_support_ticket_events', {
            p_ticket_id: ticketId,
            p_limit: 3,
            p_before_sequence: 6,
        });
        expect(body).toEqual({
            events: [expect.objectContaining({ id: 'event-5' }), expect.objectContaining({ id: 'event-3' })],
            hasMore: true,
            nextBeforeSequence: 3,
        });
    });

    it('does not reveal whether a ticket owned by somebody else exists', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'P0002', message: 'support_ticket_not_found' },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(client({ id: studentId }, rpc) as never);
        const { GET } = await import('../../src/pages/api/support/tickets');

        const response = await GET(context(`ticketId=${ticketId}`) as never);

        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ error: 'Support ticket not found' });
    });
});
