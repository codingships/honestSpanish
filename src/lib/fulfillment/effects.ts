import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../types/database.types';
import {
    deliverIdempotentEmail,
    normalizeEmailAddressForDelivery,
    type IdempotentEmailDeliveryResult,
} from '../email/delivery';
import { getEmailFrom } from '../email/client';

const EFFECT_TYPE_RESEND_EMAIL = 'resend.email';
const EFFECT_TYPE_GOOGLE_CALENDAR_PATCH = 'google.calendar.patch';
const EFFECT_LEASE_SECONDS = 120;
const EFFECT_KEY_PATTERN = /^[a-z0-9][a-z0-9_.:/-]*$/;
const LEASE_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

export type FulfillmentEmailEffectContext = {
    effectKey: string;
    jobId: string;
    leaseOwner: string;
    supabaseAdmin: SupabaseClient<Database>;
};

export type FulfillmentCalendarEffectContext = FulfillmentEmailEffectContext;

export type FulfillmentEmailMessage = {
    email: string;
    html: string;
    source: string;
    subject: string;
};

export type FulfillmentCalendarPatchPayload = {
    eventId: string;
    operationId: string;
    previousScheduledAt: string;
    scheduledAt: string;
};

export type FulfillmentCalendarPatchOutcome = 'accepted' | 'ambiguous' | 'retryable';

export type FulfillmentEffectErrorCode =
    | 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS'
    | 'FULFILLMENT_EFFECT_CLAIM_FAILED'
    | 'FULFILLMENT_EFFECT_DELIVERY_FAILED'
    | 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS'
    | 'FULFILLMENT_EFFECT_IDENTITY_MISMATCH'
    | 'FULFILLMENT_EFFECT_IN_PROGRESS'
    | 'FULFILLMENT_EFFECT_INVALID_CONTEXT'
    | 'FULFILLMENT_EFFECT_MANUAL_REVIEW';

export class FulfillmentEffectError extends Error {
    constructor(
        public readonly code: FulfillmentEffectErrorCode,
        public readonly requiresManualReview: boolean,
    ) {
        super(code);
        this.name = 'FulfillmentEffectError';
    }
}

export function isFulfillmentEffectManualReviewError(
    error: unknown,
): error is FulfillmentEffectError {
    return error instanceof FulfillmentEffectError && error.requiresManualReview;
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Canonical JSON requires finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
    }
    throw new Error(`Unsupported canonical JSON value: ${typeof value}`);
}

export async function deterministicSha256(value: unknown): Promise<string> {
    const bytes = new TextEncoder().encode(canonicalJson(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function fulfillmentEmailIdempotencyKey(
    jobId: string,
    effectKey: string,
): string {
    const key = `fulfillment/${jobId}/${effectKey}`;
    if (key.length > 256) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_INVALID_CONTEXT', true);
    }
    return key;
}

function assertContext(context: FulfillmentEmailEffectContext): void {
    if (
        !context.jobId
        || context.effectKey.length < 1
        || context.effectKey.length > 200
        || !EFFECT_KEY_PATTERN.test(context.effectKey)
        || context.leaseOwner.length < 1
        || context.leaseOwner.length > 200
        || !LEASE_OWNER_PATTERN.test(context.leaseOwner)
    ) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_INVALID_CONTEXT', true);
    }
}

async function claimEffect(
    context: FulfillmentEmailEffectContext,
    effectType: string,
    payloadSha256: string,
) {
    const { data: claimRows, error: claimError } = await context.supabaseAdmin.rpc(
        'claim_fulfillment_effect',
        {
            p_effect_key: context.effectKey,
            p_effect_type: effectType,
            p_job_id: context.jobId,
            p_lease_owner: context.leaseOwner,
            p_lease_seconds: EFFECT_LEASE_SECONDS,
            p_payload_sha256: payloadSha256,
        },
    );

    if (claimError) {
        const messageText = claimError.message ?? '';
        if (messageText.includes('fulfillment_effect_identity_mismatch')) {
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_IDENTITY_MISMATCH', true);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_CLAIM_FAILED', false);
    }

    const claim = claimRows?.[0];
    if (!claim) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_CLAIM_FAILED', false);
    }
    return claim;
}

