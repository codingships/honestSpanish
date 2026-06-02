import type { APIRoute } from 'astro';
import { processDueFulfillmentJobs } from '../../../lib/fulfillment/jobs';
import { readRuntimeEnv } from '../../../lib/runtime-env';

export const POST: APIRoute = async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    const expectedToken = readRuntimeEnv('CRON_SECRET');

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const result = await processDueFulfillmentJobs({ limit: 20 });

    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const GET = POST;
