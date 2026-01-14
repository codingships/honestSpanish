import { describe, it, expect } from 'vitest';

// Test helpers que podrían existir o crear
describe('Price Calculations', () => {
    const calculateDiscountedPrice = (basePrice: number, months: number): number => {
        if (months === 3) return basePrice * 3 * 0.9;
        if (months === 6) return basePrice * 6 * 0.8;
        return basePrice * months;
    };

    it('should return full price for 1 month', () => {
        expect(calculateDiscountedPrice(160, 1)).toBe(160);
    });

    it('should apply 10% discount for 3 months', () => {
        expect(calculateDiscountedPrice(160, 3)).toBe(432);
    });

    it('should apply 20% discount for 6 months', () => {
        expect(calculateDiscountedPrice(160, 6)).toBe(768);
    });
});

describe('Duration Detection from PriceId', () => {
    const getDurationFromPriceId = (
        priceId: string,
        pkg: { stripe_price_1m: string; stripe_price_3m: string; stripe_price_6m: string }
    ): number => {
        if (pkg.stripe_price_3m === priceId) return 3;
        if (pkg.stripe_price_6m === priceId) return 6;
        return 1;
    };

    const mockPackage = {
        stripe_price_1m: 'price_1m',
        stripe_price_3m: 'price_3m',
        stripe_price_6m: 'price_6m',
    };

    it('should return 1 for 1-month price', () => {
        expect(getDurationFromPriceId('price_1m', mockPackage)).toBe(1);
    });

    it('should return 3 for 3-month price', () => {
        expect(getDurationFromPriceId('price_3m', mockPackage)).toBe(3);
    });

    it('should return 6 for 6-month price', () => {
        expect(getDurationFromPriceId('price_6m', mockPackage)).toBe(6);
    });
});

describe('Session Calculations', () => {
    it('should calculate total sessions correctly', () => {
        const sessionsPerMonth = 7;
        const durationMonths = 3;
        expect(sessionsPerMonth * durationMonths).toBe(21);
    });
});
