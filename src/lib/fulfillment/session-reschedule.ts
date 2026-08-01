import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database.types';
import { sendCheckoutV2CycleRescheduled, sendClassRescheduled } from '../email';
import { updateCalendarEvent } from '../google/calendar';
import { DEFAULT_CLASS_DURATION_MINUTES } from '../class-duration';
import { INITIAL_INDIVIDUAL_OFFER, PACKAGE_CURRENCY_CODE } from '../package-pricing';
import {
    FulfillmentEffectError,
    runFulfillmentCalendarPatchEffect,
} from './effects';
import { FulfillmentDependencyPendingError } from './dependency';
import type { FulfillmentJobPayload, FulfillmentJobRow } from './queue';

type ProfileJoin = {
    id: string;
    email?: string | null;
    full_name?: string | null;
    preferred_language?: string | null;
};

type RescheduleSession = Pick<
    Database['public']['Tables']['sessions']['Row'],
    | 'id'
    | 'student_id'
    | 'teacher_id'
    | 'subscription_id'
    | 'checkout_v2_cycle_id'
    | 'checkout_v2_cycle_session_index'
    | 'scheduled_at'
    | 'duration_minutes'
    | 'calendar_event_id'
    | 'meet_link'
    | 'drive_doc_url'
    | 'status'
> & {
    student?: ProfileJoin | ProfileJoin[] | null;
    teacher?: ProfileJoin | ProfileJoin[] | null;
};

type RescheduleOperation = Pick<
    Database['public']['Tables']['checkout_v2_reschedule_operations']['Row'],
    | 'id'
    | 'session_id'
    | 'subscription_id'
    | 'cycle_id'
    | 'operation_kind'
    | 'new_scheduled_at'
    | 'target_stripe_anchor_at'
    | 'status'
>;

type CycleSession = Pick<
    Database['public']['Tables']['sessions']['Row'],
    | 'id'
    | 'student_id'
    | 'teacher_id'
    | 'subscription_id'
    | 'checkout_v2_cycle_id'
    | 'checkout_v2_cycle_session_index'
    | 'scheduled_at'
    | 'duration_minutes'
    | 'status'
>;

type WeeklyAllocation = Pick<
    Database['public']['Tables']['checkout_v2_weekly_allocations']['Row'],
    'subscription_id' | 'teacher_id' | 'duration_minutes' | 'timezone_name' | 'status'
>;

type RescheduleBarrierJob = Pick<
    Database['public']['Tables']['fulfillment_jobs']['Row'],
    | 'id'
    | 'job_type'
    | 'session_id'
    | 'subscription_id'
    | 'dedupe_key'
    | 'status'
    | 'attempts'
    | 'max_attempts'
>;

type CalendarBarrierEffect = Pick<
    Database['public']['Tables']['fulfillment_effects']['Row'],
    'job_id' | 'effect_key' | 'status'
>;

export { FulfillmentDependencyPendingError } from './dependency';

function one<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function locale(value: unknown): 'es' | 'en' | 'ru' {
    return value === 'es' || value === 'ru' ? value : 'en';
}

function requiredDate(value: unknown, field: string): Date {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`session_reschedule requires ${field}`);
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new Error(`session_reschedule requires a valid ${field}`);
    }
    return date;
}

function effectContext(
    supabaseAdmin: SupabaseClient<Database>,
    job: FulfillmentJobRow,
    effectKey: string,
) {
    if (!job.locked_by) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_INVALID_CONTEXT', true);
    }
    return {
        effectKey,
        jobId: job.id,
        leaseOwner: job.locked_by,
        supabaseAdmin,
    };
}

async function loadSession(
    supabaseAdmin: SupabaseClient<Database>,
    sessionId: string,
): Promise<RescheduleSession> {
    const { data, error } = await supabaseAdmin
        .from('sessions')
        .select(`
            id,
            student_id,
            teacher_id,
            subscription_id,
            checkout_v2_cycle_id,
            checkout_v2_cycle_session_index,
            scheduled_at,
            duration_minutes,
            calendar_event_id,
            meet_link,
            drive_doc_url,
            status,
            student:profiles!sessions_student_id_fkey(id, full_name, email, preferred_language),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email, preferred_language)
        `)
        .eq('id', sessionId)
        .single();
    if (error || !data) throw error ?? new Error('Session not found for reschedule fulfillment');
    return data as unknown as RescheduleSession;
}

async function loadOperation(
    supabaseAdmin: SupabaseClient<Database>,
    operationId: string,
): Promise<RescheduleOperation> {
    const { data, error } = await supabaseAdmin
        .from('checkout_v2_reschedule_operations')
        .select(`
            id,
            session_id,
            subscription_id,
            cycle_id,
            operation_kind,
            new_scheduled_at,
            target_stripe_anchor_at,
            status
        `)
        .eq('id', operationId)
        .single();
    if (error || !data) throw error ?? new Error('Reschedule operation not found for fulfillment');
    return data;
}

