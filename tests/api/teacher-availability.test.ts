import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = ({
    method = 'GET',
    searchParams = {},
    body = {},
}: {
    method?: string;
    searchParams?: Record<string, string>;
    body?: Record<string, unknown>;
} = {}) => {
    const url = new URL('http://localhost:4321/api/teacher/availability');
    Object.entries(searchParams).forEach(([key, value]) => url.searchParams.set(key, value));

    return {
        request: {
            method,
            url: url.toString(),
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn().mockReturnValue('') },
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
};

const makeThenableChain = <T,>(result: T) => {
    const eqCalls: Array<[string, unknown]> = [];
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
        }),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        maybeSingle: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: T) => unknown) => Promise.resolve(result).then(resolve),
    };

    return { chain, eqCalls };
};

const makeSupabase = ({
    user = { id: 'admin-1', email: 'admin@example.com' },
    currentRole = 'admin',
    targetRole = 'teacher',
    availability = [{ id: 'slot-1' }],
}: {
    user?: { id: string; email: string } | null;
    currentRole?: string;
    targetRole?: string | null;
    availability?: Array<Record<string, unknown>>;
} = {}) => {
    const availabilityQuery = makeThenableChain({ data: availability, error: null });
    const profileRoleQueue = [currentRole, targetRole];
    const teacherAvailabilityCalls = [availabilityQuery.chain];

    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table === 'profiles') {
                const role = profileRoleQueue.shift();
                return makeThenableChain({ data: role ? { role } : null, error: null }).chain;
            }
            if (table === 'teacher_availability') {
                return teacherAvailabilityCalls.shift() ?? availabilityQuery.chain;
            }
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { supabase, availabilityQuery };
};

const setSupabase = async (mockSupabase: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
};

describe('/api/teacher/availability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('requires teacherId when admin queries availability', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/teacher/availability');
        const response = await GET(makeContext() as any);

        expect(response.status).toBe(400);
    });

    it('rejects admin availability query for a non-teacher profile', async () => {
        const { supabase } = makeSupabase({ targetRole: 'student' });
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/teacher/availability');
        const response = await GET(makeContext({ searchParams: { teacherId: 'student-1' } }) as any);

        expect(response.status).toBe(400);
    });

    it('allows admin to query a real teacher availability', async () => {
        const { supabase, availabilityQuery } = makeSupabase();
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/teacher/availability');
        const response = await GET(makeContext({ searchParams: { teacherId: 'teacher-1' } }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ availability: [{ id: 'slot-1' }] });
        expect(availabilityQuery.eqCalls).toContainEqual(['teacher_id', 'teacher-1']);
    });

    it('rejects admin availability changes for a non-teacher profile', async () => {
        const { supabase, availabilityQuery } = makeSupabase({ targetRole: 'student' });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/teacher/availability');
        const response = await POST(makeContext({
            method: 'POST',
            body: { teacherId: 'student-1', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
        }) as any);

        expect(response.status).toBe(400);
        expect(availabilityQuery.chain.insert).not.toHaveBeenCalled();
    });

    it('allows a teacher to create only their own availability even if a teacherId is supplied', async () => {
        const { supabase, availabilityQuery } = makeSupabase({
            user: { id: 'teacher-1', email: 'teacher@example.com' },
            currentRole: 'teacher',
            targetRole: null,
        });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/teacher/availability');
        const response = await POST(makeContext({
            method: 'POST',
            body: { teacherId: 'teacher-2', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
        }) as any);

        expect(response.status).toBe(201);
        expect(availabilityQuery.chain.insert).toHaveBeenCalledWith(expect.objectContaining({
            teacher_id: 'teacher-1',
        }));
    });
});
