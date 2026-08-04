export type LegalIdentityMode = 'example' | 'verified';

export const LEGAL_IDENTITY_MODE: LegalIdentityMode = 'example';

export const legalIdentity = {
    ownerName: 'EJEMPLO — titular pendiente de confirmar',
    taxId: 'EJEMPLO — NIF/CIF pendiente de confirmar',
    address: 'EJEMPLO — domicilio pendiente de confirmar, Madrid, España',
    footerAddress: 'EJEMPLO — domicilio pendiente de confirmar',
    footerCity: 'Madrid, España · NO VÁLIDO PARA PRODUCCIÓN',
    email: 'alejandro@espanolhonesto.com',
    activity: 'Servicios de enseñanza de español para extranjeros',
} as const;

type LegalIdentity = {
    ownerName: string;
    taxId: string;
    address: string;
    footerAddress: string;
    footerCity: string;
    email: string;
    activity: string;
};

const provisionalMarker = /(?:\bejemplo\b|pendiente de confirmar|no válido para producción)/iu;

export function isLegalIdentityProductionReady(
    mode: LegalIdentityMode = LEGAL_IDENTITY_MODE,
    identity: LegalIdentity = legalIdentity,
): boolean {
    if (mode !== 'verified') return false;

    return Object.values(identity).every((value) => {
        const normalized = value.trim();
        return normalized.length > 0 && !provisionalMarker.test(normalized);
    });
}
