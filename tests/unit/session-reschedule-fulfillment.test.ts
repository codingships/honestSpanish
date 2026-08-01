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

function session(calendarEventId: string | null) {
    return {
        id: 'session-1',
        student_id: 'student-1',
        teacher_id: 'teacher-1',
        scheduled_at: scheduledAt,
        duration_minutes: 50,
        calendar_event_id: calendarEventId,
        meet_link: 'https://meet.google.com/abc-defg-hij',
        drive_doc_url: 'https://docs.google.com/document/d/doc-1',
        status: 'scheduled',
        student: {
            id: 'student-1',
            full_name: 'Student One',
            email: 'student@example.com',
            preferred_language: 'es',
        },
        teacher: {
            id: 'teacher-1',
            full_name: 'Teacher One',
            email: 'teacher@example.com',
            preferred_language: 'en',
        },
    };
}

function job() {
    return {
        id: 'job-1',
        session_id: 'session-1',
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
    options: { finalizeSucceeds?: boolean } = {},
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
    const from = vi.fn((table: string) => {
        if (table !== 'sessions') throw new Error(`Unexpected table ${table}`);
        return {
            select: () => ({
                eq: () => ({
                    single: async () => ({
                        data: sessionRows[Math.min(sessionRead++, sessionRows.length - 1)],
                        error: null,
                    }),
                }),
            }),
        };
    });
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
