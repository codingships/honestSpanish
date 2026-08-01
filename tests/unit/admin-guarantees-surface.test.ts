import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/layouts/CampusLayout.astro', 'utf8');
const page = readFileSync('src/pages/[lang]/campus/admin/guarantees.astro', 'utf8');
const student = readFileSync('src/pages/[lang]/campus/admin/student/[id].astro', 'utf8');

describe('admin guarantee surface integration', () => {
    it('is reachable only through the established admin campus shell', () => {
        expect(layout).toContain('/campus/admin/guarantees');
        expect(page).toContain("profile.role !== 'admin'");
        expect(page).toContain('<GuaranteeOperationsManager');
        expect(page).toContain('client:load');
    });

    it('links a student to filtered guarantees and shows gross, refunded and net payment values', () => {
        expect(student).toContain('/campus/admin/guarantees?studentId=${studentId}');
        expect(student).toContain('amount_refunded');
        expect(student).toContain('Bruto:');
        expect(student).toContain('Devuelto:');
        expect(student).toContain('Neto:');
        expect(student).toContain('payment.amount - (payment.amount_refunded || 0)');
    });
});
