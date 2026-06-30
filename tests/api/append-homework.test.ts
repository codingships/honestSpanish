import { beforeEach, describe, expect, it, vi } from 'vitest';

const internalJobServiceMock = vi.hoisted(() => ({
    callInternalJobService: vi.fn(),
}));

vi.mock('../../src/lib/internal-job-service', () => internalJobServiceMock);

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/drive/append-homework',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

const makeChain = (result: { data: unknown; error: unknown }) => {
    const eqCalls: Array<[string, unknown]> = [];
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
        }),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return { chain, eqCalls };
};

const makeSupabase = ({
    user = { id: 'teacher-1', email: 'teacher@example.com' },
    role = 'teacher',
    sessionResults = [{ data: { id: 'session-1' }, error: null }],
}: {
    user?: { id: string; email: string } | null;
    role?: string;
    sessionResults?: Array<{ data: unknown; error: unknown }>;
} = {}) => {
    const sessionQueries: ReturnType<typeof makeChain>[] = [];
    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table === 'profiles') {
                return makeChain({ data: { role }, error: null }).chain;
            }
            if (table === 'sessions') {
                const nextResult = sessionResults.shift() ?? { data: null, error: null };
                const query = makeChain(nextResult);
                sessionQueries.push(query);
                return query.chain;
            }
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { supabase, sessionQueries };
};

const setSupabase = async (mockSupabase: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
};

describe('POST /api/drive/append-homework', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        internalJobServiceMock.callInternalJobService.mockResolvedValue({ success: true });
    });

    it('rejects non-Google document URLs', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/drive/append-homework');
        const response = await POST(makeContext({
            docUrl: 'https://example.com/document/d/doc_123/edit',
            text: 'Practice subjunctive',
        }) as any);

        expect(response.status).toBe(400);
        expect(internalJobServiceMock.callInternalJobService).not.toHaveBeenCalled();
    });

    it('allows a teacher to append to a document owned by one of their sessions by doc id', async () => {
        const { supabase, sessionQueries } = makeSupabase({
            sessionResults: [{ data: { id: 'session-1' }, error: null }],
        });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/drive/append-homework');
        const response = await POST(makeContext({
            docUrl: 'https://docs.google.com/document/d/doc_123/edit',
            text: 'Practice subjunctive',
            classDate: '2026-02-18T10:00:00Z',
        }) as any);

        expect(response.status).toBe(200);
        expect(sessionQueries[0].chain).not.toHaveProperty('or');
        expect(sessionQueries[0].eqCalls).toContainEqual(['drive_doc_id', 'doc_123']);
        expect(sessionQueries[0].eqCalls).toContainEqual(['teacher_id', 'teacher-1']);
        expect(internalJobServiceMock.callInternalJobService).toHaveBeenCalledWith(
            '/internal/drive/append-homework',
            expect.objectContaining({
                docId: 'doc_123',
                content: expect.stringContaining('Practice subjunctive'),
            }),
            expect.any(Object),
        );
    });

    it('falls back to exact stored doc URL without interpolating a raw OR filter', async () => {
        const docUrl = 'https://docs.google.com/document/d/doc_456/edit';
        const { supabase, sessionQueries } = makeSupabase({
            sessionResults: [
                { data: null, error: null },
                { data: { id: 'session-2' }, error: null },
            ],
        });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/drive/append-homework');
        const response = await POST(makeContext({ docUrl, text: 'Homework' }) as any);

        expect(response.status).toBe(200);
        expect(sessionQueries).toHaveLength(2);
        expect(sessionQueries[1].chain).not.toHaveProperty('or');
        expect(sessionQueries[1].eqCalls).toContainEqual(['drive_doc_url', docUrl]);
        expect(sessionQueries[1].eqCalls).toContainEqual(['teacher_id', 'teacher-1']);
    });

    it('forbids a teacher when neither doc id nor exact doc URL belongs to them', async () => {
        const { supabase } = makeSupabase({
            sessionResults: [
                { data: null, error: null },
                { data: null, error: null },
            ],
        });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/drive/append-homework');
        const response = await POST(makeContext({
            docUrl: 'https://docs.google.com/document/d/doc_foreign/edit',
            text: 'Homework',
        }) as any);

        expect(response.status).toBe(403);
        expect(internalJobServiceMock.callInternalJobService).not.toHaveBeenCalled();
    });

    it('allows admin to append without teacher ownership lookup', async () => {
        const { supabase } = makeSupabase({ role: 'admin', sessionResults: [] });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/drive/append-homework');
        const response = await POST(makeContext({
            docUrl: 'https://docs.google.com/document/d/doc_admin/edit',
            text: 'Admin correction',
        }) as any);

        expect(response.status).toBe(200);
        expect(supabase.from).not.toHaveBeenCalledWith('sessions');
        expect(internalJobServiceMock.callInternalJobService).toHaveBeenCalledWith(
            '/internal/drive/append-homework',
            expect.objectContaining({ docId: 'doc_admin' }),
            expect.any(Object),
        );
    });
});
