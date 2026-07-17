import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    createReadStream,
    existsSync,
    lstatSync,
    realpathSync,
    statSync,
} from 'node:fs';
import path from 'node:path';
import {
    sha256,
    stableJson,
    type BackupReceipt,
} from './production-fixture-cleanup-shared';

const REQUIRED_ARCHIVE_TABLE_DATA = [
    ['auth', 'users'],
    ['public', 'profiles'],
    ['public', 'profiles_private'],
    ['public', 'packages'],
    ['public', 'subscriptions'],
    ['public', 'student_teachers'],
    ['public', 'sessions'],
    ['public', 'payments'],
    ['public', 'leads'],
    ['public', 'processed_webhook_events'],
    ['public', 'fulfillment_jobs'],
    ['public', 'jobs'],
    ['public', 'support_tickets'],
    ['public', 'admin_audit_log'],
    ['public', 'teacher_availability'],
] as const;

const POST_CLOSURE_PUBLIC_TABLE_DATA = [
    'leads',
    'profiles',
    'profiles_private',
    'packages',
    'package_prices',
    'subscriptions',
    'student_teachers',
    'sessions',
    'payments',
    'processed_webhook_events',
    'fulfillment_jobs',
    'fulfillment_effects',
    'email_recipient_budget_usage',
    'support_tickets',
    'crm_contacts',
    'crm_opportunities',
    'checkout_intents',
    'crm_tasks',
    'crm_activities',
    'crm_consents',
    'admin_audit_log',
    'teacher_availability',
] as const;

const POST_CLOSURE_FORBIDDEN_PUBLIC_TABLE_DATA = [
    'public.jobs',
    'public.staging_integration_smoke_runs',
    'public.staging_integration_smoke_leases',
] as const;

const POST_CLOSURE_REQUIRED_TABLE_DATA = [
    'auth.users',
    ...POST_CLOSURE_PUBLIC_TABLE_DATA.map((table) => `public.${table}`),
] as const;

interface ArchiveListResult {
    ok: boolean;
    stdout: string;
}

export interface BackupArtifactRuntime {
    verifyWindowsEfsArtifact: (artifactPath: string) => boolean;
    listArchive: (artifactPath: string) => ArchiveListResult;
    sha256File: (artifactPath: string) => Promise<string>;
}

export interface BackupArtifactRevalidation {
    provided: boolean;
    valid: boolean;
    artifactSha256: string | null;
    artifactBytes: number | null;
    atRestProtectionVerified: boolean;
    archiveListVerified: boolean;
    archiveRequiredTableDataVerified: boolean;
    archiveTocEntryCount: number | null;
    verificationSha256: string;
    pathRecorded: false;
    errors: string[];
}

export function archiveContainsRequiredTableData(archiveList: string): {
    ok: boolean;
    missing: string[];
    tocEntryCount: number;
} {
    const missing = REQUIRED_ARCHIVE_TABLE_DATA
        .filter(([schema, table]) => !new RegExp(
            `\\bTABLE DATA\\s+${escapeRegExp(schema)}\\s+${escapeRegExp(table)}\\b`,
            'u',
        ).test(archiveList))
        .map(([schema, table]) => `${schema}.${table}`);
    const tocEntryCount = archiveList
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(';'))
        .length;
    return { ok: missing.length === 0 && tocEntryCount > 0, missing, tocEntryCount };
}

export interface PostClosureArchiveInventoryValidation {
    ok: boolean;
    missing: string[];
    unexpected: string[];
    forbidden: string[];
    tocEntryCount: number;
}

/**
 * Validates the post-closure backup inventory without changing the historical
 * pre-rollout contract used by archiveContainsRequiredTableData.
 *
 * Other auth TABLE DATA entries are intentionally allowed because a dump of
 * the auth schema contains Supabase-managed tables. When supplied, the live
 * inventory must contain fully-qualified public table names.
 */
