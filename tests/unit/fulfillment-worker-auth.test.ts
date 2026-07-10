import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/fulfillment/jobs', () => ({
    processDueFulfillmentJobs: vi.fn().mockResolvedValue({ processed: 0 }),
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
    it('does not authorize internal routes with CRON_SECRET fallback', async () => {
        const worker = await import('../../workers/fulfillment/src/index');
        const response = await worker.default.fetch(
            new Request('https://worker.example.com/internal/jobs/process', {
                method: 'POST',
                headers: { Authorization: 'Bearer cron-secret' },
                body: JSON.stringify({ limit: 1 }),
            }),
            { CRON_SECRET: 'cron-secret' }
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
            { INTERNAL_JOB_SECRET: 'internal-secret', CRON_SECRET: 'cron-secret' }
        );

        await expect(response.json()).resolves.toEqual({ processed: 0 });
        expect(response.status).toBe(200);
    });
});
