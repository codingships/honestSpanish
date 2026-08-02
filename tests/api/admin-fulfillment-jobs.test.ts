import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    processFulfillmentJobs: vi.fn().mockResolvedValue({ processed: 0 }),
}));

function roleClient(role: string | null) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null }),
        },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: role ? { role } : null, error: null }),
        })),
    };
}

function listAdminClient() {
    const query: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => resolve({ data: [], error: null })),
    };
    return { client: { from: vi.fn(() => query) }, query };
}

function getContext(path: string) {
    return {
        request: {
            url: `http://localhost:4321${path}`,
            headers: { get: vi.fn().mockReturnValue('') },
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function postContextInvalidJson() {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/fulfillment-jobs',
            json: vi.fn().mockRejectedValue(new Error('bad json')),
            headers: { get: vi.fn().mockReturnValue('') },
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function postContext(body: unknown) {
    return {
        request: {
            url: 'http://localhost:4321/api/admin/fulfillment-jobs',
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn().mockReturnValue('') },
        },
        cookies: { get: vi.fn(), set: vi.fn() },
    };
}

function processDueAdminClient(auditResults: Array<{ error: unknown }> = [{ error: null }, { error: null }]) {
    const auditInsert = vi.fn();
    auditResults.forEach((result) => auditInsert.mockResolvedValueOnce(result));
    const client = {
        from: vi.fn((table: string) => {
            if (table !== 'admin_audit_log') throw new Error(`Unexpected table ${table}`);
            return { insert: auditInsert };
        }),
    };

    return { client, auditInsert };
}

function recoveryActionAdminClient(input: {
    updated?: Record<string, unknown> | null;
    error?: { code?: string; message: string } | null;
}) {
    const rpc = vi.fn().mockResolvedValue({
        data: input.updated ?? null,
        error: input.error ?? null,
    });
    return { client: { rpc }, rpc };
}

describe('/api/admin/fulfillment-jobs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses the default page size when the limit is invalid', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { client, query } = listAdminClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { GET } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await GET(getContext('/api/admin/fulfillment-jobs?limit=-5') as any);

        expect(response.status).toBe(200);
        expect(query.limit).toHaveBeenCalledWith(50);
    });

    it('returns 400 for invalid JSON before creating an admin client', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContextInvalidJson() as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('records the required request audit before processing due jobs and then logs the result', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { processFulfillmentJobs } = await import('../../src/lib/internal-job-service');
        const { client, auditInsert } = processDueAdminClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        vi.mocked(processFulfillmentJobs).mockResolvedValue({ processed: 2, succeeded: 1, failed: 1 });

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'process_due', limit: 2 }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body.result).toEqual({ processed: 2, succeeded: 1, failed: 1 });
        expect(processFulfillmentJobs).toHaveBeenCalledWith(expect.any(Object), 2);
        expect(auditInsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
            admin_id: 'admin-1',
            action: 'fulfillment_jobs.process_due.requested',
            entity_type: 'fulfillment_job',
            after: { status: 'requested', limit: 2 },
        }));
        expect(auditInsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
            admin_id: 'admin-1',
            action: 'fulfillment_jobs.process_due.completed',
            entity_type: 'fulfillment_job',
            after: {
                status: 'completed',
                result: { processed: 2, succeeded: 1, failed: 1 },
            },
        }));
        expect(auditInsert.mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(processFulfillmentJobs).mock.invocationCallOrder[0]
        );
    });

    it('does not invoke processing when the required request audit fails', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { processFulfillmentJobs } = await import('../../src/lib/internal-job-service');
        const { client, auditInsert } = processDueAdminClient([
            { error: { code: '23514', message: 'audit rejected' } },
        ]);
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'process_due', limit: 2 }) as any);

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Could not record processing request' });
        expect(auditInsert).toHaveBeenCalledOnce();
        expect(processFulfillmentJobs).not.toHaveBeenCalled();
        expect(errorLog).toHaveBeenCalled();
    });

    it('keeps the durable request audit when processing fails', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { processFulfillmentJobs } = await import('../../src/lib/internal-job-service');
        const { client, auditInsert } = processDueAdminClient([{ error: null }]);
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        vi.mocked(processFulfillmentJobs).mockRejectedValueOnce(new Error('worker unavailable'));
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'process_due', limit: 7 }) as any);

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Could not process jobs' });
        expect(auditInsert).toHaveBeenCalledOnce();
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'fulfillment_jobs.process_due.requested',
            after: { status: 'requested', limit: 7 },
        }));
        expect(errorLog).toHaveBeenCalled();
    });

    it('retries a failed job and records before/after audit evidence', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000001';
        const updated = { id: jobId, status: 'pending', attempts: 0, last_error: null };
        const { client, rpc } = recoveryActionAdminClient({ updated });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'retry', jobId }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body.job).toEqual(updated);
        expect(rpc).toHaveBeenCalledWith('admin_recover_fulfillment_job', {
            p_action: 'retry',
            p_admin_id: 'admin-1',
            p_job_id: jobId,
        });
    });

    it.each([
        ['the conflict SQLSTATE', { code: '40001', message: 'serialization failure' }],
        ['the domain error message', { code: 'P0001', message: 'fulfillment_job_recovery_conflict' }],
    ])('returns a stable retry conflict from %s', async (_source, databaseError) => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { processFulfillmentJobs } = await import('../../src/lib/internal-job-service');
        const jobId = '70000000-0000-4000-8000-000000000004';
        const { client, rpc } = recoveryActionAdminClient({
            error: databaseError,
        });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'retry', jobId }) as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Fulfillment job changed or is not retryable',
            code: 'FULFILLMENT_JOB_RETRY_CONFLICT',
        });
        expect(rpc).toHaveBeenCalledOnce();
        expect(processFulfillmentJobs).not.toHaveBeenCalled();
    });

    it('returns 404 when the transactional operation cannot find the job', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000004';
        const { client } = recoveryActionAdminClient({
            error: { code: 'P0002', message: 'fulfillment_job_not_found' },
        });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'retry', jobId }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(404);
        expect(body).toEqual({ error: 'Job not found' });
    });

    it('returns 500 when the transaction fails instead of reporting an unaudited success', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000005';
        const { client } = recoveryActionAdminClient({
            error: { code: '23514', message: 'audit trigger rejected row' },
        });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'retry', jobId }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(500);
        expect(body).toEqual({ error: 'Could not update job' });
        expect(errorLog).toHaveBeenCalled();
    });

    it('cancels a job and records before/after audit evidence', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000002';
        const updated = { id: jobId, status: 'cancelled', attempts: 3, last_error: 'Template missing' };
        const { client, rpc } = recoveryActionAdminClient({ updated });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'cancel', jobId }) as any);
        const body = await response.json() as JsonBody;

        expect(response.status).toBe(200);
        expect(body.job).toEqual(updated);
        expect(rpc).toHaveBeenCalledWith('admin_recover_fulfillment_job', {
            p_action: 'cancel',
            p_admin_id: 'admin-1',
            p_job_id: jobId,
        });
    });

    it('returns a stable conflict instead of cancelling a processing job', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000006';
        const { client } = recoveryActionAdminClient({
            error: { code: '40001', message: 'fulfillment_job_recovery_conflict' },
        });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'cancel', jobId }) as any);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Fulfillment job changed or cannot be cancelled',
            code: 'FULFILLMENT_JOB_CANCEL_CONFLICT',
        });
    });
});
