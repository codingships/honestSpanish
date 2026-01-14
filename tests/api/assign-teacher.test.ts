import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('POST /api/admin/assign-teacher', () => {
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

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
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

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should return 403 if user is not admin', async () => {
        const mockSupabase = createMockSupabaseClient();
        // Override to return non-admin role
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
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

        const { POST } = await import('../../src/pages/api/admin/assign-teacher');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(403);
    });
});
