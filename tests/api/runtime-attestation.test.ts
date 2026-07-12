import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env as cloudflareEnv } from 'cloudflare:workers';

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

import { POST } from '../../src/pages/api/internal/runtime-attestation';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
} from '../../src/lib/runtime-attestation';

const versionMetadata = cloudflareEnv as { CF_VERSION_METADATA?: { id?: string } };

function context(body: string, options: { authorization?: string; contentLength?: string } = {}) {
    return {
        request: new Request('https://espanolhonesto-staging.alindev95.workers.dev/api/internal/runtime-attestation', {
            method: 'POST',
            headers: {
                ...(options.authorization ? { Authorization: options.authorization } : {}),
                ...(options.contentLength ? { 'Content-Length': options.contentLength } : {}),
                'Content-Type': 'application/json',
            },
            body,
        }),
    } as Parameters<typeof POST>[0];
}

describe('web runtime attestation API', () => {
    beforeEach(() => {
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        delete versionMetadata.CF_VERSION_METADATA;
    });

    it('is server-only to the exact staging identity and requires the internal secret', async () => {
        mocks.env.PUBLIC_APP_ENV = 'production';
        const hidden = await POST(context('{"nonce":"valid_nonce_123456789"}'));
        expect(hidden.status).toBe(404);

        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto-staging',
            INTERNAL_JOB_SECRET: 'internal-secret',
        });
        const unauthorized = await POST(context('{"nonce":"valid_nonce_123456789"}', {
            authorization: 'Bearer wrong-secret',
        }));
        expect(unauthorized.status).toBe(401);
    });

    it('rejects oversized or malformed bodies before attesting', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto-staging',
            INTERNAL_JOB_SECRET: 'internal-secret',
        });
        const oversized = await POST(context('{}', {
            authorization: 'Bearer internal-secret',
            contentLength: '16385',
        }));
        expect(oversized.status).toBe(413);
        const malformed = await POST(context('{', {
            authorization: 'Bearer internal-secret',
        }));
        expect(malformed.status).toBe(400);
    });

    it('binds the opaque proof to the deployed Cloudflare version metadata', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto-staging',
            INTERNAL_JOB_SECRET: 'internal-secret',
            PUBLIC_SUPABASE_URL: 'https://staging.supabase.co',
            PUBLIC_SUPABASE_ANON_KEY: 'anon',
            SUPABASE_EXPECTED_PROJECT_REF: 'staging',
            SUPABASE_SERVICE_ROLE_KEY: 'service',
            FULFILLMENT_WORKER_URL: 'https://fulfillment.example.com',
            EMAIL_DELIVERY_MODE: 'allowlist',
            EMAIL_RECIPIENT_ALLOWLIST: 'allowed@example.com',
            EMAIL_DAILY_RECIPIENT_LIMIT: '10',
            EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
            EMAIL_FROM: 'Sender <sender@example.com>',
            RESEND_API_KEY: 'resend',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });
        const workerVersionId = '11111111-1111-4111-8111-111111111111';
        versionMetadata.CF_VERSION_METADATA = { id: workerVersionId };
        const nonce = 'valid_nonce_123456789';
        const result = await POST(context(JSON.stringify({ nonce }), {
            authorization: 'Bearer internal-secret',
        }));
        expect(result.status).toBe(200);
        const envelope = await result.json() as RuntimeAttestationEnvelope;
        expect(envelope).not.toHaveProperty('config');
        expect(envelope.workerVersionId).toBe(workerVersionId);
        const config = await buildRuntimeAttestationConfig('web', {
            ...mocks.env,
            WORKER_VERSION_ID: workerVersionId,
        });
        await expect(verifyRuntimeAttestation(envelope, {
            config,
            nonce,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, 'internal-secret')).resolves.toBe(true);
    });

    it('allows only the exact production identity in production', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
            WORKER_IDENTITY: 'espanolhonesto',
            INTERNAL_JOB_SECRET: 'internal-secret',
            SUPABASE_EXPECTED_PROJECT_REF: 'production-ref',
        });
        versionMetadata.CF_VERSION_METADATA = { id: '22222222-2222-4222-8222-222222222222' };
        const allowed = await POST(context('{"nonce":"valid_nonce_123456789"}', {
            authorization: 'Bearer internal-secret',
        }));
        expect(allowed.status).toBe(200);

        mocks.env.WORKER_IDENTITY = 'espanolhonesto-staging';
        const hidden = await POST(context('{"nonce":"valid_nonce_123456789"}', {
            authorization: 'Bearer internal-secret',
        }));
        expect(hidden.status).toBe(404);
    });

    it('hides a production runtime with an unknown web mode', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'unknown',
            WORKER_IDENTITY: 'espanolhonesto',
            INTERNAL_JOB_SECRET: 'internal-secret',
        });
        versionMetadata.CF_VERSION_METADATA = { id: '33333333-3333-4333-8333-333333333333' };

        const hidden = await POST(context('{"nonce":"valid_nonce_123456789"}', {
            authorization: 'Bearer internal-secret',
        }));

        expect(hidden.status).toBe(404);
    });
});
