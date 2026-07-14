import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type DeploymentEnvironment = 'staging' | 'production';

type BuiltWranglerConfig = {
    configPath?: unknown;
    userConfigPath?: unknown;
    topLevelName?: unknown;
    definedEnvironments?: unknown;
    targetEnvironment?: unknown;
    keep_vars?: unknown;
    name?: unknown;
    main?: unknown;
    preview_urls?: unknown;
    routes?: Array<{ custom_domain?: unknown; pattern?: unknown }>;
    workers_dev?: unknown;
    assets?: { binding?: unknown; directory?: unknown };
    vars?: Record<string, unknown>;
    services?: Array<{ binding?: unknown; service?: unknown }>;
};

const accountId = 'd1a22bcf6477ff2ff31d2bfb83084e44';
const workspaceRoot = process.cwd();
const builtConfigPath = path.join(workspaceRoot, 'dist', 'server', 'wrangler.json');
const sourceConfigPath = path.join(workspaceRoot, 'wrangler.toml');
const environment = argumentValue('--environment') as DeploymentEnvironment | null;
const dryRun = process.argv.includes('--dry-run');
const execute = process.argv.includes('--execute');

if (environment !== 'staging' && environment !== 'production') {
    throw new Error('[deploy-built-worker] Use --environment staging or --environment production.');
}
if (dryRun === execute) {
    throw new Error('[deploy-built-worker] Select exactly one of --dry-run or --execute.');
}
if (execute && environment !== 'staging') {
    throw new Error('[deploy-built-worker] Generic production writes are forbidden; use the gated production phase-1 runner.');
}
if (!existsSync(builtConfigPath)) {
    throw new Error('[deploy-built-worker] Missing dist/server/wrangler.json; build the selected environment first.');
}

const config = JSON.parse(readFileSync(builtConfigPath, 'utf8')) as BuiltWranglerConfig;
validateBuiltConfig(config, environment);

if (execute) verifyCloudflareIdentity();

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const wranglerArgs = [
    '--config.verify-deps-before-run=false',
    'exec',
    'wrangler',
    'deploy',
    '--config',
    path.relative(workspaceRoot, builtConfigPath).replaceAll('\\', '/'),
    dryRun ? '--dry-run' : '--keep-vars',
];

console.log(`[deploy-built-worker] Validated Astro 6 ${environment} package for ${String(config.name)}.`);
console.log(`[deploy-built-worker] Cloudflare account=${accountId}; write=${String(execute)}; checkout=false.`);

