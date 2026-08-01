import type { APIRoute } from 'astro';
import {
    CheckoutV2RescheduleError,
    normalizeCheckoutV2RescheduleInput,
    rescheduleCheckoutV2,
} from '../../../lib/checkout-v2-reschedule';
import {
    assertCheckoutV2RescheduleTargetAvailable,
    classifyCheckoutV2ReschedulePreflight,
    failCheckoutV2ReschedulePreflightConflict,
    listCheckoutV2RescheduleTargets,
    normalizeCheckoutV2RescheduleTargetWindow,
} from '../../../lib/checkout-v2-reschedule-targets';
import { triggerFulfillmentProcessing } from '../../../lib/internal-job-service';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
};

function json(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function rescheduleError(error: unknown): Response {
    if (error instanceof CheckoutV2RescheduleError) {
        return json({ error: 'Reschedule could not be completed', errorCode: error.code }, error.status);
    }
    console.error('[CheckoutV2Reschedule] Unexpected failure');
    return json({ error: 'Reschedule could not be completed', errorCode: 'RESCHEDULE_RETRYABLE' }, 503);
}

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const url = new URL(context.request.url);
    const request = normalizeCheckoutV2RescheduleTargetWindow({
        sessionId: url.searchParams.get('sessionId'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
    });
    if (!request) return json({ error: 'Invalid request' }, 400);

    try {
        const targets = await listCheckoutV2RescheduleTargets({
            context,
            actorId: user.id,
            ...request,
        });
        return json({ targets }, 200);
    } catch (error) {
        return rescheduleError(error);
    }
};

export const POST: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    let body: unknown;
    try {
        body = await context.request.json();
    } catch {
        return json({ error: 'Invalid request' }, 400);
    }
    const request = normalizeCheckoutV2RescheduleInput(body);
    if (!request) return json({ error: 'Invalid request' }, 400);

    try {
        const preflight = await classifyCheckoutV2ReschedulePreflight({
            actorId: user.id,
            ...request,
        });
        if (preflight.mode !== 'reconcile') {
            try {
                await assertCheckoutV2RescheduleTargetAvailable({
                    context,
                    actorId: user.id,
                    sessionId: request.sessionId,
                    newScheduledAt: request.newScheduledAt,
                    ignoredPendingRequestId: preflight.mode === 'revalidate'
                        ? preflight.ignoredPendingRequestId
                        : null,
                });
            } catch (error) {
                if (
                    preflight.mode === 'revalidate'
                    && error instanceof CheckoutV2RescheduleError
                    && error.code === 'RESCHEDULE_CONFLICT'
                ) {
                    await failCheckoutV2ReschedulePreflightConflict({
                        operationId: preflight.operationId,
                        actorId: user.id,
                        ...request,
                    });
                }
                throw error;
            }
        }
        const result = await rescheduleCheckoutV2({
            context,
            actorId: user.id,
            ...request,
        });
        triggerFulfillmentProcessing(context, result.operationKind === 'provisional_anchor' ? 6 : 3);
        return json({
            success: true,
            replayed: result.replayed,
        }, 200);
    } catch (error) {
        return rescheduleError(error);
    }
};
