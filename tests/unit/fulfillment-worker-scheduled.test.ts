import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createSupabaseAdminClient: vi.fn(),
    processDueFulfillmentJobs: vi.fn(),
    quarantineStaleFulfillmentJobs: vi.fn(),
    sendClassReminder: vi.fn(),
    recordClassEmailOutInCrmSafe: vi.fn(),
}));

vi.mock('../../src/lib/fulfillment/jobs', () => ({
    ExactFulfillmentJobError: class ExactFulfillmentJobError extends Error {
        code: string;
        constructor(code: string) {
            super(code);
            this.code = code;
        }
    },
    processDueFulfillmentJobs: mocks.processDueFulfillmentJobs,
    processExactFulfillmentJob: vi.fn(),
    quarantineStaleFulfillmentJobs: mocks.quarantineStaleFulfillmentJobs,
}));

vi.mock('../../src/lib/email', () => ({
    sendClassReminder: mocks.sendClassReminder,
}));

vi.mock('../../src/lib/crm/class-email', () => ({
    recordClassEmailOutInCrmSafe: mocks.recordClassEmailOutInCrmSafe,
}));

vi.mock('../../src/lib/google/calendar', () => ({
    checkTeacherAvailability: vi.fn(),
    getCalendarClient: vi.fn(),
}));

vi.mock('../../src/lib/google/drive', () => ({
    appendToDocument: vi.fn(),
    ensureUserPermission: vi.fn(),
    getFolderLink: vi.fn(),
}));

