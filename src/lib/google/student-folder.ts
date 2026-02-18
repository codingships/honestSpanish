/**
 * Student Folder Structure Creation
 * Creates the complete Drive folder hierarchy for a student
 */
import { drive } from '@googleapis/drive';
import { docs } from '@googleapis/docs';
import { getAuthClient } from './auth';
import { googleConfig } from './config';
import { findOrCreateFolder, shareWithUser, getFileLink } from './drive';

export interface CreateStudentFolderOptions {
    studentName: string;
    studentEmail: string;
    teacherName?: string | null;
}

export interface LevelFolderInfo {
    folderId: string;
    exercisesFolderId: string;
    audioFolderId: string;
    indexDocId: string;
}

export interface StudentFolderResult {
    rootFolderId: string;
    rootFolderLink: string;
    levels: {
        A2: LevelFolderInfo;
        B1: LevelFolderInfo;
        B2: LevelFolderInfo;
        C1: LevelFolderInfo;
    };
}

const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;

/**
 * Create the complete folder structure for a student with ALL levels
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
    const teacherDisplay = teacherName || 'Por asignar';

    console.log(`[StudentFolder] Creating complete structure for ${studentName}`);

    // 1. Create root folder: "[Nombre] - [Email]"
    const rootFolderName = `${studentName} - ${studentEmail}`;
    const rootFolder = await findOrCreateFolder(rootFolderName, googleConfig.driveRootFolderId);

    if (!rootFolder.id) {
        throw new Error('Failed to create root folder');
    }

    // 2. Create all level folders
    const levels: Record<string, LevelFolderInfo> = {};

    for (const level of LEVELS) {
        try {
            console.log(`[StudentFolder] Creating level ${level} for ${studentName}`);

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
            console.error(`[StudentFolder] Error creating level ${level}:`,
                error instanceof Error ? error.message : 'Unknown error');
            // Continue with other levels even if one fails
        }
    }

    // 3. Share root folder with student (as viewer)
    try {
        await shareWithUser(rootFolder.id, studentEmail, 'reader');
        console.log(`[StudentFolder] Shared folder with ${studentEmail}`);
    } catch (error) {
        console.error(`[StudentFolder] Warning: Could not share folder with ${studentEmail}:`,
            error instanceof Error ? error.message : 'Unknown error');
    }

    // 4. Get shareable link
    const rootFolderLink = await getFileLink(rootFolder.id);

    console.log(`[StudentFolder] Complete structure created for ${studentName}`);

    return {
        rootFolderId: rootFolder.id,
        rootFolderLink,
        levels: levels as StudentFolderResult['levels'],
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

    // Create empty document
    const createResponse = await docsClient.documents.create({
        requestBody: {
            title: docTitle,
        },
    });

    const docId = createResponse.data.documentId;
    if (!docId) {
        throw new Error('Failed to create index document');
    }

    // Move document to the correct folder
    await driveClient.files.update({
        fileId: docId,
        addParents: parentFolderId,
        removeParents: 'root',
        fields: 'id, parents',
    });

    // Add initial content
    const initialContent = `${studentName} - Español (${level})

Índice de clases

[Las entradas se añadirán automáticamente]
`;

    await docsClient.documents.batchUpdate({
        documentId: docId,
        requestBody: {
            requests: [
                {
                    insertText: {
                        location: { index: 1 },
                        text: initialContent,
                    },
                },
            ],
        },
    });

    console.log(`[StudentFolder] Created index document: ${docTitle} (${docId})`);

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

    console.log(`[StudentFolder] Adding level ${level} for ${studentName}`);

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
            console.log(`[StudentFolder] Level folder not found: ${levelFolderName}`);
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
            console.log(`[StudentFolder] Ejercicios folder not found in ${levelFolderName}`);
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

        console.log(`[StudentFolder] Found structure for ${studentName} (${level})`);

        return {
            levelFolderId: levelFolder.id,
            exercisesFolderId: exercisesFolder.id,
            audioFolderId: audioFolder?.id || '',
            indexDocId: indexDoc?.id || null,
        };

    } catch (error) {
        console.error('[StudentFolder] Error getting folder structure:',
            error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}
