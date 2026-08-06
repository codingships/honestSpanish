import type { Breadcrumb, Event } from '@sentry/astro';

const SENSITIVE_KEY = /(?:auth|cookie|email|ip|name|password|phone|secret|token|user)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const PROVIDER_SECRET = /\b(?:sk_(?:live|test)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g;
const KEYED_SECRET = /\b(password|secret|token)=([^&\s]+)/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
/** Require a phone-like separator so pure timestamps and request ids survive. */
const PHONE = /(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s().-]+)+\d{2,4}(?:[\s().-]*\d{2,4})+/g;
const QUERY_VALUE = /([?&][^=\s]+)=([^&#\s]+)/g;
const MAX_COLLECTION_ITEMS = 30;
const MAX_DEPTH = 6;
const SAFE_TAG_VALUE = /^[A-Za-z0-9_.:-]{1,120}$/u;

function sanitizeString(value: string): string {
    return value
        .replace(EMAIL, '[redacted-email]')
        .replace(BEARER, 'Bearer [redacted]')
        .replace(PROVIDER_SECRET, '[redacted-secret]')
        .replace(KEYED_SECRET, '$1=[redacted]')
        .replace(IPV4, '[redacted-ip]')
        .replace(PHONE, '[redacted-phone]')
        .replace(QUERY_VALUE, '$1=[redacted]');
}

function sanitizeUnknown(value: unknown, depth = 0): unknown {
    if (depth > MAX_DEPTH) return '[truncated]';
    if (typeof value === 'string') return sanitizeString(value);
    if (typeof value !== 'object' || value === null) return value;
    if (Array.isArray(value)) {
        return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => sanitizeUnknown(item, depth + 1));
    }

    return Object.fromEntries(
        Object.entries(value)
            .slice(0, MAX_COLLECTION_ITEMS)
            .map(([key, child]) => [
                key,
                SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeUnknown(child, depth + 1),
            ]),
    );
}

function pathnameOnly(value: string | undefined): string | undefined {
    if (!value) return value;
    try {
        return new URL(value, 'https://redacted.invalid').pathname;
    } catch {
        return sanitizeString(value.split(/[?#]/u, 1)[0] ?? '');
    }
}

/**
 * Minimizes error events before they leave the runtime. Diagnostics retain
 * route, stack and stable codes; identity, request payloads and URL parameters
 * are deliberately removed.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
    const preservedTags = event.tags
        ? Object.fromEntries(
            Object.entries(event.tags).flatMap(([key, value]) => {
                if (
                    typeof value === 'string'
                    && SAFE_TAG_VALUE.test(value)
                    && !SENSITIVE_KEY.test(key)
                ) {
                    return [[key, value] as const];
                }
                return [];
            }),
        )
        : undefined;

    const scrubbed = sanitizeUnknown(event) as T;

    delete scrubbed.user;
    if (scrubbed.request) {
        scrubbed.request.url = pathnameOnly(scrubbed.request.url);
        delete scrubbed.request.cookies;
        delete scrubbed.request.data;
        delete scrubbed.request.env;
        delete scrubbed.request.headers;
        delete scrubbed.request.query_string;
    }
    if (scrubbed.transaction) scrubbed.transaction = pathnameOnly(scrubbed.transaction);
    if (preservedTags && Object.keys(preservedTags).length > 0) {
        scrubbed.tags = {
            ...(typeof scrubbed.tags === 'object' && scrubbed.tags ? scrubbed.tags : {}),
            ...preservedTags,
        };
    }

    return scrubbed;
}

/** Console breadcrumbs are both noisy and the easiest route for accidental
 * PII leakage. Other breadcrumbs keep only scrubbed text/data and pathnames. */
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
    if (breadcrumb.category?.startsWith('console')) return null;

    const scrubbed = sanitizeUnknown(breadcrumb) as Breadcrumb;
    if (scrubbed.data && typeof scrubbed.data.url === 'string') {
        scrubbed.data.url = pathnameOnly(scrubbed.data.url);
    }
    return scrubbed;
}
