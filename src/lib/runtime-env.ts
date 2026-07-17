import type { APIContext } from 'astro';
import { getSecret } from 'astro:env/server';

function getProcessEnvValue(key: string): string | undefined {
    const processLike = globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
    };

    return processLike.process?.env?.[key];
}

function getAstroSecretValue(key: string): string | undefined {
    try {
        return getSecret(key);
    } catch {
        return undefined;
    }
}

export function readRuntimeEnv(key: string, _context?: Pick<APIContext, 'locals'>): string | undefined {
    const value = getAstroSecretValue(key) ??
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
