import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    importProductionConnectorPreflight,
    parseProductionConnectorPreflightArgs,
    parseProductionConnectorSnapshot,
    type ProductionConnectorSnapshot,
} from '../../scripts/launch/supabase-production-connector-preflight';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_MIGRATIONS,
    collectLocalMigrations,
} from '../../scripts/launch/supabase-production-rollout-shared';
import {
    PRODUCTION_ROLLOUT_MIGRATIONS,
    readProductionPreflightEvidence,
} from '../../scripts/launch/supabase-production-rollout-runner-shared';

const repositoryRoot = process.cwd();
const now = new Date('2026-07-12T15:00:00.000Z');
let root: string;

describe('Supabase production connector preflight importer', () => {
    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), 'supabase-connector-preflight-'));
        mkdirSync(path.join(root, 'supabase'), { recursive: true });
        cpSync(
            path.join(repositoryRoot, 'supabase', 'migrations'),
            path.join(root, 'supabase', 'migrations'),
            { recursive: true },
        );
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('accepts only the required --snapshot argument', () => {
        expect(parseProductionConnectorPreflightArgs(['--snapshot', 'capture.json']))
            .toEqual({ snapshotPath: 'capture.json' });
        expect(parseProductionConnectorPreflightArgs(['--', '--snapshot', 'capture.json']))
            .toEqual({ snapshotPath: 'capture.json' });
        expect(() => parseProductionConnectorPreflightArgs([])).toThrow('--snapshot is required');
        expect(() => parseProductionConnectorPreflightArgs(['--output', 'elsewhere']))
            .toThrow('Unknown production connector preflight argument');
        expect(() => parseProductionConnectorPreflightArgs([
            '--snapshot',
            'first.json',
            '--snapshot',
            'second.json',
        ])).toThrow('--snapshot may only be supplied once');
    });

    it('emits compatible evidence with explicit connector provenance only under outputs', () => {
        const snapshotPath = writeSnapshot(validSnapshot());
        const result = importProductionConnectorPreflight({ snapshotPath, root, now });
        const expectedOutputsRoot = path.join(root, 'outputs');

        expect(path.relative(expectedOutputsRoot, result.summaryPath)).not.toMatch(/^\.\./u);
        expect(readdirSync(result.outputDir)).toEqual(['summary.json']);
        expect(result.report).toMatchObject({
            schemaVersion: 1,
            endedAt: now.toISOString(),
            mode: 'connector_snapshot_import_read_only',
            target: { ref: PRODUCTION_PROJECT.ref },
            provenance: {
                source: 'supabase_connector_execute_sql',
                rawSnapshotStored: false,
                localMigrationInventoryRecalculated: true,
            },
            safety: {
                noExternalWrite: true,
                noPrivateRowsSelected: true,
                noSecretsStored: true,
                readOnlyTransaction: true,
            },
        });
        expect(result.report.migrationInventory.localMigrations)
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ version: '20260712112000', historyStatus: 'missing' }),
                ...STAGING_ONLY_MIGRATIONS.map((migration) => expect.objectContaining({
                    ...migration,
                    stagingOnly: true,
                    historyStatus: 'missing',
                })),
            ]));
        expect(result.report.migrationInventory.semanticMissingCountExcludingStagingOnly).toBe(25);
        expect(readProductionPreflightEvidence(result.summaryPath, now, root))
            .toMatchObject({ valid: true, errors: [] });
    });

    it.each(STAGING_ONLY_MIGRATIONS)(
        'fails closed when staging-only history is present for $version',
        (migration) => {
            const snapshot = validSnapshot();
            snapshot.remoteMigrations.push({ ...migration });
            expectImportToFail(snapshot, 'missing, misclassified or not absent from production');
        },
    );

    it('accepts the exact aggregate-only rollout evidence shapes while keeping them optional', () => {
        const snapshot = validSnapshot();
        addExactRolloutAggregates(snapshot);

        const parsed = parseProductionConnectorSnapshot(JSON.stringify(snapshot), now);
        expect(parsed.aggregates).toMatchObject({
            fixture_distributions: {
                profiles_by_role: { admin: 1, student: 136, teacher: 1 },
            },
            billing_legacy_hazard: {
                stripe_linked: 27,
                stripe_linked_breakdown: expect.arrayContaining([
                    expect.objectContaining({ package_key: 'standard', fixture_count: 1 }),
                ]),
            },
            billing_package_price_links: {
                column_present: false,
                stripe_linked_without_package_price: 27,
            },
            baseline_history_effects: {
                packages_updated_at_column_present: true,
                pg_graphql_absent: true,
            },
            processed_at_posture: {
                column_default: 'now()',
                total: 184,
                invalid_status: 0,
                null_status: 0,
                processing_with_processed_at: 0,
            },
        });
    });

    it('requires the exact live fixture-count class set used by the cleanup contract', () => {
        const missing = validSnapshot() as unknown as {
            aggregates: { fixture_counts: Record<string, unknown> };
        };
        delete missing.aggregates.fixture_counts.support_tickets;
        expect(() => parseProductionConnectorSnapshot(JSON.stringify(missing), now))
            .toThrow('schema validation failed');

        const legacyAlias = validSnapshot() as unknown as {
            aggregates: { fixture_counts: Record<string, unknown> };
        };
        legacyAlias.aggregates.fixture_counts.legacy_jobs = legacyAlias.aggregates.fixture_counts.jobs;
        delete legacyAlias.aggregates.fixture_counts.jobs;
        expect(() => parseProductionConnectorSnapshot(JSON.stringify(legacyAlias), now))
            .toThrow('schema validation failed');
    });

    it('rejects cross-aggregate billing contradictions before producing rollout evidence', () => {
        const snapshot = validSnapshot();
        addExactRolloutAggregates(snapshot);
        snapshot.aggregates.billing_package_price_links!.stripe_linked_without_package_price = 0;

        expectImportToFail(snapshot, 'aggregate coherence failed');
    });

    it('rejects unknown or private fields inside the optional aggregate breakdown', () => {
        const snapshot = validSnapshot();
        addExactRolloutAggregates(snapshot);
        const breakdown = snapshot.aggregates.billing_legacy_hazard!.stripe_linked_breakdown[0] as {
            customer_email?: string;
        };
        breakdown.customer_email = 'private-customer@example.test';

        let error: Error | null = null;
        try {
            parseProductionConnectorSnapshot(JSON.stringify(snapshot), now);
        } catch (caught) {
            error = caught as Error;
        }
        expect(error?.message).toContain('schema validation failed');
        expect(error?.message).not.toContain('private-customer@example.test');
    });

    it('rejects wrong target identity before creating outputs', () => {
        const snapshot = validSnapshot();
        snapshot.target.ref = 'aaaaaaaaaaaaaaaaaaaa';
        expectImportToFail(snapshot, 'target ref mismatch');

        const wrongRegion = validSnapshot();
        wrongRegion.target.region = 'eu-central-1';
        expectImportToFail(wrongRegion, 'production identity mismatch');
    });

    it('rejects known historical version/name drift fail-closed', () => {
        const snapshot = validSnapshot();
        const historical009 = snapshot.remoteMigrations.find((migration) => migration.version === '009');
        expect(historical009).toBeDefined();
        historical009!.name = 'jobs';
        expectImportToFail(snapshot, 'version/name drift');
    });

    it('rejects duplicate semantic history fail-closed', () => {
        const snapshot = validSnapshot();
        snapshot.remoteMigrations.push(
            { version: '20260703192245', name: '021_harden_session_write_policies' },
            { version: '20260703192307', name: '022_track_stripe_webhook_processing_state' },
            { version: '20260703192329', name: '20260702124757_harden_profile_role_trigger' },
        );
        expectImportToFail(snapshot, 'duplicate semantic entries');
    });

    it('rejects stale and future captures instead of refreshing their evidence time', () => {
        const stale = validSnapshot();
        stale.capturedAt = new Date(now.getTime() - 24 * 60 * 60 * 1_000 - 1).toISOString();
        expectImportToFail(stale, 'snapshot is stale');

        const future = validSnapshot();
        future.capturedAt = new Date(now.getTime() + 1).toISOString();
        expectImportToFail(future, 'capturedAt is in the future');
    });

    it.each(['readOnlyTransaction', 'noPrivateRowsSelected', 'noSecretsStored', 'noExternalWrite'] as const)(
        'rejects a snapshot without the %s assertion',
        (assertion) => {
            const snapshot = validSnapshot();
            (snapshot.safety as Record<string, boolean>)[assertion] = false;
            expectImportToFail(snapshot, 'schema validation failed');
        },
    );

    it('rejects unknown fields and private row identifiers without echoing their value', () => {
        const snapshot = validSnapshot() as ProductionConnectorSnapshot & {
            aggregates: ProductionConnectorSnapshot['aggregates'] & {
                student_ids: string[];
            };
        };
        snapshot.aggregates.student_ids = ['private-student-value'];
        const raw = JSON.stringify(snapshot);

        let error: Error | null = null;
        try {
            parseProductionConnectorSnapshot(raw, now);
        } catch (caught) {
            error = caught as Error;
        }
        expect(error?.message).toContain('schema validation failed');
        expect(error?.message).not.toContain('private-student-value');
        expect(existsSync(path.join(root, 'outputs'))).toBe(false);
    });

    it.each([
        {
            label: 'non-numeric version',
            mutate: (snapshot: ProductionConnectorSnapshot) => {
                snapshot.remoteMigrations[0].version = 'bad-version';
            },
        },
        {
            label: 'unsafe migration name',
            mutate: (snapshot: ProductionConnectorSnapshot) => {
                snapshot.remoteMigrations[0].name = 'contains@email.example';
            },
        },
        {
            label: 'duplicate version',
            mutate: (snapshot: ProductionConnectorSnapshot) => {
                snapshot.remoteMigrations.push({ ...snapshot.remoteMigrations[0] });
            },
        },
    ])('rejects malformed remote migrations: $label', ({ mutate }) => {
        const snapshot = validSnapshot();
        mutate(snapshot);
        expectImportToFail(snapshot, 'schema validation failed');
    });

    it('contains no service client or database credential path', () => {
        const source = readFileSync(
            path.join(repositoryRoot, 'scripts/launch/supabase-production-connector-preflight.ts'),
            'utf8',
        );
        expect(source).not.toContain('SUPABASE_DB_URL');
        expect(source).not.toContain('child_process');
        expect(source).not.toContain('fetch(');
        expect(source).not.toMatch(/\bexecute_sql\s*\(/u);
        expect(source).toContain("z.literal('supabase_connector_execute_sql')");
    });
});

