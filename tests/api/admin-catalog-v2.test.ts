import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    accountRetrieve: vi.fn(),
    productCreate: vi.fn(),
    productList: vi.fn(),
    productRetrieve: vi.fn(),
    productUpdate: vi.fn(),
    priceCreate: vi.fn(),
    priceList: vi.fn(),
    priceRetrieve: vi.fn(),
    priceUpdate: vi.fn(),
    prices: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_catalog';
        if (key === 'PUBLIC_APP_ENV') return 'test';
        return undefined;
    }),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        accounts: { retrieve: stripeMocks.accountRetrieve },
        products: {
            create: stripeMocks.productCreate,
            list: stripeMocks.productList,
            retrieve: stripeMocks.productRetrieve,
            update: stripeMocks.productUpdate,
        },
        prices: {
            create: stripeMocks.priceCreate,
            list: stripeMocks.priceList,
            retrieve: stripeMocks.priceRetrieve,
            update: stripeMocks.priceUpdate,
        },
    },
}));

type TableName = 'packages' | 'package_catalog_drafts' | 'package_prices' | 'checkout_v2_price_snapshots';

function packageRow(overrides: Record<string, unknown> = {}) {
    return {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'individual_4x50_28d',
        display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 индивидуальных занятия' },
        price_monthly: 25900,
        sessions_per_month: 4,
        has_group_session: false,
        has_dual_teacher: false,
        catalog_version: 1,
        stripe_product_id: null,
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
        created_at: '2026-08-03T10:00:00Z',
        updated_at: '2026-08-03T10:00:00Z',
        ...overrides,
    };
}

function draftRow(overrides: Record<string, unknown> = {}) {
    return {
        id: '22222222-2222-4222-8222-222222222222',
        package_id: '11111111-1111-4111-8111-111111111111',
        base_catalog_version: 1,
        package_key: 'individual_4x50_28d',
        display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 индивидуальных занятия' },
        amount_cents: 25900,
        currency: 'eur',
        billing_interval_unit: 'day',
        billing_interval_count: 28,
        sessions_per_period: 4,
        class_duration_minutes: 50,
        has_group_session: false,
        has_dual_teacher: false,
        is_publicly_listed: true,
        revision: 1,
        status: 'draft',
        published_package_price_id: null,
        created_by: 'admin-1',
        updated_by: 'admin-1',
        created_at: '2026-08-03T10:00:00Z',
        updated_at: '2026-08-03T10:00:00Z',
        published_at: null,
        discarded_at: null,
        ...overrides,
    };
}

type State = Record<TableName, Array<Record<string, any>>>;

class Query {
    private filters: Array<(row: Record<string, any>) => boolean> = [];

    constructor(private rows: Array<Record<string, any>>) {}

    select() { return this; }
    order() { return this; }
    eq(column: string, value: unknown) {
        this.filters.push((row) => row[column] === value);
        return this;
    }
    in(column: string, values: unknown[]) {
        this.filters.push((row) => values.includes(row[column]));
        return this;
    }
    private result() {
        return this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    }
    single() {
        const rows = this.result();
        return Promise.resolve(rows.length === 1
            ? { data: rows[0], error: null }
            : { data: null, error: { code: 'PGRST116' } });
    }
    then(resolve: (value: { data: Array<Record<string, any>>; error: null }) => unknown) {
        return Promise.resolve({ data: this.result(), error: null }).then(resolve);
    }
}

function createAdminClient(overrides: Partial<State> = {}) {
    const state: State = {
        packages: [packageRow()],
        package_catalog_drafts: [draftRow()],
        package_prices: [],
        checkout_v2_price_snapshots: [],
        ...overrides,
    };
    const rpc = vi.fn(async (name: string) => {
        if (name === 'retire_versioned_package') {
            for (const price of state.package_prices) price.status = 'retired';
            for (const pkg of state.packages) {
                pkg.is_active = false;
                pkg.is_publicly_listed = false;
            }
        }
        return { data: {}, error: null };
    });
    return {
        state,
        rpc,
        from: vi.fn((table: TableName) => new Query(state[table])),
    };
}

function createServerClient(capabilities: readonly string[] = ['catalog.read', 'catalog.write']) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: { id: 'admin-1', email: 'admin@example.test' } },
                error: null,
            }),
        },
        rpc: vi.fn((_name: string, args: { p_capability: string }) => Promise.resolve({
            data: capabilities.includes(args.p_capability),
            error: null,
        })),
    };
}

