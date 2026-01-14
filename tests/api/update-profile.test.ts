import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

describe('POST /api/account/update-profile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 401 if user is not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ fullName: 'New Name' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/account/update-profile');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should update profile successfully', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({
                fullName: 'Updated Name',
                phone: '+34612345678',
                preferredLanguage: 'en',
                timezone: 'Europe/London',
            }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/account/update-profile');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
    });
});
