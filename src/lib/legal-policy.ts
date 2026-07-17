export const LEGAL_POLICY_VERSION = '2026-07-10';
export const MINIMUM_CUSTOMER_AGE = 18;

export function hasAcceptedAdultPolicy(value: unknown): value is true {
    return value === true;
}

export function hasAcceptedCheckoutPolicies(input: {
    adultConfirmed?: unknown;
    termsAccepted?: unknown;
    serviceStartRequested?: unknown;
    withdrawalLossAcknowledged?: unknown;
}): boolean {
    return input.adultConfirmed === true
        && input.termsAccepted === true
        && input.serviceStartRequested === true
        && input.withdrawalLossAcknowledged === true;
}
