import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();
const runtimeDirectory = resolve(cwd, 'tests', 'e2e', 'runtime');
const runtimeVarsPath = resolve(runtimeDirectory, '.dev.vars');
const stagingRef = 'mzjyvmlxfpzdfdjzxxyj';
const isInertCiPublic = process.env.CI === 'true'
    && process.env.E2E_CI_PUBLIC_PLACEHOLDER === 'true'
    && process.env.E2E_TARGET_SUPABASE_REF === 'placeholder';
const expectedRef = isInertCiPublic ? 'placeholder' : stagingRef;
const runtimeBindingKeys = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_APP_ENV',
    'CHECKOUT_ENABLED',
    'E2E_DISABLE_EXTERNAL_INTEGRATIONS',
    'E2E_RUNTIME_ISOLATED',
    'E2E_TARGET_SUPABASE_REF',
];
const externalProviderKeys = [
    'CRON_SECRET',
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
];

function requireValue(key) {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`[e2e-env] Server owner is missing ${key}`);
    return value;
}

function projectRef(value) {
    try {
        return /^([a-z0-9]+)\.supabase\.co$/i.exec(new URL(value).hostname)?.[1] ?? null;
    } catch {
        return null;
    }
}

if (
    process.env.E2E_RUNTIME_ISOLATED !== 'true' ||
    process.env.E2E_DISABLE_EXTERNAL_INTEGRATIONS !== 'true' ||
    process.env.CHECKOUT_ENABLED !== 'false' ||
    process.env.E2E_TARGET_SUPABASE_REF !== expectedRef ||
    projectRef(requireValue('PUBLIC_SUPABASE_URL')) !== expectedRef
) {
    throw new Error('[e2e-env] Server owner refused an inconsistent runtime identity');
}

const presentProviders = externalProviderKeys.filter((key) => Boolean(process.env[key]));
if (presentProviders.length > 0) {
    throw new Error(`[e2e-env] Server owner refuses provider credentials: ${presentProviders.join(', ')}`);
}

const content = `${runtimeBindingKeys
    .map((key) => `${key}=${JSON.stringify(requireValue(key))}`)
    .join('\n')}\n`;

mkdirSync(runtimeDirectory, { recursive: true });
if (!existsSync(runtimeVarsPath) || readFileSync(runtimeVarsPath, 'utf8') !== content) {
    writeFileSync(runtimeVarsPath, content, { encoding: 'utf8', mode: 0o600 });
}

const cleanup = () => rmSync(runtimeVarsPath, { force: true });
process.once('exit', cleanup);

const astroCli = resolve(cwd, 'node_modules', 'astro', 'bin', 'astro.mjs');
const server = spawn(process.execPath, [astroCli, 'dev'], {
    cwd,
    env: process.env,
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
