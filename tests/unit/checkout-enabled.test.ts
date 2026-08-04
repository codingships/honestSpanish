import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
    legalIdentityReady: false,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

vi.mock('../../src/lib/legal-identity', () => ({
    isLegalIdentityProductionReady: vi.fn(() => mocks.legalIdentityReady),
}));

import { isCheckoutEnabled } from '../../src/lib/checkout-enabled';

describe('checkout runtime gate', () => {
    beforeEach(() => {
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        mocks.legalIdentityReady = false;
    });

    it('does not change the staging flag', () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'staging',
            CHECKOUT_ENABLED: 'true',
        });

        expect(isCheckoutEnabled()).toBe(true);
    });

    it('refuses production checkout while the seller identity is provisional', () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
        });

        expect(isCheckoutEnabled()).toBe(false);
    });

    it('honors the production flag after the seller identity is verified', () => {
        mocks.legalIdentityReady = true;
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'production',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
        });

        expect(isCheckoutEnabled()).toBe(true);
    });
});
