import type { APIRoute } from 'astro';
import { isCheckoutEnabled } from '../lib/checkout-enabled';
import { isLegalIdentityProductionReady } from '../lib/legal-identity';
import { readRuntimeEnv } from '../lib/runtime-env';

export const prerender = false;

function json(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
    });
}

function booleanFlag(value: string | undefined): boolean | null {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
}

export const GET: APIRoute = async (context) => {
    const appEnvironment = readRuntimeEnv('PUBLIC_APP_ENV', context);
    const workerIdentity = readRuntimeEnv('WORKER_IDENTITY', context);
    const runtimeMode = readRuntimeEnv('WEB_RUNTIME_MODE', context);
    const checkoutConfigured = booleanFlag(readRuntimeEnv('CHECKOUT_ENABLED', context));
    const checkoutOverride = booleanFlag(readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE', context));
    const checkoutEnabled = isCheckoutEnabled(context);
    const legalIdentityReady = appEnvironment !== 'production'
        || isLegalIdentityProductionReady();

    const expectedIdentity = appEnvironment === 'staging'
        ? 'espanolhonesto-staging'
        : appEnvironment === 'production'
            ? 'espanolhonesto'
            : null;
    const validMode = appEnvironment === 'staging'
        ? runtimeMode === 'active'
        : appEnvironment === 'production'
            ? runtimeMode === 'active'
            : false;
    const validCheckout = checkoutConfigured !== null
        && checkoutOverride !== null
        && (
            appEnvironment !== 'staging'
            || checkoutConfigured === checkoutOverride
        );
    const healthy = Boolean(
        expectedIdentity
        && workerIdentity === expectedIdentity
        && validMode
        && validCheckout
        && legalIdentityReady,
    );

    return json(healthy ? 200 : 503, {
        appEnvironment: appEnvironment ?? 'invalid',
        checkoutEnabled,
        legalIdentityReady,
        runtimeMode: runtimeMode ?? 'invalid',
        status: healthy ? 'ok' : 'invalid',
        workerIdentity: workerIdentity ?? 'invalid',
    });
};
