/**
 * Google Drive API Client
 * Provides helper functions for folder and file management
 */
import { drive, drive_v3 } from '@googleapis/drive';
import { docs } from '@googleapis/docs';
import { getAuthClient } from './auth';
import { googleConfig } from './config';

let cachedDriveClient: drive_v3.Drive | null = null;

/**
 * Get authenticated Drive client
 */
export function getDriveClient(): drive_v3.Drive {
    if (cachedDriveClient) {
        return cachedDriveClient;
    }

    const auth = getAuthClient();
    cachedDriveClient = drive({ version: 'v3', auth });
    return cachedDriveClient;
}

/**
 * Find a folder by name within a parent folder
 */
export async function findFolder(name: string, parentId?: string): Promise<drive_v3.Schema$File | null> {
    const drive = getDriveClient();
    const parent = parentId || googleConfig.driveRootFolderId;

    try {
        const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const query = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and '${parent}' in parents and trashed = false`;

        const response = await drive.files.list({
            q: query,
            fields: 'files(id, name, webViewLink)',
            spaces: 'drive',
        });

        return response.data.files?.[0] || null;
    } catch (error) {
        console.error('[Drive] Error finding folder:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Create a new folder
 */
export async function createFolder(name: string, parentId?: string): Promise<drive_v3.Schema$File> {
    const drive = getDriveClient();
    const parent = parentId || googleConfig.driveRootFolderId;

    try {
        const response = await drive.files.create({
            requestBody: {
                name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parent],
            },
            fields: 'id, name, webViewLink',
        });

        console.log(`[Drive] Created folder: ${name} (${response.data.id})`);
        return response.data;
    } catch (error) {
        console.error('[Drive] Error creating folder:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Find or create a folder if it doesn't exist
 */
export async function findOrCreateFolder(name: string, parentId?: string): Promise<drive_v3.Schema$File> {
    const existing = await findFolder(name, parentId);
    if (existing) {
        console.log(`[Drive] Found existing folder: ${name} (${existing.id})`);
        return existing;
    }
    return createFolder(name, parentId);
}

/**
 * Share a folder or file with a user
 */
export async function shareWithUser(fileId: string, email: string, role: 'reader' | 'writer' | 'commenter' = 'writer'): Promise<void> {
    const drive = getDriveClient();

    try {
        await drive.permissions.create({
            fileId,
            requestBody: {
                type: 'user',
                role,
                emailAddress: email,
            },
            sendNotificationEmail: false,
        });

        console.log(`[Drive] Shared ${fileId} with ${email} as ${role}`);
    } catch (error) {
        console.error('[Drive] Error sharing file:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Copy a file to a destination folder
 */
export async function copyFile(fileId: string, newName: string, destinationFolderId: string): Promise<drive_v3.Schema$File> {
    const drive = getDriveClient();

    try {
        const response = await drive.files.copy({
            fileId,
            requestBody: {
                name: newName,
                parents: [destinationFolderId],
            },
            fields: 'id, name, webViewLink',
        });

        console.log(`[Drive] Copied file to: ${newName} (${response.data.id})`);
        return response.data;
    } catch (error) {
        console.error('[Drive] Error copying file:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Move a file to a new parent folder
 */
export async function moveFile(fileId: string, newParentId: string): Promise<drive_v3.Schema$File> {
    const drive = getDriveClient();

    try {
        // Get current parents
        const file = await drive.files.get({
            fileId,
            fields: 'parents',
        });

        const previousParents = file.data.parents?.join(',') || '';

        // Move to new parent
        const response = await drive.files.update({
            fileId,
            addParents: newParentId,
            removeParents: previousParents,
            fields: 'id, name, webViewLink',
        });

        console.log(`[Drive] Moved file ${fileId} to ${newParentId}`);
        return response.data;
    } catch (error) {
        console.error('[Drive] Error moving file:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Append content to a Google Doc
 */
export async function appendToDocument(docId: string, content: string): Promise<void> {
    const docsClient = docs({ version: 'v1', auth: getAuthClient() });

    try {
        // Get document to find end index
        const doc = await docsClient.documents.get({ documentId: docId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Insert content at end
        await docsClient.documents.batchUpdate({
            documentId: docId,
            requestBody: {
                requests: [
                    {
                        insertText: {
                            location: { index: endIndex - 1 },
                            text: content,
                        },
                    },
                ],
            },
        });

        console.log(`[Drive] Appended content to doc ${docId}`);
    } catch (error) {
        console.error('[Drive] Error appending to document:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Get shareable link for a file
 */
export async function getFileLink(fileId: string): Promise<string> {
    const drive = getDriveClient();

    try {
        const response = await drive.files.get({
            fileId,
            fields: 'webViewLink',
        });

        return response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    } catch (error) {
        console.error('[Drive] Error getting file link:', error instanceof Error ? error.message : 'Unknown error');
        return `https://drive.google.com/file/d/${fileId}/view`;
    }
}

