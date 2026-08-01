import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deliverIdempotentEmail: vi.fn(),
    getEmailFrom: vi.fn(() => 'Academia <hello@example.com>'),
}));

vi.mock('../../src/lib/email/delivery', () => ({
    deliverIdempotentEmail: mocks.deliverIdempotentEmail,
    normalizeEmailAddressForDelivery: vi.fn((value: string) => {
        const normalized = value.trim().toLowerCase();
        return /^\S+@\S+\.\S+$/.test(normalized) ? normalized : null;
    }),
}));

vi.mock('../../src/lib/email/client', () => ({
    getEmailFrom: mocks.getEmailFrom,
}));

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const OWNER = 'worker:test:1';

function message(email = 'student@example.com') {
    return {
        email,
        html: '<p>Welcome</p>',
        source: 'welcome',
        subject: 'Welcome',
    };
}

function context(rpc: ReturnType<typeof vi.fn>, effectKey = 'email.welcome.student') {
    return {
        effectKey,
        jobId: JOB_ID,
        leaseOwner: OWNER,
        supabaseAdmin: { rpc } as any,
    };
}

function claimed(effectId = '22222222-2222-4222-8222-222222222222', generation = 1) {
    return {
        data: [{
            attempt_generation: generation,
            claimed: true,
            effect_id: effectId,
            effect_status: 'processing',
            provider_id: null,
            result: null,
        }],
        error: null,
    };
}

function drivePayload() {
    return {
        documentName: '03/08/26 - Ejercicios - Student',
        exercisesFolderId: 'drive-exercises-folder-1',
        sessionId: '33333333-3333-4333-8333-333333333333',
        templateId: 'drive-template-1',
    };
}

