import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    freebusyQuery: vi.fn(),
    getCalendarClient: vi.fn(),
}));

vi.mock('../../src/lib/fulfillment/jobs', () => ({
    ExactFulfillmentJobError: class ExactFulfillmentJobError extends Error {
        code = 'EXACT_JOB_ERROR';
    },
    processDueFulfillmentJobs: vi.fn(),
    processExactFulfillmentJob: vi.fn(),
}));

vi.mock('../../src/lib/email', () => ({ sendClassReminder: vi.fn() }));
vi.mock('../../src/lib/crm/class-email', () => ({ recordClassEmailOutInCrmSafe: vi.fn() }));
vi.mock('../../src/lib/google/calendar', () => ({
    checkTeacherAvailability: vi.fn(),
    getCalendarClient: mocks.getCalendarClient,
}));
vi.mock('../../src/lib/google/drive', () => ({
    appendToDocument: vi.fn(),
    ensureUserPermission: vi.fn(),
    getFolderLink: vi.fn(),
}));
vi.mock('../../src/lib/google/student-folder', () => ({ createStudentFolderStructure: vi.fn() }));
vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));
vi.mock('../../src/lib/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }));

const teacherEmail = 'teacher@example.com';
const slots = [{
    slot_start: '2026-07-20T10:00:00.000Z',
    slot_end: '2026-07-20T10:50:00.000Z',
}];

async function filterSlots(): Promise<Response> {
    const worker = await import('../../workers/fulfillment/src/index');
    return worker.default.fetch(
        new Request('https://worker.example.com/internal/google/filter-available-slots', {
            method: 'POST',
            headers: { Authorization: 'Bearer internal-secret' },
            body: JSON.stringify({ teacherEmail, slots }),
        }),
        { INTERNAL_JOB_SECRET: 'internal-secret' },
    );
}

describe('fulfillment worker FreeBusy slot filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCalendarClient.mockReturnValue({
            freebusy: { query: mocks.freebusyQuery },
        });
    });

    it('fails closed when Google omits the requested calendar', async () => {
        mocks.freebusyQuery.mockResolvedValue({ data: { calendars: {} } });

        const response = await filterSlots();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ errorCode: 'INTERNAL_OPERATION_FAILED' });
    });

    it('fails closed when Google reports a per-calendar error', async () => {
        mocks.freebusyQuery.mockResolvedValue({
            data: {
                calendars: {
                    [teacherEmail]: {
                        busy: [],
                        errors: [{ domain: 'global', reason: 'notFound' }],
                    },
                },
            },
        });

        const response = await filterSlots();

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ errorCode: 'INTERNAL_OPERATION_FAILED' });
    });

    it('returns slots only when Google explicitly returns an error-free calendar', async () => {
        mocks.freebusyQuery.mockResolvedValue({
            data: {
                calendars: {
                    [teacherEmail]: { busy: [] },
                },
            },
        });

        const response = await filterSlots();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots });
    });
});
