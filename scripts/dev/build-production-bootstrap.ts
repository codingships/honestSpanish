import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as dotenv from 'dotenv';

const productionRef = 'vkkahxsybhbutszerawz';
const productionSite = 'https://espanolhonesto.com';
export const googleRuntimeVariableNames = [
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_TEMPLATE_DOC_ID',
] as const;

const forbiddenBootstrapProcessEnvironmentNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'EMAIL_FROM',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'SENTRY_AUTH_TOKEN',
    ...googleRuntimeVariableNames,
] as const;

const forbiddenBootstrapConfigVariableNames = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'RESEND_API_KEY',
    'TURNSTILE_SECRET_KEY',
    'CRON_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    ...googleRuntimeVariableNames,
] as const;

export function runProductionBootstrapBuild(): void {
    const workspaceRoot = path.resolve(process.cwd());
    const distRoot = path.resolve(workspaceRoot, 'dist');

    if (distRoot !== path.join(workspaceRoot, 'dist')) {
        throw new Error('[build:production:bootstrap] Refused unsafe dist path.');
    }

    // Prefer the future dedicated source, but allow the current protected
    // production env file while the project is still in pre-launch preparation.
    dotenv.config({ path: '.env.production', override: false, quiet: true });
    dotenv.config({ path: '.env', override: false, quiet: true });

    const sourceCredentialValues = captureSourceCredentialValues();

    const runtimeRef = supabaseProjectRef(process.env.PUBLIC_SUPABASE_URL);
    const mismatches = [
        runtimeRef === productionRef ? null : `PUBLIC_SUPABASE_URL project=${productionRef}`,
        process.env.PUBLIC_SUPABASE_ANON_KEY?.trim() ? null : 'PUBLIC_SUPABASE_ANON_KEY',
    ].filter((value): value is string => Boolean(value));

    if (mismatches.length > 0) {
        throw new Error(`[build:production:bootstrap] Refusing ambiguous bootstrap build; missing or mismatched: ${mismatches.join(', ')}.`);
    }

    process.env.CLOUDFLARE_ENV = 'production_bootstrap';
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_APP_ENV = 'production';
    process.env.WEB_RUNTIME_MODE = 'bootstrap';
    process.env.SUPABASE_EXPECTED_PROJECT_REF = productionRef;
    process.env.PUBLIC_SITE_URL = productionSite;
    process.env.CHECKOUT_ENABLED = 'false';
    process.env.CHECKOUT_ENABLED_OVERRIDE = 'false';
    process.env.EMAIL_DELIVERY_MODE = 'disabled';
    process.env.EMAIL_DAILY_RECIPIENT_LIMIT = '0';
    process.env.EMAIL_MONTHLY_RECIPIENT_LIMIT = '0';
    process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
    process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

    scrubBootstrapEnvironment(process.env);

    // Vite always loads the generic .env file for every mode. Deleting a value
    // from process.env is therefore insufficient: it would be reintroduced into
    // import.meta.env and the generated client chunks. Bootstrap deliberately
    // compiles with inert public placeholders; the active release build remains
    // responsible for compiling the real public provider configuration.
    process.env.PUBLIC_SUPABASE_URL = `https://${productionRef}.supabase.co`;
    process.env.PUBLIC_SUPABASE_ANON_KEY = 'bootstrap-disabled-anon-key';
    process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY = 'bootstrap-disabled-stripe-key';
    process.env.PUBLIC_TURNSTILE_SITE_KEY = 'bootstrap-disabled-turnstile-key';
    process.env.PUBLIC_SENTRY_DSN = '';

    // Point both Astro's explicit loadEnv call and Vite at a genuinely empty
    // directory. Otherwise every mode also reloads the repository's generic .env
    // after the sanitised process environment has been prepared.
    const isolatedEnvDirectory = mkdtempSync(path.join(tmpdir(), 'espanol-honesto-bootstrap-env-'));
    process.env.ESPANOL_RUNTIME_ENV_DIR = isolatedEnvDirectory;

    const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
    let result: ReturnType<typeof spawnSync>;
    try {
        // Astro/Cloudflare can leave old content-addressed chunks behind when a
        // build changes modes. A clean, verified build root is required before
        // scanning the bootstrap bundle for provider material.
        rmSync(distRoot, { force: true, recursive: true });
        result = spawnSync(command, ['pnpm', 'exec', 'astro', 'build', '--mode', 'production_bootstrap'], {
            env: process.env,
            stdio: 'inherit',
            shell: process.platform === 'win32',
        });
    } finally {
        rmSync(isolatedEnvDirectory, { force: true, recursive: true });
    }

    if (result.error || result.status !== 0) {
        throw new Error(`[build:production:bootstrap] Astro build failed with exit code ${String(result.status)}.`);
    }

    const forbiddenRuntimeFiles = existsSync(distRoot) ? findDevVars(distRoot) : [];
    if (forbiddenRuntimeFiles.length > 0) {
        for (const filePath of forbiddenRuntimeFiles) {
            const resolved = path.resolve(filePath);
            if (!resolved.startsWith(`${distRoot}${path.sep}`)) {
                throw new Error('[build:production:bootstrap] Refusing to clean a generated runtime file outside dist.');
            }
            rmSync(resolved, { force: true });
        }
        throw new Error('[build:production:bootstrap] Refused package: generated .dev.vars files were removed from dist.');
    }

    const generatedConfigPath = path.join(distRoot, 'server', 'wrangler.json');
    installBootstrapEntry(generatedConfigPath);
    validateGeneratedBootstrap(generatedConfigPath);
    validateBootstrapBundle(distRoot, sourceCredentialValues);
}

