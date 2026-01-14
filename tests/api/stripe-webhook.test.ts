import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockStripeClient } from '../mocks/stripe';

// Mock environment variables
vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_secret');

// Mock Stripe
vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        webhooks: {
            constructEvent: vi.fn(),
        },
    },
}));

// Mock Supabase Admin (service role)
vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => ({
        from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            insert: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
                data: {
                    id: 'pkg-1',
                    name: 'Basic',
                    sessions_per_month: 7,
                    stripe_price_1m: 'price_1m',
                    stripe_price_3m: 'price_3m',
                    stripe_price_6m: 'price_6m',
                },
                error: null,
            }),
        }),
    })),
}));

describe('POST /api/stripe-webhook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return 400 if stripe-signature header is missing', async () => {
        const mockRequest = {
            text: vi.fn().mockResolvedValue('{}'),
            headers: {
                get: vi.fn().mockReturnValue(null), // No signature
            },
        };

        const mockContext = {
            request: mockRequest,
        };

        const { POST } = await import('../../src/pages/api/stripe-webhook');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
        const body = await response.text();
        expect(body).toContain('signature');
    });

    it('should return 400 if signature verification fails', async () => {
        const { stripe } = await import('../../src/lib/stripe');
        vi.mocked(stripe.webhooks.constructEvent).mockImplementation(() => {
            throw new Error('Invalid signature');
        });

        const mockRequest = {
            text: vi.fn().mockResolvedValue('{}'),
            headers: {
                get: vi.fn().mockReturnValue('valid-signature'),
            },
        };

        const mockContext = {
            request: mockRequest,
        };

        const { POST } = await import('../../src/pages/api/stripe-webhook');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(400);
    });

    it('should return 200 and process checkout.session.completed event', async () => {
        const mockSession = {
            id: 'cs_mock',
            metadata: {
                userId: 'user-123',
                priceId: 'price_1m',
                lang: 'es',
            },
            amount_total: 16000,
            currency: 'eur',
            payment_intent: 'pi_mock',
            invoice: 'inv_mock',
        };

        const { stripe } = await import('../../src/lib/stripe');
        vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
            type: 'checkout.session.completed',
            data: { object: mockSession },
        } as any);

        const mockRequest = {
            text: vi.fn().mockResolvedValue(JSON.stringify(mockSession)),
            headers: {
                get: vi.fn().mockReturnValue('valid-stripe-signature'),
            },
        };

        const mockContext = {
            request: mockRequest,
        };

        const { POST } = await import('../../src/pages/api/stripe-webhook');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.received).toBe(true);
    });

    it('should ignore non-checkout events', async () => {
        const { stripe } = await import('../../src/lib/stripe');
        vi.mocked(stripe.webhooks.constructEvent).mockReturnValue({
            type: 'customer.created',
            data: { object: {} },
        } as any);

        const mockRequest = {
            text: vi.fn().mockResolvedValue('{}'),
            headers: {
                get: vi.fn().mockReturnValue('valid-signature'),
            },
        };

        const mockContext = {
            request: mockRequest,
        };

        const { POST } = await import('../../src/pages/api/stripe-webhook');
        const response = await POST(mockContext as any);

        expect(response.status).toBe(200);
    });
});
