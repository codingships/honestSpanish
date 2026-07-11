import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    processDueFulfillmentJobs: vi.fn(),
    processExactFulfillmentJob: vi.fn(),
    quarantineStaleFulfillmentJobs: vi.fn(),
    queueSend: vi.fn(),
    queueSendBatch: vi.fn(),
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
    processExactFulfillmentJob: mocks.processExactFulfillmentJob,
    quarantineStaleFulfillmentJobs: mocks.quarantineStaleFulfillmentJobs,
}));

vi.mock('../../src/lib/email', () => ({
    sendClassReminder: vi.fn(),
}));

vi.mock('../../src/lib/crm/class-email', () => ({
    recordClassEmailOutInCrmSafe: vi.fn(),
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
    createSupabaseAdminClient: vi.fn(),
}));

describe('fulfillment worker internal auth', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.queueSend.mockResolvedValue(undefined);
        mocks.quarantineStaleFulfillmentJobs.mockResolvedValue(0);
    });

    it('does not authorize internal routes with CRON_SECRET fallback', async () => {
        const worker = await import('../../workers/fulfillment/src/index');
        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/jobs/process', {
                method: 'POST',
                headers: { Authorization: 'Bearer cron-secret' },
                body: JSON.stringify({ limit: 1 }),
            }),
            { CRON_SECRET: 'cron-secret', FULFILLMENT_RUNTIME_MODE: 'active' }
        );

        await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
        expect(response.status).toBe(401);
    });

    it('authorizes internal routes with INTERNAL_JOB_SECRET', async () => {
        const worker = await import('../../workers/fulfillment/src/index');
        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/jobs/process', {
                method: 'POST',
                headers: { Authorization: 'Bearer internal-secret' },
                body: JSON.stringify({ limit: 1 }),
            }),
            {
                INTERNAL_JOB_SECRET: 'internal-secret',
                CRON_SECRET: 'cron-secret',
                FULFILLMENT_RUNTIME_MODE: 'active',
                PUBLIC_APP_ENV: 'staging',
                WORKER_IDENTITY: 'espanol-honesto-fulfillment-staging',
                FULFILLMENT_QUEUE: {
                    send: mocks.queueSend,
                    sendBatch: mocks.queueSendBatch,
                },
            }
        );

        await expect(response.json()).resolves.toEqual({ queued: true, limit: 1 });
        expect(response.status).toBe(200);
        expect(mocks.queueSend).toHaveBeenCalledWith({
            version: 1,
            kind: 'process_due',
            environment: 'staging',
            limit: 1,
            requestedAt: expect.any(String),
        }, { contentType: 'json' });
        expect(mocks.processDueFulfillmentJobs).not.toHaveBeenCalled();
    });

    it('preserves the existing inline production path until production Queues are approved', async () => {
        mocks.processDueFulfillmentJobs.mockResolvedValueOnce({
            processed: 1,
            succeeded: 1,
            failed: 0,
        });
        const worker = await import('../../workers/fulfillment/src/index');
        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/jobs/process', {
                method: 'POST',
                headers: { Authorization: 'Bearer internal-secret' },
                body: JSON.stringify({ limit: 1 }),
            }),
            {
                INTERNAL_JOB_SECRET: 'internal-secret',
                FULFILLMENT_RUNTIME_MODE: 'active',
                PUBLIC_APP_ENV: 'production',
                WORKER_IDENTITY: 'espanol-honesto-fulfillment-production',
            },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            processed: 1,
            succeeded: 1,
            failed: 0,
        });
        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledWith({
            limit: 1,
            workerId: expect.stringMatching(/^cloudflare-fulfillment-worker:http:[0-9a-f-]+$/),
        });
        expect(mocks.quarantineStaleFulfillmentJobs).toHaveBeenCalledTimes(1);
        expect(mocks.queueSend).not.toHaveBeenCalled();
    });
});
