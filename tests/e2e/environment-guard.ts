import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

type EnvironmentMap = Record<string, string | undefined>;

export const STAGING_SUPABASE_PROJECT_REF = 'mzjyvmlxfpzdfdjzxxyj';
export const PRODUCTION_SUPABASE_PROJECT_REF = 'vkkahxsybhbutszerawz';

const stagingKeys = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TEST_STUDENT_EMAIL',
    'TEST_STUDENT_PASSWORD',
    'TEST_TEACHER_EMAIL',
    'TEST_TEACHER_PASSWORD',
    'TEST_ADMIN_EMAIL',
    'TEST_ADMIN_PASSWORD',
] as const;

const externalProviderKeys = [
    'CRON_SECRET',
    'FULFILLMENT_WORKER_URL',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'INTERNAL_JOB_SECRET',
    'INTERNAL_JOB_SERVICE_URL',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'RESEND_API_KEY',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_DSN',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
] as const;

function scrubExternalProviders(processEnv: NodeJS.ProcessEnv): void {
    for (const key of externalProviderKeys) delete processEnv[key];
    processEnv.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
}

function parseEnvironmentFile(path: string, required: boolean): EnvironmentMap {
    if (!existsSync(path)) {
        if (required) throw new Error(`[e2e-env] Required environment file is missing: ${path}`);
        return {};
    }

    return dotenv.parse(readFileSync(path));
}

function requireValue(env: EnvironmentMap, key: string, source: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`[e2e-env] ${source} is missing ${key}`);
    return value;
}

function supabaseProjectRef(value: string, source: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`[e2e-env] ${source} contains an invalid PUBLIC_SUPABASE_URL`);
    }

    const match = /^([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname);
    if (!match) throw new Error(`[e2e-env] ${source} is not a Supabase project URL`);
    return match[1];
}

function localBaseUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('[e2e-env] .env.test contains an invalid TEST_BASE_URL');
    }

    const allowedOrigins = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
    if (
        !allowedOrigins.has(url.origin) ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
    ) {
        throw new Error('[e2e-env] TEST_BASE_URL must be an exact local Astro origin on port 4321');
    }

    return url.origin;
}

export function buildLocalStagingEnvironment(
    testEnv: EnvironmentMap,
    stagingEnv: EnvironmentMap,
    productionEnv: EnvironmentMap,
): { values: EnvironmentMap; stagingRef: string } {
    const stagingUrl = requireValue(stagingEnv, 'PUBLIC_SUPABASE_URL', '.env.staging');
    const productionUrl = requireValue(productionEnv, 'PUBLIC_SUPABASE_URL', '.env');
    const stagingRef = supabaseProjectRef(stagingUrl, '.env.staging');
    const productionRef = supabaseProjectRef(productionUrl, '.env');

    if (stagingRef !== STAGING_SUPABASE_PROJECT_REF) {
        throw new Error(
            `[e2e-env] Refusing to run: .env.staging must target the approved staging project ${STAGING_SUPABASE_PROJECT_REF}`,
        );
    }

    if (productionRef !== PRODUCTION_SUPABASE_PROJECT_REF) {
        throw new Error(
            `[e2e-env] Refusing to run: .env must identify the protected production project ${PRODUCTION_SUPABASE_PROJECT_REF}`,
        );
    }

    const stagingServiceRole = requireValue(stagingEnv, 'SUPABASE_SERVICE_ROLE_KEY', '.env.staging');
    const productionServiceRole = requireValue(productionEnv, 'SUPABASE_SERVICE_ROLE_KEY', '.env');
    if (stagingServiceRole === productionServiceRole) {
        throw new Error('[e2e-env] Refusing to run: staging and production use the same Supabase service-role key');
    }

    const values: EnvironmentMap = { ...testEnv };
    for (const key of stagingKeys) {
        values[key] = requireValue(stagingEnv, key, '.env.staging');
    }

    values.PUBLIC_APP_ENV = 'staging';
    values.TEST_BASE_URL = localBaseUrl(requireValue(testEnv, 'TEST_BASE_URL', '.env.test'));
    values.CHECKOUT_ENABLED = 'false';
    values.E2E_DISABLE_EXTERNAL_INTEGRATIONS = 'true';
    values.E2E_RUNTIME_ISOLATED = 'true';
    values.E2E_TARGET_SUPABASE_REF = stagingRef;

    return { values, stagingRef };
}

export function configurePlaywrightEnvironment(
    processEnv: NodeJS.ProcessEnv = process.env,
    cwd: string = process.cwd(),
): { target: 'ci' | 'staging'; supabaseRef: string | null } {
    if (processEnv.CI === 'true') {
        if (processEnv.E2E_CI_PUBLIC_PLACEHOLDER !== 'true') {
            throw new Error('[e2e-env] CI Playwright requires explicit E2E_CI_PUBLIC_PLACEHOLDER=true');
        }

        const ciUrl = requireValue(processEnv, 'PUBLIC_SUPABASE_URL', 'CI environment');
        if (
            ciUrl !== 'https://placeholder.supabase.co' ||
            requireValue(processEnv, 'PUBLIC_SUPABASE_ANON_KEY', 'CI environment') !== 'placeholder-anon-key' ||
            requireValue(processEnv, 'SUPABASE_SERVICE_ROLE_KEY', 'CI environment') !== 'placeholder-service-role-key'
        ) {
            throw new Error('[e2e-env] CI public mode accepts only the inert placeholder Supabase credentials');
        }

        for (const key of stagingKeys.filter((key) => key.startsWith('TEST_'))) {
            if (processEnv[key]) throw new Error(`[e2e-env] CI public mode refuses authenticated credential ${key}`);
        }

        scrubExternalProviders(processEnv);
        processEnv.PUBLIC_APP_ENV = 'test';
        processEnv.TEST_BASE_URL = 'http://localhost:4321';
        processEnv.CHECKOUT_ENABLED = 'false';
        processEnv.E2E_DISABLE_EXTERNAL_INTEGRATIONS = 'true';
        processEnv.E2E_RUNTIME_ISOLATED = 'true';
        processEnv.E2E_TARGET_SUPABASE_REF = 'placeholder';
        return {
            target: 'ci',
            supabaseRef: 'placeholder',
        };
    }

    const testEnv = parseEnvironmentFile(resolve(cwd, '.env.test'), false);
    const stagingEnv = parseEnvironmentFile(resolve(cwd, '.env.staging'), true);
    const productionEnv = parseEnvironmentFile(resolve(cwd, '.env'), true);
    const { values, stagingRef } = buildLocalStagingEnvironment(testEnv, stagingEnv, productionEnv);
    Object.assign(processEnv, values);
    scrubExternalProviders(processEnv);

    console.log(`[e2e-env] target=staging supabase_ref=${stagingRef} external_integrations=disabled checkout=disabled`);
    return { target: 'staging', supabaseRef: stagingRef };
}
