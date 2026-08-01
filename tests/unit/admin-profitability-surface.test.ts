import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = readFileSync('src/layouts/CampusLayout.astro', 'utf8');
const page = readFileSync('src/pages/[lang]/campus/admin/profitability.astro', 'utf8');
const translations = readFileSync('src/i18n/translations.ts', 'utf8');

describe('admin profitability surface integration', () => {
    it('is role-checked and mounted inside the established admin campus shell', () => {
        expect(layout).toContain('/campus/admin/profitability');
        expect(layout).toContain("t('campus.nav.profitability')");
        expect(page).toContain("profile.role !== 'admin'");
        expect(page).toContain('<ProfitabilityManager client:load');
        expect(translations).toContain('profitability: "Rentabilidad"');
        expect(translations).toContain('profitability: "Profitability"');
        expect(translations).toContain('profitability: "Рентабельность"');
    });

    it('labels the result as provisional and keeps all exclusions visible', () => {
        expect(page).toContain('Contribución operativa provisional');
        expect(page).toContain('no calcula el beneficio final');
        expect(page).toContain('reserva');
        expect(page).toContain('costes compartidos no registrados');
        expect(page).toContain('fiscalidad');
        expect(page).toContain('reparto');
        expect(page).toContain('remuneración fundadora no docente');
        expect(page).toContain('no equivale a que el profesor haya recibido un pago');
        expect(page).toContain('resta todo el gasto de campaña');
        expect(page).toContain('solo resta la captación que se le haya asignado expresamente');
    });
});
