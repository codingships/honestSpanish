import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/external-integrations', () => ({
    shouldDisableExternalIntegrations: vi.fn().mockReturnValue(true),
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    isInternalJobServiceConfigured: vi.fn().mockReturnValue(true),
    filterSlotsAgainstGoogleViaInternalService: vi.fn((_context, input) => Promise.resolve(input.slots)),
}));

const makeContext = (searchParams: Record<string, string> = {}) => {
    const url = new URL('http://localhost:4321/api/calendar/available-slots');
    Object.entries(searchParams).forEach(([key, value]) => url.searchParams.set(key, value));

    return {
        request: {
            url: url.toString(),
            headers: { get: vi.fn().mockReturnValue('') },
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
};

const makeQuery = ({
    singleResult = { data: null, error: null },
}: {
    singleResult?: { data: unknown; error: unknown };
} = {}) => {
    const eqCalls: Array<[string, unknown]> = [];
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
        }),
        single: vi.fn().mockResolvedValue(singleResult),
    };

    return { chain, eqCalls };
};

const makeSupabase = ({
    user = { id: 'teacher-1', email: 'teacher@example.com' },
    role = 'teacher',
    assigned = false,
}: {
    user?: { id: string; email: string } | null;
    role?: string | null;
    assigned?: boolean;
} = {}) => {
    const tableCalls: string[] = [];
    const profileQuery = makeQuery({
        singleResult: { data: role ? { role } : null, error: null },
    });
    const assignmentQuery = makeQuery({
        singleResult: { data: assigned ? { id: 'assignment-1' } : null, error: null },
    });

    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            tableCalls.push(table);
            if (table === 'profiles') return profileQuery.chain;
            if (table === 'student_teachers') return assignmentQuery.chain;
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { supabase, tableCalls, profileQuery, assignmentQuery };
};

const setSupabaseClients = async (mockSupabase: unknown, mockAdmin: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(mockAdmin as any);
};

describe('GET /api/calendar/available-slots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('returns 401 when user is not authenticated', async () => {
        const { supabase } = makeSupabase({ user: null });
        const admin = { rpc: vi.fn() };
        await setSupabaseClients(supabase, admin);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 'teacher-1', date: '2026-02-18' }) as any);

        expect(response.status).toBe(401);
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('forbids teachers from querying another teacher availability', async () => {
        const { supabase } = makeSupabase({
            user: { id: 'teacher-1', email: 'teacher@example.com' },
            role: 'teacher',
        });
        const admin = { rpc: vi.fn() };
        await setSupabaseClients(supabase, admin);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 'teacher-2', date: '2026-02-18' }) as any);

        expect(response.status).toBe(403);
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('allows teachers to query their own availability', async () => {
        const slots = [{ slot_start: '2026-02-18T09:00:00Z', slot_end: '2026-02-18T09:50:00Z' }];
        const { supabase } = makeSupabase({
            user: { id: 'teacher-1', email: 'teacher@example.com' },
            role: 'teacher',
        });
        const admin = { rpc: vi.fn().mockResolvedValue({ data: slots, error: null }) };
        await setSupabaseClients(supabase, admin);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 'teacher-1', date: '2026-02-18' }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots });
        expect(admin.rpc).toHaveBeenCalledWith('get_available_slots', {
            p_teacher_id: 'teacher-1',
            p_date: '2026-02-18',
            p_duration_minutes: 50,
        });
    });

    it('forbids students from querying unassigned teachers', async () => {
        const { supabase } = makeSupabase({
            user: { id: 'student-1', email: 'student@example.com' },
            role: 'student',
            assigned: false,
        });
        const admin = { rpc: vi.fn() };
        await setSupabaseClients(supabase, admin);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 'teacher-1', date: '2026-02-18' }) as any);

        expect(response.status).toBe(403);
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('allows students to query assigned teachers', async () => {
        const slots = [{ slot_start: '2026-02-18T10:00:00Z', slot_end: '2026-02-18T10:50:00Z' }];
        const { supabase } = makeSupabase({
            user: { id: 'student-1', email: 'student@example.com' },
            role: 'student',
            assigned: true,
        });
        const admin = { rpc: vi.fn().mockResolvedValue({ data: slots, error: null }) };
        await setSupabaseClients(supabase, admin);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 'teacher-1', date: '2026-02-18' }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots });
        expect(admin.rpc).toHaveBeenCalled();
    });

    it('allows admins to query any teacher availability', async () => {
        const { supabase } = makeSupabase({
            user: { id: 'admin-1', email: 'admin@example.com' },
            role: 'admin',
        });
        const admin = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
        await setSupabaseClients(supabase, admin);

        const { GET } = await import('../../src/pages/api/calendar/available-slots');
        const response = await GET(makeContext({ teacherId: 'teacher-2', date: '2026-02-18' }) as any);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenCalledWith('get_available_slots', expect.objectContaining({
            p_teacher_id: 'teacher-2',
        }));
    });
});
