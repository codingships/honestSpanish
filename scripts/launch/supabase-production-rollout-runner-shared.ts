import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    FIXTURE_CLEANUP_PATHS,
    FIXTURE_CLEANUP_TARGET,
    sha256,
    stableJson,
    validateBackupReceipt,
} from './production-fixture-cleanup-shared';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_VERSION,
    normalizeMigrationName,
    type MigrationHistoryMapping,
} from './supabase-production-rollout-shared';

export const PRODUCTION_ROLLOUT_APPROVAL_ENV = 'SUPABASE_PRODUCTION_ROLLOUT_APPROVAL';
export const PRODUCTION_ROLLOUT_DB_URL_ENV = 'SUPABASE_DB_URL';
export const PRODUCTION_ROLLOUT_PSQL_GATE = 'EXECUTE_SUPABASE_PRODUCTION_WAVE_V1';
export const PRODUCTION_ROLLOUT_STAGING_REF = 'mzjyvmlxfpzdfdjzxxyj';
export const PRODUCTION_PREFLIGHT_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const PRODUCTION_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const PRODUCTION_AUTH_QUARANTINE_MIN_REMAINING_MS = 15 * 60 * 1_000;

export type ProductionRolloutWaveId =
    | 'processed_at_small_fix'
    | 'base_model_reconciliation'
    | 'application_schema'
    | 'runtime_and_policy'
    | 'billing_contract'
    | 'fulfillment_ledger'
    | 'deferred_rc_hardening';

export interface ProductionRolloutMigration {
    version: string;
    name: string;
    file: string;
    sha256: string;
}

export interface ProductionRolloutWave {
    id: ProductionRolloutWaveId;
    migrations: readonly ProductionRolloutMigration[];
}

function migration(version: string, name: string, sha: string): ProductionRolloutMigration {
    return {
        version,
        name,
        file: `supabase/migrations/${version}_${name}.sql`,
        sha256: sha,
    };
}

export const PRODUCTION_ROLLOUT_WAVES: readonly ProductionRolloutWave[] = [
    {
        id: 'processed_at_small_fix',
        migrations: [
            migration('20260703211451', 'drop_processed_webhook_processed_at_default', '56bc53a202ad494a6b227986be0364d777b511ab6db90e0df7ff7585191e7a99'),
        ],
    },
    {
        id: 'base_model_reconciliation',
        migrations: [
            migration('20260712112000', 'reconcile_database_model_contract', '84b12589850221c71b0f6ac1d9210e1a4c180836c274b6078ab638eca6b343aa'),
        ],
    },
    {
        id: 'application_schema',
        migrations: [
            migration('018', 'enrich_leads_for_application', '588ebb8360bc1511bbb143e4d224326310173cd81d9269b2956d62d8ec7c6c66'),
            migration('019', 'capture_preferred_package_on_leads', '02d29aa6ed1b62b26869bd565322986332499db898b2d985263e75d5253bd214'),
            migration('020', 'enforce_profile_role_links', 'ab616764f54e3e6b2ef0fc45cec7bf6f7ca88b1ab482963adaa648795e8db10d'),
            migration('20260624163423', 'add_crm_core', 'f5a63e238ddc983076618a5e953463f2c24fe86c420284dd5ce4c63f9c35aaac'),
            migration('20260624185757', 'add_crm_task_related_entity', '7deca3f5261ffca77d0d1239c5b52432508b2d95aa0f56a35e0a2fec5f1a2c13'),
            migration('20260625213116', 'capture_lead_languages', 'd815dc7b6475853360b665f64a4470ae0dd16ab54635a6472156d8af2c342cce'),
            migration('20260625215008', 'add_lightweight_level_check_to_leads', 'd6f62dc40247fe75f61c8ca9f546d1d461c0bc4a02ee26f5cdb074cfc5410e1c'),
        ],
    },
    {
        id: 'runtime_and_policy',
        migrations: [
            migration('20260710083915', 'enforce_resend_recipient_budget', 'b4d947263797334a1e8cd4005eced7d620f19971024b208b98cdf24f4a719c17'),
            migration('20260710120000', 'enforce_adult_lead_attestation', '0de12182e955e1fdb10864b79720c0b9cb52d3a0399ebbe152f92269e5da26da'),
            migration('20260710123000', 'track_stripe_refunds', '6f7534f94499ed77f430031d2d03457f6d2417a55411018546c70a626b6ebae0'),
            migration('20260710130000', 'add_renewal_notice_jobs', '165f5bdc57ea680351f011c849b9da1ab63320dadec5d7bf5d33f93444826d87'),
            migration('20260710133000', 'reconcile_runtime_schema_drift', '4548f134c17145080ac5b1dd03bdd1f391d78e804ebb2614975617c6ed9ca9d3'),
            migration('20260710143000', 'cancel_scheduled_session_atomically', '07df20dac5487192665bf474b08cc491edb52066874d023a427e90c7cc4a742c'),
            migration('20260710144000', 'enforce_adult_account_attestation', '9554c0d63e7ab041e79d3199825ce8c2b28aca409478a2ebf8de579595326469'),
        ],
    },
    {
        id: 'billing_contract',
        migrations: [
            migration('20260710205031', 'harden_billing_catalog_and_checkout_approval', '3caa451b9a74a6e9314e9cca81da03f76c820d2b71d59b69a5aa7537852bd286'),
            migration('20260710215712', 'harden_billing_reconciliation', '5fed3067181207ddc3905eb2aac1b60a33761892079d521882bda77b510b1664'),
            migration('20260710221846', 'harden_checkout_orphan_recovery', '3b009bbaa329bf0cfe907e0fc5dbd790d9e41a89630b4bd4d2c819397253728c'),
            migration('20260710223900', 'harden_checkout_customer_and_snapshot_immutability', '37a20bba050eb061e305b1d7f45a5f29ba64f0dba6f483ed83cc5404772aaf8d'),
        ],
    },
    {
        id: 'fulfillment_ledger',
        migrations: [
            migration('20260711192817', 'fulfillment_effect_ledger', '47c238e2da552d6593ca0b2bf3c9d4ebffd2b12f4ce7f121ac436af981b54038'),
        ],
    },
    {
        id: 'deferred_rc_hardening',
        migrations: [
            migration('20260712114000', 'harden_teacher_availability_overlap', '03c48790abf657571b43c2170a58f148d6d15e130a93f4de9be3be6a40aaaea3'),
            migration('20260712114500', 'require_current_adult_policy_on_signup', '5f01e7e0a2854174cab59002bea4ee01987782846f8a2266bd2dba5c897b7cfb'),
            migration('20260712115000', 'harden_data_api_table_grants', '88e26ddd4eed1ba337ab1902fa707de38619f76158b9a46fcbd1b9adf00707b4'),
            migration('20260712195500', 'harden_sessions_status_contract', '5106b1f3081f91246682ff9dc02ed1904eac4fc8dae065bfc05ac3136d5d65b1'),
        ],
    },
] as const;

export const PRODUCTION_ROLLOUT_MIGRATIONS = PRODUCTION_ROLLOUT_WAVES
    .flatMap((wave) => wave.migrations);

export interface EvidenceValidation<T> {
    provided: boolean;
    valid: boolean;
    path: string | null;
    sha256: string | null;
    value: T | null;
    errors: string[];
}

export interface ProductionPreflightEvidence {
    schemaVersion: number;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    target: { ref: string };
    migrationInventory: {
        localMigrations: MigrationHistoryMapping[];
        semanticMissingCountExcludingStagingOnly: number;
        ambiguousCount: number;
    };
    aggregates: Record<string, unknown>;
    safety: {
        noExternalWrite: boolean;
        noPrivateRowsSelected: boolean;
        noSecretsStored: boolean;
    };
}

export interface FixtureCleanupEvidence {
    schemaVersion: number;
    status: 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED';
    completedAt: string;
    targetProjectRef: string;
    aggregateSnapshotSha256: string;
    approvalScopeSha256: string;
    executeSqlSha256: string;
    backupReceiptSha256: string;
    packageStripeReferenceSha256: string;
    freezeCutoff: string;
    postconditions: {
        authUsers: number;
        profiles: number;
        profilesPrivate: number;
        legacyJobsTableAbsent: boolean;
        supportTickets: number;
        packages: number;
    };
    packagesPreserved: string[];
    localPackageStripeFieldsCleared: boolean;
    inactiveEssentialDeleted: boolean;
    externalStripeGoogleStorage: string;
    authNextStep: string;
}

