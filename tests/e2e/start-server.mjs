import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const runtimeDirectory = resolve(cwd, 'tests', 'e2e', 'runtime');
const runtimeVarsPath = resolve(runtimeDirectory, '.dev.vars');
const isolatedToolState = resolve(cwd, '.wrangler', 'e2e-isolated');
const childEnvironment = {
    ...process.env,
    XDG_CACHE_HOME: resolve(isolatedToolState, 'cache'),
    XDG_CONFIG_HOME: resolve(isolatedToolState, 'config'),
};
const publicSupabaseRef = 'placeholder';
const publicSupabaseUrl = 'https://placeholder.supabase.co';
const publicSupabaseAnonKey = 'placeholder-anon-key';
const publicSupabaseServiceRoleKey = 'placeholder-service-role-key';
const publicBaseUrl = 'http://localhost:4321';
const runtimeBindingKeys = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_APP_ENV',
    'PUBLIC_SITE_URL',
    'CHECKOUT_ENABLED',
    'CHECKOUT_ENABLED_OVERRIDE',
    'E2E_DISABLE_EXTERNAL_INTEGRATIONS',
    'E2E_RUNTIME_ISOLATED',
    'E2E_TARGET_SUPABASE_REF',
    'SUPABASE_EXPECTED_PROJECT_REF',
];
const externalProviderKeys = [
    'CLOUDFLARE_API_TOKEN',
    'CRON_SECRET',
    'DATABASE_URL',
    'FULFILLMENT_WORKER_URL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'INTERNAL_JOB_SECRET',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'RESEND_API_KEY',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_DSN',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'SUPABASE_DB_URL',
    'SUPABASE_PRODUCTION_DB_URL',
    'SUPABASE_STAGING_DB_URL',
];

function requireValue(key) {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`[e2e-env] Server owner is missing ${key}`);
    return value;
}

const exactRuntime = {
    PUBLIC_SUPABASE_URL: publicSupabaseUrl,
    PUBLIC_SUPABASE_ANON_KEY: publicSupabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: publicSupabaseServiceRoleKey,
    PUBLIC_APP_ENV: 'test',
    PUBLIC_SITE_URL: publicBaseUrl,
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
    E2E_RUNTIME_ISOLATED: 'true',
    E2E_TARGET_SUPABASE_REF: publicSupabaseRef,
    SUPABASE_EXPECTED_PROJECT_REF: publicSupabaseRef,
};
const inconsistentKeys = Object.entries(exactRuntime)
    .filter(([key, expected]) => process.env[key] !== expected)
    .map(([key]) => key);
if (inconsistentKeys.length > 0 || process.env.TEST_BASE_URL !== publicBaseUrl) {
    throw new Error(
        `[e2e-env] Server owner refused a non-placeholder public runtime: ${inconsistentKeys.join(', ') || 'TEST_BASE_URL'}`,
    );
}

const allowedPlaywrightTestMetadataKeys = new Set([
    'TEST_BASE_URL',
    'TEST_PARALLEL_INDEX',
    'TEST_WORKER_INDEX',
]);

const inheritedTestCredentials = Object.entries(process.env)
    .filter(([key, value]) =>
        key.startsWith('TEST_') && !allowedPlaywrightTestMetadataKeys.has(key) && Boolean(value?.trim()))
    .map(([key]) => key);
if (inheritedTestCredentials.length > 0) {
    throw new Error(`[e2e-env] Server owner refuses TEST_* credentials: ${inheritedTestCredentials.join(', ')}`);
}

const presentProviders = externalProviderKeys.filter((key) => Boolean(process.env[key]));
if (presentProviders.length > 0) {
    throw new Error(`[e2e-env] Server owner refuses provider credentials: ${presentProviders.join(', ')}`);
}

const content = `${runtimeBindingKeys
    .map((key) => `${key}=${JSON.stringify(requireValue(key))}`)
    .join('\n')}\n`;

mkdirSync(runtimeDirectory, { recursive: true });
mkdirSync(childEnvironment.XDG_CACHE_HOME, { recursive: true });
mkdirSync(childEnvironment.XDG_CONFIG_HOME, { recursive: true });
if (!existsSync(runtimeVarsPath) || readFileSync(runtimeVarsPath, 'utf8') !== content) {
    writeFileSync(runtimeVarsPath, content, { encoding: 'utf8', mode: 0o600 });
}

const cleanup = () => rmSync(runtimeVarsPath, { force: true });
process.once('exit', cleanup);

const astroCli = resolve(cwd, 'node_modules', 'astro', 'bin', 'astro.mjs');
// Generate Astro's runtime types before starting the isolated server. The
// Vite SSR environment itself pre-transforms the public-home module graph so
// React cannot be re-optimized while the first request is being rendered.
const sync = spawnSync(process.execPath, [astroCli, 'sync'], {
    cwd,
    env: childEnvironment,
    stdio: 'inherit',
});
if (sync.error || sync.status !== 0) {
    cleanup();
    throw new Error(`[e2e-env] Astro sync failed with exit code ${String(sync.status)}.`);
}

const server = spawn(process.execPath, [astroCli, 'dev'], {
    cwd,
    env: childEnvironment,
    stdio: 'inherit',
});

const forwardSignal = (signal) => {
    if (!server.killed) server.kill(signal);
};
process.once('SIGINT', () => forwardSignal('SIGINT'));
process.once('SIGTERM', () => forwardSignal('SIGTERM'));

const exitCode = await new Promise((resolveExit, reject) => {
    server.once('error', reject);
    server.once('exit', (code) => resolveExit(code ?? 1));
});

cleanup();
process.exitCode = exitCode;
