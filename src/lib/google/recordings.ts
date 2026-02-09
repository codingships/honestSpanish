/**
 * Meet Recording Handler
 * Future-proof infrastructure for processing Meet recordings
 * Will fail silently until Workspace license supports recordings
 */
import { drive } from '@googleapis/drive';
import { getAuthClient } from './auth';
import { findOrCreateFolder, moveFile, getFileLink } from './drive';

export interface ProcessRecordingOptions {
    meetLink: string;
    sessionId: string;
    studentRootFolderId: string;
    studentName: string;
    level: string;
}

export interface RecordingResult {
    success: boolean;
    recordingId?: string;
    recordingLink?: string;
    error?: string;
}

/**
 * Format date as DD/MM/YY
 */
function formatDateSpanish(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    return `${day}/${month}/${year}`;
}

/**
 * Find the "Meet Recordings" folder in the admin's Drive
 * This folder is auto-created by Google when recordings are enabled
 */
async function findMeetRecordingsFolder(): Promise<string | null> {
    const driveClient = drive({ version: 'v3', auth: getAuthClient() });

    try {
        const response = await driveClient.files.list({
            q: "name = 'Meet Recordings' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        const folder = response.data.files?.[0];
        return folder?.id || null;
    } catch (error) {
        console.log('[Recordings] Could not find Meet Recordings folder:',
            error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}

/**
 * Find a recording file that matches the Meet link
 * Meet recordings are named with the meeting code
 */
async function findRecordingByMeetLink(
    meetRecordingsFolderId: string,
    meetLink: string
): Promise<{ id: string; name: string } | null> {
    const driveClient = drive({ version: 'v3', auth: getAuthClient() });

    try {
        // Extract meeting code from Meet link (e.g., abc-defg-hij from meet.google.com/abc-defg-hij)
        const meetCodeMatch = meetLink.match(/meet\.google\.com\/([a-z-]+)/i);
        if (!meetCodeMatch) {
            console.log('[Recordings] Could not extract meeting code from link:', meetLink);
            return null;
        }
        const meetCode = meetCodeMatch[1];

        // Search for recent video files in Meet Recordings folder
        const response = await driveClient.files.list({
            q: `'${meetRecordingsFolderId}' in parents and mimeType contains 'video' and trashed = false`,
            fields: 'files(id, name, createdTime)',
            orderBy: 'createdTime desc',
            pageSize: 20,
        });

        // Find recording that contains the meeting code or was created recently
        const recording = response.data.files?.find(file =>
            file.name?.toLowerCase().includes(meetCode.toLowerCase())
        );

        if (recording?.id) {
            return { id: recording.id, name: recording.name || '' };
        }

        return null;
    } catch (error) {
        console.log('[Recordings] Error searching for recording:',
            error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}

/**
 * Find the level folder within student's root folder
 */
async function findLevelFolder(studentRootFolderId: string, studentName: string, level: string): Promise<string | null> {
    const driveClient = drive({ version: 'v3', auth: getAuthClient() });

    try {
        const levelFolderName = `${level} - ${studentName}`;
        const response = await driveClient.files.list({
            q: `name = '${levelFolderName}' and '${studentRootFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive',
        });

        return response.data.files?.[0]?.id || null;
    } catch (error) {
        console.log('[Recordings] Error finding level folder:',
            error instanceof Error ? error.message : 'Unknown error');
        return null;
    }
}

/**
 * Rename a file in Drive
 */
async function renameFile(fileId: string, newName: string): Promise<void> {
    const driveClient = drive({ version: 'v3', auth: getAuthClient() });

    try {
        await driveClient.files.update({
            fileId,
            requestBody: { name: newName },
        });
        console.log(`[Recordings] Renamed file to: ${newName}`);
    } catch (error) {
        console.log('[Recordings] Error renaming file:',
            error instanceof Error ? error.message : 'Unknown error');
    }
}

/**
 * Process a class recording - move from Meet Recordings to student folder
 * This will fail silently if:
 * - No Meet Recordings folder (license doesn't support it)
 * - No recording found for this session
 * - Any other error
 */
export async function processClassRecording(
    options: ProcessRecordingOptions
): Promise<RecordingResult> {
    try {
        console.log(`[Recordings] Processing recording for session ${options.sessionId}`);

        // 1. Find Meet Recordings folder
        const meetRecordingsFolderId = await findMeetRecordingsFolder();

        if (!meetRecordingsFolderId) {
            console.log('[Recordings] Meet Recordings folder not found - likely license limitation');
            return { success: true, error: 'no_recordings_folder' };
        }

        // 2. Find recording for this Meet
        const recording = await findRecordingByMeetLink(meetRecordingsFolderId, options.meetLink);

        if (!recording) {
            console.log('[Recordings] No recording found for this session - this is normal if recording is disabled');
            return { success: true, error: 'no_recording_found' };
        }

        // 3. Find level folder
        const levelFolderId = await findLevelFolder(
            options.studentRootFolderId,
            options.studentName,
            options.level
        );

        if (!levelFolderId) {
            console.log('[Recordings] Level folder not found');
            return { success: false, error: 'level_folder_not_found' };
        }

        // 4. Create or find "Grabaciones" folder within level folder
        const recordingsFolder = await findOrCreateFolder('Grabaciones', levelFolderId);

        if (!recordingsFolder.id) {
            console.log('[Recordings] Could not create Grabaciones folder');
            return { success: false, error: 'could_not_create_folder' };
        }

        // 5. Move recording to student's Grabaciones folder
        await moveFile(recording.id, recordingsFolder.id);

        // 6. Rename with consistent format
        const newName = `[${formatDateSpanish(new Date())}] - Grabación - Clase`;
        await renameFile(recording.id, newName);

        // 7. Get shareable link
        const recordingLink = await getFileLink(recording.id);

        console.log(`[Recordings] Successfully processed recording: ${recording.id}`);

        return {
            success: true,
            recordingId: recording.id,
            recordingLink,
        };

    } catch (error) {
        // Fail silently - never block main flows
        console.error('[Recordings] Error processing recording (non-blocking):',
            error instanceof Error ? error.message : 'Unknown error');
        return {
            success: false,
            error: error instanceof Error ? error.message : 'unknown_error',
        };
    }
}

/**
 * Check if recordings are available (license check)
 */
export async function checkRecordingsAvailable(): Promise<boolean> {
    const folder = await findMeetRecordingsFolder();
    return folder !== null;
}
