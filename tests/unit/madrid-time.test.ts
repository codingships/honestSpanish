import { describe, expect, it } from 'vitest';
import {
    addDaysToDateKey,
    dayOfWeekForDateKey,
    madridDateKey,
    madridDateTimeToUtcIso,
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

    it('derives Madrid date keys from UTC instants near midnight', () => {
        expect(madridDateKey(new Date('2026-07-15T22:30:00.000Z'))).toBe('2026-07-16');
    });
});
