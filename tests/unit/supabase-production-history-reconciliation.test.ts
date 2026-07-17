import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    EFFECT_EXPECTATIONS,
    HISTORY_EXPECTATIONS,
    HISTORY_RECONCILIATION_SQL_SHA256,
    buildHistoryReconciliationManifest,
    captureHistoryReconciliationSnapshotReadonly,
    parseHistoryReconciliationArgs,
    parseHistoryReconciliationSnapshot,
} from '../../scripts/launch/supabase-production-history-reconciliation';
import {
    readHistoryReconciliationManifestEvidence,
    validateAllowlistedHistoryDrift,
    validateLiveHistoryReconciliationSnapshot,
} from '../../scripts/launch/supabase-production-history-reconciliation-consumer';
import { sha256, stableJson } from '../../scripts/launch/supabase-production-rollout-shared';

const capturedAt = '2026-07-14T18:51:23.642371+00:00';
const now = new Date('2026-07-14T19:00:00.000Z');
const sql = readFileSync('scripts/launch/sql/supabase-production-history-reconciliation-readonly.sql', 'utf8');
const rolloutPlan = readFileSync('scripts/launch/supabase-production-rollout-plan.ts', 'utf8');
const rolloutRunner = readFileSync('scripts/launch/supabase-production-rollout-runner.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

function testProductionDatabaseUrl(): string {
    const url = new URL('postgresql://db.vkkahxsybhbutszerawz.supabase.co:5432/postgres');
    url.username = 'postgres';
    url.password = 'unit-only-secret';
    return url.toString();
}

describe('Supabase production history reconciliation manifest', () => {
    it('accepts exactly one canonical capture mode or one explicit snapshot', () => {
        expect(parseHistoryReconciliationArgs(['--capture-readonly'])).toEqual({
            mode: 'capture-readonly',
            snapshotPath: null,
        });
        expect(parseHistoryReconciliationArgs(['--', '--snapshot', 'outputs/capture.json'])).toEqual({
            mode: 'snapshot',
            snapshotPath: 'outputs/capture.json',
        });
        expect(() => parseHistoryReconciliationArgs([])).toThrow(/Usage/u);
        expect(() => parseHistoryReconciliationArgs(['--capture-readonly', '--snapshot', 'capture.json'])).toThrow(/Usage/u);
    });

    it('captures only the allowlisted SQL in memory with two independent read-only controls', () => {
        const directory = path.join('outputs', 'launch-supabase-production-history-reconciliation', 'unit-readonly-capture');
        const envFile = path.join(directory, 'production.env');
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        writeFileSync(envFile, [
            'PUBLIC_SUPABASE_URL=https://vkkahxsybhbutszerawz.supabase.co',
            `SUPABASE_DB_URL=${testProductionDatabaseUrl()}`,
            '',
        ].join('\n'), 'utf8');
        const captured = snapshot();
        let invocation: any = null;
        try {
            const parsed = captureHistoryReconciliationSnapshotReadonly({
                root: process.cwd(),
                envFile,
                now: new Date('2026-07-14T18:53:00.000Z'),
                spawn: (command, args, options) => {
                    invocation = { command, args, options };
                    return { status: 0, stdout: JSON.stringify(captured), stderr: '' };
                },
            });

            expect(parsed.provenance).toBe('supabase_history_capture_psql_readonly');
            expect(invocation.command).toBe('psql');
            expect(invocation.args).toEqual([
                '-X', '-w', '-q', '-A', '-t',
                '-v', 'ON_ERROR_STOP=1',
                '-f', path.resolve('scripts/launch/sql/supabase-production-history-reconciliation-readonly.sql'),
            ]);
            expect(invocation.options.env.PGHOST).toBe('db.vkkahxsybhbutszerawz.supabase.co');
            expect(invocation.options.env.PGOPTIONS).toContain('application_name=espanol-honesto-history-reconciliation-capture');
            expect(invocation.options.env.PGOPTIONS).toContain('espanol_honesto.history_reconciliation_provenance=capture_psql_readonly');
            expect(invocation.options.env.PGOPTIONS).toContain('default_transaction_read_only=on');
            expect(JSON.stringify(invocation.args)).not.toContain('unit-only-secret');
            expect(readdirSync(directory)).toEqual(['production.env']);
            expect(sha256(sql)).toBe(HISTORY_RECONCILIATION_SQL_SHA256);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('blocks read-only capture when either production target binding is wrong', () => {
        const directory = path.join('outputs', 'launch-supabase-production-history-reconciliation', 'unit-wrong-target-capture');
        const envFile = path.join(directory, 'production.env');
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        writeFileSync(envFile, [
            'PUBLIC_SUPABASE_URL=https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
            `SUPABASE_DB_URL=${testProductionDatabaseUrl()}`,
            '',
        ].join('\n'), 'utf8');
        try {
            expect(() => captureHistoryReconciliationSnapshotReadonly({
                root: process.cwd(),
                envFile,
                spawn: () => { throw new Error('must not spawn'); },
            })).toThrow(/PUBLIC_SUPABASE_URL target mismatch/u);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('accepts only the exact seven-row, hash-only, aggregate-effect snapshot', () => {
        const parsed = parseHistoryReconciliationSnapshot(JSON.stringify(snapshot()), now);
        expect(parsed.target.ref).toBe('vkkahxsybhbutszerawz');
        expect(parsed.historyRows).toHaveLength(7);
        expect(parsed.effectChecks).toHaveLength(29);
        expect(parsed.safety).toEqual({
            transactionReadOnly: true,
            rawStatementsPersisted: false,
            rawStatementsReturned: false,
            privateRowsSelected: false,
            externalWritePerformed: false,
        });
    });

    it('proves exact full-source canonical aliases but keeps activation non-consumable by default', () => {
        const parsed = parseHistoryReconciliationSnapshot(JSON.stringify(snapshot()), now);
        const first = buildHistoryReconciliationManifest(parsed, process.cwd(), fakeLineage());
        const second = buildHistoryReconciliationManifest(parsed, process.cwd(), fakeLineage());
        const reconciliation = first.reconciliation as any;
        const verdict = first.verdict as any;

        expect(reconciliation.exactAliasPairs).toHaveLength(3);
        expect(reconciliation.exactAliasPairs.every((pair: any) => (
            pair.sourceSha256 === pair.exactSourceStatementSha256
            && pair.identity === 'EXACT_FULL_SOURCE_STATEMENT'
        ))).toBe(true);
        expect(reconciliation.local009.sourceIdentity).toBe('PROVEN_DIFFERENT_VERSION_COLLISION');
        expect(reconciliation.local009.proposedException).toMatchObject({
            eligibleForManualReview: true,
            enabled: false,
            rolloutConsumable: false,
            allowlistedConsumerImplemented: true,
            activationRequiresExactApproval: true,
        });
        expect(verdict).toMatchObject({
            status: 'REVIEWED_EXCEPTION_ELIGIBLE',
            rolloutExceptionEligible: true,
            rolloutMustRemainBlocked: true,
        });
        expect(first.manifestCoreSha256).toBe(second.manifestCoreSha256);
    });

    it.each([
        ['target', (value: any) => { value.target.ref = 'mzjyvmlxfpzdfdjzxxyj'; }],
        ['remote hash', (value: any) => { value.historyRows[0].statementSha256[0] = '0'.repeat(64); }],
        ['row name', (value: any) => { value.historyRows[0].name = 'launch_catalog_and_fulfillment'; }],
        ['row count', (value: any) => { value.historyRows.pop(); }],
        ['descriptor', (value: any) => { value.remote009Descriptors[0].object_name = 'public.fulfillment_jobs'; }],
        ['descriptor byte length', (value: any) => { value.remote009Descriptors[0].statement_bytes += 1; }],
        ['effect missing', (value: any) => { value.effectChecks.pop(); }],
        ['effect false', (value: any) => { value.effectChecks[1].passed = false; }],
        ['unexpected raw SQL field', (value: any) => { value.historyRows[0].statements = ['CREATE TABLE secret']; }],
    ])('rejects %s tampering', (_label, mutate) => {
        const value = snapshot();
        mutate(value);
        expect(() => parseHistoryReconciliationSnapshot(JSON.stringify(value), now)).toThrow();
    });

    it('ships a database-enforced read-only query that never selects raw statements or private rows', () => {
        expect(sql).toContain('BEGIN READ ONLY;');
        expect(sql).toContain("'vkkahxsybhbutszerawz'");
        expect(sql).toContain('rawStatementsReturned');
        expect(sql).toContain('rawStatementsPersisted');
        expect(sql).toContain('privateRowsSelected');
        expect(sql).toContain('externalWritePerformed');
        expect(sql).toContain('statement_sha256');
        expect(sql).toContain('remote_009_descriptors');
        expect(sql).not.toMatch(/SELECT\s+(?:\w+\.)?statement(?:\s|,|$)/iu);
        expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/imu);
        expect(sql).not.toMatch(/FROM\s+(?:auth\.users|public\.profiles_private)\b/iu);
    });

    it('wires the exception only behind explicit manifest, opt-in, approval and live readback gates', () => {
        expect(rolloutPlan).toContain('--history-reconciliation-manifest');
        expect(rolloutRunner).toContain('--history-reconciliation-manifest');
        expect(rolloutRunner).toContain('--accept-reviewed-history-exception');
        expect(rolloutRunner).toContain('PRODUCTION_HISTORY_EXCEPTION_APPROVAL_ENV');
        expect(rolloutRunner).toContain("runPsql(\n        'live-history-reconciliation'");
        expect(rolloutRunner).toContain('validateLiveHistoryReconciliationSnapshot');
        expect(packageJson).toContain('"launch:supabase-production-history-reconciliation"');
    });

    it('accepts only the exact fresh source-bound manifest from the allowlisted output family', () => {
        const parsed = parseHistoryReconciliationSnapshot(JSON.stringify(snapshot()), now);
        const manifest = buildHistoryReconciliationManifest(parsed, process.cwd(), fakeLineage());
        const directory = path.join('outputs', 'launch-supabase-production-history-reconciliation', 'unit-consumer-valid');
        const manifestPath = path.join(directory, 'immutable-review-manifest.json');
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        try {
            writeFileSync(manifestPath, stableJson(manifest), 'utf8');
            const evidence = readHistoryReconciliationManifestEvidence(manifestPath, now, process.cwd());
            expect(evidence).toMatchObject({ provided: true, valid: true });
            expect(evidence.exactActivationApproval).toContain('migration_repair=FORBIDDEN');
            expect(evidence.exactActivationApproval).toContain('target=vkkahxsybhbutszerawz');

            const tampered = structuredClone(manifest) as any;
            tampered.evidence.effectChecks[0].observed = 'tampered';
            writeFileSync(manifestPath, stableJson(tampered), 'utf8');
            expect(readHistoryReconciliationManifestEvidence(manifestPath, now, process.cwd()).valid).toBe(false);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('accepts the canonical psql read-only capture provenance in a fresh manifest', () => {
        const captured = snapshot();
        captured.provenance = 'supabase_history_capture_psql_readonly';
        const parsed = parseHistoryReconciliationSnapshot(
            JSON.stringify(captured),
            now,
            'supabase_history_capture_psql_readonly',
        );
        const manifest = buildHistoryReconciliationManifest(parsed, process.cwd(), fakeLineage());
        const directory = path.join('outputs', 'launch-supabase-production-history-reconciliation', 'unit-consumer-psql');
        const manifestPath = path.join(directory, 'immutable-review-manifest.json');
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        try {
            writeFileSync(manifestPath, stableJson(manifest), 'utf8');
            expect(readHistoryReconciliationManifestEvidence(manifestPath, now, process.cwd())).toMatchObject({
                provided: true,
                valid: true,
                errors: [],
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('allows only the four exact production drift mappings and fails closed on any fifth or mutated mapping', () => {
        const parsed = parseHistoryReconciliationSnapshot(JSON.stringify(snapshot()), now);
        const manifest = buildHistoryReconciliationManifest(parsed, process.cwd(), fakeLineage());
        const directory = path.join('outputs', 'launch-supabase-production-history-reconciliation', 'unit-consumer-drift');
        const manifestPath = path.join(directory, 'immutable-review-manifest.json');
        rmSync(directory, { recursive: true, force: true });
        mkdirSync(directory, { recursive: true });
        try {
            writeFileSync(manifestPath, stableJson(manifest), 'utf8');
            const evidence = readHistoryReconciliationManifestEvidence(manifestPath, now, process.cwd());
            const preflight = driftPreflight();
            expect(validateAllowlistedHistoryDrift(preflight, evidence)).toEqual([]);

            const fifth = structuredClone(preflight);
            fifth.migrationInventory.localMigrations.push({
                ...fifth.migrationInventory.localMigrations[0],
                version: '010',
                name: 'unexpected',
            });
            fifth.migrationInventory.versionNameMismatchCount = 2;
            expect(validateAllowlistedHistoryDrift(fifth, evidence).length).toBeGreaterThan(0);

            const sourceDrift = structuredClone(preflight);
            sourceDrift.migrationInventory.localMigrations[0].sha256 = '0'.repeat(64);
            expect(validateAllowlistedHistoryDrift(sourceDrift, evidence)).toContain('History exception mapping mismatch for 009.');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('requires a five-minute live snapshot and seals the Supabase connector fallback', () => {
        const live = snapshot();
        live.provenance = 'production_rollout_psql_readonly';
        const liveNow = new Date('2026-07-14T18:53:00.000Z');
        expect(validateLiveHistoryReconciliationSnapshot(JSON.stringify(live), liveNow)).toMatchObject({
            provenance: 'production_rollout_psql_readonly',
            observedProvenance: 'production_rollout_psql_readonly',
            provenanceNormalization: 'none',
        });
        live.provenance = 'supabase_connector_execute_sql';
        expect(validateLiveHistoryReconciliationSnapshot(JSON.stringify(live), liveNow)).toMatchObject({
            provenance: 'production_rollout_psql_readonly',
            observedProvenance: 'supabase_connector_execute_sql',
            provenanceNormalization: 'connector_fallback_sealed',
        });

        const tamperedFallback = snapshot();
        tamperedFallback.provenance = 'supabase_connector_execute_sql';
        tamperedFallback.effectChecks[0].passed = false;
        expect(() => validateLiveHistoryReconciliationSnapshot(JSON.stringify(tamperedFallback), liveNow))
            .toThrow(/schema validation/i);

        const staleFallback = snapshot();
        staleFallback.provenance = 'supabase_connector_execute_sql';
        staleFallback.capturedAt = '2026-07-14T18:47:59.000Z';
        expect(() => validateLiveHistoryReconciliationSnapshot(JSON.stringify(staleFallback), liveNow))
            .toThrow();

        live.provenance = 'supabase_history_capture_psql_readonly';
        expect(() => validateLiveHistoryReconciliationSnapshot(JSON.stringify(live), liveNow)).toThrow(/provenance/i);
    });
});

function snapshot(): any {
    return {
        schemaVersion: 1,
        capturedAt,
        provenance: 'supabase_connector_execute_sql',
        target: {
            environment: 'production',
            name: 'espanolhonesto',
            ref: 'vkkahxsybhbutszerawz',
            database: 'postgres',
        },
        safety: {
            transactionReadOnly: true,
            rawStatementsPersisted: false,
            rawStatementsReturned: false,
            privateRowsSelected: false,
            externalWritePerformed: false,
        },
        historyRows: structuredClone(HISTORY_EXPECTATIONS),
        remote009Descriptors: [
            descriptor(1, 'create_table', 853),
            descriptor(2, 'create_index', 121),
            descriptor(3, 'create_index', 91),
            descriptor(4, 'create_index', 81),
            descriptor(5, 'create_index', 95),
            descriptor(6, 'enable_rls', 49),
        ],
        effectChecks: EFFECT_EXPECTATIONS.map((item) => ({ ...item, passed: true })),
    };
}

function descriptor(ordinal: number, operation: string, statement_bytes: number) {
    return {
        ordinal,
        operation,
        object_name: 'public.jobs',
        statement_bytes,
        statement_sha256: HISTORY_EXPECTATIONS[0].statementSha256[ordinal - 1],
    };
}

function fakeLineage(): Record<string, unknown> {
    return {
        commitsTouchingLocal009: ['05dca85e592efd1fb83e8d7851f7d23adf3c7697\t2026-06-02T14:04:49+02:00\tfeat: prepare launch catalog and fulfillment'],
        firstAndOnlyCommit: '05dca85e592efd1fb83e8d7851f7d23adf3c7697',
        sourceBlobSha1: '1ae157a693b802e43c253a9649af4f204ca14e3a',
        historical009JobsPaths: [],
        remote009SourceFoundInReachableGitHistory: false,
    };
}

function driftPreflight(): any {
    return {
        target: { ref: 'vkkahxsybhbutszerawz' },
        endedAt: capturedAt,
        migrationInventory: {
            ambiguousCount: 0,
            versionNameMismatchCount: 1,
            duplicateSemanticHistoryCount: 3,
            localMigrations: [
                migration('009', 'launch_catalog_and_fulfillment', 'supabase/migrations/009_launch_catalog_and_fulfillment.sql', 4_994, 'a7d9481607efc62188585419aa765400add2cffaec37f8d4fac18768ede91ffd', ['009'], true, false),
                migration('021', 'harden_session_write_policies', 'supabase/migrations/021_harden_session_write_policies.sql', 769, '5a547504b82208552751412368fd46ed7bf3efa9ab5f0f8ad8a9f11c528d21c5', ['021', '20260703192245'], false, true),
                migration('022', 'track_stripe_webhook_processing_state', 'supabase/migrations/022_track_stripe_webhook_processing_state.sql', 1_296, '398b2838c506e0c026c60489c25ed4fb3c337341c68779b676a5f7cec1d1b4f8', ['022', '20260703192307'], false, true),
                migration('20260702124757', 'harden_profile_role_trigger', 'supabase/migrations/20260702124757_harden_profile_role_trigger.sql', 1_429, 'a45c03c7aa39288c9b63dc9534ac3fc5941bed6d47855d64f7d8d36c4a27a1e3', ['20260702124757', '20260703192329'], false, true),
            ],
        },
    };
}

function migration(version: string, name: string, file: string, bytes: number, sha256: string, remoteVersions: string[], versionNameMismatch: boolean, duplicateSemanticHistory: boolean): any {
    return {
        order: 1,
        version,
        name,
        file,
        sha256,
        bytes,
        stagingOnly: false,
        plannedWave: null,
        historyStatus: 'exact',
        remoteVersions,
        versionNameMismatch,
        duplicateSemanticHistory,
    };
}
