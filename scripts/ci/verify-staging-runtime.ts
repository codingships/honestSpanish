type JsonRecord = Record<string, unknown>;

const webOrigin = (process.env.STAGING_WEB_URL ?? 'https://staging.espanolhonesto.com').replace(/\/$/u, '');
const fulfillmentOrigin = (
    process.env.STAGING_FULFILLMENT_URL
    ?? 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev'
).replace(/\/$/u, '');

async function requestJson(url: string, init?: RequestInit): Promise<{ body: JsonRecord; response: Response }> {
    const response = await fetch(url, {
        ...init,
        headers: {
            'Cache-Control': 'no-cache',
            ...init?.headers,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new Error(`${url} did not return JSON (status ${response.status}).`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`${url} returned an invalid JSON object.`);
    }
    return { body: body as JsonRecord, response };
}

function requireStatus(label: string, actual: number, expected: number): void {
    if (actual !== expected) throw new Error(`${label} returned ${actual}; expected ${expected}.`);
}

const webHealth = await requestJson(`${webOrigin}/health`);
requireStatus('Web health', webHealth.response.status, 200);
for (const [key, expected] of Object.entries({
    appEnvironment: 'staging',
    checkoutEnabled: false,
    runtimeMode: 'active',
    status: 'ok',
    workerIdentity: 'espanolhonesto-staging',
})) {
    if (webHealth.body[key] !== expected) {
        throw new Error(`Web health ${key}=${String(webHealth.body[key])}; expected ${String(expected)}.`);
    }
}

const fulfillmentHealth = await requestJson(`${fulfillmentOrigin}/health`);
requireStatus('Fulfillment health', fulfillmentHealth.response.status, 200);
for (const [key, expected] of Object.entries({
    ok: true,
    operationMode: 'active',
    runtime: 'cloudflare-workers',
    service: 'fulfillment-worker',
    workerIdentity: 'espanol-honesto-fulfillment-staging',
})) {
    if (fulfillmentHealth.body[key] !== expected) {
        throw new Error(`Fulfillment health ${key}=${String(fulfillmentHealth.body[key])}; expected ${String(expected)}.`);
    }
}

const unauthorizedJob = await requestJson(`${fulfillmentOrigin}/internal/jobs/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
});
requireStatus('Unauthenticated fulfillment route', unauthorizedJob.response.status, 401);
if (unauthorizedJob.body.error !== 'Unauthorized') {
    throw new Error('Fulfillment route did not fail closed for an unauthenticated request.');
}

const disabledCheckout = await requestJson(`${webOrigin}/api/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
});
requireStatus('Disabled checkout', disabledCheckout.response.status, 403);
if (disabledCheckout.body.error !== 'Checkout is disabled') {
    throw new Error('Checkout did not return the expected fail-closed response.');
}

console.log('[verify-staging-runtime] Web and fulfillment are healthy; internal jobs and checkout fail closed.');