describe('durable fulfillment email effects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.deliverIdempotentEmail.mockResolvedValue({
            ok: true,
            providerId: 'resend-email-1',
        });
    });

    it('uses a deterministic Cloudflare-safe SHA-256 independent of object key order', async () => {
        const { deterministicSha256 } = await import('../../src/lib/fulfillment/effects');

        const first = await deterministicSha256({ b: 2, a: { d: 4, c: 3 } });
        const second = await deterministicSha256({ a: { c: 3, d: 4 }, b: 2 });

        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(second).toBe(first);
        expect(await deterministicSha256({ a: { c: 3, d: 5 }, b: 2 })).not.toBe(first);
    });

    it('persists the provider ID and uses one stable Resend idempotency key', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: true, error: null });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');

        await expect(sendFulfillmentEmailEffect(context(rpc), message())).resolves.toEqual({
            idempotencyKey: `fulfillment/${JOB_ID}/email.welcome.student`,
            providerId: 'resend-email-1',
            replayed: false,
        });

        expect(mocks.deliverIdempotentEmail).toHaveBeenCalledWith(expect.objectContaining({
            idempotencyKey: `fulfillment/${JOB_ID}/email.welcome.student`,
            to: 'student@example.com',
        }));
        expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_fulfillment_effect', expect.objectContaining({
            p_outcome: 'succeeded',
            p_provider_id: 'resend-email-1',
            p_result: {
                idempotency_key: `fulfillment/${JOB_ID}/email.welcome.student`,
            },
        }));
    });

    it('does not send again when the same job/effect is redelivered after success', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: true, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'succeeded',
                    provider_id: 'resend-email-1',
                    result: null,
                }],
                error: null,
            });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc);

        await sendFulfillmentEmailEffect(effectContext, message());
        await expect(sendFulfillmentEmailEffect(effectContext, message())).resolves.toMatchObject({
            providerId: 'resend-email-1',
            replayed: true,
        });

        expect(mocks.deliverIdempotentEmail).toHaveBeenCalledTimes(1);
    });

    it('quarantines a timeout as ambiguous and never replays that effect', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: true, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'ambiguous',
                    provider_id: null,
                    result: null,
                }],
                error: null,
            });
        mocks.deliverIdempotentEmail.mockResolvedValueOnce({
            acceptance: 'ambiguous',
            error: new Error('request timed out'),
            ok: false,
            reason: 'provider_error',
        });
        const {
            FulfillmentEffectError,
            sendFulfillmentEmailEffect,
        } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc);

        await expect(sendFulfillmentEmailEffect(effectContext, message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
            requiresManualReview: true,
        } satisfies Partial<InstanceType<typeof FulfillmentEffectError>>);
        await expect(sendFulfillmentEmailEffect(effectContext, message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
            requiresManualReview: true,
        });

        expect(mocks.deliverIdempotentEmail).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_fulfillment_effect', expect.objectContaining({
            p_outcome: 'ambiguous',
        }));
    });

    it('blocks a payload hash mismatch before touching Resend', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'fulfillment_effect_identity_mismatch' },
        });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');

        await expect(sendFulfillmentEmailEffect(context(rpc), message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_IDENTITY_MISMATCH',
            requiresManualReview: true,
        });
        expect(mocks.deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('never replays an effect already marked for manual review', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: [{
                attempt_generation: 1,
                claimed: false,
                effect_id: '22222222-2222-4222-8222-222222222222',
                effect_status: 'manual_review',
                provider_id: null,
                result: null,
            }],
            error: null,
        });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');

        await expect(sendFulfillmentEmailEffect(context(rpc), message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
            requiresManualReview: true,
        });
        expect(mocks.deliverIdempotentEmail).not.toHaveBeenCalled();
    });

    it('rechecks finalization uncertainty before an expired processing effect becomes manual review', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: false, error: null })
            .mockResolvedValueOnce({ data: false, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'processing',
                    provider_id: null,
                    result: null,
                }],
                error: null,
            })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'ambiguous',
                    provider_id: null,
                    result: null,
                }],
                error: null,
            });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc);

        await expect(sendFulfillmentEmailEffect(effectContext, message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS',
            requiresManualReview: false,
        });
        await expect(sendFulfillmentEmailEffect(effectContext, message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_IN_PROGRESS',
            requiresManualReview: false,
        });
        await expect(sendFulfillmentEmailEffect(effectContext, message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
            requiresManualReview: true,
        });

        expect(mocks.deliverIdempotentEmail).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenNthCalledWith(3, 'finalize_fulfillment_effect', expect.objectContaining({
            p_error: { code: 'effect_finalization_lost_after_provider_acceptance' },
            p_outcome: 'ambiguous',
            p_provider_id: 'resend-email-1',
        }));
    });

    it('observes a committed success after a lost finalization response without sending or budgeting twice', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockRejectedValueOnce(new Error('database response lost after commit'))
            .mockResolvedValueOnce({ data: false, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'succeeded',
                    provider_id: 'resend-email-1',
                    result: null,
                }],
                error: null,
            });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc);

        await expect(sendFulfillmentEmailEffect(effectContext, message())).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS',
            requiresManualReview: false,
        });
        await expect(sendFulfillmentEmailEffect(effectContext, message())).resolves.toMatchObject({
            providerId: 'resend-email-1',
            replayed: true,
        });

        // The delivery function contains the persistent budget reservation,
        // so skipping it proves that neither Resend nor budget is touched twice.
        expect(mocks.deliverIdempotentEmail).toHaveBeenCalledTimes(1);
    });

    it('retries only the failed second recipient while preserving the first recipient checkpoint', async () => {
        const state = new Map<string, { generation: number; providerId: string | null; status: string }>();
        const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
            if (name === 'claim_fulfillment_effect') {
                const key = args.p_effect_key as string;
                const current = state.get(key);
                if (current?.status === 'succeeded') {
                    return {
                        data: [{
                            attempt_generation: current.generation,
                            claimed: false,
                            effect_id: key,
                            effect_status: 'succeeded',
                            provider_id: current.providerId,
                            result: null,
                        }],
                        error: null,
                    };
                }
                const generation = (current?.generation ?? 0) + 1;
                state.set(key, { generation, providerId: null, status: 'processing' });
                return {
                    data: [{
                        attempt_generation: generation,
                        claimed: true,
                        effect_id: key,
                        effect_status: 'processing',
                        provider_id: null,
                        result: null,
                    }],
                    error: null,
                };
            }

            const key = args.p_effect_id as string;
            state.set(key, {
                generation: args.p_attempt_generation as number,
                providerId: (args.p_provider_id as string | null) ?? null,
                status: args.p_outcome as string,
            });
            return { data: true, error: null };
        });
        mocks.deliverIdempotentEmail.mockImplementation(async (input: { to: string }) => {
            if (
                input.to === 'teacher@example.com'
                && mocks.deliverIdempotentEmail.mock.calls.filter(([call]) => call.to === input.to).length === 1
            ) {
                return {
                    acceptance: 'not_accepted',
                    ok: false,
                    reason: 'provider_error',
                };
            }
            return { ok: true, providerId: `provider:${input.to}` };
        });
        const { sendFulfillmentEmailEffect } = await import('../../src/lib/fulfillment/effects');
        const studentContext = context(rpc, 'email.class_confirmation.student');
        const teacherContext = context(rpc, 'email.class_confirmation.teacher');

        await sendFulfillmentEmailEffect(studentContext, message('student@example.com'));
        await expect(sendFulfillmentEmailEffect(
            teacherContext,
            message('teacher@example.com'),
        )).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_DELIVERY_FAILED',
            requiresManualReview: false,
        });

        await sendFulfillmentEmailEffect(studentContext, message('student@example.com'));
        await sendFulfillmentEmailEffect(teacherContext, message('teacher@example.com'));

        const recipients = mocks.deliverIdempotentEmail.mock.calls.map(([input]) => input.to);
        expect(recipients).toEqual([
            'student@example.com',
            'teacher@example.com',
            'teacher@example.com',
        ]);
        const teacherKeys = mocks.deliverIdempotentEmail.mock.calls
            .filter(([input]) => input.to === 'teacher@example.com')
            .map(([input]) => input.idempotencyKey);
        expect(new Set(teacherKeys)).toEqual(new Set([
            `fulfillment/${JOB_ID}/email.class_confirmation.teacher`,
        ]));
    });
});

