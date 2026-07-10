import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

// Mock Supabase Server Client
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

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/calendar/bulk-sessions',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

describe('POST /api/calendar/bulk-sessions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        crmMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
        onboardingMocks.recordFirstClassScheduledSafe.mockResolvedValue({ status: 'recorded' });
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({ studentId: '123', sessions: ['2026-01-01T10:00:00Z'] }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 403 when user is a student (RBAC Privilege Escalation attempt)', async () => {
        // Simulamos que el usuario logueado es un estdiante
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'student_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { role: 'student' } }), // Rol es Alumno
            };
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        // Un alumno intenta llamar al endpoint de agendamiento
        const response = await POST(makeContext({ studentId: '123', sessions: ['2026-01-01T10:00:00Z'] }) as any);

        // Debe ser expulsado
        expect(response.status).toBe(403);
    });

    it('returns 400 before bulk scheduling when manual meetLink is unsafe', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            sessions: ['2026-10-10T10:00:00.000Z'],
            meetLink: 'https://evil.example/class',
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(400);
        expect(body.error).toContain('HTTPS Google Meet URL');
    });

    it('returns 400 when missing required payload fields', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' } }), // Logueado como profe (permitido)
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');

        // Payload corrupto (sin arrray de 'sessions')
        const response = await POST(makeContext({ studentId: '123' }) as any);
        expect(response.status).toBe(400);

        const body = await response.json() as JsonBody;
        expect(body.error).toContain('dates are required');
    });

    it('returns 400 when sessions are not strict ISO date-times with a timezone', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const dateOnlyResponse = await POST(makeContext({
            studentId: 'student_1',
            sessions: ['2026-10-10'],
        }) as any);
        const impossibleDateResponse = await POST(makeContext({
            studentId: 'student_1',
            sessions: ['2026-02-30T10:00:00.000Z'],
        }) as any);

        expect(dateOnlyResponse.status).toBe(400);
        await expect(dateOnlyResponse.json()).resolves.toEqual({
            error: 'sessions must contain valid ISO date strings',
        });
        expect(impossibleDateResponse.status).toBe(400);
        await expect(impossibleDateResponse.json()).resolves.toEqual({
            error: 'sessions must contain valid ISO date strings',
        });
    });

    it('returns 400 when the bulk request exceeds the server-side session limit', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            sessions: Array.from({ length: 51 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`),
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(400);
        expect(body.error).toBe('Maximum 50 sessions per request');
    });

    it('returns 409 Conflict if ONE of the dates is busy (Atomicity Check)', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });

        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
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
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'profe@test.com' } });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({ data: { id: 'sub_1', sessions_used: 0, sessions_total: 10, ends_at: '2099-12-31' } });
            } else if (table === 'sessions') {
                // Mockeamos la respuesta de conflictos: Simulamos que devuelve [1] conflicto
                chain.single.mockResolvedValue({ data: [{ id: 'existing_class' }] });
                // Return an array for the select list query
                chain.lt = vi.fn().mockResolvedValue({ data: [{ id: 'fake_conflict' }] });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        // Simulamos que el calendario de Google ESTÁ libre, el bloqueo viene de BBDD

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');

        // Enviamos 3 fechas
        const payload = {
            studentId: '123',
            sessions: [
                '2026-10-10T10:00:00Z',
                '2026-10-11T10:00:00Z',
                '2026-10-12T10:00:00Z'
            ]
        };

        const response = await POST(makeContext(payload) as any);

        // La API deberia abortar devolviendo HTTP 409 Conflict antes de insertar
        expect(response.status).toBe(409);
        const body = await response.json() as JsonBody;
        expect(body.error).toContain('Conflicto detectado en Campus');
    });

    it('rejects a bulk request when any session falls after the subscription end date', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
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
                chain.single.mockResolvedValue({
                    data: {
                        id: 'sub-1',
                        sessions_used: 0,
                        sessions_total: 10,
                        ends_at: '2026-10-10',
                    },
                    error: null,
                });
            }
            return chain;
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student-1',
            sessions: [
                '2026-10-10T10:00:00.000Z',
                '2026-10-11T10:00:00.000Z',
            ],
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(400);
        expect(body.error).toBe('Sessions cannot be scheduled after the subscription end date');
    });

    it('returns 400 for invalid JSON after role authorization', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'teacher' }, error: null }),
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST({
            request: {
                json: vi.fn().mockRejectedValue(new Error('bad json')),
                headers: { get: vi.fn().mockReturnValue('') },
                url: 'http://localhost:4321/api/calendar/bulk-sessions',
            },
            cookies: { set: vi.fn(), get: vi.fn() },
        } as any);

        expect(response.status).toBe(400);
        const body = await response.json() as JsonBody;
        expect(body.error).toBe('Invalid JSON body');
    });

    it('returns 400 when admin scheduling omits teacherId', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        } as any));

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            sessions: ['2026-10-10T10:00:00Z'],
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(400);
        expect(body.error).toContain('teacherId');
    });

    it('returns 400 when admin scheduling targets a non-teacher profile', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin_1' } }, error: null }),
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

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            teacherId: 'not_a_teacher',
            sessions: ['2026-10-10T10:00:00Z'],
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(400);
        expect(body.error).toContain('teacherId must belong to a teacher profile');
    });

    it('records first-class onboarding from the earliest bulk session', async () => {
        vi.stubEnv('E2E_DISABLE_EXTERNAL_INTEGRATIONS', 'true');
        vi.stubEnv('NODE_ENV', 'test');

        const laterScheduledAt = '2026-10-12T10:00:00.000Z';
        const earliestScheduledAt = '2026-10-10T10:00:00.000Z';
        const createdSessions = [
            {
                id: 'session-later',
                subscription_id: 'sub_1',
                student_id: 'student_1',
                teacher_id: 'teacher_1',
                scheduled_at: laterScheduledAt,
                duration_minutes: 50,
                status: 'scheduled',
                student: { id: 'student_1', full_name: 'Student One', email: 'student@example.com' },
                teacher: { id: 'teacher_1', full_name: 'Teacher One', email: 'teacher@example.com' },
            },
            {
                id: 'session-earliest',
                subscription_id: 'sub_1',
                student_id: 'student_1',
                teacher_id: 'teacher_1',
                scheduled_at: earliestScheduledAt,
                duration_minutes: 50,
                status: 'scheduled',
                student: { id: 'student_1', full_name: 'Student One', email: 'student@example.com' },
                teacher: { id: 'teacher_1', full_name: 'Teacher One', email: 'teacher@example.com' },
            },
        ];

        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
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
                chain.single.mockResolvedValue({ data: { id: 'sub_1', sessions_used: 0, sessions_total: 10, ends_at: '2099-12-31' }, error: null });
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
                    { slot_start: laterScheduledAt },
                    { slot_start: earliestScheduledAt },
                ],
                error: null,
            }),
            from: vi.fn((table: string) => {
                if (table === 'sessions') {
                    return {
                        insert: vi.fn().mockReturnThis(),
                        select: vi.fn().mockResolvedValue({ data: createdSessions, error: null }),
                    };
                }
                if (table === 'subscriptions') {
                    return {
                        update: vi.fn().mockReturnThis(),
                        eq: vi.fn().mockReturnThis(),
                        select: vi.fn().mockReturnThis(),
                        single: vi.fn().mockResolvedValue({ data: { id: 'sub_1' }, error: null }),
                    };
                }
                throw new Error(`Unexpected admin table ${table}`);
            }),
        };

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            sessions: [laterScheduledAt, earliestScheduledAt],
        }) as any);

        expect(response.status).toBe(201);
        expect(crmMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledTimes(2);
        expect(onboardingMocks.recordFirstClassScheduledSafe).toHaveBeenCalledTimes(1);
        expect(onboardingMocks.recordFirstClassScheduledSafe).toHaveBeenCalledWith(adminClient, expect.objectContaining({
            profileId: 'student_1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'sub_1',
            sessionId: 'session-earliest',
            teacherId: 'teacher_1',
            scheduledAt: earliestScheduledAt,
        }));
    });

    it('returns 409 before insert when a bulk date is outside teacher availability', async () => {
        const scheduledAt = '2026-10-10T10:00:00.000Z';
        const insertMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: insertMock,
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
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'profe@test.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({ data: { id: 'sub_1', sessions_used: 0, sessions_total: 10, ends_at: '2099-12-31' } });
            } else if (table === 'sessions') {
                chain.lt.mockResolvedValue({ data: [], error: null });
            }

            return chain;
        });

        const adminClient = {
            rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
            from: vi.fn(),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            sessions: [scheduledAt],
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(409);
        expect(body.error).toContain('outside teacher availability');
        expect(insertMock).not.toHaveBeenCalled();
        expect(adminClient.rpc).toHaveBeenCalledWith('get_available_slots', expect.objectContaining({
            p_teacher_id: 'teacher_1',
            p_duration_minutes: 50,
        }));
    });

    it('returns 409 before insert when bulk dates overlap inside the same request', async () => {
        const insertMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher_1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                insert: insertMock,
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
                chain.single.mockResolvedValue({ data: { role: 'teacher', email: 'profe@test.com' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            } else if (table === 'subscriptions') {
                chain.single.mockResolvedValue({ data: { id: 'sub_1', sessions_used: 0, sessions_total: 10, ends_at: '2099-12-31' } });
            } else if (table === 'sessions') {
                chain.lt.mockResolvedValue({ data: [], error: null });
            }

            return chain;
        });

        const adminClient = {
            rpc: vi.fn(),
            from: vi.fn(),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as any);

        const { POST } = await import('../../src/pages/api/calendar/bulk-sessions');
        const response = await POST(makeContext({
            studentId: 'student_1',
            sessions: [
                '2026-10-10T10:00:00.000Z',
                '2026-10-10T10:30:00.000Z',
            ],
        }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(409);
        expect(body.error).toContain('overlapping class times');
        expect(adminClient.rpc).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });
});
