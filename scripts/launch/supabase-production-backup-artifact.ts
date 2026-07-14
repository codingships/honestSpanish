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
