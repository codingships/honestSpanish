import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const sourcePath = '.env.staging';
const targetPath = '.dev.vars.staging';
const stagingRef = 'mzjyvmlxfpzdfdjzxxyj';
const isolatedEnvDirectory = path.join(tmpdir(), 'espanol-honesto', 'staging-env');
const turnstileTestSiteKey = '1x00000000000000000000AA';
const turnstileTestSecretKey = '1x0000000000000000000000000000000AA';
const requiredKeys = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
] as const;
const optionalWebKeys = [
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
] as const;
const inheritedProviderKeys = [
    'ADMIN_EMAIL',
    'CRON_SECRET',
    'EMAIL_DAILY_RECIPIENT_LIMIT',
    'EMAIL_DELIVERY_MODE',
    'EMAIL_FROM',
    'EMAIL_MONTHLY_RECIPIENT_LIMIT',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'FULFILLMENT_WORKER_URL',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'INTERNAL_JOB_SECRET',
    'INTERNAL_JOB_SERVICE_URL',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'SUPPORT_ALERT_EMAIL',
    'TURNSTILE_SECRET_KEY',
] as const;
const syncOnly = process.argv.includes('--sync-only');
const buildMode = process.argv.includes('--build');
const useLocalStaging = syncOnly || !buildMode || (
    process.env.CI !== 'true' && process.env.CLOUDFLARE_ENV !== 'production'
);

let output: Record<string, string> = {};

if (useLocalStaging) {
    if (!existsSync(sourcePath)) {
        throw new Error(`[env:staging:sync] Missing ${sourcePath}.`);
    }

    const source = parseEnv(readFileSync(sourcePath, 'utf8'));
    const missing = requiredKeys.filter((key) => !source[key]);
    if (missing.length > 0) {
        throw new Error(`[env:staging:sync] Missing required staging keys: ${missing.join(', ')}.`);
    }
    if (!source.PUBLIC_SUPABASE_URL?.includes(stagingRef)) {
        throw new Error(`[env:staging:sync] Refusing non-staging Supabase URL; expected project ${stagingRef}.`);
    }
    if (source.STRIPE_SECRET_KEY && !source.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
        throw new Error('[env:staging:sync] Refusing a non-test Stripe secret in local staging.');
    }
    if (source.PUBLIC_STRIPE_PUBLISHABLE_KEY && !source.PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_')) {
        throw new Error('[env:staging:sync] Refusing a non-test Stripe publishable key in local staging.');
    }
    source.PUBLIC_TURNSTILE_SITE_KEY ||= turnstileTestSiteKey;
    source.TURNSTILE_SECRET_KEY ||= turnstileTestSecretKey;

    output = {
        PUBLIC_APP_ENV: 'staging',
        SUPABASE_EXPECTED_PROJECT_REF: stagingRef,
        PUBLIC_SITE_URL: 'http://localhost:4321',
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        SENTRY_CAPTURE_LOCAL: 'false',
    };
    for (const key of requiredKeys) output[key] = source[key]!;
    for (const key of optionalWebKeys) {
        if (source[key]) output[key] = source[key]!;
    }
    const sentryDsn = source.PUBLIC_SENTRY_DSN || process.env.PUBLIC_SENTRY_DSN;
    if (sentryDsn) {
        output.PUBLIC_SENTRY_DSN = sentryDsn;
        output.SENTRY_ENVIRONMENT = 'staging';
    }

    writeFileSync(
        targetPath,
        `${Object.entries(output).map(([key, value]) => `${key}=${quoteEnv(value)}`).join('\n')}\n`,
        { encoding: 'utf8', mode: 0o600 },
    );

    console.log(`[env:staging:sync] Wrote ignored ${targetPath} for Supabase staging ${stagingRef}.`);
    console.log(`[env:staging:sync] Keys: ${Object.keys(output).sort().join(', ')}.`);
    console.log('[env:staging:sync] Google, Resend, database URLs and test-user credentials were excluded.');
}

if (syncOnly) process.exit(0);

const childEnv = { ...process.env };
if (useLocalStaging) {
    for (const key of inheritedProviderKeys) childEnv[key] = '';
    Object.assign(childEnv, output);
    mkdirSync(isolatedEnvDirectory, { recursive: true });
    childEnv.ESPANOL_RUNTIME_ENV_DIR = isolatedEnvDirectory;
    childEnv.CLOUDFLARE_ENV = 'staging';
    childEnv.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true';
}
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const forwardedArgs = process.argv.slice(2)
    .filter((arg) => arg !== '--' && arg !== '--sync-only' && arg !== '--build');
const args = buildMode
    ? ['exec', 'astro', 'build', ...forwardedArgs]
    : ['exec', 'astro', 'dev', '--mode', 'staging', ...forwardedArgs];
const child = spawn(command, args, {
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
child.on('error', (error) => {
    console.error(`[${buildMode ? 'build' : 'dev'}] No se pudo arrancar Astro: ${error.message}`);
    process.exitCode = 1;
});
child.on('exit', (code) => {
    process.exitCode = code ?? 0;
});

function parseEnv(raw: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        ) {
            value = value.slice(1, -1);
        }
        parsed[key] = value;
    }
    return parsed;
}

function quoteEnv(value: string): string {
    return JSON.stringify(value);
}
