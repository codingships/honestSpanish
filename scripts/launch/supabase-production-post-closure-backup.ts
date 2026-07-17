import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    closeSync,
    createReadStream,
    existsSync,
    fstatSync,
    ftruncateSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    realpathSync,
    statSync,
    writeSync,
    writeFileSync,
    type Dirent,
    type Stats,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv, parse as parseDotenv } from 'dotenv';
import {
    FIXTURE_CLEANUP_DATABASE_ENV,
    FIXTURE_CLEANUP_TARGET,
    buildDatabaseToolProcessEnvironment,
    buildPsqlEnvironment,
    resolveNewBackupDestination,
    sanitizeOutput,
    sha256,
    stableJson,
    type DatabaseConnectionEnvironment,
} from './production-fixture-cleanup-shared';
import {
    parseProductionInertFinalReadback,
    productionInertDatabaseStateSha256,
    PRODUCTION_INERT_FINAL_ATTEMPT_FILE,
    PRODUCTION_INERT_FINAL_OUTPUT_FILE,
    PRODUCTION_INERT_FINAL_STATUS,
    renderProductionInertFinalReadbackSql,
    validateProductionInertFinalAttemptSummary,
    validateProductionInertFinalReadback,
    validateProductionInertFinalReceipt,
    type ProductionInertDatabaseReadback,
    type ProductionInertFinalAttemptSummary,
    type ProductionInertFinalReceipt,
} from './production-inert-final-readonly-shared';
import {
    cipherOutputShowsEncrypted,
    validatePostClosureArchiveInventory,
} from './supabase-production-backup-artifact';
import {
    safeErrorMessage,
    verifyLiveProductionAuthInert,
} from './supabase-auth-config-shared';
import {
    SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET,
    withSupabaseAuthManagementClient,
} from './supabase-cli-windows-credential';

export const POST_CLOSURE_BACKUP_APPROVAL_ENV = 'SUPABASE_PRODUCTION_POST_CLOSURE_BACKUP_APPROVAL';
export const POST_CLOSURE_BACKUP_RECEIPT_KIND = 'supabase_production_post_closure_logical_backup';
export const POST_CLOSURE_BACKUP_STATUS = 'POST_CLOSURE_BACKUP_CREATED_AND_ARCHIVE_VERIFIED';
export const POST_CLOSURE_MINIMUM_EVIDENCE_TTL_MS = 5 * 60 * 1_000;
export const PRODUCTION_INERT_FINAL_ATTEMPTS_DIRECTORY = path.join(
    'outputs',
    'launch-production-inert-final-readonly',
);

export const POST_CLOSURE_PUBLIC_TABLES = Object.freeze([
    'admin_audit_log',
    'checkout_intents',
    'crm_activities',
    'crm_consents',
    'crm_contacts',
    'crm_opportunities',
    'crm_tasks',
    'email_recipient_budget_usage',
    'fulfillment_effects',
    'fulfillment_jobs',
    'leads',
    'package_prices',
    'packages',
    'payments',
    'processed_webhook_events',
    'profiles',
    'profiles_private',
    'sessions',
    'student_teachers',
    'subscriptions',
    'support_tickets',
    'teacher_availability',
] as const);

export const POST_CLOSURE_FORBIDDEN_PUBLIC_TABLES = Object.freeze([
    'jobs',
    'staging_integration_smoke_leases',
    'staging_integration_smoke_runs',
] as const);

export const POST_CLOSURE_TABLE_CONTRACT_SHA256 = sha256(stableJson({
    schemaVersion: 1,
    requiredPublicBaseTables: POST_CLOSURE_PUBLIC_TABLES,
    requiredAuthBaseTables: ['users'],
    forbiddenPublicBaseTables: POST_CLOSURE_FORBIDDEN_PUBLIC_TABLES,
    archiveMustMatchFullLivePublicAndAuthInventory: true,
}));

type PostClosureBackupMode = 'plan' | 'execute';

export interface PostClosureBackupOptions {
    mode: PostClosureBackupMode;
    destination: string;
    productionInertEvidencePath: string;
    canonicalSha: string;
    executeApproved: boolean;
    restoreProcedureReviewed: boolean;
}

export interface LoadedProductionInertFinalEvidence {
    value: ProductionInertFinalReceipt;
    sha256: string;
    databaseStateSha256: string;
    summary: ProductionInertFinalAttemptSummary;
    receiptPath: string;
}

export interface LiveTableInventoryValidation {
    ok: boolean;
    missingPublic: string[];
    unexpectedPublic: string[];
    missingAuth: string[];
}

export interface ArchiveLiveInventoryComparison {
    ok: boolean;
    missingFromArchive: string[];
    unexpectedInArchive: string[];
}

interface ToolResult {
    ok: boolean;
    status: number | null;
    stdout: string;
    stderr: string;
    error: string | null;
}

interface GitIdentity {
    branch: string;
    head: string;
    originMain: string;
    clean: boolean;
}

interface AtRestValidation {
    valid: boolean;
    reason: string;
}

export interface ReservedArtifactFingerprint {
    device: number;
    inode: number;
    birthtimeMs: number;
    size: number;
    mtimeMs: number;
}

export type ArtifactExecutionPhase =
    | 'DESTINATION_RESERVED'
    | 'EMPTY_ARTIFACT_EFS_VERIFIED'
    | 'LOCAL_ENVIRONMENT_VALIDATED'
    | 'READ_ONLY_PREFLIGHT_VERIFIED'
    | 'DUMP_IN_PROGRESS'
    | 'DUMP_PINNED'
    | 'POST_DUMP_READBACKS_VERIFIED'
    | 'ARTIFACT_FINAL_REVALIDATED'
    | 'RECEIPT_PERSISTED'
    | 'COMPLETE';

interface PostClosureBackupReceiptInput {
    canonicalGitSha: string;
    productionInertEvidenceSha256: string;
    databaseStateSha256: string;
    destinationBindingSha256: string;
    liveInventorySha256: string;
    livePublicTableCount: number;
    liveAuthTableCount: number;
    archiveTocEntryCount: number;
    artifactSha256: string;
    artifactBytes: number;
    toolVersions: {
        pgDump: string;
        pgRestore: string;
        psql: string;
    };
    createdAt?: Date;
}

export interface PostClosureBackupReceipt {
    schemaVersion: 1;
    receiptKind: typeof POST_CLOSURE_BACKUP_RECEIPT_KIND;
    status: typeof POST_CLOSURE_BACKUP_STATUS;
    targetEnvironment: 'production';
    targetProjectRef: typeof FIXTURE_CLEANUP_TARGET.projectRef;
    canonicalGitSha: string;
    productionInertEvidenceSha256: string;
    databaseStateSha256: string;
    tableContractSha256: string;
    destinationBindingSha256: string;
    createdAt: string;
    method: 'logical_dump';
    backupFormat: 'pg_dump_custom';
    includedSchemas: ['public', 'auth'];
    backupCompleted: true;
    artifactStoredOutsideRepository: true;
    atRestProtection: 'windows_efs';
    atRestProtectionVerified: true;
    liveInventorySha256: string;
    livePublicTableCount: number;
    liveAuthTableCount: number;
    stableLiveInventoryReadbacks: 2;
    stableProductionInertRowStateReadbacks: 2;
    liveAuthConfigurationReadbacks: 2;
    archiveListVerified: true;
    archiveMatchesPostClosureContract: true;
    archiveMatchesFullLiveInventory: true;
    archiveTocEntryCount: number;
    artifactSha256: string;
    artifactBytes: number;
    artifactPathRecorded: false;
    restoreProcedureReviewed: true;
    restorePerformed: false;
    restoreValidation: 'tabletop_pg_restore_list_only';
    databaseWritePerformed: false;
    externalServiceWritePerformed: false;
    limitationsAcknowledged: [
        'storage_objects_not_included',
        'custom_role_passwords_not_included',
        'external_stripe_google_not_included',
        'selected_schemas_only',
        'ownership_and_privileges_not_included',
        'no_full_restore_executed_tabletop_only',
    ];
    toolVersions: {
        pgDump: string;
        pgRestore: string;
        psql: string;
    };
}

