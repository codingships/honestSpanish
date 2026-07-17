export const CLOUDFLARE_READONLY_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;
export const CLOUDFLARE_READONLY_MAX_ATTEMPTS = CLOUDFLARE_READONLY_RETRY_DELAYS_MS.length + 1;

export type CloudflareReadonlyOperation = 'readback' | 'attestation';

export interface CloudflareReadonlyAttemptContext {
    readonly operation: CloudflareReadonlyOperation;
    readonly attempt: number;
    readonly maxAttempts: typeof CLOUDFLARE_READONLY_MAX_ATTEMPTS;
}

export type CloudflareReadonlyAttemptResult<T> =
    | {
        readonly state: 'proven';
        readonly value: T;
    }
    | {
        readonly state: 'retryable';
        readonly reason: string;
    }
    | {
        readonly state: 'definitive_failure';
        readonly reason: string;
    };

interface CloudflareReadonlyRetryMetadata {
    readonly attempts: number;
    readonly delaysMs: readonly number[];
}

export type CloudflareReadonlyRetryResult<T> =
    | (Extract<CloudflareReadonlyAttemptResult<T>, { state: 'proven' }>
        & CloudflareReadonlyRetryMetadata
        & { readonly exhausted: false })
    | (Extract<CloudflareReadonlyAttemptResult<T>, { state: 'retryable' }>
        & CloudflareReadonlyRetryMetadata
        & { readonly exhausted: true })
    | (Extract<CloudflareReadonlyAttemptResult<T>, { state: 'definitive_failure' }>
        & CloudflareReadonlyRetryMetadata
        & { readonly exhausted: false });

export interface CloudflareReadonlyRetryOptions<T> {
    /**
     * This helper accepts read-only Cloudflare evidence operations only. It has
     * no mutation callback, HTTP method, request body or provider-write hook.
     */
    readonly operation: CloudflareReadonlyOperation;
    readonly read: (
        context: Readonly<CloudflareReadonlyAttemptContext>,
    ) => CloudflareReadonlyAttemptResult<T> | Promise<CloudflareReadonlyAttemptResult<T>>;
    /** Injectable so tests and orchestrators can account for each fixed delay. */
    readonly wait?: (milliseconds: number) => void | Promise<void>;
}

const ALLOWED_OPTION_KEYS = new Set(['operation', 'read', 'wait']);

export function isRetryableCloudflareReadonlyStatus(
    status: number,
    additionalTransientStatuses: readonly number[] = [],
): boolean {
    return status === 429 || status >= 500 || additionalTransientStatuses.includes(status);
}

export function isRetryableCloudflareReadonlyError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (!(error instanceof Error)) return false;
    return error.name === 'AbortError'
        || error.name === 'TimeoutError'
        || /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH)\b|fetch failed|network error|timed out/iu.test(error.message);
}

/**
 * Retries only a Cloudflare readback or runtime attestation. A retryable result
 * is retried after 1s, 2s and 4s; the fourth retryable result is returned as an
 * exhausted, unproven result. Definitive failures and exceptions stop at once.
 *
 * Callers must perform provider mutations outside this helper. Unknown option
 * keys are rejected before `read` is called so a mutation hook cannot be passed
 * through the runtime API accidentally.
 */
export async function retryCloudflareReadonlyEvidence<T>(
    options: CloudflareReadonlyRetryOptions<T>,
): Promise<CloudflareReadonlyRetryResult<T>> {
    const configurationFailure = validateOptions(options);
    if (configurationFailure) {
        return {
            state: 'definitive_failure',
            reason: configurationFailure,
            attempts: 0,
            delaysMs: [],
            exhausted: false,
        };
    }

    const delaysMs: number[] = [];
    const wait = options.wait ?? defaultWait;

    for (let attempt = 1; attempt <= CLOUDFLARE_READONLY_MAX_ATTEMPTS; attempt += 1) {
        let result: CloudflareReadonlyAttemptResult<T>;
        try {
            result = await options.read(Object.freeze({
                operation: options.operation,
                attempt,
                maxAttempts: CLOUDFLARE_READONLY_MAX_ATTEMPTS,
            }));
        } catch (error) {
            return definitiveFailure(
                `Cloudflare read-only ${options.operation} threw: ${safeError(error)}`,
                attempt,
                delaysMs,
            );
        }

        const invalidReason = validateAttemptResult(result);
        if (invalidReason) {
            return definitiveFailure(invalidReason, attempt, delaysMs);
        }

        if (result.state === 'proven') {
            return {
                ...result,
                attempts: attempt,
                delaysMs: [...delaysMs],
                exhausted: false,
            };
        }
        if (result.state === 'definitive_failure') {
            return {
                ...result,
                attempts: attempt,
                delaysMs: [...delaysMs],
                exhausted: false,
            };
        }
        if (attempt === CLOUDFLARE_READONLY_MAX_ATTEMPTS) {
            return {
                ...result,
                attempts: attempt,
                delaysMs: [...delaysMs],
                exhausted: true,
            };
        }

        const delayMs = CLOUDFLARE_READONLY_RETRY_DELAYS_MS[attempt - 1];
        if (delayMs === undefined) {
            return definitiveFailure(
                'Cloudflare read-only retry delay is missing.',
                attempt,
                delaysMs,
            );
        }
        try {
            await wait(delayMs);
        } catch (error) {
            return definitiveFailure(
                `Cloudflare read-only retry wait threw: ${safeError(error)}`,
                attempt,
                delaysMs,
            );
        }
        delaysMs.push(delayMs);
    }

    return definitiveFailure(
        'Cloudflare read-only retry loop ended without a result.',
        CLOUDFLARE_READONLY_MAX_ATTEMPTS,
        delaysMs,
    );
}

function validateOptions<T>(options: CloudflareReadonlyRetryOptions<T>): string | null {
    if (!options || typeof options !== 'object') {
        return 'Cloudflare read-only retry options must be an object.';
    }
    const unknownKeys = Object.keys(options).filter((key) => !ALLOWED_OPTION_KEYS.has(key));
    if (unknownKeys.length > 0) {
        return `Cloudflare read-only retry rejected unsupported option keys: ${unknownKeys.sort().join(', ')}.`;
    }
    if (options.operation !== 'readback' && options.operation !== 'attestation') {
        return 'Cloudflare read-only retry operation must be readback or attestation.';
    }
    if (typeof options.read !== 'function') {
        return 'Cloudflare read-only retry requires a read function.';
    }
    if (options.wait !== undefined && typeof options.wait !== 'function') {
        return 'Cloudflare read-only retry wait must be a function when provided.';
    }
    return null;
}

function validateAttemptResult<T>(result: CloudflareReadonlyAttemptResult<T>): string | null {
    if (!result || typeof result !== 'object') {
        return 'Cloudflare read-only attempt returned an invalid result.';
    }
    if (result.state === 'proven') {
        return Object.prototype.hasOwnProperty.call(result, 'value')
            ? null
            : 'Cloudflare read-only proven result is missing its value.';
    }
    if (result.state === 'retryable' || result.state === 'definitive_failure') {
        return typeof result.reason === 'string' && result.reason.trim().length > 0
            ? null
            : `Cloudflare read-only ${result.state} result requires a non-empty reason.`;
    }
    return 'Cloudflare read-only attempt returned an unsupported state.';
}

function definitiveFailure<T>(
    reason: string,
    attempts: number,
    delaysMs: readonly number[],
): CloudflareReadonlyRetryResult<T> {
    return {
        state: 'definitive_failure',
        reason,
        attempts,
        delaysMs: [...delaysMs],
        exhausted: false,
    };
}

function defaultWait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
