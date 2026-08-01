/**
 * Google Calendar API Client
 * Provides helper functions for event management with Meet integration
 */
import { calendar, calendar_v3 } from '@googleapis/calendar';
import { FulfillmentDependencyPendingError } from '../fulfillment/dependency';
import { getAuthClient } from './auth';
import { describeGoogleError } from './logging';

let cachedCalendarClient: calendar_v3.Calendar | null = null;

/**
 * Get authenticated Calendar client
 */
export function getCalendarClient(): calendar_v3.Calendar {
    if (cachedCalendarClient) {
        return cachedCalendarClient;
    }

    const auth = getAuthClient();
    cachedCalendarClient = calendar({ version: 'v3', auth });
    return cachedCalendarClient;
}

export interface CreateEventOptions {
    summary: string;
    description?: string;
    startTime: Date | string;
    endTime: Date | string;
    attendees: string[];
    calendarId?: string;
}

export interface CalendarEvent {
    id: string;
    htmlLink: string;
    meetLink: string | null;
    hangoutLink: string | null;
}

/**
 * Create a calendar event with Google Meet video conferencing
 */
export async function createEventWithMeet(options: CreateEventOptions): Promise<CalendarEvent> {
    const calendar = getCalendarClient();
    const calendarId = options.calendarId || 'primary';

    try {
        const response = await calendar.events.insert({
            calendarId,
            conferenceDataVersion: 1,
            requestBody: {
                summary: options.summary,
                description: options.description,
                start: {
                    dateTime: typeof options.startTime === 'string'
                        ? options.startTime
                        : options.startTime.toISOString(),
                    timeZone: 'Europe/Madrid',
                },
                end: {
                    dateTime: typeof options.endTime === 'string'
                        ? options.endTime
                        : options.endTime.toISOString(),
                    timeZone: 'Europe/Madrid',
                },
                attendees: options.attendees.map(email => ({ email })),
                conferenceData: {
                    createRequest: {
                        requestId: `meet-${crypto.randomUUID()}`,
                        conferenceSolutionKey: {
                            type: 'hangoutsMeet',
                        },
                    },
                },
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 60 },
                        { method: 'popup', minutes: 15 },
                    ],
                },
            },
        });

        const event = response.data;
        const meetLink = event.conferenceData?.entryPoints?.find(
            ep => ep.entryPointType === 'video'
        )?.uri || null;

        console.log('[Calendar] Created event');
        if (meetLink) {
            console.log('[Calendar] Meet conference created');
        }

        return {
            id: event.id || '',
            htmlLink: event.htmlLink || '',
            meetLink,
            hangoutLink: event.hangoutLink || null,
        };
    } catch (error) {
        console.error('[Calendar] Error creating event:', describeGoogleError(error));
        throw error;
    }
}

/**
 * Get an event by ID
 */
export async function getEvent(eventId: string, calendarId: string = 'primary'): Promise<calendar_v3.Schema$Event | null> {
    const calendar = getCalendarClient();

    try {
        const response = await calendar.events.get({
            calendarId,
            eventId,
        });

        return response.data;
    } catch (error) {
        console.error('[Calendar] Error getting event:', describeGoogleError(error));
        return null;
    }
}

/**
 * Update an event
 */
export async function updateEvent(
    eventId: string,
    updates: Partial<calendar_v3.Schema$Event>,
    calendarId: string = 'primary'
): Promise<calendar_v3.Schema$Event | null> {
    const calendar = getCalendarClient();

    try {
        const response = await calendar.events.patch({
            calendarId,
            eventId,
            requestBody: updates,
        });

        console.log('[Calendar] Updated event');
        return response.data;
    } catch (error) {
        console.error('[Calendar] Error updating event:', describeGoogleError(error));
        throw error;
    }
}

/**
 * Delete (cancel) an event
 */
