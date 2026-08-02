import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FulfillmentDependencyPendingError } from '../../src/lib/fulfillment/dependency';

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/google/student-folder', () => ({
    createStudentFolderStructure: vi.fn(),
}));

vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));

vi.mock('../../src/lib/email', () => ({
    sendClassCancelled: vi.fn(),
    sendWelcomeEmail: vi.fn(),
    sendRenewalNoticeEmail: vi.fn(),
}));

vi.mock('../../src/lib/google/calendar', () => ({
    cancelClassEvent: vi.fn(),
    deterministicClassEventId: vi.fn((sessionId: string) => sessionId.replaceAll('-', '').toLowerCase()),
}));

vi.mock('../../src/lib/crm/class-email', () => ({
    recordClassEmailOutInCrmSafe: vi.fn(),
}));

vi.mock('../../src/lib/crm/onboarding', () => ({
    recordPostPaymentOnboardingSafe: vi.fn(),
}));

vi.mock('../../src/lib/site-url', () => ({
    getSiteUrl: vi.fn().mockReturnValue('https://example.com'),
}));

vi.mock('../../src/lib/fulfillment/session-fulfillment', () => ({
    fulfillSingleSession: vi.fn(),
    fulfillSessionBatch: vi.fn(),
}));

const rescheduleMocks = vi.hoisted(() => ({
    processSessionReschedule: vi.fn(),
}));

vi.mock('../../src/lib/fulfillment/session-reschedule', () => ({
    processSessionReschedule: rescheduleMocks.processSessionReschedule,
}));

const createJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    job_type: 'session_fulfillment',
    status: 'pending',
    payload: { sessionId: 'session-1' },
    session_id: 'session-1',
    subscription_id: 'subscription-1',
    student_id: 'student-1',
    attempts: 0,
    max_attempts: 3,
    run_at: '2026-01-01T10:00:00.000Z',
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: '2026-01-01T09:00:00.000Z',
    updated_at: '2026-01-01T09:00:00.000Z',
    dedupe_key: null,
    ...overrides,
});

function createSingleQuery(result: { data: unknown; error: unknown }) {
    const query: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(result),
    };
    return query;
}

function createLockQuery(result: { data: unknown; error: unknown } = { data: { id: 'job-1' }, error: null }) {
    const query: any = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return query;
}

