export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
    'checkout.session.completed',
    'checkout.session.expired',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.upcoming',
    'charge.refunded',
    'refund.created',
    'refund.updated',
    'refund.failed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
] as const;

export type RequiredStripeWebhookEvent = typeof REQUIRED_STRIPE_WEBHOOK_EVENTS[number];

export function isRequiredStripeWebhookEvent(value: string): value is RequiredStripeWebhookEvent {
    return (REQUIRED_STRIPE_WEBHOOK_EVENTS as readonly string[]).includes(value);
}
