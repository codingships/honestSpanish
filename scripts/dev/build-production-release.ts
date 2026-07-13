import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { disableProductionReleaseSentryUpload } from './production-release-safety';

const productionRef = 'vkkahxsybhbutszerawz';
const productionSite = 'https://espanolhonesto.com';
const workspaceRoot = path.resolve(process.cwd());
const distRoot = path.resolve(workspaceRoot, 'dist');

if (distRoot !== path.join(workspaceRoot, 'dist')) {
    throw new Error('[build:production:release] Refused unsafe dist path.');
}

dotenv.config({ path: '.env.production', override: false, quiet: true });

const appEnvironment = process.env.PUBLIC_APP_ENV?.trim();
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF?.trim();
const publicSite = normalizeOrigin(process.env.PUBLIC_SITE_URL);
const runtimeRef = supabaseProjectRef(process.env.PUBLIC_SUPABASE_URL);

const mismatches = [
    appEnvironment === 'production' ? null : 'PUBLIC_APP_ENV=production',
    expectedRef === productionRef ? null : `SUPABASE_EXPECTED_PROJECT_REF=${productionRef}`,
    runtimeRef === productionRef ? null : `PUBLIC_SUPABASE_URL project=${productionRef}`,
    publicSite === productionSite ? null : `PUBLIC_SITE_URL=${productionSite}`,
].filter((value): value is string => Boolean(value));

if (mismatches.length > 0) {
    throw new Error(`[build:production:release] Refusing ambiguous production build; missing or mismatched: ${mismatches.join(', ')}.`);
}

process.env.CLOUDFLARE_ENV = 'production';
process.env.NODE_ENV = 'production';
process.env.PUBLIC_APP_ENV = 'production';
process.env.WEB_RUNTIME_MODE = 'active';
process.env.SUPABASE_EXPECTED_PROJECT_REF = productionRef;
process.env.PUBLIC_SITE_URL = productionSite;
process.env.CHECKOUT_ENABLED = 'false';
process.env.CHECKOUT_ENABLED_OVERRIDE = 'false';
// This exact Cloudflare transition does not authorize a Sentry release or
// sourcemap upload. Remove every credential needed by the Sentry build plugin
// even if the parent shell is CI or the production env file opted in.
disableProductionReleaseSentryUpload(process.env);
// Production runtime secrets are Cloudflare bindings. They must never be
// serialized into dist/server/.dev.vars by the Astro adapter.
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
// A mode transition must never reuse content-addressed chunks from the inert
// bootstrap build. The active package is rebuilt from an empty dist root and
// then validated before any launch runner may upload it.
rmSync(distRoot, { force: true, recursive: true });
const result = spawnSync(command, ['pnpm', 'exec', 'astro', 'build', '--mode', 'production'], {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (result.error || result.status !== 0) {
    throw new Error(`[build:production:release] Astro build failed with exit code ${String(result.status)}.`);
}

const forbiddenRuntimeFiles = existsSync(distRoot) ? findDevVars(distRoot) : [];
if (forbiddenRuntimeFiles.length > 0) {
    for (const filePath of forbiddenRuntimeFiles) {
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(`${distRoot}${path.sep}`)) {
            throw new Error('[build:production:release] Refusing to clean a generated runtime file outside dist.');
        }
        rmSync(resolved, { force: true });
    }
    throw new Error('[build:production:release] Refused package: generated .dev.vars files were removed from dist.');
}

validateGeneratedActiveConfig(path.join(distRoot, 'server', 'wrangler.json'));

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

function normalizeOrigin(value: string | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
        return url.origin;
    } catch {
        return null;
    }
}

function validateGeneratedActiveConfig(configPath: string): void {
    if (!existsSync(configPath)) {
        throw new Error('[build:production:release] Generated dist/server/wrangler.json is missing.');
    }

    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        assets?: { run_worker_first?: unknown };
        main?: unknown;
        name?: unknown;
        routes?: unknown[];
        services?: Array<{ binding?: unknown; service?: unknown }>;
        targetEnvironment?: unknown;
        triggers?: { crons?: unknown[] };
        vars?: Record<string, unknown>;
    };
    const vars = config.vars ?? {};
    const serviceBound = config.services?.some((binding) =>
        binding.binding === 'FULFILLMENT_SERVICE'
        && binding.service === 'espanol-honesto-fulfillment-production',
    ) === true;
    const expected: Array<[string, unknown, unknown]> = [
        ['name', config.name, 'espanolhonesto'],
        ['main', config.main, 'entry.mjs'],
        ['targetEnvironment', config.targetEnvironment, 'production'],
        ['PUBLIC_APP_ENV', vars.PUBLIC_APP_ENV, 'production'],
        ['WEB_RUNTIME_MODE', vars.WEB_RUNTIME_MODE, 'active'],
        ['SUPABASE_EXPECTED_PROJECT_REF', vars.SUPABASE_EXPECTED_PROJECT_REF, productionRef],
        ['WORKER_IDENTITY', vars.WORKER_IDENTITY, 'espanolhonesto'],
        ['PUBLIC_SITE_URL', vars.PUBLIC_SITE_URL, productionSite],
        ['CHECKOUT_ENABLED', vars.CHECKOUT_ENABLED, 'false'],
        ['CHECKOUT_ENABLED_OVERRIDE', vars.CHECKOUT_ENABLED_OVERRIDE, 'false'],
    ];
    const mismatches = expected
        .filter(([, actual, wanted]) => actual !== wanted)
        .map(([name, actual, wanted]) => `${name}=${String(actual ?? 'missing')} expected=${String(wanted)}`);

    if (!serviceBound) mismatches.push('FULFILLMENT_SERVICE=espanol-honesto-fulfillment-production');
    if (config.assets?.run_worker_first !== true) mismatches.push('assets.run_worker_first=true');
    if ((config.routes?.length ?? 0) > 0) mismatches.push('routes must be absent/empty');
    if ((config.triggers?.crons?.length ?? 0) > 0) mismatches.push('crons must be absent/empty');

    const forbiddenWebNames = [
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
    ].filter((name) => Object.prototype.hasOwnProperty.call(vars, name));
    if (forbiddenWebNames.length > 0) {
        mismatches.push(`fulfillment-only vars present=${forbiddenWebNames.join(',')}`);
    }

    if (mismatches.length > 0) {
        throw new Error(`[build:production:release] Generated active package is unsafe: ${mismatches.join(', ')}.`);
    }
}
