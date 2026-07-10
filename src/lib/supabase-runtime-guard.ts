import type { APIContext } from 'astro';
import { readRuntimeEnv, requireRuntimeEnv } from './runtime-env';

const DEPLOYED_ENVIRONMENTS = new Set(['staging', 'production']);

export function supabaseProjectRef(value: string | undefined): string | null {
    if (!value) return null;

    try {
        const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(new URL(value).hostname);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

export function getSupabaseRuntimeConfig(context?: Pick<APIContext, 'locals'>) {
    const appEnvironment = (readRuntimeEnv('PUBLIC_APP_ENV', context) ?? 'dev').trim().toLowerCase();
    const nodeEnvironment = (readRuntimeEnv('NODE_ENV', context) ?? '').trim().toLowerCase();
    const importMeta = import.meta as ImportMeta & {
        env?: Record<string, string | undefined>;
    };
    const buildUrl = importMeta.env?.PUBLIC_SUPABASE_URL?.trim();
    const runtimeUrl = readRuntimeEnv('PUBLIC_SUPABASE_URL', context)?.trim();
    const expectedProjectRef = readRuntimeEnv('SUPABASE_EXPECTED_PROJECT_REF', context)?.trim();
    const workerIdentity = readRuntimeEnv('WORKER_IDENTITY', context)?.trim() ?? '';
    const isFulfillmentWorker = workerIdentity.includes('fulfillment');
    const buildProjectRef = supabaseProjectRef(buildUrl);
    const runtimeProjectRef = supabaseProjectRef(runtimeUrl);

    if (nodeEnvironment === 'production' && !DEPLOYED_ENVIRONMENTS.has(appEnvironment)) {
        throw new Error('Production runtime requires PUBLIC_APP_ENV=staging or production');
    }
    if (buildProjectRef && runtimeProjectRef && buildProjectRef !== runtimeProjectRef) {
        throw new Error('Build-time and runtime Supabase projects do not match');
    }

    if (DEPLOYED_ENVIRONMENTS.has(appEnvironment)) {
        if (!runtimeUrl || !runtimeProjectRef) {
            throw new Error('Deployed Supabase runtime URL is missing or invalid');
        }
        if (!expectedProjectRef) {
            throw new Error('Missing SUPABASE_EXPECTED_PROJECT_REF for deployed runtime');
        }
        if (runtimeProjectRef !== expectedProjectRef) {
            throw new Error('Runtime Supabase project does not match SUPABASE_EXPECTED_PROJECT_REF');
        }
        if (!buildProjectRef && !isFulfillmentWorker) {
            throw new Error('Build-time and runtime Supabase projects do not match');
        }
    } else if (expectedProjectRef) {
        const selectedRef = runtimeProjectRef ?? buildProjectRef;
        if (selectedRef !== expectedProjectRef) {
            throw new Error('Supabase project does not match SUPABASE_EXPECTED_PROJECT_REF');
        }
    }

    const url = runtimeUrl ?? buildUrl;
    if (!url || !supabaseProjectRef(url)) {
        throw new Error('Missing or invalid PUBLIC_SUPABASE_URL');
    }

    return {
        appEnvironment,
        projectRef: supabaseProjectRef(url) as string,
        url,
    };
}

export function getSupabaseAnonKey(context?: Pick<APIContext, 'locals'>): string {
    const importMeta = import.meta as ImportMeta & {
        env?: Record<string, string | undefined>;
    };
    return readRuntimeEnv('PUBLIC_SUPABASE_ANON_KEY', context)
        ?? importMeta.env?.PUBLIC_SUPABASE_ANON_KEY
        ?? requireRuntimeEnv('PUBLIC_SUPABASE_ANON_KEY', context);
}
