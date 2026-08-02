import type { APIRoute } from 'astro';
import { listPublicBookableSlots } from '../../lib/public-bookable-slots';
import { isCheckoutEnabled } from '../../lib/checkout-enabled';
import { readStagingE2ECheckoutGrant } from '../../lib/staging-e2e-checkout';
import {
    API_CACHE_CONTROL,
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

export const GET: APIRoute = async (context) => {
    try {
        const globallyEnabled = isCheckoutEnabled(context);
        const slotsPromise = publicSlotsBody();
        const grantPromise = globallyEnabled
            ? Promise.resolve(null)
            : readStagingE2ECheckoutGrant(context);
        const [slotsBody, stagingGrant] = await Promise.all([slotsPromise, grantPromise]);
        const slots = JSON.parse(slotsBody) as { slots: unknown[] };
        const visibleSlots = stagingGrant
            ? slots.slots.filter((slot) => (
                typeof slot === 'object'
                && slot !== null
                && 'publicId' in slot
                && slot.publicId === stagingGrant.slotPublicId
            ))
            : slots.slots;
        const body = JSON.stringify({
            slots: visibleSlots,
            checkoutEnabled: globallyEnabled || Boolean(stagingGrant && visibleSlots.length === 1),
        });
        const headers = stagingGrant
            ? { ...successHeaders, 'Cache-Control': API_CACHE_CONTROL, Vary: 'Cookie' }
            : successHeaders;
        return new Response(body, { status: 200, headers });
    } catch (error) {
        console.error('Could not list public bookable slots:', error);
        return new Response(JSON.stringify({ error: 'Availability is temporarily unavailable' }), {
            status: 503,
            headers: errorHeaders,
        });
    }
};
