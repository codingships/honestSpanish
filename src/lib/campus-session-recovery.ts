import {
    appendAuthReturnTo,
    resolveAuthReturnToForRole,
    type AuthReturnRole,
} from './auth-return-to';

type FetchTarget = string | URL | { url: string };

function targetValue(target: FetchTarget): string | null {
    if (typeof target === 'string') return target;
    if (target instanceof URL) return target.href;
    return typeof target.url === 'string' ? target.url : null;
}

export function isCampusSessionFailure(
    target: FetchTarget,
    responseStatus: number,
    currentUrl: string,
    authApiOrigin?: string,
): boolean {
    if (responseStatus !== 401) return false;

    try {
        const current = new URL(currentUrl);
        const value = targetValue(target);
        if (!value) return false;
        const request = new URL(value, current);
        const applicationApi = request.origin === current.origin
            && (request.pathname === '/api' || request.pathname.startsWith('/api/'));
        const authProviderApi = Boolean(authApiOrigin)
            && request.origin === authApiOrigin
            && request.pathname.startsWith('/auth/v1/');
        return applicationApi || authProviderApi;
    } catch {
        return false;
    }
}

export function buildCampusSessionLoginUrl(
    lang: 'es' | 'en' | 'ru',
    role: AuthReturnRole,
    currentUrl: string,
): string {
    let requestedReturn: string | null = null;
    try {
        const current = new URL(currentUrl);
        requestedReturn = `${current.pathname}${current.search}${current.hash}`;
    } catch {
        // A malformed browser location must fall back to the localized login.
    }

    return appendAuthReturnTo(
        `/${lang}/login`,
        resolveAuthReturnToForRole(requestedReturn, role, lang),
    );
}
