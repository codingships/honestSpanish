import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const FIXTURE_CLEANUP_TARGET = {
    environment: 'production' as const,
    projectRef: 'vkkahxsybhbutszerawz',
    aggregateSnapshotSha256: '765491a84ccab34ff0d2b1ca9149bf09f91cce2f267d20c9c95fe3a7316f5ca6',
    approvalScopeSha256: '35e5a8bf6a9f06b4419381171b04f3a050f4e9457fd674375a7e26ebc34672ec',
    canonicalPackageSha256: '6d17a17ca7bd8a99c2f0ba17522780546b473e49c386cee83d1da9acf08da38e',
} as const;

export const FIXTURE_CLEANUP_PATHS = {
    manifest: 'scripts/launch/production-fixture-cleanup-manifest.json',
    previewSql: 'scripts/launch/sql/production-fixture-cleanup-preview.sql',
    executeSql: 'scripts/launch/sql/production-fixture-cleanup-execute.sql',
    backupReceiptTemplate: 'scripts/launch/production-fixture-cleanup-backup-receipt.template.json',
    snapshot: 'scripts/launch/production-fixture-cleanup-snapshot-v2.json',
    scope: 'scripts/launch/production-fixture-cleanup-scope-v2.json',
} as const;

export const FIXTURE_CLEANUP_APPROVAL_ENV = 'SUPABASE_PRODUCTION_FIXTURE_CLEANUP_APPROVAL';
export const FIXTURE_CLEANUP_DATABASE_ENV = 'SUPABASE_DB_URL';
export const PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV = 'SUPABASE_PRODUCTION_LOGICAL_BACKUP_APPROVAL';
export const FIXTURE_CLEANUP_PREVIEW_PREFIX = 'FIXTURE_CLEANUP_PREVIEW|';
export const FIXTURE_CLEANUP_SUCCESS_PREFIX = 'FIXTURE_CLEANUP_EXECUTE_OK|';
export const FIXTURE_CLEANUP_GATE = 'EXECUTE_PRODUCTION_FIXTURE_CLEANUP_V1';
export const BACKUP_RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface FixtureCleanupManifest {
    schemaVersion: number;
    target: {
        projectRef: string;
        environment: string;
        aggregateSnapshotSha256: string;
        approvalScopeSha256: string;
    };
    canonicalPackages: {
        catalogSha256: string;
    };
    sql: {
        preview: { path: string; sha256: string };
        execute: { path: string; sha256: string };
    };
    authCleanup: { status: string };
}

export interface FixtureCleanupPreview {
    schemaVersion: number;
    mode: string;
    targetProjectRef: string;
    aggregateSnapshotSha256: string;
    approvalScopeSha256: string;
    canonicalPackageCount: number;
    canonicalPackageSha256: string;
    packageStripeReferenceSha256: string;
    packageStripeReferenceNonNullFields: number;
    authDeletion: string;
    baselineMatches: boolean;
    counts: Record<string, number>;
    distributions: Record<string, number>;
    schemaPosture: Record<string, unknown>;
}

export interface BackupReceipt {
    schemaVersion: number;
    receiptKind: 'supabase_production_logical_backup';
    targetProjectRef: string;
    authInertEvidenceSha256: string;
    aggregateSnapshotSha256: string;
    approvalScopeSha256: string;
    createdAt: string;
    method: 'logical_dump';
    backupCompleted: boolean;
    artifactStoredOutsideRepository: boolean;
    atRestProtection: 'windows_efs';
    atRestProtectionVerified: boolean;
    artifactSha256: string;
    includedSchemas: string[];
    verification: 'dump_hash_recorded';
    restoreProcedureReviewed: boolean;
    limitationsAcknowledged: string[];
    backupFormat: 'pg_dump_custom';
    archiveListVerified: boolean;
    archiveRequiredTableDataVerified: boolean;
    archiveTocEntryCount: number;
    artifactBytes: number;
    artifactPathRecorded: false;
    toolVersions: {
        pgDump: string;
        pgRestore: string;
    };
}

export const PRODUCTION_BACKUP_REQUIRED_LIMITATIONS = Object.freeze([
    'storage_objects_not_included',
    'custom_role_passwords_not_included',
    'external_stripe_google_not_included',
    'selected_schemas_only',
] as const);