function validSnapshot(): ProductionConnectorSnapshot {
    const rolloutVersions = new Set(PRODUCTION_ROLLOUT_MIGRATIONS.map((migration) => migration.version));
    const remoteMigrations = collectLocalMigrations(repositoryRoot)
        .filter((migration) => !migration.stagingOnly && !rolloutVersions.has(migration.version))
        .map(({ version, name }) => ({ version, name }));
    return {
        schemaVersion: 1,
        capturedAt: now.toISOString(),
        provenance: 'supabase_connector_execute_sql',
        target: {
            environment: PRODUCTION_PROJECT.environment,
            name: PRODUCTION_PROJECT.name,
            ref: PRODUCTION_PROJECT.ref,
            region: PRODUCTION_PROJECT.region,
        },
        safety: {
            readOnlyTransaction: true,
            noPrivateRowsSelected: true,
            noSecretsStored: true,
            noExternalWrite: true,
        },
        remoteMigrations,
        aggregates: {
            fixture_counts: {
                auth_users: 138,
                profiles: 138,
                profiles_private: 138,
                packages: 5,
                subscriptions: 84,
                student_teachers: 60,
                sessions: 700,
                payments: 108,
                leads: 10,
                processed_webhook_events: 184,
                fulfillment_jobs: 0,
                admin_audit_log: 0,
                teacher_availability: 0,
                jobs: 111,
                support_tickets: 2,
            },
            schema_hazards: {
                package_prices_table_present: false,
                checkout_intents_table_present: false,
                email_recipient_budget_usage_table_present: false,
                fulfillment_effects_table_present: false,
                staging_smoke_table_present: false,
                legacy_jobs_table_present: true,
                leads_updated_at_present: false,
                leads_status_udt: 'pg_catalog.text',
                leads_lang_default: null,
                leads_consent_default: null,
                public_is_admin_present: true,
                private_is_admin_present: true,
                processed_at_default: 'now()',
            },
            data_hazards: {
                unsupported_lead_status: 0,
                invalid_session_roles: 646,
                unsupported_session_duration: 700,
                invalid_assignments: 62,
                nonstudent_subscriptions: 1,
                active_overlapping_availability: 0,
            },
            database_context: {
                server_version: '17.6',
                database_size_bytes: 16_845_971,
            },
        },
    };
}

