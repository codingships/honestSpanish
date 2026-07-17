import * as Sentry from '@sentry/astro';

declare const __SENTRY_DSN__: string;
declare const __SENTRY_ENVIRONMENT__: string;

const dsn = import.meta.env.SENTRY_DSN || import.meta.env.PUBLIC_SENTRY_DSN || __SENTRY_DSN__;
const environment = __SENTRY_ENVIRONMENT__;

Sentry.init({
    dsn: dsn || undefined,
    enabled: Boolean(dsn),
    environment: environment || undefined,
    defaultIntegrations: false,
    integrations: [],
});
