import {
    STAGING_FULFILLMENT_ORIGIN,
    STAGING_WEB_ORIGIN,
    assertExpectedStagingRuntimeInput,
    verifyDeployedStagingRuntime,
} from '../smoke/deployed-runtime-safety';

type JsonRecord = Record<string, unknown>;

const maxAttempts = 6;
const retryDelayMs = 5_000;
const versionIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

function requireValue(name: string): string {
    const value = process.env[name]?.trim() ?? '';
    if (!value) throw new Error(`Staging runtime verification requires ${name}.`);
    return value;
}

function exactStagingOrigin(
    envName: 'STAGING_WEB_URL' | 'STAGING_FULFILLMENT_URL',
    expected: string,
): string {
    const configured = (process.env[envName] ?? expected).trim().replace(/\/$/u, '');
    if (configured !== expected) throw new Error(`${envName} must equal the canonical staging origin.`);
    return configured;
}

function exactVersionId(name: 'STAGING_EXPECTED_WEB_VERSION_ID' | 'STAGING_EXPECTED_FULFILLMENT_VERSION_ID'): string {
    const versionId = requireValue(name);
    if (!versionIdPattern.test(versionId)) {
        throw new Error(`${name} must be an exact Cloudflare Worker version ID.`);
    }
    return versionId;
}

const webOrigin = exactStagingOrigin('STAGING_WEB_URL', STAGING_WEB_ORIGIN);
const fulfillmentOrigin = exactStagingOrigin('STAGING_FULFILLMENT_URL', STAGING_FULFILLMENT_ORIGIN);
const roleEmails = [
    requireValue('TEST_STUDENT_EMAIL'),
    requireValue('TEST_TEACHER_EMAIL'),
    requireValue('TEST_ADMIN_EMAIL'),
];

function assertExpectedRuntimeSource(): void {
    assertExpectedStagingRuntimeInput({
        baseOrigin: webOrigin,
        env: process.env,
        fulfillmentOrigin,
        roleEmails,
    });
}

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

function requireFields(label: string, body: JsonRecord, expected: JsonRecord): void {
    for (const [key, value] of Object.entries(expected)) {
        if (body[key] !== value) {
            throw new Error(`${label} ${key}=${String(body[key])}; expected ${String(value)}.`);
        }
    }
}

async function verifyInnocuousRuntimeProbes(): Promise<void> {
    await Promise.all([
        requestJson(`${webOrigin}/health`).then((webHealth) => {
            requireStatus('Web health', webHealth.response.status, 200);
            requireFields('Web health', webHealth.body, {
                appEnvironment: 'staging',
                checkoutEnabled: false,
                runtimeMode: 'active',
                status: 'ok',
                workerIdentity: 'espanolhonesto-staging',
            });
        }),
        requestJson(`${fulfillmentOrigin}/health`).then((fulfillmentHealth) => {
            requireStatus('Fulfillment health', fulfillmentHealth.response.status, 200);
            requireFields('Fulfillment health', fulfillmentHealth.body, {
                ok: true,
                operationMode: 'active',
                runtime: 'cloudflare-workers',
                service: 'fulfillment-worker',
                workerIdentity: 'espanol-honesto-fulfillment-staging',
            });
        }),
        requestJson(`${fulfillmentOrigin}/internal/jobs/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then((unauthorizedJob) => {
            requireStatus('Unauthenticated fulfillment route', unauthorizedJob.response.status, 401);
            if (unauthorizedJob.body.error !== 'Unauthorized') {
                throw new Error('Fulfillment route did not fail closed for an unauthenticated request.');
            }
        }),
        requestJson(`${webOrigin}/api/create-checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then((disabledCheckout) => {
            requireStatus('Disabled checkout', disabledCheckout.response.status, 403);
            if (disabledCheckout.body.error !== 'Checkout is disabled') {
                throw new Error('Checkout did not return the expected fail-closed response.');
            }
        }),
    ]);
}

async function verifyStagingRuntimeOnce(
    expectedWebVersionId: string,
    expectedFulfillmentVersionId: string,
): Promise<void> {
    const verified = await verifyDeployedStagingRuntime({
        baseOrigin: webOrigin,
        env: process.env,
        expectedFulfillmentVersionId,
        expectedWebVersionId,
        fulfillmentOrigin,
        roleEmails,
    });
    if (
        verified.webVersionId !== expectedWebVersionId
        || verified.fulfillmentVersionId !== expectedFulfillmentVersionId
    ) {
        throw new Error('Staging runtime did not return the exact versions activated by this deployment.');
    }
    await verifyInnocuousRuntimeProbes();
}

async function verifyStagingRuntime(
    expectedWebVersionId: string,
    expectedFulfillmentVersionId: string,
): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await verifyStagingRuntimeOnce(expectedWebVersionId, expectedFulfillmentVersionId);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                console.warn(
                    `[verify-staging-runtime] Attempt ${attempt}/${maxAttempts} failed; retrying after propagation delay.`,
                );
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Staging runtime verification failed.');
}

assertExpectedRuntimeSource();
if (process.argv.includes('--preflight')) {
    console.log('[verify-staging-runtime] Complete expected staging runtime contract is present; values withheld.');
} else {
    await verifyStagingRuntime(
        exactVersionId('STAGING_EXPECTED_WEB_VERSION_ID'),
        exactVersionId('STAGING_EXPECTED_FULFILLMENT_VERSION_ID'),
    );
    console.log(
        '[verify-staging-runtime] Exact versions and complete HMAC runtime configuration verified; '
        + 'health, internal authorization and disabled checkout probes passed.',
    );
}
