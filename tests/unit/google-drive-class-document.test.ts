import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { copyDriveFile, listDriveFiles } = vi.hoisted(() => ({
    copyDriveFile: vi.fn(),
    listDriveFiles: vi.fn(),
}));

const {
    driveCopyEffects,
    driveCopyOutcomes,
    runFulfillmentDriveCopyEffect,
} = vi.hoisted(() => {
    type AcceptedEffect = {
        documentId: string;
        documentUrl: string;
        status: 'accepted';
    };
    type StoredEffect = AcceptedEffect | { status: 'ambiguous' };
    type CopyOutcome =
        | { documentId: string; documentUrl: string; outcome: 'accepted' }
        | { outcome: 'ambiguous' }
        | { outcome: 'retryable' };

    const effects = new Map<string, StoredEffect>();
    const outcomes: CopyOutcome[] = [];
    const runEffect = vi.fn(async (
        context: { effectKey: string },
        _payload: unknown,
        copy: () => Promise<CopyOutcome>,
    ) => {
        const stored = effects.get(context.effectKey);
        if (stored?.status === 'accepted') {
            return {
                documentId: stored.documentId,
                documentUrl: stored.documentUrl,
                replayed: true,
            };
        }
        if (stored?.status === 'ambiguous') {
            throw Object.assign(new Error('FULFILLMENT_EFFECT_MANUAL_REVIEW'), {
                code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
                requiresManualReview: true,
            });
        }

        let outcome: CopyOutcome;
        try {
            outcome = await copy();
        } catch {
            outcome = { outcome: 'ambiguous' };
        }
        outcomes.push(outcome);
        if (outcome.outcome === 'accepted') {
            effects.set(context.effectKey, { ...outcome, status: 'accepted' });
            return {
                documentId: outcome.documentId,
                documentUrl: outcome.documentUrl,
                replayed: false,
            };
        }
        if (outcome.outcome === 'ambiguous') {
            effects.set(context.effectKey, { status: 'ambiguous' });
            throw Object.assign(new Error('FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS'), {
                code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
                requiresManualReview: true,
            });
        }
        throw Object.assign(new Error('FULFILLMENT_EFFECT_DELIVERY_FAILED'), {
            code: 'FULFILLMENT_EFFECT_DELIVERY_FAILED',
            requiresManualReview: false,
        });
    });

    return {
        driveCopyEffects: effects,
        driveCopyOutcomes: outcomes,
        runFulfillmentDriveCopyEffect: runEffect,
    };
});

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

vi.mock('../../src/lib/fulfillment/effects', () => ({
    runFulfillmentDriveCopyEffect,
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
    fulfillmentEffect: {
        effectKey: `drive.copy.session.${sessionId}`,
        jobId: '11111111-1111-4111-8111-111111111111',
        leaseOwner: 'test-worker',
        supabaseAdmin: {} as never,
    },
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
    identityResults: Array<ReturnType<typeof response> | Error>,
): void {
    listDriveFiles.mockImplementation(async ({ q }: { q?: string }) => {
        if (q?.includes('appProperties')) {
            const result = identityResults.shift();
            if (!result) throw new Error('unexpected class-document identity observation');
            if (result instanceof Error) throw result;
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
        driveCopyEffects.clear();
        driveCopyOutcomes.length = 0;
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
        expect(driveCopyOutcomes).toEqual([expect.objectContaining({
            documentId: existingDocument.id,
            outcome: 'accepted',
        })]);
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
        expect(driveCopyOutcomes).toEqual([expect.objectContaining({
            documentId: 'new-class-doc',
            outcome: 'accepted',
        })]);
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
        expect(driveCopyOutcomes).toEqual([expect.objectContaining({
            documentId: existingDocument.id,
            outcome: 'accepted',
        })]);
    });

    it('does not create a duplicate when the operation is replayed', async () => {
        const createdDocument = {
            ...existingDocument,
            id: 'new-class-doc',
            webViewLink: 'https://docs.google.com/document/d/new-class-doc/edit',
        };
        installFolderStructure([
            response([]),
        ]);
        copyDriveFile.mockResolvedValueOnce({ data: createdDocument });

        await expect(createClassDocument(params)).resolves.toMatchObject({
            docId: createdDocument.id,
        });
        await expect(createClassDocument(params)).resolves.toMatchObject({
            docId: createdDocument.id,
        });

        expect(copyDriveFile).toHaveBeenCalledTimes(1);
        expect(runFulfillmentDriveCopyEffect).toHaveBeenCalledTimes(2);
        expect(driveCopyOutcomes).toHaveLength(1);
    });

    it('quarantines an ambiguous copy when Drive visibility is unavailable and never copies again', async () => {
        installFolderStructure([
            response([]),
            new Error('Drive identity observation unavailable'),
        ]);
        copyDriveFile.mockRejectedValueOnce(new Error('connection ended without a response'));

        await expect(createClassDocument(params)).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
            requiresManualReview: true,
        });
        await expect(createClassDocument(params)).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_MANUAL_REVIEW',
            requiresManualReview: true,
        });

        expect(driveCopyOutcomes).toEqual([{ outcome: 'ambiguous' }]);
        expect(copyDriveFile).toHaveBeenCalledTimes(1);
    });

    it('retries an identity observation failure safely when no copy was attempted', async () => {
        installFolderStructure([
            new Error('Drive identity observation unavailable'),
        ]);

        await expect(createClassDocument(params)).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_DELIVERY_FAILED',
            requiresManualReview: false,
        });

        expect(driveCopyOutcomes).toEqual([{ outcome: 'retryable' }]);
        expect(copyDriveFile).not.toHaveBeenCalled();
    });

    it('fails closed when more than one document owns the session identity', async () => {
        installFolderStructure([
            response([
                existingDocument,
                { ...existingDocument, id: 'duplicate-class-doc' },
            ]),
        ]);

        await expect(createClassDocument(params)).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
            requiresManualReview: true,
        });
        expect(driveCopyOutcomes).toEqual([{ outcome: 'ambiguous' }]);
        expect(copyDriveFile).not.toHaveBeenCalled();
    });

    it('fails closed when Drive reports an incomplete identity search', async () => {
        installFolderStructure([response([], true)]);

        await expect(createClassDocument(params)).rejects.toMatchObject({
            code: 'FULFILLMENT_EFFECT_ACCEPTANCE_AMBIGUOUS',
            requiresManualReview: true,
        });
        expect(driveCopyOutcomes).toEqual([{ outcome: 'ambiguous' }]);
        expect(copyDriveFile).not.toHaveBeenCalled();
    });
});
