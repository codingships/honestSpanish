import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: mocks.getPrivateProfile,
}));

type QueryResult = {
    data: unknown;
    error: null | { message: string };
};

type QueuedQuery = {
    table: string;
    result: QueryResult;
};

const ok = (data: unknown): QueryResult => ({ data, error: null });
const fail = (message: string): QueryResult => ({ data: null, error: { message } });

const makeContext = (body: Record<string, unknown>) => ({
    request: {
        url: 'http://localhost:4321/api/test/full-class-flow',
        json: vi.fn().mockResolvedValue(body),
    },
    cookies: { get: vi.fn(), set: vi.fn() },
    locals: {},
});

const makeInvalidJsonContext = () => ({
    request: {
        url: 'http://localhost:4321/api/test/full-class-flow',
        json: vi.fn().mockRejectedValue(new Error('bad json')),
    },
    cookies: { get: vi.fn(), set: vi.fn() },
    locals: {},
});

const makeQuery = (result: QueryResult) => {
    const eqCalls: Array<[string, unknown]> = [];
    const insertCalls: unknown[] = [];
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
        }),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        insert: vi.fn((value: unknown) => {
            insertCalls.push(value);
            return chain;
        }),
        single: vi.fn().mockResolvedValue(result),
    };

    return { chain, eqCalls, insertCalls };
};

const makeServerSupabase = ({
    user = { id: 'admin-1', email: 'admin@example.com' },
    role = 'admin',
}: {
    user?: { id: string; email: string } | null;
    role?: string | null;
} = {}) => {
    const profileQuery = makeQuery(role ? ok({ role }) : ok(null));
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table !== 'profiles') {
                throw new Error(`Unexpected server table ${table}`);
            }
            return profileQuery.chain;
        }),
        profileQuery,
    };
};

const makeAdminSupabase = (queuedQueries: QueuedQuery[]) => {
    const queries: Array<ReturnType<typeof makeQuery> & { table: string }> = [];
    const queue = [...queuedQueries];
    const client = {
        from: vi.fn((table: string) => {
            const queued = queue.shift();
            if (!queued) {
                throw new Error(`Unexpected admin table ${table}`);
            }
            if (queued.table !== table) {
                throw new Error(`Expected admin table ${queued.table}, got ${table}`);
            }
            const query = makeQuery(queued.result);
            queries.push({ table, ...query });
            return query.chain;
        }),
    };

    return { client, queries };
};

const setSupabaseClients = async (serverClient: unknown, adminClient?: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
    vi.mocked(createSupabaseServerClient).mockReturnValue(serverClient as any);
    if (adminClient) {
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as any);
    }
};

const readJson = (response: Response) => response.json() as Promise<Record<string, unknown>>;

const validBody = {
    studentId: 'student-1',
    teacherId: 'teacher-1',
    startTime: '2026-01-25T10:00:00+01:00',
};

const student = { id: 'student-1', full_name: 'Student One', email: 'student@example.com' };
const teacher = { id: 'teacher-1', full_name: 'Teacher One', email: 'teacher@example.com' };
const subscription = { id: 'sub-1', status: 'active', sessions_total: 8, sessions_used: 2 };
const session = { id: 'session-1', scheduled_at: validBody.startTime, status: 'scheduled' };

const baseAdminQueries = (overrides: Partial<Record<string, QueryResult>> = {}): QueuedQuery[] => [
    { table: 'profiles', result: overrides.student ?? ok(student) },
    { table: 'profiles', result: overrides.teacher ?? ok(teacher) },
    { table: 'student_teachers', result: overrides.assignment ?? ok({ student_id: 'student-1', teacher_id: 'teacher-1' }) },
    { table: 'subscriptions', result: overrides.subscription ?? ok(subscription) },
    { table: 'sessions', result: overrides.sessionInsert ?? ok(session) },
    {
        table: 'sessions',
        result: overrides.sessionRefetch ?? ok({
            drive_doc_id: 'doc-1',
            drive_doc_url: 'https://docs.google.com/document/d/doc-1',
            calendar_event_id: 'event-1',
            meet_link: 'https://meet.google.com/abc-defg-hij',
        }),
    },
];

