import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({
        from: vi.fn().mockReturnValue({
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gt: vi.fn().mockResolvedValue({ error: null }),
            select: vi.fn().mockResolvedValue({ data: [{ id: 'sub-1' }], error: null }),
        }),
    })),
}));

const crmMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn().mockResolvedValue({ status: 'created' }),
}));

const onboardingMocks = vi.hoisted(() => ({
    recordFirstClassCancelledSafe: vi.fn().mockResolvedValue({ status: 'recorded' }),
    recordFirstClassCompletedSafe: vi.fn().mockResolvedValue({ status: 'recorded' }),
    recordNoShowFollowUpSafe: vi.fn().mockResolvedValue({ status: 'recorded' }),
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    recordCrmActivityForProfileSafe: crmMocks.recordCrmActivityForProfileSafe,
}));

vi.mock('../../src/lib/crm/onboarding', () => ({
    recordFirstClassCancelledSafe: onboardingMocks.recordFirstClassCancelledSafe,
    recordFirstClassCompletedSafe: onboardingMocks.recordFirstClassCompletedSafe,
    recordNoShowFollowUpSafe: onboardingMocks.recordNoShowFollowUpSafe,
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    triggerFulfillmentProcessing: vi.fn(),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/calendar/session-action',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

const makeInvalidJsonContext = () => ({
    request: {
        json: vi.fn().mockRejectedValue(new Error('bad json')),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/calendar/session-action',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

describe('POST /api/calendar/session-action', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        onboardingMocks.recordFirstClassCancelledSafe.mockResolvedValue({ status: 'recorded' });
        onboardingMocks.recordFirstClassCompletedSafe.mockResolvedValue({ status: 'recorded' });
        onboardingMocks.recordNoShowFollowUpSafe.mockResolvedValue({ status: 'recorded' });
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

    it('returns 400 for invalid JSON', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeInvalidJsonContext() as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
    });

    it('returns 400 for invalid actions before loading session data', async () => {
        const mockSupabase = createMockSupabaseClient();
        const fromMock = vi.fn((table: string) => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        }));
        mockSupabase.from = fromMock as any;
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({ sessionId: 'session-1', action: 'delete' }) as any);

        expect(response.status).toBe(400);
        expect(fromMock).not.toHaveBeenCalledWith('sessions');
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

    it('blocks student cancellations with less than 24 hours notice before updating the session', async () => {
        const mockUser = { id: 'student-id', email: 'student@test.com' };
        const mockSession = {
            id: 'session-1',
            student_id: 'student-id',
            teacher_id: 'teacher-id',
            status: 'scheduled',
            scheduled_at: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
            subscription: { id: 'sub-1', sessions_used: 2 },
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
                update: sessionsUpdateMock,
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
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body.error).toBe('Student cancellations require at least 24 hours notice.');
        expect(sessionsUpdateMock).not.toHaveBeenCalled();
        expect(crmMocks.recordCrmActivityForProfileSafe).not.toHaveBeenCalled();
        expect(onboardingMocks.recordFirstClassCancelledSafe).not.toHaveBeenCalled();
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
            // Make chain thenable to simulate Supabase resolving an array for the update query
            chain.then = vi.fn((resolve) => resolve({ data: [{ id: 'session-1' }], error: null }));
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
        expect(body.quotaRestored).toBe(true);
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            profileId: 'student-id',
            email: 'student@test.com',
            activityType: 'class',
            subject: 'Clase cancelada',
            relatedEntityType: 'session_cancelled',
            relatedEntityId: 'session-1',
            metadata: expect.objectContaining({
                quota_restore_attempted: true,
                quota_restored: true,
                previous_sessions_used: 2,
                next_sessions_used: 1,
            }),
        }));
        expect(onboardingMocks.recordFirstClassCancelledSafe).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
            profileId: 'student-id',
            email: 'student@test.com',
            fullName: 'Student',
            subscriptionId: 'sub-1',
            sessionId: 'session-1',
            teacherId: 'teacher-id',
            scheduledAt: mockSession.scheduled_at,
            cancelledAt: expect.any(String),
            cancelledBy: 'student',
            cancellationReason: null,
        }));
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
            chain.then = vi.fn((resolve) => resolve({ data: [{ id: 'session-1' }], error: null }));
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

    it('marks a past session completed and records first-class onboarding activation', async () => {
        const mockUser = { id: 'teacher-id', email: 'teacher@test.com' };
        const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const mockSession = {
            id: 'session-1',
            subscription_id: 'sub-1',
            student_id: 'student-id',
            teacher_id: 'teacher-id',
            status: 'scheduled',
            scheduled_at: scheduledAt,
            subscription: { id: 'sub-1', sessions_used: 1 },
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
            calendar_event_id: 'event-1',
        };
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            },
        });
        const sessionUpdate = vi.fn().mockReturnThis();
        const sessionFetchChain: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        };
        const sessionUpdateChain: any = {
            update: vi.fn((data: unknown) => {
                sessionUpdate(data);
                return sessionUpdateChain;
            }),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ id: 'session-1' }], error: null }),
        };
        let sessionsFromCalls = 0;
        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
                };
            }
            if (table === 'sessions') {
                sessionsFromCalls += 1;
                return sessionsFromCalls === 1 ? sessionFetchChain : sessionUpdateChain;
            }
            throw new Error(`Unexpected table ${table}`);
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
        const supabaseAdmin = {
            from: vi.fn().mockReturnValue({
                insert: vi.fn().mockResolvedValue({ error: null }),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gt: vi.fn().mockResolvedValue({ error: null }),
            }),
        };
        vi.mocked(createSupabaseAdminClient).mockReturnValue(supabaseAdmin as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({
            sessionId: 'session-1',
            action: 'complete',
            report: 'Worked on professional introductions.',
        }) as any);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            completed_at: expect.any(String),
            post_class_report: 'Worked on professional introductions.',
        }));
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(supabaseAdmin, expect.objectContaining({
            profileId: 'student-id',
            email: 'student@test.com',
            activityType: 'class',
            subject: 'Clase completada',
            relatedEntityType: 'session_completed',
            relatedEntityId: 'session-1',
        }));
        expect(onboardingMocks.recordFirstClassCompletedSafe).toHaveBeenCalledWith(supabaseAdmin, expect.objectContaining({
            profileId: 'student-id',
            email: 'student@test.com',
            fullName: 'Student',
            subscriptionId: 'sub-1',
            sessionId: 'session-1',
            teacherId: 'teacher-id',
            scheduledAt,
            completedAt: expect.any(String),
        }));
    });

    it('marks a past session as no_show and creates a shared CRM follow-up task', async () => {
        const mockUser = { id: 'teacher-id', email: 'teacher@test.com' };
        const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const mockSession = {
            id: 'session-1',
            subscription_id: 'sub-1',
            student_id: 'student-id',
            teacher_id: 'teacher-id',
            status: 'scheduled',
            scheduled_at: scheduledAt,
            subscription: { id: 'sub-1', sessions_used: 1 },
            student: { full_name: 'Student', email: 'student@test.com' },
            teacher: { full_name: 'Teacher', email: 'teacher@test.com' },
            calendar_event_id: 'event-1',
        };
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
            },
        });
        const sessionUpdate = vi.fn().mockReturnThis();
        const sessionFetchChain: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
        };
        const sessionUpdateChain: any = {
            update: vi.fn((data: unknown) => {
                sessionUpdate(data);
                return sessionUpdateChain;
            }),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ id: 'session-1' }], error: null }),
        };
        let sessionsFromCalls = 0;
        mockSupabase.from = vi.fn((table: string) => {
            if (table === 'profiles') {
                return {
                    select: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
                };
            }
            if (table === 'sessions') {
                sessionsFromCalls += 1;
                return sessionsFromCalls === 1 ? sessionFetchChain : sessionUpdateChain;
            }
            throw new Error(`Unexpected table ${table}`);
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
        const supabaseAdmin = {
            from: vi.fn().mockReturnValue({
                insert: vi.fn().mockResolvedValue({ error: null }),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gt: vi.fn().mockResolvedValue({ error: null }),
            }),
        };
        vi.mocked(createSupabaseAdminClient).mockReturnValue(supabaseAdmin as any);

        const { POST } = await import('../../src/pages/api/calendar/session-action');
        const response = await POST(makeContext({
            sessionId: 'session-1',
            action: 'no_show',
            notes: 'Student did not join the call.',
        }) as any);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(sessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'no_show',
            teacher_notes: 'Student did not join the call.',
        }));
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(supabaseAdmin, expect.objectContaining({
            profileId: 'student-id',
            email: 'student@test.com',
            activityType: 'class',
            subject: 'Alumno no asistio',
            relatedEntityType: 'session_no_show',
            relatedEntityId: 'session-1',
        }));
        expect(onboardingMocks.recordNoShowFollowUpSafe).toHaveBeenCalledWith(supabaseAdmin, expect.objectContaining({
            profileId: 'student-id',
            email: 'student@test.com',
            fullName: 'Student',
            subscriptionId: 'sub-1',
            sessionId: 'session-1',
            teacherId: 'teacher-id',
            scheduledAt,
            noShowAt: expect.any(String),
        }));
    });
});
