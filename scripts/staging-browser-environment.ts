import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

type EnvironmentMap = Record<string, string | undefined>;

export const STAGING_BROWSER_SUPABASE_REF = 'mzjyvmlxfpzdfdjzxxyj';
export const PRODUCTION_BROWSER_SUPABASE_REF = 'vkkahxsybhbutszerawz';
export const STAGING_BROWSER_ORIGIN = 'https://staging.espanolhonesto.com';

const supabaseRuntimeKeys = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DB_URL',
] as const;

const forbiddenTestSupabaseKeys = [
    ...supabaseRuntimeKeys,
    'SUPABASE_EXPECTED_PROJECT_REF',
    'E2E_TARGET_SUPABASE_REF',
] as const;

const browserDatabaseCredentialKeys = [
    'SUPABASE_DB_URL',
    'SUPABASE_STAGING_DB_URL',
    'SUPABASE_PRODUCTION_DB_URL',
    'DATABASE_URL',
    'PGPASSWORD',
    'PGHOST',
    'PGUSER',
    'PGDATABASE',
    'PGPORT',
] as const;

export interface StagingBrowserEnvironment {
    values: EnvironmentMap;
    stagingRef: typeof STAGING_BROWSER_SUPABASE_REF;
    protectedProductionCompared: boolean;
}

export interface LoadStagingBrowserEnvironmentOptions {
    cwd?: string;
    processEnv?: NodeJS.ProcessEnv;
}

export function buildStagingBrowserEnvironment(
    stagingEnv: EnvironmentMap,
    testEnv: EnvironmentMap,
    protectedProductionEnv: EnvironmentMap = {},
): StagingBrowserEnvironment {
    const stagingUrl = requireValue(stagingEnv, 'PUBLIC_SUPABASE_URL', '.env.staging');
    const stagingRef = readSupabaseProjectRef(stagingUrl, '.env.staging');
    if (stagingRef !== STAGING_BROWSER_SUPABASE_REF) {
        throw new Error(
            `[staging-browser-env] Refusing to run: .env.staging must target approved Supabase staging ${STAGING_BROWSER_SUPABASE_REF}`,
        );
    }

    if (requireValue(stagingEnv, 'SUPABASE_EXPECTED_PROJECT_REF', '.env.staging') !== STAGING_BROWSER_SUPABASE_REF) {
        throw new Error('[staging-browser-env] Refusing to run: .env.staging has an inconsistent Supabase project ref');
    }

    if (requireValue(stagingEnv, 'PUBLIC_APP_ENV', '.env.staging') !== 'staging') {
        throw new Error('[staging-browser-env] Refusing to run: .env.staging must set PUBLIC_APP_ENV=staging');
    }

    if (requireValue(stagingEnv, 'CHECKOUT_ENABLED', '.env.staging') !== 'false') {
        throw new Error('[staging-browser-env] Refusing to run: .env.staging must keep checkout disabled');
    }
    if (stagingEnv.CHECKOUT_ENABLED_OVERRIDE?.trim()
        && stagingEnv.CHECKOUT_ENABLED_OVERRIDE.trim() !== 'false') {
        throw new Error('[staging-browser-env] Refusing to run: .env.staging must keep the checkout override disabled');
    }

    assertStagingOrLocalBrowserBaseUrl(
        requireValue(stagingEnv, 'PUBLIC_SITE_URL', '.env.staging'),
        '.env.staging PUBLIC_SITE_URL',
    );

    const stagingDatabaseUrl = requireValue(stagingEnv, 'SUPABASE_DB_URL', '.env.staging');
    assertStagingDatabaseUrl(stagingDatabaseUrl);

    const stagingAnonKey = requireValue(stagingEnv, 'PUBLIC_SUPABASE_ANON_KEY', '.env.staging');
    const stagingServiceRoleKey = requireValue(stagingEnv, 'SUPABASE_SERVICE_ROLE_KEY', '.env.staging');
    if (stagingAnonKey === stagingServiceRoleKey) {
        throw new Error('[staging-browser-env] Refusing to run: staging Supabase keys are not distinct');
    }
    for (const [key, value] of [
        ['PUBLIC_SUPABASE_ANON_KEY', stagingAnonKey],
        ['SUPABASE_SERVICE_ROLE_KEY', stagingServiceRoleKey],
    ] as const) {
        if (containsProjectIdentity(value, PRODUCTION_BROWSER_SUPABASE_REF)) {
            throw new Error(`[staging-browser-env] Refusing to run: ${key} contains the protected production identity`);
        }
    }

    for (const key of forbiddenTestSupabaseKeys) {
        if (testEnv[key]?.trim()) {
            throw new Error(`[staging-browser-env] Refusing to run: .env.test cannot override ${key}`);
        }
    }

    const productionUrl = protectedProductionEnv.PUBLIC_SUPABASE_URL?.trim();
    let protectedProductionCompared = false;
    if (productionUrl) {
        if (readSupabaseProjectRef(productionUrl, 'protected .env') !== PRODUCTION_BROWSER_SUPABASE_REF) {
            throw new Error('[staging-browser-env] Refusing to run: protected .env does not identify expected production');
        }
        protectedProductionCompared = true;

        for (const key of supabaseRuntimeKeys) {
            const protectedValue = protectedProductionEnv[key]?.trim();
            const stagingValue = stagingEnv[key]?.trim();
            if (protectedValue && stagingValue === protectedValue) {
                throw new Error(`[staging-browser-env] Refusing to run: .env.staging reuses protected production ${key}`);
            }
        }
    }

    const values: EnvironmentMap = { ...stagingEnv };
    for (const [key, value] of Object.entries(testEnv)) {
        if (isTestOnlyOverride(key)) values[key] = value;
    }

    values.PUBLIC_APP_ENV = 'staging';
    values.PUBLIC_SUPABASE_URL = stagingUrl;
    values.SUPABASE_EXPECTED_PROJECT_REF = STAGING_BROWSER_SUPABASE_REF;
    values.E2E_TARGET_SUPABASE_REF = STAGING_BROWSER_SUPABASE_REF;
    values.CHECKOUT_ENABLED = 'false';
    values.CHECKOUT_ENABLED_OVERRIDE = 'false';
    values.CLOUDFLARE_ENV = 'staging';
    delete values.SUPABASE_DB_URL;

    return {
        values,
        stagingRef: STAGING_BROWSER_SUPABASE_REF,
        protectedProductionCompared,
    };
}