export interface AuthPolicyEvidence {
    schemaVersion: number;
    targetProjectRef: string;
    status: 'AUTH_REDUCED_QUARANTINED';
    completedAt: string;
    publicCleanupReceiptSha256: string;
    backupReceiptSha256: string;
    authUsers: 2;
    profiles: 0;
    fixtureStudents: 0;
    storageObjectsTouched: false;
    externalProvidersTouched: false;
    passwordsRotatedUnretained: true;
    quarantineUntil: string;
    preservedSetSha256: string;
    deletedCandidateSetSha256: string;
    freezeCutoff: string;
    jwtExpirySeconds: number;
    jwtExpirySource: 'management_api' | 'conservative_default';
    refreshSessionsRemaining: 0;
    resetEmailsSent: false;
    googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED';
}

export interface StagingHardeningEvidence {
    schemaVersion: number;
    endedAt: string;
    status: string;
    closureStatus: string;
    target: { projectRef: string };
    writeCommandInvoked: boolean;
    externalWritePerformed: boolean;
    migrations: Array<{ version: string; name: string; file: string; sha256: string }>;
    checks: Array<{ status: string }>;
}

export interface GoogleFixturePolicyEvidence {
    schemaVersion: number;
    environment: 'production';
    status: 'TRASHED_AND_VERIFIED' | 'EXPLICITLY_DEFERRED_APPROVED';
    completedAt: string;
    observedActiveRootChildrenBefore: 110;
    observedFoldersBefore: 110;
    activeRootChildrenAfter: number;
    permanentlyDeleted: 0;
    rootIdStored: false;
}

export interface SentryProductionHardeningEvidence {
    schemaVersion: number;
    endedAt: string;
    status: string;
    closureStatus: string;
    target: { organization: string; project: string; environment: string };
    executeRequested: boolean;
    externalWriteAttempted: boolean;
    externalWritePerformed: boolean;
    rollbackAttempted: boolean;
    createdWorkflowCount: number;
    detectorFingerprint: string;
    ownerFingerprint: string;
    expectedChanges: {
        scrubIPAddresses: boolean;
        workflows: string[];
        environment: string;
    };
    checks: Array<{ status: string }>;
}

export interface AllowlistValidation {
    valid: boolean;
    errors: string[];
    sources: Map<string, string>;
    allowlistSha256: string;
}

export interface WaveHistoryState {
    id: ProductionRolloutWaveId;
    state: 'complete' | 'pending' | 'partial_or_ambiguous';
}

export function productionRolloutAllowlistSha256(): string {
    return sha256(stableJson(PRODUCTION_ROLLOUT_WAVES));
}

export function validateProductionRolloutAllowlist(root = process.cwd()): AllowlistValidation {
    const errors: string[] = [];
    const sources = new Map<string, string>();
    const versions = new Set<string>();

    if (PRODUCTION_ROLLOUT_MIGRATIONS.length !== 25) {
        errors.push(`Allowlist must contain exactly 25 migrations, observed ${PRODUCTION_ROLLOUT_MIGRATIONS.length}.`);
    }
    for (const migrationEntry of PRODUCTION_ROLLOUT_MIGRATIONS) {
        if (versions.has(migrationEntry.version)) errors.push(`Duplicate version ${migrationEntry.version}.`);
        versions.add(migrationEntry.version);
        if (migrationEntry.version === STAGING_ONLY_VERSION) errors.push(`Staging-only version ${STAGING_ONLY_VERSION} is forbidden.`);

        const absolutePath = path.resolve(root, migrationEntry.file);
        const relative = path.relative(path.resolve(root), absolutePath);
        if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            errors.push(`${migrationEntry.file} resolves outside the repository.`);
            continue;
        }
        if (!existsSync(absolutePath)) {
            errors.push(`${migrationEntry.file} is missing.`);
            continue;
        }
        const source = readFileSync(absolutePath, 'utf8');
        sources.set(migrationEntry.version, source);
        if (sha256(source) !== migrationEntry.sha256) errors.push(`${migrationEntry.file} SHA-256 mismatch.`);
        if (source.includes(`$production_rollout_${migrationEntry.version}$`)) {
            errors.push(`${migrationEntry.file} contains the reserved history dollar tag.`);
        }
        if (/^\s*\\/mu.test(source)) errors.push(`${migrationEntry.file} contains a psql meta-command.`);
        if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/imu.test(source)) {
            errors.push(`${migrationEntry.file} contains an explicit transaction boundary.`);
        }
        if (/CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY/iu.test(source)) {
            errors.push(`${migrationEntry.file} contains non-transactional CREATE INDEX CONCURRENTLY.`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        sources,
        allowlistSha256: productionRolloutAllowlistSha256(),
    };
}

export function readProductionPreflightEvidence(
    evidencePath: string | null,
    now = new Date(),
    root = process.cwd(),
): EvidenceValidation<ProductionPreflightEvidence> {
    const loaded = readJsonEvidence<ProductionPreflightEvidence>(evidencePath);
    if (!loaded.value) return loaded;
    const value = loaded.value;
    const errors = [...loaded.errors];
    if (value.schemaVersion !== 1) errors.push('Preflight schemaVersion must be 1.');
    if (value.target?.ref !== PRODUCTION_PROJECT.ref) errors.push('Preflight target ref mismatch.');
    if (!['OK', 'WARNING'].includes(value.status)) errors.push('Preflight status must be OK or WARNING.');
    if (!value.safety?.noExternalWrite || !value.safety?.noPrivateRowsSelected || !value.safety?.noSecretsStored) {
        errors.push('Preflight safety assertions are incomplete.');
    }
    if (value.migrationInventory?.ambiguousCount !== 0) errors.push('Preflight contains ambiguous migration mappings.');
    requireFreshTimestamp(value.endedAt, now, PRODUCTION_PREFLIGHT_MAX_AGE_MS, 'Preflight', errors);

    const localMigrations = Array.isArray(value.migrationInventory?.localMigrations)
        ? value.migrationInventory.localMigrations
        : [];
    if (!Array.isArray(value.migrationInventory?.localMigrations)) {
        errors.push('Preflight local migration inventory is missing or invalid.');
    }
    const localByVersion = new Map(localMigrations.map((entry) => [entry.version, entry]));
    for (const migrationEntry of PRODUCTION_ROLLOUT_MIGRATIONS) {
        const observed = localByVersion.get(migrationEntry.version);
        if (!observed) {
            errors.push(`Preflight is missing allowlisted migration ${migrationEntry.version}.`);
            continue;
        }
        if (observed.name !== migrationEntry.name || observed.sha256 !== migrationEntry.sha256) {
            errors.push(`Preflight migration identity/hash mismatch for ${migrationEntry.version}.`);
        }
        if (!['missing', 'exact'].includes(observed.historyStatus)) {
            errors.push(`Preflight migration state is unsafe for ${migrationEntry.version}: ${observed.historyStatus}.`);
        }
    }
    const stagingOnly = localByVersion.get(STAGING_ONLY_VERSION);
    if (!stagingOnly || stagingOnly.historyStatus !== 'missing') {
        errors.push(`Staging-only migration ${STAGING_ONLY_VERSION} must remain absent.`);
    }
    const allowlistedVersions = new Set(PRODUCTION_ROLLOUT_MIGRATIONS.map((entry) => entry.version));
    const unplanned = localMigrations.filter((entry) => (
        entry.historyStatus === 'missing'
        && !entry.stagingOnly
        && !allowlistedVersions.has(entry.version)
    ));
    if (unplanned.length > 0) errors.push(`Preflight has unplanned semantic migrations: ${unplanned.map((entry) => entry.version).join(',')}.`);
    const observedMissing = PRODUCTION_ROLLOUT_MIGRATIONS.filter((entry) => localByVersion.get(entry.version)?.historyStatus === 'missing').length;
    if (value.migrationInventory?.semanticMissingCountExcludingStagingOnly !== observedMissing) {
        errors.push('Preflight semantic missing count does not equal the exact allowlisted pending count.');
    }
    const waveStates = deriveWaveHistoryStates(value);
    validateWavePrefix(waveStates, errors);

    const localValidation = validateProductionRolloutAllowlist(root);
    errors.push(...localValidation.errors.map((error) => `Local allowlist: ${error}`));
    return { ...loaded, valid: errors.length === 0, errors };
}

