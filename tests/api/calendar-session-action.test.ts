import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('POST /api/calendar/session-action', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    it('should return 401 if not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1', action: 'complete' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should return 400 if sessionId is missing', async () => {
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
                json: vi.fn().mockResolvedValue({ action: 'complete' }), // No sessionId
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
    });

    it('should return 400 if action is missing', async () => {
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
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1' }), // No action
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
    });

    it('should return 404 if session is not found', async () => {
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
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: null, error: null }), // Session not found
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'non-existent', action: 'complete' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(404);
    });

    it('should return 400 if student tries to complete a session (not implemented)', async () => {
        // session-action.ts only implements 'cancel' action
        // 'complete' falls through to 400 Invalid action
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
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: {
                            id: 'session-1',
                            student_id: 'test-user-id',
                            teacher_id: 'teacher-1',
                            scheduled_at: '2026-01-20T10:00:00Z',
                            subscription: { id: 'sub-1', sessions_used: 0 }
                        },
                        error: null
                    }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1', action: 'complete' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('Invalid action');
    });

    it('should return 400 if student tries to mark no_show (not implemented)', async () => {
        // session-action.ts only implements 'cancel' action
        // 'no_show' falls through to 400 Invalid action
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
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: {
                            id: 'session-1',
                            student_id: 'test-user-id',
                            teacher_id: 'teacher-1',
                            subscription: { id: 'sub-1', sessions_used: 0 }
                        },
                        error: null
                    }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1', action: 'no_show' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('Invalid action');
    });

    it('should allow student to cancel session successfully', async () => {
        // Note: session-action.ts does NOT enforce 24h cancellation policy in code
        // It handles any cancel action by updating status and restoring subscription
        const scheduledTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const mockSession = {
            id: 'session-1',
            student_id: 'test-user-id',
            teacher_id: 'teacher-1',
            scheduled_at: scheduledTime.toISOString(),
            subscription: { id: 'sub-1', sessions_used: 1 },
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
        };

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
                return {
                    select: vi.fn().mockReturnThis(),
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockImplementation(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
                        eq: vi.fn().mockResolvedValue({ error: null }),
                    })),
                };
            }
            if (table === 'subscriptions') {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ error: null }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1', action: 'cancel', reason: 'Personal reasons' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    it('should return 400 for invalid action', async () => {
        const mockSession = {
            id: 'session-1',
            student_id: 'student-1',
            teacher_id: 'test-user-id',
            subscription: { id: 'sub-1', sessions_used: 0 }
        };

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
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1', action: 'invalid_action' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('Invalid action');
    });

    it('should allow teacher to cancel session successfully', async () => {
        const mockSession = {
            id: 'session-1',
            student_id: 'student-1',
            teacher_id: 'test-user-id',
            scheduled_at: '2026-01-20T10:00:00Z',
            subscription: { id: 'sub-1', sessions_used: 1 },
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
        };

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
                return {
                    select: vi.fn().mockReturnThis(),
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockImplementation(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
                        eq: vi.fn().mockResolvedValue({ error: null }),
                    })),
                };
            }
            if (table === 'subscriptions') {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ error: null }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({
                    sessionId: 'session-1',
                    action: 'cancel',
                    reason: 'Teacher unavailable'
                }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    it('should allow admin to cancel any session', async () => {
        const mockSession = {
            id: 'session-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            scheduled_at: '2026-01-20T10:00:00Z',
            subscription: { id: 'sub-1', sessions_used: 1 },
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
        };

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
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockImplementation(() => ({
                        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
                        eq: vi.fn().mockResolvedValue({ error: null }),
                    })),
                };
            }
            if (table === 'subscriptions') {
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockResolvedValue({ error: null }),
                };
            }
            return { select: vi.fn().mockReturnThis() };
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockContext = {
            request: {
                json: vi.fn().mockResolvedValue({ sessionId: 'session-1', action: 'cancel' }),
            },
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
    });
});
