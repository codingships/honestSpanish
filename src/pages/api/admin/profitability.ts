import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const jsonHeaders = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
};

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const nullableUtm = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._~-]+$/).nullable();
const cents = z.number().int().positive().max(2_147_483_647);
const centsDelta = z.number().int().min(-2_147_483_648).max(2_147_483_647).refine((value) => value !== 0);

const listSchema = z.object({
    page: z.coerce.number().int().min(0).max(10_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    candidateQuery: z.string()
        .trim()
        .min(1)
        .max(120)
        .regex(/^[\p{L}\p{N}@._+\-\s]+$/u)
        .optional(),
}).strict();

const createCampaignSchema = z.object({
    action: z.literal('create_campaign'),
    requestId: uuid,
    name: z.string().trim().min(2).max(200),
    provider: z.string().trim().min(2).max(100).regex(/^[^\p{Cc}]+$/u),
    attributionMode: z.enum(['observed_utm', 'manual']),
    externalReference: z.string().trim().min(1).max(200).regex(/^[^\p{Cc}]+$/u).nullable(),
    utmSource: nullableUtm,
    utmMedium: nullableUtm,
    utmCampaign: nullableUtm,
    utmTerm: nullableUtm,
    utmContent: nullableUtm,
}).strict().superRefine((value, context) => {
    const requiredObservedValues = [value.utmSource, value.utmMedium, value.utmCampaign];
    const allUtmValues = [...requiredObservedValues, value.utmTerm, value.utmContent];

    if (value.attributionMode === 'observed_utm' && requiredObservedValues.some((item) => item === null)) {
        context.addIssue({ code: 'custom', message: 'Observed campaigns require source, medium and campaign UTM values' });
    }
    if (value.attributionMode === 'manual' && allUtmValues.some((item) => item !== null)) {
        context.addIssue({ code: 'custom', message: 'Manual campaigns cannot contain UTM values' });
    }
});

const actionSchema = z.discriminatedUnion('action', [
    createCampaignSchema,
    z.object({
        action: z.literal('record_cost'),
        requestId: uuid,
        costKind: z.enum(['acquisition_spend', 'delivery_material', 'student_tool', 'other_direct']),
        campaignId: uuid.nullable(),
        studentId: uuid.nullable(),
        amountCents: cents,
        incurredAt: timestamp,
        description: z.string().trim().min(5).max(1000),
    }).strict().superRefine((value, context) => {
        if (value.costKind === 'acquisition_spend' && (value.campaignId === null || value.studentId !== null)) {
            context.addIssue({ code: 'custom', message: 'Acquisition spend must belong only to a campaign' });
        }
        if (value.costKind !== 'acquisition_spend' && (value.studentId === null || value.campaignId !== null)) {
            context.addIssue({ code: 'custom', message: 'Direct costs must belong only to a student' });
        }
    }),
    z.object({
        action: z.literal('adjust_cost'),
        requestId: uuid,
        costEntryId: uuid,
        amountDeltaCents: centsDelta,
        reason: z.string().trim().min(5).max(1000),
    }).strict(),
    z.object({
        action: z.literal('record_allocation'),
        requestId: uuid,
        campaignId: uuid,
        studentId: uuid,
        checkoutAttributionEventId: uuid.nullable(),
        basis: z.enum(['observed_checkout', 'manual']),
        amountCents: cents,
        reason: z.string().trim().min(5).max(1000),
    }).strict().superRefine((value, context) => {
        if (value.basis === 'observed_checkout' && value.checkoutAttributionEventId === null) {
            context.addIssue({ code: 'custom', message: 'Observed checkout allocation requires an attribution event' });
        }
        if (value.basis === 'manual' && value.checkoutAttributionEventId !== null) {
            context.addIssue({ code: 'custom', message: 'Manual allocation cannot claim an observed checkout event' });
        }
    }),
    z.object({
        action: z.literal('adjust_allocation'),
        requestId: uuid,
        allocationEntryId: uuid,
        amountDeltaCents: centsDelta,
        reason: z.string().trim().min(5).max(1000),
    }).strict(),
]);

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

async function requireAdmin(context: APIContext) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { user: null, error: json({ error: 'Unauthorized' }, 401) };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (profile?.role !== 'admin') {
        return { user: null, error: json({ error: 'Forbidden' }, 403) };
    }
    return { user, error: null };
}

