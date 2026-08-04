import { describe, expect, it } from 'vitest';
import { isLegalIdentityProductionReady } from '../../src/lib/legal-identity';

const verifiedIdentity = {
    ownerName: 'Persona Titular',
    taxId: '00000000T',
    address: 'Calle Verificada 1, Madrid, España',
    footerAddress: 'Calle Verificada 1',
    footerCity: 'Madrid, España',
    email: 'soporte@espanolhonesto.com',
    activity: 'Servicios de enseñanza de español para extranjeros',
};

describe('legal identity production gate', () => {
    it('requires an explicit verified mode', () => {
        expect(isLegalIdentityProductionReady('example', verifiedIdentity)).toBe(false);
        expect(isLegalIdentityProductionReady('verified', verifiedIdentity)).toBe(true);
    });

    it.each([
        ['empty field', { ...verifiedIdentity, taxId: ' ' }],
        ['example marker', { ...verifiedIdentity, ownerName: 'EJEMPLO — titular' }],
        ['pending marker', { ...verifiedIdentity, address: 'Pendiente de confirmar' }],
        ['invalid marker', { ...verifiedIdentity, footerCity: 'No válido para producción' }],
    ])('rejects %s even in verified mode', (_scenario, identity) => {
        expect(isLegalIdentityProductionReady('verified', identity)).toBe(false);
    });
});
