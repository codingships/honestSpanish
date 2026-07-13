const sentryBuildOnlyKeys = [
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
] as const;

/**
 * The Cloudflare active-transition approval excludes Sentry writes. Empty
 * process values override any matching dotenv values consumed by Vite, while
 * the public DSN remains available for runtime error capture.
 */
export function disableProductionReleaseSentryUpload(environment: NodeJS.ProcessEnv): void {
    environment.SENTRY_UPLOAD_SOURCEMAPS = 'false';
    for (const key of sentryBuildOnlyKeys) environment[key] = '';
}
