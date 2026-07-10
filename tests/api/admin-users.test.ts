import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = () => ({
    request: {
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/admin/users',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

function profileRoleQuery(role: string | null) {
    return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
    };
}

function listQuery(data: unknown[] | null, error: unknown = null) {
    const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data, error }),
    };
    return query;
}

function makeSupabase({
    user = { id: 'admin-1', email: 'admin@example.com' },
    role = 'admin',
    teachers = [],
    teachersError = null,
    students = [],
    studentsError = null,
}: {
    user?: { id: string; email: string } | null;
    role?: string | null;
    teachers?: unknown[];
    teachersError?: unknown;
    students?: unknown[];
    studentsError?: unknown;
} = {}) {
    const roleQuery = profileRoleQuery(role);
    const teachersQuery = listQuery(teachers, teachersError);
    const studentsQuery = listQuery(students, studentsError);
    const queryQueue = [roleQuery, teachersQuery, studentsQuery];
    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn(() => {
            const query = queryQueue.shift();
            if (!query) throw new Error('Unexpected Supabase query');
            return query;
        }),
    };

    return { supabase, roleQuery, teachersQuery, studentsQuery };
}

async function setSupabase(mockSupabase: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
}

describe('GET /api/admin/users', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('returns 401 when the user is not authenticated', async () => {
        const { supabase } = makeSupabase({ user: null });
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);

        expect(response.status).toBe(401);
        expect(supabase.from).not.toHaveBeenCalled();
    });

    it('returns 403 before listing users when the current profile is not admin', async () => {
        const { supabase } = makeSupabase({ role: 'teacher' });
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);

        expect(response.status).toBe(403);
        expect(supabase.from).toHaveBeenCalledTimes(1);
    });

    it('returns 500 when the teacher list cannot be read', async () => {
        const { supabase } = makeSupabase({ teachersError: { message: 'database offline' } });
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(500);
        expect(body.error).toBe('Error fetching teachers');
    });

    it('formats teachers, active subscriptions and primary teachers for the admin matcher', async () => {
        const teacher = { id: 'teacher-1', full_name: 'Ana Profesora', email: 'ana@example.com' };
        const student = {
            id: 'student-1',
            full_name: 'Marta Garcia',
            email: 'marta@example.com',
            created_at: '2026-06-01T10:00:00.000Z',
            subscriptions: [
                { id: 'sub-old', status: 'canceled', sessions_total: 4, sessions_used: 4, package: { name: 'old', display_name: null } },
                { id: 'sub-active', status: 'active', sessions_total: 8, sessions_used: 3, package: { name: 'intensive', display_name: { es: 'Intensivo' } } },
            ],
            assigned_teachers: [
                { teacher: { id: 'teacher-1', full_name: 'Ana Profesora' } },
            ],
        };
        const { supabase, teachersQuery, studentsQuery } = makeSupabase({
            teachers: [teacher],
            students: [student],
        });
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(teachersQuery.eq).toHaveBeenCalledWith('role', 'teacher');
        expect(studentsQuery.eq).toHaveBeenCalledWith('role', 'student');
        expect(body.teachers).toEqual([teacher]);
        expect(body.students).toEqual([
            {
                id: 'student-1',
                fullName: 'Marta Garcia',
                email: 'marta@example.com',
                createdAt: '2026-06-01T10:00:00.000Z',
                activeSubscription: student.subscriptions[1],
                primaryTeacher: { id: 'teacher-1', full_name: 'Ana Profesora' },
            },
        ]);
    });
});
