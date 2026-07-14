import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    FIXTURE_CLEANUP_APPROVAL_ENV,
    FIXTURE_CLEANUP_PREVIEW_PREFIX,
    FIXTURE_CLEANUP_TARGET,
    buildFixtureCleanupApproval,
    buildPsqlEnvironment,
    loadAndValidateFixtureCleanupManifest,
    parseFixtureCleanupPreview,
    sanitizeOutput,
    validateBackupReceipt,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    executeGateRequested,
    parseFixtureCleanupArgs,
} from '../../scripts/launch/production-fixture-cleanup-runner';

const previewSql = readFileSync(
    'scripts/launch/sql/production-fixture-cleanup-preview.sql',
    'utf8',
);
const executeSql = readFileSync(
    'scripts/launch/sql/production-fixture-cleanup-execute.sql',
    'utf8',
);
const runnerSource = readFileSync(
    'scripts/launch/production-fixture-cleanup-runner.ts',
    'utf8',
);
const manifestSource = readFileSync(
    'scripts/launch/production-fixture-cleanup-manifest.json',
    'utf8',
);
const cleanupScope = JSON.parse(readFileSync(
    'scripts/launch/production-fixture-cleanup-scope-v2.json',
    'utf8',
)) as { deleteFixtureRows: string[]; dropAfterVerifiedDelete: string[] };
const manifest = JSON.parse(manifestSource) as {
    schemaVersion: number;
    snapshotDocument: { path: string; sha256: string };
    approvalScopeDocument: { path: string; sha256: string };
    sql: {
        preview: { sha256: string };
        execute: { sha256: string };
    };
    deleteOrder: string[];
    dropAfterVerifiedDelete: string[];
    authCleanup: { status: string };
};
const authRunnerSource = readFileSync(
    'scripts/launch/supabase-production-auth-cleanup.ts',
    'utf8',
);
const authSharedSource = readFileSync(
    'scripts/launch/supabase-production-auth-cleanup-shared.ts',
    'utf8',
);

