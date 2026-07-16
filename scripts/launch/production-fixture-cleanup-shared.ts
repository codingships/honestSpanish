import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const FIXTURE_CLEANUP_TARGET = {
    environment: 'production' as const,
    projectRef: 'vkkahxsybhbutszerawz',
    aggregateSnapshotSha256: '765491a84ccab34ff0d2b1ca9149bf09f91cce2f267d20c9c95fe3a7316f5ca6',
    approvalScopeSha256: '3579509fe2cec168f9758fc69dab19f697fa5163a8e8a35582d8b8a1665ad320',
    canonicalPackageSha256: '6d17a17ca7bd8a99c2f0ba17522780546b473e49c386cee83d1da9acf08da38e',
} as const;

export const FIXTURE_CLEANUP_PATHS = {
    manifest: 'scripts/launch/production-fixture-cleanup-manifest.json',
    previewSql: 'scripts/launch/sql/production-fixture-cleanup-preview.sql',
    executeSql: 'scripts/launch/sql/production-fixture-cleanup-execute.sql',
    backupReceiptTemplate: 'scripts/launch/production-fixture-cleanup-backup-receipt.template.json',
    snapshot: 'scripts/launch/production-fixture-cleanup-snapshot-v2.json',
    scope: 'scripts/launch/production-fixture-cleanup-contract-v3.json',
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
    snapshotDocument: { path: string; sha256: string };
    approvalScopeDocument: { path: string; sha256: string };
    canonicalPackages: {
        preserve: string[];
        catalogSha256: string;
        clearLocalFieldsBeforeBillingWave: string[];
        deleteAfterSubscriptions: { name: string; requiredActiveState: boolean };
    };
    sql: {
        preview: { path: string; sha256: string };
        execute: { path: string; sha256: string };
    };
    expectedBaseline: {
        counts: Record<string, number>;
    };
    deleteOrder: string[];
    dropAfterVerifiedDelete: string[];
    authCleanup: { status: string };
}

export interface FixtureCleanupClassAction {
    resource: string;
    expectedCount: number | null;
    decision: string;
}

export interface FixtureCleanupContract {
    schemaVersion: number;
    operation: string;
    targetProjectRef: string;
    aggregateSnapshotSha256: string;
    classActions: Record<string, FixtureCleanupClassAction>;
    deleteOrder: string[];
    dropAfterVerifiedDelete: string[];
    packageAction: {
        preserve: string[];
        clearLocalFields: string[];
        deleteAfterSubscriptions: { name: string; requiredActiveState: boolean };
    };
}

export interface FixturePreservationPolicy {
    schemaVersion: number;
    policyKind: 'production_fixture_preservation';
    targetProjectRef: string;
    aggregateSnapshotSha256: string;
    approvalScopeSha256: string;
    approvedAt: string;
    observedCounts: Record<string, number | null>;
    decisions: Record<string, string>;
}

