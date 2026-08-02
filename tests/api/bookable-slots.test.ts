import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL,
    PUBLIC_BOOKABLE_SLOTS_CACHE_TTL_SECONDS,
} from '../../src/lib/security-headers';

const mocks = vi.hoisted(() => ({
    listPublicBookableSlots: vi.fn(),
    checkoutEnabled: false,
    stagingGrant: null as { slotPublicId: string; studentId: string } | null,
}));

vi.mock('../../src/lib/public-bookable-slots', () => ({
    listPublicBookableSlots: mocks.listPublicBookableSlots,
}));

vi.mock('../../src/lib/checkout-enabled', () => ({
    isCheckoutEnabled: vi.fn(() => mocks.checkoutEnabled),
}));

vi.mock('../../src/lib/staging-e2e-checkout', () => ({
    readStagingE2ECheckoutGrant: vi.fn(() => Promise.resolve(mocks.stagingGrant)),
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
        mocks.checkoutEnabled = false;
        mocks.stagingGrant = null;
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
        await expect(firstResponse.json()).resolves.toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: false });
        await expect(secondResponse.json()).resolves.toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: false });
        expect(firstResponse.headers.get('Cache-Control')).toBe(PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL);
    });

    it('serves the successful micro-cache until it expires, then refreshes it', async () => {
        mocks.listPublicBookableSlots
            .mockResolvedValueOnce([{ publicId: 'slot-one' }])
            .mockResolvedValueOnce([{ publicId: 'slot-two' }]);
        const { GET } = await import('../../src/pages/api/bookable-slots');

        const first = await GET({} as never) as Response;
        const cached = await GET({} as never) as Response;
        expect(await first.json()).toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: false });
        expect(await cached.json()).toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: false });
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(1);

        now.mockReturnValue(1_000 + PUBLIC_BOOKABLE_SLOTS_CACHE_TTL_SECONDS * 1_000 + 1);
        const refreshed = await GET({} as never) as Response;

        expect(await refreshed.json()).toEqual({ slots: [{ publicId: 'slot-two' }], checkoutEnabled: false });
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(2);
    });

    it('reads the runtime checkout gate dynamically without putting auth in the cacheable payload', async () => {
        mocks.listPublicBookableSlots.mockResolvedValueOnce([{ publicId: 'slot-one' }]);
        const { GET } = await import('../../src/pages/api/bookable-slots');

        mocks.checkoutEnabled = true;
        const open = await GET({} as never) as Response;
        expect(await open.json()).toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: true });

        mocks.checkoutEnabled = false;
        const closed = await GET({} as never) as Response;
        const closedPayload = await closed.json() as Record<string, unknown>;
        expect(closedPayload).toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: false });
        expect(closedPayload).not.toHaveProperty('isLoggedIn');
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(1);
    });

    it('keeps a private staging grant out of shared caches', async () => {
        mocks.listPublicBookableSlots.mockResolvedValueOnce([
            { publicId: 'slot-one' },
            { publicId: 'slot-two' },
        ]);
        const { GET } = await import('../../src/pages/api/bookable-slots');

        mocks.stagingGrant = {
            slotPublicId: 'slot-one',
            studentId: '10000000-0000-4000-8000-000000000001',
        };
        const response = await GET({} as never) as Response;

        await expect(response.json()).resolves.toEqual({
            slots: [{ publicId: 'slot-one' }],
            checkoutEnabled: true,
        });
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(response.headers.get('Vary')).toBe('Cookie');
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
        await expect(recovered.json()).resolves.toEqual({ slots: [{ publicId: 'slot-one' }], checkoutEnabled: false });
        expect(mocks.listPublicBookableSlots).toHaveBeenCalledTimes(2);
        expect(consoleError).toHaveBeenCalledWith('Could not list public bookable slots:', error);
    });
});
