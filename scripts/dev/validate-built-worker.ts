import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

type BuiltWranglerConfig = {
    configPath?: unknown;
    userConfigPath?: unknown;
    topLevelName?: unknown;
    definedEnvironments?: unknown;
    targetEnvironment?: unknown;
    keep_vars?: unknown;
    unsafe?: { metadata?: { keep_bindings?: unknown } };
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
const environment = argumentValue('--environment');
const dryRun = process.argv.includes('--dry-run');

if (environment !== 'staging') {
    throw new Error('[validate-built-worker] Only --environment staging is supported.');
}
if (!dryRun || process.argv.includes('--execute')) {
    throw new Error('[validate-built-worker] This validator supports --dry-run only; remote writes belong to an authorized workflow.');
}
if (!existsSync(builtConfigPath)) {
    throw new Error('[validate-built-worker] Missing dist/server/wrangler.json; build staging first.');
}

const config = JSON.parse(readFileSync(builtConfigPath, 'utf8')) as BuiltWranglerConfig;
validateBuiltConfig(config);

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const wranglerArgs = [
    '--config.verify-deps-before-run=false',
    'exec',
    'wrangler',
    'deploy',
    '--config',
    path.relative(workspaceRoot, builtConfigPath).replaceAll('\\', '/'),
    '--dry-run',
];

console.log(`[validate-built-worker] Validated Astro 7 staging package for ${String(config.name)}.`);
console.log(`[validate-built-worker] Cloudflare account=${accountId}; write=false; checkout=false.`);

const result = spawnSync(pnpm, wranglerArgs, {
    cwd: workspaceRoot,
    env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: '',
        WRANGLER_SEND_METRICS: 'false',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
if (result.error || result.status !== 0) {
    throw new Error(`[validate-built-worker] Wrangler failed with exit code ${String(result.status)}.`);
}

function validateBuiltConfig(configValue: BuiltWranglerConfig): void {
    const expected = {
        name: 'espanolhonesto-staging',
        supabaseRef: 'mzjyvmlxfpzdfdjzxxyj',
        site: 'https://staging.espanolhonesto.com',
        fulfillment: 'espanol-honesto-fulfillment-staging',
    };
    const vars = configValue.vars ?? {};
    const mismatches = [
        configValue.targetEnvironment === 'staging' ? null : 'targetEnvironment=staging',
        configValue.name === expected.name ? null : `name=${expected.name}`,
        configValue.topLevelName === 'espanolhonesto-env-required' ? null : 'topLevelName=espanolhonesto-env-required',
        configValue.keep_vars === false ? null : 'keep_vars=false',
        Array.isArray(configValue.unsafe?.metadata?.keep_bindings)
            && configValue.unsafe.metadata.keep_bindings.length === 0
            ? null
            : 'unsafe.metadata.keep_bindings=[]',
        configValue.main === 'entry.mjs' ? null : 'main=entry.mjs',
        configValue.assets?.binding === 'ASSETS' ? null : 'assets.binding=ASSETS',
        configValue.assets?.directory === '../client' ? null : 'assets.directory=../client',
        vars.PUBLIC_APP_ENV === 'staging' ? null : 'PUBLIC_APP_ENV=staging',
        vars.SUPABASE_EXPECTED_PROJECT_REF === expected.supabaseRef ? null : `SUPABASE_EXPECTED_PROJECT_REF=${expected.supabaseRef}`,
        Object.prototype.hasOwnProperty.call(vars, 'STRIPE_EXPECTED_ACCOUNT_ID')
            ? 'STRIPE_EXPECTED_ACCOUNT_ID must be a version-scoped secret only'
            : null,
        vars.WORKER_IDENTITY === expected.name ? null : `WORKER_IDENTITY=${expected.name}`,
        vars.PUBLIC_SITE_URL === expected.site ? null : `PUBLIC_SITE_URL=${expected.site}`,
        vars.CHECKOUT_ENABLED === 'true' ? null : 'CHECKOUT_ENABLED=true',
        vars.CHECKOUT_ENABLED_OVERRIDE === 'true' ? null : 'CHECKOUT_ENABLED_OVERRIDE=true',
        Array.isArray(configValue.definedEnvironments) && configValue.definedEnvironments.includes('staging')
            ? null
            : 'definedEnvironments includes staging',
        path.resolve(String(configValue.configPath ?? '')) === sourceConfigPath ? null : 'configPath=workspace/wrangler.toml',
        path.resolve(String(configValue.userConfigPath ?? '')) === sourceConfigPath ? null : 'userConfigPath=workspace/wrangler.toml',
        Array.isArray(configValue.services)
            && configValue.services.length === 1
            && configValue.services[0]?.binding === 'FULFILLMENT_SERVICE'
            && configValue.services[0]?.service === expected.fulfillment
            ? null
            : `FULFILLMENT_SERVICE=${expected.fulfillment}`,
        configValue.routes?.length === 1
            && configValue.routes[0]?.pattern === 'staging.espanolhonesto.com'
            && configValue.routes[0]?.custom_domain === true
            ? null
            : 'exact staging custom domain route',
        configValue.workers_dev === true ? null : 'staging workers_dev=true during transition',
        configValue.preview_urls === false ? null : 'staging preview_urls=false',
    ].filter((value): value is string => Boolean(value));

    const mainPath = path.resolve(path.dirname(builtConfigPath), String(configValue.main ?? ''));
    const assetsPath = path.resolve(path.dirname(builtConfigPath), String(configValue.assets?.directory ?? ''));
    const distRoot = path.resolve(workspaceRoot, 'dist');
    if (!isWithin(distRoot, mainPath) || !existsSync(mainPath)) mismatches.push('generated main exists inside dist');
    if (!isWithin(distRoot, assetsPath) || !existsSync(assetsPath)) mismatches.push('generated assets exist inside dist');

    if (mismatches.length > 0) {
        throw new Error(`[validate-built-worker] Refusing mismatched staging package: ${mismatches.join(', ')}.`);
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
