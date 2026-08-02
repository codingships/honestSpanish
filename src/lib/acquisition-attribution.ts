export type AcquisitionLanguage = 'es' | 'en' | 'ru';
export type AcquisitionReferrerKind = 'direct' | 'internal' | 'external';

export interface AcquisitionAttribution {
    requestId: string;
    landingPath: string;
    referrerKind: AcquisitionReferrerKind;
    referrerHost?: string;
    referrerPath?: string;
    entryLanguage: AcquisitionLanguage;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
}

type CaptureOptions = {
    href?: string;
    referrer?: string;
    requestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UTM_PATTERN = /^[A-Za-z0-9._~-]+$/u;
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const MAX_PATH_LENGTH = 200;
const PRIVATE_INTERNAL_PATH = /^\/(?:api(?:\/|$)|(?:es|en|ru)\/(?:campus|login|adult-confirmation|reset-password)(?:\/|$))/iu;
const HEX_TOKEN_SEGMENT = /^[a-f0-9]{32,}$/iu;
const OPAQUE_TOKEN_SEGMENT = /^(?=.{32,}$)(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9_.~-]+$/u;

const UTM_FIELDS = [
    ['utm_source', 'utmSource', 100],
    ['utm_medium', 'utmMedium', 100],
    ['utm_campaign', 'utmCampaign', 100],
    ['utm_term', 'utmTerm', 100],
    ['utm_content', 'utmContent', 100],
] as const;

const RETURN_FIELDS = [
    ['attrRequestId', 'requestId'],
    ['attrLandingPath', 'landingPath'],
    ['attrReferrerKind', 'referrerKind'],
    ['attrReferrerHost', 'referrerHost'],
    ['attrReferrerPath', 'referrerPath'],
    ['attrEntryLanguage', 'entryLanguage'],
    ['attrUtmSource', 'utmSource'],
    ['attrUtmMedium', 'utmMedium'],
    ['attrUtmCampaign', 'utmCampaign'],
    ['attrUtmTerm', 'utmTerm'],
    ['attrUtmContent', 'utmContent'],
] as const satisfies ReadonlyArray<readonly [string, keyof AcquisitionAttribution]>;

export const ACQUISITION_RETURN_QUERY_KEYS = RETURN_FIELDS.map(([queryKey]) => queryKey);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
    return Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    });
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.normalize('NFKC');
    return normalized && !hasControlCharacter(normalized) ? normalized : null;
}

function containsPersonalOrUrlShape(value: string): boolean {
    return value.includes('@') || /(?:https?:\/\/|www\.)/iu.test(value);
}

type SanitizedPath = { canonical: string; decoded: string };

function sanitizePathSyntax(value: unknown): SanitizedPath | null {
    const normalized = normalizeString(value);
    if (
        !normalized
        || normalized.length > MAX_PATH_LENGTH
        || !normalized.startsWith('/')
        || normalized.startsWith('//')
        || normalized.includes('\\')
        || normalized.includes('?')
        || normalized.includes('#')
    ) return null;

    let decoded = normalized;
    try {
        decoded = decodeURIComponent(normalized).normalize('NFKC');
    } catch {
        return null;
    }
    if (
        hasControlCharacter(decoded)
        || decoded.includes('\\')
        || decoded.includes('?')
        || decoded.includes('#')
        || decoded.startsWith('//')
        || containsPersonalOrUrlShape(decoded)
    ) return null;
    return { canonical: normalized, decoded };
}

function hasOpaquePathSegment(decodedPath: string): boolean {
    return decodedPath.split('/').some((segment) => (
        UUID_PATTERN.test(segment)
        || HEX_TOKEN_SEGMENT.test(segment)
        || OPAQUE_TOKEN_SEGMENT.test(segment)
    ));
}

function isPrivateOrDynamicPath(decodedPath: string): boolean {
    return PRIVATE_INTERNAL_PATH.test(decodedPath) || hasOpaquePathSegment(decodedPath);
}

