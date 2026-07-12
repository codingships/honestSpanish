import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    KNOWN_MIGRATION_WAVES,
    PROCESSED_AT_VERSION,
    PRODUCTION_PROJECT,
    STAGING_ONLY_VERSION,
    collectLocalMigrations,
    sha256,
    stableJson,
    toPosix,
    type MigrationHistoryMapping,
} from './supabase-production-rollout-shared';
import {
    assessBillingPackagePriceLinks,
    assessProcessedAtPosture,
} from './supabase-production-rollout-evidence';
import {
    STAGING_HARDENING_CONNECTOR_QUERY_PATH,
    readStagingHardeningEvidence as readStrictStagingHardeningEvidence,
    type StagingHardeningEvidence,
} from './supabase-production-rollout-runner-shared';

type GateStatus = 'ready' | 'blocked' | 'already_closed';

interface PreflightReport {
    schemaVersion: number;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    target: typeof PRODUCTION_PROJECT;
    migrationInventory: {
        localMigrations: MigrationHistoryMapping[];
        canonicalVersionMissingCount: number;
        semanticAliasCount: number;
        semanticMissingCountExcludingStagingOnly: number;
        ambiguousCount: number;
        versionNameMismatchCount: number;
        duplicateSemanticHistoryCount: number;
    };
    aggregates: Record<string, unknown>;
    safety: {
        noExternalWrite: boolean;
        noPrivateRowsSelected: boolean;
        noSecretsStored: boolean;
    };
}

interface BackupReceipt {
    schemaVersion: number;
    targetProjectRef: string;
    createdAt: string;
    method: 'logical_dump' | 'dashboard_backup' | 'pitr';
    backupCompleted: boolean;
    artifactStoredOutsideRepository: boolean;
    verification: 'dump_hash_recorded' | 'restore_tested' | 'dashboard_restore_point_confirmed';
    limitationsAcknowledged: string[];
}

interface PreservationPolicy {
    schemaVersion: number;
    targetProjectRef: string;
    aggregateSnapshotSha256: string;
    approvedAt: string;
    decisions: Record<string, string>;
}

interface InputGate<T> {
    provided: boolean;
    valid: boolean;
    label: string | null;
    value: T | null;
    errors: string[];
}

const args = parseArgs(process.argv.slice(2));
const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-supabase-production-rollout-plan',
    stamp(startedAt),
);
mkdirSync(outputDir, { recursive: true });

const preflightPath = args.preflight ?? latestPreflightPath();
if (!preflightPath || !existsSync(preflightPath)) {
    throw new Error('No production Supabase read-only preflight is available. Run pnpm launch:supabase-production-readonly-preflight first.');
}

const preflightRaw = readFileSync(preflightPath, 'utf8');
const preflight = JSON.parse(preflightRaw) as PreflightReport;
validatePreflightShape(preflight);

const localMigrations = collectLocalMigrations();
const preflightByVersion = new Map(preflight.migrationInventory.localMigrations.map((migration) => [migration.version, migration]));
const hashDrift = localMigrations
    .filter((migration) => preflightByVersion.get(migration.version)?.sha256 !== migration.sha256)
    .map((migration) => migration.version);
const localAddedAfterPreflight = localMigrations
    .filter((migration) => !preflightByVersion.has(migration.version))
    .map((migration) => migration.version);

const fixtureCounts = asRecord(preflight.aggregates.fixture_counts);
const fixtureDistributions = asRecord(preflight.aggregates.fixture_distributions);
const billingHazard = asRecord(preflight.aggregates.billing_legacy_hazard);
const packagePriceLinks = asRecord(preflight.aggregates.billing_package_price_links);
const processedAtPostureAssessment = assessProcessedAtPosture(preflight.aggregates.processed_at_posture);
const packagePriceLinksAssessment = assessBillingPackagePriceLinks(
    preflight.aggregates.billing_package_price_links,
    {
        total_subscriptions: fixtureCounts.subscriptions,
        stripe_linked: billingHazard.stripe_linked,
    },
);
const baselineHistoryEffects = asRecord(preflight.aggregates.baseline_history_effects);
const baselineEffectsVerified = Object.keys(baselineHistoryEffects).length > 0
    && Object.values(baselineHistoryEffects).every((present) => present === true);
const aggregateSnapshot = {
    fixtureCounts,
    fixtureDistributions,
    billingHazard,
    packagePriceLinks,
};
const aggregateSnapshotSha256 = sha256(stableJson(aggregateSnapshot));

const backupReceipt = readBackupReceipt(args.backupEvidenceReceipt);
const preservationPolicy = readPreservationPolicy(
    args.preservationPolicy,
    aggregateSnapshotSha256,
    Object.keys(fixtureCounts),
);
const stagingHardeningEvidence = readStagingHardeningEvidenceForPlan(args.stagingHardeningEvidence);

