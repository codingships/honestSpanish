type GoogleErrorLike = {
    code?: unknown;
    name?: unknown;
    response?: { status?: unknown };
    status?: unknown;
};

/**
 * Return operational error metadata without forwarding provider messages.
 * Google/Gaxios messages can contain emails, file IDs, event IDs or URLs.
 */
export function describeGoogleError(error: unknown): string {
    const candidate = typeof error === 'object' && error !== null
        ? error as GoogleErrorLike
        : null;
    const rawName = error instanceof Error ? error.name : candidate?.name;
    const name = typeof rawName === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName)
        ? rawName
        : 'GoogleError';
    const rawStatus = candidate?.response?.status ?? candidate?.status ?? candidate?.code;
    const status = typeof rawStatus === 'number' || (typeof rawStatus === 'string' && /^\d{3}$/.test(rawStatus))
        ? String(rawStatus)
        : null;

    return status ? `${name} (status ${status})` : name;
}
