import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    accountRetrieve: vi.fn(),
    productCreate: vi.fn(),
    productList: vi.fn(),
    productRetrieve: vi.fn(),
    productUpdate: vi.fn(),
    priceCreate: vi.fn(),
    priceRetrieve: vi.fn(),
    priceList: vi.fn(),
    priceUpdate: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_example';
        return undefined;
    }),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        accounts: {
            retrieve: stripeMocks.accountRetrieve,
        },
        products: {
            create: stripeMocks.productCreate,
            list: stripeMocks.productList,
            retrieve: stripeMocks.productRetrieve,
            update: stripeMocks.productUpdate,
        },
        prices: {
            create: stripeMocks.priceCreate,
            retrieve: stripeMocks.priceRetrieve,
            list: stripeMocks.priceList,
            update: stripeMocks.priceUpdate,
        },
    },
}));

function createRoleClient(
    role: string | null,
    user: { id: string; email: string } | null = { id: 'admin-1', email: 'admin@example.com' },
    capabilities: 'all' | readonly string[] = 'all',
) {
    const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: 'missing' } }),
    };

    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        rpc: vi.fn((_name: string, args: { p_capability: string }) => Promise.resolve({
            data: role === 'admin'
                && (capabilities === 'all' || capabilities.includes(args.p_capability)),
            error: null,
        })),
        from: vi.fn(() => profileChain),
    };
}

function createSingleQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function packageRow(overrides: Record<string, unknown> = {}) {
    return {
        id: '00000000-0000-4000-8000-000000000101',
        catalog_version: 1,
        name: 'standard',
        display_name: { es: 'Estándar', en: 'Standard', ru: 'Standard' },
        price_monthly: 10000,
        sessions_per_month: 4,
        has_group_session: true,
        has_dual_teacher: false,
        is_active: true,
        stripe_product_id: null,
        stripe_price_1m: 'price_old_1',
        stripe_price_3m: 'price_old_3',
        stripe_price_6m: 'price_old_6',
        contract_schema_version: 1,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function createAdminClientForPackage(before: Record<string, unknown>, after: Record<string, unknown>) {
    const beforeQuery = createSingleQuery({ data: before, error: null });
    const updateQuery = createSingleQuery({ data: after, error: null });
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const retiredPricesQuery: any = {};
    retiredPricesQuery.select = vi.fn(() => retiredPricesQuery);
    retiredPricesQuery.eq = vi.fn(() => retiredPricesQuery);
    retiredPricesQuery.order = vi.fn().mockResolvedValue({ data: [], error: null });
    const activePricesQuery: any = {};
    activePricesQuery.select = vi.fn(() => activePricesQuery);
    activePricesQuery.eq = vi.fn(() => activePricesQuery);
    activePricesQuery.in = vi.fn().mockResolvedValue({ data: [], error: null });
    const packagePriceQueries = [retiredPricesQuery, activePricesQuery];
    const packageQueries = [beforeQuery, updateQuery];
    const client = {
        rpc: vi.fn().mockResolvedValue({ data: {}, error: null }),
        from: vi.fn((table: string) => {
            if (table === 'packages') return packageQueries.shift();
            if (table === 'package_prices') return packagePriceQueries.shift();
            if (table === 'admin_audit_log') return { insert: auditInsert };
            throw new Error(`Unexpected table ${table}`);
        }),
    };
    return { client, beforeQuery, updateQuery, retiredPricesQuery, activePricesQuery, auditInsert };
}

function createAdminClientForCreate(created: Record<string, unknown>) {
    const createQuery = createSingleQuery({ data: created, error: null });
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'packages') return createQuery;
            if (table === 'admin_audit_log') return { insert: auditInsert };
            throw new Error(`Unexpected table ${table}`);
        }),
    };
    return { client, createQuery, auditInsert };
}

