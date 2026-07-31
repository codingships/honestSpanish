import { describe, expect, it } from 'vitest';
import {
    buildRuntimeAttestationConfig,
    buildRuntimeAttestationConfigForSchema,
    createRuntimeAttestation,
    isValidAttestationNonce,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
} from '../../src/lib/runtime-attestation';

function runtimeEnv() {
    return {
        ADMIN_EMAIL: 'admin@example.com',
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        EMAIL_DAILY_RECIPIENT_LIMIT: '10',
        EMAIL_DELIVERY_MODE: 'allowlist',
        EMAIL_FROM: 'Sender <sender@example.com>',
        EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
        EMAIL_RECIPIENT_ALLOWLIST: 'test@example.com',
        FULFILLMENT_WORKER_URL: 'https://fulfillment.example.com',
        INTERNAL_JOB_SECRET: 'attestation-secret',
        PUBLIC_APP_ENV: 'staging',
        PUBLIC_SENTRY_DSN: 'https://public@example.invalid/123',
        PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_attested',
        PUBLIC_SUPABASE_ANON_KEY: 'anon',
        PUBLIC_SUPABASE_URL: 'https://staging.supabase.co',
        RESEND_API_KEY: 'resend',
        RESEND_FROM_EMAIL: 'Fallback <fallback@example.com>',
        STRIPE_EXPECTED_ACCOUNT_ID: 'acct_attested',
        STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_attested',
        STRIPE_SECRET_KEY: 'sk_test_attested',
        STRIPE_WEBHOOK_SECRET: 'whsec_attested',
        SUPABASE_EXPECTED_PROJECT_REF: 'staging',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
        SUPPORT_ALERT_EMAIL: 'support@example.com',
        WEB_RUNTIME_MODE: 'active',
        WORKER_IDENTITY: 'espanolhonesto-staging',
        WORKER_VERSION_ID: '11111111-1111-4111-8111-111111111111',
    };
}

