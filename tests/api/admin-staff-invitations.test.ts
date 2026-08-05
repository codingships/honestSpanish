import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAdminCapability } from '../../src/lib/admin-access';
import { createSupabaseAdminClient } from '../../src/lib/supabase-admin';

vi.mock('../../src/lib/admin-access', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/admin-access')>(
        '../../src/lib/admin-access',
    );
    return { ...actual, requireAdminCapability: vi.fn() };
});

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(),
}));

const actor = {
    id: '99400000-0000-4000-8000-000000000001',
    email: 'owner@example.test',
};
const requestId = '99400000-0000-4000-8000-000000000002';
const invitedId = '99400000-0000-4000-8000-000000000003';

function request(body: unknown, origin = 'http://localhost:4321') {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (origin) headers.set('Origin', origin);
    return {
        request: new Request('http://localhost:4321/api/admin/staff-invitations', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        }),
    };
}

function queryResult(data: unknown[], error: unknown = null) {
    const result = { data, error };
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'ilike']) {
        query[method] = vi.fn().mockReturnValue(query);
    }
    query.limit = vi.fn().mockResolvedValue(result);
    return query;
}

function client(input: {
    auditRows?: unknown[];
    profiles?: unknown[];
    inviteError?: unknown;
    authUser?: unknown;
} = {}) {
    const auditQuery = queryResult(input.auditRows ?? []);
    const profileQuery = queryResult(input.profiles ?? []);
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const inviteUserByEmail = vi.fn().mockResolvedValue({
        data: { user: { id: invitedId } },
        error: input.inviteError ?? null,
    });
    const getUserById = vi.fn().mockResolvedValue({
        data: { user: input.authUser ?? null },
        error: null,
    });
    const admin = {
        from: vi.fn((table: string) => {
            if (table === 'profiles') return profileQuery;
            if (table === 'admin_audit_log') {
                return {
                    ...auditQuery,
                    insert: auditInsert,
                };
            }
            throw new Error(`Unexpected table ${table}`);
        }),
        auth: { admin: { getUserById, inviteUserByEmail } },
    };
    return { admin, auditInsert, auditQuery, profileQuery, getUserById, inviteUserByEmail };
}

function invitation(overrides: Record<string, unknown> = {}) {
    return {
        requestId,
        target: 'teacher',
        email: 'teacher@example.test',
        fullName: 'New Teacher',
        lang: 'en',
        reason: 'Planned teacher onboarding',
        ...overrides,
    };
}

describe('/api/admin/staff-invitations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(requireAdminCapability).mockResolvedValue({ error: null, user: actor } as never);
    });

    it('rejects cross-origin requests before resolving authorization or service credentials', async () => {
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');
        const response = await POST(request(invitation(), 'https://attacker.example') as never);

        expect(response.status).toBe(403);
        expect(requireAdminCapability).not.toHaveBeenCalled();
        expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('invites a teacher server-side without placing authorization in user metadata', async () => {
        const mocked = client();
        vi.mocked(createSupabaseAdminClient).mockReturnValue(mocked.admin as never);
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');

        const response = await POST(request(invitation()) as never);
        const body = await response.json() as { state: string; profileId: string };

        expect(response.status).toBe(202);
        expect(body).toMatchObject({ state: 'sent', profileId: invitedId });
        expect(requireAdminCapability).toHaveBeenCalledWith(expect.anything(), 'operations.write');
        expect(mocked.profileQuery.ilike).toHaveBeenCalledWith('email', 'teacher@example.test');
        expect(mocked.inviteUserByEmail).toHaveBeenCalledWith('teacher@example.test', {
            data: { full_name: 'New Teacher' },
            redirectTo: 'http://localhost:4321/en/login',
        });
        expect(mocked.inviteUserByEmail.mock.calls[0][1].data).not.toHaveProperty('role');
        expect(mocked.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'staff.invitation.requested',
            entity_id: requestId,
            after: expect.objectContaining({
                identity_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
        }));
        expect(mocked.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'staff.invitation.sent',
            entity_id: invitedId,
        }));
    });

    it('requires access administration authority for an administrator invitation', async () => {
        const mocked = client();
        vi.mocked(createSupabaseAdminClient).mockReturnValue(mocked.admin as never);
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');

        const response = await POST(request(invitation({ target: 'admin' })) as never);

        expect(response.status).toBe(202);
        expect(requireAdminCapability).toHaveBeenCalledWith(expect.anything(), 'access.write');
    });

    it('does not send another invitation to an already verified exact account', async () => {
        const mocked = client({
            profiles: [{ id: invitedId, email: 'teacher@example.test', full_name: 'Teacher', role: 'student' }],
            authUser: {
                id: invitedId,
                email: 'teacher@example.test',
                email_confirmed_at: '2026-08-05T08:00:00.000Z',
            },
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(mocked.admin as never);
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');

        const response = await POST(request(invitation()) as never);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            state: 'existing_verified',
            profileId: invitedId,
        });
        expect(mocked.getUserById).toHaveBeenCalledWith(invitedId);
        expect(mocked.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('does not resend automatically when the exact account is still pending verification', async () => {
        const mocked = client({
            profiles: [{ id: invitedId, email: 'teacher@example.test', full_name: 'Teacher', role: 'student' }],
            authUser: {
                id: invitedId,
                email: 'teacher@example.test',
                email_confirmed_at: null,
            },
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(mocked.admin as never);
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');

        const response = await POST(request(invitation()) as never);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            state: 'existing_pending',
            profileId: invitedId,
        });
        expect(mocked.inviteUserByEmail).not.toHaveBeenCalled();
        expect(mocked.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
            action: 'staff.invitation.existing_pending',
            entity_id: invitedId,
        }));
    });

    it('rejects a replay whose recorded target or reason does not match', async () => {
        const mocked = client({
            auditRows: [{
                id: 'audit-1',
                admin_id: actor.id,
                after: {
                    target: 'admin',
                    reason: 'Different request',
                    identity_fingerprint: 'different',
                },
            }],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(mocked.admin as never);
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');

        const response = await POST(request(invitation()) as never);

        expect(response.status).toBe(409);
        expect(mocked.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('rejects reusing a request id for a different identity without logging PII', async () => {
        const mocked = client({
            auditRows: [{
                id: 'audit-1',
                admin_id: actor.id,
                after: {
                    target: 'teacher',
                    reason: 'Planned teacher onboarding',
                    identity_fingerprint: '0'.repeat(64),
                },
            }],
        });
        vi.mocked(createSupabaseAdminClient).mockReturnValue(mocked.admin as never);
        const { POST } = await import('../../src/pages/api/admin/staff-invitations');

        const response = await POST(request(invitation()) as never);

        expect(response.status).toBe(409);
        expect(mocked.inviteUserByEmail).not.toHaveBeenCalled();
    });
});