const result = spawnSync(pnpm, wranglerArgs, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
if (result.error || result.status !== 0) {
    throw new Error(`[deploy-built-worker] Wrangler failed with exit code ${String(result.status)}.`);
}

function validateBuiltConfig(configValue: BuiltWranglerConfig, selectedEnvironment: DeploymentEnvironment): void {
    const expected = selectedEnvironment === 'staging'
        ? {
            name: 'espanolhonesto-staging',
            supabaseRef: 'mzjyvmlxfpzdfdjzxxyj',
            site: 'https://staging.espanolhonesto.com',
            fulfillment: 'espanol-honesto-fulfillment-staging',
        }
        : {
            name: 'espanolhonesto',
            supabaseRef: 'vkkahxsybhbutszerawz',
            site: 'https://espanolhonesto.com',
            fulfillment: 'espanol-honesto-fulfillment-production',
        };
    const vars = configValue.vars ?? {};
    const mismatches = [
        configValue.targetEnvironment === selectedEnvironment ? null : `targetEnvironment=${selectedEnvironment}`,
        configValue.name === expected.name ? null : `name=${expected.name}`,
        configValue.topLevelName === 'espanolhonesto-env-required' ? null : 'topLevelName=espanolhonesto-env-required',
        configValue.keep_vars === true ? null : 'keep_vars=true',
        configValue.main === 'entry.mjs' ? null : 'main=entry.mjs',
        configValue.assets?.binding === 'ASSETS' ? null : 'assets.binding=ASSETS',
        configValue.assets?.directory === '../client' ? null : 'assets.directory=../client',
        vars.PUBLIC_APP_ENV === selectedEnvironment ? null : `PUBLIC_APP_ENV=${selectedEnvironment}`,
        vars.SUPABASE_EXPECTED_PROJECT_REF === expected.supabaseRef ? null : `SUPABASE_EXPECTED_PROJECT_REF=${expected.supabaseRef}`,
        vars.WORKER_IDENTITY === expected.name ? null : `WORKER_IDENTITY=${expected.name}`,
        vars.PUBLIC_SITE_URL === expected.site ? null : `PUBLIC_SITE_URL=${expected.site}`,
        vars.CHECKOUT_ENABLED === 'false' ? null : 'CHECKOUT_ENABLED=false',
        vars.CHECKOUT_ENABLED_OVERRIDE === 'false' ? null : 'CHECKOUT_ENABLED_OVERRIDE=false',
        Array.isArray(configValue.definedEnvironments) && configValue.definedEnvironments.includes(selectedEnvironment)
            ? null
            : `definedEnvironments includes ${selectedEnvironment}`,
        path.resolve(String(configValue.configPath ?? '')) === sourceConfigPath ? null : 'configPath=workspace/wrangler.toml',
        path.resolve(String(configValue.userConfigPath ?? '')) === sourceConfigPath ? null : 'userConfigPath=workspace/wrangler.toml',
        Array.isArray(configValue.services)
            && configValue.services.length === 1
            && configValue.services[0]?.binding === 'FULFILLMENT_SERVICE'
            && configValue.services[0]?.service === expected.fulfillment
            ? null
            : `FULFILLMENT_SERVICE=${expected.fulfillment}`,
        selectedEnvironment === 'staging'
            ? (
                configValue.routes?.length === 1
                && configValue.routes[0]?.pattern === 'staging.espanolhonesto.com'
                && configValue.routes[0]?.custom_domain === true
                    ? null
                    : 'exact staging custom domain route'
            )
            : (
                configValue.routes === undefined || configValue.routes.length === 0
                    ? null
                    : 'no production custom routes'
            ),
        selectedEnvironment !== 'staging' || configValue.workers_dev === true
            ? null
            : 'staging workers_dev=true during transition',
        selectedEnvironment !== 'staging' || configValue.preview_urls === false
            ? null
            : 'staging preview_urls=false',
    ].filter((value): value is string => Boolean(value));

    const mainPath = path.resolve(path.dirname(builtConfigPath), String(configValue.main ?? ''));
    const assetsPath = path.resolve(path.dirname(builtConfigPath), String(configValue.assets?.directory ?? ''));
    const distRoot = path.resolve(workspaceRoot, 'dist');
    if (!isWithin(distRoot, mainPath) || !existsSync(mainPath)) mismatches.push('generated main exists inside dist');
    if (!isWithin(distRoot, assetsPath) || !existsSync(assetsPath)) mismatches.push('generated assets exist inside dist');

    if (mismatches.length > 0) {
        throw new Error(`[deploy-built-worker] Refusing mismatched ${selectedEnvironment} package: ${mismatches.join(', ')}.`);
    }
}

function verifyCloudflareIdentity(): void {
    const configuredAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (configuredAccount && configuredAccount !== accountId) {
        throw new Error(`[deploy-built-worker] CLOUDFLARE_ACCOUNT_ID must equal ${accountId}.`);
    }

    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const result = spawnSync(pnpm, [
        '--config.verify-deps-before-run=false',
        'exec',
        'wrangler',
        'whoami',
        '--json',
    ], {
        cwd: workspaceRoot,
        env: process.env,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 60_000,
    });
    if (result.error || result.status !== 0) {
        throw new Error('[deploy-built-worker] Cloudflare identity preflight failed.');
    }
    const raw = typeof result.stdout === 'string' ? result.stdout : '';
    const jsonStart = raw.indexOf('{');
    if (jsonStart < 0) throw new Error('[deploy-built-worker] Cloudflare identity JSON was not returned.');
    const identity = JSON.parse(raw.slice(jsonStart)) as {
        loggedIn?: unknown;
        accounts?: Array<{ id?: unknown }>;
    };
    if (identity.loggedIn !== true || !identity.accounts?.some((account) => account.id === accountId)) {
        throw new Error(`[deploy-built-worker] Authenticated Cloudflare identity does not include account ${accountId}.`);
    }
}

function argumentValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function isWithin(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
