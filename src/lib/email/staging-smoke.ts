import { getEmailFrom } from './client';
import { deliverPreReservedStagingSmokeEmail } from './delivery';
import { buildEmailPreview } from './previews';

export type StagingSmokeEmailOutcome = 'retryable' | 'sent' | 'terminal_failed';

export type StagingSmokeEmailResult = {
    errorCode: string | null;
    httpStatus: number | null;
    outcome: StagingSmokeEmailOutcome;
    providerId: string | null;
};

const RETRYABLE_PROVIDER_CODES = new Set([
    'application_error',
    'concurrent_idempotent_requests',
    'daily_quota_exceeded',
    'internal_server_error',
    'monthly_quota_exceeded',
    'rate_limit_exceeded',
]);

function safeProviderCode(value: unknown): string {
    if (typeof value !== 'string') return 'provider_unknown';
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 80);
    return normalized.length >= 2 ? normalized : 'provider_unknown';
}

function providerStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const raw = (error as { statusCode?: unknown; status?: unknown }).statusCode
        ?? (error as { status?: unknown }).status;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : null;
}

export function classifyStagingSmokeProviderError(error: unknown): StagingSmokeEmailResult {
    const code = safeProviderCode(
        error && typeof error === 'object' ? (error as { name?: unknown }).name : null,
    );
    const status = providerStatus(error);
    const retryable = RETRYABLE_PROVIDER_CODES.has(code)
        || status === null
        || status === 408
        || status === 429
        || status >= 500;
    return {
        errorCode: code,
        httpStatus: status,
        outcome: retryable ? 'retryable' : 'terminal_failed',
        providerId: null,
    };
}

function canonicalPayload(input: {
    from: string;
    html: string;
    subject: string;
    to: string;
}): string {
    return JSON.stringify({
        from: input.from,
        html: input.html,
        subject: input.subject,
        to: input.to,
    });
}

function toHex(buffer: ArrayBuffer): string {
    return [...new Uint8Array(buffer)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function buildStagingSmokeEmail(recipient: string) {
    const preview = buildEmailPreview('welcome');
    const payload = {
        from: getEmailFrom(),
        html: preview.html,
        subject: preview.subject,
        to: recipient.trim().toLowerCase(),
    };
    const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalPayload(payload)),
    );
    return { payload, payloadSha256: toHex(hash) };
}

export async function sendStagingSmokeEmail(
    payload: Awaited<ReturnType<typeof buildStagingSmokeEmail>>['payload'],
    idempotencyKey: string,
): Promise<StagingSmokeEmailResult> {
    const delivery = await deliverPreReservedStagingSmokeEmail({
        ...payload,
        idempotencyKey,
    });
    if (delivery.ok) {
        return {
            errorCode: null,
            httpStatus: null,
            outcome: 'sent',
            providerId: delivery.providerId,
        };
    }
    if (delivery.reason === 'policy_invalid') {
        return {
            errorCode: 'policy_invalid',
            httpStatus: null,
            outcome: 'terminal_failed',
            providerId: null,
        };
    }
    if (delivery.reason === 'provider_unavailable') {
        return {
            errorCode: 'provider_unavailable',
            httpStatus: null,
            outcome: 'retryable',
            providerId: null,
        };
    }
    return classifyStagingSmokeProviderError(delivery.error);
}
