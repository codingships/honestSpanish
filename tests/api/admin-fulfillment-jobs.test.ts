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

function processDueAdminClient() {
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
        from: vi.fn((table: string) => {
            if (table !== 'admin_audit_log') throw new Error(`Unexpected table ${table}`);
            return { insert: auditInsert };
        }),
    };

    return { client, auditInsert };
}

function recoveryActionAdminClient(input: { before: Record<string, unknown>; updated: Record<string, unknown> }) {
    let fulfillmentJobsCalls = 0;
    const beforeQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: input.before, error: null }),
    };
    const updateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: input.updated, error: null }),
    };
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'admin_audit_log') return { insert: auditInsert };
            if (table !== 'fulfillment_jobs') throw new Error(`Unexpected table ${table}`);
            fulfillmentJobsCalls += 1;
            return fulfillmentJobsCalls === 1 ? beforeQuery : updateQuery;
        }),
    };

    return { client, beforeQuery, updateQuery, auditInsert };
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
        const body = await response.json();

        expect(response.status).toBe(400);
        expect(body.error).toBe('Invalid JSON body');
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('processes due jobs through the internal worker client and logs audit evidence', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const { processFulfillmentJobs } = await import('../../src/lib/internal-job-service');
        const { client, auditInsert } = processDueAdminClient();
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);
        vi.mocked(processFulfillmentJobs).mockResolvedValue({ processed: 2, succeeded: 1, failed: 1 });

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'process_due', limit: 2 }) as any);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.result).toEqual({ processed: 2, succeeded: 1, failed: 1 });
        expect(processFulfillmentJobs).toHaveBeenCalledWith(expect.any(Object), 2);
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'fulfillment_jobs.process_due',
            entity_type: 'fulfillment_job',
            after: { processed: 2, succeeded: 1, failed: 1 },
        }));
    });

    it('retries a failed job and records before/after audit evidence', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000001';
        const before = { id: jobId, status: 'failed', attempts: 2, last_error: 'Resend timeout' };
        const updated = { id: jobId, status: 'pending', attempts: 0, last_error: null };
        const { client, beforeQuery, updateQuery, auditInsert } = recoveryActionAdminClient({ before, updated });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'retry', jobId }) as any);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.job).toEqual(updated);
        expect(beforeQuery.eq).toHaveBeenCalledWith('id', jobId);
        expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            attempts: 0,
            locked_at: null,
            locked_by: null,
            last_error: null,
            run_at: expect.any(String),
        }));
        expect(updateQuery.eq).toHaveBeenCalledWith('id', jobId);
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'fulfillment_job.retry',
            entity_type: 'fulfillment_job',
            entity_id: jobId,
            before,
            after: updated,
        }));
    });

    it('cancels a job and records before/after audit evidence', async () => {
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        const { createSupabaseAdminClient } = await import('../../src/lib/supabase-admin');
        const jobId = '70000000-0000-4000-8000-000000000002';
        const before = { id: jobId, status: 'failed', attempts: 3, last_error: 'Template missing' };
        const updated = { id: jobId, status: 'cancelled', attempts: 3, last_error: 'Template missing' };
        const { client, updateQuery, auditInsert } = recoveryActionAdminClient({ before, updated });
        vi.mocked(createSupabaseServerClient).mockReturnValue(roleClient('admin') as any);
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as any);

        const { POST } = await import('../../src/pages/api/admin/fulfillment-jobs');
        const response = await POST(postContext({ action: 'cancel', jobId }) as any);
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.job).toEqual(updated);
        expect(updateQuery.update).toHaveBeenCalledWith({
            status: 'cancelled',
            locked_at: null,
            locked_by: null,
        });
        expect(updateQuery.eq).toHaveBeenCalledWith('id', jobId);
        expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            admin_id: 'admin-1',
            action: 'fulfillment_job.cancel',
            entity_type: 'fulfillment_job',
            entity_id: jobId,
            before,
            after: updated,
        }));
    });
});
