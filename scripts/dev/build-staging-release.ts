import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.staging', quiet: true });

const publicDsn = process.env.PUBLIC_SENTRY_DSN?.trim() ?? '';
let parsedDsn: URL;
try {
    parsedDsn = new URL(publicDsn);
} catch {
    throw new Error('[build:staging:release] PUBLIC_SENTRY_DSN must be configured explicitly for staging.');
}
if (
    parsedDsn.protocol !== 'https:'
    || !parsedDsn.username
    || parsedDsn.password
    || parsedDsn.hostname !== 'o4510912289701888.ingest.de.sentry.io'
    || parsedDsn.pathname !== '/4510917714444368'
    || parsedDsn.port
    || parsedDsn.search
    || parsedDsn.hash
) {
    throw new Error('[build:staging:release] PUBLIC_SENTRY_DSN must identify the exact Academy Sentry project.');
}

if (process.env.SENTRY_UPLOAD_SOURCEMAPS === 'true') {
    throw new Error(
        '[build:staging:release] Sourcemap upload is not part of the staging build; use a separately authorized operation.',
    );
}

process.env.PUBLIC_SENTRY_DSN = publicDsn;
process.env.SENTRY_UPLOAD_SOURCEMAPS = 'false';
process.env.SENTRY_ENVIRONMENT = 'staging';
await import('./staging');
