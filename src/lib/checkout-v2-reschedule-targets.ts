import type { APIContext } from 'astro';
import {
    CheckoutV2RescheduleError,
    checkoutV2DatabaseFailure,
    type CheckoutV2RescheduleOperation,
} from './checkout-v2-reschedule';
import { shouldDisableExternalIntegrations } from './external-integrations';
import { deterministicClassEventId } from './google/calendar';
import {
    filterSlotsAgainstGoogleViaInternalService,
    isInternalJobServiceConfigured,
} from './internal-job-service';
import { createSupabaseAdminClient } from './supabase-admin';

type DatabaseError = { code?: string; message?: string };

type RawRescheduleTarget = {
    target_scheduled_at: unknown;
    operation_kind: unknown;
    affected_scheduled_ats: unknown;
};

type SourceSession = {
    id: string;
    teacher_id: string | null;
    duration_minutes: number;
    checkout_v2_cycle_id: string | null;
    calendar_event_id: string | null;
};

type CalendarIdentity = {
    id: string;
    calendar_event_id: string | null;
};

type RecordedRescheduleRequest = {
    id: string;
    request_id: string;
    session_id: string;
    actor_id: string;
    new_scheduled_at: string;
    operation_kind: unknown;
    status: unknown;
    stripe_mutation_started_at: unknown;
};

export type CheckoutV2RescheduleTarget = {
    scheduledAt: string;
    operationKind: CheckoutV2RescheduleOperation['operation_kind'];
    affectedScheduledAts: string[];
};

export type CheckoutV2RescheduleTargetWindow = {
    sessionId: string;
    from: string;
    to: string;
};

export type CheckoutV2ReschedulePreflight =
    | { mode: 'fresh' }
    | { mode: 'revalidate'; ignoredPendingRequestId: string; operationId: string }
    | { mode: 'reconcile' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WHOLE_SECOND_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.0{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/;
const MAX_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_TARGETS = 256;

function wholeSecondIso(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = WHOLE_SECOND_PATTERN.exec(value);
    if (!match) return null;

    const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetSign, offsetHourText, offsetMinuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
    const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
    if (
        year < 1
        || month < 1 || month > 12
        || day < 1 || day > 31
        || hour > 23
        || minute > 59
        || second > 59
        || offsetHour > 14
        || offsetMinute > 59
        || (offsetHour === 14 && offsetMinute !== 0)
    ) return null;

    const offsetMinutes = offsetSign
        ? (offsetHour * 60 + offsetMinute) * (offsetSign === '+' ? 1 : -1)
        : 0;
    const utcMillis = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
    const parsed = new Date(utcMillis);
    if (
        Number.isNaN(parsed.getTime())
        || parsed.getUTCFullYear() < 1
        || parsed.getTime() % 1000 !== 0
    ) return null;

    const wallClock = new Date(utcMillis + offsetMinutes * 60_000);
    if (
        wallClock.getUTCFullYear() !== year
        || wallClock.getUTCMonth() !== month - 1
        || wallClock.getUTCDate() !== day
        || wallClock.getUTCHours() !== hour
        || wallClock.getUTCMinutes() !== minute
        || wallClock.getUTCSeconds() !== second
    ) return null;
    return parsed.toISOString();
}

export function normalizeCheckoutV2RescheduleTargetWindow(value: {
    sessionId: unknown;
    from: unknown;
    to: unknown;
}): CheckoutV2RescheduleTargetWindow | null {
    if (typeof value.sessionId !== 'string' || !UUID_PATTERN.test(value.sessionId)) return null;
    const from = wholeSecondIso(value.from);
    const to = wholeSecondIso(value.to);
    if (!from || !to) return null;
    const windowMs = Date.parse(to) - Date.parse(from);
    if (windowMs <= 0 || windowMs > MAX_WINDOW_MS) return null;
    return { sessionId: value.sessionId, from, to };
}

function normalizeTarget(value: RawRescheduleTarget): CheckoutV2RescheduleTarget | null {
    const scheduledAt = wholeSecondIso(value.target_scheduled_at);
    const operationKind = value.operation_kind;
    if (
        !scheduledAt
        || (operationKind !== 'single_session' && operationKind !== 'provisional_anchor')
        || !Array.isArray(value.affected_scheduled_ats)
    ) return null;

    const affectedScheduledAts = value.affected_scheduled_ats.map(wholeSecondIso);
    if (affectedScheduledAts.some((timestamp) => timestamp === null)) return null;
    const affected = affectedScheduledAts as string[];
    const expectedLength = operationKind === 'provisional_anchor' ? 4 : 1;
    if (
        affected.length !== expectedLength
        || affected[0] !== scheduledAt
        || new Set(affected).size !== affected.length
        || affected.some((timestamp, index) => index > 0 && Date.parse(timestamp) <= Date.parse(affected[index - 1]))
    ) return null;

    return { scheduledAt, operationKind, affectedScheduledAts: affected };
}

async function loadCalendarContext(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    sessionId: string,
    operationKind: CheckoutV2RescheduleOperation['operation_kind'],
): Promise<{ teacherEmail: string; durationMinutes: number; ignoredEventIds: string[] }> {
    const { data: rawSource, error: sourceError } = await supabaseAdmin
        .from('sessions')
        .select('id, teacher_id, duration_minutes, checkout_v2_cycle_id, calendar_event_id')
        .eq('id', sessionId)
        .maybeSingle();
    if (sourceError) throw checkoutV2DatabaseFailure(sourceError as DatabaseError);
    const source = rawSource as SourceSession | null;
    if (!source?.teacher_id) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_NOT_FOUND', 404);
    }

    const { data: rawTeacher, error: teacherError } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', source.teacher_id)
        .maybeSingle();
    if (teacherError) throw checkoutV2DatabaseFailure(teacherError as DatabaseError);
    const teacherEmail = typeof rawTeacher?.email === 'string' ? rawTeacher.email.trim() : '';
    if (!teacherEmail) throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);

    let identities: CalendarIdentity[] = [{ id: source.id, calendar_event_id: source.calendar_event_id }];
    if (operationKind === 'provisional_anchor') {
        if (!source.checkout_v2_cycle_id) {
            throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
        }
        const { data: rawIdentities, error: identitiesError } = await supabaseAdmin
            .from('sessions')
            .select('id, calendar_event_id')
            .eq('checkout_v2_cycle_id', source.checkout_v2_cycle_id)
            .order('checkout_v2_cycle_session_index', { ascending: true });
        if (identitiesError) throw checkoutV2DatabaseFailure(identitiesError as DatabaseError);
        identities = (rawIdentities ?? []) as CalendarIdentity[];
        if (identities.length !== 4) {
            throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
        }
    }

    return {
        teacherEmail,
        durationMinutes: source.duration_minutes,
        ignoredEventIds: identities.map((identity) => (
            identity.calendar_event_id ?? deterministicClassEventId(identity.id)
        )),
    };
}

