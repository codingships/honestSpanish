import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-admin', () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock('../../src/lib/google/student-folder', () => ({ createStudentFolderStructure: vi.fn() }));
vi.mock('../../src/lib/profiles-private', () => ({
    getPrivateProfile: vi.fn(),
    upsertPrivateProfile: vi.fn(),
}));
vi.mock('../../src/lib/email', () => ({
    sendClassCancelled: vi.fn(),
    sendGuaranteeRefundEmail: vi.fn(),
    sendRenewalNoticeEmail: vi.fn(),
    sendWelcomeEmail: vi.fn(),
}));
vi.mock('../../src/lib/google/calendar', () => ({
    cancelClassEvent: vi.fn(),
    deterministicClassEventId: vi.fn(),
}));
vi.mock('../../src/lib/crm/class-email', () => ({ recordClassEmailOutInCrmSafe: vi.fn() }));
vi.mock('../../src/lib/crm/activity-sync', () => ({ recordCrmActivityForProfileSafe: vi.fn() }));
vi.mock('../../src/lib/crm/onboarding', () => ({ recordPostPaymentOnboardingSafe: vi.fn() }));
vi.mock('../../src/lib/site-url', () => ({ getSiteUrl: vi.fn().mockReturnValue('https://example.com') }));
vi.mock('../../src/lib/fulfillment/session-fulfillment', () => ({
    fulfillSingleSession: vi.fn(),
    fulfillSessionBatch: vi.fn(),
}));
vi.mock('../../src/lib/fulfillment/session-reschedule', () => ({ processSessionReschedule: vi.fn() }));

function selectedJob(job: Record<string, unknown>) {
    return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [job], error: null }),
    };
}

function stateUpdate(result: Record<string, unknown>) {
    return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
    };
}

describe('guarantee refund fulfillment', () => {
    beforeEach(() => vi.clearAllMocks());

    it('sends one durable localized confirmation and records the CRM effect', async () => {
        const operationId = '11111111-1111-4111-8111-111111111111';
        const job = {
            id: 'job-guarantee',
            job_type: 'guarantee_refund',
            status: 'pending',
            payload: {
                operationId,
                subscriptionId: 'subscription-1',
                userId: 'student-1',
                refundAmount: 18071,
                currency: 'eur',
                cycleNumber: 2,
                sessionsTotal: 6,
                sessionsConsumed: 2,
                sessionsRefundable: 4,
                sendEmail: true,
            },
            session_id: null,
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            attempts: 0,
            max_attempts: 3,
            run_at: '2026-08-01T10:00:00.000Z',
            locked_at: null,
            locked_by: null,
            last_error: null,
            created_at: '2026-08-01T09:00:00.000Z',
            updated_at: '2026-08-01T09:00:00.000Z',
            dedupe_key: `guarantee_refund:${operationId}`,
        };
        const operationQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: operationId,
                    actor_id: 'student-1',
                    subscription_id: 'subscription-1',
                    status: 'refunded',
                    cycle_number: 2,
                    sessions_total: 6,
                    sessions_consumed: 2,
                    refund_amount_cents: 18071,
                    currency: 'eur',
                    stripe_refund_id: 're_guarantee',
                    refunded_at: '2026-08-01T09:01:00.000Z',
                },
                error: null,
            }),
        };
        const profileQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
                data: {
                    id: 'student-1',
                    email: 'student@example.com',
                    full_name: 'Alina',
                    preferred_language: 'es',
                },
                error: null,
            }),
        };
        const lock = stateUpdate({ id: job.id });
        const success = stateUpdate({ id: job.id });
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectedJob(job))
                .mockReturnValueOnce(lock)
                .mockReturnValueOnce(operationQuery)
                .mockReturnValueOnce(profileQuery)
                .mockReturnValueOnce(success),
        };
        const email = await import('../../src/lib/email');
        const crm = await import('../../src/lib/crm/activity-sync');
        vi.mocked(email.sendGuaranteeRefundEmail).mockResolvedValue(true);
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as never,
            workerId: 'guarantee-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0 });

        expect(email.sendGuaranteeRefundEmail).toHaveBeenCalledWith(
            'student@example.com',
            {
                locale: 'es',
                studentName: 'Alina',
                refundAmount: 18071,
                currency: 'eur',
                cycleNumber: 2,
                sessionsTotal: 6,
                sessionsConsumed: 2,
                sessionsRefundable: 4,
                accountUrl: 'https://example.com/es/campus/account',
                supportUrl: 'https://example.com/es/campus/support',
            },
            expect.objectContaining({
                fulfillmentEffect: expect.objectContaining({
                    effectKey: 'email.guarantee_refund.student',
                    jobId: job.id,
                    leaseOwner: 'guarantee-worker',
                    supabaseAdmin,
                }),
            }),
        );
        expect(crm.recordCrmActivityForProfileSafe).toHaveBeenCalledWith(
            supabaseAdmin,
            expect.objectContaining({
                profileId: 'student-1',
                relatedEntityId: operationId,
                metadata: expect.objectContaining({ refund_amount: 18071 }),
            }),
        );
    });

    it('fails closed before email when the durable operation is not refunded', async () => {
        const operationId = '22222222-2222-4222-8222-222222222222';
        const job = {
            id: 'job-pending-guarantee',
            job_type: 'guarantee_refund',
            status: 'pending',
            payload: {
                operationId,
                subscriptionId: 'subscription-1',
                userId: 'student-1',
                refundAmount: 12950,
                currency: 'eur',
                cycleNumber: 1,
                sessionsTotal: 4,
                sessionsConsumed: 2,
                sessionsRefundable: 2,
                sendEmail: true,
            },
            session_id: null,
            subscription_id: 'subscription-1',
            student_id: 'student-1',
            attempts: 0,
            max_attempts: 3,
            run_at: '2026-08-01T10:00:00.000Z',
            locked_at: null,
            locked_by: null,
            last_error: null,
            created_at: '2026-08-01T09:00:00.000Z',
            updated_at: '2026-08-01T09:00:00.000Z',
            dedupe_key: `guarantee_refund:${operationId}`,
        };
        const operationQuery = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
                data: {
                    id: operationId,
                    actor_id: 'student-1',
                    subscription_id: 'subscription-1',
                    status: 'refund_pending',
                    cycle_number: 1,
                    sessions_total: 4,
                    sessions_consumed: 2,
                    refund_amount_cents: 12950,
                    currency: 'eur',
                    stripe_refund_id: 're_pending',
                    refunded_at: null,
                },
                error: null,
            }),
        };
        const lock = stateUpdate({ id: job.id });
        const failed = stateUpdate({ id: job.id });
        const supabaseAdmin = {
            from: vi.fn()
                .mockReturnValueOnce(selectedJob(job))
                .mockReturnValueOnce(lock)
                .mockReturnValueOnce(operationQuery)
                .mockReturnValueOnce(failed),
        };
        const email = await import('../../src/lib/email');
        const { processDueFulfillmentJobs } = await import('../../src/lib/fulfillment/jobs');

        await expect(processDueFulfillmentJobs({
            supabaseAdmin: supabaseAdmin as never,
            workerId: 'guarantee-worker',
        })).resolves.toEqual({ processed: 1, succeeded: 0, failed: 1 });

        expect(email.sendGuaranteeRefundEmail).not.toHaveBeenCalled();
    });
});
