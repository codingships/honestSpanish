import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
    HISTORY_RECONCILIATION_EXCEPTION_ID,
    HISTORY_RECONCILIATION_MAX_AGE_MS,
    HISTORY_RECONCILIATION_SQL_PATH,
    buildHistoryReconciliationManifest,
    parseHistoryReconciliationSnapshot,
    type HistoryReconciliationSnapshot,
} from './supabase-production-history-reconciliation';
import {
    PRODUCTION_PROJECT,
    sha256,
    stableJson,
    type MigrationHistoryMapping,
} from './supabase-production-rollout-shared';

const MAX_MANIFEST_BYTES = 500_000;
const OUTPUT_FAMILY = 'outputs/launch-supabase-production-history-reconciliation';

export const PRODUCTION_HISTORY_EXCEPTION_APPROVAL_ENV = 'SUPABASE_PRODUCTION_HISTORY_EXCEPTION_APPROVAL';

export interface HistoryReconciliationManifestEvidence {
    provided: boolean;
    valid: boolean;
    path: string | null;
    sha256: string | null;
    manifestCoreSha256: string | null;
    snapshotSha256: string | null;
    capturedAt: string | null;
    value: Record<string, unknown> | null;
    exactActivationApproval: string | null;
    errors: string[];
}

export interface HistoryDriftPreflight {
    target?: { ref?: string };
    endedAt?: string;
    migrationInventory?: {
        ambiguousCount?: number;
        versionNameMismatchCount?: number;
        duplicateSemanticHistoryCount?: number;
        localMigrations?: MigrationHistoryMapping[];
    };
}

export interface ValidatedLiveHistoryReconciliationSnapshot extends HistoryReconciliationSnapshot {
    observedProvenance: HistoryReconciliationSnapshot['provenance'];
    provenanceNormalization: 'none' | 'connector_fallback_sealed';
}

const allowlistedDrift = [
    drift('009', 'launch_catalog_and_fulfillment', 'supabase/migrations/009_launch_catalog_and_fulfillment.sql', 4_994, 'a7d9481607efc62188585419aa765400add2cffaec37f8d4fac18768ede91ffd', ['009'], true, false),
    drift('021', 'harden_session_write_policies', 'supabase/migrations/021_harden_session_write_policies.sql', 769, '5a547504b82208552751412368fd46ed7bf3efa9ab5f0f8ad8a9f11c528d21c5', ['021', '20260703192245'], false, true),
    drift('022', 'track_stripe_webhook_processing_state', 'supabase/migrations/022_track_stripe_webhook_processing_state.sql', 1_296, '398b2838c506e0c026c60489c25ed4fb3c337341c68779b676a5f7cec1d1b4f8', ['022', '20260703192307'], false, true),
    drift('20260702124757', 'harden_profile_role_trigger', 'supabase/migrations/20260702124757_harden_profile_role_trigger.sql', 1_429, 'a45c03c7aa39288c9b63dc9534ac3fc5941bed6d47855d64f7d8d36c4a27a1e3', ['20260702124757', '20260703192329'], false, true),
] as const;

