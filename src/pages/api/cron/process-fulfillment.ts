import type { APIRoute } from 'astro';
import { processFulfillmentJobs } from '../../../lib/internal-job-service';
import { readRuntimeEnv } from '../../../lib/runtime-env';

export const POST: APIRoute = async (context) => {
    const authHeader = context.request.headers.get('Authorization');
    const expectedToken = readRuntimeEnv('CRON_SECRET', context);

    if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const result = await processFulfillmentJobs(context, 20);

    return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};

export const GET = POST;
