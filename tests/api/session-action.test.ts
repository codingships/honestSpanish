import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/google/calendar', () => ({
    cancelClassEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/email', () => ({
    sendClassCancelledToBoth: vi.fn().mockResolvedValue(undefined),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/calendar/session-action',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

describe('POST /api/calendar/session-action', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ sessionId: 'session-1', action: 'cancel' }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 400 when sessionId is missing from body', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ action: 'cancel' }) as any);
        expect(response.status).toBe(400);
    });

    it('returns 400 when action is missing from body', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ sessionId: 'session-1' }) as any);
        expect(response.status).toBe(400);
    });

    it('returns 404 when session is not found', async () => {
        const mockSupabase = createMockSupabaseClient();
        // profiles returns student role, sessions returns null
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'student' }, error: null });
            } else if (table === 'sessions') {
                chain.single.mockResolvedValue({ data: null, error: { message: 'Not found' } });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ sessionId: 'nonexistent', action: 'cancel' }) as any);
        expect(response.status).toBe(404);
    });

    it('returns 403 when user is not owner of the session and not admin', async () => {
        const mockUser = { id: 'other-user-id', email: 'other@test.com' };
        const mockSession = {
            id: 'session-1',
            student_id: 'different-student-id',
            teacher_id: 'different-teacher-id',
            status: 'scheduled',
            subscription: null,
            student: { full_name: 'Other', email: 'other@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
            calendar_event_id: null,
        };

        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'student' }, error: null });
            } else if (table === 'sessions') {
                chain.single.mockResolvedValue({ data: mockSession, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ sessionId: 'session-1', action: 'cancel' }) as any);
        expect(response.status).toBe(403);
    });

    it('returns 200 and success:true when student cancels their own session', async () => {
        const mockUser = { id: 'student-id', email: 'student@test.com' };
        const mockSession = {
            id: 'session-1',
            student_id: 'student-id',
            teacher_id: 'teacher-id',
            status: 'scheduled',
            scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            subscription: { id: 'sub-1', sessions_used: 2 },
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
            calendar_event_id: null,
        };

        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            },
        });

        const updateMock = vi.fn().mockReturnThis();
        const eqMock = vi.fn().mockReturnThis();

        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                update: updateMock,
                eq: eqMock,
                single: vi.fn(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'student' }, error: null });
            } else if (table === 'sessions') {
                chain.single.mockResolvedValue({ data: mockSession, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({ data: null, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ sessionId: 'session-1', action: 'cancel' }) as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    it('calls update with status cancelled on the sessions table', async () => {
        const mockUser = { id: 'student-id', email: 'student@test.com' };
        const mockSession = {
            id: 'session-1',
            student_id: 'student-id',
            teacher_id: 'teacher-id',
            status: 'scheduled',
            scheduled_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            subscription: null,
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
            calendar_event_id: null,
        };

        const sessionsUpdateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            },
        });

        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                update: vi.fn((data: any) => {
                    if (table === 'sessions') sessionsUpdateMock(data);
                    return chain;
                }),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'student' }, error: null });
            } else if (table === 'sessions') {
                chain.single.mockResolvedValue({ data: mockSession, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        await POST(makeContext({ sessionId: 'session-1', action: 'cancel' }) as any);

        expect(sessionsUpdateMock).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'cancelled' })
        );
    });
});
