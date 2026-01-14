/**
 * Comprehensive Google APIs Mock for Testing
 * 
 * Provides detailed mocks for:
 * - Google Drive (folder creation, file management)
 * - Google Calendar (event creation, updates)
 * - Google Docs (document creation)
 * - Google Meet (meeting links)
 */
import { vi } from 'vitest';

// Types
interface MockConfig {
    shouldFail?: boolean;
    failureType?: 'auth' | 'quota' | 'not_found' | 'permission';
    delay?: number;
}

// ==================== GOOGLE DRIVE MOCKS ====================

export const mockDriveFolder = {
    id: 'folder_test123456',
    name: 'Test Student - Español Honesto',
    mimeType: 'application/vnd.google-apps.folder',
    webViewLink: 'https://drive.google.com/drive/folders/folder_test123456',
    parents: ['root_folder_id'],
    createdTime: '2026-01-14T12:00:00.000Z',
};

export const mockDriveFile = {
    id: 'file_test123456',
    name: 'Clase 2026-01-14 - Gramática',
    mimeType: 'application/vnd.google-apps.document',
    webViewLink: 'https://docs.google.com/document/d/file_test123456/edit',
    parents: ['folder_test123456'],
    createdTime: '2026-01-14T12:00:00.000Z',
};

export const mockDrivePermission = {
    id: 'permission_test123',
    type: 'user',
    role: 'writer',
    emailAddress: 'student@test.com',
};

// ==================== GOOGLE CALENDAR MOCKS ====================

export const mockCalendarEvent = {
    id: 'event_test123456',
    summary: 'Clase de Español - Test Student',
    description: 'Clase de español con Test Teacher',
    start: {
        dateTime: '2026-01-15T10:00:00+01:00',
        timeZone: 'Europe/Madrid',
    },
    end: {
        dateTime: '2026-01-15T11:00:00+01:00',
        timeZone: 'Europe/Madrid',
    },
    attendees: [
        { email: 'student@test.com', responseStatus: 'needsAction' },
        { email: 'teacher@espanolhonesto.com', responseStatus: 'accepted' },
    ],
    conferenceData: {
        conferenceId: 'meet_test123',
        conferenceSolution: {
            key: { type: 'hangoutsMeet' },
            name: 'Google Meet',
        },
        entryPoints: [
            {
                entryPointType: 'video',
                uri: 'https://meet.google.com/abc-defg-hij',
                label: 'meet.google.com/abc-defg-hij',
            },
        ],
    },
    htmlLink: 'https://calendar.google.com/calendar/event?eid=event_test123456',
    hangoutLink: 'https://meet.google.com/abc-defg-hij',
    status: 'confirmed',
};

export const mockCalendarList = {
    items: [mockCalendarEvent],
    nextPageToken: null,
};

// ==================== GOOGLE DOCS MOCKS ====================

export const mockDocument = {
    documentId: 'doc_test123456',
    title: 'Clase 2026-01-15 - Test Student',
    body: {
        content: [
            { paragraph: { elements: [{ textRun: { content: 'Notas de la clase...\n' } }] } },
        ],
    },
    revisionId: 'revision_1',
};

// ==================== ERROR RESPONSES ====================

export const googleErrors = {
    auth: {
        code: 401,
        message: 'Invalid Credentials',
        errors: [{ reason: 'authError' }],
    },
    quota: {
        code: 403,
        message: 'Rate Limit Exceeded',
        errors: [{ reason: 'rateLimitExceeded' }],
    },
    not_found: {
        code: 404,
        message: 'File not found',
        errors: [{ reason: 'notFound' }],
    },
    permission: {
        code: 403,
        message: 'The caller does not have permission',
        errors: [{ reason: 'forbidden' }],
    },
};

// ==================== MOCK FACTORY ====================

