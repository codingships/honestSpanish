import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    FIXTURE_CLEANUP_DATABASE_ENV,
    FIXTURE_CLEANUP_TARGET,
    PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV,
    buildDatabaseToolProcessEnvironment,
    buildProductionLogicalBackupApproval,
    buildPsqlEnvironment,
    resolveNewBackupDestination,
    sanitizeOutput,
    sha256,
    stableJson,
} from './production-fixture-cleanup-shared';

type BackupMode = 'plan' | 'execute';

interface BackupOptions {
    mode: BackupMode;
    destination: string | null;
    executeApproved: boolean;
    restoreProcedureReviewed: boolean;
}

interface ToolResult {
    ok: boolean;
    status: number | null;
    stdout: string;
    stderr: string;
    error: string | null;
}

interface AtRestValidation {
    valid: boolean;
    reason: string;
}

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

const root = process.cwd();

export function parseProductionBackupArgs(args: string[]): BackupOptions {
    const modeCandidate = args[0] ?? 'plan';
    if (!['plan', 'execute'].includes(modeCandidate)) {
        throw new Error('Backup mode must be plan or execute.');
    }

    let destination: string | null = null;
    let executeApproved = false;
    let restoreProcedureReviewed = false;
    for (let index = 1; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--destination') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) throw new Error('--destination requires an absolute .dump path.');
            if (destination) throw new Error('--destination may only be supplied once.');
            destination = value;
            index += 1;
            continue;
        }
        if (argument === '--execute-approved') {
            if (executeApproved) throw new Error('--execute-approved may only be supplied once.');
            executeApproved = true;
            continue;
        }
        if (argument === '--restore-procedure-reviewed') {
            if (restoreProcedureReviewed) throw new Error('--restore-procedure-reviewed may only be supplied once.');
            restoreProcedureReviewed = true;
            continue;
        }
        throw new Error(`Unknown production-backup argument: ${argument}`);
    }

    const mode = modeCandidate as BackupMode;
    if (mode === 'plan' && (executeApproved || restoreProcedureReviewed)) {
        throw new Error('Execution attestations are accepted only in execute mode.');
    }
    return { mode, destination, executeApproved, restoreProcedureReviewed };
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

