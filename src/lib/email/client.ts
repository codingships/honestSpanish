/**
 * Resend Email Client
 * Configured client for sending transactional emails
 */
import { Resend } from 'resend';

const apiKey = import.meta.env.RESEND_API_KEY || process.env.RESEND_API_KEY;

if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not configured - emails will not be sent');
}

export const resend = new Resend(apiKey || 'dummy_key');

export const EMAIL_FROM = import.meta.env.EMAIL_FROM ||
    import.meta.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    process.env.RESEND_FROM_EMAIL ||
    'Español Honesto <alejandro@espanolhonesto.com>';
