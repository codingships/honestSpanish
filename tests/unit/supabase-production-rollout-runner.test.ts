import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    FIXTURE_CLEANUP_TARGET,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    PRODUCTION_ROLLOUT_APPROVAL_ENV,
    PRODUCTION_ROLLOUT_MIGRATIONS,
    PRODUCTION_ROLLOUT_WAVES,
    PRODUCTION_ROLLOUT_PSQL_GATE,
    buildProductionRolloutApproval,
    deriveWaveHistoryStates,
    expectedProductionWaveVerificationFacts,
    readAuthPolicyEvidence,
    readBackupReceiptEvidence,
    readFixtureCleanupEvidence,
    readGoogleFixturePolicyEvidence,
    readProductionPreflightEvidence,
    readSentryProductionHardeningEvidence,
    readStagingHardeningEvidence,
    renderProductionLivePreflightSql,
    renderProductionWaveApplySql,
    renderProductionWaveVerifySql,
    selectedWavesThrough,
    validateLiveHistoryFacts,
    validateProductionRolloutAllowlist,
    type ProductionPreflightEvidence,
    type ProductionRolloutMigration,
} from '../../scripts/launch/supabase-production-rollout-runner-shared';
import { parseProductionRolloutArgs } from '../../scripts/launch/supabase-production-rollout-runner';
import {
    PRODUCTION_PROJECT,
    STAGING_ONLY_VERSION,
    type MigrationHistoryMapping,
} from '../../scripts/launch/supabase-production-rollout-shared';

const runnerSource = readFileSync('scripts/launch/supabase-production-rollout-runner.ts', 'utf8');
const sharedSource = readFileSync('scripts/launch/supabase-production-rollout-runner-shared.ts', 'utf8');