async function loadProvisionalCycle(
    supabaseAdmin: SupabaseClient<Database>,
    operation: RescheduleOperation,
): Promise<{ sessions: CycleSession[]; allocation: WeeklyAllocation }> {
    const [{ data: sessions, error: sessionsError }, { data: allocation, error: allocationError }] = await Promise.all([
        supabaseAdmin
            .from('sessions')
            .select(`
                id,
                student_id,
                teacher_id,
                subscription_id,
                checkout_v2_cycle_id,
                checkout_v2_cycle_session_index,
                scheduled_at,
                duration_minutes,
                status
            `)
            .eq('checkout_v2_cycle_id', operation.cycle_id)
            .order('checkout_v2_cycle_session_index', { ascending: true }),
        supabaseAdmin
            .from('checkout_v2_weekly_allocations')
            .select('subscription_id, teacher_id, duration_minutes, timezone_name, status')
            .eq('subscription_id', operation.subscription_id)
            .eq('status', 'active')
            .single(),
    ]);
    if (sessionsError || !sessions) {
        throw sessionsError ?? new Error('Checkout V2 reschedule cycle not found');
    }
    if (allocationError || !allocation) {
        throw allocationError ?? new Error('Checkout V2 reschedule allocation not found');
    }
    return { sessions, allocation };
}

function assertProvisionalCycleCoherent(
    operation: RescheduleOperation,
    primarySession: RescheduleSession,
    sessions: CycleSession[],
    allocation: WeeklyAllocation,
): { classStartsAt: string[]; renewalAnchorAt: string; timezoneName: string } {
    const primaryStudentId = primarySession.student_id;
    const primaryTeacherId = primarySession.teacher_id;
    const classStartsAt = sessions.map((session) => session.scheduled_at);
    const renewalAnchorAt = operation.target_stripe_anchor_at;
    const firstClassAt = new Date(operation.new_scheduled_at);
    const renewalAt = new Date(renewalAnchorAt ?? '');
    if (
        operation.status !== 'applied'
        || sessions.length !== INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod
        || !primaryTeacherId
        || allocation.status !== 'active'
        || allocation.subscription_id !== operation.subscription_id
        || allocation.teacher_id !== primaryTeacherId
        || allocation.duration_minutes !== INITIAL_INDIVIDUAL_OFFER.classDurationMinutes
        || !allocation.timezone_name.trim()
        || classStartsAt.some((value) => !value || !Number.isFinite(new Date(value).getTime()))
        || sessions.some((session, index) => (
            session.checkout_v2_cycle_id !== operation.cycle_id
            || session.subscription_id !== operation.subscription_id
            || session.student_id !== primaryStudentId
            || session.teacher_id !== primaryTeacherId
            || session.status !== 'scheduled'
            || session.duration_minutes !== INITIAL_INDIVIDUAL_OFFER.classDurationMinutes
            || session.checkout_v2_cycle_session_index !== index + 1
        ))
        || sessions[0]?.id !== operation.session_id
        || new Date(sessions[0]?.scheduled_at ?? '').getTime() !== firstClassAt.getTime()
        || !Number.isFinite(firstClassAt.getTime())
        || !Number.isFinite(renewalAt.getTime())
        || renewalAt.getTime() !== firstClassAt.getTime()
            + INITIAL_INDIVIDUAL_OFFER.billingIntervalCount * 24 * 60 * 60 * 1000
    ) {
        throw new Error('Checkout V2 provisional reschedule state is incoherent');
    }
    return {
        classStartsAt: classStartsAt as string[],
        renewalAnchorAt: renewalAnchorAt as string,
        timezoneName: allocation.timezone_name,
    };
}

