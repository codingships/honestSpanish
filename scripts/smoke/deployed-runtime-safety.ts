import { randomUUID } from 'node:crypto';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
    type RuntimeAttestationRole,
} from '../../src/lib/runtime-attestation';

export const STAGING_SUPABASE_REF = 'mzjyvmlxfpzdfdjzxxyj';
export const STAGING_STRIPE_ACCOUNT_ID = 'acct_1TruqOC22M3erP0j';
export const STAGING_WEB_IDENTITY = 'espanolhonesto-staging';
export const STAGING_WEB_ORIGIN = 'https://staging.espanolhonesto.com';
export const STAGING_FULFILLMENT_IDENTITY = 'espanol-honesto-fulfillment-staging';
export const STAGING_FULFILLMENT_ORIGIN = 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev';

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PROOF_PATTERN = /^[a-f0-9]{64}$/;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DeployedRuntimeVerification = {
    fulfillmentVersionId: string;
    webVersionId: string;
};

function requireValue(env: Record<string, string | undefined>, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Deployed runtime preflight requires ${key}`);
    return value;
}

function exactOrigin(raw: string, expected: string, label: string): string {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error(`${label} must be the exact staging origin`);
    }
    if (parsed.origin !== expected || parsed.href !== `${expected}/`) {
        throw new Error(`${label} must be the exact staging origin`);
    }
    return parsed.origin;
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

export function assertExpectedStagingRuntimeInput(input: {
    baseOrigin: string;
    env: Record<string, string | undefined>;
    fulfillmentOrigin: string;
    roleEmails: string[];
}): void {
    const { env } = input;
    exactOrigin(input.baseOrigin, STAGING_WEB_ORIGIN, 'Staging web origin');
    exactOrigin(input.fulfillmentOrigin, STAGING_FULFILLMENT_ORIGIN, 'Staging fulfillment origin');

    if (requireValue(env, 'PUBLIC_APP_ENV') !== 'staging') {
        throw new Error('PUBLIC_APP_ENV must be staging');
    }
    if (requireValue(env, 'PUBLIC_SITE_URL') !== STAGING_WEB_ORIGIN) {
        throw new Error('PUBLIC_SITE_URL must be the exact stable staging Worker');
    }
    if (requireValue(env, 'PUBLIC_SUPABASE_URL') !== `https://${STAGING_SUPABASE_REF}.supabase.co`) {
        throw new Error('PUBLIC_SUPABASE_URL must be the approved staging project');
    }
    if (requireValue(env, 'FULFILLMENT_WORKER_URL') !== STAGING_FULFILLMENT_ORIGIN) {
        throw new Error('FULFILLMENT_WORKER_URL must be the exact staging Worker');
    }
    if (requireValue(env, 'SUPABASE_EXPECTED_PROJECT_REF') !== STAGING_SUPABASE_REF) {
        throw new Error('SUPABASE_EXPECTED_PROJECT_REF must be the approved staging project');
    }
    if (requireValue(env, 'CHECKOUT_ENABLED') !== 'false'
        || requireValue(env, 'CHECKOUT_ENABLED_OVERRIDE') !== 'false') {
        throw new Error('The local staging source must keep checkout fail-closed');
    }
    if (requireValue(env, 'WEB_RUNTIME_MODE') !== 'active'
        || requireValue(env, 'FULFILLMENT_RUNTIME_MODE') !== 'active') {
        throw new Error('Both staging runtime modes must be active');
    }
    if (requireValue(env, 'EMAIL_DELIVERY_MODE') !== 'allowlist') {
        throw new Error('EMAIL_DELIVERY_MODE must be allowlist in staging');
    }
    if (requireValue(env, 'EMAIL_DAILY_RECIPIENT_LIMIT') !== '10'
        || requireValue(env, 'EMAIL_MONTHLY_RECIPIENT_LIMIT') !== '100') {
        throw new Error('Staging email budgets must be exactly 10 daily and 100 monthly');
    }

    const allowlist = new Set(
        requireValue(env, 'EMAIL_RECIPIENT_ALLOWLIST')
            .split(/[,;\n]/u)
            .map(normalizeEmail)
            .filter(Boolean),
    );
    const roleEmails = input.roleEmails.map(normalizeEmail);
    if (roleEmails.length !== 3
        || new Set(roleEmails).size !== 3
        || allowlist.size !== 3
        || roleEmails.some((email) => email.endsWith('@example.com') || !allowlist.has(email))) {
        throw new Error('The deployed runtime preflight requires exactly the three existing allowlisted role accounts');
    }

    for (const key of [
        'ADMIN_EMAIL',
        'CRON_SECRET',
        'EMAIL_FROM',
        'PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'INTERNAL_JOB_SECRET',
        'LEVEL_CHECK_TOKEN_SECRET',
        'PUBLIC_SENTRY_DSN',
        'PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_EXPECTED_ACCOUNT_ID',
        'STRIPE_PORTAL_CONFIGURATION_ID',
        'PUBLIC_TURNSTILE_SITE_KEY',
        'TURNSTILE_SECRET_KEY',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
        'RESEND_API_KEY',
        'RESEND_FROM_EMAIL',
        'SUPPORT_ALERT_EMAIL',
    ]) requireValue(env, key);

    if (!requireValue(env, 'PUBLIC_STRIPE_PUBLISHABLE_KEY').startsWith('pk_test_')
        || !requireValue(env, 'STRIPE_SECRET_KEY').startsWith('sk_test_')
        || !requireValue(env, 'STRIPE_WEBHOOK_SECRET').startsWith('whsec_')
        || requireValue(env, 'STRIPE_EXPECTED_ACCOUNT_ID') !== STAGING_STRIPE_ACCOUNT_ID
        || !/^bpc_[A-Za-z0-9]+$/u.test(requireValue(env, 'STRIPE_PORTAL_CONFIGURATION_ID'))) {
        throw new Error(
            `Stripe staging runtime requires test-mode keys, exact account ${STAGING_STRIPE_ACCOUNT_ID} `
            + 'and a Portal configuration',
        );
    }

    if (env.GOOGLE_DRIVE_ROOT_FOLDER_ID === env.GOOGLE_TEMPLATE_DOC_ID) {
        throw new Error('Google staging root and template IDs must differ');
    }
    if (normalizeEmail(requireValue(env, 'ADMIN_EMAIL')) !== normalizeEmail(roleEmails[2])
        || normalizeEmail(requireValue(env, 'SUPPORT_ALERT_EMAIL')) !== normalizeEmail(roleEmails[2])) {
        throw new Error('ADMIN_EMAIL and SUPPORT_ALERT_EMAIL must identify the expected staging admin');
    }
}