export function validatePostClosureArchiveInventory(
    archiveList: string,
    livePublicTableInventory?: readonly string[],
): PostClosureArchiveInventoryValidation {
    const archiveInventory = parseArchiveTableDataInventory(archiveList);
    const archiveRelevant = new Set([
        ...(archiveInventory.has('auth.users') ? ['auth.users'] : []),
        ...[...archiveInventory].filter((entry) => entry.startsWith('public.')),
    ]);
    const liveInventory = livePublicTableInventory === undefined
        ? null
        : new Set(livePublicTableInventory.map((entry) => entry.trim()));

    const missing = POST_CLOSURE_REQUIRED_TABLE_DATA.filter((entry) => {
        if (!archiveRelevant.has(entry)) return true;
        return entry.startsWith('public.') && liveInventory !== null && !liveInventory.has(entry);
    });
    const observedPublic = new Set([
        ...[...archiveRelevant].filter((entry) => entry.startsWith('public.')),
        ...[...(liveInventory ?? [])],
    ]);
    const forbidden = POST_CLOSURE_FORBIDDEN_PUBLIC_TABLE_DATA
        .filter((entry) => observedPublic.has(entry));
    const required = new Set<string>(POST_CLOSURE_REQUIRED_TABLE_DATA);
    const forbiddenSet = new Set<string>(POST_CLOSURE_FORBIDDEN_PUBLIC_TABLE_DATA);
    const unexpected = [...observedPublic]
        .filter((entry) => !required.has(entry) && !forbiddenSet.has(entry))
        .sort();
    const tocEntryCount = archiveList
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith(';'))
        .length;

    return {
        ok: tocEntryCount > 0
            && missing.length === 0
            && unexpected.length === 0
            && forbidden.length === 0,
        missing: [...missing],
        unexpected,
        forbidden: [...forbidden],
        tocEntryCount,
    };
}

export async function revalidateProductionBackupArtifact(input: {
    artifactPath: string | null;
    receipt: BackupReceipt | null;
    repositoryRoot?: string;
    runtime?: BackupArtifactRuntime;
}): Promise<BackupArtifactRevalidation> {
    const errors: string[] = [];
    const result = {
        provided: input.artifactPath !== null,
        artifactSha256: null as string | null,
        artifactBytes: null as number | null,
        atRestProtectionVerified: false,
        archiveListVerified: false,
        archiveRequiredTableDataVerified: false,
        archiveTocEntryCount: null as number | null,
        pathRecorded: false as const,
    };
    if (!input.artifactPath) {
        errors.push('The current backup artifact path was not supplied.');
        return finalize(result, errors);
    }
    if (!input.receipt) {
        errors.push('A validated backup receipt is required before artifact revalidation.');
        return finalize(result, errors);
    }

    let artifactPath: string;
    try {
        artifactPath = resolveExistingBackupArtifact(input.artifactPath, input.repositoryRoot ?? process.cwd());
    } catch {
        errors.push('The backup artifact must be an existing ordinary .dump file outside the repository.');
        return finalize(result, errors);
    }

    const artifactStat = statSync(artifactPath);
    result.artifactBytes = artifactStat.size;
    if (!Number.isSafeInteger(artifactStat.size) || artifactStat.size <= 0) {
        errors.push('The backup artifact is empty or has an invalid size.');
    } else if (artifactStat.size !== input.receipt.artifactBytes) {
        errors.push('The backup artifact size does not match the receipt.');
    }

    const runtime = input.runtime ?? defaultRuntime();
    try {
        result.atRestProtectionVerified = runtime.verifyWindowsEfsArtifact(artifactPath);
    } catch {
        result.atRestProtectionVerified = false;
    }
    if (!result.atRestProtectionVerified) {
        errors.push('Windows EFS protection could not be re-verified for the backup artifact.');
    }

    try {
        result.artifactSha256 = await runtime.sha256File(artifactPath);
    } catch {
        errors.push('The backup artifact SHA-256 could not be recalculated.');
    }
    if (result.artifactSha256 !== input.receipt.artifactSha256) {
        errors.push('The backup artifact SHA-256 does not match the receipt.');
    }

    let archiveList: ArchiveListResult = { ok: false, stdout: '' };
    try {
        archiveList = runtime.listArchive(artifactPath);
    } catch {
        archiveList = { ok: false, stdout: '' };
    }
    result.archiveListVerified = archiveList.ok;
    if (!archiveList.ok) {
        errors.push('pg_restore --list could not read the backup artifact.');
    } else {
        const archive = archiveContainsRequiredTableData(archiveList.stdout);
        result.archiveRequiredTableDataVerified = archive.ok;
        result.archiveTocEntryCount = archive.tocEntryCount;
        if (!archive.ok) errors.push('The backup artifact TOC is missing required public/auth TABLE DATA entries.');
        if (archive.tocEntryCount !== input.receipt.archiveTocEntryCount) {
            errors.push('The backup artifact TOC entry count does not match the receipt.');
        }
    }

    return finalize(result, errors);
}

