import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchEvent } = vi.hoisted(() => ({
    patchEvent: vi.fn(),
}));

vi.mock('@googleapis/calendar', () => ({
    calendar: () => ({
        events: {
            patch: patchEvent,
        },
    }),
}));

vi.mock('../../src/lib/google/auth', () => ({
    getAuthClient: () => ({}),
}));

import { updateCalendarEvent } from '../../src/lib/google/calendar';

describe('updateCalendarEvent outcome classification', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('reports an accepted PATCH', async () => {
        patchEvent.mockResolvedValue({ data: { id: 'event-1' } });

        await expect(updateCalendarEvent('event-1', {
            startTime: new Date('2026-08-05T10:00:00.000Z'),
            endTime: new Date('2026-08-05T10:50:00.000Z'),
            operationId: '418f47a2-9b6d-4c31-8a4e-123456789abc',
        })).resolves.toBe('accepted');

        expect(patchEvent).toHaveBeenCalledWith(expect.objectContaining({
            calendarId: 'primary',
            eventId: 'event-1',
            sendUpdates: 'none',
        }));
    });

    it.each([429, 500, 503])('keeps HTTP %s eligible for retry', async (code) => {
        patchEvent.mockRejectedValue(Object.assign(new Error('provider unavailable'), { code }));

        await expect(updateCalendarEvent('event-1', {
            startTime: new Date('2026-08-05T10:00:00.000Z'),
        })).resolves.toBe('retryable');
    });

    it.each([
        Object.assign(new Error('event absent'), { code: 404 }),
        new Error('connection ended without an HTTP response'),
    ])('quarantines an uncertain or absent event for reconciliation', async (error) => {
        patchEvent.mockRejectedValue(error);

        await expect(updateCalendarEvent('event-1', {
            startTime: new Date('2026-08-05T10:00:00.000Z'),
        })).resolves.toBe('ambiguous');
    });
});
