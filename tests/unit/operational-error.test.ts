import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
    captureException: vi.fn(),
    isEnabled: vi.fn(() => true),
    setLevel: vi.fn(),
    setTag: vi.fn(),
}));

vi.mock('@sentry/astro', () => ({
    captureException: sentry.captureException,
    isEnabled: sentry.isEnabled,
    withScope: (callback: (scope: unknown) => void) => callback({
        setLevel: sentry.setLevel,
        setTag: sentry.setTag,
    }),
}));

import { reportOperationalFailure } from '../../src/lib/operational-error';

describe('operational failure reporting', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps logs and Sentry exceptions free of the original message', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const original = new Error('Payment for learner@example.com used secret-token');
        Object.assign(original, { code: 'PROVIDER_TIMEOUT' });

        reportOperationalFailure({
            surface: 'checkout.v2',
            error: original,
            requestId: '123e4567-e89b-42d3-a456-426614174000',
        });

        expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toEqual({
            event: 'operational_failure',
            surface: 'checkout.v2',
            code: 'PROVIDER_TIMEOUT',
            requestId: '123e4567-e89b-42d3-a456-426614174000',
        });
        expect(sentry.captureException).toHaveBeenCalledOnce();
        const captured = sentry.captureException.mock.calls[0]?.[0] as Error;
        expect(captured.message).toBe('Operational failure: checkout.v2:PROVIDER_TIMEOUT');
        expect(captured.stack).not.toContain('learner@example.com');
        expect(captured.stack).not.toContain('secret-token');
    });

    it('does not call Sentry when the SDK is disabled', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        sentry.isEnabled.mockReturnValueOnce(false);

        reportOperationalFailure({ surface: 'checkout.v2', code: 'EXPECTED_FAILURE' });

        expect(sentry.captureException).not.toHaveBeenCalled();
    });
});
