import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const adminId = '70000000-0000-4000-8000-000000000001';
const teacherId = '70000000-0000-4000-8000-000000000002';
const requestId = '70000000-0000-4000-8000-000000000003';
const slotId = '70000000-0000-4000-8000-000000000004';
const packageId = '70000000-0000-4000-8000-000000000005';

function roleClient(role: string | null, user: { id: string } | null = { id: adminId }) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
        },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
        })),
    };
}

function context(body: unknown, origin = 'http://localhost:4321') {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (origin) headers.set('Origin', origin);
    return {
        request: new Request('http://localhost:4321/api/admin/teachers-slots', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        }),
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function thenableQuery<T>(data: T) {
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'ilike', 'lte', 'gt', 'in', 'order', 'limit']) {
        query[method] = vi.fn().mockReturnValue(query);
    }
    query.then = (
        resolve: (value: { data: T; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data, error: null }).then(resolve, reject);
    return query;
}

const canonicalPackage = {
    id: packageId,
    name: 'individual_4x50_28d',
    display_name: '4 clases individuales',
    amount_cents: 25900,
    contract_schema_version: 2,
    billing_interval_unit: 'day',
    billing_interval_count: 28,
    sessions_per_period: 4,
    class_duration_minutes: 50,
};

const canonicalPrice = {
    id: '70000000-0000-4000-8000-000000000006',
    package_id: packageId,
    amount_cents: 25900,
    currency: 'eur',
    contract_schema_version: 2,
    billing_interval_unit: 'day',
    billing_interval_count: 28,
    sessions_per_period: 4,
    class_duration_minutes: 50,
};

