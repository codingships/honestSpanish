import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    freebusyQuery: vi.fn(),
    eventsList: vi.fn(),
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

async function filterSlots(ignoredEventIds?: string[]): Promise<Response> {
    const worker = await import('../../workers/fulfillment/src/index');
    return worker.default.fetch(
        new Request('https://worker.example.com/internal/google/filter-available-slots', {
            method: 'POST',
            headers: { Authorization: 'Bearer internal-secret' },
            body: JSON.stringify({ teacherEmail, slots, ignoredEventIds }),
        }),
        { INTERNAL_JOB_SECRET: 'internal-secret', FULFILLMENT_RUNTIME_MODE: 'active' },
    );
}

describe('fulfillment worker FreeBusy slot filtering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCalendarClient.mockReturnValue({
            freebusy: { query: mocks.freebusyQuery },
            events: { list: mocks.eventsList },
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

    it('ignores the class event being moved while retaining an otherwise free target', async () => {
        mocks.eventsList.mockResolvedValue({
            data: {
                items: [{
                    id: 'own-class-event',
                    status: 'confirmed',
                    start: { dateTime: slots[0].slot_start },
                    end: { dateTime: slots[0].slot_end },
                }],
            },
        });

        const response = await filterSlots(['own-class-event']);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots });
        expect(mocks.freebusyQuery).not.toHaveBeenCalled();
        expect(mocks.eventsList).toHaveBeenCalledWith(expect.objectContaining({
            calendarId: teacherEmail,
            singleEvents: true,
            showDeleted: false,
        }));
    });

    it('still blocks an external event that overlaps a target occupied by an ignored class event', async () => {
        mocks.eventsList.mockResolvedValue({
            data: {
                items: [
                    {
                        id: 'own-class-event',
                        status: 'confirmed',
                        start: { dateTime: slots[0].slot_start },
                        end: { dateTime: slots[0].slot_end },
                    },
                    {
                        id: 'external-event',
                        status: 'confirmed',
                        start: { dateTime: '2026-07-20T10:10:00.000Z' },
                        end: { dateTime: '2026-07-20T10:20:00.000Z' },
                    },
                ],
            },
        });

        const response = await filterSlots(['own-class-event']);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots: [] });
    });

    it('does not treat transparent or self-declined Calendar events as busy', async () => {
        mocks.eventsList.mockResolvedValue({
            data: {
                items: [
                    {
                        id: 'transparent-event',
                        status: 'confirmed',
                        transparency: 'transparent',
                        start: { dateTime: slots[0].slot_start },
                        end: { dateTime: slots[0].slot_end },
                    },
                    {
                        id: 'declined-event',
                        status: 'confirmed',
                        attendees: [{ self: true, responseStatus: 'declined' }],
                        start: { dateTime: slots[0].slot_start },
                        end: { dateTime: slots[0].slot_end },
                    },
                ],
            },
        });

        const response = await filterSlots(['own-class-event']);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots });
    });

    it('uses exact Madrid midnights for all-day events instead of blocking adjacent days', async () => {
        mocks.eventsList.mockResolvedValue({
            data: {
                items: [{
                    id: 'next-day-event',
                    status: 'confirmed',
                    start: { date: '2026-07-21' },
                    end: { date: '2026-07-22' },
                }],
            },
        });

        const response = await filterSlots(['own-class-event']);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ slots });

        mocks.eventsList.mockResolvedValueOnce({
            data: {
                items: [{
                    id: 'same-day-event',
                    status: 'confirmed',
                    start: { date: '2026-07-20' },
                    end: { date: '2026-07-21' },
                }],
            },
        });
        const sameDay = await filterSlots(['own-class-event']);
        expect(sameDay.status).toBe(200);
        await expect(sameDay.json()).resolves.toEqual({ slots: [] });
    });

    it('fails closed for offsetless or malformed Calendar event boundaries', async () => {
        mocks.eventsList.mockResolvedValueOnce({
            data: {
                items: [{
                    id: 'offsetless-event',
                    status: 'confirmed',
                    start: { dateTime: '2026-07-20T10:00:00', timeZone: 'Europe/Madrid' },
                    end: { dateTime: '2026-07-20T10:50:00', timeZone: 'Europe/Madrid' },
                }],
            },
        });

        const offsetless = await filterSlots(['own-class-event']);
        expect(offsetless.status).toBe(500);
        await expect(offsetless.json()).resolves.toEqual({ errorCode: 'INTERNAL_OPERATION_FAILED' });

        mocks.eventsList.mockResolvedValueOnce({
            data: {
                items: [{
                    status: 'confirmed',
                    start: { dateTime: slots[0].slot_start },
                    end: { dateTime: slots[0].slot_end },
                }],
            },
        });
        const missingId = await filterSlots(['own-class-event']);
        expect(missingId.status).toBe(500);
        await expect(missingId.json()).resolves.toEqual({ errorCode: 'INTERNAL_OPERATION_FAILED' });
    });
});
