import type { APIRoute } from 'astro';
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

export const GET: APIRoute = async (context) => {
    const appEnvironment = readRuntimeEnv('PUBLIC_APP_ENV', context);
    const workerIdentity = readRuntimeEnv('WORKER_IDENTITY', context);
    const runtimeMode = readRuntimeEnv('WEB_RUNTIME_MODE', context);
    const checkoutEnabled = readRuntimeEnv('CHECKOUT_ENABLED', context);
    const checkoutOverride = readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE', context);

    const expectedIdentity = appEnvironment === 'staging'
        ? 'espanolhonesto-staging'
        : appEnvironment === 'production'
            ? 'espanolhonesto'
            : null;
    const validMode = appEnvironment === 'staging'
        ? runtimeMode === 'active'
        : appEnvironment === 'production'
            ? runtimeMode === 'bootstrap' || runtimeMode === 'active'
            : false;
    const healthy = Boolean(
        expectedIdentity
        && workerIdentity === expectedIdentity
        && validMode
        && checkoutEnabled === 'false'
        && checkoutOverride === 'false',
    );

    return json(healthy ? 200 : 503, {
        appEnvironment: appEnvironment ?? 'invalid',
        checkoutEnabled: false,
        runtimeMode: runtimeMode ?? 'invalid',
        status: healthy ? 'ok' : 'invalid',
        workerIdentity: workerIdentity ?? 'invalid',
    });
};