const root = process.cwd();
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const TABLE_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/u;

export function parsePostClosureBackupArgs(args: readonly string[]): PostClosureBackupOptions {
    const mode = args[0] ?? 'plan';
    if (mode !== 'plan' && mode !== 'execute') {
        throw new Error('Post-closure backup mode must be plan or execute.');
    }

    let destination: string | null = null;
    let productionInertEvidencePath: string | null = null;
    let canonicalSha: string | null = null;
    let executeApproved = false;
    let restoreProcedureReviewed = false;
    for (let index = 1; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--destination') {
            destination = uniqueValue(argument, destination, args[index + 1]);
            index += 1;
            continue;
        }
        if (argument === '--production-inert-evidence') {
            productionInertEvidencePath = uniqueValue(argument, productionInertEvidencePath, args[index + 1]);
            index += 1;
            continue;
        }
        if (argument === '--canonical-sha') {
            canonicalSha = uniqueValue(argument, canonicalSha, args[index + 1]);
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
        throw new Error(`Unknown post-closure-backup argument: ${argument}`);
    }

    if (!destination) throw new Error('--destination is required in plan and execute modes.');
    if (!productionInertEvidencePath) {
        throw new Error('--production-inert-evidence is required in plan and execute modes.');
    }
    if (!canonicalSha || !GIT_SHA_PATTERN.test(canonicalSha)) {
        throw new Error('--canonical-sha must be the exact lowercase 40-character canonical Git SHA.');
    }
    if (mode === 'plan' && (executeApproved || restoreProcedureReviewed)) {
        throw new Error('Execution attestations are accepted only in execute mode.');
    }

    return {
        mode,
        destination,
        productionInertEvidencePath,
        canonicalSha,
        executeApproved,
        restoreProcedureReviewed,
    };
}

export function loadProductionInertFinalEvidence(
    evidencePath: string,
    now = new Date(),
    options: {
        attemptsRoot?: string;
        minimumRemainingTtlMs?: number;
    } = {},
): LoadedProductionInertFinalEvidence {
    const attemptsRoot = options.attemptsRoot
        ? path.resolve(options.attemptsRoot)
        : path.join(root, PRODUCTION_INERT_FINAL_ATTEMPTS_DIRECTORY);
    const minimumRemainingTtlMs = options.minimumRemainingTtlMs
        ?? POST_CLOSURE_MINIMUM_EVIDENCE_TTL_MS;
    if (!Number.isSafeInteger(minimumRemainingTtlMs) || minimumRemainingTtlMs < 0) {
        throw new Error('Production inert final evidence TTL margin must be a non-negative integer.');
    }

    const latestAttempt = findLatestProductionInertFinalAttempt(attemptsRoot);
    let rawSummary: unknown;
    try {
        rawSummary = JSON.parse(readFileSync(latestAttempt.summaryPath, 'utf8')) as unknown;
    } catch {
        throw new Error('The latest real production inert final attempt has an unreadable summary.');
    }
    const summaryErrors = validateProductionInertFinalAttemptSummary(rawSummary, now);
    if (summaryErrors.length > 0) {
        throw new Error(`The latest real production inert final attempt summary is invalid: ${summaryErrors.join(' ')}`);
    }
    const summary = rawSummary as ProductionInertFinalAttemptSummary;
    if (summary.startedAt !== latestAttempt.startedAt.toISOString()) {
        throw new Error('The latest real production inert final attempt directory does not match summary.startedAt.');
    }
    if (summary.status !== PRODUCTION_INERT_FINAL_STATUS) {
        throw new Error(`The latest real production inert final attempt is ${summary.status}; a prior receipt cannot be reused.`);
    }

    const expectedReceiptPath = path.join(latestAttempt.directory, PRODUCTION_INERT_FINAL_OUTPUT_FILE);
    const suppliedReceiptPath = path.resolve(root, evidencePath);
    if (normalizePathForBinding(suppliedReceiptPath) !== normalizePathForBinding(expectedReceiptPath)) {
        throw new Error('Production inert final evidence must be the canonical receipt from the latest real attempt.');
    }
    let canonicalAttemptsRoot: string;
    let canonicalExpectedReceiptPath: string;
    let canonicalSuppliedReceiptPath: string;
    try {
        canonicalAttemptsRoot = realpathSync(attemptsRoot);
        canonicalExpectedReceiptPath = realpathSync(expectedReceiptPath);
        canonicalSuppliedReceiptPath = realpathSync(suppliedReceiptPath);
    } catch {
        throw new Error('The latest production inert final receipt path is missing or cannot be canonicalized.');
    }
    if (!pathIsWithin(canonicalAttemptsRoot, canonicalExpectedReceiptPath)
        || normalizePathForBinding(canonicalExpectedReceiptPath)
            !== normalizePathForBinding(canonicalSuppliedReceiptPath)) {
        throw new Error('Production inert final evidence canonical path is outside or aliases the latest real attempt.');
    }

    let rawReceiptText: string;
    let rawReceipt: unknown;
    try {
        rawReceiptText = readFileSync(canonicalExpectedReceiptPath, 'utf8');
        rawReceipt = JSON.parse(rawReceiptText) as unknown;
    } catch {
        throw new Error('The latest production inert final evidence must be a readable JSON receipt.');
    }
    const errors = validateProductionInertFinalReceipt(rawReceipt, now);
    if (errors.length > 0) {
        throw new Error(`Production inert final evidence is invalid or stale: ${errors.join(' ')}`);
    }
    const receipt = rawReceipt as ProductionInertFinalReceipt;
    const canonicalReceipt = stableJson(receipt);
    if (rawReceiptText !== canonicalReceipt) {
        throw new Error('Production inert final evidence file is not in canonical receipt form.');
    }
    const receiptSha256 = sha256(canonicalReceipt);
    if (summary.receiptFile !== PRODUCTION_INERT_FINAL_OUTPUT_FILE
        || summary.receiptSha256 !== receiptSha256
        || summary.receiptObservedAt !== receipt.observedAt
        || summary.receiptExpiresAt !== receipt.expiresAt) {
        throw new Error('The latest attempt summary does not bind exactly to its production inert final receipt.');
    }
    const remainingTtlMs = Date.parse(receipt.expiresAt) - now.getTime();
    if (remainingTtlMs < minimumRemainingTtlMs) {
        throw new Error(`Production inert final evidence requires at least ${minimumRemainingTtlMs} ms of remaining TTL.`);
    }
    return {
        value: receipt,
        sha256: receiptSha256,
        databaseStateSha256: receipt.databaseStateSha256,
        summary,
        receiptPath: canonicalExpectedReceiptPath,
    };
}

