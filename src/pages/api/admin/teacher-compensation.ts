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

const listSchema = z.object({
    teacherId: z.union([uuid, z.literal('')]).optional(),
    page: z.coerce.number().int().min(0).max(10_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

const actionSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('configure_engagement'),
        requestId: uuid,
        teacherId: uuid,
        engagementKind: z.enum(['founder', 'external']),
        effectiveFrom: timestamp,
        reason: z.string().trim().min(5).max(1000),
    }),
    z.object({
        action: z.literal('confirm_history'),
        requestId: uuid,
        confirmation: z.enum(['not_reached', 'reached']),
        triggerCycleId: uuid.nullable(),
        observedCount: z.number().int().min(10).max(32767).nullable(),
        reason: z.string().trim().min(5).max(1000),
    }).superRefine((value, context) => {
        if (value.confirmation === 'not_reached' && (value.triggerCycleId !== null || value.observedCount !== null)) {
            context.addIssue({ code: 'custom', message: 'Unexpected reached-history fields' });
        }
        if (value.confirmation === 'reached' && (!value.triggerCycleId || value.observedCount === null)) {
            context.addIssue({ code: 'custom', message: 'Missing reached-history fields' });
        }
    }),
    z.object({ action: z.literal('reconcile_cycle'), cycleId: uuid }),
    z.object({ action: z.literal('reconcile_session'), sessionId: uuid }),
    z.object({
        action: z.literal('record_mandatory_work'),
        requestId: uuid,
        teacherId: uuid,
        workKind: z.enum(['mandatory_training', 'mandatory_meeting']),
        startedAt: timestamp,
        endedAt: timestamp,
        description: z.string().trim().min(5).max(1000),
    }).superRefine((value, context) => {
        if (new Date(value.endedAt).getTime() <= new Date(value.startedAt).getTime()) {
            context.addIssue({ code: 'custom', message: 'Work end must be after its start' });
        }
    }),
    z.object({
        action: z.literal('adjust_mandatory_work'),
        requestId: uuid,
        workEntryId: uuid,
        minutesDelta: z.number().int().min(-720).max(720).refine((value) => value !== 0),
        reason: z.string().trim().min(5).max(1000),
    }),
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

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function profileLabel(profile: { full_name: string | null; email: string } | null | undefined, fallback: string): string {
    return profile?.full_name || profile?.email || fallback;
}

function databaseErrorResponse(error: { code?: string; message?: string } | null) {
    const code = error?.code || '';
    const message = error?.message || '';
    if (code === '42501' || message.includes('_forbidden')) return json({ error: 'Forbidden' }, 403);
    if (code === '40001' || code === '23P01' || message.includes('state_conflicts')) {
        return json({ error: 'La operación entra en conflicto con el estado registrado' }, 409);
    }
    if (code === '55000' || message.includes('precondition_missing')) return json({ error: 'Falta una precondición operativa' }, 503);
    if (code === '22023' || code === '23514' || message.includes('invalid_') || message.includes('_requires_')) {
        return json({ error: 'La operación no cumple el contrato de remuneración' }, 400);
    }
    console.error('[TeacherCompensation] Database operation failed', { code });
    return json({ error: 'No se pudo completar la operación' }, 500);
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const parsed = listSchema.safeParse({
        teacherId: url.searchParams.get('teacherId') || undefined,
        page: url.searchParams.get('page') || undefined,
        limit: url.searchParams.get('limit') || undefined,
    });
    if (!parsed.success) return json({ error: 'Invalid compensation filters' }, 400);

    const { teacherId, page, limit } = parsed.data;
    const rangeStart = page * limit;
    const rangeEnd = rangeStart + limit;
    const admin = createSupabaseAdminClient();

    const teachersQuery = admin
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'teacher')
        .order('full_name', { ascending: true });

    const engagementsQuery = admin
        .from('teacher_compensation_engagements')
        .select('id, teacher_id, engagement_kind, effective_from, reason, created_at')
        .order('effective_from', { ascending: false })
        .limit(1000);

    const milestoneQuery = admin
        .from('teacher_compensation_milestones')
        .select('ten_active_history_state, first_ready_initial_at, ten_active_reached_at, ten_active_students_count')
        .eq('policy_version', 1)
        .single();

    const historyCyclesQuery = admin
        .from('checkout_v2_cycles')
        .select(`
            id, created_at, cycle_number, subscription_id,
            subscription:subscriptions!inner(
                contract_schema_version,
                student:profiles!subscriptions_student_id_fkey(full_name, email)
            )
        `)
        .eq('cycle_number', 1)
        .eq('cycle_kind', 'initial')
        .eq('materialization_state', 'ready')
        .eq('subscriptions.contract_schema_version', 2)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1000);

    const readyCyclesQuery = admin
        .from('checkout_v2_cycles')
        .select(`
            id, created_at, cycle_number, subscription_id,
            cycle_terms:teacher_compensation_cycle_terms!left(cycle_id),
            subscription:subscriptions!inner(
                contract_schema_version,
                student:profiles!subscriptions_student_id_fkey(full_name, email)
            )
        `)
        .eq('materialization_state', 'ready')
        .eq('subscriptions.contract_schema_version', 2)
        .is('cycle_terms', null)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(25);

    const reconciliationCandidatesQuery = admin
        .from('teacher_compensation_session_reconciliation_candidates')
        .select(`
            session_id, cycle_id, scheduled_at, status, event_kind,
            source_occurred_at, teacher_id, student_id,
            teacher_full_name, teacher_email, student_full_name, student_email
        `)
        .order('source_occurred_at', { ascending: true })
        .order('session_id', { ascending: true })
        .limit(25);

    let classQuery = admin
        .from('teacher_compensation_ledger')
        .select(`
            id, teacher_id, student_id, event_kind, source_occurred_at, amount_cents, currency,
            teacher:profiles!teacher_compensation_ledger_teacher_id_fkey(full_name, email),
            student:profiles!teacher_compensation_ledger_student_id_fkey(full_name, email)
        `)
        .order('source_occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .range(rangeStart, rangeEnd);
    if (teacherId) classQuery = classQuery.eq('teacher_id', teacherId);

    let workQuery = admin
        .from('teacher_compensation_work_balances')
        .select(`
            id, teacher_id, work_kind, started_at, ended_at, duration_minutes,
            amount_cents, adjustment_minutes, adjusted_minutes,
            adjustment_amount_cents, adjusted_amount_cents,
            currency, description, created_at
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(rangeStart, rangeEnd);
    if (teacherId) workQuery = workQuery.eq('teacher_id', teacherId);

    let adjustmentsQuery = admin
        .from('teacher_compensation_work_adjustments')
        .select(`
            id, teacher_id, work_entry_id, minutes_delta, amount_delta_cents,
            currency, reason, created_at,
            teacher:profiles!teacher_compensation_work_adjustments_teacher_id_fkey(full_name, email)
        `)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(25);
    if (teacherId) adjustmentsQuery = adjustmentsQuery.eq('teacher_id', teacherId);

    const [
        teachersResult,
        engagementsResult,
        milestoneResult,
        historyCyclesResult,
        readyCyclesResult,
        reconciliationCandidatesResult,
        classResult,
        workResult,
        adjustmentsResult,
    ] = await Promise.all([
        teachersQuery,
        engagementsQuery,
        milestoneQuery,
        historyCyclesQuery,
        readyCyclesQuery,
        reconciliationCandidatesQuery,
        classQuery,
        workQuery,
        adjustmentsQuery,
    ]);

    const failed = [
        teachersResult,
        engagementsResult,
        milestoneResult,
        historyCyclesResult,
        readyCyclesResult,
        reconciliationCandidatesResult,
        classResult,
        workResult,
        adjustmentsResult,
    ].find((result) => result.error);
    if (failed?.error) {
        console.error('[TeacherCompensation] Could not load operations', { code: failed.error.code });
        return json({ error: 'No se pudo cargar la remuneración docente' }, 500);
    }

    const engagements = (engagementsResult.data || []).map((row) => ({
        id: row.id,
        teacherId: row.teacher_id,
        engagementKind: row.engagement_kind,
        effectiveFrom: row.effective_from,
        reason: row.reason,
        createdAt: row.created_at,
    }));
    const currentEngagements = new Map<string, (typeof engagements)[number]>();
    const now = Date.now();
    for (const engagement of engagements) {
        if (new Date(engagement.effectiveFrom).getTime() <= now && !currentEngagements.has(engagement.teacherId)) {
            currentEngagements.set(engagement.teacherId, engagement);
        }
    }

    const classRows = classResult.data || [];
    const workRows = workResult.data || [];
    const adjustmentRows = adjustmentsResult.data || [];

    return json({
        teachers: (teachersResult.data || []).map((teacher) => ({
            id: teacher.id,
            fullName: teacher.full_name,
            email: teacher.email,
            currentEngagement: currentEngagements.get(teacher.id) || null,
        })),
        engagements,
        milestone: milestoneResult.data ? {
            tenActiveHistoryState: milestoneResult.data.ten_active_history_state,
            firstReadyInitialAt: milestoneResult.data.first_ready_initial_at,
            tenActiveReachedAt: milestoneResult.data.ten_active_reached_at,
            tenActiveStudentsCount: milestoneResult.data.ten_active_students_count,
        } : null,
        historyCycles: (historyCyclesResult.data || []).map((cycle) => {
            const subscription = relationOne(cycle.subscription);
            return {
                id: cycle.id,
                createdAt: cycle.created_at,
                studentLabel: profileLabel(relationOne(subscription?.student), cycle.subscription_id),
            };
        }),
        cycleGaps: (readyCyclesResult.data || [])
            .slice(0, 25)
            .map((cycle) => {
                const subscription = relationOne(cycle.subscription);
                return {
                    id: cycle.id,
                    createdAt: cycle.created_at,
                    cycleNumber: cycle.cycle_number,
                    studentLabel: profileLabel(relationOne(subscription?.student), cycle.subscription_id),
                };
            }),
        sessionGaps: (reconciliationCandidatesResult.data || [])
            .map((session) => ({
                id: session.session_id,
                scheduledAt: session.scheduled_at,
                status: session.status,
                teacherLabel: session.teacher_full_name
                    || session.teacher_email
                    || session.teacher_id
                    || 'Profesor no disponible',
                studentLabel: session.student_full_name
                    || session.student_email
                    || session.student_id
                    || 'Alumno no disponible',
            })),
        classObligations: classRows.slice(0, limit).map((entry) => ({
            id: entry.id,
            teacherId: entry.teacher_id,
            teacherLabel: profileLabel(relationOne(entry.teacher), entry.teacher_id),
            studentLabel: profileLabel(relationOne(entry.student), entry.student_id),
            eventKind: entry.event_kind,
            sourceOccurredAt: entry.source_occurred_at,
            amountCents: entry.amount_cents,
            currency: entry.currency,
        })),
        workObligations: workRows.slice(0, limit).map((entry) => ({
            id: entry.id,
            teacherId: entry.teacher_id,
            teacherLabel: profileLabel(
                (teachersResult.data || []).find((teacher) => teacher.id === entry.teacher_id) || null,
                entry.teacher_id,
            ),
            workKind: entry.work_kind,
            startedAt: entry.started_at,
            endedAt: entry.ended_at,
            originalMinutes: entry.duration_minutes,
            originalAmountCents: entry.amount_cents,
            adjustmentMinutes: entry.adjustment_minutes,
            adjustmentAmountCents: entry.adjustment_amount_cents,
            adjustedMinutes: entry.adjusted_minutes,
            adjustedAmountCents: entry.adjusted_amount_cents,
            currency: entry.currency,
            description: entry.description,
            createdAt: entry.created_at,
        })),
        workAdjustments: adjustmentRows.slice(0, limit).map((entry) => ({
            id: entry.id,
            teacherId: entry.teacher_id,
            teacherLabel: profileLabel(relationOne(entry.teacher), entry.teacher_id),
            workEntryId: entry.work_entry_id,
            minutesDelta: entry.minutes_delta,
            amountCents: entry.amount_delta_cents,
            currency: entry.currency,
            reason: entry.reason,
            createdAt: entry.created_at,
        })),
        pagination: {
            page,
            limit,
            hasPrevious: page > 0,
            hasMore: classRows.length > limit || workRows.length > limit,
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
    if (!parsed.success) return json({ error: 'Invalid compensation action' }, 400);

    const admin = createSupabaseAdminClient();
    const action = parsed.data;
    let result;

    switch (action.action) {
        case 'configure_engagement':
            result = await admin.rpc('configure_teacher_compensation_engagement', {
                p_request_id: action.requestId,
                p_teacher_id: action.teacherId,
                p_engagement_kind: action.engagementKind,
                p_effective_from: action.effectiveFrom,
                p_configured_by: auth.user.id,
                p_reason: action.reason,
            });
            break;
        case 'confirm_history':
            result = await admin.rpc('confirm_teacher_compensation_ten_active_history', {
                p_request_id: action.requestId,
                p_confirmation: action.confirmation,
                p_trigger_cycle_id: action.triggerCycleId,
                p_observed_count: action.observedCount,
                p_admin_id: auth.user.id,
                p_reason: action.reason,
            });
            break;
        case 'reconcile_cycle':
            result = await admin.rpc('reconcile_teacher_compensation_cycle', {
                p_cycle_id: action.cycleId,
                p_admin_id: auth.user.id,
            });
            break;
        case 'reconcile_session':
            result = await admin.rpc('reconcile_teacher_compensation_session', {
                p_session_id: action.sessionId,
                p_admin_id: auth.user.id,
            });
            break;
        case 'record_mandatory_work':
            result = await admin.rpc('record_teacher_compensation_work', {
                p_request_id: action.requestId,
                p_teacher_id: action.teacherId,
                p_work_kind: action.workKind,
                p_started_at: action.startedAt,
                p_ended_at: action.endedAt,
                p_recorded_by: auth.user.id,
                p_description: action.description,
            });
            break;
        case 'adjust_mandatory_work':
            result = await admin.rpc('adjust_teacher_compensation_work', {
                p_request_id: action.requestId,
                p_work_entry_id: action.workEntryId,
                p_minutes_delta: action.minutesDelta,
                p_recorded_by: auth.user.id,
                p_reason: action.reason,
            });
            break;
    }

    if (result.error) return databaseErrorResponse(result.error);
    return json({ result: result.data });
};
