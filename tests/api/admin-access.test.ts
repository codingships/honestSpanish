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
    id: '99300000-0000-4000-8000-000000000001',
    email: 'owner@example.test',
};
const editorId = '99300000-0000-4000-8000-000000000002';

function resolvedQuery(data: unknown[], error: unknown = null) {
    const result = { data, error };
    const query: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return query;
}

function adminClient(input: {
    profiles?: unknown[];
    assignments?: unknown[];
    promotionProfiles?: unknown[];
    rpcData?: unknown;
    rpcError?: unknown;
} = {}) {
    const profileQuery = resolvedQuery(input.profiles ?? [
        { id: owner.id, email: owner.email, full_name: 'Owner' },
        { id: editorId, email: 'editor@example.test', full_name: 'Editor' },
    ]);
    const assignmentQuery = resolvedQuery(input.assignments ?? [
        { profile_id: owner.id, access_role: 'owner', granted_at: '2026-08-03T00:00:00Z', granted_by: null },
        { profile_id: editorId, access_role: 'viewer', granted_at: '2026-08-03T00:00:00Z', granted_by: owner.id },
        { profile_id: editorId, access_role: 'catalog_editor', granted_at: '2026-08-03T00:00:00Z', granted_by: owner.id },
    ]);
    const promotionQuery = resolvedQuery(input.promotionProfiles ?? []);
    let profileReads = 0;
    const client = {
        from: vi.fn((table: string) => {
            if (table === 'profiles') {
                if (input.promotionProfiles && profileReads++ === 0) return promotionQuery;
                return profileQuery;
            }
            if (table === 'admin_role_assignments') return assignmentQuery;
            throw new Error(`Unexpected table ${table}`);
        }),
        rpc: vi.fn().mockResolvedValue({
            data: input.rpcData ?? { changed: true },
            error: input.rpcError ?? null,
        }),
    };
    return { client, profileQuery, assignmentQuery, promotionQuery };
}

function context(body: unknown = {}, invalidJson = false, origin = 'http://localhost:4321') {
    const request = new Request('http://localhost:4321/api/admin/access', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: origin,
        },
        body: JSON.stringify(body),
    });
    if (invalidJson) {
        Object.defineProperty(request, 'json', {
            value: vi.fn().mockRejectedValue(new Error('bad json')),
        });
    }
    return { request };
}

describe('/api/admin/access', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requireAdminCapability).mockResolvedValue({ error: null, user: owner } as never);
    });

    it('returns the administrator roster with stable role ordering', async () => {
        const { client } = adminClient();
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { GET } = await import('../../src/pages/api/admin/access');
        const response = await GET(context() as never);
        const body = await response.json() as {
            canWrite: boolean;
            admins: Array<{ id: string; roles: string[] }>;
        };

        expect(response.status).toBe(200);
        expect(requireAdminCapability).toHaveBeenCalledWith(expect.anything(), 'access.read');
        expect(body.canWrite).toBe(true);
        expect(body.admins.find((admin) => admin.id === editorId)?.roles).toEqual([
            'catalog_editor',
            'viewer',
        ]);
    });

    it('stops before using the service role when access.read is denied', async () => {
        vi.mocked(requireAdminCapability).mockResolvedValue({
            error: new Response('{}', { status: 403 }),
            user: null,
        });

        const { GET } = await import('../../src/pages/api/admin/access');
        const response = await GET(context() as never);

        expect(response.status).toBe(403);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('validates mutations before creating a service-role client', async () => {
        const { POST } = await import('../../src/pages/api/admin/access');
        const response = await POST(context({
            action: 'grant',
            profileId: 'not-a-uuid',
            accessRole: 'superuser',
        }) as never);

        expect(response.status).toBe(400);
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('rejects cross-origin mutations before resolving access', async () => {
        const { POST } = await import('../../src/pages/api/admin/access');
        const response = await POST(context({
            action: 'grant',
            profileId: editorId,
            accessRole: 'viewer',
        }, false, 'https://attacker.example') as never);

        expect(response.status).toBe(403);
        expect(requireAdminCapability).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('grants a role through the audited database RPC and reloads the roster', async () => {
        const { client } = adminClient({
            assignments: [
                { profile_id: owner.id, access_role: 'owner', granted_at: '2026-08-03T00:00:00Z', granted_by: null },
                { profile_id: editorId, access_role: 'catalog_editor', granted_at: '2026-08-03T00:00:00Z', granted_by: owner.id },
            ],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { POST } = await import('../../src/pages/api/admin/access');
        const response = await POST(context({
            action: 'grant',
            profileId: editorId,
            accessRole: 'catalog_editor',
        }) as never);
        const body = await response.json() as { canWrite: boolean };

        expect(response.status).toBe(200);
        expect(body.canWrite).toBe(true);
        expect(requireAdminCapability).toHaveBeenCalledWith(expect.anything(), 'access.write');
        expect(client.rpc).toHaveBeenCalledWith('admin_grant_access_role', {
            p_actor_id: owner.id,
            p_profile_id: editorId,
            p_access_role: 'catalog_editor',
        });
    });

    it('returns refreshed write authority after an owner revokes their own owner role', async () => {
        const { client } = adminClient({
            assignments: [
                { profile_id: editorId, access_role: 'owner', granted_at: '2026-08-03T00:00:00Z', granted_by: owner.id },
            ],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { POST } = await import('../../src/pages/api/admin/access');
        const response = await POST(context({
            action: 'revoke',
            profileId: owner.id,
            accessRole: 'owner',
        }) as never);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            canWrite: false,
        });
    });

    it('promotes one exact invited account through the verified audited RPC', async () => {
        const { client, promotionQuery } = adminClient({
            promotionProfiles: [{ id: editorId }],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { POST } = await import('../../src/pages/api/admin/access');
        const response = await POST(context({
            action: 'promote',
            requestId: '99300000-0000-4000-8000-000000000003',
            email: 'editor_name@example.test',
            accessRole: 'content_editor',
            reason: 'Alta del equipo editorial',
        }) as never);

        expect(response.status).toBe(200);
        expect(promotionQuery.ilike).toHaveBeenCalledWith('email', 'editor\\_name@example.test');
        expect(client.rpc).toHaveBeenCalledWith('promote_admin_profile', {
            p_request_id: '99300000-0000-4000-8000-000000000003',
            p_profile_id: editorId,
            p_access_role: 'content_editor',
            p_admin_id: owner.id,
            p_reason: 'Alta del equipo editorial',
        });
    });

    it('maps the last-owner database guard to a conflict without exposing internals', async () => {
        const { client } = adminClient({
            rpcError: { code: '23514', message: 'admin_access_last_owner' },
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(client as never);

        const { POST } = await import('../../src/pages/api/admin/access');
        const response = await POST(context({
            action: 'revoke',
            profileId: owner.id,
            accessRole: 'owner',
        }) as never);

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'At least one owner must remain',
        });
    });
});
