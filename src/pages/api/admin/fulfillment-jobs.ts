import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { processFulfillmentJobs } from '../../../lib/internal-job-service';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Json } from '../../../types/database.types';

const jsonHeaders = { 'Content-Type': 'application/json' };
const retryConflict = {
    error: 'Fulfillment job changed or is not retryable',
    code: 'FULFILLMENT_JOB_RETRY_CONFLICT',
};
const cancelConflict = {
    error: 'Fulfillment job changed or cannot be cancelled',
    code: 'FULFILLMENT_JOB_CANCEL_CONFLICT',
};

const jobActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('retry'), jobId: z.string().uuid() }),
    z.object({ action: z.literal('cancel'), jobId: z.string().uuid() }),
    z.object({ action: z.literal('process_due'), limit: z.number().int().min(1).max(100).default(20) }),
]);

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

async function requireAdmin(context: APIContext) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: jsonResponse({ error: 'Unauthorized' }, 401), user: null };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'admin') {
        return { error: jsonResponse({ error: 'Forbidden' }, 403), user: null };
    }

    return { error: null, user };
}

async function logAudit(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; action: string; entityId?: string | null; before?: Json | null; after?: Json | null }
) {
    const { error } = await supabaseAdmin
        .from('admin_audit_log')
        .insert({
            admin_id: input.adminId,
            action: input.action,
            entity_type: 'fulfillment_job',
            entity_id: input.entityId ?? null,
            before: input.before ?? null,
            after: input.after ?? null,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminFulfillmentJobs] Failed to write audit log:', error);
    }
}

async function logRequiredAudit(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: { adminId: string; action: string; entityId?: string | null; before?: Json | null; after?: Json | null }
): Promise<boolean> {
    const { error } = await supabaseAdmin
        .from('admin_audit_log')
        .insert({
            admin_id: input.adminId,
            action: input.action,
            entity_type: 'fulfillment_job',
            entity_id: input.entityId ?? null,
            before: input.before ?? null,
            after: input.after ?? null,
        });

    if (!error) return true;

    console.error('[AdminFulfillmentJobs] Required audit write failed:', error);
    return false;
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const url = new URL(context.request.url);
    const status = url.searchParams.get('status');
    const rawLimit = Number(url.searchParams.get('limit') || 50);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
    const supabaseAdmin = createSupabaseAdminClient();

    let query = supabaseAdmin
        .from('fulfillment_jobs')
        .select(`
            *,
            student:profiles!fulfillment_jobs_student_id_fkey(id, full_name, email),
            session:sessions(id, scheduled_at, status)
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (status && status !== 'all') {
        query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
        return jsonResponse({ error: 'Could not load fulfillment jobs' }, 500);
    }

    return jsonResponse({ jobs: data ?? [] });
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let rawBody: unknown;
    try {
        rawBody = await context.request.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const parsed = jobActionSchema.safeParse(rawBody);
    if (!parsed.success) {
        return jsonResponse({ error: 'Invalid job action' }, 400);
    }

    const payload = parsed.data;
    const supabaseAdmin = createSupabaseAdminClient();

    if (payload.action === 'process_due') {
        const requestAudited = await logRequiredAudit(supabaseAdmin, {
            adminId: auth.user.id,
            action: 'fulfillment_jobs.process_due.requested',
            after: {
                status: 'requested',
                limit: payload.limit,
            },
        });
        if (!requestAudited) {
            return jsonResponse({ error: 'Could not record processing request' }, 503);
        }

        try {
            const result = await processFulfillmentJobs(context, payload.limit);
            await logAudit(supabaseAdmin, {
                adminId: auth.user.id,
                action: 'fulfillment_jobs.process_due.completed',
                after: {
                    status: 'completed',
                    result,
                } as Json,
            });
            return jsonResponse({ result });
        } catch (error) {
            console.error('[AdminFulfillmentJobs] Could not process jobs:', error);
            return jsonResponse({ error: 'Could not process jobs' }, 503);
        }
    }

    const { data: updated, error } = await supabaseAdmin.rpc(
        'admin_recover_fulfillment_job',
        {
            p_action: payload.action,
            p_admin_id: auth.user.id,
            p_job_id: payload.jobId,
        },
    );

    if (error) {
        if (error.code === 'P0002' || error.message.includes('fulfillment_job_not_found')) {
            return jsonResponse({ error: 'Job not found' }, 404);
        }
        if (error.code === '40001' || error.message.includes('fulfillment_job_recovery_conflict')) {
            return jsonResponse(payload.action === 'retry' ? retryConflict : cancelConflict, 409);
        }
        console.error('[AdminFulfillmentJobs] Could not recover job:', error);
        return jsonResponse({ error: 'Could not update job' }, 500);
    }

    return jsonResponse({ job: updated });
};
