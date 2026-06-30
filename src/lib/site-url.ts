import { readRuntimeEnv } from './runtime-env';

const metaEnv = (import.meta as ImportMeta & {
    env?: { DEV?: boolean | string };
}).env;

const DEFAULT_SITE_URL = String(metaEnv?.DEV) === 'true'
    ? 'http://localhost:4321'
    : 'https://espanolhonesto.com';

export function getSiteUrl(fallback = DEFAULT_SITE_URL): string {
    const rawUrl =
        readRuntimeEnv('PUBLIC_SITE_URL') ||
        readRuntimeEnv('PUBLIC_URL') ||
        readRuntimeEnv('SITE') ||
        fallback;

    return new URL(rawUrl).origin;
}
