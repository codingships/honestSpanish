import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const paymentsPage = readFileSync('src/pages/[lang]/campus/admin/payments.astro', 'utf8');
const translations = readFileSync('src/i18n/translations.ts', 'utf8');

describe('admin payment accounting', () => {
    it('shows and totals the net amount after partial refunds', () => {
        expect(paymentsPage).toContain('amount_refunded');
        expect(paymentsPage).toContain("filterStatus: 'partially_refunded'");
        expect(paymentsPage).toContain('(p.amount || 0) - (p.amount_refunded || 0)');
        expect(paymentsPage).toContain('payment.amount - payment.amount_refunded');
        expect(paymentsPage).toContain("t('campus.admin.payments.grossAmount')");
        expect(paymentsPage).toContain("t('campus.admin.payments.refundedAmount')");
        expect(translations).toContain('Partially refunded');
        expect(translations).toContain('Частичный возврат');
    });

    it('builds Stripe links from the immutable offer mode instead of always using test mode', () => {
        expect(paymentsPage).toContain('package_prices (');
        expect(paymentsPage).toContain('stripe_livemode');
        expect(paymentsPage).toContain("const modePath = livemode ? '' : 'test/'");
        expect(paymentsPage).not.toContain('https://dashboard.stripe.com/test/payments/${paymentIntentId}');
    });
});
