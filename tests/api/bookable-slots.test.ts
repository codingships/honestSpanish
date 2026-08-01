import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL,
    PUBLIC_BOOKABLE_SLOTS_CACHE_TTL_SECONDS,
} from '../../src/lib/security-headers';

const mocks = vi.hoisted(() => ({
    listPublicBookableSlots: vi.fn(),
}));

vi.mock('../../src/lib/public-bookable-slots', () => ({
    listPublicBookableSlots: mocks.listPublicBookableSlots,
}));

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('GET /api/bookable-slots', () => {
    let now: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('coalesces concurrent cache misses into one Supabase read', async () => {
        const pending = deferred<Array<{ publicId: string }>>();
        mocks.listPublicBookableSlots.mockReturnValueOnce(pending.promise);
        const { GET } = await import('../../src/pages/api/bookable-slots');

        const first = GET({} as never) as Promise<Response>;
        const second = GET({} as never) as Promise<Response>;

        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(1);
        pending.resolve([{ publicId: 'slot-one' }]);

        const [firstResponse, secondResponse] = await Promise.all([first, second]);
        await expect(firstResponse.json()).resolves.toEqual({ slots: [{ publicId: 'slot-one' }] });
        await expect(secondResponse.json()).resolves.toEqual({ slots: [{ publicId: 'slot-one' }] });
        expect(firstResponse.headers.get('Cache-Control')).toBe(PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL);
    });

    it('serves the successful micro-cache until it expires, then refreshes it', async () => {
        mocks.listPublicBookableSlots
            .mockResolvedValueOnce([{ publicId: 'slot-one' }])
            .mockResolvedValueOnce([{ publicId: 'slot-two' }]);
        const { GET } = await import('../../src/pages/api/bookable-slots');

        const first = await GET({} as never) as Response;
        const cached = await GET({} as never) as Response;
        expect(await first.json()).toEqual({ slots: [{ publicId: 'slot-one' }] });
        expect(await cached.json()).toEqual({ slots: [{ publicId: 'slot-one' }] });
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000 + PUBLIC_BOOKABLE_SLOTS_CACHE_TTL_SECONDS * 1_000 + 1);
        const refreshed = await GET({} as never) as Response;

        expect(await refreshed.json()).toEqual({ slots: [{ publicId: 'slot-two' }] });
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(2);
    });

    it('never caches failures and retries the next request', async () => {
        const error = new Error('temporary Supabase failure');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.listPublicBookableSlots
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce([{ publicId: 'slot-one' }]);
        const { GET } = await import('../../src/pages/api/bookable-slots');

        const failed = await GET({} as never) as Response;
        expect(failed.status).toBe(503);
        expect(failed.headers.get('Cache-Control')).toBe('no-store');
        await expect(failed.json()).resolves.toEqual({ error: 'Availability is temporarily unavailable' });

        const recovered = await GET({} as never) as Response;
        expect(recovered.status).toBe(200);
        expect(recovered.headers.get('Cache-Control')).toBe(PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL);
        await expect(recovered.json()).resolves.toEqual({ slots: [{ publicId: 'slot-one' }] });
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(2);
        expect(consoleError).toHaveBeenCalledWith('Could not list public bookable slots:', error);
    });
});