export function assertProductionInertRowStateMatchesEvidence(
    readback: ProductionInertDatabaseReadback,
    evidence: LoadedProductionInertFinalEvidence,
    label: string,
): string {
    const errors = validateProductionInertFinalReadback(
        readback,
        evidence.value.preservedSetSha256,
        evidence.value.preservedRoleBindingSha256,
    );
    if (errors.length > 0) {
        throw new Error(`${label} production inert row-state readback failed: ${errors.join(' ')}`);
    }
    const stateSha256 = productionInertDatabaseStateSha256(readback);
    if (stateSha256 !== evidence.databaseStateSha256) {
        throw new Error(`${label} production inert row-state SHA-256 does not match the supplied receipt.`);
    }
    return stateSha256;
}

export function redactExpectedProductionEmails(
    value: string,
    emails: readonly string[],
): string {
    return emails.reduce(
        (redacted, email) => email ? redacted.replaceAll(email, '[redacted-email]') : redacted,
        value,
    );
}

export function captureReservedArtifactFingerprint(
    descriptor: number,
    destination: string,
): ReservedArtifactFingerprint {
    const handleStat = fstatSync(descriptor);
    const pathStat = statSync(destination);
    if (!handleStat.isFile() || !pathStat.isFile()) {
        throw new Error('Reserved backup artifact must remain a regular file.');
    }
    if (!sameArtifactIdentity(handleStat, pathStat)) {
        throw new Error('Reserved backup artifact path no longer identifies the open file handle.');
    }
    return {
        device: handleStat.dev,
        inode: handleStat.ino,
        birthtimeMs: handleStat.birthtimeMs,
        size: handleStat.size,
        mtimeMs: handleStat.mtimeMs,
    };
}

export function assertReservedArtifactFingerprint(
    descriptor: number,
    destination: string,
    expected: ReservedArtifactFingerprint,
): ReservedArtifactFingerprint {
    const observed = captureReservedArtifactFingerprint(descriptor, destination);
    for (const key of [
        'device',
        'inode',
        'birthtimeMs',
        'size',
        'mtimeMs',
    ] as const) {
        if (observed[key] !== expected[key]) {
            throw new Error(`Reserved backup artifact ${key} changed after the dump was pinned.`);
        }
    }
    return observed;
}

const EFS_RESERVATION_SENTINEL = Buffer.from([0x45]);

export function prepareReservedArtifactForEncryptedDump(
    descriptor: number,
    destination: string,
    verifyArtifactEfs: (artifactPath: string) => { valid: boolean } = verifyWindowsEfsArtifact,
): ReservedArtifactFingerprint {
    const reservedArtifact = captureReservedArtifactFingerprint(descriptor, destination);
    if (reservedArtifact.size !== 0) {
        throw new Error('Exclusive backup reservation was not created as an empty file.');
    }

    try {
        const bytesWritten = writeSync(
            descriptor,
            EFS_RESERVATION_SENTINEL,
            0,
            EFS_RESERVATION_SENTINEL.length,
            0,
        );
        if (bytesWritten !== EFS_RESERVATION_SENTINEL.length) {
            throw new Error('The EFS reservation sentinel was not written completely.');
        }
        fsyncSync(descriptor);

        const sentinelArtifact = captureReservedArtifactFingerprint(descriptor, destination);
        if (!samePinnedArtifactIdentity(reservedArtifact, sentinelArtifact)
            || sentinelArtifact.size !== EFS_RESERVATION_SENTINEL.length) {
            throw new Error('Reserved backup artifact identity changed while proving Windows EFS protection.');
        }
        if (!verifyArtifactEfs(destination).valid) {
            throw new Error('The exclusive backup artifact did not inherit verifiable Windows EFS protection.');
        }
    } finally {
        ftruncateSync(descriptor, 0);
        fsyncSync(descriptor);
    }

    const restoredArtifact = captureReservedArtifactFingerprint(descriptor, destination);
    if (!samePinnedArtifactIdentity(reservedArtifact, restoredArtifact)
        || restoredArtifact.size !== 0) {
        throw new Error('Reserved backup artifact was not restored safely after proving Windows EFS protection.');
    }
    return restoredArtifact;
}

export async function sha256PinnedReservedArtifact(
    descriptor: number,
    destination: string,
    expected: ReservedArtifactFingerprint,
): Promise<string> {
    assertReservedArtifactFingerprint(descriptor, destination, expected);
    const digest = await sha256FileStream(destination);
    assertReservedArtifactFingerprint(descriptor, destination, expected);
    return digest;
}

