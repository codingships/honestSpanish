import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(),
}));

function context() {
    return {
        request: { headers: new Headers() },
        cookies: {},
    };
}

function client(input: {
    allowed?: boolean;
    capabilityError?: { code: string } | null;
    user?: { id: string; email: string } | null;
    userError?: { message: string } | null;
}) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: input.user === undefined ? { id: 'admin-1', email: 'admin@example.com' } : input.user },
                error: input.userError ?? null,
            }),
        },
        rpc: vi.fn().mockResolvedValue({
            data: input.allowed ?? false,
            error: input.capabilityError ?? null,
        }),
    };
}

describe('requireAdminCapability', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 before checking capabilities without an authenticated user', async () => {
        const supabase = client({ user: null });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(supabase as never);

        const { requireAdminCapability } = await import('../../src/lib/admin-access');
        const result = await requireAdminCapability(context() as never, 'operations.read');

        expect(result.error?.status).toBe(401);
        expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('returns 403 when the requested capability is absent', async () => {
        const supabase = client({ allowed: false });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(supabase as never);

        const { requireAdminCapability } = await import('../../src/lib/admin-access');
        const result = await requireAdminCapability(context() as never, 'finance.write');

        expect(result.error?.status).toBe(403);
        expect(supabase.rpc).toHaveBeenCalledWith('has_my_admin_capability', {
            p_capability: 'finance.write',
        });
    });

    it('fails closed with 503 when the capability source is unavailable', async () => {
        const supabase = client({ capabilityError: { code: 'PGRST202' } });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(supabase as never);

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { requireAdminCapability } = await import('../../src/lib/admin-access');
        const result = await requireAdminCapability(context() as never, 'catalog.read');

        expect(result.error?.status).toBe(503);
        expect(consoleSpy).toHaveBeenCalledWith(
            '[AdminAccess] Capability check unavailable',
            { code: 'PGRST202' },
        );
        consoleSpy.mockRestore();
    });

    it('returns the authenticated user only when PostgreSQL allows the capability', async () => {
        const supabase = client({ allowed: true });
        const { createSupabaseServerClient } = await import('../../src/lib/supabase-server');
        vi.mocked(createSupabaseServerClient).mockReturnValue(supabase as never);

        const { requireAdminCapability } = await import('../../src/lib/admin-access');
        const result = await requireAdminCapability(context() as never, 'content.write');

        expect(result.error).toBeNull();
        expect(result.user?.id).toBe('admin-1');
    });
});