export function readHistoryReconciliationManifestEvidence(
    evidencePath: string | null,
    now = new Date(),
    root = process.cwd(),
): HistoryReconciliationManifestEvidence {
    const empty = (provided: boolean, errors: string[]): HistoryReconciliationManifestEvidence => ({
        provided,
        valid: false,
        path: evidencePath ? path.resolve(evidencePath) : null,
        sha256: null,
        manifestCoreSha256: null,
        snapshotSha256: null,
        capturedAt: null,
        value: null,
        exactActivationApproval: null,
        errors,
    });
    if (!evidencePath) return empty(false, ['not provided']);

    const absolute = path.resolve(evidencePath);
    if (!existsSync(absolute)) return empty(true, ['manifest does not exist']);
    try {
        const stat = lstatSync(absolute);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) {
            return empty(true, ['manifest must be an ordinary bounded file']);
        }
        const rootReal = realpathSync(root);
        const fileReal = realpathSync(absolute);
        const relative = path.relative(rootReal, fileReal).split(path.sep).join('/');
        if (!relative.startsWith(`${OUTPUT_FAMILY}/`) || !relative.endsWith('/immutable-review-manifest.json')) {
            return empty(true, ['manifest path is outside the exact reconciliation output family']);
        }

        const raw = readFileSync(absolute, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) return empty(true, ['manifest root is not an object']);
        const evidence = record(parsed.evidence, 'manifest evidence');
        const target = record(parsed.target, 'manifest target');
        const allowlist = record(parsed.allowlist, 'manifest allowlist');
        const verdict = record(parsed.verdict, 'manifest verdict');
        const safety = record(parsed.safety, 'manifest safety');
        const reconciliation = record(parsed.reconciliation, 'manifest reconciliation');
        const local009 = record(reconciliation.local009, 'manifest 009 reconciliation');
        const proposedException = record(local009.proposedException, 'manifest proposed exception');

        const manifestCoreSha256 = stringField(parsed.manifestCoreSha256, 'manifestCoreSha256');
        const snapshotSha256 = stringField(evidence.snapshotSha256, 'snapshotSha256');
        const capturedAt = stringField(evidence.capturedAt, 'capturedAt');
        const provenance = stringField(evidence.provenance, 'provenance');
        if (parsed.schemaVersion !== 2
            || target.ref !== PRODUCTION_PROJECT.ref
            || allowlist.id !== HISTORY_RECONCILIATION_EXCEPTION_ID
            || allowlist.targetProjectRef !== PRODUCTION_PROJECT.ref
            || allowlist.migrationRepair !== 'FORBIDDEN'
            || verdict.status !== 'REVIEWED_EXCEPTION_ELIGIBLE'
            || verdict.rolloutExceptionEligible !== true
            || verdict.rolloutMustRemainBlocked !== true
            || proposedException.enabled !== false
            || proposedException.rolloutConsumable !== false
            || proposedException.allowlistedConsumerImplemented !== true
            || proposedException.activationRequiresExactApproval !== true
            || safety.externalWritePerformed !== false
            || safety.migrationApplied !== false
            || safety.migrationRepairPerformed !== false) {
            throw new Error('Manifest allowlist, target, verdict or safety contract mismatch.');
        }
        if (provenance !== 'supabase_connector_execute_sql'
            && provenance !== 'supabase_history_capture_psql_readonly') {
            throw new Error('Manifest must originate from an allowlisted read-only history capture.');
        }

        const snapshot: HistoryReconciliationSnapshot = parseHistoryReconciliationSnapshot(JSON.stringify({
            schemaVersion: 1,
            capturedAt,
            provenance,
            target: {
                environment: 'production',
                name: 'espanolhonesto',
                ref: PRODUCTION_PROJECT.ref,
                database: 'postgres',
            },
            safety: {
                transactionReadOnly: true,
                rawStatementsPersisted: false,
                rawStatementsReturned: false,
                privateRowsSelected: false,
                externalWritePerformed: false,
            },
            historyRows: evidence.historyRows,
            remote009Descriptors: evidence.remote009Descriptors,
            effectChecks: evidence.effectChecks,
        }), now, provenance, HISTORY_RECONCILIATION_MAX_AGE_MS);

        if (sha256(stableJson(snapshot)) !== snapshotSha256) throw new Error('Manifest snapshot SHA-256 mismatch.');
        const expected = buildHistoryReconciliationManifest(snapshot, root);
        if (stableJson(parsed) !== stableJson(expected)) throw new Error('Manifest is not the exact current source-bound reconciliation.');
        const core = { ...parsed };
        delete core.manifestCoreSha256;
        if (sha256(stableJson(core)) !== manifestCoreSha256) throw new Error('Manifest core SHA-256 mismatch.');

        const fileSha256 = sha256(raw);
        return {
            provided: true,
            valid: true,
            path: absolute,
            sha256: fileSha256,
            manifestCoreSha256,
            snapshotSha256,
            capturedAt,
            value: parsed,
            exactActivationApproval: buildHistoryExceptionApproval({
                manifestSha256: fileSha256,
                manifestCoreSha256,
                snapshotSha256,
            }),
            errors: [],
        };
    } catch (error) {
        return empty(true, [error instanceof Error ? error.message : String(error)]);
    }
}