function databaseErrorResponse(error: { code?: string; message?: string } | null) {
    const code = error?.code || '';
    const message = error?.message || '';
    if (code === '42501' || message.includes('_forbidden')) return json({ error: 'Forbidden' }, 403);
    if (
        code === '40001'
        || code === '23P01'
        || code === '23505'
        || code === '23514'
        || message.includes('state_conflicts')
        || message.includes('balance_out_of_range')
        || message.includes('allocation_exceeds')
    ) {
        return json({ error: 'La operación entra en conflicto con el estado registrado' }, 409);
    }
    if (code === '55000' || message.includes('precondition_missing')) {
        return json({ error: 'Falta una precondición operativa' }, 503);
    }
    if (code === '22023' || code === '23503' || message.includes('invalid_') || message.includes('_requires_')) {
        return json({ error: 'La operación no cumple el contrato de rentabilidad' }, 400);
    }
    console.error('[Profitability] Database operation failed', { code });
    return json({ error: 'No se pudo completar la operación' }, 500);
}

function profileLabel(
    profile: { full_name: string | null; email: string } | null | undefined,
    fallbackName: string | null | undefined,
    fallbackEmail: string | null | undefined,
    fallbackId: string,
) {
    return {
        name: profile?.full_name || fallbackName || profile?.email || fallbackEmail || fallbackId,
        email: profile?.email || fallbackEmail || '',
    };
}

function camelCaseKey(key: string): string {
    return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelCaseResult(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(camelCaseResult);
    if (!value || typeof value !== 'object' || value instanceof Date) return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .map(([key, nested]) => [camelCaseKey(key), camelCaseResult(nested)]),
    );
}

