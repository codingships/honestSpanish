import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';
import { createMockStripeClient } from '../mocks/stripe';

// Mock the modules
vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: createMockStripeClient(),
}));

describe('POST /api/create-checkout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 if priceId is missing', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createMockSupabaseClient() as any);

        // Simulate the request
        const mockRequest = {
            json: vi.fn().mockResolvedValue({ lang: 'es' }), // No priceId
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('priceId is required');
    });

    it('should return 401 if user is not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ priceId: 'price_123', lang: 'es' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should create checkout session for authenticated user', async () => {
        const mockSupabase = createMockSupabaseClient();
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            json: vi.fn().mockResolvedValue({ priceId: 'price_123', lang: 'es' }),
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/create-checkout');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.url).toBeDefined();
    });
});
