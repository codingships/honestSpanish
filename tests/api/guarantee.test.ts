import { beforeEach, describe, expect, it, vi } from 'vitest';

const guaranteeMocks = vi.hoisted(() => ({
    getState: vi.fn(),
    normalize: vi.fn(),
    normalizeSubscriptionId: vi.fn(),
    run: vi.fn(),
    GuaranteeError: class GuaranteeError extends Error {
        constructor(
            public readonly status: number,
            public readonly guarantee: Record<string, unknown>,
        ) {
            super('guarantee');
        }
    },
}));
const serverMocks = vi.hoisted(() => ({ create: vi.fn() }));
const fulfillmentMocks = vi.hoisted(() => ({ trigger: vi.fn() }));

vi.mock('../../src/lib/checkout-v2-guarantee', () => ({
    CheckoutV2GuaranteeError: guaranteeMocks.GuaranteeError,
    getCheckoutV2GuaranteeState: guaranteeMocks.getState,
    normalizeCheckoutV2GuaranteeRequest: guaranteeMocks.normalize,
    normalizeCheckoutV2GuaranteeSubscriptionId: guaranteeMocks.normalizeSubscriptionId,
    runCheckoutV2Guarantee: guaranteeMocks.run,
}));
vi.mock('../../src/lib/supabase-server', () => ({ createSupabaseServerClient: serverMocks.create }));
vi.mock('../../src/lib/internal-job-service', () => ({ triggerFulfillmentProcessing: fulfillmentMocks.trigger }));

const userId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const subscriptionId = '30000000-0000-4000-8000-000000000003';
const operationId = '40000000-0000-4000-8000-000000000004';

function context(method: 'GET' | 'POST', body?: unknown, origin = 'https://example.test') {
    return {
        request: new Request(
            method === 'GET'
                ? `https://example.test/api/account/guarantee?subscriptionId=${subscriptionId}`
                : 'https://example.test/api/account/guarantee',
            {
                method,
                headers: method === 'POST'
                    ? { 'Content-Type': 'application/json', Origin: origin }
                    : undefined,
                body: method === 'POST' ? JSON.stringify(body) : undefined,
            },
        ),
        locals: {},
    } as never;
}

function guarantee(status: string) {
    return {
        subscriptionId,
        status,
        refundAmountCents: 19_425,
        currency: 'eur',
        operationId,
        reason: null,
    };
}

describe('account guarantee API', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        serverMocks.create.mockReturnValue({
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
        });
        guaranteeMocks.normalize.mockImplementation((value: unknown) => value);
        guaranteeMocks.normalizeSubscriptionId.mockImplementation((value: unknown) => value);
    });

    it('returns the authoritative state without caching it', async () => {
        guaranteeMocks.getState.mockResolvedValue(guarantee('eligible'));
        const { GET } = await import('../../src/pages/api/account/guarantee');
        const response = await GET(context('GET'));

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        await expect(response.json()).resolves.toEqual({ guarantee: guarantee('eligible') });
        expect(guaranteeMocks.getState).toHaveBeenCalledWith({ actorId: userId, subscriptionId });
    });

    it('rejects a malformed GET subscription before querying state', async () => {
        guaranteeMocks.normalizeSubscriptionId.mockReturnValueOnce(null);
        const { GET } = await import('../../src/pages/api/account/guarantee');
        const response = await GET(context('GET'));
        expect(response.status).toBe(400);
        expect(guaranteeMocks.getState).not.toHaveBeenCalled();
    });

    it.each(['processing', 'refund_pending', 'manual_review'])('returns 202 for %s', async (status) => {
        guaranteeMocks.run.mockResolvedValue(guarantee(status));
        const { POST } = await import('../../src/pages/api/account/guarantee');
        const response = await POST(context('POST', { requestId, subscriptionId }));
        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({ guarantee: guarantee(status) });
    });

    it.each([
        ['closed', 409],
        ['retryable', 503],
    ])('returns the contract HTTP status for %s state', async (status, expectedStatus) => {
        guaranteeMocks.getState.mockResolvedValue(guarantee(status));
        const { GET } = await import('../../src/pages/api/account/guarantee');
        const response = await GET(context('GET'));
        expect(response.status).toBe(expectedStatus);
        await expect(response.json()).resolves.toEqual({ guarantee: guarantee(status) });
    });

    it('rejects a cross-origin mutation before authentication', async () => {
        const { POST } = await import('../../src/pages/api/account/guarantee');
        const response = await POST(context('POST', { requestId, subscriptionId }, 'https://evil.test'));
        expect(response.status).toBe(403);
        expect(serverMocks.create).not.toHaveBeenCalled();
    });

    it('rejects a mutation without an Origin header before authentication', async () => {
        const { POST } = await import('../../src/pages/api/account/guarantee');
        const response = await POST({
            request: new Request('https://example.test/api/account/guarantee', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, subscriptionId }),
            }),
            locals: {},
        } as never);

        expect(response.status).toBe(403);
        expect(serverMocks.create).not.toHaveBeenCalled();
    });

    it('returns the stable guarantee envelope for closed and retryable outcomes', async () => {
        const { POST } = await import('../../src/pages/api/account/guarantee');
        const closed = { ...guarantee('closed'), reason: 'GUARANTEE_CLOSED' };
        guaranteeMocks.run.mockRejectedValueOnce(new guaranteeMocks.GuaranteeError(409, closed));
        const closedResponse = await POST(context('POST', { requestId, subscriptionId }));
        expect(closedResponse.status).toBe(409);
        await expect(closedResponse.json()).resolves.toEqual({ guarantee: closed });

        const retryable = { ...guarantee('retryable'), reason: 'GUARANTEE_RETRYABLE' };
        guaranteeMocks.run.mockRejectedValueOnce(new guaranteeMocks.GuaranteeError(503, retryable));
        const retryResponse = await POST(context('POST', { requestId, subscriptionId }));
        expect(retryResponse.status).toBe(503);
        await expect(retryResponse.json()).resolves.toEqual({ guarantee: retryable });
    });

    it('requires authentication and a normalized UUID request', async () => {
        serverMocks.create.mockReturnValueOnce({
            auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
        });
        const { POST } = await import('../../src/pages/api/account/guarantee');
        expect((await POST(context('POST', { requestId, subscriptionId }))).status).toBe(401);

        guaranteeMocks.normalize.mockReturnValueOnce(null);
        expect((await POST(context('POST', { requestId: 'bad' }))).status).toBe(400);
        expect(guaranteeMocks.run).not.toHaveBeenCalled();
    });
});
