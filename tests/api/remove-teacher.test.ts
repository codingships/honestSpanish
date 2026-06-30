import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

function makeContext(body: Record<string, unknown>) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/admin/remove-teacher',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
}

function makeInvalidJsonContext() {
    return {
        request: {
            json: vi.fn().mockRejectedValue(new Error('bad json')),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/admin/remove-teacher',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
}

async function setClient(client: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as any);
}

describe('POST /api/admin/remove-teacher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 before parsing JSON when unauthenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const context = makeInvalidJsonContext();
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(context as any);

        expect(response.status).toBe(401);
        expect(context.request.json).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON after admin authorization', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        } as any));
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(makeInvalidJsonContext() as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
    });

    it('trims IDs before deleting the assignment', async () => {
        const deleteQuery = {
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        deleteQuery.eq.mockReturnValue(deleteQuery);
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                };
            }
            if (table === 'student_teachers') {
                return deleteQuery;
            }
            throw new Error(`Unexpected table ${table}`);
        });
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(makeContext({ studentId: ' student-1 ', teacherId: ' teacher-1 ' }) as any);

        expect(response.status).toBe(200);
        expect(deleteQuery.eq).toHaveBeenCalledWith('student_id', 'student-1');
        expect(deleteQuery.eq).toHaveBeenCalledWith('teacher_id', 'teacher-1');
    });
});