const preflightAgeHours = (startedAt.getTime() - new Date(preflight.endedAt).getTime()) / 3_600_000;
const preflightFresh = Number.isFinite(preflightAgeHours) && preflightAgeHours >= 0 && preflightAgeHours <= 24;
const preflightSafe = preflight.status !== 'FAILED'
    && preflight.target.ref === PRODUCTION_PROJECT.ref
    && preflight.safety.noExternalWrite
    && preflight.safety.noPrivateRowsSelected
    && preflight.safety.noSecretsStored
    && preflight.migrationInventory.ambiguousCount === 0;
const localInventoryStable = hashDrift.length === 0 && localAddedAfterPreflight.length === 0;

const migrationMap = new Map(preflight.migrationInventory.localMigrations.map((migration) => [migration.version, migration]));
const stagingOnlyMigration = migrationMap.get(STAGING_ONLY_VERSION);
const stagingOnlyExcluded = stagingOnlyMigration?.historyStatus === 'missing';
const processedMigration = migrationMap.get(PROCESSED_AT_VERSION);
const processedAlreadyClosed = preflightSafe
    && preflightFresh
    && localInventoryStable
    && stagingOnlyExcluded
    && (processedMigration?.historyStatus === 'exact' || processedMigration?.historyStatus === 'alias')
    && processedAtPostureAssessment.alreadyClosed;
const processedReady = preflightSafe
    && preflightFresh
    && localInventoryStable
    && stagingOnlyExcluded
    && processedMigration?.historyStatus === 'missing'
    && processedAtPostureAssessment.readyForFix;

const processedGate: GateStatus = processedAlreadyClosed
    ? 'already_closed'
    : processedReady ? 'ready' : 'blocked';

const stripeLinkedWithoutPackagePrice = packagePriceLinksAssessment.stripeLinkedWithoutPackagePrice;
const cleanupGate: GateStatus = backupReceipt.valid && preservationPolicy.valid
    ? 'ready'
    : 'blocked';
const billingDataReady = packagePriceLinksAssessment.ready;
const baseModelReconciliationPresent = waveIsPresent('base_model_reconciliation');
const applicationSchemaPresent = waveIsPresent('application_schema');
const runtimeAndPolicyPresent = waveIsPresent('runtime_and_policy');

const waves = KNOWN_MIGRATION_WAVES.map((wave) => {
    const migrations = wave.versions.map((version) => migrationMap.get(version)).filter(isDefined);
    const pending = migrations.filter((migration) => migration.historyStatus === 'missing');
    const alreadyPresent = migrations.filter((migration) => migration.historyStatus === 'exact' || migration.historyStatus === 'alias');
    const ambiguous = migrations.filter((migration) => migration.historyStatus === 'ambiguous');
    const missingLocalVersion = wave.versions.filter((version) => !migrationMap.has(version));
    const prerequisites: string[] = ['fresh production read-only preflight', 'checkout remains disabled'];
    if (wave.requiresBackupEvidence) prerequisites.push('valid backup evidence receipt');
    if (wave.requiresPreservationPolicy) prerequisites.push('valid explicit fixture preservation policy');
    if (wave.id !== 'processed_at_small_fix') {
        prerequisites.push('processed_at small fix verified or already closed');
        prerequisites.push('baseline alias/version-name schema effects verified read-only');
    }
    if (wave.id === 'base_model_reconciliation') {
        prerequisites.push('exact model reconciliation migration applied and verified in staging first');
    }
    if (['application_schema', 'runtime_and_policy', 'billing_contract', 'fulfillment_ledger', 'deferred_rc_hardening'].includes(wave.id)) {
        prerequisites.push('base_model_reconciliation wave verified or already closed');
    }
    if (['runtime_and_policy', 'billing_contract', 'fulfillment_ledger', 'deferred_rc_hardening'].includes(wave.id)) {
        prerequisites.push('application_schema wave verified or already closed');
    }
    if (wave.id === 'billing_contract') prerequisites.push('runtime_and_policy wave verified or already closed');
    if (wave.id === 'deferred_rc_hardening') {
        prerequisites.push('runtime_and_policy wave verified or already closed');
        prerequisites.push('exact migrations applied and availability/signup tests passed in staging first');
    }
    if (wave.id === 'billing_contract') prerequisites.push('zero Stripe-linked subscriptions without package_price_id');

    const ready = preflightSafe
        && preflightFresh
        && localInventoryStable
        && stagingOnlyExcluded
        && ambiguous.length === 0
        && missingLocalVersion.length === 0
        && (!wave.requiresBackupEvidence || backupReceipt.valid)
        && (!wave.requiresPreservationPolicy || preservationPolicy.valid)
        && (wave.id !== 'processed_at_small_fix' || processedReady || processedAlreadyClosed)
        && (wave.id === 'processed_at_small_fix' || processedAlreadyClosed)
        && (wave.id === 'processed_at_small_fix' || baselineEffectsVerified)
        && (wave.id !== 'base_model_reconciliation' || stagingHardeningEvidence.valid)
        && (!['application_schema', 'runtime_and_policy', 'billing_contract', 'fulfillment_ledger', 'deferred_rc_hardening'].includes(wave.id) || baseModelReconciliationPresent)
        && (!['runtime_and_policy', 'billing_contract', 'fulfillment_ledger', 'deferred_rc_hardening'].includes(wave.id) || applicationSchemaPresent)
        && (wave.id !== 'billing_contract' || runtimeAndPolicyPresent)
        && (wave.id !== 'deferred_rc_hardening' || (runtimeAndPolicyPresent && stagingHardeningEvidence.valid))
        && (wave.id !== 'billing_contract' || billingDataReady);

    const gateStatus: GateStatus = pending.length === 0
        ? 'already_closed'
        : ready ? 'ready' : 'blocked';

    return {
        id: wave.id,
        label: wave.label,
        destructive: wave.destructive,
        requiresBackupEvidence: wave.requiresBackupEvidence,
        requiresPreservationPolicy: wave.requiresPreservationPolicy,
        gateStatus,
        prerequisites,
        pending,
        alreadyPresent,
        ambiguous,
        missingLocalVersion,
    };
});

