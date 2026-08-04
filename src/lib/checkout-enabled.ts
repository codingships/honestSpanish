import type { APIContext } from 'astro';
import { isLegalIdentityProductionReady } from './legal-identity';
import { readRuntimeEnv } from './runtime-env';

type CheckoutContext = Pick<APIContext, 'locals'>;

export function isCheckoutEnabled(context?: CheckoutContext): boolean {
    const override = readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE', context)?.trim().toLowerCase();
    const requested = override !== undefined
        ? override === 'true'
        : readRuntimeEnv('CHECKOUT_ENABLED', context)?.trim().toLowerCase() === 'true';

    if (
        requested
        && readRuntimeEnv('PUBLIC_APP_ENV', context)?.trim().toLowerCase() === 'production'
        && !isLegalIdentityProductionReady()
    ) return false;

    return requested;
}
