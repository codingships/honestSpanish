import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';

const productionRef = 'vkkahxsybhbutszerawz';
const productionSite = 'https://espanolhonesto.com';

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
// Production runtime secrets are Cloudflare bindings. They must never be
// serialized into dist/server/.dev.vars by the Astro adapter.
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

const command = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
const result = spawnSync(command, ['pnpm', 'exec', 'astro', 'build', '--mode', 'production'], {
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (result.error || result.status !== 0) {
    throw new Error(`[build:production:release] Astro build failed with exit code ${String(result.status)}.`);
}

const distRoot = path.resolve(process.cwd(), 'dist');
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