const knownVersions = new Set([
    ...KNOWN_MIGRATION_WAVES.flatMap((wave) => [...wave.versions]),
    STAGING_ONLY_VERSION,
]);
const unplannedSemanticMissing = preflight.migrationInventory.localMigrations.filter((migration) => (
    migration.historyStatus === 'missing'
    && !knownVersions.has(migration.version)
    && !migration.stagingOnly
));

const approvalScope = {
    target: PRODUCTION_PROJECT,
    preflight: {
        path: toPosix(path.relative(process.cwd(), preflightPath)),
        sha256: sha256(preflightRaw),
        endedAt: preflight.endedAt,
    },
    aggregateSnapshotSha256,
    baselineHistoryEffects,
    migrationInventory: preflight.migrationInventory.localMigrations.map((migration) => ({
        order: migration.order,
        version: migration.version,
        name: migration.name,
        sha256: migration.sha256,
        historyStatus: migration.historyStatus,
        remoteVersions: migration.remoteVersions,
        stagingOnly: migration.stagingOnly,
        plannedWave: migration.plannedWave,
        versionNameMismatch: migration.versionNameMismatch,
        duplicateSemanticHistory: migration.duplicateSemanticHistory,
    })),
    exclusions: {
        stagingOnlyMigration: STAGING_ONLY_VERSION,
        blanketDbPush: true,
        migrationRepair: true,
        privateDataExportIntoRepository: true,
    },
};
const approvalScopeSha256 = sha256(stableJson(approvalScope));

const artifacts = {
    manifest: path.join(outputDir, 'production-supabase-rollout-manifest.json'),
    summaryJson: path.join(outputDir, 'summary.json'),
    summaryMarkdown: path.join(outputDir, 'summary.md'),
    approvalSentences: path.join(outputDir, 'approval-sentences.md'),
    backupTemplate: path.join(outputDir, 'backup-evidence-receipt.template.json'),
    preservationTemplate: path.join(outputDir, 'fixture-preservation-policy.template.json'),
    stagingHardeningConnectorQuery: path.join(process.cwd(), STAGING_HARDENING_CONNECTOR_QUERY_PATH),
    verificationRollback: path.join(outputDir, 'verification-and-rollback.md'),
    verificationSql: path.join(outputDir, 'production-readonly-verification.sql'),
};