async function main(): Promise<void> {
    const startedAt = new Date();
    const outputDir = createOutputDir(startedAt);
    const options = parseProductionBackupArgs(process.argv.slice(2));

    let destination: string | null = null;
    let destinationBindingSha256: string | null = null;
    let atRestValidation: AtRestValidation | null = null;
    if (options.destination) {
        destination = resolveNewBackupDestination(options.destination, root);
        destinationBindingSha256 = sha256(normalizePathForBinding(destination));
        atRestValidation = verifyWindowsEfsDirectory(destination);
    }

    if (options.mode === 'plan') {
        const approval = destinationBindingSha256 && atRestValidation?.valid
            ? buildProductionLogicalBackupApproval(destinationBindingSha256)
            : '<supply an absolute, new .dump destination in a verifiably Windows-EFS encrypted directory outside the repository>';
        writeFileSync(path.join(outputDir, 'approval-template.txt'), `${approval}\n`, 'utf8');
        writeSummary(outputDir, {
            status: destination && !atRestValidation?.valid
                ? 'BLOCKED_DESTINATION_NOT_EFS'
                : 'PLAN_ONLY_READY',
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
            approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
            destinationValidatedOutsideRepository: destination !== null,
            destinationBindingSha256,
            atRestProtection: atRestValidation ?? { valid: false, reason: 'destination not supplied' },
            format: 'pg_dump custom archive',
            schemas: ['public', 'auth'],
            archiveVerification: 'pg_restore --list plus required TABLE DATA entries',
            executeRequirements: [
                '--destination <absolute-new-path-outside-repository.dump>',
                '--execute-approved',
                '--restore-procedure-reviewed',
                'destination parent verified encrypted by cipher.exe /c (Windows EFS)',
                `${PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV}=<exact approval from this plan>`,
                `${FIXTURE_CLEANUP_DATABASE_ENV}=<exact ${FIXTURE_CLEANUP_TARGET.projectRef} database URL>`,
            ],
            receiptContainsArtifactPath: false,
            networkAccessPerformed: false,
            databaseWritePerformed: false,
            localBackupWritten: false,
        });
        console.log(`${destination && !atRestValidation?.valid ? 'BLOCKED_DESTINATION_NOT_EFS' : 'PLAN_ONLY_READY'}: ${path.join(outputDir, 'summary.json')}`);
        return;
    }

    if (!destination || !destinationBindingSha256) {
        writeSummary(outputDir, {
            status: 'BLOCKED_DESTINATION_REQUIRED',
            networkAccessPerformed: false,
            databaseWritePerformed: false,
            localBackupWritten: false,
        });
        throw new Error('Execute mode requires --destination with an absolute new .dump path outside the repository.');
    }
    if (!atRestValidation?.valid) {
        writeSummary(outputDir, {
            status: 'BLOCKED_DESTINATION_NOT_EFS',
            destinationBindingSha256,
            atRestProtection: atRestValidation ?? { valid: false, reason: 'not checked' },
            networkAccessPerformed: false,
            databaseWritePerformed: false,
            localBackupWritten: false,
        });
        throw new Error('Backup destination parent is not verifiably protected by Windows EFS.');
    }
    if (!options.executeApproved || !options.restoreProcedureReviewed) {
        writeSummary(outputDir, {
            status: 'BLOCKED_EXECUTION_ATTESTATIONS_MISSING',
            required: ['--execute-approved', '--restore-procedure-reviewed'],
            destinationBindingSha256,
            networkAccessPerformed: false,
            databaseWritePerformed: false,
            localBackupWritten: false,
        });
        throw new Error('Execute mode requires --execute-approved and --restore-procedure-reviewed.');
    }

    const exactApproval = buildProductionLogicalBackupApproval(destinationBindingSha256);
    writeFileSync(path.join(outputDir, 'exact-approval-required.txt'), `${exactApproval}\n`, 'utf8');
    if (process.env[PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV] !== exactApproval) {
        writeSummary(outputDir, {
            status: 'BLOCKED_EXACT_APPROVAL_MISMATCH',
            destinationBindingSha256,
            exactApprovalFile: 'exact-approval-required.txt',
            networkAccessPerformed: false,
            databaseWritePerformed: false,
            localBackupWritten: false,
        });
        throw new Error(`Exact approval mismatch; inspect exact-approval-required.txt and set ${PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV}.`);
    }

    const databaseUrl = process.env[FIXTURE_CLEANUP_DATABASE_ENV];
    if (!databaseUrl) throw new Error(`${FIXTURE_CLEANUP_DATABASE_ENV} is required for execute mode.`);
    const connection = buildPsqlEnvironment(databaseUrl);
    const databaseToolEnvironment = buildDatabaseToolProcessEnvironment(connection, {
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=10000',
    });

    const pgDumpVersion = runTool('pg_dump', ['--version'], databaseToolEnvironment, 10_000);
    const pgRestoreVersion = runTool('pg_restore', ['--version'], databaseToolEnvironment, 10_000);
    if (!pgDumpVersion.ok || !pgRestoreVersion.ok) {
        throw new Error('pg_dump and pg_restore must both be installed and runnable before backup.');
    }
    if (existsSync(destination)) throw new Error('Backup destination appeared after approval; overwrite remains forbidden.');
    if (!verifyWindowsEfsDirectory(destination).valid) {
        throw new Error('Windows EFS protection could not be re-verified immediately before pg_dump.');
    }

    const dumpResult = runTool('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--serializable-deferrable',
        '--lock-wait-timeout=10s',
        '--schema=public',
        '--schema=auth',
        '--file',
        destination,
    ], databaseToolEnvironment, 180_000);

    if (!dumpResult.ok) {
        writeSummary(outputDir, {
            status: 'BACKUP_FAILED_NO_RECEIPT',
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            destinationBindingSha256,
            pgDumpExitCode: dumpResult.status,
            partialArtifactMayExist: existsSync(destination),
            diagnostic: redactBackupPath(safeDiagnostic(dumpResult), destination),
            databaseWritePerformed: false,
            localBackupWriteAttempted: true,
            nextAction: 'Do not reuse or overwrite the path. Inspect and remove any partial artifact manually before a new approved run.',
        });
        throw new Error('pg_dump failed; no backup receipt was issued.');
    }
    if (!existsSync(destination) || statSync(destination).size <= 0) {
        throw new Error('pg_dump returned success but the custom archive is missing or empty.');
    }
    if (!verifyWindowsEfsArtifact(destination).valid) {
        throw new Error('The completed backup artifact is not verifiably protected by Windows EFS; no receipt was issued.');
    }

    const restoreListResult = runTool(
        'pg_restore',
        ['--list', destination],
        databaseToolEnvironment,
        60_000,
    );
    if (!restoreListResult.ok) {
        throw new Error('pg_restore --list could not verify the custom archive; no receipt was issued.');
    }
    const archiveVerification = archiveContainsRequiredTableData(restoreListResult.stdout);
    if (!archiveVerification.ok) {
        writeSummary(outputDir, {
            status: 'BACKUP_ARCHIVE_INCOMPLETE_NO_RECEIPT',
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            destinationBindingSha256,
            missingRequiredTableData: archiveVerification.missing,
            tocEntryCount: archiveVerification.tocEntryCount,
            databaseWritePerformed: false,
            localBackupWritten: true,
        });
        throw new Error('Custom archive does not contain all required public/auth TABLE DATA entries.');
    }

    const artifactSha256 = await sha256FileStream(destination);
    const completedAt = new Date();
    const receipt = {
        schemaVersion: 1,
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        createdAt: completedAt.toISOString(),
        backupCompleted: true,
        artifactStoredOutsideRepository: true,
        atRestProtection: 'windows_efs',
        atRestProtectionVerified: true,
        artifactSha256,
        includedSchemas: ['public', 'auth'],
        verification: 'dump_hash_recorded',
        restoreProcedureReviewed: true,
        limitationsAcknowledged: [
            'storage_objects_not_included',
            'external_stripe_google_not_included',
            'selected_schemas_only',
        ],
        backupFormat: 'pg_dump_custom',
        archiveListVerified: true,
        archiveRequiredTableDataVerified: true,
        archiveTocEntryCount: archiveVerification.tocEntryCount,
        artifactBytes: statSync(destination).size,
        artifactPathRecorded: false,
        toolVersions: {
            pgDump: safeVersion(pgDumpVersion.stdout),
            pgRestore: safeVersion(pgRestoreVersion.stdout),
        },
    };
    const receiptPath = path.join(outputDir, 'backup-receipt.json');
    writeFileSync(receiptPath, stableJson(receipt), 'utf8');
    const receiptSha256 = sha256(stableJson(receipt));

    writeSummary(outputDir, {
        status: 'BACKUP_CREATED_AND_ARCHIVE_VERIFIED',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        destinationBindingSha256,
        artifactSha256,
        receiptSha256,
        receiptFile: path.basename(receiptPath),
        includedSchemas: ['public', 'auth'],
        archiveTocEntryCount: archiveVerification.tocEntryCount,
        artifactPathRecorded: false,
        networkAccessPerformed: true,
        databaseWritePerformed: false,
        localBackupWritten: true,
    });
    console.log(`BACKUP_CREATED_AND_ARCHIVE_VERIFIED: ${path.join(outputDir, 'summary.json')}`);
}