describe('Supabase production wave rollout runner', () => {
    it('pins the exact 23 migrations in seven dependency-ordered waves and excludes staging smoke', () => {
        expect(PRODUCTION_ROLLOUT_WAVES.map((wave) => wave.migrations.length)).toEqual([1, 1, 7, 7, 4, 1, 2]);
        expect(PRODUCTION_ROLLOUT_MIGRATIONS).toHaveLength(23);
        expect(new Set(PRODUCTION_ROLLOUT_MIGRATIONS.map((entry) => entry.version)).size).toBe(23);
        expect(PRODUCTION_ROLLOUT_MIGRATIONS.some((entry) => entry.version === STAGING_ONLY_VERSION)).toBe(false);
        expect(validateProductionRolloutAllowlist()).toMatchObject({ valid: true, errors: [] });
        expect(selectedWavesThrough('billing_contract').map((wave) => wave.id)).toEqual([
            'processed_at_small_fix',
            'base_model_reconciliation',
            'application_schema',
            'runtime_and_policy',
            'billing_contract',
        ]);
    });

    it('defaults to a local plan and makes execute intent explicit and non-ambiguous', () => {
        expect(parseProductionRolloutArgs([])).toMatchObject({
            executeApproved: false,
            checkoutDisabledConfirmed: false,
            through: 'deferred_rc_hardening',
            throughExplicit: false,
        });
        expect(parseProductionRolloutArgs([
            '--execute-approved',
            '--checkout-disabled-confirmed',
            '--through',
            'billing_contract',
            '--preflight',
            'preflight.json',
        ])).toMatchObject({
            executeApproved: true,
            checkoutDisabledConfirmed: true,
            through: 'billing_contract',
            throughExplicit: true,
        });
        expect(() => parseProductionRolloutArgs(['--checkout-disabled-confirmed'])).toThrow();
        expect(() => parseProductionRolloutArgs(['--through', 'unknown'])).toThrow();
    });

    it('requires one coherent fresh preflight and rejects partial-wave or staging-only history', () => {
        withTempDirectory((directory) => {
            const now = new Date('2026-07-12T12:00:00.000Z');
            const preflight = preflightEvidence('2026-07-12T11:30:00.000Z');
            const validPath = writeJson(directory, 'preflight.json', preflight);
            expect(readProductionPreflightEvidence(validPath, now)).toMatchObject({ valid: true, errors: [] });
            expect(deriveWaveHistoryStates(preflight).map((entry) => entry.state)).toEqual(Array(7).fill('pending'));

            const partial = structuredClone(preflight);
            partial.migrationInventory.localMigrations[1].historyStatus = 'exact';
            partial.migrationInventory.semanticMissingCountExcludingStagingOnly = 22;
            const partialPath = writeJson(directory, 'partial.json', partial);
            expect(readProductionPreflightEvidence(partialPath, now)).toMatchObject({ valid: false });

            const stagingPresent = structuredClone(preflight);
            stagingPresent.migrationInventory.localMigrations.at(-1)!.historyStatus = 'exact';
            const stagingPath = writeJson(directory, 'staging-present.json', stagingPresent);
            expect(readProductionPreflightEvidence(stagingPath, now)).toMatchObject({ valid: false });

            const malformed = structuredClone(preflight) as unknown as {
                migrationInventory: Record<string, unknown>;
            };
            malformed.migrationInventory.localMigrations = null;
            expect(readProductionPreflightEvidence(writeJson(directory, 'malformed.json', malformed), now))
                .toMatchObject({ valid: false });

            const aliased = structuredClone(preflight);
            aliased.migrationInventory.localMigrations[0].historyStatus = 'alias';
            aliased.migrationInventory.semanticMissingCountExcludingStagingOnly = 22;
            expect(readProductionPreflightEvidence(writeJson(directory, 'aliased.json', aliased), now))
                .toMatchObject({ valid: false });
        });
    });

    it('renders each wave as one exact gated transaction with source-bound history', () => {
        const allowlist = validateProductionRolloutAllowlist();
        const wave = PRODUCTION_ROLLOUT_WAVES[1];
        const scopeSha256 = 'a'.repeat(64);
        const sql = renderProductionWaveApplySql({ wave, sources: allowlist.sources, scopeSha256 });
        expect(sql).toContain('\\set ON_ERROR_STOP on');
        expect(sql).toContain('BEGIN;');
        expect(sql).toContain('COMMIT;');
        expect(sql).toContain(PRODUCTION_ROLLOUT_PSQL_GATE);
        expect(sql).toContain(PRODUCTION_PROJECT.ref);
        expect(sql).toContain(`PRODUCTION_ROLLOUT_WAVE_COMMITTED|wave=${wave.id}|scope=${scopeSha256}`);
        expect(sql.match(/INSERT INTO supabase_migrations\.schema_migrations/gu)).toHaveLength(wave.migrations.length);
        for (const entry of wave.migrations) {
            expect(sql).toContain(entry.file);
            expect(sql).toContain(`-- sha256 ${entry.sha256}`);
            expect(sql).toContain(`$production_rollout_${entry.version}$`);
            expect(sql.indexOf(entry.file)).toBeLessThan(sql.indexOf(`VALUES ('${entry.version}'`));
        }
        expect(sql).not.toContain('staging_integration_smoke_runs.sql');
        expect(sql).not.toContain('supabase db push');
        expect(sql).not.toContain('supabase migration repair');
    });

    it('rechecks the current inert database state immediately before any operational wave', () => {
        const preflight = preflightEvidence('2026-07-12T11:30:00.000Z');
        const sql = renderProductionLivePreflightSql();
        for (const key of [
            'inert_auth_users',
            'inert_auth_sessions',
            'inert_auth_refresh_tokens',
            'inert_profiles',
            'inert_profiles_private',
            'inert_legacy_jobs_absent',
            'inert_public_fixture_rows',
            'inert_packages_clean',
        ]) expect(sql).toContain(`'${key}'`);

        const facts = new Map<string, string>([
            ['current_database', 'postgres'],
            ['history_columns', 'name,statements,version'],
            ['staging_only_count', '0'],
            ['inert_auth_users', '2'],
            ['inert_auth_sessions', '0'],
            ['inert_auth_refresh_tokens', '0'],
            ['inert_profiles', '0'],
            ['inert_profiles_private', '0'],
            ['inert_legacy_jobs_absent', 'true'],
            ['inert_public_fixture_rows', '0'],
            ['inert_packages_clean', 'true'],
            ...PRODUCTION_ROLLOUT_MIGRATIONS.map((entry) => [`history:${entry.version}`, '0'] as [string, string]),
        ]);
        expect(validateLiveHistoryFacts(facts, preflight, true)).toEqual([]);
        facts.set('inert_auth_users', '3');
        expect(validateLiveHistoryFacts(facts, preflight, true)).toContain(
            'inert_auth_users: expected 2, observed 3.',
        );
    });

    it('verifies exact history source hashes and wave-specific schema effects read-only', () => {
        const waves = selectedWavesThrough('fulfillment_ledger');
        const sql = renderProductionWaveVerifySql(waves);
        const expected = expectedProductionWaveVerificationFacts(waves);
        expect(sql).toContain('BEGIN READ ONLY;');
        expect(sql).toContain("history.statements[1]");
        expect(sql).toContain("extensions.digest(convert_to(history.statements[1], 'UTF8'), 'sha256')");
        expect(sql).toContain("'billing_fixture_rows_absent'");
        expect(sql).toContain("'fulfillment_effects_empty'");
        expect(sql).toContain("'model_leads_status_contract'");
        expect(sql).toContain("'model_leads_acl_valid'");
        expect(sql).toContain("'model_sessions_reminder_contract'");
        expect(sql).toContain("'model_student_teacher_profile_policy'");
        expect(expected.get('model_reconciliation_indexes')).toBe('2');
        expect(expected.get('model_public_is_admin_absent')).toBe('true');
        expect(expected.get('history_verified_count')).toBe('21');
        expect(expected.get('staging_only_absent')).toBe('true');
    });

    it('verifies the final availability trigger and all required operational indexes', () => {
        const waves = selectedWavesThrough('deferred_rc_hardening');
        const sql = renderProductionWaveVerifySql(waves);
        const expected = expectedProductionWaveVerificationFacts(waves);
        expect(sql).toContain("'hardening_availability_updated_at_trigger'");
        expect(sql).toContain("'hardening_session_duration_contract'");
        expect(sql).toContain("'hardening_required_indexes'");
        expect(expected.get('hardening_availability_updated_at_trigger')).toBe('true');
        expect(expected.get('hardening_session_duration_contract')).toBe('true');
        expect(expected.get('hardening_required_indexes')).toBe('13');
        expect(expected.get('history_verified_count')).toBe('23');
    });

    it('chains encrypted backup, public cleanup, active Auth quarantine, Google policy and staging proof', () => {
        withTempDirectory((directory) => {
            const now = new Date('2026-07-12T12:00:00.000Z');
            const backupPath = writeJson(directory, 'backup.json', backupReceipt('2026-07-12T11:00:00.000Z'));
            const backup = readBackupReceiptEvidence(backupPath, now);
            expect(backup).toMatchObject({ valid: true });

            const manifest = JSON.parse(readFileSync('scripts/launch/production-fixture-cleanup-manifest.json', 'utf8')) as {
                sql: { execute: { sha256: string } };
            };
            const cleanupPath = writeJson(directory, 'public-cleanup-receipt.json', {
                schemaVersion: 2,
                status: 'PUBLIC_FIXTURE_CLEANUP_EXECUTED_AND_VERIFIED',
                targetProjectRef: PRODUCTION_PROJECT.ref,
                completedAt: '2026-07-12T11:15:00.000Z',
                aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
                approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
                executeSqlSha256: manifest.sql.execute.sha256,
                backupReceiptSha256: backup.sha256,
                packageStripeReferenceSha256: 'c'.repeat(64),
                freezeCutoff: '2026-07-02T18:29:27.580Z',
                postconditions: {
                    authUsers: 138,
                    profiles: 0,
                    profilesPrivate: 0,
                    legacyJobsTableAbsent: true,
                    supportTickets: 0,
                    packages: 4,
                },
                packagesPreserved: ['group', 'standard', 'hybrid', 'bootcamp'],
                localPackageStripeFieldsCleared: true,
                inactiveEssentialDeleted: true,
                externalStripeGoogleStorage: 'UNTOUCHED',
                authNextStep: 'SEPARATE_AUTH_REDUCTION_REQUIRED',
            });
            const cleanup = readFixtureCleanupEvidence(cleanupPath, backup.sha256, now);
            expect(cleanup).toMatchObject({ valid: true });

            const authPath = writeJson(directory, 'auth-reduced-quarantined-receipt.json', {
                schemaVersion: 1,
                status: 'AUTH_REDUCED_QUARANTINED',
                targetProjectRef: PRODUCTION_PROJECT.ref,
                completedAt: '2026-07-12T11:30:00.000Z',
                publicCleanupReceiptSha256: cleanup.sha256,
                backupReceiptSha256: backup.sha256,
                authUsers: 2,
                profiles: 0,
                fixtureStudents: 0,
                passwordsRotatedUnretained: true,
                quarantineUntil: '2026-07-12T13:00:00.000Z',
                storageObjectsTouched: false,
                externalProvidersTouched: false,
                preservedSetSha256: 'd'.repeat(64),
                deletedCandidateSetSha256: 'e'.repeat(64),
                freezeCutoff: '2026-07-02T18:29:27.580Z',
                jwtExpirySeconds: 3600,
                jwtExpirySource: 'management_api',
                refreshSessionsRemaining: 0,
                resetEmailsSent: false,
                googleDriveFixtureFolders: 'UNTOUCHED_110_OBSERVED',
            });
            expect(readAuthPolicyEvidence(authPath, cleanup.sha256, now, backup.sha256)).toMatchObject({ valid: true });
            expect(readAuthPolicyEvidence(authPath, cleanup.sha256, new Date('2026-07-12T13:01:00.000Z'), backup.sha256))
                .toMatchObject({ valid: false });
            expect(readAuthPolicyEvidence(authPath, cleanup.sha256, new Date('2026-07-12T12:50:01.000Z'), backup.sha256))
                .toMatchObject({ valid: false });

            const googlePath = writeJson(directory, 'google-fixture-policy-evidence.json', {
                schemaVersion: 1,
                environment: 'production',
                status: 'TRASHED_AND_VERIFIED',
                completedAt: '2026-07-12T11:45:00.000Z',
                observedActiveRootChildrenBefore: 110,
                observedFoldersBefore: 110,
                activeRootChildrenAfter: 0,
                permanentlyDeleted: 0,
                rootIdStored: false,
            });
            expect(readGoogleFixturePolicyEvidence(googlePath, now)).toMatchObject({ valid: true });

            const stagingPath = writeJson(directory, 'staging-hardening.json', stagingEvidence());
            expect(readStagingHardeningEvidence(stagingPath, now)).toMatchObject({ valid: true });
            const merelyAlready = { ...stagingEvidence(), closureStatus: 'ALREADY_APPLIED_AND_VERIFIED' };
            expect(readStagingHardeningEvidence(writeJson(directory, 'staging-already.json', merelyAlready), now))
                .toMatchObject({ valid: false });
            expect(readStagingHardeningEvidence(writeJson(
                directory,
                'staging-malformed.json',
                { ...stagingEvidence(), migrations: null },
            ), now)).toMatchObject({ valid: false });

            const sentryPath = writeJson(directory, 'sentry-hardening.json', sentryEvidence());
            expect(readSentryProductionHardeningEvidence(sentryPath, now)).toMatchObject({ valid: true });
            expect(readSentryProductionHardeningEvidence(
                writeJson(directory, 'sentry-plan.json', { ...sentryEvidence(), closureStatus: 'PLAN_READY' }),
                now,
            )).toMatchObject({ valid: false });
            expect(readSentryProductionHardeningEvidence(
                writeJson(directory, 'sentry-malformed.json', { ...sentryEvidence(), expectedChanges: null }),
                now,
            )).toMatchObject({ valid: false });
        });
    });

    it('binds the exact approval to all evidence, migration hashes, SQL hashes and exclusions', () => {
        const approval = buildProductionRolloutApproval({
            scopeSha256: '1'.repeat(64),
            allowlistSha256: '2'.repeat(64),
            through: 'deferred_rc_hardening',
            preflightSha256: '3'.repeat(64),
            backupReceiptSha256: '4'.repeat(64),
            cleanupEvidenceSha256: '5'.repeat(64),
            authPolicyEvidenceSha256: '6'.repeat(64),
            stagingEvidenceSha256: '7'.repeat(64),
            googleFixturePolicySha256: '8'.repeat(64),
            sentryHardeningEvidenceSha256: 'a'.repeat(64),
            pendingMigrations: [PRODUCTION_ROLLOUT_MIGRATIONS[0]],
            waveSqlSha256: { processed_at_small_fix: '9'.repeat(64) },
            livePreflightSqlSha256: 'b'.repeat(64),
            waveVerifySqlSha256: { processed_at_small_fix: 'c'.repeat(64) },
            finalVerifySqlSha256: 'd'.repeat(64),
        });
        for (const token of [
            `target=${PRODUCTION_PROJECT.ref}`,
            'through=deferred_rc_hardening',
            `exclude=${STAGING_ONLY_VERSION}`,
            'checkout=DISABLED',
            'db_push=FORBIDDEN',
            'migration_repair=FORBIDDEN',
            `sentry_hardening=${'a'.repeat(64)}`,
            `live_preflight_sql=${'b'.repeat(64)}`,
            `wave_verify_sql=processed_at_small_fix@${'c'.repeat(64)}`,
            `final_verify_sql=${'d'.repeat(64)}`,
            `${PRODUCTION_ROLLOUT_MIGRATIONS[0].version}@${PRODUCTION_ROLLOUT_MIGRATIONS[0].sha256}`,
        ]) expect(approval).toContain(token);
        expect(PRODUCTION_ROLLOUT_APPROVAL_ENV).toBe('SUPABASE_PRODUCTION_ROLLOUT_APPROVAL');
        expect(() => buildProductionRolloutApproval({
            scopeSha256: 'not-a-hash',
            allowlistSha256: '2'.repeat(64),
            through: 'processed_at_small_fix',
            preflightSha256: '3'.repeat(64),
            backupReceiptSha256: null,
            cleanupEvidenceSha256: null,
            authPolicyEvidenceSha256: null,
            stagingEvidenceSha256: null,
            googleFixturePolicySha256: null,
            sentryHardeningEvidenceSha256: null,
            pendingMigrations: [],
            waveSqlSha256: {},
            livePreflightSqlSha256: 'b'.repeat(64),
            waveVerifySqlSha256: {},
            finalVerifySqlSha256: 'd'.repeat(64),
        })).toThrow('non-SHA-256');
    });

    it('does not open a connection before every local gate and never auto-restores or switches', () => {
        const localGate = runnerSource.indexOf('if (executionErrors.length > 0)');
        const databaseCredentialRead = runnerSource.indexOf('const databaseUrl = process.env[PRODUCTION_ROLLOUT_DB_URL_ENV]');
        const psqlCall = runnerSource.indexOf("runPsql('live-preflight'");
        expect(localGate).toBeGreaterThan(-1);
        expect(databaseCredentialRead).toBeGreaterThan(localGate);
        expect(psqlCall).toBeGreaterThan(databaseCredentialRead);
        expect(runnerSource).toContain("status: 'BLOCKED_BEFORE_CONNECTION'");
        expect(runnerSource).toContain("status: 'STOPPED_AMBIGUOUS_WAVE_RESULT'");
        expect(runnerSource).toContain("status: 'STOPPED_AUTH_QUARANTINE_EXPIRED'");
        expect(runnerSource).toContain('authFinalizeRequired: true');
        expect(runnerSource).toContain('sentryProductionHardeningEvidenceSha256');
        expect(runnerSource).toContain("status: 'PRODUCTION_ROLLOUT_ALL_WAVES_APPLIED_AND_VERIFIED'");
        expect(runnerSource).not.toContain("spawnSync('supabase'");
        expect(runnerSource).not.toMatch(/runTool\([^)]*supabase/iu);
        expect(sharedSource).toContain('automatic_down_or_restore=FORBIDDEN');
    });
});

