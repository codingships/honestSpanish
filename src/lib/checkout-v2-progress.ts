import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';

export type CheckoutV2CycleProgress =
    Database['public']['Views']['checkout_v2_cycle_progress']['Row'];

export type CheckoutV2AcademicProgress =
    | { state: 'ready'; consumed: number; total: number }
    | { state: 'pending' | 'legacy' | 'missing' | 'inconsistent' };

const progressSelection = 'cycle_id, subscription_id, student_id, cycle_number, cycle_kind, starts_at, ends_at, materialization_state, sessions_materialized_at, sessions_total, sessions_materialized, sessions_scheduled, sessions_completed, sessions_no_show, sessions_late_student_cancelled, sessions_restored, sessions_consumed, sessions_remaining, progress_state';
const progressBatchSize = 500;

export const loadLatestCheckoutV2Progress = async (
    supabaseAdmin: SupabaseClient<Database>,
    subscriptionIds: readonly string[],
): Promise<Map<string, CheckoutV2CycleProgress>> => {
    const uniqueIds = [...new Set(subscriptionIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const batches = Array.from(
        { length: Math.ceil(uniqueIds.length / progressBatchSize) },
        (_, index) => uniqueIds.slice(index * progressBatchSize, (index + 1) * progressBatchSize),
    );
    const results = await Promise.all(batches.map((p_subscription_ids) => (
        supabaseAdmin.rpc('get_checkout_v2_subscriptions_progress', { p_subscription_ids })
    )));

    const latestBySubscription = new Map<string, CheckoutV2CycleProgress>();
    for (const { data, error } of results) {
        if (error) {
            throw new Error('checkout_v2_progress_load_failed', { cause: error });
        }
        for (const row of data ?? []) {
            if (!row.subscription_id) continue;
            latestBySubscription.set(row.subscription_id, row);
        }
    }

    return latestBySubscription;
};

export const loadCheckoutV2ProgressHistory = async (
    supabaseAdmin: SupabaseClient<Database>,
    subscriptionIds: readonly string[],
): Promise<Map<string, CheckoutV2CycleProgress[]>> => {
    const uniqueIds = [...new Set(subscriptionIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const { data, error } = await supabaseAdmin
        .from('checkout_v2_cycle_progress')
        .select(progressSelection)
        .in('subscription_id', uniqueIds)
        .order('cycle_number', { ascending: false });

    if (error) {
        throw new Error('checkout_v2_progress_load_failed', { cause: error });
    }

    const historyBySubscription = new Map<string, CheckoutV2CycleProgress[]>();
    for (const row of data ?? []) {
        if (!row.subscription_id) continue;
        const history = historyBySubscription.get(row.subscription_id) ?? [];
        history.push(row);
        historyBySubscription.set(row.subscription_id, history);
    }

    return historyBySubscription;
};

export const loadCheckoutV2ProgressForSubscription = async (
    supabaseAdmin: SupabaseClient<Database>,
    subscriptionId: string,
): Promise<CheckoutV2CycleProgress | null> => {
    const progress = await loadLatestCheckoutV2Progress(supabaseAdmin, [subscriptionId]);
    return progress.get(subscriptionId) ?? null;
};

export const hasUsableCheckoutV2Progress = (
    progress: CheckoutV2CycleProgress | null | undefined,
): progress is CheckoutV2CycleProgress & { progress_state: 'ready' } => (
    progress?.progress_state === 'ready'
);

export const resolveCheckoutV2AcademicProgress = (
    contractSchemaVersion: number | null | undefined,
    progress: CheckoutV2CycleProgress | null | undefined,
): CheckoutV2AcademicProgress => {
    if (contractSchemaVersion !== 2) return { state: 'legacy' };
    if (!progress) return { state: 'missing' };
    if (progress.progress_state === 'pending') return { state: 'pending' };

    if (
        hasUsableCheckoutV2Progress(progress)
        && typeof progress.sessions_consumed === 'number'
        && typeof progress.sessions_total === 'number'
        && progress.sessions_total > 0
        && progress.sessions_consumed >= 0
        && progress.sessions_consumed <= progress.sessions_total
    ) {
        return {
            state: 'ready',
            consumed: progress.sessions_consumed,
            total: progress.sessions_total,
        };
    }

    return { state: 'inconsistent' };
};
