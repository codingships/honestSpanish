import type { APIRoute } from 'astro';
import {
    CheckoutV2GuaranteeError,
    getCheckoutV2GuaranteeState,
    normalizeCheckoutV2GuaranteeRequest,
    normalizeCheckoutV2GuaranteeSubscriptionId,
    runCheckoutV2Guarantee,
    type CheckoutV2GuaranteeResult,
} from '../../../lib/checkout-v2-guarantee';
import { triggerFulfillmentProcessing } from '../../../lib/internal-job-service';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const jsonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
};

function json(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function isSameOrigin(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function responseStatus(result: CheckoutV2GuaranteeResult): number {
    if (['processing', 'refund_pending', 'manual_review'].includes(result.status)) return 202;
    if (result.status === 'retryable') return 503;
    if (result.status === 'closed') return 409;
    return 200;
}

function guaranteeError(error: unknown): Response {
    if (error instanceof CheckoutV2GuaranteeError) {
        return json({ guarantee: error.guarantee }, error.status);
    }
    console.error('[CheckoutV2Guarantee] Unexpected failure');
    return json({
        guarantee: {
            subscriptionId: null,
            status: 'retryable',
            refundAmountCents: 19_425,
            currency: 'eur',
            operationId: null,
            reason: 'GUARANTEE_RETRYABLE',
        },
    }, 503);
}

export const GET: APIRoute = async (context) => {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const subscriptionId = normalizeCheckoutV2GuaranteeSubscriptionId(
        new URL(context.request.url).searchParams.get('subscriptionId'),
    );
    if (!subscriptionId) return json({ error: 'Invalid request' }, 400);

    try {
        const result = await getCheckoutV2GuaranteeState({
            actorId: user.id,
            subscriptionId,
        });
        return json({ guarantee: result }, responseStatus(result));
    } catch (error) {
        return guaranteeError(error);
    }
};

export const POST: APIRoute = async (context) => {
    if (!isSameOrigin(context.request)) {
        return json({ error: 'Forbidden' }, 403);
    }

    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    let body: unknown;
    try {
        body = await context.request.json();
    } catch {
        return json({ error: 'Invalid request' }, 400);
    }
    const request = normalizeCheckoutV2GuaranteeRequest(body);
    if (!request) return json({ error: 'Invalid request' }, 400);

    try {
        const result = await runCheckoutV2Guarantee({
            context,
            actorId: user.id,
            ...request,
        });
        if (result.operationId) triggerFulfillmentProcessing(context, 5);
        return json({ guarantee: result }, responseStatus(result));
    } catch (error) {
        return guaranteeError(error);
    }
};
