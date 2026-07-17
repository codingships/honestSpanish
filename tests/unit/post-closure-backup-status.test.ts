import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    assessPostClosureBackupTechnicalClosure,
} from '../../scripts/launch/post-closure-backup-status';
import {
    createPostClosureBackupReceipt,
    POST_CLOSURE_BACKUP_STATUS,
    type PostClosureBackupReceipt,
} from '../../scripts/launch/supabase-production-post-closure-backup';
import {
    sha256,
    stableJson,
} from '../../scripts/launch/production-fixture-cleanup-shared';

const now = new Date('2026-07-17T17:05:00.000Z');

function createOutputsRoot(): string {
    return mkdtempSync(path.join(tmpdir(), 'eh-post-closure-status-'));
}

function attemptDirectory(outputsRoot: string, timestamp: string): string {
    const directory = path.join(
        outputsRoot,
        'launch-supabase-production-post-closure-backup',
        timestamp,
    );
    mkdirSync(directory, { recursive: true });
    return directory;
}

function validReceipt(): PostClosureBackupReceipt {
    return createPostClosureBackupReceipt({
        canonicalGitSha: 'a'.repeat(40),
        productionInertEvidenceSha256: '1'.repeat(64),
        databaseStateSha256: '2'.repeat(64),
        destinationBindingSha256: '3'.repeat(64),
        liveInventorySha256: '4'.repeat(64),
        livePublicTableCount: 22,
        liveAuthTableCount: 12,
        archiveTocEntryCount: 100,
        artifactSha256: '5'.repeat(64),
        artifactBytes: 1234,
        toolVersions: {
            pgDump: 'pg_dump (PostgreSQL) 17.4',
            pgRestore: 'pg_restore (PostgreSQL) 17.4',
            psql: 'psql (PostgreSQL) 17.4',
        },
        createdAt: new Date('2026-07-17T17:04:00.000Z'),
    });
}

function validSummary(receipt: PostClosureBackupReceipt): Record<string, unknown> {
    const receiptRaw = stableJson(receipt);
    return {
        status: POST_CLOSURE_BACKUP_STATUS,
        targetProjectRef: receipt.targetProjectRef,
        canonicalGitSha: receipt.canonicalGitSha,
        productionInertEvidenceSha256: receipt.productionInertEvidenceSha256,
        databaseStateSha256: receipt.databaseStateSha256,
        tableContractSha256: receipt.tableContractSha256,
        destinationBindingSha256: receipt.destinationBindingSha256,
        liveInventorySha256: receipt.liveInventorySha256,
        livePublicTableCount: receipt.livePublicTableCount,
        liveAuthTableCount: receipt.liveAuthTableCount,
        stableProductionInertRowStateReadbacks: receipt.stableProductionInertRowStateReadbacks,
        liveAuthConfigurationReadbacks: receipt.liveAuthConfigurationReadbacks,
        productionInertEvidenceRevalidatedAtEnd: true,
        archiveTocEntryCount: receipt.archiveTocEntryCount,
        artifactSha256: receipt.artifactSha256,
        receiptSha256: sha256(receiptRaw),
        receiptFile: 'post-closure-backup-receipt.json',
        artifactPathRecorded: false,
        restoreValidation: receipt.restoreValidation,
        restorePerformed: false,
        networkAccessPerformed: true,
        databaseWritePerformed: false,
        externalServiceWritePerformed: false,
        localBackupWritten: true,
    };
}

function writeSuccessfulAttempt(
    outputsRoot: string,
    timestamp = '2026-07-17T17-04-00-000Z',
): { directory: string; receipt: PostClosureBackupReceipt; summary: Record<string, unknown> } {
    const directory = attemptDirectory(outputsRoot, timestamp);
    const receipt = validReceipt();
    const summary = validSummary(receipt);
    writeFileSync(
        path.join(directory, 'post-closure-backup-receipt.json'),
        stableJson(receipt),
        'utf8',
    );
    writeFileSync(path.join(directory, 'summary.json'), stableJson(summary), 'utf8');
    return { directory, receipt, summary };
}