const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status: 'OK' as const,
    closureStatus: 'PLAN_ONLY_READY' as const,
    mode: 'plan_only' as const,
    target: PRODUCTION_PROJECT,
    preflight: {
        path: toPosix(path.relative(process.cwd(), preflightPath)),
        sha256: sha256(preflightRaw),
        endedAt: preflight.endedAt,
        ageHours: Number(preflightAgeHours.toFixed(2)),
        fresh: preflightFresh,
        safe: preflightSafe,
    },
    approvalScopeSha256,
    migrationHistory: {
        canonicalVersionMissingCount: preflight.migrationInventory.canonicalVersionMissingCount,
        semanticAliasCount: preflight.migrationInventory.semanticAliasCount,
        semanticMissingCountExcludingStagingOnly: preflight.migrationInventory.semanticMissingCountExcludingStagingOnly,
        ambiguousCount: preflight.migrationInventory.ambiguousCount,
        versionNameMismatchCount: preflight.migrationInventory.versionNameMismatchCount,
        duplicateSemanticHistoryCount: preflight.migrationInventory.duplicateSemanticHistoryCount,
        baselineEffectsVerified,
        baselineHistoryEffects,
        localInventoryStable,
        hashDrift,
        localAddedAfterPreflight,
        stagingOnlyExcluded,
        mappings: preflight.migrationInventory.localMigrations,
    },
    aggregateSnapshot,
    aggregateSnapshotSha256,
    gates: {
        processedAtSmallFix: {
            status: processedGate,
            version: PROCESSED_AT_VERSION,
            currentDefault: processedAtPostureAssessment.columnDefault,
            evidenceComplete: processedAtPostureAssessment.complete,
            evidenceSummary: processedAtPostureAssessment.summary,
            counts: processedAtPostureAssessment.counts,
            requiresBackupEvidence: false,
            requiresPreservationPolicy: false,
        },
        billingPackagePriceLinks: {
            status: (billingDataReady ? 'ready' : 'blocked') as GateStatus,
            evidenceComplete: packagePriceLinksAssessment.complete,
            evidenceSummary: packagePriceLinksAssessment.summary,
            columnPresent: packagePriceLinksAssessment.columnPresent,
            stripeLinkedWithoutPackagePrice,
            allSubscriptionsWithoutPackagePrice: packagePriceLinksAssessment.allSubscriptionsWithoutPackagePrice,
        },
        destructiveFixtureCleanup: {
            status: cleanupGate,
            backupReceipt,
            preservationPolicy,
            noCleanupSqlGenerated: true,
            stripeLinkedWithoutPackagePrice,
            packageLinkEvidenceComplete: packagePriceLinksAssessment.complete,
        },
        stagingHardeningEvidence,
        migrationWaves: waves,
    },
    unplannedSemanticMissing,
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [
        key,
        toPosix(path.relative(process.cwd(), value)),
    ])),
    safety: {
        externalWritePerformed: false,
        networkAccessPerformed: false,
        cleanupSqlGenerated: false,
        applySqlBundleGenerated: false,
        secretsRead: false,
        secretsStored: false,
        forbiddenCommands: ['supabase db push', 'supabase migration repair'],
        productionExcludedMigration: STAGING_ONLY_VERSION,
    },
};

const manifest = {
    schemaVersion: 1,
    approvalScopeSha256,
    target: report.target,
    preflight: report.preflight,
    migrationHistory: report.migrationHistory,
    aggregateSnapshot: report.aggregateSnapshot,
    aggregateSnapshotSha256,
    gates: report.gates,
    unplannedSemanticMissing,
    safety: report.safety,
};

writeFileSync(artifacts.manifest, stableJson(manifest), 'utf8');
writeFileSync(artifacts.summaryJson, stableJson(report), 'utf8');
writeFileSync(artifacts.summaryMarkdown, renderSummary(report), 'utf8');
writeFileSync(artifacts.approvalSentences, renderApprovalSentences(report), 'utf8');
writeFileSync(artifacts.backupTemplate, stableJson(renderBackupTemplate()), 'utf8');
writeFileSync(artifacts.preservationTemplate, stableJson(renderPreservationTemplate()), 'utf8');
writeFileSync(artifacts.verificationRollback, renderVerificationAndRollback(report), 'utf8');
writeFileSync(artifacts.verificationSql, renderVerificationSql(report), 'utf8');

console.log('[launch:supabase-production-rollout-plan] Status: OK');
console.log('[launch:supabase-production-rollout-plan] Closure: PLAN_ONLY_READY');
console.log(`[launch:supabase-production-rollout-plan] Target: ${PRODUCTION_PROJECT.name} (${PRODUCTION_PROJECT.ref})`);
console.log(`[launch:supabase-production-rollout-plan] Approval scope SHA-256: ${approvalScopeSha256}`);
console.log('[launch:supabase-production-rollout-plan] External write performed: false');
console.log(`[launch:supabase-production-rollout-plan] Summary: ${artifacts.summaryMarkdown}`);
console.log(`[launch:supabase-production-rollout-plan] Manifest: ${artifacts.manifest}`);

function parseArgs(values: string[]): {
    preflight: string | null;
    backupEvidenceReceipt: string | null;
    preservationPolicy: string | null;
    stagingHardeningEvidence: string | null;
} {
    const normalizedValues = values[0] === '--' ? values.slice(1) : values;
    const parsed = {
        preflight: null as string | null,
        backupEvidenceReceipt: null as string | null,
        preservationPolicy: null as string | null,
        stagingHardeningEvidence: null as string | null,
    };
    for (let index = 0; index < normalizedValues.length; index += 1) {
        const value = normalizedValues[index];
        const next = normalizedValues[index + 1];
        if (value === '--preflight' && next) {
            parsed.preflight = path.resolve(next);
            index += 1;
        } else if (value === '--backup-evidence-receipt' && next) {
            parsed.backupEvidenceReceipt = path.resolve(next);
            index += 1;
        } else if (value === '--preservation-policy' && next) {
            parsed.preservationPolicy = path.resolve(next);
            index += 1;
        } else if (value === '--staging-hardening-evidence' && next) {
            parsed.stagingHardeningEvidence = path.resolve(next);
            index += 1;
        } else {
            throw new Error(`Unsupported or incomplete argument: ${value}`);
        }
    }
    return parsed;
}

