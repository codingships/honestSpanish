import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const settlementId = '70000000-0000-4000-8000-000000000020';
const teacherId = '70000000-0000-4000-8000-000000000002';

function context(id = settlementId) {
    return {
        request: new Request(`http://localhost:4321/api/teacher/compensation-export?settlementId=${id}`),
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function serverClient(role: string | null, userId: string | null = teacherId) {
    const profileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
    };
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: userId ? { id: userId } : null },
                error: userId ? null : { message: 'unauthenticated' },
            }),
        },
        from: vi.fn().mockReturnValue(profileQuery),
    };
}

function adminClient(ownerId = teacherId, status: 'paid' | 'closed' = 'paid') {
    const settlement = {
        id: settlementId,
        teacher_id: ownerId,
        period_month: '2026-07-01',
        period_start_at: '2026-06-30T22:00:00.000Z',
        period_end_at: '2026-07-31T22:00:00.000Z',
        currency: 'eur',
        class_amount_cents: 2000,
        mandatory_work_amount_cents: 1500,
        adjustment_amount_cents: -250,
        total_amount_cents: 3250,
        line_count: 3,
        status,
        paid_at: status === 'paid' ? '2026-08-01T10:00:00.000Z' : null,
        payment_reference: status === 'paid' ? 'transfer-2026-07' : null,
        invoice_reference: status === 'paid' ? 'invoice-2026-07' : null,
    };
    const lines = [{
        source_kind: 'mandatory_work',
        source_occurred_at: '2026-07-15T10:00:00.000Z',
        quantity_minutes: 60,
        description: ' \t=HYPERLINK("https://example.test")',
        amount_cents: 1500,
        currency: 'eur',
    }];
    return {
        from: vi.fn((table: string) => {
            const data = table === 'teacher_compensation_settlement_balances' ? settlement : lines;
            const query: Record<string, unknown> = {};
            for (const method of ['select', 'eq', 'order']) {
                query[method] = vi.fn().mockReturnValue(query);
            }
            query.single = vi.fn().mockResolvedValue({ data, error: null });
            query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
            return query;
        }),
    };
}

describe('/api/teacher/compensation-export', () => {
    beforeEach(() => vi.clearAllMocks());

    it('requires authentication before creating a privileged client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(serverClient(null, null) as never);
        const { GET } = await import('../../src/pages/api/teacher/compensation-export');

        const response = await GET(context() as never);

        expect(response.status).toBe(401);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('prevents a teacher from exporting another teacher settlement', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(serverClient('teacher') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(
            adminClient('70000000-0000-4000-8000-000000000099') as never,
        );
        const { GET } = await import('../../src/pages/api/teacher/compensation-export');

        const response = await GET(context() as never);

        expect(response.status).toBe(403);
    });

    it('exports an owned immutable snapshot as private CSV and neutralizes formulas', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = adminClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(serverClient('teacher') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { GET } = await import('../../src/pages/api/teacher/compensation-export');

        const response = await GET(context() as never);
        const csvBytes = new Uint8Array(await response.clone().arrayBuffer());
        const csv = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
        expect(response.headers.get('Content-Disposition')).toBe(
            'attachment; filename="teacher-settlement-2026-07-01.csv"',
        );
        expect(Array.from(csvBytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);
        expect(csv).toContain('"\' \t=HYPERLINK(""https://example.test"")"');
        expect(csv).toContain('"total_cents","3250"');
        expect(admin.from).toHaveBeenCalledWith('teacher_compensation_settlement_lines');
    });

    it('does not present voided payment evidence as current in a corrected export', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(serverClient('teacher') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient(teacherId, 'closed') as never);
        const { GET } = await import('../../src/pages/api/teacher/compensation-export');

        const response = await GET(context() as never);
        const csv = await response.text();

        expect(response.status).toBe(200);
        expect(csv).toContain('"2026-07-01","closed","","",""');
        expect(csv).not.toContain('transfer-2026-07');
    });
});
