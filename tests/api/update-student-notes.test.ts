import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('POST /api/update-student-notes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 if studentId is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ notes: 'Some notes' }), // Missing studentId
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('studentId is required');
    });

    it('should return 401 if user is not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', notes: 'Notes' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should return 403 if user is not teacher or admin', async () => {
        const mockSupabase = createMockSupabaseClient();
        // Override to return student role
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', notes: 'Notes' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(403);
    });

    it('should return 403 if teacher tries to update unassigned student', async () => {
        const mockSupabase = createMockSupabaseClient();
        const callCount = 0;
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
                };
            }
            if (table === 'student_teachers') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: null, error: null }), // No assignment
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', notes: 'Notes' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(403);
    });

    it('should update notes successfully for admin', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockImplementation(() => ({
                        single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                    })),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ studentId: 'student-1', notes: 'Updated notes' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
    });
});
