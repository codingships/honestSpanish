import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const crmMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn().mockResolvedValue({ status: 'created' }),
}));

const onboardingMocks = vi.hoisted(() => ({
    recordFirstClassScheduledSafe: vi.fn().mockResolvedValue({ status: 'recorded' }),
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    recordCrmActivityForProfileSafe: crmMocks.recordCrmActivityForProfileSafe,
}));

vi.mock('../../src/lib/crm/onboarding', () => ({
    recordFirstClassScheduledSafe: onboardingMocks.recordFirstClassScheduledSafe,
}));

vi.mock('../../src/lib/google/drive', () => ({
    createClassDocument: vi.fn().mockResolvedValue(null),
    getFileLink: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    checkTeacherAvailabilityViaInternalService: vi.fn().mockResolvedValue(true),
    isInternalJobServiceConfigured: vi.fn().mockReturnValue(true),
    triggerFulfillmentProcessing: vi.fn(),
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

const setSupabaseClients = async (mockSupabase: unknown, mockAdmin = mockSupabase) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
    vi.mocked(createSupabaseAdminClient).mockReturnValue(mockAdmin as any);
};

const mockNewSession = {
    id: 'session-new',
    student_id: 'student-1',
    teacher_id: 'teacher-1',
    scheduled_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    duration_minutes: 50,
    status: 'scheduled',
    meet_link: null,
    student: { id: 'student-1', full_name: 'Student', email: 'student@test.com' },
    teacher: { id: 'teacher-1', full_name: 'Teacher', email: 'teacher@test.com' },
};

const availabilitySlotFor = (scheduledAt: string, durationMinutes = 50) => ({
    slot_start: scheduledAt,
    slot_end: new Date(new Date(scheduledAt).getTime() + durationMinutes * 60000).toISOString(),
});

describe('POST /api/calendar/sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        onboardingMocks.recordFirstClassScheduledSafe.mockResolvedValue({ status: 'recorded' });
        vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
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
        await setSupabaseClients(mockSupabase);

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
        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);
        expect(response.status).toBe(403);
    });

    it('returns 400 when admin scheduling does not provide teacherId', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        });
        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('teacherId');
    });

    it('returns 400 when admin scheduling targets a non-teacher profile', async () => {
        const mockSupabase = createMockSupabaseClient();
        const roleQueue = ['student', 'student'];
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({
                    data: { role: roleQueue.shift() },
                    error: null,
                })),
            };
            if (table !== 'profiles') {
                throw new Error(`Unexpected table ${table}`);
            }
            return chain;
        });
        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            teacherId: 'student-acting-as-teacher',
            scheduledAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        }) as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain('teacherId must belong to a teacher profile');
    });

    it('returns 400 when student has no active subscription', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn((table: string) => {
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
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({ data: null, error: null });
            }
            return chain;
        });

        await setSupabaseClients(mockSupabase);

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
        mockSupabase.from = vi.fn((table: string) => {
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
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({
                    data: { id: 'sub-1', sessions_used: 8, sessions_total: 8 },
                    error: null,
                });
            }
            return chain;
        });

        await setSupabaseClients(mockSupabase);

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
        const scheduledAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: [availabilitySlotFor(scheduledAt)],
            error: null,
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
                lt: vi.fn()
            };

            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'teacher@test.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single = vi.fn().mockImplementation(() => {
                    // optimisitc lock check vs get active sub
                    return Promise.resolve({
                        data: { id: 'sub-1', sessions_used: 2, sessions_total: 8 },
                        error: null,
                    });
                });
            } else if (table === 'sessions') {
                // Para el conflict check:
                chain.lt.mockResolvedValue({ data: [], error: null });
                // Para el insert select single:
                chain.single.mockResolvedValue({ data: mockNewSession, error: null });
            }

            return chain;
        });

        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt,
        }) as any);

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.session).toBeDefined();
        expect(body.session.id).toBe('session-new');
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(mockSupabase, expect.objectContaining({
            profileId: 'student-1',
            email: 'student@test.com',
            activityType: 'class',
            subject: 'Clase programada',
            relatedEntityType: 'session_scheduled',
            relatedEntityId: 'session-new',
        }));
        expect(onboardingMocks.recordFirstClassScheduledSafe).not.toHaveBeenCalled();
        expect(mockSupabase.rpc).toHaveBeenCalledWith('get_available_slots', expect.objectContaining({
            p_teacher_id: 'test-user-id',
            p_duration_minutes: 50,
        }));
    });

    it('records first-class onboarding only when the subscription has no used sessions yet', async () => {
        const scheduledAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: [availabilitySlotFor(scheduledAt)],
            error: null,
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
                lt: vi.fn(),
            };

            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'teacher@test.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({
                    data: { id: 'sub-1', sessions_used: 0, sessions_total: 8 },
                    error: null,
                });
            } else if (table === 'sessions') {
                chain.lt.mockResolvedValue({ data: [], error: null });
                chain.single.mockResolvedValue({ data: mockNewSession, error: null });
            }

            return chain;
        });

        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt,
        }) as any);

        expect(response.status).toBe(201);
        expect(onboardingMocks.recordFirstClassScheduledSafe).toHaveBeenCalledWith(mockSupabase, expect.objectContaining({
            profileId: 'student-1',
            email: 'student@test.com',
            fullName: 'Student',
            subscriptionId: 'sub-1',
            sessionId: 'session-new',
            teacherId: 'teacher-1',
            scheduledAt: mockNewSession.scheduled_at,
        }));
    });

    it('returns 409 when the requested time is outside teacher availability', async () => {
        const scheduledAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const mockSupabase = createMockSupabaseClient();
        const insertMock = vi.fn().mockReturnThis();
        mockSupabase.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: insertMock,
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lte: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
                lt: vi.fn(),
            };

            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'teacher@test.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({
                    data: { id: 'sub-1', sessions_used: 2, sessions_total: 8 },
                    error: null,
                });
            } else if (table === 'sessions') {
                chain.lt.mockResolvedValue({ data: [], error: null });
                chain.single.mockResolvedValue({ data: mockNewSession, error: null });
            }

            return chain;
        });

        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            scheduledAt,
        }) as any);
        const body = await response.json();

        expect(response.status).toBe(409);
        expect(body.error).toContain('outside teacher availability');
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('increments sessions_used on the subscription after creating session', async () => {
        const scheduledAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        const subscriptionUpdateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.rpc = vi.fn().mockResolvedValue({
            data: [availabilitySlotFor(scheduledAt)],
            error: null,
        });
        mockSupabase.from = vi.fn((table: string) => {
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
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
                lt: vi.fn()
            };

            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'teacher@test.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single = vi.fn().mockImplementation(() => {
                    return Promise.resolve({
                        data: { id: 'sub-1', sessions_used: 3, sessions_total: 8 },
                        error: null,
                    });
                });
            } else if (table === 'sessions') {
                chain.lt.mockResolvedValue({ data: [], error: null });
                chain.single.mockResolvedValue({ data: mockNewSession, error: null });
            }

            return chain;
        });

        await setSupabaseClients(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/sessions');
        await POST(makeContext({
            studentId: 'student-1',
            scheduledAt,
        }) as any);

        // sessions_used was 3, should now be 4
        expect(subscriptionUpdateMock).toHaveBeenCalledWith({ sessions_used: 4 });
    });
});
