import { vi } from 'vitest';

export const createMockStripe = (overrides: any = {}) => ({
    checkout: {
        sessions: {
            create: vi.fn().mockResolvedValue({
                id: 'cs_test_123',
                url: 'https://checkout.stripe.com/pay/cs_test_123',
            }),
        },
    },
    billingPortal: {
        sessions: {
            create: vi.fn().mockResolvedValue({
                url: 'https://billing.stripe.com/session/test_123',
            }),
        },
    },
    customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_test_123' }),
        retrieve: vi.fn().mockResolvedValue({ id: 'cus_test_123', email: 'test@example.com' }),
    },
    webhooks: {
        constructEvent: vi.fn().mockReturnValue({
            type: 'checkout.session.completed',
            data: { object: { id: 'cs_test_123', customer: 'cus_test_123' } },
        }),
    },
    ...overrides,
});