function preflightEvidence(endedAt: string): ProductionPreflightEvidence {
    return {
        schemaVersion: 1,
        endedAt,
        status: 'OK',
        target: { ref: PRODUCTION_PROJECT.ref },
        migrationInventory: {
            localMigrations: [
                ...PRODUCTION_ROLLOUT_MIGRATIONS.map((entry, index) => mappedMigration(entry, index)),
                {
                    ...mappedMigration({
                        version: STAGING_ONLY_VERSION,
                        name: 'staging_integration_smoke_runs',
                        file: `supabase/migrations/${STAGING_ONLY_VERSION}_staging_integration_smoke_runs.sql`,
                        sha256: 'f'.repeat(64),
                    }, 23),
                    stagingOnly: true,
                },
            ],
            semanticMissingCountExcludingStagingOnly: 23,
            ambiguousCount: 0,
        },
        aggregates: {},
        safety: {
            noExternalWrite: true,
            noPrivateRowsSelected: true,
            noSecretsStored: true,
        },
    };
}

function mappedMigration(entry: ProductionRolloutMigration, index: number): MigrationHistoryMapping {
    return {
        order: index + 1,
        version: entry.version,
        name: entry.name,
        file: entry.file,
        sha256: entry.sha256,
        bytes: 1,
        stagingOnly: false,
        plannedWave: null,
        historyStatus: 'missing',
        remoteVersions: [],
        versionNameMismatch: false,
        duplicateSemanticHistory: false,
    };
}

