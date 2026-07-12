import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_VERSION,
    collectLocalMigrations,
    mapMigrationHistory,
    sha256,
    stableJson,
    toPosix,
    type RemoteMigration,
} from './supabase-production-rollout-shared';
import {
    PRODUCTION_PREFLIGHT_MAX_AGE_MS,
    PRODUCTION_ROLLOUT_MIGRATIONS,
    deriveWaveHistoryStates,
    validateProductionRolloutAllowlist,
    type ProductionPreflightEvidence,
} from './supabase-production-rollout-runner-shared';
import {
    baselineHistoryEffectsAggregateSchema,
    billingLegacyHazardAggregateSchema,
    billingPackagePriceLinksAggregateSchema,
    fixtureDistributionsAggregateSchema,
    processedAtPostureAggregateSchema,
} from './supabase-production-rollout-evidence';

const MAX_SNAPSHOT_BYTES = 1_000_000;
const OUTPUT_FAMILY = 'launch-supabase-production-connector-preflight';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const fixtureCountsSchema = z.strictObject({
    auth_users: count,
    profiles: count,
    packages: count,
    subscriptions: count,
    student_teachers: count,
    sessions: count,
    payments: count,
    leads: count,
    processed_webhook_events: count,
    fulfillment_jobs: count,
    admin_audit_log: count,
    teacher_availability: count,
    legacy_jobs: count,
});

const aggregatesSchema = z.strictObject({
    fixture_counts: fixtureCountsSchema,
    fixture_distributions: fixtureDistributionsAggregateSchema.optional(),
    billing_legacy_hazard: billingLegacyHazardAggregateSchema.optional(),
    billing_package_price_links: billingPackagePriceLinksAggregateSchema.optional(),
    schema_hazards: z.strictObject({
        package_prices_table_present: z.boolean(),
        checkout_intents_table_present: z.boolean(),
        email_recipient_budget_usage_table_present: z.boolean(),
        fulfillment_effects_table_present: z.boolean(),
        staging_smoke_table_present: z.boolean(),
        legacy_jobs_table_present: z.boolean(),
        leads_updated_at_present: z.boolean(),
        leads_status_udt: z.enum(['pg_catalog.text', 'public.lead_status']),
        leads_lang_default: z.enum(["'es'::text"]).nullable(),
        leads_consent_default: z.enum(['false']).nullable(),
        public_is_admin_present: z.boolean(),
        private_is_admin_present: z.boolean(),
        processed_at_default: z.enum(['now()']).nullable(),
    }),
    data_hazards: z.strictObject({
        unsupported_lead_status: count,
        invalid_session_roles: count,
        unsupported_session_duration: count,
        invalid_assignments: count,
        nonstudent_subscriptions: count,
        active_overlapping_availability: count,
    }),
    baseline_history_effects: baselineHistoryEffectsAggregateSchema.optional(),
    processed_at_posture: processedAtPostureAggregateSchema.optional(),
    database_context: z.strictObject({
        server_version: z.string().regex(/^\d+\.\d+(?:\.\d+)?$/u),
        database_size_bytes: count,
    }),
});

const remoteMigrationsSchema = z.array(z.strictObject({
    version: z.string().regex(/^(?:\d{3}|\d{14})$/u),
    name: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9_-]*$/u),
})).min(1).max(500).superRefine((migrations, context) => {
    const versions = new Set<string>();
    for (const [index, migration] of migrations.entries()) {
        if (versions.has(migration.version)) {
            context.addIssue({
                code: 'custom',
                message: 'duplicate remote migration version',
                path: [index, 'version'],
            });
        }
        versions.add(migration.version);
    }
});

const connectorSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    capturedAt: z.string().datetime({ offset: true }),
    provenance: z.literal('supabase_connector_execute_sql'),
    target: z.strictObject({
        environment: z.string().min(1).max(20),
        name: z.string().min(1).max(80),
        ref: z.string().regex(/^[a-z]{20}$/u),
        region: z.string().min(1).max(40),
    }),
    safety: z.strictObject({
        readOnlyTransaction: z.literal(true),
        noPrivateRowsSelected: z.literal(true),
        noSecretsStored: z.literal(true),
        noExternalWrite: z.literal(true),
    }),
    remoteMigrations: remoteMigrationsSchema,
    aggregates: aggregatesSchema,
});

