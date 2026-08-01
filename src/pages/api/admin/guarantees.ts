import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import {
    CheckoutV2GuaranteeError,
    reconcileCheckoutV2GuaranteeRefundOperation,
    resolveCheckoutV2GuaranteeReview,
    resumeCheckoutV2GuaranteeOperation,
    type CheckoutV2GuaranteeResult,
} from '../../../lib/checkout-v2-guarantee';
import { triggerFulfillmentProcessing } from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const operationStatuses = [
    'requested',
    'processing',
    'refund_pending',
    'refunded',
    'retryable',
    'manual_review',
] as const;

const actionSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('resume'),
        operationId: z.string().uuid(),
    }).strict(),
    z.object({
        action: z.literal('reconcile_refund'),
        operationId: z.string().uuid(),
    }).strict(),
    z.object({
        action: z.literal('resolve_review'),
        operationId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
    }).strict(),
    z.object({
        action: z.literal('excuse_incident'),
        sessionId: z.string().uuid(),
        reason: z.string().trim().min(5).max(2000),
    }).strict(),
]);

type DatabaseError = { code?: string; message?: string };
type QueryResult = PromiseLike<{ data: unknown; error: DatabaseError | null }>;
type QueryBuilder = QueryResult & {
    select(columns: string): QueryBuilder;
    eq(column: string, value: unknown): QueryBuilder;
    in(column: string, values: readonly unknown[]): QueryBuilder;
    order(column: string, options?: { ascending?: boolean }): QueryBuilder;
    limit(value: number): QueryBuilder;
    single(): Promise<{ data: unknown; error: DatabaseError | null }>;
};
type UntypedAdminClient = {
    from(table: string): QueryBuilder;
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: DatabaseError | null }>;
};

type ProfileRelation = { id: string; full_name: string | null; email: string | null };
type SubscriptionRelation = {
    id: string;
    student_id: string;
    contract_schema_version: number;
    student: ProfileRelation | ProfileRelation[] | null;
};
type PaymentRelation = {
    id: string;
    amount: number;
    amount_refunded: number;
    currency: string;
    status: string;
};
type TicketRelation = { id: string; status: string; issue_title: string };
type OperationRow = {
    id: string;
    subscription_id: string;
    payment_id: string;
    second_session_id: string;
    gross_amount_cents: number;
    refund_amount_cents: number;
    currency: string;
    status: typeof operationStatuses[number];
    stripe_refund_id: string | null;
    refund_status: string | null;
    created_at: string;
    updated_at: string;
    refund_created_at: string | null;
    refunded_at: string | null;
    support_ticket_id: string | null;
    last_error: string | null;
    subscription: SubscriptionRelation | SubscriptionRelation[] | null;
    payment: PaymentRelation | PaymentRelation[] | null;
    support_ticket: TicketRelation | TicketRelation[] | null;
};
type CycleRelation = { id: string; cycle_number: number; cycle_kind: string };
type IncidentSessionRow = {
    id: string;
    subscription_id: string;
    status: string;
    scheduled_at: string | null;
    cancelled_at: string | null;
    cancelled_by: string | null;
    updated_at: string | null;
    subscription: SubscriptionRelation | SubscriptionRelation[] | null;
    cycle: CycleRelation | CycleRelation[] | null;
};
type ResolutionRow = {
    id: string;
    session_id: string;
    admin_id: string;
    original_status: string;
    incident_at: string;
    reason: string;
    created_at: string;
};

const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
};

