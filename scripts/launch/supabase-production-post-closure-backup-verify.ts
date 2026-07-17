import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    createReadStream,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    sha256,
    stableJson,
} from './production-fixture-cleanup-shared';
import {
    compareArchiveToLiveInventory,
    parseArchivePublicAuthTableData,
    POST_CLOSURE_PUBLIC_TABLES,
    validatePostClosureBackupReceipt,
    type PostClosureBackupReceipt,
} from './supabase-production-post-closure-backup';
import {
    cipherOutputShowsEncrypted,
    validatePostClosureArchiveInventory,
} from './supabase-production-backup-artifact';

export const POST_CLOSURE_BACKUP_VERIFY_STATUS = 'POST_CLOSURE_BACKUP_REVALIDATED_LOCALLY';
export const POST_CLOSURE_BACKUP_VERIFY_FAILED_STATUS = 'POST_CLOSURE_BACKUP_LOCAL_REVALIDATION_FAILED';

export interface PostClosureBackupVerifyOptions {
    artifact: string;
    receipt: string;
}

interface ArchiveListResult {
    ok: boolean;
    stdout: string;
}

export interface PostClosureBackupVerifyRuntime {
    verifyWindowsEfsArtifact: (artifactPath: string) => boolean;
    listArchive: (artifactPath: string) => ArchiveListResult;
    sha256File: (artifactPath: string) => Promise<string>;
}

export interface PostClosureBackupVerificationReceipt {
    schemaVersion: 1;
    receiptKind: 'supabase_production_post_closure_backup_local_revalidation';
    status: typeof POST_CLOSURE_BACKUP_VERIFY_STATUS;
    targetEnvironment: 'production';
    targetProjectRef: string;
    canonicalGitSha: string;
    sourceReceiptSha256: string;
    destinationBindingSha256: string;
    artifactSha256: string;
    artifactBytes: number;
    tableContractSha256: string;
    liveInventorySha256: string;
    livePublicTableCount: number;
    liveAuthTableCount: number;
    archiveTocEntryCount: number;
    receiptContractVerified: true;
    destinationBindingVerified: true;
    atRestProtectionVerified: true;
    archiveListVerified: true;
    archiveMatchesPostClosureContract: true;
    archiveMatchesFullReceiptInventory: true;
    artifactPathRecorded: false;
    sourceReceiptPathRecorded: false;
    networkAccessPerformed: false;
    credentialEnvironmentRead: false;
    databaseReadPerformed: false;
    databaseWritePerformed: false;
    externalServiceWritePerformed: false;
    verifiedAt: string;
}

export interface PostClosureBackupVerificationResult {
    valid: boolean;
    verificationReceipt: PostClosureBackupVerificationReceipt | null;
    errors: string[];
}

interface LoadedReceipt {
    value: PostClosureBackupReceipt;
    sha256: string;
}

const root = process.cwd();
const MAX_RECEIPT_BYTES = 64 * 1_024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function parsePostClosureBackupVerifyArgs(
    args: readonly string[],
): PostClosureBackupVerifyOptions {
    let artifact: string | null = null;
    let receipt: string | null = null;
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--artifact') {
            artifact = uniqueValue(argument, artifact, args[index + 1]);
            index += 1;
            continue;
        }
        if (argument === '--receipt') {
            receipt = uniqueValue(argument, receipt, args[index + 1]);
            index += 1;
            continue;
        }
        throw new Error(`Unknown post-closure backup verification argument: ${argument}`);
    }
    if (!artifact) throw new Error('--artifact is required.');
    if (!receipt) throw new Error('--receipt is required.');
    if (!path.isAbsolute(artifact)) throw new Error('--artifact must be an absolute path.');
    return { artifact, receipt };
}

