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

function createRoleClient(role: string | null, user: { id: string; email: string } | null = { id: 'student-1', email: 'student@example.com' }) {
    const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: 'missing' } }),
    };

    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn(() => profileChain),
    };
}

function contextWithBody(body: Record<string, unknown>) {
    return {
        request: {
            url: 'http://localhost:4321/api/account/link-google-drive',
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

function contextWithInvalidJson() {
    return {
        request: {
            url: 'http://localhost:4321/api/account/link-google-drive',
            json: vi.fn().mockRejectedValue(new Error('bad json')),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

describe('/api/account/link-google-drive', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPrivateProfile.mockResolvedValue({ drive_folder_id: 'folder-1' });
        mocks.callInternalJobService.mockResolvedValue({
            driveFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
            googleAccountEmail: 'student@gmail.com',
        });
    });

    it('rejects non-students before reading private Drive state', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('teacher') as any);

        const { POST } = await import('../../src/pages/api/account/link-google-drive');
        const response = await POST(contextWithBody({ googleAccountEmail: 'teacher@gmail.com' }) as any);

        expect(response.status).toBe(403);
        expect(mocks.getPrivateProfile).not.toHaveBeenCalled();
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON before calling the internal worker', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { POST } = await import('../../src/pages/api/account/link-google-drive');
        const response = await POST(contextWithInvalidJson() as any);
        const body = await readJson(response);

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('requires a prepared Drive folder before delegating Google permission work', async () => {
        mocks.getPrivateProfile.mockResolvedValue({ drive_folder_id: null });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { POST } = await import('../../src/pages/api/account/link-google-drive');
        const response = await POST(contextWithBody({ googleAccountEmail: 'student@gmail.com' }) as any);

        expect(response.status).toBe(400);
        expect(mocks.callInternalJobService).not.toHaveBeenCalled();
    });

    it('normalizes student Google email and delegates permission changes to the internal worker', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { POST } = await import('../../src/pages/api/account/link-google-drive');
        const context = contextWithBody({ googleAccountEmail: '  Student@Gmail.COM ' });
        const response = await POST(context as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            success: true,
            googleAccountEmail: 'student@gmail.com',
        });
        expect(mocks.callInternalJobService).toHaveBeenCalledWith('/internal/account/link-google-drive', {
            userId: 'student-1',
            googleAccountEmail: 'student@gmail.com',
        }, { context });
    });
});
