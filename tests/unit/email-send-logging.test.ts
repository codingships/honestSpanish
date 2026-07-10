import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emailMocks = vi.hoisted(() => ({
    deliverEmail: vi.fn(),
}));

vi.mock('../../src/lib/email/delivery', () => ({
    deliverEmail: emailMocks.deliverEmail,
}));

describe('transactional email send logging', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        emailMocks.deliverEmail.mockResolvedValue({ ok: true });
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('sends to the real recipient while redacting personal email addresses in success logs', async () => {
        const { sendLeadWelcomeEmail } = await import('../../src/lib/email/send');

        const sent = await sendLeadWelcomeEmail('student.person@example.com', {
            recipientName: 'Student',
        });

        expect(sent).toBe(true);
        expect(emailMocks.deliverEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'student.person@example.com',
            source: 'lead_welcome',
        }));
        expect(logSpy).toHaveBeenCalledWith('[Email] Lead welcome email sent to s***n@example.com');
        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('student.person@example.com'));
    });

    it('routes localized renewal notices through the persistent delivery gate', async () => {
        const { sendRenewalNoticeEmail } = await import('../../src/lib/email/send');

        const sent = await sendRenewalNoticeEmail('student.person@example.com', {
            locale: 'es',
            studentName: 'Student',
            packageName: 'Individual',
            renewalAt: '2026-10-10T12:00:00.000Z',
            cancelBy: '2026-10-10T12:00:00.000Z',
            durationMonths: 3,
            amountTotal: 27000,
            currency: 'eur',
            accountUrl: 'https://example.com/es/campus/account',
            supportUrl: 'https://example.com/es/campus/support',
            termsUrl: 'https://example.com/es/legal/terminos',
        });

        expect(sent).toBe(true);
        expect(emailMocks.deliverEmail).toHaveBeenCalledWith(expect.objectContaining({
            to: 'student.person@example.com',
            source: 'renewal_notice',
            subject: 'Aviso de renovación de tu suscripción - Español Honesto',
            html: expect.stringContaining('Plazo de cancelación'),
        }));
    });

    it('summarizes provider errors while redacting personal email addresses', async () => {
        emailMocks.deliverEmail.mockResolvedValueOnce({
            ok: false,
            reason: 'provider_error',
            error: {
                message: 'Recipient student.person@example.com was rejected',
                statusCode: 422,
                response: {
                    recipient: 'student.person@example.com',
                    reason: 'suppressed',
                },
            },
        });
        const { sendLeadWelcomeEmail } = await import('../../src/lib/email/send');

        const sent = await sendLeadWelcomeEmail('student.person@example.com', {
            recipientName: 'Student',
        });

        expect(sent).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith(
            '[Email] Failed to send lead welcome email:',
            'Recipient s***n@example.com was rejected status=422'
        );
        expect(errorSpy.mock.calls[0]?.[1]).toEqual(expect.any(String));
        expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('student.person@example.com');
    });
});
