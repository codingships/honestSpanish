import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { copyDriveFile, listDriveFiles } = vi.hoisted(() => ({
    copyDriveFile: vi.fn(),
    listDriveFiles: vi.fn(),
}));

vi.mock('@googleapis/drive', () => ({
    drive: () => ({
        files: {
            copy: copyDriveFile,
            list: listDriveFiles,
        },
    }),
}));

vi.mock('@googleapis/docs', () => ({
    docs: () => ({
        documents: {
            get: vi.fn(),
            batchUpdate: vi.fn(),
        },
    }),
}));

vi.mock('../../src/lib/google/auth', () => ({
    getAuthClient: () => ({}),
}));

vi.mock('../../src/lib/google/config', () => ({
    googleConfig: {
        driveRootFolderId: 'drive-root',
        templateDocId: 'class-template',
    },
}));

import { createClassDocument } from '../../src/lib/google/drive';

const sessionId = '418f47a2-9b6d-4c31-8a4e-123456789abc';
const existingDocument = {
    id: 'existing-class-doc',
    name: '05/08/26 - Ejercicios - Ana Alumna',
    webViewLink: 'https://docs.google.com/document/d/existing-class-doc/edit',
    appProperties: {
        honestSpanishSessionId: sessionId,
    },
};

const params = {
    sessionId,
    studentName: 'Ana Alumna',
    studentRootFolderId: 'student-root',
    level: 'B1' as const,
    classDate: new Date('2026-08-05T10:00:00.000Z'),
};

function response(files: unknown[], incompleteSearch = false) {
    return { data: { files, incompleteSearch } };
}

function installFolderStructure(
    identityResults: Array<ReturnType<typeof response>>,
): void {
    listDriveFiles.mockImplementation(async ({ q }: { q?: string }) => {
        if (q?.includes('appProperties')) {
            const result = identityResults.shift();
            if (!result) throw new Error('unexpected class-document identity observation');
            return result;
        }
        if (q?.includes("name = 'B1'")) {
            return response([{ id: 'level-folder', name: 'B1' }]);
        }
        if (q?.includes("name = 'Ejercicios'")) {
            return response([{ id: 'exercises-folder', name: 'Ejercicios' }]);
        }
        if (q?.includes("name = 'Audio'")) {
            return response([]);
        }
        if (q?.includes("mimeType = 'application/vnd.google-apps.document'")) {
            return response([]);
        }
        throw new Error(`unexpected Drive query: ${q ?? '<missing>'}`);
    });
}

describe('idempotent class document creation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the document with the existing session identity without copying', async () => {
        installFolderStructure([response([existingDocument])]);

        await expect(createClassDocument(params)).resolves.toEqual({
            docId: existingDocument.id,
            docUrl: existingDocument.webViewLink,
        });

        expect(copyDriveFile).not.toHaveBeenCalled();
        expect(listDriveFiles).toHaveBeenCalledWith(expect.objectContaining({
            q: expect.stringContaining(sessionId),
            spaces: 'drive',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        }));
    });

    it('copies an absent document with durable identity and shared-drive flags', async () => {
        installFolderStructure([response([])]);
        copyDriveFile.mockResolvedValue({
            data: {
                id: 'new-class-doc',
                webViewLink: 'https://docs.google.com/document/d/new-class-doc/edit',
                appProperties: { honestSpanishSessionId: sessionId },
            },
        });

        await expect(createClassDocument(params)).resolves.toEqual({
            docId: 'new-class-doc',
            docUrl: 'https://docs.google.com/document/d/new-class-doc/edit',
        });

        expect(copyDriveFile).toHaveBeenCalledTimes(1);
        expect(copyDriveFile).toHaveBeenCalledWith({
            fileId: 'class-template',
            supportsAllDrives: true,
            requestBody: {
                name: '05/08/26 - Ejercicios - Ana Alumna',
                parents: ['exercises-folder'],
                appProperties: {
                    honestSpanishSessionId: sessionId,
                },
            },
            fields: expect.stringContaining('appProperties'),
        });
    });

    it('reconciles an ambiguous copy error against the accepted Drive document', async () => {
        installFolderStructure([
            response([]),
            response([existingDocument]),
        ]);
        copyDriveFile.mockRejectedValueOnce(new Error('connection ended without a response'));

        await expect(createClassDocument(params)).resolves.toEqual({
            docId: existingDocument.id,
            docUrl: existingDocument.webViewLink,
        });

        expect(copyDriveFile).toHaveBeenCalledTimes(1);
    });

    it('does not create a duplicate when the operation is replayed', async () => {
        const createdDocument = {
            ...existingDocument,
            id: 'new-class-doc',
            webViewLink: 'https://docs.google.com/document/d/new-class-doc/edit',
        };
        installFolderStructure([
            response([]),
            response([createdDocument]),
        ]);
        copyDriveFile.mockResolvedValueOnce({ data: createdDocument });

        await expect(createClassDocument(params)).resolves.toMatchObject({
            docId: createdDocument.id,
        });
        await expect(createClassDocument(params)).resolves.toMatchObject({
            docId: createdDocument.id,
        });

        expect(copyDriveFile).toHaveBeenCalledTimes(1);
    });

    it('fails closed when more than one document owns the session identity', async () => {
        installFolderStructure([
            response([
                existingDocument,
                { ...existingDocument, id: 'duplicate-class-doc' },
            ]),
        ]);

        await expect(createClassDocument(params)).rejects.toThrow(
            'class_document_identity_conflict',
        );
        expect(copyDriveFile).not.toHaveBeenCalled();
    });

    it('fails closed when Drive reports an incomplete identity search', async () => {
        installFolderStructure([response([], true)]);

        await expect(createClassDocument(params)).rejects.toThrow(
            'class_document_identity_observation_incomplete',
        );
        expect(copyDriveFile).not.toHaveBeenCalled();
    });
});
