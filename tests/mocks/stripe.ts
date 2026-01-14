/**
 * Comprehensive Stripe Mock for Testing
 * 
 * Provides detailed mocks that simulate all Stripe API responses
 * with configurable success/failure scenarios
 */
import { vi } from 'vitest';

// Types for mock configuration
interface MockConfig {
    shouldFail?: boolean;
    failureCode?: string;
    delay?: number;
}

// Mock customer data
export const mockCustomer = {
    id: 'cus_test123456789',
    email: 'test@espanolhonesto.com',
    name: 'Test Student',
    created: 1699999999,
    metadata: {
        supabase_user_id: 'user-uuid-12345',
    },
};

// Mock checkout session
export const mockCheckoutSession = {
    id: 'cs_test_session123',
    url: 'https://checkout.stripe.com/c/pay/cs_test_session123',
    status: 'open',
    payment_status: 'unpaid',
    customer: 'cus_test123456789',
    customer_email: 'test@espanolhonesto.com',
    mode: 'payment',
    success_url: 'https://espanolhonesto.com/success',
    cancel_url: 'https://espanolhonesto.com/cancel',
    metadata: {
        user_id: 'user-uuid-12345',
        package_id: 'intensivo',
        duration_months: '3',
    },
    amount_total: 75600, // 756.00 EUR in cents
    currency: 'eur',
};

// Mock completed checkout session (after successful payment)
export const mockCompletedCheckoutSession = {
    ...mockCheckoutSession,
    id: 'cs_test_completed123',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_test123456',
};

// Mock portal session
export const mockPortalSession = {
    id: 'bps_test123',
    url: 'https://billing.stripe.com/p/session/test_session',
    customer: 'cus_test123456789',
    return_url: 'https://espanolhonesto.com/campus/account',
};

// Mock Stripe webhook event
export const createMockWebhookEvent = (type: string, data: any) => ({
    id: `evt_${Date.now()}`,
    type,
    data: {
        object: data,
    },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
});

// Mock invoice
export const mockInvoice = {
    id: 'in_test123',
    customer: 'cus_test123456789',
    status: 'paid',
    amount_paid: 75600,
    currency: 'eur',
    hosted_invoice_url: 'https://invoice.stripe.com/i/test123',
    invoice_pdf: 'https://invoice.stripe.com/i/test123/pdf',
};

// Stripe error responses
export const stripeErrors = {
    card_declined: {
        type: 'StripeCardError',
        code: 'card_declined',
        message: 'Your card was declined.',
    },
    insufficient_funds: {
        type: 'StripeCardError',
        code: 'insufficient_funds',
        message: 'Your card has insufficient funds.',
    },
    invalid_customer: {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        message: 'No such customer: cus_invalid',
    },
    webhook_error: {
        type: 'StripeSignatureVerificationError',
        message: 'Webhook signature verification failed.',
    },
};

/**
 * Creates a comprehensive mock Stripe client
 */
export const createMockStripeClient = (config: MockConfig = {}) => {
    const { shouldFail = false, failureCode = 'card_declined', delay = 0 } = config;

    const withDelay = async <T>(value: T): Promise<T> => {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (shouldFail) {
            throw stripeErrors[failureCode as keyof typeof stripeErrors] || stripeErrors.card_declined;
        }
        return value;
    };

    return {
        customers: {
            create: vi.fn().mockImplementation((params) =>
                withDelay({ ...mockCustomer, email: params.email, name: params.name })
            ),
            retrieve: vi.fn().mockImplementation((id) =>
                withDelay(id === 'cus_invalid' ? null : mockCustomer)
            ),
            update: vi.fn().mockImplementation((id, params) =>
                withDelay({ ...mockCustomer, ...params })
            ),
            del: vi.fn().mockImplementation(() =>
                withDelay({ id: mockCustomer.id, deleted: true })
            ),
        },
        checkout: {
            sessions: {
                create: vi.fn().mockImplementation((params) =>
                    withDelay({
                        ...mockCheckoutSession,
                        metadata: params.metadata,
                        success_url: params.success_url,
                        cancel_url: params.cancel_url,
                    })
                ),
                retrieve: vi.fn().mockImplementation((id) =>
                    withDelay(id.includes('completed') ? mockCompletedCheckoutSession : mockCheckoutSession)
                ),
                expire: vi.fn().mockImplementation(() =>
                    withDelay({ ...mockCheckoutSession, status: 'expired' })
                ),
            },
        },
        billingPortal: {
            sessions: {
                create: vi.fn().mockImplementation((params) =>
                    withDelay({ ...mockPortalSession, return_url: params.return_url })
                ),
            },
        },
        webhooks: {
            constructEvent: vi.fn().mockImplementation((payload, sig, secret) => {
                if (sig === 'invalid_signature') {
                    throw stripeErrors.webhook_error;
                }
                return JSON.parse(payload);
            }),
        },
        invoices: {
            retrieve: vi.fn().mockImplementation(() => withDelay(mockInvoice)),
            list: vi.fn().mockImplementation(() => withDelay({ data: [mockInvoice] })),
        },
        paymentIntents: {
            retrieve: vi.fn().mockImplementation(() =>
                withDelay({
                    id: 'pi_test123',
                    status: 'succeeded',
                    amount: 75600,
                    currency: 'eur',
                })
            ),
        },
    };
};

/**
 * Helper to create mock webhook payload
 */
export const createMockWebhookPayload = (eventType: string, data: any) => ({
    body: JSON.stringify(createMockWebhookEvent(eventType, data)),
    headers: {
        'stripe-signature': 'valid_signature_mock',
    },
});

/**
 * Helper to simulate webhook verification
 */
export const mockVerifyWebhook = (client: ReturnType<typeof createMockStripeClient>) => {
    return (payload: string, signature: string) => {
        return client.webhooks.constructEvent(payload, signature, 'whsec_test');
    };
};

export default createMockStripeClient;
