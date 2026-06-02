import Stripe from 'stripe';
import { requireRuntimeEnv } from './runtime-env';

let cachedStripeKey: string | null = null;
let cachedStripeClient: Stripe | null = null;

export function getStripe(): Stripe {
    const stripeSecretKey = requireRuntimeEnv('STRIPE_SECRET_KEY');

    if (cachedStripeClient && cachedStripeKey === stripeSecretKey) {
        return cachedStripeClient;
    }

    cachedStripeKey = stripeSecretKey;
    cachedStripeClient = new Stripe(stripeSecretKey, {
        apiVersion: '2026-02-25.clover',
    });

    return cachedStripeClient;
}

export const stripe = new Proxy({} as Stripe, {
    get(_target, property) {
        const client = getStripe();
        const value = client[property as keyof Stripe];
        return typeof value === 'function' ? value.bind(client) : value;
    },
    set(_target, property, value) {
        const client = getStripe();
        (client as unknown as Record<PropertyKey, unknown>)[property] = value;
        return true;
    },
});
