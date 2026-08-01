import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADULT_POLICY_VERSION, CHECKOUT_TERMS_VERSION } from '../../src/lib/legal-policy';

const terms = readFileSync('src/pages/[lang]/legal/terminos.astro', 'utf8');

describe('legal terms version on automatic renewal', () => {
    it('versions checkout terms independently from the adult attestation', () => {
        expect(CHECKOUT_TERMS_VERSION).toBe('2026-08-01');
        expect(ADULT_POLICY_VERSION).toBe('2026-07-10');
        expect(CHECKOUT_TERMS_VERSION).not.toBe(ADULT_POLICY_VERSION);
        expect(terms).toContain('Última actualización: 1 de agosto de 2026');
        expect(terms).toContain('Last updated: August 1, 2026');
    });

    it('does not claim that an automatic renewal records a new acceptance', () => {
        expect(terms).not.toContain('aceptada en la contratación o renovación');
        expect(terms).not.toContain('accepted at purchase or renewal');
        expect(terms).toContain('recabaremos una nueva aceptación cuando sea legalmente necesaria');
        expect(terms).toContain('obtain fresh acceptance where legally required');
        expect(terms).toContain('получим новое согласие');
    });

    it('states the exact initial charge, renewal anchor and guarantee in every language', () => {
        expect(terms).toContain('La primera cuota de 259 EUR se cobra al reservar la plaza');
        expect(terms).toContain('La siguiente cuota se cobra 28 días después de la primera clase');
        expect(terms).toContain('hasta 28 días inclusive desde la fecha originalmente comprada');
        expect(terms).toContain('devolución de 194,25 EUR');
        expect(terms).toContain('que soporte no haya reclasificado consume la segunda clase y cierra la garantía');
        expect(terms).toContain('The initial EUR 259 charge is collected when the place is reserved');
        expect(terms).toContain('The next charge is collected 28 days after the first class');
        expect(terms).toContain('up to and including 28 days after the originally purchased date');
        expect(terms).toContain('EUR 194.25 refund');
        expect(terms).toContain('that support has not reclassified consumes the second class and closes the guarantee');
        expect(terms).toContain('Первые 259 EUR списываются при бронировании места');
        expect(terms).toContain('через 28 дней после первого занятия');
        expect(terms).toContain('на 28 дней включительно от первоначально приобретённой даты');
        expect(terms).toContain('возврат 194,25 EUR');
    });
});
