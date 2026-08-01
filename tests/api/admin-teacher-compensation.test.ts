import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

function roleClient(role: string | null, user: { id: string } | null = { id: 'admin-1' }) {
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

function context(body?: unknown, origin = 'http://localhost:4321') {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/teacher-compensation',
            headers: { get: vi.fn((name: string) => name === 'Origin' ? origin : '') },
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function rpcClient(data: Record<string, unknown> = { id: 'result-1' }) {
    return {
        rpc: vi.fn().mockResolvedValue({ data, error: null }),
    };
}

function listAdminClient() {
    const tableResults: Record<string, unknown[]> = {
        profiles: [[{ id: 'teacher-1', full_name: 'Irene', email: 'irene@example.test' }]],
        teacher_compensation_engagements: [[
            { id: 'future', teacher_id: 'teacher-1', engagement_kind: 'founder', effective_from: '2099-01-01T00:00:00.000Z', reason: 'Cambio futuro', created_at: '2026-08-01T10:00:00.000Z' },
            { id: 'current', teacher_id: 'teacher-1', engagement_kind: 'external', effective_from: '2026-07-01T00:00:00.000Z', reason: 'Vínculo actual', created_at: '2026-07-01T00:00:00.000Z' },
        ]],
        teacher_compensation_milestones: [{ ten_active_history_state: 'tracking', first_ready_initial_at: null, ten_active_reached_at: null, ten_active_students_count: null }],
        checkout_v2_cycles: [[], [{ id: 'cycle-gap', created_at: '2026-08-01T10:00:00.000Z', cycle_number: 1, subscription_id: 'sub-1', subscription: { contract_schema_version: 2, student: { full_name: 'Ana', email: 'ana@example.test' } } }]],
        teacher_compensation_session_reconciliation_candidates: [[
            { session_id: 'completed', cycle_id: 'cycle-gap', scheduled_at: '2026-08-01T10:00:00.000Z', status: 'completed', event_kind: 'class_completed', source_occurred_at: '2026-08-01T11:00:00.000Z', teacher_id: 'teacher-1', student_id: 'student-1', teacher_full_name: 'Irene', teacher_email: 'irene@example.test', student_full_name: 'Ana', student_email: 'ana@example.test' },
            { session_id: 'no-show', cycle_id: 'cycle-gap', scheduled_at: '2026-08-02T10:00:00.000Z', status: 'no_show', event_kind: 'student_no_show', source_occurred_at: '2026-08-02T10:30:00.000Z', teacher_id: 'teacher-1', student_id: 'student-1', teacher_full_name: 'Irene', teacher_email: 'irene@example.test', student_full_name: 'Ana', student_email: 'ana@example.test' },
            { session_id: 'late', cycle_id: 'cycle-gap', scheduled_at: '2026-08-03T10:00:00.000Z', status: 'cancelled', event_kind: 'student_late_cancellation', source_occurred_at: '2026-08-02T11:00:00.000Z', teacher_id: 'teacher-1', student_id: 'student-1', teacher_full_name: 'Irene', teacher_email: 'irene@example.test', student_full_name: 'Ana', student_email: 'ana@example.test' },
        ]],
        teacher_compensation_ledger: [[]],
        teacher_compensation_work_balances: [[{
            id: 'work-1',
            teacher_id: 'teacher-1',
            work_kind: 'mandatory_training',
            started_at: '2026-08-01T10:00:00.000Z',
            ended_at: '2026-08-01T11:00:00.000Z',
            duration_minutes: 60,
            amount_cents: 1500,
            adjustment_minutes: -15,
            adjusted_minutes: 45,
            adjustment_amount_cents: -375,
            adjusted_amount_cents: 1125,
            currency: 'eur',
            description: 'Formación obligatoria',
            created_at: '2026-08-01T11:00:00.000Z',
        }]],
        teacher_compensation_work_adjustments: [[]],
    };
    const relationFilters: Array<{ table: string; column: string; value: unknown }> = [];
    const client = {
        from: vi.fn((table: string) => {
            const next = tableResults[table]?.shift() ?? [];
            const query: Record<string, unknown> = {};
            for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit', 'range']) {
                query[method] = vi.fn().mockReturnValue(query);
            }
            query.is = vi.fn((column: string, value: unknown) => {
                relationFilters.push({ table, column, value });
                return query;
            });
            query.single = vi.fn().mockResolvedValue({ data: next, error: null });
            query.then = (resolve: (value: unknown) => unknown) => resolve({ data: next, error: null });
            return query;
        }),
    };
    return { client, relationFilters };
}

describe('/api/admin/teacher-compensation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects unauthenticated and non-admin callers before creating a service-role client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/teacher-compensation');

        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient(null, null) as never);
        const unauthenticated = await POST(context({ action: 'reconcile_cycle', cycleId: '70000000-0000-4000-8000-000000000001' }) as never);
        expect(unauthenticated.status).toBe(401);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();

        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('student') as never);
        const nonAdmin = await POST(context({ action: 'reconcile_cycle', cycleId: '70000000-0000-4000-8000-000000000001' }) as never);
        expect(nonAdmin.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects cross-origin and originless mutations before any auth or privileged access', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/teacher-compensation');
        const payload = { action: 'reconcile_cycle', cycleId: '70000000-0000-4000-8000-000000000001' };

        const crossOrigin = await POST(context(payload, 'https://example.test') as never);
        const originless = await POST(context(payload, '') as never);

        expect(crossOrigin.status).toBe(403);
        expect(originless.status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('passes the authenticated admin id to engagement and reconciliation RPCs', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = rpcClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teacher-compensation');

        const response = await POST(context({
            action: 'configure_engagement',
            requestId: '70000000-0000-4000-8000-000000000001',
            teacherId: '70000000-0000-4000-8000-000000000002',
            engagementKind: 'external',
            effectiveFrom: '2026-08-01T10:00:00.000Z',
            reason: 'Inicio del vínculo externo',
            configuredBy: 'attacker-controlled',
        }) as never);

        expect(response.status).toBe(200);
        expect(admin.rpc).toHaveBeenCalledWith('configure_teacher_compensation_engagement', {
            p_request_id: '70000000-0000-4000-8000-000000000001',
            p_teacher_id: '70000000-0000-4000-8000-000000000002',
            p_engagement_kind: 'external',
            p_effective_from: '2026-08-01T10:00:00.000Z',
            p_configured_by: 'admin-1',
            p_reason: 'Inicio del vínculo externo',
        });
    });

    it('records and adjusts mandatory work with stable request ids and the authenticated recorder', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = rpcClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teacher-compensation');

        const record = await POST(context({
            action: 'record_mandatory_work',
            requestId: '70000000-0000-4000-8000-000000000003',
            teacherId: '70000000-0000-4000-8000-000000000002',
            workKind: 'mandatory_training',
            startedAt: '2026-08-01T10:00:00.000Z',
            endedAt: '2026-08-01T11:00:00.000Z',
            description: 'Formación inicial obligatoria',
            recordedBy: 'attacker-controlled',
        }) as never);

        expect(record.status).toBe(200);
        expect(admin.rpc).toHaveBeenLastCalledWith('record_teacher_compensation_work', {
            p_request_id: '70000000-0000-4000-8000-000000000003',
            p_teacher_id: '70000000-0000-4000-8000-000000000002',
            p_work_kind: 'mandatory_training',
            p_started_at: '2026-08-01T10:00:00.000Z',
            p_ended_at: '2026-08-01T11:00:00.000Z',
            p_recorded_by: 'admin-1',
            p_description: 'Formación inicial obligatoria',
        });

        const adjustment = await POST(context({
            action: 'adjust_mandatory_work',
            requestId: '70000000-0000-4000-8000-000000000004',
            workEntryId: '70000000-0000-4000-8000-000000000005',
            minutesDelta: -15,
            reason: 'Corrección del tiempo real',
        }) as never);

        expect(adjustment.status).toBe(200);
        expect(admin.rpc).toHaveBeenLastCalledWith('adjust_teacher_compensation_work', {
            p_request_id: '70000000-0000-4000-8000-000000000004',
            p_work_entry_id: '70000000-0000-4000-8000-000000000005',
            p_minutes_delta: -15,
            p_recorded_by: 'admin-1',
            p_reason: 'Corrección del tiempo real',
        });
    });

    it('rejects invalid work intervals before creating a privileged client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        const { POST } = await import('../../src/pages/api/admin/teacher-compensation');

        const response = await POST(context({
            action: 'record_mandatory_work',
            requestId: '70000000-0000-4000-8000-000000000003',
            teacherId: '70000000-0000-4000-8000-000000000002',
            workKind: 'mandatory_meeting',
            startedAt: '2026-08-01T11:00:00.000Z',
            endedAt: '2026-08-01T10:00:00.000Z',
            description: 'Reunión obligatoria del equipo',
        }) as never);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('maps exclusion conflicts to 409 without exposing database details', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '23P01', message: 'sensitive exclusion detail' } }) };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/teacher-compensation');

        const response = await POST(context({
            action: 'configure_engagement',
            requestId: '70000000-0000-4000-8000-000000000001',
            teacherId: '70000000-0000-4000-8000-000000000002',
            engagementKind: 'external',
            effectiveFrom: '2026-08-01T10:00:00.000Z',
            reason: 'Inicio del vínculo externo',
        }) as never);
        const body = await response.json() as { error: string };

        expect(response.status).toBe(409);
        expect(body.error).toBe('La operación entra en conflicto con el estado registrado');
        expect(body.error).not.toContain('sensitive');
    });

    it('lists only real reconciliation gaps and does not call a future engagement current', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { client, relationFilters } = listAdminClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
        const { GET } = await import('../../src/pages/api/admin/teacher-compensation');

        const response = await GET(context() as never);
        const body = await response.json() as {
            teachers: Array<{ currentEngagement: { id: string } | null }>;
            cycleGaps: Array<{ id: string }>;
            sessionGaps: Array<{ id: string }>;
            workObligations: Array<{
                originalMinutes: number;
                originalAmountCents: number;
                adjustedMinutes: number;
                adjustedAmountCents: number;
            }>;
        };

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(body.teachers[0].currentEngagement?.id).toBe('current');
        expect(body.cycleGaps.map((item) => item.id)).toEqual(['cycle-gap']);
        expect(body.sessionGaps.map((item) => item.id)).toEqual(['completed', 'no-show', 'late']);
        expect(body.workObligations[0]).toMatchObject({
            originalMinutes: 60,
            originalAmountCents: 1500,
            adjustedMinutes: 45,
            adjustedAmountCents: 1125,
        });
        expect(client.from).toHaveBeenCalledWith('teacher_compensation_session_reconciliation_candidates');
        expect(relationFilters).toEqual(expect.arrayContaining([
            { table: 'checkout_v2_cycles', column: 'cycle_terms', value: null },
        ]));
    });
});
