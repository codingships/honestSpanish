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

    it('accepts numbers and numeric strings', () => {
        expect(normalizeClassDurationMinutes(55)).toBe(55);
        expect(normalizeClassDurationMinutes('60')).toBe(60);
        expect(normalizeClassDurationMinutes(74.6)).toBe(75);
    });

    it('keeps durations inside the supported scheduling bounds', () => {
        expect(normalizeClassDurationMinutes(5)).toBe(15);
        expect(normalizeClassDurationMinutes(240)).toBe(180);
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