describe('post-closure backup technical-closure assessment', () => {
    it('reports pending when no real backup attempt exists', () => {
        const outputsRoot = createOutputsRoot();
        try {
            expect(assessPostClosureBackupTechnicalClosure(outputsRoot, now)).toEqual({
                status: 'pending',
                reason: expect.stringContaining('No real post-closure backup attempt'),
                canonicalGitSha: null,
                receiptSha256: null,
                artifactSha256: null,
                evidencePath: null,
                isFinalGate: false,
            });
        } finally {
            rmSync(outputsRoot, { recursive: true, force: true });
        }
    });

    it('ignores a newer canonical plan-only attempt and keeps the latest real success', () => {
        const outputsRoot = createOutputsRoot();
        try {
            const successful = writeSuccessfulAttempt(outputsRoot);
            const planDirectory = attemptDirectory(outputsRoot, '2026-07-17T17-04-30-000Z');
            writeFileSync(
                path.join(planDirectory, 'summary.json'),
                stableJson({ status: 'PLAN_ONLY_READY' }),
                'utf8',
            );

            const assessment = assessPostClosureBackupTechnicalClosure(outputsRoot, now);
            expect(assessment.status).toBe('verified');
            expect(assessment.evidencePath).toBe(path.join(successful.directory, 'summary.json'));
            expect(assessment.isFinalGate).toBe(false);
        } finally {
            rmSync(outputsRoot, { recursive: true, force: true });
        }
    });

    it('verifies a canonical summary and exactly bound receipt', () => {
        const outputsRoot = createOutputsRoot();
        try {
            const successful = writeSuccessfulAttempt(outputsRoot);
            const receiptRaw = stableJson(successful.receipt);

            expect(assessPostClosureBackupTechnicalClosure(outputsRoot, now)).toEqual({
                status: 'verified',
                reason: expect.stringContaining('canonical, valid and exactly bound'),
                canonicalGitSha: successful.receipt.canonicalGitSha,
                receiptSha256: sha256(receiptRaw),
                artifactSha256: successful.receipt.artifactSha256,
                evidencePath: path.join(successful.directory, 'summary.json'),
                isFinalGate: false,
            });
        } finally {
            rmSync(outputsRoot, { recursive: true, force: true });
        }
    });

    it('lets a later failed real attempt invalidate an older success', () => {
        const outputsRoot = createOutputsRoot();
        try {
            writeSuccessfulAttempt(outputsRoot);
            const failedDirectory = attemptDirectory(outputsRoot, '2026-07-17T17-04-30-000Z');
            writeFileSync(
                path.join(failedDirectory, 'summary.json'),
                stableJson({ status: 'BACKUP_FAILED' }),
                'utf8',
            );

            const assessment = assessPostClosureBackupTechnicalClosure(outputsRoot, now);
            expect(assessment.status).toBe('invalid');
            expect(assessment.reason).toContain('BACKUP_FAILED');
            expect(assessment.evidencePath).toBe(path.join(failedDirectory, 'summary.json'));
            expect(assessment.canonicalGitSha).toBeNull();
        } finally {
            rmSync(outputsRoot, { recursive: true, force: true });
        }
    });

    it('rejects drift between the latest success summary and receipt', () => {
        const outputsRoot = createOutputsRoot();
        try {
            const successful = writeSuccessfulAttempt(outputsRoot);
            const drifted = {
                ...successful.summary,
                artifactSha256: '9'.repeat(64),
            };
            writeFileSync(
                path.join(successful.directory, 'summary.json'),
                stableJson(drifted),
                'utf8',
            );

            const assessment = assessPostClosureBackupTechnicalClosure(outputsRoot, now);
            expect(assessment.status).toBe('invalid');
            expect(assessment.reason).toContain('bindings differ');
            expect(assessment.receiptSha256).toBeNull();
            expect(assessment.isFinalGate).toBe(false);
        } finally {
            rmSync(outputsRoot, { recursive: true, force: true });
        }
    });
});
