import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { getLandingPageData } from '../../src/lib/landing-data';

describe('getLandingPageData inert public E2E mode', () => {
    beforeEach(() => {
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        mocks.createSupabaseServerClient.mockReset();
        const order = vi.fn().mockResolvedValue({ data: [], error: null });
        const eq = vi.fn(() => ({ order }));
        const select = vi.fn(() => ({ eq }));
        mocks.createSupabaseServerClient.mockReturnValue({
            from: vi.fn(() => ({ select })),
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
        });
    });

    it('uses a deterministic four-package catalogue only behind the exact inert gate', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'test',
            E2E_RUNTIME_ISOLATED: 'true',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            E2E_TARGET_SUPABASE_REF: 'placeholder',
        });

        const result = await getLandingPageData({} as Parameters<typeof getLandingPageData>[0]);

        expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
        expect(result.isLoggedIn).toBe(false);
        expect(result.packages.map(({ name, price_monthly }) => [name, price_monthly])).toEqual([
            ['group', 5000],
            ['standard', 14500],
            ['hybrid', 15000],
            ['bootcamp', 34500],
        ]);
        expect(result.packages.every((pkg) => (
            pkg.stripe_price_1m === null
            && pkg.stripe_price_3m === null
            && pkg.stripe_price_6m === null
        ))).toBe(true);
    });

    it.each([
        ['PUBLIC_APP_ENV', 'staging'],
        ['E2E_RUNTIME_ISOLATED', 'false'],
        ['E2E_DISABLE_EXTERNAL_INTEGRATIONS', 'false'],
        ['E2E_TARGET_SUPABASE_REF', 'mzjyvmlxfpzdfdjzxxyj'],
    ])('keeps Supabase as the source when %s does not match', async (key, value) => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'test',
            E2E_RUNTIME_ISOLATED: 'true',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            E2E_TARGET_SUPABASE_REF: 'placeholder',
            [key]: value,
        });

        const result = await getLandingPageData({} as Parameters<typeof getLandingPageData>[0]);

        expect(mocks.createSupabaseServerClient).toHaveBeenCalledOnce();
        expect(result).toEqual({ packages: [], isLoggedIn: false });
    });
});