// A bootstrap build must not even receive active-provider credentials. The
// exact minimal runtime bindings are loaded later through a separate gate.
export function scrubBootstrapEnvironment(environment: NodeJS.ProcessEnv): void {
    for (const key of forbiddenBootstrapProcessEnvironmentNames) {
        if (environment === process.env) delete process.env[key];
        else delete environment[key];
    }
}

function findDevVars(directory: string): string[] {
    const matches: string[] = [];
    for (const entry of readdirSync(directory)) {
        const candidate = path.join(directory, entry);
        if (statSync(candidate).isDirectory()) matches.push(...findDevVars(candidate));
        else if (entry === '.dev.vars') matches.push(candidate);
    }
    return matches;
}

function supabaseProjectRef(value: string | undefined): string | null {
    if (!value) return null;
    try {
        return /^([a-z0-9]+)\.supabase\.co$/iu.exec(new URL(value).hostname)?.[1] ?? null;
    } catch {
        return null;
    }
}

function captureSourceCredentialValues(): Map<string, string> {
    const values = new Map<string, string>();
    for (const key of [
        'CRON_SECRET',
        'INTERNAL_JOB_SECRET',
        'LEVEL_CHECK_TOKEN_SECRET',
        'PUBLIC_SENTRY_DSN',
        'PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'PUBLIC_SUPABASE_ANON_KEY',
        'PUBLIC_TURNSTILE_SITE_KEY',
        'RESEND_API_KEY',
        'SENTRY_AUTH_TOKEN',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'SUPABASE_SERVICE_ROLE_KEY',
        'TURNSTILE_SECRET_KEY',
        // GOOGLE_ADMIN_EMAIL is commonly the same public contact address used
        // by ADMIN_EMAIL/legal content. Matching that value in the bundle does
        // not prove that a Google binding leaked. Its binding name is rejected
        // in the resolved Wrangler config below; the provider-specific values
        // remain covered here.
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
    ] as const) {
        const value = process.env[key]?.trim();
        if (value && value.length >= 8) values.set(key, value);
    }
    return values;
}

function installBootstrapEntry(configPath: string): void {
    if (!existsSync(configPath)) {
        throw new Error('[build:production:bootstrap] Generated dist/server/wrangler.json is missing.');
    }
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown> & {
        main?: unknown;
    };
    if (config.main !== 'entry.mjs') {
        throw new Error('[build:production:bootstrap] Refused unexpected generated Worker entrypoint.');
    }

    const wrapperName = 'bootstrap-entry.mjs';
    const wrapperPath = path.join(path.dirname(configPath), wrapperName);
    const wrapper = `import app from './entry.mjs';

const ALLOWED_PATHS = new Set(['/health', '/api/internal/runtime-attestation']);

function inertResponse() {
    return new Response(JSON.stringify({ errorCode: 'WEB_RUNTIME_BOOTSTRAP' }), {
        status: 503,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'Retry-After': '300',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
    });
}

export default {
    async fetch(request, env, context) {
        if (!ALLOWED_PATHS.has(new URL(request.url).pathname)) return inertResponse();
        return app.fetch(request, env, context);
    },
};
`;
    writeFileSync(wrapperPath, wrapper, 'utf8');
    config.main = wrapperName;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function validateBootstrapBundle(distRoot: string, sourceValues: Map<string, string>): void {
    const files = findRegularFiles(distRoot).filter((filePath) =>
        /\.(?:css|html|js|json|map|mjs|txt)$/iu.test(filePath),
    );
    const leakedNames = new Set<string>();
    const forbiddenPatterns = [
        /\b(?:pk|rk|sk)_(?:live|test)_[A-Za-z0-9]+/u,
        /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+/u,
    ];

    for (const filePath of files) {
        const contents = readFileSync(filePath, 'utf8');
        for (const [key, value] of sourceValues) {
            const jsonEscapedValue = JSON.stringify(value).slice(1, -1);
            if (contents.includes(value) || contents.includes(jsonEscapedValue)) leakedNames.add(key);
        }
        if (forbiddenPatterns.some((pattern) => pattern.test(contents))) {
            leakedNames.add('provider-key-pattern');
        }
    }

    if (leakedNames.size > 0) {
        throw new Error(
            `[build:production:bootstrap] Refused provider material in bootstrap bundle: ${[...leakedNames].sort().join(', ')}.`,
        );
    }
}

function findRegularFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory)) {
        const candidate = path.join(directory, entry);
        if (statSync(candidate).isDirectory()) files.push(...findRegularFiles(candidate));
        else files.push(candidate);
    }
    return files;
}

