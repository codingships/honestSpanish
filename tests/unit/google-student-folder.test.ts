import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { LevelFolderInfo, StudentLevel } from '../../src/lib/google/student-folder';

const mocks = vi.hoisted(() => ({
    batchUpdate: vi.fn(),
    createFile: vi.fn(),
    ensureAnyoneWithLinkPermission: vi.fn(),
    findOrCreateFolder: vi.fn(),
    getDocument: vi.fn(),
    getFolderLink: vi.fn(),
    listFiles: vi.fn(),
}));

vi.mock('@googleapis/drive', () => ({
    drive: () => ({ files: { create: mocks.createFile, list: mocks.listFiles } }),
}));

vi.mock('@googleapis/docs', () => ({
    docs: () => ({
        documents: {
            batchUpdate: mocks.batchUpdate,
            get: mocks.getDocument,
        },
    }),
}));

vi.mock('../../src/lib/google/auth', () => ({
    getAuthClient: () => ({}),
}));

vi.mock('../../src/lib/google/config', () => ({
    googleConfig: { driveRootFolderId: 'drive-root' },
}));

vi.mock('../../src/lib/google/drive', () => ({
    ensureAnyoneWithLinkPermission: mocks.ensureAnyoneWithLinkPermission,
    findOrCreateFolder: mocks.findOrCreateFolder,
    getFolderLink: mocks.getFolderLink,
}));

vi.mock('../../src/lib/google/logging', () => ({
    describeGoogleError: (error: unknown) => String(error),
}));

describe('createStudentFolderStructure', () => {
    const expectedB1Content = 'Ada - Espa\u00f1ol (B1)\n\n\u00cdndice de clases\n\n[Las entradas se a\u00f1adir\u00e1n autom\u00e1ticamente]\n';
    const documentWithText = (text: string) => ({
        data: {
            body: {
                content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }],
            },
        },
    });

    beforeEach(() => {
        vi.clearAllMocks();
        let documentNumber = 0;
        mocks.createFile.mockImplementation(async () => ({
            data: { id: `index-${++documentNumber}` },
        }));
        mocks.findOrCreateFolder.mockImplementation(async (name: string, parentId?: string) => ({
            id: parentId === 'drive-root'
                ? 'student-root'
                : `${parentId ?? 'root'}-${name}`,
        }));
        mocks.getFolderLink.mockResolvedValue('https://drive.example/student-root');
        mocks.listFiles.mockResolvedValue({ data: { files: [] } });
    });

    it('creates all four levels when no selection is supplied', async () => {
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        const result = await createStudentFolderStructure({
            studentName: 'Ada',
            studentEmail: 'ada@example.com',
        });

        expect(Object.keys(result.levels)).toEqual(['A2', 'B1', 'B2', 'C1']);
        expect(mocks.createFile).toHaveBeenCalledTimes(4);
        expect(mocks.createFile).toHaveBeenCalledWith(expect.objectContaining({
            requestBody: expect.objectContaining({
                mimeType: 'application/vnd.google-apps.document',
                parents: ['student-root-A2-Ejercicios'],
            }),
        }));
        expectTypeOf(result.levels).toEqualTypeOf<Partial<Record<StudentLevel, LevelFolderInfo>>>();
    });

    it('creates only the requested levels', async () => {
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        const result = await createStudentFolderStructure({
            studentName: 'Ada',
            studentEmail: 'ada@example.com',
            levels: ['B1', 'C1'],
        });

        expect(Object.keys(result.levels)).toEqual(['B1', 'C1']);
        expect(result.levels.A2).toBeUndefined();
        expect(result.levels.B1?.folderId).toBe('student-root-B1');
        expect(result.levels.C1?.folderId).toBe('student-root-C1');
        expect(mocks.createFile).toHaveBeenCalledTimes(2);
        expect(mocks.findOrCreateFolder).not.toHaveBeenCalledWith('A2', 'student-root');
        expect(mocks.findOrCreateFolder).not.toHaveBeenCalledWith('B2', 'student-root');
    });

    it('deduplicates a requested level before creating its index document', async () => {
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        const result = await createStudentFolderStructure({
            studentName: 'Ada',
            studentEmail: 'ada@example.com',
            levels: ['B2', 'B2'],
        });

        expect(Object.keys(result.levels)).toEqual(['B2']);
        expect(mocks.createFile).toHaveBeenCalledTimes(1);
    });

    it('reuses the unique exact index document in the exercises folder', async () => {
        mocks.listFiles.mockResolvedValue({
            data: { files: [{ id: 'existing-index' }] },
        });
        mocks.getDocument.mockResolvedValue(documentWithText(`${expectedB1Content}\n`));
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        const result = await createStudentFolderStructure({
            studentName: 'Ada',
            studentEmail: 'ada@example.com',
            levels: ['B1'],
        });

        expect(result.levels.B1?.indexDocId).toBe('existing-index');
        expect(mocks.listFiles).toHaveBeenCalledWith(expect.objectContaining({
            q: `name = 'Ada / Por asignar - Espa\u00f1ol (B1)' and 'student-root-B1-Ejercicios' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
            pageSize: 2,
        }));
        expect(mocks.createFile).not.toHaveBeenCalled();
        expect(mocks.batchUpdate).not.toHaveBeenCalled();
    });

    it('initializes an exact empty document left by a retry after Drive creation', async () => {
        mocks.listFiles.mockResolvedValue({ data: { files: [{ id: 'empty-index' }] } });
        mocks.getDocument.mockResolvedValue(documentWithText('\n'));
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        const result = await createStudentFolderStructure({
            studentName: 'Ada',
            studentEmail: 'ada@example.com',
            levels: ['B1'],
        });

        expect(result.levels.B1?.indexDocId).toBe('empty-index');
        expect(mocks.createFile).not.toHaveBeenCalled();
        expect(mocks.batchUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
            documentId: 'empty-index',
            requestBody: {
                requests: [{
                    insertText: {
                        location: { index: 1 },
                        text: expectedB1Content,
                    },
                }],
            },
        }));
    });

    it('rejects an exact-title document whose content is not canonical', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.listFiles.mockResolvedValue({ data: { files: [{ id: 'unexpected-index' }] } });
        mocks.getDocument.mockResolvedValue(documentWithText('Manual content\n'));
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        try {
            await expect(createStudentFolderStructure({
                studentName: 'Ada',
                studentEmail: 'ada@example.com',
                levels: ['B1'],
            })).rejects.toThrow('Ambiguous existing index document content');

            expect(mocks.createFile).not.toHaveBeenCalled();
            expect(mocks.batchUpdate).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('stops a selected-level retry when more than one exact index document exists', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        mocks.listFiles.mockResolvedValue({
            data: { files: [
                { id: 'existing-index-1' },
                { id: 'existing-index-2' },
            ] },
        });
        const { createStudentFolderStructure } = await import('../../src/lib/google/student-folder');

        try {
            await expect(createStudentFolderStructure({
                studentName: 'Ada',
                studentEmail: 'ada@example.com',
                levels: ['B1'],
            })).rejects.toThrow('Ambiguous existing index document');

            expect(mocks.createFile).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
});
