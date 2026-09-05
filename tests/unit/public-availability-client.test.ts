import { describe, expect, it, vi } from 'vitest';
import {
    fetchPublicAvailability,
    PUBLIC_AVAILABILITY_PATH,
    PublicAvailabilityClientError,
} from '../../src/lib/public-availability-client';

const nowMs = Date.parse('2035-01-01T00:00:00.000Z');
const slot = {
    publicId: '11111111-1111-4111-8111-111111111111',
    teacherName: 'Álex',
    weekday: 1,
    localStartTime: '18:00:00',
    timezoneName: 'Europe/Madrid',
    firstClassAt: '2035-01-08T17:00:00.000Z',
    renewalAt: '2035-02-05T17:00:00.000Z',
    occurrences: [
        { index: 1, startsAt: '2035-01-08T17:00:00.000Z', durationMinutes: 50 },
        { index: 2, startsAt: '2035-01-15T17:00:00.000Z', durationMinutes: 50 },
        { index: 3, startsAt: '2035-01-22T17:00:00.000Z', durationMinutes: 50 },
        { index: 4, startsAt: '2035-01-29T17:00:00.000Z', durationMinutes: 50 },
    ],
};

describe('public availability browser client', () => {
    it('uses only the canonical no-store GET and the checkout parser', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(Response.json({ slots: [slot], checkoutEnabled: true }));

        await expect(fetchPublicAvailability({ fetchImpl, nowMs })).resolves.toEqual({
            slots: [slot],
            checkoutEnabled: true,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(fetchImpl).toHaveBeenCalledWith(PUBLIC_AVAILABILITY_PATH, {
            method: 'GET',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
    });

    it.each([
        ['an unsuccessful response', Response.json({ error: 'unavailable' }, { status: 503 })],
        ['a malformed successful response', Response.json({ slots: [slot] })],
    ])('fails closed for %s', async (_label, response) => {
        const fetchImpl = vi.fn().mockResolvedValue(response);

        await expect(fetchPublicAvailability({ fetchImpl, nowMs })).rejects.toBeInstanceOf(
            PublicAvailabilityClientError,
        );
    });

    it('passes through an AbortSignal without changing the request contract', async () => {
        const controller = new AbortController();
        const fetchImpl = vi.fn().mockResolvedValue(Response.json({ slots: [], checkoutEnabled: false }));

        await fetchPublicAvailability({ fetchImpl, signal: controller.signal, nowMs });

        expect(fetchImpl).toHaveBeenCalledWith(PUBLIC_AVAILABILITY_PATH, expect.objectContaining({
            method: 'GET',
            signal: controller.signal,
        }));
    });
});
