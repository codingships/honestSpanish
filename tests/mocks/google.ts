import { vi } from 'vitest';

export const createMockGoogleCalendar = (overrides: any = {}) => ({
    events: {
        insert: vi.fn().mockResolvedValue({
            data: {
                id: 'event_test_123',
                hangoutLink: 'https://meet.google.com/test-link',
                htmlLink: 'https://calendar.google.com/event/test',
            },
        }),
        delete: vi.fn().mockResolvedValue({ data: {} }),
        patch: vi.fn().mockResolvedValue({ data: { id: 'event_test_123' } }),
    },
    ...overrides,
});

export const createMockGoogleDrive = (overrides: any = {}) => ({
    files: {
        create: vi.fn().mockResolvedValue({
            data: {
                id: 'file_test_123',
                webViewLink: 'https://docs.google.com/document/test',
            },
        }),
        get: vi.fn().mockResolvedValue({
            data: { webViewLink: 'https://drive.google.com/drive/folders/test' },
        }),
        copy: vi.fn().mockResolvedValue({
            data: { id: 'file_copy_123', webViewLink: 'https://docs.google.com/document/copy' },
        }),
    },
    permissions: {
        create: vi.fn().mockResolvedValue({ data: { id: 'perm_123' } }),
    },
    ...overrides,
});