describe('production fixture-cleanup safety package', () => {
    it('binds both SQL files to the immutable manifest and exact production snapshot', () => {
        expect(loadAndValidateFixtureCleanupManifest()).toMatchObject({ ok: true, errors: [] });
        expect(manifest.schemaVersion).toBe(2);
        expect(manifest.sql.preview.sha256).toBe(hash(previewSql));
        expect(manifest.sql.execute.sha256).toBe(hash(executeSql));
        expect(manifest.snapshotDocument.sha256).toBe(hash(readFileSync(manifest.snapshotDocument.path, 'utf8')));
        expect(manifest.approvalScopeDocument.sha256).toBe(hash(readFileSync(manifest.approvalScopeDocument.path, 'utf8')));

        for (const binding of [
            FIXTURE_CLEANUP_TARGET.projectRef,
            FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
            FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
            FIXTURE_CLEANUP_TARGET.canonicalPackageSha256,
        ]) {
            expect(previewSql).toContain(binding);
            expect(executeSql).toContain(binding);
        }
    });

    it('keeps preview database-enforced read-only and aggregate-only', () => {
        expect(previewSql).toContain('BEGIN READ ONLY;');
        expect(previewSql).toContain("'baselineMatches'");
        expect(previewSql).toContain("'authDeletion', 'blocked_separate_step'");
        expect(previewSql).toContain(FIXTURE_CLEANUP_PREVIEW_PREFIX);
        expect(previewSql).not.toMatch(/\b(?:DELETE|UPDATE|INSERT|TRUNCATE|ALTER|DROP)\b/iu);
        expect(previewSql).not.toMatch(/SELECT\s+(?:email|id|stripe_subscription_id|raw_user_meta_data)\b/iu);
    });

    it('uses one fail-closed transaction, explicit row assertions and dependency order', () => {
        for (const snippet of [
            'BEGIN;',
            'pg_advisory_xact_lock',
            'IN SHARE ROW EXCLUSIVE MODE',
            'GET DIAGNOSTICS v_deleted = ROW_COUNT',
            "RAISE EXCEPTION 'Schema drift:",
            "RAISE EXCEPTION 'Baseline drift:",
            "RAISE EXCEPTION 'Postcondition failed:",
            'COMMIT;',
            'FIXTURE_CLEANUP_EXECUTE_OK|',
        ]) {
            expect(executeSql).toContain(snippet);
        }

        const statements = [
            'DELETE FROM public.jobs;',
            'DROP TABLE public.jobs;',
            'DELETE FROM public.fulfillment_jobs;',
            'DELETE FROM public.processed_webhook_events;',
            'DELETE FROM public.admin_audit_log;',
            'DELETE FROM public.support_tickets;',
            'DELETE FROM public.payments;',
            'DELETE FROM public.sessions;',
            'DELETE FROM public.student_teachers;',
            'DELETE FROM public.teacher_availability;',
            'DELETE FROM public.subscriptions;',
            'DELETE FROM public.leads;',
            'DELETE FROM public.profiles_private;',
            'DELETE FROM public.profiles;',
            'UPDATE public.packages',
            'DELETE FROM public.packages',
        ];
        let previousIndex = -1;
        for (const statement of statements) {
            const currentIndex = executeSql.indexOf(statement);
            expect(currentIndex).toBeGreaterThan(previousIndex);
            previousIndex = currentIndex;
        }
        expect(manifest.deleteOrder).toEqual([
            'public.jobs',
            'public.fulfillment_jobs',
            'public.processed_webhook_events',
            'public.admin_audit_log',
            'public.support_tickets',
            'public.payments',
            'public.sessions',
            'public.student_teachers',
            'public.teacher_availability',
            'public.subscriptions',
            'public.leads',
            'public.profiles_private',
            'public.profiles',
            'public.packages[name=essential,is_active=false]',
        ]);
        expect(manifest.dropAfterVerifiedDelete).toEqual(['public.jobs']);
        expect(cleanupScope.deleteFixtureRows).toEqual(manifest.deleteOrder);
        expect(cleanupScope.dropAfterVerifiedDelete).toEqual(manifest.dropAfterVerifiedDelete);
        expect(executeSql).toContain('IF v_deleted <> 111 THEN');
        expect(executeSql).toContain('IF v_deleted <> 2 THEN');
        expect(executeSql).toContain("to_regclass('public.jobs') IS NOT NULL");
    });

    it('preserves four canonical packages, clears only local Stripe references, then deletes essential', () => {
        expect(executeSql).toContain("WHERE name IN ('group', 'standard', 'hybrid', 'bootcamp')");
        for (const column of [
            'stripe_product_id = NULL',
            'stripe_price_1m = NULL',
            'stripe_price_3m = NULL',
            'stripe_price_6m = NULL',
        ]) {
            expect(executeSql).toContain(column);
        }
        expect(executeSql).toContain("WHERE name = 'essential' AND is_active = FALSE;");
        expect(executeSql).toContain("v_canonical_sha256 <> '6d17a17ca7bd8a99c2f0ba17522780546b473e49c386cee83d1da9acf08da38e'");
        expect(executeSql).toContain("current_setting('cleanup.package_stripe_reference_sha256')");
    });

    it('never deletes Auth, Storage or external-provider state', () => {
        expect(executeSql).not.toMatch(/DELETE\s+FROM\s+(?:auth|storage)\./iu);
        expect(executeSql).not.toMatch(/\bTRUNCATE\b/iu);
        expect(executeSql).not.toMatch(/\bCASCADE\b/iu);
        expect(executeSql).not.toMatch(/stripe\.com|googleapis|storage\.objects/iu);
        expect(executeSql).toContain("IF (SELECT count(*) FROM auth.users) <> 138 THEN");
        expect(executeSql).toContain('auth_users=BLOCKED_UNTOUCHED_138');
        expect(manifest.authCleanup.status).toBe('BLOCKED_SEPARATE_APPROVAL_AND_WORKFLOW');
    });

    it('drops only the exact verified legacy jobs table and never cascades', () => {
        expect(executeSql.match(/\bDROP\s+TABLE\b/giu)).toEqual(['DROP TABLE']);
        expect(executeSql).toContain('DROP TABLE public.jobs;');
        expect(executeSql).not.toMatch(/DROP\s+TABLE\s+[^;]*\bCASCADE\b/iu);
        expect(executeSql).toContain("v_jobs_shape_sha256 <> 'b707ddc341370795c975b8eddff2ae1394afed9f121ab116306fea2db3e1b1ec'");
        for (const indexName of [
            'jobs_aggregate_idx',
            'jobs_dedupe_key_unique',
            'jobs_kind_status_idx',
            'jobs_pkey',
            'jobs_status_run_after_idx',
        ]) expect(executeSql).toContain(`'${indexName}'`);
        expect(previewSql).toContain("'shape_sha256', (");
        expect(previewSql).toContain("'inbound_references', (");
    });

    it('hands Auth cleanup to the separate resumable quarantine runner', () => {
        expect(manifestSource).toContain('BLOCKED_SEPARATE_APPROVAL_AND_WORKFLOW');
        expect(authRunnerSource).toContain("type Mode = 'plan' | 'preflight' | 'requarantine-preflight' | AuthCleanupPhase");
        expect(authSharedSource).toContain("'auth-reduced-quarantined-receipt.json'");
        expect(authSharedSource).toContain("'auth-policy-receipt.json'");
        expect(authSharedSource).toContain('refreshSessionsRemaining');
        expect(authSharedSource).toContain('quarantineUntil');
    });

    it('requires an exact, fresh, project-bound backup receipt', () => {
        const now = new Date('2026-07-12T12:00:00.000Z');
        const valid = validReceipt('2026-07-12T11:30:00.000Z');
        expect(validateBackupReceipt(valid, now)).toMatchObject({ ok: true, errors: [] });

        expect(validateBackupReceipt({
            ...valid,
            targetProjectRef: 'wrong-project',
            backupCompleted: false,
            createdAt: '2026-07-10T11:30:00.000Z',
        }, now)).toMatchObject({ ok: false });
        expect(validateBackupReceipt({ ...valid, artifactPath: 'C:\\secret\\production.dump' }, now))
            .toMatchObject({ ok: false });
    });

    it('binds the exact approval to SQL, backup, Auth inert and fresh package-reference hashes', () => {
        const approval = buildFixtureCleanupApproval({
            executeSqlSha256: manifest.sql.execute.sha256,
            backupReceiptSha256: 'b'.repeat(64),
            authInertEvidenceSha256: 'd'.repeat(64),
            packageStripeReferenceSha256: 'c'.repeat(64),
        });
        expect(approval).toContain(`target=${FIXTURE_CLEANUP_TARGET.projectRef}`);
        expect(approval).toContain(`execute_sql=${manifest.sql.execute.sha256}`);
        expect(approval).toContain(`backup_receipt=${'b'.repeat(64)}`);
        expect(approval).toContain(`auth_inert_evidence=${'d'.repeat(64)}`);
        expect(approval).toContain(`package_stripe_references=${'c'.repeat(64)}`);
        expect(approval).toContain('auth_users=BLOCKED_UNTOUCHED');
        expect(approval).toContain('post_commit_rollback=VERIFIED_BACKUP_ONLY');
        expect(runnerSource).toContain(`process.env[FIXTURE_CLEANUP_APPROVAL_ENV] !== approvalSentence`);
        expect(runnerSource).toContain('result.stdout.includes(expectedSuccessMarker)');
        expect(FIXTURE_CLEANUP_APPROVAL_ENV).toBe('SUPABASE_PRODUCTION_FIXTURE_CLEANUP_APPROVAL');
    });

    it('rejects wrong targets and never places the database URL in psql arguments', () => {
        expect(buildPsqlEnvironment(
            fixtureDatabaseUrl(`db.${FIXTURE_CLEANUP_TARGET.projectRef}.supabase.co`),
        )).toMatchObject({
            PGHOST: `db.${FIXTURE_CLEANUP_TARGET.projectRef}.supabase.co`,
            PGDATABASE: 'postgres',
        });
        expect(() => buildPsqlEnvironment(
            fixtureDatabaseUrl('db.attacker.supabase.co'),
        )).toThrow('exact approved Supabase production project');
        expect(() => buildPsqlEnvironment([
            'postgresql://postgres.',
            FIXTURE_CLEANUP_TARGET.projectRef,
            ':fixture-secret@attacker.example/postgres',
        ].join(''))).toThrow('exact approved Supabase production project');

        expect(runnerSource).toContain('buildDatabaseToolProcessEnvironment(input.databaseEnvironment');
        expect(runnerSource).not.toContain('{ ...process.env }');
        expect(runnerSource).not.toContain("args.push(process.env[FIXTURE_CLEANUP_DATABASE_ENV]");
    });

    it('requires approval, backup and fresh Auth inert evidence before execute-mode preview', () => {
        expect(executeGateRequested(parseFixtureCleanupArgs([
            'execute',
            '--execute-approved',
            '--backup-receipt',
            'receipt.json',
            '--auth-inert-evidence',
            'auth-inert-receipt.json',
        ]))).toBe(true);
        expect(executeGateRequested(parseFixtureCleanupArgs(['execute']))).toBe(false);
        expect(() => parseFixtureCleanupArgs(['preview', '--execute-approved'])).toThrow();

        const gateIndex = runnerSource.indexOf('if (!executeGateRequested(options))');
        const executePreviewIndex = runnerSource.indexOf(
            'const preview = runPreview(outputDir, databaseEnvironment);',
            gateIndex,
        );
        const executePsqlIndex = runnerSource.indexOf('sqlPath: path.join(root, FIXTURE_CLEANUP_PATHS.executeSql)');
        const liveAuthIndex = runnerSource.indexOf('await verifyLiveProductionAuthInert(accessToken)', executePreviewIndex);
        expect(gateIndex).toBeGreaterThan(-1);
        expect(executePreviewIndex).toBeGreaterThan(gateIndex);
        expect(liveAuthIndex).toBeGreaterThan(executePreviewIndex);
        expect(executePsqlIndex).toBeGreaterThan(liveAuthIndex);
        expect(runnerSource).toContain("status: 'BLOCKED_AUTH_INERT_EVIDENCE_REVALIDATION'");
    });

    it('parses only one exactly bound aggregate preview and preserves mismatch as a block signal', () => {
        const payload = previewPayload(false);
        const parsed = parseFixtureCleanupPreview(`${FIXTURE_CLEANUP_PREVIEW_PREFIX}${JSON.stringify(payload)}\n`);
        expect(parsed.baselineMatches).toBe(false);
        expect(parsed.packageStripeReferenceSha256).toBe('d'.repeat(64));
        expect(() => parseFixtureCleanupPreview('')).toThrow('exactly one');
        expect(() => parseFixtureCleanupPreview(
            `${FIXTURE_CLEANUP_PREVIEW_PREFIX}${JSON.stringify({ ...payload, targetProjectRef: 'wrong' })}`,
        )).toThrow('binding or shape mismatch');
    });

    it('redacts connection material from persisted process evidence', () => {
        const unsafe = [
            fixtureDatabaseUrl('db.example.test'),
            ['PGPASSWORD', 'fixture-secret'].join('='),
            ['Bearer', 'fixture-token'].join(' '),
        ].join(' ');
        const safe = sanitizeOutput(unsafe);
        expect(safe).not.toContain('postgres:fixture-secret');
        expect(safe).not.toContain('PGPASSWORD=fixture-secret');
        expect(safe).not.toContain('Bearer fixture-token');
    });
});

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function fixtureDatabaseUrl(host: string): string {
    return [
        'postgresql:',
        '//',
        'postgres',
        ':',
        'fixture-secret',
        '@',
        host,
        ':5432/postgres',
    ].join('');
}

