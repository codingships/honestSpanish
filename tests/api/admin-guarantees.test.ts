import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const guaranteeMocks = vi.hoisted(() => ({
    resumeCheckoutV2GuaranteeOperation: vi.fn(),
    reconcileCheckoutV2GuaranteeRefundOperation: vi.fn(),
    resolveCheckoutV2GuaranteeReview: vi.fn(),
}));

const jobMocks = vi.hoisted(() => ({
    triggerFulfillmentProcessing: vi.fn(),
}));

vi.mock('../../src/lib/checkout-v2-guarantee', () => ({
    CheckoutV2GuaranteeError: class CheckoutV2GuaranteeError extends Error {},
    resumeCheckoutV2GuaranteeOperation: guaranteeMocks.resumeCheckoutV2GuaranteeOperation,
    reconcileCheckoutV2GuaranteeRefundOperation: guaranteeMocks.reconcileCheckoutV2GuaranteeRefundOperation,
    resolveCheckoutV2GuaranteeReview: guaranteeMocks.resolveCheckoutV2GuaranteeReview,
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    triggerFulfillmentProcessing: jobMocks.triggerFulfillmentProcessing,
}));

const adminId = '10000000-0000-4000-8000-000000000001';
const operationId = '20000000-0000-4000-8000-000000000002';
const subscriptionId = '30000000-0000-4000-8000-000000000003';
const studentId = '40000000-0000-4000-8000-000000000004';
const sessionId = '50000000-0000-4000-8000-000000000005';

function roleClient(role: string | null) {
    const profileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
    };
    return {
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: adminId } }, error: null }) },
        from: vi.fn(() => profileQuery),
    };
}

function query(result: { data: unknown; error: unknown }) {
    const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    return chain;
}

