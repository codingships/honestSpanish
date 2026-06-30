import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMocks = vi.hoisted(() => ({
    recordCrmActivityForProfileSafe: vi.fn(),
}));

vi.mock('../../src/lib/crm/activity-sync', () => ({
    recordCrmActivityForProfileSafe: activityMocks.recordCrmActivityForProfileSafe,
}));

import { recordClassEmailOutInCrmSafe } from '../../src/lib/crm/class-email';

describe('recordClassEmailOutInCrmSafe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activityMocks.recordCrmActivityForProfileSafe.mockResolvedValue({ status: 'created' });
    });

    it('records class transactional email on the student CRM timeline', async () => {
        const client = { from: vi.fn() };

        await expect(recordClassEmailOutInCrmSafe(client as any, {
            template: 'class_reminder',
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
            dateLabel: 'viernes, 26 de junio de 2026',
            timeLabel: '10:00',
            meetLink: 'https://meet.example/abc',
            documentLink: 'https://docs.example/doc',
            source: 'reminder_worker',
        })).resolves.toEqual({ status: 'created' });

        expect(activityMocks.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(client, expect.objectContaining({
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            source: 'reminder_worker',
            sourcePath: '/campus',
            activityType: 'email_out',
            subject: 'Class reminder email sent',
            body: 'class_reminder',
            relatedEntityType: 'session_class_reminder_email',
            relatedEntityId: 'session-1',
            metadata: expect.objectContaining({
                automated: true,
                purpose: 'transactional',
                template: 'class_reminder',
                session_id: 'session-1',
                subscription_id: 'subscription-1',
                scheduled_at: '2026-06-26T10:00:00.000Z',
                duration_minutes: 50,
                meet_link_ready: true,
                document_link_ready: true,
                recipients: {
                    student: {
                        id: 'student-1',
                        email: 'student@example.com',
                    },
                    teacher: {
                        id: 'teacher-1',
                        email: 'teacher@example.com',
                        name: 'Teacher One',
                    },
                },
            }),
        }));
    });
});