function activePackagePriceRows(pkg: Record<string, any>) {
    return ([1, 3, 6] as const).map((duration) => ({
        package_id: pkg.id,
        catalog_version: pkg.catalog_version,
        package_key: pkg.name,
        duration_months: duration,
        amount_cents: duration === 1 ? 10000 : duration === 3 ? 27000 : 48000,
        currency: 'eur',
        sessions_per_month: pkg.sessions_per_month,
        sessions_per_period: pkg.sessions_per_month * duration,
        has_group_session: pkg.has_group_session,
        has_dual_teacher: pkg.has_dual_teacher,
        status: 'active',
        stripe_account_id: 'acct_test',
        stripe_livemode: false,
        stripe_product_id: pkg.stripe_product_id,
        stripe_price_id: pkg[`stripe_price_${duration}m`],
    }));
}

function createAdminClientForList(packages: Record<string, unknown>[], prices: Record<string, unknown>[]) {
    const packageQuery: any = {};
    packageQuery.select = vi.fn(() => packageQuery);
    packageQuery.eq = vi.fn(() => packageQuery);
    packageQuery.order = vi.fn().mockResolvedValue({ data: packages, error: null });
    const priceQuery: any = {};
    priceQuery.select = vi.fn(() => priceQuery);
    priceQuery.eq = vi.fn(() => priceQuery);
    priceQuery.in = vi.fn().mockResolvedValue({ data: prices, error: null });
    return {
        packageQuery,
        from: vi.fn((table: string) => {
            if (table === 'packages') return packageQuery;
            if (table === 'package_prices') return priceQuery;
            throw new Error(`Unexpected table ${table}`);
        }),
    };
}