export function validateAllowlistedHistoryDrift(
    preflight: HistoryDriftPreflight,
    evidence: HistoryReconciliationManifestEvidence,
): string[] {
    const errors: string[] = [];
    if (!evidence.valid) errors.push('Exact fresh history reconciliation manifest is not valid.');
    if (preflight.target?.ref !== PRODUCTION_PROJECT.ref) errors.push('History exception preflight target mismatch.');
    if (preflight.migrationInventory?.ambiguousCount !== 0) errors.push('History exception never permits ambiguous mappings.');
    if (preflight.migrationInventory?.versionNameMismatchCount !== 1) errors.push('History exception requires exactly one version/name mismatch.');
    if (preflight.migrationInventory?.duplicateSemanticHistoryCount !== 3) errors.push('History exception requires exactly three duplicate semantic mappings.');

    const migrations = Array.isArray(preflight.migrationInventory?.localMigrations)
        ? preflight.migrationInventory.localMigrations
        : [];
    const observedFlagged = migrations.filter((entry) => entry.versionNameMismatch || entry.duplicateSemanticHistory);
    if (observedFlagged.length !== allowlistedDrift.length) errors.push('History exception flagged migration count mismatch.');
    const observedByVersion = new Map(observedFlagged.map((entry) => [entry.version, entry]));
    for (const expected of allowlistedDrift) {
        const observed = observedByVersion.get(expected.version);
        if (!observed || stableJson(selectDriftIdentity(observed)) !== stableJson(expected)) {
            errors.push(`History exception mapping mismatch for ${expected.version}.`);
        }
    }
    for (const observed of observedFlagged) {
        if (!allowlistedDrift.some((expected) => expected.version === observed.version)) {
            errors.push(`History exception contains non-allowlisted drift ${observed.version}.`);
        }
    }
    return errors;
}

export function validateLiveHistoryReconciliationSnapshot(
    raw: string,
    now = new Date(),
): ValidatedLiveHistoryReconciliationSnapshot {
    const normalized = raw.trim();
    try {
        const direct = parseHistoryReconciliationSnapshot(
            normalized,
            now,
            'production_rollout_psql_readonly',
            5 * 60 * 1_000,
        );
        return {
            ...direct,
            observedProvenance: direct.provenance,
            provenanceNormalization: 'none',
        };
    } catch (rolloutProvenanceError) {
        try {
            // Supabase can strip custom startup GUCs while preserving the exact
            // read-only SQL contract. Accept only the connector fallback after
            // every schema, safety, history, descriptor, effect and freshness
            // check passes, then seal the trusted wrapper provenance locally.
            const fallback = parseHistoryReconciliationSnapshot(
                normalized,
                now,
                'supabase_connector_execute_sql',
                5 * 60 * 1_000,
            );
            return {
                ...fallback,
                provenance: 'production_rollout_psql_readonly',
                observedProvenance: fallback.provenance,
                provenanceNormalization: 'connector_fallback_sealed',
            };
        } catch {
            throw rolloutProvenanceError;
        }
    }
}

export function buildHistoryExceptionApproval(input: {
    manifestSha256: string;
    manifestCoreSha256: string;
    snapshotSha256: string;
}): string {
    for (const value of Object.values(input)) {
        if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('History exception approval requires exact SHA-256 bindings.');
    }
    return [
        'AUTORIZO LA EXCEPCION EXACTA DE HISTORIAL SUPABASE PRODUCCION',
        `target=${PRODUCTION_PROJECT.ref}`,
        `exception=${HISTORY_RECONCILIATION_EXCEPTION_ID}`,
        `manifest=${input.manifestSha256}`,
        `core=${input.manifestCoreSha256}`,
        `snapshot=${input.snapshotSha256}`,
        `query=${HISTORY_RECONCILIATION_SQL_PATH}`,
        'remote_collision=009:jobs',
        'canonical_full_source_aliases=021,022,20260702124757',
        'live_readonly_reconciliation_before_write=true',
        'migration_repair=FORBIDDEN',
        'db_push=FORBIDDEN',
        'checkout=DISABLED',
    ].join(' | ');
}

function drift(
    version: string,
    name: string,
    file: string,
    bytes: number,
    sourceSha256: string,
    remoteVersions: readonly string[],
    versionNameMismatch: boolean,
    duplicateSemanticHistory: boolean,
) {
    return {
        version,
        name,
        file,
        bytes,
        sha256: sourceSha256,
        stagingOnly: false,
        plannedWave: null,
        historyStatus: 'exact',
        remoteVersions: [...remoteVersions],
        versionNameMismatch,
        duplicateSemanticHistory,
    } as const;
}

function selectDriftIdentity(entry: MigrationHistoryMapping) {
    return {
        version: entry.version,
        name: entry.name,
        file: entry.file,
        bytes: entry.bytes,
        sha256: entry.sha256,
        stagingOnly: entry.stagingOnly,
        plannedWave: entry.plannedWave,
        historyStatus: entry.historyStatus,
        remoteVersions: entry.remoteVersions,
        versionNameMismatch: entry.versionNameMismatch,
        duplicateSemanticHistory: entry.duplicateSemanticHistory,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${label} is not an object.`);
    return value;
}

function stringField(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is missing.`);
    return value;
}
