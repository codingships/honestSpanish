const AUTH_RETURN_TO_ORIGIN = 'https://auth-return.local';
const MAX_AUTH_RETURN_TO_LENGTH = 512;
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
    if (
        parsed.origin !== AUTH_RETURN_TO_ORIGIN
        || parsed.username
        || parsed.password
        || !pathMatch
        || parsed.hash !== '#planes'
        || queryKeys.length !== 1
        || queryKeys[0] !== 'checkoutSlot'
        || slotValues.length !== 1
        || !SLOT_PUBLIC_ID.test(slotValues[0] ?? '')
    ) return null;

    return `/${pathMatch[1]}?checkoutSlot=${encodeURIComponent(slotValues[0]!)}#planes`;
}

export function appendAuthReturnTo(location: string, returnTo: string | null): string {
    if (!returnTo) return location;
    return `${location}${location.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(returnTo)}`;
}