describe('/api/test/full-class-flow', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        mocks.getPrivateProfile.mockResolvedValue({
            drive_folder_id: 'folder-1',
            current_level: 'B1',
        });
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
            if (typeof callback === 'function') callback();
            return 0;
        }) as typeof setTimeout);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('rejects unauthenticated requests before reading profile role or admin data', async () => {
        const server = makeServerSupabase({ user: null });
        await setSupabaseClients(server);

        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);

        expect(response.status).toBe(401);
        expect(server.from).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects non-admin users before parsing the test payload', async () => {
        const server = makeServerSupabase({ role: 'teacher' });
        await setSupabaseClients(server);

        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('returns 410 in production before parsing JSON or creating admin clients', async () => {
        vi.stubEnv('PROD', true);
        const server = makeServerSupabase();
        const context = makeContext(validBody);
        await setSupabaseClients(server);

        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(context as any);
        const body = await readJson(response);

        expect(response.status).toBe(410);
        expect(body.error).toContain('disabled in production');
        expect(context.request.json).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON after admin authorization', async () => {
        const server = makeServerSupabase();
        await setSupabaseClients(server);

        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeInvalidJsonContext() as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('requires studentId, teacherId and startTime before reading admin data', async () => {
        const server = makeServerSupabase();
        await setSupabaseClients(server);

        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext({ studentId: 'student-1' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.error).toContain('Missing required fields');
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('returns 400 when the student profile is missing before checking assignment or subscription', async () => {
        const server = makeServerSupabase();
        const admin = makeAdminSupabase(baseAdminQueries({ student: fail('student not found') }));
        await setSupabaseClients(server, admin.client);

        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(String((body.errors as string[])[0])).toContain('Student not found');
        expect(mocks.getPrivateProfile).not.toHaveBeenCalled();
        expect(admin.client.from).toHaveBeenCalledTimes(2);
    });

    it('returns 400 when the teacher is not assigned to the student before creating a session', async () => {
        const server = makeServerSupabase();
        const admin = makeAdminSupabase(baseAdminQueries({ assignment: fail('no rows') }));
        await setSupabaseClients(server, admin.client);

        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.errors).toContain('Teacher is not assigned to student: no rows');
        expect(admin.client.from).toHaveBeenCalledTimes(3);
        expect(admin.queries[2].eqCalls).toContainEqual(['student_id', 'student-1']);
        expect(admin.queries[2].eqCalls).toContainEqual(['teacher_id', 'teacher-1']);
        expect(admin.queries.some((query) => query.table === 'sessions')).toBe(false);
    });

    it('returns 400 when the student has no active subscription before creating a session', async () => {
        const server = makeServerSupabase();
        const admin = makeAdminSupabase(baseAdminQueries({ subscription: fail('no active subscription') }));
        await setSupabaseClients(server, admin.client);

        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(String((body.errors as string[]).at(-1))).toContain('No active subscription');
        expect(admin.queries.some((query) => query.table === 'sessions')).toBe(false);
    });

    it('returns 500 when session creation fails after all preconditions pass', async () => {
        const server = makeServerSupabase();
        const admin = makeAdminSupabase(baseAdminQueries({ sessionInsert: fail('insert denied') }));
        await setSupabaseClients(server, admin.client);

        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);
        const body = await readJson(response);

        expect(response.status).toBe(500);
        expect(body.errors).toContain('Failed to create session: insert denied');
        expect(admin.queries.find((query) => query.table === 'sessions')?.insertCalls).toHaveLength(1);
    });

    it('returns 207 when the session is created but Google fulfillment outputs are still missing', async () => {
        const server = makeServerSupabase();
        const admin = makeAdminSupabase(baseAdminQueries({
            sessionRefetch: ok({
                drive_doc_id: null,
                drive_doc_url: null,
                calendar_event_id: null,
                meet_link: null,
            }),
        }));
        await setSupabaseClients(server, admin.client);

        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);
        const body = await readJson(response);

        expect(response.status).toBe(207);
        expect(body.success).toBe(false);
        expect(body.errors).toContain('Drive document was not created');
        expect(body.errors).toContain('Calendar event was not created');
        expect(body.errors).toContain('Meet link was not generated');
    });

    it('returns 200 and structured step results when the full mocked flow succeeds', async () => {
        const server = makeServerSupabase();
        const admin = makeAdminSupabase(baseAdminQueries());
        await setSupabaseClients(server, admin.client);

        const { POST } = await import('../../src/pages/api/test/full-class-flow');
        const response = await POST(makeContext(validBody) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.step1_session).toMatchObject({ id: 'session-1', created: true });
        expect(body.step2_driveDoc).toMatchObject({ success: true, docId: 'doc-1' });
        expect(body.step3_calendarEvent).toMatchObject({ success: true, eventId: 'event-1' });
        expect(body.step4_meetLink).toMatchObject({ success: true, url: 'https://meet.google.com/abc-defg-hij' });
        expect(body.step5_studentData).toMatchObject({ id: 'student-1', hasDriveFolder: true, level: 'B1' });
        expect(body.step6_teacherData).toMatchObject({ id: 'teacher-1', email: 'teacher@example.com' });
        expect(mocks.getPrivateProfile).toHaveBeenCalledWith('student-1', admin.client);
    });
});
