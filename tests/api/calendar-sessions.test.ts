import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('GET /api/calendar/sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should return 401 if user is not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockContext = {
            request: { url: 'http://localhost:4321/api/calendar/sessions' },
            cookies: { set: vi.fn() },
        };

        const { GET } = await import('../../src/pages/api/calendar/sessions');
        const response = await GET(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should filter sessions by student_id for student role', async () => {
        const mockSessions = [
            { id: 'session-1', student_id: 'test-user-id', scheduled_at: '2026-01-15T10:00:00Z' }
        ];

        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
                };
            }
            if (table === 'sessions') {
                // sessions API calls: from().select().order().eq()
                const chainable = {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    then: vi.fn((resolve) => resolve({ data: mockSessions, error: null })),
                };
                return chainable;
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: { url: 'http://localhost:4321/api/calendar/sessions' },
            cookies: { set: vi.fn() },
        };

        const { GET } = await import('../../src/pages/api/calendar/sessions');
        const response = await GET(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.sessions).toBeDefined();
    });

    it('should filter sessions by teacher_id for teacher role', async () => {
        const mockSessions = [
            { id: 'session-1', teacher_id: 'test-user-id', scheduled_at: '2026-01-15T10:00:00Z' }
        ];

        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
                };
            }
            if (table === 'sessions') {
                // sessions API calls: from().select().order().eq()
                const chainable = {
                    select: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    then: vi.fn((resolve) => resolve({ data: mockSessions, error: null })),
                };
                return chainable;
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: { url: 'http://localhost:4321/api/calendar/sessions' },
            cookies: { set: vi.fn() },
        };

        const { GET } = await import('../../src/pages/api/calendar/sessions');
        const response = await GET(mockContext as any);

        expect(response.status).toBe(200);
    });

    it('should return all sessions for admin role', async () => {
        const mockSessions = [
            { id: 'session-1', student_id: 'student-1', teacher_id: 'teacher-1' },
            { id: 'session-2', student_id: 'student-2', teacher_id: 'teacher-2' }
        ];

        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                };
            }
            if (table === 'sessions') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    lte: vi.fn().mockReturnThis(),
                    order: vi.fn().mockResolvedValue({ data: mockSessions, error: null }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: { url: 'http://localhost:4321/api/calendar/sessions' },
            cookies: { set: vi.fn() },
        };

        const { GET } = await import('../../src/pages/api/calendar/sessions');
        const response = await GET(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.sessions).toBeDefined();
    });
});

describe('POST /api/calendar/sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should return 401 if not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockContext = {
            request: {
                url: 'http://localhost:4321/api/calendar/sessions',
                json: vi.fn().mockResolvedValue({ studentId: 'student-1', scheduledAt: '2026-01-20T10:00:00Z' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should return 403 if user is student (not teacher or admin)', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                url: 'http://localhost:4321/api/calendar/sessions',
                json: vi.fn().mockResolvedValue({ studentId: 'student-1', scheduledAt: '2026-01-20T10:00:00Z' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(403);
    });

    it('should return 400 if studentId is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                url: 'http://localhost:4321/api/calendar/sessions',
                json: vi.fn().mockResolvedValue({ scheduledAt: '2026-01-20T10:00:00Z' }), // No studentId
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('required');
    });

    it('should return 400 if scheduledAt is missing', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                url: 'http://localhost:4321/api/calendar/sessions',
                json: vi.fn().mockResolvedValue({ studentId: 'student-1' }), // No scheduledAt
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
    });

    it('should return 400 if student has no active subscription', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockImplementation((table) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
                };
            }
            if (table === 'subscriptions') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    gte: vi.fn().mockReturnThis(),
                    order: vi.fn().mockReturnThis(),
                    limit: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: null, error: null }), // No subscription
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                url: 'http://localhost:4321/api/calendar/sessions',
                json: vi.fn().mockResolvedValue({
                    studentId: 'student-1',
                    scheduledAt: '2026-01-20T10:00:00Z'
                }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('subscription');
    });
});
