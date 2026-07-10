import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({
    productCreate: vi.fn(),
    productRetrieve: vi.fn(),
    productUpdate: vi.fn(),
    priceCreate: vi.fn(),
    priceRetrieve: vi.fn(),
    priceUpdate: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        products: {
            create: stripeMocks.productCreate,
            retrieve: stripeMocks.productRetrieve,
            update: stripeMocks.productUpdate,
        },
        prices: {
            create: stripeMocks.priceCreate,
            retrieve: stripeMocks.priceRetrieve,
            update: stripeMocks.priceUpdate,
        },
    },
}));

function createRoleClient(role: string | null, user: { id: string; email: string } | null = { id: 'admin-1', email: 'admin@example.com' }) {
    const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: 'missing' } }),
    };

    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
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
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function createAdminClientForPackage(before: Record<string, unknown>, after: Record<string, unknown>) {
    const beforeQuery = createSingleQuery({ data: before, error: null });
    const updateQuery = createSingleQuery({ data: after, error: null });
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const packageQueries = [beforeQuery, updateQuery];
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'packages') return packageQueries.shift();
            if (table === 'admin_audit_log') return { insert: auditInsert };
            throw new Error(`Unexpected table ${table}`);
        }),
    };
    return { client, beforeQuery, updateQuery, auditInsert };
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
        stripeMocks.productCreate.mockResolvedValue({ id: 'prod_new' });
        stripeMocks.productRetrieve.mockRejectedValue(new Error('not found'));
        stripeMocks.productUpdate.mockResolvedValue({ id: 'prod_existing' });
        stripeMocks.priceCreate.mockResolvedValue({ id: 'price_new_1' });
        stripeMocks.priceRetrieve.mockRejectedValue(new Error('not found'));
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
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'package.create',
            entity_id: created.id,
            after: created,
        }));
    });

    it('syncs requested Stripe durations through mocked Stripe and audit logging', async () => {
        const before = packageRow({ stripe_product_id: null, stripe_price_1m: null });
        const after = packageRow({ stripe_product_id: 'prod_new', stripe_price_1m: 'price_new_1' });
        const { client, updateQuery, auditInsert } = createAdminClientForPackage(before, after);
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
        expect(stripeMocks.productCreate).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Estándar',
            active: true,
        }));
        expect(stripeMocks.priceCreate).toHaveBeenCalledWith(expect.objectContaining({
            product: 'prod_new',
            unit_amount: 10000,
            recurring: {
                interval: 'month',
                interval_count: 1,
            },
        }));
        expect(updateQuery.update).toHaveBeenCalledWith({
            stripe_product_id: 'prod_new',
            stripe_price_1m: 'price_new_1',
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'package.stripe_sync',
            before,
            after,
        }));
    });
});
