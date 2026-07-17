import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

import { GET } from '../../src/pages/health';

describe('web health', () => {
    beforeEach(() => {
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
    });

    it('reports a strict production bootstrap as healthy and inert', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
            WORKER_IDENTITY: 'espanolhonesto',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
        await expect(response.json()).resolves.toMatchObject({
            checkoutEnabled: false,
            runtimeMode: 'bootstrap',
            status: 'ok',
            workerIdentity: 'espanolhonesto',
        });
    });

    it('fails closed if checkout or identity is inconsistent', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
            WORKER_IDENTITY: 'wrong-worker',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({ status: 'invalid' });
    });
});