async function filterTargetsAgainstGoogle(
    context: Pick<APIContext, 'locals'>,
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    sessionId: string,
    targets: CheckoutV2RescheduleTarget[],
): Promise<CheckoutV2RescheduleTarget[]> {
    if (targets.length === 0 || shouldDisableExternalIntegrations()) return targets;
    if (!isInternalJobServiceConfigured(context)) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }

    const operationKind = targets[0].operationKind;
    if (targets.some((target) => target.operationKind !== operationKind)) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }
    const calendarContext = await loadCalendarContext(supabaseAdmin, sessionId, operationKind);
    const slotsByStart = new Map<string, { slot_start: string; slot_end: string }>();
    for (const target of targets) {
        for (const scheduledAt of target.affectedScheduledAts) {
            slotsByStart.set(scheduledAt, {
                slot_start: scheduledAt,
                slot_end: new Date(
                    Date.parse(scheduledAt) + calendarContext.durationMinutes * 60_000,
                ).toISOString(),
            });
        }
    }
    const slots = [...slotsByStart.values()].sort((left, right) => (
        Date.parse(left.slot_start) - Date.parse(right.slot_start)
    ));

    let availableSlots: typeof slots;
    try {
        availableSlots = await filterSlotsAgainstGoogleViaInternalService(context, {
            teacherEmail: calendarContext.teacherEmail,
            slots,
            ignoredEventIds: calendarContext.ignoredEventIds,
        });
    } catch {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }
    const availableStarts = new Set(availableSlots.map((slot) => wholeSecondIso(slot.slot_start)));
    return targets.filter((target) => (
        target.affectedScheduledAts.every((timestamp) => availableStarts.has(timestamp))
    ));
}

