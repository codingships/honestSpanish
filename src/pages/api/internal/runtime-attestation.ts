import type { APIRoute } from 'astro';
import { env as cloudflareEnv } from 'cloudflare:workers';
import {
    createRuntimeAttestation,
    isValidAttestationNonce,
    timingSafeTextEqual,
} from '../../../lib/runtime-attestation';
import { readRuntimeEnv } from '../../../lib/runtime-env';

export const prerender = false;

const ATTESTED_KEYS = [
    'ADMIN_EMAIL',
    'CHECKOUT_ENABLED',
    'CHECKOUT_ENABLED_OVERRIDE',
    'CRON_SECRET',
    'EMAIL_DAILY_RECIPIENT_LIMIT',
    'EMAIL_DELIVERY_MODE',
    'EMAIL_FROM',
    'EMAIL_MONTHLY_RECIPIENT_LIMIT',
    'EMAIL_RECIPIENT_ALLOWLIST',
    'FULFILLMENT_WORKER_URL',
    'INTERNAL_JOB_SECRET',
    'LEVEL_CHECK_TOKEN_SECRET',
    'PUBLIC_APP_ENV',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'PUBLIC_SUPABASE_ANON_KEY',
    'PUBLIC_SUPABASE_URL',
    'RESEND_API_KEY',
    'RESEND_FROM_EMAIL',
    'SUPABASE_EXPECTED_PROJECT_REF',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPPORT_ALERT_EMAIL',
    'STRIPE_EXPECTED_ACCOUNT_ID',
    'STRIPE_PORTAL_CONFIGURATION_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'WEB_RUNTIME_MODE',
    'WORKER_IDENTITY',
] as const;

type VersionMetadata = { id?: unknown };

function readWorkerVersionId(): string | null {
    const metadata = (cloudflareEnv as { CF_VERSION_METADATA?: VersionMetadata }).CF_VERSION_METADATA;
    const id = metadata?.id;
    return typeof id === 'string' && id ? id : null;
}

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

export const POST: APIRoute = async (context) => {
    const appEnvironment = readRuntimeEnv('PUBLIC_APP_ENV', context);
    const expectedIdentity = appEnvironment === 'staging'
        ? 'espanolhonesto-staging'
        : appEnvironment === 'production'
            ? 'espanolhonesto'
            : null;
    const webRuntimeMode = readRuntimeEnv('WEB_RUNTIME_MODE', context);
    const validMode = appEnvironment === 'staging'
        ? webRuntimeMode === 'active'
        : appEnvironment === 'production'
            ? webRuntimeMode === 'bootstrap' || webRuntimeMode === 'active'
            : false;
    if (
        !expectedIdentity
        || !validMode
        || readRuntimeEnv('WORKER_IDENTITY', context) !== expectedIdentity
    ) {
        return response(404, { errorCode: 'ATTESTATION_RUNTIME_INVALID' });
    }
    const internalSecret = readRuntimeEnv('INTERNAL_JOB_SECRET', context) ?? '';
    const bearer = context.request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!internalSecret || !timingSafeTextEqual(bearer, internalSecret)) {
        return response(401, { errorCode: 'ATTESTATION_UNAUTHORIZED' });
    }

    const declaredLength = Number(context.request.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
        return response(413, { errorCode: 'ATTESTATION_REQUEST_TOO_LARGE' });
    }

    let body: unknown;
    try {
        const text = await context.request.text();
        if (text.length > 16_384) {
            return response(413, { errorCode: 'ATTESTATION_REQUEST_TOO_LARGE' });
        }
        body = JSON.parse(text) as unknown;
    } catch {
        return response(400, { errorCode: 'ATTESTATION_INVALID_REQUEST' });
    }
    const nonce = body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).nonce
        : null;
    if (!isValidAttestationNonce(nonce)) {
        return response(400, { errorCode: 'ATTESTATION_INVALID_REQUEST' });
    }

    try {
        const workerVersionId = readWorkerVersionId();
        if (!workerVersionId) return response(503, { errorCode: 'ATTESTATION_RUNTIME_INVALID' });
        const env = {
            ...Object.fromEntries(ATTESTED_KEYS.map((key) => [key, readRuntimeEnv(key, context)])),
            WORKER_VERSION_ID: workerVersionId,
        };
        return response(200, await createRuntimeAttestation('web', env, nonce));
    } catch {
        return response(503, { errorCode: 'ATTESTATION_RUNTIME_INVALID' });
    }
};
