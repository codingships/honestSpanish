import { randomUUID } from 'node:crypto';
import {
    buildRuntimeAttestationConfigForSchema,
    isSupportedRollbackAttestationSchema,
    RUNTIME_ATTESTATION_SCHEMA,
    type SupportedRollbackAttestationSchema,
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
export const STAGING_LEGACY_IDENTITY_WEB_VERSION_ID = '8f90a491-99f9-4347-a793-b762a782a8d3';
export const STAGING_LEGACY_IDENTITY_FULFILLMENT_VERSION_ID = '4dd8e219-0389-4186-91eb-e1cfec2e7728';

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const PROOF_PATTERN = /^[a-f0-9]{64}$/;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DeployedRuntimeVerification = {
    fulfillmentVersionId: string;
    webVersionId: string;
};

export type StagingRollbackRoleContract = {
    bindingNames: string[];
    role: RuntimeAttestationRole;
    schema: SupportedRollbackAttestationSchema;
    verificationMode: 'configuration-hmac' | 'legacy-authenticated-identity';
    workerIdentity: string;
    workerVersionId: string;
};

export type StagingRollbackContract = {
    contractSchema: 2;
    fulfillment: StagingRollbackRoleContract;
    web: StagingRollbackRoleContract;
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

function parseAttestationEnvelope(
    value: unknown,
    expectedSchema?: SupportedRollbackAttestationSchema,
): RuntimeAttestationEnvelope {
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
        || !isSupportedRollbackAttestationSchema(record.schema)
        || (expectedSchema !== undefined && record.schema !== expectedSchema)
        || typeof record.workerIdentity !== 'string'
        || typeof record.workerVersionId !== 'string'
        || !VERSION_ID_PATTERN.test(record.workerVersionId)
    ) {
        throw new Error('Runtime attestation response is invalid');
    }
    return record as RuntimeAttestationEnvelope;
}

function exactBindingNames(bindingNames: readonly string[], role: RuntimeAttestationRole): string[] {
    if (!Array.isArray(bindingNames)) throw new Error(`${role} baseline binding names are invalid`);
    const normalized = bindingNames.map((name) => {
        if (typeof name !== 'string' || !/^[A-Z][A-Z0-9_]*$/u.test(name)) {
            throw new Error(`${role} baseline binding names are invalid`);
        }
        return name;
    });
    if (new Set(normalized).size !== normalized.length) {
        throw new Error(`${role} baseline binding names contain duplicates`);
    }
    return normalized.sort();
}

function isApprovedLegacyIdentityBaseline(
    role: RuntimeAttestationRole,
    schema: number,
    versionId: string,
): boolean {
    return schema === 5 && (role === 'web'
        ? versionId === STAGING_LEGACY_IDENTITY_WEB_VERSION_ID
        : versionId === STAGING_LEGACY_IDENTITY_FULFILLMENT_VERSION_ID);
}

export function extractRollbackBindingNamesFromVersionView(
    value: unknown,
    expectedVersionId: string,
    role: RuntimeAttestationRole,
): string[] {
    if (!VERSION_ID_PATTERN.test(expectedVersionId)
        || !value
        || typeof value !== 'object'
        || Array.isArray(value)) {
        throw new Error(`${role} baseline version view is invalid`);
    }
    const version = value as Record<string, unknown>;
    const resources = version.resources;
    if (version.id !== expectedVersionId
        || !resources
        || typeof resources !== 'object'
        || Array.isArray(resources)
        || !Array.isArray((resources as Record<string, unknown>).bindings)) {
        throw new Error(`${role} baseline version view does not match the exact immutable version`);
    }
    const names = ((resources as Record<string, unknown>).bindings as unknown[]).map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`${role} baseline version view contains an invalid binding`);
        }
        const binding = entry as Record<string, unknown>;
        if (typeof binding.name !== 'string' || typeof binding.type !== 'string' || !binding.type.trim()) {
            throw new Error(`${role} baseline version view contains an invalid binding`);
        }
        return binding.name;
    });
    return exactBindingNames(names, role);
}

function assertRollbackRoleContract(
    contract: StagingRollbackRoleContract,
    expectedRole: RuntimeAttestationRole,
    expectedIdentity: string,
): StagingRollbackRoleContract {
    if (
        !contract
        || contract.role !== expectedRole
        || contract.workerIdentity !== expectedIdentity
        || !VERSION_ID_PATTERN.test(contract.workerVersionId)
        || !isSupportedRollbackAttestationSchema(contract.schema)
        || (contract.verificationMode !== 'configuration-hmac'
            && contract.verificationMode !== 'legacy-authenticated-identity')
        || (contract.verificationMode === 'legacy-authenticated-identity' && (
            !isApprovedLegacyIdentityBaseline(expectedRole, contract.schema, contract.workerVersionId)
        ))
    ) throw new Error(`${expectedRole} rollback runtime contract is invalid`);
    return { ...contract, bindingNames: exactBindingNames(contract.bindingNames, expectedRole) };
}

