import {
    ACQUISITION_RETURN_QUERY_KEYS,
    appendAcquisitionAttribution,
    readAcquisitionAttributionFromSearchParams,
} from './acquisition-attribution';

const AUTH_RETURN_TO_ORIGIN = 'https://auth-return.local';
const MAX_AUTH_RETURN_TO_LENGTH = 1_024;
const LOCALIZED_LANDING_PATH = /^\/(es|en|ru)\/?$/u;
const LOCALIZED_CAMPUS_PATH = /^\/(es|en|ru)\/campus(?:\/|$)/u;
const SLOT_PUBLIC_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type AuthReturnRole = 'student' | 'teacher' | 'admin';

/**
 * Authentication accepts only the public checkout continuation and localized
 * campus routes. Keeping this narrower than "any local URL" prevents auth from
 * becoming a general redirector. The final campus destination is filtered by
 * role with resolveAuthReturnToForRole before redirecting.
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

    const rawPath = value.split(/[?#]/u, 1)[0] ?? '';
    const commonDestinationIsSafe = parsed.origin === AUTH_RETURN_TO_ORIGIN
        && !parsed.username
        && !parsed.password
        && !parsed.pathname.includes('//')
        && !/%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)
        && !/%(?:2f|5c)/iu.test(rawPath);
    if (!commonDestinationIsSafe) return null;

    if (LOCALIZED_CAMPUS_PATH.test(parsed.pathname)) {
        return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
        !pathMatch
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

/**
 * Prevents a safe local return path from overriding the authenticated role.
 * Shared account/support pages remain reachable by every campus role; all
 * other destinations must belong to the actor's own campus area.
 */
export function resolveAuthReturnToForRole(
    value: unknown,
    role: string,
    lang: string,
): string | null {
    const returnTo = sanitizeAuthReturnTo(value);
    if (!returnTo || !['es', 'en', 'ru'].includes(lang)) return null;

    const parsed = new URL(returnTo, AUTH_RETURN_TO_ORIGIN);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] !== lang) return null;

    if (segments.length === 1) {
        return role === 'student' ? returnTo : null;
    }
    if (segments[1] !== 'campus') return null;

    const area = segments[2];
    const shared = area === 'account' || area === 'support';
    if (role === 'admin') return area === 'admin' || shared ? returnTo : null;
    if (role === 'teacher') return area === 'teacher' || shared ? returnTo : null;
    if (role === 'student') {
        return area !== 'admin' && area !== 'teacher' ? returnTo : null;
    }
    return null;
}

export function appendAuthReturnTo(location: string, returnTo: string | null): string {
    if (!returnTo) return location;
    return `${location}${location.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
}
