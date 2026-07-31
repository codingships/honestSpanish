import { beforeEach, describe, expect, it, vi } from 'vitest';

const exactClosedOffer = {
    id: 'pkg-v2',
    name: 'individual_4x50_28d',
    display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 индивидуальных занятия' },
    price_monthly: 25900,
    sessions_per_month: 4,
    has_group_session: false,
    has_dual_teacher: false,
    stripe_price_1m: null,
    stripe_price_3m: null,
    stripe_price_6m: null,
    is_active: false,
    is_publicly_listed: true,
    contract_schema_version: 2,
    amount_cents: 25900,
    billing_interval_unit: 'day',
    billing_interval_count: 28,
    sessions_per_period: 4,
    class_duration_minutes: 50,
};

const mocks = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
    createSupabaseServerClient: vi.fn(),
    packageResult: { data: [] as typeof exactClosedOffer[], error: null as unknown },
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => mocks.env[key]),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: mocks.createSupabaseServerClient,
}));

import { getLandingPageData } from '../../src/lib/landing-data';

function context() {
    return {} as Parameters<typeof getLandingPageData>[0];
}

describe('getLandingPageData public offer projection', () => {
    beforeEach(() => {
        for (const key of Object.keys(mocks.env)) delete mocks.env[key];
        mocks.createSupabaseServerClient.mockReset();
        mocks.packageResult = { data: [], error: null };
        const query: any = {
            then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (
                Promise.resolve(mocks.packageResult).then(resolve, reject)
            ),
        };
        query.eq = vi.fn(() => query);
        const select = vi.fn(() => query);
        mocks.createSupabaseServerClient.mockReturnValue({
            from: vi.fn(() => ({ select })),
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
        });
    });

    it('uses the deterministic target offer only behind the exact inert gate', async () => {
        Object.assign(mocks.env, {
            PUBLIC_APP_ENV: 'test',
            E2E_RUNTIME_ISOLATED: 'true',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            E2E_TARGET_SUPABASE_REF: 'placeholder',
        });

        const result = await getLandingPageData(context());

        expect(mocks.createSupabaseServerClient).not.toHaveBeenCalled();
        expect(result.packages).toEqual([
            expect.objectContaining({ name: 'individual_4x50_28d', price_monthly: 25900, sessions_per_month: 4 }),
        ]);
        expect(result.packages[0].stripe_price_1m).toBeNull();
    });

    it('emits the closed projection only for one exact v2 catalogue snapshot', async () => {
        mocks.packageResult = { data: [exactClosedOffer], error: null };

        const result = await getLandingPageData(context());

        expect(result.packages).toEqual([
            expect.objectContaining({ id: 'pkg-v2', name: 'individual_4x50_28d', price_monthly: 25900, sessions_per_month: 4 }),
        ]);
        expect(result.packages[0].stripe_price_1m).toBeNull();
    });

    it('rejects a name-matching row with an incorrect v2 contract', async () => {
        mocks.packageResult = {
            data: [{ ...exactClosedOffer, billing_interval_count: 30 }],
            error: null,
        };

        expect(await getLandingPageData(context())).toMatchObject({ packages: [] });
    });

    it('rejects an exact contract that is not explicitly published', async () => {
        mocks.packageResult = {
            data: [{ ...exactClosedOffer, is_publicly_listed: false }],
            error: null,
        };

        expect(await getLandingPageData(context())).toMatchObject({ packages: [] });
    });

    it('does not mix the deterministic projection into a catalogue read error', async () => {
        mocks.packageResult = { data: [], error: { message: 'schema unavailable' } };

        expect(await getLandingPageData(context())).toMatchObject({ packages: [] });
    });
});
