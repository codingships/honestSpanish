import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    FIXTURE_CLEANUP_TARGET,
    PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV,
    buildProductionLogicalBackupApproval,
    resolveNewBackupDestination,
    sha256,
} from '../../scripts/launch/production-fixture-cleanup-shared';
import {
    archiveContainsRequiredTableData,
    cipherOutputShowsEncrypted,
    parseProductionBackupArgs,
} from '../../scripts/launch/supabase-production-logical-backup';

const runnerSource = readFileSync(
    'scripts/launch/supabase-production-logical-backup.ts',
    'utf8',
);

describe('Supabase production logical-backup runner', () => {
    it('defaults to a network-free plan and requires all execute attestations', () => {
        expect(parseProductionBackupArgs([])).toEqual({
            mode: 'plan',
            destination: null,
            executeApproved: false,
            restoreProcedureReviewed: false,
        });
        expect(parseProductionBackupArgs([
            'execute',
            '--destination',
            'C:\\backups\\production.dump',
            '--execute-approved',
            '--restore-procedure-reviewed',
        ])).toMatchObject({
            mode: 'execute',
            executeApproved: true,
            restoreProcedureReviewed: true,
        });
        expect(() => parseProductionBackupArgs(['plan', '--execute-approved'])).toThrow();
        expect(runnerSource).toContain("'PLAN_ONLY_READY'");
        expect(runnerSource).toContain('networkAccessPerformed: false');
    });

    it('requires an absolute new .dump destination physically outside the repository', () => {
        const outside = path.join(os.tmpdir(), `espanol-honesto-${Date.now()}-never-created.dump`);
        expect(resolveNewBackupDestination(outside)).toBe(path.join(
            path.dirname(resolveNewBackupDestination(outside)),
            path.basename(outside),
        ));
        expect(() => resolveNewBackupDestination('relative.dump')).toThrow('absolute path');
        expect(() => resolveNewBackupDestination(path.join(process.cwd(), 'forbidden.dump')))
            .toThrow('outside the repository');
        expect(() => resolveNewBackupDestination(path.join(os.tmpdir(), 'wrong-extension.sql')))
            .toThrow('end in .dump');
    });

    it('uses custom pg_dump for only public+auth and verifies with pg_restore --list', () => {
        for (const snippet of [
            "'--format=custom'",
            "'--no-owner'",
            "'--no-privileges'",
            "'--no-password'",
            "'--serializable-deferrable'",
            "'--schema=public'",
            "'--schema=auth'",
            "'pg_restore'",
            "['--list', destination]",
            'archiveContainsRequiredTableData',
        ]) {
            expect(runnerSource).toContain(snippet);
        }
        expect(runnerSource).not.toContain('--schema=storage');
        expect(runnerSource).not.toContain('--clean');
        expect(runnerSource).not.toContain('--create');
    });

    it('requires TABLE DATA for auth.users and every current public fixture table', () => {
        const tables = [
            'auth users',
            'public profiles',
            'public profiles_private',
            'public packages',
            'public subscriptions',
            'public student_teachers',
            'public sessions',
            'public payments',
            'public leads',
            'public processed_webhook_events',
            'public fulfillment_jobs',
            'public jobs',
            'public support_tickets',
            'public admin_audit_log',
            'public teacher_availability',
        ];
        const completeList = tables
            .map((entry, index) => `${index + 1}; 0 ${100 + index} TABLE DATA ${entry} postgres`)
            .join('\n');
        expect(archiveContainsRequiredTableData(completeList)).toMatchObject({
            ok: true,
            missing: [],
            tocEntryCount: tables.length,
        });
        expect(archiveContainsRequiredTableData(completeList.replace('TABLE DATA auth users', 'TABLE auth users')))
            .toMatchObject({ ok: false, missing: ['auth.users'] });
    });

    it('binds exact approval to target, snapshot, scope and a non-disclosing path hash', () => {
        const destinationBinding = sha256('C:\\outside\\production.dump'.toLowerCase());
        const approval = buildProductionLogicalBackupApproval(destinationBinding);
        expect(approval).toContain(`target=${FIXTURE_CLEANUP_TARGET.projectRef}`);
        expect(approval).toContain(`snapshot=${FIXTURE_CLEANUP_TARGET.aggregateSnapshotSha256}`);
        expect(approval).toContain(`scope=${FIXTURE_CLEANUP_TARGET.approvalScopeSha256}`);
        expect(approval).toContain(`destination_binding=${destinationBinding}`);
        expect(approval).toContain('restore_procedure_reviewed=true');
        expect(approval).toContain('at_rest_protection=windows_efs');
        expect(approval).not.toContain('C:\\outside');
        expect(PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV).toBe('SUPABASE_PRODUCTION_LOGICAL_BACKUP_APPROVAL');
        expect(runnerSource).toContain('process.env[PRODUCTION_LOGICAL_BACKUP_APPROVAL_ENV] !== exactApproval');
    });

    it('accepts only an explicit Windows EFS encrypted-directory marker', () => {
        expect(cipherOutputShowsEncrypted(' E C:\\secure-backups')).toBe(true);
        expect(cipherOutputShowsEncrypted(' U C:\\plain-backups')).toBe(false);
        expect(cipherOutputShowsEncrypted('Directory is encrypted')).toBe(false);
        expect(runnerSource).toContain("spawnSync('cipher.exe', ['/c', parent]");
        expect(runnerSource).toContain("spawnSync('cipher.exe', ['/c', destination]");
        expect(runnerSource).toContain('The completed backup artifact is not verifiably protected by Windows EFS');
        expect(runnerSource).toContain("status: 'BLOCKED_DESTINATION_NOT_EFS'");
        expect(runnerSource).toContain("atRestProtection: 'windows_efs'");
        expect(runnerSource).toContain('atRestProtectionVerified: true');
    });

    it('keeps the database connection out of arguments, evidence and receipts', () => {
        expect(runnerSource).toContain('buildPsqlEnvironment(databaseUrl)');
        expect(runnerSource).toContain('buildDatabaseToolProcessEnvironment(connection');
        expect(runnerSource).not.toContain('args.push(databaseUrl)');
        expect(runnerSource).not.toContain('artifactPath: destination');
        expect(runnerSource).toContain('redactBackupPath(safeDiagnostic(dumpResult), destination)');
        expect(runnerSource).toContain('artifactPathRecorded: false');
        expect(runnerSource).toContain("verification: 'dump_hash_recorded'");
        expect(runnerSource).toContain("'storage_objects_not_included'");
        expect(runnerSource).toContain("'external_stripe_google_not_included'");
    });

    it('never overwrites, restores, or writes to production', () => {
        expect(runnerSource).toContain("existsSync(destination) || statSync(destination).size <= 0");
        expect(runnerSource).not.toMatch(/\b(?:unlinkSync|rmSync|renameSync)\b/u);
        expect(runnerSource).not.toContain('pg_restore --dbname');
        expect(runnerSource).not.toContain("'--dbname'");
        expect(runnerSource).not.toContain('supabase db push');
        expect(runnerSource).not.toContain('supabase migration repair');
        expect(runnerSource).toContain('databaseWritePerformed: false');
    });
});
