import * as dotenv from 'dotenv';

type SentryClientKey = {
    isActive?: boolean;
    dsn?: { public?: string };
};

dotenv.config({ path: '.env.staging', quiet: true });

if (!process.env.PUBLIC_SENTRY_DSN) {
    const token = process.env.SENTRY_AUTH_TOKEN?.trim();
    const org = process.env.SENTRY_ORG?.trim();
    const project = process.env.SENTRY_PROJECT?.trim();

    if (!token || !org || !project) {
        throw new Error('[build:staging:release] Missing Sentry token, org or project for staging DSN resolution.');
    }

    const response = await fetch(
        `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/keys/?status=active`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
        throw new Error(`[build:staging:release] Sentry client-key lookup failed with status ${response.status}.`);
    }

    const keys = await response.json() as SentryClientKey[];
    const publicDsn = keys.find((key) => key.isActive !== false && key.dsn?.public)?.dsn?.public;
    if (!publicDsn || !/^https:\/\/[^@/]+@[^/]+\/\d+$/u.test(publicDsn)) {
        throw new Error('[build:staging:release] Sentry returned no valid active public DSN.');
    }
    process.env.PUBLIC_SENTRY_DSN = publicDsn;
}

process.env.SENTRY_ENVIRONMENT = 'staging';
await import('./staging');
