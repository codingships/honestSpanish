import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutV2RescheduleOperation } from '../../src/lib/checkout-v2-reschedule';

const stripeMocks = vi.hoisted(() => ({
    accountRetrieve: vi.fn(),
    subscriptionRetrieve: vi.fn(),
    subscriptionUpdate: vi.fn(),
}));

const supabaseMocks = vi.hoisted(() => ({
    createSupabaseAdminClient: vi.fn(),
    createSupabaseServerClient: vi.fn(),
}));

const fulfillmentMocks = vi.hoisted(() => ({
    triggerFulfillmentProcessing: vi.fn(),
}));

const targetMocks = vi.hoisted(() => ({
    assertCheckoutV2RescheduleTargetAvailable: vi.fn(),
    classifyCheckoutV2ReschedulePreflight: vi.fn(),
    failCheckoutV2ReschedulePreflightConflict: vi.fn(),
    listCheckoutV2RescheduleTargets: vi.fn(),
    normalizeCheckoutV2RescheduleTargetWindow: vi.fn(),
}));

vi.mock('../../src/lib/stripe', () => ({
    stripe: {
        accounts: { retrieve: stripeMocks.accountRetrieve },
        subscriptions: {
            retrieve: stripeMocks.subscriptionRetrieve,
            update: stripeMocks.subscriptionUpdate,
        },
    },
}));

vi.mock('../../src/lib/supabase-admin', () => ({
    createSupabaseAdminClient: supabaseMocks.createSupabaseAdminClient,
}));

vi.mock('../../src/lib/supabase-server', () => ({
    createSupabaseServerClient: supabaseMocks.createSupabaseServerClient,
}));

vi.mock('../../src/lib/internal-job-service', () => ({
    triggerFulfillmentProcessing: fulfillmentMocks.triggerFulfillmentProcessing,
}));

vi.mock('../../src/lib/checkout-v2-reschedule-targets', () => ({
    assertCheckoutV2RescheduleTargetAvailable: targetMocks.assertCheckoutV2RescheduleTargetAvailable,
    classifyCheckoutV2ReschedulePreflight: targetMocks.classifyCheckoutV2ReschedulePreflight,
    failCheckoutV2ReschedulePreflightConflict: targetMocks.failCheckoutV2ReschedulePreflightConflict,
    listCheckoutV2RescheduleTargets: targetMocks.listCheckoutV2RescheduleTargets,
    normalizeCheckoutV2RescheduleTargetWindow: targetMocks.normalizeCheckoutV2RescheduleTargetWindow,
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: vi.fn((key: string) => {
        if (key === 'PUBLIC_APP_ENV') return 'staging';
        if (key === 'NODE_ENV') return 'production';
        if (key === 'STRIPE_EXPECTED_ACCOUNT_ID') return 'acct_test';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_reschedule';
        return undefined;
    }),
}));

const actorId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000002';
const sessionId = '30000000-0000-4000-8000-000000000003';
const subscriptionId = '40000000-0000-4000-8000-000000000004';
const cycleId = '50000000-0000-4000-8000-000000000005';
const operationId = '60000000-0000-4000-8000-000000000006';
const packagePriceId = '70000000-0000-4000-8000-000000000007';
const checkoutIntentId = '80000000-0000-4000-8000-000000000008';
const oldScheduledAt = '2099-08-01T10:00:00.000Z';
const oldAnchorAt = '2099-08-29T10:00:00.000Z';
const newScheduledAt = '2099-08-08T10:00:00.000Z';
const targetAnchorAt = '2099-09-05T10:00:00.000Z';
const mutationStartedAt = '2099-07-01T09:01:00.000Z';
const oldAnchorUnix = Math.floor(Date.parse(oldAnchorAt) / 1000);
const targetAnchorUnix = Math.floor(Date.parse(targetAnchorAt) / 1000);

type OperationKind = CheckoutV2RescheduleOperation['operation_kind'];
type OperationStatus = CheckoutV2RescheduleOperation['status'];
type DatabaseError = { code?: string; message?: string };

