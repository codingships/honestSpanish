const ALLOWED_MEETING_HOSTS = new Set([
    'meet.google.com',
]);

export function normalizeManualMeetingLink(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
    if (value === undefined || value === null || value === '') {
        return { ok: true, value: null };
    }

    if (typeof value !== 'string') {
        return { ok: false, error: 'meetLink must be a valid HTTPS Google Meet URL' };
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return { ok: true, value: null };
    }

    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { ok: false, error: 'meetLink must be a valid HTTPS Google Meet URL' };
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !ALLOWED_MEETING_HOSTS.has(parsed.hostname.toLowerCase())) {
        return { ok: false, error: 'meetLink must be a valid HTTPS Google Meet URL' };
    }

    return { ok: true, value: parsed.toString() };
}