function addExactRolloutAggregates(snapshot: ProductionConnectorSnapshot): void {
    snapshot.aggregates.fixture_distributions = {
        profiles_by_role: { admin: 1, student: 136, teacher: 1 },
        subscriptions_by_status: { active: 58, cancelled: 26 },
        sessions_by_status: { no_show: 13, cancelled: 653, completed: 16, scheduled: 18 },
        payments_by_status: { failed: 26, succeeded: 82 },
    };
    snapshot.aggregates.billing_legacy_hazard = {
        total_subscriptions: 84,
        stripe_linked: 27,
        active_stripe_linked: 1,
        cancelled_stripe_linked: 26,
        package_price_id_column_present: false,
        stripe_linked_breakdown: [
            {
                status: 'active',
                package_key: 'standard',
                duration_months: 6,
                fixture_count: 1,
            },
            {
                status: 'cancelled',
                package_key: 'essential',
                duration_months: 3,
                fixture_count: 26,
            },
        ],
    };
    snapshot.aggregates.billing_package_price_links = {
        column_present: false,
        stripe_linked_without_package_price: 27,
        all_subscriptions_without_package_price: 84,
    };
    snapshot.aggregates.baseline_history_effects = {
        packages_updated_at_column_present: true,
        fulfillment_jobs_table_present: true,
        admin_audit_log_table_present: true,
        support_tickets_table_present: true,
        support_tickets_rls_enabled: true,
        private_is_admin_present: true,
        public_is_admin_present: true,
        public_is_admin_public_execute_absent: true,
        public_is_admin_anon_execute_absent: true,
        public_is_admin_authenticated_execute_absent: true,
        public_is_admin_service_role_execute_present: true,
        pg_graphql_absent: true,
    };
    snapshot.aggregates.processed_at_posture = {
        column_default: 'now()',
        total: 184,
        invalid_status: 0,
        null_status: 0,
        processing_with_processed_at: 0,
    };
}

function writeSnapshot(snapshot: unknown): string {
    const snapshotPath = path.join(root, 'connector-snapshot.json');
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    return snapshotPath;
}

function expectImportToFail(snapshot: unknown, expectedMessage: string): void {
    const snapshotPath = writeSnapshot(snapshot);
    expect(() => importProductionConnectorPreflight({ snapshotPath, root, now }))
        .toThrow(expectedMessage);
    expect(existsSync(path.join(root, 'outputs'))).toBe(false);
}
