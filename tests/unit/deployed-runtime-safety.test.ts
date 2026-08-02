import { describe, expect, it } from 'vitest';
import {
    createRuntimeAttestationForSchema,
    RUNTIME_ATTESTATION_SCHEMA,
    type SupportedRollbackAttestationSchema,
} from '../../src/lib/runtime-attestation';
import {
    STAGING_FULFILLMENT_IDENTITY,
    STAGING_FULFILLMENT_ORIGIN,
    STAGING_LEGACY_HEALTH_FULFILLMENT_VERSION_ID,
    STAGING_LEGACY_IDENTITY_FULFILLMENT_VERSION_ID,
    STAGING_LEGACY_IDENTITY_WEB_VERSION_ID,
    STAGING_SUPABASE_REF,
    STAGING_STRIPE_ACCOUNT_ID,
    STAGING_WEB_IDENTITY,
    STAGING_WEB_ORIGIN,
    assertStagingRollbackContract,
    assertExpectedStagingRuntimeInput,
    captureStagingRollbackBaseline,
    extractRollbackBindingNamesFromVersionView,
    verifyDeployedStagingRuntime,
    verifyStagingRollbackRuntime,
} from '../../scripts/smoke/deployed-runtime-safety';

const roleEmails = ['student@test.invalid', 'teacher@test.invalid', 'admin@test.invalid'];
const baseEnv: Record<string, string> = {
    ADMIN_EMAIL: roleEmails[2],
    CHECKOUT_HOLD_FINGERPRINT_SECRET: 'staging-checkout-hold-fingerprint-secret-32-bytes',
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    CRON_SECRET: 'staging-cron-secret',
    EMAIL_DAILY_RECIPIENT_LIMIT: '10',
    EMAIL_DELIVERY_MODE: 'allowlist',
    EMAIL_FROM: 'Staging <staging@espanolhonesto.com>',
    EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
    EMAIL_RECIPIENT_ALLOWLIST: roleEmails.join(','),
    FULFILLMENT_RUNTIME_MODE: 'active',
    FULFILLMENT_WORKER_URL: STAGING_FULFILLMENT_ORIGIN,
    GOOGLE_ADMIN_EMAIL: 'admin@staging.invalid',
    GOOGLE_DRIVE_ROOT_FOLDER_ID: 'staging-root',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@staging.invalid',
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'staging-private-key',
    GOOGLE_TEMPLATE_DOC_ID: 'staging-template',
    INTERNAL_JOB_SECRET: 'staging-internal-secret',
    LEVEL_CHECK_TOKEN_SECRET: 'staging-level-check-secret',
    PUBLIC_APP_ENV: 'staging',
    PUBLIC_SENTRY_DSN: 'https://public@sentry.invalid/1',
    PUBLIC_SITE_URL: STAGING_WEB_ORIGIN,
    PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_staging',
    PUBLIC_SUPABASE_ANON_KEY: 'staging-anon',
    PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_REF}.supabase.co`,
    PUBLIC_TURNSTILE_SITE_KEY: 'staging-turnstile-site-key',
    RESEND_API_KEY: 're_staging',
    RESEND_FROM_EMAIL: 'Staging <staging@espanolhonesto.com>',
    STRIPE_EXPECTED_ACCOUNT_ID: STAGING_STRIPE_ACCOUNT_ID,
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_staging',
    STRIPE_SECRET_KEY: 'sk_test_staging',
    STRIPE_WEBHOOK_SECRET: 'whsec_staging',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role',
    SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
    SUPPORT_ALERT_EMAIL: roleEmails[2],
    TURNSTILE_SECRET_KEY: 'staging-turnstile-secret-key',
    WEB_RUNTIME_MODE: 'active',
};

const webVersionId = '11111111-1111-4111-8111-111111111111';
const fulfillmentVersionId = STAGING_LEGACY_IDENTITY_FULFILLMENT_VERSION_ID;

const legacyFulfillmentBindingNames = [
    'CRON_SECRET',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'INTERNAL_JOB_SECRET',
    'PUBLIC_SUPABASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPPORT_ALERT_EMAIL',
];
const webBindingNames = Object.keys(baseEnv);

function deployedFetch(options?: {
    allowMissingBearer?: boolean;
    checkoutEnabled?: boolean;
    fulfillmentGoogleKey?: string;
    legacyFulfillmentHealth?: boolean;
    fulfillmentSchema?: SupportedRollbackAttestationSchema;
    fulfillmentVersionId?: string;
    overrideFulfillmentNonce?: string;
    overrideFulfillmentSchema?: number;
    webSecretKey?: string;
    webSchema?: SupportedRollbackAttestationSchema;
    webVersionId?: string;
}) {
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.href === `${STAGING_WEB_ORIGIN}/es`) {
            return new Response('<html></html>', { status: 200 });
        }
        if (url.href === `${STAGING_WEB_ORIGIN}/health`) {
            return Response.json({
                appEnvironment: 'staging',
                checkoutEnabled: options?.checkoutEnabled ?? false,
                runtimeMode: 'active',
                status: 'ok',
                workerIdentity: STAGING_WEB_IDENTITY,
            });
        }
        if (url.href === `${STAGING_FULFILLMENT_ORIGIN}/health`) {
            return Response.json({
                ...(options?.legacyFulfillmentHealth ? {} : { appEnvironment: 'staging', status: 'ok' }),
                ok: true,
                operationMode: 'active',
                service: 'fulfillment-worker',
                runtime: 'cloudflare-workers',
                workerIdentity: STAGING_FULFILLMENT_IDENTITY,
            });
        }
        if (url.href === `${STAGING_FULFILLMENT_ORIGIN}/internal/jobs/process`) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (url.href === `${STAGING_WEB_ORIGIN}/api/create-checkout`) {
            return Response.json({ error: 'Checkout is disabled' }, { status: 403 });
        }

        if (new Headers(init?.headers).get('Authorization') !== `Bearer ${baseEnv.INTERNAL_JOB_SECRET}`) {
            if (options?.allowMissingBearer) {
                return Response.json({ accepted: true });
            }
            return url.href === `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`
                ? Response.json({ error: 'Unauthorized' }, { status: 401 })
                : Response.json({ errorCode: 'ATTESTATION_UNAUTHORIZED' }, { status: 401 });
        }

        const body = JSON.parse(String(init?.body)) as { nonce: string };
        if (url.href === `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`) {
            const envelope = await createRuntimeAttestationForSchema('web', {
                ...baseEnv,
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                STRIPE_SECRET_KEY: options?.webSecretKey ?? baseEnv.STRIPE_SECRET_KEY,
                WORKER_IDENTITY: STAGING_WEB_IDENTITY,
                WORKER_VERSION_ID: options?.webVersionId ?? webVersionId,
            }, body.nonce, options?.webSchema ?? RUNTIME_ATTESTATION_SCHEMA, new Set(webBindingNames));
            return Response.json(envelope);
        }
        if (url.href === `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`) {
            const schema = options?.fulfillmentSchema ?? RUNTIME_ATTESTATION_SCHEMA;
            const envelope = await createRuntimeAttestationForSchema('fulfillment', {
                ...baseEnv,
                CHECKOUT_ENABLED_OVERRIDE: 'false',
                FULFILLMENT_RUNTIME_MODE: 'active',
                GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: options?.fulfillmentGoogleKey ?? baseEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
                SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
                WORKER_IDENTITY: STAGING_FULFILLMENT_IDENTITY,
                WORKER_VERSION_ID: options?.fulfillmentVersionId ?? fulfillmentVersionId,
            }, body.nonce, schema, new Set(legacyFulfillmentBindingNames));
            return Response.json({
                ...envelope,
                ...(options?.overrideFulfillmentNonce === undefined
                    ? {}
                    : { nonce: options.overrideFulfillmentNonce }),
                ...(options?.overrideFulfillmentSchema === undefined
                    ? {}
                    : { schema: options.overrideFulfillmentSchema }),
            });
        }
        return new Response('not found', { status: 404 });
    };
}

describe('deployed staging runtime safety', () => {
    it('anchors baseline binding names to the exact Wrangler version view', () => {
        const versionView = {
            id: fulfillmentVersionId,
            resources: {
                bindings: [
                    { name: 'INTERNAL_JOB_SECRET', type: 'secret_text' },
                    { name: 'PUBLIC_APP_ENV', type: 'plain_text' },
                ],
            },
        };
        expect(extractRollbackBindingNamesFromVersionView(
            versionView,
            fulfillmentVersionId,
            'fulfillment',
        )).toEqual(['INTERNAL_JOB_SECRET', 'PUBLIC_APP_ENV']);
        expect(() => extractRollbackBindingNamesFromVersionView(
            versionView,
            webVersionId,
            'fulfillment',
        )).toThrow('exact immutable version');
        expect(() => extractRollbackBindingNamesFromVersionView({
            ...versionView,
            resources: {
                bindings: [
                    { name: 'INTERNAL_JOB_SECRET', type: 'secret_text' },
                    { name: 'INTERNAL_JOB_SECRET', type: 'plain_text' },
                ],
            },
        }, fulfillmentVersionId, 'fulfillment')).toThrow('duplicates');
    });

    it('verifies both deployed Workers and their complete staging configuration', async () => {
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch(),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).resolves.toEqual({ fulfillmentVersionId, webVersionId });
    });

    it('rejects a deployed Google boundary that differs from the approved staging source', async () => {
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ fulfillmentGoogleKey: 'different-deployed-key' }),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).rejects.toThrow('fulfillment runtime attestation does not match');
    });

    it('captures and verifies an exact mixed schema 6/web and schema 5/fulfillment rollback contract', async () => {
        const fetchImpl = deployedFetch({ fulfillmentSchema: 5, webSchema: 6 });
        const contract = await captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl,
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        });

        expect(contract.web.schema).toBe(6);
        expect(contract.fulfillment.schema).toBe(5);
        expect(contract.web.verificationMode).toBe('configuration-hmac');
        expect(contract.fulfillment.verificationMode).toBe('configuration-hmac');
        expect(contract.fulfillment.bindingNames).not.toContain('ADMIN_EMAIL');
        await expect(verifyStagingRollbackRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            contract,
            env: baseEnv,
            fetchImpl,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).resolves.toEqual({ fulfillmentVersionId, webVersionId });
    });

    it('accepts the exact legacy fulfillment health contract only for rollback compatibility', async () => {
        const fetchImpl = deployedFetch({
            fulfillmentVersionId: STAGING_LEGACY_HEALTH_FULFILLMENT_VERSION_ID,
            legacyFulfillmentHealth: true,
        });
        const contract = await captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: STAGING_LEGACY_HEALTH_FULFILLMENT_VERSION_ID,
            expectedWebVersionId: webVersionId,
            fetchImpl,
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        });

        await expect(verifyStagingRollbackRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            contract,
            env: baseEnv,
            fetchImpl,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).resolves.toEqual({
            fulfillmentVersionId: STAGING_LEGACY_HEALTH_FULFILLMENT_VERSION_ID,
            webVersionId,
        });
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: STAGING_LEGACY_HEALTH_FULFILLMENT_VERSION_ID,
            expectedWebVersionId: webVersionId,
            fetchImpl,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).rejects.toThrow('invalid 200 response');
    });

    it('rejects the legacy fulfillment health contract for any other immutable version', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ legacyFulfillmentHealth: true }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('invalid 200 response');
    });

    it('does not allow schema 5 through the normal deployment verification path', async () => {
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ fulfillmentSchema: 5 }),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).rejects.toThrow('Runtime attestation response is invalid');
    });

    it('uses authenticated identity only for a legacy schema 5 config that cannot be reconstructed', async () => {
        const contract = await captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ fulfillmentSchema: 5 }),
            fulfillmentBindingNames: [...legacyFulfillmentBindingNames, 'ADMIN_EMAIL'],
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        });

        expect(contract.fulfillment.verificationMode).toBe('legacy-authenticated-identity');
        await expect(verifyStagingRollbackRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            contract,
            env: baseEnv,
            fetchImpl: deployedFetch({ fulfillmentSchema: 5 }),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).resolves.toEqual({ fulfillmentVersionId, webVersionId });
    });

    it('uses authenticated identity only for the exact legacy web schema 5 version', async () => {
        const legacyWebVersionId = STAGING_LEGACY_IDENTITY_WEB_VERSION_ID;
        const fetchImpl = deployedFetch({
            webSchema: 5,
            webSecretKey: 'immutable-legacy-web-secret',
            webVersionId: legacyWebVersionId,
        });
        const contract = await captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: legacyWebVersionId,
            fetchImpl,
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        });

        expect(contract.web.verificationMode).toBe('legacy-authenticated-identity');
        await expect(verifyStagingRollbackRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            contract,
            env: baseEnv,
            fetchImpl,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).resolves.toEqual({
            fulfillmentVersionId,
            webVersionId: legacyWebVersionId,
        });
    });

    it('rejects identity-only fallback for any other legacy web version', async () => {
        const unapprovedWebVersionId = '22222222-2222-4222-8222-222222222222';
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: unapprovedWebVersionId,
            fetchImpl: deployedFetch({
                webSchema: 5,
                webSecretKey: 'immutable-legacy-web-secret',
                webVersionId: unapprovedWebVersionId,
            }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('web baseline runtime attestation does not match');
    });

    it('never degrades a schema 6 web mismatch to identity-only verification', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: STAGING_LEGACY_IDENTITY_WEB_VERSION_ID,
            fetchImpl: deployedFetch({
                webSecretKey: 'different-schema-6-secret',
                webVersionId: STAGING_LEGACY_IDENTITY_WEB_VERSION_ID,
            }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('web baseline runtime attestation does not match');
    });

    it('never degrades a schema 6 configuration mismatch to identity-only verification', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ fulfillmentGoogleKey: 'different-deployed-key' }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('baseline runtime attestation does not match');
    });

    it('requires fail-closed probes before accepting a legacy identity baseline', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ checkoutEnabled: true, fulfillmentSchema: 5 }),
            fulfillmentBindingNames: [...legacyFulfillmentBindingNames, 'ADMIN_EMAIL'],
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('fail-closed staging contract');
    });

    it('never treats an invalid bearer or nonce as a legacy identity fallback', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: { ...baseEnv, INTERNAL_JOB_SECRET: 'wrong-internal-secret' },
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ fulfillmentSchema: 5 }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('baseline runtime attestation returned 401');

        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({
                fulfillmentSchema: 5,
                overrideFulfillmentNonce: 'different_nonce_value_1234',
            }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('identity or version does not match');
    });

    it('requires the attestation endpoints to reject a request without a bearer', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ allowMissingBearer: true, fulfillmentSchema: 5 }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('did not reject a missing bearer');
    });

    it('does not let a forged schema field enable legacy mode for another version', async () => {
        const unapprovedVersionId = '22222222-2222-4222-8222-222222222222';
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: unapprovedVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({
                fulfillmentSchema: 6,
                fulfillmentVersionId: unapprovedVersionId,
                overrideFulfillmentSchema: 5,
            }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('baseline runtime attestation does not match');
    });

    it('rejects an unknown schema during baseline capture', async () => {
        await expect(captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ overrideFulfillmentSchema: 8 }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        })).rejects.toThrow('Runtime attestation response is invalid');
    });

    it('rejects an unsupported schema in a persisted rollback contract', () => {
        expect(() => assertStagingRollbackContract({
            contractSchema: 2,
            web: {
                bindingNames: webBindingNames,
                role: 'web',
                schema: 8,
                verificationMode: 'configuration-hmac',
                workerIdentity: STAGING_WEB_IDENTITY,
                workerVersionId: webVersionId,
            },
            fulfillment: {
                bindingNames: legacyFulfillmentBindingNames,
                role: 'fulfillment',
                schema: 5,
                verificationMode: 'configuration-hmac',
                workerIdentity: STAGING_FULFILLMENT_IDENTITY,
                workerVersionId: fulfillmentVersionId,
            },
        })).toThrow('web rollback runtime contract is invalid');
    });

    it('rejects identity-only verification for any schema other than legacy schema 5', () => {
        expect(() => assertStagingRollbackContract({
            contractSchema: 2,
            web: {
                bindingNames: webBindingNames,
                role: 'web',
                schema: 6,
                verificationMode: 'legacy-authenticated-identity',
                workerIdentity: STAGING_WEB_IDENTITY,
                workerVersionId: webVersionId,
            },
            fulfillment: {
                bindingNames: legacyFulfillmentBindingNames,
                role: 'fulfillment',
                schema: 5,
                verificationMode: 'configuration-hmac',
                workerIdentity: STAGING_FULFILLMENT_IDENTITY,
                workerVersionId: fulfillmentVersionId,
            },
        })).toThrow('web rollback runtime contract is invalid');
    });

    it('rejects a persisted identity-only web contract for an unapproved version', () => {
        expect(() => assertStagingRollbackContract({
            contractSchema: 2,
            web: {
                bindingNames: webBindingNames,
                role: 'web',
                schema: 5,
                verificationMode: 'legacy-authenticated-identity',
                workerIdentity: STAGING_WEB_IDENTITY,
                workerVersionId: webVersionId,
            },
            fulfillment: {
                bindingNames: legacyFulfillmentBindingNames,
                role: 'fulfillment',
                schema: 5,
                verificationMode: 'configuration-hmac',
                workerIdentity: STAGING_FULFILLMENT_IDENTITY,
                workerVersionId: fulfillmentVersionId,
            },
        })).toThrow('web rollback runtime contract is invalid');
    });

    it('rejects rollback when the live schema differs from the captured exact schema', async () => {
        const contract = await captureStagingRollbackBaseline({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: webVersionId,
            fetchImpl: deployedFetch({ fulfillmentSchema: 5 }),
            fulfillmentBindingNames: legacyFulfillmentBindingNames,
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
            webBindingNames,
        });
        await expect(verifyStagingRollbackRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            contract,
            env: baseEnv,
            fetchImpl: deployedFetch({ fulfillmentSchema: 6 }),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).rejects.toThrow('Runtime attestation response is invalid');
    });

    it('rejects a runtime version other than the exact version activated by the deployment', async () => {
        await expect(verifyDeployedStagingRuntime({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: baseEnv,
            expectedFulfillmentVersionId: fulfillmentVersionId,
            expectedWebVersionId: '33333333-3333-4333-8333-333333333333',
            fetchImpl: deployedFetch(),
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).rejects.toThrow('web runtime identity or version does not match the exact version');
    });

    it('rejects any Stripe account other than the exact Academy staging sandbox', () => {
        expect(() => assertExpectedStagingRuntimeInput({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: { ...baseEnv, STRIPE_EXPECTED_ACCOUNT_ID: 'acct_other' },
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).toThrow(STAGING_STRIPE_ACCOUNT_ID);
    });

    it('rejects a staging runtime without the checkout hold fingerprint secret', () => {
        expect(() => assertExpectedStagingRuntimeInput({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: { ...baseEnv, CHECKOUT_HOLD_FINGERPRINT_SECRET: '' },
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).toThrow('CHECKOUT_HOLD_FINGERPRINT_SECRET');
    });

    it('rejects a staging runtime with a checkout hold fingerprint secret below 32 bytes', () => {
        expect(() => assertExpectedStagingRuntimeInput({
            baseOrigin: STAGING_WEB_ORIGIN,
            env: { ...baseEnv, CHECKOUT_HOLD_FINGERPRINT_SECRET: 'too-short' },
            fulfillmentOrigin: STAGING_FULFILLMENT_ORIGIN,
            roleEmails,
        })).toThrow('CHECKOUT_HOLD_FINGERPRINT_SECRET must contain at least 32 UTF-8 bytes');
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
