import { describe, expect, it } from 'vitest';
import { sanitizePublicBookableSlots } from '../../src/lib/public-bookable-slots';

const now = new Date('2026-08-01T10:00:00.000Z');
const slot = {
    id: 'slot-1', public_id: '10000000-0000-4000-8000-000000000001', package_id: 'package-1',
    teacher_id: 'teacher-1', status: 'available', contract_schema_version: 2,
    first_occurrence_at: '2026-08-10T16:00:00.000Z', timezone_name: 'Europe/Madrid', weekday: 1,
    local_start_time: '18:00:00', published_at: '2026-08-01T09:00:00.000Z', sold_subscription_id: null,
};
const pkg = {
    id: 'package-1', name: 'individual_4x50_28d', is_active: true, is_publicly_listed: true,
    contract_schema_version: 2, amount_cents: 25900, billing_interval_unit: 'day',
    billing_interval_count: 28, sessions_per_period: 4, class_duration_minutes: 50,
};
const packagePrice = {
    id: 'price-row-1', package_id: 'package-1', status: 'active', contract_schema_version: 2,
    amount_cents: 25900, currency: 'eur', billing_interval_unit: 'day', billing_interval_count: 28,
    sessions_per_period: 4, class_duration_minutes: 50, stripe_account_id: 'acct_test',
    stripe_livemode: false, stripe_price_id: 'price_recurring_28d',
};
const priceSnapshot = {
    package_price_id: 'price-row-1', initial_amount_cents: 25900, recurring_amount_cents: 25900,
    currency: 'eur', recurring_interval_unit: 'day', recurring_interval_count: 28,
    recurring_stripe_price_id: 'price_recurring_28d', stripe_account_id: 'acct_test',
    stripe_livemode: false,
};
const occurrences = [0, 7, 14, 21].map((days, index) => ({
    slot_id: 'slot-1', occurrence_index: index + 1,
    starts_at: new Date(Date.parse(slot.first_occurrence_at) + days * 86_400_000).toISOString(),
    duration_minutes: 50,
}));

describe('public bookable slot projection', () => {
    it('returns only the sanitized contract fields and computes the exact renewal', () => {
        const result = sanitizePublicBookableSlots({
            slots: [slot], occurrences, holds: [], packages: [pkg],
            packagePrices: [packagePrice], priceSnapshots: [priceSnapshot],
            teachers: [{ id: 'teacher-1', full_name: 'Irene', role: 'teacher' }], now,
        });

        expect(result).toEqual([expect.objectContaining({
            publicId: slot.public_id,
            teacherName: 'Irene',
            firstClassAt: slot.first_occurrence_at,
            renewalAt: '2026-09-07T16:00:00.000Z',
        })]);
        expect(result[0]).not.toHaveProperty('id');
        expect(result[0]).not.toHaveProperty('teacherId');
    });

    it('excludes a live hold and any slot outside the exact v2 contract', () => {
        const held = sanitizePublicBookableSlots({
            slots: [slot], occurrences,
            holds: [{ slot_id: 'slot-1', status: 'held', expires_at: '2026-08-01T11:00:00.000Z' }],
            packages: [pkg], packagePrices: [packagePrice], priceSnapshots: [priceSnapshot],
            teachers: [{ id: 'teacher-1', full_name: 'Irene', role: 'teacher' }], now,
        });
        const wrongContract = sanitizePublicBookableSlots({
            slots: [{ ...slot, contract_schema_version: 1 }], occurrences, holds: [], packages: [pkg],
            packagePrices: [packagePrice], priceSnapshots: [priceSnapshot],
            teachers: [{ id: 'teacher-1', full_name: 'Irene', role: 'teacher' }], now,
        });

        expect(held).toEqual([]);
        expect(wrongContract).toEqual([]);
    });

    it('excludes a slot when its immutable Stripe price pair is missing', () => {
        const result = sanitizePublicBookableSlots({
            slots: [slot], occurrences, holds: [], packages: [pkg], packagePrices: [packagePrice],
            priceSnapshots: [], teachers: [{ id: 'teacher-1', full_name: 'Irene', role: 'teacher' }], now,
        });

        expect(result).toEqual([]);
    });
});
