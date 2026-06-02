import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/google/student-folder', () => ({
    createStudentFolderStructure: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/email', () => ({
    sendWelcomeEmail: vi.fn(),
}));

vi.mock('../../src/lib/site-url', () => ({
    getSiteUrl: vi.fn().mockReturnValue('https://example.com'),
}));

vi.mock('../../src/lib/fulfillment/session-fulfillment', () => ({
    fulfillSingleSession: vi.fn(),
    fulfillSessionBatch: vi.fn(),
}));

const createJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    job_type: 'session_fulfillment',
    status: 'pending',
    payload: { sessionId: 'session-1' },
    session_id: 'session-1',
    subscription_id: 'subscription-1',
    student_id: 'student-1',
    attempts: 0,
    max_attempts: 3,
    run_at: '2026-01-01T10:00:00.000Z',
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: '2026-01-01T09:00:00.000Z',
    updated_at: '2026-01-01T09:00:00.000Z',
    ...overrides,
});

describe('fulfillment jobs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enqueues single, bulk and welcome jobs with normalized payloads', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabaseAdmin = {
            from: vi.fn().mockReturnValue({ insert }),
        };
        const {
            enqueueSessionFulfillment,
            enqueueBulkSessionFulfillment,
            enqueueWelcomeFulfillment,
        } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueSessionFulfillment(supabaseAdmin as any, {
            id: 'session-1',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
        }, { autoCreateMeeting: false })).resolves.toBe(true);

        await expect(enqueueBulkSessionFulfillment(supabaseAdmin as any, [{
            id: 'session-2',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
        }], { sendEmail: false })).resolves.toBe(true);

        await expect(enqueueWelcomeFulfillment(supabaseAdmin as any, {
            userId: 'student-1',
            packageId: 'package-1',
        })).resolves.toBe(true);

        expect(insert).toHaveBeenCalledTimes(3);
        expect(insert).toHaveBeenNthCalledWith(1, expect.objectContaining({
            job_type: 'session_fulfillment',
            session_id: 'session-1',
            payload: expect.objectContaining({
                sessionId: 'session-1',
                autoCreateMeeting: false,
                sendEmail: true,
            }),
        }));
        expect(insert).toHaveBeenNthCalledWith(2, expect.objectContaining({
            job_type: 'bulk_session_fulfillment',
            payload: expect.objectContaining({
                sessionIds: ['session-2'],
                autoCreateMeeting: true,
                sendEmail: false,
            }),
        }));
        expect(insert).toHaveBeenNthCalledWith(3, expect.objectContaining({
            job_type: 'welcome_fulfillment',
            student_id: 'student-1',
        }));
    });

    it('skips bulk enqueue when there are no sessions', async () => {
        const supabaseAdmin = { from: vi.fn() };
        const { enqueueBulkSessionFulfillment } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueBulkSessionFulfillment(supabaseAdmin as any, [])).resolves.toBe(true);
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it('degrades to direct fallback when the jobs table has not been migrated yet', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const supabaseAdmin = {
            from: vi.fn().mockReturnValue({
                insert: vi.fn().mockResolvedValue({
                    error: { code: '42P01', message: 'relation fulfillment_jobs does not exist' },
                }),
            }),
        };
        const { enqueueWelcomeFulfillment } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueWelcomeFulfillment(supabaseAdmin as any, {
            userId: 'student-1',
            packageId: 'package-1',
        })).resolves.toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[Fulfillment] fulfillment_jobs table is missing; using direct fallback'
        );
    });

    it('returns an empty result when processing jobs before the migration exists', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '42P01', message: 'fulfillment_jobs is missing' },
            }),
        };
        const supabaseAdmin = { from: vi.fn().mockReturnValue(selectChain) };
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
    });

    it('processes a due session fulfillment job and marks it succeeded', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [createJob()], error: null }),
        };
        const lockChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ error: null }),
        };
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain)
                .mockReturnValueOnce(successChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockResolvedValue(undefined);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
        expect(sessionFulfillment.fulfillSingleSession).toHaveBeenCalledWith(
            supabaseAdmin,
            'session-1',
            { autoCreateMeeting: undefined, sendEmail: undefined }
        );
        expect(successChain.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'succeeded',
            last_error: null,
        }));
    });

    it('reschedules failed jobs that still have retry attempts', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
                data: [createJob({
                    job_type: 'bulk_session_fulfillment',
                    payload: { sessionIds: [] },
                })],
                error: null,
            }),
        };
        const lockChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ error: null }),
        };
        const failChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain)
                .mockReturnValueOnce(failChain),
        };
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });
        expect(failChain.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            last_error: 'bulk_session_fulfillment requires sessionIds',
        }));
    });
});
