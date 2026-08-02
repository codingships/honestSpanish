import { describe, expect, it } from 'vitest';
import { INITIAL_INDIVIDUAL_OFFER } from '../../src/lib/package-pricing';
import { getStaticLandingPackages } from '../../src/lib/landing-data';

describe('static public offer projection', () => {
    it('derives the visible offer from the executable launch contract', () => {
        expect(getStaticLandingPackages()).toEqual([{
            name: INITIAL_INDIVIDUAL_OFFER.packageKey,
            price_monthly: INITIAL_INDIVIDUAL_OFFER.amountCents,
            sessions_per_month: INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod,
        }]);
    });

    it('does not expose database or Stripe identity in the presentation model', () => {
        const [offer] = getStaticLandingPackages();
        expect(offer).not.toHaveProperty('id');
        expect(Object.keys(offer ?? {})).not.toContain('stripe_price_1m');
    });

    it('returns an isolated offer object for each prerender', () => {
        const first = getStaticLandingPackages();
        first[0]!.price_monthly = 1;
        expect(getStaticLandingPackages()[0]!.price_monthly).toBe(INITIAL_INDIVIDUAL_OFFER.amountCents);
    });
});
