import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    sendLevelCheckInviteEmail: vi.fn(),
    sendMissingInfoEmail: vi.fn(),
    sendProposalNextStepEmail: vi.fn(),
    getSiteUrl: vi.fn(() => 'https://staging.espanolhonesto.com'),
    signLeadEmailToken: vi.fn(),
    loadLeadCaptureForCrm: vi.fn(),
    syncLeadCaptureToCrmSafe: vi.fn(),
    recordLeadEmailOutInCrmSafe: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/email', () => ({
    sendLevelCheckInviteEmail: mocks.sendLevelCheckInviteEmail,
    sendMissingInfoEmail: mocks.sendMissingInfoEmail,
    sendProposalNextStepEmail: mocks.sendProposalNextStepEmail,
}));

vi.mock('../../src/lib/site-url', () => ({
    getSiteUrl: mocks.getSiteUrl,
}));

vi.mock('../../src/lib/lead-email-token', () => ({
    signLeadEmailToken: mocks.signLeadEmailToken,
}));

vi.mock('../../src/lib/crm/lead-capture', () => ({
    loadLeadCaptureForCrm: mocks.loadLeadCaptureForCrm,
    syncLeadCaptureToCrmSafe: mocks.syncLeadCaptureToCrmSafe,
    recordLeadEmailOutInCrmSafe: mocks.recordLeadEmailOutInCrmSafe,
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

function createAwaitableQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    return chain;
}

function createSingleQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function createMaybeSingleQuery(result: { data: unknown; error: unknown }) {
    const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return chain;
}

function createAdminClientForList(
    leads: unknown[] = [],
    opportunities: unknown[] | null = null,
    summaryLeads: unknown[] = leads,
    summaryOpportunities: unknown[] | null = opportunities,
    checkoutPackages: unknown[] = [],
) {
    const leadsQuery = createAwaitableQuery({ data: leads, error: null });
    const summaryLeadsQuery = createAwaitableQuery({ data: summaryLeads, error: null });
    const opportunitiesQuery = opportunities
        ? createAwaitableQuery({ data: opportunities, error: null })
        : createAwaitableQuery({
            data: null,
            error: { code: '42P01', message: 'relation "crm_opportunities" does not exist' },
        });
    const summaryOpportunitiesQuery = summaryOpportunities
        ? createAwaitableQuery({ data: summaryOpportunities, error: null })
        : createAwaitableQuery({
            data: null,
            error: { code: '42P01', message: 'relation "crm_opportunities" does not exist' },
        });
    const checkoutPackagesQuery = createAwaitableQuery({ data: checkoutPackages, error: null });
    const leadQueries = [leadsQuery, summaryLeadsQuery];
    const opportunityQueries = [opportunitiesQuery, summaryOpportunitiesQuery];
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'leads') return leadQueries.shift();
            if (table === 'crm_opportunities') return opportunityQueries.shift();
            if (table === 'packages') return checkoutPackagesQuery;
            throw new Error(`Unexpected table ${table}`);
        }),
    };
    return { client, leadsQuery, opportunitiesQuery, summaryLeadsQuery, summaryOpportunitiesQuery, checkoutPackagesQuery };
}

function createAdminClientForUpdate(before: Record<string, unknown>, after: Record<string, unknown>) {
    const beforeQuery = createSingleQuery({ data: before, error: null });
    const updateQuery = createSingleQuery({ data: after, error: null });
    const missingCrmQuery = createMaybeSingleQuery({
        data: null,
        error: { code: '42P01', message: 'relation "crm_opportunities" does not exist' },
    });
    const taskUpdate: any = {
        error: null,
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
    };
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const leadQueries = [beforeQuery, updateQuery];
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'leads') return leadQueries.shift();
            if (table === 'crm_opportunities') return missingCrmQuery;
            if (table === 'crm_tasks') return taskUpdate;
            if (table === 'admin_audit_log') return { insert: auditInsert };
            throw new Error(`Unexpected table ${table}`);
        }),
    };
    return { client, beforeQuery, updateQuery, auditInsert, missingCrmQuery, taskUpdate };
}

