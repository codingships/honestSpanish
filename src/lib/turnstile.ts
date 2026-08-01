import type { APIContext } from 'astro';
import { readRuntimeEnv } from './runtime-env';

const siteverifyEndpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const checkoutAction = 'checkout_hold';
const testingAction = 'test';
const testingHostname = 'localhost';
const alwaysPassTestingSiteKey = '1x00000000000000000000AA';
const maximumTokenLength = 2048;
const defaultTimeoutMs = 5_000;

type CheckoutTurnstileResult =
    | { ok: true }
    | { ok: false; reason: 'invalid' | 'unavailable' };

function expectedCheckoutVerification(context?: Pick<APIContext, 'locals'>): {
    actions: ReadonlySet<string>;
    hostnames: ReadonlySet<string>;
} | null {
    const configuredSiteUrl = readRuntimeEnv('PUBLIC_SITE_URL', context)?.trim();
    const siteKey = readRuntimeEnv('PUBLIC_TURNSTILE_SITE_KEY', context)?.trim();
    const appEnvironment = readRuntimeEnv('PUBLIC_APP_ENV', context)?.trim();
    if (!configuredSiteUrl || !siteKey) return null;

    try {
        const parsed = new URL(configuredSiteUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
        if (siteKey === alwaysPassTestingSiteKey) {
            // Cloudflare's documented dummy response uses action=test and
            // hostname=localhost. Keep that compatibility outside production,
            // while also accepting the configured widget fields if returned.
            if (appEnvironment === 'production') return null;
            return {
                actions: new Set([checkoutAction, testingAction]),
                hostnames: new Set([parsed.hostname, testingHostname]),
            };
        }
        return {
            actions: new Set([checkoutAction]),
            hostnames: new Set([parsed.hostname]),
        };
    } catch {
        return null;
    }
}

function isVerificationPayload(value: unknown): value is {
    success: boolean;
    action?: string;
    hostname?: string;
} {
    return typeof value === 'object'
        && value !== null
        && 'success' in value
        && typeof (value as { success?: unknown }).success === 'boolean';
}

export async function verifyCheckoutTurnstile(input: {
    token: unknown;
    clientAddress: string;
    context?: Pick<APIContext, 'locals'>;
    timeoutMs?: number;
}): Promise<CheckoutTurnstileResult> {
    if (
        typeof input.token !== 'string'
        || input.token.length === 0
        || input.token.length > maximumTokenLength
    ) return { ok: false, reason: 'invalid' };

    const secret = readRuntimeEnv('TURNSTILE_SECRET_KEY', input.context)?.trim();
    const expected = expectedCheckoutVerification(input.context);
    if (!secret || !expected || !input.clientAddress) {
        return { ok: false, reason: 'unavailable' };
    }

    const body = new URLSearchParams({
        secret,
        response: input.token,
        remoteip: input.clientAddress,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? defaultTimeoutMs);

    try {
        const response = await fetch(siteverifyEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: controller.signal,
        });
        if (!response.ok) return { ok: false, reason: 'unavailable' };

        const payload: unknown = await response.json();
        if (!isVerificationPayload(payload)) return { ok: false, reason: 'unavailable' };
        if (
            payload.success !== true
            || typeof payload.action !== 'string'
            || !expected.actions.has(payload.action)
            || typeof payload.hostname !== 'string'
            || !expected.hostnames.has(payload.hostname)
        ) return { ok: false, reason: 'invalid' };

        return { ok: true };
    } catch {
        return { ok: false, reason: 'unavailable' };
    } finally {
        clearTimeout(timeout);
    }
}
