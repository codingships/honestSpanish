import { describe, expect, it } from 'vitest';
import {
    buildRuntimeAttestationConfig,
    createRuntimeAttestation,
    isValidAttestationNonce,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
} from '../../src/lib/runtime-attestation';

function runtimeEnv() {
    return {
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
        PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_attested',
        PUBLIC_SUPABASE_ANON_KEY: 'anon',
        PUBLIC_SUPABASE_URL: 'https://staging.supabase.co',
        RESEND_API_KEY: 'resend',
        STRIPE_EXPECTED_ACCOUNT_ID: 'acct_attested',
        STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_attested',
        STRIPE_SECRET_KEY: 'sk_test_attested',
        STRIPE_WEBHOOK_SECRET: 'whsec_attested',
        SUPABASE_EXPECTED_PROJECT_REF: 'staging',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
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
