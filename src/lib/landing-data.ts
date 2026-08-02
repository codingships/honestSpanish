import { INITIAL_INDIVIDUAL_OFFER } from './package-pricing';

export interface LandingPackage {
    name: string;
    price_monthly: number;
    sessions_per_month: number;
}

export const PUBLIC_OFFER_KEY = INITIAL_INDIVIDUAL_OFFER.packageKey;

// The public shell describes the product contract, not live inventory. Capacity,
// lifecycle state and Stripe identifiers remain authoritative in the dynamic
// availability and checkout endpoints and never participate in page rendering.
const PUBLIC_TARGET_PACKAGE: Readonly<LandingPackage> = Object.freeze({
    name: PUBLIC_OFFER_KEY,
    price_monthly: INITIAL_INDIVIDUAL_OFFER.amountCents,
    sessions_per_month: INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod,
});

export function getStaticLandingPackages(): LandingPackage[] {
    return [{ ...PUBLIC_TARGET_PACKAGE }];
}