export async function runFulfillmentCalendarPatchEffect(
    context: FulfillmentCalendarEffectContext,
    payload: FulfillmentCalendarPatchPayload,
    patch: () => Promise<FulfillmentCalendarPatchOutcome>,
): Promise<{ replayed: boolean }> {
    assertContext(context);
    const payloadSha256 = await deterministicSha256({
        channel: EFFECT_TYPE_GOOGLE_CALENDAR_PATCH,
        ...payload,
        version: 1,
    });
    const claim = await claimEffect(context, EFFECT_TYPE_GOOGLE_CALENDAR_PATCH, payloadSha256);

    if (!claim.claimed) {
        if (claim.effect_status === 'succeeded') return { replayed: true };
        if (claim.effect_status === 'processing') {
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_IN_PROGRESS', false);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }
    if (claim.effect_status !== 'processing') {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_CLAIM_FAILED', false);
    }

    const result: Json = {
        event_id: payload.eventId,
        operation_id: payload.operationId,
    };
    let patchOutcome: FulfillmentCalendarPatchOutcome = 'ambiguous';
    try {
        patchOutcome = await patch();
    } catch {
        patchOutcome = 'ambiguous';
    }
    if (patchOutcome === 'retryable') {
        let finalized = false;
        try {
            finalized = await finalizeEffect({
                attemptGeneration: claim.attempt_generation,
                context,
                effectId: claim.effect_id,
                error: { code: 'google_calendar_patch_retryable_failure' },
                outcome: 'failed',
                result,
            });
        } catch {
            finalized = false;
        }
        if (!finalized) {
            await bestEffortMarkAmbiguous({
                attemptGeneration: claim.attempt_generation,
                context,
                effectId: claim.effect_id,
                reason: 'effect_finalization_lost_after_calendar_retryable_failure',
                result,
            });
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', false);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_DELIVERY_FAILED', false);
    }
    if (patchOutcome === 'ambiguous') {
        await bestEffortMarkAmbiguous({
            attemptGeneration: claim.attempt_generation,
            context,
            effectId: claim.effect_id,
            providerId: payload.eventId,
            reason: 'google_calendar_patch_acceptance_ambiguous',
            result,
        });
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS', true);
    }

    let finalized = false;
    try {
        finalized = await finalizeEffect({
            attemptGeneration: claim.attempt_generation,
            context,
            effectId: claim.effect_id,
            outcome: 'succeeded',
            providerId: payload.eventId,
            result,
        });
    } catch {
        finalized = false;
    }
    if (!finalized) {
        await bestEffortMarkAmbiguous({
            attemptGeneration: claim.attempt_generation,
            context,
            effectId: claim.effect_id,
            providerId: payload.eventId,
            reason: 'effect_finalization_lost_after_calendar_patch',
            result,
        });
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', true);
    }

    return { replayed: false };
}

function safeDeliveryError(result: Extract<IdempotentEmailDeliveryResult, { ok: false }>): Json {
    return {
        code: result.acceptance === 'ambiguous'
            ? 'provider_acceptance_ambiguous'
            : 'provider_did_not_accept',
        reason: result.reason,
    };
}

async function finalizeEffect(options: {
    attemptGeneration: number;
    context: FulfillmentEmailEffectContext;
    effectId: string;
    error?: Json | null;
    outcome: 'succeeded' | 'failed' | 'ambiguous' | 'manual_review';
    providerId?: string | null;
    result?: Json | null;
}): Promise<boolean> {
    const { data, error } = await options.context.supabaseAdmin.rpc(
        'finalize_fulfillment_effect',
        {
            p_attempt_generation: options.attemptGeneration,
            p_effect_id: options.effectId,
            p_error: options.error ?? null,
            p_lease_owner: options.context.leaseOwner,
            p_outcome: options.outcome,
            p_provider_id: options.providerId ?? null,
            p_result: options.result ?? null,
        },
    );
    return !error && data === true;
}

async function bestEffortMarkAmbiguous(options: {
    attemptGeneration: number;
    context: FulfillmentEmailEffectContext;
    effectId: string;
    providerId?: string | null;
    reason: string;
    result: Json;
}): Promise<void> {
    try {
        await finalizeEffect({
            attemptGeneration: options.attemptGeneration,
            context: options.context,
            effectId: options.effectId,
            error: { code: options.reason },
            outcome: 'ambiguous',
            providerId: options.providerId ?? null,
            result: options.result,
        });
    } catch {
        // A missing/expired lease is itself ambiguous. The owning job is
        // quarantined by the caller and no provider replay is attempted.
    }
}

export async function sendFulfillmentEmailEffect(
    context: FulfillmentEmailEffectContext,
    message: FulfillmentEmailMessage,
): Promise<{ idempotencyKey: string; providerId: string | null; replayed: boolean }> {
    assertContext(context);

    const normalizedRecipient = normalizeEmailAddressForDelivery(message.email)
        ?? message.email.trim().toLowerCase();
    const from = getEmailFrom();
    const idempotencyKey = fulfillmentEmailIdempotencyKey(context.jobId, context.effectKey);
    const payloadSha256 = await deterministicSha256({
        channel: EFFECT_TYPE_RESEND_EMAIL,
        from,
        html: message.html,
        source: message.source,
        subject: message.subject,
        to: normalizedRecipient,
        version: 1,
    });

    const claim = await claimEffect(context, EFFECT_TYPE_RESEND_EMAIL, payloadSha256);
    if (!claim.claimed) {
        if (claim.effect_status === 'succeeded') {
            return {
                idempotencyKey,
                providerId: claim.provider_id,
                replayed: true,
            };
        }
        if (claim.effect_status === 'processing') {
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_IN_PROGRESS', false);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }
    if (claim.effect_status !== 'processing') {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_CLAIM_FAILED', false);
    }

    const delivery = await deliverIdempotentEmail({
        from,
        html: message.html,
        idempotencyKey,
        source: message.source,
        subject: message.subject,
        to: normalizedRecipient,
    });
    const result: Json = { idempotency_key: idempotencyKey };

    if (!delivery.ok) {
        const outcome = delivery.acceptance === 'ambiguous' ? 'ambiguous' : 'failed';
        let finalized = false;
        try {
            finalized = await finalizeEffect({
                attemptGeneration: claim.attempt_generation,
                context,
                effectId: claim.effect_id,
                error: safeDeliveryError(delivery),
                outcome,
                result,
            });
        } catch {
            finalized = false;
        }
        if (!finalized) {
            await bestEffortMarkAmbiguous({
                attemptGeneration: claim.attempt_generation,
                context,
                effectId: claim.effect_id,
                reason: 'effect_finalization_lost_after_delivery_failure',
                result,
            });
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', false);
        }
        if (delivery.acceptance === 'ambiguous') {
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS', true);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_DELIVERY_FAILED', false);
    }

    let finalized = false;
    try {
        finalized = await finalizeEffect({
            attemptGeneration: claim.attempt_generation,
            context,
            effectId: claim.effect_id,
            outcome: 'succeeded',
            providerId: delivery.providerId,
            result,
        });
    } catch {
        finalized = false;
    }
    if (!finalized) {
        await bestEffortMarkAmbiguous({
            attemptGeneration: claim.attempt_generation,
            context,
            effectId: claim.effect_id,
            providerId: delivery.providerId,
            reason: 'effect_finalization_lost_after_provider_acceptance',
            result,
        });
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', false);
    }

    return {
        idempotencyKey,
        providerId: delivery.providerId,
        replayed: false,
    };
}
