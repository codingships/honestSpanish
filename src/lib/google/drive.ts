/**
 * Google Drive API Client
 * Provides helper functions for folder and file management
 */
import { google, drive_v3 } from 'googleapis';
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
    cachedDriveClient = google.drive({ version: 'v3', auth });
    return cachedDriveClient;
}

/**
 * Find a folder by name within a parent folder
 */
export async function findFolder(name: string, parentId?: string): Promise<drive_v3.Schema$File | null> {
    const drive = getDriveClient();
    const parent = parentId || googleConfig.driveRootFolderId;

    try {
        const query = `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and '${parent}' in parents and trashed = false`;

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
    const docs = google.docs({ version: 'v1', auth: getAuthClient() });

    try {
        // Get document to find end index
        const doc = await docs.documents.get({ documentId: docId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Insert content at end
        await docs.documents.batchUpdate({
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
