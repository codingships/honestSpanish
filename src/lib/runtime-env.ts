import type { APIContext } from 'astro';

type RuntimeEnv = Record<string, string | undefined>;
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

function getContextEnv(context?: Pick<APIContext, 'locals'>): RuntimeEnv | null {
    const runtime = (context?.locals as RuntimeLocals | undefined)?.runtime;
    return runtime?.env ?? null;
}

export function setRuntimeEnvFromContext(context: Pick<APIContext, 'locals'>): void {
    const env = getContextEnv(context);
    if (env) {
        currentRuntimeEnv = env;
    }
}

export function readRuntimeEnv(key: string, context?: Pick<APIContext, 'locals'>): string | undefined {
    const contextEnv = getContextEnv(context);
    const value = contextEnv?.[key] ?? currentRuntimeEnv?.[key] ?? getProcessEnvValue(key);

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
