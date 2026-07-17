import type { APIContext } from 'astro';
import { readRuntimeEnv } from './runtime-env';

export interface StripeRuntimeContext {
    accountId: string;
    appEnvironment: string;
    livemode: boolean;
}

export function assertStripeRuntimeAccount(
    context: Pick<APIContext, 'locals'>,
    account: {
        id: string;
        country?: string | null;
        charges_enabled?: boolean;
        details_submitted?: boolean;
        payouts_enabled?: boolean;
    }
): StripeRuntimeContext {
    const appEnvironment = (readRuntimeEnv('PUBLIC_APP_ENV', context) ?? 'dev').trim().toLowerCase();
    const nodeEnvironment = (readRuntimeEnv('NODE_ENV', context) ?? '').trim().toLowerCase();
    const expectedAccountId = readRuntimeEnv('STRIPE_EXPECTED_ACCOUNT_ID', context);
    const secretKey = readRuntimeEnv('STRIPE_SECRET_KEY', context);
    const knownKeyMode = secretKey?.startsWith('sk_live_')
        ? 'live'
        : secretKey?.startsWith('sk_test_')
            ? 'test'
            : null;

    if (!['dev', 'test', 'staging', 'production'].includes(appEnvironment)) {
        throw new Error('Invalid PUBLIC_APP_ENV for Stripe operations');
    }
    if (nodeEnvironment === 'production' && !['staging', 'production'].includes(appEnvironment)) {
        throw new Error('Production runtime requires an explicit Stripe app environment');
    }
    if (!knownKeyMode) {
        throw new Error('Stripe key mode could not be verified');
    }

    if (['staging', 'production'].includes(appEnvironment)) {
        if (!expectedAccountId) {
            throw new Error('Missing STRIPE_EXPECTED_ACCOUNT_ID for deployed Stripe operations');
        }
    }

    if (expectedAccountId && account.id !== expectedAccountId) {
        throw new Error('Stripe account does not match STRIPE_EXPECTED_ACCOUNT_ID');
    }

    const livemode = knownKeyMode === 'live';
    if (livemode && appEnvironment !== 'production') {
        throw new Error('Stripe live keys are forbidden outside production');
    }

    if (appEnvironment === 'production') {
        if (!livemode) {
            throw new Error('Stripe test keys are forbidden for production billing sync');
        }
        if (account.country?.toUpperCase() !== 'ES') {
            throw new Error('Production Stripe account must be registered in Spain');
        }
    }

    return { accountId: account.id, appEnvironment, livemode };
}

export function assertStripePaymentReadiness(account: {
    charges_enabled?: boolean;
    details_submitted?: boolean;
    payouts_enabled?: boolean;
}): void {
    if (!account.details_submitted || !account.charges_enabled || !account.payouts_enabled) {
        throw new Error('Stripe account is not ready for charges and payouts');
    }
}
