import { beforeEach, describe, expect, it, vi } from 'vitest';

const stripeMocks = vi.hoisted(() => ({ accountRetrieve: vi.fn() }));
const feeMocks = vi.hoisted(() => ({ reconcileStripePaymentFeesBestEffort: vi.fn() }));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: { accounts: { retrieve: stripeMocks.accountRetrieve } },
}));

vi.mock('../../src/lib/stripe-fee-reconciliation', () => ({
    reconcileStripePaymentFeesBestEffort: feeMocks.reconcileStripePaymentFeesBestEffort,
}));

const ids = {
    request: '70000000-0000-4000-8000-000000000001',
    campaign: '70000000-0000-4000-8000-000000000002',
    student: '70000000-0000-4000-8000-000000000003',
    cost: '70000000-0000-4000-8000-000000000004',
    allocation: '70000000-0000-4000-8000-000000000005',
    attribution: '70000000-0000-4000-8000-000000000006',
    contact: '70000000-0000-4000-8000-000000000007',
    subscription: '70000000-0000-4000-8000-000000000008',
    cycle: '70000000-0000-4000-8000-000000000009',
    payment: '70000000-0000-4000-8000-000000000013',
};

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

function context(body?: unknown, origin = 'http://localhost:4321', query = '') {
    return {
        request: {
            url: `http://localhost:4321/api/admin/profitability${query}`,
            headers: { get: vi.fn((name: string) => name === 'Origin' ? origin : '') },
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

function rpcClient(data: Record<string, unknown> = { original_cost_id: ids.cost, amount_cents: 20000 }) {
    return { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
}

function listAdminClient(options: { economicsStudentId?: string | null; pendingFee?: boolean } = {}) {
    const results: Record<string, unknown[]> = {
        portfolio_unit_economics: [{
            portfolio_key: 'all',
            student_count: 1,
            gross_revenue_cents: 51800,
            refunds_cents: 19425,
            net_revenue_cents: 32375,
            teacher_compensation_cents: 8000,
            direct_operational_cost_cents: 1500,
            campaign_spend_cents: 20000,
            allocated_acquisition_cost_cents: 10000,
            unallocated_acquisition_cost_cents: 10000,
            unreconciled_payment_count: 0,
            stripe_fee_reconciliation_status: 'reconciled',
            stripe_fee_cents: 2100,
            provisional_contribution_cents: 2875,
            currency: 'eur',
        }],
        acquisition_campaign_unit_economics: [[{
            campaign_id: ids.campaign,
            campaign_name: 'English launch',
            provider: 'google_ads',
            attribution_mode: 'observed_utm',
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: 'english_launch',
            utm_term: 'adult-spanish',
            utm_content: 'hero_a',
            acquired_student_count: 1,
            gross_revenue_cents: 51800,
            refunds_cents: 19425,
            net_revenue_cents: 32375,
            teacher_compensation_cents: 8000,
            direct_operational_cost_cents: 0,
            allocated_acquisition_cost_cents: 10000,
            campaign_spend_cents: 20000,
            unallocated_spend_cents: 10000,
            unreconciled_payment_count: 0,
            stripe_fee_reconciliation_status: 'reconciled',
            stripe_fee_cents: 1400,
            provisional_contribution_cents: 4375,
            currency: 'eur',
            created_at: '2026-08-01T10:00:00.000Z',
        }]],
        student_unit_economics: [[{
            student_id: options.economicsStudentId === undefined
                ? ids.student
                : options.economicsStudentId,
            student_full_name: 'Nombre desactualizado',
            student_email: 'old@example.test',
            gross_revenue_cents: 51800,
            refunds_cents: 19425,
            net_revenue_cents: 32375,
            teacher_compensation_cents: 8000,
            direct_operational_cost_cents: 1500,
            acquisition_cost_cents: 10000,
            unreconciled_payment_count: 0,
            stripe_fee_reconciliation_status: 'reconciled',
            stripe_fee_cents: 1400,
            provisional_contribution_cents: 12875,
            active_campaign_id: ids.campaign,
            active_campaign_name: 'English launch',
            acquisition_basis: 'observed_checkout',
            first_cycle_id: ids.cycle,
            first_paid_at: '2026-08-01T10:00:00.000Z',
        }, {
            student_id: '70000000-0000-4000-8000-000000000010',
            first_paid_at: '2026-07-01T10:00:00.000Z',
        }]],
        operational_cost_balances: [[{
            original_cost_id: ids.cost,
            cost_kind: 'acquisition_spend',
            campaign_id: ids.campaign,
            student_id: null,
            original_amount_cents: 20000,
            adjustment_amount_cents: -1000,
            balance_amount_cents: 19000,
            currency: 'eur',
            incurred_at: '2026-08-01T09:00:00.000Z',
            description: 'Publicidad inicial',
        }, { original_cost_id: '70000000-0000-4000-8000-000000000011' }]],
        acquisition_cost_allocation_balances: [[{
            original_allocation_id: ids.allocation,
            campaign_id: ids.campaign,
            student_id: ids.student,
            original_amount_cents: 10000,
            adjustment_amount_cents: -1000,
            balance_amount_cents: 9000,
            basis: 'observed_checkout',
            reason: 'Asignación observada',
            created_at: '2026-08-01T11:00:00.000Z',
        }, {
            original_allocation_id: '70000000-0000-4000-8000-000000000012',
            campaign_id: ids.campaign,
            student_id: ids.student,
        }]],
        acquisition_allocation_candidates: [[{
            student_id: ids.student,
            student_full_name: 'Nombre candidato',
            student_email: 'candidate@example.test',
            contact_id: ids.contact,
            first_subscription_id: ids.subscription,
            first_cycle_id: ids.cycle,
            checkout_attribution_event_id: ids.attribution,
            has_active_allocation: false,
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: 'english_launch',
            utm_term: 'adult-spanish',
            utm_content: 'hero_a',
            first_paid_at: '2026-08-01T10:00:00.000Z',
        }]],
        stripe_payment_fee_status: [options.pendingFee ? [{
            payment_id: ids.payment,
            student_id: ids.student,
            gross_amount_cents: 25900,
            amount_refunded_cents: 0,
            currency: 'eur',
            reconciliation_status: 'pending',
            last_error_code: 'stripe_fee_remote_unavailable',
            last_attempted_at: '2026-08-04T10:00:00.000Z',
        }] : []],
        profiles: [[{
            id: ids.student,
            full_name: 'Ana Actual',
            email: 'ana@example.test',
        }]],
    };
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const client = {
        from: vi.fn((table: string) => {
            const next = results[table]?.shift() ?? [];
            const query: Record<string, unknown> = {};
            for (const method of ['select', 'eq', 'order', 'limit', 'range', 'in', 'ilike']) {
                query[method] = vi.fn((...args: unknown[]) => {
                    calls.push({ table, method, args });
                    return query;
                });
            }
            query.single = vi.fn().mockResolvedValue({ data: next, error: null });
            query.then = (resolve: (value: unknown) => unknown) => resolve({ data: next, error: null });
            return query;
        }),
    };
    return { client, calls };
}

describe('/api/admin/profitability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
        vi.stubEnv('PUBLIC_APP_ENV', 'test');
        vi.stubEnv('STRIPE_EXPECTED_ACCOUNT_ID', '');
        stripeMocks.accountRetrieve.mockResolvedValue({ id: 'acct_test' });
        feeMocks.reconcileStripePaymentFeesBestEffort.mockResolvedValue({
            status: 'reconciled',
            paymentId: ids.payment,
            transactionCount: 1,
        });
    });

    it('rejects unauthenticated and non-admin callers before privileged client creation', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { GET } = await import('../../src/pages/api/admin/profitability');

        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient(null, null) as never);
        expect((await GET(context() as never)).status).toBe(401);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();

        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('student') as never);
        expect((await GET(context() as never)).status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects cross-origin and originless mutations before auth or privileged access', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { POST } = await import('../../src/pages/api/admin/profitability');
        const payload = { action: 'adjust_cost' };

        expect((await POST(context(payload, 'https://example.test') as never)).status).toBe(403);
        expect((await POST(context(payload, '') as never)).status).toBe(403);
        expect(createSupabaseServerClient).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('strictly validates campaign shape and unsupported cost fields before privileged access', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        const { POST } = await import('../../src/pages/api/admin/profitability');

        const invalidCampaign = await POST(context({
            action: 'create_campaign',
            requestId: ids.request,
            name: 'Manual',
            provider: 'manual',
            attributionMode: 'manual',
            externalReference: null,
            utmSource: 'google',
            utmMedium: null,
            utmCampaign: null,
            utmTerm: null,
            utmContent: null,
        }) as never);
        const unsupportedCost = await POST(context({
            action: 'record_cost',
            requestId: ids.request,
            costKind: 'acquisition_spend',
            campaignId: ids.campaign,
            studentId: null,
            amountCents: 20000,
            incurredAt: '2026-08-01T10:00:00.000Z',
            description: 'Publicidad inicial',
            paymentId: ids.cost,
        }) as never);
        const invalidAcquisitionScope = await POST(context({
            action: 'record_cost',
            requestId: ids.request,
            costKind: 'acquisition_spend',
            campaignId: ids.campaign,
            studentId: ids.student,
            amountCents: 20000,
            incurredAt: '2026-08-01T10:00:00.000Z',
            description: 'Publicidad inicial',
        }) as never);
        const invalidDirectScope = await POST(context({
            action: 'record_cost',
            requestId: ids.request,
            costKind: 'student_tool',
            campaignId: null,
            studentId: null,
            amountCents: 1500,
            incurredAt: '2026-08-01T10:00:00.000Z',
            description: 'Herramienta individual',
        }) as never);

        expect(invalidCampaign.status).toBe(400);
        expect(unsupportedCost.status).toBe(400);
        expect(invalidAcquisitionScope.status).toBe(400);
        expect(invalidDirectScope.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('maps campaign and allocation actions to exact RPC arguments and authenticated admin id', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = rpcClient({ campaign_id: ids.campaign, created_at: '2026-08-01T10:00:00.000Z' });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/profitability');

        const campaignResponse = await POST(context({
            action: 'create_campaign',
            requestId: ids.request,
            name: 'English launch',
            provider: 'Google Ads',
            attributionMode: 'observed_utm',
            externalReference: 'campaign-123',
            utmSource: 'google',
            utmMedium: 'cpc',
            utmCampaign: 'english_launch',
            utmTerm: 'adult-spanish',
            utmContent: 'hero_a',
        }) as never);

        expect(campaignResponse.status).toBe(200);
        expect(await campaignResponse.json()).toEqual({
            result: { campaignId: ids.campaign, createdAt: '2026-08-01T10:00:00.000Z' },
        });
        expect(admin.rpc).toHaveBeenLastCalledWith('create_acquisition_campaign', {
            p_request_id: ids.request,
            p_name: 'English launch',
            p_provider: 'Google Ads',
            p_external_reference: 'campaign-123',
            p_utm_source: 'google',
            p_utm_medium: 'cpc',
            p_utm_campaign: 'english_launch',
            p_utm_term: 'adult-spanish',
            p_utm_content: 'hero_a',
            p_admin_id: 'admin-1',
        });

        await POST(context({
            action: 'record_allocation',
            requestId: '70000000-0000-4000-8000-000000000013',
            campaignId: ids.campaign,
            studentId: ids.student,
            checkoutAttributionEventId: ids.attribution,
            basis: 'observed_checkout',
            amountCents: 10000,
            reason: 'Checkout observado y verificado',
        }) as never);

        expect(admin.rpc).toHaveBeenLastCalledWith('record_acquisition_cost_allocation', {
            p_request_id: '70000000-0000-4000-8000-000000000013',
            p_campaign_id: ids.campaign,
            p_student_id: ids.student,
            p_amount_cents: 10000,
            p_basis: 'observed_checkout',
            p_checkout_attribution_event_id: ids.attribution,
            p_admin_id: 'admin-1',
            p_reason: 'Checkout observado y verificado',
        });
    });

    it('maps cost recording and both append-only adjustments without accepting an actor from the client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = rpcClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/profitability');

        await POST(context({
            action: 'record_cost',
            requestId: ids.request,
            costKind: 'acquisition_spend',
            campaignId: ids.campaign,
            studentId: null,
            amountCents: 20000,
            incurredAt: '2026-08-01T10:00:00.000Z',
            description: 'Publicidad inicial',
        }) as never);
        expect(admin.rpc).toHaveBeenLastCalledWith('record_operational_cost', {
            p_request_id: ids.request,
            p_cost_kind: 'acquisition_spend',
            p_campaign_id: ids.campaign,
            p_student_id: null,
            p_amount_cents: 20000,
            p_incurred_at: '2026-08-01T10:00:00.000Z',
            p_admin_id: 'admin-1',
            p_description: 'Publicidad inicial',
        });

        await POST(context({
            action: 'adjust_cost',
            requestId: '70000000-0000-4000-8000-000000000014',
            costEntryId: ids.cost,
            amountDeltaCents: -1000,
            reason: 'Crédito del proveedor',
        }) as never);
        expect(admin.rpc).toHaveBeenLastCalledWith('adjust_operational_cost', {
            p_request_id: '70000000-0000-4000-8000-000000000014',
            p_original_cost_id: ids.cost,
            p_amount_delta_cents: -1000,
            p_admin_id: 'admin-1',
            p_reason: 'Crédito del proveedor',
        });

        await POST(context({
            action: 'adjust_allocation',
            requestId: '70000000-0000-4000-8000-000000000015',
            allocationEntryId: ids.allocation,
            amountDeltaCents: 500,
            reason: 'Corrección de asignación',
        }) as never);
        expect(admin.rpc).toHaveBeenLastCalledWith('adjust_acquisition_cost_allocation', {
            p_request_id: '70000000-0000-4000-8000-000000000015',
            p_original_allocation_id: ids.allocation,
            p_amount_delta_cents: 500,
            p_admin_id: 'admin-1',
            p_reason: 'Corrección de asignación',
        });
    });

    it('retries a pending Checkout V2 Stripe fee only after verifying the runtime account', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        const paymentQuery: any = {};
        paymentQuery.select = vi.fn(() => paymentQuery);
        paymentQuery.eq = vi.fn(() => paymentQuery);
        paymentQuery.maybeSingle = vi.fn().mockResolvedValue({
            data: {
                id: ids.payment,
                amount: 25900,
                amount_refunded: 0,
                currency: 'eur',
                status: 'succeeded',
                stripe_payment_intent_id: 'pi_fee_admin',
                checkout_v2_cycle_id: ids.cycle,
            },
            error: null,
        });
        const admin = { from: vi.fn(() => paymentQuery), rpc: vi.fn() };
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/profitability');

        const response = await POST(context({
            action: 'reconcile_stripe_fee',
            requestId: ids.request,
            paymentId: ids.payment,
        }) as never);

        expect(response.status).toBe(200);
        expect(stripeMocks.accountRetrieve).toHaveBeenCalledOnce();
        expect(feeMocks.reconcileStripePaymentFeesBestEffort).toHaveBeenCalledWith({
            supabaseAdmin: admin,
            runtime: { accountId: 'acct_test', appEnvironment: 'test', livemode: false },
            payment: {
                id: ids.payment,
                amount: 25900,
                amount_refunded: 0,
                currency: 'eur',
                status: 'succeeded',
                stripe_payment_intent_id: 'pi_fee_admin',
            },
        });

        feeMocks.reconcileStripePaymentFeesBestEffort.mockResolvedValueOnce({
            status: 'pending',
            paymentId: ids.payment,
            code: 'stripe_fee_remote_unavailable',
        });
        const pendingResponse = await POST(context({
            action: 'reconcile_stripe_fee',
            requestId: ids.request,
            paymentId: ids.payment,
        }) as never);
        expect(pendingResponse.status).toBe(503);
        expect(await pendingResponse.json()).toEqual({
            error: 'Stripe todavía no permite conciliar este cobro',
        });
    });

    it('maps all ledgers, portfolio totals, live profile labels and pagination', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { client, calls } = listAdminClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
        const { GET } = await import('../../src/pages/api/admin/profitability');

        const response = await GET(context(undefined, 'http://localhost:4321', '?page=0&limit=1&candidateQuery=Ana') as never);
        const body = await response.json() as {
            summary: Record<string, number | string | null>;
            campaigns: Array<Record<string, unknown>>;
            students: Array<Record<string, unknown>>;
            costs: Array<Record<string, unknown>>;
            allocations: Array<Record<string, unknown>>;
            candidates: Array<Record<string, unknown>>;
            feeReconciliations: Array<Record<string, unknown>>;
            pagination: Record<string, unknown>;
        };

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(body.summary).toEqual({
            totalGrossCollectedCents: 51800,
            totalRefundsCents: 19425,
            totalNetRevenueCents: 32375,
            totalTeacherObligationCents: 8000,
            totalDirectCostCents: 1500,
            totalAcquisitionAllocatedCents: 10000,
            totalStripeFeeCents: 2100,
            stripeFeeReconciliationStatus: 'reconciled',
            unreconciledPaymentCount: 0,
            totalProvisionalContributionCents: 2875,
            totalCampaignSpendCents: 20000,
            totalUnallocatedCampaignSpendCents: 10000,
        });
        expect(body.campaigns[0]).toMatchObject({
            id: ids.campaign,
            attributionMode: 'observed_utm',
            utmTerm: 'adult-spanish',
            utmContent: 'hero_a',
            netSpendCents: 20000,
            unallocatedAcquisitionCents: 10000,
            stripeFeeCents: 1400,
            stripeFeeReconciliationStatus: 'reconciled',
        });
        expect(body.students).toEqual([expect.objectContaining({
            studentId: ids.student,
            studentName: 'Ana Actual',
            studentEmail: 'ana@example.test',
            campaignName: 'English launch',
            firstCycleId: ids.cycle,
            stripeFeeCents: 1400,
            stripeFeeReconciliationStatus: 'reconciled',
        })]);
        expect(body.costs).toEqual([expect.objectContaining({
            entryId: ids.cost,
            originalAmountCents: 20000,
            netAmountCents: 19000,
        })]);
        expect(body.allocations).toEqual([expect.objectContaining({
            entryId: ids.allocation,
            studentName: 'Ana Actual',
            netAmountCents: 9000,
        })]);
        expect(body.candidates).toEqual([expect.objectContaining({
            studentName: 'Ana Actual',
            attributionEventId: ids.attribution,
            hasActiveAllocation: false,
            utmTerm: 'adult-spanish',
            utmContent: 'hero_a',
        })]);
        expect(body.feeReconciliations).toEqual([]);
        expect(body.pagination).toEqual({
            page: 0,
            limit: 1,
            studentsHasMore: true,
            costsHasMore: true,
            allocationsHasMore: true,
        });
        expect(calls).toContainEqual({
            table: 'acquisition_allocation_candidates',
            method: 'ilike',
            args: ['student_full_name', '%Ana%'],
        });
    });

    it('lists pending fee reconciliation without exposing Stripe payment identifiers', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { client } = listAdminClient({ pendingFee: true });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
        const { GET } = await import('../../src/pages/api/admin/profitability');

        const response = await GET(context() as never);
        const body = await response.json() as { feeReconciliations: Array<Record<string, unknown>> };

        expect(response.status).toBe(200);
        expect(body.feeReconciliations).toEqual([{
            paymentId: ids.payment,
            studentId: ids.student,
            studentName: 'Ana Actual',
            studentEmail: 'ana@example.test',
            grossAmountCents: 25900,
            amountRefundedCents: 0,
            currency: 'eur',
            status: 'pending',
            lastErrorCode: 'stripe_fee_remote_unavailable',
            lastAttemptedAt: '2026-08-04T10:00:00.000Z',
        }]);
        expect(JSON.stringify(body.feeReconciliations)).not.toContain('pi_');
    });

    it('maps database conflicts without exposing database details', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const admin = {
            rpc: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '23505', message: 'sensitive acquisition allocation detail' },
            }),
        };
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
        const { POST } = await import('../../src/pages/api/admin/profitability');

        const response = await POST(context({
            action: 'adjust_allocation',
            requestId: ids.request,
            allocationEntryId: ids.allocation,
            amountDeltaCents: -1000,
            reason: 'Corrección del importe asignado',
        }) as never);
        const body = await response.json() as { error: string };

        expect(response.status).toBe(409);
        expect(body.error).toBe('La operación entra en conflicto con el estado registrado');
        expect(body.error).not.toContain('sensitive');
    });

    it('fails closed instead of hiding a financial row without its required identity', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { client } = listAdminClient({ economicsStudentId: null });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as never);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { GET } = await import('../../src/pages/api/admin/profitability');

        const response = await GET(context() as never);

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: 'No se pudo cargar la rentabilidad operativa' });
        expect(consoleError).toHaveBeenCalledWith(
            '[Profitability] A unit-economics view returned a row without its required identity',
        );
    });
});
