import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('POST /api/admin/remove-teacher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 if studentId or teacherId is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1' }), // Missing teacherId
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('studentId and teacherId are required');
    });

    it('should return 401 if user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', teacherId: 'teacher-1' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should return 403 if user is not admin', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', teacherId: 'teacher-1' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(403);
    });

    it('should remove assignment successfully for admin', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                };
            }
            if (table === 'student_teachers') {
                return {
                    delete: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockImplementation(() => ({
                        eq: vi.fn().mockResolvedValue({ error: null }),
                    })),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', teacherId: 'teacher-1' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/admin/remove-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });
});
