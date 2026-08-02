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
const EFFECT_TYPE_GOOGLE_DRIVE_COPY = 'google.drive.copy';
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
export type FulfillmentDriveCopyEffectContext = FulfillmentEmailEffectContext;

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

export type FulfillmentDriveCopyPayload = {
    documentName: string;
    exercisesFolderId: string;
    sessionId: string;
    templateId: string;
};

export type FulfillmentDriveCopyOutcome =
    | {
        documentId: string;
        documentUrl: string;
        outcome: 'accepted';
    }
    | {
        documentId?: string | null;
        documentUrl?: string | null;
        outcome: 'ambiguous';
    }
    | {
        outcome: 'retryable';
    };

export type FulfillmentDriveCopyResult = {
    documentId: string;
    documentUrl: string;
    replayed: boolean;
};

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

function driveCopyResultJson(
    documentId?: string | null,
    documentUrl?: string | null,
): Json {
    return {
        document_id: documentId ?? null,
        document_url: documentUrl ?? null,
    };
}

function readDriveCopyReplayResult(claim: {
    provider_id: string | null;
    result: Json | null;
}): FulfillmentDriveCopyResult {
    const result = claim.result;
    const documentId = claim.provider_id
        ?? (result && !Array.isArray(result) && typeof result === 'object'
            ? result.document_id
            : null);
    const documentUrl = result && !Array.isArray(result) && typeof result === 'object'
        ? result.document_url
        : null;

    if (typeof documentId !== 'string' || !documentId || typeof documentUrl !== 'string' || !documentUrl) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }
    return { documentId, documentUrl, replayed: true };
}

export async function runFulfillmentDriveCopyEffect(
    context: FulfillmentDriveCopyEffectContext,
    payload: FulfillmentDriveCopyPayload,
    copy: () => Promise<FulfillmentDriveCopyOutcome>,
): Promise<FulfillmentDriveCopyResult> {
    assertContext(context);
    const payloadSha256 = await deterministicSha256({
        channel: EFFECT_TYPE_GOOGLE_DRIVE_COPY,
        ...payload,
        version: 1,
    });
    const claim = await claimEffect(context, EFFECT_TYPE_GOOGLE_DRIVE_COPY, payloadSha256);

    if (!claim.claimed) {
        if (claim.effect_status === 'succeeded') return readDriveCopyReplayResult(claim);
        if (claim.effect_status === 'processing') {
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_IN_PROGRESS', false);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_MANUAL_REVIEW', true);
    }
    if (claim.effect_status !== 'processing') {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_CLAIM_FAILED', false);
    }

    let copyOutcome: FulfillmentDriveCopyOutcome = { outcome: 'ambiguous' };
    try {
        copyOutcome = await copy();
    } catch {
        copyOutcome = { outcome: 'ambiguous' };
    }

    if (copyOutcome.outcome === 'retryable') {
        const result = driveCopyResultJson();
        let finalized = false;
        try {
            finalized = await finalizeEffect({
                attemptGeneration: claim.attempt_generation,
                context,
                effectId: claim.effect_id,
                error: { code: 'google_drive_copy_retryable_failure' },
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
                reason: 'effect_finalization_lost_after_drive_retryable_failure',
                result,
            });
            throw new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', false);
        }
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_DELIVERY_FAILED', false);
    }

    const result = driveCopyResultJson(copyOutcome.documentId, copyOutcome.documentUrl);
    if (
        copyOutcome.outcome === 'ambiguous'
        || !copyOutcome.documentId
        || !copyOutcome.documentUrl
    ) {
        await bestEffortMarkAmbiguous({
            attemptGeneration: claim.attempt_generation,
            context,
            effectId: claim.effect_id,
            providerId: copyOutcome.documentId ?? null,
            reason: 'google_drive_copy_acceptance_ambiguous',
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
            providerId: copyOutcome.documentId,
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
            providerId: copyOutcome.documentId,
            reason: 'effect_finalization_lost_after_drive_copy',
            result,
        });
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS', false);
    }

    return {
        documentId: copyOutcome.documentId,
        documentUrl: copyOutcome.documentUrl,
        replayed: false,
    };
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

    const delivery = await deliverIdempotentEmail(
        {
            from,
            html: message.html,
            idempotencyKey,
            source: message.source,
            subject: message.subject,
            to: normalizedRecipient,
        },
        { supabaseAdmin: context.supabaseAdmin },
    );
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
     …18542 tokens truncated…s: message.attempts,
                error: error instanceof Error ? error.message : 'unknown_error',
            }));
            message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
        }
    }
}

