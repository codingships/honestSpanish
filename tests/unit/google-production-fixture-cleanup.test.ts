import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildGoogleProductionCleanupApproval,
    driveChildrenAggregate,
    resourceFingerprint,
    validateExpectedSnapshot,
} from '../../scripts/launch/google-production-fixture-cleanup-shared';

const folderMime = 'application/vnd.google-apps.folder';

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
        expect(source).toContain("requestBody: { trashed: true }");
        expect(source).toContain('validateExpectedSnapshot');
        expect(source).toContain('externalWriteAttempted = true');
        expect(source).toContain("'google-fixture-policy-evidence.json'");
        expect(source).toContain("status: 'TRASHED_AND_VERIFIED'");
        expect(source).toContain('permanentlyDeleted: 0');
        expect(source).toContain('rootIdStored: false');
        expect(source).not.toContain('files.delete(');
        expect(source).not.toContain('files.emptyTrash(');
        expect(source).not.toContain('permissions.delete(');
    });
});
