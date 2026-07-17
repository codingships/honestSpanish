import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getPrivateProfile: vi.fn(),
    callInternalJobService: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: mocks.getPrivateProfile,
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    callInternalJobService: mocks.callInternalJobService,
}));

const contextWithBody = (body: Record<string, unknown>) => ({
    request: {
        url: 'http://localhost:4321/api/google/create-student-folder',
        json: vi.fn().mockResolvedValue(body),
    },
    cookies: { get: vi.fn(), set: vi.fn() },
    locals: {},
});

const contextWithInvalidJson = () => ({
    request: {
        url: 'http://localhost:4321/api/google/create-student-folder',
        json: vi.fn().mockRejectedValue(new Error('bad json')),
    },
    cookies: { get: vi.fn(), set: vi.fn() },
    locals: {},
});

const makeQuery = (result: { data: unknown; error: unknown }) => {
    const eqCalls: Array<[string, unknown]> = [];
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
        }),
        single: vi.fn().mockResolvedValue(result),
    };
    return { chain, eqCalls };
};

const makeSupabase = ({
    user = { id: 'admin-1', email: 'admin@example.com' },
    role = 'admin',
    studentResult = { data: { id: 'student-1' }, error: null },
}: {
    user?: { id: string; email: string } | null;
    role?: string | null;
    studentResult?: { data: unknown; error: unknown };
} = {}) => {
    const profileQueries: ReturnType<typeof makeQuery>[] = [];
    const supabase = {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn((table: string) => {
            if (table !== 'profiles') throw new Error(`Unexpected table ${table}`);
            const result = profileQueries.length === 0
                ? { data: role ? { role } : null, error: role ? null : { message: 'missing profile' } }
                : studentResult;
            const query = makeQuery(result);
            profileQueries.push(query);
            return query.chain;
        }),
    };

    return { supabase, profileQueries };
};

const setSupabase = async (mockSupabase: unknown) => {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);
};

const readJson = (response: Response) => response.json() as Promise<Record<string, unknown>>;

describe('/api/google/create-student-folder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        mocks.getPrivateProfile.mockResolvedValue(null);
        mocks.callInternalJobService.mockResolvedValue({
            folderId: 'folder-1',
            folderUrl: 'https://drive.google.com/drive/folders/folder-1',
        });
    });

    it('rejects unauthenticated requests before reading profiles', async () => {
        const { supabase } = makeSupabase({ user: null });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const response = await POST(contextWithBody({ studentId: 'student-1' }) as any);

        expect(response.status).toBe(401);
        expect(supabase.from).not.toHaveBeenCalled();
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('rejects non-admin users before reading private Drive state', async () => {
        const { supabase } = makeSupabase({ role: 'teacher' });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const response = await POST(contextWithBody({ studentId: 'student-1' }) as any);

        expect(response.status).toBe(403);
        expect(mocks.getPrivateProfile).not.toHaveBeenCalled();
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON before looking up a student', async () => {
        const { supabase, profileQueries } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const response = await POST(contextWithInvalidJson() as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
        expect(profileQueries).toHaveLength(1);
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('requires a string studentId', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const response = await POST(contextWithBody({ studentId: '' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.error).toBe('studentId is required');
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('returns 404 when the target student profile does not exist', async () => {
        const { supabase, profileQueries } = makeSupabase({
            studentResult: { data: null, error: { message: 'not found' } },
        });
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const response = await POST(contextWithBody({ studentId: 'missing-student' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(404);
        expect(body.error).toBe('Student not found');
        expect(profileQueries[1].eqCalls).toContainEqual(['id', 'missing-student']);
        expect(mocks.getPrivateProfile).not.toHaveBeenCalled();
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('does not enqueue duplicate folder work when the student already has a Drive folder', async () => {
        mocks.getPrivateProfile.mockResolvedValue({
            drive_folder_id: 'folder-existing',
            drive_folder_url: 'https://drive.google.com/drive/folders/folder-existing',
        });
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const response = await POST(contextWithBody({ studentId: 'student-1' }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
            error: 'Student already has a Drive folder',
            folderId: 'folder-existing',
        });
        expect(mocks.getPrivateProfile).toHaveBeenCalledWith('student-1');
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('delegates folder creation to the internal worker for an admin and valid student', async () => {
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        const { POST } = await import('../../src/pages/api/google/create-student-folder');
        const context = contextWithBody({ studentId: 'student-1' });
        const response = await POST(context as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.result).toMatchObject({ folderId: 'folder-1' });
        expect(mocks.callInternalJobService).toHaveBeenCalledWith(
            '/internal/google/create-student-folder',
            { studentId: 'student-1' },
            { context },
        );
    });

    it('returns a generic 500 when the internal worker call fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.callInternalJobService.mockRejectedValue(new Error('worker unavailable'));
        const { supabase } = makeSupabase();
        await setSupabase(supabase);

        try {
            const { POST } = await import('../../src/pages/api/google/create-student-folder');
            const response = await POST(contextWithBody({ studentId: 'student-1' }) as any);
            const body = await readJson(response);

            expect(response.status).toBe(500);
            expect(body.error).toBe('Failed to create folder structure');
            expect(body.details).toBe('See server logs');
        } finally {
            consoleError.mockRestore();
        }
    });
});
