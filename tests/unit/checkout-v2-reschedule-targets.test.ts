import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adminMocks = vi.hoisted(() => ({
    createSupabaseAdminClient: vi.fn(),
}));

const integrationMocks = vi.hoisted(() => ({
    shouldDisableExternalIntegrations: vi.fn(),
    isInternalJobServiceConfigured: vi.fn(),
    filterSlotsAgainstGoogleViaInternalService: vi.fn(),
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: adminMocks.createSupabaseAdminClient,
}));

vi.mock('../../src/lib/external-integrations', () => ({
    shouldDisableExternalIntegrations: integrationMocks.shouldDisableExternalIntegrations,
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    isInternalJobServiceConfigured: integrationMocks.isInternalJobServiceConfigured,
    filterSlotsAgainstGoogleViaInternalService: integrationMocks.filterSlotsAgainstGoogleViaInternalService,
}));

const actorId = '10000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000003';
const teacherId = '40000000-0000-4000-8000-000000000004';
const cycleId = '50000000-0000-4000-8000-000000000005';
const targetAt = '2099-08-08T10:00:00.000Z';
const affected = [
    '2099-08-08T10:00:00.000Z',
    '2099-08-15T10:00:00.000Z',
    '2099-08-22T10:00:00.000Z',
    '2099-08-29T10:00:00.000Z',
];

type Result = { data: unknown; error: { code?: string; message?: string } | null };

function adminClient(options: {
    rpcResult?: Result;
    sourceResult?: Result;
    teacherResult?: Result;
    identitiesResult?: Result;
} = {}) {
    const rpc = vi.fn().mockResolvedValue(options.rpcResult ?? {
        data: [{
            target_scheduled_at: targetAt,
            operation_kind: 'single_session',
            affected_scheduled_ats: [targetAt],
        }],
        error: null,
    });
    const sourceResult = options.sourceResult ?? {
        data: {
            id: sessionId,
            teacher_id: teacherId,
            duration_minutes: 50,
            checkout_v2_cycle_id: cycleId,
            calendar_event_id: null,
        },
        error: null,
    };
    const teacherResult = options.teacherResult ?? {
        data: { email: 'teacher@example.com' },
        error: null,
    };
    const identitiesResult = options.identitiesResult ?? {
        data: affected.map((_, index) => ({
            id: `${index + 1}0000000-0000-4000-8000-00000000000${index + 1}`,
            calendar_event_id: index === 0 ? 'provider-event-1' : null,
        })),
        error: null,
    };
    const from = vi.fn((table: string) => ({
        select: vi.fn(() => ({
            eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue(table === 'profiles' ? teacherResult : sourceResult),
                order: vi.fn().mockResolvedValue(identitiesResult),
            })),
        })),
    }));
    return { client: { rpc, from }, rpc, from };
}

function context(): Pick<APIContext, 'locals'> {
    return { locals: {} } as Pick<APIContext, 'locals'>;
}