export type ProductionConnectorSnapshot = z.infer<typeof connectorSnapshotSchema>;

export interface ProductionConnectorPreflightArgs {
    snapshotPath: string;
}

export interface ImportProductionConnectorPreflightOptions {
    snapshotPath: string;
    root?: string;
    now?: Date;
}

export interface ImportProductionConnectorPreflightResult {
    outputDir: string;
    summaryPath: string;
    report: ConnectorProductionPreflightEvidence;
}

export interface ConnectorProductionPreflightEvidence extends ProductionPreflightEvidence {
    startedAt: string;
    importedAt: string;
    mode: 'connector_snapshot_import_read_only';
    target: typeof PRODUCTION_PROJECT;
    provenance: {
        source: 'supabase_connector_execute_sql';
        captureMethod: 'supabase_connector_execute_sql';
        snapshotSchemaVersion: 1;
        snapshotSha256: string;
        rawSnapshotStored: false;
        localMigrationInventoryRecalculated: true;
    };
    migrationInventory: ProductionPreflightEvidence['migrationInventory'] & {
        localCount: number;
        remoteCount: number;
        canonicalVersionMissingCount: number;
        semanticAliasCount: number;
        versionNameMismatchCount: number;
        duplicateSemanticHistoryCount: number;
        remoteMigrations: RemoteMigration[];
    };
    checks: Array<{
        status: 'ok' | 'warning';
        name: string;
        message: string;
    }>;
    safety: ProductionPreflightEvidence['safety'] & {
        readOnlyTransaction: true;
        sourceSnapshotStored: false;
        noMigrationStatementsSelected: true;
    };
}

export function parseProductionConnectorPreflightArgs(args: string[]): ProductionConnectorPreflightArgs {
    const normalizedArgs = args[0] === '--' ? args.slice(1) : args;
    let snapshotPath: string | null = null;
    for (let index = 0; index < normalizedArgs.length; index += 1) {
        const argument = normalizedArgs[index];
        if (argument !== '--snapshot') {
            throw new Error(`Unknown production connector preflight argument: ${argument}`);
        }
        if (snapshotPath) throw new Error('--snapshot may only be supplied once.');
        const value = normalizedArgs[index + 1];
        if (!value || value.startsWith('--')) throw new Error('--snapshot requires a JSON file path.');
        snapshotPath = value;
        index += 1;
    }

    if (!snapshotPath) throw new Error('--snapshot is required.');
    return { snapshotPath };
}