export function normalizePostClosureBackupPathForBinding(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function destinationBindingForExistingArtifact(
    artifactPath: string,
    repositoryRoot = process.cwd(),
): { artifactPath: string; destinationBindingSha256: string } {
    if (!path.isAbsolute(artifactPath) || !artifactPath.toLowerCase().endsWith('.dump')) {
        throw new Error('Artifact must be an absolute .dump path.');
    }
    if (!existsSync(artifactPath)) throw new Error('Artifact does not exist.');
    const artifactLstat = lstatSync(artifactPath);
    if (!artifactLstat.isFile() || artifactLstat.isSymbolicLink()) {
        throw new Error('Artifact must be an ordinary non-symlink file.');
    }

    const resolvedArtifact = path.resolve(artifactPath);
    const realArtifact = realpathSync.native(resolvedArtifact);
    const realRepository = realpathSync.native(repositoryRoot);
    const relative = path.relative(realRepository, realArtifact);
    const insideRepository = relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    if (insideRepository) throw new Error('Artifact must be outside the repository.');

    return {
        artifactPath: resolvedArtifact,
        destinationBindingSha256: sha256(normalizePostClosureBackupPathForBinding(resolvedArtifact)),
    };
}

export function loadExactPostClosureBackupReceipt(
    receiptPath: string,
    now = new Date(),
): LoadedReceipt {
    const resolved = path.resolve(receiptPath);
    if (!existsSync(resolved)) throw new Error('Receipt does not exist.');
    const receiptLstat = lstatSync(resolved);
    if (!receiptLstat.isFile() || receiptLstat.isSymbolicLink()
        || receiptLstat.size < 1 || receiptLstat.size > MAX_RECEIPT_BYTES) {
        throw new Error('Receipt must be a bounded ordinary non-symlink file.');
    }

    let rawText: string;
    let raw: unknown;
    try {
        rawText = readFileSync(resolved, 'utf8');
        raw = JSON.parse(rawText) as unknown;
    } catch {
        throw new Error('Receipt must be readable JSON.');
    }
    const errors = validatePostClosureBackupReceipt(raw, now);
    if (errors.length > 0) {
        throw new Error(`Receipt contract validation failed: ${errors.join(' ')}`);
    }
    if (rawText !== stableJson(raw)) {
        throw new Error('Receipt JSON is not in the canonical exact form emitted by the backup runner.');
    }
    if (receiptContainsPathOrSecret(rawText)) {
        throw new Error('Receipt contains path, identity, URL or secret-like material.');
    }
    return {
        value: raw as PostClosureBackupReceipt,
        sha256: sha256(rawText),
    };
}

export async function verifyPostClosureBackupLocally(input: {
    artifactPath: string;
    receiptPath: string;
    repositoryRoot?: string;
    runtime?: PostClosureBackupVerifyRuntime;
    now?: Date;
}): Promise<PostClosureBackupVerificationResult> {
    const errors: string[] = [];
    const verificationTime = input.now ?? new Date();
    if (!Number.isFinite(verificationTime.getTime())) {
        return {
            valid: false,
            verificationReceipt: null,
            errors: ['The local verification timestamp is invalid.'],
        };
    }
    let receipt: LoadedReceipt | null = null;
    try {
        receipt = loadExactPostClosureBackupReceipt(input.receiptPath, verificationTime);
    } catch (error) {
        errors.push(controlledError(error, 'The post-closure backup receipt could not be validated.'));
    }

    let artifact: { artifactPath: string; destinationBindingSha256: string } | null = null;
    try {
        artifact = destinationBindingForExistingArtifact(
            input.artifactPath,
            input.repositoryRoot ?? process.cwd(),
        );
    } catch {
        errors.push('The artifact must be an existing ordinary non-symlink .dump file outside the repository.');
    }
    if (!receipt || !artifact) return { valid: false, verificationReceipt: null, errors };

    if (artifact.destinationBindingSha256 !== receipt.value.destinationBindingSha256) {
        errors.push('The artifact destination binding does not match the source receipt.');
    }

    const artifactStat = statSync(artifact.artifactPath);
    if (!Number.isSafeInteger(artifactStat.size) || artifactStat.size < 1) {
        errors.push('The artifact is empty or has an invalid size.');
    } else if (artifactStat.size !== receipt.value.artifactBytes) {
        errors.push('The artifact size does not match the source receipt.');
    }

    const runtime = input.runtime ?? defaultRuntime();
    let efsVerified = false;
    try {
        efsVerified = runtime.verifyWindowsEfsArtifact(artifact.artifactPath);
    } catch {
        efsVerified = false;
    }
    if (!efsVerified) errors.push('Windows EFS protection could not be re-verified.');

    let artifactSha256: string | null = null;
    try {
        artifactSha256 = await runtime.sha256File(artifact.artifactPath);
    } catch {
        errors.push('The artifact SHA-256 could not be recalculated.');
    }
    if (!artifactSha256 || !SHA256_PATTERN.test(artifactSha256)
        || artifactSha256 !== receipt.value.artifactSha256) {
        errors.push('The artifact SHA-256 does not match the source receipt.');
    }

    let archiveList = '';
    try {
        const listed = runtime.listArchive(artifact.artifactPath);
        if (listed.ok) archiveList = listed.stdout;
    } catch {
        archiveList = '';
    }
    if (!archiveList) {
        errors.push('pg_restore --list could not read the artifact.');
    } else {
        validateArchiveAgainstReceipt(archiveList, receipt.value, errors);
    }

    let finalArtifactStable = false;
    try {
        const finalLstat = lstatSync(artifact.artifactPath);
        const finalStat = statSync(artifact.artifactPath);
        const finalBinding = destinationBindingForExistingArtifact(
            artifact.artifactPath,
            input.repositoryRoot ?? process.cwd(),
        );
        finalArtifactStable = finalLstat.isFile()
            && !finalLstat.isSymbolicLink()
            && finalBinding.destinationBindingSha256 === artifact.destinationBindingSha256
            && finalStat.dev === artifactStat.dev
            && finalStat.ino === artifactStat.ino
            && finalStat.size === artifactStat.size
            && finalStat.mtimeMs === artifactStat.mtimeMs
            && runtime.verifyWindowsEfsArtifact(artifact.artifactPath);
    } catch {
        finalArtifactStable = false;
    }
    if (!finalArtifactStable) {
        errors.push('The artifact identity, contents or EFS state changed during local verification.');
    }

    if (errors.length > 0 || artifactSha256 === null) {
        return { valid: false, verificationReceipt: null, errors: deduplicate(errors) };
    }

    return {
        valid: true,
        errors: [],
        verificationReceipt: {
            schemaVersion: 1,
            receiptKind: 'supabase_production_post_closure_backup_local_revalidation',
            status: POST_CLOSURE_BACKUP_VERIFY_STATUS,
            targetEnvironment: 'production',
            targetProjectRef: receipt.value.targetProjectRef,
            canonicalGitSha: receipt.value.canonicalGitSha,
            sourceReceiptSha256: receipt.sha256,
            destinationBindingSha256: receipt.value.destinationBindingSha256,
            artifactSha256,
            artifactBytes: artifactStat.size,
            tableContractSha256: receipt.value.tableContractSha256,
            liveInventorySha256: receipt.value.liveInventorySha256,
            livePublicTableCount: receipt.value.livePublicTableCount,
            liveAuthTableCount: receipt.value.liveAuthTableCount,
            archiveTocEntryCount: receipt.value.archiveTocEntryCount,
            receiptContractVerified: true,
            destinationBindingVerified: true,
            atRestProtectionVerified: true,
            archiveListVerified: true,
            archiveMatchesPostClosureContract: true,
            archiveMatchesFullReceiptInventory: true,
            artifactPathRecorded: false,
            sourceReceiptPathRecorded: false,
            networkAccessPerformed: false,
            credentialEnvironmentRead: false,
            databaseReadPerformed: false,
            databaseWritePerformed: false,
            externalServiceWritePerformed: false,
            verifiedAt: verificationTime.toISOString(),
        },
    };
}

function validateArchiveAgainstReceipt(
    archiveList: string,
    receipt: PostClosureBackupReceipt,
    errors: string[],
): void {
    const inventory = parseArchivePublicAuthTableData(archiveList);
    const publicInventory = inventory.filter((entry) => entry.startsWith('public.'));
    const authInventory = inventory.filter((entry) => entry.startsWith('auth.'));
    const expectedPublicInventory = POST_CLOSURE_PUBLIC_TABLES
        .map((table) => `public.${table}`)
        .sort();

    const archiveContract = validatePostClosureArchiveInventory(
        archiveList,
        expectedPublicInventory,
    );
    if (!archiveContract.ok) {
        errors.push('The archive does not match the exact post-closure public/auth contract.');
    }
    const comparison = compareArchiveToLiveInventory(archiveList, inventory);
    if (!comparison.ok) {
        errors.push('The archive TABLE DATA inventory is internally inconsistent.');
    }
    if (stableJson(publicInventory) !== stableJson(expectedPublicInventory)) {
        errors.push('The archive public TABLE DATA inventory is not the exact 22-table contract.');
    }
    if (!authInventory.includes('auth.users') || authInventory.length !== receipt.liveAuthTableCount) {
        errors.push('The archive auth TABLE DATA inventory does not match the receipt count or lacks auth.users.');
    }
    if (publicInventory.length !== receipt.livePublicTableCount) {
        errors.push('The archive public TABLE DATA count does not match the receipt.');
    }
    if (sha256(stableJson(inventory)) !== receipt.liveInventorySha256) {
        errors.push('The archive public/auth TABLE DATA inventory hash does not match the receipt.');
    }
    if (archiveContract.tocEntryCount !== receipt.archiveTocEntryCount) {
        errors.push('The archive TOC entry count does not match the receipt.');
    }
    if (countPublicAuthTableDataEntries(archiveList) !== inventory.length) {
        errors.push('The archive contains duplicate or malformed public/auth TABLE DATA entries.');
    }
}

function countPublicAuthTableDataEntries(archiveList: string): number {
    let count = 0;
    for (const line of archiveList.split(/\r?\n/u)) {
        const match = /\bTABLE DATA\s+("?[a-z_][a-z0-9_]*"?)\s+("?[a-z_][a-z0-9_]*"?)\s+/iu.exec(line);
        if (!match) continue;
        const schema = match[1].replaceAll('"', '').toLowerCase();
        if (schema === 'public' || schema === 'auth') count += 1;
    }
    return count;
}

function defaultRuntime(): PostClosureBackupVerifyRuntime {
    return {
        verifyWindowsEfsArtifact: (artifactPath) => {
            if (process.platform !== 'win32') return false;
            const result = spawnSync('cipher.exe', ['/c', artifactPath], {
                env: localToolEnvironment(),
                encoding: 'utf8',
                timeout: 10_000,
                windowsHide: true,
            });
            return !result.error && result.status === 0
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
                stdout: String(result.stdout ?? ''),
            };
        },
        sha256File,
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

function receiptContainsPathOrSecret(raw: string): boolean {
    return /@/u.test(raw)
        || /(?:https?|postgres(?:ql)?):\/\//iu.test(raw)
        || /(?:[a-z]:[\\/]|\\\\[^\\])/iu.test(raw)
        || /"\s*:\s*"\//u.test(raw)
        || /(?:sk|pk)_(?:live|test)_[a-z0-9]+/iu.test(raw)
        || /\b(?:sbp|eyJ)[a-z0-9_.-]{12,}/iu.test(raw)
        || /\b(?:password|token|secret|private[_ -]?key)\s*[=:]\s*[^\s",}]+/iu.test(raw);
}

function uniqueValue(
    argument: string,
    previous: string | null,
    next: string | undefined,
): string {
    if (previous !== null) throw new Error(`${argument} may only be supplied once.`);
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires an explicit value.`);
    return next;
}

function controlledError(error: unknown, fallback: string): string {
    if (!(error instanceof Error)) return fallback;
    const safePrefixes = [
        'Receipt contract validation failed:',
        'Receipt JSON is not in the canonical exact form',
        'Receipt contains path, identity, URL or secret-like material',
        'Receipt must be a bounded ordinary non-symlink file',
        'Receipt must be readable JSON',
        'Receipt does not exist',
    ];
    return safePrefixes.some((prefix) => error.message.startsWith(prefix)) ? error.message : fallback;
}

function deduplicate(errors: readonly string[]): string[] {
    return [...new Set(errors)];
}

export function createPostClosureBackupVerifyOutputDirectory(
    startedAt: Date,
    repositoryRoot = process.cwd(),
): string {
    const outputRoot = path.join(
        repositoryRoot,
        'outputs',
        'launch-supabase-production-post-closure-backup-verify',
    );
    mkdirSync(outputRoot, { recursive: true });
    const realRepositoryRoot = realpathSync.native(repositoryRoot);
    const realOutputRoot = realpathSync.native(outputRoot);
    const outputRelative = path.relative(realRepositoryRoot, realOutputRoot);
    if (!outputRelative
        || outputRelative.startsWith(`..${path.sep}`)
        || outputRelative === '..'
        || path.isAbsolute(outputRelative)) {
        throw new Error('Verification output directory must resolve inside the repository.');
    }
    const outputDirectory = path.join(
        outputRoot,
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDirectory, { recursive: false });
    return outputDirectory;
}

async function main(): Promise<void> {
    const options = parsePostClosureBackupVerifyArgs(process.argv.slice(2));
    const startedAt = new Date();
    const outputDirectory = createPostClosureBackupVerifyOutputDirectory(startedAt, root);
    const result = await verifyPostClosureBackupLocally({
        artifactPath: options.artifact,
        receiptPath: options.receipt,
        now: startedAt,
    });

    if (!result.valid || !result.verificationReceipt) {
        const failure = {
            schemaVersion: 1,
            status: POST_CLOSURE_BACKUP_VERIFY_FAILED_STATUS,
            artifactPathRecorded: false,
            sourceReceiptPathRecorded: false,
            networkAccessPerformed: false,
            credentialEnvironmentRead: false,
            databaseReadPerformed: false,
            databaseWritePerformed: false,
            externalServiceWritePerformed: false,
            errors: result.errors,
        };
        writeFileSync(path.join(outputDirectory, 'summary.json'), stableJson(failure), {
            encoding: 'utf8',
            flag: 'wx',
        });
        throw new Error(`${POST_CLOSURE_BACKUP_VERIFY_FAILED_STATUS}; inspect the path-free summary.`);
    }

    const verificationReceipt = stableJson(result.verificationReceipt);
    const verificationReceiptSha256 = sha256(verificationReceipt);
    writeFileSync(path.join(outputDirectory, 'verification-receipt.json'), verificationReceipt, {
        encoding: 'utf8',
        flag: 'wx',
    });
    writeFileSync(path.join(outputDirectory, 'summary.json'), stableJson({
        schemaVersion: 1,
        status: POST_CLOSURE_BACKUP_VERIFY_STATUS,
        verificationReceiptSha256,
        artifactPathRecorded: false,
        sourceReceiptPathRecorded: false,
        networkAccessPerformed: false,
        credentialEnvironmentRead: false,
        databaseReadPerformed: false,
        databaseWritePerformed: false,
        externalServiceWritePerformed: false,
    }), {
        encoding: 'utf8',
        flag: 'wx',
    });
    console.log(`${POST_CLOSURE_BACKUP_VERIFY_STATUS}: ${repositoryRelativeOutputPath(path.join(outputDirectory, 'summary.json'))}`);
}

function repositoryRelativeOutputPath(filePath: string): string {
    const relative = path.relative(root, filePath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Output evidence path escaped the repository.');
    }
    return relative.replaceAll('\\', '/');
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : POST_CLOSURE_BACKUP_VERIFY_FAILED_STATUS);
        process.exitCode = 1;
    });
}
