import type { APIRoute } from 'astro';
import * as Sentry from '@sentry/astro';

export const GET: APIRoute = async () => {
    try {
        throw new Error('Sentry Test Error from Astro + Cloudflare (Phase 10)');
    } catch (e) {
        Sentry.captureException(e);
        return new Response(JSON.stringify({ message: 'Error enviado a Sentry' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
