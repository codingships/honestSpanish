export const RUNTIME_ATTESTATION_SCHEMA = 1;

export type RuntimeAttestationRole = 'web' | 'fulfillment';

export type RuntimeAttestationConfig = {
    appEnvironment: string;
    checkoutEnabled: string;
    checkoutOverride: string;
    fulfillmentUrlFingerprint: string;
    googleAdminFingerprint: string;
    googleBoundary: 'absent' | 'configured';
    googleDriveRootFingerprint: string;
    googlePrivateKeyFingerprint: string;
    googleServiceAccountFingerprint: string;
    googleTemplateFingerprint: string;
    internalSecretFingerprint: string;
    resendAllowlistFingerprint: string;
    resendApiKeyFingerprint: string;
    resendDailyLimit: string;
    resendMode: string;
    resendMonthlyLimit: string;
    resendSenderFingerprint: string;
    supabaseAnonFingerprint: string;
    supabaseServiceRoleFingerprint: string;
    supabaseUrlFingerprint: string;
    workerIdentity: string;
    workerVersionId: string;
};

export type RuntimeAttestationEnvelope = {
    nonce: string;
    proof: string;
    role: RuntimeAttestationRole;
    schema: number;
    workerIdentity: string;
    workerVersionId: string;
};

const encoder = new TextEncoder();

function value(env: Record<string, string | undefined>, key: string): string {
    return env[key]?.trim() ?? '';
}

function sender(env: Record<string, string | undefined>): string {
    return value(env, 'EMAIL_FROM') || value(env, 'RESEND_FROM_EMAIL');
}

function canonicalJson(valueToEncode: unknown): string {
    if (Array.isArray(valueToEncode)) {
        return `[${valueToEncode.map(canonicalJson).join(',')}]`;
    }
    if (valueToEncode && typeof valueToEncode === 'object') {
        const entries = Object.entries(valueToEncode as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
    }
    return JSON.stringify(valueToEncode);
}

function toHex(bytes: ArrayBuffer): string {
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runtimeFingerprint(raw: string): Promise<string> {
    if (!raw) return 'absent';
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
    return `sha256:${toHex(digest)}`;
}

export async function buildRuntimeAttestationConfig(
    role: RuntimeAttestationRole,
    env: Record<string, string | undefined>,
): Promise<RuntimeAttestationConfig> {
    const googleConfigured = role === 'fulfillment';
    return {
        appEnvironment: value(env, 'PUBLIC_APP_ENV'),
        checkoutEnabled: value(env, 'CHECKOUT_ENABLED'),
        checkoutOverride: value(env, 'CHECKOUT_ENABLED_OVERRIDE'),
        fulfillmentUrlFingerprint: await runtimeFingerprint(role === 'web' ? value(env, 'FULFILLMENT_WORKER_URL') : ''),
        googleAdminFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_ADMIN_EMAIL') : ''),
        googleBoundary: googleConfigured ? 'configured' : 'absent',
        googleDriveRootFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_DRIVE_ROOT_FOLDER_ID') : ''),
        googlePrivateKeyFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n') : ''),
        googleServiceAccountFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') : ''),
        googleTemplateFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_TEMPLATE_DOC_ID') : ''),
        internalSecretFingerprint: await runtimeFingerprint(value(env, 'INTERNAL_JOB_SECRET')),
        resendAllowlistFingerprint: await runtimeFingerprint(value(env, 'EMAIL_RECIPIENT_ALLOWLIST')),
        resendApiKeyFingerprint: await runtimeFingerprint(value(env, 'RESEND_API_KEY')),
        resendDailyLimit: value(env, 'EMAIL_DAILY_RECIPIENT_LIMIT'),
        resendMode: value(env, 'EMAIL_DELIVERY_MODE'),
        resendMonthlyLimit: value(env, 'EMAIL_MONTHLY_RECIPIENT_LIMIT'),
        resendSenderFingerprint: await runtimeFingerprint(sender(env)),
        supabaseAnonFingerprint: await runtimeFingerprint(role === 'web' ? value(env, 'PUBLIC_SUPABASE_ANON_KEY') : ''),
        supabaseServiceRoleFingerprint: await runtimeFingerprint(value(env, 'SUPABASE_SERVICE_ROLE_KEY')),
        supabaseUrlFingerprint: await runtimeFingerprint(value(env, 'PUBLIC_SUPABASE_URL')),
        workerIdentity: value(env, 'WORKER_IDENTITY'),
        workerVersionId: value(env, 'WORKER_VERSION_ID'),
    };
}

async function hmac(secret: string, valueToSign: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(valueToSign)));
}

export async function createRuntimeAttestation(
    role: RuntimeAttestationRole,
    env: Record<string, string | undefined>,
    nonce: string,
): Promise<RuntimeAttestationEnvelope> {
    const secret = value(env, 'INTERNAL_JOB_SECRET');
    if (!secret) throw new Error('ATTESTATION_CONFIG_INVALID');
    const config = await buildRuntimeAttestationConfig(role, env);
    const unsigned = {
        config,
        nonce,
        role,
        schema: RUNTIME_ATTESTATION_SCHEMA,
    };
    return {
        nonce,
        proof: await hmac(secret, canonicalJson(unsigned)),
        role,
        schema: RUNTIME_ATTESTATION_SCHEMA,
        workerIdentity: config.workerIdentity,
        workerVersionId: config.workerVersionId,
    };
}

export async function verifyRuntimeAttestation(
    envelope: RuntimeAttestationEnvelope,
    expected: {
        config: RuntimeAttestationConfig;
        nonce: string;
        role: RuntimeAttestationRole;
        schema: number;
    },
    secret: string,
): Promise<boolean> {
    if (
        envelope.nonce !== expected.nonce
        || envelope.role !== expected.role
        || envelope.schema !== expected.schema
        || envelope.workerIdentity !== expected.config.workerIdentity
        || envelope.workerVersionId !== expected.config.workerVersionId
    ) return false;
    const expectedProof = await hmac(secret, canonicalJson(expected));
    return timingSafeTextEqual(envelope.proof, expectedProof);
}

export function isValidAttestationNonce(valueToCheck: unknown): valueToCheck is string {
    return typeof valueToCheck === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(valueToCheck);
}

export function timingSafeTextEqual(left: string, right: string): boolean {
    const leftBytes = encoder.encode(left);
    const rightBytes = encoder.encode(right);
    if (leftBytes.byteLength !== rightBytes.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < leftBytes.byteLength; index += 1) {
        difference |= leftBytes[index] ^ rightBytes[index];
    }
    return difference === 0;
}