function latestPreflightPath(): string | null {
    const root = path.join(process.cwd(), 'outputs', 'launch-supabase-production-readonly-preflight');
    if (!existsSync(root)) return null;
    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, 'summary.json'))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();
    return candidates[0] ?? null;
}

function validatePreflightShape(preflight: PreflightReport): void {
    if (preflight.schemaVersion !== 1) throw new Error('Unsupported production preflight schema version.');
    if (preflight.target?.ref !== PRODUCTION_PROJECT.ref) throw new Error('Preflight targets the wrong Supabase project.');
    if (!Array.isArray(preflight.migrationInventory?.localMigrations)) throw new Error('Preflight migration inventory is missing.');
    if (!preflight.aggregates || typeof preflight.aggregates !== 'object') throw new Error('Preflight aggregates are missing.');
}

function readBackupReceipt(receiptPath: string | null): InputGate<BackupReceipt> {
    if (!receiptPath) return { provided: false, valid: false, label: null, value: null, errors: ['not provided'] };
    if (!existsSync(receiptPath)) return { provided: true, valid: false, label: path.basename(receiptPath), value: null, errors: ['file does not exist'] };

    const errors: string[] = [];
    let value: BackupReceipt | null = null;
    try {
        value = JSON.parse(readFileSync(receiptPath, 'utf8')) as BackupReceipt;
        if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
        if (value.targetProjectRef !== PRODUCTION_PROJECT.ref) errors.push('targetProjectRef mismatch');
        if (!value.backupCompleted) errors.push('backupCompleted must be true');
        if (!value.artifactStoredOutsideRepository) errors.push('artifactStoredOutsideRepository must be true');
        if (!['logical_dump', 'dashboard_backup', 'pitr'].includes(value.method)) errors.push('unsupported backup method');
        if (!['dump_hash_recorded', 'restore_tested', 'dashboard_restore_point_confirmed'].includes(value.verification)) errors.push('unsupported verification');
        const ageHours = (Date.now() - new Date(value.createdAt).getTime()) / 3_600_000;
        if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 24) errors.push('backup evidence must be no more than 24 hours old');
        for (const limitation of ['storage_objects_not_included', 'custom_role_passwords_not_included']) {
            if (!value.limitationsAcknowledged?.includes(limitation)) errors.push(`missing limitation acknowledgement: ${limitation}`);
        }
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }

    return {
        provided: true,
        valid: errors.length === 0,
        label: path.basename(receiptPath),
        value,
        errors,
    };
}

function readPreservationPolicy(
    policyPath: string | null,
    expectedSnapshotSha256: string,
    requiredClasses: string[],
): InputGate<PreservationPolicy> {
    if (!policyPath) return { provided: false, valid: false, label: null, value: null, errors: ['not provided'] };
    if (!existsSync(policyPath)) return { provided: true, valid: false, label: path.basename(policyPath), value: null, errors: ['file does not exist'] };

    const errors: string[] = [];
    let value: PreservationPolicy | null = null;
    try {
        value = JSON.parse(readFileSync(policyPath, 'utf8')) as PreservationPolicy;
        if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
        if (value.targetProjectRef !== PRODUCTION_PROJECT.ref) errors.push('targetProjectRef mismatch');
        if (value.aggregateSnapshotSha256 !== expectedSnapshotSha256) errors.push('aggregateSnapshotSha256 mismatch');
        const approvedAt = new Date(value.approvedAt).getTime();
        if (!Number.isFinite(approvedAt)) errors.push('approvedAt must be an ISO timestamp');
        const allowed = new Set(['preserve', 'delete_as_fixture', 'rebuild_from_source', 'not_present', 'cleanup_separately']);
        for (const fixtureClass of [...requiredClasses, 'stripe_external_objects', 'google_external_objects', 'storage_objects']) {
            const decision = value.decisions?.[fixtureClass];
            if (!decision || !allowed.has(decision)) errors.push(`missing or invalid decision for ${fixtureClass}`);
        }
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }

    return {
        provided: true,
        valid: errors.length === 0,
        label: path.basename(policyPath),
        value,
        errors,
    };
}

