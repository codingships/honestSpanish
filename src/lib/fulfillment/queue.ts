import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../types/database.types';

export type FulfillmentJobType =
    | 'session_fulfillment'
    | 'bulk_session_fulfillment'
    | 'welcome_fulfillment'
    | 'session_cancellation'
    | 'session_reschedule'
    | 'guarantee_refund'
    | 'renewal_notice';

export type FulfillmentJobPayload = {
    sessionId?: string;
    sessionIds?: string[];
    userId?: string;
    packageId?: string;
    packageKey?: string;
    packageDisplayName?: Json;
    subscriptionId?: string | null;
    durationMonths?: number;
    billingIntervalUnit?: 'day' | 'week' | 'month' | 'year';
    billingIntervalCount?: number;
    startsAt?: string;
    endsAt?: string;
    sessionsTotal?: number;
    amountTotal?: number;
    currency?: string;
    legalPolicyVersion?: string;
    policyAcceptedAt?: string;
    autoCreateMeeting?: boolean;
    sendEmail?: boolean;
    cancelledBy?: 'admin' | 'teacher' | 'student' | 'guarantee';
    reason?: string | null;
    operationId?: string;
    previousScheduledAt?: string;
    scheduledAt?: string;
    stripeEventId?: string;
    stripeInvoiceId?: string;
    stripeSubscriptionId?: string;
    renewalAt?: string;
    cancelBy?: string;
    refundAmount?: number;
    smokeMarker?: string;
    smokeRunId?: string;
};

export type FulfillmentJobRow = Database['public']['Tables']['fulfillment_jobs']['Row'];

export function asFulfillmentPayload(value: Json | null): FulfillmentJobPayload {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as FulfillmentJobPayload
        : {};
}

export function isMissingJobsTable(error: { code?: string; message?: string } | null): boolean {
    return error?.code === '42P01' || error?.message?.includes('fulfillment_jobs') === true;
}

export async function enqueueFulfillmentJob(
    supabaseAdmin: SupabaseClient<Database>,
    input: {
        jobType: FulfillmentJobType;
        sessionId?: string | null;
        subscriptionId?: string | null;
        studentId?: string | null;
        payload: FulfillmentJobPayload;
        runAt?: string;
        dedupeKey?: string | null;
    }
): Promise<boolean> {
    const { error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .insert({
            job_type: input.jobType,
            session_id: input.sessionId ?? null,
            subscription_id: input.subscriptionId ?? null,
            student_id: input.studentId ?? null,
            dedupe_key: input.dedupeKey ?? null,
            payload: input.payload as Json,
            run_at: input.runAt ?? new Date().toISOString(),
        });

    if (error) {
        if (error.code === '23505' && input.dedupeKey) {
            return true;
        }
        if (isMissingJobsTable(error)) {
            console.warn('[Fulfillment] fulfillment_jobs table is missing; cannot enqueue background work');
            return false;
        }
        throw error;
    }

    return true;
}

export async function enqueueRenewalNotice(
    supabaseAdmin: SupabaseClient<Database>,
    input: {
        stripeEventId: string;
        stripeInvoiceId?: string;
        stripeSubscriptionId: string;
        userId: string;
        packageId: string;
        packageKey?: string;
        packageDisplayName?: Json;
        subscriptionId: string;
        renewalAt: string;
        cancelBy: string;
        durationMonths?: number;
        billingIntervalUnit?: 'day' | 'week' | 'month' | 'year';
        billingIntervalCount?: number;
        amountTotal: number;
        currency: string;
    }
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'renewal_notice',
        subscriptionId: input.subscriptionId,
        studentId: input.userId,
        dedupeKey: `renewal_notice:${input.stripeSubscriptionId}:${input.renewalAt}`,
        payload: input,
    });
}

export async function enqueueSessionFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    session: Pick<Database['public']['Tables']['sessions']['Row'], 'id' | 'subscription_id' | 'student_id'>,
    options: { autoCreateMeeting?: boolean; sendEmail?: boolean } = {}
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'session_fulfillment',
        sessionId: session.id,
        subscriptionId: session.subscription_id,
        studentId: session.student_id,
        payload: {
            sessionId: session.id,
            autoCreateMeeting: options.autoCreateMeeting ?? true,
            sendEmail: options.sendEmail ?? true,
        },
    });
}

export async function enqueueBulkSessionFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    sessions: Pick<Database['public']['Tables']['sessions']['Row'], 'id' | 'subscription_id' | 'student_id'>[],
    options: { autoCreateMeeting?: boolean; sendEmail?: boolean } = {}
): Promise<boolean> {
    if (sessions.length === 0) return true;

    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'bulk_session_fulfillment',
        subscriptionId: sessions[0].subscription_id,
        studentId: sessions[0].student_id,
        payload: {
            sessionIds: sessions.map((session) => session.id),
            autoCreateMeeting: options.autoCreateMeeting ?? true,
            sendEmail: options.sendEmail ?? true,
        },
    });
}

export async function enqueueWelcomeFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    input: {
        userId: string;
        packageId: string;
        packageKey?: string;
        packageDisplayName?: Json;
        subscriptionId?: string | null;
        durationMonths?: number;
        startsAt?: string;
        endsAt?: string;
        sessionsTotal?: number;
        amountTotal?: number;
        currency?: string;
        legalPolicyVersion?: string;
        policyAcceptedAt?: string;
    }
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'welcome_fulfillment',
        subscriptionId: input.subscriptionId ?? null,
        studentId: input.userId,
        payload: input,
    });
}

export async function enqueueSessionCancellation(
    supabaseAdmin: SupabaseClient<Database>,
    input: {
        sessionId: string;
        subscriptionId?: string | null;
        studentId?: string | null;
        cancelledBy: 'admin' | 'teacher' | 'student';
        reason?: string | null;
    }
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'session_cancellation',
        sessionId: input.sessionId,
        subscriptionId: input.subscriptionId ?? null,
        studentId: input.studentId ?? null,
        payload: {
            sessionId: input.sessionId,
            cancelledBy: input.cancelledBy,
            reason: input.reason ?? null,
        },
    });
}

export async function enqueueSessionReschedule(
    supabaseAdmin: SupabaseClient<Database>,
    input: {
        operationId: string;
        sessionId: string;
        subscriptionId?: string | null;
        studentId?: string | null;
        previousScheduledAt: string;
        scheduledAt: string;
        sendEmail?: boolean;
    }
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'session_reschedule',
        sessionId: input.sessionId,
        subscriptionId: input.subscriptionId ?? null,
        studentId: input.studentId ?? null,
        dedupeKey: `checkout_v2_reschedule:${input.operationId}:${input.sessionId}`,
        payload: {
            operationId: input.operationId,
            sessionId: input.sessionId,
            previousScheduledAt: input.previousScheduledAt,
            scheduledAt: input.scheduledAt,
            sendEmail: input.sendEmail ?? true,
        },
    });
}
