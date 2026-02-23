import * as Sentry from "@sentry/astro";

Sentry.init({
    // @ts-ignore - import.meta.env is injected by Astro during build
    dsn: import.meta.env.PUBLIC_SENTRY_DSN,

    // Performance Monitoring
    tracesSampleRate: 1.0, //  Capture 100% of the transactions (for testing). Reduce in production!
});
