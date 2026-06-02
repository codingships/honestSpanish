const DEFAULT_SITE_URL = import.meta.env.DEV
    ? 'http://localhost:4321'
    : 'https://espanolhonesto.com';

const readEnv = (key: string): string | undefined => {
    const metaValue = import.meta.env[key] as string | undefined;
    return metaValue || process.env[key];
};

export function getSiteUrl(fallback = DEFAULT_SITE_URL): string {
    const rawUrl =
        readEnv('PUBLIC_SITE_URL') ||
        readEnv('PUBLIC_URL') ||
        readEnv('SITE') ||
        fallback;

    return new URL(rawUrl).origin;
}
