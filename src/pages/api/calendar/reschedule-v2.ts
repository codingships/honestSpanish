import type { APIRoute } from 'astro';
import {
    CheckoutV2RescheduleError,
    normalizeCheckoutV2RescheduleInput,
    rescheduleCheckoutV2,
} from '../../../lib/checkout-v2-reschedule';
import { triggerFulfillmentProcessing } from '../../../lib/internal-job-service';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const jsonHeaders = { 'Content-Type': 'application/json' };

function json(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

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
        if (error instanceof CheckoutV2RescheduleError) {
            return json({ error: 'Reschedule could not be completed', errorCode: error.code }, error.status);
        }
        console.error('[CheckoutV2Reschedule] Unexpected failure');
        return json({ error: 'Reschedule could not be completed', errorCode: 'RESCHEDULE_RETRYABLE' }, 503);
    }
};
