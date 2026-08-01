import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeEnvMock = vi.hoisted(() => {
    const env: Record<string, string | undefined> = {};
    return {
        env,
        readRuntimeEnv: vi.fn((key: string): string | undefined => env[key]),
    };
});

vi.mock('../../src/lib/runtime-env', () => runtimeEnvMock);

describe('checkout Turnstile verification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(runtimeEnvMock.env)) delete runtimeEnvMock.env[key];
        Object.assign(runtimeEnvMock.env, {
            PUBLIC_APP_ENV: 'staging',
            PUBLIC_SITE_URL: 'https://staging.example.test',
            PUBLIC_TURNSTILE_SITE_KEY: 'real-staging-site-key',
            TURNSTILE_SECRET_KEY: 'turnstile-secret',
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('aborts a stalled Siteverify request and fails closed', async () => {
        const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { verifyCheckoutTurnstile } = await import('../../src/lib/turnstile');

        await expect(verifyCheckoutTurnstile({
            token: 'turnstile-token',
            clientAddress: '203.0.113.10',
            timeoutMs: 1,
        })).resolves.toEqual({ ok: false, reason: 'unavailable' });
    });

    it('requires the exact checkout action and configured hostname and sends the client IP', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            success: true,
            action: 'checkout_hold',
            hostname: 'staging.example.test',
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { verifyCheckoutTurnstile } = await import('../../src/lib/turnstile');

        await expect(verifyCheckoutTurnstile({
            token: 'turnstile-token',
            clientAddress: '203.0.113.10',
        })).resolves.toEqual({ ok: true });

        const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
        const body = request.body as URLSearchParams;
        expect(body.get('remoteip')).toBe('203.0.113.10');
        expect(body.get('response')).toBe('turnstile-token');
        expect(body.get('secret')).toBe('turnstile-secret');

        fetchMock.mockResolvedValueOnce(Response.json({
            success: true,
            action: 'other_action',
            hostname: 'staging.example.test',
        }));
        await expect(verifyCheckoutTurnstile({
            token: 'another-token',
            clientAddress: '203.0.113.10',
        })).resolves.toEqual({ ok: false, reason: 'invalid' });
    });

    it('accepts Cloudflare dummy response fields only outside production', async () => {
        runtimeEnvMock.env.PUBLIC_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            success: true,
            action: 'test',
            hostname: 'localhost',
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { verifyCheckoutTurnstile } = await import('../../src/lib/turnstile');

        await expect(verifyCheckoutTurnstile({
            token: 'XXXX.DUMMY.TOKEN.XXXX',
            clientAddress: '203.0.113.10',
        })).resolves.toEqual({ ok: true });

        runtimeEnvMock.env.PUBLIC_APP_ENV = 'production';
        await expect(verifyCheckoutTurnstile({
            token: 'XXXX.DUMMY.TOKEN.XXXX',
            clientAddress: '203.0.113.10',
        })).resolves.toEqual({ ok: false, reason: 'unavailable' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