export interface FixturePreservationPolicyEvidence extends ValidationResult<FixturePreservationPolicy> {
    provided: boolean;
    sha256: string | null;
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

export function loadAndValidateFixtureCleanupContract(
    root = process.cwd(),
): ValidationResult<FixtureCleanupContract> {
    const errors: string[] = [];
    const absolutePath = path.join(root, FIXTURE_CLEANUP_PATHS.scope);
    let contract: FixtureCleanupContract | null = null;

    try {
        if (sha256File(absolutePath) !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) {
            errors.push('Fixture-cleanup contract SHA-256 mismatch.');
        }
        contract = JSON.parse(readFileSync(absolutePath, 'utf8')) as FixtureCleanupContract;
    } catch {
        return { ok: false, errors: ['Fixture-cleanup contract is missing or invalid JSON.'], value: null };
    }

    if (contract.schemaVersion !== 3) errors.push('Fixture-cleanup contract schemaVersion must be 3.');
    if (contract.operation !== 'production_fixture_cleanup_before_schema_rollout') {
        errors.push('Fixture-cleanup contract operation mismatch.');
    }
    if (contract.targetProjectRef !== FIXTURE_CLEANUP_TARGET.projectRef) {
        errors.push('Fixture-cleanup contract project ref mismatch.');
    }
    if (contract.aggregateSnapshotSha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) {
        errors.push('Fixture-cleanup contract aggregate snapshot mismatch.');
    }
    if (!isRecord(contract.classActions)) errors.push('Fixture-cleanup contract classActions must be an object.');

    const classEntries = isRecord(contract.classActions)
        ? Object.entries(contract.classActions)
        : [];
    const requiredClasses = [
        'auth_users',
        'profiles',
        'profiles_private',
        'packages',
        'subscriptions',
        'student_teachers',
        'sessions',
        'payments',
        'leads',
        'processed_webhook_events',
        'fulfillment_jobs',
        'admin_audit_log',
        'teacher_availability',
        'jobs',
        'support_tickets',
        'stripe_external_objects',
        'google_external_objects',
        'storage_objects',
    ];
    if (stableJson(classEntries.map(([key]) => key).sort()) !== stableJson([...requiredClasses].sort())) {
        errors.push('Fixture-cleanup contract class set mismatch.');
    }

    const allowedDecisions = new Set([
        'preserve_for_separate_cleanup',
        'delete_as_fixture_rebuild_preserved_auth_profiles_separately',
        'preserve_canonical_clear_local_stripe_delete_inactive_essential',
        'delete_as_fixture',
        'delete_as_fixture_drop_verified_legacy_table',
        'untouched_cleanup_separately',
    ]);
    for (const [fixtureClass, rawAction] of classEntries) {
        if (!isRecord(rawAction)) {
            errors.push(`Fixture-cleanup contract action ${fixtureClass} must be an object.`);
            continue;
        }
        const action = rawAction as unknown as FixtureCleanupClassAction;
        if (typeof action.resource !== 'string' || action.resource.length === 0) {
            errors.push(`Fixture-cleanup contract resource ${fixtureClass} is invalid.`);
        }
        if (!allowedDecisions.has(action.decision)) {
            errors.push(`Fixture-cleanup contract decision ${fixtureClass} is invalid.`);
        }
        if (action.expectedCount !== null
            && (!Number.isSafeInteger(action.expectedCount) || action.expectedCount < 0)) {
            errors.push(`Fixture-cleanup contract expected count ${fixtureClass} is invalid.`);
        }
    }

    const externalClasses = ['stripe_external_objects', 'google_external_objects', 'storage_objects'];
    for (const fixtureClass of externalClasses) {
        const action = contract.classActions?.[fixtureClass];
        if (action?.expectedCount !== null || action?.decision !== 'untouched_cleanup_separately') {
            errors.push(`Fixture-cleanup external class ${fixtureClass} must remain untouched and separate.`);
        }
    }
    if (contract.classActions?.auth_users?.decision !== 'preserve_for_separate_cleanup') {
        errors.push('Fixture-cleanup Auth users must remain preserved for the separate workflow.');
    }
    if (contract.classActions?.profiles?.decision !== 'delete_as_fixture_rebuild_preserved_auth_profiles_separately'
        || contract.classActions?.profiles_private?.decision !== 'delete_as_fixture_rebuild_preserved_auth_profiles_separately') {
        errors.push('Fixture-cleanup profile actions must bind deletion to the separate preserved-profile rebuild.');
    }
    if (contract.classActions?.packages?.decision !== 'preserve_canonical_clear_local_stripe_delete_inactive_essential') {
        errors.push('Fixture-cleanup packages must use the exact partial-preservation action.');
    }
    if (contract.classActions?.jobs?.decision !== 'delete_as_fixture_drop_verified_legacy_table') {
        errors.push('Fixture-cleanup legacy jobs action must bind delete and verified drop.');
    }

    if (!Array.isArray(contract.deleteOrder) || new Set(contract.deleteOrder).size !== contract.deleteOrder.length) {
        errors.push('Fixture-cleanup contract deleteOrder must be a duplicate-free array.');
    }
    const expectedDeleteTargets = classEntries
        .filter(([, action]) => isRecord(action) && String(action.decision).startsWith('delete_as_fixture'))
        .map(([, action]) => String(action.resource));
    expectedDeleteTargets.push('public.packages[name=essential,is_active=false]');
    if (stableJson([...expectedDeleteTargets].sort()) !== stableJson([...(contract.deleteOrder ?? [])].sort())) {
        errors.push('Fixture-cleanup contract deleteOrder does not cover the exact destructive class set.');
    }
    if (stableJson(contract.dropAfterVerifiedDelete) !== stableJson(['public.jobs'])) {
        errors.push('Fixture-cleanup contract drop target must be exactly public.jobs.');
    }
    if (stableJson(contract.packageAction?.preserve) !== stableJson(['group', 'standard', 'hybrid', 'bootcamp'])
        || stableJson(contract.packageAction?.clearLocalFields) !== stableJson([
            'stripe_product_id',
            'stripe_price_1m',
            'stripe_price_3m',
            'stripe_price_6m',
        ])
        || stableJson(contract.packageAction?.deleteAfterSubscriptions) !== stableJson({
            name: 'essential',
            requiredActiveState: false,
        })) {
        errors.push('Fixture-cleanup contract package partial-preservation action mismatch.');
    }

    return { ok: errors.length === 0, errors, value: contract };
}

export function loadAndValidateFixtureCleanupManifest(
    root = process.cwd(),
): ValidationResult<FixtureCleanupManifest> {
    const errors: string[] = [];
    const contractValidation = loadAndValidateFixtureCleanupContract(root);
    errors.push(...contractValidation.errors);
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
    if (manifest.snapshotDocument?.path !== FIXTURE_CLEANUP_PATHS.snapshot
        || manifest.snapshotDocument?.sha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) {
        errors.push('Manifest snapshot document binding mismatch.');
    }
    if (manifest.approvalScopeDocument?.path !== FIXTURE_CLEANUP_PATHS.scope
        || manifest.approvalScopeDocument?.sha256 !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) {
        errors.push('Manifest cleanup-contract document binding mismatch.');
    }
    if (manifest.canonicalPackages?.catalogSha256 !== FIXTURE_CLEANUP_TARGET.canonicalPackageSha256) {
        errors.push('Manifest canonical package hash mismatch.');
    }
    if (manifest.authCleanup?.status !== 'BLOCKED_SEPARATE_APPROVAL_AND_WORKFLOW') {
        errors.push('Manifest must keep Auth cleanup blocked as a separate workflow.');
    }

    const contract = contractValidation.value;
    if (contract) {
        if (stableJson(manifest.deleteOrder) !== stableJson(contract.deleteOrder)) {
            errors.push('Manifest deleteOrder does not exactly match the cleanup contract.');
        }
        if (stableJson(manifest.dropAfterVerifiedDelete) !== stableJson(contract.dropAfterVerifiedDelete)) {
            errors.push('Manifest dropAfterVerifiedDelete does not exactly match the cleanup contract.');
        }
        if (stableJson(manifest.canonicalPackages?.preserve) !== stableJson(contract.packageAction.preserve)
            || stableJson(manifest.canonicalPackages?.clearLocalFieldsBeforeBillingWave)
                !== stableJson(contract.packageAction.clearLocalFields)
            || stableJson(manifest.canonicalPackages?.deleteAfterSubscriptions)
                !== stableJson(contract.packageAction.deleteAfterSubscriptions)) {
            errors.push('Manifest package action does not exactly match the cleanup contract.');
        }
        for (const [fixtureClass, action] of Object.entries(contract.classActions)) {
            if (action.expectedCount === null) continue;
            if (manifest.expectedBaseline?.counts?.[fixtureClass] !== action.expectedCount) {
                errors.push(`Manifest expected count ${fixtureClass} does not match the cleanup contract.`);
            }
        }
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

export function readFixturePreservationPolicyEvidence(
    policyPath: string | null,
    now = new Date(),
    root = process.cwd(),
): FixturePreservationPolicyEvidence {
    if (!policyPath) {
        return {
            provided: false,
            ok: false,
            errors: ['Fixture-preservation policy was not provided.'],
            value: null,
            sha256: null,
        };
    }

    let bytes: Buffer;
    let raw: unknown;
    try {
        bytes = readFileSync(path.resolve(root, policyPath));
        raw = JSON.parse(bytes.toString('utf8'));
    } catch {
        return {
            provided: true,
            ok: false,
            errors: ['Fixture-preservation policy is missing or invalid JSON.'],
            value: null,
            sha256: null,
        };
    }

    const policySha256 = sha256(bytes);
    if (!isRecord(raw)) {
        return {
            provided: true,
            ok: false,
            errors: ['Fixture-preservation policy must be a JSON object.'],
            value: null,
            sha256: policySha256,
        };
    }

    const contractValidation = loadAndValidateFixtureCleanupContract(root);
    const errors = [...contractValidation.errors];
    const policy = raw as unknown as FixturePreservationPolicy;
    const exactKeys = [
        'schemaVersion',
        'policyKind',
        'targetProjectRef',
        'aggregateSnapshotSha256',
        'approvalScopeSha256',
        'approvedAt',
        'observedCounts',
        'decisions',
    ];
    if (stableJson(Object.keys(raw).sort()) !== stableJson([...exactKeys].sort())) {
        errors.push('Fixture-preservation policy top-level field set mismatch.');
    }
    if (policy.schemaVersion !== 2) errors.push('Fixture-preservation policy schemaVersion must be 2.');
    if (policy.policyKind !== 'production_fixture_preservation') {
        errors.push('Fixture-preservation policy kind mismatch.');
    }
    if (policy.targetProjectRef !== FIXTURE_CLEANUP_TARGET.projectRef) {
        errors.push('Fixture-preservation policy project ref mismatch.');
    }
    if (policy.aggregateSnapshotSha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) {
        errors.push('Fixture-preservation policy aggregate snapshot mismatch.');
    }
    if (policy.approvalScopeSha256 !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) {
        errors.push('Fixture-preservation policy cleanup-contract hash mismatch.');
    }

    const approvedAt = typeof policy.approvedAt === 'string'
        ? Date.parse(policy.approvedAt)
        : Number.NaN;
    const age = now.getTime() - approvedAt;
    if (!Number.isFinite(approvedAt)) {
        errors.push('Fixture-preservation policy approvedAt must be a valid ISO timestamp.');
    } else if (age < -FUTURE_CLOCK_SKEW_MS) {
        errors.push('Fixture-preservation policy approvedAt is too far in the future.');
    } else if (age > BACKUP_RECEIPT_MAX_AGE_MS) {
        errors.push('Fixture-preservation policy is older than 24 hours.');
    }

    if (!isRecord(policy.observedCounts)) errors.push('Fixture-preservation policy observedCounts must be an object.');
    if (!isRecord(policy.decisions)) errors.push('Fixture-preservation policy decisions must be an object.');
    const contract = contractValidation.value;
    if (contract && isRecord(policy.observedCounts) && isRecord(policy.decisions)) {
        const classes = Object.keys(contract.classActions).sort();
        if (stableJson(Object.keys(policy.observedCounts).sort()) !== stableJson(classes)) {
            errors.push('Fixture-preservation policy observed-count class set mismatch.');
        }
        if (stableJson(Object.keys(policy.decisions).sort()) !== stableJson(classes)) {
            errors.push('Fixture-preservation policy decision class set mismatch.');
        }
        for (const fixtureClass of classes) {
            const expected = contract.classActions[fixtureClass];
            if (policy.observedCounts[fixtureClass] !== expected.expectedCount) {
                errors.push(`Fixture-preservation policy observed count ${fixtureClass} does not match the contract.`);
            }
            if (policy.decisions[fixtureClass] !== expected.decision) {
                errors.push(`Fixture-preservation policy decision ${fixtureClass} does not match the contract.`);
            }
        }
    }

    return {
        provided: true,
        ok: errors.length === 0,
        errors,
        value: policy,
        sha256: policySha256,
    };
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
    preservationPolicySha256: string;
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
        `preservation_policy=${input.preservationPolicySha256}`,
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
