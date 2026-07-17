export const CSP_HEADER_BASELINE_DIRECTIVES = [
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    'upgrade-insecure-requests',
] as const;

export const CSP_HEADER_BASELINE = CSP_HEADER_BASELINE_DIRECTIVES.join('; ');

export const HOSTED_SECURITY_HEADERS = {
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
} as const;

export const HSTS_HEADER = 'max-age=31536000';
export const API_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';
export const PRIVATE_PAGE_CACHE_CONTROL = 'private, no-store';
export const ADMIN_EMAIL_PREVIEW_FRAME_PATH = '/api/email/preview-frame';
export const ADMIN_EMAIL_PREVIEW_CACHE_CONTROL = 'private, no-store, no-cache, must-revalidate';

export const ADMIN_EMAIL_PREVIEW_CSP_DIRECTIVES = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "media-src 'none'",
    "manifest-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    'sandbox',
] as const;
export const ADMIN_EMAIL_PREVIEW_CSP = ADMIN_EMAIL_PREVIEW_CSP_DIRECTIVES.join('; ');

const SENSITIVE_LOCALIZED_ROUTE = /^\/(?:es|en|ru)\/(?:campus(?:\/|$)|login\/?$|logout\/?$|reset-password\/?$|adult-confirmation\/?$|success\/?$|cancel\/?$|diagnostico\/?$|demo\/?$)/u;
const SESSION_AWARE_LANDING_ROUTE = /^\/(?:es|en|ru)\/?$/u;
const SESSION_AWARE_SEGMENT_ROUTE = /^\/es\/(?:clases-de-conversacion-en-espanol|espanol-para-vivir-en-espana|espanol-para-profesionales)\/?$/u;

export function normalizeRoutePathname(pathname: string): string {
    let decodedPathname = pathname;
    try {
        // Astro route matching decodes once with decodeURI. Mirroring it here
        // prevents encoded ASCII segments such as %63ampus from bypassing
        // authentication and cache controls in middleware.
        decodedPathname = decodeURI(pathname);
    } catch {
        // Astro also falls back to the raw pathname for malformed sequences.
        decodedPathname = pathname;
    }

    // Middleware classifies path segments after removing empty entries. Use
    // the same effective pathname for cache controls, including repeated or
    // leading slashes, without changing the URL that Astro ultimately routes.
    return decodedPathname.replace(/\/{2,}/gu, '/');
}

function directiveName(directive: string): string {
    return (directive.trim().split(/\s+/u, 1)[0] ?? '').toLowerCase();
}

export function mergeCspHeader(
    existing: string | null,
    requiredDirectives: readonly string[] = CSP_HEADER_BASELINE_DIRECTIVES,
): string {
    const baselineNames = new Set(requiredDirectives.map(directiveName));
    const existingDirectives = (existing ?? '')
        .split(';')
        .map((directive) => directive.trim())
        .filter(Boolean)
        .filter((directive) => !baselineNames.has(directiveName(directive)));
    return [...existingDirectives, ...requiredDirectives].join('; ');
}

function cacheControlForNormalizedPath(normalizedPathname: string): string | null {
    if (normalizedPathname === ADMIN_EMAIL_PREVIEW_FRAME_PATH) return ADMIN_EMAIL_PREVIEW_CACHE_CONTROL;
    if (/^\/api(?:\/|$)/u.test(normalizedPathname)) return API_CACHE_CONTROL;
    if (normalizedPathname === '/demo' || normalizedPathname === '/demo/') return PRIVATE_PAGE_CACHE_CONTROL;
    if (SESSION_AWARE_LANDING_ROUTE.test(normalizedPathname)) return PRIVATE_PAGE_CACHE_CONTROL;
    if (SESSION_AWARE_SEGMENT_ROUTE.test(normalizedPathname)) return PRIVATE_PAGE_CACHE_CONTROL;
    if (SENSITIVE_LOCALIZED_ROUTE.test(normalizedPathname)) return PRIVATE_PAGE_CACHE_CONTROL;
    return null;
}

export function cacheControlForPath(pathname: string): string | null {
    return cacheControlForNormalizedPath(normalizeRoutePathname(pathname));
}

export function applyHostedSecurityHeaders(
    response: Response,
    options: { pathname: string; secureTransport: boolean },
): void {
    for (const [name, value] of Object.entries(HOSTED_SECURITY_HEADERS)) {
        response.headers.set(name, value);
    }

    const normalizedPathname = normalizeRoutePathname(options.pathname);
    const isAdminEmailPreview = normalizedPathname === ADMIN_EMAIL_PREVIEW_FRAME_PATH;
    response.headers.set(
        'Content-Security-Policy',
        isAdminEmailPreview
            // This response contains generated email HTML. Replace the whole
            // application policy so no permissive fetch directive can survive.
            ? ADMIN_EMAIL_PREVIEW_CSP
            : mergeCspHeader(response.headers.get('Content-Security-Policy')),
    );

    if (isAdminEmailPreview) {
        response.headers.set('X-Frame-Options', 'SAMEORIGIN');
        response.headers.set('Referrer-Policy', 'no-referrer');
    }

    if (options.secureTransport) {
        response.headers.set('Strict-Transport-Security', HSTS_HEADER);
    }

    const cacheControl = cacheControlForNormalizedPath(normalizedPathname);
    if (cacheControl) response.headers.set('Cache-Control', cacheControl);
}
