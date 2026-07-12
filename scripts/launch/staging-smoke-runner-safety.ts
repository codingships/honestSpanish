import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import path from 'node:path';

type BaseNodeCommandOptions = {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
    maxBuffer?: number;
};

export type DirectNodeCommandOptions = BaseNodeCommandOptions & {
    timeoutMs: number;
};

export type SafeWranglerWhoamiSummary = {
    authenticated: boolean;
    jsonParsed: boolean;
    accountIds: string[];
};

export const RESEND_FREE_DAILY_RECIPIENT_LIMIT = 10;
export const RESEND_FREE_MONTHLY_RECIPIENT_LIMIT = 100;
export const MAX_STAGING_SMOKE_PLANNED_RECIPIENTS = 8;
export const STAGING_SMOKE_EMAIL_RECIPIENT_PLAN = Object.freeze({
    classConfirmation: 2,
    classReminder: 2,
    classCancellation: 2,
    secondarySchedulingVariants: 0,
    cleanup: 0,
});
export const STAGING_SMOKE_PLANNED_RECIPIENTS = Object.values(
    STAGING_SMOKE_EMAIL_RECIPIENT_PLAN,
).reduce<number>((total, recipientCount) => total + recipientCount, 0);

export type StagingSmokeEmailBudgetAssessment = {
    allowed: boolean;
    reason:
        | 'within_limit'
        | 'invalid_budget_input'
        | 'configured_limit_exceeds_resend_free_cap'
        | 'smoke_plan_exceeds_maximum'
        | 'daily_budget_exceeded'
        | 'monthly_budget_exceeded';
    currentDailyRecipients: number;
    currentMonthlyRecipients: number;
    plannedSmokeRecipients: number;
    projectedDailyRecipients: number;
    projectedMonthlyRecipients: number;
    configuredDailyLimit: number;
    configuredMonthlyLimit: number;
    effectiveDailyLimit: number;
    effectiveMonthlyLimit: number;
    resendFreeDailyLimit: number;
    resendFreeMonthlyLimit: number;
};