export function parseProductionConnectorSnapshot(raw: string, now = new Date()): ProductionConnectorSnapshot {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw) as unknown;
    } catch {
        throw new Error('Connector snapshot is not valid JSON.');
    }

    const validated = connectorSnapshotSchema.safeParse(parsed);
    if (!validated.success) {
        const issues = validated.error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}:${issue.code}`)
            .join(', ');
        throw new Error(`Connector snapshot schema validation failed: ${issues}`);
    }

    const snapshot = validated.data;
    if (snapshot.target.ref !== PRODUCTION_PROJECT.ref) throw new Error('Connector snapshot target ref mismatch.');
    if (snapshot.target.environment !== PRODUCTION_PROJECT.environment
        || snapshot.target.name !== PRODUCTION_PROJECT.name
        || snapshot.target.region !== PRODUCTION_PROJECT.region) {
        throw new Error('Connector snapshot production identity mismatch.');
    }

    const capturedAt = Date.parse(snapshot.capturedAt);
    const age = now.getTime() - capturedAt;
    if (capturedAt > now.getTime()) throw new Error('Connector snapshot capturedAt is in the future.');
    if (age > PRODUCTION_PREFLIGHT_MAX_AGE_MS) throw new Error('Connector snapshot is stale.');
    const aggregateErrors = validateAggregateCoherence(snapshot.aggregates);
    if (aggregateErrors.length > 0) {
        throw new Error(`Connector snapshot aggregate coherence failed: ${aggregateErrors.join('; ')}.`);
    }
    return snapshot;
}

function validateAggregateCoherence(
    aggregates: ProductionConnectorSnapshot['aggregates'],
): string[] {
    const errors: string[] = [];
    const counts = aggregates.fixture_counts;
    const distributions = aggregates.fixture_distributions;
    if (distributions) {
        for (const [label, observed, expected] of [
            ['profiles_by_role', sumSparseCounts(distributions.profiles_by_role), counts.profiles],
            ['subscriptions_by_status', sumSparseCounts(distributions.subscriptions_by_status), counts.subscriptions],
            ['sessions_by_status', sumSparseCounts(distributions.sessions_by_status), counts.sessions],
            ['payments_by_status', sumSparseCounts(distributions.payments_by_status), counts.payments],
        ] as const) {
            if (observed !== expected) errors.push(`${label} does not sum to fixture_counts`);
        }
    }

    const processedAt = aggregates.processed_at_posture;
    if (processedAt && processedAt.total !== counts.processed_webhook_events) {
        errors.push('processed_at_posture.total does not match fixture_counts.processed_webhook_events');
    }

    const billing = aggregates.billing_legacy_hazard;
    if (billing) {
        if (billing.total_subscriptions !== counts.subscriptions) {
            errors.push('billing_legacy_hazard.total_subscriptions does not match fixture_counts.subscriptions');
        }
        if (billing.stripe_linked !== billing.active_stripe_linked + billing.cancelled_stripe_linked) {
            errors.push('billing_legacy_hazard Stripe status totals do not match stripe_linked');
        }
        const breakdownTotal = billing.stripe_linked_breakdown
            .reduce((total, row) => total + row.fixture_count, 0);
        if (breakdownTotal !== billing.stripe_linked) {
            errors.push('billing_legacy_hazard breakdown does not sum to stripe_linked');
        }
        for (const [status, expected] of [
            ['active', billing.active_stripe_linked],
            ['cancelled', billing.cancelled_stripe_linked],
        ] as const) {
            const observed = billing.stripe_linked_breakdown
                .filter((row) => row.status === status)
                .reduce((total, row) => total + row.fixture_count, 0);
            if (observed !== expected) errors.push(`billing_legacy_hazard ${status} breakdown mismatch`);
        }
    }

    const links = aggregates.billing_package_price_links;
    if (links) {
        if (links.all_subscriptions_without_package_price > counts.subscriptions) {
            errors.push('billing_package_price_links all-subscription count exceeds fixture total');
        }
        if (!links.column_present && links.all_subscriptions_without_package_price !== counts.subscriptions) {
            errors.push('absent package_price_id column must count every subscription as missing');
        }
        if (billing) {
            if (links.column_present !== billing.package_price_id_column_present) {
                errors.push('billing package_price_id column presence disagrees across aggregates');
            }
            if (links.stripe_linked_without_package_price > billing.stripe_linked) {
                errors.push('billing_package_price_links Stripe count exceeds billing_legacy_hazard');
            }
            if (!links.column_present
                && links.stripe_linked_without_package_price !== billing.stripe_linked) {
                errors.push('absent package_price_id column must count every Stripe-linked subscription as missing');
            }
        }
    }

    return errors;
}

function sumSparseCounts(value: Record<string, number | undefined>): number {
    return Object.values(value).reduce<number>((total, countValue) => total + (countValue ?? 0), 0);
}

export function buildProductionConnectorPreflightEvidence(
    snapshot: ProductionConnectorSnapshot,
    snapshotSha256: string,
    root = process.cwd(),
    now = new Date(),
): ConnectorProductionPreflightEvidence {
    const localValidation = validateProductionRolloutAllowlist(root);
    if (!localValidation.valid) {
        throw new Error(`Local production migration allowlist is invalid: ${localValidation.errors.join('; ')}`);
    }

    const localMigrations = collectLocalMigrations(root);
    if (localMigrations.length === 0) throw new Error('No local Supabase migrations were found.');
    const remoteMigrations = [...snapshot.remoteMigrations]
        .sort((left, right) => left.version.localeCompare(right.version, 'en') || left.name.localeCompare(right.name, 'en'));
    const migrationMappings = mapMigrationHistory(localMigrations, remoteMigrations);
    const ambiguous = migrationMappings.filter((migration) => migration.historyStatus === 'ambiguous');
    const aliases = migrationMappings.filter((migration) => migration.historyStatus === 'alias');
    const versionNameMismatches = migrationMappings.filter((migration) => migration.versionNameMismatch);
    const duplicateSemanticHistory = migrationMappings.filter((migration) => migration.duplicateSemanticHistory);
    const semanticMissing = migrationMappings.filter((migration) => migration.historyStatus === 'missing' && !migration.stagingOnly);
    const canonicalMissing = migrationMappings.filter((migration) => migration.historyStatus !== 'exact');
    const errors: string[] = [];

    if (ambiguous.length > 0) errors.push('Remote migration history contains ambiguous semantic mappings.');
    const localByVersion = new Map(migrationMappings.map((migration) => [migration.version, migration]));
    for (const rolloutMigration of PRODUCTION_ROLLOUT_MIGRATIONS) {
        const observed = localByVersion.get(rolloutMigration.version);
        if (!observed) {
            errors.push(`Local inventory is missing rollout migration ${rolloutMigration.version}.`);
        } else if (!['missing', 'exact'].includes(observed.historyStatus)) {
            errors.push(`Rollout migration ${rolloutMigration.version} has unsafe history state ${observed.historyStatus}.`);
        }
    }

    const stagingOnly = localByVersion.get(STAGING_ONLY_VERSION);
    if (!stagingOnly || stagingOnly.historyStatus !== 'missing') {
        errors.push(`Staging-only migration ${STAGING_ONLY_VERSION} is not absent from production.`);
    }

    const rolloutVersions = new Set(PRODUCTION_ROLLOUT_MIGRATIONS.map((migration) => migration.version));
    const unplannedMissing = migrationMappings.filter((migration) => (
        migration.historyStatus === 'missing'
        && !migration.stagingOnly
        && !rolloutVersions.has(migration.version)
    ));
    if (unplannedMissing.length > 0) {
        errors.push(`Remote history has unplanned missing migrations: ${unplannedMissing.map((migration) => migration.version).join(',')}.`);
    }

    const capturedAt = new Date(snapshot.capturedAt).toISOString();
    const report: ConnectorProductionPreflightEvidence = {
        schemaVersion: 1,
        startedAt: capturedAt,
        endedAt: capturedAt,
        importedAt: now.toISOString(),
        status: 'WARNING',
        mode: 'connector_snapshot_import_read_only',
        target: PRODUCTION_PROJECT,
        provenance: {
            source: snapshot.provenance,
            captureMethod: snapshot.provenance,
            snapshotSchemaVersion: snapshot.schemaVersion,
            snapshotSha256,
            rawSnapshotStored: false,
            localMigrationInventoryRecalculated: true,
        },
        migrationInventory: {
            localCount: localMigrations.length,
            remoteCount: remoteMigrations.length,
            canonicalVersionMissingCount: canonicalMissing.length,
            semanticAliasCount: aliases.length,
            semanticMissingCountExcludingStagingOnly: semanticMissing.length,
            ambiguousCount: ambiguous.length,
            versionNameMismatchCount: versionNameMismatches.length,
            duplicateSemanticHistoryCount: duplicateSemanticHistory.length,
            localMigrations: migrationMappings,
            remoteMigrations,
        },
        aggregates: snapshot.aggregates,
        checks: [
            {
                status: 'ok',
                name: 'exact_production_target',
                message: 'Connector snapshot identifies the exact approved production Supabase project.',
            },
            {
                status: 'ok',
                name: 'connector_read_only_attestation',
                message: 'Snapshot attests a read-only transaction with no private rows, secrets or external writes.',
            },
            {
                status: versionNameMismatches.length > 0 || duplicateSemanticHistory.length > 0 ? 'warning' : 'ok',
                name: 'local_migration_reconciliation',
                message: versionNameMismatches.length > 0 || duplicateSemanticHistory.length > 0
                    ? 'Local migrations were re-hashed; known version/name or duplicate semantic history drift remains visible in the inventory.'
                    : 'Local migrations were re-hashed and mapped against the captured remote history.',
            },
            {
                status: 'warning',
                name: 'aggregate_fixture_inventory',
                message: 'Aggregate fixture counts remain subject to the production preservation and cleanup policy.',
            },
        ],
        safety: {
            noExternalWrite: true,
            noPrivateRowsSelected: true,
            noSecretsStored: true,
            readOnlyTransaction: true,
            sourceSnapshotStored: false,
            noMigrationStatementsSelected: true,
        },
    };

    const waveStates = deriveWaveHistoryStates(report);
    let pendingObserved = false;
    for (const wave of waveStates) {
        if (wave.state === 'partial_or_ambiguous') errors.push(`Rollout wave ${wave.id} is partial or ambiguous.`);
        if (wave.state === 'pending') pendingObserved = true;
        if (wave.state === 'complete' && pendingObserved) errors.push(`Rollout wave ${wave.id} is complete after an earlier pending wave.`);
    }

    if (errors.length > 0) throw new Error(`Connector snapshot is incompatible with production rollout: ${errors.join(' ')}`);
    return report;
}

export function importProductionConnectorPreflight(
    options: ImportProductionConnectorPreflightOptions,
): ImportProductionConnectorPreflightResult {
    const root = path.resolve(options.root ?? process.cwd());
    const now = options.now ?? new Date();
    const snapshotPath = path.resolve(root, options.snapshotPath);
    if (path.extname(snapshotPath).toLowerCase() !== '.json') throw new Error('--snapshot must reference a .json file.');
    if (!existsSync(snapshotPath)) throw new Error('Connector snapshot file does not exist.');
    const snapshotStat = lstatSync(snapshotPath);
    if (snapshotStat.isSymbolicLink() || !snapshotStat.isFile()) {
        throw new Error('Connector snapshot must be a regular, non-symlink JSON file.');
    }
    if (statSync(snapshotPath).size > MAX_SNAPSHOT_BYTES) throw new Error('Connector snapshot exceeds the size limit.');

    const raw = readFileSync(snapshotPath, 'utf8');
    const snapshot = parseProductionConnectorSnapshot(raw, now);
    const report = buildProductionConnectorPreflightEvidence(snapshot, sha256(raw), root, now);

    const outputsRoot = path.resolve(root, 'outputs');
    mkdirSync(outputsRoot, { recursive: true });
    assertOrdinaryDirectory(outputsRoot, 'outputs');
    const familyDir = path.resolve(outputsRoot, OUTPUT_FAMILY);
    assertInside(outputsRoot, familyDir);
    mkdirSync(familyDir, { recursive: true });
    assertOrdinaryDirectory(familyDir, OUTPUT_FAMILY);
    const outputDir = path.resolve(familyDir, stamp(now));
    assertInside(outputsRoot, outputDir);
    if (existsSync(outputDir)) throw new Error('Connector preflight output directory already exists.');
    mkdirSync(outputDir);

    const summaryPath = path.join(outputDir, 'summary.json');
    writeFileSync(summaryPath, stableJson(report), { encoding: 'utf8', flag: 'wx' });
    return { outputDir, summaryPath, report };
}

function assertOrdinaryDirectory(directory: string, label: string): void {
    const stats = lstatSync(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${label} must be a regular directory.`);
}

function assertInside(parent: string, child: string): void {
    const relative = path.relative(parent, child);
    if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error('Refusing to write outside outputs.');
    }
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}

async function main(): Promise<void> {
    const args = parseProductionConnectorPreflightArgs(process.argv.slice(2));
    const result = importProductionConnectorPreflight(args);
    console.log('[launch:supabase-production-connector-preflight] Status: WARNING');
    console.log(`[launch:supabase-production-connector-preflight] Target: ${PRODUCTION_PROJECT.name} (${PRODUCTION_PROJECT.ref})`);
    console.log(`[launch:supabase-production-connector-preflight] Summary: ${toPosix(path.relative(process.cwd(), result.summaryPath))}`);
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : 'Connector preflight import failed.');
        process.exitCode = 1;
    });
}
