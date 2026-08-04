import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const serverMode = process.env.E2E_SERVER_MODE || 'dev';
if (serverMode !== 'dev' && serverMode !== 'built') {
    throw new Error(`[e2e-env] Unsupported E2E_SERVER_MODE: ${serverMode}.`);
}
const runtimeDirectory = resolve(cwd, 'tests', 'e2e', 'runtime');
const runtimeVarsPath = resolve(runtimeDirectory, '.dev.vars');
const isolatedToolState = resolve(cwd, '.wrangler', 'e2e-isolated');
const localPersistence = resolve(isolatedToolState, 'state');
const childEnvironment = {
    ...process.env,
    WRANGLER_SEND_METRICS: 'false',
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
mkdirSync(localPersistence, { recursive: true });
if (!existsSync(runtimeVarsPath) || readFileSync(runtimeVarsPath, 'utf8') !== content) {
    writeFileSync(runtimeVarsPath, content, { encoding: 'utf8', mode: 0o600 });
}

const cleanup = () => rmSync(runtimeVarsPath, { force: true });
process.once('exit', cleanup);

const astroCli = resolve(cwd, 'node_modules', 'astro', 'bin', 'astro.mjs');
const prepareArgs = serverMode === 'built'
    ? [astroCli, 'build']
    : [astroCli, 'sync'];
// Public E2E keeps the fast dev server. Performance audits select `built` so
// Lighthouse measures the generated Cloudflare Worker instead of Vite's
// transform and compilation latency.
const prepare = spawnSync(process.execPath, prepareArgs, {
    cwd,
    env: childEnvironment,
    stdio: 'inherit',
});
if (prepare.error || prepare.status !== 0) {
    cleanup();
    throw new Error(
        `[e2e-env] Astro ${serverMode === 'built' ? 'build' : 'sync'} failed with exit code ${String(prepare.status)}.`,
    );
}

const builtConfigPath = resolve(cwd, 'dist', 'server', 'wrangler.json');
if (serverMode === 'built' && !existsSync(builtConfigPath)) {
    cleanup();
    throw new Error('[e2e-env] Astro build did not produce dist/server/wrangler.json.');
}
const wranglerCli = resolve(cwd, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const serverArgs = serverMode === 'built'
    ? [
        wranglerCli,
        'dev',
        '--config', builtConfigPath,
        '--env-file', runtimeVarsPath,
        '--local',
        '--ip', '127.0.0.1',
        '--port', '4321',
        '--persist-to', localPersistence,
        '--log-level', 'error',
        '--show-interactive-dev-session=false',
    ]
    : [astroCli, 'dev'];
const server = spawn(process.execPath, serverArgs, {
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