export function assertStagingRollbackContract(value: unknown): StagingRollbackContract {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Staging rollback runtime contract is invalid');
    }
    const record = value as Partial<StagingRollbackContract>;
    if (record.contractSchema !== 2 || !record.web || !record.fulfillment) {
        throw new Error('Staging rollback runtime contract is invalid');
    }
    return {
        contractSchema: 2,
        web: assertRollbackRoleContract(record.web, 'web', STAGING_WEB_IDENTITY),
        fulfillment: assertRollbackRoleContract(
            record.fulfillment,
            'fulfillment',
            STAGING_FULFILLMENT_IDENTITY,
        ),
    };
}

async function readJson(response: Response, label: string): Promise<unknown> {
    const text = await response.text();
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new Error(`${label} did not return JSON`);
    }
}

async function requestJson(
    fetchImpl: FetchLike,
    url: string,
    init?: RequestInit,
): Promise<{ body: Record<string, unknown>; response: Response }> {
    const response = await fetchImpl(url, {
        ...init,
        headers: {
            'Cache-Control': 'no-cache',
            ...init?.headers,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
    });
    const body = await readJson(response, url);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`${url} returned an invalid JSON object`);
    }
    return { body: body as Record<string, unknown>, response };
}

export async function verifyInnocuousStagingRuntimeProbes(fetchImpl: FetchLike = fetch): Promise<void> {
    await Promise.all([
        requestJson(fetchImpl, `${STAGING_WEB_ORIGIN}/health`).then(({ body, response }) => {
            if (
                response.status !== 200
                || body.appEnvironment !== 'staging'
                || body.checkoutEnabled !== false
                || body.runtimeMode !== 'active'
                || body.status !== 'ok'
                || body.workerIdentity !== STAGING_WEB_IDENTITY
            ) throw new Error('Web health did not return the exact fail-closed staging contract');
        }),
        requestJson(fetchImpl, `${STAGING_FULFILLMENT_ORIGIN}/health`).then(({ body, response }) => {
            if (
                response.status !== 200
                || body.ok !== true
                || body.operationMode !== 'active'
                || body.runtime !== 'cloudflare-workers'
                || body.service !== 'fulfillment-worker'
                || body.workerIdentity !== STAGING_FULFILLMENT_IDENTITY
            ) throw new Error('Fulfillment health did not return the exact staging contract');
        }),
        requestJson(fetchImpl, `${STAGING_FULFILLMENT_ORIGIN}/internal/jobs/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(({ body, response }) => {
            if (response.status !== 401 || body.error !== 'Unauthorized') {
                throw new Error('Fulfillment route did not fail closed for an unauthenticated request');
            }
        }),
        requestJson(fetchImpl, `${STAGING_WEB_ORIGIN}/api/create-checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(({ body, response }) => {
            if (response.status !== 403 || body.error !== 'Checkout is disabled') {
                throw new Error('Checkout did not return the expected fail-closed response');
            }
        }),
        requestJson(fetchImpl, `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(({ body, response }) => {
            if (response.status !== 401 || body.errorCode !== 'ATTESTATION_UNAUTHORIZED') {
                throw new Error('Web runtime attestation did not reject a missing bearer');
            }
        }),
        requestJson(fetchImpl, `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(({ body, response }) => {
            if (response.status !== 401 || body.error !== 'Unauthorized') {
                throw new Error('Fulfillment runtime attestation did not reject a missing bearer');
            }
        }),
    ]);
}

async function verifyHealth(fetchImpl: FetchLike): Promise<void> {
    const [web, fulfillment] = await Promise.all([
        fetchImpl(`${STAGING_WEB_ORIGIN}/es`, {
            headers: { 'Cache-Control': 'no-cache' },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
        }),
        fetchImpl(`${STAGING_FULFILLMENT_ORIGIN}/health`, {
            headers: { 'Cache-Control': 'no-cache' },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
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
    bindingNames?: readonly string[];
    env: Record<string, string | undefined>;
    expectedIdentity: string;
    expectedVersionId: string;
    fetchImpl: FetchLike;
    role: RuntimeAttestationRole;
    schema: SupportedRollbackAttestationSchema;
    url: string;
    verificationMode?: StagingRollbackRoleContract['verificationMode'];
}): Promise<{ schema: SupportedRollbackAttestationSchema; versionId: string }> {
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
        signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) {
        throw new Error(`${input.role} runtime attestation returned ${response.status}`);
    }
    const envelope = parseAttestationEnvelope(
        await readJson(response, `${input.role} runtime attestation`),
        input.schema,
    );
    if (
        envelope.nonce !== nonce
        || envelope.role !== input.role
        || envelope.workerIdentity !== input.expectedIdentity
        || envelope.workerVersionId !== input.expectedVersionId
    ) {
        throw new Error(`${input.role} runtime identity or version does not match the exact version activated by this run`);
    }
    const verificationMode = input.verificationMode ?? 'configuration-hmac';
    if (verificationMode === 'legacy-authenticated-identity') {
        if (!isApprovedLegacyIdentityBaseline(input.role, input.schema, input.expectedVersionId)) {
            throw new Error(`${input.role} legacy identity verification is restricted to an approved schema 5 version`);
        }
        return { schema: input.schema, versionId: envelope.workerVersionId };
    }
    const expectedConfig = await buildRuntimeAttestationConfigForSchema(input.role, {
        ...input.env,
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        FULFILLMENT_RUNTIME_MODE: input.role === 'fulfillment' ? 'active' : 'absent',
        PUBLIC_APP_ENV: 'staging',
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
        WORKER_IDENTITY: input.expectedIdentity,
        WORKER_VERSION_ID: input.expectedVersionId,
    }, input.schema, input.bindingNames ? new Set(exactBindingNames(input.bindingNames, input.role)) : undefined);
    const valid = await verifyRuntimeAttestation(envelope, {
        config: expectedConfig,
        nonce,
        role: input.role,
        schema: input.schema,
    }, secret);
    if (!valid) {
        throw new Error(`${input.role} runtime attestation does not match the expected staging configuration`);
    }
    return { schema: input.schema, versionId: envelope.workerVersionId };
}

async function discoverAndVerifyOneBaseline(input: {
    bindingNames: readonly string[];
    env: Record<string, string | undefined>;
    expectedIdentity: string;
    expectedVersionId: string;
    fetchImpl: FetchLike;
    role: RuntimeAttestationRole;
    url: string;
}): Promise<StagingRollbackRoleContract> {
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
        signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200) {
        throw new Error(`${input.role} baseline runtime attestation returned ${response.status}`);
    }
    const envelope = parseAttestationEnvelope(
        await readJson(response, `${input.role} baseline runtime attestation`),
    );
    if (envelope.nonce !== nonce
        || envelope.role !== input.role
        || envelope.workerIdentity !== input.expectedIdentity
        || envelope.workerVersionId !== input.expectedVersionId) {
        throw new Error(`${input.role} baseline runtime identity or version does not match the immutable baseline`);
    }
    const bindingNames = exactBindingNames(input.bindingNames, input.role);
    const expectedConfig = await buildRuntimeAttestationConfigForSchema(input.role, {
        ...input.env,
        CHECKOUT_ENABLED: 'false',
        CHECKOUT_ENABLED_OVERRIDE: 'false',
        FULFILLMENT_RUNTIME_MODE: input.role === 'fulfillment' ? 'active' : 'absent',
        PUBLIC_APP_ENV: 'staging',
        SUPABASE_EXPECTED_PROJECT_REF: STAGING_SUPABASE_REF,
        WORKER_IDENTITY: input.expectedIdentity,
        WORKER_VERSION_ID: input.expectedVersionId,
    }, envelope.schema as SupportedRollbackAttestationSchema, new Set(bindingNames));
    const valid = await verifyRuntimeAttestation(envelope, {
        config: expectedConfig,
        nonce,
        role: input.role,
        schema: envelope.schema,
    }, secret);
    let verificationMode: StagingRollbackRoleContract['verificationMode'] = 'configuration-hmac';
    if (!valid) {
        if (
            !isApprovedLegacyIdentityBaseline(input.role, envelope.schema, input.expectedVersionId)
        ) {
            throw new Error(`${input.role} baseline runtime attestation does not match the expected staging configuration`);
        }
        // Schema 5 can contain immutable legacy secrets that no longer exist in the
        // canonical source. Only the two exact pre-transition versions may use their
        // authenticated identity; fail-closed probes still run and schema 6 is never
        // allowed to use this transition.
        verificationMode = 'legacy-authenticated-identity';
    }
    return {
        bindingNames,
        role: input.role,
        schema: envelope.schema as SupportedRollbackAttestationSchema,
        verificationMode,
        workerIdentity: input.expectedIdentity,
        workerVersionId: input.expectedVersionId,
    };
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
    await verifyInnocuousStagingRuntimeProbes(fetchImpl);
    const [web, fulfillment] = await Promise.all([
        verifyOneAttestation({
            env: input.env,
            expectedIdentity: STAGING_WEB_IDENTITY,
            expectedVersionId: input.expectedWebVersionId,
            fetchImpl,
            role: 'web',
            schema: RUNTIME_ATTESTATION_SCHEMA,
            url: `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`,
        }),
        verifyOneAttestation({
            env: input.env,
            expectedIdentity: STAGING_FULFILLMENT_IDENTITY,
            expectedVersionId: input.expectedFulfillmentVersionId,
            fetchImpl,
            role: 'fulfillment',
            schema: RUNTIME_ATTESTATION_SCHEMA,
            url: `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`,
        }),
    ]);
    return { fulfillmentVersionId: fulfillment.versionId, webVersionId: web.versionId };
}

export async function captureStagingRollbackBaseline(input: {
    baseOrigin: string;
    env: Record<string, string | undefined>;
    expectedFulfillmentVersionId: string;
    expectedWebVersionId: string;
    fetchImpl?: FetchLike;
    fulfillmentBindingNames: readonly string[];
    fulfillmentOrigin: string;
    roleEmails: string[];
    webBindingNames: readonly string[];
}): Promise<StagingRollbackContract> {
    assertExpectedStagingRuntimeInput(input);
    if (!VERSION_ID_PATTERN.test(input.expectedWebVersionId)
        || !VERSION_ID_PATTERN.test(input.expectedFulfillmentVersionId)) {
        throw new Error('Expected staging baseline Worker version IDs are invalid');
    }
    const fetchImpl = input.fetchImpl ?? fetch;
    await verifyHealth(fetchImpl);
    await verifyInnocuousStagingRuntimeProbes(fetchImpl);
    const [web, fulfillment] = await Promise.all([
        discoverAndVerifyOneBaseline({
            bindingNames: input.webBindingNames,
            env: input.env,
            expectedIdentity: STAGING_WEB_IDENTITY,
            expectedVersionId: input.expectedWebVersionId,
            fetchImpl,
            role: 'web',
            url: `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`,
        }),
        discoverAndVerifyOneBaseline({
            bindingNames: input.fulfillmentBindingNames,
            env: input.env,
            expectedIdentity: STAGING_FULFILLMENT_IDENTITY,
            expectedVersionId: input.expectedFulfillmentVersionId,
            fetchImpl,
            role: 'fulfillment',
            url: `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`,
        }),
    ]);
    return { contractSchema: 2, fulfillment, web };
}

export async function verifyStagingRollbackRuntime(input: {
    baseOrigin: string;
    contract: StagingRollbackContract;
    env: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
    fulfillmentOrigin: string;
    roleEmails: string[];
}): Promise<DeployedRuntimeVerification> {
    assertExpectedStagingRuntimeInput(input);
    const contract = assertStagingRollbackContract(input.contract);
    const fetchImpl = input.fetchImpl ?? fetch;
    await verifyHealth(fetchImpl);
    await verifyInnocuousStagingRuntimeProbes(fetchImpl);
    const [web, fulfillment] = await Promise.all([
        verifyOneAttestation({
            bindingNames: contract.web.bindingNames,
            env: input.env,
            expectedIdentity: STAGING_WEB_IDENTITY,
            expectedVersionId: contract.web.workerVersionId,
            fetchImpl,
            role: 'web',
            schema: contract.web.schema,
            url: `${STAGING_WEB_ORIGIN}/api/internal/runtime-attestation`,
            verificationMode: contract.web.verificationMode,
        }),
        verifyOneAttestation({
            bindingNames: contract.fulfillment.bindingNames,
            env: input.env,
            expectedIdentity: STAGING_FULFILLMENT_IDENTITY,
            expectedVersionId: contract.fulfillment.workerVersionId,
            fetchImpl,
            role: 'fulfillment',
            schema: contract.fulfillment.schema,
            url: `${STAGING_FULFILLMENT_ORIGIN}/internal/runtime-attestation`,
            verificationMode: contract.fulfillment.verificationMode,
        }),
    ]);
    return { fulfillmentVersionId: fulfillment.versionId, webVersionId: web.versionId };
}
