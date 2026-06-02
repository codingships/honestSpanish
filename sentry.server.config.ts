import * as Sentry from '@sentry/astro';

declare const __SENTRY_DSN__: string;

const dsn = import.meta.env.SENTRY_DSN || import.meta.env.PUBLIC_SENTRY_DSN || __SENTRY_DSN__;

Sentry.init({
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
});