function runTool(
    executable: string,
    args: string[],
    environment: NodeJS.ProcessEnv,
    timeout: number,
): ToolResult {
    const result = spawnSync(executable, args, {
        env: environment,
        encoding: 'utf8',
        timeout,
        windowsHide: true,
    });
    const status = typeof result.status === 'number' ? result.status : null;
    return {
        ok: !result.error && status === 0,
        status,
        stdout: sanitizeOutput(result.stdout ?? ''),
        stderr: sanitizeOutput(result.stderr ?? ''),
        error: result.error ? sanitizeOutput(result.error.message) : null,
    };
}

export function cipherOutputShowsEncrypted(output: string): boolean {
    return output
        .split(/\r?\n/u)
        .some((line) => /^\s*E\s+\S/iu.test(line));
}

function verifyWindowsEfsDirectory(destination: string): AtRestValidation {
    if (process.platform !== 'win32') {
        return { valid: false, reason: 'automatic at-rest verification currently requires Windows EFS' };
    }
    const parent = path.dirname(destination);
    const result = spawnSync('cipher.exe', ['/c', parent], {
        env: localToolEnvironment(),
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
    });
    if (result.error || result.status !== 0) {
        return { valid: false, reason: 'cipher.exe could not verify the destination parent' };
    }
    return cipherOutputShowsEncrypted(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
        ? { valid: true, reason: 'destination parent verified as Windows EFS encrypted' }
        : { valid: false, reason: 'cipher.exe reports no encrypted destination marker' };
}

function verifyWindowsEfsArtifact(destination: string): AtRestValidation {
    if (process.platform !== 'win32') {
        return { valid: false, reason: 'automatic at-rest verification currently requires Windows EFS' };
    }
    const result = spawnSync('cipher.exe', ['/c', destination], {
        env: localToolEnvironment(),
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
    });
    if (result.error || result.status !== 0) {
        return { valid: false, reason: 'cipher.exe could not verify the completed backup artifact' };
    }
    return cipherOutputShowsEncrypted(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
        ? { valid: true, reason: 'completed backup artifact verified as Windows EFS encrypted' }
        : { valid: false, reason: 'cipher.exe reports no encrypted marker for the completed backup artifact' };
}

function localToolEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
        if (process.env[name]) environment[name] = process.env[name];
    }
    return environment;
}

function safeDiagnostic(result: ToolResult): string {
    const diagnostic = result.error ?? result.stderr.trim();
    return sanitizeOutput(diagnostic || `exit=${result.status ?? 'unknown'}`)
        .slice(0, 1_000);
}

function redactBackupPath(value: string, destination: string): string {
    return value
        .replaceAll(destination, '[redacted-backup-path]')
        .replaceAll(destination.replaceAll('\\', '/'), '[redacted-backup-path]');
}

function safeVersion(value: string): string {
    return sanitizeOutput(value.trim()).slice(0, 200);
}

async function sha256FileStream(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
    return hash.digest('hex');
}

function normalizePathForBinding(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function createOutputDir(startedAt: Date): string {
    const outputDir = path.join(
        root,
        'outputs',
        'launch-production-logical-backup',
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

function writeSummary(outputDir: string, summary: Record<string, unknown>): void {
    writeFileSync(path.join(outputDir, 'summary.json'), stableJson(summary), 'utf8');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    main().catch((error: unknown) => {
        console.error(sanitizeOutput(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
    });
}
