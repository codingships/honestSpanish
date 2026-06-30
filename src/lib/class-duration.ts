export const CLASS_DURATION_OPTIONS_MINUTES = [30, 40, 50] as const;
export const DEFAULT_CLASS_DURATION_MINUTES = 50;

export function normalizeClassDurationMinutes(value: unknown): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : DEFAULT_CLASS_DURATION_MINUTES;

    if (!Number.isFinite(parsed)) {
        return DEFAULT_CLASS_DURATION_MINUTES;
    }

    const rounded = Math.round(parsed);
    return CLASS_DURATION_OPTIONS_MINUTES.includes(rounded as typeof CLASS_DURATION_OPTIONS_MINUTES[number])
        ? rounded
        : DEFAULT_CLASS_DURATION_MINUTES;
}
