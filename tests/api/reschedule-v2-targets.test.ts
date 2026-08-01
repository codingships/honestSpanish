import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutV2RescheduleError } from '../../src/lib/checkout-v2-reschedule';

const supabaseMocks = vi.hoisted(() => ({
    createSupabaseServerClient: vi.fn(),
}));

const targetMocks = vi.hoisted(() => ({
    assertCheckoutV2RescheduleTargetAvailable: vi.fn(),
    checkoutV2RescheduleRequestAlreadyRecorded: vi.fn(),
    listCheckoutV2RescheduleTargets: vi.fn(),
    normalizeCheckoutV2RescheduleTargetWindow: vi.fn(),
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: supabaseMocks.createSupabaseServerClient,
}));

vi.mock('../../src/lib/checkout-v2-reschedule-targets', () => ({
    assertCheckoutV2RescheduleTargetAvailable: targetMocks.assertCheckoutV2RescheduleTargetAvailable,
    checkoutV2RescheduleRequestAlreadyRecorded: targetMocks.checkoutV2RescheduleRequestAlreadyRecorded,
    listCheckoutV2RescheduleTargets: targetMocks.listCheckoutV2RescheduleTargets,
    normalizeCheckoutV2RescheduleTargetWindow: targetMocks.normalizeCheckoutV2RescheduleTargetWindow,
}));

const actorId = '10000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000003';
const from = '2099-08-08T00:00:00.000Z';
const to = '2099-08-09T00:00:00.000Z';

function authenticatedServer(userId: string | null = actorId) {
    return {
        auth: {
            getUser: vi.fn().mockResolvedValue({
                data: { user: userId ? { id: userId } : null },
                error: null,
            }),
        },
    };
}

function context(query = `sessionId=${sessionId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`) {
    return {
        request: {
            url: `https://example.test/api/calendar/reschedule-v2?${query}`,
            headers: { get: vi.fn() },
        },
        cookies: { get: vi.fn(), has: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

async function get(query?: string) {
    const { GET } = await import('../../src/pages/api/calendar/reschedule-v2');
    return GET(context(query) as never);
}

describe('GET /api/calendar/reschedule-v2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        supabaseMocks.createSupabaseServerClient.mockReturnValue(authenticatedServer());
        targetMocks.normalizeCheckoutV2RescheduleTargetWindow.mockReturnValue({ sessionId, from, to });
        targetMocks.listCheckoutV2RescheduleTargets.mockResolvedValue([{
            scheduledAt: '2099-08-08T10:00:00.000Z',
            operationKind: 'single_session',
            affectedScheduledAts: ['2099-08-08T10:00:00.000Z'],
        }]);
    });

    it('requires an authenticated user before listing targets', async () => {
        supabaseMocks.createSupabaseServerClient.mockReturnValue(authenticatedServer(null));

        const response = await get();

        expect(response.status).toBe(401);
        expect(targetMocks.listCheckoutV2RescheduleTargets).not.toHaveBeenCalled();
    });

    it('rejects an invalid or over-broad target window', async () => {
        targetMocks.normalizeCheckoutV2RescheduleTargetWindow.mockReturnValueOnce(null);

        const response = await get('sessionId=bad&from=bad&to=bad');

        expect(response.status).toBe(400);
        expect(targetMocks.listCheckoutV2RescheduleTargets).not.toHaveBeenCalled();
    });

    it('derives the actor from the authenticated session and returns only the target DTO', async () => {
        const response = await get(`sessionId=${sessionId}&actorId=attacker&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            targets: [{
                scheduledAt: '2099-08-08T10:00:00.000Z',
                operationKind: 'single_session',
                affectedScheduledAts: ['2099-08-08T10:00:00.000Z'],
            }],
        });
        expect(targetMocks.listCheckoutV2RescheduleTargets).toHaveBeenCalledWith({
            context: expect.any(Object),
            actorId,
            sessionId,
            from,
            to,
        });
    });

    it('maps ownership failures without exposing internal database details', async () => {
        targetMocks.listCheckoutV2RescheduleTargets.mockRejectedValueOnce(
            new CheckoutV2RescheduleError('RESCHEDULE_FORBIDDEN', 403),
        );

        const response = await get();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(403);
        expect(body).toEqual({
            error: 'Reschedule could not be completed',
            errorCode: 'RESCHEDULE_FORBIDDEN',
        });
        expect(JSON.stringify(body)).not.toContain('database');
    });

    it('fails closed when Google or the target contract cannot be verified', async () => {
        targetMocks.listCheckoutV2RescheduleTargets.mockRejectedValueOnce(
            new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503),
        );

        const response = await get();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({
            error: 'Reschedule could not be completed',
            errorCode: 'RESCHEDULE_RETRYABLE',
        });
    });
});