function operation(
    kind: OperationKind,
    status: OperationStatus = 'requested',
    overrides: Partial<CheckoutV2RescheduleOperation> = {},
): CheckoutV2RescheduleOperation {
    const terminalError = status === 'failed' || status === 'manual_review'
        ? 'test_terminal_outcome'
        : null;
    const startedAt = kind === 'provisional_anchor' && (status === 'applied' || status === 'manual_review')
        ? mutationStartedAt
        : null;
    return {
        id: operationId,
        request_id: requestId,
        session_id: sessionId,
        subscription_id: subscriptionId,
        cycle_id: cycleId,
        actor_id: actorId,
        operation_kind: kind,
        old_scheduled_at: oldScheduledAt,
        new_scheduled_at: newScheduledAt,
        expected_anchor_revision: 1,
        target_stripe_anchor_at: kind === 'provisional_anchor' ? targetAnchorAt : null,
        observed_stripe_anchor_at: status === 'applied' && kind === 'provisional_anchor'
            ? targetAnchorAt
            : null,
        stripe_mutation_started_at: startedAt,
        status,
        last_error: terminalError,
        applied_at: status === 'applied' ? '2099-07-01T10:00:00.000Z' : null,
        created_at: '2099-07-01T09:00:00.000Z',
        updated_at: '2099-07-01T10:00:00.000Z',
        ...overrides,
    };
}

function remoteSubscription(input: {
    target?: boolean;
    updatedMetadata?: boolean;
    operationMetadata?: boolean;
    priceActive?: boolean;
    status?: string;
} = {}) {
    return {
        id: 'sub_checkout_v2',
        customer: 'cus_checkout_v2',
        livemode: false,
        status: input.status ?? 'trialing',
        trial_end: input.target ? targetAnchorUnix : oldAnchorUnix,
        metadata: {
            contractSchemaVersion: '2',
            userId: actorId,
            checkoutIntentId,
            packagePriceId,
            firstClassAt: input.updatedMetadata ? newScheduledAt : oldScheduledAt,
            renewalAnchorAt: input.updatedMetadata ? targetAnchorAt : oldAnchorAt,
            ...(input.operationMetadata ? { rescheduleOperationId: operationId } : {}),
            preserved: 'yes',
        },
        items: {
            data: [{
                quantity: 1,
                price: {
                    id: 'price_recurring_28d',
                    active: input.priceActive ?? true,
                    type: 'recurring',
                    unit_amount: 25900,
                    currency: 'eur',
                    livemode: false,
                    product: 'prod_v2',
                    recurring: { interval: 'day', interval_count: 28 },
                },
            }],
        },
    };
}

function singleQuery(result: { data: unknown; error: unknown }) {
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.single = vi.fn().mockResolvedValue(result);
    return query;
}