function context(path: string, body?: Record<string, unknown>, origin: string | null = 'http://localhost:4321') {
    return {
        request: new Request(`http://localhost:4321${path}`, {
            method: body ? 'POST' : 'GET',
            headers: body ? {
                ...(origin ? { Origin: origin } : {}),
                'Content-Type': 'application/json',
            } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        }),
        cookies: { get: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

describe('/api/admin/guarantees', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects non-admin users before creating a service-role client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('student') as never);

        const { GET } = await import('../../src/pages/api/admin/guarantees');
        const response = await GET(context('/api/admin/guarantees') as never);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('lists immutable operations with gross, refunded and net amounts plus valid incident candidates', async () => {
        const operationRow = {
            id: operationId,
            subscription_id: subscriptionId,
            payment_id: '60000000-0000-4000-8000-000000000006',
            second_session_id: sessionId,
            gross_amount_cents: 25900,
            refund_amount_cents: 19425,
            currency: 'eur',
            status: 'retryable',
            stripe_refund_id: null,
            refund_status: null,
            created_at: '2026-08-01T10:00:00.000Z',
            updated_at: '2026-08-01T10:05:00.000Z',
            refund_created_at: null,
            refunded_at: null,
            support_ticket_id: null,
            last_error: 'temporary',
            subscription: { id: subscriptionId, student_id: studentId, contract_schema_version: 2, student: { id: studentId, full_name: 'Ana', email: 'ana@example.com' } },
            payment: { id: '60000000-0000-4000-8000-000000000006', amount: 25900, amount_refunded: 1000, currency: 'eur', status: 'succeeded' },
            support_ticket: null,
        };
        const sessionRow = {
            id: sessionId,
            subscription_id: subscriptionId,
            status: 'no_show',
            scheduled_at: '2026-08-01T11:00:00.000Z',
            cancelled_at: null,
            cancelled_by: null,
            updated_at: '2026-08-01T11:15:00.000Z',
            subscription: operationRow.subscription,
            cycle: { id: '70000000-0000-4000-8000-000000000007', cycle_number: 1, cycle_kind: 'initial' },
        };
        const operationsQuery = query({ data: [operationRow], error: null });
        const incidentsQuery = query({ data: [sessionRow], error: null });
        const resolutionsQuery = query({ data: [], error: null });
        const adminClient = {
            from: vi.fn((table: string) => {
                if (table === 'checkout_v2_guarantee_operations') return operationsQuery;
                if (table === 'sessions') return incidentsQuery;
                if (table === 'checkout_v2_session_incident_resolutions') return resolutionsQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as never);

        const { GET } = await import('../../src/pages/api/admin/guarantees');
        const response = await GET(context('/api/admin/guarantees?status=retryable') as never);
        const body = await response.json() as {
            operations: Array<Record<string, unknown>>;
            incidents: Array<Record<string, unknown>>;
        };

        expect(response.status).toBe(200);
        expect(operationsQuery.eq).toHaveBeenCalledWith('status', 'retryable');
        expect(body.operations[0]).toEqual(expect.objectContaining({
            id: operationId,
            grossCents: 25900,
            guaranteeRefundCents: 19425,
            refundedCents: 1000,
            netCents: 24900,
        }));
        expect(body.incidents[0]).toEqual(expect.objectContaining({
            sessionId,
            canExcuse: false,
        }));
    });

    it('applies the student and Checkout V2 initial-cycle filters before the result limit', async () => {
        const subscriptionsQuery = query({ data: [{ id: subscriptionId }], error: null });
        const operationsQuery = query({ data: [], error: null });
        const incidentsQuery = query({ data: [], error: null });
        const adminClient = {
            from: vi.fn((table: string) => {
                if (table === 'subscriptions') return subscriptionsQuery;
                if (table === 'checkout_v2_guarantee_operations') return operationsQuery;
                if (table === 'sessions') return incidentsQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as never);

        const { GET } = await import('../../src/pages/api/admin/guarantees');
        const response = await GET(context(`/api/admin/guarantees?studentId=${studentId}`) as never);

        expect(response.status).toBe(200);
        expect(subscriptionsQuery.eq).toHaveBeenCalledWith('student_id', studentId);
        expect(operationsQuery.in).toHaveBeenCalledWith('subscription_id', [subscriptionId]);
        expect(incidentsQuery.in).toHaveBeenCalledWith('subscription_id', [subscriptionId]);
        expect(incidentsQuery.eq).toHaveBeenCalledWith('subscription.contract_schema_version', 2);
        expect(incidentsQuery.eq).toHaveBeenCalledWith('cycle.cycle_number', 1);
        expect(incidentsQuery.eq).toHaveBeenCalledWith('cycle.cycle_kind', 'initial');
        expect(operationsQuery.in.mock.invocationCallOrder[0]).toBeLessThan(operationsQuery.limit.mock.invocationCallOrder[0]);
        expect(incidentsQuery.in.mock.invocationCallOrder[0]).toBeLessThan(incidentsQuery.limit.mock.invocationCallOrder[0]);
    });

    it('keeps an incident non-actionable when its operation exists outside the filtered operation list', async () => {
        const subscription = {
            id: subscriptionId,
            student_id: studentId,
            contract_schema_version: 2,
            student: { id: studentId, full_name: 'Ana', email: 'ana@example.com' },
        };
        const sessionRow = {
            id: sessionId,
            subscription_id: subscriptionId,
            status: 'no_show',
            scheduled_at: '2026-08-01T11:00:00.000Z',
            cancelled_at: null,
            cancelled_by: null,
            updated_at: '2026-08-01T11:15:00.000Z',
            subscription,
            cycle: { id: '70000000-0000-4000-8000-000000000007', cycle_number: 1, cycle_kind: 'initial' },
        };
        const listedOperations = query({ data: [], error: null });
        const incidentsQuery = query({ data: [sessionRow], error: null });
        const resolutionsQuery = query({ data: [], error: null });
        const incidentOperationGuard = query({ data: [{ subscription_id: subscriptionId }], error: null });
        const operationQueries = [listedOperations, incidentOperationGuard];
        const adminClient = {
            from: vi.fn((table: string) => {
                if (table === 'checkout_v2_guarantee_operations') return operationQueries.shift();
                if (table === 'sessions') return incidentsQuery;
                if (table === 'checkout_v2_session_incident_resolutions') return resolutionsQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as never);

        const { GET } = await import('../../src/pages/api/admin/guarantees');
        const response = await GET(context('/api/admin/guarantees?status=refunded') as never);
        const body = await response.json() as {
            operations: Array<Record<string, unknown>>;
            incidents: Array<Record<string, unknown>>;
        };

        expect(response.status).toBe(200);
        expect(body.operations).toEqual([]);
        expect(body.incidents[0]).toEqual(expect.objectContaining({ sessionId, canExcuse: false }));
        expect(incidentOperationGuard.in).toHaveBeenCalledWith('subscription_id', [subscriptionId]);
    });

    it('fails closed if a legacy or non-initial session leaks through the database filters', async () => {
        const legacySession = {
            id: sessionId,
            subscription_id: subscriptionId,
            status: 'no_show',
            scheduled_at: '2026-08-01T11:00:00.000Z',
            cancelled_at: null,
            cancelled_by: null,
            updated_at: '2026-08-01T11:15:00.000Z',
            subscription: {
                id: subscriptionId,
                student_id: studentId,
                contract_schema_version: 1,
                student: { id: studentId, full_name: 'Legacy', email: 'legacy@example.com' },
            },
            cycle: { id: '70000000-0000-4000-8000-000000000007', cycle_number: 2, cycle_kind: 'renewal' },
        };
        const listedOperations = query({ data: [], error: null });
        const incidentsQuery = query({ data: [legacySession], error: null });
        const resolutionsQuery = query({ data: [], error: null });
        const incidentOperationGuard = query({ data: [], error: null });
        const operationQueries = [listedOperations, incidentOperationGuard];
        const adminClient = {
            from: vi.fn((table: string) => {
                if (table === 'checkout_v2_guarantee_operations') return operationQueries.shift();
                if (table === 'sessions') return incidentsQuery;
                if (table === 'checkout_v2_session_incident_resolutions') return resolutionsQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(adminClient as never);

        const { GET } = await import('../../src/pages/api/admin/guarantees');
        const response = await GET(context('/api/admin/guarantees') as never);
        const body = await response.json() as { incidents: unknown[] };

        expect(response.status).toBe(200);
        expect(body.incidents).toEqual([]);
    });

    it('resumes only the server-loaded existing operation after admin authorization', async () => {
        const result = {
            subscriptionId,
            status: 'processing',
            refundAmountCents: 19425,
            currency: 'eur',
            operationId,
            reason: null,
        };
        guaranteeMocks.resumeCheckoutV2GuaranteeOperation.mockResolvedValue(result);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);

        const { POST } = await import('../../src/pages/api/admin/guarantees');
        const requestContext = context('/api/admin/guarantees', { action: 'resume', operationId });
        const response = await POST(requestContext as never);

        expect(response.status).toBe(202);
        expect(guaranteeMocks.resumeCheckoutV2GuaranteeOperation).toHaveBeenCalledWith({
            context: requestContext,
            operationId,
        });
        expect(jobMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(requestContext, 5);
    });

    it('records an incident only through the exact durable RPC with the authenticated admin and required reason', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: { id: 'resolution-1' }, error: null });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue({ rpc } as never);

        const { POST } = await import('../../src/pages/api/admin/guarantees');
        const response = await POST(context('/api/admin/guarantees', {
            action: 'excuse_incident',
            sessionId,
            reason: 'Incidencia justificada y comprobada.',
        }) as never);

        expect(response.status).toBe(200);
        expect(rpc).toHaveBeenCalledWith('excuse_checkout_v2_guarantee_incident', {
            p_session_id: sessionId,
            p_admin_id: adminId,
            p_reason: 'Incidencia justificada y comprobada.',
        });
    });

    it('reconciles an existing refund using only the immutable operation id', async () => {
        const result = {
            subscriptionId,
            status: 'refund_pending',
            refundAmountCents: 19425,
            currency: 'eur',
            operationId,
            reason: null,
        };
        guaranteeMocks.reconcileCheckoutV2GuaranteeRefundOperation.mockResolvedValue(result);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);

        const { POST } = await import('../../src/pages/api/admin/guarantees');
        const requestContext = context('/api/admin/guarantees', {
            action: 'reconcile_refund',
            operationId,
        });
        const response = await POST(requestContext as never);

        expect(response.status).toBe(202);
        expect(guaranteeMocks.reconcileCheckoutV2GuaranteeRefundOperation).toHaveBeenCalledWith({
            context: requestContext,
            operationId,
        });
    });

    it('releases an audited review and resumes only that same operation', async () => {
        const result = {
            subscriptionId,
            status: 'processing',
            refundAmountCents: 19425,
            currency: 'eur',
            operationId,
            reason: null,
        };
        guaranteeMocks.resolveCheckoutV2GuaranteeReview.mockResolvedValue(result);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);

        const { POST } = await import('../../src/pages/api/admin/guarantees');
        const requestContext = context('/api/admin/guarantees', {
            action: 'resolve_review',
            operationId,
            reason: 'Ticket resuelto y decisión documentada.',
        });
        const response = await POST(requestContext as never);

        expect(response.status).toBe(202);
        expect(guaranteeMocks.resolveCheckoutV2GuaranteeReview).toHaveBeenCalledWith({
            context: requestContext,
            operationId,
            adminId,
            reason: 'Ticket resuelto y decisión documentada.',
        });
    });

    it('rejects missing/cross-origin and free-form financial mutations before any write', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        const { POST } = await import('../../src/pages/api/admin/guarantees');

        const crossOrigin = await POST(context('/api/admin/guarantees', {
            action: 'resume',
            operationId,
        }, 'https://evil.example') as never);
        const missingOrigin = await POST(context('/api/admin/guarantees', {
            action: 'resume',
            operationId,
        }, null) as never);
        const freeForm = await POST(context('/api/admin/guarantees', {
            action: 'reconcile_refund',
            operationId,
            amount: 99999,
            stripeRefundId: 're_attacker',
        }) as never);

        expect(crossOrigin.status).toBe(403);
        expect(missingOrigin.status).toBe(403);
        expect(freeForm.status).toBe(400);
        expect(guaranteeMocks.resumeCheckoutV2GuaranteeOperation).not.toHaveBeenCalled();
        expect(guaranteeMocks.reconcileCheckoutV2GuaranteeRefundOperation).not.toHaveBeenCalled();
    });
});