function parseAttestationEnvelope(value: unknown): RuntimeAttestationEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Runtime attestation response is invalid');
    }
    const record = value as Record<string, unknown>;
    if (
        typeof record.nonce !== 'string'
        || !NONCE_PATTERN.test(record.nonce)
        || typeof record.proof !== 'string'
        || !PROOF_PATTERN.test(record.proof)
        || (record.role !== 'web' && record.role !== 'fulfillment')
        || record.schema !== RUNTIME_ATTESTATION_SCHEMA
        || typeof record.workerIdentity !== 'string'
        || typeof record.workerVersionId !== 'string'
        || !VERSION_ID_PATTERN.test(record.workerVersionId)
    ) {
        throw new Error('Runtime attestation response is invalid');
    }
    return record as RuntimeAttestationEnvelope;
}

async function readJson(response: Response, label: string): Promise<unknown> {
    const text = await response.text();
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error(`${label} did not return JSON`);
    }
}

async function verifyHealth(fetchImpl: FetchLike): Promise<void> {
    const [web, fulfillment] = await Promise.all([
        fetchImpl(`${STAGING_WEB_ORIGIN}/es`, {
            headers: { 'Cache-Control': 'no-cache' },
            redirect: 'manual',
        }),
        fetchImpl(`${STAGING_FULFILLMENT_ORIGIN}/health`, {
            headers: { 'Cache-Control': 'no-cache' },
            redirect: 'manual',
        }),
    ]);
    if (web.status !== 200) {
        throw new Error(`Staging web health returned ${web.status}`);
    }
    const fulfillmentBody = await readJson(fulfillment, 'Fulfillment health');
    if (
        fulfillment.status !== 200
        || !fulfillmentBody
        || typeof fulfillmentBody !== 'object'
        || Array.isArray(fulfillmentBody)
        || (fulfillmentBody as Record<string, unknown>).ok !== true
        || (fulfillmentBody as Record<string, unknown>).service !== 'fulfillment-worker'
        || (fulfillmentBody as Record<string, unknown>).runtime !== 'cloudflare-workers'
    ) {
        throw new Error(`Staging fulfillment health returned an invalid ${fulfillment.status} response`);
    }
}

