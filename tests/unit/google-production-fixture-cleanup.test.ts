import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT,
    advanceGoogleProductionCleanupRecoveryState,
    buildGoogleFixturePolicyEvidence,
    buildGoogleProductionCleanupApproval,
    buildGoogleProductionCleanupRecoveryState,
    driveChildrenAggregate,
    evaluateGoogleProductionCleanupRecoverySnapshot,
    isGoogleProductionCleanupRecoveryState,
    reconcileGoogleProductionCleanupRecoveryState,
    resourceFingerprint,
    validateGoogleProductionRecoveryDirectory,
    validateGoogleProductionRecoveryApproval,
    validateExpectedSnapshot,
} from '../../scripts/launch/google-production-fixture-cleanup-shared';
import { readGoogleFixturePolicyEvidence } from '../../scripts/launch/supabase-production-rollout-runner-shared';

const folderMime = 'application/vnd.google-apps.folder';

function fixtureFolders(count = GOOGLE_PRODUCTION_FIXTURE_BASELINE_COUNT) {
    return Array.from({ length: count }, (_, index) => ({
        id: `folder-${String(index + 1).padStart(3, '0')}`,
        mimeType: folderMime,
        createdTime: `2026-04-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
}

describe('Google production fixture cleanup safety', () => {
    it('builds a stable order-independent fingerprint without exposing ids', () => {
        const left = driveChildrenAggregate([
            { id: 'folder-b', mimeType: folderMime, createdTime: '2026-06-02T00:00:00.000Z' },
            { id: 'folder-a', mimeType: folderMime, createdTime: '2026-04-03T00:00:00.000Z' },
        ]);
        const right = driveChildrenAggregate([
            { id: 'folder-a', mimeType: folderMime, createdTime: '2026-04-03T00:00:00.000Z' },
            { id: 'folder-b', mimeType: folderMime, createdTime: '2026-06-02T00:00:00.000Z' },
        ]);

        expect(left).toEqual(right);
        expect(left).toMatchObject({
            total: 2,
            folders: 2,
            nonFolders: 0,
            oldestCreatedAt: '2026-04-03T00:00:00.000Z',
            newestCreatedAt: '2026-06-02T00:00:00.000Z',
        });
        expect(left.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(JSON.stringify(left)).not.toContain('folder-a');
    });

    it('fails closed on count, fingerprint or non-folder drift', () => {
        const aggregate = driveChildrenAggregate([
            { id: 'folder-a', mimeType: folderMime, createdTime: '2026-04-03T00:00:00.000Z' },
            { id: 'doc-a', mimeType: 'application/vnd.google-apps.document', createdTime: '2026-04-04T00:00:00.000Z' },
        ]);

        expect(validateExpectedSnapshot({
            aggregate,
            expectedCount: '1',
            expectedFingerprint: '0'.repeat(64),
        })).toEqual(expect.arrayContaining([
            expect.stringContaining('count'),
            expect.stringContaining('fingerprint'),
            expect.stringContaining('non-folder'),
        ]));
    });

    it('accepts only the exact positive count and snapshot fingerprint', () => {
        const aggregate = driveChildrenAggregate([
            { id: 'folder-a', mimeType: folderMime, createdTime: '2026-04-03T00:00:00.000Z' },
        ]);
        expect(validateExpectedSnapshot({
            aggregate,
            expectedCount: '1',
            expectedFingerprint: aggregate.fingerprintSha256,
        })).toEqual([]);
    });

    it('pins the exact root and children snapshot in the approval sentence', () => {
        const rootFingerprint = resourceFingerprint('production-root');
        const childFingerprint = 'a'.repeat(64);
        const approval = buildGoogleProductionCleanupApproval({
            rootFingerprint,
            childCount: 110,
            childFingerprint,
        });
        expect(approval).toContain('110 hijos directos');
        expect(approval).toContain(rootFingerprint);
        expect(approval).toContain(childFingerprint);
        expect(approval).toContain('sin borrado permanente');
        expect(approval).toContain('No autorizo tocar la carpeta raiz');
    });

    it('keeps the executable runner trash-only and free of permanent-delete operations', () => {
        const source = readFileSync('scripts/launch/google-production-fixture-cleanup.ts', 'utf8');
        const sharedSource = readFileSync('scripts/launch/google-production-fixture-cleanup-shared.ts', 'utf8');
        const completeSource = `${source}\n${sharedSource}`;
        expect(source).toContain("requestBody: { trashed: true }");
        expect(source).toContain('validateExpectedSnapshot');
        expect(source).toContain('externalWriteAttempted = true');
        expect(source).toContain("'google-fixture-policy-evidence.json'");
        expect(completeSource).toContain("status: 'TRASHED_AND_VERIFIED'");
        expect(completeSource).toContain('permanentlyDeleted: 0');
        expect(completeSource).toContain('rootIdStored: false');
        expect(source).toContain('persistDurableRecoveryState(recoveryState);');
        expect(source).toContain('GOOGLE_PRODUCTION_RECOVERY_DIR_ENV');
        expect(source).toContain('validateGoogleProductionRecoveryDirectory');
        expect(source).toContain('Refusing Google cleanup write without a valid');
        expect(source.indexOf('persistDurableRecoveryState(recoveryState);'))
            .toBeLessThan(source.indexOf('const response = await drive.files.update'));
        expect(source).toContain("'ALREADY_CLEAN_UNATTESTED'");
        expect(source).toContain("'RECOVERY_PLAN_READY'");
        expect(source).not.toContain('files.delete(');
        expect(source).not.toContain('files.emptyTrash(');
        expect(source).not.toContain('permissions.delete(');
        expect(source).not.toContain('signed filename');
    });

    it('requires an absolute recovery journal directory outside the repository', () => {
        const repositoryRoot = path.resolve(process.cwd());
        expect(validateGoogleProductionRecoveryDirectory(undefined, repositoryRoot)).toMatchObject({ valid: false });
        expect(validateGoogleProductionRecoveryDirectory('outputs/recovery-state', repositoryRoot)).toMatchObject({ valid: false });
        expect(validateGoogleProductionRecoveryDirectory(path.join(repositoryRoot, 'outputs', 'recovery-state'), repositoryRoot))
            .toMatchObject({ valid: false });
        expect(validateGoogleProductionRecoveryDirectory(path.join(path.dirname(repositoryRoot), 'eh-google-recovery'), repositoryRoot))
            .toMatchObject({ valid: true });
    });

    it('refuses to re-approve a partial snapshot when no durable 110-folder baseline exists', () => {
        const evaluation = evaluateGoogleProductionCleanupRecoverySnapshot({
            state: null,
            rootFingerprint: resourceFingerprint('production-root'),
            currentChildren: fixtureFolders(109),
        });

        expect(evaluation).toMatchObject({
            disposition: 'PARTIAL_STATE_UNATTESTED',
            reconciliation: null,
        });
        expect(evaluation.errors.join(' ')).toContain('cannot be approved as a new snapshot');
    });

    it('treats an empty root without durable baseline evidence as blocked, not ALREADY_CLEAN success', () => {
        const evaluation = evaluateGoogleProductionCleanupRecoverySnapshot({
            state: null,
            rootFingerprint: resourceFingerprint('production-root'),
            currentChildren: [],
        });

        expect(evaluation.disposition).toBe('ALREADY_CLEAN_UNATTESTED');
        expect(evaluation.errors.join(' ')).toContain('cannot emit a rollout receipt');
    });

    it('resumes only an exact subset of the original approved children and keeps the original approval', () => {
        const children = fixtureFolders();
        const rootFingerprint = resourceFingerprint('production-root');
        const state = buildGoogleProductionCleanupRecoveryState({
            rootFingerprint,
            children,
            now: new Date('2026-07-13T00:00:00.000Z'),
        });
        const remaining = children.slice(7);
        const evaluation = evaluateGoogleProductionCleanupRecoverySnapshot({
            state,
            rootFingerprint,
            currentChildren: remaining,
        });

        expect(evaluation).toMatchObject({
            disposition: 'RECOVERY_READY',
            reconciliation: {
                valid: true,
                activeChildren: 103,
                movedToTrashDerived: 7,
            },
        });
        expect(validateGoogleProductionRecoveryApproval({
            state,
            expectedCount: '110',
            expectedFingerprint: state.baseline.fingerprintSha256,
        })).toEqual([]);
        expect(validateGoogleProductionRecoveryApproval({
            state,
            expectedCount: '103',
            expectedFingerprint: driveChildrenAggregate(remaining).fingerprintSha256,
        })).toHaveLength(2);
        expect(buildGoogleProductionCleanupApproval({
            rootFingerprint,
            childCount: state.baseline.total,
            childFingerprint: state.baseline.fingerprintSha256,
        })).toContain('110 hijos directos');
    });

    it('blocks recovery when a new child appears after a partial execution', () => {
        const children = fixtureFolders();
        const rootFingerprint = resourceFingerprint('production-root');
        const state = buildGoogleProductionCleanupRecoveryState({
            rootFingerprint,
            children,
            now: new Date('2026-07-13T00:00:00.000Z'),
        });
        const current = [
            ...children.slice(1),
            { id: 'unapproved-folder', mimeType: folderMime, createdTime: '2026-07-13T00:00:00.000Z' },
        ];

        const evaluation = evaluateGoogleProductionCleanupRecoverySnapshot({ state, rootFingerprint, currentChildren: current });
        expect(evaluation.disposition).toBe('BLOCKED');
        expect(evaluation.errors.join(' ')).toContain('outside the approved baseline');
    });

    it('reconstructs a rollout-consumable receipt after every move succeeded but receipt creation was interrupted', () => {
        const children = fixtureFolders();
        const rootFingerprint = resourceFingerprint('production-root');
        const initial = buildGoogleProductionCleanupRecoveryState({
            rootFingerprint,
            children,
            now: new Date('2026-07-13T00:00:00.000Z'),
        });
        const writeAheadBeforeLastMove = advanceGoogleProductionCleanupRecoveryState({
            state: initial,
            currentChildren: [children.at(-1)!],
            now: new Date('2026-07-13T00:01:00.000Z'),
            pendingChildFingerprintSha256: initial.baseline.childIdentityFingerprints.at(-1),
        });

        const afterCrash = reconcileGoogleProductionCleanupRecoveryState({
            state: writeAheadBeforeLastMove,
            rootFingerprint,
            currentChildren: [],
        });
        expect(afterCrash).toMatchObject({ valid: true, activeChildren: 0, movedToTrashDerived: 110 });

        const terminal = advanceGoogleProductionCleanupRecoveryState({
            state: writeAheadBeforeLastMove,
            currentChildren: [],
            now: new Date('2026-07-13T00:02:00.000Z'),
            markEmptyVerified: true,
        });
        const evidence = buildGoogleFixturePolicyEvidence({
            state: terminal,
            currentChildren: [],
            completedAt: new Date('2026-07-13T00:03:00.000Z'),
            recoveredAfterInterruptedRun: true,
        });

        expect(evidence).toMatchObject({
            schemaVersion: 2,
            environment: 'production',
            status: 'TRASHED_AND_VERIFIED',
            observedActiveRootChildrenBefore: 110,
            observedFoldersBefore: 110,
            activeRootChildrenAfter: 0,
            permanentlyDeleted: 0,
            rootIdStored: false,
            recoveredAfterInterruptedRun: true,
        });
        expect(evidence).toMatchObject({
            baselineFingerprintSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            recoveryStateSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        });

        const directory = mkdtempSync(path.join(tmpdir(), 'eh-google-recovery-'));
        try {
            const evidencePath = path.join(directory, 'google-fixture-policy-evidence.json');
            writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`, 'utf8');
            expect(readGoogleFixturePolicyEvidence(
                evidencePath,
                new Date('2026-07-13T00:04:00.000Z'),
            )).toMatchObject({ valid: true, errors: [] });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('detects tampering in durable state before it can authorize recovery or evidence', () => {
        const state = buildGoogleProductionCleanupRecoveryState({
            rootFingerprint: resourceFingerprint('production-root'),
            children: fixtureFolders(),
            now: new Date('2026-07-13T00:00:00.000Z'),
        });
        const tampered = { ...state, movedToTrashDerived: 1 };

        expect(isGoogleProductionCleanupRecoveryState(tampered)).toBe(false);
    });
});
