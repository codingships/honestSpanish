import { madridDateKey } from './madrid-time';

type AvailableSlot = {
    slot_start: string;
    slot_end?: string;
};

type RpcClient = {
    rpc: (
        fn: 'get_available_slots',
        args: {
            p_teacher_id: string;
            p_date: string;
            p_duration_minutes: number;
        }
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type TeacherAvailabilitySlotCheck =
    | { ok: true }
    | { ok: false; status: 400 | 409 | 500; error: string };

function parseScheduledDate(value: string): Date | null {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function checkPayloadOverlaps(scheduledAts: string[], durationMinutes: number): TeacherAvailabilitySlotCheck {
    const intervals = scheduledAts.map((scheduledAt) => {
        const start = parseScheduledDate(scheduledAt);
        if (!start) {
            return null;
        }

        return {
            startMs: start.getTime(),
            endMs: start.getTime() + durationMinutes * 60000,
        };
    });

    if (intervals.some((interval) => interval === null)) {
        return {
            ok: false,
            status: 400,
            error: 'scheduledAt must be a valid ISO date string',
        };
    }

    const sortedIntervals = (intervals as Array<{ startMs: number; endMs: number }>).sort((a, b) => a.startMs - b.startMs);

    for (let index = 1; index < sortedIntervals.length; index += 1) {
        const previous = sortedIntervals[index - 1];
        const current = sortedIntervals[index];

        if (current.startMs < previous.endMs) {
            return {
                ok: false,
                status: 409,
                error: 'Request contains overlapping class times',
            };
        }
    }

    return { ok: true };
}

export async function checkTeacherAvailabilitySlots(
    supabaseAdmin: RpcClient,
    input: {
        teacherId: string;
        scheduledAts: string[];
        durationMinutes: number;
    }
): Promise<TeacherAvailabilitySlotCheck> {
    const payloadOverlapCheck = checkPayloadOverlaps(input.scheduledAts, input.durationMinutes);
    if (!payloadOverlapCheck.ok) {
        return payloadOverlapCheck;
    }

    const scheduledByDate = new Map<string, Date[]>();

    for (const scheduledAt of input.scheduledAts) {
        const scheduledDate = parseScheduledDate(scheduledAt);
        if (!scheduledDate) {
            return {
                ok: false,
                status: 400,
                error: 'scheduledAt must be a valid ISO date string',
            };
        }

        const dateKey = madridDateKey(scheduledDate);
        const dates = scheduledByDate.get(dateKey) ?? [];
        dates.push(scheduledDate);
        scheduledByDate.set(dateKey, dates);
    }

    for (const [dateKey, scheduledDates] of scheduledByDate.entries()) {
        const { data, error } = await supabaseAdmin.rpc('get_available_slots', {
            p_teacher_id: input.teacherId,
            p_date: dateKey,
            p_duration_minutes: input.durationMinutes,
        });

        if (error) {
            console.error('[CalendarAvailability] Failed to verify teacher availability:', error);
            return {
                ok: false,
                status: 500,
                error: 'Cannot verify teacher availability right now',
            };
        }

        const availableStarts = new Set(
            ((data ?? []) as AvailableSlot[])
                .map((slot) => parseScheduledDate(slot.slot_start)?.getTime())
                .filter((value): value is number => typeof value === 'number')
        );

        for (const scheduledDate of scheduledDates) {
            if (!availableStarts.has(scheduledDate.getTime())) {
                return {
                    ok: false,
                    status: 409,
                    error: 'Time slot is outside teacher availability or already booked',
                };
            }
        }
    }

    return { ok: true };
}