export function validateGeneratedBootstrap(configPath: string): void {
    if (!existsSync(configPath)) {
        throw new Error('[build:production:bootstrap] Generated dist/server/wrangler.json is missing.');
    }
    const configSource = readFileSync(configPath, 'utf8');
    const config = JSON.parse(configSource) as {
        assets?: { run_worker_first?: unknown };
        images?: unknown;
        kv_namespaces?: unknown[];
        main?: unknown;
        name?: unknown;
        routes?: unknown[];
        services?: Array<{ binding?: unknown; service?: unknown }>;
        vars?: Record<string, unknown>;
    };
    const vars = config.vars ?? {};
    const serviceBinding = config.services?.find((binding) => binding.binding === 'FULFILLMENT_SERVICE');
    const mismatches = [
        config.main === 'bootstrap-entry.mjs' ? null : 'main=bootstrap-entry.mjs',
        config.name === 'espanolhonesto' ? null : 'name=espanolhonesto',
        vars.PUBLIC_APP_ENV === 'production' ? null : 'PUBLIC_APP_ENV=production',
        vars.WEB_RUNTIME_MODE === 'bootstrap' ? null : 'WEB_RUNTIME_MODE=bootstrap',
        vars.SUPABASE_EXPECTED_PROJECT_REF === productionRef ? null : `SUPABASE_EXPECTED_PROJECT_REF=${productionRef}`,
        vars.CHECKOUT_ENABLED === 'false' ? null : 'CHECKOUT_ENABLED=false',
        vars.CHECKOUT_ENABLED_OVERRIDE === 'false' ? null : 'CHECKOUT_ENABLED_OVERRIDE=false',
        vars.EMAIL_DELIVERY_MODE === 'disabled' ? null : 'EMAIL_DELIVERY_MODE=disabled',
        vars.EMAIL_DAILY_RECIPIENT_LIMIT === '0' ? null : 'EMAIL_DAILY_RECIPIENT_LIMIT=0',
        vars.EMAIL_MONTHLY_RECIPIENT_LIMIT === '0' ? null : 'EMAIL_MONTHLY_RECIPIENT_LIMIT=0',
        config.assets?.run_worker_first === true ? null : 'assets.run_worker_first=true',
        (config.kv_namespaces?.length ?? 0) === 0 ? null : 'no auto-provisioned KV namespaces',
        config.images == null ? null : 'no Cloudflare Images binding',
        (config.routes?.length ?? 0) === 0 ? null : 'no custom routes/domains',
        serviceBinding?.service === 'espanol-honesto-fulfillment-production'
            ? null
            : 'FULFILLMENT_SERVICE=espanol-honesto-fulfillment-production',
    ].filter((value): value is string => Boolean(value));

    const forbiddenNames = forbiddenBootstrapConfigVariableNames.filter((key) =>
        Object.prototype.hasOwnProperty.call(vars, key),
    );
    if (forbiddenNames.length > 0) {
        mismatches.push(`forbidden bootstrap vars=${forbiddenNames.join(',')}`);
    }
    const forbiddenConfigNames = googleRuntimeVariableNames.filter((key) => configSource.includes(key));
    if (forbiddenConfigNames.length > 0) {
        mismatches.push(`forbidden Google names in generated config=${forbiddenConfigNames.join(',')}`);
    }
    if (mismatches.length > 0) {
        throw new Error(`[build:production:bootstrap] Generated bootstrap package is unsafe: ${mismatches.join(', ')}.`);
    }
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    runProductionBootstrapBuild();
}
