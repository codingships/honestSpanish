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

export type IdempotentEmailDeliveryResult =
    | { ok: true; providerId: string }
    | {
        acceptance: 'not_accepted' | 'ambiguous';
        error?: unknown;
        ok: false;
        reason: EmailDeliveryFailureReason | 'invalid_idempotency_key';
    };

export type PreReservedStagingSmokeEmailResult =
    | { ok: true; providerId: string }
    | {
        ok: false;
        reason: 'policy_invalid' | 'provider_error' | 'provider_unavailable';
        error?: unknown;
    };

export type BudgetedEmail = {
    from?: string;
    to: string | string[];
    subject: string;
    html: string;
    source: string;
};

export type IdempotentBudgetedEmail = Omit<BudgetedEmail, 'to'> & {
    idempotencyKey: string;
    to: string;
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

export function normalizeEmailAddressForDelivery(value: string): string | null {
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
            .map(normalizeEmailAddressForDelivery)
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

function classifyProviderErrorAcceptance(error: unknown): 'not_accepted' | 'ambiguous' {
    const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
    // Resend resolves fetch/network failures as an error with statusCode=null.
    // Only an explicit, definitive client rejection is safe to retry. A
    // timeout, conflict/in-flight idempotent request, 5xx, or unknown shape
    // may have reached the provider and must not be replayed blindly.
    if (
        typeof statusCode === 'number'
        && statusCode >= 400
        && statusCode < 500
        && statusCode !== 408
        && statusCode !== 409
    ) {
        return 'not_accepted';
    }
    return 'ambiguous';
}

export async function deliverEmail(input: BudgetedEmail): Promise<EmailDeliveryResult> {
    const rawRecipients = Array.isArray(input.to) ? input.to : [input.to];
    const recipients = rawRecipients.map(normalizeEmailAddressForDelivery);
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

/**
 * Provider delivery for a durable fulfillment effect. Unlike deliverEmail,
 * this exposes the provider ID and distinguishes a definite rejection from a
 * transport outcome where provider acceptance is unknown.
 */
export async function deliverIdempotentEmail(
    input: IdempotentBudgetedEmail,
): Promise<IdempotentEmailDeliveryResult> {
    const recipient = normalizeEmailAddressForDelivery(input.to);
    if (!recipient) {
        return { acceptance: 'not_accepted', ok: false, reason: 'invalid_recipient' };
    }
    if (
        input.idempotencyKey.length < 1
        || input.idempotencyKey.length > 256
        || !/^fulfillment\/[A-Za-z0-9_.:/-]+$/.test(input.idempotencyKey)
    ) {
        return { acceptance: 'not_accepted', ok: false, reason: 'invalid_idempotency_key' };
    }

    const policy = getEmailDeliveryPolicy();
    const blockedReason = policyFailure(policy, [recipient]);
    if (blockedReason) {
        console.warn(`[EmailBudget] blocked source=${safeToken(input.source, 'unknown', 80)} reason=${blockedReason}`);
        return { acceptance: 'not_accepted', ok: false, reason: blockedReason };
    }
    if (!readRuntimeEnv('RESEND_API_KEY')) {
        return { acceptance: 'not_accepted', ok: false, reason: 'provider_unavailable' };
    }

    const source = safeToken(input.source, 'unknown', 80);
    try {
        const supabaseAdmin = createSupabaseAdminClient();
        const { error: budgetError } = await supabaseAdmin.rpc('reserve_email_recipient_budget', {
            p_budget_scope: policy.budgetScope,
            p_recipient_count: 1,
            p_daily_limit: policy.dailyLimit,
            p_monthly_limit: policy.monthlyLimit,
            p_source: source,
        });

        if (budgetError) {
            const reason = classifyBudgetError(budgetError);
            console.warn(`[EmailBudget] blocked source=${source} reason=${reason}`);
            return { acceptance: 'not_accepted', ok: false, reason };
        }
    } catch {
        console.warn(`[EmailBudget] blocked source=${source} reason=budget_unavailable`);
        return { acceptance: 'not_accepted', ok: false, reason: 'budget_unavailable' };
    }

    try {
        const { data, error } = await getResend().emails.send({
            from: input.from ?? getEmailFrom(),
            to: recipient,
            subject: input.subject,
            html: input.html,
        }, { idempotencyKey: input.idempotencyKey });

        if (error) {
            return {
                acceptance: classifyProviderErrorAcceptance(error),
                ok: false,
                reason: 'provider_error',
                error,
            };
        }
        if (!data?.id) {
            return { acceptance: 'ambiguous', ok: false, reason: 'provider_error' };
        }
        return { ok: true, providerId: data.id };
    } catch (error) {
        return { acceptance: 'ambiguous', ok: false, reason: 'provider_error', error };
    }
}

export async function deliverPreReservedStagingSmokeEmail(input: {
    from: string;
    html: string;
    idempotencyKey: string;
    subject: string;
    to: string;
}): Promise<PreReservedStagingSmokeEmailResult> {
    const recipient = normalizeEmailAddressForDelivery(input.to);
    const policy = getEmailDeliveryPolicy();
    const rawDailyLimit = Number(readRuntimeEnv('EMAIL_DAILY_RECIPIENT_LIMIT'));
    const rawMonthlyLimit = Number(readRuntimeEnv('EMAIL_MONTHLY_RECIPIENT_LIMIT'));
    const configuredSender = readRuntimeEnv('EMAIL_FROM') || readRuntimeEnv('RESEND_FROM_EMAIL');
    const validIdempotencyKey = /^staging-integration-smoke\/email\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(
        input.idempotencyKey,
    );
    if (
        policy.appEnvironment !== 'staging'
        || policy.mode !== 'allowlist'
        || !recipient
        || !policy.recipientAllowlist.has(recipient)
        || !Number.isInteger(rawDailyLimit)
        || rawDailyLimit !== policy.dailyLimit
        || rawDailyLimit < 1
        || rawDailyLimit > STAGING_EMAIL_DAILY_RECIPIENT_LIMIT
        || !Number.isInteger(rawMonthlyLimit)
        || rawMonthlyLimit !== policy.monthlyLimit
        || rawMonthlyLimit < 1
        || rawMonthlyLimit > STAGING_EMAIL_MONTHLY_RECIPIENT_LIMIT
        || !configuredSender
        || input.from !== getEmailFrom()
        || !validIdempotencyKey
    ) {
        return { ok: false, reason: 'policy_invalid' };
    }
    if (!readRuntimeEnv('RESEND_API_KEY')) {
        return { ok: false, reason: 'provider_unavailable' };
    }

    try {
        const { data, error } = await getResend().emails.send({
            from: input.from,
            to: recipient,
            subject: input.subject,
            html: input.html,
        }, { idempotencyKey: input.idempotencyKey });
        if (error || !data?.id) {
            return { ok: false, reason: 'provider_error', error: error ?? undefined };
        }
        return { ok: true, providerId: data.id };
    } catch (error) {
        return { ok: false, reason: 'provider_error', error };
    }
}
