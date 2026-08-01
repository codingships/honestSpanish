import type { APIRoute } from 'astro';
import { listPublicBookableSlots } from '../../lib/public-bookable-slots';
import {
    PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL,
    PUBLIC_BOOKABLE_SLOTS_CACHE_TTL_SECONDS,
} from '../../lib/security-headers';

const successHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL,
};
const errorHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
};
const cacheTtlMs = PUBLIC_BOOKABLE_SLOTS_CACHE_TTL_SECONDS * 1_000;

let cachedSuccess: { body: string; expiresAt: number } | null = null;
let inFlightSuccess: Promise<string> | null = null;

async function publicSlotsBody(): Promise<string> {
    const now = Date.now();
    if (cachedSuccess && cachedSuccess.expiresAt > now) return cachedSuccess.body;
    if (inFlightSuccess) return inFlightSuccess;

    const request = listPublicBookableSlots().then((slots) => {
        const body = JSON.stringify({ slots });
        cachedSuccess = { body, expiresAt: Date.now() + cacheTtlMs };
        return body;
    });
    inFlightSuccess = request;

    try {
        return await request;
    } finally {
        if (inFlightSuccess === request) inFlightSuccess = null;
    }
}

export const GET: APIRoute = async () => {
    try {
        const body = await publicSlotsBody();
        return new Response(body, { status: 200, headers: successHeaders });
    } catch (error) {
        console.error('Could not list public bookable slots:', error);
        return new Response(JSON.stringify({ error: 'Availability is temporarily unavailable' }), {
            status: 503,
            headers: errorHeaders,
        });
    }
};
