import { describe, expect, it } from 'vitest';
import {
    inspectStripeLiveReadiness,
    PRODUCTION_STRIPE_WEBHOOK_URL,
    type StripeLiveReadClient,
} from '../../scripts/launch/stripe-live-readiness';
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from '../../src/lib/stripe-webhook-events';

function client(overrides: {
    account?: Record<string, unknown>;
    portal?: Record<string, unknown>;
    endpoints?: Array<Record<string, unknown>>;
} = {}): StripeLiveReadClient {
    const account = {
        id: 'acct_live_expected',
        country: 'ES',
        default_currency: 'eur',
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
        ...overrides.account,
    };
    const portal = {
        id: 'bpc_live_expected',
        active: true,
        features: {
            payment_method_update: { enabled: true },
            invoice_history: { enabled: true },
            subscription_cancel: { enabled: true, mode: 'at_period_end' },
            subscription_update: { enabled: false },
        },
        ...overrides.portal,
    };
    const endpoints = overrides.endpoints ?? [{
        id: 'we_live_expected',
        status: 'enabled',
        url: PRODUCTION_STRIPE_WEBHOOK_URL,
        enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS],
    }];
    return {
        accounts: { retrieve: async () => account },
        billingPortal: { configurations: { retrieve: async () => portal } },
        webhookEndpoints: { list: async () => ({ data: endpoints }) },
    } as unknown as StripeLiveReadClient;
}

describe('Stripe live read-only readiness', () => {
    it('accepts only an activated Spain/EUR account with exact Portal and webhook', async () => {
        const result = await inspectStripeLiveReadiness(
            client(),
            'acct_live_expected',
            'bpc_live_expected',
        );
        expect(result).toEqual(expect.objectContaining({
            ok: true,
            failures: [],
            facts: expect.objectContaining({
                accountMatched: true,
                accountReady: true,
                country: 'ES',
                currency: 'eur',
                enabledWebhookCount: 1,
                portalMatched: true,
                webhookMatched: true,
            }),
        }));
    });

    it('fails closed on account, activation, Portal, duplicate endpoint or event drift', async () => {
        const result = await inspectStripeLiveReadiness(client({
            account: {
                id: 'acct_wrong',
                country: 'US',
                default_currency: 'usd',
                payouts_enabled: false,
            },
            portal: { active: false },
            endpoints: [
                {
                    id: 'we_one',
                    status: 'enabled',
                    url: PRODUCTION_STRIPE_WEBHOOK_URL,
                    enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS, 'customer.created'],
                },
                {
                    id: 'we_two',
                    status: 'enabled',
                    url: 'https://old.example.com/api/stripe-webhook',
                    enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS],
                },
            ],
        }), 'acct_live_expected', 'bpc_live_expected');

        expect(result.ok).toBe(false);
        expect(result.failures).toEqual(expect.arrayContaining([
            'stripe_account_mismatch',
            'stripe_account_country_not_es',
            'stripe_account_currency_not_eur',
            'stripe_account_not_charge_and_payout_ready',
            'stripe_portal_configuration_not_launch_safe',
            'stripe_webhook_not_exact',
        ]));
    });
});
