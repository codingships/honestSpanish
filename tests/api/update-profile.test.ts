import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

const makeContext = (body: Record<string, unknown> = {}) => ({
    request: {
        json: vi.fn().mockResolvedValue(body),
        headers: { get: vi.fn().mockReturnValue('') },
        url: 'http://localhost:4321/api/account/update-profile',
    },
    cookies: { set: vi.fn(), get: vi.fn() },
});

describe('POST /api/account/update-profile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when user is not authenticated', async () => {
        const mockSupabase = createMockSupabaseClient({
            auth: {
                getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/account/update-profile');
        const response = await POST(makeContext({ fullName: 'Test User' }) as any);
        expect(response.status).toBe(401);
    });

    it('returns 200 on successful profile update', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/account/update-profile');
        const response = await POST(makeContext({ fullName: 'New Name' }) as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });

    it('applies default preferredLanguage=es when not provided', async () => {
        const updateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            update: updateMock,
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/account/update-profile');
        await POST(makeContext({ fullName: 'Test' }) as any);

        expect(updateMock).toHaveBeenCalledWith(
            expect.objectContaining({ preferred_language: 'es' })
        );
    });

    it('applies default timezone=Europe/Madrid when not provided', async () => {
        const updateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            update: updateMock,
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/account/update-profile');
        await POST(makeContext({ fullName: 'Test' }) as any);

        expect(updateMock).toHaveBeenCalledWith(
            expect.objectContaining({ timezone: 'Europe/Madrid' })
        );
    });

    it('includes updated_at in the update payload', async () => {
        const updateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            update: updateMock,
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/account/update-profile');
        await POST(makeContext({ fullName: 'Test' }) as any);

        expect(updateMock).toHaveBeenCalledWith(
            expect.objectContaining({ updated_at: expect.any(String) })
        );
    });

    it('accepts provided preferredLanguage and timezone values', async () => {
        const updateMock = vi.fn().mockReturnThis();
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            update: updateMock,
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const { POST } = await import('../../src/pages/api/account/update-profile');
        await POST(makeContext({ fullName: 'Test', preferredLanguage: 'en', timezone: 'America/New_York' }) as any);

        expect(updateMock).toHaveBeenCalledWith(
            expect.objectContaining({
                preferred_language: 'en',
                timezone: 'America/New_York',
            })
        );
    });
});
