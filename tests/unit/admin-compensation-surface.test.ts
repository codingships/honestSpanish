import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/layouts/CampusLayout.astro', 'utf8');
const page = readFileSync('src/pages/[lang]/campus/admin/compensation.astro', 'utf8');

describe('admin compensation surface integration', () => {
    it('is reachable only through the established admin campus shell', () => {
        expect(layout).toContain('/campus/admin/compensation');
        expect(page).toContain("profile.role !== 'admin'");
        expect(page).toContain('<TeacherCompensationManager');
        expect(page).toContain('client:load');
    });

    it('describes obligations without presenting a payment or payroll operation', () => {
        expect(page).toContain('obligaciones internas');
        expect(page).toContain('no ejecuta pagos');
        expect(page).not.toContain('Marcar como pagado');
        expect(page).not.toContain('Nómina');
    });
});
