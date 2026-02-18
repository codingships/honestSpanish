import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = (searchParams: Record<string, string> = {}) => {
    const url = new URL('http://localhost:4321/api/calendar/available-slots');
    Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
    return {
        request: {
            url: url.toString(),
            headers: { get: vi.fn().mockReturnValue('') },
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
};

describe('GET /api/calendar/available-slots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 't1', date: '2026-02-18' }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 400 when teacherId is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ date: '2026-02-18' }) as any);
        expect(response.status).toBe(400);
    });

    it('returns 400 when date is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 't1' }) as any);
        expect(response.status).toBe(400);
    });

    it('returns 200 with slots array when RPC returns data', async () => {
        const mockSlots = [
            { start_time: '09:00', end_time: '10:00' },
            { start_time: '10:00', end_time: '11:00' },
        ];
        const mockSupabase = createMockSupabaseClient({
            rpc: vi.fn().mockResolvedValue({ data: mockSlots, error: null }),
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 't1', date: '2026-02-18' }) as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.slots).toEqual(mockSlots);
    });

    it('returns 200 with empty slots array when RPC returns null', async () => {
        const mockSupabase = createMockSupabaseClient({
            rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 't1', date: '2026-02-18' }) as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.slots).toEqual([]);
    });

    it('returns 500 when Supabase RPC returns an error', async () => {
        const mockSupabase = createMockSupabaseClient({
            rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 't1', date: '2026-02-18' }) as any);
        expect(response.status).toBe(500);
    });
});