async function assertProvisionalCalendarBarrier(
    supabaseAdmin: SupabaseClient<Database>,
    operation: RescheduleOperation,
    sessions: CycleSession[],
    currentJob: FulfillmentJobRow,
): Promise<void> {
    const expectedJobs = new Map(sessions.map((session) => [
        `checkout_v2_reschedule:${operation.id}:${session.id}`,
        session.id,
    ]));
    const { data: jobs, error: jobsError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .select('id, job_type, session_id, subscription_id, dedupe_key, status, attempts, max_attempts')
        .eq('job_type', 'session_reschedule')
        .in('dedupe_key', [...expectedJobs.keys()]);
    if (jobsError || !jobs) {
        throw jobsError ?? new Error('Checkout V2 provisional reschedule jobs not found');
    }
    const typedJobs = jobs as RescheduleBarrierJob[];
    const jobIds = new Set<string>();
    const observedDedupeKeys = new Set<string>();
    if (typedJobs.length !== INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod) {
        throw new Error('Checkout V2 provisional reschedule Calendar barrier is incoherent');
    }
    for (const barrierJob of typedJobs) {
        const dedupeKey = barrierJob.dedupe_key;
        if (
            !dedupeKey
            || barrierJob.job_type !== 'session_reschedule'
            || barrierJob.subscription_id !== operation.subscription_id
            || barrierJob.session_id !== expectedJobs.get(dedupeKey)
            || (
                barrierJob.session_id === operation.session_id
                && barrierJob.id !== currentJob.id
            )
            || jobIds.has(barrierJob.id)
            || observedDedupeKeys.has(dedupeKey)
        ) {
            throw new Error('Checkout V2 provisional reschedule Calendar barrier is incoherent');
        }
        jobIds.add(barrierJob.id);
        observedDedupeKeys.add(dedupeKey);
    }
    if (typedJobs.some((barrierJob) => (
        barrierJob.status === 'cancelled'
        || (
            barrierJob.status === 'failed'
            && barrierJob.attempts >= barrierJob.max_attempts
        )
    ))) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }

    const { data: effects, error: effectsError } = await supabaseAdmin
        .from('fulfillment_effects')
        .select('job_id, effect_key, status')
        .in('job_id', [...jobIds])
        .eq('effect_key', 'calendar.session_reschedule');
    if (effectsError || !effects) {
        throw effectsError ?? new Error('Checkout V2 provisional reschedule Calendar effects not found');
    }
    const typedEffects = effects as CalendarBarrierEffect[];
    if (typedEffects.some((effect) => (
        effect.effect_key !== 'calendar.session_reschedule'
        || !jobIds.has(effect.job_id)
        || ['ambiguous', 'manual_review'].includes(effect.status)
    ))) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }
    const succeededJobIds = new Set(
        typedEffects
            .filter((effect) => effect.status === 'succeeded')
            .map((effect) => effect.job_id),
    );
    if (typedJobs.some((barrierJob) => (
        barrierJob.status === 'succeeded'
        && !succeededJobIds.has(barrierJob.id)
    ))) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }
    if (succeededJobIds.size !== INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod) {
        throw new FulfillmentDependencyPendingError(
            'checkout_v2_reschedule_waiting_for_all_calendar_effects',
        );
    }
}

