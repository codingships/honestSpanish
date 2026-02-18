import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

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

describe('POST /api/admin/assign-teacher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 400 when studentId is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ teacherId: 'teacher-1' }) as any);
        expect(response.status).toBe(400);
    });

    it('returns 400 when teacherId is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1' }) as any);
        expect(response.status).toBe(400);
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 403 when role is not admin', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);
        expect(response.status).toBe(403);
    });

    it('returns 200 creating a new assignment when none exists', async () => {
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;
        mockSupabase.from = vi.fn((_table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                // profiles — admin role
                chain.single.mockResolvedValue({ data: { role: 'admin' }, error: null });
            } else if (callCount === 2) {
                // student_teachers — no existing assignment
                chain.single.mockResolvedValue({ data: null, error: null });
            } else {
                // insert
                chain.single.mockResolvedValue({ data: {}, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    it('returns 200 updating an existing assignment', async () => {
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;
        mockSupabase.from = vi.fn((_table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                // profiles — admin
                chain.single.mockResolvedValue({ data: { role: 'admin' }, error: null });
            } else if (callCount === 2) {
                // student_teachers — existing assignment found
                chain.single.mockResolvedValue({ data: { id: 'existing-assignment' }, error: null });
            } else {
                chain.single.mockResolvedValue({ data: {}, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1' }) as any);
        expect(response.status).toBe(200);
    });

    it('deactivates previous primary assignments when isPrimary is true', async () => {
        const deactivatePrimaryMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;

        mockSupabase.from = vi.fn((_table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn((data: any) => {
                    if (callCount === 2) deactivatePrimaryMock(data);
                    return chain;
                }),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                // profiles
                chain.single.mockResolvedValue({ data: { role: 'admin' }, error: null });
            } else if (callCount === 3) {
                // existing check
                chain.single.mockResolvedValue({ data: null, error: null });
            } else {
                chain.single.mockResolvedValue({ data: {}, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        await POST(makeContext({ studentId: 'student-1', teacherId: 'teacher-1', isPrimary: true }) as any);

        expect(deactivatePrimaryMock).toHaveBeenCalledWith({ is_primary: false });
    });
});
