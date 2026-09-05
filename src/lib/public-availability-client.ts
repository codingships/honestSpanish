import {
    parseBookableSlotsResponse,
    type PublicAvailabilityResponse,
} from './public-checkout-ui';

export const PUBLIC_AVAILABILITY_PATH = '/api/bookable-slots' as const;

export class PublicAvailabilityClientError extends Error {
    constructor() {
        super('Public availability is unavailable');
        this.name = 'PublicAvailabilityClientError';
    }
}

interface FetchPublicAvailabilityOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    nowMs?: number;
}

/**
 * Browser-only read path shared by the visible checkout UI and WebMCP.
 * The server endpoint and its parser remain authoritative; this helper never
 * creates a hold, changes a session, or starts checkout.
 */
export async function fetchPublicAvailability({
    fetchImpl = fetch,
    signal,
    nowMs = Date.now(),
}: FetchPublicAvailabilityOptions = {}): Promise<PublicAvailabilityResponse> {
    const response = await fetchImpl(PUBLIC_AVAILABILITY_PATH, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        ...(signal ? { signal } : {}),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new PublicAvailabilityClientError();

    const parsed = parseBookableSlotsResponse(payload, nowMs);
    if (!parsed) throw new PublicAvailabilityClientError();
    return parsed;
}
