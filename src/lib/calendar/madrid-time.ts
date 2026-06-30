const MADRID_TIME_ZONE = 'Europe/Madrid';

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
    const parts = partsFor(date, MADRID_TIME_ZONE);
    return [
        String(parts.year).padStart(4, '0'),
        String(parts.month).padStart(2, '0'),
        String(parts.day).padStart(2, '0'),
    ].join('-');
}

export function normalizeDateInputToDateKey(value: string): string | null {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
        return value;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : madridDateKey(parsed);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

export function dayOfWeekForDateKey(dateKey: string): number {
    const [year, month, day] = dateKey.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function compareDateKeys(a: string, b: string): number {
    return a.localeCompare(b);
}

export function madridDateTimeToUtcIso(dateKey: string, time: string): string | null {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);

    if (!dateMatch || !timeMatch) {
        return null;
    }

    const [, yearRaw, monthRaw, dayRaw] = dateMatch;
    const [, hourRaw, minuteRaw] = timeMatch;
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    const firstOffset = offsetMinutesFor(new Date(localAsUtc), MADRID_TIME_ZONE);
    let utcInstant = new Date(localAsUtc - firstOffset * 60000);
    const secondOffset = offsetMinutesFor(utcInstant, MADRID_TIME_ZONE);

    if (secondOffset !== firstOffset) {
        utcInstant = new Date(localAsUtc - secondOffset * 60000);
    }

    return utcInstant.toISOString();
}