export async function listCheckoutV2RescheduleTargets(input: {
    context: Pick<APIContext, 'locals'>;
    actorId: string;
    sessionId: string;
    from: string;
    to: string;
    ignoredPendingRequestId?: string | null;
}): Promise<CheckoutV2RescheduleTarget[]> {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('list_checkout_v2_reschedule_targets', {
        p_session_id: input.sessionId,
        p_actor_id: input.actorId,
        p_from: input.from,
        p_to: input.to,
        p_ignored_pending_request_id: input.ignoredPendingRequestId ?? null,
    });
    if (error) throw checkoutV2DatabaseFailure(error as DatabaseError);
    if (!Array.isArray(data) || data.length > MAX_TARGETS) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }

    const normalized = (data as RawRescheduleTarget[]).map(normalizeTarget);
    if (normalized.some((target) => target === null)) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }
    const targets = normalized as CheckoutV2RescheduleTarget[];
    if (new Set(targets.map((target) => target.scheduledAt)).size !== targets.length) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }
    targets.sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
    return filterTargetsAgainstGoogle(input.context, supabaseAdmin, input.sessionId, targets);
}

export async function assertCheckoutV2RescheduleTargetAvailable(input: {
    context: Pick<APIContext, 'locals'>;
    actorId: string;
    sessionId: string;
    newScheduledAt: string;
    ignoredPendingRequestId?: string | null;
}): Promise<CheckoutV2RescheduleTarget> {
    const from = wholeSecondIso(input.newScheduledAt);
    if (!from) throw new CheckoutV2RescheduleError('RESCHEDULE_CONFLICT', 409);
    const to = new Date(Date.parse(from) + 1000).toISOString();
    const targets = await listCheckoutV2RescheduleTargets({ ...input, from, to });
    const exactTarget = targets.find((target) => target.scheduledAt === from);
    if (!exactTarget) throw new CheckoutV2RescheduleError('RESCHEDULE_CONFLICT', 409);
    return exactTarget;
}

export async function classifyCheckoutV2ReschedulePreflight(input: {
    requestId: string;
    sessionId: string;
    actorId: string;
    newScheduledAt: string;
}): Promise<CheckoutV2ReschedulePreflight> {
    const supabaseAdmin = createSupabaseAdminClient();
    const query = supabaseAdmin
        .from('checkout_v2_reschedule_operations')
        .select('id, request_id, session_id, actor_id, new_scheduled_at, operation_kind, status, stripe_mutation_started_at')
        .eq('request_id', input.requestId)
        .eq('session_id', input.sessionId)
        .eq('actor_id', input.actorId)
        .eq('new_scheduled_at', input.newScheduledAt);
    const { data, error } = await query
        .maybeSingle();
    if (error) throw checkoutV2DatabaseFailure(error as DatabaseError);
    if (data === null) return { mode: 'fresh' };

    const operation = data as RecordedRescheduleRequest;
    const newScheduledAt = wholeSecondIso(operation.new_scheduled_at);
    const mutationStartedAt = operation.stripe_mutation_started_at === null
        ? null
        : wholeSecondIso(operation.stripe_mutation_started_at);
    if (
        !UUID_PATTERN.test(operation.id)
        || operation.request_id !== input.requestId
        || operation.session_id !== input.sessionId
        || operation.actor_id !== input.actorId
        || newScheduledAt !== input.newScheduledAt
        || (operation.operation_kind !== 'single_session' && operation.operation_kind !== 'provisional_anchor')
        || !['requested', 'applied', 'failed', 'manual_review'].includes(String(operation.status))
        || (operation.stripe_mutation_started_at !== null && mutationStartedAt === null)
    ) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503);
    }

    if (operation.status === 'requested' && mutationStartedAt === null) {
        return {
            mode: 'revalidate',
            ignoredPendingRequestId: input.requestId,
            operationId: operation.id,
        };
    }
    return { mode: 'reconcile' };
}

export async function failCheckoutV2ReschedulePreflightConflict(input: {
    operationId: string;
    requestId: string;
    sessionId: string;
    actorId: string;
    newScheduledAt: string;
}): Promise<void> {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.rpc('mark_checkout_v2_reschedule_outcome', {
        p_operation_id: input.operationId,
        p_status: 'failed',
        p_last_error: 'target_revalidation_conflict',
        p_observed_stripe_anchor_at: null,
    });
    if (error) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409);
    }
    const operation = data as Partial<CheckoutV2RescheduleOperation> | null;
    if (
        !operation
        || operation.id !== input.operationId
        || operation.request_id !== input.requestId
        || operation.session_id !== input.sessionId
        || operation.actor_id !== input.actorId
        || wholeSecondIso(operation.new_scheduled_at) !== input.newScheduledAt
        || operation.status !== 'failed'
        || operation.last_error !== 'target_revalidation_conflict'
        || operation.stripe_mutation_started_at !== null
    ) {
        throw new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409);
    }
}
