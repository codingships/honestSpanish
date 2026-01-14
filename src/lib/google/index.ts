/**
 * Google APIs - Main exports
 */

// Configuration
export { googleConfig, validateGoogleConfig } from './config';

// Authentication
export { getAuthClient, clearAuthCache, testAuth } from './auth';

// Drive
export {
    getDriveClient,
    findFolder,
    createFolder,
    findOrCreateFolder,
    shareWithUser,
    copyFile,
    moveFile,
    appendToDocument,
    getFileLink,
    listFilesInFolder,
} from './drive';

// Calendar
export {
    getCalendarClient,
    createEventWithMeet,
    createClassEvent,
    cancelClassEvent,
    updateCalendarEvent,
    getEvent,
    updateEvent,
    deleteEvent,
    listUpcomingEvents,
    type CreateEventOptions,
    type CalendarEvent,
    type CreateClassEventOptions,
    type ClassEventResult,
} from './calendar';

// Student Folder
export {
    createStudentFolderStructure,
    addLevelToStudent,
    getStudentFolderStructure,
    type CreateStudentFolderOptions,
    type StudentFolderResult,
    type StudentFolderStructure,
} from './student-folder';

// Class Document
export {
    createClassDocument,
    createClassDocumentsBatch,
    linkRecordingToDocument,
    type CreateClassDocumentOptions,
    type ClassDocumentResult,
} from './class-document';

// Recordings
export {
    processClassRecording,
    checkRecordingsAvailable,
    type ProcessRecordingOptions,
    type RecordingResult,
} from './recordings';