export function buildPostClosureBackupApproval(input: {
    canonicalGitSha: string;
    productionInertEvidenceSha256: string;
    databaseStateSha256: string;
    destinationBindingSha256: string;
}): string {
    if (!GIT_SHA_PATTERN.test(input.canonicalGitSha)) {
        throw new Error('canonicalGitSha must be a lowercase 40-character Git SHA.');
    }
    for (const [name, value] of Object.entries(input).filter(([name]) => name !== 'canonicalGitSha')) {
        if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256 hash.`);
    }
    return [
        'AUTORIZO EL BACKUP LOGICO POSCIERRE DE SUPABASE PRODUCCION',
        `target=${FIXTURE_CLEANUP_TARGET.projectRef}`,
        `canonical_sha=${input.canonicalGitSha}`,
        `production_inert_evidence=${input.productionInertEvidenceSha256}`,
        `database_state=${input.databaseStateSha256}`,
        `table_contract=${POST_CLOSURE_TABLE_CONTRACT_SHA256}`,
        `destination_binding=${input.destinationBindingSha256}`,
        'format=pg_dump_custom',
        'schemas=public,auth',
        'destination_outside_repository=true',
        'at_rest_protection=windows_efs',
        'overwrite=FORBIDDEN',
        'database_writes=FORBIDDEN',
        'external_service_writes=FORBIDDEN',
        'restore_procedure_reviewed=true',
        'restore_validation=TABLETOP_PG_RESTORE_LIST_ONLY',
        'storage_and_external_providers=NOT_INCLUDED',
    ].join(' | ');
}

export function parseLiveTableInventory(output: string): string[] {
    const inventory = new Set<string>();
    for (const rawLine of output.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = line.split('\t');
        if (parts.length !== 2) throw new Error('Live table inventory returned an invalid row.');
        const [schema, table] = parts;
        if (!['public', 'auth'].includes(schema) || !TABLE_NAME_PATTERN.test(table)) {
            throw new Error('Live table inventory returned an unexpected schema or table name.');
        }
        const qualified = `${schema}.${table}`;
        if (inventory.has(qualified)) throw new Error('Live table inventory returned a duplicate row.');
        inventory.add(qualified);
    }
    return [...inventory].sort();
}

export function validateLivePostClosureInventory(
    inventory: readonly string[],
): LiveTableInventoryValidation {
    const expectedPublic = POST_CLOSURE_PUBLIC_TABLES.map((table) => `public.${table}`).sort();
    const actualPublic = inventory.filter((entry) => entry.startsWith('public.')).sort();
    const actualAuth = inventory.filter((entry) => entry.startsWith('auth.')).sort();
    const missingPublic = expectedPublic.filter((entry) => !actualPublic.includes(entry));
    const unexpectedPublic = actualPublic.filter((entry) => !expectedPublic.includes(entry));
    const missingAuth = actualAuth.includes('auth.users') ? [] : ['auth.users'];
    return {
        ok: missingPublic.length === 0 && unexpectedPublic.length === 0 && missingAuth.length === 0,
        missingPublic,
        unexpectedPublic,
        missingAuth,
    };
}

export function parseArchivePublicAuthTableData(archiveList: string): string[] {
    const inventory = new Set<string>();
    for (const line of archiveList.split(/\r?\n/u)) {
        const match = /\bTABLE DATA\s+("?[a-z_][a-z0-9_]*"?)\s+("?[a-z_][a-z0-9_]*"?)\s+/iu.exec(line);
        if (!match) continue;
        const schema = match[1].replaceAll('"', '').toLowerCase();
        const table = match[2].replaceAll('"', '').toLowerCase();
        if (schema === 'public' || schema === 'auth') inventory.add(`${schema}.${table}`);
    }
    return [...inventory].sort();
}

export function compareArchiveToLiveInventory(
    archiveList: string,
    liveInventory: readonly string[],
): ArchiveLiveInventoryComparison {
    const archiveInventory = parseArchivePublicAuthTableData(archiveList);
    const expected = [...new Set(liveInventory)].sort();
    const missingFromArchive = expected.filter((entry) => !archiveInventory.includes(entry));
    const unexpectedInArchive = archiveInventory.filter((entry) => !expected.includes(entry));
    return {
        ok: missingFromArchive.length === 0 && unexpectedInArchive.length === 0,
        missingFromArchive,
        unexpectedInArchive,
    };
}

export function createPostClosureBackupReceipt(
    input: PostClosureBackupReceiptInput,
): PostClosureBackupReceipt {
    if (!GIT_SHA_PATTERN.test(input.canonicalGitSha)) {
        throw new Error('Post-closure backup receipt requires an exact canonical Git SHA.');
    }
    for (const [name, value] of Object.entries({
        productionInertEvidenceSha256: input.productionInertEvidenceSha256,
        databaseStateSha256: input.databaseStateSha256,
        destinationBindingSha256: input.destinationBindingSha256,
        liveInventorySha256: input.liveInventorySha256,
        artifactSha256: input.artifactSha256,
    })) {
        if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256 hash.`);
    }
    if (input.livePublicTableCount !== POST_CLOSURE_PUBLIC_TABLES.length) {
        throw new Error('Post-closure backup receipt requires exactly 22 live public tables.');
    }
    if (!Number.isSafeInteger(input.liveAuthTableCount) || input.liveAuthTableCount < 1) {
        throw new Error('Post-closure backup receipt requires at least auth.users.');
    }
    if (!Number.isSafeInteger(input.archiveTocEntryCount) || input.archiveTocEntryCount < 1) {
        throw new Error('Post-closure backup receipt requires a non-empty archive TOC.');
    }
    if (!Number.isSafeInteger(input.artifactBytes) || input.artifactBytes < 1) {
        throw new Error('Post-closure backup receipt requires a non-empty artifact.');
    }
    return {
        schemaVersion: 1,
        receiptKind: POST_CLOSURE_BACKUP_RECEIPT_KIND,
        status: POST_CLOSURE_BACKUP_STATUS,
        targetEnvironment: 'production',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        canonicalGitSha: input.canonicalGitSha,
        productionInertEvidenceSha256: input.productionInertEvidenceSha256,
        databaseStateSha256: input.databaseStateSha256,
        tableContractSha256: POST_CLOSURE_TABLE_CONTRACT_SHA256,
        destinationBindingSha256: input.destinationBindingSha256,
        createdAt: (input.createdAt ?? new Date()).toISOString(),
        method: 'logical_dump',
        backupFormat: 'pg_dump_custom',
        includedSchemas: ['public', 'auth'],
        backupCompleted: true,
        artifactStoredOutsideRepository: true,
        atRestProtection: 'windows_efs',
        atRestProtectionVerified: true,
        liveInventorySha256: input.liveInventorySha256,
        livePublicTableCount: input.livePublicTableCount,
        liveAuthTableCount: input.liveAuthTableCount,
        stableLiveInventoryReadbacks: 2,
        stableProductionInertRowStateReadbacks: 2,
        liveAuthConfigurationReadbacks: 2,
        archiveListVerified: true,
        archiveMatchesPostClosureContract: true,
        archiveMatchesFullLiveInventory: true,
        archiveTocEntryCount: input.archiveTocEntryCount,
        artifactSha256: input.artifactSha256,
        artifactBytes: input.artifactBytes,
        artifactPathRecorded: false,
        restoreProcedureReviewed: true,
        restorePerformed: false,
        restoreValidation: 'tabletop_pg_restore_list_only',
        databaseWritePerformed: false,
        externalServiceWritePerformed: false,
        limitationsAcknowledged: [
            'storage_objects_not_included',
            'custom_role_passwords_not_included',
            'external_stripe_google_not_included',
            'selected_schemas_only',
            'ownership_and_privileges_not_included',
            'no_full_restore_executed_tabletop_only',
        ],
        toolVersions: { ...input.toolVersions },
    };
}

export function validatePostClosureBackupReceipt(
    raw: unknown,
    now = new Date(),
): string[] {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return ['Post-closure backup receipt must be an object.'];
    }
    const receipt = raw as Record<string, unknown>;
    const expectedKeys = [
        'schemaVersion',
        'receiptKind',
        'status',
        'targetEnvironment',
        'targetProjectRef',
        'canonicalGitSha',
        'productionInertEvidenceSha256',
        'databaseStateSha256',
        'tableContractSha256',
        'destinationBindingSha256',
        'createdAt',
        'method',
        'backupFormat',
        'includedSchemas',
        'backupCompleted',
        'artifactStoredOutsideRepository',
        'atRestProtection',
        'atRestProtectionVerified',
        'liveInventorySha256',
        'livePublicTableCount',
        'liveAuthTableCount',
        'stableLiveInventoryReadbacks',
        'stableProductionInertRowStateReadbacks',
        'liveAuthConfigurationReadbacks',
        'archiveListVerified',
        'archiveMatchesPostClosureContract',
        'archiveMatchesFullLiveInventory',
        'archiveTocEntryCount',
        'artifactSha256',
        'artifactBytes',
        'artifactPathRecorded',
        'restoreProcedureReviewed',
        'restorePerformed',
        'restoreValidation',
        'databaseWritePerformed',
        'externalServiceWritePerformed',
        'limitationsAcknowledged',
        'toolVersions',
    ].sort();
    const errors: string[] = [];
    if (stableJson(Object.keys(receipt).sort()) !== stableJson(expectedKeys)) {
        errors.push('Post-closure backup receipt keys are not exact.');
    }
    const expectedStatic: Record<string, unknown> = {
        schemaVersion: 1,
        receiptKind: POST_CLOSURE_BACKUP_RECEIPT_KIND,
        status: POST_CLOSURE_BACKUP_STATUS,
        targetEnvironment: 'production',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        tableContractSha256: POST_CLOSURE_TABLE_CONTRACT_SHA256,
        method: 'logical_dump',
        backupFormat: 'pg_dump_custom',
        backupCompleted: true,
        artifactStoredOutsideRepository: true,
        atRestProtection: 'windows_efs',
        atRestProtectionVerified: true,
        livePublicTableCount: POST_CLOSURE_PUBLIC_TABLES.length,
        stableLiveInventoryReadbacks: 2,
        stableProductionInertRowStateReadbacks: 2,
        liveAuthConfigurationReadbacks: 2,
        archiveListVerified: true,
        archiveMatchesPostClosureContract: true,
        archiveMatchesFullLiveInventory: true,
        artifactPathRecorded: false,
        restoreProcedureReviewed: true,
        restorePerformed: false,
        restoreValidation: 'tabletop_pg_restore_list_only',
        databaseWritePerformed: false,
        externalServiceWritePerformed: false,
    };
    for (const [name, value] of Object.entries(expectedStatic)) {
        if (receipt[name] !== value) errors.push(`${name} does not match the post-closure receipt contract.`);
    }
    if (stableJson(receipt.includedSchemas) !== stableJson(['public', 'auth'])) {
        errors.push('includedSchemas must be exactly public and auth.');
    }
    const expectedLimitations: PostClosureBackupReceipt['limitationsAcknowledged'] = [
        'storage_objects_not_included',
        'custom_role_passwords_not_included',
        'external_stripe_google_not_included',
        'selected_schemas_only',
        'ownership_and_privileges_not_included',
        'no_full_restore_executed_tabletop_only',
    ];
    if (stableJson(receipt.limitationsAcknowledged) !== stableJson(expectedLimitations)) {
        errors.push('limitationsAcknowledged does not match the exact tabletop contract.');
    }
    if (typeof receipt.canonicalGitSha !== 'string' || !GIT_SHA_PATTERN.test(receipt.canonicalGitSha)) {
        errors.push('canonicalGitSha must be a lowercase 40-character SHA.');
    }
    for (const name of [
        'productionInertEvidenceSha256',
        'databaseStateSha256',
        'tableContractSha256',
        'destinationBindingSha256',
        'liveInventorySha256',
        'artifactSha256',
    ]) {
        if (typeof receipt[name] !== 'string' || !SHA256_PATTERN.test(receipt[name])) {
            errors.push(`${name} must be a lowercase SHA-256.`);
        }
    }
    for (const name of ['liveAuthTableCount', 'archiveTocEntryCount', 'artifactBytes']) {
        if (!Number.isSafeInteger(receipt[name]) || Number(receipt[name]) < 1) {
            errors.push(`${name} must be a positive safe integer.`);
        }
    }
    const createdAt = typeof receipt.createdAt === 'string' ? Date.parse(receipt.createdAt) : Number.NaN;
    if (!Number.isFinite(createdAt)
        || new Date(createdAt).toISOString() !== receipt.createdAt
        || createdAt > now.getTime()) {
        errors.push('createdAt must be a non-future ISO timestamp.');
    }
    const toolVersions = receipt.toolVersions;
    if (!toolVersions || typeof toolVersions !== 'object' || Array.isArray(toolVersions)
        || stableJson(Object.keys(toolVersions).sort()) !== stableJson(['pgDump', 'pgRestore', 'psql'].sort())
        || Object.values(toolVersions).some((value) => typeof value !== 'string'
            || value.length < 1
            || value.length > 200)) {
        errors.push('toolVersions must contain only bounded pgDump, pgRestore and psql strings.');
    }
    const serialized = JSON.stringify(receipt);
    if (/@/u.test(serialized) || /postgres(?:ql)?:\/\//iu.test(serialized)) {
        errors.push('Post-closure backup receipt must not contain identities, URLs or credentials.');
    }
    return errors;
}

