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
        privateProfileMocks.getPrivateProfiles.mockResolvedValue(new Map([['student-1', {
            drive_folder_id: 'student-folder-1',
            current_level: 'B1',
        }]]));
        vi.mocked(createClassDocument).mockResolvedValue({
            docId: 'doc-created',
            docUrl: 'https://docs.example/doc-created',
        });
        vi.mocked(getFileLink).mockResolvedValue('https://drive.example/student-folder-1');
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
            emailEffectJob: {
                jobId: '11111111-1111-4111-8111-111111111111',
                leaseOwner: 'worker:test:1',
            },
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

    it('separates four Google writes, confirmation email, and CRM into bounded replay-safe phases', async () => {
        const sessions = Array.from({ length: 4 }, (_, index) => ({
            id: `session-${index + 1}`,
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            teacher_id: 'teacher-1',
            status: 'scheduled',
            scheduled_at: `2026-08-${String(3 + index * 7).padStart(2, '0')}T10:00:00.000Z`,
            duration_minutes: 50,
            meet_link: null as string | null,
            drive_doc_url: null as string | null,
            drive_doc_id: null as string | null,
            calendar_event_id: null as string | null,
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
        }));
        const sessionsQuery: any = {
            select: vi.fn(() => sessionsQuery),
            in: vi.fn((_field: string, ids: string[]) => Promise.resolve({
                data: ids.map((id) => sessions.find((session) => session.id === id)),
                error: null,
            })),
            update: vi.fn((values: Record<string, string>) => ({
                eq: vi.fn((_field: string, id: string) => {
                    Object.assign(sessions.find((session) => session.id === id)!, values);
                    return Promise.resolve({ error: null });
                }),
            })),
        };
        const succeededEffectKeys = new Set<string>();
        const recordedCrmSessionIds = new Set<string>();
        const effectsQuery: any = {
            select: vi.fn(() => effectsQuery),
            eq: vi.fn(() => effectsQuery),
            in: vi.fn((_field: string, keys: string[]) => Promise.resolve({
                data: keys
                    .filter((effectKey) => succeededEffectKeys.has(effectKey))
                    .map((effectKey) => ({ effect_key: effectKey, status: 'succeeded' })),
                error: null,
            })),
        };
        const crmActivitiesQuery: any = {
            select: vi.fn(() => crmActivitiesQuery),
            eq: vi.fn(() => crmActivitiesQuery),
            in: vi.fn((_field: string, sessionIds: string[]) => Promise.resolve({
                data: sessionIds
                    .filter((sessionId) => recordedCrmSessionIds.has(sessionId))
                    .map((relatedEntityId) => ({ related_entity_id: relatedEntityId })),
                error: null,
            })),
        };
        const supabaseAdmin = {
            from: vi.fn((table: string) => {
                if (table === 'sessions') return sessionsQuery;
                if (table === 'fulfillment_effects') return effectsQuery;
                if (table === 'crm_activities') return crmActivitiesQuery;
                throw new Error(`Unexpected table ${table}`);
            }),
        };
        let driveFolderReady = false;
        privateProfileMocks.getPrivateProfiles.mockImplementation(async () => driveFolderReady
            ? new Map([['student-1', {
                drive_folder_id: 'student-folder-1',
                current_level: 'B1',
            }]])
            : new Map());
        let documentNumber = 0;
        vi.mocked(createClassDocument).mockImplementation(async () => {
            documentNumber += 1;
            return {
                docId: `doc-${documentNumber}`,
                docUrl: `https://docs.example/doc-${documentNumber}`,
            };
        });
        vi.mocked(getFileLink).mockResolvedValue('https://drive.example/student-folder-1');
        vi.mocked(createClassEvent).mockImplementation(async ({ sessionId }) => ({
            eventId: `event-${sessionId}`,
            meetLink: `https://meet.example/${sessionId}`,
            htmlLink: `https://calendar.example/${sessionId}`,
        }));
        const deliveredConfirmations = new Set<string>();
        const confirmationProviderWrites: string[] = [];
        emailMocks.sendClassConfirmation.mockImplementation(async (
            recipient: string,
            _data: unknown,
            options?: { fulfillmentEffect?: { effectKey?: string } },
        ) => {
            const deliveryKey = `${options?.fulfillmentEffect?.effectKey}:${recipient}`;
            if (options?.fulfillmentEffect?.effectKey) {
                succeededEffectKeys.add(options.fulfillmentEffect.effectKey);
            }
            if (!deliveredConfirmations.has(deliveryKey)) {
                deliveredConfirmations.add(deliveryKey);
                confirmationProviderWrites.push(deliveryKey);
            }
            return true;
        });
        const options = {
            autoCreateMeeting: true,
            emailEffectJob: {
                jobId: '11111111-1111-4111-8111-111111111111',
                leaseOwner: 'worker:test:1',
            },
            sendEmail: true,
        };
        let rejectSecondCrmRecordOnce = true;
        crmClassEmailMocks.recordClassEmailOutInCrmSafe.mockImplementation(async (_client, input) => {
            if (input.sessionId === 'session-2' && rejectSecondCrmRecordOnce) {
                rejectSecondCrmRecordOnce = false;
                return { status: 'skipped', reason: 'record_failed' };
            }
            recordedCrmSessionIds.add(input.sessionId);
            return { status: 'created' };
        });

        await expect(fulfillSessionBatch(supabaseAdmin as any, sessions.map(({ id }) => id), options))
            .rejects.toMatchObject({
                name: 'FulfillmentDependencyPendingError',
                message: 'bulk_session_fulfillment_waiting_for_drive_folder',
            });

        expect(createClassDocument).not.toHaveBeenCalled();
        expect(getFileLink).not.toHaveBeenCalled();
        expect(createClassEvent).not.toHaveBeenCalled();
        expect(emailMocks.sendClassConfirmation).not.toHaveBeenCalled();
        expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).not.toHaveBeenCalled();

        driveFolderReady = true;
        for (let invocation = 0; invocation < 4; invocation += 1) {
            await expect(fulfillSessionBatch(
                supabaseAdmin as any,
                sessions.map(({ id }) => id),
                options,
            )).rejects.toMatchObject({
                name: 'FulfillmentDependencyPendingError',
                message: 'bulk_session_fulfillment_remaining_sessions',
                delaySeconds: 0,
            });
            expect(createClassDocument).toHaveBeenCalledTimes(invocation + 1);
            expect(createClassEvent).toHaveBeenCalledTimes(invocation + 1);
            expect(emailMocks.sendClassConfirmation).not.toHaveBeenCalled();
            expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).not.toHaveBeenCalled();
        }

        await expect(fulfillSessionBatch(
            supabaseAdmin as any,
            sessions.map(({ id }) => id),
            options,
        )).rejects.toMatchObject({
            name: 'FulfillmentDependencyPendingError',
            message: 'bulk_session_fulfillment_crm_pending',
            delaySeconds: 0,
        });

        expect(createClassDocument).toHaveBeenCalledTimes(4);
        expect(createClassEvent).toHaveBeenCalledTimes(4);
        expect(sessions).toEqual(expect.arrayContaining(Array.from({ length: 4 }, (_, index) => expect.objectContaining({
            id: `session-${index + 1}`,
            drive_doc_id: `doc-${index + 1}`,
            drive_doc_url: `https://docs.example/doc-${index + 1}`,
            calendar_event_id: `event-session-${index + 1}`,
            meet_link: `https://meet.example/session-${index + 1}`,
        }))));
        expect(deliveredConfirmations).toEqual(new Set([
            'email.class_confirmation.student:student@example.com',
            'email.class_confirmation.teacher:teacher@example.com',
        ]));
        expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).not.toHaveBeenCalled();

        await expect(fulfillSessionBatch(
            supabaseAdmin as any,
            sessions.map(({ id }) => id),
            options,
        )).rejects.toThrow('bulk_session_fulfillment_crm_record_failed:record_failed');

        expect(recordedCrmSessionIds).toEqual(new Set(['session-1']));

        await fulfillSessionBatch(supabaseAdmin as any, sessions.map(({ id }) => id), options);

        expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).toHaveBeenCalledTimes(5);
        expect(recordedCrmSessionIds).toEqual(new Set(sessions.map(({ id }) => id)));

        await fulfillSessionBatch(supabaseAdmin as any, sessions.map(({ id }) => id), options);

        expect(createClassDocument).toHaveBeenCalledTimes(4);
        expect(createClassEvent).toHaveBeenCalledTimes(4);
        expect(deliveredConfirmations.size).toBe(2);
        expect(confirmationProviderWrites).toHaveLength(2);
        expect(emailMocks.sendClassConfirmation).toHaveBeenCalledTimes(2);
        expect(crmClassEmailMocks.recordClassEmailOutInCrmSafe).toHaveBeenCalledTimes(5);
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
