import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FIXTURE_CLEANUP_TARGET,
    type BackupReceipt,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    archiveContainsRequiredTableData,
    revalidateProductionBackupArtifact,
    type BackupArtifactRuntime,
    validatePostClosureArchiveInventory,
} from '../../scripts/launch/supabase-production-backup-artifact';

const temporaryDirectories: string[] = [];
const tableData = [
    ['auth', 'users'],
    ['public', 'profiles'],
    ['public', 'profiles_private'],
    ['public', 'packages'],
    ['public', 'subscriptions'],
    ['public', 'student_teachers'],
    ['public', 'sessions'],
    ['public', 'payments'],
    ['public', 'leads'],
    ['public', 'processed_webhook_events'],
    ['public', 'fulfillment_jobs'],
    ['public', 'jobs'],
    ['public', 'support_tickets'],
    ['public', 'admin_audit_log'],
    ['public', 'teacher_availability'],
] as const;
const archiveList = tableData
    .map(([schema, table], index) => `${index + 1}; 0 0 TABLE DATA ${schema} ${table} postgres`)
    .join('\n');
const postClosurePublicTables = [
    'public.leads',
    'public.profiles',
    'public.profiles_private',
    'public.packages',
    'public.package_prices',
    'public.subscriptions',
    'public.student_teachers',
    'public.sessions',
    'public.payments',
    'public.processed_webhook_events',
    'public.fulfillment_jobs',
    'public.fulfillment_effects',
    'public.email_recipient_budget_usage',
    'public.support_tickets',
    'public.crm_contacts',
    'public.crm_opportunities',
    'public.checkout_intents',
    'public.crm_tasks',
    'public.crm_activities',
    'public.crm_consents',
    'public.admin_audit_log',
    'public.teacher_availability',
] as const;

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe('Supabase production backup artifact revalidation', () => {
    it('revalidates the current dump without returning or persisting its path', async () => {
        const artifactPath = createArtifact();
        const receipt = validReceipt();
        const result = await revalidateProductionBackupArtifact({
            artifactPath,
            receipt,
            runtime: validRuntime(),
        });

        expect(result).toMatchObject({
            provided: true,
            valid: true,
            artifactSha256: receipt.artifactSha256,
            artifactBytes: receipt.artifactBytes,
            atRestProtectionVerified: true,
            archiveListVerified: true,
            archiveRequiredTableDataVerified: true,
            archiveTocEntryCount: receipt.archiveTocEntryCount,
            pathRecorded: false,
            errors: [],
        });
        expect(JSON.stringify(result)).not.toContain(artifactPath);
        expect(result.verificationSha256).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('fails closed on SHA, EFS, size or TOC drift', async () => {
        const artifactPath = createArtifact();
        const receipt = validReceipt();
        const badHash = await revalidateProductionBackupArtifact({
            artifactPath,
            receipt,
            runtime: { ...validRuntime(), sha256File: async () => 'b'.repeat(64) },
        });
        expect(badHash).toMatchObject({ valid: false });
        expect(badHash.errors).toContain('The backup artifact SHA-256 does not match the receipt.');

        const badEfs = await revalidateProductionBackupArtifact({
            artifactPath,
            receipt,
            runtime: { ...validRuntime(), verifyWindowsEfsArtifact: () => false },
        });
        expect(badEfs).toMatchObject({ valid: false });

        const badToc = await revalidateProductionBackupArtifact({
            artifactPath,
            receipt,
            runtime: { ...validRuntime(), listArchive: () => ({ ok: true, stdout: '1; 0 0 TABLE DATA auth users postgres' }) },
        });
        expect(badToc).toMatchObject({ valid: false });
        expect(badToc.errors).toContain('The backup artifact TOC is missing required public/auth TABLE DATA entries.');

        const badSize = await revalidateProductionBackupArtifact({
            artifactPath,
            receipt: { ...receipt, artifactBytes: receipt.artifactBytes + 1 },
            runtime: validRuntime(),
        });
        expect(badSize).toMatchObject({ valid: false });
    });

    it('rejects missing artifacts and verifies the required TABLE DATA contract', async () => {
        const missing = await revalidateProductionBackupArtifact({
            artifactPath: path.join(os.tmpdir(), 'does-not-exist.dump'),
            receipt: validReceipt(),
            runtime: validRuntime(),
        });
        expect(missing).toMatchObject({ valid: false, pathRecorded: false });
        expect(archiveContainsRequiredTableData(archiveList)).toEqual({
            ok: true,
            missing: [],
            tocEntryCount: tableData.length,
        });
    });

    it('validates the exact post-closure public inventory while allowing managed auth tables', () => {
        expect(postClosurePublicTables).toHaveLength(22);
        const toc = buildPostClosureArchiveList([
            'auth.identities',
            'auth.sessions',
        ]);

        const expected = {
            ok: true,
            missing: [],
            unexpected: [],
            forbidden: [],
            tocEntryCount: 25,
        };
        expect(validatePostClosureArchiveInventory(toc)).toEqual(expected);
        expect(validatePostClosureArchiveInventory(toc, postClosurePublicTables)).toEqual(expected);
    });

    it('reports post-closure TOC and live-inventory drift deterministically', () => {
        const archiveTables = [
            ...postClosurePublicTables.filter((entry) => entry !== 'public.package_prices'),
            'public.zzz_extra',
            'public.aaa_extra',
            'public.staging_integration_smoke_leases',
            'public.jobs',
        ];
        const liveTables = [
            ...postClosurePublicTables.filter((entry) => entry !== 'public.checkout_intents'),
            'public.zeta_live',
            'public.staging_integration_smoke_runs',
        ];
        const toc = archiveTables
            .map((entry, index) => tocTableDataLine(entry, index))
            .join('\n');

        expect(validatePostClosureArchiveInventory(toc, liveTables)).toEqual({
            ok: false,
            missing: [
                'auth.users',
                'public.package_prices',
                'public.checkout_intents',
            ],
            unexpected: [
                'public.aaa_extra',
                'public.zeta_live',
                'public.zzz_extra',
            ],
            forbidden: [
                'public.jobs',
                'public.staging_integration_smoke_runs',
                'public.staging_integration_smoke_leases',
            ],
            tocEntryCount: archiveTables.length,
        });
    });

    it('keeps the historical pre-rollout archive contract unchanged', () => {
        expect(archiveContainsRequiredTableData(archiveList)).toEqual({
            ok: true,
            missing: [],
            tocEntryCount: tableData.length,
        });
        expect(archiveList).toContain('TABLE DATA public jobs');
    });
});

function buildPostClosureArchiveList(additionalTables: readonly string[] = []): string {
    return [
        'auth.users',
        ...postClosurePublicTables,
        ...additionalTables,
    ]
        .map((entry, index) => tocTableDataLine(entry, index))
        .join('\n');
}

function tocTableDataLine(entry: string, index: number): string {
    const separator = entry.indexOf('.');
    const schema = entry.slice(0, separator);
    const table = entry.slice(separator + 1);
    return `${index + 1}; 0 0 TABLE DATA ${schema} ${table} postgres`;
}

function createArtifact(): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'eh-production-backup-artifact-'));
    temporaryDirectories.push(directory);
    const artifactPath = path.join(directory, 'production.dump');
    writeFileSync(artifactPath, 'fixture');
    return artifactPath;
}

function validRuntime(): BackupArtifactRuntime {
    return {
        verifyWindowsEfsArtifact: () => true,
        listArchive: () => ({ ok: true, stdout: archiveList }),
        sha256File: async () => 'a'.repeat(64),
    };
}

function validReceipt(): BackupReceipt {
    return {
        schemaVersion: 1,
        receiptKind: 'supabase_production_logical_backup',
        targetProjectRef: FIXTURE_CLEANUP_TARGET.projectRef,
        authInertEvidenceSha256: 'e'.repeat(64),
        aggregateSnapshotSha256: FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256,
        approvalScopeSha256: FIXTURE_CLEANUP_TARGET.approvalScopeSha256,
        createdAt: new Date().toISOString(),
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
        archiveTocEntryCount: tableData.length,
        artifactBytes: Buffer.byteLength('fixture'),
        artifactPathRecorded: false,
        toolVersions: { pgDump: 'pg_dump 17', pgRestore: 'pg_restore 17' },
    };
}