export function createPostClosureArtifactFailureSummary(input: {
    canonicalGitSha: string;
    destinationBindingSha256: string;
    phase: ArtifactExecutionPhase;
    error: unknown;
    artifactRetainedForInspection: boolean;
    receiptPersisted: boolean;
}): Record<string, unknown> {
    return {
        status: input.receiptPersisted
            ? 'BACKUP_POST_RECEIPT_FAILURE_REQUIRES_REVIEW'
            : 'BACKUP_FAILED_NO_RECEIPT',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        canonicalGitSha: input.canonicalGitSha,
        destinationBindingSha256: input.destinationBindingSha256,
        failurePhase: input.phase,
        failureCategory: classifyPostClosureBackupFailure(input.error),
        artifactReservationCreated: true,
        artifactRetainedForInspection: input.artifactRetainedForInspection,
        artifactPathRecorded: false,
        receiptPersisted: input.receiptPersisted,
        receiptFile: input.receiptPersisted ? 'post-closure-backup-receipt.json' : null,
        nextAction: 'Do not reuse or overwrite the destination. Preserve any artifact and receipt for manual inspection and choose a new approved path for another attempt.',
        databaseWritePerformed: false,
        externalServiceWritePerformed: false,
        localBackupWriteAttempted: true,
    };
}

