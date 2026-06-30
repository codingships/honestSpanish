import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

const profileMocks = vi.hoisted(() => ({
    upsertPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    upsertPrivateProfile: profileMocks.upsertPrivateProfile,
}));

function makeContext(body: Record<string, unknown>) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/update-student-notes',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
}

function makeInvalidJsonContext() {
    return {
        request: {
            json: vi.fn().mockRejectedValue(new Error('bad json')),
            headers: { get: vi.fn().mockReturnValue('') },
            url: 'http://localhost:4321/api/update-student-notes',
        },
        cookies: { set: vi.fn(), get: vi.fn() },
    };
}

async function setClient(client: unknown) {
    const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as any);
}

describe('POST /api/update-student-notes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        profileMocks.upsertPrivateProfile.mockResolvedValue(undefined);
    });

    it('returns 401 before parsing JSON when unauthenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const context = makeInvalidJsonContext();
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(context as any);

        expect(response.status).toBe(401);
        expect(context.request.json).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid JSON after authentication', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }),
            },
        });
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(makeInvalidJsonContext() as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
    });

    it('rejects non-string notes', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }),
            },
        });
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(makeContext({ studentId: 'student-1', notes: { text: 'bad' } }) as any);
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('notes must be a string');
        expect(profileMocks.upsertPrivateProfile).not.toHaveBeenCalled();
    });

    it('lets an assigned teacher update trimmed student notes', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null }),
            },
        });
        mockSupabase.from = vi.fn((table: string) => {
            const chain: any = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn(),
            };
            if (table === 'profiles') {
                chain.single.mockResolvedValue({ data: { role: 'teacher' }, error: null });
            } else if (table === 'student_teachers') {
                chain.single.mockResolvedValue({ data: { id: 'assignment-1' }, error: null });
            }
            return chain;
        });
        await setClient(mockSupabase);

        const { POST } = await import('../../src/pages/api/update-student-notes');
        const response = await POST(makeContext({ studentId: ' student-1 ', notes: 'Needs B2 practice.' }) as any);

        expect(response.status).toBe(200);
        expect(profileMocks.upsertPrivateProfile).toHaveBeenCalledWith('student-1', {
            notes: 'Needs B2 practice.',
        });
    });
});
