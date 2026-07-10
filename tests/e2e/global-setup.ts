import type { FullConfig } from '@playwright/test';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { STAGING_SUPABASE_PROJECT_REF } from './environment-guard';

type RuntimeIdentity = {
    appEnv?: string;
    checkoutEnabled?: boolean;
    externalIntegrationsDisabled?: boolean;
    importMetaSupabaseRef?: string | null;
    providerCredentialsPresent?: boolean;
    runtimeIsolationEnabled?: boolean;
    runtimeSupabaseRef?: string | null;
    targetSupabaseRef?: string | null;
};

export default async function verifyE2eRuntime(config: FullConfig): Promise<void> {
    const inertCiPublicMode = process.env.CI === 'true'
        && process.env.E2E_CI_PUBLIC_PLACEHOLDER === 'true'
        && process.env.PUBLIC_APP_ENV === 'test'
        && process.env.E2E_TARGET_SUPABASE_REF === 'placeholder';
    if (inertCiPublicMode) return;

    const configuredBaseUrl = config.projects[0]?.use.baseURL;
    const baseUrl = typeof configuredBaseUrl === 'string'
        ? configuredBaseUrl
        : process.env.TEST_BASE_URL || 'http://localhost:4321';
    const response = await fetch(new URL('/api/e2e-runtime/environment', baseUrl));

    if (!response.ok) {
        throw new Error(`[e2e-env] Runtime identity endpoint failed with HTTP ${response.status}`);
    }

    const identity = await response.json() as RuntimeIdentity;
    const expected = STAGING_SUPABASE_PROJECT_REF;
    const valid = identity.appEnv === 'staging'
        && identity.checkoutEnabled === false
        && identity.externalIntegrationsDisabled === true
        && identity.runtimeIsolationEnabled === true
        && identity.providerCredentialsPresent === false
        && identity.importMetaSupabaseRef === expected
        && identity.runtimeSupabaseRef === expected
        && identity.targetSupabaseRef === expected;

    if (!valid) {
        throw new Error(
            `[e2e-env] Runtime identity mismatch: expected isolated staging ${expected}; ` +
            `received app=${identity.appEnv ?? 'missing'}, ` +
            `import_meta=${identity.importMetaSupabaseRef ?? 'missing'}, ` +
            `runtime=${identity.runtimeSupabaseRef ?? 'missing'}, ` +
            `target=${identity.targetSupabaseRef ?? 'missing'}, ` +
            `checkout=${String(identity.checkoutEnabled)}, ` +
            `external_integrations_disabled=${String(identity.externalIntegrationsDisabled)}, ` +
            `runtime_isolation_enabled=${String(identity.runtimeIsolationEnabled)}, ` +
            `provider_credentials_present=${String(identity.providerCredentialsPresent)}`,
        );
    }

    for (const role of ['student', 'teacher', 'admin']) {
        rmSync(resolve(process.cwd(), 'tests', 'e2e', '.auth', `${role}.json`), { force: true });
    }

    console.log(`[e2e-env] runtime_verified=staging supabase_ref=${expected}`);
}