async function main(): Promise<void> {
    const options = parsePostClosureBackupArgs(process.argv.slice(2));
    const initialGit = readAndValidateCanonicalGitIdentity(options.canonicalSha);
    const initialEvidence = loadProductionInertFinalEvidence(options.productionInertEvidencePath);
    const destination = resolveNewBackupDestination(options.destination, root);
    const destinationBindingSha256 = sha256(normalizePathForBinding(destination));
    const atRest = verifyWindowsEfsDirectory(destination);
    if (!atRest.valid) throw new Error('Backup destination parent is not verifiably protected by Windows EFS.');

    const approval = buildPostClosureBackupApproval({
        canonicalGitSha: initialGit.head,
        productionInertEvidenceSha256: initialEvidence.sha256,
        databaseStateSha256: initialEvidence.databaseStateSha256,
        destinationBindingSha256,
    });
    const startedAt = new Date();
    const outputDir = createOutputDir(startedAt);
    writeFileSync(path.join(outputDir, 'exact-approval-required.txt'), `${approval}\n`, 'utf8');

    if (options.mode === 'plan') {
        writeSummary(outputDir, {
            status: 'PLAN_ONLY_READY',
            targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
            canonicalGitSha: initialGit.head,
            productionInertEvidenceSha256: initialEvidence.sha256,
            databaseStateSha256: initialEvidence.databaseStateSha256,
            tableContractSha256: POST_CLOSURE_TABLE_CONTRACT_SHA256,
            destinationBindingSha256,
            destinationValidatedOutsideRepository: true,
            atRestProtection: atRest,
            includedSchemas: ['public', 'auth'],
            livePublicTableCountExpected: POST_CLOSURE_PUBLIC_TABLES.length,
            minimumProductionInertEvidenceTtlMs: POST_CLOSURE_MINIMUM_EVIDENCE_TTL_MS,
            productionInertRowStateReadbacksRequired: 2,
            liveAuthConfigurationGetReadbacksRequired: 2,
            archiveVerification: 'pg_restore --list plus exact live public/auth TABLE DATA inventory',
            restoreValidation: 'tabletop_pg_restore_list_only',
            restorePerformed: false,
            artifactPathRecorded: false,
            networkAccessPerformed: false,
            databaseWritePerformed: false,
            externalServiceWritePerformed: false,
            localBackupWritten: false,
            executeRequirements: [
                '--execute-approved',
                '--restore-procedure-reviewed',
                `${POST_CLOSURE_BACKUP_APPROVAL_ENV}=<exact approval from this plan>`,
                `${FIXTURE_CLEANUP_DATABASE_ENV}=<exact ${FIXTURE_CLEANUP_TARGET.projectRef} database URL>`,
                `Windows Credential Manager contains ${SUPABASE_CLI_WINDOWS_CREDENTIAL_TARGET}`,
            ],
        });
        console.log(`PLAN_ONLY_READY: ${repositoryRelativeOutputPath(path.join(outputDir, 'summary.json'))}`);
        return;
    }

    if (!options.executeApproved || !options.restoreProcedureReviewed) {
        throw new Error('Execute mode requires --execute-approved and --restore-procedure-reviewed.');
    }
    if (process.env[POST_CLOSURE_BACKUP_APPROVAL_ENV] !== approval) {
        throw new Error(`Exact approval mismatch; inspect exact-approval-required.txt and set ${POST_CLOSURE_BACKUP_APPROVAL_ENV}.`);
    }

    const immediateGit = readAndValidateCanonicalGitIdentity(options.canonicalSha);
    if (immediateGit.head !== initialGit.head) throw new Error('Canonical Git identity changed after planning.');
    const immediateEvidence = loadProductionInertFinalEvidence(options.productionInertEvidencePath, new Date());
    if (immediateEvidence.sha256 !== initialEvidence.sha256
        || immediateEvidence.databaseStateSha256 !== initialEvidence.databaseStateSha256) {
        throw new Error('Production inert final evidence changed after planning.');
    }
    if (existsSync(destination)) throw new Error('Backup destination appeared after planning; overwrite remains forbidden.');
    if (!verifyWindowsEfsDirectory(destination).valid) {
        throw new Error('Windows EFS protection could not be re-verified immediately before execution.');
    }

    // The exclusive reservation is the first operation after the final parent-EFS check.
    // The same descriptor remains open through pg_dump and every final artifact check.
    const descriptor = openSync(destination, 'wx', 0o600);
    let artifactPhase: ArtifactExecutionPhase = 'DESTINATION_RESERVED';
    let receiptPersisted = false;
    let deferredError: unknown = null;
    try {
        const emptyArtifact = prepareReservedArtifactForEncryptedDump(descriptor, destination);
        artifactPhase = 'EMPTY_ARTIFACT_EFS_VERIFIED';

    // Deliberately load local environment only after every non-network execution gate above.
    loadDotenv({ path: path.join(root, '.env'), override: false, quiet: true });
    const databaseUrl = process.env[FIXTURE_CLEANUP_DATABASE_ENV]?.trim() ?? '';
    if (!databaseUrl) throw new Error(`${FIXTURE_CLEANUP_DATABASE_ENV} is required for execute mode.`);
    const connection = buildPsqlEnvironment(databaseUrl);
    if (connection.PGDATABASE !== 'postgres') {
        throw new Error('The approved Supabase production backup target database must be postgres.');
    }
    const databaseToolEnvironment = buildDatabaseToolProcessEnvironment(connection, {
        PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=10000',
    });
    const expectedEmails = readExpectedProductionEmails();
    artifactPhase = 'LOCAL_ENVIRONMENT_VALIDATED';

    const toolVersions = verifyDatabaseTools(databaseToolEnvironment);
    const rowStateSql = renderProductionInertFinalReadbackSql();
    const rowStateBefore = readProductionInertRowState(
        connection,
        rowStateSql,
        expectedEmails.admin,
        expectedEmails.teacher,
    );
    const rowStateBeforeSha256 = assertProductionInertRowStateMatchesEvidence(
        rowStateBefore,
        immediateEvidence,
        'Pre-dump',
    );
    const inventoryBefore = readLiveTableInventory(databaseToolEnvironment);
    const inventoryValidation = validateLivePostClosureInventory(inventoryBefore);
    if (!inventoryValidation.ok) {
        throw new Error('Live production public/auth inventory does not match the post-closure contract.');
    }

    // This exact Management API GET is deliberately sequenced between the two row-state reads.
    await withSupabaseAuthManagementClient(
        FIXTURE_CLEANUP_TARGET.projectRef,
        async (client) => await verifyLiveProductionAuthInert(client),
    );
    const preDumpEvidence = loadProductionInertFinalEvidence(
        options.productionInertEvidencePath,
        new Date(),
    );
    if (preDumpEvidence.sha256 !== immediateEvidence.sha256
        || preDumpEvidence.databaseStateSha256 !== immediateEvidence.databaseStateSha256) {
        throw new Error('Production inert final evidence changed or was superseded immediately before the dump.');
    }
    artifactPhase = 'READ_ONLY_PREFLIGHT_VERIFIED';

    artifactPhase = 'DUMP_IN_PROGRESS';
    const dumpResult = runPgDumpToReservedDestination(descriptor, databaseToolEnvironment);
    if (!dumpResult.ok) {
        throw new Error('pg_dump failed; the exclusive partial artifact was retained and no receipt was issued.');
    }
    const pinnedArtifact = captureReservedArtifactFingerprint(descriptor, destination);
    if (!samePinnedArtifactIdentity(emptyArtifact, pinnedArtifact)) {
        throw new Error('Reserved backup artifact identity changed while pg_dump was writing to its open descriptor.');
    }
    if (pinnedArtifact.size <= 0) {
        throw new Error('pg_dump returned success but the custom archive is missing or empty.');
    }
    const artifactSha256AfterDump = await sha256PinnedReservedArtifact(
        descriptor,
        destination,
        pinnedArtifact,
    );
    artifactPhase = 'DUMP_PINNED';

    const restoreList = runTool('pg_restore', ['--list', destination], databaseToolEnvironment, 60_000);
    if (!restoreList.ok) throw new Error('pg_restore --list could not verify the custom archive; no receipt was issued.');
    const inventoryAfter = readLiveTableInventory(databaseToolEnvironment);
    if (stableJson(inventoryAfter) !== stableJson(inventoryBefore)) {
        throw new Error('Live public/auth inventory changed while the backup was being verified.');
    }
    const rowStateAfter = readProductionInertRowState(
        connection,
        rowStateSql,
        expectedEmails.admin,
        expectedEmails.teacher,
    );
    const rowStateAfterSha256 = assertProductionInertRowStateMatchesEvidence(
        rowStateAfter,
        immediateEvidence,
        'Post-dump',
    );
    if (rowStateAfterSha256 !== rowStateBeforeSha256) {
        throw new Error('Production inert row-state changed during the backup.');
    }
    await withSupabaseAuthManagementClient(
        FIXTURE_CLEANUP_TARGET.projectRef,
        async (client) => await verifyLiveProductionAuthInert(client),
    );
    artifactPhase = 'POST_DUMP_READBACKS_VERIFIED';

    const livePublicInventory = inventoryBefore.filter((entry) => entry.startsWith('public.'));
    const archiveContract = validatePostClosureArchiveInventory(restoreList.stdout, livePublicInventory);
    if (!archiveContract.ok) {
        throw new Error('Custom archive does not match the exact post-closure public-table contract.');
    }
    const archiveLiveComparison = compareArchiveToLiveInventory(restoreList.stdout, inventoryBefore);
    if (!archiveLiveComparison.ok) {
        throw new Error('Custom archive TABLE DATA does not match the full live public/auth base-table inventory.');
    }

    const liveInventorySha256 = sha256(stableJson(inventoryBefore));
    assertReservedArtifactFingerprint(descriptor, destination, pinnedArtifact);
    if (!verifyWindowsEfsArtifact(destination).valid) {
        throw new Error('The pinned backup artifact is not verifiably protected by Windows EFS immediately before receipt.');
    }
    const artifactSha256 = await sha256PinnedReservedArtifact(
        descriptor,
        destination,
        pinnedArtifact,
    );
    if (artifactSha256 !== artifactSha256AfterDump) {
        throw new Error('Pinned backup artifact hash changed between post-dump capture and final receipt validation.');
    }
    assertReservedArtifactFingerprint(descriptor, destination, pinnedArtifact);
    artifactPhase = 'ARTIFACT_FINAL_REVALIDATED';

    // Keep this renewable evidence revalidation as the final gate before synchronous receipt creation.
    const finalEvidence = loadProductionInertFinalEvidence(
        options.productionInertEvidencePath,
        new Date(),
        { minimumRemainingTtlMs: 0 },
    );
    if (finalEvidence.sha256 !== initialEvidence.sha256
        || finalEvidence.databaseStateSha256 !== initialEvidence.databaseStateSha256) {
        throw new Error('Production inert final evidence changed or was superseded during backup execution.');
    }
    const receipt = createPostClosureBackupReceipt({
        canonicalGitSha: options.canonicalSha,
        productionInertEvidenceSha256: initialEvidence.sha256,
        databaseStateSha256: initialEvidence.databaseStateSha256,
        destinationBindingSha256,
        liveInventorySha256,
        livePublicTableCount: livePublicInventory.length,
        liveAuthTableCount: inventoryBefore.length - livePublicInventory.length,
        archiveTocEntryCount: archiveContract.tocEntryCount,
        artifactSha256,
        artifactBytes: pinnedArtifact.size,
        toolVersions,
    });
    const receiptErrors = validatePostClosureBackupReceipt(receipt, new Date());
    if (receiptErrors.length > 0) {
        throw new Error(`Post-closure backup receipt self-validation failed: ${receiptErrors.join(' ')}`);
    }
    const receiptPath = path.join(outputDir, 'post-closure-backup-receipt.json');
    writeDurableFile(receiptPath, stableJson(receipt), 'wx');
    receiptPersisted = true;
    artifactPhase = 'RECEIPT_PERSISTED';
    const receiptSha256 = sha256(stableJson(receipt));

    writeSummary(outputDir, {
        status: POST_CLOSURE_BACKUP_STATUS,
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        canonicalGitSha: options.canonicalSha,
        productionInertEvidenceSha256: initialEvidence.sha256,
        databaseStateSha256: initialEvidence.databaseStateSha256,
        tableContractSha256: POST_CLOSURE_TABLE_CONTRACT_SHA256,
        destinationBindingSha256,
        liveInventorySha256,
        livePublicTableCount: livePublicInventory.length,
        liveAuthTableCount: inventoryBefore.length - livePublicInventory.length,
        stableProductionInertRowStateReadbacks: 2,
        liveAuthConfigurationReadbacks: 2,
        productionInertEvidenceRevalidatedAtEnd: true,
        archiveTocEntryCount: archiveContract.tocEntryCount,
        artifactSha256,
        receiptSha256,
        receiptFile: path.basename(receiptPath),
        artifactPathRecorded: false,
        restoreValidation: 'tabletop_pg_restore_list_only',
        restorePerformed: false,
        networkAccessPerformed: true,
        databaseWritePerformed: false,
        externalServiceWritePerformed: false,
        localBackupWritten: true,
    });
    artifactPhase = 'COMPLETE';
    } catch (error) {
        deferredError = error;
        try {
            writeSummary(outputDir, createPostClosureArtifactFailureSummary({
                canonicalGitSha: options.canonicalSha,
                destinationBindingSha256,
                phase: artifactPhase,
                error,
                artifactRetainedForInspection: existsSync(destination),
                receiptPersisted,
            }));
        } catch (summaryError) {
            deferredError = summaryError;
        }
    }
    try {
        closeSync(descriptor);
    } catch (closeError) {
        if (deferredError === null) {
            deferredError = closeError;
            try {
                writeSummary(outputDir, createPostClosureArtifactFailureSummary({
                    canonicalGitSha: options.canonicalSha,
                    destinationBindingSha256,
                    phase: artifactPhase,
                    error: closeError,
                    artifactRetainedForInspection: existsSync(destination),
                    receiptPersisted,
                }));
            } catch (summaryError) {
                deferredError = summaryError;
            }
        }
    }
    if (deferredError !== null) throw deferredError;
    console.log(`${POST_CLOSURE_BACKUP_STATUS}: ${repositoryRelativeOutputPath(path.join(outputDir, 'summary.json'))}`);
}

