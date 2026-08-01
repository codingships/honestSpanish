import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FulfillmentDependencyPendingError } from '../../src/lib/fulfillment/dependency';

const { getCalendarEvent, insertCalendarEvent } = vi.hoisted(() => ({
    getCalendarEvent: vi.fn(),
    insertCalendarEvent: vi.fn(),
}));

vi.mock('@googleapis/calendar', () => ({
    calendar: () => ({
        events: {
            get: getCalendarEvent,
            insert: insertCalendarEvent,
        },
    }),
}));

vi.mock('../../src/lib/google/auth', () => ({
    getAuthClient: () => ({}),
}));

import { createClassEvent } from '../../src/lib/google/calendar';

const sessionId = '418f47a2-9b6d-4c31-8a4e-123456789abc';
const eventId = '418f47a29b6d4c318a4e123456789abc';
const conferenceRequestId = eventId;
const startTime = new Date('2026-08-05T10:00:00.000Z');
const endTime = new Date('2026-08-05T10:50:00.000Z');

const options = {
    sessionId,
    summary: 'Clase de Español - Student One',
    studentEmail: 'Student@example.com',
    teacherEmail: 'teacher@example.com',
    startTime,
    endTime,
};

function exactEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: eventId,
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/event?eid=deterministic',
        start: { dateTime: startTime.toISOString(), timeZone: 'Europe/Madrid' },
        end: { dateTime: endTime.toISOString(), timeZone: 'Europe/Madrid' },
        attendees: [
            { email: 'teacher@example.com' },
            { email: 'student@example.com' },
        ],
        extendedProperties: {
            private: {
                honestSpanishSessionId: sessionId,
            },
        },
        conferenceData: {
            createRequest: {
                requestId: conferenceRequestId,
                status: { statusCode: 'success' },
            },
            entryPoints: [{
                entryPointType: 'video',
                uri: 'https://meet.google.com/abc-defg-hij',
            }],
        },
        ...overrides,
    };
}

const absent = () => Object.assign(new Error('not found'), { code: 404 });

describe('deterministic class Calendar event creation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('recovers a lost insert response on retry without a second insert or invitation', async () => {
        getCalendarEvent
            .mockRejectedValueOnce(absent())
            .mockRejectedValueOnce(absent())
            .mockResolvedValueOnce({ data: exactEvent() });
        insertCalendarEvent.mockRejectedValueOnce(new Error('connection ended without a response'));

        await expect(createClassEvent(options)).rejects.toBeInstanceOf(
            FulfillmentDependencyPendingError,
        );
        await expect(createClassEvent(options)).resolves.toEqual({
            eventId,
            meetLink: 'https://meet.google.com/abc-defg-hij',
            htmlLink: 'https://calendar.google.com/event?eid=deterministic',
        });

        expect(insertCalendarEvent).toHaveBeenCalledTimes(1);
        expect(insertCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
            calendarId: 'primary',
            sendUpdates: 'all',
        }));
    });

    it('reconciles a Google 409 against the exact deterministic event', async () => {
        getCalendarEvent
            .mockRejectedValueOnce(absent())
            .mockResolvedValueOnce({ data: exactEvent() });
        insertCalendarEvent.mockRejectedValueOnce(
            Object.assign(new Error('identifier already exists'), { code: 409 }),
        );

        await expect(createClassEvent(options)).resolves.toMatchObject({ eventId });

        expect(insertCalendarEvent).toHaveBeenCalledTimes(1);
        expect(insertCalendarEvent).toHaveBeenCalledWith(expect.objectContaining({
            conferenceDataVersion: 1,
            sendUpdates: 'all',
            requestBody: expect.objectContaining({
                id: eventId,
                extendedProperties: {
                    private: {
                        honestSpanishSessionId: sessionId,
                    },
                },
                conferenceData: {
                    createRequest: expect.objectContaining({
                        requestId: conferenceRequestId,
                    }),
                },
            }),
        }));
    });

    it('fails closed when the deterministic ID belongs to a divergent event', async () => {
        getCalendarEvent.mockResolvedValueOnce({
            data: exactEvent({
                extendedProperties: {
                    private: {
                        honestSpanishSessionId: '518f47a2-9b6d-4c31-8a4e-123456789abc',
                    },
                },
            }),
        });

        await expect(createClassEvent(options)).rejects.toThrow(
            'class_calendar_event_identity_mismatch',
        );
        expect(insertCalendarEvent).not.toHaveBeenCalled();
    });

    it('waits for a pending Meet and only reads the deterministic event on retry', async () => {
        getCalendarEvent
            .mockResolvedValueOnce({
                data: exactEvent({
                    hangoutLink: null,
                    conferenceData: {
                        createRequest: {
                            requestId: conferenceRequestId,
                            status: { statusCode: 'pending' },
                        },
                        entryPoints: [],
                    },
                }),
            })
            .mockResolvedValueOnce({ data: exactEvent() });

        await expect(createClassEvent(options)).rejects.toMatchObject({
            name: 'FulfillmentDependencyPendingError',
            message: 'class_calendar_event_waiting_for_meet',
        });
        await expect(createClassEvent(options)).resolves.toMatchObject({ eventId });

        expect(insertCalendarEvent).not.toHaveBeenCalled();
        expect(getCalendarEvent).toHaveBeenCalledTimes(2);
    });
});
