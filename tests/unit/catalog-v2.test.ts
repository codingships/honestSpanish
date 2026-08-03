import { describe, expect, it } from 'vitest';
import {
    allocateSessionAmounts,
    buildGuaranteeSchedule,
    isCurrentCheckoutRuntimeCompatible,
} from '../../src/lib/catalog-v2';

describe('catalog v2 contract helpers', () => {
    it('allocates every cent deterministically across all package sessions', () => {
        expect(allocateSessionAmounts(25900, 4)).toEqual([6475, 6475, 6475, 6475]);
        expect(allocateSessionAmounts(27107, 6)).toEqual([4518, 4518, 4518, 4518, 4518, 4517]);
        expect(allocateSessionAmounts(27107, 6).reduce((total, value) => total + value, 0)).toBe(27107);
    });

    it('derives the proportional guarantee after every successive class', () => {
        expect(buildGuaranteeSchedule(25900, 4)).toEqual([
            { consumedSessions: 1, consumedAmountCents: 6475, refundableAmountCents: 19425 },
            { consumedSessions: 2, consumedAmountCents: 12950, refundableAmountCents: 12950 },
            { consumedSessions: 3, consumedAmountCents: 19425, refundableAmountCents: 6475 },
            { consumedSessions: 4, consumedAmountCents: 25900, refundableAmountCents: 0 },
        ]);
    });

    it('rejects package shapes that cannot allocate at least one cent per class', () => {
        expect(() => allocateSessionAmounts(3, 4)).toThrow('cannot be allocated exactly');
        expect(() => allocateSessionAmounts(25900.5, 4)).toThrow('positive integer');
    });

    it('labels only the currently implemented launch contract as checkout compatible', () => {
        const launchTerms = {
            packageKey: 'individual_4x50_28d',
            amountCents: 25900,
            currency: 'eur',
            billingIntervalUnit: 'day' as const,
            billingIntervalCount: 28,
            sessionsPerPeriod: 4,
            classDurationMinutes: 50,
            hasGroupSession: false,
            hasDualTeacher: false,
        };

        expect(isCurrentCheckoutRuntimeCompatible(launchTerms)).toBe(true);
        expect(isCurrentCheckoutRuntimeCompatible({ ...launchTerms, amountCents: 29900 })).toBe(false);
        expect(isCurrentCheckoutRuntimeCompatible({ ...launchTerms, hasGroupSession: true })).toBe(false);
    });
});
