import { normalizeClassDurationMinutes } from './class-duration';

export const CLASS_JOIN_BEFORE_START_MINUTES = 15;
export const CLASS_JOIN_AFTER_END_BUFFER_MINUTES = 120;

export function isClassJoinWindowOpen(
    scheduledAt: string,
    durationMinutes: unknown,
    now: Date = new Date()
): boolean {
    const scheduledTime = new Date(scheduledAt).getTime();
    if (Number.isNaN(scheduledTime)) return false;

    const duration = normalizeClassDurationMinutes(durationMinutes);
    const elapsedMinutes = (now.getTime() - scheduledTime) / (1000 * 60);

    return elapsedMinutes >= -CLASS_JOIN_BEFORE_START_MINUTES
        && elapsedMinutes <= duration + CLASS_JOIN_AFTER_END_BUFFER_MINUTES;
}
