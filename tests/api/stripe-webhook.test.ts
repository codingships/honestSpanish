import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock de Stripe Lib local para evitar que crashee por falta de .env
vi.mock('../../src/lib/stripe', () => {
    return {
        stripe: {
            webhooks: {
                constructEvent: vi.fn()
            }
        }
    };
});

// Mock de Supabase para evitar crash por variables de entorno indefinidas (URL)
vi.mock('@supabase/supabase-js', () => {
    return {
        createClient: vi.fn().mockReturnValue({})
    };
});

describe('POST /api/stripe-webhook', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test_secret_key_123');
    });

    it('returns 400 when missing Stripe-Signature header', async () => {
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        // Contexto falso sin el Header de Stripe
        const mockContext = {
            request: {
                text: vi.fn().mockResolvedValue('{"some":"payload"}'),
                headers: {
                    get: vi.fn().mockReturnValue(null) // Simular ausencia de firma
                }
            }
        };

        const response = await POST(mockContext as any);
        expect(response.status).toBe(400);

        const text = await response.text();
        expect(text).toContain('Missing stripe-signature header');
    });

    it('returns 400 on Webhook Signature verification failure (Hacker payload)', async () => {
        const { POST } = await import('../../src/pages/api/stripe-webhook');

        // Forzamos al mock a tirar un error de validación (firma incorrecta o secreta mala)
        const stripeModule = await import('../../src/lib/stripe');
        stripeModule.stripe.webhooks.constructEvent = vi.fn().mockImplementation(() => {
            throw new Error('Firma Invalida');
        });

        const mockContext = {
            request: {
                text: vi.fn().mockResolvedValue('{"id":"evt_fake","type":"checkout.session.completed"}'),
                headers: {
                    get: vi.fn().mockReturnValue('t=123,v1=fake_signature_hash')
                }
            }
        };

        const response = await POST(mockContext as any);
        expect(response.status).toBe(400);

        const text = await response.text();
        expect(text).toContain('Webhook Error');
    });
});
