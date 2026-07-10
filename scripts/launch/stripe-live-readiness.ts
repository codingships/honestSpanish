import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from '../../src/lib/stripe-webhook-events';

export const PRODUCTION_STRIPE_WEBHOOK_URL = 'https://espanolhonesto.com/api/stripe-webhook';

type StripeAccount = {
    id: string;
    country?: string | null;
    default_currency?: string | null;
    charges_enabled?: boolean;
    details_submitted?: boolean;
    payouts_enabled?: boolean;
};

type PortalConfiguration = {
    id: string;
    active: boolean;
    features: {
        invoice_history: { enabled: boolean };
        payment_method_update: { enabled: boolean };
        subscription_cancel: { enabled: boolean; mode: string };
        subscription_update: { enabled: boolean };
    };
};

type WebhookEndpoint = {
    id: string;
    enabled_events: string[];
    status: string;
    url: string;
};

export type StripeLiveReadClient = {
    accounts: { retrieve(): Promise<StripeAccount> };
    billingPortal: {
        configurations: { retrieve(id: string): Promise<PortalConfiguration> };
    };
    webhookEndpoints: {
        list(options: { limit: number }): Promise<{ data: WebhookEndpoint[] }>;
    };
};

export type StripeLiveReadiness = {
    ok: boolean;
    failures: string[];
    facts: {
        accountMatched: boolean;
        accountReady: boolean;
        country: string;
        currency: string;
        enabledWebhookCount: number;
        portalMatched: boolean;
        webhookMatched: boolean;
    };
};

/**
 * Fresh read-only proof used immediately before production runtime writes.
 * It deliberately returns only non-secret launch facts.
 */
export async function inspectStripeLiveReadiness(
    stripe: StripeLiveReadClient,
    expectedAccountId: string,
    expectedPortalConfigurationId: string,
): Promise<StripeLiveReadiness> {
    const failures: string[] = [];
    const [account, portal, endpoints] = await Promise.all([
        stripe.accounts.retrieve(),
        stripe.billingPortal.configurations.retrieve(expectedPortalConfigurationId),
        stripe.webhookEndpoints.list({ limit: 100 }),
    ]);

    const accountMatched = account.id === expectedAccountId;
    const country = account.country?.toUpperCase() ?? 'unknown';
    const currency = account.default_currency?.toLowerCase() ?? 'unknown';
    const accountReady = account.details_submitted === true
        && account.charges_enabled === true
        && account.payouts_enabled === true;
    if (!accountMatched) failures.push('stripe_account_mismatch');
    if (country !== 'ES') failures.push('stripe_account_country_not_es');
    if (currency !== 'eur') failures.push('stripe_account_currency_not_eur');
    if (!accountReady) failures.push('stripe_account_not_charge_and_payout_ready');

    const portalMatched = portal.id === expectedPortalConfigurationId
        && portal.active
        && portal.features.payment_method_update.enabled
        && portal.features.invoice_history.enabled
        && portal.features.subscription_cancel.enabled
        && portal.features.subscription_cancel.mode === 'at_period_end'
        && !portal.features.subscription_update.enabled;
    if (!portalMatched) failures.push('stripe_portal_configuration_not_launch_safe');

    const enabled = endpoints.data.filter((endpoint) => endpoint.status === 'enabled');
    const webhook = enabled[0];
    const webhookMatched = enabled.length === 1
        && webhook.url === PRODUCTION_STRIPE_WEBHOOK_URL
        && webhook.enabled_events.length === REQUIRED_STRIPE_WEBHOOK_EVENTS.length
        && REQUIRED_STRIPE_WEBHOOK_EVENTS.every((event) => webhook.enabled_events.includes(event));
    if (!webhookMatched) failures.push('stripe_webhook_not_exact');

    return {
        ok: failures.length === 0,
        failures,
        facts: {
            accountMatched,
            accountReady,
            country,
            currency,
            enabledWebhookCount: enabled.length,
            portalMatched,
            webhookMatched,
        },
    };
}
