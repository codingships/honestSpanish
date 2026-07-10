import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    sendWelcomeEmail: vi.fn(),
    sendRenewalNoticeEmail: vi.fn(),
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

    it('treats a renewal-notice unique-key conflict as an idempotent enqueue', async () => {
        const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
        const supabaseAdmin = { from: vi.fn().mockReturnValue({ insert }) };
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

    it('processes welcome fulfillment and records post-payment onboarding work in CRM', async () => {
        const job = createJob({
            job_type: 'welcome_fulfillment',
            payload: {
                userId: 'student-1',
                packageId: 'package-1',
                subscriptionId: 'subscription-1',
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
                name: 'hybrid',
                display_name: { es: 'Plan Híbrido', en: 'Hybrid Plan', ru: 'Гибридный план' },
            },
            error: null,
        });
        const successChain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
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
        vi.mocked(profilesPrivate.getPrivateProfile).mockResolvedValue(null as any);
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
            studentName: 'Student One',
            studentEmail: 'student@example.com',
            teacherName: 'Teacher One',
        });
        expect(email.sendWelcomeEmail).toHaveBeenCalledWith('student@example.com', expect.objectContaining({
            locale: 'en',
            studentName: 'Student One',
            packageName: 'Hybrid Plan',
            loginUrl: 'https://example.com/en/login',
            driveFolderUrl: 'https://drive.google.com/folder-1',
        }));
        expect(crmOnboarding.recordPostPaymentOnboardingSafe).toHaveBeenCalledWith(supabaseAdmin, {
            profileId: 'student-1',
            email: 'student@example.com',
            fullName: 'Student One',
            subscriptionId: 'subscription-1',
            packageId: 'package-1',
            packageName: 'Hybrid Plan',
            driveFolderUrl: 'https://drive.google.com/folder-1',
        });
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
            eq: vi.fn().mockResolvedValue({ error: null }),
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
        expect(email.sendWelcomeEmail).toHaveBeenCalledWith('student2@example.com', expect.objectContaining({
            locale: 'en',
            studentName: 'Student Two',
            packageName: 'individual',
            loginUrl: 'https://example.com/en/login',
            driveFolderUrl: 'https://drive.google.com/existing-folder',
        }));
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
                durationMonths: 3,
                amountTotal: 27000,
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
            eq: vi.fn().mockResolvedValue({ error: null }),
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
            durationMonths: 3,
            amountTotal: 27000,
            currency: 'eur',
            accountUrl: 'https://example.com/ru/campus/account',
            supportUrl: 'https://example.com/ru/campus/support',
            termsUrl: 'https://example.com/ru/legal/terminos',
        });
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
            eq: vi.fn().mockResolvedValue({ error: null }),
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
            { autoCreateMeeting: undefined, sendEmail: undefined }
        );
        expect(successChain.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'succeeded',
            last_error: null,
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
            eq: vi.fn().mockResolvedValue({ error: null }),
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