function readStagingHardeningEvidenceForPlan(
    evidencePath: string | null,
): InputGate<StagingHardeningEvidence> {
    const evidence = readStrictStagingHardeningEvidence(evidencePath, startedAt);
    return {
        provided: evidence.provided,
        valid: evidence.valid,
        label: evidence.path ? path.basename(evidence.path) : null,
        value: evidence.value,
        errors: evidence.errors,
    };
}

function renderBackupTemplate(): BackupReceipt {
    return {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_PROJECT.ref,
        createdAt: '<ISO-8601 after the backup completes>',
        method: 'logical_dump',
        backupCompleted: false,
        artifactStoredOutsideRepository: true,
        verification: 'dump_hash_recorded',
        limitationsAcknowledged: [
            'storage_objects_not_included',
            'custom_role_passwords_not_included',
        ],
    };
}

function renderPreservationTemplate(): PreservationPolicy {
    const decisions = Object.fromEntries([
        ...Object.keys(fixtureCounts),
        'stripe_external_objects',
        'google_external_objects',
        'storage_objects',
    ].map((fixtureClass) => [fixtureClass, 'UNDECIDED']));
    return {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_PROJECT.ref,
        aggregateSnapshotSha256,
        approvedAt: '<ISO-8601 after human review>',
        decisions,
    };
}

function renderSummary(value: typeof report): string {
    const lines = [
        '# Supabase production rollout plan',
        '',
        `- Status: ${value.status}`,
        `- Closure: ${value.closureStatus}`,
        `- Exact target: ${value.target.name} (${value.target.ref}, ${value.target.region})`,
        `- Approval scope SHA-256: ${value.approvalScopeSha256}`,
        `- Read-only preflight: ${value.preflight.path}`,
        `- Preflight fresh: ${value.preflight.fresh} (${value.preflight.ageHours} h)`,
        '- External write performed: false',
        '- Network access performed by this plan runner: false',
        '',
        '## What the history means',
        '',
        `- Canonical versions absent: ${value.migrationHistory.canonicalVersionMissingCount}`,
        `- Semantic aliases: ${value.migrationHistory.semanticAliasCount}`,
        `- Semantically missing, excluding staging-only: ${value.migrationHistory.semanticMissingCountExcludingStagingOnly}`,
        `- Ambiguous mappings: ${value.migrationHistory.ambiguousCount}`,
        `- Version/name mismatches: ${value.migrationHistory.versionNameMismatchCount}`,
        `- Duplicate semantic history entries: ${value.migrationHistory.duplicateSemanticHistoryCount}`,
        `- Baseline schema effects verified read-only: ${value.migrationHistory.baselineEffectsVerified}`,
        '',
        'An alias is evidence to verify, not permission to run or repair history. A canonical version that is absent but whose migration name is present under one remote version must not be reapplied blindly.',
        '',
        '## Separate gates',
        '',
        '| Gate | Status | Backup required | Preservation policy required | Evidence / blocking fact |',
        '| --- | --- | --- | --- | --- |',
        `| processed_at small fix | ${value.gates.processedAtSmallFix.status} | no | no | ${value.gates.processedAtSmallFix.evidenceSummary} |`,
        `| billing package-price links | ${value.gates.billingPackagePriceLinks.status} | no | no | ${value.gates.billingPackagePriceLinks.evidenceSummary} |`,
        `| destructive fixture cleanup | ${value.gates.destructiveFixtureCleanup.status} | yes | yes | backup receipt valid=${value.gates.destructiveFixtureCleanup.backupReceipt.valid}; preservation policy valid=${value.gates.destructiveFixtureCleanup.preservationPolicy.valid} |`,
        ...value.gates.migrationWaves
            .filter((wave) => wave.id !== 'processed_at_small_fix')
            .map((wave) => `| ${wave.id} | ${wave.gateStatus} | ${wave.requiresBackupEvidence ? 'yes' : 'no'} | ${wave.requiresPreservationPolicy ? 'yes' : 'no'} | pending=${wave.pending.length}; already present=${wave.alreadyPresent.length} |`),
        '',
        '## Aggregate fixture snapshot',
        '',
        '```json',
        JSON.stringify(value.aggregateSnapshot, null, 2),
        '```',
        '',
        `Snapshot SHA-256: ${value.aggregateSnapshotSha256}`,
        '',
        '## Exact migration waves',
        '',
        ...value.gates.migrationWaves.flatMap((wave) => [
            `### ${wave.id}: ${wave.label}`,
            '',
            `Gate: ${wave.gateStatus}.`,
            '',
            ...(wave.pending.length > 0 ? wave.pending.map((migration) => `- pending ${migration.order}. ${migration.version}_${migration.name}.sql - SHA-256 ${migration.sha256}`) : ['- No pending migration in this wave.']),
            ...wave.alreadyPresent.map((migration) => `- do not reapply ${migration.version}_${migration.name}.sql - history=${migration.historyStatus}; remote=${migration.remoteVersions.join(',') || migration.version}`),
            '',
        ]),
        '## Unplanned local migrations',
        '',
        ...(value.unplannedSemanticMissing.length > 0
            ? value.unplannedSemanticMissing.map((migration) => `- EXCLUDED pending review: ${migration.version}_${migration.name}.sql - SHA-256 ${migration.sha256}`)
            : ['- None.']),
        '',
        '## Hard stop conditions',
        '',
        '- Never run blanket `supabase db push`.',
        '- Never run `supabase migration repair` to hide alias drift.',
        `- Never apply ${STAGING_ONLY_VERSION}_staging_integration_smoke_runs.sql to production.`,
        '- Never clean fixtures without both a fresh backup evidence receipt and a complete preservation policy bound to the aggregate snapshot hash.',
        '- Treat missing or incomplete processed_at_posture and billing_package_price_links aggregates as hard blockers, never as zero counts.',
        '- Never start the billing wave while any Stripe-linked subscription lacks `package_price_id`.',
        '- Never apply the deferred RC hardening wave to production until both exact migrations pass overlap, availability and signup checks in staging.',
        '- Stop if checkout is enabled, target ref changes, local hashes drift, the preflight is older than 24 hours or verification finds a mismatch.',
        '',
    ];
    return `${lines.join('\n')}\n`;
}