export function loadStagingBrowserEnvironment(
    options: LoadStagingBrowserEnvironmentOptions = {},
): StagingBrowserEnvironment {
    const cwd = options.cwd ?? process.cwd();
    const processEnv = options.processEnv ?? process.env;
    const stagingEnv = parseEnvironmentFile(path.resolve(cwd, '.env.staging'), true);
    const testEnv = parseEnvironmentFile(path.resolve(cwd, '.env.test'), false);
    const protectedProductionEnv = parseEnvironmentFile(path.resolve(cwd, '.env'), false);
    const result = buildStagingBrowserEnvironment(stagingEnv, testEnv, protectedProductionEnv);
    applyStagingBrowserEnvironment(processEnv, result.values);
    return result;
}

export function applyStagingBrowserEnvironment(
    processEnv: NodeJS.ProcessEnv,
    values: EnvironmentMap,
): void {
    for (const key of browserDatabaseCredentialKeys) delete processEnv[key];
    Object.assign(processEnv, values);
    for (const key of browserDatabaseCredentialKeys) delete processEnv[key];
}

export function assertStagingOrLocalBrowserBaseUrl(value: string, source: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`[staging-browser-env] ${source} must be a valid browser origin`);
    }

    const isOriginOnly = url.pathname === '/'
        && !url.search
        && !url.hash
        && !url.username
        && !url.password;
    const isApprovedStaging = url.origin === STAGING_BROWSER_ORIGIN;
    const isExplicitLocal = url.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

    if (!isOriginOnly || (!isApprovedStaging && !isExplicitLocal)) {
        throw new Error(
            `[staging-browser-env] Refusing ${source}: use an explicit local origin or ${STAGING_BROWSER_ORIGIN}`,
        );
    }

    return url.origin;
}

function parseEnvironmentFile(filePath: string, required: boolean): EnvironmentMap {
    if (!existsSync(filePath)) {
        if (required) {
            throw new Error(`[staging-browser-env] Required environment file is missing: ${path.basename(filePath)}`);
        }
        return {};
    }

    return dotenv.parse(readFileSync(filePath));
}

function requireValue(env: EnvironmentMap, key: string, source: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`[staging-browser-env] ${source} is missing ${key}`);
    return value;
}

function readSupabaseProjectRef(value: string, source: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`[staging-browser-env] ${source} contains an invalid PUBLIC_SUPABASE_URL`);
    }

    const match = /^([a-z0-9]+)\.supabase\.co$/iu.exec(url.hostname);
    if (
        url.protocol !== 'https:'
        || !match
        || url.pathname !== '/'
        || url.search
        || url.hash
        || url.username
        || url.password
        || url.port
    ) {
        throw new Error(`[staging-browser-env] ${source} contains an invalid Supabase project origin`);
    }
    return match[1];
}

function assertStagingDatabaseUrl(value: string): void {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('[staging-browser-env] .env.staging contains an invalid SUPABASE_DB_URL');
    }

    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new Error('[staging-browser-env] .env.staging contains an invalid SUPABASE_DB_URL protocol');
    }

    const identity = `${decodeURIComponent(url.username)}@${url.hostname}`.toLowerCase();
    if (identity.includes(PRODUCTION_BROWSER_SUPABASE_REF)) {
        throw new Error('[staging-browser-env] Refusing production SUPABASE_DB_URL');
    }
    if (!identity.includes(STAGING_BROWSER_SUPABASE_REF)) {
        throw new Error('[staging-browser-env] SUPABASE_DB_URL must identify approved Supabase staging');
    }
}

function isTestOnlyOverride(key: string): boolean {
    return /^(?:TEST|E2E)_[A-Z0-9_]+$/u.test(key);
}

function containsProjectIdentity(value: string, projectRef: string): boolean {
    if (value.toLowerCase().includes(projectRef)) return true;

    for (const segment of value.split('.')) {
        try {
            if (Buffer.from(segment, 'base64url').toString('utf8').toLowerCase().includes(projectRef)) {
                return true;
            }
        } catch {
            // Opaque API keys are expected; exact production comparisons happen separately.
        }
    }

    return false;
}
