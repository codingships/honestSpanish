import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    updateCalendarEvent,
    deliverIdempotentEmail,
} = vi.hoisted(() => ({
    updateCalendarEvent: vi.fn(),
    deliverIdempotentEmail: vi.fn(),
}));

vi.mock('../../src/lib/google/calendar', () => ({
    updateCalendarEvent,
}));

vi.mock('../../src/lib/email/delivery', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/lib/email/delivery')>(),
    deliverIdempotentEmail,
}));

vi.mock('../../src/lib/email/client', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../src/lib/email/client')>(),
    getEmailFrom: () => 'Español Honesto <test@example.com>',
}));

import {
    FulfillmentDependencyPendingError,
    processSessionReschedule,
} from '../../src/lib/fulfillment/session-reschedule';
import { enqueueSessionReschedule } from '../../src/lib/fulfillment/queue';

const previousScheduledAt = '2026-08-03T08:00:00.000Z';
const scheduledAt = '2026-08-05T10:00:00.000Z';
const provisionalClassStartsAt = [
    scheduledAt,
    '2026-08-12T10:00:00.000Z',
    '2026-08-19T10:00:00.000Z',
    '2026-08-26T10:00:00.000Z',
];
const provisionalRenewalAt = '2026-09-02T10:00:00.000Z';

function session(
    calendarEventId: string | null,
    options: { id?: string; scheduledAt?: string; index?: number; withEmail?: boolean } = {},
) {
    const id = options.id ?? 'session-1';
    return {
        id,
        student_id: 'student-1',
        teacher_id: 'teacher-1',
        subscription_id: 'subscription-1',
        checkout_v2_cycle_id: 'cycle-1',
        checkout_v2_cycle_session_index: options.index ?? 1,
        scheduled_at: options.scheduledAt ?? scheduledAt,
        duration_minutes: 50,
        calendar_event_id: calendarEventId,
        meet_link: 'https://meet.google.com/abc-defg-hij',
        drive_doc_url: 'https://docs.google.com/document/d/doc-1',
        status: 'scheduled',
        student: {
            id: 'student-1',
            full_name: 'Student One',
            email: options.withEmail === false ? null : 'student@example.com',
            preferred_language: 'es',
        },
        teacher: {
            id: 'teacher-1',
            full_name: 'Teacher One',
            email: options.withEmail === false ? null : 'teacher@example.com',
            preferred_language: 'en',
        },
    };
}

function job(sessionId = 'session-1') {
    return {
        id: 'job-1',
        session_id: sessionId,
        subscription_id: 'subscription-1',
        locked_by: 'worker-1',
        payload: {},
    } as never;
}

function payload(overrides: Record<string, unknown> = {}) {
    return {
        operationId: '418f47a2-9b6d-4c31-8a4e-123456789abc',
        sessionId: 'session-1',
        previousScheduledAt,
        scheduledAt,
        sendEmail: true,
        ...overrides,
    };
}

