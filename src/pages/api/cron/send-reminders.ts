import type { APIRoute } from 'astro';
import { sendDueReminders } from '../../../lib/internal-job-service';
import { readRuntimeEnv } from '../../../lib/runtime-env';

export const GET: APIRoute = async (context) => {
    const cronSecret = readRuntimeEnv('CRON_SECRET', context);
    if (!cronSecret) {
        console.error('[CRON] CRON_SECRET is not configured');
        return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const authHeader = context.request.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[CRON] Unauthorized request to send-reminders');
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const result = await sendDueReminders(context);
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('[CRON] Internal reminder service failed:', error);
        return new Response(JSON.stringify({
            success: false,
            error: 'Internal reminder service failed',
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
};

export const POST = GET;