export async function deleteEvent(eventId: string, calendarId: string = 'primary'): Promise<boolean> {
    const calendar = getCalendarClient();

    try {
        await calendar.events.delete({
            calendarId,
            eventId,
            sendUpdates: 'all', // Notify attendees
        });

        console.log('[Calendar] Deleted event');
        return true;
    } catch (error) {
        const status =
            typeof error === 'object' && error !== null && 'code' in error
                ? Number((error as { code?: number }).code)
                : undefined;

        if (status === 404 || status === 410) {
            console.warn('[Calendar] Event was already absent in Google Calendar');
            return true;
        }

        console.error('[Calendar] Error deleting event:', describeGoogleError(error));
        return false;
    }
}

/**
 * List upcoming events
 */
export async function listUpcomingEvents(
    maxResults: number = 10,
    calendarId: string = 'primary'
): Promise<calendar_v3.Schema$Event[]> {
    const calendar = getCalendarClient();

    try {
        const response = await calendar.events.list({
            calendarId,
            timeMin: new Date().toISOString(),
            maxResults,
            singleEvents: true,
            orderBy: 'startTime',
        });

        return response.data.items || [];
    } catch (error) {
        console.error('[Calendar] Error listing events:', describeGoogleError(error));
        return [];
    }
}

/**
 * Check if a teacher's calendar is free for a given time slot.
 * Uses the Google Calendar FreeBusy API to avoid double booking.
 */