vi.mock('../../src/lib/google/student-folder', () => ({
    createStudentFolderStructure: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

function createSupabaseAdmin(sessions: unknown[] = []) {
    const sessionsQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    sessionsQuery.select = vi.fn(() => sessionsQuery);
    sessionsQuery.update = vi.fn(() => sessionsQuery);
    sessionsQuery.eq = vi.fn(() => sessionsQuery);
    sessionsQuery.gte = vi.fn(() => sessionsQuery);
    sessionsQuery.lte = vi.fn().mockResolvedValue({ data: sessions, error: null });
    Object.assign(sessionsQuery, { error: null });

    return {
        admin: {
            from: vi.fn(() => sessionsQuery),
        },
        sessionsQuery,
    };
}

const stagingQueueName = 'espanol-honesto-fulfillment-staging-queue';
const productionQueueName = 'espanol-honesto-fulfillment-production-queue';
const stagingQueueEnv = {
    FULFILLMENT_QUEUE: {
        metrics: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
        sendBatch: vi.fn().mockResolvedValue(undefined),
    },
    FULFILLMENT_RUNTIME_MODE: 'active',
    PUBLIC_APP_ENV: 'staging',
    WORKER_IDENTITY: 'espanol-honesto-fulfillment-staging',
};

function createQueueBatch(options: {
    attempts?: number;
    body?: unknown;
    queue?: string;
} = {}) {
    const message = {
        id: 'queue-message-1',
        timestamp: new Date('2026-07-11T16:00:00.000Z'),
        attempts: options.attempts ?? 1,
        body: options.body ?? {
            version: 1,
            kind: 'process_due',
            environment: 'staging',
            limit: 5,
            requestedAt: '2026-07-11T16:00:00.000Z',
        },
        ack: vi.fn(),
        retry: vi.fn(),
    };
    const batch = {
        queue: options.queue ?? stagingQueueName,
        messages: [message],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
    };
    return { batch, message };
}

describe('fulfillment worker scheduled handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.processDueFulfillmentJobs.mockResolvedValue({
            processed: 0,
            succeeded: 0,
            failed: 0,
        });
        mocks.quarantineStaleFulfillmentJobs.mockResolvedValue(0);
        mocks.sendClassReminder.mockResolvedValue(true);
        mocks.recordClassEmailOutInCrmSafe.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('processes a valid Queue trigger and acknowledges only after durable jobs finish', async () => {
        mocks.processDueFulfillmentJobs.mockResolvedValueOnce({
            processed: 1,
            succeeded: 1,
            failed: 0,
        });
        const { batch, message } = createQueueBatch();
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, stagingQueueEnv);

        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledWith({
            limit: 1,
            workerId: 'cloudflare-fulfillment-worker:queue:queue-message-1:1',
        });
        expect(mocks.quarantineStaleFulfillmentJobs).toHaveBeenCalledTimes(1);
        expect(stagingQueueEnv.FULFILLMENT_QUEUE.send).toHaveBeenCalledWith(
            expect.objectContaining({
                environment: 'staging',
                kind: 'process_due',
                limit: 5,
                version: 1,
            }),
            { contentType: 'json' },
        );
        expect(message.ack).toHaveBeenCalledTimes(1);
        expect(message.retry).not.toHaveBeenCalled();
    });

    it('publishes a fresh Queue signal for a durably pending phase instead of consuming a retry', async () => {
        mocks.processDueFulfillmentJobs.mockResolvedValueOnce({
            processed: 1,
            succeeded: 0,
            failed: 0,
        });
        const { batch, message } = createQueueBatch({ attempts: 10 });
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, stagingQueueEnv);

        expect(stagingQueueEnv.FULFILLMENT_QUEUE.send).toHaveBeenCalledTimes(1);
        expect(message.ack).toHaveBeenCalledTimes(1);
        expect(message.retry).not.toHaveBeenCalled();
    });

    it('accepts only the exact production Queue/message identity in production', async () => {
        const { batch, message } = createQueueBatch({
            queue: productionQueueName,
            body: {
                version: 1,
                kind: 'process_due',
                environment: 'production',
                limit: 5,
                requestedAt: '2026-07-11T16:00:00.000Z',
            },
        });
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, {
            FULFILLMENT_QUEUE: {
                metrics: vi.fn(),
                send: vi.fn().mockResolvedValue(undefined),
                sendBatch: vi.fn().mockResolvedValue(undefined),
            },
            FULFILLMENT_RUNTIME_MODE: 'active',
            PUBLIC_APP_ENV: 'production',
            WORKER_IDENTITY: 'espanol-honesto-fulfillment-production',
        });

        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledWith({
            limit: 1,
            workerId: 'cloudflare-fulfillment-worker:queue:queue-message-1:1',
        });
        expect(message.ack).toHaveBeenCalledTimes(1);
        expect(message.retry).not.toHaveBeenCalled();
    });

    it('retries the Queue message with backoff when a durable job reports failure', async () => {
        mocks.processDueFulfillmentJobs.mockResolvedValueOnce({
            processed: 1,
            succeeded: 0,
            failed: 1,
        });
        const { batch, message } = createQueueBatch({ attempts: 2 });
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, stagingQueueEnv);

        expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
        expect(message.ack).not.toHaveBeenCalled();
    });

    it('retries the Queue message when job processing throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.processDueFulfillmentJobs.mockRejectedValueOnce(new Error('database unavailable'));
        const { batch, message } = createQueueBatch({ attempts: 3 });
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, stagingQueueEnv);

        expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 120 });
        expect(message.ack).not.toHaveBeenCalled();
    });

    it('sends malformed Queue messages toward the DLQ without calling providers', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { batch, message } = createQueueBatch({ body: { version: 99 } });
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, stagingQueueEnv);

        expect(mocks.processDueFulfillmentJobs).not.toHaveBeenCalled();
        expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
        expect(message.ack).not.toHaveBeenCalled();
    });

    it('fails closed when a Queue delivery reaches the wrong runtime identity', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { batch, message } = createQueueBatch();
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.queue(batch as never, {
            ...stagingQueueEnv,
            WORKER_IDENTITY: 'espanol-honesto-fulfillment-production',
        });

        expect(batch.retryAll).toHaveBeenCalledWith({ delaySeconds: 60 });
        expect(mocks.processDueFulfillmentJobs).not.toHaveBeenCalled();
        expect(message.ack).not.toHaveBeenCalled();
        expect(message.retry).not.toHaveBeenCalled();
    });

    it('tracks one scheduled run that processes a small job batch and then reminders', async () => {
        const { admin } = createSupabaseAdmin();
        mocks.createSupabaseAdminClient.mockReturnValue(admin);
        let scheduledRun: Promise<unknown> | undefined;
        const waitUntil = vi.fn((promise: Promise<unknown>) => {
            scheduledRun = promise;
        });
        const worker = await import('../../workers/fulfillment/src/index');

        await worker.default.scheduled(
            {} as ScheduledController,
            { INTERNAL_JOB_SECRET: 'internal-secret', FULFILLMENT_RUNTIME_MODE: 'active' },
            { waitUntil } as unknown as ExecutionContext
        );

        expect(waitUntil).toHaveBeenCalledTimes(1);
        expect(scheduledRun).toBeDefined();
        await expect(scheduledRun).resolves.toBeUndefined();
        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledTimes(1);
        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledWith({
            limit: 5,
            workerId: expect.stringMatching(/^cloudflare-fulfillment-worker:scheduled:[0-9a-f-]+$/),
            supabaseAdmin: admin,
        });
        expect(mocks.quarantineStaleFulfillmentJobs).toHaveBeenCalledWith({ supabaseAdmin: admin });
        expect(admin.from).toHaveBeenCalledWith('sessions');
    });

    it('does not schedule jobs or reminders while the production bootstrap is inert', async () => {
        const worker = await import('../../workers/fulfillment/src/index');
        const waitUntil = vi.fn();

        await worker.default.scheduled(
            {} as ScheduledController,
            { FULFILLMENT_RUNTIME_MODE: 'bootstrap' },
            { waitUntil } as unknown as ExecutionContext,
        );

        expect(waitUntil).not.toHaveBeenCalled();
        expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
        expect(mocks.processDueFulfillmentJobs).not.toHaveBeenCalled();
    });

    it('preserves fulfillment processing on the manual reminders endpoint', async () => {
        const { admin } = createSupabaseAdmin();
        mocks.createSupabaseAdminClient.mockReturnValue(admin);
        const worker = await import('../../workers/fulfillment/src/index');

        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/reminders/send', {
                method: 'POST',
                headers: { Authorization: 'Bearer internal-secret' },
                body: '{}',
            }),
            { INTERNAL_JOB_SECRET: 'internal-secret', FULFILLMENT_RUNTIME_MODE: 'active' }
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            success: true,
            processed: 0,
            sent: 0,
            failed: 0,
            fulfillment: { processed: 0, succeeded: 0, failed: 0 },
        }));
        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledWith({
            limit: 20,
            supabaseAdmin: admin,
        });
        expect(admin.from).toHaveBeenCalledWith('sessions');
    });

    it('sends only the exact smoke reminder without processing arbitrary jobs', async () => {
        const sessionId = '10000000-0000-4000-8000-000000000001';
        const studentId = '20000000-0000-4000-8000-000000000001';
        const teacherId = '30000000-0000-4000-8000-000000000001';
        const subscriptionId = '40000000-0000-4000-8000-000000000001';
        const smokeMarker = 'SMOKE-REMINDER-20260710225433';
        const { admin, sessionsQuery } = createSupabaseAdmin([{
            id: sessionId,
            student_id: studentId,
            teacher_id: teacherId,
            subscription_id: subscriptionId,
            scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            duration_minutes: 50,
            meet_link: null,
            drive_doc_url: null,
            student: { id: studentId, full_name: 'Student', email: 'student@example.test' },
            teacher: { id: teacherId, full_name: 'Teacher', email: 'teacher@example.test' },
        }]);
        mocks.createSupabaseAdminClient.mockReturnValue(admin);
        const worker = await import('../../workers/fulfillment/src/index');

        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/reminders/send-exact', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer internal-secret',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId, studentId, teacherId, subscriptionId, smokeMarker }),
            }),
            {
                INTERNAL_JOB_SECRET: 'internal-secret',
                FULFILLMENT_RUNTIME_MODE: 'active',
                PUBLIC_APP_ENV: 'staging',
                WORKER_IDENTITY: 'espanol-honesto-fulfillment-staging',
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            processed: 1,
            sent: 2,
            failed: 0,
        }));
        expect(mocks.processDueFulfillmentJobs).not.toHaveBeenCalled();
        expect(sessionsQuery.eq).toHaveBeenCalledWith('id', sessionId);
        expect(sessionsQuery.eq).toHaveBeenCalledWith('teacher_notes', smokeMarker);
        expect(mocks.sendClassReminder).toHaveBeenCalledTimes(2);
        expect(mocks.sendClassReminder).toHaveBeenCalledWith(
            'student@example.test',
            expect.objectContaining({
                time: expect.stringMatching(/\b(?:CET|CEST|GMT[+-]\d+)\b/u),
            }),
        );
    });

    it('rejects every operational endpoint before auth while bootstrap mode is active', async () => {
        const worker = await import('../../workers/fulfillment/src/index');

        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/jobs/process', {
                method: 'POST',
                body: '{}',
            }),
            {
                FULFILLMENT_RUNTIME_MODE: 'bootstrap',
                PUBLIC_APP_ENV: 'production',
                WORKER_IDENTITY: 'espanol-honesto-fulfillment-production',
            },
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ errorCode: 'FULFILLMENT_DISABLED' });
        expect(mocks.createSupabaseAdminClient).not.toHaveBeenCalled();
        expect(mocks.processDueFulfillmentJobs).not.toHaveBeenCalled();
    });
});