function findLatestProductionInertFinalAttempt(attemptsRoot: string): {
    directory: string;
    summaryPath: string;
    startedAt: Date;
} {
    let entries: Dirent[];
    try {
        entries = readdirSync(attemptsRoot, { withFileTypes: true });
    } catch {
        throw new Error('Production inert final attempt history is missing or unreadable.');
    }
    const attempts: Array<{ directory: string; summaryPath: string; startedAt: Date }> = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(attemptsRoot, entry.name);
        const summaryPath = path.join(directory, PRODUCTION_INERT_FINAL_ATTEMPT_FILE);
        const planPath = path.join(directory, 'plan.json');
        if (!existsSync(summaryPath)) {
            if (existsSync(planPath)
                && !existsSync(path.join(directory, PRODUCTION_INERT_FINAL_OUTPUT_FILE))) {
                continue;
            }
            throw new Error('Production inert final attempt history contains a non-plan directory without a summary.');
        }
        const startedAt = parseAttemptDirectoryTimestamp(entry.name);
        if (!startedAt) {
            throw new Error('Production inert final attempt history contains a summary in a non-canonical directory.');
        }
        attempts.push({ directory, summaryPath, startedAt });
    }
    attempts.sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
    const latest = attempts[0];
    if (!latest) throw new Error('No real production inert final capture attempt exists.');
    return latest;
}

function parseAttemptDirectoryTimestamp(name: string): Date | null {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/u.exec(name);
    if (!match) return null;
    const value = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    const parsed = new Date(timestamp);
    return parsed.toISOString() === value ? parsed : null;
}