function renderApprovalSentences(value: typeof report): string {
    const processed = value.gates.migrationWaves.find((wave) => wave.id === 'processed_at_small_fix');
    const processedApproval = processed?.gateStatus === 'ready' && processed.pending.length === 1
        ? `Autorizo aplicar unicamente la migracion ${PROCESSED_AT_VERSION}_drop_processed_webhook_processed_at_default.sql, SHA-256 ${processed.pending[0].sha256}, en Supabase production ${PRODUCTION_PROJECT.name} (${PRODUCTION_PROJECT.ref}), con checkout desactivado y alcance ${value.approvalScopeSha256}; despues, autorizo solo la verificacion read-only generada. No autorizo ninguna otra migracion, limpieza de datos, Auth, Storage, Stripe, Cloudflare, supabase db push ni migration repair.`
        : `BLOQUEADO: no existe una autorizacion ejecutable para processed_at mientras su gate sea ${processed?.gateStatus ?? 'missing'}.`;
    const lines = [
        '# Exact Supabase production approval sentences',
        '',
        'Use one sentence at a time. Each sentence authorizes only its named phase; none authorizes production generally.',
        '',
        '## 1. Small processed_at fix',
        '',
        processedApproval,
        '',
        '## 2. Backup capture before any destructive cleanup or migration wave',
        '',
        `Autorizo crear y verificar un backup de Supabase production ${PRODUCTION_PROJECT.name} (${PRODUCTION_PROJECT.ref}) para el alcance ${value.approvalScopeSha256}, guardarlo fuera del repositorio y registrar unicamente el recibo no secreto con sus limitaciones. No autorizo restaurar, limpiar datos ni aplicar migraciones.`,
        '',
        '## 3. Fixture cleanup scope',
        '',
        `Confirmo que el recibo de backup y la politica de preservacion vinculada al snapshot agregado ${value.aggregateSnapshotSha256} han sido revisados. Autorizo preparar un manifiesto SQL transaccional de limpieza limitado exclusivamente a las clases marcadas delete_as_fixture para Supabase production ${PRODUCTION_PROJECT.ref}; esta frase no autoriza ejecutar ese SQL hasta que se presente su hash exacto, su orden de borrado, su dry-run de conteos y una segunda aprobacion literal. No autorizo borrar objetos externos de Stripe, Google o Storage, ni usar db push o migration repair.`,
        '',
        '## 4. Migration waves',
        '',
        ...value.gates.migrationWaves
            .filter((wave) => wave.id !== 'processed_at_small_fix')
            .flatMap((wave) => {
                const exactList = wave.pending.map((migration) => `${migration.version} (SHA-256 ${migration.sha256})`).join(', ') || '<none-pending>';
                return [
                    `### ${wave.id}`,
                    '',
                    `Autorizo aplicar en Supabase production ${PRODUCTION_PROJECT.name} (${PRODUCTION_PROJECT.ref}) unicamente la ola ${wave.id}, en este orden exacto: ${exactList}; alcance ${value.approvalScopeSha256}. La autorizacion solo es valida si todos los prerequisitos del manifiesto estan en ready, checkout sigue desactivado y una verificacion read-only pasa tras cada migracion. Se excluye expresamente ${STAGING_ONLY_VERSION}; no autorizo db push, migration repair, otras migraciones, limpieza, Stripe, Cloudflare, DNS ni dominios.`,
                    '',
                ];
            }),
    ];
    return `${lines.join('\n')}\n`;
}