export async function checkTeacherAvailability(
    teacherEmail: string,
    startTime: Date,
    endTime: Date
): Promise<boolean> {
    const calendar = getCalendarClient();

    try {
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: startTime.toISOString(),
                timeMax: endTime.toISOString(),
                items: [{ id: teacherEmail }],
                timeZone: 'Europe/Madrid',
            },
        });

        const calendarAvailability = response.data.calendars?.[teacherEmail];
        if (!calendarAvailability || (calendarAvailability.errors?.length ?? 0) > 0) {
            throw new Error('FreeBusy did not return a valid result for the requested calendar');
        }

        const busySlots = calendarAvailability.busy || [];

        // If there are busy slots, the teacher is not available
        return busySlots.length === 0;
    } catch (error) {
        console.error('[Calendar] Error checking teacher availability:', describeGoogleError(error));
        // Fail-closed: if we can't verify availability, reject the booking.
        // Better to refuse a valid slot than to double-book.
        throw new Error(`Cannot verify teacher availability: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
}

// ============================================
// Class-specific Calendar Functions
// ============================================

export interface CreateClassEventOptions {
    sessionId: string;
    summary: string;
    studentEmail: string;
    teacherEmail: string;
    startTime: Date;
    endTime: Date;
    documentLink?: string;
    studentFolderLink?: string;
}

export interface ClassEventResult {
    eventId: string;
    meetLink: string;
    htmlLink: string;
}

const CLASS_EVENT_SESSION_PROPERTY = 'honestSpanishSessionId';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function googleStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    if ('code' in error && Number.isFinite(Number((error as { code?: unknown }).code))) {
        return Number((error as { code?: unknown }).code);
    }
    const response = 'response' in error
        ? (error as { response?: { status?: unknown } }).response
        : undefined;
    if (response && Number.isFinite(Number(response.status))) {
        return Number(response.status);
    }
    return null;
}

function isAmbiguousCalendarWrite(error: unknown): boolean {
    const status = googleStatus(error);
    return status === null
        || status === 408
        || status === 409
        || status === 425
        || status === 429
        || status >= 500;
}

export function deterministicClassEventId(sessionId: string): string {
    if (!UUID_PATTERN.test(sessionId)) {
        throw new Error('class_calendar_event_requires_uuid_session_id');
    }
    return sessionId.replaceAll('-', '').toLowerCase();
}

function deterministicClassEventIdentity(sessionId: string): {
    eventId: string;
    conferenceRequestId: string;
} {
    const eventId = deterministicClassEventId(sessionId);
    return {
        eventId,
        conferenceRequestId: eventId,
    };
}

function normalizedAttendees(event: calendar_v3.Schema$Event): string[] | null {
    const attendees = event.attendees ?? [];
    if (attendees.some((attendee) => typeof attendee.email !== 'string' || !attendee.email.trim())) {
        return null;
    }
    return [...new Set(attendees.map((attendee) => attendee.email!.trim().toLowerCase()))].sort();
}

function classEventResult(
    event: calendar_v3.Schema$Event,
    options: CreateClassEventOptions,
    expectedEventId: string,
    expectedConferenceRequestId: string,
): ClassEventResult {
    const expectedAttendees = [...new Set([
        options.studentEmail.trim().toLowerCase(),
        options.teacherEmail.trim().toLowerCase(),
    ])].sort();
    const actualAttendees = normalizedAttendees(event);
    const startAt = event.start?.dateTime ? Date.parse(event.start.dateTime) : Number.NaN;
    const endAt = event.end?.dateTime ? Date.parse(event.end.dateTime) : Number.NaN;
    const privateSessionId = event.extendedProperties?.private?.[CLASS_EVENT_SESSION_PROPERTY];
    const conferenceRequestId = event.conferenceData?.createRequest?.requestId;

    if (
        event.id !== expectedEventId
        || event.status === 'cancelled'
        || privateSessionId !== options.sessionId
        || startAt !== options.startTime.getTime()
        || endAt !== options.endTime.getTime()
        || actualAttendees === null
        || actualAttendees.length !== expectedAttendees.length
        || actualAttendees.some((email, index) => email !== expectedAttendees[index])
        || (
            typeof conferenceRequestId === 'string'
            && conferenceRequestId !== expectedConferenceRequestId
        )
    ) {
        throw new Error('class_calendar_event_identity_mismatch');
    }

    const meetLink = event.conferenceData?.entryPoints?.find(
        (entryPoint) => entryPoint.entryPointType === 'video'
    )?.uri || event.hangoutLink || '';
    const conferenceStatus = event.conferenceData?.createRequest?.status?.statusCode;
    if (!meetLink) {
        if (conferenceStatus === 'failure') {
            throw new Error('class_calendar_event_conference_failed');
        }
        throw new FulfillmentDependencyPendingError('class_calendar_event_waiting_for_meet');
    }

    return {
        eventId: expectedEventId,
        meetLink,
        htmlLink: event.htmlLink || '',
    };
}

async function observeClassEvent(
    calendarClient: calendar_v3.Calendar,
    eventId: string,
): Promise<calendar_v3.Schema$Event | null> {
    try {
        const response = await calendarClient.events.get({
            calendarId: 'primary',
            eventId,
        });
        return response.data;
    } catch (error) {
        const status = googleStatus(error);
        if (status === 404 || status === 410) return null;
        if (status === null || status === 408 || status === 425 || status === 429 || status >= 500) {
            throw new FulfillmentDependencyPendingError('class_calendar_event_observation_pending');
        }
        throw error;
    }
}

/**
 * Build description for class event with links
 */
function buildClassDescription(options: CreateClassEventOptions): string {
    let description = `🎓 Clase de Español\n\n`;

    if (options.documentLink) {
        description += `📄 Documento de la clase:\n${options.documentLink}\n\n`;
    }

    if (options.studentFolderLink) {
        description += `📁 Carpeta del alumno:\n${options.studentFolderLink}\n\n`;
    }

    description += `---\nEvento creado automáticamente por Español Honesto`;

    return description;
}

/**
 * Create a calendar event for a Spanish class with Google Meet
 */
export async function createClassEvent(options: CreateClassEventOptions): Promise<ClassEventResult> {
    const calendar = getCalendarClient();
    const { eventId, conferenceRequestId } = deterministicClassEventIdentity(options.sessionId);

    const existingEvent = await observeClassEvent(calendar, eventId);
    if (existingEvent) {
        return classEventResult(existingEvent, options, eventId, conferenceRequestId);
    }

    try {
        const response = await calendar.events.insert({
            calendarId: 'primary',
            conferenceDataVersion: 1,
            sendUpdates: 'all', // Send invitations to attendees
            requestBody: {
                id: eventId,
                summary: options.summary,
                description: buildClassDescription(options),
                start: {
                    dateTime: options.startTime.toISOString(),
                    timeZone: 'Europe/Madrid',
                },
                end: {
                    dateTime: options.endTime.toISOString(),
                    timeZone: 'Europe/Madrid',
                },
                attendees: [
                    { email: options.studentEmail },
                    { email: options.teacherEmail },
                ],
                extendedProperties: {
                    private: {
                        [CLASS_EVENT_SESSION_PROPERTY]: options.sessionId,
                    },
                },
                conferenceData: {
                    createRequest: {
                        requestId: conferenceRequestId,
                        conferenceSolutionKey: {
                            type: 'hangoutsMeet',
                        },
                    },
                },
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'email', minutes: 24 * 60 },  // 24 hours before
                        { method: 'popup', minutes: 30 },        // 30 min before
                    ],
                },
            },
        });

        const result = classEventResult(response.data, options, eventId, conferenceRequestId);

        console.log('[Calendar] Created class event');
        console.log('[Calendar] Meet conference created');
        return result;
    } catch (error) {
        console.error('[Calendar] Error creating class event:', describeGoogleError(error));
        if (error instanceof FulfillmentDependencyPendingError) throw error;

        let reconciledEvent: calendar_v3.Schema$Event | null;
        try {
            reconciledEvent = await observeClassEvent(calendar, eventId);
        } catch (observationError) {
            if (isAmbiguousCalendarWrite(error)) throw observationError;
            throw error;
        }
        if (reconciledEvent) {
            return classEventResult(reconciledEvent, options, eventId, conferenceRequestId);
        }
        if (isAmbiguousCalendarWrite(error)) {
            throw new FulfillmentDependencyPendingError('class_calendar_event_write_outcome_pending');
        }
        throw error;
    }
}

/**
 * Cancel a class event and notify attendees
 */
export async function cancelClassEvent(eventId: string): Promise<boolean> {
    return deleteEvent(eventId, 'primary');
}

/**
 * Update a calendar event (for rescheduling)
 */
export async function updateCalendarEvent(
    eventId: string,
    updates: {
        startTime?: Date;
        endTime?: Date;
        description?: string;
        summary?: string;
        operationId?: string;
    }
): Promise<'accepted' | 'ambiguous' | 'retryable'> {
    const calendar = getCalendarClient();

    try {
        const patch: calendar_v3.Schema$Event = {};

        if (updates.startTime) {
            patch.start = {
                dateTime: updates.startTime.toISOString(),
                timeZone: 'Europe/Madrid',
            };
        }

        if (updates.endTime) {
            patch.end = {
                dateTime: updates.endTime.toISOString(),
                timeZone: 'Europe/Madrid',
            };
        }

        if (updates.description) {
            patch.description = updates.description;
        }

        if (updates.summary) {
            patch.summary = updates.summary;
        }

        if (updates.operationId) {
            patch.extendedProperties = {
                private: {
                    honestSpanishRescheduleOperationId: updates.operationId,
                },
            };
        }

        await calendar.events.patch({
            calendarId: 'primary',
            eventId,
            sendUpdates: 'none',
            requestBody: patch,
        });

        console.log('[Calendar] Updated event');
        return 'accepted';
    } catch (error) {
        const status = typeof error === 'object' && error !== null && 'code' in error
            ? Number((error as { code?: number }).code)
            : undefined;
        console.error('[Calendar] Failed to update event:', describeGoogleError(error));
        if (status === 429 || (status !== undefined && status >= 500 && status <= 599)) {
            return 'retryable';
        }
        return 'ambiguous';
    }
}
