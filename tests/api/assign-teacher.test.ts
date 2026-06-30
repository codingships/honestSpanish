import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/admin/assign-teacher',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

const makeProfilesQuery = (roleQueue: Array<string | null>) => {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        maybeSingle: vi.fn().mockImplementation(() => {
            const role = roleQueue.shift();
            return Promise.resolve({ data: role ? { role } : null, error: null });
        }),
    };
    return chain;
};

const makeAssignmentQueries = ({
    existingAssignment = null,
    existingError = null,
}: {
    existingAssignment?: { id: string } | null;
    existingError?: { code: string } | null;
} = {}) => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const updateResult = { error: null };
    const updateChain: any = {
        eq: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof updateResult) => unknown) => Promise.resolve(updateResult).then(resolve),
    };
    const update = vi.fn().mockReturnValue(updateChain);
    const readChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: existingAssignment, error: existingError }),
    };
    const writeChain = { insert, update };

    return { readChain, writeChain, insert, update };
};

const makeSupabase = ({
    user = { id: 'admin-1', email: 'admin@example.com' },
    currentRole = 'admin',
    targetRoles = ['student', 'teacher'],
    existingAssignment = null,
}: {
    user?: { id: string; email: string } | null;
    currentRole?: string;
    targetRoles?: Array<string | null>;
    existingAssignment?: { id: string } | null;
} = {}) => {
    const roleQueue = [...targetRoles];
    const profilesQuery = makeProfilesQuery(roleQueue);
    profilesQuery.single.mockResolvedValue({ data: { role: currentRole }, error: null });
    const assignment = makeAssignmentQueries({ existingAssignment });
    let studentTeachersCalls = 0;

    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table === 'profiles') return profilesQuery;
            if (table === 'student_teachers') {
                studentTeachersCalls += 1;
                return studentTeachersCalls === 1 ? assignment.readChain : assignment.writeChain;
            }
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { supabase, profilesQuery, assignment };
};

const setSupabase = async (mockSupabase: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
};

describe('POST /api/admin/assign-teacher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('returns 401 when user is not authenticated', async () => {
        const { supabase } = makeSupabase({ user: null });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);

        expect(response.status).toBe(401);
    });

    it('returns 403 when current user is not admin', async () => {
        const { supabase } = makeSupabase({ currentRole: 'teacher' });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);

        expect(response.status).toBe(403);
    });

    it('returns 400 when studentId or teacherId is missing', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');

        await expect(POST(makeContext({ teacherId: 'teacher-1' }) as any)).resolves.toMatchObject({ status: 400 });
        await expect(POST(makeContext({ studentId: 'student-1' }) as any)).resolves.toMatchObject({ status: 400 });
    });

    it('rejects a studentId that does not belong to a student profile', async () => {
        const { supabase, assignment } = makeSupabase({ targetRoles: ['teacher', 'teacher'] });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'teacher-acting-as-student', teacherId: 'teacher-1' }) as any);

        expect(response.status).toBe(400);
        expect(assignment.insert).not.toHaveBeenCalled();
        expect(assignment.update).not.toHaveBeenCalled();
    });

    it('rejects a teacherId that does not belong to a teacher profile', async () => {
        const { supabase, assignment } = makeSupabase({ targetRoles: ['student', 'student'] });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'student-acting-as-teacher' }) as any);

        expect(response.status).toBe(400);
        expect(assignment.insert).not.toHaveBeenCalled();
        expect(assignment.update).not.toHaveBeenCalled();
    });

    it('creates a primary assignment for a real student and teacher', async () => {
        const { supabase, assignment } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);

        expect(response.status).toBe(200);
        expect(assignment.insert).toHaveBeenCalledWith({
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            is_primary: true,
        });
    });

    it('updates the existing primary assignment for a real student and teacher', async () => {
        const { supabase, assignment } = makeSupabase({
            existingAssignment: { id: 'assignment-1' },
        });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-2' }) as any);

        expect(response.status).toBe(200);
        expect(assignment.update).toHaveBeenCalledWith(expect.objectContaining({
            teacher_id: 'teacher-2',
        }));
    });
});
