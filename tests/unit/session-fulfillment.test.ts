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

import { fulfillSessionBatch, fulfillSingleSession } from '../../src/lib/fulfillment/session-fulfillment';
import { createClassEvent } from '../../src/lib/google/calendar';
import { createClassDocument, getFileLink } from '../../src/lib/google/drive';

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

    it('passes the session identity when creating a missing Calendar event', async () => {
        const sessionId = '418f47a2-9b6d-4c31-8a4e-123456789abc';
        const eventId = '418f47a29b6d4c318a4e123456789abc';
        const session = {
            id: sessionId,
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            status: 'scheduled',
            scheduled_at: '2026-06-26T10:00:00.000Z',
            duration_minutes: 50,
            meet_link: null,
            drive_doc_url: null,
            drive_doc_id: null,
            calendar_event_id: null,
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
        const updateChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(sessionsQuery)
                .mockReturnValueOnce(updateChain),
        };
        vi.mocked(createClassEvent).mockResolvedValue({
            eventId,
            meetLink: 'https://meet.example/abc',
            htmlLink: 'https://calendar.example/event',
        });

        await fulfillSingleSession(supabaseAdmin as any, sessionId, {
            autoCreateMeeting: true,
            sendEmail: false,
        });

        expect(createClassEvent).toHaveBeenCalledWith(expect.objectContaining({
            sessionId,
            studentEmail: 'student@example.com',
            teacherEmail: 'teacher@example.com',
            startTime: new Date('2026-06-26T10:00:00.000Z'),
            endTime: new Date('2026-06-26T10:50:00.000Z'),
        }));
        expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
            calendar_event_id: eventId,
            meet_link: 'https://meet.example/abc',
        }));
    });

    it('sends class confirmation emails and records the outbound CRM event', async () => {
        const session = {
            id: 'session-1',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            status: 'scheduled',
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
            emailEffectJob: {
                jobId: '11111111-1111-4111-8111-111111111111',
                leaseOwner: 'worker:test:1',
            },
            sendEmail: true,
        });

        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledTimes(2);
        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledWith('student@example.com', expect.objectContaining({
            recipientName: 'Student One',
            isTeacher: false,
            otherPartyName: 'Teacher One',
            date: 'Friday, 26 June 2026',
            time: '12:00 CEST',
            duration: 50,
            meetLink: 'https://meet.example/abc',
            documentLink: 'https://docs.example/doc',
        }), expect.objectContaining({
            fulfillmentEffect: expect.objectContaining({
                effectKey: 'email.class_confirmation.student',
                jobId: '11111111-1111-4111-8111-111111111111',
                leaseOwner: 'worker:test:1',
                supabaseAdmin,
            }),
        }));
        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledWith('teacher@example.com', expect.objectContaining({
            recipientName: 'Teacher One',
            isTeacher: true,
            otherPartyName: 'Student One',
            duration: 50,
            meetLink: 'https://meet.example/abc',
            documentLink: 'https://docs.example/doc',
        }), expect.objectContaining({
            fulfillmentEffect: expect.objectContaining({
                effectKey: 'email.class_confirmation.teacher',
                jobId: '11111111-1111-4111-8111-111111111111',
                leaseOwner: 'worker:test:1',
                supabaseAdmin,
            }),
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

    it('does not append a zero-additional-classes suffix to a one-session batch', async () => {
        const session = {
            id: 'session-1',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            status: 'scheduled',
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

        await fulfillSessionBatch(supabaseAdmin as any, ['session-1'], {
            autoCreateMeeting: false,
            sendEmail: true,
        });

        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledWith(
            'student@example.com',
            expect.objectContaining({
                date: 'Friday, 26 June 2026',
            }),
        );
        expect(emailMocks.sendClassConfirmation.mock.calls[0]?.[1]?.date).not.toContain('+ 0');
    });

    it('skips cancelled sessions in a batch without creating provider artifacts or notifications', async () => {
        const cancelledSession = {
            id: 'session-cancelled',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            status: 'cancelled',
            scheduled_at: '2026-06-26T10:00:00.000Z',
            duration_minutes: 50,
            meet_link: null,
            drive_doc_url: null,
            drive_doc_id: null,
            calendar_event_id: null,
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
        const sessionsQuery = createSessionsQuery({ data: [cancelledSession], error: null });
        const supabaseAdmin = {
            from: vi.fn((table: string) => {
                if (table === 'sessions') return sessionsQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };

        await fulfillSessionBatch(supabaseAdmin as any, ['session-cancelled'], {
            autoCreateMeeting: true,
            sendEmail: true,
        });

        expect(createClassEvent).not.toHaveBeenCalled();
        expect(createClassDocument).not.toHaveBeenCalled();
        expect(getFileLink).not.toHaveBeenCalled();
        expect(emailMocks.sendClassConfirmation).not.toHaveBeenCalled();
        expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).not.toHaveBeenCalled();
    });
});
