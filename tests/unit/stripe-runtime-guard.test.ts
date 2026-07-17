import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeEnv = vi.hoisted(() => ({
    values: {} as Record<string, string | undefined>,
    readRuntimeEnv: vi.fn((key: string) => runtimeEnv.values[key]),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: runtimeEnv.readRuntimeEnv,
}));

describe('Stripe runtime guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeEnv.values = {
            PUBLIC_APP_ENV: 'staging',
            STRIPE_SECRET_KEY: 'sk_test_example',
            STRIPE_EXPECTED_ACCOUNT_ID: 'acct_staging',
        };
    });

    it('accepts the exact test account in staging', async () => {
        const { assertStripePaymentReadiness, assertStripeRuntimeAccount } = await import('../../src/lib/stripe-runtime-guard');
        expect(assertStripeRuntimeAccount({ locals: {} } as any, {
            id: 'acct_staging',
            country: 'US',
        })).toEqual({
            accountId: 'acct_staging',
            appEnvironment: 'staging',
            livemode: false,
        });
    });

    it('forbids live keys outside production even when the account matches', async () => {
        runtimeEnv.values.STRIPE_SECRET_KEY = 'sk_live_example';
        const { assertStripePaymentReadiness, assertStripeRuntimeAccount } = await import('../../src/lib/stripe-runtime-guard');
        expect(() => assertStripeRuntimeAccount({ locals: {} } as any, {
            id: 'acct_staging',
            country: 'ES',
        })).toThrow(/outside production/);
    });

    it('requires a Spanish, fully enabled account in production', async () => {
        runtimeEnv.values = {
            PUBLIC_APP_ENV: 'production',
            STRIPE_SECRET_KEY: 'sk_live_example',
            STRIPE_EXPECTED_ACCOUNT_ID: 'acct_live',
        };
        const { assertStripePaymentReadiness, assertStripeRuntimeAccount } = await import('../../src/lib/stripe-runtime-guard');

        const disabledAccount = {
            id: 'acct_live',
            country: 'ES',
            details_submitted: true,
            charges_enabled: false,
            payouts_enabled: true,
        };
        expect(assertStripeRuntimeAccount({ locals: {} } as any, disabledAccount).livemode).toBe(true);
        expect(() => assertStripePaymentReadiness(disabledAccount)).toThrow(/not ready/);

        const readyAccount = {
            id: 'acct_live',
            country: 'ES',
            details_submitted: true,
            charges_enabled: true,
            payouts_enabled: true,
        };
        assertStripePaymentReadiness(readyAccount);
    });
});
