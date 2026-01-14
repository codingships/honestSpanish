import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient, createUnauthenticatedMockClient } from '../mocks/supabase';
import { createMockStripeClient } from '../mocks/stripe';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        billingPortal: {
            sessions: {
                create: vi.fn().mockResolvedValue({
                    url: 'https://billing.stripe.com/session/mock',
                }),
            },
        },
    },
}));

describe('POST /api/account/create-portal-session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 401 if user is not authenticated', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createUnauthenticatedMockClient() as any);

        const mockRequest = {
            headers: {
                get: vi.fn().mockReturnValue('http://localhost:4321'),
            },
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(401);
    });

    it('should return 400 if user has no Stripe customer ID', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { stripe_customer_id: null }, error: null }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            headers: {
                get: vi.fn().mockReturnValue('http://localhost:4321'),
            },
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('No Stripe customer found');
    });

    it('should create portal session successfully', async () => {
        const mockSupabase = createMockSupabaseClient();
        mockSupabase.from = vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
                data: { stripe_customer_id: 'cus_123' },
                error: null
            }),
        });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(mockSupabase as any);

        const mockRequest = {
            headers: {
                get: vi.fn().mockReturnValue('http://localhost:4321'),
            },
        };

        const mockContext = {
            request: mockRequest,
            cookies: { set: vi.fn() },
        };

        const { POST } = await import('../../src/pages/api/account/create-portal-session');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.url).toBeDefined();
        expect(body.url).toContain('stripe.com');
    });
});
