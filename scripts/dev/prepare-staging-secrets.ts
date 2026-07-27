import { createPrivateKey } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as dotenv from 'dotenv';
import { normalizeGooglePrivateKey } from '../../src/lib/google/private-key';

type SentryClientKey = {
    isActive?: boolean;
    dsn?: { public?: string };
};

const stagingPath = '.env.staging';
const testPath = '.env.test';
const stagingRef = 'mzjyvmlxfpzdfdjzxxyj';
const stagingSupabaseUrl = `https://${stagingRef}.supabase.co`;
const stagingStripeAccountId = 'acct_1TruqOC22M3erP0j';
const webUrl = 'https://staging.espanolhonesto.com';
const fulfillmentUrl = 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev';
const sentryOrg = 'honestspanish';
const sentryProject = 'espanol-honesto-astro';
const sentryDsnHost = 'o4510912289701888.ingest.de.sentry.io';
const sentryProjectId = '4510917714444368';

const staging = dotenv.parse(readFileSync(stagingPath, 'utf8'));
if (!existsSync(testPath)) {
    throw new Error('[env:staging:prepare] Missing .env.test with the three dedicated staging role accounts.');
}
const test = dotenv.parse(readFileSync(testPath, 'utf8'));

if (!isExactHttpsOrigin(staging.PUBLIC_SUPABASE_URL, stagingSupabaseUrl) || !staging.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(`[env:staging:prepare] Refusing non-staging Supabase configuration; expected ${stagingSupabaseUrl}.`);
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
if (stripeExpectedAccount !== stagingStripeAccountId || !stripePortalConfiguration?.startsWith('bpc_')) {
    throw new Error(`[env:staging:prepare] Stripe must identify account ${stagingStripeAccountId} and a Portal configuration.`);
}

const testEmails = ['TEST_STUDENT_EMAIL', 'TEST_TEACHER_EMAIL', 'TEST_ADMIN_EMAIL']
    .map((key) => test[key]?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
if (
    new Set(testEmails).size !== 3
    || testEmails.some((email) => !/^\S+@\S+\.\S+$/u.test(email) || email.endsWith('@example.com'))
) {
    throw new Error('[env:staging:prepare] Exactly three distinct valid staging test emails are required.');
}

const sentryDsn = validateSentryDsn(staging.PUBLIC_SENTRY_DSN || await resolveSentryDsn());
const cronSecret = requireStagingSecret('CRON_SECRET');
const internalJobSecret = requireStagingSecret('INTERNAL_JOB_SECRET');
const levelCheckTokenSecret = requireStagingSecret('LEVEL_CHECK_TOKEN_SECRET');
if (new Set([cronSecret, internalJobSecret, levelCheckTokenSecret]).size !== 3) {
    throw new Error(
        '[env:staging:prepare] CRON_SECRET, INTERNAL_JOB_SECRET and LEVEL_CHECK_TOKEN_SECRET must be distinct.',
    );
}
const googlePrivateKey = normalizeGooglePrivateKey(staging.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '');
try {
    createPrivateKey(googlePrivateKey);
} catch {
    throw new Error('[env:staging:prepare] Google staging private key is not a valid PEM.');
}

Object.assign(staging, {
    ADMIN_EMAIL: test.TEST_ADMIN_EMAIL,
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    CRON_SECRET: cronSecret,
    EMAIL_DAILY_RECIPIENT_LIMIT: '10',
    EMAIL_DELIVERY_MODE: 'allowlist',
    EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
    EMAIL_RECIPIENT_ALLOWLIST: testEmails.join(','),
    FULFILLMENT_WORKER_URL: fulfillmentUrl,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: googlePrivateKey,
    INTERNAL_JOB_SECRET: internalJobSecret,
    LEVEL_CHECK_TOKEN_SECRET: levelCheckTokenSecret,
    PUBLIC_APP_ENV: 'staging',
    SUPABASE_EXPECTED_PROJECT_REF: stagingRef,
    PUBLIC_SENTRY_DSN: sentryDsn,
    PUBLIC_SITE_URL: webUrl,
    PUBLIC_STRIPE_PUBLISHABLE_KEY: stripePublishable,
    PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    SENTRY_ENVIRONMENT: 'staging',
    SENTRY_ORG: sentryOrg,
    SENTRY_PROJECT: sentryProject,
    STRIPE_SECRET_KEY: stripeSecret,
    STRIPE_EXPECTED_ACCOUNT_ID: stripeExpectedAccount,
    STRIPE_PORTAL_CONFIGURATION_ID: stripePortalConfiguration,
    STRIPE_WEBHOOK_SECRET: stripeWebhook,
    SUPPORT_ALERT_EMAIL: test.TEST_ADMIN_EMAIL,
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

function requireStagingSecret(name: string): string {
    const value = staging[name]?.trim() ?? '';
    if (
        value.length < 32
        || /(?:placeholder|example|changeme|your[_-])/iu.test(value)
    ) {
        throw new Error(`[env:staging:prepare] ${name} must already contain the provisioned staging secret.`);
    }
    return value;
}

function isExactHttpsOrigin(value: string | undefined, expected: string): boolean {
    try {
        const parsed = new URL(value?.trim() ?? '');
        return (
            parsed.protocol === 'https:'
            && parsed.href === `${expected}/`
            && !parsed.username
            && !parsed.password
        );
    } catch {
        return false;
    }
}

async function resolveSentryDsn(): Promise<string> {
    const token = (staging.SENTRY_AUTH_TOKEN || process.env.SENTRY_AUTH_TOKEN)?.trim();
    if (!token) {
        throw new Error('[env:staging:prepare] Missing staging Sentry auth token for public DSN lookup.');
    }

    const response = await fetch(
        `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/keys/?status=active`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
        throw new Error(`[env:staging:prepare] Sentry client-key lookup failed with status ${response.status}.`);
    }

    const keys = await response.json() as SentryClientKey[];
    const publicDsn = keys.find((key) => key.isActive !== false && key.dsn?.public)?.dsn?.public;
    if (!publicDsn) {
        throw new Error('[env:staging:prepare] Sentry returned no active public DSN.');
    }
    return publicDsn;
}

function validateSentryDsn(value: string): string {
    let parsed: URL;
    try {
        parsed = new URL(value.trim());
    } catch {
        throw new Error('[env:staging:prepare] Sentry returned an invalid public DSN.');
    }

    if (
        parsed.protocol !== 'https:'
        || !parsed.username
        || parsed.password
        || parsed.hostname !== sentryDsnHost
        || parsed.pathname !== `/${sentryProjectId}`
        || parsed.port
        || parsed.search
        || parsed.hash
    ) {
        throw new Error('[env:staging:prepare] Refusing a Sentry DSN outside the Academy staging project.');
    }
    return parsed.toString();
}
