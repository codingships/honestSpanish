/**
 * Student Folder Structure Creation
 * Creates the complete Drive folder hierarchy for a student
 */
import { drive } from '@googleapis/drive';
import { docs } from '@googleapis/docs';
import { getAuthClient } from './auth';
import { googleConfig } from './config';
import { ensureAnyoneWithLinkPermission, findOrCreateFolder, getFolderLink } from './drive';
import { describeGoogleError } from './logging';

export interface CreateStudentFolderOptions {
    studentName: string;
    studentEmail: string;
    teacherName?: string | null;
    levels?: readonly [StudentLevel, ...StudentLevel[]];
}

export interface LevelFolderInfo {
    folderId: string;
    exercisesFolderId: string;
    audioFolderId: string;
    indexDocId: string;
}

const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

export type StudentLevel = typeof LEVELS[number];

export interface StudentFolderResult {
    rootFolderId: string;
    rootFolderLink: string;
    levels: Partial<Record<StudentLevel, LevelFolderInfo>>;
}

/**
 * Create the folder structure for a student (all levels by default)
 * 
 * Structure:
 * 📁 [Nombre Estudiante] - [Email]
 * ├── 📁 A2
 * │   └── 📁 Ejercicios
 * │       └── 📁 Audio
 * │       └── 📄 Índice de ejercicios
 * ├── 📁 B1
 * │   └── 📁 Ejercicios
 * │       └── 📁 Audio
 * │       └── 📄 Índice de ejercicios
 * ├── 📁 B2
 * │   └── 📁 Ejercicios
 * │       └── 📁 Audio
 * │       └── 📄 Índice de ejercicios
 * └── 📁 C1
 *     └── 📁 Ejercicios
 *         └── 📁 Audio
 *         └── 📄 Índice de ejercicios
 */
export async function createStudentFolderStructure(
    options: CreateStudentFolderOptions
): Promise<StudentFolderResult> {
    const { studentName, studentEmail, teacherName } = options;
    const requestedLevels: readonly StudentLevel[] = options.levels
        ? [...new Set(options.levels)]
        : LEVELS;
    const teacherDisplay = teacherName || 'Por asignar';

    console.log('[StudentFolder] Creating complete student structure');

    // 1. Create root folder: "[Nombre] - [Email]"
    const rootFolderName = `${studentName} - ${studentEmail}`;
    const rootFolder = await findOrCreateFolder(rootFolderName, googleConfig.driveRootFolderId);

    if (!rootFolder.id) {
        throw new Error('Failed to create root folder');
    }

    // 2. Create the requested level folders (all levels by default)
    const levels: StudentFolderResult['levels'] = {};

    for (const level of requestedLevels) {
        try {
            console.log(`[StudentFolder] Creating level ${level}`);

            // Create level folder
            const levelFolder = await findOrCreateFolder(level, rootFolder.id);
            if (!levelFolder.id) {
                throw new Error(`Failed to create ${level} folder`);
            }

            // Create Ejercicios folder
            const exercisesFolder = await findOrCreateFolder('Ejercicios', levelFolder.id);
            if (!exercisesFolder.id) {
                throw new Error(`Failed to create Ejercicios folder for ${level}`);
            }

            // Create Audio subfolder
            const audioFolder = await findOrCreateFolder('Audio', exercisesFolder.id);

            // Create index document
            const indexDoc = await createIndexDocument({
                studentName,
                teacherName: teacherDisplay,
                level,
                parentFolderId: exercisesFolder.id,
            });

            levels[level] = {
                folderId: levelFolder.id,
                exercisesFolderId: exercisesFolder.id,
                audioFolderId: audioFolder.id || '',
                indexDocId: indexDoc.id,
            };

            console.log(`[StudentFolder] Level ${level} created successfully`);
        } catch (error) {
            console.error(`[StudentFolder] Error creating level ${level}:`, describeGoogleError(error));
            if (options.levels) throw error;
            // Continue with other levels even if one fails
        }
    }

    // 3. Enable progressive access by default: anyone with the link can view.
    try {
        await ensureAnyoneWithLinkPermission(rootFolder.id, 'reader');
        console.log('[StudentFolder] Enabled public-link access');
    } catch (error) {
        console.error('[StudentFolder] Warning: Could not enable public-link access:', describeGoogleError(error));
    }

    // 4. Get shareable link
    const rootFolderLink = await getFolderLink(rootFolder.id);

    console.log('[StudentFolder] Complete student structure created');

    return {
        rootFolderId: rootFolder.id,
        rootFolderLink,
        levels,
    };
}

interface CreateIndexDocOptions {
    studentName: string;
    teacherName: string;
    level: string;
    parentFolderId: string;
}

/**
 * Create the index document for class entries
 */