function supabaseFor(
    sessionRows: ReturnType<typeof session>[],
    options: {
        finalizeSucceeds?: boolean;
        operation?: Record<string, unknown>;
        cycleSessions?: ReturnType<typeof session>[];
        allocation?: Record<string, unknown>;
        barrierJobs?: Record<string, unknown>[];
        barrierEffects?: Record<string, unknown>[];
    } = {},
) {
    const effects = new Map<string, { status: string; effectId: string; generation: number }>();
    let sessionRead = 0;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'claim_fulfillment_effect') {
            const key = `${args.p_job_id}:${args.p_effect_key}`;
            const existing = effects.get(key);
            if (existing) {
                return {
                    data: [{
                        claimed: false,
                        effect_status: existing.status,
                        effect_id: existing.effectId,
                        attempt_generation: existing.generation,
                        provider_id: args.p_effect_key === 'calendar.session_reschedule' ? 'event-1' : 'email-1',
                    }],
                    error: null,
                };
            }
            const created = { status: 'processing', effectId: `effect-${effects.size + 1}`, generation: 1 };
            effects.set(key, created);
            return {
                data: [{
                    claimed: true,
                    effect_status: 'processing',
                    effect_id: created.effectId,
                    attempt_generation: created.generation,
                    provider_id: null,
                }],
                error: null,
            };
        }
        if (name === 'finalize_fulfillment_effect') {
            if (options.finalizeSucceeds === false) return { data: false, error: null };
            const entry = [...effects.values()].find((effect) => effect.effectId === args.p_effect_id);
            if (entry) entry.status = String(args.p_outcome);
            return { data: true, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
    });
    const operation = {
        id: '418f47a2-9b6d-4c31-8a4e-123456789abc',
        session_id: 'session-1',
        subscription_id: 'subscription-1',
        cycle_id: 'cycle-1',
        operation_kind: 'single_session',
        new_scheduled_at: scheduledAt,
        target_stripe_anchor_at: null,
        status: 'applied',
        ...options.operation,
    };
    const allocation = {
        subscription_id: 'subscription-1',
        teacher_id: 'teacher-1',
        duration_minutes: 50,
        timezone_name: 'Europe/Madrid',
        status: 'active',
        ...options.allocation,
    };
    const barrierJobs = options.barrierJobs ?? provisionalClassStartsAt.map((_, index) => ({
        id: `job-${index + 1}`,
        job_type: 'session_reschedule',
        session_id: `session-${index + 1}`,
        subscription_id: 'subscription-1',
        dedupe_key: `checkout_v2_reschedule:${operation.id}:session-${index + 1}`,
        status: index === 0 ? 'processing' : 'succeeded',
        attempts: 1,
        max_attempts: 5,
    }));
    const barrierEffects = options.barrierEffects ?? barrierJobs.map((barrierJob) => ({
        job_id: barrierJob.id,
        effect_key: 'calendar.session_reschedule',
        status: 'succeeded',
    }));
    const from = vi.fn((table: string) => ({
        select: () => {
            if (table === 'checkout_v2_reschedule_operations') {
                return {
                    eq: () => ({ single: async () => ({ data: operation, error: null }) }),
                };
            }
            if (table === 'sessions') {
                return {
                    eq: (field: string) => {
                        if (field === 'id') {
                            return {
                                single: async () => ({
                                    data: sessionRows[Math.min(sessionRead++, sessionRows.length - 1)],
                                    error: null,
                                }),
                            };
                        }
                        if (field === 'checkout_v2_cycle_id') {
                            return {
                                order: async () => ({
                                    data: options.cycleSessions ?? sessionRows,
                                    error: null,
                                }),
                            };
                        }
                        throw new Error(`Unexpected sessions filter ${field}`);
                    },
                };
            }
            if (table === 'checkout_v2_weekly_allocations') {
                const secondFilter = {
                    eq: () => ({ single: async () => ({ data: allocation, error: null }) }),
                };
                return { eq: () => secondFilter };
            }
            if (table === 'fulfillment_jobs') {
                return {
                    eq: () => ({
                        in: async () => ({ data: barrierJobs, error: null }),
                    }),
                };
            }
            if (table === 'fulfillment_effects') {
                return {
                    in: () => ({
                        eq: async () => ({ data: barrierEffects, error: null }),
                    }),
                };
            }
            throw new Error(`Unexpected table ${table}`);
        },
    }));
    return { client: { from, rpc } as never, effects, rpc };
}

