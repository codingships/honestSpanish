import { describe, expect, it } from 'vitest';
import {
    addDaysToDateKey,
    dayOfWeekForDateKey,
    madridDateKey,
    madridDateTimeToUtcIso,
    madridWeekStartDateKey,
    madridWeekUtcRange,
    normalizeDateInputToDateKey,
} from '../../src/lib/calendar/madrid-time';

describe('Madrid calendar helpers', () => {
    it('converts Madrid local class times to UTC across winter and summer offsets', () => {
        expect(madridDateTimeToUtcIso('2026-02-18', '10:00')).toBe('2026-02-18T09:00:00.000Z');
        expect(madridDateTimeToUtcIso('2026-07-15', '10:00')).toBe('2026-07-15T08:00:00.000Z');
    });

    it('keeps date-key math independent from the runtime timezone', () => {
        expect(dayOfWeekForDateKey('2026-07-15')).toBe(3);
        expect(addDaysToDateKey('2026-07-15', 7)).toBe('2026-07-22');
        expect(normalizeDateInputToDateKey('2026-07-15')).toBe('2026-07-15');
    });

    it('rejects impossible civil dates and runtime-local instants', () => {
        for (const value of [
            '2026-02-29',
            '2026-02-30',
            '2026-04-31',
            '2026-13-01',
            '2026-2-01',
            '0999-12-31',
            ' 2026-02-01',
            '2026-02-01T12:00:00',
            '2026-02-30T12:00:00Z',
        ]) {
            expect(normalizeDateInputToDateKey(value), value).toBeNull();
        }

        expect(normalizeDateInputToDateKey('2028-02-29')).toBe('2028-02-29');
        expect(normalizeDateInputToDateKey('2026-02-18T09:00:00.000Z')).toBe('2026-02-18');
        expect(() => addDaysToDateKey('2026-02-30', 1)).toThrow(RangeError);
        expect(() => addDaysToDateKey('2026-02-18', 1.5)).toThrow(RangeError);
        expect(() => addDaysToDateKey('9999-12-31', 1)).toThrow(RangeError);
    });

    it('rejects Madrid wall-clock times that are nonexistent or ambiguous at DST changes', () => {
        expect(madridDateTimeToUtcIso('2026-03-29', '01:59')).toBe('2026-03-29T00:59:00.000Z');
        expect(madridDateTimeToUtcIso('2026-03-29', '02:00')).toBeNull();
        expect(madridDateTimeToUtcIso('2026-03-29', '02:30')).toBeNull();
        expect(madridDateTimeToUtcIso('2026-03-29', '03:00')).toBe('2026-03-29T01:00:00.000Z');

        expect(madridDateTimeToUtcIso('2026-10-25', '01:59')).toBe('2026-10-24T23:59:00.000Z');
        expect(madridDateTimeToUtcIso('2026-10-25', '02:00')).toBeNull();
        expect(madridDateTimeToUtcIso('2026-10-25', '02:30')).toBeNull();
        expect(madridDateTimeToUtcIso('2026-10-25', '03:00')).toBe('2026-10-25T02:00:00.000Z');
    });

    it('derives the previous Monday on Sunday in Madrid', () => {
        expect(madridWeekStartDateKey(new Date('2026-03-29T10:00:00.000Z'))).toBe('2026-03-23');
    });

    it.each([
        ['2026-02-16', '2026-02-15T23:00:00.000Z', '2026-02-22T23:00:00.000Z', 168],
        ['2026-07-13', '2026-07-12T22:00:00.000Z', '2026-07-19T22:00:00.000Z', 168],
        ['2026-03-23', '2026-03-22T23:00:00.000Z', '2026-03-29T22:00:00.000Z', 167],
        ['2026-10-19', '2026-10-18T22:00:00.000Z', '2026-10-25T23:00:00.000Z', 169],
    ])('builds the exact half-open UTC range for Madrid week %s', (weekStart, from, to, hours) => {
        const range = madridWeekUtcRange(weekStart);
        expect(range).toEqual({
            weekStartKey: weekStart,
            weekEndKeyExclusive: addDaysToDateKey(weekStart, 7),
            fromUtc: from,
            toUtcExclusive: to,
        });
        expect((Date.parse(to) - Date.parse(from)) / 3_600_000).toBe(hours);
    });

    it('only accepts a valid Monday as a weekly range identity', () => {
        expect(madridWeekUtcRange('2026-02-17')).toBeNull();
        expect(madridWeekUtcRange('2026-02-30')).toBeNull();
        expect(madridWeekUtcRange('9999-12-27')).toBeNull();
    });

    it('derives Madrid date keys from UTC instants near midnight', () => {
        expect(madridDateKey(new Date('2026-07-15T22:30:00.000Z'))).toBe('2026-07-16');
    });
});
