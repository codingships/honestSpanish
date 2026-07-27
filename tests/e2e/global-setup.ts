import type { FullConfig } from '@playwright/test';
import {
    PUBLIC_E2E_BASE_URL,
    PUBLIC_E2E_SUPABASE_REF,
} from './environment-guard';

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
    const configuredBaseUrl = config.projects[0]?.use.baseURL;
    const baseUrl = typeof configuredBaseUrl === 'string'
        ? configuredBaseUrl
        : PUBLIC_E2E_BASE_URL;
    if (baseUrl !== PUBLIC_E2E_BASE_URL) {
        throw new Error(`[e2e-env] Public Playwright requires ${PUBLIC_E2E_BASE_URL}`);
    }

    const response = await fetch(new URL('/api/e2e-runtime/environment', baseUrl));
    if (!response.ok) {
        throw new Error(`[e2e-env] Runtime identity endpoint failed with HTTP ${response.status}`);
    }

    const identity = await response.json() as RuntimeIdentity;
    const expected = PUBLIC_E2E_SUPABASE_REF;
    const valid = identity.appEnv === 'test'
        && identity.checkoutEnabled === false
        && identity.externalIntegrationsDisabled === true
        && identity.runtimeIsolationEnabled === true
        && identity.providerCredentialsPresent === false
        && identity.importMetaSupabaseRef === expected
        && identity.runtimeSupabaseRef === expected
        && identity.targetSupabaseRef === expected;

    if (!valid) {
        throw new Error(
            `[e2e-env] Runtime identity mismatch: expected inert public placeholder ${expected}; ` +
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

    console.log(`[e2e-env] runtime_verified=public-inert supabase_ref=${expected}`);
}