const routes: Record<string, Handler> = {
    '/internal/jobs/process': handleProcessJobs,
    '/internal/jobs/process-exact': handleProcessExactJob,
    '/internal/runtime-attestation': handleRuntimeAttestation,
    '/internal/google/availability': handleAvailability,
    '/internal/google/filter-available-slots': handleFilterSlots,
    '/internal/drive/append-homework': handleAppendHomework,
    '/internal/account/link-google-drive': handleLinkGoogleDrive,
    '/internal/google/create-student-folder': handleCreateStudentFolder,
    '/internal/reminders/send': handleSendReminders,
    '/internal/reminders/send-exact': handleSendExactReminder,
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/health') {
            const appEnvironment = envString(env, 'PUBLIC_APP_ENV');
            const operationMode = envString(env, 'FULFILLMENT_RUNTIME_MODE');
            const workerIdentity = envString(env, 'WORKER_IDENTITY');
            const healthy = operationMode === 'active' && fulfillmentEnvironment(env) !== null;
            return json(healthy ? 200 : 503, {
                appEnvironment: appEnvironment ?? 'unconfigured',
                ok: healthy,
                operationMode: operationMode ?? 'unconfigured',
                service: 'fulfillment-worker',
                status: healthy ? 'ok' : 'invalid',
                workerIdentity: workerIdentity ?? 'unconfigured',
                runtime: 'cloudflare-workers',
                timestamp: new Date().toISOString(),
            });
        }

        if (url.pathname !== '/internal/runtime-attestation' && fulfillmentRuntimeMode(env) !== 'active') {
            return json(503, { errorCode: 'FULFILLMENT_DISABLED' });
        }

        if (!isAuthorized(request, env)) {
            return json(401, { error: 'Unauthorized' });
        }

        const route = routes[url.pathname];
        if (!route) {
            return json(404, { error: 'Not found' });
        }
        if (request.method !== 'POST') {
            return json(405, { errorCode: 'METHOD_NOT_ALLOWED' });
        }

        try {
            const result = await route(await readJson(request), env);
            const errorCode = result && typeof result === 'object' && 'errorCode' in result
                ? (result as { errorCode?: unknown }).errorCode
                : null;
            return json(typeof errorCode === 'string' ? 400 : 200, result);
        } catch (error) {
            const errorCode = error instanceof ExactFulfillmentJobError
                ? error.code
                : error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
                    ? 'REQUEST_TOO_LARGE'
                    : 'INTERNAL_OPERATION_FAILED';
            console.error(JSON.stringify({ event: 'fulfillment_request_failed', errorCode, path: url.pathname }));
            return json(errorCode === 'REQUEST_TOO_LARGE' ? 413 : 500, { errorCode });
        }
    },

    async queue(
        batch: MessageBatch<FulfillmentQueueMessage>,
        env: Env,
    ): Promise<void> {
        await handleQueue(batch, env);
    },

    async scheduled(
        _controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        if (fulfillmentRuntimeMode(env) !== 'active') {
            console.log(JSON.stringify({ event: 'fulfillment_scheduled_skipped', reason: 'runtime_disabled' }));
            return;
        }
        ctx.waitUntil(handleScheduled(env));
    },
} satisfies ExportedHandler<Env, FulfillmentQueueMessage>;