export function assessStagingSmokeEmailBudget(input: {
    currentDailyRecipients: number;
    currentMonthlyRecipients: number;
    configuredDailyLimit: number;
    configuredMonthlyLimit: number;
    plannedSmokeRecipients?: number;
}): StagingSmokeEmailBudgetAssessment {
    const plannedSmokeRecipients = input.plannedSmokeRecipients
        ?? STAGING_SMOKE_PLANNED_RECIPIENTS;
    const validInputs = [
        input.currentDailyRecipients,
        input.currentMonthlyRecipients,
        input.configuredDailyLimit,
        input.configuredMonthlyLimit,
        plannedSmokeRecipients,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
        && input.configuredDailyLimit > 0
        && input.configuredMonthlyLimit > 0;
    const projectedDailyRecipients = input.currentDailyRecipients + plannedSmokeRecipients;
    const projectedMonthlyRecipients = input.currentMonthlyRecipients + plannedSmokeRecipients;
    const effectiveDailyLimit = Math.min(
        input.configuredDailyLimit,
        RESEND_FREE_DAILY_RECIPIENT_LIMIT,
    );
    const effectiveMonthlyLimit = Math.min(
        input.configuredMonthlyLimit,
        RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
    );

    let reason: StagingSmokeEmailBudgetAssessment['reason'] = 'within_limit';
    if (!validInputs) {
        reason = 'invalid_budget_input';
    } else if (
        input.configuredDailyLimit > RESEND_FREE_DAILY_RECIPIENT_LIMIT
        || input.configuredMonthlyLimit > RESEND_FREE_MONTHLY_RECIPIENT_LIMIT
    ) {
        reason = 'configured_limit_exceeds_resend_free_cap';
    } else if (plannedSmokeRecipients > MAX_STAGING_SMOKE_PLANNED_RECIPIENTS) {
        reason = 'smoke_plan_exceeds_maximum';
    } else if (projectedDailyRecipients > effectiveDailyLimit) {
        reason = 'daily_budget_exceeded';
    } else if (projectedMonthlyRecipients > effectiveMonthlyLimit) {
        reason = 'monthly_budget_exceeded';
    }

    return {
        allowed: reason === 'within_limit',
        reason,
        currentDailyRecipients: input.currentDailyRecipients,
        currentMonthlyRecipients: input.currentMonthlyRecipients,
        plannedSmokeRecipients,
        projectedDailyRecipients,
        projectedMonthlyRecipients,
        configuredDailyLimit: input.configuredDailyLimit,
        configuredMonthlyLimit: input.configuredMonthlyLimit,
        effectiveDailyLimit,
        effectiveMonthlyLimit,
        resendFreeDailyLimit: RESEND_FREE_DAILY_RECIPIENT_LIMIT,
        resendFreeMonthlyLimit: RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
    };
}

export function parseStagingSmokeEmailBudget(
    stdout: string,
): StagingSmokeEmailBudgetAssessment | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout.trim()) as unknown;
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const budget = (parsed as { emailRecipientBudget?: unknown }).emailRecipientBudget;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)) return null;
    const candidate = budget as Record<string, unknown>;
    const numericNames = [
        'currentDailyRecipients',
        'currentMonthlyRecipients',
        'plannedSmokeRecipients',
        'projectedDailyRecipients',
        'projectedMonthlyRecipients',
        'configuredDailyLimit',
        'configuredMonthlyLimit',
        'effectiveDailyLimit',
        'effectiveMonthlyLimit',
        'resendFreeDailyLimit',
        'resendFreeMonthlyLimit',
    ] as const;
    if (numericNames.some((name) => !Number.isSafeInteger(candidate[name]))) return null;
    if (candidate.allowed !== true || candidate.reason !== 'within_limit') return null;

    const assessment = assessStagingSmokeEmailBudget({
        currentDailyRecipients: candidate.currentDailyRecipients as number,
        currentMonthlyRecipients: candidate.currentMonthlyRecipients as number,
        configuredDailyLimit: candidate.configuredDailyLimit as number,
        configuredMonthlyLimit: candidate.configuredMonthlyLimit as number,
        plannedSmokeRecipients: candidate.plannedSmokeRecipients as number,
    });
    if (
        !assessment.allowed
        || assessment.projectedDailyRecipients !== candidate.projectedDailyRecipients
        || assessment.projectedMonthlyRecipients !== candidate.projectedMonthlyRecipients
        || assessment.effectiveDailyLimit !== candidate.effectiveDailyLimit
        || assessment.effectiveMonthlyLimit !== candidate.effectiveMonthlyLimit
        || assessment.resendFreeDailyLimit !== candidate.resendFreeDailyLimit
        || assessment.resendFreeMonthlyLimit !== candidate.resendFreeMonthlyLimit
        || assessment.plannedSmokeRecipients !== STAGING_SMOKE_PLANNED_RECIPIENTS
    ) {
        return null;
    }

    return assessment;
}

export function runDirectNodeCommand(
    args: string[],
    options: DirectNodeCommandOptions,
): SpawnSyncReturns<string> {
    return spawnNodeCommand(args, options, options.timeoutMs);
}

export function runCleanupOwnedNodeCommand(
    args: string[],
    options: Pick<BaseNodeCommandOptions, 'cwd' | 'env'>,
): SpawnSyncReturns<Buffer> {
    // A write-capable child owns provider cleanup in its own finally blocks.
    // The parent must wait for that child to return instead of killing it at an
    // arbitrary deadline or output-buffer ceiling that can strand smoke
    // artifacts. The harness writes its own redacted evidence; parent capture
    // intentionally does not buffer child output.
    return spawnSync(process.execPath, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'ignore',
        windowsHide: true,
    });
}

