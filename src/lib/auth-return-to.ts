import {
    ACQUISITION_RETURN_QUERY_KEYS,
    appendAcquisitionAttribution,
    readAcquisitionAttributionFromSearchParams,
} from './acquisition-attribution';

const AUTH_RETURN_TO_ORIGIN = 'https://auth-return.local';
const MAX_AUTH_RETURN_TO_LENGTH = 1_024;
const LOCALIZED_LANDING_PATH = /^\/(es|en|ru)\/?$/u;
const SLOT_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * The checkout login flow has exactly one return contract. Keeping this
 * allowlist narrower than "any local URL" prevents auth from becoming a
 * general redirector and makes every later navigation independently auditable.
 */
export function sanitizeAuthReturnTo(value: unknown): string | null {
    if (
        typeof value !== 'string'
        || value.length === 0
        || value.length > MAX_AUTH_RETURN_TO_LENGTH
        || !value.startsWith('/')
        || value.startsWith('//')
        || value.includes('\\')
        || Array.from(value).some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 31 || codePoint === 127;
        })
    ) return null;

    let parsed: URL;
    try {
        parsed = new URL(value, AUTH_RETURN_TO_ORIGIN);
    } catch {
        return null;
    }

    const pathMatch = LOCALIZED_LANDING_PATH.exec(parsed.pathname);
    const slotValues = parsed.searchParams.getAll('checkoutSlot');
    const queryKeys = [...parsed.searchParams.keys()];
    const allowedKeys = new Set(['checkoutSlot', ...ACQUISITION_RETURN_QUERY_KEYS]);
    const hasAttribution = ACQUISITION_RETURN_QUERY_KEYS.some((key) => parsed.searchParams.has(key));
    const attribution = hasAttribution
        ? readAcquisitionAttributionFromSearchParams(parsed.searchParams)
        : null;
    if (
        parsed.origin !== AUTH_RETURN_TO_ORIGIN
        || parsed.username
        || parsed.password
        || !pathMatch
        || parsed.hash !== '#planes'
        || queryKeys.some((key) => !allowedKeys.has(key))
        || queryKeys.some((key) => parsed.searchParams.getAll(key).length !== 1)
        || slotValues.length !== 1
        || !SLOT_PUBLIC_ID.test(slotValues[0] ?? '')
        || (hasAttribution && !attribution)
    ) return null;

    const canonicalParams = new URLSearchParams({ checkoutSlot: slotValues[0]! });
    if (attribution) appendAcquisitionAttribution(canonicalParams, attribution);
    return `/${pathMatch[1]}?${canonicalParams.toString()}#planes`;
}

export function appendAuthReturnTo(location: string, returnTo: string | null): string {
    if (!returnTo) return location;
    return `${location}${location.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
}