/**
 * List files in a folder
 */
export async function listFilesInFolder(folderId: string): Promise<drive_v3.Schema$File[]> {
    const drive = getDriveClient();

    try {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType, webViewLink, createdTime)',
            orderBy: 'createdTime desc',
        });

        return response.data.files || [];
    } catch (error) {
        console.error('[Drive] Error listing files:', error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

// ============================================
// Class Document Functions
// ============================================

export interface StudentLevelStructure {
    levelFolderId: string;
    exercisesFolderId: string;
    audioFolderId: string;
    indexDocId: string | null;
}

/**
 * Get the folder structure for a student's specific level
 */
export async function getStudentLevelStructure(
    rootFolderId: string,
    level: 'A2' | 'B1' | 'B2' | 'C1'
): Promise<StudentLevelStructure | null> {
    const drive = getDriveClient();

    try {
        // Find level folder (e.g., "A2") within the root folder
        const levelQuery = `name = '${level}' and '${rootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const levelResponse = await drive.files.list({
            q: levelQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const levelFolder = levelResponse.data.files?.[0];
        if (!levelFolder?.id) {
            console.error(`[Drive] Level folder ${level} not found in ${rootFolderId}`);
            return null;
        }

        // Find "Ejercicios" folder within the level folder
        const exercisesQuery = `name = 'Ejercicios' and '${levelFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const exercisesResponse = await drive.files.list({
            q: exercisesQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const exercisesFolder = exercisesResponse.data.files?.[0];
        if (!exercisesFolder?.id) {
            console.error(`[Drive] Ejercicios folder not found in ${level}`);
            return null;
        }

        // Find "Audio" folder within Ejercicios
        const audioQuery = `name = 'Audio' and '${exercisesFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const audioResponse = await drive.files.list({
            q: audioQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const audioFolder = audioResponse.data.files?.[0];

        // Find index document (Google Doc) within Ejercicios folder
        const indexQuery = `'${exercisesFolder.id}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`;
        const indexResponse = await drive.files.list({
            q: indexQuery,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const indexDoc = indexResponse.data.files?.[0];

        console.log(`[Drive] Found structure for level ${level}: exercises=${exercisesFolder.id}, index=${indexDoc?.id || 'none'}`);

        return {
            levelFolderId: levelFolder.id,
            exercisesFolderId: exercisesFolder.id,
            audioFolderId: audioFolder?.id || '',
            indexDocId: indexDoc?.id || null,
        };

    } catch (error) {
        console.error('[Drive] Error getting student level structure:',
            error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}

export interface CreateClassDocumentParams {
    studentName: string;
    studentRootFolderId: string;
    level: 'A2' | 'B1' | 'B2' | 'C1';
    classDate: Date;
}

export interface ClassDocumentResult {
    docId: string;
    docUrl: string;
}

/**
 * Format date in Spanish format DD/MM/YY with Europe/Madrid timezone
 */
function formatDateSpanish(date: Date): string {
    const formatter = new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        timeZone: 'Europe/Madrid',
    });
    return formatter.format(date);
}

/**
 * Create a class document by copying the template and adding to index
 */
export async function createClassDocument(
    params: CreateClassDocumentParams
): Promise<ClassDocumentResult | null> {
    const { studentName, studentRootFolderId, level, classDate } = params;
    const drive = getDriveClient();

    try {
        // 1. Get folder structure for the level
        const structure = await getStudentLevelStructure(studentRootFolderId, level);
        if (!structure) {
            console.error(`[Drive] Cannot create class document: folder structure not found for ${level}`);
            return null;
        }

        // 2. Format date and create document name
        const dateStr = formatDateSpanish(classDate);
        const docName = `${dateStr} - Ejercicios - ${studentName}`;

        // 3. Copy template document
        const templateId = googleConfig.templateDocId;
        if (!templateId) {
            console.error('[Drive] GOOGLE_TEMPLATE_DOC_ID not configured');
            return null;
        }

        const copyResponse = await drive.files.copy({
            fileId: templateId,
            requestBody: {
                name: docName,
                parents: [structure.exercisesFolderId],
            },
            fields: 'id, name, webViewLink',
        });

        const newDocId = copyResponse.data.id;
        const newDocUrl = copyResponse.data.webViewLink || `https://docs.google.com/document/d/${newDocId}/edit`;

        if (!newDocId) {
            console.error('[Drive] Failed to copy template document');
            return null;
        }

        console.log(`[Drive] Created class document: ${docName} (${newDocId})`);

        // 4. Append to index document (non-blocking)
        if (structure.indexDocId) {
            try {
                await appendToIndexDocument(structure.indexDocId, classDate, newDocUrl);
            } catch (indexError) {
                console.warn('[Drive] Warning: Could not update index document:',
                    indexError instanceof Error ? indexError.message : 'Unknown error');
                // Continue - document was created successfully
            }
        } else {
            console.warn('[Drive] No index document found, skipping index update');
        }

        return {
            docId: newDocId,
            docUrl: newDocUrl,
        };

    } catch (error) {
        console.error('[Drive] Error creating class document:',
            error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}

/**
 * Append a new entry to the index document
 */
export async function appendToIndexDocument(
    indexDocId: string,
    classDate: Date,
    docUrl: string
): Promise<void> {
    const docsClient = docs({ version: 'v1', auth: getAuthClient() });

    try {
        // Get document to find end index
        const doc = await docsClient.documents.get({ documentId: indexDocId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Format entry: • DD/MM/YY - [Link al documento]
        const dateStr = formatDateSpanish(classDate);
        const entry = `\n• ${dateStr} - ${docUrl}`;

        // Insert at end of document
        await docsClient.documents.batchUpdate({
            documentId: indexDocId,
            requestBody: {
                requests: [
                    {
                        insertText: {
                            location: { index: endIndex - 1 },
                            text: entry,
                        },
                    },
                ],
            },
        });

        console.log(`[Drive] Added entry to index: ${dateStr}`);
    } catch (error) {
        console.error('[Drive] Error appending to index document:',
            error instanceof Error ? error.message : 'Unknown error');
        throw error;
    }
}

/**
 * Upload a file Buffer directly to a specific Google Drive folder
 */
export async function uploadFileToFolder(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    folderId: string
): Promise<ClassDocumentResult | null> {
    const drive = getDriveClient();

    try {
        const Readable = (await import('stream')).Readable;
        const body = new Readable();
        body.push(buffer);
        body.push(null);

        const response = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [folderId],
            },
            media: {
                mimeType,
                body,
            },
            fields: 'id, webViewLink'
        });

        if (!response.data.id) return null;

        console.log(`[Drive] Uploaded file: ${fileName} to ${folderId}`);
        return {
            docId: response.data.id,
            docUrl: response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`
        };
    } catch (error) {
        console.error('[Drive] Error uploading file:', error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}
