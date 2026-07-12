export const TURNSTILE_CLOUDFLARE_REQUEST_TIMEOUT_MS = 20_000;

export interface CloudflareApiResponse<T> {
    success?: boolean;
    errors?: Array<{ code?: number; message?: string }>;
    messages?: unknown[];
    result?: T;
}

export class TurnstileCloudflareRequestTimeoutError extends Error {
    constructor(timeoutMs: number) {
        super(`Cloudflare Turnstile API request timed out after ${timeoutMs}ms; provider outcome is unknown.`);
        this.name = 'TurnstileCloudflareRequestTimeoutError';
    }
}

export class TurnstileCloudflareWriteOutcomeUnknownError extends Error {
    readonly status: number;

    constructor(status: number) {
        super(`Cloudflare Turnstile PUT returned HTTP ${status}; provider outcome is unknown.`);
        this.name = 'TurnstileCloudflareWriteOutcomeUnknownError';
        this.status = status;
    }
}

const deterministicPutRejectionStatuses = new Set([
    400, // malformed or invalid update payload
    401, // authentication rejected before authorization
    403, // authorization rejected
    404, // target widget or account not found
    405, // method rejected
    409, // conflicting update rejected
    413, // request rejected as too large
    415, // content type rejected
    422, // semantically invalid update rejected
    429, // request rejected by rate limiting
]);

export interface TurnstileCloudflareRequestOptions {
    apiToken: string;
    method: 'GET' | 'PUT';
    pathname: string;
    body?: unknown;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}

export async function requestTurnstileCloudflareApi<T>(
    options: TurnstileCloudflareRequestOptions,
): Promise<CloudflareApiResponse<T>> {
    const timeoutMs = options.timeoutMs ?? TURNSTILE_CLOUDFLARE_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error('Cloudflare Turnstile API timeout must be a positive integer.');
    }

    const controller = new AbortController();
    const fetchImpl = options.fetchImpl ?? fetch;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            reject(new TurnstileCloudflareRequestTimeoutError(timeoutMs));
        }, timeoutMs);
    });
    const request = (async (): Promise<CloudflareApiResponse<T>> => {
        const response = await fetchImpl(`https://api.cloudflare.com/client/v4${options.pathname}`, {
            method: options.method,
            headers: {
                Authorization: `Bearer ${options.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: controller.signal,
        });
        const payload = await response.json() as CloudflareApiResponse<T>;
        if (!response.ok && options.method === 'PUT') {
            const isProvenRejection = payload.success === false
                && deterministicPutRejectionStatuses.has(response.status);
            if (!isProvenRejection) {
                throw new TurnstileCloudflareWriteOutcomeUnknownError(response.status);
            }
        }
        if (!response.ok && payload.success !== false) {
            return {
                success: false,
                errors: [{ code: response.status, message: response.statusText }],
                result: payload as T,
            };
        }
        return payload;
    })();

    try {
        return await Promise.race([request, timeout]);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}
