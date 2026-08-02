import type { PublicBookableSlot } from './public-bookable-slots';
import {
    appendAcquisitionAttribution,
    type AcquisitionAttribution,
} from './acquisition-attribution';

export type CheckoutLanguage = 'es' | 'en' | 'ru';

const maxAuthReturnToLength = 1_024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const localTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const renewalPeriodMs = 28 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
        return true;
    } catch {
        return false;
    }
}

interface LocalDateTimeContract {
    calendarDayMs: number;
    weekday: number;
    localTime: string;
}

function getLocalDateTimeContract(timestampMs: number, timeZone: string): LocalDateTimeContract | null {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date(timestampMs));

    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = Number(values.get('year'));
    const month = Number(values.get('month'));
    const day = Number(values.get('day'));
    const hour = values.get('hour');
    const minute = values.get('minute');
    const second = values.get('second');
    if (
        !Number.isInteger(year)
        || !Number.isInteger(month)
        || !Number.isInteger(day)
        || !hour
        || !minute
        || !second
    ) return null;

    const calendarDayMs = Date.UTC(year, month - 1, day);
    return {
        calendarDayMs,
        weekday: new Date(calendarDayMs).getUTCDay(),
        localTime: `${hour}:${minute}:${second}`,
    };
}

function parsePublicBookableSlot(value: unknown, nowMs: number): PublicBookableSlot | null {
    if (!isRecord(value)) return null;
    if (typeof value.publicId !== 'string' || !uuidPattern.test(value.publicId)) return null;
    if (typeof value.teacherName !== 'string' || !value.teacherName.trim() || value.teacherName.length > 120) return null;
    if (!Number.isInteger(value.weekday) || Number(value.weekday) < 0 || Number(value.weekday) > 6) return null;
    if (typeof value.localStartTime !== 'string' || !localTimePattern.test(value.localStartTime)) return null;
    if (typeof value.timezoneName !== 'string' || !isValidTimeZone(value.timezoneName)) return null;
    if (typeof value.firstClassAt !== 'string' || typeof value.renewalAt !== 'string') return null;
    if (!Array.isArray(value.occurrences) || value.occurrences.length !== 4) return null;

    const firstClassMs = Date.parse(value.firstClassAt);
    const renewalMs = Date.parse(value.renewalAt);
    if (!Number.isFinite(firstClassMs) || firstClassMs <= nowMs) return null;
    if (!Number.isFinite(renewalMs) || renewalMs !== firstClassMs + renewalPeriodMs) return null;

    const occurrences = value.occurrences.map((occurrence, arrayIndex) => {
        if (!isRecord(occurrence)) return null;
        if (occurrence.index !== arrayIndex + 1 || occurrence.durationMinutes !== 50) return null;
        if (typeof occurrence.startsAt !== 'string' || !Number.isFinite(Date.parse(occurrence.startsAt))) return null;
        return {
            index: occurrence.index,
            startsAt: occurrence.startsAt,
            durationMinutes: occurrence.durationMinutes,
        };
    });
    if (occurrences.some((occurrence) => occurrence === null)) return null;
    const parsedOccurrences = occurrences as PublicBookableSlot['occurrences'];
    const occurrenceTimes = parsedOccurrences.map((occurrence) => Date.parse(occurrence.startsAt));
    if (occurrenceTimes[0] !== firstClassMs) return null;
    if (occurrenceTimes.some((occurrenceMs) => occurrenceMs <= nowMs)) return null;
    if (new Set(occurrenceTimes).size !== occurrenceTimes.length) return null;

    let previousLocalDayMs: number | null = null;
    for (let index = 0; index < occurrenceTimes.length; index += 1) {
        const occurrenceMs = occurrenceTimes[index]!;
        if (index > 0 && occurrenceMs <= occurrenceTimes[index - 1]!) return null;

        const local = getLocalDateTimeContract(occurrenceMs, value.timezoneName);
        if (!local || local.weekday !== Number(value.weekday) || local.localTime !== value.localStartTime) return null;
        if (previousLocalDayMs !== null && local.calendarDayMs - previousLocalDayMs !== 7 * 24 * 60 * 60 * 1000) return null;
        previousLocalDayMs = local.calendarDayMs;
    }

    return {
        publicId: value.publicId,
        teacherName: value.teacherName.trim(),
        weekday: Number(value.weekday),
        localStartTime: value.localStartTime,
        timezoneName: value.timezoneName,
        firstClassAt: value.firstClassAt,
        renewalAt: value.renewalAt,
        occurrences: parsedOccurrences,
    };
}

export interface PublicAvailabilityResponse {
    slots: PublicBookableSlot[];
    checkoutEnabled: boolean;
}

export function parseBookableSlotsResponse(value: unknown, nowMs = Date.now()): PublicAvailabilityResponse | null {
    if (!isRecord(value) || !Array.isArray(value.slots) || typeof value.checkoutEnabled !== 'boolean') return null;

    const parsed = value.slots.map((slot) => parsePublicBookableSlot(slot, nowMs));
    if (parsed.some((slot) => slot === null)) return null;

    const slots = parsed as PublicBookableSlot[];
    if (new Set(slots.map((slot) => slot.publicId)).size !== slots.length) return null;
    return { slots, checkoutEnabled: value.checkoutEnabled };
}

export function buildCheckoutLoginUrl(
    lang: CheckoutLanguage,
    slotPublicId: string,
    attribution?: AcquisitionAttribution | null,
): string {
    const params = new URLSearchParams({ checkoutSlot: slotPublicId });
    if (attribution) appendAcquisitionAttribution(params, attribution);
    let returnTo = `/${lang}?${params.toString()}#planes`;
    if (returnTo.length > maxAuthReturnToLength) {
        returnTo = `/${lang}?checkoutSlot=${encodeURIComponent(slotPublicId)}#planes`;
    }
    return `/${lang}/login?returnTo=${encodeURIComponent(returnTo)}`;
}
