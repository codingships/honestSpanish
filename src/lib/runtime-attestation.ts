export const RUNTIME_ATTESTATION_SCHEMA = 5;

export type RuntimeAttestationRole = 'web' | 'fulfillment';

export type RuntimeAttestationConfig = {
    adminEmailFingerprint: string;
    appEnvironment: string;
    checkoutEnabled: string;
    checkoutOverride: string;
    cronSecretFingerprint: string;
    fulfillmentRuntimeMode: string;
    fulfillmentUrlFingerprint: string;
    googleAdminFingerprint: string;
    googleBoundary: 'absent' | 'configured';
    googleDriveRootFingerprint: string;
    googlePrivateKeyFingerprint: string;
    googleServiceAccountFingerprint: string;
    googleTemplateFingerprint: string;
    internalSecretFingerprint: string;
    levelCheckSecretFingerprint: string;
    publicSentryDsnFingerprint: string;
    resendAllowlistFingerprint: string;
    resendApiKeyFingerprint: string;
    resendDailyLimit: string;
    resendMode: string;
    resendMonthlyLimit: string;
    resendFromEmailFingerprint: string;
    resendSenderFingerprint: string;
    stripeBoundary: 'absent' | 'configured';
    stripeExpectedAccountId: string;
    stripePortalConfigurationId: string;
    stripePublishableKeyFingerprint: string;
    stripeSecretKeyFingerprint: string;
    stripeWebhookSecretFingerprint: string;
    supabaseAnonFingerprint: string;
    supabaseExpectedProjectRef: string;
    supabaseServiceRoleFingerprint: string;
    supabaseUrlFingerprint: string;
    supportAlertEmailFingerprint: string;
    turnstileSecretFingerprint: string;
    turnstileSiteKeyFingerprint: string;
    webRuntimeMode: string;
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
    const googleConfigured = role === 'fulfillment' && [
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_ADMIN_EMAIL',
        'GOOGLE_DRIVE_ROOT_FOLDER_ID',
        'GOOGLE_TEMPLATE_DOC_ID',
    ].some((key) => Boolean(value(env, key)));
    const webRuntimeMode = role === 'web' ? value(env, 'WEB_RUNTIME_MODE') : 'absent';
    const webRole = role === 'web';
    const stripeConfigured = webRole && [
        'PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_EXPECTED_ACCOUNT_ID',
        'STRIPE_PORTAL_CONFIGURATION_ID',
    ].some((key) => Boolean(value(env, key)));
    return {
        adminEmailFingerprint: await runtimeFingerprint(value(env, 'ADMIN_EMAIL')),
        appEnvironment: value(env, 'PUBLIC_APP_ENV'),
        checkoutEnabled: value(env, 'CHECKOUT_ENABLED'),
        checkoutOverride: value(env, 'CHECKOUT_ENABLED_OVERRIDE'),
        cronSecretFingerprint: await runtimeFingerprint(value(env, 'CRON_SECRET')),
        fulfillmentRuntimeMode: role === 'fulfillment' ? value(env, 'FULFILLMENT_RUNTIME_MODE') : 'absent',
        fulfillmentUrlFingerprint: await runtimeFingerprint(role === 'web' ? value(env, 'FULFILLMENT_WORKER_URL') : ''),
        googleAdminFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_ADMIN_EMAIL') : ''),
        googleBoundary: googleConfigured ? 'configured' : 'absent',
        googleDriveRootFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_DRIVE_ROOT_FOLDER_ID') : ''),
        googlePrivateKeyFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n') : ''),
        googleServiceAccountFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL') : ''),
        googleTemplateFingerprint: await runtimeFingerprint(googleConfigured ? value(env, 'GOOGLE_TEMPLATE_DOC_ID') : ''),
        internalSecretFingerprint: await runtimeFingerprint(value(env, 'INTERNAL_JOB_SECRET')),
        levelCheckSecretFingerprint: await runtimeFingerprint(value(env, 'LEVEL_CHECK_TOKEN_SECRET')),
        publicSentryDsnFingerprint: await runtimeFingerprint(value(env, 'PUBLIC_SENTRY_DSN')),
        resendAllowlistFingerprint: await runtimeFingerprint(value(env, 'EMAIL_RECIPIENT_ALLOWLIST')),
        resendApiKeyFingerprint: await runtimeFingerprint(value(env, 'RESEND_API_KEY')),
        resendDailyLimit: value(env, 'EMAIL_DAILY_RECIPIENT_LIMIT'),
        resendMode: value(env, 'EMAIL_DELIVERY_MODE'),
        resendMonthlyLimit: value(env, 'EMAIL_MONTHLY_RECIPIENT_LIMIT'),
        resendFromEmailFingerprint: await runtimeFingerprint(value(env, 'RESEND_FROM_EMAIL')),
        resendSenderFingerprint: await runtimeFingerprint(sender(env)),
        stripeBoundary: stripeConfigured ? 'configured' : 'absent',
        stripeExpectedAccountId: webRole ? value(env, 'STRIPE_EXPECTED_ACCOUNT_ID') : '',
        stripePortalConfigurationId: webRole ? value(env, 'STRIPE_PORTAL_CONFIGURATION_ID') : '',
        stripePublishableKeyFingerprint: await runtimeFingerprint(webRole ? value(env, 'PUBLIC_STRIPE_PUBLISHABLE_KEY') : ''),
        stripeSecretKeyFingerprint: await runtimeFingerprint(webRole ? value(env, 'STRIPE_SECRET_KEY') : ''),
        stripeWebhookSecretFingerprint: await runtimeFingerprint(webRole ? value(env, 'STRIPE_WEBHOOK_SECRET') : ''),
        supabaseAnonFingerprint: await runtimeFingerprint(role === 'web' ? value(env, 'PUBLIC_SUPABASE_ANON_KEY') : ''),
        supabaseExpectedProjectRef: value(env, 'SUPABASE_EXPECTED_PROJECT_REF'),
        supabaseServiceRoleFingerprint: await runtimeFingerprint(value(env, 'SUPABASE_SERVICE_ROLE_KEY')),
        supabaseUrlFingerprint: await runtimeFingerprint(value(env, 'PUBLIC_SUPABASE_URL')),
        supportAlertEmailFingerprint: await runtimeFingerprint(value(env, 'SUPPORT_ALERT_EMAIL')),
        turnstileSecretFingerprint: await runtimeFingerprint(value(env, 'TURNSTILE_SECRET_KEY')),
        turnstileSiteKeyFingerprint: await runtimeFingerprint(value(env, 'PUBLIC_TURNSTILE_SITE_KEY')),
        webRuntimeMode,
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