export function readBackupReceiptEvidence(
    evidencePath: string | null,
    now = new Date(),
): EvidenceValidation<Record<string, unknown>> {
    const loaded = readJsonEvidence<Record<string, unknown>>(evidencePath);
    if (!loaded.value) return loaded;
    const validation = validateBackupReceipt(loaded.value, now);
    return {
        ...loaded,
        valid: loaded.errors.length === 0 && validation.ok,
        errors: [...loaded.errors, ...validation.errors],
    };
}

export function readFixtureCleanupEvidence(
    evidencePath: string | null,
    backupReceiptSha256: string | null,
    now = new Date(),
    root = process.cwd(),
): EvidenceValidation<FixtureCleanupEvidence> {
    const loaded = readJsonEvidence<FixtureCleanupEvidence>(evidencePath);
    if (!loaded.value) return loaded;
    const value = loaded.value;
    const errors = [...loaded.errors];
    let manifest: { sql?: { execute?: { sha256?: string } } } = {};
    try {
        manifest = JSON.parse(readFileSync(path.join(root, FIXTURE_CLEANUP_PATHS.manifest), 'utf8')) as typeof manifest;
    } catch {
        errors.push('Current fixture-cleanup manifest is missing or invalid.');
    }
    if (value.schemaVersion !== 2) errors.push('Fixture cleanup receipt schemaVersion must be 2.');
    if (value.status !== 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED') errors.push('Fixture cleanup receipt status is invalid.');
    if (value.targetProjectRef !== PRODUCTION_PROJECT.ref) errors.push('Fixture cleanup target ref mismatch.');
    if (value.aggregateSnapshotSha256 !== FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256) errors.push('Fixture cleanup snapshot hash mismatch.');
    if (value.approvalScopeSha256 !== FIXTURE_CLEANUP_TARGET.approvalScopeSha256) errors.push('Fixture cleanup approval scope mismatch.');
    if (value.executeSqlSha256 !== manifest.sql?.execute?.sha256) errors.push('Fixture cleanup SQL hash mismatch.');
    if (!backupReceiptSha256 || value.backupReceiptSha256 !== backupReceiptSha256) errors.push('Fixture cleanup is not bound to the supplied backup receipt.');
    if (stableJson([...(value.packagesPreserved ?? [])].sort()) !== stableJson(['bootcamp', 'group', 'hybrid', 'standard'])) {
        errors.push('Fixture cleanup did not preserve the exact canonical package set.');
    }
    if (!value.localPackageStripeFieldsCleared || !value.inactiveEssentialDeleted) errors.push('Fixture cleanup package postconditions are incomplete.');
    if (value.externalStripeGoogleStorage !== 'UNTOUCHED') errors.push('Fixture cleanup external-provider exclusion is not proven.');
    if (value.freezeCutoff !== '2026-07-02T18:29:27.580Z') errors.push('Fixture cleanup freeze cutoff mismatch.');
    const postconditions = value.postconditions;
    if (!postconditions
        || Object.keys(postconditions).length !== 6
        || postconditions.authUsers !== 138
        || postconditions.profiles !== 0
        || postconditions.profilesPrivate !== 0
        || postconditions.legacyJobsTableAbsent !== true
        || postconditions.supportTickets !== 0
        || postconditions.packages !== 4) {
        errors.push('Fixture cleanup public postconditions mismatch.');
    }
    if (value.authNextStep !== 'SEPARATE_AUTH_REDUCTION_REQUIRED') errors.push('Fixture cleanup Auth handoff is invalid.');
    requireFreshTimestamp(value.completedAt, now, PRODUCTION_EVIDENCE_MAX_AGE_MS, 'Fixture cleanup', errors);
    return { ...loaded, valid: errors.length === 0, errors };
}

export function readAuthPolicyEvidence(
    evidencePath: string | null,
    publicCleanupReceiptSha256: string | null,
    now = new Date(),
    backupReceiptSha256: string | null = null,
): EvidenceValidation<AuthPolicyEvidence> {
    const loaded = readJsonEvidence<AuthPolicyEvidence>(evidencePath);
    if (!loaded.value) return loaded;
    const value = loaded.value;
    const errors = [...loaded.errors];
    if (value.schemaVersion !== 1) errors.push('Auth policy schemaVersion must be 1.');
    if (value.targetProjectRef !== PRODUCTION_PROJECT.ref) errors.push('Auth policy target ref mismatch.');
    if (value.status !== 'AUTH_REDUCED_QUARANTINED') errors.push('Auth receipt is not AUTH_REDUCED_QUARANTINED.');
    if (!publicCleanupReceiptSha256 || value.publicCleanupReceiptSha256 !== publicCleanupReceiptSha256) {
        errors.push('Auth receipt is not bound to the supplied public-cleanup receipt.');
    }
    if (!backupReceiptSha256 || value.backupReceiptSha256 !== backupReceiptSha256) {
        errors.push('Auth receipt is not bound to the supplied encrypted-backup receipt.');
    }
    if (value.fixtureStudents !== 0) errors.push('Auth fixture students remain.');
    if (value.storageObjectsTouched !== false || value.externalProvidersTouched !== false) errors.push('Auth policy touched excluded state.');
    if (value.authUsers !== 2 || value.profiles !== 0) errors.push('Auth quarantine counts must be auth=2/profiles=0.');
    if (value.passwordsRotatedUnretained !== true) errors.push('Preserved credentials were not quarantined.');
    if (value.refreshSessionsRemaining !== 0) errors.push('Auth refresh sessions remain after quarantine.');
    if (value.resetEmailsSent !== false) errors.push('Auth cleanup unexpectedly sent reset emails.');
    if (value.googleDriveFixtureFolders !== 'UNTOUCHED_110_OBSERVED') errors.push('Auth cleanup Google exclusion is invalid.');
    if (value.freezeCutoff !== '2026-07-02T18:29:27.580Z') errors.push('Auth cleanup freeze cutoff mismatch.');
    if (!/^[a-f0-9]{64}$/u.test(value.preservedSetSha256 ?? '')
        || !/^[a-f0-9]{64}$/u.test(value.deletedCandidateSetSha256 ?? '')) {
        errors.push('Auth identity-set hashes are invalid.');
    }
    if (!Number.isSafeInteger(value.jwtExpirySeconds) || value.jwtExpirySeconds <= 0
        || !['management_api', 'conservative_default'].includes(value.jwtExpirySource)) {
        errors.push('Auth JWT quarantine configuration is invalid.');
    }
    requireFreshTimestamp(value.completedAt, now, PRODUCTION_EVIDENCE_MAX_AGE_MS, 'Auth quarantine', errors);
    const quarantineUntil = Date.parse(value.quarantineUntil);
    if (!Number.isFinite(quarantineUntil) || quarantineUntil <= Date.parse(value.completedAt)) {
        errors.push('Auth quarantineUntil must be later than completion.');
    } else if (quarantineUntil <= now.getTime()) {
        errors.push('Auth credential quarantine has expired; rollout must finish during the active quarantine window.');
    } else if (quarantineUntil - now.getTime() < PRODUCTION_AUTH_QUARANTINE_MIN_REMAINING_MS) {
        errors.push('Auth credential quarantine has less than 15 minutes remaining; obtain a fresh safe execution window.');
    }
    return { ...loaded, valid: errors.length === 0, errors };
}

export function readStagingHardeningEvidence(
    evidencePath: string | null,
    now = new Date(),
): EvidenceValidation<StagingHardeningEvidence> {
    const loaded = readJsonEvidence<StagingHardeningEvidence>(evidencePath);
    if (!loaded.value) return loaded;
    const value = loaded.value;
    const errors = [...loaded.errors];
    if (value.schemaVersion !== 1) errors.push('Staging evidence schemaVersion must be 1.');
    if (value.target?.projectRef !== PRODUCTION_ROLLOUT_STAGING_REF) errors.push('Staging evidence project ref mismatch.');
    if (value.status !== 'OK' || value.closureStatus !== 'APPLIED_AND_VERIFIED') {
        errors.push('Staging hardening must be APPLIED_AND_VERIFIED, not merely planned, preflighted or already claimed.');
    }
    if (!value.writeCommandInvoked || !value.externalWritePerformed) errors.push('Staging evidence does not prove the exact apply run.');
    if (!Array.isArray(value.checks) || value.checks.length === 0
        || value.checks.some((check) => check.status !== 'ok')) {
        errors.push('Staging evidence must contain only completed ok checks.');
    }
    const expected = PRODUCTION_ROLLOUT_WAVES
        .filter((wave) => ['base_model_reconciliation', 'deferred_rc_hardening'].includes(wave.id))
        .flatMap((wave) => wave.migrations);
    const suppliedMigrations = Array.isArray(value.migrations) ? value.migrations : [];
    if (!Array.isArray(value.migrations)) errors.push('Staging evidence migrations are missing or invalid.');
    const supplied = new Map(suppliedMigrations.map((entry) => [entry.version, entry]));
    if (supplied.size !== expected.length) errors.push('Staging evidence migration count mismatch.');
    for (const migrationEntry of expected) {
        const observed = supplied.get(migrationEntry.version);
        if (!observed || observed.name !== migrationEntry.name || observed.sha256 !== migrationEntry.sha256) {
            errors.push(`Staging evidence mismatch for ${migrationEntry.version}.`);
        }
    }
    requireFreshTimestamp(value.endedAt, now, PRODUCTION_EVIDENCE_MAX_AGE_MS, 'Staging hardening', errors);
    return { ...loaded, valid: errors.length === 0, errors };
}

export function readGoogleFixturePolicyEvidence(
    evidencePath: string | null,
    now = new Date(),
): EvidenceValidation<GoogleFixturePolicyEvidence> {
    const loaded = readJsonEvidence<GoogleFixturePolicyEvidence>(evidencePath);
    if (!loaded.value) return loaded;
    const value = loaded.value;
    const errors = [...loaded.errors];
    if (value.schemaVersion !== 1 || value.environment !== 'production') errors.push('Google fixture evidence identity mismatch.');
    if (!['TRASHED_AND_VERIFIED', 'EXPLICITLY_DEFERRED_APPROVED'].includes(value.status)) errors.push('Google fixture policy is not closed or explicitly deferred.');
    if (value.observedActiveRootChildrenBefore !== 110 || value.observedFoldersBefore !== 110) errors.push('Google fixture baseline mismatch.');
    if (value.status === 'TRASHED_AND_VERIFIED' && value.activeRootChildrenAfter !== 0) errors.push('Google root cleanup is not verified empty.');
    if (value.status === 'EXPLICITLY_DEFERRED_APPROVED' && value.activeRootChildrenAfter !== 110) errors.push('Google deferral count mismatch.');
    if (value.permanentlyDeleted !== 0 || value.rootIdStored !== false) errors.push('Google evidence violates recoverability/privacy constraints.');
    requireFreshTimestamp(value.completedAt, now, PRODUCTION_EVIDENCE_MAX_AGE_MS, 'Google fixture policy', errors);
    return { ...loaded, valid: errors.length === 0, errors };
}

export function readSentryProductionHardeningEvidence(
    evidencePath: string | null,
    now = new Date(),
): EvidenceValidation<SentryProductionHardeningEvidence> {
    const loaded = readJsonEvidence<SentryProductionHardeningEvidence>(evidencePath);
    if (!loaded.value) return loaded;
    const value = loaded.value;
    const errors = [...loaded.errors];
    if (value.schemaVersion !== 1 || value.status !== 'OK' || value.closureStatus !== 'HARDENED_AND_VERIFIED') {
        errors.push('Sentry production hardening is not HARDENED_AND_VERIFIED.');
    }
    if (value.target?.organization !== 'honestspanish'
        || value.target?.project !== 'espanol-honesto-astro'
        || value.target?.environment !== 'production') {
        errors.push('Sentry production hardening target mismatch.');
    }
    if (!value.executeRequested || !value.externalWriteAttempted || !value.externalWritePerformed) {
        errors.push('Sentry evidence does not prove an executed hardening run.');
    }
    if (value.rollbackAttempted) errors.push('Sentry hardening evidence includes a rollback attempt.');
    if (value.createdWorkflowCount !== 2) errors.push('Sentry hardening did not create the exact two workflows.');
    if (!/^[a-f0-9]{64}$/u.test(value.detectorFingerprint ?? '')
        || !/^[a-f0-9]{64}$/u.test(value.ownerFingerprint ?? '')) {
        errors.push('Sentry detector/owner fingerprints are invalid.');
    }
    if (!Array.isArray(value.expectedChanges?.workflows)
        || stableJson(value.expectedChanges.workflows) !== stableJson([
            'EH Production - New and regressed errors',
            'EH Production - Error spike 10 events in 5 minutes',
        ]) || value.expectedChanges?.scrubIPAddresses !== true
        || value.expectedChanges?.environment !== 'production') {
        errors.push('Sentry hardening final workflow/privacy contract mismatch.');
    }
    if (!Array.isArray(value.checks) || value.checks.length === 0
        || value.checks.some((check) => check.status !== 'ok')) {
        errors.push('Sentry hardening must contain only completed ok checks.');
    }
    requireFreshTimestamp(value.endedAt, now, PRODUCTION_EVIDENCE_MAX_AGE_MS, 'Sentry production hardening', errors);
    return { ...loaded, valid: errors.length === 0, errors };
}

export function deriveWaveHistoryStates(preflight: ProductionPreflightEvidence): WaveHistoryState[] {
    const migrations = Array.isArray(preflight.migrationInventory?.localMigrations)
        ? preflight.migrationInventory.localMigrations
        : [];
    const map = new Map(migrations.map((entry) => [entry.version, entry]));
    return PRODUCTION_ROLLOUT_WAVES.map((wave) => {
        const states = wave.migrations.map((entry) => map.get(entry.version)?.historyStatus ?? 'ambiguous');
        if (states.every((state) => state === 'missing')) return { id: wave.id, state: 'pending' as const };
        if (states.every((state) => state === 'exact' || state === 'alias')) return { id: wave.id, state: 'complete' as const };
        return { id: wave.id, state: 'partial_or_ambiguous' as const };
    });
}

export function selectedWavesThrough(through: ProductionRolloutWaveId): readonly ProductionRolloutWave[] {
    const index = PRODUCTION_ROLLOUT_WAVES.findIndex((wave) => wave.id === through);
    if (index < 0) throw new Error(`Unknown rollout wave: ${through}`);
    return PRODUCTION_ROLLOUT_WAVES.slice(0, index + 1);
}

export function renderProductionWaveApplySql(input: {
    wave: ProductionRolloutWave;
    sources: Map<string, string>;
    scopeSha256: string;
}): string {
    const semanticGate = input.wave.migrations.map((entry) => (
        `(history.version = '${sqlLiteral(entry.version)}' OR regexp_replace(coalesce(history.name, ''), '^[0-9]+_', '') = '${sqlLiteral(entry.name)}')`
    )).join('\n            OR ');
    const lines = [
        '\\set ON_ERROR_STOP on',
        'BEGIN;',
        "SET LOCAL statement_timeout = '120s';",
        "SET LOCAL lock_timeout = '10s';",
        "SET LOCAL idle_in_transaction_session_timeout = '120s';",
        'SELECT (',
        `    :'rollout_gate' = '${PRODUCTION_ROLLOUT_PSQL_GATE}'`,
        `    AND :'rollout_project_ref' = '${PRODUCTION_PROJECT.ref}'`,
        `    AND :'rollout_scope_sha256' = '${input.scopeSha256}'`,
        `    AND :'rollout_wave' = '${input.wave.id}'`,
        ') AS rollout_gate_ok \\gset',
        '\\if :rollout_gate_ok',
        '\\else',
        '    ROLLBACK;',
        "    \\echo 'Supabase production rollout SQL gate rejected.'",
        '    \\quit 3',
        '\\endif',
        `SELECT pg_advisory_xact_lock(hashtextextended('espanol-honesto:production-rollout:v1', 0));`,
        'DO $production_rollout_history_gate$',
        'BEGIN',
        '    IF EXISTS (',
        '        SELECT 1 FROM supabase_migrations.schema_migrations AS history',
        `        WHERE ${semanticGate}`,
        '    ) THEN',
        `        RAISE EXCEPTION 'Wave ${input.wave.id} already has semantic history; refusing duplicate apply';`,
        '    END IF;',
        `    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${STAGING_ONLY_VERSION}') THEN`,
        `        RAISE EXCEPTION 'Staging-only migration ${STAGING_ONLY_VERSION} is forbidden in production';`,
        '    END IF;',
        'END',
        '$production_rollout_history_gate$;',
        '',
    ];

    for (const migrationEntry of input.wave.migrations) {
        const source = input.sources.get(migrationEntry.version);
        if (source === undefined) throw new Error(`Missing validated source for ${migrationEntry.version}.`);
        const tag = `$production_rollout_${migrationEntry.version}$`;
        lines.push(
            `-- ${migrationEntry.file}`,
            `-- sha256 ${migrationEntry.sha256}`,
            source,
            'INSERT INTO supabase_migrations.schema_migrations (version, statements, name)',
            `VALUES ('${migrationEntry.version}', ARRAY[${tag}${source}${tag}]::text[], '${migrationEntry.name}');`,
            '',
        );
    }
    lines.push(
        'COMMIT;',
        `SELECT 'PRODUCTION_ROLLOUT_WAVE_COMMITTED|wave=${input.wave.id}|scope=${input.scopeSha256}';`,
        '',
    );
    return lines.join('\n');
}

export function renderProductionLivePreflightSql(): string {
    const values = PRODUCTION_ROLLOUT_MIGRATIONS
        .map((entry) => `('${sqlLiteral(entry.version)}','${sqlLiteral(entry.name)}')`)
        .join(',\n        ');
    return `${[
        'BEGIN READ ONLY;',
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL lock_timeout = '5s';",
        `SELECT 'current_database', current_database();`,
        `SELECT 'history_columns', coalesce(string_agg(column_name, ',' ORDER BY column_name), '')`,
        'FROM information_schema.columns',
        "WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations';",
        `SELECT 'staging_only_count', count(*)::text FROM supabase_migrations.schema_migrations WHERE version = '${STAGING_ONLY_VERSION}';`,
        `SELECT 'inert_auth_users', count(*)::text FROM auth.users;`,
        `SELECT 'inert_auth_sessions', count(*)::text FROM auth.sessions;`,
        `SELECT 'inert_auth_refresh_tokens', count(*)::text FROM auth.refresh_tokens;`,
        `SELECT 'inert_profiles', count(*)::text FROM public.profiles;`,
        `SELECT 'inert_profiles_private', count(*)::text FROM public.profiles_private;`,
        `SELECT 'inert_legacy_jobs_absent', (to_regclass('public.jobs') IS NULL)::text;`,
        `SELECT 'inert_public_fixture_rows', (` ,
        `    (SELECT count(*) FROM public.subscriptions)`,
        `  + (SELECT count(*) FROM public.student_teachers)`,
        `  + (SELECT count(*) FROM public.sessions)`,
        `  + (SELECT count(*) FROM public.payments)`,
        `  + (SELECT count(*) FROM public.leads)`,
        `  + (SELECT count(*) FROM public.processed_webhook_events)`,
        `  + (SELECT count(*) FROM public.fulfillment_jobs)`,
        `  + (SELECT count(*) FROM public.support_tickets)`,
        `  + (SELECT count(*) FROM public.admin_audit_log)`,
        `  + (SELECT count(*) FROM public.teacher_availability)`,
        `)::text;`,
        `SELECT 'inert_packages_clean', ((SELECT count(*) = 4 FROM public.packages) AND (`,
        `    SELECT count(*) = 4 FROM public.packages`,
        `    WHERE name IN ('group','standard','hybrid','bootcamp')`,
        `      AND stripe_product_id IS NULL`,
        `      AND stripe_price_1m IS NULL`,
        `      AND stripe_price_3m IS NULL`,
        `      AND stripe_price_6m IS NULL`,
        `) AND NOT EXISTS (SELECT 1 FROM public.packages WHERE name = 'essential'))::text;`,
        'WITH expected(version, name) AS (',
        `    VALUES ${values}`,
        '), matches AS (',
        '    SELECT expected.version, expected.name, count(history.version)::integer AS match_count',
        '    FROM expected',
        '    LEFT JOIN supabase_migrations.schema_migrations AS history',
        '      ON history.version = expected.version',
        "      OR regexp_replace(coalesce(history.name, ''), '^[0-9]+_', '') = expected.name",
        '    GROUP BY expected.version, expected.name',
        ')',
        `SELECT 'history:' || version, match_count::text FROM matches ORDER BY version;`,
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function renderProductionWaveVerifySql(appliedWaves: readonly ProductionRolloutWave[]): string {
    const migrations = appliedWaves.flatMap((wave) => wave.migrations);
    const historyValues = migrations.map((entry) => (
        `('${sqlLiteral(entry.version)}','${sqlLiteral(entry.name)}','${entry.sha256}')`
    )).join(',\n        ');
    const facts = appliedWaves.flatMap((wave) => waveVerificationFacts(wave.id));
    return `${[
        'BEGIN READ ONLY;',
        "SET LOCAL statement_timeout = '30s';",
        "SET LOCAL lock_timeout = '5s';",
        `SELECT 'current_database', current_database();`,
        `SELECT 'staging_only_absent', (NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '${STAGING_ONLY_VERSION}'))::text;`,
        'WITH expected(version, name, source_sha256) AS (',
        `    VALUES ${historyValues || "('<none>','<none>','<none>')"}`,
        ')',
        `SELECT 'history_verified_count', count(*)::text`,
        'FROM expected',
        'JOIN supabase_migrations.schema_migrations AS history',
        '  ON history.version = expected.version',
        ' AND history.name = expected.name',
        ' AND cardinality(history.statements) = 1',
        " AND encode(extensions.digest(convert_to(history.statements[1], 'UTF8'), 'sha256'), 'hex') = expected.source_sha256;",
        ...facts.map((fact) => fact.sql),
        'COMMIT;',
        '',
    ].join('\n')}\n`;
}

export function expectedProductionWaveVerificationFacts(
    appliedWaves: readonly ProductionRolloutWave[],
): Map<string, string> {
    const expected = new Map<string, string>([
        ['current_database', 'postgres'],
        ['staging_only_absent', 'true'],
        ['history_verified_count', String(appliedWaves.flatMap((wave) => wave.migrations).length)],
    ]);
    for (const fact of appliedWaves.flatMap((wave) => waveVerificationFacts(wave.id))) {
        expected.set(fact.key, fact.expected);
    }
    return expected;
}

export function parseProductionSqlFacts(output: string): Map<string, string> {
    const facts = new Map<string, string>();
    for (const line of output.split(/\r?\n/u)) {
        const separator = line.indexOf('\t');
        if (separator <= 0) continue;
        facts.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return facts;
}

export function validateLiveHistoryFacts(
    facts: Map<string, string>,
    preflight: ProductionPreflightEvidence,
    requireInertState = false,
): string[] {
    const errors: string[] = [];
    if (facts.get('current_database') !== 'postgres') errors.push('Live preflight current database mismatch.');
    if (facts.get('staging_only_count') !== '0') errors.push(`Staging-only migration ${STAGING_ONLY_VERSION} is present.`);
    const columns = new Set((facts.get('history_columns') ?? '').split(','));
    for (const column of ['name', 'statements', 'version']) {
        if (!columns.has(column)) errors.push(`Migration history is missing ${column}.`);
    }
    const preflightMap = new Map(preflight.migrationInventory.localMigrations.map((entry) => [entry.version, entry]));
    for (const migrationEntry of PRODUCTION_ROLLOUT_MIGRATIONS) {
        const expectedCount = preflightMap.get(migrationEntry.version)?.historyStatus === 'missing' ? '0' : '1';
        const observed = facts.get(`history:${migrationEntry.version}`);
        if (observed !== expectedCount) {
            errors.push(`Live semantic history drift for ${migrationEntry.version}: expected ${expectedCount}, observed ${observed ?? '<missing>'}.`);
        }
    }
    if (requireInertState) {
        for (const [key, expected] of [
            ['inert_auth_users', '2'],
            ['inert_auth_sessions', '0'],
            ['inert_auth_refresh_tokens', '0'],
            ['inert_profiles', '0'],
            ['inert_profiles_private', '0'],
            ['inert_legacy_jobs_absent', 'true'],
            ['inert_public_fixture_rows', '0'],
            ['inert_packages_clean', 'true'],
        ] as const) {
            if (facts.get(key) !== expected) {
                errors.push(`${key}: expected ${expected}, observed ${facts.get(key) ?? '<missing>'}.`);
            }
        }
    }
    return errors;
}

export function validateVerificationFacts(
    facts: Map<string, string>,
    expected: Map<string, string>,
): string[] {
    const errors: string[] = [];
    for (const [key, expectedValue] of expected) {
        const observed = facts.get(key);
        if (observed !== expectedValue) errors.push(`${key}: expected ${expectedValue}, observed ${observed ?? '<missing>'}.`);
    }
    return errors;
}

export function buildProductionRolloutApproval(scope: {
    scopeSha256: string;
    allowlistSha256: string;
    through: ProductionRolloutWaveId;
    preflightSha256: string;
    backupReceiptSha256: string | null;
    cleanupEvidenceSha256: string | null;
    authPolicyEvidenceSha256: string | null;
    stagingEvidenceSha256: string | null;
    googleFixturePolicySha256: string | null;
    sentryHardeningEvidenceSha256: string | null;
    pendingMigrations: readonly ProductionRolloutMigration[];
    waveSqlSha256: Record<string, string>;
    livePreflightSqlSha256: string;
    waveVerifySqlSha256: Record<string, string>;
    finalVerifySqlSha256: string;
}): string {
    const requiredHashes = [
        scope.scopeSha256,
        scope.allowlistSha256,
        scope.preflightSha256,
        scope.livePreflightSqlSha256,
        scope.finalVerifySqlSha256,
        ...scope.pendingMigrations.map((entry) => entry.sha256),
        ...Object.values(scope.waveSqlSha256),
        ...Object.values(scope.waveVerifySqlSha256),
    ];
    const optionalHashes = [
        scope.backupReceiptSha256,
        scope.cleanupEvidenceSha256,
        scope.authPolicyEvidenceSha256,
        scope.stagingEvidenceSha256,
        scope.googleFixturePolicySha256,
        scope.sentryHardeningEvidenceSha256,
    ].filter((value): value is string => value !== null);
    if ([...requiredHashes, ...optionalHashes].some((value) => !/^[a-f0-9]{64}$/u.test(value))) {
        throw new Error('Production rollout approval contains a non-SHA-256 binding.');
    }
    const migrationScope = scope.pendingMigrations
        .map((entry) => `${entry.version}@${entry.sha256}`)
        .join(',') || '<verify-only>';
    const waveSqlScope = Object.entries(scope.waveSqlSha256)
        .map(([wave, hash]) => `${wave}@${hash}`)
        .join(',') || '<none>';
    const waveVerifyScope = Object.entries(scope.waveVerifySqlSha256)
        .map(([wave, hash]) => `${wave}@${hash}`)
        .join(',') || '<none>';
    return [
        'AUTORIZO EL ROLLOUT EXACTO DE SUPABASE PRODUCCION POR OLAS',
        `target=${PRODUCTION_PROJECT.ref}`,
        `through=${scope.through}`,
        `scope=${scope.scopeSha256}`,
        `allowlist=${scope.allowlistSha256}`,
        `preflight=${scope.preflightSha256}`,
        `backup=${scope.backupReceiptSha256 ?? '<not-required>'}`,
        `cleanup=${scope.cleanupEvidenceSha256 ?? '<not-required>'}`,
        `auth_policy=${scope.authPolicyEvidenceSha256 ?? '<not-required>'}`,
        `staging_hardening=${scope.stagingEvidenceSha256 ?? '<not-required>'}`,
        `google_fixture_policy=${scope.googleFixturePolicySha256 ?? '<not-required>'}`,
        `sentry_hardening=${scope.sentryHardeningEvidenceSha256 ?? '<not-required>'}`,
        `migrations=${migrationScope}`,
        `wave_sql=${waveSqlScope}`,
        `live_preflight_sql=${scope.livePreflightSqlSha256}`,
        `wave_verify_sql=${waveVerifyScope}`,
        `final_verify_sql=${scope.finalVerifySqlSha256}`,
        `exclude=${STAGING_ONLY_VERSION}`,
        'checkout=DISABLED',
        'db_push=FORBIDDEN',
        'migration_repair=FORBIDDEN',
        'automatic_down_or_restore=FORBIDDEN',
        'verify_read_only_after_each_wave=true',
    ].join(' | ');
}

function waveVerificationFacts(wave: ProductionRolloutWaveId): Array<{ key: string; expected: string; sql: string }> {
    switch (wave) {
        case 'processed_at_small_fix':
            return [fact('processed_at_default_absent', 'true', `(
                SELECT column_default IS NULL
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='processed_webhook_events' AND column_name='processed_at'
            )`)];
        case 'base_model_reconciliation':
            return [
                fact('model_leads_updated_at_contract', 'true', `(SELECT EXISTS(
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='leads' AND column_name='updated_at'
                      AND data_type='timestamp with time zone' AND column_default ILIKE '%now()%'
                ))`),
                fact('model_leads_status_contract', 'true', `(
                    EXISTS(
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='leads' AND column_name='status'
                          AND udt_schema='public' AND udt_name='lead_status' AND column_default ILIKE '%new%'
                          AND is_nullable='NO'
                    ) AND (
                        SELECT string_agg(enum_value.enumlabel, ',' ORDER BY enum_value.enumsortorder) = 'new,contacted,discarded'
                        FROM pg_enum enum_value
                        WHERE enum_value.enumtypid=to_regtype('public.lead_status')
                    )
                )`),
                fact('model_leads_defaults_contract', 'true', `((
                    SELECT count(*)=3 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='leads' AND (
                        (column_name='lang' AND column_default='''es''::text')
                        OR (column_name='consent_given' AND column_default='false')
                        OR (column_name='created_at' AND is_nullable='NO'
                            AND column_default='timezone(''utc''::text, now())')
                    )
                ))`),
                fact('model_leads_acl_valid', 'true', `(
                    NOT EXISTS(
                        SELECT 1 FROM information_schema.table_privileges
                        WHERE table_schema='public' AND table_name='leads'
                          AND grantee IN ('PUBLIC','anon')
                          AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
                    )
                    AND (SELECT count(DISTINCT privilege_type)=4 FROM information_schema.table_privileges
                         WHERE table_schema='public' AND table_name='leads' AND grantee='authenticated'
                           AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
                    AND (SELECT count(DISTINCT privilege_type)=4 FROM information_schema.table_privileges
                         WHERE table_schema='public' AND table_name='leads' AND grantee='service_role'
                           AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
                )`),
                fact('model_public_is_admin_absent', 'true', `(to_regprocedure('public.is_admin()') IS NULL)`),
                fact('model_legacy_session_columns_absent', 'true', `((
                    SELECT count(*)=0 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='sessions'
                      AND column_name IN ('drive_doc_link','google_calendar_event_id','google_meet_link')
                ))`),
                fact('model_sessions_reminder_contract', 'true', `(
                    EXISTS(
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='sessions' AND column_name='reminder_sent'
                          AND data_type='boolean' AND is_nullable='NO' AND column_default='false'
                    )
                    AND NOT EXISTS(SELECT 1 FROM public.sessions WHERE reminder_sent IS NULL)
                    AND to_regclass('public.idx_sessions_reminder_pending') IS NOT NULL
                )`),
                fact('model_student_teacher_profile_policy', 'true', `(SELECT EXISTS(
                    SELECT 1 FROM pg_policies
                    WHERE schemaname='public' AND tablename='profiles'
                      AND policyname='Students can view their teachers'
                      AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[]
                      AND qual ILIKE '%student_teachers%' AND qual ILIKE '%auth.uid()%'
                ))`),
                fact('model_authenticated_identity_policies', '13', `(SELECT count(*)
                    FROM pg_policies
                    WHERE schemaname='public'
                      AND policyname IN (
                          'Students can view their teachers',
                          'Students can view own payments',
                          'Teachers can view their students',
                          'Users can update own profile',
                          'Users can view own profile',
                          'Students can view own sessions',
                          'Teachers can view assigned sessions',
                          'Students can see their teachers',
                          'Teachers can see their students',
                          'Students can view own subscriptions',
                          'Teachers can view assigned student subscriptions',
                          'Students can view assigned teacher availability',
                          'Teachers can manage own availability'
                      )
                      AND roles=ARRAY['authenticated']::name[]
                      AND qual ILIKE '%select auth.uid()%'
                )`),
                fact('model_reconciliation_indexes', '2', `(SELECT count(*) FROM (VALUES
                    (to_regclass('public.idx_profiles_role')),
                    (to_regclass('public.idx_sessions_reminder_pending'))
                ) required(index_oid) WHERE index_oid IS NOT NULL)`),
            ];
        case 'application_schema':
            return [
                fact('application_crm_tables', '5', `(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('crm_contacts','crm_opportunities','crm_tasks','crm_activities','crm_consents'))`),
                fact('application_crm_rls', '5', `(SELECT count(*) FROM pg_class WHERE oid IN ('public.crm_contacts'::regclass,'public.crm_opportunities'::regclass,'public.crm_tasks'::regclass,'public.crm_activities'::regclass,'public.crm_consents'::regclass) AND relrowsecurity)`),
                fact('application_lead_columns', '17', `(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('current_level','learning_goal','availability','source_path','preferred_package','spoken_languages','is_russian_speaker','level_check_status','level_check_context','level_check_summary','level_check_estimated_level','level_check_confidence','level_check_plan_recommendation','level_check_fit_flags','level_check_received_at','level_check_reviewed_at','level_check_raw_cleared_at'))`),
                fact('application_role_trigger_count', '6', `(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('enforce_student_teacher_profile_roles','enforce_session_profile_roles','enforce_subscription_student_role','enforce_payment_student_role','enforce_fulfillment_job_student_role','enforce_teacher_availability_teacher_role'))`),
            ];
        case 'runtime_and_policy':
            return [
                fact('runtime_email_budget_table_rls', 'true', `(SELECT relrowsecurity FROM pg_class WHERE oid='public.email_recipient_budget_usage'::regclass)`),
                fact('runtime_lead_adult_columns', '3', `(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name IN ('adult_confirmed','adult_confirmed_at','age_policy_version'))`),
                fact('runtime_profile_adult_columns', '3', `(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name IN ('adult_confirmed','adult_confirmed_at','age_policy_version'))`),
                fact('runtime_payment_refund_columns', '3', `(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='payments' AND column_name IN ('amount_refunded','stripe_refund_id','refunded_at'))`),
                fact('runtime_required_functions', '4', `(SELECT count(*) FROM (VALUES (to_regprocedure('public.reserve_email_recipient_budget(text,integer,integer,integer,text)')),(to_regprocedure('public.get_available_slots(uuid,date,integer)')),(to_regprocedure('public.cancel_scheduled_session(uuid,uuid,text,text)')),(to_regprocedure('public.handle_new_user()'))) AS functions(oid) WHERE oid IS NOT NULL)`),
            ];
        case 'billing_contract':
            return [
                fact('billing_tables', '2', `(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('package_prices','checkout_intents'))`),
                fact('billing_tables_rls', '2', `(SELECT count(*) FROM pg_class WHERE oid IN ('public.package_prices'::regclass,'public.checkout_intents'::regclass) AND relrowsecurity)`),
                fact('billing_subscription_contract_columns', '2', `(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='subscriptions' AND column_name IN ('package_price_id','contracted_sessions_per_period'))`),
                fact('billing_fixture_rows_absent', 'true', `((SELECT count(*)=0 FROM public.subscriptions) AND (SELECT count(*)=0 FROM public.package_prices) AND (SELECT count(*)=0 FROM public.checkout_intents))`),
                fact('billing_canonical_packages_clean', 'true', `((SELECT count(*)=4 FROM public.packages WHERE name IN ('group','standard','hybrid','bootcamp') AND stripe_product_id IS NULL AND stripe_price_1m IS NULL AND stripe_price_3m IS NULL AND stripe_price_6m IS NULL) AND NOT EXISTS (SELECT 1 FROM public.packages WHERE name='essential'))`),
                fact('billing_required_functions', '7', `(SELECT count(*) FROM (VALUES (to_regprocedure('public.apply_subscription_renewal(uuid,text,text,date)')),(to_regprocedure('public.reconcile_stripe_refund(uuid,integer,text,timestamptz)')),(to_regprocedure('public.claim_checkout_intent(uuid,uuid,uuid,uuid,text,text,text)')),(to_regprocedure('public.snapshot_checkout_intent_customer(uuid,text)')),(to_regprocedure('public.release_abandoned_checkout_intent(uuid,text)')),(to_regprocedure('public.complete_checkout_intent(uuid,uuid,uuid,uuid,text,text)')),(to_regprocedure('public.activate_package_price(uuid,bigint,smallint,integer,text,text,boolean,text,text,uuid)'))) AS functions(oid) WHERE oid IS NOT NULL)`),
            ];
        case 'fulfillment_ledger':
            return [
                fact('fulfillment_effects_table_rls', 'true', `(SELECT relrowsecurity FROM pg_class WHERE oid='public.fulfillment_effects'::regclass)`),
                fact('fulfillment_effects_empty', '0', `(SELECT count(*) FROM public.fulfillment_effects)`),
                fact('fulfillment_effect_functions', '2', `(SELECT count(*) FROM (VALUES (to_regprocedure('public.claim_fulfillment_effect(uuid,text,text,text,text,integer)')),(to_regprocedure('public.finalize_fulfillment_effect(uuid,text,bigint,text,text,jsonb,jsonb)'))) AS functions(oid) WHERE oid IS NOT NULL)`),
            ];
        case 'deferred_rc_hardening':
            return [
                fact('hardening_session_duration_contract', 'true', `(
                    EXISTS(
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='sessions' AND column_name='duration_minutes'
                          AND is_nullable='NO' AND column_default='50'
                    )
                    AND EXISTS(
                        SELECT 1 FROM pg_constraint
                        WHERE conrelid='public.sessions'::regclass
                          AND conname='sessions_duration_minutes_supported'
                          AND contype='c'
                          AND pg_get_constraintdef(oid) ILIKE '%duration_minutes%30%40%50%'
                    )
                    AND NOT EXISTS(
                        SELECT 1 FROM public.sessions
                        WHERE duration_minutes IS NULL OR duration_minutes NOT IN (30,40,50)
                    )
                )`),
                fact('hardening_session_status_contract', 'true', `(
                    EXISTS(
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema='public' AND table_name='sessions' AND column_name='status'
                          AND data_type='text' AND is_nullable='NO'
                          AND column_default='''scheduled''::text'
                    )
                    AND EXISTS(
                        SELECT 1 FROM pg_constraint
                        WHERE conrelid='public.sessions'::regclass
                          AND conname='sessions_status_check'
                          AND contype='c'
                          AND pg_get_constraintdef(oid) ILIKE '%scheduled%'
                          AND pg_get_constraintdef(oid) ILIKE '%completed%'
                          AND pg_get_constraintdef(oid) ILIKE '%cancelled%'
                          AND pg_get_constraintdef(oid) ILIKE '%no_show%'
                    )
                    AND NOT EXISTS(
                        SELECT 1 FROM public.sessions
                        WHERE status IS NULL OR status NOT IN ('scheduled','completed','cancelled','no_show')
                    )
                )`),
                fact('hardening_overlap_constraint', 'true', `(SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.teacher_availability'::regclass AND conname='teacher_availability_no_active_overlap' AND contype='x'))`),
                fact('hardening_btree_gist_schema', 'public', `(SELECT namespace.nspname
                    FROM pg_extension extension
                    JOIN pg_namespace namespace ON namespace.oid=extension.extnamespace
                    WHERE extension.extname='btree_gist'
                )`),
                fact('hardening_legacy_unique_absent', 'true', `(SELECT NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.teacher_availability'::regclass AND conname='teacher_availability_teacher_id_day_of_week_start_time_key'))`),
                fact('hardening_availability_updated_at_trigger', 'true', `(SELECT EXISTS(
                    SELECT 1 FROM pg_trigger trigger_row
                    WHERE trigger_row.tgname='update_teacher_availability_updated_at'
                      AND trigger_row.tgrelid='public.teacher_availability'::regclass
                      AND trigger_row.tgfoid=to_regprocedure('public.update_updated_at()')
                      AND NOT trigger_row.tgisinternal
                      AND (trigger_row.tgtype & 1)=1
                      AND (trigger_row.tgtype & 2)=2
                      AND (trigger_row.tgtype & 16)=16
                      AND (trigger_row.tgtype & 108)=0
                ))`),
                fact('hardening_required_indexes', '13', `(SELECT count(*) FROM (VALUES
                    (to_regclass('public.idx_teacher_availability_teacher')),
                    (to_regclass('public.idx_teacher_availability_day')),
                    (to_regclass('public.idx_sessions_status')),
                    (to_regclass('public.payments_stripe_payment_intent_idx')),
                    (to_regclass('public.checkout_intents_contact_idx')),
                    (to_regclass('public.idx_fulfillment_jobs_student')),
                    (to_regclass('public.idx_fulfillment_jobs_subscription')),
                    (to_regclass('public.package_prices_created_by_idx')),
                    (to_regclass('public.payments_subscription_idx')),
                    (to_regclass('public.sessions_cancelled_by_idx')),
                    (to_regclass('public.sessions_subscription_idx')),
                    (to_regclass('public.student_teachers_teacher_idx')),
                    (to_regclass('public.subscriptions_package_idx'))
                ) required(index_oid) WHERE index_oid IS NOT NULL)`),
                fact('hardening_handle_new_user_policy', 'true', `(SELECT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.handle_new_user()') AND pg_get_functiondef(oid) LIKE '%2026-07-10%' AND pg_get_functiondef(oid) LIKE '%v_requested_age_policy_version = v_current_age_policy_version%'))`),
                fact('hardening_data_api_grants_exact', 'true', `(
                    (SELECT count(*)=1 FROM (
                        SELECT DISTINCT table_name, privilege_type
                        FROM information_schema.table_privileges
                        WHERE table_schema='public' AND grantee='anon'
                    ) grants)
                    AND (SELECT count(*)=63 FROM (
                        SELECT DISTINCT table_name, privilege_type
                        FROM information_schema.table_privileges
                        WHERE table_schema='public' AND grantee='authenticated'
                    ) grants)
                    AND NOT EXISTS(
                        SELECT 1
                        FROM (
                            SELECT DISTINCT grantee, table_name, privilege_type
                            FROM information_schema.table_privileges
                            WHERE table_schema='public'
                              AND grantee IN ('PUBLIC','anon','authenticated')
                        ) grants
                        WHERE NOT (
                            (grantee='anon' AND table_name='packages' AND privilege_type='SELECT')
                            OR (grantee='authenticated' AND table_name IN (
                                'leads','crm_contacts','crm_opportunities','crm_tasks','crm_activities',
                                'crm_consents','fulfillment_jobs','packages','payments','profiles',
                                'profiles_private','sessions','student_teachers','subscriptions','teacher_availability'
                            ) AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
                            OR (grantee='authenticated' AND table_name IN (
                                'admin_audit_log','processed_webhook_events'
                            ) AND privilege_type='SELECT')
                            OR (grantee='authenticated' AND table_name='support_tickets' AND privilege_type='INSERT')
                        )
                    )
                    AND (SELECT count(*)=18
                        FROM pg_class table_row
                        JOIN pg_namespace namespace ON namespace.oid=table_row.relnamespace
                        WHERE namespace.nspname='public'
                          AND table_row.relkind IN ('r','p')
                          AND table_row.relrowsecurity
                          AND table_row.relname IN (
                              'admin_audit_log','crm_activities','crm_consents','crm_contacts',
                              'crm_opportunities','crm_tasks','fulfillment_jobs','leads','packages',
                              'payments','processed_webhook_events','profiles','profiles_private',
                              'sessions','student_teachers','subscriptions','support_tickets',
                              'teacher_availability'
                          )
                    )
                    AND NOT EXISTS(
                        SELECT 1
                        FROM (
                            SELECT DISTINCT table_name
                            FROM information_schema.table_privileges
                            WHERE table_schema='public' AND grantee IN ('anon','authenticated')
                        ) granted_tables
                        JOIN pg_class table_row
                          ON table_row.oid=to_regclass(format('public.%I', granted_tables.table_name))
                        WHERE NOT table_row.relrowsecurity
                    )
                    AND NOT EXISTS(
                        SELECT 1
                        FROM pg_default_acl defaults
                        JOIN pg_roles owner_role ON owner_role.oid=defaults.defaclrole
                        LEFT JOIN pg_namespace namespace ON namespace.oid=defaults.defaclnamespace
                        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
                        WHERE owner_role.rolname='postgres'
                          AND (defaults.defaclnamespace=0 OR namespace.nspname='public')
                          AND defaults.defaclobjtype='r'
                          AND (acl.grantee=0 OR pg_get_userbyid(acl.grantee) IN ('anon','authenticated'))
                    )
                )`),
            ];
    }
}

function fact(key: string, expected: string, expression: string): { key: string; expected: string; sql: string } {
    return { key, expected, sql: `SELECT '${key}', (${expression})::text;` };
}

function readJsonEvidence<T>(evidencePath: string | null): EvidenceValidation<T> {
    if (!evidencePath) return { provided: false, valid: false, path: null, sha256: null, value: null, errors: ['not provided'] };
    const absolutePath = path.resolve(evidencePath);
    if (!existsSync(absolutePath)) return { provided: true, valid: false, path: absolutePath, sha256: null, value: null, errors: ['file does not exist'] };
    try {
        const raw = readFileSync(absolutePath);
        return {
            provided: true,
            valid: true,
            path: absolutePath,
            sha256: sha256(raw),
            value: JSON.parse(raw.toString('utf8')) as T,
            errors: [],
        };
    } catch {
        return { provided: true, valid: false, path: absolutePath, sha256: null, value: null, errors: ['invalid JSON evidence'] };
    }
}

function requireFreshTimestamp(
    raw: string | undefined,
    now: Date,
    maxAgeMs: number,
    label: string,
    errors: string[],
): void {
    const timestamp = typeof raw === 'string' ? Date.parse(raw) : Number.NaN;
    const age = now.getTime() - timestamp;
    if (!Number.isFinite(timestamp)) errors.push(`${label} timestamp is invalid.`);
    else if (age < -5 * 60 * 1_000) errors.push(`${label} timestamp is in the future.`);
    else if (age > maxAgeMs) errors.push(`${label} evidence is stale.`);
}

function validateWavePrefix(states: WaveHistoryState[], errors: string[]): void {
    let pendingObserved = false;
    for (const state of states) {
        if (state.state === 'partial_or_ambiguous') errors.push(`Wave ${state.id} is partially applied or ambiguous.`);
        if (state.state === 'pending') pendingObserved = true;
        if (state.state === 'complete' && pendingObserved) errors.push(`Wave ${state.id} is complete after an earlier pending wave.`);
    }
}

function sqlLiteral(value: string): string {
    return value.replace(/'/gu, "''");
}
