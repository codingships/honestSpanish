import { createSupabaseAdminClient } from '../supabase-admin';
import { readRuntimeEnv } from '../runtime-env';
import { getEmailFrom, getResend } from './client';

export type EmailDeliveryMode = 'disabled' | 'allowlist' | 'live';
export type EmailDeliveryFailureReason =
    | 'delivery_disabled'
    | 'invalid_delivery_mode'
    | 'recipient_not_allowlisted'
    | 'invalid_recipient'
    | 'provider_unavailable'
    | 'budget_daily_exceeded'
    | 'budget_monthly_exceeded'
    | 'budget_unavailable'
    | 'provider_error';

export type EmailDeliveryResult =
    | { ok: true }
    | { ok: false; reason: EmailDeliveryFailureReason; error?: unknown };

export type BudgetedEmail = {
    from?: string;
    to: string | string[];
    subject: string;
    html: string;
    source: string;
};

export type EmailDeliveryPolicy = {
    appEnvironment: string;
    budgetScope: string;
    dailyLimit: number;
    monthlyLimit: number;
    mode: EmailDeliveryMode;
    recipientAllowlist: Set<string>;
};

export const PRODUCTION_EMAIL_DAILY_RECIPIENT_LIMIT = 80;
export const PRODUCTION_EMAIL_MONTHLY_RECIPIENT_LIMIT = 2400;
export const STAGING_EMAIL_DAILY_RECIPIENT_LIMIT = 10;
export const STAGING_EMAIL_MONTHLY_RECIPIENT_LIMIT = 100;

const DELIVERY_MODES = new Set<EmailDeliveryMode>(['disabled', 'allowlist', 'live']);
const SAFE_TOKEN_PATTERN = /^[a-z0-9_.:-]+$/;

function parsePositiveLimit(raw: string | undefined, fallback: number, maximum: number): number {
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function normalizeEmailAddress(value: string): string | null {
    const trimmed = value.trim().toLowerCase();
    const angleAddress = /<([^<>]+)>$/.exec(trimmed)?.[1]?.trim() ?? trimmed;
    if (!/^\S+@\S+\.\S+$/.test(angleAddress)) return null;
    return angleAddress;
}

function parseAllowlist(raw: string | undefined): Set<string> {
    if (!raw) return new Set();

    return new Set(
        raw
            .split(/[,;\n]/)
            .map(normalizeEmailAddress)
            .filter((value): value is string => Boolean(value)),
    );
}

function safeToken(value: string | undefined, fallback: string, maxLength: number): string {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || normalized.length > maxLength || !SAFE_TOKEN_PATTERN.test(normalized)) {
        return fallback;
    }
    return normalized;
}

export function getEmailDeliveryPolicy(): EmailDeliveryPolicy {
    const appEnvironment = safeToken(readRuntimeEnv('PUBLIC_APP_ENV'), 'unknown', 32);
    const requestedMode = readRuntimeEnv('EMAIL_DELIVERY_MODE')?.trim().toLowerCase();
    const mode = DELIVERY_MODES.has(requestedMode as EmailDeliveryMode)
        ? requestedMode as EmailDeliveryMode
        : 'disabled';
    const production = appEnvironment === 'production';
    const maximumDaily = production
        ? PRODUCTION_EMAIL_DAILY_RECIPIENT_LIMIT
        : STAGING_EMAIL_DAILY_RECIPIENT_LIMIT;
    const maximumMonthly = production
        ? PRODUCTION_EMAIL_MONTHLY_RECIPIENT_LIMIT
        : STAGING_EMAIL_MONTHLY_RECIPIENT_LIMIT;

    return {
        appEnvironment,
        // Both Workers in one environment must share the same counter. Derive
        // the scope instead of accepting an override that could split quota.
        budgetScope: production ? 'production' : 'nonproduction',
        dailyLimit: parsePositiveLimit(
            readRuntimeEnv('EMAIL_DAILY_RECIPIENT_LIMIT'),
            maximumDaily,
            maximumDaily,
        ),
        monthlyLimit: parsePositiveLimit(
            readRuntimeEnv('EMAIL_MONTHLY_RECIPIENT_LIMIT'),
            maximumMonthly,
            maximumMonthly,
        ),
        mode,
        recipientAllowlist: parseAllowlist(readRuntimeEnv('EMAIL_RECIPIENT_ALLOWLIST')),
    };
}

function policyFailure(
    policy: EmailDeliveryPolicy,
    recipients: string[],
): EmailDeliveryFailureReason | null {
    if (policy.mode === 'disabled') return 'delivery_disabled';
    if (policy.mode === 'live' && policy.appEnvironment !== 'production') {
        return 'invalid_delivery_mode';
    }
    if (policy.mode === 'allowlist') {
        if (policy.recipientAllowlist.size === 0) return 'recipient_not_allowlisted';
        if (recipients.some((recipient) => !policy.recipientAllowlist.has(recipient))) {
            return 'recipient_not_allowlisted';
        }
    }
    return null;
}

function classifyBudgetError(error: unknown): EmailDeliveryFailureReason {
    const message = typeof (error as { message?: unknown })?.message === 'string'
        ? (error as { message: string }).message
        : '';
    if (message.includes('email_budget_daily_exceeded')) return 'budget_daily_exceeded';
    if (message.includes('email_budget_monthly_exceeded')) return 'budget_monthly_exceeded';
    return 'budget_unavailable';
}

export async function deliverEmail(input: BudgetedEmail): Promise<EmailDeliveryResult> {
    const rawRecipients = Array.isArray(input.to) ? input.to : [input.to];
    const recipients = rawRecipients.map(normalizeEmailAddress);
    if (recipients.length === 0 || recipients.some((recipient) => !recipient)) {
        return { ok: false, reason: 'invalid_recipient' };
    }

    const normalizedRecipients = recipients as string[];
    const policy = getEmailDeliveryPolicy();
    const blockedReason = policyFailure(policy, normalizedRecipients);
    if (blockedReason) {
        console.warn(`[EmailBudget] blocked source=${safeToken(input.source, 'unknown', 80)} reason=${blockedReason}`);
        return { ok: false, reason: blockedReason };
    }

    if (!readRuntimeEnv('RESEND_API_KEY')) {
        return { ok: false, reason: 'provider_unavailable' };
    }

    const source = safeToken(input.source, 'unknown', 80);
    try {
        const supabaseAdmin = createSupabaseAdminClient();
        const { error: budgetError } = await supabaseAdmin.rpc('reserve_email_recipient_budget', {
            p_budget_scope: policy.budgetScope,
            p_recipient_count: normalizedRecipients.length,
            p_daily_limit: policy.dailyLimit,
            p_monthly_limit: policy.monthlyLimit,
            p_source: source,
        });

        if (budgetError) {
            const reason = classifyBudgetError(budgetError);
            console.warn(`[EmailBudget] blocked source=${source} reason=${reason}`);
            return { ok: false, reason };
        }
    } catch {
        console.warn(`[EmailBudget] blocked source=${source} reason=budget_unavailable`);
        return { ok: false, reason: 'budget_unavailable' };
    }

    try {
        const { error } = await getResend().emails.send({
            from: input.from ?? getEmailFrom(),
            to: input.to,
            subject: input.subject,
            html: input.html,
        });

        if (error) return { ok: false, reason: 'provider_error', error };
        return { ok: true };
    } catch (error) {
        return { ok: false, reason: 'provider_error', error };
    }
}