function contextWithBody(body: Record<string, unknown>, method: 'PATCH' | 'POST' = 'PATCH') {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/packages',
            method,
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function contextWithInvalidJson(method: 'PATCH' | 'POST' = 'POST') {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/packages',
            method,
            json: vi.fn().mockRejectedValue(new Error('bad json')),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

describe('/api/admin/packages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        stripeMocks.accountRetrieve.mockResolvedValue({
            id: 'acct_test',
            country: 'US',
            details_submitted: false,
            charges_enabled: false,
            payouts_enabled: false,
        });
        stripeMocks.productCreate.mockResolvedValue({ id: 'prod_new' });
        stripeMocks.productList.mockResolvedValue({ data: [] });
        stripeMocks.productRetrieve.mockRejectedValue(Object.assign(new Error('not found'), {
            code: 'resource_missing',
        }));
        stripeMocks.productUpdate.mockResolvedValue({ id: 'prod_existing' });
        stripeMocks.priceCreate.mockResolvedValue({
            id: 'price_new_1',
            active: true,
            product: 'prod_new',
            unit_amount: 10000,
            currency: 'eur',
            recurring: { interval: 'month', interval_count: 1 },
            metadata: {},
            livemode: false,
        });
        stripeMocks.priceRetrieve.mockResolvedValue({
            id: 'price_new_1',
            active: true,
            product: 'prod_new',
            unit_amount: 10000,
            currency: 'eur',
            recurring: { interval: 'month', interval_count: 1 },
            metadata: {
                package_id: '00000000-0000-4000-8000-000000000101',
                package_key: 'standard',
                catalog_version: '1',
                duration_months: '1',
                app_environment: 'dev',
            },
            livemode: false,
        });
        stripeMocks.priceList.mockResolvedValue({ data: [] });
        stripeMocks.priceUpdate.mockResolvedValue({ id: 'price_old_1' });
    });

    it('rejects non-admin package access before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('teacher') as any);

        const { GET } = await import('../../src/pages/api/admin/packages');
        const response = await GET(contextWithBody({}, 'POST') as any);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('allows catalog reads without granting catalog writes', async () => {
        const client = createAdminClientForList([], []);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const roleClient = createRoleClient(
            'admin',
            { id: 'admin-1', email: 'admin@example.com' },
            ['catalog.read'],
        );
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET, POST } = await import('../../src/pages/api/admin/packages');
        const readResponse = await GET(contextWithBody({}, 'POST') as any);

        expect(readResponse.status).toBe(200);
        expect(roleClient.rpc).toHaveBeenCalledWith('has_my_admin_capability', {
            p_capability: 'catalog.read',
        });

        vi.clearAllMocks();
        const writeResponse = await POST(contextWithBody({
            action: 'create_package',
            name: 'another',
            displayName: { es: 'Otro', en: 'Another', ru: 'Another' },
            priceMonthlyEur: 100,
            sessionsPerMonth: 4,
            hasGroupSession: false,
            hasDualTeacher: false,
            isActive: false,
        }, 'POST') as any);

        expect(writeResponse.status).toBe(403);
        expect(roleClient.rpc).toHaveBeenCalledWith('has_my_admin_capability', {
            p_capability: 'catalog.write',
        });
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('reports checkout readiness only for an exact immutable offer set', async () => {
        const readyPackage = packageRow({
            stripe_product_id: 'prod_standard',
            stripe_price_1m: 'price_standard_1m',
            stripe_price_3m: 'price_standard_3m',
            stripe_price_6m: 'price_standard_6m',
        });
        const mismatchedPackage = packageRow({
            id: '00000000-0000-4000-8000-000000000102',
            name: 'other',
            stripe_product_id: 'prod_other',
            stripe_price_1m: 'price_other_1m',
            stripe_price_3m: 'price_other_3m',
            stripe_price_6m: 'price_other_6m',
        });
        const mismatchedRows = activePackagePriceRows(mismatchedPackage);
        mismatchedRows[1].amount_cents += 1;
        const client = createAdminClientForList(
            [readyPackage, mismatchedPackage],
            [...activePackagePriceRows(readyPackage), ...mismatchedRows],
        );
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/packages');
        const response = await GET(contextWithBody({}, 'POST') as any);
        const body = await response.json() as { packages: Array<{ name: string; checkout_ready: boolean }> };

        expect(response.status).toBe(200);
        expect(client.packageQuery.eq).toHaveBeenCalledWith('contract_schema_version', 1);
        expect(body.packages).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'standard', checkout_ready: true }),
            expect.objectContaining({ name: 'other', checkout_ready: false }),
        ]));
    });

    it('returns 400 for invalid JSON before touching package data', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithInvalidJson('POST') as any);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects invalid create_package payload before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithBody({
            action: 'create_package',
            name: 'x',
            displayName: { es: '', en: 'New', ru: 'New' },
            priceMonthlyEur: 0,
            sessionsPerMonth: 0,
            hasGroupSession: false,
            hasDualTeacher: false,
            isActive: false,
        }, 'POST') as any);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects invalid sync_stripe payload before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithBody({
            action: 'sync_stripe',
            packageId: 'not-a-uuid',
            durations: [2],
        }, 'POST') as any);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects versioned packages in the legacy edit flow', async () => {
        const before = packageRow({
            name: 'individual_4x50_28d',
            contract_schema_version: 2,
            is_active: false,
        });
        const { client, updateQuery } = createAdminClientForPackage(before, before);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PATCH } = await import('../../src/pages/api/admin/packages');
        const response = await PATCH(contextWithBody({
            packageId: before.id,
            displayName: { es: '4 clases individuales', en: '4 individual classes', ru: '4 individual classes' },
            priceMonthlyEur: 259,
            sessionsPerMonth: 4,
            hasGroupSession: false,
            hasDualTeacher: false,
            isActive: false,
        }) as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Versioned packages require the v2 catalog flow',
        });
        expect(updateQuery.update).not.toHaveBeenCalled();
    });

    it('clears stored Stripe Price IDs when the monthly package price changes', async () => {
        const before = packageRow();
        const after = packageRow({
            price_monthly: 12000,
            stripe_price_1m: null,
            stripe_price_3m: null,
            stripe_price_6m: null,
        });
        const { client, updateQuery, auditInsert } = createAdminClientForPackage(before, after);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PATCH } = await import('../../src/pages/api/admin/packages');
        const response = await PATCH(contextWithBody({
            packageId: before.id,
            displayName: { es: 'Estándar', en: 'Standard', ru: 'Standard' },
            priceMonthlyEur: 120,
            sessionsPerMonth: 4,
            hasGroupSession: true,
            hasDualTeacher: false,
            isActive: true,
        }) as any);

        expect(response.status).toBe(200);
        expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
            price_monthly: 12000,
            stripe_price_1m: null,
            stripe_price_3m: null,
            stripe_price_6m: null,
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'package.update',
            before,
            after,
        }));
    });

    it('creates a package with validated price, quotas and audit logging', async () => {
        const created = packageRow({
            id: '00000000-0000-4000-8000-000000000202',
            name: 'intensive',
            display_name: { es: 'Intensivo', en: 'Intensive', ru: 'Intensive' },
            price_monthly: 22000,
            sessions_per_month: 8,
            has_group_session: false,
            has_dual_teacher: true,
            is_active: false,
            stripe_product_id: null,
            stripe_price_1m: null,
            stripe_price_3m: null,
            stripe_price_6m: null,
        });
        const { client, createQuery, auditInsert } = createAdminClientForCreate(created);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithBody({
            action: 'create_package',
            name: ' intensive ',
            displayName: { es: ' Intensivo ', en: ' Intensive ', ru: ' Intensive ' },
            priceMonthlyEur: 220,
            sessionsPerMonth: 8,
            hasGroupSession: false,
            hasDualTeacher: true,
            isActive: false,
        }, 'POST') as any);

        expect(response.status).toBe(201);
        expect(createQuery.insert).toHaveBeenCalledWith({
            name: 'intensive',
            display_name: { es: 'Intensivo', en: 'Intensive', ru: 'Intensive' },
            price_monthly: 22000,
            sessions_per_month: 8,
            has_group_session: false,
            has_dual_teacher: true,
            is_active: false,
            contract_schema_version: 1,
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'package.create',
            entity_id: created.id,
            after: created,
        }));
    });

    it('rejects versioned packages before any Stripe synchronization', async () => {
        const before = packageRow({
            name: 'individual_4x50_28d',
            contract_schema_version: 2,
            is_active: false,
            stripe_product_id: null,
            stripe_price_1m: null,
            stripe_price_3m: null,
            stripe_price_6m: null,
        });
        const { client } = createAdminClientForPackage(before, before);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithBody({
            action: 'sync_stripe',
            packageId: before.id,
            durations: [1],
        }, 'POST') as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Versioned packages require the v2 catalog flow',
        });
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.productCreate).not.toHaveBeenCalled();
        expect(stripeMocks.priceCreate).not.toHaveBeenCalled();
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('syncs requested Stripe durations through mocked Stripe and audit logging', async () => {
        const before = packageRow({ stripe_product_id: null, stripe_price_1m: null });
        const after = packageRow({ stripe_product_id: 'prod_new', stripe_price_1m: 'price_new_1' });
        const { client, retiredPricesQuery, auditInsert } = createAdminClientForPackage(before, after);
        retiredPricesQuery.order.mockResolvedValueOnce({
            data: [{
                duration_months: 1,
                stripe_price_id: 'price_retired_1m',
                stripe_account_id: null,
                stripe_livemode: false,
                retired_at: '2026-07-10T20:00:00.000Z',
            }],
            error: null,
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithBody({
            action: 'sync_stripe',
            packageId: before.id,
            durations: [1],
        }, 'POST') as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.productCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Estándar',
                active: true,
            }),
            { idempotencyKey: `product:dev:${before.id}:v1` },
        );
        expect(stripeMocks.priceCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                product: 'prod_new',
                unit_amount: 10000,
                recurring: {
                    interval: 'month',
                    interval_count: 1,
                },
            }),
            { idempotencyKey: `price:dev:${before.id}:v1:1m` },
        );
        expect(client.rpc).toHaveBeenCalledWith('activate_package_price', expect.objectContaining({
            p_package_id: before.id,
            p_catalog_version: 1,
            p_duration_months: 1,
            p_amount_cents: 10000,
            p_currency: 'eur',
            p_stripe_product_id: 'prod_new',
            p_stripe_price_id: 'price_new_1',
        }));
        expect(stripeMocks.priceUpdate).toHaveBeenCalledWith('price_retired_1m', { active: false });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'package.stripe_sync',
            before,
            after,
        }));
    });

    it('recovers matching Stripe objects after a partial prior sync', async () => {
        const before = packageRow({ stripe_product_id: null, stripe_price_1m: null });
        const after = packageRow({
            stripe_product_id: 'prod_recovered',
            stripe_price_1m: 'price_recovered_1m',
        });
        const { client } = createAdminClientForPackage(before, after);
        stripeMocks.productList.mockResolvedValueOnce({
            data: [{
                id: 'prod_recovered',
                deleted: false,
                name: 'Estándar',
                active: true,
                metadata: {
                    package_id: before.id,
                    package_key: 'standard',
                    catalog_version: '1',
                    app_environment: 'dev',
                },
            }],
        });
        stripeMocks.priceList.mockResolvedValueOnce({
            data: [{
                id: 'price_recovered_1m',
                active: true,
                product: 'prod_recovered',
                unit_amount: 10000,
                currency: 'eur',
                recurring: { interval: 'month', interval_count: 1 },
                livemode: false,
                metadata: {
                    package_id: before.id,
                    catalog_version: '1',
                    duration_months: '1',
                    app_environment: 'dev',
                },
            }],
        });
        stripeMocks.priceRetrieve
            .mockResolvedValueOnce({
                id: 'price_recovered_1m',
                active: true,
                product: 'prod_recovered',
                unit_amount: 10000,
                currency: 'eur',
                recurring: { interval: 'month', interval_count: 1 },
                livemode: false,
                metadata: {
                    package_id: before.id,
                    catalog_version: '1',
                    duration_months: '1',
                    app_environment: 'dev',
                },
            })
            .mockResolvedValueOnce({
                id: 'price_recovered_1m',
                active: true,
                product: 'prod_recovered',
                unit_amount: 10000,
                currency: 'eur',
                recurring: { interval: 'month', interval_count: 1 },
                livemode: false,
                metadata: {
                    package_id: before.id,
                    package_key: 'standard',
                    catalog_version: '1',
                    duration_months: '1',
                    app_environment: 'dev',
                },
            });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        const response = await POST(contextWithBody({
            action: 'sync_stripe',
            packageId: before.id,
            durations: [1],
        }, 'POST') as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.productCreate).not.toHaveBeenCalled();
        expect(stripeMocks.priceCreate).not.toHaveBeenCalled();
        expect(stripeMocks.priceUpdate).toHaveBeenCalledWith('price_recovered_1m', {
            metadata: { package_key: 'standard' },
        });
        expect(client.rpc).toHaveBeenCalledWith('activate_package_price', expect.objectContaining({
            p_stripe_product_id: 'prod_recovered',
            p_stripe_price_id: 'price_recovered_1m',
        }));
    });

    it('does not activate an idempotently replayed Price that Stripe already archived', async () => {
        const before = packageRow({ stripe_product_id: null, stripe_price_1m: null });
        const after = packageRow({ stripe_product_id: 'prod_new', stripe_price_1m: null });
        const { client } = createAdminClientForPackage(before, after);
        stripeMocks.priceRetrieve.mockResolvedValueOnce({
            id: 'price_new_1',
            active: false,
            product: 'prod_new',
            unit_amount: 10000,
            currency: 'eur',
            recurring: { interval: 'month', interval_count: 1 },
            livemode: false,
            metadata: {
                package_id: before.id,
                package_key: 'standard',
                catalog_version: '1',
                duration_months: '1',
                app_environment: 'dev',
            },
        });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/packages');
        await expect(POST(contextWithBody({
            action: 'sync_stripe',
            packageId: before.id,
            durations: [1],
        }, 'POST') as any)).rejects.toThrow(
            'Stripe Price does not match the catalog offer after persistence'
        );

        expect(stripeMocks.priceCreate).toHaveBeenCalledTimes(1);
        expect(client.rpc).not.toHaveBeenCalled();
    });
});
