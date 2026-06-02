/**
 * Resend Email Client
 * Configured client for sending transactional emails.
 */
import { Resend } from 'resend';
import { readRuntimeEnv } from '../runtime-env';

let warnedMissingApiKey = false;
let cachedApiKey: string | null = null;
let cachedResend: Resend | null = null;

export function getResend(): Resend {
    const apiKey = readRuntimeEnv('RESEND_API_KEY') || '';

    if (!apiKey && !warnedMissingApiKey) {
        warnedMissingApiKey = true;
        console.warn('[Email] RESEND_API_KEY not configured - emails will not be sent');
    }

    if (cachedResend && cachedApiKey === apiKey) {
        return cachedResend;
    }

    cachedApiKey = apiKey;
    cachedResend = new Resend(apiKey || 'dummy_key');
    return cachedResend;
}

export function getEmailFrom(): string {
    return readRuntimeEnv('EMAIL_FROM') ||
        readRuntimeEnv('RESEND_FROM_EMAIL') ||
        'Español Honesto <alejandro@espanolhonesto.com>';
}

export const resend = new Proxy({} as Resend, {
    get(_target, property) {
        const client = getResend();
        const value = client[property as keyof Resend];
        return typeof value === 'function' ? value.bind(client) : value;
    },
});
