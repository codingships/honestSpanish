import type { APIRoute } from 'astro';
import { listPublicBookableSlots } from '../../lib/public-bookable-slots';

const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};

export const GET: APIRoute = async () => {
    try {
        const slots = await listPublicBookableSlots();
        return new Response(JSON.stringify({ slots }), { status: 200, headers });
    } catch (error) {
        console.error('Could not list public bookable slots:', error);
        return new Response(JSON.stringify({ error: 'Availability is temporarily unavailable' }), {
            status: 503,
            headers,
        });
    }
};
