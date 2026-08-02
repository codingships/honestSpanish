import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    recordFirstClassCancelled,
    recordFirstClassCompleted,
    recordFirstClassScheduled,
    recordNoShowFollowUp,
    recordPostPaymentOnboarding,
} from '../../src/lib/crm/onboarding';
import { ensureCrmContactForProfile } from '../../src/lib/crm/activity-sync';

vi.mock('../../src/lib/crm/activity-sync', () => ({
    ensureCrmContactForProfile: vi.fn(),
}));

type QueryResult = { data: unknown; error: unknown };

function createQuery(result: QueryResult, recorder?: {
    inserts?: unknown[];
    upserts?: unknown[];
    upsertOptions?: unknown[];
    updates?: unknown[];
}) {
    const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        insert: vi.fn((value: unknown) => {
            recorder?.inserts?.push(value);
            return query;
        }),
        upsert: vi.fn((value: unknown, options: unknown) => {
            recorder?.upserts?.push(value);
            recorder?.upsertOptions?.push(options);
            return query;
        }),
        update: vi.fn((value: unknown) => {
            recorder?.updates?.push(value);
            return query;
        }),
        maybeSingle: vi.fn().mockResolvedValue(result),
        single: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
    };
    return query;
}

function createClient(
    queues: Record<string, any[]>,
    rpc = vi.fn().mockResolvedValue({ data: true, error: null }),
) {
    return {
        from: vi.fn((table: string) => {
            const query = queues[table]?.shift();
            if (!query) throw new Error(`Unexpected table query: ${table}`);
            return query;
        }),
        rpc,
    };
}