function validReceipt(createdAt: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        receiptKind: 'supabase_production_logical_backup',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        authInertEvidenceSha256: 'e'.repeat(64),
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        createdAt,
        method: 'logical_dump',
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
            'custom_role_passwords_not_included',
            'external_stripe_google_not_included',
            'selected_schemas_only',
        ],
        backupFormat: 'pg_dump_custom',
        archiveListVerified: true,
        archiveRequiredTableDataVerified: true,
        archiveTocEntryCount: 42,
        artifactBytes: 1_024,
        artifactPathRecorded: false,
        toolVersions: { pgDump: 'pg_dump 17', pgRestore: 'pg_restore 17' },
    };
}

function previewPayload(baselineMatches: boolean): Record<string, unknown> {
    return {
        schemaVersion: 2,
        mode: 'read_only',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        canonicalPackageCount: 4,
        canonicalPackageSha256: FIXTURE_CLEANUP_TARGET.canonicalPackageSha256,
        packageStripeReferenceSha256: 'd'.repeat(64),
        packageStripeReferenceNonNullFields: 16,
        authDeletion: 'blocked_separate_step',
        baselineMatches,
        counts: { auth_users: 138 },
        distributions: { profiles_admin: 1 },
        schemaPosture: { unexpected_public_tables: [] },
    };
}
