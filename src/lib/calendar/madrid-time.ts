export const MADRID_TIME_ZONE = 'Europe/Madrid';

type DateKeyParts = {
    year: number;
    month: number;
    day: number;
};

export type MadridWeekUtcRange = {
    weekStartKey: string;
    weekEndKeyExclusive: string;
    fromUtc: string;
    toUtcExclusive: string;
};

function utcDateFromParts(year: number, month: number, day: number, hour = 0, minute = 0): Date {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, 0, 0);
    return date;
}

function parseDateKey(value: string): DateKeyParts | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = utcDateFromParts(year, month, day);

    if (
        year < 1000
        || year > 9999
        ||
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

function isExplicitIsoInstant(value: string): boolean {
    const match = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(Z|[+-](\d{2}):([0-5]\d))$/i.exec(value);
    if (!match || !parseDateKey(match[1])) return false;

    if (match[3]) {
        const offsetHours = Number(match[3]);
        const offsetMinutes = Number(match[4]);
        if (offsetHours > 14 || (offsetHours === 14 && offsetMinutes !== 0)) return false;
    }

    return !Number.isNaN(Date.parse(value));
}

function partsFor(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);

    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;

    return {
        year: Number(value('year')),
        month: Number(value('month')),
        day: Number(value('day')),
        hour: Number(value('hour')),
        minute: Number(value('minute')),
        second: Number(value('second')),
    };
}

function offsetMinutesFor(date: Date, timeZone: string): number {
    const parts = partsFor(date, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return (asUtc - date.getTime()) / 60000;
}

export function madridDateKey(date: Date): string {
    if (Number.isNaN(date.getTime())) {
        throw new RangeError('Invalid instant');
    }
    const parts = partsFor(date, MADRID_TIME_ZONE);
    return [
        String(parts.year).padStart(4, '0'),
        String(parts.month).padStart(2, '0'),
        String(parts.day).padStart(2, '0'),
    ].join('-');
}

export function normalizeDateInputToDateKey(value: string): string | null {
    if (parseDateKey(value)) {
        return value;
    }

    // Instants must include an explicit UTC offset. Runtime-local date-times are ambiguous.
    if (!isExplicitIsoInstant(value)) return null;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : madridDateKey(parsed);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
    const parts = parseDateKey(dateKey);
    if (!parts || !Number.isInteger(days)) {
        throw new RangeError('Invalid Madrid date-key arithmetic');
    }

    const date = utcDateFromParts(parts.year, parts.month, parts.day + days);
    const resultYear = date.getUTCFullYear();
    if (resultYear < 1000 || resultYear > 9999) {
        throw new RangeError('Madrid date-key arithmetic exceeded the supported year range');
    }
    return date.toISOString().slice(0, 10);
}

export function dayOfWeekForDateKey(dateKey: string): number {
    const parts = parseDateKey(dateKey);
    if (!parts) throw new RangeError('Invalid Madrid date key');
    return utcDateFromParts(parts.year, parts.month, parts.day).getUTCDay();
}

export function compareDateKeys(a: string, b: string): number {
    return a.localeCompare(b);
}

export function madridDateTimeToUtcIso(dateKey: string, time: string): string | null {
    const dateParts = parseDateKey(dateKey);
    const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

    if (!dateParts || !timeMatch) {
        return null;
    }

    const [, hourRaw, minuteRaw] = timeMatch;
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const localAsUtc = utcDateFromParts(dateParts.year, dateParts.month, dateParts.day, hour, minute).getTime();
    const offsetSamples = [-48, -24, 0, 24, 48].map((hours) => (
        offsetMinutesFor(new Date(localAsUtc + hours * 60 * 60 * 1000), MADRID_TIME_ZONE)
    ));
    const candidateInstants = [...new Set(offsetSamples)]
        .map((offsetMinutes) => new Date(localAsUtc - offsetMinutes * 60000))
        .filter((candidate) => {
            const local = partsFor(candidate, MADRID_TIME_ZONE);
            return local.year === dateParts.year
                && local.month === dateParts.month
                && local.day === dateParts.day
                && local.hour === hour
                && local.minute === minute
                && local.second === 0;
        });
    const uniqueCandidates = [...new Map(candidateInstants.map((candidate) => (
        [candidate.getTime(), candidate]
    ))).values()];

    // Zero candidates is a DST gap; two candidates is a DST overlap. Neither is implicit.
    return uniqueCandidates.length === 1 ? uniqueCandidates[0].toISOString() : null;
}

export function madridWeekStartDateKey(date: Date): string {
    const dateKey = madridDateKey(date);
    const dayOfWeek = dayOfWeekForDateKey(dateKey);
    return addDaysToDateKey(dateKey, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
}

export function madridWeekUtcRange(weekStartKey: string): MadridWeekUtcRange | null {
    if (!parseDateKey(weekStartKey) || dayOfWeekForDateKey(weekStartKey) !== 1) return null;

    let weekEndKeyExclusive: string;
    try {
        weekEndKeyExclusive = addDaysToDateKey(weekStartKey, 7);
    } catch (error) {
        if (error instanceof RangeError) return null;
        throw error;
    }
    const fromUtc = madridDateTimeToUtcIso(weekStartKey, '00:00');
    const toUtcExclusive = madridDateTimeToUtcIso(weekEndKeyExclusive, '00:00');
    if (!fromUtc || !toUtcExclusive) return null;

    return {
        weekStartKey,
        weekEndKeyExclusive,
        fromUtc,
        toUtcExclusive,
    };
}