describe('recordPostPaymentOnboarding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates an actionable first-class onboarding task and CRM activity', async () => {
        const taskInserts: unknown[] = [];
        const activityInserts: unknown[] = [];
        const contactUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-1' }, error: null }, { inserts: taskInserts }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }),
                createQuery({ data: null, error: null }, { inserts: activityInserts }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }, { updates: contactUpdates }),
            ],
        });

        const result = await recordPostPaymentOnboarding(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            packageId: 'package-1',
            packageName: 'Plan Hybrid',
            driveFolderUrl: 'https://drive.example/folder',
            occurredAt: '2026-06-25T10:00:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-1',
        });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            source: 'post_payment_onboarding',
            sourcePath: '/campus',
        });
        expect(taskInserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            title: 'Coordinate first class and materials',
            task_type: 'admin',
            priority: 'high',
            due_at: '2026-06-26T10:00:00.000Z',
            related_entity_type: 'subscription_onboarding',
            related_entity_id: 'subscription-1',
            metadata: expect.objectContaining({
                activation_goal: 'first_class_scheduled',
                package_id: 'package-1',
                package_name: 'Plan Hybrid',
                drive_folder_ready: true,
                drive_folder_url: 'https://drive.example/folder',
                welcome_email_sent: true,
                manual_scheduling_required: true,
                materials_before_first_class: true,
                shared_owner_queue: true,
            }),
        })]);
        expect(activityInserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            activity_type: 'system',
            subject: 'Post-payment onboarding started',
            body: 'Welcome email sent, materials folder prepared, first class coordination pending.',
            occurred_at: '2026-06-25T10:00:00.000Z',
            related_entity_type: 'subscription_onboarding',
            related_entity_id: 'subscription-1',
            metadata: expect.objectContaining({
                task_id: 'task-1',
                activation_goal: 'first_class_scheduled',
            }),
        })]);
        expect(contactUpdates).toEqual([expect.objectContaining({
            lifecycle_stage: 'customer',
            next_follow_up_at: '2026-06-26T10:00:00.000Z',
            updated_at: '2026-06-25T10:00:00.000Z',
        })]);
    });

    it('does not claim materials are prepared while the Drive folder is still pending', async () => {
        const taskInserts: unknown[] = [];
        const activityInserts: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-1' }, error: null }, { inserts: taskInserts }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }),
                createQuery({ data: null, error: null }, { inserts: activityInserts }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }),
            ],
        });

        const result = await recordPostPaymentOnboarding(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            packageId: 'package-1',
            packageName: 'Plan Hybrid',
            occurredAt: '2026-06-25T10:00:00.000Z',
        });

        expect(result).toMatchObject({ status: 'recorded', taskId: 'task-1' });
        expect(taskInserts).toEqual([expect.objectContaining({
            title: 'Coordinate first class and materials',
            metadata: expect.objectContaining({
                drive_folder_ready: false,
                drive_folder_url: null,
                materials_before_first_class: true,
            }),
        })]);
        expect(activityInserts).toEqual([expect.objectContaining({
            subject: 'Post-payment onboarding started',
            body: 'Welcome email sent, materials folder still needs preparation before the first class.',
        })]);
    });

    it('refreshes existing open onboarding work without duplicating activity', async () => {
        const taskInserts: unknown[] = [];
        const taskUpdates: unknown[] = [];
        const activityInserts: unknown[] = [];
        const contactUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const existingTaskQuery = createQuery({
            data: {
                id: 'task-existing',
                due_at: '2026-06-27T10:00:00.000Z',
                metadata: { manual_note: 'keep this context' },
            },
            error: null,
        });
        const client = createClient({
            crm_tasks: [
                existingTaskQuery,
                createQuery({ data: null, error: null }, { inserts: taskInserts, updates: taskUpdates }),
            ],
            crm_activities: [
                createQuery({ data: { id: 'activity-existing' }, error: null }, { inserts: activityInserts }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }, { updates: contactUpdates }),
            ],
        });

        const result = await recordPostPaymentOnboarding(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            packageId: 'package-1',
            packageName: 'Plan Hybrid',
            occurredAt: '2026-06-25T10:00:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-existing',
        });
        expect(taskInserts).toEqual([]);
        expect(existingTaskQuery.select).toHaveBeenCalledWith('id, due_at, metadata');
        expect(taskUpdates).toEqual([expect.objectContaining({
            title: 'Coordinate first class and materials',
            status: 'open',
            due_at: '2026-06-26T10:00:00.000Z',
            updated_at: '2026-06-25T10:00:00.000Z',
            metadata: expect.objectContaining({
                manual_note: 'keep this context',
                activation_goal: 'first_class_scheduled',
                package_id: 'package-1',
                package_name: 'Plan Hybrid',
                drive_folder_ready: false,
                drive_folder_url: null,
                welcome_email_sent: true,
                manual_scheduling_required: true,
                materials_before_first_class: true,
                shared_owner_queue: true,
            }),
        })]);
        expect(activityInserts).toEqual([]);
        expect(contactUpdates).toEqual([expect.objectContaining({
            lifecycle_stage: 'customer',
            next_follow_up_at: '2026-06-26T10:00:00.000Z',
        })]);
    });

    it('does not downgrade first-class materials work when welcome fulfillment is retried', async () => {
        const taskUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({
                    data: {
                        id: 'task-existing',
                        due_at: '2026-07-01T10:00:00.000Z',
                        metadata: {
                            first_class_scheduled: true,
                            session_id: 'session-1',
                            scheduled_at: '2026-07-01T10:00:00.000Z',
                        },
                    },
                    error: null,
                }),
                createQuery({ data: null, error: null }, { updates: taskUpdates }),
            ],
            crm_activities: [
                createQuery({ data: { id: 'activity-existing' }, error: null }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }),
            ],
        });

        const result = await recordPostPaymentOnboarding(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            packageId: 'package-1',
            packageName: 'Plan Hybrid',
            driveFolderUrl: 'https://drive.example/folder',
            occurredAt: '2026-06-26T12:00:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-existing',
        });
        expect(taskUpdates).toEqual([expect.objectContaining({
            title: 'Prepare materials before first class',
            status: 'open',
            due_at: '2026-07-01T10:00:00.000Z',
            updated_at: '2026-06-26T12:00:00.000Z',
            metadata: expect.objectContaining({
                first_class_scheduled: true,
                session_id: 'session-1',
                scheduled_at: '2026-07-01T10:00:00.000Z',
                drive_folder_ready: true,
                drive_folder_url: 'https://drive.example/folder',
                welcome_email_sent: true,
            }),
        })]);
    });

    it('refreshes onboarding work when the first class is scheduled', async () => {
        const taskUpdates: unknown[] = [];
        const contactUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const existingTaskQuery = createQuery({
            data: {
                id: 'task-1',
                due_at: '2026-07-02T10:00:00.000Z',
                metadata: { welcome_email_sent: true },
            },
            error: null,
        });
        const client = createClient({
            crm_tasks: [
                existingTaskQuery,
                createQuery({ data: null, error: null }, { updates: taskUpdates }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }, { updates: contactUpdates }),
            ],
        });

        const result = await recordFirstClassScheduled(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-07-01T10:00:00.000Z',
            occurredAt: '2026-06-26T11:00:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-1',
        });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            source: 'first_class_scheduled',
            sourcePath: '/campus',
        });
        expect(existingTaskQuery.eq).toHaveBeenCalledWith('related_entity_type', 'subscription_onboarding');
        expect(taskUpdates).toEqual([expect.objectContaining({
            title: 'Prepare materials before first class',
            status: 'open',
            due_at: '2026-07-01T10:00:00.000Z',
            updated_at: '2026-06-26T11:00:00.000Z',
            metadata: expect.objectContaining({
                welcome_email_sent: true,
                activation_goal: 'first_class_scheduled',
                first_class_scheduled: true,
                session_id: 'session-1',
                subscription_id: 'subscription-1',
                teacher_id: 'teacher-1',
                scheduled_at: '2026-07-01T10:00:00.000Z',
                materials_before_first_class: true,
                shared_owner_queue: true,
            }),
        })]);
        expect(contactUpdates).toEqual([expect.objectContaining({
            lifecycle_stage: 'customer',
            next_follow_up_at: '2026-07-01T10:00:00.000Z',
            updated_at: '2026-06-26T11:00:00.000Z',
        })]);
    });

    it('creates first-class materials work if scheduling happens before onboarding task exists', async () => {
        const taskInserts: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-created' }, error: null }, { inserts: taskInserts }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }),
            ],
        });

        const result = await recordFirstClassScheduled(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-07-01T10:00:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-created',
        });
        expect(taskInserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            title: 'Prepare materials before first class',
            task_type: 'admin',
            priority: 'high',
            due_at: '2026-07-01T10:00:00.000Z',
            related_entity_type: 'profile_onboarding',
            related_entity_id: 'student-1',
            metadata: expect.objectContaining({
                first_class_scheduled: true,
                session_id: 'session-1',
                teacher_id: 'teacher-1',
                scheduled_at: '2026-07-01T10:00:00.000Z',
                materials_before_first_class: true,
            }),
        })]);
    });

    it('turns pending first-class onboarding into rescheduling work when the session is cancelled', async () => {
        const taskUpdates: unknown[] = [];
        const contactUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const existingTaskQuery = createQuery({
            data: {
                id: 'task-1',
                metadata: {
                    welcome_email_sent: true,
                    first_class_scheduled: true,
                    session_id: 'session-1',
                    scheduled_at: '2026-07-01T10:00:00.000Z',
                },
            },
            error: null,
        });
        const client = createClient({
            crm_tasks: [
                existingTaskQuery,
                createQuery({ data: null, error: null }, { updates: taskUpdates }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }, { updates: contactUpdates }),
            ],
        });

        const result = await recordFirstClassCancelled(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-07-01T10:00:00.000Z',
            cancelledAt: '2026-06-30T09:00:00.000Z',
            cancelledBy: 'student',
            cancellationReason: 'Work trip',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-1',
        });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            source: 'first_class_cancelled',
            sourcePath: '/campus',
        });
        expect(existingTaskQuery.eq).toHaveBeenCalledWith('related_entity_type', 'subscription_onboarding');
        expect(taskUpdates).toEqual([expect.objectContaining({
            title: 'Reschedule first class and materials',
            status: 'open',
            due_at: '2026-07-01T09:00:00.000Z',
            updated_at: '2026-06-30T09:00:00.000Z',
            metadata: expect.objectContaining({
                welcome_email_sent: true,
                activation_goal: 'first_class_scheduled',
                first_class_scheduled: false,
                first_class_cancelled: true,
                reschedule_required: true,
                session_id: 'session-1',
                cancelled_session_id: 'session-1',
                subscription_id: 'subscription-1',
                teacher_id: 'teacher-1',
                scheduled_at: '2026-07-01T10:00:00.000Z',
                cancelled_at: '2026-06-30T09:00:00.000Z',
                cancelled_by: 'student',
                cancellation_reason: 'Work trip',
                materials_before_first_class: true,
                shared_owner_queue: true,
            }),
        })]);
        expect(contactUpdates).toEqual([expect.objectContaining({
            lifecycle_stage: 'customer',
            next_follow_up_at: '2026-07-01T09:00:00.000Z',
            updated_at: '2026-06-30T09:00:00.000Z',
        })]);
    });

    it('does not rewrite onboarding when the cancelled class is not the tracked first class', async () => {
        const taskUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({
                    data: {
                        id: 'task-1',
                        metadata: { session_id: 'first-session' },
                    },
                    error: null,
                }),
            ],
        });

        const result = await recordFirstClassCancelled(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'later-session',
            teacherId: 'teacher-1',
            scheduledAt: '2026-07-08T10:00:00.000Z',
            cancelledAt: '2026-07-07T09:00:00.000Z',
            cancelledBy: 'teacher',
            cancellationReason: 'Teacher unavailable',
        });

        expect(result).toEqual({ status: 'skipped', reason: 'different_onboarding_session' });
        expect(taskUpdates).toEqual([]);
    });

    it('records first class completion and closes open onboarding tasks', async () => {
        const taskUpdates: unknown[] = [];
        const activityUpserts: unknown[] = [];
        const activityUpsertOptions: unknown[] = [];
        const contactUpdates: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const findTasksQuery = createQuery({
            data: [{ id: 'task-1' }, { id: 'task-2' }],
            error: null,
        });
        const client = createClient({
            crm_tasks: [
                findTasksQuery,
                createQuery({ data: null, error: null }, { updates: taskUpdates }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }, {
                    upserts: activityUpserts,
                    upsertOptions: activityUpsertOptions,
                }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }, { updates: contactUpdates }),
            ],
        });

        const result = await recordFirstClassCompleted(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-06-26T10:00:00.000Z',
            completedAt: '2026-06-26T10:55:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            closedTaskIds: ['task-1', 'task-2'],
        });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            source: 'first_class_completed',
            sourcePath: '/campus',
        });
        expect(findTasksQuery.eq).toHaveBeenCalledWith('related_entity_type', 'subscription_onboarding');
        expect(findTasksQuery.eq).toHaveBeenCalledWith('related_entity_id', 'subscription-1');
        expect(taskUpdates).toEqual([expect.objectContaining({
            status: 'done',
            completed_at: '2026-06-26T10:55:00.000Z',
            updated_at: '2026-06-26T10:55:00.000Z',
        })]);
        expect(activityUpserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            activity_type: 'system',
            subject: 'First class completed',
            body: 'Student completed the first class; onboarding activation achieved.',
            occurred_at: '2026-06-26T10:55:00.000Z',
            related_entity_type: 'subscription_activation',
            related_entity_id: 'subscription-1',
            idempotency_key: 'crm:first-class-completed:activity:subscription_activation:subscription-1',
            metadata: expect.objectContaining({
                activation_goal: 'first_class_completed',
                session_id: 'session-1',
                subscription_id: 'subscription-1',
                teacher_id: 'teacher-1',
                scheduled_at: '2026-06-26T10:00:00.000Z',
                completed_at: '2026-06-26T10:55:00.000Z',
                closed_onboarding_task_ids: ['task-1', 'task-2'],
            }),
        })]);
        expect(activityUpsertOptions).toEqual([{ onConflict: 'idempotency_key', ignoreDuplicates: true }]);
        expect(contactUpdates).toEqual([expect.objectContaining({
            lifecycle_stage: 'customer',
            last_contacted_at: '2026-06-26T10:55:00.000Z',
            next_follow_up_at: null,
            updated_at: '2026-06-26T10:55:00.000Z',
        })]);
    });

    it('keeps first-class activation unique when a later session is completed', async () => {
        const activityUpserts: unknown[] = [];
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({ status: 'ready', contactId: 'contact-1' });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: [], error: null }),
                createQuery({ data: [], error: null }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }, { upserts: activityUpserts }),
                createQuery({ data: null, error: null }, { upserts: activityUpserts }),
            ],
            crm_contacts: [
                createQuery({ data: null, error: null }),
                createQuery({ data: null, error: null }),
            ],
        });

        for (const sessionId of ['session-1', 'session-2']) {
            const result = await recordFirstClassCompleted(client as any, {
                profileId: 'student-1',
                email: 'student@example.com',
                fullName: 'Student One',
                subscriptionId: 'subscription-1',
                sessionId,
                completedAt: sessionId === 'session-1'
                    ? '2026-06-26T10:55:00.000Z'
                    : '2026-07-03T10:55:00.000Z',
            });
            expect(result.status).toBe('recorded');
        }

        expect(activityUpserts).toHaveLength(2);
        expect(activityUpserts).toEqual([
            expect.objectContaining({
                idempotency_key: 'crm:first-class-completed:activity:subscription_activation:subscription-1',
            }),
            expect.objectContaining({
                idempotency_key: 'crm:first-class-completed:activity:subscription_activation:subscription-1',
            }),
        ]);
    });

    it('creates a shared follow-up task when a student misses class', async () => {
        const taskUpserts: unknown[] = [];
        const taskUpsertOptions: unknown[] = [];
        const activityUpserts: unknown[] = [];
        const activityUpsertOptions: unknown[] = [];
        const refreshAlarm = vi.fn().mockResolvedValue({ data: true, error: null });
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }, { upserts: taskUpserts, upsertOptions: taskUpsertOptions }),
                createQuery({ data: { id: 'task-no-show' }, error: null }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }, { upserts: activityUpserts, upsertOptions: activityUpsertOptions }),
            ],
        }, refreshAlarm);

        const result = await recordNoShowFollowUp(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-06-26T10:00:00.000Z',
            noShowAt: '2026-06-26T10:15:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-no-show',
        });
        expect(ensureCrmContactForProfile).toHaveBeenCalledWith(client, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            lifecycleStage: 'customer',
            source: 'class_no_show',
            sourcePath: '/campus',
        });
        expect(taskUpserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            title: 'Follow up after missed class',
            task_type: 'email',
            priority: 'high',
            due_at: '2026-06-27T10:15:00.000Z',
            related_entity_type: 'session_no_show',
            related_entity_id: 'session-1',
            idempotency_key: 'crm:no-show-follow-up:task:session-1',
            metadata: expect.objectContaining({
                action: 'no_show_follow_up',
                session_id: 'session-1',
                subscription_id: 'subscription-1',
                teacher_id: 'teacher-1',
                scheduled_at: '2026-06-26T10:00:00.000Z',
                no_show_at: '2026-06-26T10:15:00.000Z',
                follow_up_hours: 24,
                shared_owner_queue: true,
            }),
        })]);
        expect(taskUpsertOptions).toEqual([{ onConflict: 'idempotency_key', ignoreDuplicates: true }]);
        expect(activityUpserts).toEqual([expect.objectContaining({
            contact_id: 'contact-1',
            activity_type: 'system',
            subject: 'No-show follow-up task created',
            body: 'Student missed a scheduled class; manual follow-up is required.',
            occurred_at: '2026-06-26T10:15:00.000Z',
            related_entity_type: 'session_no_show',
            related_entity_id: 'session-1',
            idempotency_key: 'crm:no-show-follow-up:activity:session-1',
            metadata: expect.objectContaining({
                task_id: 'task-no-show',
                action: 'no_show_follow_up',
            }),
        })]);
        expect(activityUpsertOptions).toEqual([{ onConflict: 'idempotency_key', ignoreDuplicates: true }]);
        expect(refreshAlarm).toHaveBeenCalledWith('refresh_crm_no_show_contact_alarm', {
            p_task_id: 'task-no-show',
            p_contact_id: 'contact-1',
            p_due_at: '2026-06-27T10:15:00.000Z',
            p_occurred_at: '2026-06-26T10:15:00.000Z',
        });
    });

    it('repairs the contact alarm without overwriting an existing open no-show task', async () => {
        const activityUpserts: unknown[] = [];
        const refreshAlarm = vi.fn().mockResolvedValue({ data: true, error: null });
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-existing' }, error: null }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }, { upserts: activityUpserts }),
            ],
        }, refreshAlarm);

        const result = await recordNoShowFollowUp(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-06-26T10:00:00.000Z',
            noShowAt: '2026-06-26T10:20:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-existing',
        });
        expect(client.from).toHaveBeenCalledWith('crm_tasks');
        expect(activityUpserts).toEqual([expect.objectContaining({
            related_entity_type: 'session_no_show',
            related_entity_id: 'session-1',
            metadata: expect.objectContaining({
                task_id: 'task-existing',
                no_show_at: '2026-06-26T10:20:00.000Z',
            }),
        })]);
        expect(refreshAlarm).toHaveBeenCalledWith('refresh_crm_no_show_contact_alarm', {
            p_task_id: 'task-existing',
            p_contact_id: 'contact-1',
            p_due_at: '2026-06-27T10:20:00.000Z',
            p_occurred_at: '2026-06-26T10:20:00.000Z',
        });
    });

    it('does not reopen a task completed before the atomic contact-alarm refresh', async () => {
        const taskUpserts: unknown[] = [];
        const activityUpserts: unknown[] = [];
        const refreshAlarm = vi.fn().mockResolvedValue({ data: false, error: null });
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({
            status: 'ready',
            contactId: 'contact-1',
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }, { upserts: taskUpserts }),
                createQuery({ data: { id: 'task-done' }, error: null }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }, { upserts: activityUpserts }),
            ],
        }, refreshAlarm);

        const result = await recordNoShowFollowUp(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-06-26T10:00:00.000Z',
            noShowAt: '2026-06-26T10:20:00.000Z',
        });

        expect(result).toEqual({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-done',
        });
        expect(taskUpserts).toHaveLength(1);
        expect(activityUpserts).toHaveLength(1);
        expect(refreshAlarm).toHaveBeenCalledOnce();
        expect(client.from).not.toHaveBeenCalledWith('crm_contacts');
    });

    it('preserves a manually snoozed task and does not reset the contact alarm', async () => {
        const activityUpserts: unknown[] = [];
        const refreshAlarm = vi.fn().mockResolvedValue({ data: false, error: null });
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({ status: 'ready', contactId: 'contact-1' });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-snoozed' }, error: null }),
            ],
            crm_activities: [
                createQuery({ data: null, error: null }, { upserts: activityUpserts }),
            ],
        }, refreshAlarm);

        const result = await recordNoShowFollowUp(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            noShowAt: '2026-06-26T10:20:00.000Z',
        });

        expect(result).toEqual({ status: 'recorded', contactId: 'contact-1', taskId: 'task-snoozed' });
        expect(activityUpserts).toHaveLength(1);
        expect(refreshAlarm).toHaveBeenCalledOnce();
        expect(client.from).not.toHaveBeenCalledWith('crm_contacts');
    });

    it('fails the no-show convergence when the atomic contact-alarm refresh fails', async () => {
        vi.mocked(ensureCrmContactForProfile).mockResolvedValue({ status: 'ready', contactId: 'contact-1' });
        const refreshAlarm = vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'XX000', message: 'temporary contact alarm failure' },
        });
        const client = createClient({
            crm_tasks: [
                createQuery({ data: null, error: null }),
                createQuery({ data: { id: 'task-existing' }, error: null }),
            ],
            crm_activities: [createQuery({ data: null, error: null })],
        }, refreshAlarm);

        await expect(recordNoShowFollowUp(client as any, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            sessionId: 'session-1',
            noShowAt: '2026-06-26T10:20:00.000Z',
        })).rejects.toEqual(expect.objectContaining({
            code: 'XX000',
            message: 'temporary contact alarm failure',
        }));
    });
});
