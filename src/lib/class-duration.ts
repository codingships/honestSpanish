export const DEFAULT_CLASS_DURATION_MINUTES = 55;

export function normalizeClassDurationMinutes(value: unknown): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : DEFAULT_CLASS_DURATION_MINUTES;

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_CLASS_DURATION_MINUTES;
    }

    return Math.min(Math.max(Math.round(parsed), 15), 180);
}
