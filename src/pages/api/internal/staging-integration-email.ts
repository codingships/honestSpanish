import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getEmailDeliveryPolicy } from '../../../lib/email/delivery';
import {
    buildStagingSmokeEmail,
    sendStagingSmokeEmail,
    type StagingSmokeEmailOutcome,
} from '../../../lib/email/staging-smoke';
import { timingSafeTextEqual } from '../../../lib/runtime-attestation';
import { readRuntimeEnv } from '../../../lib/runtime-env';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';

export const prerender = false;

const requestSchema = z.object({
    leaseGeneration: z.number().int().positive(),
    leaseName: z.literal('google-resend-write-smoke'),
    ownerToken: z.string().uuid(),
    recipient: z.string().trim().email().max(320),
    runId: z.string().uuid(),
    smokeMarker: z.string().regex(/^SMOKE-INTEGRATION-[A-Za-z0-9-]{20,160}$/),
}).strict();

type ClaimRow = {
    attempt_generation: number;
    claimed: boolean;
    email_status: string;
    idempotency_key: string;
    provider_id: string | null;
};

function response(status: number, body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

function isApprovedHost(hostname: string): boolean {
    return hostname === 'espanolhonesto-staging.alindev95.workers.dev'
        || /^[a-z0-9]+(?:-[a-z0-9]+)*-espanolhonesto-staging[.]alindev95[.]workers[.]dev$/.test(hostname);
}

function logFailure(errorCode: string, outcome: StagingSmokeEmailOutcome | 'rejected'): void {
    console.error(JSON.stringify({
        errorCode,
        event: 'staging_smoke_email_failed',
        outcome,
    }));
}

export const POST: APIRoute = async (context) => {
    const requestUrl = new URL(context.request.url);
    if (
        readRuntimeEnv('PUBLIC_APP_ENV', context) !== 'staging'
        || readRuntimeEnv('WORKER_IDENTITY', context) !== 'espanolhonesto-staging'
        || !isApprovedHost(requestUrl.hostname)
    ) {
        return response(404, { errorCode: 'STAGING_SMOKE_RUNTIME_INVALID' });
    }

    const internalSecret = readRuntimeEnv('INTERNAL_JOB_SECRET', context) ?? '';
    const bearer = context.request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!internalSecret || !timingSafeTextEqual(bearer, internalSecret)) {
        return response(401, { errorCode: 'STAGING_SMOKE_UNAUTHORIZED' });
    }

    const declaredLength = Number(context.request.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
        return response(413, { errorCode: 'STAGING_SMOKE_REQUEST_TOO_LARGE' });
    }

    let rawBody: unknown;
    try {
        const text = await context.request.text();
        if (text.length > 16_384) {
            return response(413, { errorCode: 'STAGING_SMOKE_REQUEST_TOO_LARGE' });
        }
        rawBody = JSON.parse(text) as unknown;
    } catch {
        return response(400, { errorCode: 'STAGING_SMOKE_INVALID_REQUEST' });
    }
    const parsed = requestSchema.safeParse(rawBody);
    if (!parsed.success) return response(400, { errorCode: 'STAGING_SMOKE_INVALID_REQUEST' });

    const policy = getEmailDeliveryPolicy();
    const recipient = parsed.data.recipient.toLowerCase();
    const configuredDailyLimit = Number(readRuntimeEnv('EMAIL_DAILY_RECIPIENT_LIMIT', context));
    const configuredMonthlyLimit = Number(readRuntimeEnv('EMAIL_MONTHLY_RECIPIENT_LIMIT', context));
    if (
        policy.appEnvironment !== 'staging'
        || policy.mode !== 'allowlist'
        || !policy.recipientAllowlist.has(recipient)
        || configuredDailyLimit !== policy.dailyLimit
        || configuredMonthlyLimit !== policy.monthlyLimit
        || !Number.isInteger(configuredDailyLimit)
        || !Number.isInteger(configuredMonthlyLimit)
        || configuredDailyLimit < 1
        || configuredDailyLimit > 10
        || configuredMonthlyLimit < 1
        || configuredMonthlyLimit > 100
        || !readRuntimeEnv('RESEND_API_KEY', context)
        || !(readRuntimeEnv('EMAIL_FROM', context) || readRuntimeEnv('RESEND_FROM_EMAIL', context))
    ) {
        return response(403, { errorCode: 'STAGING_SMOKE_EMAIL_POLICY_INVALID' });
    }

    const email = await buildStagingSmokeEmail(recipient);
    const supabase = createSupabaseAdminClient();
    const { data: claimRows, error: claimError } = await supabase.rpc(
        'claim_staging_integration_smoke_email',
        {
            p_base_host: requestUrl.host,
            p_daily_limit: policy.dailyLimit,
            p_generation: parsed.data.leaseGeneration,
            p_lease_name: parsed.data.leaseName,
            p_monthly_limit: policy.monthlyLimit,
            p_owner_token: parsed.data.ownerToken,
            p_payload_sha256: email.payloadSha256,
            p_run_id: parsed.data.runId,
            p_smoke_marker: parsed.data.smokeMarker,
        },
    );
    if (claimError) {
        logFailure('claim_rejected', 'rejected');
        return response(409, { errorCode: 'STAGING_SMOKE_EMAIL_CLAIM_REJECTED' });
    }
    const claim = claimRows?.[0] as ClaimRow | undefined;
    if (!claim) return response(503, { errorCode: 'STAGING_SMOKE_EMAIL_STATE_UNAVAILABLE' });
    if (!claim.claimed && claim.email_status === 'sent') {
        return response(200, {
            runId: parsed.data.runId,
            smokeMarker: parsed.data.smokeMarker,
            status: 'sent',
        });
    }
    if (!claim.claimed || claim.email_status !== 'sending') {
        return response(409, { errorCode: 'STAGING_SMOKE_EMAIL_IN_PROGRESS' });
    }

    const result = await sendStagingSmokeEmail(email.payload, claim.idempotency_key);
    const { data: finalized, error: finalizeError } = await supabase.rpc(
        'finalize_staging_integration_smoke_email',
        {
            p_attempt_generation: claim.attempt_generation,
            p_error_code: result.errorCode,
            p_generation: parsed.data.leaseGeneration,
            p_http_status: result.httpStatus,
            p_lease_name: parsed.data.leaseName,
            p_outcome: result.outcome,
            p_owner_token: parsed.data.ownerToken,
            p_provider_id: result.providerId,
            p_run_id: parsed.data.runId,
        },
    );
    if (finalizeError || finalized !== true) {
        logFailure('finalize_fence_rejected', result.outcome);
        return response(503, { errorCode: 'STAGING_SMOKE_EMAIL_FINALIZE_FAILED' });
    }
    if (result.outcome !== 'sent') {
        logFailure(result.errorCode ?? 'provider_unknown', result.outcome);
        return response(result.outcome === 'retryable' ? 503 : 422, {
            errorCode: result.outcome === 'retryable'
                ? 'STAGING_SMOKE_EMAIL_RETRYABLE'
                : 'STAGING_SMOKE_EMAIL_TERMINAL',
        });
    }

    return response(200, {
        runId: parsed.data.runId,
        smokeMarker: parsed.data.smokeMarker,
        status: 'sent',
    });
};
