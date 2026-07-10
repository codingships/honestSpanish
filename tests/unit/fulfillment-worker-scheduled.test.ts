import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createSupabaseAdminClient: vi.fn(),
    processDueFulfillmentJobs: vi.fn(),
}));

vi.mock('../../src/lib/fulfillment/jobs', () => ({
    processDueFulfillmentJobs: mocks.processDueFulfillmentJobs,
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
    createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

function createSupabaseAdmin() {
    const sessionsQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    sessionsQuery.select = vi.fn(() => sessionsQuery);
    sessionsQuery.eq = vi.fn(() => sessionsQuery);
    sessionsQuery.gte = vi.fn(() => sessionsQuery);
    sessionsQuery.lte = vi.fn().mockResolvedValue({ data: [], error: null });

    return {
        admin: {
            from: vi.fn(() => sessionsQuery),
        },
        sessionsQuery,
    };
}

describe('fulfillment worker scheduled handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.processDueFulfillmentJobs.mockResolvedValue({
            processed: 0,
            succeeded: 0,
            failed: 0,
        });
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
            { INTERNAL_JOB_SECRET: 'internal-secret' },
            { waitUntil } as unknown as ExecutionContext
        );

        expect(waitUntil).toHaveBeenCalledTimes(1);
        expect(scheduledRun).toBeDefined();
        await expect(scheduledRun).resolves.toBeUndefined();
        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledTimes(1);
        expect(mocks.processDueFulfillmentJobs).toHaveBeenCalledWith({
            limit: 5,
            workerId: 'cloudflare-fulfillment-worker',
            supabaseAdmin: admin,
        });
        expect(admin.from).toHaveBeenCalledWith('sessions');
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
            { INTERNAL_JOB_SECRET: 'internal-secret' }
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
});
