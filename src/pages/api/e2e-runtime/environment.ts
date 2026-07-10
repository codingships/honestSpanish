import type { APIRoute } from 'astro';
import { shouldDisableExternalIntegrations } from '../../../lib/external-integrations';
import { readRuntimeEnv } from '../../../lib/runtime-env';

function supabaseProjectRef(value: string | undefined): string | null {
    if (!value) return null;

    try {
        const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(new URL(value).hostname);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

export const GET: APIRoute = (context) => {
    if (!__E2E_RUNTIME_BUILD__) {
        return new Response(null, { status: 404 });
    }

    const importMetaEnv = import.meta.env as ImportMetaEnv & Record<string, string | undefined>;
    const runtimeIsolationEnabled = readRuntimeEnv('E2E_RUNTIME_ISOLATED', context) === 'true';
    const externalIntegrationsDisabled = shouldDisableExternalIntegrations();
    const appEnv = readRuntimeEnv('PUBLIC_APP_ENV', context);
    const checkoutEnabled = (readRuntimeEnv('CHECKOUT_ENABLED', context) ?? 'false') === 'true';
    const importMetaSupabaseRef = supabaseProjectRef(importMetaEnv.PUBLIC_SUPABASE_URL);
    const runtimeSupabaseRef = supabaseProjectRef(readRuntimeEnv('PUBLIC_SUPABASE_URL', context));
    const providerCredentialsPresent = [
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'RESEND_API_KEY',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'FULFILLMENT_WORKER_URL',
        'INTERNAL_JOB_SECRET',
        'SENTRY_AUTH_TOKEN',
        'CRON_SECRET',
    ].some((key) => Boolean(readRuntimeEnv(key, context)));

    return Response.json({
        appEnv,
        checkoutEnabled,
        externalIntegrationsDisabled,
        runtimeIsolationEnabled,
        importMetaSupabaseRef,
        runtimeSupabaseRef,
        targetSupabaseRef: readRuntimeEnv('E2E_TARGET_SUPABASE_REF', context) ?? null,
        providerCredentialsPresent,
    }, {
        headers: { 'Cache-Control': 'no-store' },
    });
};
