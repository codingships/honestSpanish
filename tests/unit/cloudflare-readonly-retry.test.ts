import { describe, expect, it, vi } from 'vitest';
import {
    CLOUDFLARE_READONLY_MAX_ATTEMPTS,
    CLOUDFLARE_READONLY_RETRY_DELAYS_MS,
    isRetryableCloudflareReadonlyError,
    isRetryableCloudflareReadonlyStatus,
    retryCloudflareReadonlyEvidence,
} from '../../scripts/launch/cloudflare-readonly-retry';

describe('Cloudflare read-only evidence retry', () => {
    it('classifies only transient Cloudflare read statuses plus explicitly allowed propagation statuses', () => {
        expect(isRetryableCloudflareReadonlyStatus(429)).toBe(true);
        expect(isRetryableCloudflareReadonlyStatus(500)).toBe(true);
        expect(isRetryableCloudflareReadonlyStatus(599)).toBe(true);
        expect(isRetryableCloudflareReadonlyStatus(401, [401])).toBe(true);
        expect(isRetryableCloudflareReadonlyStatus(404, [404])).toBe(true);
        expect(isRetryableCloudflareReadonlyStatus(401)).toBe(false);
        expect(isRetryableCloudflareReadonlyStatus(404)).toBe(false);
        expect(isRetryableCloudflareReadonlyStatus(200, [401, 404])).toBe(false);
    });

    it('classifies transport and timeout errors without treating arbitrary failures as transient', () => {
        const aborted = new Error('aborted');
        aborted.name = 'AbortError';
        const timeout = new Error('request timed out');
        const reset = new Error('read ECONNRESET');

        expect(isRetryableCloudflareReadonlyError(new TypeError('fetch failed'))).toBe(true);
        expect(isRetryableCloudflareReadonlyError(aborted)).toBe(true);
        expect(isRetryableCloudflareReadonlyError(timeout)).toBe(true);
        expect(isRetryableCloudflareReadonlyError(reset)).toBe(true);
        expect(isRetryableCloudflareReadonlyError(new Error('invalid JSON'))).toBe(false);
        expect(isRetryableCloudflareReadonlyError('timeout')).toBe(false);
    });

    it('returns proven evidence immediately without waiting', async () => {
        const read = vi.fn().mockResolvedValue({ state: 'proven', value: { version: 'v2' } });
        const wait = vi.fn();

        const result = await retryCloudflareReadonlyEvidence({ operation: 'readback', read, wait });

        expect(result).toEqual({
            state: 'proven',
            value: { version: 'v2' },
            attempts: 1,
            delaysMs: [],
            exhausted: false,
        });
        expect(read).toHaveBeenCalledOnce();
        expect(read).toHaveBeenCalledWith({ operation: 'readback', attempt: 1, maxAttempts: 4 });
        expect(wait).not.toHaveBeenCalled();
    });

    it('uses the fixed injected 1s, 2s and 4s delays before proving the fourth attempt', async () => {
        const read = vi.fn()
            .mockResolvedValueOnce({ state: 'retryable', reason: 'deployment list is stale' })
            .mockResolvedValueOnce({ state: 'retryable', reason: 'edge version is stale' })
            .mockResolvedValueOnce({ state: 'retryable', reason: 'attestation is propagating' })
            .mockResolvedValueOnce({ state: 'proven', value: 'current-version' });
        const wait = vi.fn().mockResolvedValue(undefined);

        const result = await retryCloudflareReadonlyEvidence({ operation: 'attestation', read, wait });

        expect(result).toEqual({
            state: 'proven',
            value: 'current-version',
            attempts: 4,
            delaysMs: [1_000, 2_000, 4_000],
            exhausted: false,
        });
        expect(read).toHaveBeenCalledTimes(4);
        expect(read.mock.calls.map(([context]) => context)).toEqual([
            { operation: 'attestation', attempt: 1, maxAttempts: 4 },
            { operation: 'attestation', attempt: 2, maxAttempts: 4 },
            { operation: 'attestation', attempt: 3, maxAttempts: 4 },
            { operation: 'attestation', attempt: 4, maxAttempts: 4 },
        ]);
        expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([1_000, 2_000, 4_000]);
    });

    it('returns the fourth retryable outcome as exhausted and never makes a fifth attempt', async () => {
        const read = vi.fn()
            .mockResolvedValue({ state: 'retryable', reason: 'Cloudflare is still propagating' });
        const wait = vi.fn().mockResolvedValue(undefined);

        const result = await retryCloudflareReadonlyEvidence({ operation: 'readback', read, wait });

        expect(result).toEqual({
            state: 'retryable',
            reason: 'Cloudflare is still propagating',
            attempts: 4,
            delaysMs: [1_000, 2_000, 4_000],
            exhausted: true,
        });
        expect(read).toHaveBeenCalledTimes(CLOUDFLARE_READONLY_MAX_ATTEMPTS);
        expect(wait).toHaveBeenCalledTimes(3);
        expect(CLOUDFLARE_READONLY_MAX_ATTEMPTS).toBe(4);
        expect(CLOUDFLARE_READONLY_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000]);
    });

    it('stops immediately on a definitive failure', async () => {
        const read = vi.fn().mockResolvedValue({
            state: 'definitive_failure',
            reason: 'secret inventory has an unexpected shape',
        });
        const wait = vi.fn();

        const result = await retryCloudflareReadonlyEvidence({ operation: 'readback', read, wait });

        expect(result).toEqual({
            state: 'definitive_failure',
            reason: 'secret inventory has an unexpected shape',
            attempts: 1,
            delaysMs: [],
            exhausted: false,
        });
        expect(read).toHaveBeenCalledOnce();
        expect(wait).not.toHaveBeenCalled();
    });

    it('stops on a later definitive failure without consuming another delay', async () => {
        const read = vi.fn()
            .mockResolvedValueOnce({ state: 'retryable', reason: 'temporary 503' })
            .mockResolvedValueOnce({ state: 'definitive_failure', reason: 'wrong Worker identity' });
        const wait = vi.fn().mockResolvedValue(undefined);

        const result = await retryCloudflareReadonlyEvidence({ operation: 'attestation', read, wait });

        expect(result).toEqual({
            state: 'definitive_failure',
            reason: 'wrong Worker identity',
            attempts: 2,
            delaysMs: [1_000],
            exhausted: false,
        });
        expect(read).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledExactlyOnceWith(1_000);
    });

    it('fails closed when the read function throws and does not retry implicitly', async () => {
        const read = vi.fn().mockRejectedValue(new Error('GET timed out'));
        const wait = vi.fn();

        const result = await retryCloudflareReadonlyEvidence({ operation: 'readback', read, wait });

        expect(result).toEqual({
            state: 'definitive_failure',
            reason: 'Cloudflare read-only readback threw: GET timed out',
            attempts: 1,
            delaysMs: [],
            exhausted: false,
        });
        expect(read).toHaveBeenCalledOnce();
        expect(wait).not.toHaveBeenCalled();
    });

    it('fails closed when the injected wait throws and does not make the next read', async () => {
        const read = vi.fn().mockResolvedValue({ state: 'retryable', reason: 'not propagated' });
        const wait = vi.fn().mockRejectedValue(new Error('timer aborted'));

        const result = await retryCloudflareReadonlyEvidence({ operation: 'attestation', read, wait });

        expect(result).toEqual({
            state: 'definitive_failure',
            reason: 'Cloudflare read-only retry wait threw: timer aborted',
            attempts: 1,
            delaysMs: [],
            exhausted: false,
        });
        expect(read).toHaveBeenCalledOnce();
        expect(wait).toHaveBeenCalledExactlyOnceWith(1_000);
    });

    it.each([
        [undefined, 'Cloudflare read-only attempt returned an invalid result.'],
        [{ state: 'unknown' }, 'Cloudflare read-only attempt returned an unsupported state.'],
        [{ state: 'proven' }, 'Cloudflare read-only proven result is missing its value.'],
        [{ state: 'retryable', reason: '   ' }, 'Cloudflare read-only retryable result requires a non-empty reason.'],
        [{ state: 'definitive_failure' }, 'Cloudflare read-only definitive_failure result requires a non-empty reason.'],
    ])('fails closed on malformed attempt result %#', async (attemptResult, reason) => {
        const read = vi.fn().mockResolvedValue(attemptResult);
        const wait = vi.fn();

        const result = await retryCloudflareReadonlyEvidence({
            operation: 'readback',
            read: read as never,
            wait,
        });

        expect(result).toMatchObject({ state: 'definitive_failure', reason, attempts: 1 });
        expect(read).toHaveBeenCalledOnce();
        expect(wait).not.toHaveBeenCalled();
    });

    it('rejects mutation-shaped options before invoking any supplied callback', async () => {
        const read = vi.fn().mockResolvedValue({ state: 'proven', value: true });
        const mutate = vi.fn();

        const result = await retryCloudflareReadonlyEvidence({
            operation: 'readback',
            read,
            wait: vi.fn(),
            method: 'PUT',
            body: { secret: 'never-use' },
            mutate,
        } as never);

        expect(result).toEqual({
            state: 'definitive_failure',
            reason: 'Cloudflare read-only retry rejected unsupported option keys: body, method, mutate.',
            attempts: 0,
            delaysMs: [],
            exhausted: false,
        });
        expect(read).not.toHaveBeenCalled();
        expect(mutate).not.toHaveBeenCalled();
    });

    it.each([
        [{ operation: 'write', read: vi.fn() }, 'Cloudflare read-only retry operation must be readback or attestation.'],
        [{ operation: 'readback' }, 'Cloudflare read-only retry requires a read function.'],
        [{ operation: 'readback', read: vi.fn(), wait: 1 }, 'Cloudflare read-only retry wait must be a function when provided.'],
    ])('fails closed on invalid configuration %#', async (options, reason) => {
        const result = await retryCloudflareReadonlyEvidence(options as never);

        expect(result).toMatchObject({
            state: 'definitive_failure',
            reason,
            attempts: 0,
            delaysMs: [],
            exhausted: false,
        });
    });
});
