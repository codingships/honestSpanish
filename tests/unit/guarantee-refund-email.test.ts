import { describe, expect, it } from 'vitest';
import {
    guaranteeRefundEmailTemplate,
    guaranteeRefundSubject,
} from '../../src/lib/email/templates';

const mojibakePattern = /(?:Ãƒ|Ã‚|Ã|Ã°Å¸|Ã¢â‚¬|Ã¢Â|Ã¢Â|ï¿½)/;

describe('guarantee refund email', () => {
    it.each([
        ['es', 'Tu garantía ya se ha aplicado', '129,50', '2 clases consumidas permanecen pagadas'],
        ['en', 'Your guarantee has been applied', '129.50', '2 consumed classes remain paid'],
        ['ru', 'Гарантия применена', '129,50', 'Использованные занятия остаются оплаченными: 2'],
    ] as const)('renders the complete contractual result in %s', (locale, title, amount, consumedCopy) => {
        const html = guaranteeRefundEmailTemplate({
            locale,
            studentName: 'Alina <script>alert(1)</script>',
            refundAmount: 12950,
            currency: 'eur',
            cycleNumber: 2,
            sessionsTotal: 4,
            sessionsConsumed: 2,
            sessionsRefundable: 2,
            accountUrl: `https://example.com/${locale}/campus/account`,
            supportUrl: `https://example.com/${locale}/campus/support`,
        });

        expect(guaranteeRefundSubject(locale)).toContain('Español Honesto');
        expect(html).toContain(title);
        expect(html).toContain(amount);
        expect(html).toContain(consumedCopy);
        expect(html).toContain(`/${locale}/campus/account`);
        expect(html).toContain(`/${locale}/campus/support`);
        expect(html).toContain('Alina &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script');
        expect(html).not.toMatch(mojibakePattern);
    });

    it('rejects a non-positive or fractional refund amount', () => {
        const render = (refundAmount: number) => guaranteeRefundEmailTemplate({
            locale: 'en',
            studentName: 'Alina',
            refundAmount,
            currency: 'eur',
            cycleNumber: 1,
            sessionsTotal: 4,
            sessionsConsumed: 1,
            sessionsRefundable: 3,
            accountUrl: 'https://example.com/en/campus/account',
            supportUrl: 'https://example.com/en/campus/support',
        });

        expect(() => render(0)).toThrow('positive integer amount');
        expect(() => render(19425.5)).toThrow('positive integer amount');
    });

    it('rejects an incoherent proportional snapshot', () => {
        expect(() => guaranteeRefundEmailTemplate({
            locale: 'en',
            studentName: 'Alina',
            refundAmount: 12950,
            currency: 'eur',
            cycleNumber: 2,
            sessionsTotal: 4,
            sessionsConsumed: 2,
            sessionsRefundable: 3,
            accountUrl: 'https://example.com/en/campus/account',
            supportUrl: 'https://example.com/en/campus/support',
        })).toThrow('coherent session snapshot');
    });
});