function getContext(path = '/api/admin/leads?status=new&limit=25') {
    return {
        request: {
            url: `http://localhost:4321${path}`,
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function postContext(body: Record<string, unknown>) {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/leads',
            json: vi.fn().mockResolvedValue(body),
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

async function readJson(response: Response) {
    return response.json() as Promise<Record<string, unknown>>;
}

function expectedDiagnosticUrl(leadId: string) {
    return `https://staging.espanolhonesto.com/en/diagnostico?email=student%40example.com&leadId=${leadId}&token=signed-level-token`;
}

function checkoutReadyPackage(id: string, name = 'standard') {
    const productId = `prod_${name}`;
    return {
        id,
        name,
        display_name: { es: 'Estandar' },
        catalog_version: 1,
        price_monthly: 10000,
        sessions_per_month: 4,
        has_group_session: false,
        has_dual_teacher: false,
        is_active: true,
        stripe_product_id: productId,
        stripe_price_1m: `price_${name}_1m`,
        stripe_price_3m: `price_${name}_3m`,
        stripe_price_6m: `price_${name}_6m`,
        package_prices: ([1, 3, 6] as const).map((duration) => ({
            catalog_version: 1,
            package_key: name,
            duration_months: duration,
            amount_cents: duration === 1 ? 10000 : duration === 3 ? 27000 : 48000,
            currency: 'eur',
            sessions_per_month: 4,
            sessions_per_period: 4 * duration,
            has_group_session: false,
            has_dual_teacher: false,
            status: 'active',
            stripe_account_id: 'acct_staging',
            stripe_livemode: false,
            stripe_price_id: `price_${name}_${duration}m`,
            stripe_product_id: productId,
        })),
    };
}

describe('/api/admin/leads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.sendLevelCheckInviteEmail.mockResolvedValue(true);
        mocks.sendMissingInfoEmail.mockResolvedValue(true);
        mocks.sendProposalNextStepEmail.mockResolvedValue(true);
        mocks.getSiteUrl.mockReturnValue('https://staging.espanolhonesto.com');
        mocks.signLeadEmailToken.mockResolvedValue('signed-level-token');
        mocks.loadLeadCaptureForCrm.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000005',
            email: 'student@example.com',
            name: 'Student',
            interest: 'general',
            current_level: 'b1',
            learning_goal: null,
            availability: null,
            preferred_package: null,
            source_path: '/en',
            lang: 'en',
            spoken_languages: ['ru'],
            is_russian_speaker: true,
            consent_given: true,
            status: 'new',
            created_at: '2026-06-26T08:00:00.000Z',
            updated_at: '2026-06-26T08:00:00.000Z',
            crm_contact_id: null,
            crm_opportunity_id: null,
        });
        mocks.syncLeadCaptureToCrmSafe.mockResolvedValue({
            status: 'synced',
            contactId: '10000000-0000-4000-8000-000000000005',
            opportunityId: '20000000-0000-4000-8000-000000000005',
            taskId: '30000000-0000-4000-8000-000000000005',
        });
        mocks.recordLeadEmailOutInCrmSafe.mockResolvedValue({ status: 'created', activityId: 'activity-1' });
    });

    it('rejects non-admin users before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('student') as any);

        const { GET } = await import('../../src/pages/api/admin/leads');
        const response = await GET(getContext() as any);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('lets admins list lead applications with status filter and limit cap', async () => {
        const lead = { id: 'lead-1', status: 'new', email: 'student@example.com' };
        const checkoutPackage = checkoutReadyPackage('70000000-0000-4000-8000-000000000010');
        const { client, leadsQuery, checkoutPackagesQuery } = createAdminClientForList(
            [lead],
            null,
            [lead],
            null,
            [checkoutPackage],
        );
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/leads');
        const response = await GET(getContext('/api/admin/leads?status=new&limit=999') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.leads).toEqual([{ ...lead, crm_opportunity: null }]);
        expect(body.checkoutPackages).toEqual([{
            id: checkoutPackage.id,
            name: checkoutPackage.name,
            display_name: checkoutPackage.display_name,
        }]);
        expect(leadsQuery.eq).toHaveBeenCalledWith('status', 'new');
        expect(leadsQuery.limit).toHaveBeenCalledWith(100);
        expect(checkoutPackagesQuery.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('does not offer checkout approval for a package split across Stripe accounts', async () => {
        const mixedAccountPackage = checkoutReadyPackage('70000000-0000-4000-8000-000000000011');
        mixedAccountPackage.package_prices[2].stripe_account_id = 'acct_other';
        const { client } = createAdminClientForList([], null, [], null, [mixedAccountPackage]);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/leads');
        const response = await GET(getContext('/api/admin/leads') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.checkoutPackages).toEqual([]);
    });

    it('enriches listed leads with CRM opportunity pipeline data when available', async () => {
        const lead = { id: 'lead-1', status: 'new', email: 'student@example.com' };
        const opportunity = {
            id: 'opportunity-1',
            legacy_lead_id: 'lead-1',
            stage: 'qualified',
            contact_id: 'contact-1',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            packages: null,
            crm_contacts: {
                id: 'contact-1',
                lifecycle_stage: 'qualified',
                next_follow_up_at: '2026-06-25T10:00:00.000Z',
                last_contacted_at: '2026-06-24T10:00:00.000Z',
            },
        };
        const { client, opportunitiesQuery } = createAdminClientForList([lead], [opportunity]);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/leads');
        const response = await GET(getContext('/api/admin/leads?status=all&limit=25') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.leads).toEqual([{ ...lead, crm_opportunity: opportunity }]);
        expect(opportunitiesQuery.in).toHaveBeenCalledWith('legacy_lead_id', ['lead-1']);
    });

    it('returns global lead conversion summary independent from the visible status filter', async () => {
        const visibleLead = {
            id: 'lead-visible',
            status: 'new',
            email: 'visible@example.com',
            interest: 'general',
            current_level: 'a2',
            preferred_package: 'starter',
            source_path: '/es',
            created_at: '2026-06-24T08:00:00.000Z',
        };
        const summaryLead = {
            id: 'lead-summary',
            status: 'contacted',
            email: 'summary@example.com',
            interest: 'company',
            current_level: 'b2',
            preferred_package: 'intensive',
            source_path: '/es/espanol-para-profesionales',
            created_at: '2026-06-23T08:00:00.000Z',
        };
        const visibleOpportunity = {
            id: 'opportunity-visible',
            legacy_lead_id: 'lead-visible',
            stage: 'new',
            contact_id: 'contact-visible',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'a2',
            learning_goal: null,
            availability: null,
            packages: null,
            crm_contacts: null,
        };
        const summaryOpportunity = {
            legacy_lead_id: 'lead-summary',
            stage: 'won',
        };
        const { client, summaryLeadsQuery, summaryOpportunitiesQuery } = createAdminClientForList(
            [visibleLead],
            [visibleOpportunity],
            [visibleLead, summaryLead],
            [visibleOpportunity, summaryOpportunity]
        );
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/leads');
        const response = await GET(getContext('/api/admin/leads?status=new&limit=25') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.leads).toEqual([{ ...visibleLead, crm_opportunity: visibleOpportunity }]);
        expect(body.summary).toMatchObject({
            totalLeads: 2,
            contactedLeads: 1,
            discardedLeads: 0,
            qualifiedLeadCount: 1,
            activePipelineCount: 1,
            wonOpportunities: 1,
            lostOpportunities: 0,
            contactedRate: 50,
            wonRate: 50,
        });
        expect(body.summary).toMatchObject({
            topSourcePaths: expect.arrayContaining([
                { label: '/es', count: 1 },
                { label: '/es/espanol-para-profesionales', count: 1 },
            ]),
            pipelineStageSummary: expect.arrayContaining([
                { label: 'new', count: 1 },
                { label: 'won', count: 1 },
            ]),
            sourcePerformance: expect.arrayContaining([
                expect.objectContaining({
                    sourcePath: '/es/espanol-para-profesionales',
                    total: 1,
                    contacted: 1,
                    qualified: 1,
                    won: 1,
                }),
            ]),
        });
        expect(summaryLeadsQuery.limit).toHaveBeenCalledWith(500);
        expect(summaryOpportunitiesQuery.in).toHaveBeenCalledWith('legacy_lead_id', ['lead-visible', 'lead-summary']);
    });

    it('keeps the admin lead list available when optional summary columns are not migrated yet', async () => {
        const lead = { id: 'lead-1', status: 'new', email: 'student@example.com' };
        const fallbackSummaryLead = {
            id: 'lead-summary',
            status: 'new',
            created_at: '2026-06-24T08:00:00.000Z',
        };
        const visibleLeadsQuery = createAwaitableQuery({ data: [lead], error: null });
        const missingOptionalSummaryColumnQuery = createAwaitableQuery({
            data: null,
            error: {
                code: '42703',
                message: 'column leads.source_path does not exist',
            },
        });
        const fallbackSummaryQuery = createAwaitableQuery({ data: [fallbackSummaryLead], error: null });
        const opportunitiesQuery = createAwaitableQuery({
            data: null,
            error: { code: '42P01', message: 'relation "crm_opportunities" does not exist' },
        });
        const summaryOpportunitiesQuery = createAwaitableQuery({
            data: null,
            error: { code: '42P01', message: 'relation "crm_opportunities" does not exist' },
        });
        const checkoutPackagesQuery = createAwaitableQuery({ data: [], error: null });
        const leadQueries = [visibleLeadsQuery, missingOptionalSummaryColumnQuery, fallbackSummaryQuery];
        const opportunityQueries = [opportunitiesQuery, summaryOpportunitiesQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return leadQueries.shift();
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'packages') return checkoutPackagesQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/leads');
        const response = await GET(getContext('/api/admin/leads?status=all&limit=25') as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.leads).toEqual([{ ...lead, crm_opportunity: null }]);
        expect(body.summary).toMatchObject({
            totalLeads: 1,
            topSourcePaths: [{ label: 'Sin ruta', count: 1 }],
            topInterests: [{ label: 'Sin interes', count: 1 }],
            topPreferredPackages: [{ label: 'Sin plan', count: 1 }],
            levelSummary: [{ label: 'Sin nivel', count: 1 }],
        });
        expect(client.from).toHaveBeenCalledWith('leads');
    });

    it('updates lead status and writes an admin audit log', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000002',
            status: 'new',
            email: 'student@example.com',
        };
        const after = {
            ...before,
            status: 'discarded',
        };
        const { client, updateQuery, auditInsert, taskUpdate } = createAdminClientForUpdate(before, after);
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/leads');
        const response = await POST(postContext({
            leadId: before.id,
            newStatus: 'discarded',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.lead).toEqual(after);
        expect(updateQuery.update).toHaveBeenCalledWith({
            status: 'discarded',
            level_check_context: {},
            level_check_raw_cleared_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead', 'level_check', 'lead_sales_follow_up']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'lead.update',
            entity_type: 'lead',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('sends a lightweight level check invite from admin and records CRM email trace', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000005',
            status: 'new',
            email: 'student@example.com',
            name: 'Student',
            lang: 'en',
            level_check_status: 'not_requested',
        };
        const after = {
            ...before,
            level_check_status: 'sent',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const preflightQuery = createSingleQuery({ data: { level_check_status: 'not_requested' }, error: null });
        const updateQuery = createSingleQuery({ data: after, error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const leadQueries = [beforeQuery, preflightQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return leadQueries.shift();
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'send_level_check',
            leadId: before.id,
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            lead: after,
            diagnosticUrl: expectedDiagnosticUrl(before.id),
            emailSent: true,
        });
        expect(mocks.signLeadEmailToken).toHaveBeenCalledWith({
            leadId: before.id,
            email: 'student@example.com',
        });
        expect(mocks.getSiteUrl).toHaveBeenCalledWith('http://localhost:4321');
        expect(mocks.sendLevelCheckInviteEmail).toHaveBeenCalledWith('student@example.com', {
            recipientName: 'Student',
            diagnosticUrl: expectedDiagnosticUrl(before.id),
        });
        expect(updateQuery.update).toHaveBeenCalledWith({
            level_check_status: 'sent',
            updated_at: expect.any(String),
        });
        expect(mocks.loadLeadCaptureForCrm).toHaveBeenCalledWith(expect.anything(), 'student@example.com');
        expect(mocks.syncLeadCaptureToCrmSafe).toHaveBeenCalled();
        expect(mocks.recordLeadEmailOutInCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            contactId: '10000000-0000-4000-8000-000000000005',
            opportunityId: '20000000-0000-4000-8000-000000000005',
            subject: 'Optional Spanish context - Espanol Honesto',
            template: 'level_check_invite',
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'lead.level_check.send',
            entity_type: 'lead',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('marks a received level check as reviewed, clears raw context and closes review work', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000015',
            status: 'contacted',
            email: 'student@example.com',
            crm_contact_id: '10000000-0000-4000-8000-000000000015',
            crm_opportunity_id: '20000000-0000-4000-8000-000000000015',
            level_check_status: 'received',
            level_check_context: { written_sample: 'temporary raw writing sample' },
            level_check_summary: 'B1 plateau candidate, culture context signal.',
            level_check_raw_cleared_at: null,
            level_check_reviewed_at: null,
        };
        const after = {
            ...before,
            level_check_status: 'reviewed',
            level_check_context: {},
            level_check_raw_cleared_at: '2026-06-26T09:30:00.000Z',
            level_check_reviewed_at: '2026-06-26T09:30:00.000Z',
            updated_at: '2026-06-26T09:30:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createSingleQuery({ data: after, error: null });
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const leadQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return leadQueries.shift();
                if (table === 'crm_tasks') return taskUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'review_level_check',
            leadId: before.id,
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.lead).toEqual(after);
        expect(updateQuery.update).toHaveBeenCalledWith({
            level_check_status: 'reviewed',
            level_check_context: {},
            level_check_raw_cleared_at: expect.any(String),
            level_check_reviewed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_type', 'level_check');
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.crm_contact_id,
            opportunity_id: before.crm_opportunity_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Lightweight level check reviewed',
            body: before.level_check_summary,
            related_entity_type: 'level_check',
            related_entity_id: before.id,
            metadata: expect.objectContaining({
                action: 'review_level_check',
                raw_context_cleared: true,
                level_check_status: 'reviewed',
            }),
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'lead.level_check.review',
            entity_type: 'lead',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('sends a manual proposal follow-up and moves the CRM opportunity to proposal', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000006',
            status: 'new',
            email: 'student@example.com',
            name: 'Student',
            lang: 'en',
            preferred_package: 'hybrid',
            level_check_plan_recommendation: 'Hybrid plan with focused conversation practice.',
        };
        const after = {
            ...before,
            status: 'contacted',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createSingleQuery({ data: after, error: null });
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const opportunityUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const consentLookup = createMaybeSingleQuery({
            data: {
                id: '40000000-0000-4000-8000-000000000006',
                legal_basis: 'consent',
                opted_out_at: null,
                captured_at: '2026-06-25T10:00:00.000Z',
                created_at: '2026-06-25T10:00:00.000Z',
            },
            error: null,
        });
        const taskLookup = createMaybeSingleQuery({ data: null, error: null });
        const taskInsert = {
            insert: vi.fn().mockResolvedValue({ error: null }),
        };
        const taskQueries = [taskLookup, taskInsert];
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const leadQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return leadQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'crm_opportunities') return opportunityUpdate;
                if (table === 'crm_consents') return consentLookup;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'send_sales_email',
            leadId: before.id,
            template: 'proposal_next_step',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            lead: after,
            template: 'proposal_next_step',
            emailSent: true,
        });
        expect(mocks.sendProposalNextStepEmail).toHaveBeenCalledWith('student@example.com', {
            recipientName: 'Student',
            planRecommendation: 'Hybrid plan with focused conversation practice.',
        });
        expect(updateQuery.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(mocks.loadLeadCaptureForCrm).toHaveBeenCalledWith(expect.anything(), 'student@example.com');
        expect(mocks.syncLeadCaptureToCrmSafe).toHaveBeenCalled();
        expect(mocks.recordLeadEmailOutInCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            contactId: '10000000-0000-4000-8000-000000000005',
            opportunityId: '20000000-0000-4000-8000-000000000005',
            subject: 'How direct booking will work - Espanol Honesto',
            template: 'proposal_next_step',
        }));
        expect(consentLookup.eq).toHaveBeenCalledWith('contact_id', '10000000-0000-4000-8000-000000000005');
        expect(consentLookup.eq).toHaveBeenCalledWith('purpose', 'sales_follow_up');
        expect(contactUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
            lifecycle_stage: 'qualified',
            last_contacted_at: expect.any(String),
            next_follow_up_at: expect.any(String),
        }));
        expect(contactUpdate.eq).toHaveBeenCalledWith('id', '10000000-0000-4000-8000-000000000005');
        expect(opportunityUpdate.update).toHaveBeenCalledWith({
            stage: 'proposal',
            closed_at: null,
            updated_at: expect.any(String),
        });
        expect(opportunityUpdate.eq).toHaveBeenCalledWith('id', '20000000-0000-4000-8000-000000000005');
        expect(taskLookup.eq).toHaveBeenCalledWith('contact_id', '10000000-0000-4000-8000-000000000005');
        expect(taskLookup.eq).toHaveBeenCalledWith('task_type', 'email');
        expect(taskLookup.eq).toHaveBeenCalledWith('related_entity_type', 'lead_sales_follow_up');
        expect(taskLookup.eq).toHaveBeenCalledWith('related_entity_id', before.id);
        expect(taskLookup.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: '10000000-0000-4000-8000-000000000005',
            opportunity_id: '20000000-0000-4000-8000-000000000005',
            assigned_to: 'admin-1',
            title: 'Follow up after proposal email',
            task_type: 'email',
            priority: 'high',
            due_at: expect.any(String),
            related_entity_type: 'lead_sales_follow_up',
            related_entity_id: before.id,
            metadata: expect.objectContaining({
                action: 'sales_email_follow_up',
                template: 'proposal_next_step',
                follow_up_hours: 24,
                lead_id: before.id,
            }),
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'lead.sales_email.proposal_next_step.send',
            entity_type: 'lead',
            entity_id: before.id,
            before,
            after,
        }));
    });

    it('refreshes an existing missing-info follow-up task without duplicating CRM work', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000026',
            status: 'contacted',
            email: 'student@example.com',
            name: 'Student',
            lang: 'en',
            preferred_package: 'individual',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const opportunityUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const consentLookup = createMaybeSingleQuery({
            data: {
                id: '40000000-0000-4000-8000-000000000026',
                legal_basis: 'consent',
                opted_out_at: null,
                captured_at: '2026-06-25T10:00:00.000Z',
                created_at: '2026-06-25T10:00:00.000Z',
            },
            error: null,
        });
        const taskLookup = createMaybeSingleQuery({
            data: { id: '30000000-0000-4000-8000-000000000026' },
            error: null,
        });
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskQueries = [taskLookup, taskUpdate];
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return beforeQuery;
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'crm_opportunities') return opportunityUpdate;
                if (table === 'crm_consents') return consentLookup;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'send_sales_email',
            leadId: before.id,
            template: 'missing_info',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body).toMatchObject({
            lead: before,
            template: 'missing_info',
            emailSent: true,
        });
        expect(mocks.sendMissingInfoEmail).toHaveBeenCalledWith('student@example.com', {
            recipientName: 'Student',
            diagnosticUrl: expectedDiagnosticUrl(before.id),
        });
        expect(mocks.recordLeadEmailOutInCrmSafe).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            contactId: '10000000-0000-4000-8000-000000000005',
            opportunityId: '20000000-0000-4000-8000-000000000005',
            subject: 'Optional context for your classes - Espanol Honesto',
            template: 'missing_info',
        }));
        expect(opportunityUpdate.update).toHaveBeenCalledWith({
            stage: 'contacted',
            closed_at: null,
            checkout_approved_at: null,
            updated_at: expect.any(String),
        });
        expect(taskLookup.eq).toHaveBeenCalledWith('related_entity_type', 'lead_sales_follow_up');
        expect(taskLookup.eq).toHaveBeenCalledWith('related_entity_id', before.id);
        expect(taskLookup.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
            assigned_to: 'admin-1',
            status: 'open',
            due_at: expect.any(String),
            updated_at: expect.any(String),
            metadata: expect.objectContaining({
                action: 'sales_email_follow_up',
                template: 'missing_info',
                follow_up_hours: 24,
                lead_id: before.id,
            }),
        }));
        expect(taskUpdate.eq).toHaveBeenCalledWith('id', '30000000-0000-4000-8000-000000000026');
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'lead.sales_email.missing_info.send',
            entity_type: 'lead',
            entity_id: before.id,
            before,
            after: before,
        }));
    });

    it('blocks manual sales follow-up when the CRM contact has opted out', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000016',
            status: 'contacted',
            email: 'student@example.com',
            name: 'Student',
            lang: 'en',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const consentLookup = createMaybeSingleQuery({
            data: {
                id: '40000000-0000-4000-8000-000000000016',
                legal_basis: 'consent',
                opted_out_at: '2026-06-25T12:00:00.000Z',
                captured_at: '2026-06-25T10:00:00.000Z',
                created_at: '2026-06-25T10:00:00.000Z',
            },
            error: null,
        });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return beforeQuery;
                if (table === 'crm_consents') return consentLookup;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'send_sales_email',
            leadId: before.id,
            template: 'proposal_next_step',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(409);
        expect(body).toMatchObject({
            error: 'Contact is opted out for sales follow-up by email',
            reason: 'consent_opted_out',
            channel: 'email',
            purpose: 'sales_follow_up',
        });
        expect(mocks.loadLeadCaptureForCrm).toHaveBeenCalledWith(expect.anything(), 'student@example.com');
        expect(mocks.syncLeadCaptureToCrmSafe).toHaveBeenCalled();
        expect(mocks.sendProposalNextStepEmail).not.toHaveBeenCalled();
        expect(mocks.sendMissingInfoEmail).not.toHaveBeenCalled();
        expect(mocks.recordLeadEmailOutInCrmSafe).not.toHaveBeenCalled();
    });

    it('syncs changed lead status into the CRM pipeline and timeline when CRM tables exist', async () => {
        const before = {
            id: '00000000-0000-4000-8000-000000000003',
            status: 'new',
            email: 'student@example.com',
            crm_contact_id: '10000000-0000-4000-8000-000000000001',
            crm_opportunity_id: '20000000-0000-4000-8000-000000000001',
        };
        const after = {
            ...before,
            status: 'contacted',
        };
        const beforeQuery = createSingleQuery({ data: before, error: null });
        const updateQuery = createSingleQuery({ data: after, error: null });
        const opportunityUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const leadQueries = [beforeQuery, updateQuery];
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'leads') return leadQueries.shift();
                if (table === 'crm_opportunities') return opportunityUpdate;
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'crm_tasks') return taskUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/leads');
        const response = await POST(postContext({
            leadId: before.id,
            newStatus: 'contacted',
        }) as any);

        expect(response.status).toBe(200);
        expect(opportunityUpdate.update).toHaveBeenCalledWith({
            stage: 'contacted',
            closed_at: null,
            checkout_approved_at: null,
            updated_at: expect.any(String),
        });
        expect(opportunityUpdate.eq).toHaveBeenCalledWith('id', before.crm_opportunity_id);
        expect(contactUpdate.update).toHaveBeenCalledWith({
            lifecycle_stage: 'qualified',
            last_contacted_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(contactUpdate.eq).toHaveBeenCalledWith('id', before.crm_contact_id);
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', before.id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: before.crm_contact_id,
            opportunity_id: before.crm_opportunity_id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Lead marcado como contactado',
            related_entity_type: 'lead',
            related_entity_id: before.id,
            metadata: {
                previous_status: 'new',
                new_status: 'contacted',
            },
        }));
    });

    it('updates CRM opportunity stage, syncs legacy lead status and writes timeline activity', async () => {
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000002',
            contact_id: '10000000-0000-4000-8000-000000000002',
            legacy_lead_id: '00000000-0000-4000-8000-000000000004',
            stage: 'new',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            stage: 'proposal',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            packages: null,
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'opportunity_stage',
            opportunityId: opportunityBefore.id,
            newStage: 'proposal',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.opportunity).toEqual(opportunityAfter);
        expect(updateQuery.update).toHaveBeenCalledWith({
            stage: 'proposal',
            closed_at: null,
            checkout_approved_at: null,
            updated_at: expect.any(String),
        });
        expect(contactUpdate.update).toHaveBeenCalledWith({
            lifecycle_stage: 'qualified',
            last_contacted_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(leadUpdate.eq).toHaveBeenCalledWith('id', opportunityBefore.legacy_lead_id);
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', opportunityBefore.legacy_lead_id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: opportunityBefore.contact_id,
            opportunity_id: opportunityBefore.id,
            actor_id: 'admin-1',
            activity_type: 'system',
            subject: 'Etapa de oportunidad actualizada',
            related_entity_type: 'crm_opportunity',
            related_entity_id: opportunityBefore.id,
            metadata: {
                previous_stage: 'new',
                new_stage: 'proposal',
                legacy_lead_id: opportunityBefore.legacy_lead_id,
                next_follow_up_at: null,
            },
        }));
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_opportunity.stage.update',
            entity_type: 'crm_opportunity',
            entity_id: opportunityBefore.id,
            before: opportunityBefore,
            after: opportunityAfter,
        }));
    });

    it('explicitly approves checkout for one active package and audits the decision', async () => {
        const packageId = '70000000-0000-4000-8000-000000000001';
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000051',
            contact_id: '10000000-0000-4000-8000-000000000051',
            legacy_lead_id: '00000000-0000-4000-8000-000000000051',
            stage: 'qualified',
            preferred_package_id: null,
            checkout_approved_at: null,
            converted_subscription_id: null,
            updated_at: '2026-06-24T10:00:00.000Z',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            stage: 'proposal',
            preferred_package_id: packageId,
            checkout_approved_at: '2026-06-26T10:00:00.000Z',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            packages: { name: 'standard', display_name: { es: 'Estandar' } },
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const packageQuery = createMaybeSingleQuery({ data: checkoutReadyPackage(packageId), error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'packages') return packageQuery;
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'checkout_approval',
            opportunityId: opportunityBefore.id,
            packageId,
            approved: true,
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.opportunity).toEqual(opportunityAfter);
        expect(packageQuery.eq).toHaveBeenCalledWith('id', packageId);
        expect(packageQuery.eq).toHaveBeenCalledWith('is_active', true);
        expect(updateQuery.update).toHaveBeenCalledWith({
            preferred_package_id: packageId,
            checkout_approved_at: expect.any(String),
            stage: 'proposal',
            closed_at: null,
            updated_at: expect.any(String),
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'crm_opportunity.checkout.approve',
            entity_type: 'crm_opportunity',
            entity_id: opportunityBefore.id,
            before: opportunityBefore,
            after: opportunityAfter,
        }));
    });

    it('does not allow checkout approval for the group-only package until group sessions exist', async () => {
        const packageId = '70000000-0000-4000-8000-000000000099';
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000099',
            contact_id: '10000000-0000-4000-8000-000000000099',
            legacy_lead_id: '00000000-0000-4000-8000-000000000099',
            stage: 'qualified',
            preferred_package_id: null,
            checkout_approved_at: null,
            converted_subscription_id: null,
            updated_at: '2026-07-10T10:00:00.000Z',
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const packageQuery = createMaybeSingleQuery({ data: checkoutReadyPackage(packageId, 'group'), error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return beforeQuery;
                if (table === 'packages') return packageQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'checkout_approval',
            opportunityId: opportunityBefore.id,
            packageId,
            approved: true,
        }) as any);

        expect(response.status).toBe(409);
        expect(await readJson(response)).toEqual({ error: 'Package is not operationally available for checkout' });
        expect(client.from).not.toHaveBeenCalledWith('admin_audit_log');
    });

    it('revokes checkout approval without using the CRM stage as the permission', async () => {
        const packageId = '70000000-0000-4000-8000-000000000002';
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000052',
            contact_id: '10000000-0000-4000-8000-000000000052',
            legacy_lead_id: '00000000-0000-4000-8000-000000000052',
            stage: 'proposal',
            preferred_package_id: packageId,
            checkout_approved_at: '2026-06-26T10:00:00.000Z',
            converted_subscription_id: null,
            updated_at: '2026-06-26T10:00:00.000Z',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            checkout_approved_at: null,
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'b1',
            learning_goal: null,
            availability: null,
            packages: { name: 'hybrid', display_name: { es: 'Hibrido' } },
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'checkout_approval',
            opportunityId: opportunityBefore.id,
            packageId,
            approved: false,
        }) as any);

        expect(response.status).toBe(200);
        expect(updateQuery.update).toHaveBeenCalledWith({
            checkout_approved_at: null,
            updated_at: expect.any(String),
        });
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'crm_opportunity.checkout.revoke',
            before: opportunityBefore,
            after: opportunityAfter,
        }));
        expect(client.from).not.toHaveBeenCalledWith('packages');
    });

    it('marks lost opportunities as discarded leads and closes terminal lead work', async () => {
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000022',
            contact_id: '10000000-0000-4000-8000-000000000022',
            legacy_lead_id: '00000000-0000-4000-8000-000000000022',
            stage: 'proposal',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            stage: 'lost',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: '2026-06-26T10:00:00.000Z',
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            packages: null,
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'opportunity_stage',
            opportunityId: opportunityBefore.id,
            newStage: 'lost',
        }) as any);

        expect(response.status).toBe(200);
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'discarded',
            level_check_context: {},
            level_check_raw_cleared_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(leadUpdate.eq).toHaveBeenCalledWith('id', opportunityBefore.legacy_lead_id);
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead', 'level_check', 'lead_sales_follow_up']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', opportunityBefore.legacy_lead_id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(contactUpdate.update).toHaveBeenCalledWith({
            lifecycle_stage: 'lost',
            updated_at: expect.any(String),
        });
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                previous_stage: 'proposal',
                new_stage: 'lost',
            }),
        }));
    });

    it('marks won opportunities as contacted leads and closes terminal lead work', async () => {
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000032',
            contact_id: '10000000-0000-4000-8000-000000000032',
            legacy_lead_id: '00000000-0000-4000-8000-000000000032',
            stage: 'proposal',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            stage: 'won',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: '2026-06-26T10:00:00.000Z',
            current_level: 'b1',
            learning_goal: 'Work meetings',
            availability: 'Mornings',
            packages: null,
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const taskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskUpdate;
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'opportunity_stage',
            opportunityId: opportunityBefore.id,
            newStage: 'won',
        }) as any);

        expect(response.status).toBe(200);
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            level_check_context: {},
            level_check_raw_cleared_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(contactUpdate.update).toHaveBeenCalledWith({
            lifecycle_stage: 'customer',
            updated_at: expect.any(String),
        });
        expect(taskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(taskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead', 'level_check', 'lead_sales_follow_up']);
        expect(taskUpdate.eq).toHaveBeenCalledWith('related_entity_id', opportunityBefore.legacy_lead_id);
        expect(taskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
    });

    it('turns a nurture stage into a postponed lead with a follow-up task', async () => {
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000012',
            contact_id: '10000000-0000-4000-8000-000000000012',
            legacy_lead_id: '00000000-0000-4000-8000-000000000012',
            stage: 'proposal',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            stage: 'nurture',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'b1',
            learning_goal: 'Needs September availability',
            availability: 'After summer',
            packages: null,
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const initialReviewTaskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const taskLookup = createMaybeSingleQuery({ data: null, error: null });
        const taskInsert = {
            insert: vi.fn().mockResolvedValue({ error: null }),
        };
        const taskQueries = [initialReviewTaskUpdate, taskLookup, taskInsert];
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'opportunity_stage',
            opportunityId: opportunityBefore.id,
            newStage: 'nurture',
        }) as any);
        const body = await readJson(response);

        expect(response.status).toBe(200);
        expect(body.opportunity).toEqual(opportunityAfter);
        expect(contactUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
            lifecycle_stage: 'lead',
            next_follow_up_at: expect.any(String),
            updated_at: expect.any(String),
        }));
        expect(leadUpdate.update).toHaveBeenCalledWith({
            status: 'contacted',
            updated_at: expect.any(String),
        });
        expect(initialReviewTaskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(initialReviewTaskUpdate.in).toHaveBeenCalledWith('related_entity_type', ['lead']);
        expect(initialReviewTaskUpdate.eq).toHaveBeenCalledWith('related_entity_id', opportunityBefore.legacy_lead_id);
        expect(initialReviewTaskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskLookup.eq).toHaveBeenCalledWith('opportunity_id', opportunityBefore.id);
        expect(taskLookup.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(taskInsert.insert).toHaveBeenCalledWith(expect.objectContaining({
            contact_id: opportunityBefore.contact_id,
            opportunity_id: opportunityBefore.id,
            assigned_to: 'admin-1',
            title: 'Revisar lead pospuesto',
            task_type: 'review',
            priority: 'normal',
            due_at: expect.any(String),
            related_entity_type: 'crm_opportunity',
            related_entity_id: opportunityBefore.id,
            metadata: expect.objectContaining({
                action: 'nurture_follow_up',
                stage: 'nurture',
                legacy_lead_id: opportunityBefore.legacy_lead_id,
                follow_up_days: 7,
            }),
        }));
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                previous_stage: 'proposal',
                new_stage: 'nurture',
                next_follow_up_at: expect.any(String),
            }),
        }));
    });

    it('closes a postponed-opportunity follow-up task when the opportunity resumes', async () => {
        const opportunityBefore = {
            id: '20000000-0000-4000-8000-000000000042',
            contact_id: '10000000-0000-4000-8000-000000000042',
            legacy_lead_id: '00000000-0000-4000-8000-000000000042',
            stage: 'nurture',
        };
        const opportunityAfter = {
            ...opportunityBefore,
            stage: 'proposal',
            opened_at: '2026-06-24T10:00:00.000Z',
            closed_at: null,
            current_level: 'b1',
            learning_goal: 'Ready after summer',
            availability: 'September afternoons',
            packages: null,
            crm_contacts: null,
        };
        const beforeQuery = createSingleQuery({ data: opportunityBefore, error: null });
        const updateQuery = createSingleQuery({ data: opportunityAfter, error: null });
        const opportunityQueries = [beforeQuery, updateQuery];
        const contactUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const leadUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
        };
        const initialReviewTaskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const nurtureTaskUpdate: any = {
            error: null,
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
        };
        const taskQueries = [initialReviewTaskUpdate, nurtureTaskUpdate];
        const activityInsert = vi.fn().mockResolvedValue({ error: null });
        const auditInsert = vi.fn().mockResolvedValue({ error: null });
        const client = {
            from: vi.fn((table: string) => {
                if (table === 'crm_opportunities') return opportunityQueries.shift();
                if (table === 'crm_contacts') return contactUpdate;
                if (table === 'leads') return leadUpdate;
                if (table === 'crm_tasks') return taskQueries.shift();
                if (table === 'crm_activities') return { insert: activityInsert };
                if (table === 'admin_audit_log') return { insert: auditInsert };
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { PUT } = await import('../../src/pages/api/admin/leads');
        const response = await PUT(postContext({
            action: 'opportunity_stage',
            opportunityId: opportunityBefore.id,
            newStage: 'proposal',
        }) as any);

        expect(response.status).toBe(200);
        expect(initialReviewTaskUpdate.eq).toHaveBeenCalledWith('related_entity_id', opportunityBefore.legacy_lead_id);
        expect(nurtureTaskUpdate.update).toHaveBeenCalledWith({
            status: 'done',
            completed_at: expect.any(String),
            updated_at: expect.any(String),
        });
        expect(nurtureTaskUpdate.eq).toHaveBeenCalledWith('related_entity_type', 'crm_opportunity');
        expect(nurtureTaskUpdate.eq).toHaveBeenCalledWith('related_entity_id', opportunityBefore.id);
        expect(nurtureTaskUpdate.in).toHaveBeenCalledWith('status', ['open', 'snoozed']);
        expect(activityInsert).toHaveBeenCalledWith(expect.objectContaining({
            metadata: expect.objectContaining({
                previous_stage: 'nurture',
                new_stage: 'proposal',
                next_follow_up_at: null,
            }),
        }));
    });

    it('rejects invalid filters and invalid updates', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(createRoleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(createAdminClientForList([]).client as any);

        const { GET, POST } = await import('../../src/pages/api/admin/leads');
        const invalidFilter = await GET(getContext('/api/admin/leads?status=deleted') as any);
        const invalidUpdate = await POST(postContext({
            leadId: 'not-a-uuid',
            newStatus: 'deleted',
        }) as any);

        expect(invalidFilter.status).toBe(400);
        expect(invalidUpdate.status).toBe(400);
    });
});