function json(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isUuid(value: string | null): value is string {
    return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function sameOriginRequest(request: Request) {
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

function mapOperation(row: OperationRow) {
    const subscription = relationOne(row.subscription);
    const student = relationOne(subscription?.student);
    const payment = relationOne(row.payment);
    const ticket = relationOne(row.support_ticket);
    const grossCents = row.gross_amount_cents;
    const refundedCents = payment?.amount_refunded ?? 0;

    return {
        id: row.id,
        subscriptionId: row.subscription_id,
        student: student ? {
            id: student.id,
            fullName: student.full_name,
            email: student.email,
        } : null,
        status: row.status,
        grossCents,
        guaranteeRefundCents: row.refund_amount_cents,
        refundedCents,
        netCents: Math.max(0, grossCents - refundedCents),
        currency: row.currency,
        payment: payment ? { id: payment.id, status: payment.status } : null,
        stripeRefundId: row.stripe_refund_id,
        stripeRefundStatus: row.refund_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        refundCreatedAt: row.refund_created_at,
        refundedAt: row.refunded_at,
        supportTicket: ticket ? {
            id: ticket.id,
            status: ticket.status,
            title: ticket.issue_title,
        } : null,
        lastError: row.last_error,
    };
}

function isLateStudentCancellation(session: IncidentSessionRow, studentId: string | null) {
    if (session.status !== 'cancelled'
        || !session.scheduled_at
        || !session.cancelled_at
        || !studentId
        || session.cancelled_by !== studentId) return false;
    const scheduledAt = new Date(session.scheduled_at).getTime();
    const cancelledAt = new Date(session.cancelled_at).getTime();
    return Number.isFinite(scheduledAt)
        && Number.isFinite(cancelledAt)
        && scheduledAt < cancelledAt + 24 * 60 * 60 * 1000;
}

function responseStatus(result: CheckoutV2GuaranteeResult) {
    return ['processing', 'refund_pending', 'manual_review'].includes(result.status) ? 202 : 200;
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const requestedStatus = url.searchParams.get('status') || 'all';
    if (requestedStatus !== 'all' && !operationStatuses.includes(requestedStatus as typeof operationStatuses[number])) {
        return json({ error: 'Invalid status filter' }, 400);
    }
    const studentId = url.searchParams.get('studentId');
    if (studentId && !isUuid(studentId)) return json({ error: 'Invalid student filter' }, 400);

    const admin = createSupabaseAdminClient() as unknown as UntypedAdminClient;
    let studentSubscriptionIds: string[] | null = null;
    if (studentId) {
        const subscriptionsResult = await admin
            .from('subscriptions')
            .select('id')
            .eq('student_id', studentId);
        if (subscriptionsResult.error) {
            console.error('[AdminGuarantees] Could not resolve student subscriptions');
            return json({ error: 'Could not load guarantee operations' }, 500);
        }
        studentSubscriptionIds = ((subscriptionsResult.data ?? []) as Array<{ id: string }>).map((row) => row.id);
        if (studentSubscriptionIds.length === 0) return json({ operations: [], incidents: [] });
    }

    let operationsQuery = admin
        .from('checkout_v2_guarantee_operations')
        .select(`
            id,
            subscription_id,
            payment_id,
            second_session_id,
            gross_amount_cents,
            refund_amount_cents,
            currency,
            status,
            stripe_refund_id,
            refund_status,
            created_at,
            updated_at,
            refund_created_at,
            refunded_at,
            support_ticket_id,
            last_error,
            subscription:subscriptions!checkout_v2_guarantee_operations_subscription_id_fkey (
                id,
                student_id,
                contract_schema_version,
                student:profiles!subscriptions_student_id_fkey (id, full_name, email)
            ),
            payment:payments!checkout_v2_guarantee_operations_payment_id_fkey (
                id, amount, amount_refunded, currency, status
            ),
            support_ticket:support_tickets!checkout_v2_guarantee_operations_support_ticket_id_fkey (
                id, status, issue_title
            )
        `);
    if (requestedStatus !== 'all') operationsQuery = operationsQuery.eq('status', requestedStatus);
    if (studentSubscriptionIds) operationsQuery = operationsQuery.in('subscription_id', studentSubscriptionIds);
    operationsQuery = operationsQuery
        .order('updated_at', { ascending: false })
        .limit(100);

    let incidentQuery = admin
        .from('sessions')
        .select(`
            id,
            subscription_id,
            status,
            scheduled_at,
            cancelled_at,
            cancelled_by,
            updated_at,
            subscription:subscriptions!sessions_subscription_id_fkey!inner (
                id,
                student_id,
                contract_schema_version,
                student:profiles!subscriptions_student_id_fkey (id, full_name, email)
            ),
            cycle:checkout_v2_cycles!sessions_checkout_v2_cycle_id_fkey!inner (id, cycle_number, cycle_kind)
        `)
        .eq('checkout_v2_cycle_session_index', 2)
        .in('status', ['cancelled', 'no_show'])
        .eq('subscription.contract_schema_version', 2)
        .eq('cycle.cycle_number', 1)
        .eq('cycle.cycle_kind', 'initial');
    if (studentSubscriptionIds) incidentQuery = incidentQuery.in('subscription_id', studentSubscriptionIds);
    incidentQuery = incidentQuery
        .order('updated_at', { ascending: false })
        .limit(100);

    const [operationsResult, incidentResult] = await Promise.all([operationsQuery, incidentQuery]);
    if (operationsResult.error || incidentResult.error) {
        console.error('[AdminGuarantees] Could not load guarantee operations');
        return json({ error: 'Could not load guarantee operations' }, 500);
    }

    const operationRows = (operationsResult.data ?? []) as OperationRow[];
    const sessionRows = (incidentResult.data ?? []) as IncidentSessionRow[];
    const sessionIds = sessionRows.map((session) => session.id);
    const incidentSubscriptionIds = [...new Set(sessionRows.map((session) => session.subscription_id))];
    let resolutions: ResolutionRow[] = [];
    const operationSubscriptions = new Set<string>();
    if (sessionIds.length > 0 && incidentSubscriptionIds.length > 0) {
        const [resolutionResult, incidentOperationsResult] = await Promise.all([
            admin
            .from('checkout_v2_session_incident_resolutions')
            .select('id, session_id, admin_id, original_status, incident_at, reason, created_at')
            .in('session_id', sessionIds),
            admin
                .from('checkout_v2_guarantee_operations')
                .select('subscription_id')
                .in('subscription_id', incidentSubscriptionIds),
        ]);
        if (resolutionResult.error || incidentOperationsResult.error) {
            console.error('[AdminGuarantees] Could not load incident guards');
            return json({ error: 'Could not load guarantee incident resolutions' }, 500);
        }
        resolutions = (resolutionResult.data ?? []) as ResolutionRow[];
        for (const row of (incidentOperationsResult.data ?? []) as Array<{ subscription_id: string }>) {
            operationSubscriptions.add(row.subscription_id);
        }
    }

    const mappedOperations = operationRows.map(mapOperation)
        .filter((operation) => !studentId || operation.student?.id === studentId);
    const resolutionBySession = new Map(resolutions.map((resolution) => [resolution.session_id, resolution]));
    const incidents = sessionRows.flatMap((session) => {
        const subscription = relationOne(session.subscription);
        const student = relationOne(subscription?.student);
        const cycle = relationOne(session.cycle);
        if (!subscription
            || subscription.contract_schema_version !== 2
            || !student
            || cycle?.cycle_number !== 1
            || cycle.cycle_kind !== 'initial') return [];
        if (studentId && student.id !== studentId) return [];
        const resolution = resolutionBySession.get(session.id) ?? null;
        const isEligibleIncident = session.status === 'no_show'
            || isLateStudentCancellation(session, student.id);
        if (!isEligibleIncident && !resolution) return [];
        return [{
            sessionId: session.id,
            subscriptionId: subscription.id,
            student: {
                id: student.id,
                fullName: student.full_name,
                email: student.email,
            },
            originalStatus: session.status,
            scheduledAt: session.scheduled_at,
            incidentAt: session.status === 'cancelled' ? session.cancelled_at : session.updated_at,
            canExcuse: Boolean(isEligibleIncident && !resolution && !operationSubscriptions.has(subscription.id)),
            resolution,
        }];
    });

    return json({ operations: mappedOperations, incidents });
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
    if (!parsed.success) return json({ error: 'Invalid guarantee action' }, 400);

    if (parsed.data.action === 'resume') {
        try {
            const result = await resumeCheckoutV2GuaranteeOperation({
                context,
                operationId: parsed.data.operationId,
            });
            if (result.operationId) triggerFulfillmentProcessing(context, 5);
            return json({ guarantee: result }, responseStatus(result));
        } catch (error) {
            if (error instanceof CheckoutV2GuaranteeError) {
                return json({ guarantee: error.guarantee }, error.status);
            }
            console.error('[AdminGuarantees] Could not resume guarantee operation');
            return json({ error: 'Could not resume guarantee operation' }, 500);
        }
    }

    if (parsed.data.action === 'reconcile_refund') {
        try {
            const result = await reconcileCheckoutV2GuaranteeRefundOperation({
                context,
                operationId: parsed.data.operationId,
            });
            if (result.operationId) triggerFulfillmentProcessing(context, 5);
            return json({ guarantee: result }, responseStatus(result));
        } catch (error) {
            if (error instanceof CheckoutV2GuaranteeError) {
                return json({ guarantee: error.guarantee }, error.status);
            }
            console.error('[AdminGuarantees] Could not reconcile existing guarantee refund');
            return json({ error: 'Could not reconcile existing guarantee refund' }, 500);
        }
    }

    if (parsed.data.action === 'resolve_review') {
        try {
            const result = await resolveCheckoutV2GuaranteeReview({
                context,
                operationId: parsed.data.operationId,
                adminId: auth.user.id,
                reason: parsed.data.reason,
            });
            if (result.operationId) triggerFulfillmentProcessing(context, 5);
            return json({ guarantee: result }, responseStatus(result));
        } catch (error) {
            if (error instanceof CheckoutV2GuaranteeError) {
                return json({ guarantee: error.guarantee }, error.status);
            }
            console.error('[AdminGuarantees] Could not resolve guarantee review');
            return json({ error: 'Could not resolve guarantee review' }, 500);
        }
    }

    const admin = createSupabaseAdminClient() as unknown as UntypedAdminClient;
    const { data, error } = await admin.rpc('excuse_checkout_v2_guarantee_incident', {
        p_session_id: parsed.data.sessionId,
        p_admin_id: auth.user.id,
        p_reason: parsed.data.reason,
    });
    if (error || !data) {
        const message = error?.message ?? '';
        const status = message.includes('forbidden') ? 403
            : message.includes('not_found') ? 404
                : message.includes('invalid_') ? 400
                    : message.includes('after_request') || message.includes('cannot_be_excused') ? 409
                        : 500;
        if (status === 500) console.error('[AdminGuarantees] Could not excuse guarantee incident');
        return json({ error: 'Could not record the incident resolution' }, status);
    }
    return json({ resolution: data }, 200);
};