function renderVerificationAndRollback(value: typeof report): string {
    return `# Supabase production verification and rollback\n\n` +
        `Target: ${value.target.name} (${value.target.ref}). Approval scope: ${value.approvalScopeSha256}.\n\n` +
        `## Before every phase\n\n` +
        `1. Rerun \`pnpm launch:supabase-production-readonly-preflight\`.\n` +
        `2. Rerun \`pnpm launch:supabase-production-rollout-plan\` against that exact summary.\n` +
        `3. Confirm checkout is disabled, the project ref is ${value.target.ref}, hashes are unchanged, aliases are unambiguous and ${STAGING_ONLY_VERSION} is absent.\n` +
        `4. For cleanup or migration waves, confirm a backup receipt no older than 24 hours. For cleanup/billing, also confirm the preservation policy hash.\n\n` +
        `## processed_at small fix\n\n` +
        `- Verify: the migration history/effect is present once; \`processed_at\` has no default; invalid/null processing states remain zero.\n` +
        `- Narrow rollback, only after separate approval: \`ALTER TABLE public.processed_webhook_events ALTER COLUMN processed_at SET DEFAULT now();\`.\n` +
        `- Stop instead of rolling back if webhook processing semantics or rows are unclear.\n\n` +
        `## Fixture cleanup\n\n` +
        `- This plan intentionally generates no DELETE/TRUNCATE SQL. Create a separate transactional cleanup manifest with pre-delete counts, dependency order and post-delete counts.\n` +
        `- Rollback is restore from the verified backup, preferably into a new project for inspection first. Supabase database backups do not restore Storage objects, and custom role passwords may require reset.\n` +
        `- Stripe, Google and Storage objects require separate preservation/cleanup decisions; a database restore cannot recreate deleted external objects.\n\n` +
        `## Migration waves\n\n` +
        `- Apply one exact migration file/hash at a time with a provider mechanism that records one unambiguous history entry. A provider-generated version alias is acceptable only when its normalized name maps to that exact migration and the schema effects pass.\n` +
        `- Do not reapply aliases and do not repair history merely for visual parity.\n` +
        `- Most waves have no safe generic down migration. On failure, stop, keep checkout disabled and choose either a reviewed forward fix or restore from backup.\n` +
        `- After each wave: rerun aggregate counts, RLS/privilege checks, advisors/lint where available, application typecheck/tests and the production-inert health probes.\n`;
}

function renderVerificationSql(value: typeof report): string {
    const expectedMigrations = value.gates.migrationWaves
        .flatMap((wave) => wave.pending)
        .filter((migration) => migration.version !== STAGING_ONLY_VERSION)
        .map((migration) => `('${migration.version.replace(/'/g, "''")}', '${migration.name.replace(/'/g, "''")}')`)
        .join(', ');
    return `-- Read-only verification for Supabase production ${PRODUCTION_PROJECT.ref}.\n` +
        `-- Run with default_transaction_read_only=on. Do not paste private rows into evidence.\n\n` +
        `with expected(canonical_version, canonical_name) as (\n` +
        `    values ${expectedMigrations || "('<none>', '<none>')"}\n` +
        `)\n` +
        `select expected.canonical_version,\n` +
        `       expected.canonical_name,\n` +
        `       coalesce(array_agg(remote.version order by remote.version) filter (where remote.version is not null), '{}') as remote_versions\n` +
        `from expected\n` +
        `left join supabase_migrations.schema_migrations remote\n` +
        `  on remote.version = expected.canonical_version\n` +
        `  or regexp_replace(coalesce(remote.name, ''), '^[0-9]+_', '') = expected.canonical_name\n` +
        `group by expected.canonical_version, expected.canonical_name\n` +
        `order by expected.canonical_version;\n\n` +
        `select column_default\n` +
        `from information_schema.columns\n` +
        `where table_schema = 'public'\n` +
        `  and table_name = 'processed_webhook_events'\n` +
        `  and column_name = 'processed_at';\n\n` +
        `select count(*)::int as total,\n` +
        `       count(*) filter (where processing_status is null)::int as null_status,\n` +
        `       count(*) filter (where processing_status not in ('processing','succeeded','failed'))::int as invalid_status,\n` +
        `       count(*) filter (where processing_status = 'processing' and processed_at is not null)::int as processing_with_processed_at\n` +
        `from public.processed_webhook_events;\n\n` +
        `select to_regclass('public.staging_integration_smoke_runs') as must_remain_null;\n`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

function waveIsPresent(waveId: string): boolean {
    const wave = KNOWN_MIGRATION_WAVES.find((candidate) => candidate.id === waveId);
    if (!wave) return false;
    return wave.versions.every((version) => {
        const migration = migrationMap.get(version);
        return migration?.historyStatus === 'exact' || migration?.historyStatus === 'alias';
    });
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
