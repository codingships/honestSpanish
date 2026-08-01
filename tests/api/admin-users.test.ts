import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLatestCheckoutV2Progress } from '../../src/lib/checkout-v2-progress';
import { createSupabaseAdminClient } from '../../src/lib/supabase-admin';

vi.mock('../../src/lib/checkout-v2-progress', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/checkout-v2-progress')>(
        '../../src/lib/checkout-v2-progress',
    );
    return {
        ...actual,
        loadLatestCheckoutV2Progress: vi.fn(),
    };
});

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

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
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data, error }),
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
    teacherPages,
    studentPages,
}: {
    user?: { id: string; email: string } | null;
    role?: string | null;
    teachers?: unknown[];
    teachersError?: unknown;
    students?: unknown[];
    studentsError?: unknown;
    teacherPages?: unknown[][];
    studentPages?: unknown[][];
} = {}) {
    const roleQuery = profileRoleQuery(role);
    const teacherQueries = (teacherPages ?? [teachers])
        .map((page, index) => listQuery(page, index === 0 ? teachersError : null));
    const studentQueries = (studentPages ?? [students])
        .map((page, index) => listQuery(page, index === 0 ? studentsError : null));
    const teachersQuery = teacherQueries[0];
    const studentsQuery = studentQueries[0];
    const queryQueue = [roleQuery, ...teacherQueries, ...studentQueries];
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

    return { supabase, roleQuery, teachersQuery, studentsQuery, teacherQueries, studentQueries };
}

async function setSupabase(mockSupabase: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
}

describe('GET /api/admin/users', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createSupabaseAdminClient).mockReturnValue({} as never);
        vi.mocked(loadLatestCheckoutV2Progress).mockResolvedValue(new Map());
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
                { id: 'sub-old', status: 'canceled', sessions_total: 4, contract_schema_version: 2, package: { name: 'old', display_name: null } },
                { id: 'sub-active', status: 'active', sessions_total: 4, contract_schema_version: 2, package: { name: 'individual', display_name: { es: 'Individual' } } },
            ],
            assigned_teachers: [
                { teacher: { id: 'teacher-1', full_name: 'Ana Profesora' } },
            ],
        };
        const { supabase, teachersQuery, studentsQuery } = makeSupabase({
            teachers: [teacher],
            students: [student],
        });
        vi.mocked(loadLatestCheckoutV2Progress).mockResolvedValue(new Map([
            ['sub-active', {
                subscription_id: 'sub-active',
                progress_state: 'ready',
                sessions_consumed: 1,
                sessions_total: 4,
            } as never],
        ]));
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(teachersQuery.eq).toHaveBeenCalledWith('role', 'teacher');
        expect(studentsQuery.eq).toHaveBeenCalledWith('role', 'student');
        expect(body.teachers).toEqual([teacher]);
        expect(loadLatestCheckoutV2Progress).toHaveBeenCalledWith(expect.anything(), ['sub-active']);
        expect(body.students).toEqual([
            {
                id: 'student-1',
                fullName: 'Marta Garcia',
                email: 'marta@example.com',
                createdAt: '2026-06-01T10:00:00.000Z',
                activeSubscription: {
                    ...student.subscriptions[1],
                    academicProgress: {
                        state: 'ready',
                        consumedSessions: 1,
                        sessionsTotal: 4,
                    },
                },
                primaryTeacher: { id: 'teacher-1', full_name: 'Ana Profesora' },
            },
        ]);
    });

    it('reads every student page instead of silently stopping at the PostgREST row cap', async () => {
        const student = (index: number) => ({
            id: `student-${index}`,
            full_name: `Student ${index}`,
            email: `student-${index}@example.com`,
            created_at: '2026-06-01T10:00:00.000Z',
            subscriptions: [],
            assigned_teachers: [],
        });
        const firstPage = Array.from({ length: 500 }, (_, index) => student(index));
        const secondPage = [student(500)];
        const { supabase, studentQueries } = makeSupabase({
            studentPages: [firstPage, secondPage],
        });
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body.students).toHaveLength(501);
        expect(studentQueries[0].order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
        expect(studentQueries[0].order).toHaveBeenNthCalledWith(2, 'id', { ascending: true });
        expect(studentQueries[0].range).toHaveBeenCalledWith(0, 499);
        expect(studentQueries[1].range).toHaveBeenCalledWith(500, 999);
    });

    it('returns 503 instead of fabricating progress when the canonical view fails', async () => {
        const student = {
            id: 'student-1',
            full_name: 'Marta Garcia',
            email: 'marta@example.com',
            created_at: '2026-06-01T10:00:00.000Z',
            subscriptions: [{
                id: 'sub-active',
                status: 'active',
                sessions_total: 4,
                contract_schema_version: 2,
                package: { name: 'individual', display_name: null },
            }],
            assigned_teachers: [],
        };
        const { supabase } = makeSupabase({ students: [student] });
        vi.mocked(loadLatestCheckoutV2Progress).mockRejectedValue(new Error('checkout_v2_progress_load_failed'));
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(503);
        expect(body.error).toBe('Error fetching academic progress');
    });

    it('returns 503 when a Checkout V2 subscription has no canonical cycle row', async () => {
        const student = {
            id: 'student-1',
            full_name: 'Marta Garcia',
            email: 'marta@example.com',
            created_at: '2026-06-01T10:00:00.000Z',
            subscriptions: [{
                id: 'sub-active',
                status: 'active',
                sessions_total: 4,
                contract_schema_version: 2,
                package: { name: 'individual', display_name: null },
            }],
            assigned_teachers: [],
        };
        const { supabase } = makeSupabase({ students: [student] });
        vi.mocked(loadLatestCheckoutV2Progress).mockResolvedValue(new Map());
        await setSupabase(supabase);

        const { GET } = await import('../../src/pages/api/admin/users');
        const response = await GET(makeContext() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(503);
        expect(body.error).toBe('Error fetching academic progress');
    });
});