export function cipherOutputShowsEncrypted(output: string): boolean {
    return output
        .split(/\r?\n/u)
        .some((line) => /^\s*E\s+\S/iu.test(line));
}

function resolveExistingBackupArtifact(artifactPath: string, repositoryRoot: string): string {
    if (!path.isAbsolute(artifactPath) || !artifactPath.toLowerCase().endsWith('.dump')) {
        throw new Error('invalid artifact path');
    }
    if (!existsSync(artifactPath)) throw new Error('artifact missing');
    const artifactLstat = lstatSync(artifactPath);
    if (!artifactLstat.isFile() || artifactLstat.isSymbolicLink()) throw new Error('artifact is not an ordinary file');
    const realArtifact = realpathSync(artifactPath);
    const realRoot = realpathSync(repositoryRoot);
    const relative = path.relative(realRoot, realArtifact);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new Error('artifact is inside repository');
    }
    return realArtifact;
}

function defaultRuntime(): BackupArtifactRuntime {
    return {
        verifyWindowsEfsArtifact: (artifactPath) => {
            if (process.platform !== 'win32') return false;
            const result = spawnSync('cipher.exe', ['/c', artifactPath], {
                env: localToolEnvironment(),
                encoding: 'utf8',
                timeout: 10_000,
                windowsHide: true,
            });
            return !result.error
                && result.status === 0
                && cipherOutputShowsEncrypted(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
        },
        listArchive: (artifactPath) => {
            const result = spawnSync('pg_restore', ['--list', artifactPath], {
                env: localToolEnvironment(),
                encoding: 'utf8',
                timeout: 60_000,
                windowsHide: true,
            });
            return {
                ok: !result.error && result.status === 0,
                stdout: result.stdout ?? '',
            };
        },
        sha256File,
    };
}

function finalize(
    result: Omit<BackupArtifactRevalidation, 'valid' | 'verificationSha256' | 'errors'>,
    errors: string[],
): BackupArtifactRevalidation {
    const core = {
        ...result,
        valid: errors.length === 0,
    };
    return {
        ...core,
        verificationSha256: sha256(stableJson(core)),
        errors,
    };
}

function localToolEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
        if (process.env[name]) environment[name] = process.env[name];
    }
    return environment;
}

async function sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
    return hash.digest('hex');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseArchiveTableDataInventory(archiveList: string): Set<string> {
    const inventory = new Set<string>();
    for (const line of archiveList.split(/\r?\n/u)) {
        const match = line.match(/(?:^|\s)TABLE DATA\s+(\S+)\s+(\S+)(?:\s|$)/u);
        if (match?.[1] && match[2]) inventory.add(`${match[1]}.${match[2]}`);
    }
    return inventory;
}
