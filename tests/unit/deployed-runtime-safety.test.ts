import { describe, expect, it } from 'vitest';
import { createRuntimeAttestation } from '../../src/lib/runtime-attestation';
import {
    STAGING_FULFILLMENT_IDENTITY,
    STAGING_FULFILLMENT_ORIGIN,
    STAGING_SUPABASE_REF,
    STAGING_WEB_IDENTITY,
    STAGING_WEB_ORIGIN,
    assertExpectedStagingRuntimeInput,
    verifyDeployedStagingRuntime,
} from '../../scripts/smoke/deployed-runtime-safety';

const roleEmails = ['admin@test.invalid', 'teacher@test.invalid', 'student@test.invalid'];
const baseEnv: Record<string, string> = {
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    EMAIL_DAILY_RECIPIENT_LIMIT: '10',
    EMAIL_DELIVERY_MODE: 'allowlist',
    EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
    EMAIL_RECIPIENT_ALLOWLIST: roleEmails.join(','),
    FULFILLMENT_WORKER_URL: STAGING_FULFILLMENT_ORIGIN,
    GOOGLE_ADMIN_EMAIL: 'admin@staging.invalid',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'staging-root',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@staging.invalid',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'staging-private-key',
    GOOGLE_TEMPLATE_DOC_ID: 'staging-template',
    INTERNAL_JOB_SECRET: 'staging-internal-secret',
    PUBLIC_APP_ENV: 'staging',
    PUBLIC_SITE_URL: STAGING_WEB_ORIGIN,
    PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_staging',
    PUBLIC_SUPABASE_ANON_KEY: 'staging-anon',
    PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
    RESEND_API_KEY: 're_staging',
    RESEND_FROM_EMAIL: 'Staging <staging@espanolhonesto.com>',
    STRIPE_EXPECTED_ACCOUNT_ID: 'acct_staging',
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_staging',
    STRIPE_SECRET_KEY: 'sk_test_staging',
    STRIPE_WEBHOOK_SECRET: 'whsec_staging',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role',
};

const webVersionId = '11111111-1111-4111-8111-111111111111';
const fulfillmentVersionId = '22222222-2222-4222-8222-222222222222';

function deployedFetch(options?: { fulfillmentGoogleKey?: string }) {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.href === `${STAGING_WEB_ORIGIN}/es`) {
            return new Response('<html></html>', { status: 200 });
        }
        if (url.href === `${STAGING_FULFILLMENT_ORIGIN}/health`) {
            return Response.json({ ok: true, service: 'fulfillment-worker', runtime: 'cloudflare-workers' });
        }

        const body = JSON.parse(String(init?.body)) as { nonce: string };
        if (url.href === `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`) {
            return Response.json(await createRuntimeAttestation('web', {
                ...baseEnv,
                CHECKOUT_ENABLED_OVERRIDE: 'true',
                SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
                WORKER_IDENTITY: STAGING_WEB_IDENTITY,
                WORKER_VERSION_ID: webVersionId,
            }, body.nonce));
        }
        if (url.href === `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`) {
            return Response.json(await createRuntimeAttestation('fulfillment', {
                ...baseEnv,
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                FULFILLMENT_RUNTIME_MODE: 'active',
                GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: options?.fulfillmentGoogleKey ?? baseEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
                SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
                WORKER_IDENTITY: STAGING_FULFILLMENT_IDENTITY,
                WORKER_VERSION_ID: fulfillmentVersionId,
            }, body.nonce));
        }
        return new Response('not found', { status: 404 });
    };
}

describe('deployed staging runtime safety', () => {
    it('verifies both deployed Workers and their complete staging configuration', async () => {
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedWebCheckoutOverride: 'true',
            fetchImpl: deployedFetch(),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).resolves.toEqual({ fulfillmentVersionId, webVersionId });
    });

    it('rejects a deployed Google boundary that differs from the approved staging source', async () => {
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedWebCheckoutOverride: 'true',
            fetchImpl: deployedFetch({ fulfillmentGoogleKey: 'different-deployed-key' }),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).rejects.toThrow('fulfillment runtime attestation does not match');
    });

    it('rejects a non-staging environment and any broader recipient allowlist', () => {
        expect(() => assertExpectedStagingRuntimeInput({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: { ...baseEnv, PUBLIC_APP_ENV: 'production' },
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).toThrow('PUBLIC_APP_ENV must be staging');

        expect(() => assertExpectedStagingRuntimeInput({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: { ...baseEnv, EMAIL_RECIPIENT_ALLOWLIST: `${baseEnv.EMAIL_RECIPIENT_ALLOWLIST},extra@test.invalid` },
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).toThrow('exactly the three existing allowlisted role accounts');
    });
});
