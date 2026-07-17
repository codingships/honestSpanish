import { describe, expect, it } from 'vitest';
import {
    calculatePackageMonthlyEquivalentCents,
    calculatePackageSavingsCents,
    calculatePackageTotalCents,
    calculateSessionsPerPeriod,
    formatPackagePrice,
    getCheckoutReadyPackageOffers,
    isPackageCheckoutReady,
    isPackageCheckoutEligible,
    isPackageKeyCheckoutEligible,
    isPackageDuration,
    packagePriceField,
} from '../../src/lib/package-pricing';

describe('package pricing contract', () => {
    it.each([
        { duration: 1 as const, total: 14500, monthly: 14500, savings: 0, field: 'stripe_price_1m' },
        { duration: 3 as const, total: 39150, monthly: 13050, savings: 4350, field: 'stripe_price_3m' },
        { duration: 6 as const, total: 69600, monthly: 11600, savings: 17400, field: 'stripe_price_6m' },
    ])('keeps the $duration-month amount and Stripe field aligned', ({ duration, total, monthly, savings, field }) => {
        expect(calculatePackageTotalCents(14500, duration)).toBe(total);
        expect(calculatePackageMonthlyEquivalentCents(14500, duration)).toBe(monthly);
        expect(calculatePackageSavingsCents(14500, duration)).toBe(savings);
        expect(packagePriceField(duration)).toBe(field);
        expect(calculateSessionsPerPeriod(4, duration)).toBe(4 * duration);
    });

    it('rejects invalid cents and session counts', () => {
        expect(() => calculatePackageTotalCents(12.5, 1)).toThrow(/integer/);
        expect(() => calculatePackageTotalCents(-1, 1)).toThrow(/non-negative/);
        expect(() => calculateSessionsPerPeriod(-1, 1)).toThrow(/non-negative/);
    });

    it('recognizes only supported durations', () => {
        expect(isPackageDuration(1)).toBe(true);
        expect(isPackageDuration(3)).toBe(true);
        expect(isPackageDuration(6)).toBe(true);
        expect(isPackageDuration(12)).toBe(false);
        expect(isPackageDuration('3')).toBe(false);
    });

    it('formats whole and fractional euro amounts without rounding them away', () => {
        expect(formatPackagePrice(14500, 'es')).toMatch(/145/);
        expect(formatPackagePrice(39150, 'es')).toMatch(/391,50/);
        expect(formatPackagePrice(39150, 'en')).toMatch(/391\.50/);
    });

    it('requires one exact immutable offer per duration, account and Stripe mode', () => {
        const packageSnapshot = {
            name: 'standard',
            catalog_version: 2,
            price_monthly: 14500,
            sessions_per_month: 4,
            has_group_session: false,
            has_dual_teacher: false,
            is_active: true,
            stripe_product_id: 'prod_standard',
            stripe_price_1m: 'price_standard_1m',
            stripe_price_3m: 'price_standard_3m',
            stripe_price_6m: 'price_standard_6m',
            package_prices: ([1, 3, 6] as const).map((duration) => ({
                catalog_version: 2,
                package_key: 'standard',
                duration_months: duration,
                amount_cents: calculatePackageTotalCents(14500, duration),
                currency: 'eur',
                sessions_per_month: 4,
                sessions_per_period: 4 * duration,
                has_group_session: false,
                has_dual_teacher: false,
                status: 'active',
                stripe_account_id: 'acct_staging',
                stripe_livemode: false,
                stripe_product_id: 'prod_standard',
                stripe_price_id: `price_standard_${duration}m`,
            })),
        };

        expect(isPackageCheckoutReady(packageSnapshot)).toBe(true);
        expect(isPackageCheckoutEligible(packageSnapshot)).toBe(true);
        expect(isPackageKeyCheckoutEligible('group')).toBe(false);
        expect(isPackageKeyCheckoutEligible('hybrid')).toBe(false);
        expect(isPackageCheckoutEligible({ ...packageSnapshot, name: 'group' })).toBe(false);
        expect([...getCheckoutReadyPackageOffers(packageSnapshot)!.keys()]).toEqual([1, 3, 6]);
        expect(isPackageCheckoutReady({
            ...packageSnapshot,
            package_prices: packageSnapshot.package_prices.map((offer) => (
                offer.duration_months === 3 ? { ...offer, amount_cents: offer.amount_cents + 1 } : offer
            )),
        })).toBe(false);
        expect(isPackageCheckoutReady({
            ...packageSnapshot,
            package_prices: packageSnapshot.package_prices.map((offer) => (
                offer.duration_months === 6 ? { ...offer, stripe_account_id: 'acct_other' } : offer
            )),
        })).toBe(false);
    });
});
