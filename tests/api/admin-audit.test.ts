import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminCapability } from '../../src/lib/admin-access';
import { createSupabaseAdminClient } from '../../src/lib/supabase-admin';

vi.mock('../../src/lib/admin-access', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/admin-access')>(
        '../../src/lib/admin-access',
    );
    return {
        ...actual,
        requireAdminCapability: vi.fn(),
    };
});

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const owner = {
    id: '99400000-0000-4000-8000-000000000001',
    email: 'owner@example.test',
};

function auditClient(input: {
    rows?: unknown[];
    auditError?: unknown;
    actors?: unknown[];
    actorsError?: unknown;
} = {}) {
    const auditResult = {
        data: input.rows ?? [],
        error: input.auditError ?? null,
    };
    const auditQuery: any = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve: (value: typeof auditResult) => unknown) => Promise.resolve(auditResult).then(resolve),
    };

    const actorResult = {
        data: input.actors ?? [],
        error: input.actorsError ?? null,
    };
    const actorQuery: any = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue(actorResult),
    };

    const client = {
        from: vi.fn((table: string) => {
            if (table === 'admin_audit_log') return auditQuery;
            if (table === 'profiles') return actorQuery;
            throw new Error(`Unexpected table ${table}`);
        }),
    };

    return { client, auditQuery, actorQuery };
}

function context(query = '') {
    return {
        request: {
            url: `https://staging.example.test/api/admin/audit${query}`,
        },
    };
}

describe('/api/admin/audit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requireAdminCapability).mockResolvedValue({ error: null, user: owner } as never);
    });

    it('stops before using the service role when access.read is denied', async () => {
        vi.mocked(requireAdminCapability).mockResolvedValue({
            error: new Response('{}', { status: 403 }),
            user: null,
        });

        const { GET } = await import('../../src/pages/api/admin/audit');
        const response = await GET(context() as never);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects invalid filters before creating a service-role client', async () => {
        const { GET } = await import('../../src/pages/api/admin/audit');
        const response = await GET(context('?entityType=profiles%20or%201%3D1') as never);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects an incomplete composite pagination cursor', async () => {
        const { GET } = await import('../../src/pages/api/admin/audit');
        const response = await GET(context(
            '?before=2026-08-03T11%3A00%3A00.000Z',
        ) as never);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('returns redacted event metadata, resolves actors and applies filters', async () => {
        const createdAt = '2026-08-03T10:15:30.000Z';
        const previousPage = '2026-08-03T11:00:00.000Z';
        const previousId = '99500000-0000-4000-8000-000000000099';
        const sensitiveBefore = { email: 'private-before@example.test' };
        const sensitiveAfter = { email: 'private-after@example.test' };
        const { client, auditQuery, actorQuery } = auditClient({
            rows: [{
                id: '99500000-0000-4000-8000-000000000001',
                admin_id: owner.id,
                action: 'admin_access.grant',
                entity_type: 'admin_access',
                entity_id: '99500000-0000-4000-8000-000000000002',
                created_at: createdAt,
                before: sensitiveBefore,
                after: sensitiveAfter,
            }],
            actors: [{ id: owner.id, full_name: 'Owner Name', email: owner.email }],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { GET } = await import('../../src/pages/api/admin/audit');
        const response = await GET(context(
            `?entityType=admin_access&before=${encodeURIComponent(previousPage)}&beforeId=${previousId}&limit=10`,
        ) as never);
        const body = await response.json() as {
            events: Array<Record<string, unknown>>;
            nextCursor: { createdAt: string; id: string } | null;
        };

        expect(response.status).toBe(200);
        expect(requireAdminCapability).toHaveBeenCalledWith(expect.anything(), 'access.read');
        expect(auditQuery.or).toHaveBeenCalledWith([
            `created_at.lt.${previousPage}`,
            `and(created_at.eq.${previousPage},id.lt.${previousId})`,
        ].join(','));
        expect(auditQuery.eq).toHaveBeenCalledWith('entity_type', 'admin_access');
        expect(auditQuery.limit).toHaveBeenCalledWith(10);
        expect(actorQuery.in).toHaveBeenCalledWith('id', [owner.id]);
        expect(body).toEqual({
            events: [{
                id: '99500000-0000-4000-8000-000000000001',
                actorId: owner.id,
                actorLabel: 'Owner Name',
                action: 'admin_access.grant',
                entityType: 'admin_access',
                entityId: '99500000-0000-4000-8000-000000000002',
                createdAt,
                hasBefore: true,
                hasAfter: true,
            }],
            nextCursor: null,
        });
        expect(JSON.stringify(body)).not.toContain('private-before@example.test');
        expect(JSON.stringify(body)).not.toContain('private-after@example.test');
        expect(body.events[0]).not.toHaveProperty('before');
        expect(body.events[0]).not.toHaveProperty('after');
    });

    it('returns timestamp and id together when another page may exist', async () => {
        const createdAt = '2026-08-03T10:15:30.000Z';
        const id = '99500000-0000-4000-8000-000000000001';
        const { client } = auditClient({
            rows: [{
                id,
                admin_id: null,
                action: 'admin_access.revoke',
                entity_type: 'admin_access',
                entity_id: null,
                created_at: createdAt,
                before: { access_role: 'viewer' },
                after: null,
            }],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { GET } = await import('../../src/pages/api/admin/audit');
        const response = await GET(context('?limit=1') as never);

        await expect(response.json()).resolves.toMatchObject({
            nextCursor: { createdAt, id },
        });
    });

    it('fails closed when the audit store is unavailable', async () => {
        const { client } = auditClient({ auditError: { code: '08006', message: 'unavailable' } });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { GET } = await import('../../src/pages/api/admin/audit');
        const response = await GET(context() as never);

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({ error: 'Could not load audit history' });
    });
});
