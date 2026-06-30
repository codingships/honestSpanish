import { describe, expect, it } from 'vitest';
import { isClassJoinWindowOpen } from '../../src/lib/class-access';

describe('isClassJoinWindowOpen', () => {
    it('keeps class links open through the configured overrun window', () => {
        const scheduledAt = '2026-02-18T10:00:00.000Z';

        expect(isClassJoinWindowOpen(
            scheduledAt,
            50,
            new Date('2026-02-18T12:49:00.000Z')
        )).toBe(true);

        expect(isClassJoinWindowOpen(
            scheduledAt,
            50,
            new Date('2026-02-18T12:51:00.000Z')
        )).toBe(false);
    });

    it('returns false for invalid schedule dates', () => {
        expect(isClassJoinWindowOpen('not-a-date', 50)).toBe(false);
    });
});