function adminClient(input: {
    prepared?: CheckoutV2RescheduleOperation;
    prepareError?: DatabaseError | null;
    subscriptionReadError?: DatabaseError | null;
    beginError?: DatabaseError | null;
    beginReject?: Error | null;
    beginRejectAfterCommit?: Error | null;
    applyError?: DatabaseError | null;
    applyReject?: Error | null;
    markError?: DatabaseError | null;
} = {}) {
    let current = input.prepared ?? operation('single_session');
    const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
        if (name === 'prepare_checkout_v2_reschedule') {
            return { data: input.prepareError ? null : current, error: input.prepareError ?? null };
        }
        if (name === 'begin_checkout_v2_reschedule_stripe_mutation') {
            if (input.beginRejectAfterCommit) {
                current = {
                    ...current,
                    stripe_mutation_started_at: current.stripe_mutation_started_at ?? mutationStartedAt,
                    updated_at: mutationStartedAt,
                };
                throw input.beginRejectAfterCommit;
            }
            if (input.beginReject) throw input.beginReject;
            if (input.beginError) return { data: null, error: input.beginError };
            current = {
                ...current,
                stripe_mutation_started_at: current.stripe_mutation_started_at ?? mutationStartedAt,
                updated_at: mutationStartedAt,
            };
            return { data: current, error: null };
        }
        if (name === 'mark_checkout_v2_reschedule_outcome') {
            if (input.markError) return { data: null, error: input.markError };
            current = {
                ...current,
                status: args.p_status as 'failed' | 'manual_review',
                last_error: args.p_last_error as string,
                observed_stripe_anchor_at: typeof args.p_observed_stripe_anchor_at === 'string'
                    ? args.p_observed_stripe_anchor_at
                    : current.observed_stripe_anchor_at,
                applied_at: null,
                updated_at: '2099-07-01T09:02:00.000Z',
            };
            return { data: current, error: null };
        }
        if (name === 'apply_checkout_v2_reschedule') {
            if (input.applyReject) throw input.applyReject;
            if (input.applyError) return { data: null, error: input.applyError };
            const observedAnchor = typeof args.p_observed_stripe_anchor_at === 'string'
                ? args.p_observed_stripe_anchor_at.replace('.000Z', '+00:00')
                : null;
            current = {
                ...current,
                observed_stripe_anchor_at: observedAnchor,
                stripe_mutation_started_at: current.operation_kind === 'provisional_anchor'
                    ? current.stripe_mutation_started_at ?? mutationStartedAt
                    : null,
                status: 'applied',
                last_error: null,
                applied_at: '2099-07-01T10:00:00.000Z',
                updated_at: '2099-07-01T10:00:00.000Z',
            };
            return { data: current, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
    });
    const from = vi.fn((table: string) => {
        if (table === 'subscriptions' && input.subscriptionReadError) return singleQuery({
            data: null,
            error: input.subscriptionReadError,
        });
        if (table === 'subscriptions') return singleQuery({
            data: {
                id: subscriptionId,
                student_id: actorId,
                package_price_id: packagePriceId,
                checkout_intent_id: checkoutIntentId,
                contract_schema_version: 2,
                status: 'active',
                stripe_subscription_id: 'sub_checkout_v2',
            },
            error: null,
        });
        if (table === 'package_prices') return singleQuery({
            data: {
                id: packagePriceId,
                stripe_account_id: 'acct_test',
                stripe_livemode: false,
                stripe_product_id: 'prod_v2',
            },
            error: null,
        });
        if (table === 'checkout_v2_price_snapshots') return singleQuery({
            data: {
                package_price_id: packagePriceId,
                recurring_stripe_price_id: 'price_recurring_28d',
                recurring_amount_cents: 25900,
                currency: 'eur',
                recurring_interval_unit: 'day',
                recurring_interval_count: 28,
                stripe_account_id: 'acct_test',
                stripe_livemode: false,
            },
            error: null,
        });
        if (table === 'checkout_intents') return singleQuery({
            data: {
                id: checkoutIntentId,
                student_id: actorId,
                package_price_id: packagePriceId,
                stripe_customer_id: 'cus_checkout_v2',
            },
            error: null,
        });
        throw new Error(`Unexpected table ${table}`);
    });
    return { client: { rpc, from }, rpc, from, current: () => current };
}

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

function context(body: Record<string, unknown>) {
    return {
        request: {
            json: vi.fn().mockResolvedValue(body),
            headers: { get: vi.fn((name: string) => name === 'Cookie' ? 'sb=test' : null) },
            url: 'https://example.test/api/calendar/reschedule-v2',
        },
        cookies: { get: vi.fn(), has: vi.fn(), set: vi.fn() },
        locals: {},
    };
}

const validBody = { requestId, sessionId, newScheduledAt };

async function post(body: Record<string, unknown> = validBody) {
    const { POST } = await import('../../src/pages/api/calendar/reschedule-v2');
    return POST(context(body) as any);
}

function rpcNames(rpc: ReturnType<typeof vi.fn>): string[] {
    return rpc.mock.calls.map(([name]) => name as string);
}

