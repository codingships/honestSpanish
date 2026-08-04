import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
    legalIdentityReady: true,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

vi.mock('../../src/lib/legal-identity', () => ({
    isLegalIdentityProductionReady: vi.fn(() => mocks.legalIdentityReady),
}));

import { GET } from '../../src/pages/health';

describe('web health', () => {
    beforeEach(() => {
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        mocks.legalIdentityReady = true;
    });

    it('reports an active staging runtime with closed checkout as ready', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto-staging',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(200);
        expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
        await expect(response.json()).resolves.toMatchObject({
            appEnvironment: 'staging',
            checkoutEnabled: false,
            legalIdentityReady: true,
            runtimeMode: 'active',
            status: 'ok',
            workerIdentity: 'espanolhonesto-staging',
        });
    });

    it.each([
        ['enabled', 'false', 'true', true],
        ['closed', 'true', 'false', false],
    ])('reports an active production runtime with checkout %s as ready', async (
        _scenario,
        configured,
        override,
        expectedEnabled,
    ) => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto',
            CHECKOUT_ENABLED: configured,
            CHECKOUT_ENABLED_OVERRIDE: override,
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            appEnvironment: 'production',
            checkoutEnabled: expectedEnabled,
            legalIdentityReady: true,
            runtimeMode: 'active',
            status: 'ok',
            workerIdentity: 'espanolhonesto',
        });
    });

    it('reports production bootstrap as unavailable while preserving diagnostics', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'bootstrap',
            WORKER_IDENTITY: 'espanolhonesto',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            appEnvironment: 'production',
            runtimeMode: 'bootstrap',
            status: 'invalid',
            workerIdentity: 'espanolhonesto',
        });
    });

    it('fails closed while the production seller identity is provisional', async () => {
        mocks.legalIdentityReady = false;
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto',
            CHECKOUT_ENABLED: 'true',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            checkoutEnabled: false,
            legalIdentityReady: false,
            status: 'invalid',
        });
    });

    it('fails closed if identity is inconsistent', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'wrong-worker',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({ status: 'invalid' });
    });

    it.each([
        ['missing base flag', undefined, 'false', false],
        ['missing override flag', 'true', undefined, true],
        ['invalid base flag', 'enabled', 'true', true],
        ['invalid override flag', 'false', 'disabled', false],
    ])('fails closed for %s while reporting effective checkout state', async (
        _scenario,
        configured,
        override,
        expectedEnabled,
    ) => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto',
            CHECKOUT_ENABLED: configured,
            CHECKOUT_ENABLED_OVERRIDE: override,
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            checkoutEnabled: expectedEnabled,
            status: 'invalid',
        });
    });

    it('does not report staging ready when checkout is enabled', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            WEB_RUNTIME_MODE: 'active',
            WORKER_IDENTITY: 'espanolhonesto-staging',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
        });

        const response = await GET({} as Parameters<typeof GET>[0]) as Response;

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            checkoutEnabled: true,
            status: 'invalid',
        });
    });
});