export const createMockGoogleDrive = (config: MockConfig = {}) => {
    const { shouldFail = false, failureType = 'not_found', delay = 0 } = config;

    const withDelay = async <T>(value: T): Promise<T> => {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (shouldFail) {
            throw { response: { data: { error: googleErrors[failureType] } } };
        }
        return value;
    };

    return {
        files: {
            create: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockDriveFolder, name: params.requestBody?.name } })
            ),
            get: vi.fn().mockImplementation((params) =>
                withDelay({ data: params.fileId === 'folder_test123456' ? mockDriveFolder : mockDriveFile })
            ),
            list: vi.fn().mockImplementation(() =>
                withDelay({ data: { files: [mockDriveFolder, mockDriveFile] } })
            ),
            update: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockDriveFile, ...params.requestBody } })
            ),
            delete: vi.fn().mockImplementation(() =>
                withDelay({ data: {} })
            ),
            copy: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockDriveFile, id: 'copy_file_test123' } })
            ),
        },
        permissions: {
            create: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockDrivePermission, emailAddress: params.requestBody?.emailAddress } })
            ),
            delete: vi.fn().mockImplementation(() =>
                withDelay({ data: {} })
            ),
            list: vi.fn().mockImplementation(() =>
                withDelay({ data: { permissions: [mockDrivePermission] } })
            ),
        },
    };
};

export const createMockGoogleCalendar = (config: MockConfig = {}) => {
    const { shouldFail = false, failureType = 'not_found', delay = 0 } = config;

    const withDelay = async <T>(value: T): Promise<T> => {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (shouldFail) {
            throw { response: { data: { error: googleErrors[failureType] } } };
        }
        return value;
    };

    return {
        events: {
            insert: vi.fn().mockImplementation((params) =>
                withDelay({
                    data: {
                        ...mockCalendarEvent,
                        summary: params.requestBody?.summary,
                        start: params.requestBody?.start,
                        end: params.requestBody?.end,
                    }
                })
            ),
            get: vi.fn().mockImplementation(() =>
                withDelay({ data: mockCalendarEvent })
            ),
            update: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockCalendarEvent, ...params.requestBody } })
            ),
            delete: vi.fn().mockImplementation(() =>
                withDelay({ data: {} })
            ),
            list: vi.fn().mockImplementation(() =>
                withDelay({ data: mockCalendarList })
            ),
            patch: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockCalendarEvent, status: params.requestBody?.status } })
            ),
        },
        calendarList: {
            list: vi.fn().mockImplementation(() =>
                withDelay({ data: { items: [{ id: 'primary', summary: 'Main Calendar' }] } })
            ),
        },
    };
};

export const createMockGoogleDocs = (config: MockConfig = {}) => {
    const { shouldFail = false, failureType = 'not_found', delay = 0 } = config;

    const withDelay = async <T>(value: T): Promise<T> => {
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        if (shouldFail) {
            throw { response: { data: { error: googleErrors[failureType] } } };
        }
        return value;
    };

    return {
        documents: {
            create: vi.fn().mockImplementation((params) =>
                withDelay({ data: { ...mockDocument, title: params.requestBody?.title } })
            ),
            get: vi.fn().mockImplementation(() =>
                withDelay({ data: mockDocument })
            ),
            batchUpdate: vi.fn().mockImplementation(() =>
                withDelay({ data: { documentId: mockDocument.documentId } })
            ),
        },
    };
};

// ==================== COMBINED GOOGLE API MOCK ====================

export const createMockGoogleAPIs = (config: MockConfig = {}) => ({
    drive: createMockGoogleDrive(config),
    calendar: createMockGoogleCalendar(config),
    docs: createMockGoogleDocs(config),
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Create a mock Meet link for testing
 */
export const generateMockMeetLink = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const part1 = Array(3).fill(null).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    const part2 = Array(4).fill(null).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    const part3 = Array(3).fill(null).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `https://meet.google.com/${part1}-${part2}-${part3}`;
};

/**
 * Create mock calendar event with customized time
 */
export const createMockEventWithTime = (date: Date, durationMinutes = 60) => {
    const endDate = new Date(date.getTime() + durationMinutes * 60000);
    return {
        ...mockCalendarEvent,
        id: `event_${Date.now()}`,
        start: {
            dateTime: date.toISOString(),
            timeZone: 'Europe/Madrid',
        },
        end: {
            dateTime: endDate.toISOString(),
            timeZone: 'Europe/Madrid',
        },
    };
};

export default {
    createMockGoogleDrive,
    createMockGoogleCalendar,
    createMockGoogleDocs,
    createMockGoogleAPIs,
};
