import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deliver: vi.fn(),
}));

vi.mock('../../src/lib/email/client', () => ({
    getEmailFrom: () => 'Sender <sender@example.com>',
}));

vi.mock('../../src/lib/email/delivery', () => ({
    deliverPreReservedStagingSmokeEmail: mocks.deliver,
}));

describe('staging smoke email provider boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('passes the durable run-derived key as the Resend idempotency option', async () => {
        mocks.deliver.mockResolvedValue({ ok: true, providerId: 'provider-id' });
        const { buildStagingSmokeEmail, sendStagingSmokeEmail } = await import(
            '../../src/lib/email/staging-smoke'
        );
        const email = await buildStagingSmokeEmail('allowed@example.com');
        const key = 'staging-integration-smoke/email/11111111-1111-4111-8111-111111111111';
        await expect(sendStagingSmokeEmail(email.payload, key)).resolves.toEqual({
            errorCode: null,
            httpStatus: null,
            outcome: 'sent',
            providerId: 'provider-id',
        });
        expect(mocks.deliver).toHaveBeenCalledWith({ ...email.payload, idempotencyKey: key });
        expect(email.payloadSha256).toMatch(/^[a-f0-9]{64}$/);
    });

    it('classifies ambiguous/provider failures without persisting their messages', async () => {
        const { classifyStagingSmokeProviderError } = await import('../../src/lib/email/staging-smoke');
        expect(classifyStagingSmokeProviderError({
            name: 'concurrent_idempotent_requests',
            message: 'contains sensitive provider detail',
            statusCode: 409,
        })).toEqual({
            errorCode: 'concurrent_idempotent_requests',
            httpStatus: 409,
            outcome: 'retryable',
            providerId: null,
        });
        expect(classifyStagingSmokeProviderError({
            name: 'invalid_idempotency_key',
            message: 'contains sensitive provider detail',
            statusCode: 400,
        })).toEqual({
            errorCode: 'invalid_idempotency_key',
            httpStatus: 400,
            outcome: 'terminal_failed',
            providerId: null,
        });
    });
});
