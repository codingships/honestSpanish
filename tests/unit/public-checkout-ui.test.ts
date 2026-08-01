import { describe, expect, it } from 'vitest';
import { buildCheckoutLoginUrl, parseBookableSlotsResponse } from '../../src/lib/public-checkout-ui';

const nowMs = Date.parse('2035-01-01T00:00:00.000Z');
const slotPublicId = '11111111-1111-4111-8111-111111111111';
const validSlot = {
    publicId: slotPublicId,
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

describe('public checkout UI contract', () => {
    it('accepts exactly four future weekly occurrences in the declared local schedule', () => {
        expect(parseBookableSlotsResponse({ slots: [validSlot] }, nowMs)).toEqual([validSlot]);
    });

    it('keeps the weekly local time valid across a daylight-saving transition', () => {
        const dstSlot = {
            ...validSlot,
            firstClassAt: '2035-03-12T17:00:00.000Z',
            renewalAt: '2035-04-09T17:00:00.000Z',
            occurrences: [
                { index: 1, startsAt: '2035-03-12T17:00:00.000Z', durationMinutes: 50 },
                { index: 2, startsAt: '2035-03-19T17:00:00.000Z', durationMinutes: 50 },
                { index: 3, startsAt: '2035-03-26T16:00:00.000Z', durationMinutes: 50 },
                { index: 4, startsAt: '2035-04-02T16:00:00.000Z', durationMinutes: 50 },
            ],
        };

        expect(parseBookableSlotsResponse({ slots: [dstSlot] }, nowMs)).toEqual([dstSlot]);
    });

    it.each([
        ['duplicate occurrence', {
            ...validSlot,
            occurrences: validSlot.occurrences.map((occurrence, index) => (
                index === 2 ? { ...occurrence, startsAt: validSlot.occurrences[1]!.startsAt } : occurrence
            )),
        }],
        ['out-of-order occurrence', {
            ...validSlot,
            occurrences: [
                validSlot.occurrences[0],
                { ...validSlot.occurrences[1], startsAt: validSlot.occurrences[2]!.startsAt },
                { ...validSlot.occurrences[2], startsAt: validSlot.occurrences[1]!.startsAt },
                validSlot.occurrences[3],
            ],
        }],
        ['non-weekly occurrence', {
            ...validSlot,
            occurrences: validSlot.occurrences.map((occurrence, index) => (
                index === 2 ? { ...occurrence, startsAt: '2035-01-23T17:00:00.000Z' } : occurrence
            )),
        }],
        ['wrong local time', {
            ...validSlot,
            localStartTime: '19:00:00',
        }],
        ['wrong weekday', {
            ...validSlot,
            weekday: 2,
        }],
    ])('rejects a %s', (_label, malformedSlot) => {
        expect(parseBookableSlotsResponse({ slots: [malformedSlot] }, nowMs)).toBeNull();
    });

    it('rejects the complete payload when any occurrence is no longer in the future', () => {
        expect(parseBookableSlotsResponse(
            { slots: [validSlot] },
            Date.parse(validSlot.occurrences[1]!.startsAt),
        )).toBeNull();
    });

    it('builds only the localized selector return contract', () => {
        expect(buildCheckoutLoginUrl('en', slotPublicId)).toBe(
            `/en/login?returnTo=${encodeURIComponent(`/en?checkoutSlot=${slotPublicId}#planes`)}`,
        );
    });
});
