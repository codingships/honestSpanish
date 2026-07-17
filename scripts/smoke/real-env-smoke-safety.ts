import { madridDateKey } from '../../src/lib/calendar/madrid-time';

type DriveFolderState = {
    driveFolderId: string | null;
    driveFolderUrl: string | null;
};

type DriveFolderResponse = {
    status: number;
    body: unknown;
};

export function isAcceptedDriveFolderProvisioning(
    response: DriveFolderResponse,
    state: DriveFolderState | null,
): boolean {
    if (!state?.driveFolderId || !state.driveFolderUrl) return false;
    if (response.status === 200) return true;
    if (response.status !== 400 || !isRecord(response.body)) return false;

    return response.body.error === 'Student already has a Drive folder'
        && response.body.folderId === state.driveFolderId
        && response.body.folderUrl === state.driveFolderUrl;
}

export function parseAvailableSlotStarts(body: unknown): string[] | null {
    if (!isRecord(body) || !Array.isArray(body.slots)) return null;

    const starts: string[] = [];
    for (const slot of body.slots) {
        if (!isRecord(slot) || typeof slot.slot_start !== 'string') return null;
        if (Number.isNaN(new Date(slot.slot_start).getTime())) return null;
        starts.push(slot.slot_start);
    }

    return starts;
}

export function parseAvailableSlotStartsForDate(body: unknown, dateKey: string): string[] | null {
    const starts = parseAvailableSlotStarts(body);
    if (!starts) return null;
    return starts.every((slotStart) => madridDateKey(new Date(slotStart)) === dateKey)
        ? starts
        : null;
}

type SchedulingProbeResponse<TBody> = {
    status: number;
    body: TBody;
};

type SchedulingProbeFailure<TBody> = {
    slotStart: string;
    response: SchedulingProbeResponse<TBody>;
};

type SchedulingProbeResult<TBody> =
    | {
        kind: 'scheduled';
        slotStart: string;
        response: SchedulingProbeResponse<TBody>;
    }
    | {
        kind: 'fatal';
        slotStart: string;
        response: SchedulingProbeResponse<TBody>;
    }
    | {
        kind: 'none';
        lastFailure: SchedulingProbeFailure<TBody> | null;
    };

export async function findFirstSchedulableAvailableSlot<TBody>(options: {
    now: Date;
    subscriptionEndDate: string;
    firstDayOffset?: number;
    lastDayOffsetExclusive?: number;
    listAvailableSlotStarts: (dateKey: string) => Promise<string[]>;
    schedule: (slotStart: string) => Promise<SchedulingProbeResponse<TBody>>;
}): Promise<SchedulingProbeResult<TBody>> {
    let lastFailure: SchedulingProbeFailure<TBody> | null = null;

    for (const dateKey of buildSubscriptionCandidateDateKeys(options)) {
        const availableSlotStarts = await options.listAvailableSlotStarts(dateKey);
        for (const slotStart of availableSlotStarts) {
            const response = await options.schedule(slotStart);
            if (response.status === 201) {
                return { kind: 'scheduled', slotStart, response };
            }

            lastFailure = { slotStart, response };
            if (response.status !== 409) {
                return { kind: 'fatal', slotStart, response };
            }
        }
    }

    return { kind: 'none', lastFailure };
}

export function buildSubscriptionCandidateDateKeys(options: {
    now: Date;
    subscriptionEndDate: string;
    firstDayOffset?: number;
    lastDayOffsetExclusive?: number;
}): string[] {
    const firstDayOffset = options.firstDayOffset ?? 14;
    const lastDayOffsetExclusive = options.lastDayOffsetExclusive ?? 90;
    const dateKeys: string[] = [];

    for (let dayOffset = firstDayOffset; dayOffset < lastDayOffsetExclusive; dayOffset += 1) {
        const candidateDate = new Date(options.now);
        candidateDate.setUTCDate(candidateDate.getUTCDate() + dayOffset);
        const dateKey = candidateDate.toISOString().split('T')[0];
        if (dateKey > options.subscriptionEndDate) break;
        dateKeys.push(dateKey);
    }

    return dateKeys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
