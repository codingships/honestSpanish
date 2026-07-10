export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
    'checkout.session.completed',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.upcoming',
    'charge.refunded',
    'customer.subscription.updated',
    'customer.subscription.deleted',
] as const;

export type RequiredStripeWebhookEvent = typeof REQUIRED_STRIPE_WEBHOOK_EVENTS[number];

export function isRequiredStripeWebhookEvent(value: string): value is RequiredStripeWebhookEvent {
    return (REQUIRED_STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(value);
}
