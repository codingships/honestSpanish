import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getUser: vi.fn(),
    profileSingle: vi.fn(),
    update: vi.fn(),
    updatedMaybeSingle: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: vi.fn(() => ({
        auth: { getUser: mocks.getUser },
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: mocks.profileSingle,
        })),
    })),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({
        from: vi.fn(() => ({
            update: mocks.update.mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: mocks.updatedMaybeSingle,
        })),
    })),
}));

function context(body: unknown, origin = 'http://localhost:4321') {
    return {
        request: new Request('http://localhost:4321/api/auth/confirm-adult', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: origin,
            },
            body: JSON.stringify(body),
        }),
        cookies: { get: vi.fn(), set: vi.fn(), has: vi.fn() },
    };
}

describe('POST /api/auth/confirm-adult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getUser.mockResolvedValue({
            data: { user: { id: 'student-1', email: 'student@example.com' } },
            error: null,
        });
        mocks.profileSingle.mockResolvedValue({
            data: { id: 'student-1', role: 'student' },
            error: null,
        });
        mocks.updatedMaybeSingle.mockResolvedValue({
            data: {
                id: 'student-1',
                adult_confirmed: true,
                adult_confirmed_at: '2026-07-10T12:00:00.000Z',
                age_policy_version: '2026-07-10',
            },
            error: null,
        });
    });

    it('requires an explicit boolean confirmation before authentication or writes', async () => {
        const { POST } = await import('../../src/pages/api/auth/confirm-adult');
        const response = await POST(context({ adultConfirmed: 'true' }) as any);

        expect(response.status).toBe(400);
        expect(mocks.getUser).not.toHaveBeenCalled();
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('rejects cross-origin submissions', async () => {
        const { POST } = await import('../../src/pages/api/auth/confirm-adult');
        const response = await POST(context({ adultConfirmed: true }, 'https://evil.example') as any);

        expect(response.status).toBe(403);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('persists the server timestamp and current age-policy version for a student', async () => {
        const { POST } = await import('../../src/pages/api/auth/confirm-adult');
        const response = await POST(context({ adultConfirmed: true }) as any);
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(mocks.update).toHaveBeenCalledWith({
            adult_confirmed: true,
            adult_confirmed_at: expect.any(String),
            age_policy_version: '2026-07-10',
        });
        expect(body).toEqual({
            success: true,
            adultConfirmedAt: '2026-07-10T12:00:00.000Z',
            agePolicyVersion: '2026-07-10',
        });
    });

    it('does not expose the student re-attestation write to internal roles', async () => {
        mocks.profileSingle.mockResolvedValue({ data: { id: 'admin-1', role: 'admin' }, error: null });

        const { POST } = await import('../../src/pages/api/auth/confirm-adult');
        const response = await POST(context({ adultConfirmed: true }) as any);

        expect(response.status).toBe(409);
        expect(mocks.update).not.toHaveBeenCalled();
    });
});
