import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const emailMocks = vi.hoisted(() => ({
    send: vi.fn(),
}));

vi.mock('../../src/lib/email/client', () => ({
    getEmailFrom: vi.fn(() => 'Academia <hello@example.com>'),
    getResend: vi.fn(() => ({
        emails: {
            send: emailMocks.send,
        },
    })),
}));

describe('transactional email send logging', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        emailMocks.send.mockResolvedValue({ error: null });
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
        expect(emailMocks.send).toHaveBeenCalledWith(expect.objectContaining({
            to: 'student.person@example.com',
        }));
        expect(logSpy).toHaveBeenCalledWith('[Email] Lead welcome email sent to s***n@example.com');
        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('student.person@example.com'));
    });

    it('summarizes provider errors while redacting personal email addresses', async () => {
        emailMocks.send.mockResolvedValueOnce({
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