describe('durable fulfillment Google Drive copy effects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('finalizes an accepted copy with its document identity and replays it without copying again', async () => {
        const persistedResult = {
            document_id: 'drive-doc-1',
            document_url: 'https://docs.google.com/document/d/drive-doc-1/edit',
        };
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: true, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'succeeded',
                    provider_id: 'drive-doc-1',
                    result: persistedResult,
                }],
                error: null,
            });
        const copy = vi.fn().mockResolvedValue({
            documentId: 'drive-doc-1',
            documentUrl: persistedResult.document_url,
            outcome: 'accepted',
        });
        const { runFulfillmentDriveCopyEffect } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc, 'drive.copy.session.33333333-3333-4333-8333-333333333333');

        await expect(runFulfillmentDriveCopyEffect(
            effectContext,
            drivePayload(),
            copy,
        )).resolves.toEqual({
            documentId: 'drive-doc-1',
            documentUrl: persistedResult.document_url,
            replayed: false,
        });
        await expect(runFulfillmentDriveCopyEffect(
            effectContext,
            drivePayload(),
            copy,
        )).resolves.toEqual({
            documentId: 'drive-doc-1',
            documentUrl: persistedResult.document_url,
            replayed: true,
        });

        expect(copy).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenNthCalledWith(1, 'claim_fulfillment_effect', expect.objectContaining({
            p_effect_type: 'google.drive.copy',
        }));
        expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_fulfillment_effect', expect.objectContaining({
            p_outcome: 'succeeded',
            p_provider_id: 'drive-doc-1',
            p_result: persistedResult,
        }));
    });

    it('marks ambiguous provider acceptance for manual review and never invokes the copy callback again', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: true, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'ambiguous',
                    provider_id: null,
                    result: null,
                }],
                error: null,
            });
        const copy = vi.fn().mockResolvedValue({ outcome: 'ambiguous' });
        const {
            runFulfillmentDriveCopyEffect,
        } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc, 'drive.copy.session.33333333-3333-4333-8333-333333333333');

        await expect(runFulfillmentDriveCopyEffect(
            effectContext,
            drivePayload(),
            copy,
        )).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
            requiresManualReview: true,
        });
        await expect(runFulfillmentDriveCopyEffect(
            effectContext,
            drivePayload(),
            copy,
        )).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
            requiresManualReview: true,
        });

        expect(copy).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_fulfillment_effect', expect.objectContaining({
            p_error: { code: 'google_drive_copy_acceptance_ambiguous' },
            p_outcome: 'ambiguous',
        }));
    });

    it('finalizes a retryable rejection as failed and reports a delivery failure', async () => {
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockResolvedValueOnce({ data: true, error: null });
        const copy = vi.fn().mockResolvedValue({ outcome: 'retryable' });
        const { runFulfillmentDriveCopyEffect } = await import('../../src/lib/fulfillment/effects');

        await expect(runFulfillmentDriveCopyEffect(
            context(rpc, 'drive.copy.session.33333333-3333-4333-8333-333333333333'),
            drivePayload(),
            copy,
        )).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_DELIVERY_FAILED',
            requiresManualReview: false,
        });

        expect(rpc).toHaveBeenNthCalledWith(2, 'finalize_fulfillment_effect', expect.objectContaining({
            p_error: { code: 'google_drive_copy_retryable_failure' },
            p_outcome: 'failed',
        }));
    });

    it('recovers a committed success after the finalization response is lost without copying twice', async () => {
        const persistedResult = {
            document_id: 'drive-doc-1',
            document_url: 'https://docs.google.com/document/d/drive-doc-1/edit',
        };
        const rpc = vi.fn()
            .mockResolvedValueOnce(claimed())
            .mockRejectedValueOnce(new Error('database response lost after commit'))
            .mockResolvedValueOnce({ data: false, error: null })
            .mockResolvedValueOnce({
                data: [{
                    attempt_generation: 1,
                    claimed: false,
                    effect_id: '22222222-2222-4222-8222-222222222222',
                    effect_status: 'succeeded',
                    provider_id: 'drive-doc-1',
                    result: persistedResult,
                }],
                error: null,
            });
        const copy = vi.fn().mockResolvedValue({
            documentId: 'drive-doc-1',
            documentUrl: persistedResult.document_url,
            outcome: 'accepted',
        });
        const { runFulfillmentDriveCopyEffect } = await import('../../src/lib/fulfillment/effects');
        const effectContext = context(rpc, 'drive.copy.session.33333333-3333-4333-8333-333333333333');

        await expect(runFulfillmentDriveCopyEffect(
            effectContext,
            drivePayload(),
            copy,
        )).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS',
            requiresManualReview: false,
        });
        await expect(runFulfillmentDriveCopyEffect(
            effectContext,
            drivePayload(),
            copy,
        )).resolves.toEqual({
            documentId: 'drive-doc-1',
            documentUrl: persistedResult.document_url,
            replayed: true,
        });

        expect(copy).toHaveBeenCalledTimes(1);
        expect(rpc).toHaveBeenNthCalledWith(3, 'finalize_fulfillment_effect', expect.objectContaining({
            p_error: { code: 'effect_finalization_lost_after_drive_copy' },
            p_outcome: 'ambiguous',
            p_provider_id: 'drive-doc-1',
        }));
    });
});
