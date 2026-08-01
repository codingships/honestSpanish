import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseServerClient } from '../../src/lib/supabase-server';
import { GET } from '../../src/pages/api/calendar/sessions';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

type ClientOptions = {
    user?: { id: string } | null;
    authError?: unknown;
    role?: string | null;
    profileError?: unknown;
    sessions?: unknown[] | null;
    sessionsError?: unknown;
};

function createReadClient({
    user = { id: 'teacher-a' },
    authError = null,
    role = 'teacher',
    profileError = null,
    sessions = [],
    sessionsError = null,
}: ClientOptions = {}) {
    const profileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
            data: profileError ? null : (role === null ? null : { role }),
            error: profileError,
        }),
    };
    const sessionsResult = { data: sessions, error: sessionsError };
    const sessionsQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'gte', 'lt', 'order', 'limit', 'eq']) {
        sessionsQuery[method] = vi.fn().mockReturnValue(sessionsQuery);
    }
    sessionsQuery.then = vi.fn((resolve, reject) => Promise.resolve(sessionsResult).then(resolve, reject));

    const client = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: authError }),
        },
        from: vi.fn((table: string) => table === 'profiles' ? profileQuery : sessionsQuery),
    };

    return { client, profileQuery, sessionsQuery };
}

function context(query = '') {
    return {
        request: new Request(`http://localhost:4321/api/calendar/sessions${query}`),
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

async function responseJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('GET /api/calendar/sessions', () => {
    const teacherB = '22222222-2222-4222-8222-222222222222';
    const studentId = '33333333-3333-4333-8333-333333333333';

    it('requires an authenticated user', async () => {
        const { client } = createReadClient({ user: null });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16') as never);

        expect(response.status).toBe(401);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    });

    it('returns a retryable error when authentication cannot be verified', async () => {
        const { client } = createReadClient({ user: null, authError: { code: 'AUTH_UNAVAILABLE' } });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16') as never);

        expect(response.status).toBe(503);
    });

    it('fails closed when the profile cannot be read or has no allowed role', async () => {
        const unavailable = createReadClient({ profileError: { message: 'database details' } });
        vi.mocked(createSupabaseServerClient).mockReturnValue(unavailable.client as never);
        const unavailableResponse = await GET(context('?weekStart=2026-02-16') as never);
        expect(unavailableResponse.status).toBe(503);
        expect(JSON.stringify(await responseJson(unavailableResponse))).not.toContain('database details');
        expect(unavailable.client.from).toHaveBeenCalledTimes(1);

        const forbidden = createReadClient({ role: 'support' });
        vi.mocked(createSupabaseServerClient).mockReturnValue(forbidden.client as never);
        const forbiddenResponse = await GET(context('?weekStart=2026-02-16') as never);
        expect(forbiddenResponse.status).toBe(403);
        expect(forbidden.client.from).toHaveBeenCalledTimes(1);

        const missing = createReadClient({ role: null });
        vi.mocked(createSupabaseServerClient).mockReturnValue(missing.client as never);
        const missingResponse = await GET(context('?weekStart=2026-02-16') as never);
        expect(missingResponse.status).toBe(403);
        expect(missing.client.from).toHaveBeenCalledTimes(1);
    });

    it.each([
        '',
        '?weekStart=2026-02-17',
        '?weekStart=2026-02-30',
        '?weekStart=2026-2-16',
        '?weekStart=9999-12-27',
    ])('rejects a missing or invalid Madrid Monday: %s', async (query) => {
        const { client } = createReadClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context(query) as never);

        expect(response.status).toBe(400);
        expect(client.from).toHaveBeenCalledTimes(1);
    });

    it('rejects unknown status values before querying sessions', async () => {
        const { client } = createReadClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16&status=deleted') as never);

        expect(response.status).toBe(400);
        expect(client.from).toHaveBeenCalledTimes(1);
    });

    it.each([
        '?weekStart=2026-02-16&studentId=not-a-uuid',
        '?weekStart=2026-02-16&teacherId=not-a-uuid',
    ])('rejects malformed profile filters: %s', async (query) => {
        const { client } = createReadClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context(query) as never);

        expect(response.status).toBe(400);
        expect(client.from).toHaveBeenCalledTimes(1);
    });

    it('derives a half-open DST-aware range and always scopes a teacher to themself', async () => {
        const session = {
            id: 'session-1',
            student_id: studentId,
            scheduled_at: '2026-03-24T10:00:00.000Z',
            duration_minutes: 50,
            status: 'scheduled',
            meet_link: null,
            teacher_notes: null,
            drive_doc_url: null,
            student: { id: 'student-1', full_name: 'Ana', email: 'ana@example.com' },
        };
        const { client, sessionsQuery } = createReadClient({ sessions: [session] });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context(
            `?weekStart=2026-03-23&teacherId=${teacherB}&studentId=${studentId}&status=scheduled`,
        ) as never);

        expect(response.status).toBe(200);
        expect(sessionsQuery.gte).toHaveBeenCalledWith('scheduled_at', '2026-03-22T23:00:00.000Z');
        expect(sessionsQuery.lt).toHaveBeenCalledWith('scheduled_at', '2026-03-29T22:00:00.000Z');
        expect(sessionsQuery.limit).toHaveBeenCalledWith(501);
        expect(sessionsQuery.eq).toHaveBeenCalledWith('teacher_id', 'teacher-a');
        expect(sessionsQuery.eq).not.toHaveBeenCalledWith('teacher_id', teacherB);
        expect(sessionsQuery.eq).toHaveBeenCalledWith('student_id', studentId);
        expect(sessionsQuery.eq).toHaveBeenCalledWith('status', 'scheduled');
        expect(String(sessionsQuery.select.mock.calls[0]?.[0])).not.toContain('*');
        expect(await responseJson(response)).toEqual({
            weekStartKey: '2026-03-23',
            sessions: [{
                id: session.id,
                scheduled_at: session.scheduled_at,
                duration_minutes: session.duration_minutes,
                status: session.status,
                meet_link: session.meet_link,
                teacher_notes: session.teacher_notes,
                drive_doc_url: session.drive_doc_url,
                student: session.student,
            }],
        });
    });

    it('lets an administrator apply an explicit teacher filter within the same bounded week', async () => {
        const { client, sessionsQuery } = createReadClient({ role: 'admin' });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context(`?weekStart=2026-10-19&teacherId=${teacherB}`) as never);

        expect(response.status).toBe(200);
        expect(sessionsQuery.gte).toHaveBeenCalledWith('scheduled_at', '2026-10-18T22:00:00.000Z');
        expect(sessionsQuery.lt).toHaveBeenCalledWith('scheduled_at', '2026-10-25T23:00:00.000Z');
        expect(sessionsQuery.eq).toHaveBeenCalledWith('teacher_id', teacherB);
    });

    it('requires an owner filter for an administrator weekly read', async () => {
        const { client } = createReadClient({ role: 'admin' });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-10-19') as never);

        expect(response.status).toBe(400);
        expect(await responseJson(response)).toEqual({
            error: 'Admin calendar requests require a teacherId or studentId',
        });
        expect(client.from).toHaveBeenCalledTimes(1);
    });

    it('always scopes a student to themself and ignores profile filters for other people', async () => {
        const studentUserId = '44444444-4444-4444-8444-444444444444';
        const { client, sessionsQuery } = createReadClient({
            user: { id: studentUserId },
            role: 'student',
        });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context(
            `?weekStart=2026-02-16&teacherId=${teacherB}&studentId=${studentId}`,
        ) as never);

        expect(response.status).toBe(200);
        expect(sessionsQuery.eq).toHaveBeenCalledWith('student_id', studentUserId);
        expect(sessionsQuery.eq).not.toHaveBeenCalledWith('student_id', studentId);
        expect(sessionsQuery.eq).not.toHaveBeenCalledWith('teacher_id', teacherB);
    });

    it('returns a sanitized retryable failure instead of a false empty calendar', async () => {
        const { client } = createReadClient({ sessionsError: { message: 'raw database failure' } });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16') as never);
        const payload = await responseJson(response);

        expect(response.status).toBe(503);
        expect(payload.error).toBe('Calendar is temporarily unavailable');
        expect(JSON.stringify(payload)).not.toContain('raw database failure');
    });

    it('rejects a truncated week instead of returning a partial calendar', async () => {
        const { client } = createReadClient({ sessions: Array.from({ length: 501 }, (_, id) => ({ id })) });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16') as never);

        expect(response.status).toBe(422);
        expect(await responseJson(response)).toEqual({ error: 'Too many sessions for the requested week' });
    });

    it('treats a successful null data result as unavailable instead of a false empty week', async () => {
        const { client } = createReadClient({ sessions: null });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16') as never);

        expect(response.status).toBe(503);
        expect(await responseJson(response)).toEqual({ error: 'Calendar is temporarily unavailable' });
    });

    it('keeps a historical session visible with a minimal identity when the profile embed is hidden by RLS', async () => {
        const historicalSession = {
            id: 'session-history',
            student_id: studentId,
            scheduled_at: '2026-02-18T15:00:00.000Z',
            duration_minutes: 50,
            status: 'completed',
            meet_link: null,
            teacher_notes: null,
            drive_doc_url: null,
            student: null,
        };
        const { client } = createReadClient({ sessions: [historicalSession] });
        vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

        const response = await GET(context('?weekStart=2026-02-16') as never);

        expect(response.status).toBe(200);
        expect(await responseJson(response)).toEqual({
            weekStartKey: '2026-02-16',
            sessions: [{
                id: historicalSession.id,
                scheduled_at: historicalSession.scheduled_at,
                duration_minutes: historicalSession.duration_minutes,
                status: historicalSession.status,
                meet_link: historicalSession.meet_link,
                teacher_notes: historicalSession.teacher_notes,
                drive_doc_url: historicalSession.drive_doc_url,
                student: { id: studentId, full_name: null, email: '' },
            }],
        });
    });
});
