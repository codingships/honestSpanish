import type { APIContext } from 'astro';
import { readRuntimeEnv } from './runtime-env';
import { timingSafeTextEqual } from './runtime-attestation';

export const STAGING_E2E_CHECKOUT_COOKIE = '__Host-hs_staging_e2e_checkout';
export const STAGING_E2E_CHECKOUT_MAX_AGE_SECONDS = 10 * 60;
export const STAGING_E2E_CHECKOUT_CONFIRMATION = 'sandbox-journey';

const tokenAudience = 'honestspanish-staging-checkout-e2e';
const stagingOrigin = 'https://staging.espanolhonesto.com';
const stagingWorkerIdentity = 'espanolhonesto-staging';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const runIdPattern = /^[a-z0-9][a-z0-9-]{7,63}$/u;
const syntheticEmailPattern = /^delivered\+hs-stg-[a-z0-9][a-z0-9-]{0,45}@resend\.dev$/u;

type RuntimeValues = {
    appEnvironment: string | undefined;
    checkoutEnabled: string | undefined;
    checkoutOverride: string | undefined;
    internalSecret: string | undefined;
    siteUrl: string | undefined;
    workerIdentity: string | undefined;
};

type GrantPayload = {
    aud: typeof tokenAudience;
    email: string;
    exp: number;
    iat: number;
    runId: string;
    slotPublicId: string;
    studentId: string;
    v: 1;
};

export type StagingE2ECheckoutGrant = Pick<
    GrantPayload,
    'email' | 'exp' | 'runId' | 'slotPublicId' | 'studentId'
>;

function runtimeValues(context?: Pick<APIContext, 'locals'>): RuntimeValues {
    return {
        appEnvironment: readRuntimeEnv('PUBLIC_APP_ENV', context),
        checkoutEnabled: readRuntimeEnv('CHECKOUT_ENABLED', context),
        checkoutOverride: readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE', context),
        internalSecret: readRuntimeEnv('INTERNAL_JOB_SECRET', context),
        siteUrl: readRuntimeEnv('PUBLIC_SITE_URL', context),
        workerIdentity: readRuntimeEnv('WORKER_IDENTITY', context),
    };
}

function isClosedCanonicalStagingRuntime(runtime: RuntimeValues): runtime is RuntimeValues & { internalSecret: string } {
    return runtime.appEnvironment === 'staging'
        && runtime.siteUrl === stagingOrigin
        && runtime.workerIdentity === stagingWorkerIdentity
        && runtime.checkoutEnabled === 'false'
        && runtime.checkoutOverride === 'false'
        && typeof runtime.internalSecret === 'string'
        && runtime.internalSecret.length > 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
    const padding = (4 - (value.length % 4)) % 4;
    try {
        const binary = atob(value.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat(padding));
        return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    } catch {
        return null;
    }
}

async function hmac(secret: string, value: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(`${tokenAudience}\0${value}`),
    );
    return bytesToBase64Url(new Uint8Array(signature));
}

function normalizeSyntheticEmail(value: string): string {
    return value.trim().toLowerCase();
}

export function isStagingE2ESyntheticEmail(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    return syntheticEmailPattern.test(normalizeSyntheticEmail(value));
}

function validPayload(value: unknown, nowSeconds: number): value is GrantPayload {
    if (!value || typeof value !== 'object') return false;
    const payload = value as Partial<GrantPayload>;
    return payload.v === 1
        && payload.aud === tokenAudience
        && typeof payload.studentId === 'string'
        && uuidPattern.test(payload.studentId)
        && typeof payload.email === 'string'
        && isStagingE2ESyntheticEmail(payload.email)
        && payload.email === normalizeSyntheticEmail(payload.email)
        && typeof payload.runId === 'string'
        && runIdPattern.test(payload.runId)
        && typeof payload.slotPublicId === 'string'
        && uuidPattern.test(payload.slotPublicId)
        && Number.isSafeInteger(payload.iat)
        && Number.isSafeInteger(payload.exp)
        && payload.iat! <= nowSeconds + 30
        && payload.exp! > nowSeconds
        && payload.exp! > payload.iat!
        && payload.exp! - payload.iat! <= STAGING_E2E_CHECKOUT_MAX_AGE_SECONDS;
}

export async function issueStagingE2ECheckoutGrant(input: {
    context: Pick<APIContext, 'locals'>;
    email: string;
    nowMs?: number;
    runId: string;
    slotPublicId: string;
    studentId: string;
}): Promise<{ expiresAt: string; token: string } | null> {
    const runtime = runtimeValues(input.context);
    const email = normalizeSyntheticEmail(input.email);
    if (
        !isClosedCanonicalStagingRuntime(runtime)
        || !uuidPattern.test(input.studentId)
        || !uuidPattern.test(input.slotPublicId)
        || !runIdPattern.test(input.runId)
        || !isStagingE2ESyntheticEmail(email)
    ) return null;

    const issuedAt = Math.floor((input.nowMs ?? Date.now()) / 1_000);
    const payload: GrantPayload = {
        aud: tokenAudience,
        email,
        exp: issuedAt + STAGING_E2E_CHECKOUT_MAX_AGE_SECONDS,
        iat: issuedAt,
        runId: input.runId,
        slotPublicId: input.slotPublicId,
        studentId: input.studentId,
        v: 1,
    };
    const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
    const signature = await hmac(runtime.internalSecret, encodedPayload);
    return {
        expiresAt: new Date(payload.exp * 1_000).toISOString(),
        token: `${encodedPayload}.${signature}`,
    };
}

export async function verifyStagingE2ECheckoutGrant(input: {
    context: Pick<APIContext, 'locals'>;
    nowMs?: number;
    token: string | null | undefined;
}): Promise<StagingE2ECheckoutGrant | null> {
    const runtime = runtimeValues(input.context);
    if (!isClosedCanonicalStagingRuntime(runtime) || typeof input.token !== 'string') return null;

    const parts = input.token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, providedSignature] = parts;
    if (!encodedPayload || !providedSignature) return null;
    const payloadBytes = base64UrlToBytes(encodedPayload);
    if (!payloadBytes) return null;

    const expectedSignature = await hmac(runtime.internalSecret, encodedPayload);
    if (!timingSafeTextEqual(providedSignature, expectedSignature)) return null;

    let value: unknown;
    try {
        value = JSON.parse(decoder.decode(payloadBytes));
    } catch {
        return null;
    }
    const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1_000);
    if (!validPayload(value, nowSeconds)) return null;
    return {
        email: value.email,
        exp: value.exp,
        runId: value.runId,
        slotPublicId: value.slotPublicId,
        studentId: value.studentId,
    };
}

export async function readStagingE2ECheckoutGrant(
    context: Pick<APIContext, 'cookies' | 'locals'>,
): Promise<StagingE2ECheckoutGrant | null> {
    return verifyStagingE2ECheckoutGrant({
        context,
        token: context.cookies.get(STAGING_E2E_CHECKOUT_COOKIE)?.value,
    });
}