describe('fulfillment jobs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enqueues single, bulk, welcome and deduplicated renewal-notice jobs', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabaseAdmin = {
            from: vi.fn().mockReturnValue({ insert }),
        };
        const {
            enqueueSessionFulfillment,
            enqueueBulkSessionFulfillment,
            enqueueWelcomeFulfillment,
            enqueueRenewalNotice,
        } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueSessionFulfillment(supabaseAdmin as any, {
            id: 'session-1',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
        }, { autoCreateMeeting: false })).resolves.toBe(true);

        await expect(enqueueBulkSessionFulfillment(supabaseAdmin as any, [{
            id: 'session-2',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
        }], { sendEmail: false })).resolves.toBe(true);

        await expect(enqueueWelcomeFulfillment(supabaseAdmin as any, {
            userId: 'student-1',
            packageId: 'package-1',
            subscriptionId: 'subscription-1',
        })).resolves.toBe(true);

        await expect(enqueueRenewalNotice(supabaseAdmin as any, {
            stripeEventId: 'evt_upcoming_1',
            stripeSubscriptionId: 'sub_1',
            userId: 'student-1',
            packageId: 'package-1',
            subscriptionId: 'subscription-1',
            renewalAt: '2026-10-10T00:00:00.000Z',
            cancelBy: '2026-10-10T00:00:00.000Z',
            durationMonths: 3,
            amountTotal: 27000,
            currency: 'eur',
        })).resolves.toBe(true);

        expect(insert).toHaveBeenCalledTimes(4);
        expect(insert).toHaveBeenNthCalledWith(1, expect.objectContaining({
            job_type: 'session_fulfillment',
            session_id: 'session-1',
            payload: expect.objectContaining({
                sessionId: 'session-1',
                autoCreateMeeting: false,
                sendEmail: true,
            }),
        }));
        expect(insert).toHaveBeenNthCalledWith(2, expect.objectContaining({
            job_type: 'bulk_session_fulfillment',
            payload: expect.objectContaining({
                sessionIds: ['session-2'],
                autoCreateMeeting: true,
                sendEmail: false,
            }),
        }));
        expect(insert).toHaveBeenNthCalledWith(3, expect.objectContaining({
            job_type: 'welcome_fulfillment',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            dedupe_key: 'welcome_fulfillment:subscription-1',
            payload: expect.objectContaining({
                userId: 'student-1',
                packageId: 'package-1',
                subscriptionId: 'subscription-1',
            }),
        }));
        expect(insert).toHaveBeenNthCalledWith(4, expect.objectContaining({
            job_type: 'renewal_notice',
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            dedupe_key: 'renewal_notice:sub_1:2026-10-10T00:00:00.000Z',
            payload: expect.objectContaining({
                stripeEventId: 'evt_upcoming_1',
                stripeSubscriptionId: 'sub_1',
                renewalAt: '2026-10-10T00:00:00.000Z',
            }),
        }));
    });

    it('accepts a unique-key conflict only when the persisted job is canonically equivalent', async () => {
        const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
        const lookup: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    job_type: 'renewal_notice',
                    session_id: null,
                    subscription_id: 'subscription-1',
                    student_id: 'student-1',
                    payload: {
                        currency: 'eur',
                        amountTotal: 27000,
                        durationMonths: 3,
                        cancelBy: '2026-10-10T00:00:00.000Z',
                        renewalAt: '2026-10-10T00:00:00.000Z',
                        subscriptionId: 'subscription-1',
                        packageId: 'package-1',
                        userId: 'student-1',
                        stripeSubscriptionId: 'sub_1',
                        stripeEventId: 'evt_upcoming_retry',
                    },
                },
                error: null,
            }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce({ insert })
                .mockReturnValueOnce(lookup),
        };
        const { enqueueRenewalNotice } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueRenewalNotice(supabaseAdmin as any, {
            stripeEventId: 'evt_upcoming_retry',
            stripeSubscriptionId: 'sub_1',
            userId: 'student-1',
            packageId: 'package-1',
            subscriptionId: 'subscription-1',
            renewalAt: '2026-10-10T00:00:00.000Z',
            cancelBy: '2026-10-10T00:00:00.000Z',
            durationMonths: 3,
            amountTotal: 27000,
            currency: 'eur',
        })).resolves.toBe(true);

        expect(lookup.eq).toHaveBeenCalledWith(
            'job_type',
            'renewal_notice',
        );
        expect(lookup.eq).toHaveBeenCalledWith(
            'dedupe_key',
            'renewal_notice:sub_1:2026-10-10T00:00:00.000Z',
        );
    });

    it('rejects a unique-key conflict when the persisted payload differs', async () => {
        const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
        const lookup: any = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    job_type: 'renewal_notice',
                    session_id: null,
                    subscription_id: 'subscription-1',
                    student_id: 'student-1',
                    payload: {
                        stripeEventId: 'evt_upcoming_retry',
                        stripeSubscriptionId: 'sub_1',
                        userId: 'student-1',
                        packageId: 'package-1',
                        subscriptionId: 'subscription-1',
                        renewalAt: '2026-10-10T00:00:00.000Z',
                        cancelBy: '2026-10-10T00:00:00.000Z',
                        durationMonths: 3,
                        amountTotal: 99999,
                        currency: 'eur',
                    },
                },
                error: null,
            }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce({ insert })
                .mockReturnValueOnce(lookup),
        };
        const { enqueueRenewalNotice } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueRenewalNotice(supabaseAdmin as any, {
            stripeEventId: 'evt_upcoming_retry',
            stripeSubscriptionId: 'sub_1',
            userId: 'student-1',
            packageId: 'package-1',
            subscriptionId: 'subscription-1',
            renewalAt: '2026-10-10T00:00:00.000Z',
            cancelBy: '2026-10-10T00:00:00.000Z',
            durationMonths: 3,
            amountTotal: 27000,
            currency: 'eur',
        })).rejects.toThrow('Fulfillment dedupe conflict does not match the requested job');
    });

    it('enqueues a versioned 28-day renewal notice without a legacy month count', async () => {
        const insert = vi.fn().mockResolvedValue({ error: null });
        const supabaseAdmin = { from: vi.fn().mockReturnValue({ insert }) };
        const { enqueueRenewalNotice } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueRenewalNotice(supabaseAdmin as any, {
            stripeEventId: 'evt_upcoming_v2',
            stripeSubscriptionId: 'sub_v2',
            userId: 'student-1',
            packageId: 'package-1',
            subscriptionId: 'subscription-v2',
            renewalAt: '2026-10-10T00:00:00.000Z',
            cancelBy: '2026-10-10T00:00:00.000Z',
            billingIntervalUnit: 'day',
            billingIntervalCount: 28,
            amountTotal: 25900,
            currency: 'eur',
        })).resolves.toBe(true);

        expect(insert).toHaveBeenCalledWith(expect.objectContaining({
            job_type: 'renewal_notice',
            dedupe_key: 'renewal_notice:sub_v2:2026-10-10T00:00:00.000Z',
            payload: expect.objectContaining({
                billingIntervalUnit: 'day',
                billingIntervalCount: 28,
            }),
        }));
        expect(insert.mock.calls[0]?.[0]?.payload).not.toHaveProperty('durationMonths');
    });

    it('skips bulk enqueue when there are no sessions', async () => {
        const supabaseAdmin = { from: vi.fn() };
        const { enqueueBulkSessionFulfillment } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueBulkSessionFulfillment(supabaseAdmin as any, [])).resolves.toBe(true);
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it('degrades to direct fallback when the jobs table has not been migrated yet', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const supabaseAdmin = {
            from: vi.fn().mockReturnValue({
                insert: vi.fn().mockResolvedValue({
                    error: { code: '42P01', message: 'relation fulfillment_jobs does not exist' },
                }),
            }),
        };
        const { enqueueWelcomeFulfillment } = await import('../../src/lib/fulfillment/jobs');

        await expect(enqueueWelcomeFulfillment(supabaseAdmin as any, {
            userId: 'student-1',
            packageId: 'package-1',
        })).resolves.toBe(false);
        expect(warn).toHaveBeenCalledWith(
            '[Fulfillment] fulfillment_jobs table is missing; cannot enqueue background work'
        );
    });

    it('returns an empty result when processing jobs before the migration exists', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
                data: null,
                error: { code: '42P01', message: 'fulfillment_jobs is missing' },
            }),
        };
        const supabaseAdmin = { from: vi.fn().mockReturnValue(selectChain) };
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
    });

    it('quarantines stale processing jobs for manual reconciliation without replaying providers', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const quarantineChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            select: vi.fn().mockResolvedValue({ data: [{ id: 'stale-job-1' }], error: null }),
        };
        const supabaseAdmin = { from: vi.fn().mockReturnValue(quarantineChain) };
        const { quarantineStaleFulfillmentJobs, STALE_PROCESSING_ERROR } = await import('../../src/lib/fulfillment/jobs');

        await expect(quarantineStaleFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            now: new Date('2026-07-11T16:30:00.000Z'),
        })).resolves.toBe(1);

        expect(quarantineChain.update).toHaveBeenCalledWith({
            status: 'failed',
            run_at: '9999-12-31T23:59:59.999Z',
            locked_at: null,
            locked_by: null,
            last_error: STALE_PROCESSING_ERROR,
        });
        expect(quarantineChain.eq).toHaveBeenCalledWith('status', 'processing');
        expect(quarantineChain.or).toHaveBeenCalledWith(
            'locked_at.is.null,locked_at.lt.2026-07-11T16:10:00.000Z',
        );
    });

    it('processes welcome fulfillment and records post-payment onboarding work in CRM', async () => {
        const job = createJob({
            job_type: 'welcome_fulfillment',
            payload: {
                userId: 'student-1',
                packageId: 'package-1',
                subscriptionId: 'subscription-1',
                sessionsTotal: 4,
                amountTotal: 25900,
                currency: 'eur',
                contractSchemaVersion: 2,
                classDurationMinutes: 50,
                teacherName: 'Teacher One',
                slotWeekday: 1,
                slotLocalStartTime: '10:00:00',
                timezoneName: 'Europe/Madrid',
                classStartsAt: [
                    '2026-09-07T08:00:00.000Z',
                    '2026-09-14T08:00:00.000Z',
                    '2026-09-21T08:00:00.000Z',
                    '2026-09-28T08:00:00.000Z',
                ],
                renewalAnchorAt: '2026-10-05T08:00:00.000Z',
            },
            session_id: null,
            subscription_id: 'subscription-1',
            student_id: 'student-1',
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        };
        const lockChain = createLockQuery();
        const studentQuery = createSingleQuery({
            data: {
                id: 'student-1',
                full_name: 'Student One',
                email: 'student@example.com',
                preferred_language: 'en',
                student_teachers: [{
                    is_primary: true,
                    teacher: { full_name: 'Teacher One' },
                }],
            },
            error: null,
        });
        const packageQuery = createSingleQuery({
            data: {
                id: 'package-1',
                name: 'individual_4x50_28d',
                display_name: {
                    es: '4 clases individuales de 50 minutos',
                    en: '4 individual 50-minute classes',
                    ru: '4 индивидуальных занятия по 50 минут',
                },
            },
            error: null,
        });
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain)
                .mockReturnValueOnce(studentQuery)
                .mockReturnValueOnce(packageQuery)
                .mockReturnValueOnce(successChain),
        };
        const google = await import('../../src/lib/google/student-folder');
        const profilesPrivate = await import('../../src/lib/profiles-private');
        const email = await import('../../src/lib/email');
        const crmOnboarding = await import('../../src/lib/crm/onboarding');
        vi.mocked(profilesPrivate.getPrivateProfile).mockResolvedValue({
            current_level: 'b1',
            drive_folder_id: null,
            drive_folder_url: null,
        } as any);
        vi.mocked(google.createStudentFolderStructure).mockResolvedValue({
            rootFolderId: 'drive-folder-1',
            rootFolderLink: 'https://drive.google.com/folder-1',
            exerciseFolderId: 'exercise-folder-1',
            classDocsFolderId: 'class-docs-folder-1',
            progressDocId: 'progress-doc-1',
        } as any);
        vi.mocked(profilesPrivate.upsertPrivateProfile).mockResolvedValue({} as any);
        vi.mocked(email.sendWelcomeEmail).mockResolvedValue(true);
        vi.mocked(crmOnboarding.recordPostPaymentOnboardingSafe).mockResolvedValue({
            status: 'recorded',
            contactId: 'contact-1',
            taskId: 'task-1',
        } as any);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });

        expect(google.createStudentFolderStructure).toHaveBeenCalledWith({
            levels: ['B1'],
            studentName: 'Student One',
            studentEmail: 'student@example.com',
            teacherName: 'Teacher One',
        });
        expect(email.sendWelcomeEmail).toHaveBeenCalledWith(
            'student@example.com',
            expect.objectContaining({
                locale: 'en',
                studentName: 'Student One',
                packageName: '4 individual 50-minute classes',
                loginUrl: 'https://example.com/en/login',
                driveFolderUrl: 'https://drive.google.com/folder-1',
                sessionsTotal: 4,
                amountTotal: 25900,
                currency: 'eur',
                contractSchemaVersion: 2,
                classDurationMinutes: 50,
                teacherName: 'Teacher One',
                slotWeekday: 1,
                slotLocalStartTime: '10:00:00',
                timezoneName: 'Europe/Madrid',
                classStartsAt: [
                    '2026-09-07T08:00:00.000Z',
                    '2026-09-14T08:00:00.000Z',
                    '2026-09-21T08:00:00.000Z',
                    '2026-09-28T08:00:00.000Z',
                ],
                renewalAnchorAt: '2026-10-05T08:00:00.000Z',
            }),
            expect.objectContaining({
                fulfillmentEffect: expect.objectContaining({
                    effectKey: 'email.welcome.student',
                    jobId: job.id,
                    leaseOwner: 'test-worker',
                    supabaseAdmin,
                }),
            }),
        );
        expect(crmOnboarding.recordPostPaymentOnboardingSafe).toHaveBeenCalledWith(supabaseAdmin, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            packageId: 'package-1',
            packageName: '4 individual 50-minute classes',
            driveFolderUrl: 'https://drive.google.com/folder-1',
        });
    });

    it('fails a legacy Checkout V2 welcome job before email or onboarding side effects', async () => {
        const job = createJob({
            id: 'job-legacy-v2-welcome',
            job_type: 'welcome_fulfillment',
            payload: {
                userId: 'student-1',
                packageId: 'package-1',
                packageKey: 'individual_4x50_28d',
                subscriptionId: 'subscription-1',
                sessionsTotal: 4,
                amountTotal: 25900,
                currency: 'eur',
            },
            session_id: null,
            subscription_id: 'subscription-1',
            student_id: 'student-1',
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        };
        const failureChain = createLockQuery({ data: { id: job.id }, error: null });
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery({ data: { id: job.id }, error: null }))
                .mockReturnValueOnce(failureChain),
        };
        const email = await import('../../src/lib/email');
        const google = await import('../../src/lib/google/student-folder');
        const crmOnboarding = await import('../../src/lib/crm/onboarding');
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(failureChain.update).toHaveBeenCalledWith(expect.objectContaining({
            last_error: 'Checkout V2 welcome payload is incomplete or incoherent',
        }));
        expect(email.sendWelcomeEmail).not.toHaveBeenCalled();
        expect(google.createStudentFolderStructure).not.toHaveBeenCalled();
        expect(crmOnboarding.recordPostPaymentOnboardingSafe).not.toHaveBeenCalled();
    });

    it('uses English login as the welcome email fallback when profile language is unknown', async () => {
        const job = createJob({
            id: 'job-welcome-fallback',
            job_type: 'welcome_fulfillment',
            payload: {
                userId: 'student-2',
                packageId: 'package-1',
                subscriptionId: 'subscription-1',
            },
            session_id: null,
            subscription_id: 'subscription-1',
            student_id: 'student-2',
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        };
        const lockChain = createLockQuery();
        const studentQuery = createSingleQuery({
            data: {
                id: 'student-2',
                full_name: 'Student Two',
                email: 'student2@example.com',
                preferred_language: null,
                student_teachers: [],
            },
            error: null,
        });
        const packageQuery = createSingleQuery({
            data: {
                id: 'package-1',
                name: 'individual',
                display_name: { es: 'Plan Individual' },
            },
            error: null,
        });
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain)
                .mockReturnValueOnce(studentQuery)
                .mockReturnValueOnce(packageQuery)
                .mockReturnValueOnce(successChain),
        };
        const google = await import('../../src/lib/google/student-folder');
        const profilesPrivate = await import('../../src/lib/profiles-private');
        const email = await import('../../src/lib/email');
        const crmOnboarding = await import('../../src/lib/crm/onboarding');
        vi.mocked(profilesPrivate.getPrivateProfile).mockResolvedValue({
            drive_folder_id: 'drive-folder-existing',
            drive_folder_url: 'https://drive.google.com/existing-folder',
        } as any);
        vi.mocked(email.sendWelcomeEmail).mockResolvedValue(true);
        vi.mocked(crmOnboarding.recordPostPaymentOnboardingSafe).mockResolvedValue({
            status: 'recorded',
            contactId: 'contact-2',
            taskId: 'task-2',
        } as any);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });

        expect(google.createStudentFolderStructure).not.toHaveBeenCalled();
        expect(email.sendWelcomeEmail).toHaveBeenCalledWith(
            'student2@example.com',
            expect.objectContaining({
                locale: 'en',
                studentName: 'Student Two',
                packageName: 'individual',
                loginUrl: 'https://example.com/en/login',
                driveFolderUrl: 'https://drive.google.com/existing-folder',
            }),
            expect.objectContaining({
                fulfillmentEffect: expect.objectContaining({
                    effectKey: 'email.welcome.student',
                    jobId: job.id,
                    leaseOwner: 'test-worker',
                    supabaseAdmin,
                }),
            }),
        );
    });

    it('processes a localized renewal notice through the durable worker job', async () => {
        const job = createJob({
            id: 'job-renewal-notice',
            job_type: 'renewal_notice',
            payload: {
                stripeEventId: 'evt_upcoming_1',
                stripeSubscriptionId: 'sub_1',
                userId: 'student-1',
                packageId: 'package-1',
                subscriptionId: 'subscription-1',
                renewalAt: '2026-10-10T00:00:00.000Z',
                cancelBy: '2026-10-10T00:00:00.000Z',
                billingIntervalUnit: 'day',
                billingIntervalCount: 28,
                amountTotal: 25900,
                currency: 'eur',
            },
            session_id: null,
            dedupe_key: 'renewal_notice:sub_1:2026-10-10T00:00:00.000Z',
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        };
        const studentQuery = createSingleQuery({
            data: {
                id: 'student-1',
                full_name: 'Алина',
                email: 'student@example.com',
                preferred_language: 'ru',
            },
            error: null,
        });
        const packageQuery = createSingleQuery({
            data: {
                name: 'individual',
                display_name: { es: 'Individual', en: 'Individual', ru: 'Индивидуальный' },
            },
            error: null,
        });
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(studentQuery)
                .mockReturnValueOnce(packageQuery)
                .mockReturnValueOnce(successChain),
        };
        const email = await import('../../src/lib/email');
        vi.mocked(email.sendRenewalNoticeEmail).mockResolvedValue(true);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });

        expect(email.sendRenewalNoticeEmail).toHaveBeenCalledWith('student@example.com', {
            locale: 'ru',
            studentName: 'Алина',
            packageName: 'Индивидуальный',
            renewalAt: '2026-10-10T00:00:00.000Z',
            cancelBy: '2026-10-10T00:00:00.000Z',
            durationMonths: undefined,
            billingIntervalUnit: 'day',
            billingIntervalCount: 28,
            amountTotal: 25900,
            currency: 'eur',
            accountUrl: 'https://example.com/ru/campus/account',
            supportUrl: 'https://example.com/ru/campus/support',
            termsUrl: 'https://example.com/ru/legal/terminos',
        }, expect.objectContaining({
            fulfillmentEffect: expect.objectContaining({
                effectKey: 'email.renewal_notice.student',
                jobId: job.id,
                leaseOwner: 'test-worker',
                supabaseAdmin,
            }),
        }));
    });

    it('processes a due session fulfillment job and marks it succeeded', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [createJob()], error: null }),
        };
        const lockChain = createLockQuery();
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain)
                .mockReturnValueOnce(successChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockResolvedValue(undefined);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });
        expect(sessionFulfillment.fulfillSingleSession).toHaveBeenCalledWith(
            supabaseAdmin,
            'session-1',
            {
                autoCreateMeeting: undefined,
                emailEffectJob: { jobId: 'job-1', leaseOwner: 'test-worker' },
                sendEmail: undefined,
            }
        );
        expect(successChain.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'succeeded',
            last_error: null,
        }));
        expect(successChain.eq).toHaveBeenCalledWith('status', 'processing');
        expect(successChain.eq).toHaveBeenCalledWith('locked_by', 'test-worker');
        expect(successChain.eq).toHaveBeenCalledWith('attempts', 1);
    });

    it('deletes a deterministic orphan event and uses separate durable cancellation email effects', async () => {
        const sessionId = '418f47a2-9b6d-4c31-8a4e-123456789abc';
        const job = createJob({
            id: 'job-cancellation',
            job_type: 'session_cancellation',
            session_id: sessionId,
            payload: {
                cancelledBy: 'admin',
                reason: 'Cambio de horario',
                sendEmail: true,
                sessionId,
            },
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        };
        const sessionQuery = createSingleQuery({
            data: {
                calendar_event_id: null,
                drive_doc_url: 'https://docs.example/class',
                duration_minutes: 50,
                id: sessionId,
                meet_link: 'https://meet.example/class',
                scheduled_at: '2026-08-01T10:00:00.000Z',
                student: {
                    email: 'student@example.com',
                    full_name: 'Student One',
                    id: 'student-1',
                },
                student_id: 'student-1',
                subscription_id: 'subscription-1',
                teacher: {
                    email: 'teacher@example.com',
                    full_name: 'Teacher One',
                    id: 'teacher-1',
                },
                teacher_id: 'teacher-1',
            },
            error: null,
        });
        const cancellationStateChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
        };
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(sessionQuery)
                .mockReturnValueOnce(cancellationStateChain)
                .mockReturnValueOnce(successChain),
        };
        const email = await import('../../src/lib/email');
        const calendar = await import('../../src/lib/google/calendar');
        const crmClassEmail = await import('../../src/lib/crm/class-email');
        vi.mocked(email.sendClassCancelled).mockResolvedValue(true);
        vi.mocked(calendar.cancelClassEvent).mockResolvedValue(true);
        vi.mocked(crmClassEmail.recordClassEmailOutInCrmSafe).mockResolvedValue({ status: 'created' });
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });

        expect(calendar.cancelClassEvent).toHaveBeenCalledWith('418f47a29b6d4c318a4e123456789abc');
        expect(cancellationStateChain.update).toHaveBeenCalledWith({
            calendar_event_id: null,
            meet_link: null,
        });

        expect(email.sendClassCancelled).toHaveBeenNthCalledWith(
            1,
            'student@example.com',
            expect.objectContaining({
                recipientName: 'Student One',
                date: 'Saturday, 1 August 2026',
                time: '12:00 CEST',
            }),
            expect.objectContaining({
                fulfillmentEffect: expect.objectContaining({
                    effectKey: 'email.class_cancelled.student',
                    jobId: job.id,
                    leaseOwner: 'test-worker',
                    supabaseAdmin,
                }),
            }),
        );
        expect(email.sendClassCancelled).toHaveBeenNthCalledWith(
            2,
            'teacher@example.com',
            expect.objectContaining({ recipientName: 'Teacher One' }),
            expect.objectContaining({
                fulfillmentEffect: expect.objectContaining({
                    effectKey: 'email.class_cancelled.teacher',
                    jobId: job.id,
                    leaseOwner: 'test-worker',
                    supabaseAdmin,
                }),
            }),
        );
    });

    it('quarantines a job instead of replaying providers when post-effect finalization is ambiguous', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [createJob()], error: null }),
        };
        const finalizeChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'database response was ambiguous' },
            }),
        };
        const quarantineChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(finalizeChain)
                .mockReturnValueOnce(quarantineChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockResolvedValue(undefined);
        const {
            POST_EFFECT_FINALIZATION_ERROR,
            processDueFulfillmentJobs,
        } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(sessionFulfillment.fulfillSingleSession).toHaveBeenCalledTimes(1);
        expect(quarantineChain.update).toHaveBeenCalledWith({
            status: 'failed',
            run_at: '9999-12-31T23:59:59.999Z',
            locked_at: null,
            locked_by: null,
            last_error: POST_EFFECT_FINALIZATION_ERROR,
        });
    });

    it('quarantines a job immediately when an email effect requires manual review', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [createJob()], error: null }),
        };
        const failChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(failChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        const {
            FulfillmentEffectError,
        } = await import('../../src/lib/fulfillment/effects');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockRejectedValueOnce(
            new FulfillmentEffectError('FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS', true),
        );
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(failChain.update).toHaveBeenCalledWith({
            status: 'failed',
            run_at: '9999-12-31T23:59:59.999Z',
            locked_at: null,
            locked_by: null,
            last_error: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
        });
    });

    it('requeues a lost effect-finalization response instead of quarantining immediately', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
                data: [createJob({ attempts: 2, max_attempts: 3 })],
                error: null,
            }),
        };
        const failChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(failChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        const { FulfillmentEffectError } = await import('../../src/lib/fulfillment/effects');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockRejectedValueOnce(
            new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', false),
        );
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(failChain.update).toHaveBeenCalledWith(expect.objectContaining({
            attempts: 2,
            status: 'pending',
            last_error: 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS',
        }));
        expect(failChain.update).not.toHaveBeenCalledWith(expect.objectContaining({
            run_at: '9999-12-31T23:59:59.999Z',
        }));
    });

    it('skips a due job when another worker wins the processing lock', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [createJob()], error: null }),
        };
        const lockChain = createLockQuery({ data: null, error: null });
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockResolvedValue(undefined);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });
        expect(sessionFulfillment.fulfillSingleSession).not.toHaveBeenCalled();
        expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
        expect(lockChain.eq).toHaveBeenCalledWith('status', 'pending');
        expect(lockChain.eq).toHaveBeenCalledWith('attempts', 0);
        expect(lockChain.eq).toHaveBeenCalledWith('updated_at', '2026-01-01T09:00:00.000Z');
    });

    it('does not overwrite an administrative retry observed after the due-job snapshot', async () => {
        const staleJob = createJob({
            status: 'failed',
            attempts: 4,
            max_attempts: 5,
            last_error: 'Provider timeout',
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [staleJob], error: null }),
        };
        const lockChain = createLockQuery({ data: null, error: null });
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'stale-worker',
        })).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });

        expect(lockChain.eq).toHaveBeenCalledWith('status', 'failed');
        expect(lockChain.eq).toHaveBeenCalledWith('attempts', 4);
        expect(lockChain.eq).toHaveBeenCalledWith('updated_at', staleJob.updated_at);
        expect(sessionFulfillment.fulfillSingleSession).not.toHaveBeenCalled();
    });

    it('treats the per-subscription processing unique conflict as expected contention', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [createJob()], error: null }),
        };
        const lockChain = createLockQuery({
            data: null,
            error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "fulfillment_jobs_one_processing_subscription_idx"',
            },
        });
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        vi.mocked(sessionFulfillment.fulfillSingleSession).mockResolvedValue(undefined);
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0 });

        expect(sessionFulfillment.fulfillSingleSession).not.toHaveBeenCalled();
        expect(errorLog).not.toHaveBeenCalled();
        expect(supabaseAdmin.from).toHaveBeenCalledTimes(2);
    });

    it('requeues a pending fulfillment dependency without consuming an attempt', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
                data: [createJob({
                    attempts: 2,
                    job_type: 'session_reschedule',
                    max_attempts: 3,
                    payload: {
                        operationId: 'operation-1',
                        previousScheduledAt: '2026-08-03T08:00:00.000Z',
                        scheduledAt: '2026-08-05T10:00:00.000Z',
                        sessionId: 'session-1',
                    },
                })],
                error: null,
            }),
        };
        const failChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(failChain),
        };
        rescheduleMocks.processSessionReschedule.mockRejectedValueOnce(
            new FulfillmentDependencyPendingError(
                'session_reschedule_waiting_for_calendar_event',
            ),
        );
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(rescheduleMocks.processSessionReschedule).toHaveBeenCalledTimes(1);
        expect(failChain.update).toHaveBeenCalledWith(expect.objectContaining({
            attempts: 2,
            status: 'pending',
            last_error: 'session_reschedule_waiting_for_calendar_event',
        }));
        const retryUpdate = failChain.update.mock.calls[0]?.[0] as { run_at?: string };
        expect(Date.parse(retryUpdate.run_at ?? '')).toBeGreaterThan(Date.now());
        expect(retryUpdate.run_at).not.toBe('9999-12-31T23:59:59.999Z');
    });

    it('keeps bulk fulfillment pending without consuming an attempt while its Drive folder dependency is absent', async () => {
        const job = createJob({
            attempts: 2,
            job_type: 'bulk_session_fulfillment',
            max_attempts: 3,
            payload: {
                sessionIds: ['session-1', 'session-2', 'session-3', 'session-4'],
                autoCreateMeeting: true,
                sendEmail: true,
            },
        });
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
        };
        const failChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: job.id }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(createLockQuery())
                .mockReturnValueOnce(failChain),
        };
        const sessionFulfillment = await import('../../src/lib/fulfillment/session-fulfillment');
        vi.mocked(sessionFulfillment.fulfillSessionBatch).mockRejectedValueOnce(
            new FulfillmentDependencyPendingError(
                'bulk_session_fulfillment_waiting_for_drive_folder',
            ),
        );
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(sessionFulfillment.fulfillSessionBatch).toHaveBeenCalledWith(
            supabaseAdmin,
            ['session-1', 'session-2', 'session-3', 'session-4'],
            expect.objectContaining({
                autoCreateMeeting: true,
                sendEmail: true,
            }),
        );
        expect(failChain.update).toHaveBeenCalledWith(expect.objectContaining({
            attempts: 2,
            status: 'pending',
            last_error: 'bulk_session_fulfillment_waiting_for_drive_folder',
        }));
        const retryUpdate = failChain.update.mock.calls[0]?.[0] as { run_at?: string };
        expect(Date.parse(retryUpdate.run_at ?? '')).toBeGreaterThan(Date.now());
        expect(retryUpdate.run_at).not.toBe('9999-12-31T23:59:59.999Z');
    });

    it('reschedules failed jobs that still have retry attempts', async () => {
        const selectChain: any = {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({
                data: [createJob({
                    job_type: 'bulk_session_fulfillment',
                    payload: { sessionIds: [] },
                })],
                error: null,
            }),
        };
        const lockChain = createLockQuery();
        const failChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null }),
        };
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectChain)
                .mockReturnValueOnce(lockChain)
                .mockReturnValueOnce(failChain),
        };
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as any,
            workerId: 'test-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });
        expect(failChain.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            last_error: 'bulk_session_fulfillment requires sessionIds',
        }));
    });
});
