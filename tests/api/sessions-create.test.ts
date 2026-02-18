import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/google/drive', () => ({
    createClassDocument: vi.fn().mockResolvedValue(null),
    getFileLink: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/google/calendar', () => ({
    createClassEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/email', () => ({
    sendClassConfirmationToBoth: vi.fn().mockResolvedValue(undefined),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/calendar/sessions',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

const mockNewSession = {
    id: 'session-new',
    student_id: 'student-1',
    teacher_id: 'teacher-1',
    scheduled_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    duration_minutes: 60,
    status: 'scheduled',
    meet_link: null,
    student: { id: 'student-1', full_name: 'Student', email: 'student@test.com' },
    teacher: { id: 'teacher-1', full_name: 'Teacher', email: 'teacher@test.com' },
};

describe('POST /api/calendar/sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 403 when role is student', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);
        expect(response.status).toBe(403);
    });

    it('returns 400 when student has no active subscription', async () => {
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;
        mockSupabase.from = vi.fn((_table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                // profiles — teacher
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else {
                // subscriptions — null (no active sub)
                chain.single.mockResolvedValue({ data: null, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('subscription');
    });

    it('returns 400 when sessions_used >= sessions_total (quota exhausted)', async () => {
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;
        mockSupabase.from = vi.fn((_table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else {
                // Subscription with quota exhausted
                chain.single.mockResolvedValue({
                    data: { id: 'sub-1', sessions_used: 8, sessions_total: 8 },
                    error: null,
                });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);
        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('sessions remaining');
    });

    it('returns 201 and session data when everything is valid', async () => {
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;
        mockSupabase.from = vi.fn((_table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                // profiles
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else if (callCount === 2) {
                // subscription — valid
                chain.single.mockResolvedValue({
                    data: { id: 'sub-1', sessions_used: 2, sessions_total: 8 },
                    error: null,
                });
            } else if (callCount === 3) {
                // conflict check (no .single() used, just chain)
                chain.single.mockResolvedValue({ data: [], error: null });
            } else if (callCount === 4) {
                // insert session
                chain.single.mockResolvedValue({ data: mockNewSession, error: null });
            } else {
                // subscription update, profiles lookups for background task, etc.
                chain.single.mockResolvedValue({ data: null, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.session).toBeDefined();
        expect(body.session.id).toBe('session-new');
    });

    it('increments sessions_used on the subscription after creating session', async () => {
        const subscriptionUpdateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        let callCount = 0;

        mockSupabase.from = vi.fn((table: string) => {
            callCount++;
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn((data: any) => {
                    if (table === 'subscriptions') subscriptionUpdateMock(data);
                    return chain;
                }),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (callCount === 1) {
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else if (callCount === 2) {
                chain.single.mockResolvedValue({
                    data: { id: 'sub-1', sessions_used: 3, sessions_total: 8 },
                    error: null,
                });
            } else if (callCount === 4) {
                chain.single.mockResolvedValue({ data: mockNewSession, error: null });
            } else {
                chain.single.mockResolvedValue({ data: null, error: null });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);

        // sessions_used was 3, should now be 4
        expect(subscriptionUpdateMock).toHaveBeenCalledWith({ sessions_used: 4 });
    });
});
