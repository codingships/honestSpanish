import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    from: vi.fn(),
    verifyLeadEmailToken: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock('../../src/lib/lead-email-token', () => ({
    verifyLeadEmailToken: mocks.verifyLeadEmailToken,
}));

function leadQuery(result: { data: unknown; error: unknown }) {
    const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue(result),
    };
    return query;
}

function context(body: unknown) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
        },
    };
}

describe('/api/level-check-prefill', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyLeadEmailToken.mockResolvedValue(true);
    });

    it('returns the normalized email only for a valid signed lead link and disables caching', async () => {
        const leadId = '00000000-0000-4000-8000-000000000001';
        mocks.from.mockReturnValue(leadQuery({
            data: { id: leadId, email: ' Linked.Student@Example.COM ' },
            error: null,
        }));

        const { POST } = await import('../../src/pages/api/level-check-prefill');
        const result = await POST(context({ leadId, token: 'signed-token' }) as any);

        expect(result.status).toBe(200);
        expect(result.headers.get('Cache-Control')).toBe('private, no-store');
        expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
        await expect(result.json()).resolves.toEqual({ email: 'linked.student@example.com' });
        expect(mocks.verifyLeadEmailToken).toHaveBeenCalledWith({
            leadId,
            email: 'linked.student@example.com',
            token: 'signed-token',
        });
    });

    it('returns the same generic response when the signature is invalid', async () => {
        const leadId = '00000000-0000-4000-8000-000000000001';
        mocks.verifyLeadEmailToken.mockResolvedValue(false);
        mocks.from.mockReturnValue(leadQuery({
            data: { id: leadId, email: 'private@example.com' },
            error: null,
        }));

        const { POST } = await import('../../src/pages/api/level-check-prefill');
        const result = await POST(context({ leadId, token: 'wrong-token' }) as any);

        expect(result.status).toBe(404);
        await expect(result.json()).resolves.toEqual({ error: 'Invalid diagnostic link' });
    });

    it('rejects malformed input without querying personal data', async () => {
        const { POST } = await import('../../src/pages/api/level-check-prefill');
        const result = await POST(context({ leadId: 'not-a-uuid', token: 'token' }) as any);

        expect(result.status).toBe(404);
        expect(mocks.from).not.toHaveBeenCalled();
    });
});
