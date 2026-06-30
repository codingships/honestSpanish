import type { APIContext } from 'astro';
import { getEnv } from 'astro/env/runtime';

type RuntimeEnv = Record<string, string | undefined>;
type KnownImportMetaEnv = ImportMetaEnv & {
    ADMIN_EMAIL?: string;
    CHECKOUT_ENABLED?: string;
    CRON_SECRET?: string;
    DEMO_GUIDE_ENABLED?: string;
    EMAIL_FROM?: string;
    FULFILLMENT_WORKER_URL?: string;
    GOOGLE_ADMIN_EMAIL?: string;
    GOOGLE_DRIVE_ROOT_FOLDER_ID?: string;
    GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
    GOOGLE_TEMPLATE_DOC_ID?: string;
    INTERNAL_JOB_SECRET?: string;
    INTERNAL_JOB_SERVICE_URL?: string;
    PUBLIC_SITE_URL?: string;
    PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
    PUBLIC_SUPABASE_ANON_KEY?: string;
    PUBLIC_SUPABASE_URL?: string;
    PUBLIC_SENTRY_DSN?: string;
    PUBLIC_TURNSTILE_SITE_KEY?: string;
    PUBLIC_URL?: string;
    RESEND_API_KEY?: string;
    RESEND_FROM_EMAIL?: string;
    SENTRY_AUTH_TOKEN?: string;
    SITE?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    SUPPORT_ALERT_EMAIL?: string;
    TURNSTILE_SECRET_KEY?: string;
};
type RuntimeLocals = {
    runtime?: {
        env?: RuntimeEnv;
    };
};

let currentRuntimeEnv: RuntimeEnv | null = null;

function getProcessEnvValue(key: string): string | undefined {
    const processLike = globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
    };

    return processLike.process?.env?.[key];
}

function getImportMetaEnvValue(key: string): string | undefined {
    const env = (import.meta as ImportMeta & { env?: KnownImportMetaEnv }).env;
    if (!env) return undefined;

    switch (key) {
        case 'ADMIN_EMAIL': return env.ADMIN_EMAIL;
        case 'CHECKOUT_ENABLED': return env.CHECKOUT_ENABLED;
        case 'CRON_SECRET': return env.CRON_SECRET;
        case 'DEMO_GUIDE_ENABLED': return env.DEMO_GUIDE_ENABLED;
        case 'EMAIL_FROM': return env.EMAIL_FROM;
        case 'FULFILLMENT_WORKER_URL': return env.FULFILLMENT_WORKER_URL;
        case 'GOOGLE_ADMIN_EMAIL': return env.GOOGLE_ADMIN_EMAIL;
        case 'GOOGLE_DRIVE_ROOT_FOLDER_ID': return env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
        case 'GOOGLE_SERVICE_ACCOUNT_EMAIL': return env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        case 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY': return env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
        case 'GOOGLE_TEMPLATE_DOC_ID': return env.GOOGLE_TEMPLATE_DOC_ID;
        case 'INTERNAL_JOB_SECRET': return env.INTERNAL_JOB_SECRET;
        case 'INTERNAL_JOB_SERVICE_URL': return env.INTERNAL_JOB_SERVICE_URL;
        case 'PUBLIC_SITE_URL': return env.PUBLIC_SITE_URL;
        case 'PUBLIC_STRIPE_PUBLISHABLE_KEY': return env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
        case 'PUBLIC_SUPABASE_ANON_KEY': return env.PUBLIC_SUPABASE_ANON_KEY;
        case 'PUBLIC_SUPABASE_URL': return env.PUBLIC_SUPABASE_URL;
        case 'PUBLIC_SENTRY_DSN': return env.PUBLIC_SENTRY_DSN;
        case 'PUBLIC_TURNSTILE_SITE_KEY': return env.PUBLIC_TURNSTILE_SITE_KEY;
        case 'PUBLIC_URL': return env.PUBLIC_URL;
        case 'RESEND_API_KEY': return env.RESEND_API_KEY;
        case 'RESEND_FROM_EMAIL': return env.RESEND_FROM_EMAIL;
        case 'SENTRY_AUTH_TOKEN': return env.SENTRY_AUTH_TOKEN;
        case 'SITE': return env.SITE;
        case 'STRIPE_SECRET_KEY': return env.STRIPE_SECRET_KEY;
        case 'STRIPE_WEBHOOK_SECRET': return env.STRIPE_WEBHOOK_SECRET;
        case 'SUPABASE_SERVICE_ROLE_KEY': return env.SUPABASE_SERVICE_ROLE_KEY;
        case 'SUPPORT_ALERT_EMAIL': return env.SUPPORT_ALERT_EMAIL;
        case 'TURNSTILE_SECRET_KEY': return env.TURNSTILE_SECRET_KEY;
        default: return undefined;
    }
}

function getAstroEnvValue(key: string): string | undefined {
    try {
        return getEnv(key);
    } catch {
        return undefined;
    }
}

function getContextEnv(context?: Pick<APIContext, 'locals'>): RuntimeEnv | null {
    try {
        const runtime = (context?.locals as RuntimeLocals | undefined)?.runtime;
        return runtime?.env ?? null;
    } catch {
        return null;
    }
}

export function setRuntimeEnvFromContext(context: Pick<APIContext, 'locals'>): void {
    const env = getContextEnv(context);
    if (env) {
        currentRuntimeEnv = env;
    }
}

export function readRuntimeEnv(key: string, context?: Pick<APIContext, 'locals'>): string | undefined {
    const contextEnv = getContextEnv(context);
    const value = contextEnv?.[key] ??
        currentRuntimeEnv?.[key] ??
        getAstroEnvValue(key) ??
        getImportMetaEnvValue(key) ??
        getProcessEnvValue(key);

    if (value === undefined || value === '') {
        return undefined;
    }

    return value;
}

export function requireRuntimeEnv(key: string, context?: Pick<APIContext, 'locals'>): string {
    const value = readRuntimeEnv(key, context);
    if (!value) {
        throw new Error(`Missing ${key} environment variable`);
    }

    return value;
}