function backupReceipt(createdAt: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        targetProjectRef: PRODUCTION_PROJECT.ref,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        createdAt,
        backupCompleted: true,
        artifactStoredOutsideRepository: true,
        atRestProtection: 'windows_efs',
        atRestProtectionVerified: true,
        artifactSha256: 'a'.repeat(64),
        includedSchemas: ['public', 'auth'],
        verification: 'dump_hash_recorded',
        restoreProcedureReviewed: true,
        limitationsAcknowledged: [
            'storage_objects_not_included',
            'external_stripe_google_not_included',
        ],
    };
}

function stagingEvidence(): Record<string, unknown> {
    const migrations = PRODUCTION_ROLLOUT_WAVES
        .filter((wave) => ['base_model_reconciliation', 'deferred_rc_hardening'].includes(wave.id))
        .flatMap((wave) => wave.migrations);
    return {
        schemaVersion: 1,
        endedAt: '2026-07-12T11:45:00.000Z',
        status: 'OK',
        closureStatus: 'APPLIED_AND_VERIFIED',
        target: { projectRef: 'mzjyvmlxfpzdfdjzxxyj' },
        writeCommandInvoked: true,
        externalWritePerformed: true,
        migrations,
        checks: [{ status: 'ok' }],
    };
}

function sentryEvidence(): Record<string, unknown> {
    return {
        schemaVersion: 1,
        endedAt: '2026-07-12T11:50:00.000Z',
        status: 'OK',
        closureStatus: 'HARDENED_AND_VERIFIED',
        target: {
            organization: 'honestspanish',
            project: 'espanol-honesto-astro',
            environment: 'production',
        },
        executeRequested: true,
        externalWriteAttempted: true,
        externalWritePerformed: true,
        rollbackAttempted: false,
        rollbackComplete: false,
        createdWorkflowCount: 2,
        detectorFingerprint: 'd'.repeat(64),
        ownerFingerprint: 'e'.repeat(64),
        expectedChanges: {
            scrubIPAddresses: true,
            workflows: [
                'EH Production - New and regressed errors',
                'EH Production - Error spike 10 events in 5 minutes',
            ],
            environment: 'production',
        },
        checks: [{ status: 'ok' }],
    };
}

function writeJson(directory: string, fileName: string, value: unknown): string {
    const filePath = path.join(directory, fileName);
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return filePath;
}

function withTempDirectory(run: (directory: string) => void): void {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'eh-production-rollout-test-'));
    try {
        run(directory);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
