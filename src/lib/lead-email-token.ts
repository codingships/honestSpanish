import { readRuntimeEnv } from './runtime-env';

const encoder = new TextEncoder();

function getTokenSecret(): string {
    const secret = readRuntimeEnv('LEVEL_CHECK_TOKEN_SECRET')
        ?? readRuntimeEnv('TURNSTILE_SECRET_KEY');
    if (!secret) {
        throw new Error('Missing LEVEL_CHECK_TOKEN_SECRET or TURNSTILE_SECRET_KEY');
    }
    return secret;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function tokenPayload(input: { leadId: string; email: string }): string {
    return `${input.leadId}:${normalizeEmail(input.email)}`;
}

function base64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function constantTimeEqual(a: string, b: string): boolean {
    const max = Math.max(a.length, b.length);
    let diff = a.length ^ b.length;
    for (let index = 0; index < max; index += 1) {
        diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    }
    return diff === 0;
}

export async function signLeadEmailToken(input: { leadId: string; email: string }): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(getTokenSecret()),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(tokenPayload(input)));
    return base64Url(new Uint8Array(signature));
}

export async function verifyLeadEmailToken(input: {
    leadId: string | null;
    email: string;
    token: string | null;
}): Promise<boolean> {
    if (!input.leadId || !input.token) return false;
    const expected = await signLeadEmailToken({ leadId: input.leadId, email: input.email });
    return constantTimeEqual(expected, input.token.trim());
}