export async function processSessionReschedule(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload,
    job: FulfillmentJobRow,
): Promise<void> {
    const sessionId = payload.sessionId || job.session_id;
    const operationIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (!sessionId || !payload.operationId || !operationIdPattern.test(payload.operationId)) {
        throw new Error('session_reschedule requires sessionId and operationId');
    }
    if (job.session_id && job.session_id !== sessionId) {
        throw new Error('session_reschedule session identity mismatch');
    }
    const previousDate = requiredDate(payload.previousScheduledAt, 'previousScheduledAt');
    const scheduledDate = requiredDate(payload.scheduledAt, 'scheduledAt');
    if (previousDate.getTime() === scheduledDate.getTime()) {
        throw new Error('session_reschedule requires a changed date');
    }

    const operation = await loadOperation(supabaseAdmin, payload.operationId);
    if (
        operation.id !== payload.operationId
        || operation.status !== 'applied'
        || operation.subscription_id !== job.subscription_id
        || !['single_session', 'provisional_anchor'].includes(operation.operation_kind)
        || (operation.operation_kind === 'single_session' && operation.session_id !== sessionId)
    ) {
        throw new Error('session_reschedule operation identity mismatch');
    }

    let session = await loadSession(supabaseAdmin, sessionId);
    if (
        session.subscription_id !== operation.subscription_id
        || session.checkout_v2_cycle_id !== operation.cycle_id
    ) {
        throw new Error('session_reschedule operation scope mismatch');
    }
    if (session.status !== 'scheduled') {
        console.info(JSON.stringify({
            event: 'session_reschedule_job_obsolete',
            operationId: payload.operationId,
            reason: 'session_no_longer_scheduled',
            sessionId,
        }));
        return;
    }
    if (!session.scheduled_at || new Date(session.scheduled_at).getTime() !== scheduledDate.getTime()) {
        console.info(JSON.stringify({
            event: 'session_reschedule_job_obsolete',
            operationId: payload.operationId,
            reason: 'newer_schedule_persisted',
            sessionId,
        }));
        return;
    }
    const duration = session.duration_minutes || DEFAULT_CLASS_DURATION_MINUTES;
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('session_reschedule requires a valid session duration');
    }

    if (!session.calendar_event_id) {
        throw new FulfillmentDependencyPendingError('session_reschedule_waiting_for_calendar_event');
    }

    const eventId = session.calendar_event_id;
    const endTime = new Date(scheduledDate.getTime() + duration * 60_000);
    await runFulfillmentCalendarPatchEffect(
        effectContext(supabaseAdmin, job, 'calendar.session_reschedule'),
        {
            eventId,
            operationId: payload.operationId,
            previousScheduledAt: previousDate.toISOString(),
            scheduledAt: scheduledDate.toISOString(),
        },
        () => updateCalendarEvent(eventId, {
            startTime: scheduledDate,
            endTime,
            operationId: payload.operationId,
        }),
    );

    session = await loadSession(supabaseAdmin, sessionId);
    if (session.status !== 'scheduled') {
        console.info(JSON.stringify({
            event: 'session_reschedule_notification_obsolete',
            operationId: payload.operationId,
            reason: 'session_no_longer_scheduled_after_calendar_effect',
            sessionId,
        }));
        return;
    }
    if (!session.scheduled_at || new Date(session.scheduled_at).getTime() !== scheduledDate.getTime()) {
        console.info(JSON.stringify({
            event: 'session_reschedule_notification_obsolete',
            operationId: payload.operationId,
            reason: 'newer_schedule_persisted_after_calendar_effect',
            sessionId,
        }));
        return;
    }

    if (payload.sendEmail === false) return;
    if (
        operation.operation_kind === 'provisional_anchor'
        && sessionId !== operation.session_id
    ) return;
    const student = one(session.student);
    const teacher = one(session.teacher);
    if (!student?.email || !teacher?.email) {
        throw new Error('Session reschedule email is missing student or teacher email');
    }
    if (operation.operation_kind === 'provisional_anchor') {
        if (scheduledDate.getTime() !== new Date(operation.new_scheduled_at).getTime()) {
            throw new Error('Checkout V2 provisional reschedule primary date is incoherent');
        }
        const cycle = await loadProvisionalCycle(supabaseAdmin, operation);
        const contract = assertProvisionalCycleCoherent(
            operation,
            session,
            cycle.sessions,
            cycle.allocation,
        );
        await assertProvisionalCalendarBarrier(supabaseAdmin, operation, cycle.sessions, job);
        const common = {
            classStartsAt: contract.classStartsAt,
            renewalAnchorAt: contract.renewalAnchorAt,
            timezoneName: contract.timezoneName,
            amountCents: INITIAL_INDIVIDUAL_OFFER.amountCents,
            currency: PACKAGE_CURRENCY_CODE,
        };
        const studentSent = await sendCheckoutV2CycleRescheduled(student.email, {
            locale: locale(student.preferred_language),
            recipientName: student.full_name || student.email.split('@')[0] || 'Student',
            isTeacher: false,
            otherPartyName: teacher.full_name || 'Teacher',
            ...common,
        }, {
            fulfillmentEffect: effectContext(
                supabaseAdmin,
                job,
                'email.checkout_v2_cycle_rescheduled.student',
            ),
        });
        const teacherSent = await sendCheckoutV2CycleRescheduled(teacher.email, {
            locale: locale(teacher.preferred_language),
            recipientName: teacher.full_name || teacher.email.split('@')[0] || 'Teacher',
            isTeacher: true,
            otherPartyName: student.full_name || 'Student',
            ...common,
        }, {
            fulfillmentEffect: effectContext(
                supabaseAdmin,
                job,
                'email.checkout_v2_cycle_rescheduled.teacher',
            ),
        });
        if (!studentSent || !teacherSent) {
            throw new Error('Resend did not accept one or more Checkout V2 cycle reschedule emails');
        }
        return;
    }

    const common = {
        previousScheduledAt: previousDate.toISOString(),
        scheduledAt: scheduledDate.toISOString(),
        duration,
        meetLink: session.meet_link ?? undefined,
        documentLink: session.drive_doc_url ?? undefined,
    };
    const studentSent = await sendClassRescheduled(student.email, {
        locale: locale(student.preferred_language),
        recipientName: student.full_name || student.email.split('@')[0] || 'Student',
        isTeacher: false,
        otherPartyName: teacher.full_name || 'Teacher',
        ...common,
    }, {
        fulfillmentEffect: effectContext(supabaseAdmin, job, 'email.class_rescheduled.student'),
    });
    const teacherSent = await sendClassRescheduled(teacher.email, {
        locale: locale(teacher.preferred_language),
        recipientName: teacher.full_name || teacher.email.split('@')[0] || 'Teacher',
        isTeacher: true,
        otherPartyName: student.full_name || 'Student',
        ...common,
    }, {
        fulfillmentEffect: effectContext(supabaseAdmin, job, 'email.class_rescheduled.teacher'),
    });
    if (!studentSent || !teacherSent) {
        throw new Error('Resend did not accept one or more reschedule emails');
    }
}
