import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    calendarFactory: vi.fn(),
    freebusyQuery: vi.fn(),
    getAuthClient: vi.fn(),
}));

vi.mock('@googleapis/calendar', () => ({
    calendar: mocks.calendarFactory,
}));

vi.mock('../../src/lib/google/auth', () => ({
    getAuthClient: mocks.getAuthClient,
}));

vi.mock('../../src/lib/google/logging', () => ({
    describeGoogleError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

describe('checkTeacherAvailability FreeBusy validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.getAuthClient.mockReturnValue({});
        mocks.calendarFactory.mockReturnValue({
            freebusy: { query: mocks.freebusyQuery },
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fails closed when Google omits the requested calendar', async () => {
        mocks.freebusyQuery.mockResolvedValue({ data: { calendars: {} } });
        const { checkTeacherAvailability } = await import('../../src/lib/google/calendar');

        await expect(checkTeacherAvailability(
            'teacher@example.com',
            new Date('2026-07-20T10:00:00.000Z'),
            new Date('2026-07-20T10:50:00.000Z'),
        )).rejects.toThrow('Cannot verify teacher availability');
    });

    it('fails closed when Google reports a per-calendar error', async () => {
        mocks.freebusyQuery.mockResolvedValue({
            data: {
                calendars: {
                    'teacher@example.com': {
                        busy: [],
                        errors: [{ domain: 'global', reason: 'notFound' }],
                    },
                },
            },
        });
        const { checkTeacherAvailability } = await import('../../src/lib/google/calendar');

        await expect(checkTeacherAvailability(
            'teacher@example.com',
            new Date('2026-07-20T10:00:00.000Z'),
            new Date('2026-07-20T10:50:00.000Z'),
        )).rejects.toThrow('Cannot verify teacher availability');
    });

    it('accepts an explicitly returned calendar with no busy periods', async () => {
        mocks.freebusyQuery.mockResolvedValue({
            data: {
                calendars: {
                    'teacher@example.com': { busy: [] },
                },
            },
        });
        const { checkTeacherAvailability } = await import('../../src/lib/google/calendar');

        await expect(checkTeacherAvailability(
            'teacher@example.com',
            new Date('2026-07-20T10:00:00.000Z'),
            new Date('2026-07-20T10:50:00.000Z'),
        )).resolves.toBe(true);
    });
});
