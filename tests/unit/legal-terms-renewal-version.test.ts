import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const terms = readFileSync('src/pages/[lang]/legal/terminos.astro', 'utf8');

describe('legal terms version on automatic renewal', () => {
    it('does not claim that an automatic renewal records a new acceptance', () => {
        expect(terms).not.toContain('aceptada en la contratación o renovación');
        expect(terms).not.toContain('accepted at purchase or renewal');
        expect(terms).toContain('recabaremos una nueva aceptación cuando sea legalmente necesaria');
        expect(terms).toContain('obtain fresh acceptance where legally required');
        expect(terms).toContain('получим новое согласие');
    });

    it('states that multi-month purchases are a flexible period bank rather than a hidden monthly cap', () => {
        expect(terms).toContain('banco total de sesiones del periodo');
        expect(terms).toContain('with no monthly cap');
        expect(terms).toContain('без месячного лимита');
    });
});
