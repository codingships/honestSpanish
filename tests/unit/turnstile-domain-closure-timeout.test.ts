import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    createExternalWriteReceipt,
    markExternalWriteAmbiguous,
    markExternalWriteAttemptStarted,
    markExternalWriteConfirmed,
} from '../../scripts/launch/external-write-receipt';
import {
    requestTurnstileCloudflareApi,
    TurnstileCloudflareRequestTimeoutError,
    TurnstileCloudflareWriteOutcomeUnknownError,
} from '../../scripts/launch/turnstile-cloudflare-request';

describe('Turnstile production domain closure timeout safety', () => {
    it('aborts a stalled provider request and exposes an explicit unknown-outcome timeout', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => (
            new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
            })
        ));
        const fetchImpl = fetchMock as unknown as typeof fetch;

        const request = requestTurnstileCloudflareApi({
            apiToken: 'redacted-test-token',
            method: 'PUT',
            pathname: '/accounts/account/challenges/widgets/sitekey',
            body: { domains: ['espanolhonesto.com'] },
            timeoutMs: 25,
            fetchImpl,
        });
        const assertion = expect(request).rejects.toBeInstanceOf(TurnstileCloudflareRequestTimeoutError);
        await vi.advanceTimersByTimeAsync(25);
        await assertion;

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        vi.useRealTimers();
    });

    it('keeps a timed-out PUT fail-closed as attempted and ambiguous, never not-performed', async () => {
        let receipt = markExternalWriteAttemptStarted(createExternalWriteReceipt());
        try {
            await requestTurnstileCloudflareApi({
                apiToken: 'redacted-test-token',
                method: 'PUT',
                pathname: '/accounts/account/challenges/widgets/sitekey',
                timeoutMs: 1,
                fetchImpl: (() => new Promise<Response>(() => undefined)) as typeof fetch,
            });
        } catch {
            receipt = markExternalWriteAmbiguous(receipt);
        }

        expect(receipt).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: 'unknown',
            externalWriteOutcome: 'ambiguous_needs_readonly_reconciliation',
            readonlyReconciliationRequired: true,
        });
    });

    it('treats a PUT HTTP 500 as ambiguous because the provider may have applied the write', async () => {
        let receipt = markExternalWriteAttemptStarted(createExternalWriteReceipt());
        const fetchImpl = vi.fn(async () => new Response(
            JSON.stringify({ success: false, errors: [{ code: 1000, message: 'internal error' }] }),
            { status: 500, statusText: 'Internal Server Error' },
        )) as unknown as typeof fetch;

        try {
            await requestTurnstileCloudflareApi({
                apiToken: 'redacted-test-token',
                method: 'PUT',
                pathname: '/accounts/account/challenges/widgets/sitekey',
                body: { domains: ['espanolhonesto.com'] },
                fetchImpl,
            });
            throw new Error('Expected the indeterminate provider response to throw.');
        } catch (error) {
            expect(error).toBeInstanceOf(TurnstileCloudflareWriteOutcomeUnknownError);
            receipt = markExternalWriteAmbiguous(receipt);
        }

        expect(receipt).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: 'unknown',
            externalWriteOutcome: 'ambiguous_needs_readonly_reconciliation',
            readonlyReconciliationRequired: true,
        });
    });

    it('keeps a structured PUT HTTP 400 rejection as confirmed not performed', async () => {
        let receipt = markExternalWriteAttemptStarted(createExternalWriteReceipt());
        const fetchImpl = vi.fn(async () => new Response(
            JSON.stringify({ success: false, errors: [{ code: 1001, message: 'invalid domains' }] }),
            { status: 400, statusText: 'Bad Request' },
        )) as unknown as typeof fetch;

        const payload = await requestTurnstileCloudflareApi({
            apiToken: 'redacted-test-token',
            method: 'PUT',
            pathname: '/accounts/account/challenges/widgets/sitekey',
            body: { domains: ['invalid.example'] },
            fetchImpl,
        });
        if (payload.success === false) {
            receipt = markExternalWriteConfirmed(receipt, false);
        }

        expect(payload.success).toBe(false);
        expect(receipt).toEqual({
            externalWriteAttempted: true,
            externalWritePerformed: false,
            externalWriteOutcome: 'confirmed_failed',
            readonlyReconciliationRequired: false,
        });
    });

    it('persists the ambiguous checkpoint before the bounded PUT and classifies every thrown result', () => {
        const source = readFileSync('scripts/launch/turnstile-domain-closure-runner.ts', 'utf8');
        expect(source).toMatch(
            /markExternalWriteAttemptStarted\(externalWriteReceipt\);\s+persistExternalWriteReceipt\('put_started_awaiting_provider_confirmation'\);\s+\s*try \{\s+const payload = await cloudflareRequest/,
        );
        expect(source).toContain('timeoutMs: TURNSTILE_CLOUDFLARE_REQUEST_TIMEOUT_MS');
        expect(source).toContain("persistExternalWriteReceipt('put_error_or_timeout_outcome_ambiguous')");
        expect(source).toContain("externalWritePerformed: 'unknown'");
        expect(source).toContain('NEEDS_READONLY_RECONCILIATION_OR_ROLLBACK');
    });
});
