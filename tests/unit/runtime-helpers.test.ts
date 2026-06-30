import type { APIContext } from 'astro';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CLASS_DURATION_MINUTES, normalizeClassDurationMinutes } from '../../src/lib/class-duration';
import { runAfterResponse } from '../../src/lib/cloudflare-runtime';

describe('normalizeClassDurationMinutes', () => {
    it('defaults to the launch class duration for empty or invalid values', () => {
        expect(normalizeClassDurationMinutes(undefined)).toBe(DEFAULT_CLASS_DURATION_MINUTES);
        expect(normalizeClassDurationMinutes('not-a-number')).toBe(DEFAULT_CLASS_DURATION_MINUTES);
        expect(normalizeClassDurationMinutes(-20)).toBe(DEFAULT_CLASS_DURATION_MINUTES);
    });

    it('accepts the supported class durations', () => {
        expect(normalizeClassDurationMinutes(30)).toBe(30);
        expect(normalizeClassDurationMinutes('40')).toBe(40);
        expect(normalizeClassDurationMinutes(50)).toBe(50);
    });

    it('defaults unsupported durations to the launch default', () => {
        expect(normalizeClassDurationMinutes(55)).toBe(DEFAULT_CLASS_DURATION_MINUTES);
        expect(normalizeClassDurationMinutes('60')).toBe(DEFAULT_CLASS_DURATION_MINUTES);
        expect(normalizeClassDurationMinutes(74.6)).toBe(DEFAULT_CLASS_DURATION_MINUTES);
    });
});

describe('runAfterResponse', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses Cloudflare waitUntil when Astro exposes the runtime context', async () => {
        const waitUntil = vi.fn();
        const work = Promise.resolve('done');

        runAfterResponse(
            { locals: { runtime: { ctx: { waitUntil } } } } as unknown as APIContext,
            work
        );

        expect(waitUntil).toHaveBeenCalledTimes(1);
        await expect(waitUntil.mock.calls[0][0]).resolves.toBe('done');
    });

    it('falls back outside Cloudflare and logs rejected background work', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        runAfterResponse({} as APIContext, Promise.reject(new Error('background failed')));
        await Promise.resolve();
        await Promise.resolve();

        expect(consoleError).toHaveBeenCalledWith(
            '[Background] Unhandled background task error:',
            expect.any(Error)
        );
    });
});
