type EnvironmentMap = Record<string, string | undefined>;

export const PUBLIC_E2E_SUPABASE_REF = 'placeholder';
export const PUBLIC_E2E_SUPABASE_URL = 'https://placeholder.supabase.co';
export const PUBLIC_E2E_SUPABASE_ANON_KEY = 'placeholder-anon-key';
export const PUBLIC_E2E_SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service-role-key';
export const PUBLIC_E2E_BASE_URL = 'http://localhost:4321';

const externalCredentialKeys = [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CRON_SECRET',
    'DATABASE_URL',
    'FULFILLMENT_WORKER_URL',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'INTERNAL_JOB_SECRET',
    'INTERNAL_JOB_SERVICE_URL',
    'PGDATABASE',
    'PGHOST',
    'PGPASSWORD',
    'PGPORT',
    'PGUSER',
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
] as const;

const publicValues: Readonly<EnvironmentMap> = {
    PUBLIC_SUPABASE_URL: PUBLIC_E2E_SUPABASE_URL,
    PUBLIC_SUPABASE_ANON_KEY: PUBLIC_E2E_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: PUBLIC_E2E_SUPABASE_SERVICE_ROLE_KEY,
    PUBLIC_APP_ENV: 'test',
    PUBLIC_SITE_URL: PUBLIC_E2E_BASE_URL,
    TEST_BASE_URL: PUBLIC_E2E_BASE_URL,
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
    E2E_RUNTIME_ISOLATED: 'true',
    E2E_TARGET_SUPABASE_REF: PUBLIC_E2E_SUPABASE_REF,
    SUPABASE_EXPECTED_PROJECT_REF: PUBLIC_E2E_SUPABASE_REF,
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
};

const allowedPlaywrightTestMetadataKeys = new Set([
    'TEST_BASE_URL',
    'TEST_PARALLEL_INDEX',
    'TEST_WORKER_INDEX',
]);

function inheritedTestCredentials(processEnv: EnvironmentMap): string[] {
    return Object.entries(processEnv)
        .filter(([key, value]) =>
            key.startsWith('TEST_') && !allowedPlaywrightTestMetadataKeys.has(key) && Boolean(value?.trim()))
        .map(([key]) => key)
        .sort();
}

export function configurePlaywrightEnvironment(
    processEnv: NodeJS.ProcessEnv = process.env,
): { target: 'public'; supabaseRef: typeof PUBLIC_E2E_SUPABASE_REF } {
    const inheritedCredentials = inheritedTestCredentials(processEnv);
    if (inheritedCredentials.length > 0) {
        throw new Error(
            `[e2e-env] Public Playwright refuses inherited TEST_* credentials: ${inheritedCredentials.join(', ')}`,
        );
    }

    for (const key of externalCredentialKeys) delete processEnv[key];
    delete processEnv.E2E_CI_PUBLIC_PLACEHOLDER;
    Object.assign(processEnv, publicValues);

    return {
        target: 'public',
        supabaseRef: PUBLIC_E2E_SUPABASE_REF,
    };
}
