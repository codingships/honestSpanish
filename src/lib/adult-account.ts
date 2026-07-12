import { LEGAL_POLICY_VERSION } from './legal-policy';

export type AdultAccountAttestation = {
    adult_confirmed?: boolean | null;
    adult_confirmed_at?: string | null;
    age_policy_version?: string | null;
};

export const ADULT_ATTESTATION_REQUIRED_QUERY = 'adult-attestation-required';

export function hasVerifiedAdultAccount(
    profile: AdultAccountAttestation | null | undefined,
): boolean {
    return profile?.adult_confirmed === true
        && typeof profile.adult_confirmed_at === 'string'
        && profile.adult_confirmed_at.trim().length > 0
        && profile.age_policy_version === LEGAL_POLICY_VERSION;
}