describe('session reschedule fulfillment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateCalendarEvent.mockResolvedValue('accepted');
        deliverIdempotentEmail.mockResolvedValue({
            ok: true,
            providerId: 'email-provider-id',
            replayed: false,
        });
    });

    it('patches the existing event once and replays calendar and email effects without provider duplication', async () => {
        const { client, effects } = supabaseFor([session('event-1')]);

        await processSessionReschedule(client, payload(), job());
        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(updateCalendarEvent).toHaveBeenCalledWith('event-1', {
            startTime: new Date(scheduledAt),
            endTime: new Date('2026-08-05T10:50:00.000Z'),
            operationId: '418f47a2-9b6d-4c31-8a4e-123456789abc',
        });
        expect(deliverIdempotentEmail).toHaveBeenCalledTimes(2);
        expect(effects.get('job-1:calendar.session_reschedule')?.status).toBe('succeeded');
        expect(effects.get('job-1:email.class_rescheduled.student')?.status).toBe('succeeded');
        expect(effects.get('job-1:email.class_rescheduled.teacher')?.status).toBe('succeeded');
    });

    it('sends one idempotent four-date summary from the primary provisional-anchor job', async () => {
        const cycleSessions = provisionalClassStartsAt.map((startsAt, index) => session(
            `event-${index + 1}`,
            { id: `session-${index + 1}`, scheduledAt: startsAt, index: index + 1 },
        ));
        const { client, effects } = supabaseFor([cycleSessions[0]], {
            operation: {
                operation_kind: 'provisional_anchor',
                target_stripe_anchor_at: provisionalRenewalAt,
            },
            cycleSessions,
        });

        await processSessionReschedule(client, payload(), job());
        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).toHaveBeenCalledTimes(2);
        const deliveries = deliverIdempotentEmail.mock.calls.map((call) => call[0]);
        expect(deliveries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source: 'checkout_v2_cycle_rescheduled',
                html: expect.stringContaining('259 EUR'),
            }),
            expect.objectContaining({
                source: 'checkout_v2_cycle_rescheduled',
                html: expect.not.stringContaining('259 EUR'),
            }),
        ]));
        const studentDelivery = deliveries.find((delivery) => delivery.to === 'student@example.com');
        const studentFormatter = new Intl.DateTimeFormat('es-ES', {
            timeZone: 'Europe/Madrid',
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
        expect(studentDelivery).toBeDefined();
        for (const startsAt of provisionalClassStartsAt) {
            expect(studentDelivery?.html).toContain(studentFormatter.format(new Date(startsAt)));
        }
        expect(studentDelivery?.html).toContain(studentFormatter.format(new Date(provisionalRenewalAt)));
        expect(effects.get('job-1:email.checkout_v2_cycle_rescheduled.student')?.status).toBe('succeeded');
        expect(effects.get('job-1:email.checkout_v2_cycle_rescheduled.teacher')?.status).toBe('succeeded');
    });

    it('waits for all four Calendar effects and replays the primary PATCH before emailing', async () => {
        const cycleSessions = provisionalClassStartsAt.map((startsAt, index) => session(
            `event-${index + 1}`,
            { id: `session-${index + 1}`, scheduledAt: startsAt, index: index + 1 },
        ));
        const barrierEffects: Record<string, unknown>[] = [1, 2, 3].map((index) => ({
            job_id: `job-${index}`,
            effect_key: 'calendar.session_reschedule',
            status: 'succeeded',
        }));
        const barrierJobs: Record<string, unknown>[] = [1, 2, 3, 4].map((index) => ({
            id: `job-${index}`,
            job_type: 'session_reschedule',
            session_id: `session-${index}`,
            subscription_id: 'subscription-1',
            dedupe_key: `checkout_v2_reschedule:418f47a2-9b6d-4c31-8a4e-123456789abc:session-${index}`,
            status: index === 1 ? 'processing' : index === 4 ? 'pending' : 'succeeded',
            attempts: index === 4 ? 0 : 1,
            max_attempts: 5,
        }));
        const { client } = supabaseFor([cycleSessions[0]], {
            operation: {
                operation_kind: 'provisional_anchor',
                target_stripe_anchor_at: provisionalRenewalAt,
            },
            cycleSessions,
            barrierJobs,
            barrierEffects,
        });

        await expect(processSessionReschedule(client, payload(), job())).rejects.toMatchObject({
            name: 'FulfillmentDependencyPendingError',
            message: 'checkout_v2_reschedule_waiting_for_all_calendar_effects',
        });
        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();

        barrierEffects.push({
            job_id: 'job-4',
            effect_key: 'calendar.session_reschedule',
            status: 'succeeded',
        });
        barrierJobs[3].status = 'succeeded';
        barrierJobs[3].attempts = 1;
        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).toHaveBeenCalledTimes(2);
    });

    it('requires manual review when another Calendar job exhausts its retries', async () => {
        const cycleSessions = provisionalClassStartsAt.map((startsAt, index) => session(
            `event-${index + 1}`,
            { id: `session-${index + 1}`, scheduledAt: startsAt, index: index + 1 },
        ));
        const operationId = '418f47a2-9b6d-4c31-8a4e-123456789abc';
        const barrierJobs = [1, 2, 3, 4].map((index) => ({
            id: `job-${index}`,
            job_type: 'session_reschedule',
            session_id: `session-${index}`,
            subscription_id: 'subscription-1',
            dedupe_key: `checkout_v2_reschedule:${operationId}:session-${index}`,
            status: index === 1 ? 'processing' : index === 4 ? 'failed' : 'succeeded',
            attempts: index === 4 ? 5 : 1,
            max_attempts: 5,
        }));
        const barrierEffects = barrierJobs.map((barrierJob, index) => ({
            job_id: barrierJob.id,
            effect_key: 'calendar.session_reschedule',
            status: index === 3 ? 'failed' : 'succeeded',
        }));
        const { client } = supabaseFor([cycleSessions[0]], {
            operation: {
                operation_kind: 'provisional_anchor',
                target_stripe_anchor_at: provisionalRenewalAt,
            },
            cycleSessions,
            barrierJobs,
            barrierEffects,
        });

        await expect(processSessionReschedule(client, payload(), job())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
            requiresManualReview: true,
        });
        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('patches a secondary provisional-anchor Calendar event without sending another email', async () => {
        const secondary = session('event-2', {
            id: 'session-2',
            scheduledAt: provisionalClassStartsAt[1],
            index: 2,
            withEmail: false,
        });
        const { client } = supabaseFor([secondary], {
            operation: {
                operation_kind: 'provisional_anchor',
                target_stripe_anchor_at: provisionalRenewalAt,
            },
        });

        await processSessionReschedule(client, payload({
            sessionId: 'session-2',
            previousScheduledAt: '2026-08-10T10:00:00.000Z',
            scheduledAt: provisionalClassStartsAt[1],
        }), job('session-2'));

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('fails closed when the provisional cycle no longer has four coherent sessions', async () => {
        const cycleSessions = provisionalClassStartsAt.slice(0, 3).map((startsAt, index) => session(
            `event-${index + 1}`,
            { id: `session-${index + 1}`, scheduledAt: startsAt, index: index + 1 },
        ));
        const { client } = supabaseFor([session('event-1')], {
            operation: {
                operation_kind: 'provisional_anchor',
                target_stripe_anchor_at: provisionalRenewalAt,
            },
            cycleSessions,
        });

        await expect(processSessionReschedule(client, payload(), job()))
            .rejects.toThrow('Checkout V2 provisional reschedule state is incoherent');
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('waits for the original session fulfillment job when the Calendar event is absent', async () => {
        const { client } = supabaseFor([session(null)]);

        const outcome = processSessionReschedule(
            client,
            payload({ sendEmail: false }),
            job(),
        );

        await expect(outcome).rejects.toBeInstanceOf(FulfillmentDependencyPendingError);
        await expect(outcome).rejects.toThrow('session_reschedule_waiting_for_calendar_event');

        expect(updateCalendarEvent).not.toHaveBeenCalled();
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('marks an uncertain Calendar PATCH as ambiguous and does not send email', async () => {
        updateCalendarEvent.mockResolvedValue('ambiguous');
        const { client, effects } = supabaseFor([session('event-1')]);

        await expect(processSessionReschedule(client, payload(), job())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
            requiresManualReview: true,
        });

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(effects.get('job-1:calendar.session_reschedule')?.status).toBe('ambiguous');
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('leaves a known retryable Calendar failure eligible for another attempt', async () => {
        updateCalendarEvent.mockResolvedValue('retryable');
        const { client, effects } = supabaseFor([session('event-1')]);

        await expect(processSessionReschedule(client, payload(), job())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_DELIVERY_FAILED',
            requiresManualReview: false,
        });

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(effects.get('job-1:calendar.session_reschedule')?.status).toBe('failed');
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('requires manual review when Calendar PATCH succeeds but ledger finalization is lost', async () => {
        const { client } = supabaseFor([session('event-1')], { finalizeSucceeds: false });

        await expect(processSessionReschedule(client, payload(), job())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS',
            requiresManualReview: true,
        });

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('fails invalid payloads before invoking external providers', async () => {
        const { client } = supabaseFor([session('event-1')]);

        await expect(processSessionReschedule(
            client,
            payload({ operationId: '', scheduledAt: 'not-a-date' }),
            job(),
        )).rejects.toThrow('session_reschedule requires sessionId and operationId');

        expect(updateCalendarEvent).not.toHaveBeenCalled();
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('ignores a reschedule superseded by cancellation without recreating the event', async () => {
        const cancelled = { ...session(null), status: 'cancelled' };
        const { client } = supabaseFor([cancelled]);

        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).not.toHaveBeenCalled();
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('ignores an older target after a newer reschedule has already been persisted', async () => {
        const newer = { ...session('event-1'), scheduled_at: '2026-08-06T10:00:00.000Z' };
        const { client } = supabaseFor([newer]);

        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).not.toHaveBeenCalled();
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('does not send reschedule emails when the session is cancelled during the Calendar PATCH', async () => {
        const cancelledAfterPatch = { ...session('event-1'), status: 'cancelled' };
        const { client } = supabaseFor([session('event-1'), cancelledAfterPatch]);

        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('does not send stale emails when a newer schedule is persisted during the Calendar PATCH', async () => {
        const newerAfterPatch = { ...session('event-1'), scheduled_at: '2026-08-06T10:00:00.000Z' };
        const { client } = supabaseFor([session('event-1'), newerAfterPatch]);

        await processSessionReschedule(client, payload(), job());

        expect(updateCalendarEvent).toHaveBeenCalledTimes(1);
        expect(deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('enqueues one operation with the SQL contract dedupe key', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const client = { from: vi.fn(() => ({ insert })) } as never;

        await enqueueSessionReschedule(client, {
            operationId: '418f47a2-9b6d-4c31-8a4e-123456789abc',
            sessionId: 'session-1',
            previousScheduledAt,
            scheduledAt,
        });

        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
            job_type: 'session_reschedule',
            session_id: 'session-1',
            dedupe_key: 'checkout_v2_reschedule:418f47a2-9b6d-4c31-8a4e-123456789abc:session-1',
        }));
    });
});