function sanitizePath(value: unknown): string | null {
    const path = sanitizePathSyntax(value);
    if (!path || isPrivateOrDynamicPath(path.decoded)) return null;
    return path.canonical;
}

function sanitizeInternalReferrerPath(value: unknown): string | null {
    const path = sanitizePathSyntax(value);
    if (!path) return null;
    return isPrivateOrDynamicPath(path.decoded) ? '/internal' : path.canonical;
}

function sanitizeUtm(value: unknown, maxLength: number): string | null {
    const normalized = normalizeString(value);
    if (
        !normalized
        || normalized.length > maxLength
        || containsPersonalOrUrlShape(normalized)
        || !UTM_PATTERN.test(normalized)
    ) return null;
    return normalized;
}

function sanitizeHost(value: unknown): string | null {
    const normalized = normalizeString(value)?.toLowerCase();
    if (!normalized || !HOST_PATTERN.test(normalized)) return null;
    return normalized;
}

function optionalValue(record: Record<string, unknown>, key: string): unknown {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function sanitizeAcquisitionAttribution(value: unknown): AcquisitionAttribution | null {
    if (!isRecord(value)) return null;

    const allowedFields = new Set(RETURN_FIELDS.map(([, field]) => field));
    if (Object.keys(value).some((key) => !allowedFields.has(key as keyof AcquisitionAttribution))) return null;

    const requestId = normalizeString(value.requestId);
    const landingPath = sanitizePath(value.landingPath);
    const referrerKind = normalizeString(value.referrerKind);
    const entryLanguage = normalizeString(value.entryLanguage);
    if (
        !requestId
        || !UUID_PATTERN.test(requestId)
        || !landingPath
        || !['direct', 'internal', 'external'].includes(referrerKind ?? '')
        || !['es', 'en', 'ru'].includes(entryLanguage ?? '')
    ) return null;

    const referrerHostRaw = optionalValue(value, 'referrerHost');
    const referrerPathRaw = optionalValue(value, 'referrerPath');
    const referrerHost = referrerHostRaw === undefined ? undefined : sanitizeHost(referrerHostRaw);
    const referrerPath = referrerPathRaw === undefined ? undefined : sanitizeInternalReferrerPath(referrerPathRaw);
    if (
        (referrerHostRaw !== undefined && !referrerHost)
        || (referrerPathRaw !== undefined && !referrerPath)
        || (referrerKind === 'direct' && (referrerHost || referrerPath))
        || (referrerKind === 'internal' && (!referrerPath || referrerHost))
        || (referrerKind === 'external' && (!referrerHost || referrerPath))
    ) return null;

    const result: AcquisitionAttribution = {
        requestId,
        landingPath,
        referrerKind: referrerKind as AcquisitionReferrerKind,
        entryLanguage: entryLanguage as AcquisitionLanguage,
        ...(referrerHost ? { referrerHost } : {}),
        ...(referrerPath ? { referrerPath } : {}),
    };

    for (const [, field, maxLength] of UTM_FIELDS) {
        const raw = optionalValue(value, field);
        if (raw === undefined) continue;
        const sanitized = sanitizeUtm(raw, maxLength);
        if (!sanitized) return null;
        result[field] = sanitized;
    }

    return result;
}

function hasDuplicate(params: URLSearchParams, key: string): boolean {
    return params.getAll(key).length > 1;
}

export function readAcquisitionAttributionFromSearchParams(params: URLSearchParams): AcquisitionAttribution | null {
    const hasAny = ACQUISITION_RETURN_QUERY_KEYS.some((key) => params.has(key));
    if (!hasAny || ACQUISITION_RETURN_QUERY_KEYS.some((key) => hasDuplicate(params, key))) return null;

    const candidate: Record<string, string> = {};
    for (const [queryKey, field] of RETURN_FIELDS) {
        const value = params.get(queryKey);
        if (value !== null) candidate[field] = value;
    }
    return sanitizeAcquisitionAttribution(candidate);
}

export function appendAcquisitionAttribution(
    params: URLSearchParams,
    value: AcquisitionAttribution,
): boolean {
    const attribution = sanitizeAcquisitionAttribution(value);
    if (!attribution) return false;

    for (const [queryKey, field] of RETURN_FIELDS) {
        const fieldValue = attribution[field];
        if (fieldValue !== undefined) params.set(queryKey, fieldValue);
    }
    return true;
}

export function hasExternalAcquisitionEvidence(value: unknown): boolean {
    const attribution = sanitizeAcquisitionAttribution(value);
    if (!attribution) return false;

    return attribution.referrerKind === 'external'
        || UTM_FIELDS.some(([, field]) => Boolean(attribution[field]));
}

export function buildAcquisitionContinuityUrl(
    targetHref: string,
    currentHref: string,
    value: unknown,
): string | null {
    const attribution = sanitizeAcquisitionAttribution(value);
    if (!attribution || !hasExternalAcquisitionEvidence(attribution)) return null;

    let current: URL;
    let target: URL;
    try {
        current = new URL(currentHref);
        target = new URL(targetHref, current);
    } catch {
        return null;
    }

    if (
        !['http:', 'https:'].includes(current.protocol)
        || !['http:', 'https:'].includes(target.protocol)
        || target.origin !== current.origin
    ) return null;

    return appendAcquisitionAttribution(target.searchParams, attribution)
        ? target.toString()
        : null;
}

function createBrowserRequestId(): string {
    if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('crypto.randomUUID unavailable');
    return globalThis.crypto.randomUUID();
}

export function captureAcquisitionAttribution(
    entryLanguage: AcquisitionLanguage,
    options: CaptureOptions = {},
): AcquisitionAttribution | null {
    let page: URL;
    try {
        const href = options.href ?? window.location.href;
        page = new URL(href);
    } catch {
        return null;
    }

    if (!['http:', 'https:'].includes(page.protocol)) return null;

    const hasPropagatedFields = ACQUISITION_RETURN_QUERY_KEYS.some((key) => page.searchParams.has(key));
    const propagated = readAcquisitionAttributionFromSearchParams(page.searchParams);
    if (hasPropagatedFields && !propagated) return null;

    let requestId: string;
    try {
        requestId = (options.requestId ?? createBrowserRequestId)();
    } catch {
        return null;
    }

    if (propagated) {
        return sanitizeAcquisitionAttribution({ ...propagated, requestId });
    }

    const landingPath = sanitizePath(page.pathname);
    if (!landingPath) return null;

    const candidate: Record<string, unknown> = {
        requestId,
        landingPath,
        referrerKind: 'direct',
        entryLanguage,
    };

    const referrer = options.referrer ?? (typeof document === 'undefined' ? '' : document.referrer);
    if (referrer) {
        let parsedReferrer: URL;
        try {
            parsedReferrer = new URL(referrer);
        } catch {
            return null;
        }
        if (!['http:', 'https:'].includes(parsedReferrer.protocol)) return null;
        if (parsedReferrer.origin === page.origin) {
            const referrerPath = sanitizeInternalReferrerPath(parsedReferrer.pathname);
            if (!referrerPath) return null;
            candidate.referrerKind = 'internal';
            candidate.referrerPath = referrerPath;
        } else {
            candidate.referrerKind = 'external';
            candidate.referrerHost = parsedReferrer.hostname;
        }
    }

    for (const [queryKey, field, maxLength] of UTM_FIELDS) {
        const values = page.searchParams.getAll(queryKey);
        if (values.length > 1) return null;
        if (values.length === 0) continue;
        const sanitized = sanitizeUtm(values[0], maxLength);
        if (!sanitized) return null;
        candidate[field] = sanitized;
    }

    return sanitizeAcquisitionAttribution(candidate);
}