async function createIndexDocument(options: CreateIndexDocOptions): Promise<{ id: string }> {
    const { studentName, teacherName, level, parentFolderId } = options;
    const docsClient = docs({ version: 'v1', auth: getAuthClient() });
    const driveClient = drive({ version: 'v3', auth: getAuthClient() });

    // Document title
    const docTitle = `${studentName} / ${teacherName} - Español (${level})`;

    const initialContent = `${studentName} - Español (${level})

Índice de clases

[Las entradas se añadirán automáticamente]
`;
    const initializeDocument = async (documentId: string): Promise<void> => {
        await docsClient.documents.batchUpdate({
            documentId,
            requestBody: {
                requests: [{
                    insertText: {
                        location: { index: 1 },
                        text: initialContent,
                    },
                }],
            },
        });
    };

    const escapedTitle = docTitle.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedParentId = parentFolderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const existingResponse = await driveClient.files.list({
        q: `name = '${escapedTitle}' and '${escapedParentId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 2,
    });
    const existingDocuments = existingResponse.data.files ?? [];
    if (existingDocuments.length > 1 || (existingDocuments.length === 1 && !existingDocuments[0]?.id)) {
        throw new Error('Ambiguous existing index document');
    }
    if (existingDocuments[0]?.id) {
        const documentId = existingDocuments[0].id;
        const existingDocument = await docsClient.documents.get({ documentId });
        const structuralContent = existingDocument.data.body?.content ?? [];
        const hasUnexpectedStructure = structuralContent.some((element) => (
            Boolean(element.table)
            || Boolean(element.tableOfContents)
            || (element.paragraph?.elements ?? []).some((paragraphElement) => !paragraphElement.textRun)
        ));
        const existingText = structuralContent
            .flatMap((element) => element.paragraph?.elements ?? [])
            .map((element) => element.textRun?.content ?? '')
            .join('');
        const isEmptyDocument = existingText.trim() === '';
        const hasCanonicalContent = existingText.trimEnd() === initialContent.trimEnd();
        if (hasUnexpectedStructure || (!isEmptyDocument && !hasCanonicalContent)) {
            throw new Error('Ambiguous existing index document content');
        }
        if (isEmptyDocument) {
            await initializeDocument(documentId);
            console.log('[StudentFolder] Initialized existing empty index document');
        } else {
            console.log('[StudentFolder] Reusing existing index document');
        }
        return { id: documentId };
    }

    // Create the Google Doc directly in its destination folder.
    const createResponse = await driveClient.files.create({
        requestBody: {
            name: docTitle,
            mimeType: 'application/vnd.google-apps.document',
            parents: [parentFolderId],
        },
        fields: 'id',
    });

    const docId = createResponse.data.id;
    if (!docId) {
        throw new Error('Failed to create index document');
    }

    await initializeDocument(docId);

    console.log('[StudentFolder] Created index document');

    return { id: docId };
}

/**
 * Add a new level folder to an existing student structure
 * Useful when a student advances to a new level
 */
export async function addLevelToStudent(
    rootFolderId: string,
    studentName: string,
    level: string,
    teacherName?: string | null
): Promise<{
    levelFolderId: string;
    exercisesFolderId: string;
    audioFolderId: string;
    indexDocId: string;
}> {
    const teacherDisplay = teacherName || 'Por asignar';

    console.log(`[StudentFolder] Adding level ${level}`);

    // Create level folder
    const levelFolderName = `${level} - ${studentName}`;
    const levelFolder = await findOrCreateFolder(levelFolderName, rootFolderId);

    if (!levelFolder.id) {
        throw new Error('Failed to create level folder');
    }

    // Create Ejercicios
    const exercisesFolder = await findOrCreateFolder('Ejercicios', levelFolder.id);

    // Create Audio
    const audioFolder = await findOrCreateFolder('Audio', exercisesFolder.id!);

    // Create index document
    const indexDoc = await createIndexDocument({
        studentName,
        teacherName: teacherDisplay,
        level,
        parentFolderId: levelFolder.id,
    });

    return {
        levelFolderId: levelFolder.id,
        exercisesFolderId: exercisesFolder.id!,
        audioFolderId: audioFolder.id!,
        indexDocId: indexDoc.id,
    };
}

export interface StudentFolderStructure {
    levelFolderId: string;
    exercisesFolderId: string;
    audioFolderId: string;
    indexDocId: string | null;
}

/**
 * Get existing folder structure for a student's level
 * Searches within the root folder for the level-specific folders
 */
export async function getStudentFolderStructure(
    rootFolderId: string,
    studentName: string,
    level: string
): Promise<StudentFolderStructure | null> {
    const driveClient = drive({ version: 'v3', auth: getAuthClient() });

    try {
        // Find level folder: "[Nivel] - [Nombre]"
        const levelFolderName = `${level} - ${studentName}`;
        const escapedLevelFolderName = levelFolderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const levelQuery = `name = '${escapedLevelFolderName}' and '${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

        const levelResponse = await driveClient.files.list({
            q: levelQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const levelFolder = levelResponse.data.files?.[0];
        if (!levelFolder?.id) {
            console.log(`[StudentFolder] Level folder not found for level ${level}`);
            return null;
        }

        // Find Ejercicios folder
        const exercisesQuery = `name = 'Ejercicios' and '${levelFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

        const exercisesResponse = await driveClient.files.list({
            q: exercisesQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const exercisesFolder = exercisesResponse.data.files?.[0];
        if (!exercisesFolder?.id) {
            console.log(`[StudentFolder] Ejercicios folder not found for level ${level}`);
            return null;
        }

        // Find Audio folder
        const audioQuery = `name = 'Audio' and '${exercisesFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

        const audioResponse = await driveClient.files.list({
            q: audioQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const audioFolder = audioResponse.data.files?.[0];

        // Find index document (Google Doc in level folder)
        const indexQuery = `'${levelFolder.id}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`;

        const indexResponse = await driveClient.files.list({
            q: indexQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const indexDoc = indexResponse.data.files?.[0];

        console.log(`[StudentFolder] Found structure for level ${level}`);

        return {
            levelFolderId: levelFolder.id,
            exercisesFolderId: exercisesFolder.id,
            audioFolderId: audioFolder?.id || '',
            indexDocId: indexDoc?.id || null,
        };

    } catch (error) {
        console.error('[StudentFolder] Error getting folder structure:', describeGoogleError(error));
        return null;
    }
}