describe('Checkout V2 reschedule target discovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        integrationMocks.shouldDisableExternalIntegrations.mockReturnValue(true);
        integrationMocks.isInternalJobServiceConfigured.mockReturnValue(true);
        integrationMocks.filterSlotsAgainstGoogleViaInternalService.mockImplementation(
            async (_context: unknown, input: { slots: unknown[] }) => input.slots,
        );
    });

    it('normalizes only UUID-scoped, whole-second windows of at most 48 hours', async () => {
        const { normalizeCheckoutV2RescheduleTargetWindow } = await import('../../src/lib/checkout-v2-reschedule-targets');

        expect(normalizeCheckoutV2RescheduleTargetWindow({
            sessionId,
            from: '2099-08-08T00:00:00Z',
            to: '2099-08-09T00:00:00+00:00',
        })).toEqual({
            sessionId,
            from: '2099-08-08T00:00:00.000Z',
            to: '2099-08-09T00:00:00.000Z',
        });
        expect(normalizeCheckoutV2RescheduleTargetWindow({
            sessionId,
            from: '2099-08-08T00:00:00.001Z',
            to: '2099-08-09T00:00:00Z',
        })).toBeNull();
        expect(normalizeCheckoutV2RescheduleTargetWindow({
            sessionId,
            from: '2099-08-08T00:00:00Z',
            to: '2099-08-11T00:00:00Z',
        })).toBeNull();
        expect(normalizeCheckoutV2RescheduleTargetWindow({
            sessionId: 'not-a-uuid',
            from: '2099-08-08T00:00:00Z',
            to: '2099-08-09T00:00:00Z',
        })).toBeNull();
    });

    it('returns the normalized service-role DTO without loading Calendar when integrations are disabled', async () => {
        const admin = adminClient();
        adminMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        const { listCheckoutV2RescheduleTargets } = await import('../../src/lib/checkout-v2-reschedule-targets');

        const targets = await listCheckoutV2RescheduleTargets({
            context: context(),
            actorId,
            sessionId,
            from: '2099-08-08T00:00:00.000Z',
            to: '2099-08-09T00:00:00.000Z',
        });

        expect(targets).toEqual([{
            scheduledAt: targetAt,
            operationKind: 'single_session',
            affectedScheduledAts: [targetAt],
        }]);
        expect(admin.rpc).toHaveBeenCalledWith('list_checkout_v2_reschedule_targets', {
            p_session_id: sessionId,
            p_actor_id: actorId,
            p_from: '2099-08-08T00:00:00.000Z',
            p_to: '2099-08-09T00:00:00.000Z',
            p_ignored_pending_request_id: null,
        });
        expect(admin.from).not.toHaveBeenCalled();
    });

    it('rejects malformed database rows instead of exposing uncertain targets', async () => {
        const admin = adminClient({
            rpcResult: {
                data: [{
                    target_scheduled_at: targetAt,
                    operation_kind: 'provisional_anchor',
                    affected_scheduled_ats: [targetAt],
                }],
                error: null,
            },
        });
        adminMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        const { listCheckoutV2RescheduleTargets } = await import('../../src/lib/checkout-v2-reschedule-targets');

        await expect(listCheckoutV2RescheduleTargets({
            context: context(), actorId, sessionId,
            from: targetAt,
            to: '2099-08-08T10:00:01.000Z',
        })).rejects.toMatchObject({ code: 'RESCHEDULE_RETRYABLE', status: 503 });
    });

    it('filters every affected provisional class against Google while ignoring its own four events', async () => {
        integrationMocks.shouldDisableExternalIntegrations.mockReturnValue(false);
        const admin = adminClient({
            rpcResult: {
                data: [{
                    target_scheduled_at: targetAt,
                    operation_kind: 'provisional_anchor',
                    affected_scheduled_ats: affected,
                }],
                error: null,
            },
        });
        adminMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        integrationMocks.filterSlotsAgainstGoogleViaInternalService.mockImplementationOnce(
            async (_context: unknown, input: { slots: Array<{ slot_start: string }> }) => input.slots.slice(0, 3),
        );
        const { listCheckoutV2RescheduleTargets } = await import('../../src/lib/checkout-v2-reschedule-targets');

        const targets = await listCheckoutV2RescheduleTargets({
            context: context(), actorId, sessionId,
            from: targetAt,
            to: '2099-08-08T10:00:01.000Z',
        });

        expect(targets).toEqual([]);
        expect(integrationMocks.filterSlotsAgainstGoogleViaInternalService).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                teacherEmail: 'teacher@example.com',
                slots: affected.map((slot_start) => ({
                    slot_start,
                    slot_end: new Date(Date.parse(slot_start) + 50 * 60_000).toISOString(),
                })),
                ignoredEventIds: [
                    'provider-event-1',
                    '20000000000040008000000000000002',
                    '30000000000040008000000000000003',
                    '40000000000040008000000000000004',
                ],
            }),
        );
    });

    it('fails closed before target confirmation when the internal Calendar service is unavailable', async () => {
        integrationMocks.shouldDisableExternalIntegrations.mockReturnValue(false);
        integrationMocks.isInternalJobServiceConfigured.mockReturnValue(false);
        const admin = adminClient();
        adminMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        const { assertCheckoutV2RescheduleTargetAvailable } = await import('../../src/lib/checkout-v2-reschedule-targets');

        await expect(assertCheckoutV2RescheduleTargetAvailable({
            context: context(), actorId, sessionId, newScheduledAt: targetAt,
        })).rejects.toMatchObject({ code: 'RESCHEDULE_RETRYABLE', status: 503 });
    });

    it('maps cross-tenant database rejection and rejects a target absent from the exact window', async () => {
        const forbidden = adminClient({ rpcResult: { data: null, error: { code: '42501' } } });
        adminMocks.createSupabaseAdminClient.mockReturnValueOnce(forbidden.client);
        const { assertCheckoutV2RescheduleTargetAvailable } = await import('../../src/lib/checkout-v2-reschedule-targets');

        await expect(assertCheckoutV2RescheduleTargetAvailable({
            context: context(), actorId, sessionId, newScheduledAt: targetAt,
        })).rejects.toMatchObject({ code: 'RESCHEDULE_FORBIDDEN', status: 403 });

        const missing = adminClient({ rpcResult: { data: [], error: null } });
        adminMocks.createSupabaseAdminClient.mockReturnValueOnce(missing.client);
        await expect(assertCheckoutV2RescheduleTargetAvailable({
            context: context(), actorId, sessionId, newScheduledAt: targetAt,
        })).rejects.toMatchObject({ code: 'RESCHEDULE_CONFLICT', status: 409 });
    });

    it('revalidates only an exact pending request before the mutation boundary', async () => {
        const operation = {
            id: '60000000-0000-4000-8000-000000000006',
            request_id: '20000000-0000-4000-8000-000000000002',
            session_id: sessionId,
            actor_id: actorId,
            new_scheduled_at: targetAt,
            operation_kind: 'single_session',
            status: 'requested',
            stripe_mutation_started_at: null,
        };
        const maybeSingle = vi.fn().mockResolvedValue({ data: operation, error: null });
        const chain = { eq: vi.fn(), maybeSingle };
        chain.eq.mockReturnValue(chain);
        const select = vi.fn(() => chain);
        const from = vi.fn(() => ({ select }));
        adminMocks.createSupabaseAdminClient.mockReturnValue({ from });
        const { classifyCheckoutV2ReschedulePreflight } = await import('../../src/lib/checkout-v2-reschedule-targets');

        await expect(classifyCheckoutV2ReschedulePreflight({
            requestId: operation.request_id,
            sessionId,
            actorId,
            newScheduledAt: targetAt,
        })).resolves.toEqual({
            mode: 'revalidate',
            ignoredPendingRequestId: operation.request_id,
            operationId: operation.id,
        });
        expect(from).toHaveBeenCalledWith('checkout_v2_reschedule_operations');
        expect(chain.eq).toHaveBeenCalledWith('request_id', operation.request_id);
        expect(chain.eq).toHaveBeenCalledWith('session_id', sessionId);
        expect(chain.eq).toHaveBeenCalledWith('actor_id', actorId);
        expect(chain.eq).toHaveBeenCalledWith('new_scheduled_at', targetAt);
    });

    it('bypasses fresh preflight only after the mutation boundary or for a terminal replay', async () => {
        const chain = { eq: vi.fn(), maybeSingle: vi.fn() };
        chain.eq.mockReturnValue(chain);
        const select = vi.fn(() => chain);
        adminMocks.createSupabaseAdminClient.mockReturnValue({ from: vi.fn(() => ({ select })) });
        const { classifyCheckoutV2ReschedulePreflight } = await import('../../src/lib/checkout-v2-reschedule-targets');

        chain.maybeSingle.mockResolvedValueOnce({
            data: {
                id: '60000000-0000-4000-8000-000000000006',
                request_id: '20000000-0000-4000-8000-000000000002',
                session_id: sessionId,
                actor_id: actorId,
                new_scheduled_at: targetAt,
                operation_kind: 'provisional_anchor',
                status: 'requested',
                stripe_mutation_started_at: '2099-08-01T09:00:00.000Z',
            },
            error: null,
        });
        await expect(classifyCheckoutV2ReschedulePreflight({
            requestId: '20000000-0000-4000-8000-000000000002',
            sessionId,
            actorId,
            newScheduledAt: targetAt,
        })).resolves.toEqual({ mode: 'reconcile' });

        chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
        await expect(classifyCheckoutV2ReschedulePreflight({
            requestId: '20000000-0000-4000-8000-000000000002',
            sessionId,
            actorId,
            newScheduledAt: targetAt,
        })).resolves.toEqual({ mode: 'fresh' });
    });

    it('closes only the exact pre-boundary operation after a confirmed target conflict', async () => {
        const rpc = vi.fn().mockResolvedValue({
            data: {
                id: '60000000-0000-4000-8000-000000000006',
                request_id: '20000000-0000-4000-8000-000000000002',
                session_id: sessionId,
                actor_id: actorId,
                new_scheduled_at: targetAt,
                status: 'failed',
                last_error: 'target_revalidation_conflict',
                stripe_mutation_started_at: null,
            },
            error: null,
        });
        adminMocks.createSupabaseAdminClient.mockReturnValue({ rpc });
        const { failCheckoutV2ReschedulePreflightConflict } = await import('../../src/lib/checkout-v2-reschedule-targets');

        await expect(failCheckoutV2ReschedulePreflightConflict({
            operationId: '60000000-0000-4000-8000-000000000006',
            requestId: '20000000-0000-4000-8000-000000000002',
            sessionId,
            actorId,
            newScheduledAt: targetAt,
        })).resolves.toBeUndefined();
        expect(rpc).toHaveBeenCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: '60000000-0000-4000-8000-000000000006',
            p_status: 'failed',
            p_last_error: 'target_revalidation_conflict',
            p_observed_stripe_anchor_at: null,
        });
    });

    it('requires review when a preflight conflict cannot be closed before the mutation boundary', async () => {
        adminMocks.createSupabaseAdminClient.mockReturnValue({
            rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '23514' } }),
        });
        const { failCheckoutV2ReschedulePreflightConflict } = await import('../../src/lib/checkout-v2-reschedule-targets');

        await expect(failCheckoutV2ReschedulePreflightConflict({
            operationId: '60000000-0000-4000-8000-000000000006',
            requestId: '20000000-0000-4000-8000-000000000002',
            sessionId,
            actorId,
            newScheduledAt: targetAt,
        })).rejects.toMatchObject({
            code: 'RESCHEDULE_REQUIRES_REVIEW',
            status: 409,
        });
    });
});
