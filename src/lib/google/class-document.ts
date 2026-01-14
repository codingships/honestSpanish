/**
 * Class Document Creation
 * Creates exercise documents for each scheduled class from template
 */
import { google } from 'googleapis';
import { getAuthClient } from './auth';
import { googleConfig } from './config';
import { copyFile, getFileLink } from './drive';

export interface CreateClassDocumentOptions {
    studentId: string;
    studentName: string;
    teacherName: string;
    level: string;
    classDate: Date;
    exercisesFolderId: string;
    indexDocId: string;
}

export interface ClassDocumentResult {
    documentId: string;
    documentLink: string;
}

/**
 * Format date as DD/MM/YY (Spanish format)
 */
function formatDateSpanish(date: Date): string {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    return `${day}/${month}/${year}`;
}

/**
 * Create a class document by copying the master template
 */
export async function createClassDocument(
    options: CreateClassDocumentOptions
): Promise<ClassDocumentResult> {
    const { studentName, classDate, exercisesFolderId, indexDocId } = options;
    const dateStr = formatDateSpanish(classDate);

    // Get first name only for cleaner doc name
    const firstName = studentName.split(' ')[0];
    const docName = `${dateStr} - Ejercicios - ${firstName}`;

    console.log(`[ClassDocument] Creating document: ${docName}`);

    // 1. Copy template to exercises folder
    if (!googleConfig.templateDocId) {
        throw new Error('GOOGLE_TEMPLATE_DOC_ID not configured');
    }

    const copiedDoc = await copyFile(
        googleConfig.templateDocId,
        docName,
        exercisesFolderId
    );

    if (!copiedDoc.id) {
        throw new Error('Failed to copy template document');
    }

    console.log(`[ClassDocument] Created document: ${copiedDoc.id}`);

    // 2. Get shareable link
    const documentLink = await getFileLink(copiedDoc.id);

    // 3. Update index document with new entry
    try {
        await addEntryToIndexDocument(indexDocId, dateStr, documentLink);
    } catch (error) {
        // Log but don't fail - document is already created
        console.error('[ClassDocument] Warning: Could not update index document:',
            error instanceof Error ? error.message : 'Unknown error');
    }

    return {
        documentId: copiedDoc.id,
        documentLink,
    };
}

/**
 * Add an entry to the index document with a hyperlink
 */
async function addEntryToIndexDocument(
    indexDocId: string,
    dateStr: string,
    documentLink: string
): Promise<void> {
    const docs = google.docs({ version: 'v1', auth: getAuthClient() });

    try {
        // Get document to find end index
        const doc = await docs.documents.get({ documentId: indexDocId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Text to insert
        const entryText = `\n• ${dateStr} - `;
        const linkText = 'Ver ejercicios';

        // Insert text first
        await docs.documents.batchUpdate({
            documentId: indexDocId,
            requestBody: {
                requests: [
                    {
                        insertText: {
                            location: { index: endIndex - 1 },
                            text: entryText + linkText,
                        },
                    },
                ],
            },
        });

        // Get updated document to find link position
        const updatedDoc = await docs.documents.get({ documentId: indexDocId });
        const newEndIndex = updatedDoc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Calculate position of "Ver ejercicios" text
        const linkStartIndex = newEndIndex - linkText.length - 1;
        const linkEndIndex = newEndIndex - 1;

        // Add hyperlink to the text
        await docs.documents.batchUpdate({
            documentId: indexDocId,
            requestBody: {
                requests: [
                    {
                        updateTextStyle: {
                            range: {
                                startIndex: linkStartIndex,
                                endIndex: linkEndIndex,
                            },
                            textStyle: {
                                link: { url: documentLink },
                            },
                            fields: 'link',
                        },
                    },
                ],
            },
        });

        console.log(`[ClassDocument] Added entry to index: ${dateStr}`);
    } catch (error) {
        console.error('[ClassDocument] Error updating index:', error);
        throw error;
    }
}

/**
 * Create multiple class documents (batch operation)
 */
export async function createClassDocumentsBatch(
    options: CreateClassDocumentOptions[]
): Promise<ClassDocumentResult[]> {
    const results: ClassDocumentResult[] = [];

    for (const opt of options) {
        try {
            const result = await createClassDocument(opt);
            results.push(result);
        } catch (error) {
            console.error(`[ClassDocument] Failed to create doc for ${opt.studentName}:`, error);
        }
    }

    return results;
}

/**
 * Link a recording to an existing class document
 * Appends a recording section at the end of the document
 * Fails silently if there are any errors
 */
export async function linkRecordingToDocument(
    documentId: string,
    recordingLink: string
): Promise<void> {
    try {
        const docs = google.docs({ version: 'v1', auth: getAuthClient() });

        // Get document to find end index
        const doc = await docs.documents.get({ documentId });
        const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

        // Content to append
        const recordingSection = `\n\n---\n🎥 Grabación de la clase: ${recordingLink}`;

        // Append recording section
        await docs.documents.batchUpdate({
            documentId,
            requestBody: {
                requests: [
                    {
                        insertText: {
                            location: { index: endIndex - 1 },
                            text: recordingSection,
                        },
                    },
                ],
            },
        });

        console.log(`[ClassDocument] Linked recording to document ${documentId}`);
    } catch (error) {
        // Fail silently - recording linking is not critical
        console.error('[ClassDocument] Failed to link recording to document:',
            error instanceof Error ? error.message : 'Unknown error');
    }
}
