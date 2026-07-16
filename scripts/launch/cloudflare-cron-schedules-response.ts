export type CloudflareCronSchedule = Readonly<Record<string, unknown>>;

export type CloudflareCronSchedulesResponse = Readonly<{
    schedules: CloudflareCronSchedule[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCloudflareCronSchedulesResponse(value: unknown): CloudflareCronSchedulesResponse | null {
    if (!isRecord(value) || value.success !== true) return null;

    const { result } = value;
    const schedules = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.schedules)
            ? result.schedules
            : null;

    if (!schedules || !schedules.every(isRecord)) return null;
    return { schedules };
}
