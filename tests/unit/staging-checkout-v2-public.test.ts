import { describe, expect, it } from 'vitest';
import {
    PublicCheckoutJourneyError,
    validatePublicCheckoutJourneyInput,
} from '../../scripts/smoke/staging-checkout-v2-public';

const grantedSlot = '3dc6cdb0-7f72-4e67-9673-dc5bd3b768b0';

describe('staging public checkout journey guards', () => {
    it('accepts only the exact granted slot public id', () => {
        expect(validatePublicCheckoutJourneyInput({ slotPublicId: grantedSlot })).toEqual({
            slotPublicId: grantedSlot,
            timeoutMs: 90_000,
        });
        for (const invalid of ['', 'not-a-uuid', `${grantedSlot} `, 'cs_test_123']) {
            expect(() => validatePublicCheckoutJourneyInput({ slotPublicId: invalid }))
                .toThrow(PublicCheckoutJourneyError);
        }
    });

    it('keeps the journey timeout inside the safe range', () => {
        expect(validatePublicCheckoutJourneyInput({
            slotPublicId: grantedSlot,
            timeoutMs: 5_000,
        }).timeoutMs).toBe(5_000);
        for (const invalid of [4_999, 120_001, Number.NaN, 1.5]) {
            expect(() => validatePublicCheckoutJourneyInput({
                slotPublicId: grantedSlot,
                timeoutMs: invalid,
            })).toThrow('safe range');
        }
    });
});