describe('/api/admin/teachers-slots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects cross-origin and originless mutations before authentication', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/teachers-slots');
        const payload = {
            action: 'transition_slot', requestId, slotId, transition: 'pause', reason: 'Pausa operativa',
        };

        expect((await POST(context(payload, 'https://example.test') as never)).status).toBe(403);
        expect((await POST(context(payload, '') as never)).status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('creates the exact four Madrid occurrences across the spring offset change', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const rpc = vi.fn().mockResolvedValue({ data: { id: slotId }, error: null });
        const admin = {
            from: vi.fn((table: string) => thenableQuery(
                table === 'packages' ? [canonicalPackage] : [canonicalPrice],
            )),
            rpc,
        };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teachers-slots');

        const response = await POST(context({
            action: 'create_slot',
            requestId,
            teacherId,
            firstClassDate: '2026-03-22',
            localStartTime: '10:00',
            reason: 'Nueva franja semanal',
        }) as never);

        expect(response.status).toBe(200);
        expect(rpc).toHaveBeenCalledWith('admin_create_bookable_slot', {
            p_request_id: requestId,
            p_package_id: packageId,
            p_teacher_id: teacherId,
            p_timezone_name: 'Europe/Madrid',
            p_occurrences: [
                '2026-03-22T09:00:00.000Z',
                '2026-03-29T08:00:00.000Z',
                '2026-04-05T08:00:00.000Z',
                '2026-04-12T08:00:00.000Z',
            ],
            p_admin_id: adminId,
            p_reason: 'Nueva franja semanal',
        });
    });

    it('configures a future engagement for an already-active teacher', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const rpc = vi.fn().mockResolvedValue({ data: { id: 'engagement-2' }, error: null });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);
        const { POST } = await import('../../src/pages/api/admin/teachers-slots');

        const response = await POST(context({
            action: 'configure_engagement',
            requestId,
            teacherId,
            engagementKind: 'external',
            effectiveFrom: '2026-09-01T10:00:00.000Z',
            reason: 'Cambio futuro acordado',
        }) as never);

        expect(response.status).toBe(200);
        expect(rpc).toHaveBeenCalledWith('configure_teacher_compensation_engagement', {
            p_request_id: requestId,
            p_teacher_id: teacherId,
            p_engagement_kind: 'external',
            p_effective_from: '2026-09-01T10:00:00.000Z',
            p_configured_by: adminId,
            p_reason: 'Cambio futuro acordado',
        });
    });

    it('rejects an ambiguous Madrid wall-clock time before querying the catalog', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = { from: vi.fn(), rpc: vi.fn() };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teachers-slots');

        const response = await POST(context({
            action: 'create_slot',
            requestId,
            teacherId,
            firstClassDate: '2026-10-25',
            localStartTime: '02:30',
            reason: 'Nueva franja semanal',
        }) as never);

        expect(response.status).toBe(400);
        expect(admin.from).not.toHaveBeenCalled();
        expect(admin.rpc).not.toHaveBeenCalled();
    });

    it('escapes ILIKE metacharacters and activates only a matching confirmed identity', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const email = 'first_last@example.com';
        const profileQuery = thenableQuery([{ id: teacherId, email }]);
        const rpc = vi.fn().mockResolvedValue({ data: { id: teacherId }, error: null });
        const admin = {
            from: vi.fn(() => profileQuery),
            auth: {
                admin: {
                    getUserById: vi.fn().mockResolvedValue({
                        data: { user: { id: teacherId, email, email_confirmed_at: '2026-08-01T10:00:00.000Z' } },
                        error: null,
                    }),
                },
            },
            rpc,
        };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teachers-slots');

        const response = await POST(context({
            action: 'activate_teacher',
            requestId,
            email,
            engagementKind: 'external',
            effectiveFrom: '2026-08-02T10:00:00.000Z',
            reason: 'Alta docente confirmada',
        }) as never);

        expect(response.status).toBe(200);
        expect(profileQuery.ilike).toHaveBeenCalledWith('email', 'first\\_last@example.com');
        expect(admin.auth.admin.getUserById).toHaveBeenCalledWith(teacherId);
        expect(rpc).toHaveBeenCalledWith('activate_teacher_profile', {
            p_request_id: requestId,
            p_profile_id: teacherId,
            p_engagement_kind: 'external',
            p_effective_from: '2026-08-02T10:00:00.000Z',
            p_admin_id: adminId,
            p_reason: 'Alta docente confirmada',
        });
    });

    it('returns the current engagement, active availability, four occurrences and any blocking hold', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const queries = new Map<string, ReturnType<typeof thenableQuery>>();
        const rows: Record<string, unknown[]> = {
            packages: [canonicalPackage],
            package_prices: [canonicalPrice],
            profiles: [{ id: teacherId, full_name: 'Irene', email: 'irene@example.com' }],
            teacher_compensation_engagements: [{
                id: 'engagement-1', teacher_id: teacherId, engagement_kind: 'founder',
                effective_from: '2026-09-01T10:00:00.000Z',
            }],
            teacher_availability: [{
                id: 'availability-1', teacher_id: teacherId, day_of_week: 1,
                start_time: '10:00:00', end_time: '11:00:00',
            }],
            bookable_slots: [{
                id: slotId,
                public_id: '70000000-0000-4000-8000-000000000007',
                teacher_id: teacherId,
                status: 'available',
                weekday: 1,
                local_start_time: '10:00:00',
                timezone_name: 'Europe/Madrid',
                first_occurrence_at: '2026-08-03T08:00:00.000Z',
                published_at: '2026-08-01T10:00:00.000Z',
                created_at: '2026-08-01T09:00:00.000Z',
            }],
            bookable_slot_occurrences: [0, 1, 2, 3].map((index) => ({
                slot_id: slotId,
                occurrence_index: index + 1,
                starts_at: new Date(Date.parse('2026-08-03T08:00:00.000Z') + index * 7 * 86_400_000).toISOString(),
                duration_minutes: 50,
            })),
            bookable_slot_holds: [{ slot_id: slotId }],
        };
        const admin = {
            from: vi.fn((table: string) => {
                const query = thenableQuery(rows[table] || []);
                queries.set(table, query);
                return query;
            }),
        };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { GET } = await import('../../src/pages/api/admin/teachers-slots');

        const response = await GET(context({}) as never);
        const body = await response.json() as {
            teachers: Array<{ currentEngagement: { engagementKind: string; effectiveFrom: string }; availability: unknown[] }>;
            slots: Array<{ occurrences: unknown[]; hasLiveHold: boolean }>;
        };

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(body.teachers[0].currentEngagement.engagementKind).toBe('founder');
        expect(body.teachers[0].currentEngagement.effectiveFrom).toBe('2026-09-01T10:00:00.000Z');
        expect(queries.get('teacher_compensation_engagements')?.lte).not.toHaveBeenCalled();
        expect(body.teachers[0].availability).toHaveLength(1);
        expect(body.slots[0]).toMatchObject({ hasLiveHold: true });
        expect(body.slots[0].occurrences).toHaveLength(4);
        expect(queries.get('bookable_slot_holds')?.eq).toHaveBeenCalledWith('status', 'held');
        expect(queries.get('bookable_slot_holds')?.gt).not.toHaveBeenCalled();
    });

    it('maps transition conflicts without exposing the database message', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = {
            rpc: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23P01', message: 'sensitive exclusion detail' },
            }),
        };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teachers-slots');

        const response = await POST(context({
            action: 'transition_slot',
            requestId,
            slotId,
            transition: 'publish',
            reason: 'Publicaci\u00f3n inicial',
        }) as never);
        const body = await response.json() as { error: string };

        expect(response.status).toBe(409);
        expect(body.error).toBe('La operaci\u00f3n entra en conflicto con el estado registrado');
        expect(body.error).not.toContain('sensitive');
    });
});
