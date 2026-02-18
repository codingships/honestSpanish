/**
 * Google Calendar API Client
 * Provides helper functions for event management with Meet integration
 */
import { calendar, calendar_v3 } from '@googleapis/calendar';
import { getAuthClient } from './auth';

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

        console.log(`[Calendar] Created event: ${options.summary} (${event.id})`);
        if (meetLink) {
            console.log(`[Calendar] Meet link: ${meetLink}`);
        }

        return {
            id: event.id || '',
            htmlLink: event.htmlLink || '',
            meetLink,
            hangoutLink: event.hangoutLink || null,
        };
    } catch (error) {
        console.error('[Calendar] Error creating event:', error instanceof Error ? error.message : 'Unknown error');
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
        console.error('[Calendar] Error getting event:', error instanceof Error ? error.message : 'Unknown error');
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

        console.log(`[Calendar] Updated event: ${eventId}`);
        return response.data;
    } catch (error) {
        console.error('[Calendar] Error updating event:', error instanceof Error ? error.message : 'Unknown error');
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

        console.log(`[Calendar] Deleted event: ${eventId}`);
        return true;
    } catch (error) {
        console.error('[Calendar] Error deleting event:', error instanceof Error ? error.message : 'Unknown error');
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
        console.error('[Calendar] Error listing events:', error instanceof Error ? error.message : 'Unknown error');
        return [];
    }
}

// ============================================
// Class-specific Calendar Functions
// ============================================

export interface CreateClassEventOptions {
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

    try {
        const response = await calendar.events.insert({
            calendarId: 'primary',
            conferenceDataVersion: 1,
            sendUpdates: 'all', // Send invitations to attendees
            requestBody: {
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
                conferenceData: {
                    createRequest: {
                        requestId: `class-${crypto.randomUUID()}`,
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

        const event = response.data;
        const meetLink = event.conferenceData?.entryPoints?.find(
            ep => ep.entryPointType === 'video'
        )?.uri || event.hangoutLink || '';

        console.log(`[Calendar] Created class event: ${options.summary} (${event.id})`);
        console.log(`[Calendar] Meet link: ${meetLink}`);

        return {
            eventId: event.id || '',
            meetLink,
            htmlLink: event.htmlLink || '',
        };
    } catch (error) {
        console.error('[Calendar] Error creating class event:', error instanceof Error ? error.message : 'Unknown error');
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
    }
): Promise<boolean> {
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

        await calendar.events.patch({
            calendarId: 'primary',
            eventId,
            sendUpdates: 'all',
            requestBody: patch,
        });

        console.log(`[Calendar] Updated event: ${eventId}`);
        return true;
    } catch (error) {
        console.error('[Calendar] Failed to update event:',
            error instanceof Error ? error.message : 'Unknown error');
        return false;
    }
}