describe('runtime attestation', () => {
    it('returns an opaque proof and verifies only against externally expected config', async () => {
        const env = runtimeEnv();
        const nonce = 'nonce_1234567890abcdef';
        const envelope = await createRuntimeAttestation('web', env, nonce);
        expect(envelope).not.toHaveProperty('config');
        expect(envelope.proof).toMatch(/^[a-f0-9]{64}$/);

        const config = await buildRuntimeAttestationConfig('web', env);
        await expect(verifyRuntimeAttestation(envelope, {
            config,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, env.INTERNAL_JOB_SECRET)).resolves.toBe(true);

        const wrongStripeConfig = await buildRuntimeAttestationConfig('web', {
            ...env,
            STRIPE_EXPECTED_ACCOUNT_ID: 'acct_wrong',
        });
        await expect(verifyRuntimeAttestation(envelope, {
            config: wrongStripeConfig,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, env.INTERNAL_JOB_SECRET)).resolves.toBe(false);

        const wrongConfig = await buildRuntimeAttestationConfig('web', {
            ...env,
            WORKER_VERSION_ID: '22222222-2222-4222-8222-222222222222',
        });
        await expect(verifyRuntimeAttestation(envelope, {
            config: wrongConfig,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, env.INTERNAL_JOB_SECRET)).resolves.toBe(false);
    });

    it('attests Stripe only at the web boundary', async () => {
        const env = runtimeEnv();
        const web = await buildRuntimeAttestationConfig('web', env);
        const fulfillment = await buildRuntimeAttestationConfig('fulfillment', env);

        expect(web.stripeBoundary).toBe('configured');
        expect(web.stripeExpectedAccountId).toBe(env.STRIPE_EXPECTED_ACCOUNT_ID);
        expect(web.stripeSecretKeyFingerprint).toMatch(/^sha256:/u);
        expect(fulfillment.stripeBoundary).toBe('absent');
        expect(fulfillment.stripeExpectedAccountId).toBe('');
        expect(fulfillment.stripeSecretKeyFingerprint).toBe('absent');
    });

    it('keeps web-only operational secrets absent from the fulfillment boundary', async () => {
        const env = {
            ...runtimeEnv(),
            CRON_SECRET: 'cron-secret',
            LEVEL_CHECK_TOKEN_SECRET: 'level-check-secret',
            PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site-key',
            TURNSTILE_SECRET_KEY: 'turnstile-secret-key',
        };
        const web = await buildRuntimeAttestationConfig('web', env);
        const fulfillment = await buildRuntimeAttestationConfig('fulfillment', env);

        for (const key of [
            'adminEmailFingerprint',
            'cronSecretFingerprint',
            'levelCheckSecretFingerprint',
            'publicSentryDsnFingerprint',
            'supportAlertEmailFingerprint',
            'turnstileSecretFingerprint',
            'turnstileSiteKeyFingerprint',
        ] as const) {
            expect(web[key]).toMatch(/^sha256:/u);
            expect(fulfillment[key]).toBe('absent');
        }
    });

    it('reconstructs schema 5 fulfillment using only bindings present on the immutable baseline', async () => {
        const env = {
            ...runtimeEnv(),
            CRON_SECRET: 'legacy-cron',
            LEVEL_CHECK_TOKEN_SECRET: 'not-deployed',
            PUBLIC_TURNSTILE_SITE_KEY: 'not-deployed',
            TURNSTILE_SECRET_KEY: 'not-deployed',
        };
        const legacy = await buildRuntimeAttestationConfigForSchema(
            'fulfillment',
            env,
            5,
            new Set(['CRON_SECRET', 'SUPPORT_ALERT_EMAIL']),
        );

        expect(legacy.cronSecretFingerprint).toMatch(/^sha256:/u);
        expect(legacy.supportAlertEmailFingerprint).toMatch(/^sha256:/u);
        expect(legacy.adminEmailFingerprint).toBe('absent');
        expect(legacy.levelCheckSecretFingerprint).toBe('absent');
        expect(legacy.publicSentryDsnFingerprint).toBe('absent');
        expect(legacy.turnstileSiteKeyFingerprint).toBe('absent');
        expect(legacy.turnstileSecretFingerprint).toBe('absent');
        await expect(buildRuntimeAttestationConfigForSchema('fulfillment', env, 5)).rejects.toThrow(
            'requires an exact binding-name inventory',
        );
    });

    it.each([
        ['PUBLIC_SENTRY_DSN', 'publicSentryDsnFingerprint', 'https://public@example.invalid/changed'],
        ['ADMIN_EMAIL', 'adminEmailFingerprint', 'changed-admin@example.com'],
        ['SUPPORT_ALERT_EMAIL', 'supportAlertEmailFingerprint', 'changed-support@example.com'],
        ['RESEND_FROM_EMAIL', 'resendFromEmailFingerprint', 'Changed fallback <changed-fallback@example.com>'],
    ] as const)('HMAC-binds an independent non-reversible %s fingerprint', async (
        envKey,
        fingerprintKey,
        changedValue,
    ) => {
        const env = runtimeEnv();
        const nonce = `independent_${envKey.toLowerCase()}_123456`;
        const envelope = await createRuntimeAttestation('web', env, nonce);
        const config = await buildRuntimeAttestationConfig('web', env);
        const changedConfig = await buildRuntimeAttestationConfig('web', {
            ...env,
            [envKey]: changedValue,
        });

        expect(config[fingerprintKey]).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(config[fingerprintKey]).not.toContain(env[envKey]);
        expect(changedConfig[fingerprintKey]).not.toBe(config[fingerprintKey]);
        if (envKey === 'RESEND_FROM_EMAIL') {
            expect(changedConfig.resendSenderFingerprint).toBe(config.resendSenderFingerprint);
        }
        await expect(verifyRuntimeAttestation(envelope, {
            config: changedConfig,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, env.INTERNAL_JOB_SECRET)).resolves.toBe(false);
    });

    it('attests Google as absent on a minimal fulfillment bootstrap', async () => {
        const minimal = {
            ...runtimeEnv(),
            FULFILLMENT_RUNTIME_MODE: 'bootstrap',
            GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
            GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: '',
            GOOGLE_ADMIN_EMAIL: '',
            GOOGLE_DRIVE_ROOT_FOLDER_ID: '',
            GOOGLE_TEMPLATE_DOC_ID: '',
            PUBLIC_SUPABASE_URL: '',
            SUPABASE_SERVICE_ROLE_KEY: '',
            RESEND_API_KEY: '',
            EMAIL_FROM: '',
            RESEND_FROM_EMAIL: '',
            EMAIL_RECIPIENT_ALLOWLIST: '',
            CRON_SECRET: '',
        };
        const config = await buildRuntimeAttestationConfig('fulfillment', minimal);

        expect(config.fulfillmentRuntimeMode).toBe('bootstrap');
        expect(config.googleBoundary).toBe('absent');
        expect(config.googleServiceAccountFingerprint).toBe('absent');
        expect(config.googlePrivateKeyFingerprint).toBe('absent');
        expect(config.supabaseUrlFingerprint).toBe('absent');
        expect(config.supabaseServiceRoleFingerprint).toBe('absent');
        expect(config.resendApiKeyFingerprint).toBe('absent');
        expect(config.resendAllowlistFingerprint).toBe('absent');
        expect(config.resendSenderFingerprint).toBe('absent');
        expect(config.cronSecretFingerprint).toBe('absent');
    });

    it('detects Stripe credentials in bootstrap and rejects an expected-absent HMAC gate', async () => {
        const remoteEnv = {
            ...runtimeEnv(),
            WEB_RUNTIME_MODE: 'bootstrap',
        };
        const bootstrap = await buildRuntimeAttestationConfig('web', remoteEnv);

        expect(bootstrap.webRuntimeMode).toBe('bootstrap');
        expect(bootstrap.stripeBoundary).toBe('configured');
        expect(bootstrap.stripeExpectedAccountId).toBe(remoteEnv.STRIPE_EXPECTED_ACCOUNT_ID);
        expect(bootstrap.stripeSecretKeyFingerprint).toMatch(/^sha256:/u);

        const nonce = 'bootstrap_nonce_123456789';
        const envelope = await createRuntimeAttestation('web', remoteEnv, nonce);
        const expectedAbsent = await buildRuntimeAttestationConfig('web', {
            ...remoteEnv,
            PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
            STRIPE_SECRET_KEY: '',
            STRIPE_WEBHOOK_SECRET: '',
            STRIPE_EXPECTED_ACCOUNT_ID: '',
            STRIPE_PORTAL_CONFIGURATION_ID: '',
        });
        expect(expectedAbsent.stripeBoundary).toBe('absent');
        await expect(verifyRuntimeAttestation(envelope, {
            config: expectedAbsent,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, remoteEnv.INTERNAL_JOB_SECRET)).resolves.toBe(false);
    });

    it('rejects bootstrap HMAC when Supabase runtime, Resend, Turnstile, cron or level-check material is present', async () => {
        const minimalBootstrap = {
            ...runtimeEnv(),
            WEB_RUNTIME_MODE: 'bootstrap',
            EMAIL_DELIVERY_MODE: 'disabled',
            EMAIL_DAILY_RECIPIENT_LIMIT: '0',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '0',
            EMAIL_FROM: '',
            RESEND_FROM_EMAIL: '',
            EMAIL_RECIPIENT_ALLOWLIST: '',
            PUBLIC_SUPABASE_URL: '',
            PUBLIC_SUPABASE_ANON_KEY: '',
            SUPABASE_SERVICE_ROLE_KEY: '',
            PUBLIC_STRIPE_PUBLISHABLE_KEY: '',
            STRIPE_SECRET_KEY: '',
            STRIPE_WEBHOOK_SECRET: '',
            STRIPE_EXPECTED_ACCOUNT_ID: '',
            STRIPE_PORTAL_CONFIGURATION_ID: '',
            RESEND_API_KEY: '',
            PUBLIC_TURNSTILE_SITE_KEY: '',
            TURNSTILE_SECRET_KEY: '',
            CRON_SECRET: '',
            LEVEL_CHECK_TOKEN_SECRET: '',
        };
        const leakedBootstrap = {
            ...minimalBootstrap,
            PUBLIC_SUPABASE_URL: 'https://production.supabase.co',
            PUBLIC_SUPABASE_ANON_KEY: 'anon-leak',
            SUPABASE_SERVICE_ROLE_KEY: 'service-leak',
            RESEND_API_KEY: 'resend-leak',
            PUBLIC_TURNSTILE_SITE_KEY: 'turnstile-site-leak',
            TURNSTILE_SECRET_KEY: 'turnstile-secret-leak',
            CRON_SECRET: 'cron-leak',
            LEVEL_CHECK_TOKEN_SECRET: 'level-leak',
        };
        const expected = await buildRuntimeAttestationConfig('web', minimalBootstrap);
        expect(expected.supabaseUrlFingerprint).toBe('absent');
        expect(expected.supabaseAnonFingerprint).toBe('absent');
        expect(expected.supabaseServiceRoleFingerprint).toBe('absent');
        expect(expected.resendApiKeyFingerprint).toBe('absent');
        expect(expected.turnstileSiteKeyFingerprint).toBe('absent');
        expect(expected.turnstileSecretFingerprint).toBe('absent');
        expect(expected.cronSecretFingerprint).toBe('absent');
        expect(expected.levelCheckSecretFingerprint).toBe('absent');

        const leaked = await buildRuntimeAttestationConfig('web', leakedBootstrap);
        expect(leaked.supabaseUrlFingerprint).toMatch(/^sha256:/u);
        expect(leaked.turnstileSecretFingerprint).toMatch(/^sha256:/u);
        expect(leaked.cronSecretFingerprint).toMatch(/^sha256:/u);

        const nonce = 'bootstrap_provider_leak_123456';
        const envelope = await createRuntimeAttestation('web', leakedBootstrap, nonce);
        await expect(verifyRuntimeAttestation(envelope, {
            config: expected,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, leakedBootstrap.INTERNAL_JOB_SECRET)).resolves.toBe(false);
    });

    it('rejects malformed nonces and a tampered proof', async () => {
        expect(isValidAttestationNonce('short')).toBe(false);
        expect(isValidAttestationNonce('valid_nonce_123456789')).toBe(true);
        const env = runtimeEnv();
        const nonce = 'valid_nonce_123456789';
        const envelope = await createRuntimeAttestation('web', env, nonce);
        const config = await buildRuntimeAttestationConfig('web', env);
        const tamperedProof = `${envelope.proof.slice(0, -1)}${envelope.proof.endsWith('0') ? '1' : '0'}`;
        await expect(verifyRuntimeAttestation({ ...envelope, proof: tamperedProof }, {
            config,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, env.INTERNAL_JOB_SECRET)).resolves.toBe(false);
    });
});
