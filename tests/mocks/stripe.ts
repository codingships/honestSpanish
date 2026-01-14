import { vi } from 'vitest';

export const createMockStripeClient = () => ({
    customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_mock123' }),
    },
    checkout: {
        sessions: {
            create: vi.fn().mockResolvedValue({
                id: 'cs_mock123',
                url: 'https://checkout.stripe.com/mock',
            }),
        },
    },
    webhooks: {
        constructEvent: vi.fn(),
    },
});
