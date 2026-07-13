import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    build: vi.fn(),
    env: {} as Record<string, string | undefined>,
    policy: {
        appEnvironment: 'staging',
        budgetScope: 'nonproduction',
        dailyLimit: 10,
        monthlyLimit: 100,
        mode: 'allowlist',
        recipientAllowlist: new Set(['allowed@example.com']),
    },
    rpc: vi.fn(),
    send: vi.fn(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

vi.mock('../../src/lib/email/delivery', () => ({
    getEmailDeliveryPolicy: vi.fn(() => mocks.policy),
}));

vi.mock('../../src/lib/email/staging-smoke', () => ({
    buildStagingSmokeEmail: mocks.build,
    sendStagingSmokeEmail: mocks.send,
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

import { POST } from '../../src/pages/api/internal/staging-integration-email';

const requestBody = {
    leaseGeneration: 2,
    leaseName: 'google-resend-write-smoke',
    ownerToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    recipient: 'allowed@example.com',
    runId: '11111111-1111-4111-8111-111111111111',
    smokeMarker: 'SMOKE-INTEGRATION-20260710150000-abcdef12',
};

function context(body: string, options: { authorization?: string; contentLength?: string; host?: string } = {}) {
    const host = options.host ?? 'staging.espanolhonesto.com';
    return {
        request: new Request(`https://${host}/api/internal/staging-integration-email`, {
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

function validRuntime() {
    Object.assign(mocks.env, {
        PUBLIC_APP_ENV: 'staging',
        WORKER_IDENTITY: 'espanolhonesto-staging',
        INTERNAL_JOB_SECRET: 'internal-secret',
        EMAIL_DAILY_RECIPIENT_LIMIT: '10',
        EMAIL_MONTHLY_RECIPIENT_LIMIT: '100',
        EMAIL_FROM: 'Sender <sender@example.com>',
        RESEND_API_KEY: 'resend',
    });
}

describe('staging integration email API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        mocks.policy.appEnvironment = 'staging';
        mocks.policy.mode = 'allowlist';
        mocks.policy.recipientAllowlist = new Set(['allowed@example.com']);
        mocks.build.mockResolvedValue({
            payload: {
                from: 'Sender <sender@example.com>',
                html: '<p>Smoke</p>',
                subject: 'Smoke',
                to: 'allowed@example.com',
            },
            payloadSha256: 'a'.repeat(64),
        });
        mocks.send.mockResolvedValue({
            errorCode: null,
            httpStatus: null,
            outcome: 'sent',
            providerId: 'provider-id',
        });
        mocks.rpc.mockImplementation((name: string) => {
            if (name === 'claim_staging_integration_smoke_email') {
                return Promise.resolve({
                    data: [{
                        attempt_generation: 1,
                        claimed: true,
                        email_status: 'sending',
                        idempotency_key: `staging-integration-smoke/email/${requestBody.runId}`,
                        provider_id: null,
                    }],
                    error: null,
                });
            }
            return Promise.resolve({ data: true, error: null });
        });
    });

    it('is hidden outside the exact staging Worker and requires the internal secret', async () => {
        validRuntime();
        const hidden = await POST(context(JSON.stringify(requestBody), { host: 'espanolhonesto.com' }));
        expect(hidden.status).toBe(404);
        const legacyDirectHost = await POST(context(JSON.stringify(requestBody), {
            authorization: 'Bearer wrong-secret',
            host: 'espanolhonesto-staging.alindev95.workers.dev',
        }));
        expect(legacyDirectHost.status).toBe(401);
        const unauthorized = await POST(context(JSON.stringify(requestBody), {
            authorization: 'Bearer wrong-secret',
        }));
        expect(unauthorized.status).toBe(401);
        expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it('rejects oversized and malformed request bodies before provider work', async () => {
        validRuntime();
        const oversized = await POST(context('{}', {
            authorization: 'Bearer internal-secret',
            contentLength: '16385',
        }));
        expect(oversized.status).toBe(413);
        const malformed = await POST(context('{', { authorization: 'Bearer internal-secret' }));
        expect(malformed.status).toBe(400);
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it('claims, sends and finalizes only the fenced durable run', async () => {
        validRuntime();
        const result = await POST(context(JSON.stringify(requestBody), {
            authorization: 'Bearer internal-secret',
        }));
        expect(result.status).toBe(200);
        await expect(result.json()).resolves.toEqual({
            runId: requestBody.runId,
            smokeMarker: requestBody.smokeMarker,
            status: 'sent',
        });
        expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'claim_staging_integration_smoke_email', expect.objectContaining({
            p_generation: requestBody.leaseGeneration,
            p_owner_token: requestBody.ownerToken,
            p_run_id: requestBody.runId,
            p_payload_sha256: 'a'.repeat(64),
        }));
        expect(mocks.send).toHaveBeenCalledWith(expect.any(Object), `staging-integration-smoke/email/${requestBody.runId}`);
        expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'finalize_staging_integration_smoke_email', expect.objectContaining({
            p_attempt_generation: 1,
            p_generation: requestBody.leaseGeneration,
            p_provider_id: 'provider-id',
        }));
    });
});