function spawnNodeCommand(
    args: string[],
    options: BaseNodeCommandOptions,
    timeoutMs?: number,
): SpawnSyncReturns<string> {
    const spawnOptions = {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env,
        input: options.input,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
    } as const;
    return timeoutMs === undefined
        ? spawnSync(process.execPath, args, spawnOptions)
        : spawnSync(process.execPath, args, { ...spawnOptions, timeout: timeoutMs });
}

export function tsxScriptArgs(scriptPath: string, args: string[] = []): string[] {
    return ['--import', 'tsx', scriptPath, ...args];
}

export function wranglerCliArgs(args: string[], workspaceRoot = process.cwd()): string[] {
    return [path.join(workspaceRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...args];
}

export function parseWranglerWhoamiSummary(
    stdout: string,
    exitCode: number | null,
): SafeWranglerWhoamiSummary {
    const parsed = parseFirstJsonDocument(stdout);

    const accountIds = new Set<string>();
    collectAccountIds(parsed, accountIds, false);

    return {
        authenticated: exitCode === 0,
        jsonParsed: parsed !== null,
        accountIds: [...accountIds].sort(),
    };
}

function parseFirstJsonDocument(stdout: string): unknown | null {
    for (let start = 0; start < stdout.length; start += 1) {
        const opening = stdout[start];
        if (opening !== '{' && opening !== '[') continue;

        const closing = opening === '{' ? '}' : ']';
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let end = start; end < stdout.length; end += 1) {
            const character = stdout[end];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (character === '\\') {
                    escaped = true;
                } else if (character === '"') {
                    inString = false;
                }
                continue;
            }

            if (character === '"') {
                inString = true;
                continue;
            }
            if (character === opening) depth += 1;
            if (character === closing) depth -= 1;
            if (depth !== 0) continue;

            try {
                return JSON.parse(stdout.slice(start, end + 1)) as unknown;
            } catch {
                break;
            }
        }
    }

    // The persisted summary records only that parsing failed. Raw identity
    // output (including an operator email) must never be written as evidence.
    return null;
}

export function sanitizeStagingSmokeCapture(value: string): string {
    return value
        .replace(/-----BEGIN ([A-Z0-9][A-Z0-9 ._\/-]*?)-----[\s\S]*?-----END \1-----/gu, '[redacted-pem-block]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted-email]')
        .replace(/https:\/\/checkout\.stripe\.com\/[^\s"')]+/g, '[redacted-checkout-url]')
        .replace(/\b(?:cs|cus|sub|in|pi|evt|price|prod|pm)_(?:test|live)?_?[A-Za-z0-9_]+\b/g, '[redacted-stripe-id]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{8,}/g, '[redacted-stripe-secret]')
        .replace(/pk_(live|test)_[A-Za-z0-9]{8,}/g, '[redacted-stripe-publishable]')
        .replace(/whsec_[A-Za-z0-9]{8,}/g, '[redacted-webhook-secret]')
        .replace(/sb_secret_[A-Za-z0-9_-]{8,}/g, '[redacted-supabase-secret]')
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted-google-key]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{8,}/g, '[redacted-resend-key]')
        .replace(/(postgres|postgresql):\/\/[^\s"']+/g, '[redacted-postgres-url]');
}

function collectAccountIds(value: unknown, output: Set<string>, insideAccounts: boolean): void {
    if (Array.isArray(value)) {
        for (const item of value) collectAccountIds(item, output, insideAccounts);
        return;
    }
    if (!value || typeof value !== 'object') return;

    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
        const nextInsideAccounts = insideAccounts || normalizedKey === 'accounts';
        const isAccountIdKey = normalizedKey === 'accountid'
            || (nextInsideAccounts && normalizedKey === 'id');
        if (isAccountIdKey && typeof entry === 'string' && /^[0-9a-f]{32}$/iu.test(entry)) {
            output.add(entry.toLowerCase());
        }
        collectAccountIds(entry, output, nextInsideAccounts);
    }
}