const PRODUCTION_BACKUP_RECEIPT_KEYS = new Set<keyof BackupReceipt>([
    'schemaVersion',
    'receiptKind',
    'targetProjectRef',
    'authInertEvidenceSha256',
    'aggregateSnapshotSha256',
    'approvalScopeSha256',
    'createdAt',
    'method',
    'backupCompleted',
    'artifactStoredOutsideRepository',
    'atRestProtection',
    'atRestProtectionVerified',
    'artifactSha256',
    'includedSchemas',
    'verification',
    'restoreProcedureReviewed',
    'limitationsAcknowledged',
    'backupFormat',
    'archiveListVerified',
    'archiveRequiredTableDataVerified',
    'archiveTocEntryCount',
    'artifactBytes',
    'artifactPathRecorded',
    'toolVersions',
]);

export interface ValidationResult<T> {
    ok: boolean;
    errors: string[];
    value: T | null;
}

export interface DatabaseConnectionEnvironment {
    PGHOST: string;
    PGPORT: string;
    PGUSER: string;
    PGPASSWORD: string;
    PGDATABASE: string;
}

export function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath: string): string {
    return sha256(readFileSync(filePath));
}

export function stableJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

export function sanitizeOutput(value: string): string {
    return value
        .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/giu, 'postgresql://[redacted]')
        .replace(/(password|pgpassword|supabase_db_url)\s*[=:]\s*[^\s'"<>]+/giu, '$1=[redacted]')
        .replace(/Bearer\s+[^\s'"<>]+/giu, 'Bearer [redacted]');
}

export function loadAndValidateFixtureCleanupManifest(
    root = process.cwd(),
): ValidationResult<FixtureCleanupManifest> {
    const errors: string[] = [];
    let manifest: FixtureCleanupManifest | null = null;

    try {
        manifest = JSON.parse(readFileSync(path.join(root, FIXTURE_CLEANUP_PATHS.manifest), 'utf8')) as FixtureCleanupManifest;
    } catch {
        return { ok: false, errors: ['Fixture-cleanup manifest is missing or invalid JSON.'], value: null };
    }

    if (manifest.schemaVersion !== 2) errors.push('Manifest schemaVersion must be 2.');
    if (manifest.target?.projectRef !== FIXTURE_CLEANUP_TARGET.projectRef) errors.push('Manifest project ref mismatch.');
    if (manifest.target?.environment !== FIXTURE_CLEANUP_TARGET.environment) errors.push('Manifest environment mismatch.');
    if (manifest.target?.aggregateSnapshotSha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) {
        errors.push('Manifest aggregate snapshot mismatch.');
    }
    if (manifest.target?.approvalScopeSha256 !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) {
        errors.push('Manifest approval scope mismatch.');
    }
    if (manifest.canonicalPackages?.catalogSha256 !== FIXTURE_CLEANUP_TARGET.canonicalPackageSha256) {
        errors.push('Manifest canonical package hash mismatch.');
    }
    if (manifest.authCleanup?.status !== 'BLOCKED_SEPARATE_APPROVAL_AND_WORKFLOW') {
        errors.push('Manifest must keep Auth cleanup blocked as a separate workflow.');
    }

    for (const key of ['preview', 'execute'] as const) {
        const expectedPath = key === 'preview'
            ? FIXTURE_CLEANUP_PATHS.previewSql
            : FIXTURE_CLEANUP_PATHS.executeSql;
        const entry = manifest.sql?.[key];
        if (entry?.path !== expectedPath) {
            errors.push(`Manifest ${key} SQL path mismatch.`);
            continue;
        }
        const absolutePath = path.join(root, entry.path);
        try {
            if (!SHA256_PATTERN.test(entry.sha256) || sha256File(absolutePath) !== entry.sha256) {
                errors.push(`Manifest ${key} SQL SHA-256 mismatch.`);
            }
        } catch {
            errors.push(`Manifest ${key} SQL file is missing.`);
        }
    }

    for (const [label, filePath, expectedSha256] of [
        ['snapshot', FIXTURE_CLEANUP_PATHS.snapshot, FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256],
        ['approval scope', FIXTURE_CLEANUP_PATHS.scope, FIXTURE_CLEANUP_TARGET.approvalScopeSha256],
    ] as const) {
        try {
            if (sha256File(path.join(root, filePath)) !== expectedSha256) {
                errors.push(`Fixture-cleanup ${label} document SHA-256 mismatch.`);
            }
        } catch {
            errors.push(`Fixture-cleanup ${label} document is missing.`);
        }
    }

    return { ok: errors.length === 0, errors, value: manifest };
}

export function parseFixtureCleanupPreview(stdout: string): FixtureCleanupPreview {
    const payloadLines = stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.startsWith(FIXTURE_CLEANUP_PREVIEW_PREFIX));

    if (payloadLines.length !== 1) {
        throw new Error(`Expected exactly one ${FIXTURE_CLEANUP_PREVIEW_PREFIX} payload.`);
    }

    let payload: unknown;
    try {
        payload = JSON.parse(payloadLines[0].slice(FIXTURE_CLEANUP_PREVIEW_PREFIX.length));
    } catch {
        throw new Error('Fixture-cleanup preview payload is not valid JSON.');
    }
    if (!isRecord(payload)) throw new Error('Fixture-cleanup preview payload must be an object.');

    const preview = payload as unknown as FixtureCleanupPreview;
    const bindingErrors = [
        preview.schemaVersion === 2,
        preview.mode === 'read_only',
        preview.targetProjectRef === FIXTURE_CLEANUP_TARGET.projectRef,
        preview.aggregateSnapshotSha256 === FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        preview.approvalScopeSha256 === FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        preview.canonicalPackageCount === 4,
        preview.canonicalPackageSha256 === FIXTURE_CLEANUP_TARGET.canonicalPackageSha256,
        SHA256_PATTERN.test(preview.packageStripeReferenceSha256),
        Number.isInteger(preview.packageStripeReferenceNonNullFields),
        preview.authDeletion === 'blocked_separate_step',
        typeof preview.baselineMatches === 'boolean',
        isRecord(preview.counts),
        isRecord(preview.distributions),
        isRecord(preview.schemaPosture),
    ];
    if (bindingErrors.some((matches) => !matches)) {
        throw new Error('Fixture-cleanup preview binding or shape mismatch.');
    }
    return preview;
}

export function validateBackupReceipt(
    raw: unknown,
    now = new Date(),
): ValidationResult<BackupReceipt> {
    if (!isRecord(raw)) {
        return { ok: false, errors: ['Backup receipt must be a JSON object.'], value: null };
    }

    const receipt = raw as unknown as BackupReceipt;
    const errors: string[] = [];
    const unexpectedKeys = Object.keys(raw).filter((key) => !PRODUCTION_BACKUP_RECEIPT_KEYS.has(key as keyof BackupReceipt));
    if (unexpectedKeys.length > 0) errors.push('Backup receipt contains unexpected fields.');
    if (receipt.schemaVersion !== 1) errors.push('Backup receipt schemaVersion must be 1.');
    if (receipt.receiptKind !== 'supabase_production_logical_backup') {
        errors.push('Backup receipt kind mismatch.');
    }
    if (receipt.targetProjectRef !== FIXTURE_CLEANUP_TARGET.projectRef) errors.push('Backup receipt project ref mismatch.');
    if (typeof receipt.authInertEvidenceSha256 !== 'string'
        || !SHA256_PATTERN.test(receipt.authInertEvidenceSha256)) {
        errors.push('Backup receipt Auth inert evidence SHA-256 is invalid.');
    }
    if (receipt.aggregateSnapshotSha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) {
        errors.push('Backup receipt aggregate snapshot mismatch.');
    }
    if (receipt.approvalScopeSha256 !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) {
        errors.push('Backup receipt approval scope mismatch.');
    }
    if (receipt.backupCompleted !== true) errors.push('Backup receipt must confirm backupCompleted=true.');
    if (receipt.method !== 'logical_dump' || receipt.backupFormat !== 'pg_dump_custom') {
        errors.push('Backup receipt must describe a pg_dump custom logical archive.');
    }
    if (receipt.artifactStoredOutsideRepository !== true) {
        errors.push('Backup artifact must be stored outside the repository.');
    }
    if (receipt.atRestProtection !== 'windows_efs' || receipt.atRestProtectionVerified !== true) {
        errors.push('Backup artifact must be verified at rest with Windows EFS.');
    }
    if (typeof receipt.artifactSha256 !== 'string' || !SHA256_PATTERN.test(receipt.artifactSha256)) {
        errors.push('Backup artifact SHA-256 must be 64 lowercase hexadecimal characters.');
    }
    if (!Array.isArray(receipt.includedSchemas)
        || stableJson([...receipt.includedSchemas].sort()) !== stableJson(['auth', 'public'])) {
        errors.push('Backup receipt must include exactly the public and auth schemas.');
    }
    if (receipt.verification !== 'dump_hash_recorded') {
        errors.push('Backup receipt verification must be dump_hash_recorded.');
    }
    if (receipt.restoreProcedureReviewed !== true) {
        errors.push('Backup restore procedure must be reviewed.');
    }
    if (!Array.isArray(receipt.limitationsAcknowledged)
        || PRODUCTION_BACKUP_REQUIRED_LIMITATIONS.some((entry) => !receipt.limitationsAcknowledged.includes(entry))) {
        errors.push('Backup receipt must acknowledge all logical-backup limitations.');
    }
    if (receipt.archiveListVerified !== true || receipt.archiveRequiredTableDataVerified !== true) {
        errors.push('Backup receipt must prove pg_restore TOC and required TABLE DATA verification.');
    }
    if (!Number.isSafeInteger(receipt.archiveTocEntryCount) || receipt.archiveTocEntryCount <= 0) {
        errors.push('Backup receipt archiveTocEntryCount must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(receipt.artifactBytes) || receipt.artifactBytes <= 0) {
        errors.push('Backup receipt artifactBytes must be a positive safe integer.');
    }
    if (receipt.artifactPathRecorded !== false
        || 'artifactPath' in raw
        || 'destination' in raw
        || 'backupArtifactPath' in raw) {
        errors.push('Backup receipt must not contain an artifact path.');
    }
    if (!isRecord(receipt.toolVersions)
        || typeof receipt.toolVersions.pgDump !== 'string'
        || receipt.toolVersions.pgDump.trim().length === 0
        || typeof receipt.toolVersions.pgRestore !== 'string'
        || receipt.toolVersions.pgRestore.trim().length === 0) {
        errors.push('Backup receipt must record non-secret pg_dump and pg_restore versions.');
    }

    const createdAt = typeof receipt.createdAt === 'string'
        ? Date.parse(receipt.createdAt)
        : Number.NaN;
    const age = now.getTime() - createdAt;
    if (!Number.isFinite(createdAt)) {
        errors.push('Backup receipt createdAt must be a valid ISO timestamp.');
    } else if (age < -FUTURE_CLOCK_SKEW_MS) {
        errors.push('Backup receipt timestamp is too far in the future.');
    } else if (age > BACKUP_RECEIPT_MAX_AGE_MS) {
        errors.push('Backup receipt is older than 24 hours.');
    }

    return { ok: errors.length === 0, errors, value: receipt };
}

export function buildFixtureCleanupApproval(input: {
    executeSqlSha256: string;
    backupReceiptSha256: string;
    authInertEvidenceSha256: string;
    packageStripeReferenceSha256: string;
}): string {
    for (const [name, value] of Object.entries(input)) {
        if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256 hash.`);
    }

    return [
        'AUTORIZO LA LIMPIEZA TRANSACCIONAL DE FIXTURES DE SUPABASE PRODUCCION',
        `target=${FIXTURE_CLEANUP_TARGET.projectRef}`,
        `snapshot=${FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256}`,
        `scope=${FIXTURE_CLEANUP_TARGET.approvalScopeSha256}`,
        `execute_sql=${input.executeSqlSha256}`,
        `backup_receipt=${input.backupReceiptSha256}`,
        `auth_inert_evidence=${input.authInertEvidenceSha256}`,
        `package_stripe_references=${input.packageStripeReferenceSha256}`,
        'preserve_packages=group,standard,hybrid,bootcamp',
        'clear_local_package_stripe_fields=true',
        'delete_inactive_essential_after_subscriptions=true',
        'auth_users=BLOCKED_UNTOUCHED',
        'external_stripe_google_storage=UNTOUCHED',
        'supabase_db_push=FORBIDDEN',
        'supabase_migration_repair=FORBIDDEN',
        'post_commit_rollback=VERIFIED_BACKUP_ONLY',
        'backup_at_rest=VERIFIED',
    ].join(' | ');
}

export function buildPsqlEnvironment(databaseUrl: string): DatabaseConnectionEnvironment {
    let parsed: URL;
    try {
        parsed = new URL(databaseUrl);
    } catch {
        throw new Error(`${FIXTURE_CLEANUP_DATABASE_ENV} is not a valid PostgreSQL URL.`);
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        throw new Error(`${FIXTURE_CLEANUP_DATABASE_ENV} must use postgres:// or postgresql://.`);
    }

    const exactDirectHost = parsed.hostname === `db.${FIXTURE_CLEANUP_TARGET.projectRef}.supabase.co`;
    const exactPooler = parsed.hostname.endsWith('.pooler.supabase.com')
        && decodeURIComponent(parsed.username) === `postgres.${FIXTURE_CLEANUP_TARGET.projectRef}`;
    if (!exactDirectHost && !exactPooler) {
        throw new Error('Database URL does not identify the exact approved Supabase production project.');
    }
    if (!parsed.hostname || !parsed.username || !parsed.password) {
        throw new Error('Database URL is missing host, username or password.');
    }

    const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
    if (!database) throw new Error('Database URL is missing the database name.');

    return {
        PGHOST: parsed.hostname,
        PGPORT: parsed.port || '5432',
        PGUSER: decodeURIComponent(parsed.username),
        PGPASSWORD: decodeURIComponent(parsed.password),
        PGDATABASE: database,
    };
}

export function buildDatabaseToolProcessEnvironment(
    connection: DatabaseConnectionEnvironment,
    extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = {};
    for (const name of [
        'PATH',
        'Path',
        'SYSTEMROOT',
        'SystemRoot',
        'WINDIR',
        'TEMP',
        'TMP',
        'HOME',
        'LANG',
        'LC_ALL',
    ]) {
        if (process.env[name]) environment[name] = process.env[name];
    }
    return {
        ...environment,
        ...connection,
        PGSSLMODE: 'require',
        PGCONNECT_TIMEOUT: '10',
        PGCLIENTENCODING: 'UTF8',
        ...extra,
    };
}

export function resolveNewBackupDestination(destination: string, repositoryRoot = process.cwd()): string {
    if (!path.isAbsolute(destination)) throw new Error('Backup destination must be an absolute path.');
    if (!destination.toLowerCase().endsWith('.dump')) throw new Error('Backup destination must end in .dump.');
    if (existsSync(destination)) throw new Error('Backup destination already exists; overwrite is forbidden.');

    const destinationParent = path.dirname(destination);
    if (!existsSync(destinationParent)) {
        throw new Error('Backup destination parent directory must already exist.');
    }
    const repositoryRealPath = realpathSync.native(repositoryRoot);
    const parentRealPath = realpathSync.native(destinationParent);
    const relative = path.relative(repositoryRealPath, parentRealPath);
    const parentIsInsideRepository = relative === ''
        || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    if (parentIsInsideRepository) {
        throw new Error('Backup destination must be outside the repository, including through symlinks.');
    }

    return path.join(parentRealPath, path.basename(destination));
}

export function buildProductionLogicalBackupApproval(input: {
    destinationBindingSha256: string;
    authInertEvidenceSha256: string;
}): string {
    for (const [name, value] of Object.entries(input)) {
        if (!SHA256_PATTERN.test(value)) throw new Error(`${name} must be a lowercase SHA-256 hash.`);
    }
    return [
        'AUTORIZO EL BACKUP LOGICO DE SUPABASE PRODUCCION',
        `target=${FIXTURE_CLEANUP_TARGET.projectRef}`,
        `snapshot=${FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256}`,
        `scope=${FIXTURE_CLEANUP_TARGET.approvalScopeSha256}`,
        `destination_binding=${input.destinationBindingSha256}`,
        `auth_inert_evidence=${input.authInertEvidenceSha256}`,
        'format=pg_dump_custom',
        'schemas=public,auth',
        'destination_outside_repository=true',
        'overwrite=FORBIDDEN',
        'restore_procedure_reviewed=true',
        'at_rest_protection=windows_efs',
        'storage_and_external_providers=NOT_INCLUDED',
    ].join(' | ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
