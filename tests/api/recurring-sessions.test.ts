import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({ from: vi.fn() })),
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

vi.mock('../../src/lib/internal-job-service', () => ({
    checkTeacherAvailabilityViaInternalService: vi.fn().mockResolvedValue(true),
    isInternalJobServiceConfigured: vi.fn().mockReturnValue(true),
    triggerFulfillmentProcessing: vi.fn(),
}));

function makeContext(body: Record<string, unknown>) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/calendar/recurring-sessions',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
}

function makeInvalidJsonContext() {
    return {
        request: {
            json: vi.fn().mockRejectedValue(new Error('bad json')),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/calendar/recurring-sessions',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
}

async function setClient(client: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as any);
}

describe('POST /api/calendar/recurring-sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        onboardingMocks.recordFirstClassScheduledSafe.mockResolvedValue({ status: 'recorded' });
    });

    it('returns 400 for invalid JSON after role authorization', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        } as any));
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/recurring-sessions');
        const response = await POST(makeInvalidJsonContext() as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
    });

    it('does not require teacherId when a teacher schedules their own recurring classes', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
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
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/recurring-sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            dayOfWeek: 2,
            time: '10:00',
            startDate: '2026-10-06',
        }) as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('subscription');
    });

    it('requires teacherId when an admin schedules recurring classes', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        } as any));
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/recurring-sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            dayOfWeek: 2,
            time: '10:00',
            startDate: '2026-10-06',
        }) as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('teacherId');
    });

    it('rejects admin recurring scheduling for a non-teacher profile', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
            },
        });
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
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/recurring-sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            teacherId: 'student-acting-as-teacher',
            dayOfWeek: 2,
            time: '10:00',
            startDate: '2026-10-06',
        }) as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toContain('teacherId must belong to a teacher profile');
    });

    it('records first-class onboarding from the earliest recurring session', async () => {
        vi.stubEnv('E2E_DISABLE_EXTERNAL_INTEGRATIONS', 'true');
        vi.stubEnv('NODE_ENV', 'test');

        const firstScheduledAt = '2026-10-06T08:00:00.000Z';
        const secondScheduledAt = '2026-10-13T08:00:00.000Z';
        const createdSessions = [
            {
                id: 'session-first',
                subscription_id: 'sub-1',
                student_id: 'student-1',
                teacher_id: 'teacher-1',
                scheduled_at: firstScheduledAt,
                duration_minutes: 50,
                status: 'scheduled',
                student: { id: 'student-1', full_name: 'Student One', email: 'student@example.com' },
                teacher: { id: 'teacher-1', full_name: 'Teacher One', email: 'teacher@example.com' },
            },
            {
                id: 'session-second',
                subscription_id: 'sub-1',
                student_id: 'student-1',
                teacher_id: 'teacher-1',
                scheduled_at: secondScheduledAt,
                duration_minutes: 50,
                status: 'scheduled',
                student: { id: 'student-1', full_name: 'Student One', email: 'student@example.com' },
                teacher: { id: 'teacher-1', full_name: 'Teacher One', email: 'teacher@example.com' },
            },
        ];

        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }),
            },
        });
        let sessionsQueryCount = 0;
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: vi.fn().mockReturnThis(),
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                gte: vi.fn().mockReturnThis(),
                lt: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockReturnThis(),
                single: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'student' }, error: null }),
            };

            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'teacher@example.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({
                    data: {
                        id: 'sub-1',
                        sessions_used: 0,
                        sessions_total: 10,
                        ends_at: '2026-12-31T00:00:00.000Z',
                    },
                    error: null,
                });
            } else if (table === 'sessions') {
                sessionsQueryCount += 1;
                if (sessionsQueryCount <= 2) {
                    chain.lt.mockResolvedValue({ data: [], error: null });
                } else {
                    chain.select.mockResolvedValue({ data: createdSessions, error: null });
                }
            }

            return chain;
        });

        const adminClient = {
            rpc: vi.fn().mockResolvedValue({
                data: [
                    { slot_start: firstScheduledAt },
                    { slot_start: secondScheduledAt },
                ],
                error: null,
            }),
            from: vi.fn((table: string) => {
                if (table !== 'subscriptions') {
                    throw new Error(`Unexpected admin table ${table}`);
                }
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({ data: { id: 'sub-1' }, error: null }),
                };
            }),
        };
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as any);
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/calendar/recurring-sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            dayOfWeek: 2,
            time: '10:00',
            startDate: '2026-10-06',
            endDate: '2026-10-13',
        }) as any);

        expect(response.status).toBe(201);
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledTimes(2);
        expect(onboardingMocks.recordFirstClassScheduledSafe).toHaveBeenCalledTimes(1);
        expect(onboardingMocks.recordFirstClassScheduledSafe).toHaveBeenCalledWith(adminClient, expect.objectContaining({
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'sub-1',
            sessionId: 'session-first',
            teacherId: 'teacher-1',
            scheduledAt: firstScheduledAt,
        }));
    });
});
