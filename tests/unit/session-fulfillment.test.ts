import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/google/calendar', () => ({
    createClassEvent: vi.fn(),
}));

vi.mock('../../src/lib/google/drive', () => ({
    createClassDocument: vi.fn(),
    getFileLink: vi.fn(),
}));

const privateProfileMocks = vi.hoisted(() => ({
    getPrivateProfiles: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfiles: privateProfileMocks.getPrivateProfiles,
}));

const emailMocks = vi.hoisted(() => ({
    sendClassConfirmation: vi.fn(),
}));

vi.mock('../../src/lib/email', () => ({
    sendClassConfirmation: emailMocks.sendClassConfirmation,
}));

const crmClassEmailMocks = vi.hoisted(() => ({
    recordClassEmailOutInCrmSafe: vi.fn(),
}));

vi.mock('../../src/lib/crm/class-email', () => ({
    recordClassEmailOutInCrmSafe: crmClassEmailMocks.recordClassEmailOutInCrmSafe,
}));

import { fulfillSingleSession } from '../../src/lib/fulfillment/session-fulfillment';

function createSessionsQuery(result: { data: unknown; error: unknown }) {
    const query: any = {
        select: vi.fn(() => query),
        in: vi.fn().mockResolvedValue(result),
    };
    return query;
}

describe('session fulfillment', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        privateProfileMocks.getPrivateProfiles.mockResolvedValue(new Map());
        emailMocks.sendClassConfirmation.mockResolvedValue(true);
        crmClassEmailMocks.recordClassEmailOutInCrmSafe.mockResolvedValue({ status: 'created' });
    });

    it('sends class confirmation emails and records the outbound CRM event', async () => {
        const session = {
            id: 'session-1',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            scheduled_at: '2026-06-26T10:00:00.000Z',
            duration_minutes: 50,
            meet_link: 'https://meet.example/abc',
            drive_doc_url: 'https://docs.example/doc',
            drive_doc_id: 'doc-1',
            calendar_event_id: 'event-1',
            student: {
                id: 'student-1',
                full_name: 'Student One',
                email: 'student@example.com',
            },
            teacher: {
                id: 'teacher-1',
                full_name: 'Teacher One',
                email: 'teacher@example.com',
            },
        };
        const sessionsQuery = createSessionsQuery({ data: [session], error: null });
        const supabaseAdmin = {
            from: vi.fn((table: string) => {
                if (table === 'sessions') return sessionsQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        await fulfillSingleSession(supabaseAdmin as any, 'session-1', {
            autoCreateMeeting: false,
            sendEmail: true,
        });

        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledTimes(2);
        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledWith('student@example.com', expect.objectContaining({
            recipientName: 'Student One',
            isTeacher: false,
            otherPartyName: 'Teacher One',
            duration: 50,
            meetLink: 'https://meet.example/abc',
            documentLink: 'https://docs.example/doc',
        }));
        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledWith('teacher@example.com', expect.objectContaining({
            recipientName: 'Teacher One',
            isTeacher: true,
            otherPartyName: 'Student One',
            duration: 50,
            meetLink: 'https://meet.example/abc',
            documentLink: 'https://docs.example/doc',
        }));
        expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).toHaveBeenCalledWith(supabaseAdmin, expect.objectContaining({
            template: 'class_confirmation',
            sessionId: 'session-1',
            studentId: 'student-1',
            studentEmail: 'student@example.com',
            studentName: 'Student One',
            teacherId: 'teacher-1',
            teacherEmail: 'teacher@example.com',
            teacherName: 'Teacher One',
            subscriptionId: 'subscription-1',
            scheduledAt: '2026-06-26T10:00:00.000Z',
            durationMinutes: 50,
            meetLink: 'https://meet.example/abc',
            documentLink: 'https://docs.example/doc',
            source: 'session_fulfillment',
        }));
    });
});