describe('POST /api/calendar/reschedule-v2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        supabaseMocks.createSupabaseServerClient.mockReturnValue(authenticatedServer());
        stripeMocks.accountRetrieve.mockResolvedValue({ id: 'acct_test', country: 'US' });
        targetMocks.assertCheckoutV2RescheduleTargetAvailable.mockResolvedValue({
            scheduledAt: newScheduledAt,
            operationKind: 'single_session',
            affectedScheduledAts: [newScheduledAt],
        });
        targetMocks.classifyCheckoutV2ReschedulePreflight.mockResolvedValue({ mode: 'fresh' });
        targetMocks.failCheckoutV2ReschedulePreflightConflict.mockResolvedValue(undefined);
    });

    it('requires a cookie-authenticated user', async () => {
        supabaseMocks.createSupabaseServerClient.mockReturnValue(authenticatedServer(null));

        const response = await post();

        expect(response.status).toBe(401);
        expect(supabaseMocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it.each([
        { ...validBody, requestId: 'not-a-uuid' },
        { ...validBody, sessionId: 'not-a-uuid' },
        { ...validBody, newScheduledAt: '2099-08-08T10:00:00.123Z' },
        { ...validBody, newScheduledAt: '2099-02-31T10:00:00Z' },
        { ...validBody, newScheduledAt: '2099-04-31T10:00:00Z' },
        { ...validBody, newScheduledAt: '0000-01-01T10:00:00Z' },
        { ...validBody, newScheduledAt: '0001-01-01T00:00:00+14:00' },
        { ...validBody, newScheduledAt: '2099-08-08T10:00:00+14:01' },
    ])('rejects malformed identifiers and impossible or non-whole-second timestamps', async (body) => {
        const response = await post(body);

        expect(response.status).toBe(400);
        expect(supabaseMocks.createSupabaseAdminClient).not.toHaveBeenCalled();
    });

    it('uses the authenticated actor and applies a single session without a Stripe boundary', async () => {
        const admin = adminClient({
            prepared: operation('single_session', 'requested', {
                new_scheduled_at: '2099-08-08T10:00:00+00:00',
            }),
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post({ ...validBody, actorId: 'attacker-controlled' });

        expect(response.status).toBe(200);
        expect(targetMocks.assertCheckoutV2RescheduleTargetAvailable).toHaveBeenCalledWith({
            context: expect.any(Object),
            actorId,
            sessionId,
            newScheduledAt,
            ignoredPendingRequestId: null,
        });
        expect(admin.rpc).toHaveBeenNthCalledWith(1, 'prepare_checkout_v2_reschedule', {
            p_request_id: requestId,
            p_session_id: sessionId,
            p_actor_id: actorId,
            p_new_scheduled_at: newScheduledAt,
        });
        expect(admin.rpc).toHaveBeenNthCalledWith(2, 'apply_checkout_v2_reschedule', {
            p_operation_id: operationId,
            p_observed_stripe_anchor_at: null,
        });
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'apply_checkout_v2_reschedule',
        ]);
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
        expect(fulfillmentMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(expect.any(Object), 3);
    });

    it('fails closed before the durable operation when the confirmed Google/DB target is unavailable', async () => {
        targetMocks.assertCheckoutV2RescheduleTargetAvailable.mockRejectedValueOnce(
            new (await import('../../src/lib/checkout-v2-reschedule')).CheckoutV2RescheduleError(
                'RESCHEDULE_CONFLICT',
                409,
            ),
        );

        const response = await post();

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({
            error: 'Reschedule could not be completed',
            errorCode: 'RESCHEDULE_CONFLICT',
        });
        expect(supabaseMocks.createSupabaseAdminClient).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
        expect(fulfillmentMocks.triggerFulfillmentProcessing).not.toHaveBeenCalled();
    });

    it('does not re-run the external preflight for an applied replay', async () => {
        targetMocks.classifyCheckoutV2ReschedulePreflight.mockResolvedValueOnce({ mode: 'reconcile' });
        const admin = adminClient({ prepared: operation('single_session', 'applied') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ success: true, replayed: true });
        expect(targetMocks.assertCheckoutV2RescheduleTargetAvailable).not.toHaveBeenCalled();
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
    });

    it('revalidates Google and DB for a recorded request that has not crossed its mutation boundary', async () => {
        targetMocks.classifyCheckoutV2ReschedulePreflight.mockResolvedValueOnce({
            mode: 'revalidate',
            ignoredPendingRequestId: requestId,
            operationId,
        });
        const admin = adminClient({ prepared: operation('single_session', 'requested') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();

        expect(response.status).toBe(200);
        expect(targetMocks.assertCheckoutV2RescheduleTargetAvailable).toHaveBeenCalledWith({
            context: expect.any(Object),
            actorId,
            sessionId,
            newScheduledAt,
            ignoredPendingRequestId: requestId,
        });
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'apply_checkout_v2_reschedule',
        ]);
    });

    it('closes an exact pre-boundary request when target revalidation becomes a conflict', async () => {
        targetMocks.classifyCheckoutV2ReschedulePreflight.mockResolvedValueOnce({
            mode: 'revalidate',
            ignoredPendingRequestId: requestId,
            operationId,
        });
        targetMocks.assertCheckoutV2RescheduleTargetAvailable.mockRejectedValueOnce(
            new (await import('../../src/lib/checkout-v2-reschedule')).CheckoutV2RescheduleError(
                'RESCHEDULE_CONFLICT',
                409,
            ),
        );

        const response = await post();

        expect(response.status).toBe(409);
        expect(targetMocks.failCheckoutV2ReschedulePreflightConflict).toHaveBeenCalledWith({
            operationId,
            requestId,
            sessionId,
            actorId,
            newScheduledAt,
        });
        expect(fulfillmentMocks.triggerFulfillmentProcessing).not.toHaveBeenCalled();
    });

    it('retains the exact request on retryable revalidation and fails to review if closing races a boundary', async () => {
        targetMocks.classifyCheckoutV2ReschedulePreflight.mockResolvedValue({
            mode: 'revalidate',
            ignoredPendingRequestId: requestId,
            operationId,
        });
        const { CheckoutV2RescheduleError } = await import('../../src/lib/checkout-v2-reschedule');
        targetMocks.assertCheckoutV2RescheduleTargetAvailable.mockRejectedValueOnce(
            new CheckoutV2RescheduleError('RESCHEDULE_RETRYABLE', 503),
        );

        const retryable = await post();

        expect(retryable.status).toBe(503);
        expect(targetMocks.failCheckoutV2ReschedulePreflightConflict).not.toHaveBeenCalled();

        targetMocks.assertCheckoutV2RescheduleTargetAvailable.mockRejectedValueOnce(
            new CheckoutV2RescheduleError('RESCHEDULE_CONFLICT', 409),
        );
        targetMocks.failCheckoutV2ReschedulePreflightConflict.mockRejectedValueOnce(
            new CheckoutV2RescheduleError('RESCHEDULE_REQUIRES_REVIEW', 409),
        );

        const raced = await post();

        expect(raced.status).toBe(409);
        await expect(raced.json()).resolves.toEqual({
            error: 'Reschedule could not be completed',
            errorCode: 'RESCHEDULE_REQUIRES_REVIEW',
        });
    });

    it('maps an ownership rejection without exposing its database message', async () => {
        const admin = adminClient({
            prepareError: { code: '42501', message: 'session_reschedule_forbidden_internal' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(403);
        expect(body).toEqual({
            error: 'Reschedule could not be completed',
            errorCode: 'RESCHEDULE_FORBIDDEN',
        });
        expect(JSON.stringify(body)).not.toContain('internal');
    });

    it.each(['23P01', '23514'])('maps SQL conflict %s to an HTTP 409', async (code) => {
        const admin = adminClient({ prepareError: { code } });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
    });

    it('begins durably before Stripe, accepts an archived Price and records exact metadata', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve
            .mockResolvedValueOnce(remoteSubscription({ priceActive: false }))
            .mockResolvedValueOnce(remoteSubscription({
                target: true,
                updatedMetadata: true,
                operationMetadata: true,
                priceActive: false,
            }));
        stripeMocks.subscriptionUpdate.mockResolvedValue(remoteSubscription({
            target: true,
            updatedMetadata: true,
            operationMetadata: true,
            priceActive: false,
        }));

        const response = await post();

        expect(response.status).toBe(200);
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'begin_checkout_v2_reschedule_stripe_mutation',
            'apply_checkout_v2_reschedule',
        ]);
        expect(admin.rpc.mock.invocationCallOrder[1])
            .toBeLessThan(stripeMocks.subscriptionUpdate.mock.invocationCallOrder[0]);
        expect(stripeMocks.subscriptionUpdate).toHaveBeenCalledWith('sub_checkout_v2', {
            trial_end: targetAnchorUnix,
            proration_behavior: 'none',
            metadata: expect.objectContaining({
                preserved: 'yes',
                firstClassAt: newScheduledAt,
                renewalAnchorAt: targetAnchorAt,
                rescheduleOperationId: operationId,
            }),
        }, { idempotencyKey: `checkout-v2-reschedule:${operationId}` });
        expect(admin.rpc).toHaveBeenLastCalledWith('apply_checkout_v2_reschedule', {
            p_operation_id: operationId,
            p_observed_stripe_anchor_at: targetAnchorAt,
        });
        expect(fulfillmentMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(expect.any(Object), 6);
    });

    it('converges after an update timeout when recovery observes the exact operation target', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve
            .mockResolvedValueOnce(remoteSubscription())
            .mockResolvedValueOnce(remoteSubscription({
                target: true,
                updatedMetadata: true,
                operationMetadata: true,
            }));
        stripeMocks.subscriptionUpdate.mockRejectedValue(new Error('timeout'));

        const response = await post();

        expect(response.status).toBe(200);
        expect(stripeMocks.subscriptionRetrieve).toHaveBeenCalledTimes(2);
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'begin_checkout_v2_reschedule_stripe_mutation',
            'apply_checkout_v2_reschedule',
        ]);
    });

    it('marks manual review when a post-begin Stripe timeout does not converge', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve
            .mockResolvedValueOnce(remoteSubscription())
            .mockResolvedValueOnce(remoteSubscription());
        stripeMocks.subscriptionUpdate.mockRejectedValue(new Error('timeout'));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_REQUIRES_REVIEW');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'manual_review',
            p_last_error: 'stripe_update_did_not_converge',
        });
        expect(fulfillmentMocks.triggerFulfillmentProcessing).not.toHaveBeenCalled();
    });

    it('closes a safe pre-begin contract failure as failed', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription({ status: 'active' }));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'mark_checkout_v2_reschedule_outcome',
        ]);
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'stripe_contract_preflight_failed',
        });
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('preserves requested and returns 503 when the local contract read is transiently unavailable', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor'),
            subscriptionReadError: { code: '08006', message: 'connection failure' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(503);
        expect(body.errorCode).toBe('RESCHEDULE_RETRYABLE');
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('closes a deterministically missing local contract as failed', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor'),
            subscriptionReadError: { code: 'PGRST116', message: 'zero rows' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'local_contract_preflight_failed',
        });
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
    });

    it('preserves requested and returns 503 when Stripe preflight is transiently unavailable', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockRejectedValue(new Error('connection timeout'));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(503);
        expect(body.errorCode).toBe('RESCHEDULE_RETRYABLE');
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('closes a deterministic Stripe preflight rejection as failed', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockRejectedValue(Object.assign(
            new Error('No such subscription'),
            { statusCode: 404 },
        ));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'stripe_preflight_failed',
        });
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('marks a pre-begin remote divergence for manual review', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription({ target: true }));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_REQUIRES_REVIEW');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'manual_review',
            p_last_error: 'stripe_anchor_or_metadata_diverged',
        });
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('closes a deterministic begin rejection as failed before any Stripe write', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor'),
            beginError: { code: '23P01' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription());

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'stripe_mutation_boundary_rejected',
        });
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it.each([
        {
            boundary: 'before the local commit',
            beginReject: new Error('connection lost before commit confirmation'),
            beginRejectAfterCommit: null,
            expectedStartedAt: null,
        },
        {
            boundary: 'after the local commit',
            beginReject: null,
            beginRejectAfterCommit: new Error('connection lost after commit'),
            expectedStartedAt: mutationStartedAt,
        },
    ])('closes an ambiguous begin $boundary without a remote mutation when an exact retry observes the previous anchor', async ({
        beginReject,
        beginRejectAfterCommit,
        expectedStartedAt,
    }) => {
        const admin = adminClient({
            prepared: operation('provisional_anchor'),
            beginReject,
            beginRejectAfterCommit,
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription());

        const ambiguousResponse = await post();
        const ambiguousBody = await ambiguousResponse.json() as Record<string, unknown>;

        expect(ambiguousResponse.status).toBe(409);
        expect(ambiguousBody.errorCode).toBe('RESCHEDULE_REQUIRES_REVIEW');
        expect(admin.rpc).toHaveBeenNthCalledWith(3, 'mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'manual_review',
            p_last_error: 'stripe_mutation_boundary_rejected',
        });

        const exactRetryResponse = await post();
        const exactRetryBody = await exactRetryResponse.json() as Record<string, unknown>;

        expect(exactRetryResponse.status).toBe(409);
        expect(exactRetryBody.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'begin_checkout_v2_reschedule_stripe_mutation',
            'mark_checkout_v2_reschedule_outcome',
            'prepare_checkout_v2_reschedule',
            'mark_checkout_v2_reschedule_outcome',
        ]);
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'stripe_confirmed_at_previous_anchor',
            p_observed_stripe_anchor_at: oldAnchorAt,
        });
        expect(admin.current().stripe_mutation_started_at).toBe(expectedStartedAt);
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('does not return the resolved conflict until the previous-anchor closure RPC is confirmed', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor', 'manual_review', {
                stripe_mutation_started_at: null,
            }),
            markError: { code: '08006', message: 'connection failure' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription());

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(503);
        expect(body.errorCode).toBe('RESCHEDULE_RETRYABLE');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'stripe_confirmed_at_previous_anchor',
            p_observed_stripe_anchor_at: oldAnchorAt,
        });
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('recovers manual review at the exact target without writing Stripe again', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor', 'manual_review', {
                stripe_mutation_started_at: null,
            }),
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription({
            target: true,
            updatedMetadata: true,
            operationMetadata: true,
        }));

        const response = await post();

        expect(response.status).toBe(200);
        expect(rpcNames(admin.rpc)).toEqual([
            'prepare_checkout_v2_reschedule',
            'apply_checkout_v2_reschedule',
        ]);
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
        expect(admin.rpc).toHaveBeenLastCalledWith('apply_checkout_v2_reschedule', {
            p_operation_id: operationId,
            p_observed_stripe_anchor_at: targetAnchorAt,
        });
    });

    it('keeps a manual-review operation closed when Stripe is not at its exact target', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor', 'manual_review') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve.mockResolvedValue(remoteSubscription({ target: true }));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_REQUIRES_REVIEW');
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('marks manual review when database apply fails after verified Stripe convergence', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor'),
            applyError: { code: '40001' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);
        stripeMocks.subscriptionRetrieve
            .mockResolvedValueOnce(remoteSubscription())
            .mockResolvedValueOnce(remoteSubscription({
                target: true,
                updatedMetadata: true,
                operationMetadata: true,
            }));
        stripeMocks.subscriptionUpdate.mockResolvedValue(remoteSubscription({
            target: true,
            updatedMetadata: true,
            operationMetadata: true,
        }));

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_REQUIRES_REVIEW');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'manual_review',
            p_last_error: 'database_apply_failed_after_stripe_convergence',
        });
        expect(stripeMocks.subscriptionUpdate).toHaveBeenCalledTimes(1);
        expect(fulfillmentMocks.triggerFulfillmentProcessing).not.toHaveBeenCalled();
    });

    it('closes a single-session apply failure as failed', async () => {
        const admin = adminClient({
            prepared: operation('single_session'),
            applyError: { code: '23514' },
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(admin.rpc).toHaveBeenLastCalledWith('mark_checkout_v2_reschedule_outcome', {
            p_operation_id: operationId,
            p_status: 'failed',
            p_last_error: 'single_session_database_apply_failed',
        });
    });

    it('returns a failed replay as a conflict without touching Stripe or apply', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor', 'failed') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(409);
        expect(body.errorCode).toBe('RESCHEDULE_CONFLICT');
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('rejects a post-boundary failed replay without the exact previous-anchor audit shape', async () => {
        const admin = adminClient({
            prepared: operation('provisional_anchor', 'failed', {
                stripe_mutation_started_at: mutationStartedAt,
                observed_stripe_anchor_at: targetAnchorAt,
                last_error: 'stripe_confirmed_at_previous_anchor',
            }),
        });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(503);
        expect(body.errorCode).toBe('RESCHEDULE_RETRYABLE');
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
    });

    it('returns an applied replay without repeating Stripe or database effects and wakes fulfillment', async () => {
        const admin = adminClient({ prepared: operation('provisional_anchor', 'applied') });
        supabaseMocks.createSupabaseAdminClient.mockReturnValue(admin.client);

        const response = await post();
        const body = await response.json() as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(body.replayed).toBe(true);
        expect(rpcNames(admin.rpc)).toEqual(['prepare_checkout_v2_reschedule']);
        expect(stripeMocks.subscriptionRetrieve).not.toHaveBeenCalled();
        expect(stripeMocks.subscriptionUpdate).not.toHaveBeenCalled();
        expect(fulfillmentMocks.triggerFulfillmentProcessing).toHaveBeenCalledWith(expect.any(Object), 6);
    });
});