function numberValue(value: number | null | undefined): number {
    return value ?? 0;
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const parsed = listSchema.safeParse({
        page: url.searchParams.get('page') || undefined,
        limit: url.searchParams.get('limit') || undefined,
        candidateQuery: url.searchParams.get('candidateQuery') || undefined,
    });
    if (!parsed.success) return json({ error: 'Invalid profitability filters' }, 400);

    const { page, limit, candidateQuery } = parsed.data;
    const rangeStart = page * limit;
    const rangeEnd = rangeStart + limit;
    const admin = createSupabaseAdminClient();

    const portfolioQuery = admin
        .from('portfolio_unit_economics')
        .select('*')
        .single();

    const campaignsQuery = admin
        .from('acquisition_campaign_unit_economics')
        .select('*')
        .order('created_at', { ascending: false })
        .order('campaign_id', { ascending: false })
        .limit(1000);

    const studentsQuery = admin
        .from('student_unit_economics')
        .select('*')
        .order('first_paid_at', { ascending: false, nullsFirst: false })
        .order('student_id', { ascending: false })
        .range(rangeStart, rangeEnd);

    const costsQuery = admin
        .from('operational_cost_balances')
        .select('*')
        .order('incurred_at', { ascending: false })
        .order('original_cost_id', { ascending: false })
        .range(rangeStart, rangeEnd);

    const allocationsQuery = admin
        .from('acquisition_cost_allocation_balances')
        .select('*')
        .order('created_at', { ascending: false })
        .order('original_allocation_id', { ascending: false })
        .range(rangeStart, rangeEnd);

    let candidatesQuery = admin
        .from('acquisition_allocation_candidates')
        .select('*')
        .order('first_paid_at', { ascending: false })
        .order('student_id', { ascending: false })
        .limit(100);
    if (candidateQuery) {
        candidatesQuery = candidatesQuery.ilike(
            candidateQuery.includes('@') ? 'student_email' : 'student_full_name',
            `%${candidateQuery}%`,
        );
    }

    const [
        portfolioResult,
        campaignsResult,
        studentsResult,
        costsResult,
        allocationsResult,
        candidatesResult,
    ] = await Promise.all([
        portfolioQuery,
        campaignsQuery,
        studentsQuery,
        costsQuery,
        allocationsQuery,
        candidatesQuery,
    ]);

    const failed = [
        portfolioResult,
        campaignsResult,
        studentsResult,
        costsResult,
        allocationsResult,
        candidatesResult,
    ].find((result) => result.error);
    if (failed?.error) {
        console.error('[Profitability] Could not load unit economics', { code: failed.error.code });
        return json({ error: 'No se pudo cargar la rentabilidad operativa' }, 500);
    }

    const rawCampaigns = campaignsResult.data || [];
    const rawStudentRows = studentsResult.data || [];
    const rawCostRows = costsResult.data || [];
    const rawAllocationRows = allocationsResult.data || [];
    const rawCandidateRows = candidatesResult.data || [];
    const campaigns = rawCampaigns.filter(
        (row): row is typeof row & { campaign_id: string } => typeof row.campaign_id === 'string',
    );
    const studentRows = rawStudentRows.filter(
        (row): row is typeof row & { student_id: string } => typeof row.student_id === 'string',
    );
    const costRows = rawCostRows.filter(
        (row): row is typeof row & { original_cost_id: string } => typeof row.original_cost_id === 'string',
    );
    const allocationRows = rawAllocationRows.filter(
        (row): row is typeof row & {
            original_allocation_id: string;
            campaign_id: string;
            student_id: string;
        } => typeof row.original_allocation_id === 'string'
            && typeof row.campaign_id === 'string'
            && typeof row.student_id === 'string',
    );
    const candidateRows = rawCandidateRows.filter(
        (row): row is typeof row & { student_id: string } => typeof row.student_id === 'string',
    );
    if (
        campaigns.length !== rawCampaigns.length
        || studentRows.length !== rawStudentRows.length
        || costRows.length !== rawCostRows.length
        || allocationRows.length !== rawAllocationRows.length
        || candidateRows.length !== rawCandidateRows.length
    ) {
        console.error('[Profitability] A unit-economics view returned a row without its required identity');
        return json({ error: 'No se pudo cargar la rentabilidad operativa' }, 500);
    }
    const studentIds = Array.from(new Set([
        ...studentRows.map((row) => row.student_id),
        ...allocationRows.map((row) => row.student_id),
        ...candidateRows.map((row) => row.student_id),
    ].filter((id): id is string => typeof id === 'string')));

    const profilesResult = studentIds.length > 0
        ? await admin.from('profiles').select('id, full_name, email').in('id', studentIds)
        : { data: [], error: null };
    if (profilesResult.error) {
        console.error('[Profitability] Could not load student labels', { code: profilesResult.error.code });
        return json({ error: 'No se pudo cargar la rentabilidad operativa' }, 500);
    }

    const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
    const campaignNames = new Map(campaigns.map((campaign) => [campaign.campaign_id, campaign.campaign_name]));
    const portfolio = portfolioResult.data;

    return json({
        summary: {
            totalGrossCollectedCents: numberValue(portfolio?.gross_revenue_cents),
            totalRefundsCents: numberValue(portfolio?.refunds_cents),
            totalNetRevenueCents: numberValue(portfolio?.net_revenue_cents),
            totalTeacherObligationCents: numberValue(portfolio?.teacher_compensation_cents),
            totalDirectCostCents: numberValue(portfolio?.direct_operational_cost_cents),
            totalAcquisitionAllocatedCents: numberValue(portfolio?.allocated_acquisition_cost_cents),
            totalProvisionalContributionCents: numberValue(portfolio?.provisional_contribution_cents),
            totalCampaignSpendCents: numberValue(portfolio?.campaign_spend_cents),
            totalUnallocatedCampaignSpendCents: numberValue(portfolio?.unallocated_acquisition_cost_cents),
        },
        campaigns: campaigns.map((campaign) => ({
            id: campaign.campaign_id,
            name: campaign.campaign_name,
            provider: campaign.provider,
            attributionMode: campaign.attribution_mode,
            utmSource: campaign.utm_source,
            utmMedium: campaign.utm_medium,
            utmCampaign: campaign.utm_campaign,
            utmTerm: campaign.utm_term,
            utmContent: campaign.utm_content,
            netSpendCents: campaign.campaign_spend_cents,
            allocatedAcquisitionCents: campaign.allocated_acquisition_cost_cents,
            unallocatedAcquisitionCents: campaign.unallocated_spend_cents,
            studentCount: campaign.acquired_student_count,
            grossCollectedCents: campaign.gross_revenue_cents,
            refundsCents: campaign.refunds_cents,
            netCollectedCents: campaign.net_revenue_cents,
            teacherObligationCents: campaign.teacher_compensation_cents,
            directCostCents: campaign.direct_operational_cost_cents,
            provisionalContributionCents: campaign.provisional_contribution_cents,
        })),
        students: studentRows.slice(0, limit).map((student) => {
            const label = profileLabel(
                profiles.get(student.student_id),
                student.student_full_name,
                student.student_email,
                student.student_id,
            );
            return {
                studentId: student.student_id,
                studentName: label.name,
                studentEmail: label.email,
                grossCollectedCents: student.gross_revenue_cents,
                refundsCents: student.refunds_cents,
                netCollectedCents: student.net_revenue_cents,
                teacherObligationCents: student.teacher_compensation_cents,
                directCostCents: student.direct_operational_cost_cents,
                acquisitionCostCents: student.acquisition_cost_cents,
                provisionalContributionCents: student.provisional_contribution_cents,
                campaignId: student.active_campaign_id,
                campaignName: student.active_campaign_name
                    || (student.active_campaign_id ? campaignNames.get(student.active_campaign_id) || null : null),
                acquisitionBasis: student.acquisition_basis,
                firstCycleId: student.first_cycle_id,
            };
        }),
        costs: costRows.slice(0, limit).map((entry) => ({
            entryId: entry.original_cost_id,
            costKind: entry.cost_kind,
            campaignId: entry.campaign_id,
            studentId: entry.student_id,
            originalAmountCents: entry.original_amount_cents,
            adjustmentAmountCents: entry.adjustment_amount_cents,
            netAmountCents: entry.balance_amount_cents,
            currency: entry.currency,
            incurredAt: entry.incurred_at,
            description: entry.description,
        })),
        allocations: allocationRows.slice(0, limit).map((entry) => ({
            entryId: entry.original_allocation_id,
            campaignId: entry.campaign_id,
            campaignName: campaignNames.get(entry.campaign_id) || null,
            studentId: entry.student_id,
            studentName: profileLabel(
                profiles.get(entry.student_id),
                null,
                null,
                entry.student_id,
            ).name,
            originalAmountCents: entry.original_amount_cents,
            adjustmentAmountCents: entry.adjustment_amount_cents,
            netAmountCents: entry.balance_amount_cents,
            basis: entry.basis,
            reason: entry.reason,
        })),
        candidates: candidateRows.map((candidate) => {
            const label = profileLabel(
                profiles.get(candidate.student_id),
                candidate.student_full_name,
                candidate.student_email,
                candidate.student_id,
            );
            return {
                studentId: candidate.student_id,
                studentName: label.name,
                studentEmail: label.email,
                contactId: candidate.contact_id,
                firstSubscriptionId: candidate.first_subscription_id,
                firstCycleId: candidate.first_cycle_id,
                attributionEventId: candidate.checkout_attribution_event_id,
                hasActiveAllocation: candidate.has_active_allocation,
                utmSource: candidate.utm_source,
                utmMedium: candidate.utm_medium,
                utmCampaign: candidate.utm_campaign,
                utmTerm: candidate.utm_term,
                utmContent: candidate.utm_content,
            };
        }),
        pagination: {
            page,
            limit,
            studentsHasMore: studentRows.length > limit,
            costsHasMore: costRows.length > limit,
            allocationsHasMore: allocationRows.length > limit,
        },
    });
};

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) return json({ error: 'Forbidden' }, 403);

    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let body: unknown;
    try {
        body = await context.request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid profitability action' }, 400);

    const admin = createSupabaseAdminClient();
    const action = parsed.data;
    let result;

    switch (action.action) {
        case 'create_campaign':
            result = await admin.rpc('create_acquisition_campaign', {
                p_request_id: action.requestId,
                p_name: action.name,
                p_provider: action.provider,
                p_external_reference: action.externalReference,
                p_utm_source: action.utmSource,
                p_utm_medium: action.utmMedium,
                p_utm_campaign: action.utmCampaign,
                p_utm_term: action.utmTerm,
                p_utm_content: action.utmContent,
                p_admin_id: auth.user.id,
            });
            break;
        case 'record_cost':
            result = await admin.rpc('record_operational_cost', {
                p_request_id: action.requestId,
                p_cost_kind: action.costKind,
                p_campaign_id: action.campaignId,
                p_student_id: action.studentId,
                p_amount_cents: action.amountCents,
                p_incurred_at: action.incurredAt,
                p_admin_id: auth.user.id,
                p_description: action.description,
            });
            break;
        case 'adjust_cost':
            result = await admin.rpc('adjust_operational_cost', {
                p_request_id: action.requestId,
                p_original_cost_id: action.costEntryId,
                p_amount_delta_cents: action.amountDeltaCents,
                p_admin_id: auth.user.id,
                p_reason: action.reason,
            });
            break;
        case 'record_allocation':
            result = await admin.rpc('record_acquisition_cost_allocation', {
                p_request_id: action.requestId,
                p_campaign_id: action.campaignId,
                p_student_id: action.studentId,
                p_amount_cents: action.amountCents,
                p_basis: action.basis,
                p_checkout_attribution_event_id: action.checkoutAttributionEventId,
                p_admin_id: auth.user.id,
                p_reason: action.reason,
            });
            break;
        case 'adjust_allocation':
            result = await admin.rpc('adjust_acquisition_cost_allocation', {
                p_request_id: action.requestId,
                p_original_allocation_id: action.allocationEntryId,
                p_amount_delta_cents: action.amountDeltaCents,
                p_admin_id: auth.user.id,
                p_reason: action.reason,
            });
            break;
    }

    if (result.error) return databaseErrorResponse(result.error);
    return json({ result: camelCaseResult(result.data) });
};
