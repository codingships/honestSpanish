import { createPrivateKey, randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import * as dotenv from 'dotenv';
import { normalizeGooglePrivateKey } from '../../src/lib/google/private-key';

type SentryClientKey = {
    isActive?: boolean;
    dsn?: { public?: string };
};

const stagingPath = '.env.staging';
const basePath = '.env';
const stagingRef = 'mzjyvmlxfpzdfdjzxxyj';
const webUrl = 'https://staging.espanolhonesto.com';
const fulfillmentUrl = 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev';

const staging = dotenv.parse(readFileSync(stagingPath, 'utf8'));
const base = dotenv.parse(readFileSync(basePath, 'utf8'));
const fromAllowedSources = (key: string): string | undefined =>
    staging[key] || process.env[key] || base[key];

if (!staging.PUBLIC_SUPABASE_URL?.includes(stagingRef) || !staging.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(`[env:staging:prepare] Refusing non-staging Supabase configuration; expected ${stagingRef}.`);
}

// Stripe staging must be explicit. Never inherit account-bound values from the
// base/production env when preparing the dedicated test environment.
const stripeSecret = staging.STRIPE_SECRET_KEY;
const stripePublishable = staging.PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripeWebhook = staging.STRIPE_WEBHOOK_SECRET;
const stripeExpectedAccount = staging.STRIPE_EXPECTED_ACCOUNT_ID;
const stripePortalConfiguration = staging.STRIPE_PORTAL_CONFIGURATION_ID;
if (!stripeSecret?.startsWith('sk_test_') || !stripePublishable?.startsWith('pk_test_') || !stripeWebhook?.startsWith('whsec_')) {
    throw new Error('[env:staging:prepare] Complete Stripe test credentials are required; live keys are refused.');
}
if (!stripeExpectedAccount?.startsWith('acct_') || !stripePortalConfiguration?.startsWith('bpc_')) {
    throw new Error('[env:staging:prepare] Stripe expected account and Portal configuration are required.');
}

const testEmails = ['TEST_STUDENT_EMAIL', 'TEST_TEACHER_EMAIL', 'TEST_ADMIN_EMAIL']
    .map((key) => staging[key]?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
if (new Set(testEmails).size !== 3 || testEmails.some((email) => !/^\S+@\S+\.\S+$/u.test(email))) {
    throw new Error('[env:staging:prepare] Exactly three distinct valid staging test emails are required.');
}

const sentryDsn = staging.PUBLIC_SENTRY_DSN || await resolveSentryDsn();
const randomSecret = () => randomBytes(32).toString('base64url');
const googlePrivateKey = normalizeGooglePrivateKey(staging.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '');
try {
    createPrivateKey(googlePrivateKey);
} catch {
    throw new Error('[env:staging:prepare] Google staging private key is not a valid PEM.');
}

Object.assign(staging, {
    ADMIN_EMAIL: staging.TEST_ADMIN_EMAIL,
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    CRON_SECRET: staging.CRON_SECRET || randomSecret(),
    EMAIL_DAILY_RECIPIENT_LIMIT: '10',
    EMAIL_DELIVERY_MODE: 'allowlist',
    EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
    EMAIL_RECIPIENT_ALLOWLIST: testEmails.join(','),
    FULFILLMENT_WORKER_URL: fulfillmentUrl,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: googlePrivateKey,
    INTERNAL_JOB_SECRET: staging.INTERNAL_JOB_SECRET || randomSecret(),
    LEVEL_CHECK_TOKEN_SECRET: staging.LEVEL_CHECK_TOKEN_SECRET || randomSecret(),
    PUBLIC_APP_ENV: 'staging',
    SUPABASE_EXPECTED_PROJECT_REF: stagingRef,
    PUBLIC_SENTRY_DSN: sentryDsn,
    PUBLIC_SITE_URL: webUrl,
    PUBLIC_STRIPE_PUBLISHABLE_KEY: stripePublishable,
    PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    SENTRY_ENVIRONMENT: 'staging',
    STRIPE_SECRET_KEY: stripeSecret,
    STRIPE_EXPECTED_ACCOUNT_ID: stripeExpectedAccount,
    STRIPE_PORTAL_CONFIGURATION_ID: stripePortalConfiguration,
    STRIPE_WEBHOOK_SECRET: stripeWebhook,
    SUPPORT_ALERT_EMAIL: staging.TEST_ADMIN_EMAIL,
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
});

writeFileSync(
    stagingPath,
    `${Object.entries(staging)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n')}\n`,
    { encoding: 'utf8', mode: 0o600 },
);
chmodSync(stagingPath, 0o600);

console.log(`[env:staging:prepare] Staging runtime configuration is ready for Supabase ${stagingRef}.`);
console.log(`[env:staging:prepare] Checkout remains disabled; Resend is allowlisted at 10/day and 100/month.`);

async function resolveSentryDsn(): Promise<string> {
    const token = fromAllowedSources('SENTRY_AUTH_TOKEN')?.trim();
    const org = fromAllowedSources('SENTRY_ORG')?.trim();
    const project = fromAllowedSources('SENTRY_PROJECT')?.trim();
    if (!token || !org || !project) {
        throw new Error('[env:staging:prepare] Missing Sentry credentials for public DSN lookup.');
    }

    const response = await fetch(
        `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/keys/?status=active`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
        throw new Error(`[env:staging:prepare] Sentry client-key lookup failed with status ${response.status}.`);
    }

    const keys = await response.json() as SentryClientKey[];
    const publicDsn = keys.find((key) => key.isActive !== false && key.dsn?.public)?.dsn?.public;
    if (!publicDsn || !/^https:\/\/[^@/]+@[^/]+\/\d+$/u.test(publicDsn)) {
        throw new Error('[env:staging:prepare] Sentry returned no valid active public DSN.');
    }
    return publicDsn;
}
