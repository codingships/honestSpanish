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
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(stdout.trim()) as unknown;
    } catch {
        // The persisted summary records only that parsing failed. Raw identity
        // output (including an operator email) must never be written as evidence.
    }

    const accountIds = new Set<string>();
    collectAccountIds(parsed, accountIds, false);

    return {
        authenticated: exitCode === 0,
        jsonParsed: parsed !== null,
        accountIds: [...accountIds].sort(),
    };
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