function pathIsWithin(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function uniqueValue(argument: string, previous: string | null, next: string | undefined): string {
    if (previous !== null) throw new Error(`${argument} may only be supplied once.`);
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires an explicit value.`);
    return next;
}

function readAndValidateCanonicalGitIdentity(canonicalSha: string): GitIdentity {
    const branch = runLocalTool('git', ['branch', '--show-current']);
    const head = runLocalTool('git', ['rev-parse', 'HEAD']);
    const originMain = runLocalTool('git', ['rev-parse', '--verify', 'refs/remotes/origin/main']);
    const status = runLocalTool('git', ['status', '--porcelain=v1', '--untracked-files=all']);
    if (!branch.ok || !head.ok || !originMain.ok || !status.ok) {
        throw new Error('Git identity, local origin/main or worktree status could not be read.');
    }
    const identity = {
        branch: branch.stdout.trim(),
        head: head.stdout.trim().toLowerCase(),
        originMain: originMain.stdout.trim().toLowerCase(),
        clean: status.stdout.trim().length === 0,
    };
    if (identity.branch !== 'main') throw new Error('Post-closure backup requires the main branch.');
    if (!identity.clean) throw new Error('Post-closure backup requires a clean worktree.');
    if (identity.head !== canonicalSha) throw new Error('HEAD does not equal the exact canonical SHA.');
    if (identity.originMain !== canonicalSha) {
        throw new Error('Local refs/remotes/origin/main does not equal the exact canonical SHA.');
    }
    return identity;
}

function verifyDatabaseTools(environment: NodeJS.ProcessEnv): PostClosureBackupReceipt['toolVersions'] {
    const pgDump = runTool('pg_dump', ['--version'], environment, 10_000);
    const pgRestore = runTool('pg_restore', ['--version'], environment, 10_000);
    const psql = runTool('psql', ['--version'], environment, 10_000);
    if (!pgDump.ok || !pgRestore.ok || !psql.ok) {
        throw new Error('pg_dump, pg_restore and psql must all be installed and runnable before backup.');
    }
    return {
        pgDump: safeVersion(pgDump.stdout),
        pgRestore: safeVersion(pgRestore.stdout),
        psql: safeVersion(psql.stdout),
    };
}

function readLiveTableInventory(environment: NodeJS.ProcessEnv): string[] {
    const sql = [
        "SELECT table_schema || E'\\t' || table_name",
        'FROM information_schema.tables',
        "WHERE table_schema IN ('public', 'auth')",
        "AND table_type = 'BASE TABLE'",
        'ORDER BY table_schema, table_name;',
    ].join(' ');
    const result = runTool('psql', [
        '-X',
        '-w',
        '-q',
        '-A',
        '-t',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        sql,
    ], environment, 45_000);
    if (!result.ok) throw new Error('Read-only psql could not capture the live public/auth table inventory.');
    const inventory = parseLiveTableInventory(result.stdout);
    if (inventory.length === 0) throw new Error('Live public/auth table inventory is empty.');
    return inventory;
}

function readProductionInertRowState(
    connection: DatabaseConnectionEnvironment,
    sql: string,
    expectedAdminEmail: string,
    expectedTeacherEmail: string,
): ProductionInertDatabaseReadback {
    const result = spawnSync('psql', [
        '-X',
        '-w',
        '-q',
        '-A',
        '-t',
        '-F',
        '\t',
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        '-',
    ], {
        env: buildDatabaseToolProcessEnvironment(connection, {
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',
            EH_EXPECTED_ADMIN_EMAIL: expectedAdminEmail,
            EH_EXPECTED_TEACHER_EMAIL: expectedTeacherEmail,
        }),
        input: [
            '\\getenv expected_admin_email EH_EXPECTED_ADMIN_EMAIL',
            '\\getenv expected_teacher_email EH_EXPECTED_TEACHER_EMAIL',
            sql,
        ].join('\n'),
        encoding: 'utf8',
        timeout: 45_000,
        windowsHide: true,
    });
    const status = typeof result.status === 'number' ? result.status : null;
    if (result.error || status !== 0) {
        const detail = redactExpectedProductionEmails(
            sanitizeOutput(String(result.stderr ?? result.error ?? 'psql failed')),
            [expectedAdminEmail, expectedTeacherEmail],
        );
        throw new Error(`Read-only production row-state psql exited with status ${status ?? 'unknown'}: ${detail}`);
    }
    let rawOutput = String(result.stdout ?? '');
    const readback = parseProductionInertFinalReadback(rawOutput);
    rawOutput = '';
    return readback;
}

function readExpectedProductionEmails(): { admin: string; teacher: string } {
    const testEnvPath = path.join(root, '.env.test');
    const localTestEnvironment = existsSync(testEnvPath)
        ? parseDotenv(readFileSync(testEnvPath))
        : {};
    const admin = requiredExpectedEmail(
        'TEST_ADMIN_EMAIL',
        process.env.TEST_ADMIN_EMAIL ?? localTestEnvironment.TEST_ADMIN_EMAIL,
    );
    const teacher = requiredExpectedEmail(
        'TEST_TEACHER_EMAIL',
        process.env.TEST_TEACHER_EMAIL ?? localTestEnvironment.TEST_TEACHER_EMAIL,
    );
    if (admin === teacher) throw new Error('TEST_ADMIN_EMAIL and TEST_TEACHER_EMAIL must be distinct.');
    return { admin, teacher };
}

function requiredExpectedEmail(
    name: 'TEST_ADMIN_EMAIL' | 'TEST_TEACHER_EMAIL',
    rawValue: string | undefined,
): string {
    const value = rawValue?.trim().toLowerCase() ?? '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
        throw new Error(`${name} is required locally and must be a valid email.`);
    }
    return value;
}

function sameArtifactIdentity(left: Stats, right: Stats): boolean {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.birthtimeMs === right.birthtimeMs;
}

function samePinnedArtifactIdentity(
    left: ReservedArtifactFingerprint,
    right: ReservedArtifactFingerprint,
): boolean {
    return left.device === right.device
        && left.inode === right.inode
        && left.birthtimeMs === right.birthtimeMs;
}

function runPgDumpToReservedDestination(
    descriptor: number,
    environment: NodeJS.ProcessEnv,
): ToolResult {
    try {
        const result = spawnSync('pg_dump', [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--no-password',
            '--serializable-deferrable',
            '--lock-wait-timeout=10s',
            '--schema=public',
            '--schema=auth',
        ], {
            env: environment,
            encoding: 'utf8',
            timeout: 180_000,
            windowsHide: true,
            stdio: ['ignore', descriptor, 'pipe'],
        });
        fsyncSync(descriptor);
        const status = typeof result.status === 'number' ? result.status : null;
        return {
            ok: !result.error && status === 0,
            status,
            stdout: '',
            stderr: sanitizeOutput(String(result.stderr ?? '')),
            error: result.error ? sanitizeOutput(result.error.message) : null,
        };
    } catch (error) {
        return {
            ok: false,
            status: null,
            stdout: '',
            stderr: '',
            error: safeErrorMessage(error),
        };
    }
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
        stdout: sanitizeOutput(String(result.stdout ?? '')),
        stderr: sanitizeOutput(String(result.stderr ?? '')),
        error: result.error ? sanitizeOutput(result.error.message) : null,
    };
}

function runLocalTool(executable: string, args: string[]): ToolResult {
    return runTool(executable, args, localToolEnvironment(), 10_000);
}

function verifyWindowsEfsDirectory(destination: string): AtRestValidation {
    if (process.platform !== 'win32') {
        return { valid: false, reason: 'automatic at-rest verification currently requires Windows EFS' };
    }
    const parent = path.dirname(destination);
    const result = runLocalTool('cipher.exe', ['/c', parent]);
    if (!result.ok) return { valid: false, reason: 'cipher.exe could not verify the destination parent' };
    return cipherOutputShowsEncrypted(`${result.stdout}\n${result.stderr}`)
        ? { valid: true, reason: 'destination parent verified as Windows EFS encrypted' }
        : { valid: false, reason: 'cipher.exe reports no encrypted destination marker' };
}

function verifyWindowsEfsArtifact(destination: string): AtRestValidation {
    if (process.platform !== 'win32') {
        return { valid: false, reason: 'automatic at-rest verification currently requires Windows EFS' };
    }
    const result = runLocalTool('cipher.exe', ['/c', destination]);
    if (!result.ok) return { valid: false, reason: 'cipher.exe could not verify the completed backup artifact' };
    return cipherOutputShowsEncrypted(`${result.stdout}\n${result.stderr}`)
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

function classifyPostClosureBackupFailure(error: unknown): string {
    const message = safeErrorMessage(error).toLowerCase();
    if (message.includes('efs')) return 'ARTIFACT_EFS_VERIFICATION_FAILED';
    if (message.includes('pg_dump')) return 'PG_DUMP_FAILED';
    if (message.includes('pg_restore') || message.includes('archive')) return 'ARCHIVE_VERIFICATION_FAILED';
    if (message.includes('row-state') || message.includes('inventory')) return 'DATABASE_READBACK_FAILED';
    if (message.includes('auth')) return 'AUTH_READBACK_FAILED';
    if (message.includes('receipt')) return 'RECEIPT_PERSISTENCE_FAILED';
    if (message.includes('hash') || message.includes('fingerprint') || message.includes('identity')) {
        return 'ARTIFACT_INTEGRITY_FAILED';
    }
    return 'POST_CLOSURE_BACKUP_EXECUTION_FAILED';
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
        'launch-supabase-production-post-closure-backup',
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDir, { recursive: true });
    return outputDir;
}

function writeSummary(outputDir: string, summary: Record<string, unknown>): void {
    writeDurableFile(path.join(outputDir, 'summary.json'), stableJson(summary), 'w');
}

function writeDurableFile(
    filePath: string,
    contents: string,
    flags: 'w' | 'wx',
): void {
    const descriptor = openSync(filePath, flags, 0o600);
    try {
        writeFileSync(descriptor, contents, 'utf8');
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
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
        console.error(sanitizeOutput(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
    });
}
