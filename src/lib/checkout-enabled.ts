import type { APIContext } from 'astro';
import { readRuntimeEnv } from './runtime-env';

type CheckoutContext = Pick<APIContext, 'locals'>;

export function isCheckoutEnabled(context?: CheckoutContext): boolean {
    const override = readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE', context)?.trim().toLowerCase();
    if (override !== undefined) return override === 'true';

    return readRuntimeEnv('CHECKOUT_ENABLED', context)?.trim().toLowerCase() === 'true';
}