function context(body?: Record<string, unknown>) {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/catalog-v2',
            json: vi.fn().mockResolvedValue(body ?? {}),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

describe('/api/admin/catalog-v2', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        stripeMocks.prices.clear();
        stripeMocks.accountRetrieve.mockResolvedValue({
            id: 'acct_catalog_test',
            country: 'ES',
            details_submitted: false,
            charges_enabled: false,
            payouts_enabled: false,
        });
        stripeMocks.productList.mockResolvedValue({ data: [], has_more: false });
        stripeMocks.productRetrieve.mockRejectedValue(Object.assign(new Error('missing'), { code: 'resource_missing' }));
        stripeMocks.productCreate.mockImplementation(async (params: Record<string, any>) => ({
            id: 'prod_catalog_new',
            active: params.active,
            deleted: false,
            name: params.name,
            metadata: params.metadata,
        }));
        stripeMocks.productUpdate.mockImplementation(async (id: string, params: Record<string, any>) => ({
            id,
            active: params.active ?? true,
            deleted: false,
            name: params.name ?? '4 clases individuales',
            metadata: params.metadata ?? {},
        }));
        stripeMocks.priceList.mockResolvedValue({ data: [], has_more: false });
        stripeMocks.priceCreate.mockImplementation(async (params: Record<string, any>) => {
            const role = params.metadata.billing_role as 'initial' | 'recurring';
            const price = {
                id: `price_catalog_${role}`,
                active: true,
                currency: params.currency,
                livemode: false,
                metadata: params.metadata,
                product: params.product,
                recurring: params.recurring ?? null,
                type: params.recurring ? 'recurring' : 'one_time',
                unit_amount: params.unit_amount,
            };
            stripeMocks.prices.set(price.id, price);
            return price;
        });
        stripeMocks.priceRetrieve.mockImplementation(async (id: string) => stripeMocks.prices.get(id));
        stripeMocks.priceUpdate.mockResolvedValue({ active: false });

        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createServerClient() as any);
    });

    it('loads the versioned catalogue without contacting Stripe', async () => {
        const admin = createAdminClient();
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { GET } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await GET(context() as any);
        const body = await response.json() as any;

        expect(response.status).toBe(200);
        expect(body.can_write).toBe(true);
        expect(body.packages[0]).toEqual(expect.objectContaining({
            package_key: 'individual_4x50_28d',
            checkout_compatible: true,
            sellable_now: false,
        }));
        expect(body.packages[0].draft.guarantee_schedule[0].refundableAmountCents).toBe(19425);
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
    });

    it('creates an editable version without any Stripe side effect', async () => {
        const admin = createAdminClient({ package_catalog_drafts: [] });
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'create_draft',
            packageId: '11111111-1111-4111-8111-111111111111',
        }) as any);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenCalledWith('create_package_catalog_draft', {
            p_actor_id: 'admin-1',
            p_package_id: '11111111-1111-4111-8111-111111111111',
        });
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.productCreate).not.toHaveBeenCalled();
        expect(stripeMocks.priceCreate).not.toHaveBeenCalled();
    });

    it('rejects catalogue mutation for a read-only administrator before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createServerClient(['catalog.read']) as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'discard_draft',
            draftId: '22222222-2222-4222-8222-222222222222',
            expectedRevision: 1,
        }) as any);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
    });

    it('blocks public listing of terms unsupported by the current checkout before saving', async () => {
        const admin = createAdminClient();
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'update_draft',
            draftId: '22222222-2222-4222-8222-222222222222',
            expectedRevision: 1,
            displayName: { es: 'Otro', en: 'Other', ru: 'Другой' },
            amountCents: 29900,
            billingIntervalUnit: 'day',
            billingIntervalCount: 28,
            sessionsPerPeriod: 4,
            classDurationMinutes: 50,
            hasGroupSession: false,
            hasDualTeacher: false,
            isPubliclyListed: true,
        }) as any);

        expect(response.status).toBe(409);
        expect(admin.rpc).not.toHaveBeenCalledWith('update_package_catalog_draft', expect.anything());
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
    });

    it('publishes one Product and an exact one-time/recurring Price pair', async () => {
        const admin = createAdminClient();
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'publish_draft',
            draftId: '22222222-2222-4222-8222-222222222222',
            expectedRevision: 1,
        }) as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.productCreate).toHaveBeenCalledTimes(1);
        expect(stripeMocks.priceCreate).toHaveBeenCalledTimes(2);
        expect(stripeMocks.priceCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                product: 'prod_catalog_new',
                unit_amount: 25900,
                metadata: expect.objectContaining({ billing_role: 'initial', catalog_version: '2' }),
            }),
            expect.objectContaining({ idempotencyKey: expect.stringContaining(':initial') }),
        );
        expect(stripeMocks.priceCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                recurring: { interval: 'day', interval_count: 28 },
                metadata: expect.objectContaining({ billing_role: 'recurring', catalog_version: '2' }),
            }),
            expect.objectContaining({ idempotencyKey: expect.stringContaining(':recurring') }),
        );
        expect(admin.rpc).toHaveBeenCalledWith('publish_package_catalog_draft', {
            p_actor_id: 'admin-1',
            p_draft_id: '22222222-2222-4222-8222-222222222222',
            p_expected_revision: 1,
            p_initial_stripe_price_id: 'price_catalog_initial',
            p_recurring_stripe_price_id: 'price_catalog_recurring',
            p_stripe_account_id: 'acct_catalog_test',
            p_stripe_livemode: false,
            p_stripe_product_id: 'prod_catalog_new',
        });
    });

    it('reuses the exact Stripe objects from a prior partial publication attempt', async () => {
        const metadataBase = {
            app_environment: 'test',
            catalog_draft_id: '22222222-2222-4222-8222-222222222222',
            catalog_draft_revision: '1',
            catalog_generation: 'v2',
            catalog_version: '2',
            package_id: '11111111-1111-4111-8111-111111111111',
            package_key: 'individual_4x50_28d',
        };
        const admin = createAdminClient({
            packages: [packageRow({ stripe_product_id: 'prod_catalog_recovered' })],
        });
        stripeMocks.productRetrieve.mockResolvedValueOnce({
            id: 'prod_catalog_recovered',
            active: true,
            deleted: false,
            name: '4 clases individuales',
            metadata: {
                app_environment: 'test',
                catalog_generation: 'v2',
                current_catalog_version: '2',
                package_id: '11111111-1111-4111-8111-111111111111',
                package_key: 'individual_4x50_28d',
            },
        });
        stripeMocks.priceList.mockResolvedValueOnce({
            has_more: false,
            data: [
                {
                    id: 'price_catalog_recovered_initial',
                    active: true,
                    currency: 'eur',
                    livemode: false,
                    metadata: { ...metadataBase, billing_role: 'initial' },
                    product: 'prod_catalog_recovered',
                    recurring: null,
                    type: 'one_time',
                    unit_amount: 25900,
                },
                {
                    id: 'price_catalog_recovered_recurring',
                    active: true,
                    currency: 'eur',
                    livemode: false,
                    metadata: { ...metadataBase, billing_role: 'recurring' },
                    product: 'prod_catalog_recovered',
                    recurring: { interval: 'day', interval_count: 28 },
                    type: 'recurring',
                    unit_amount: 25900,
                },
            ],
        });
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'publish_draft',
            draftId: '22222222-2222-4222-8222-222222222222',
            expectedRevision: 1,
        }) as any);

        expect(response.status).toBe(200);
        expect(stripeMocks.productCreate).not.toHaveBeenCalled();
        expect(stripeMocks.priceCreate).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenCalledWith('publish_package_catalog_draft', expect.objectContaining({
            p_stripe_product_id: 'prod_catalog_recovered',
            p_initial_stripe_price_id: 'price_catalog_recovered_initial',
            p_recurring_stripe_price_id: 'price_catalog_recovered_recurring',
        }));
    });

    it('fails a stale publication before contacting Stripe', async () => {
        const admin = createAdminClient();
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'publish_draft',
            draftId: '22222222-2222-4222-8222-222222222222',
            expectedRevision: 2,
        }) as any);

        expect(response.status).toBe(409);
        expect(stripeMocks.accountRetrieve).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalledWith('publish_package_catalog_draft', expect.anything());
    });

    it('retires in the database before archiving both Stripe Prices and the Product', async () => {
        const admin = createAdminClient({
            packages: [packageRow({ stripe_product_id: 'prod_catalog_existing', is_active: true })],
            package_prices: [{
                id: '33333333-3333-4333-8333-333333333333',
                package_id: '11111111-1111-4111-8111-111111111111',
                contract_schema_version: 2,
                catalog_version: 2,
                status: 'active',
                stripe_price_id: 'price_catalog_recurring_old',
            }],
            checkout_v2_price_snapshots: [{
                package_price_id: '33333333-3333-4333-8333-333333333333',
                initial_stripe_price_id: 'price_catalog_initial_old',
                recurring_stripe_price_id: 'price_catalog_recurring_old',
            }],
        });
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'retire_package',
            packageId: '11111111-1111-4111-8111-111111111111',
        }) as any);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenCalledWith('retire_versioned_package', {
            p_actor_id: 'admin-1',
            p_package_id: '11111111-1111-4111-8111-111111111111',
        });
        expect(stripeMocks.priceUpdate).toHaveBeenCalledWith('price_catalog_initial_old', { active: false });
        expect(stripeMocks.priceUpdate).toHaveBeenCalledWith('price_catalog_recurring_old', { active: false });
        expect(stripeMocks.productUpdate).toHaveBeenCalledWith('prod_catalog_existing', { active: false });
        expect(admin.rpc.mock.invocationCallOrder.at(-1)).toBeLessThan(stripeMocks.productUpdate.mock.invocationCallOrder[0]!);
    });

    it('keeps a database retirement successful when Stripe cleanup is temporarily unavailable', async () => {
        const admin = createAdminClient({
            packages: [packageRow({ stripe_product_id: 'prod_catalog_existing', is_active: true })],
        });
        stripeMocks.accountRetrieve.mockRejectedValueOnce(new Error('temporary Stripe outage'));
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as any);
        const { POST } = await import('../../src/pages/api/admin/catalog-v2');

        const response = await POST(context({
            action: 'retire_package',
            packageId: '11111111-1111-4111-8111-111111111111',
        }) as any);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            operation: { warnings: ['stripe:runtime'] },
        });
        expect(admin.rpc).toHaveBeenCalledWith('retire_versioned_package', expect.anything());
        expect(stripeMocks.priceUpdate).not.toHaveBeenCalled();
        expect(stripeMocks.productUpdate).not.toHaveBeenCalled();
    });
});