async function verifyOneAttestation(input: {
    env: Record<string, string | undefined>;
    expectedIdentity: string;
    expectedVersionId: string;
    fetchImpl: FetchLike;
    role: RuntimeAttestationRole;
    url: string;
}): Promise<string> {
    const nonce = randomUUID();
    const secret = requireValue(input.env, 'INTERNAL_JOB_SECRET');
    const response = await input.fetchImpl(input.url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Cache-Control': 'no-cache',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ nonce }),
        redirect: 'manual',
    });
    if (response.status !== 200) {
        throw new Error(`${input.role} runtime attestation returned ${response.status}`);
    }
    const envelope = parseAttestationEnvelope(await readJson(response, `${input.role} runtime attestation`));
    if (envelope.workerVersionId !== input.expectedVersionId) {
        throw new Error(`${input.role} runtime version does not match the exact version activated by this run`);
    }
    const expectedConfig = await buildRuntimeAttestationConfig(input.role, {
        ...input.env,
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        FULFILLMENT_RUNTIME_MODE: input.role === 'fulfillment' ? 'active' : 'absent',
        PUBLIC_APP_ENV: 'staging',
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
        WORKER_IDENTITY: input.expectedIdentity,
        WORKER_VERSION_ID: input.expectedVersionId,
    });
    const valid = await verifyRuntimeAttestation(envelope, {
        config: expectedConfig,
        nonce,
        role: input.role,
        schema: RUNTIME_ATTESTATION_SCHEMA,
    }, secret);
    if (!valid) {
        throw new Error(`${input.role} runtime attestation does not match the expected staging configuration`);
    }
    return envelope.workerVersionId;
}

export async function verifyDeployedStagingRuntime(input: {
    baseOrigin: string;
    env: Record<string, string | undefined>;
    expectedFulfillmentVersionId: string;
    expectedWebVersionId: string;
    fetchImpl?: FetchLike;
    fulfillmentOrigin: string;
    roleEmails: string[];
}): Promise<DeployedRuntimeVerification> {
    assertExpectedStagingRuntimeInput(input);
    if (!VERSION_ID_PATTERN.test(input.expectedWebVersionId)
        || !VERSION_ID_PATTERN.test(input.expectedFulfillmentVersionId)) {
        throw new Error('Expected staging Worker version IDs are invalid');
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    await verifyHealth(fetchImpl);
    const [webVersionId, fulfillmentVersionId] = await Promise.all([
        verifyOneAttestation({
            env: input.env,
            expectedIdentity: STAGING_WEB_IDENTITY,
            expectedVersionId: input.expectedWebVersionId,
            fetchImpl,
            role: 'web',
            url: `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`,
        }),
        verifyOneAttestation({
            env: input.env,
            expectedIdentity: STAGING_FULFILLMENT_IDENTITY,
            expectedVersionId: input.expectedFulfillmentVersionId,
            fetchImpl,
            role: 'fulfillment',
            url: `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`,
        }),
    ]);
    return { fulfillmentVersionId, webVersionId };
}
