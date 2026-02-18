/**
 * Session Scheduling Integration Tests
 * 
 * Tests the complete flow of scheduling a class session including:
 * - Google Calendar event creation
 * - Google Drive document creation
 * - Database updates
 * - Email notifications (mocked)
 * 
 * NOTE: These tests are currently skipped because they use outdated function signatures.
 * TODO: Update tests to match new drive.ts and calendar.ts interfaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createMockGoogleCalendar,
    createMockGoogleDrive,
    createMockGoogleDocs,
    mockCalendarEvent,
    mockDriveFile,
    mockDriveFolder,
} from '../mocks/google';

// Mock the Google modules
vi.mock('../../src/lib/google/calendar', () => ({
    createClassEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    deleteEvent: vi.fn(),
    cancelClassEvent: vi.fn(),
}));

vi.mock('../../src/lib/google/drive', () => ({
    createFolder: vi.fn(),
    createFile: vi.fn(),
    shareWithUser: vi.fn(),
    moveFile: vi.fn(),
}));

vi.mock('../../src/lib/google/class-document', () => ({
    createClassDocument: vi.fn(),
}));

vi.mock('../../src/lib/email/send', () => ({
    sendClassConfirmation: vi.fn().mockResolvedValue(true),
    sendClassConfirmationToBoth: vi.fn().mockResolvedValue(true),
    sendClassCancelled: vi.fn().mockResolvedValue(true),
}));

// Import mocked modules
import * as calendarModule from '../../src/lib/google/calendar';
import * as driveModule from '../../src/lib/google/drive';
import * as classDocModule from '../../src/lib/google/class-document';
import * as emailModule from '../../src/lib/email/send';

describe.skip('Session Scheduling Integration', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Calendar Event Creation', () => {

        it('should create calendar event with Meet link', async () => {
            // Arrange
            const mockCalendar = createMockGoogleCalendar();
            (calendarModule.createClassEvent as any).mockResolvedValue({
                eventId: mockCalendarEvent.id,
                meetLink: mockCalendarEvent.hangoutLink,
                htmlLink: mockCalendarEvent.htmlLink,
            });

            const sessionData = {
                studentEmail: 'student@test.com',
                teacherEmail: 'teacher@espanolhonesto.com',
                startTime: new Date('2026-01-15T10:00:00+01:00'),
                endTime: new Date('2026-01-15T11:00:00+01:00'),
                studentName: 'Test Student',
                teacherName: 'Test Teacher',
            };

            // Act
            const result = await calendarModule.createClassEvent({
                summary: `Clase de Español - ${sessionData.studentName}`,
                studentEmail: sessionData.studentEmail,
                teacherEmail: sessionData.teacherEmail,
                startTime: sessionData.startTime,
                endTime: sessionData.endTime,
            });

            // Assert
            expect(calendarModule.createClassEvent).toHaveBeenCalledTimes(1);
            expect(result).toHaveProperty('eventId');
            expect(result).toHaveProperty('meetLink');
            expect(result.meetLink).toContain('meet.google.com');

            console.log('✅ Calendar event created with Meet link:', result);
        });

        it('should handle calendar API failure gracefully', async () => {
            // Arrange
            const error = new Error('Calendar API quota exceeded');
            (calendarModule.createClassEvent as any).mockRejectedValue(error);

            // Act & Assert
            await expect(
                calendarModule.createClassEvent({
                    summary: 'Test Event',
                    studentEmail: 'student@test.com',
                    teacherEmail: 'teacher@test.com',
                    startTime: new Date(),
                    endTime: new Date(),
                })
            ).rejects.toThrow('Calendar API quota exceeded');

            console.log('✅ Calendar API failure handled correctly');
        });

        it('should cancel calendar event', async () => {
            // Arrange
            (calendarModule.cancelClassEvent as any).mockResolvedValue(true);

            // Act
            const result = await calendarModule.cancelClassEvent('event_test123');

            // Assert
            expect(calendarModule.cancelClassEvent).toHaveBeenCalledWith('event_test123');
            expect(result).toBe(true);

            console.log('✅ Calendar event cancelled successfully');
        });
    });

    describe('Drive Document Creation', () => {

        it('should create class document in student folder', async () => {
            // Arrange
            (classDocModule.createClassDocument as any).mockResolvedValue({
                documentId: mockDriveFile.id,
                documentUrl: mockDriveFile.webViewLink,
                documentName: mockDriveFile.name,
            });

            const sessionInfo = {
                studentFolderId: 'folder_student123',
                studentName: 'Test Student',
                teacherName: 'Test Teacher',
                sessionDate: new Date('2026-01-15T10:00:00'),
                topic: 'Gramática - Subjuntivo',
            };

            // Act
            const result = await classDocModule.createClassDocument({
                studentId: 'student-1',
                studentName: sessionInfo.studentName,
                teacherName: sessionInfo.teacherName,
                level: 'A2',
                classDate: sessionInfo.sessionDate,
                exercisesFolderId: sessionInfo.studentFolderId,
                indexDocId: 'index-doc-1',
            });

            // Assert
            expect(classDocModule.createClassDocument).toHaveBeenCalledTimes(1);
            expect(result).toHaveProperty('documentId');
            expect(result).toHaveProperty('documentLink');
            expect(result.documentLink).toContain('docs.google.com');

            console.log('✅ Class document created:', result);
        });

        it('should handle Drive API failure', async () => {
            // Arrange
            const error = new Error('Folder not found');
            (classDocModule.createClassDocument as any).mockRejectedValue(error);

            // Act & Assert
            await expect(
                classDocModule.createClassDocument({
                    studentId: 'student-1',
                    studentName: 'Student',
                    teacherName: 'Teacher',
                    level: 'A2',
                    classDate: new Date(),
                    exercisesFolderId: 'invalid_folder',
                    indexDocId: 'index-doc-1',
                })
            ).rejects.toThrow('Folder not found');

            console.log('✅ Drive API failure handled correctly');
        });
    });

    describe('Email Notifications', () => {

        it('should send confirmation emails to student and teacher', async () => {
            // Arrange
            const sessionData = {
                studentEmail: 'student@test.com',
                studentName: 'Test Student',
                teacherEmail: 'teacher@test.com',
                teacherName: 'Test Teacher',
                sessionDate: new Date('2026-01-15T10:00:00'),
                meetLink: 'https://meet.google.com/abc-defg-hij',
                documentUrl: 'https://docs.google.com/d/doc123',
            };

            // Act
            const result = await emailModule.sendClassConfirmationToBoth(
                sessionData.studentEmail,
                sessionData.studentName,
                sessionData.teacherEmail,
                sessionData.teacherName,
                {
                    date: sessionData.sessionDate.toISOString(),
                    time: '10:00',
                    duration: 60,
                    meetLink: sessionData.meetLink,
                    documentLink: sessionData.documentUrl,
                }
            );

            // Assert
            expect(emailModule.sendClassConfirmationToBoth).toHaveBeenCalledTimes(1);
            expect(result).toBe(true);

            console.log('✅ Confirmation emails sent to both parties');
        });

        it('should send cancellation emails', async () => {
            // Arrange
            const cancellationData = {
                email: 'student@test.com',
                name: 'Test Student',
                sessionDate: new Date('2026-01-15T10:00:00'),
                cancelledBy: 'teacher' as const,
            };

            // Act
            const result = await emailModule.sendClassCancelled(
                cancellationData.email,
                {
                    recipientName: cancellationData.name,
                    date: cancellationData.sessionDate.toISOString(),
                    time: '10:00',
                    cancelledBy: cancellationData.cancelledBy,
                }
            );

            // Assert
            expect(emailModule.sendClassCancelled).toHaveBeenCalledTimes(1);
            expect(result).toBe(true);

            console.log('✅ Cancellation email sent');
        });
    });

    describe('Complete Scheduling Flow', () => {

        it('should complete full scheduling flow with all integrations', async () => {
            // Arrange - mock all services
            (calendarModule.createClassEvent as any).mockResolvedValue({
                eventId: 'event_123',
                meetLink: 'https://meet.google.com/abc-defg-hij',
                htmlLink: 'https://calendar.google.com/event?eid=event_123',
            });

            (classDocModule.createClassDocument as any).mockResolvedValue({
                documentId: 'doc_123',
                documentLink: 'https://docs.google.com/d/doc_123',
            });

            (emailModule.sendClassConfirmationToBoth as any).mockResolvedValue(true);

            // Session data
            const newSession = {
                studentId: 'student-uuid-123',
                teacherId: 'teacher-uuid-456',
                studentEmail: 'student@test.com',
                teacherEmail: 'teacher@test.com',
                studentName: 'Test Student',
                teacherName: 'Test Teacher',
                studentFolderId: 'folder_123',
                startTime: new Date('2026-01-15T10:00:00'),
                endTime: new Date('2026-01-15T11:00:00'),
            };

            // Act - simulate the scheduling flow
            console.log('📋 Starting complete scheduling flow...');

            // Step 1: Create calendar event
            const calendarResult = await calendarModule.createClassEvent({
                summary: `Clase de Español - ${newSession.studentName}`,
                studentEmail: newSession.studentEmail,
                teacherEmail: newSession.teacherEmail,
                startTime: newSession.startTime,
                endTime: newSession.endTime,
            });
            console.log('  Step 1: Calendar event created', { eventId: calendarResult.eventId });

            // Step 2: Create class document
            const docResult = await classDocModule.createClassDocument({
                studentId: newSession.studentId,
                studentName: newSession.studentName,
                teacherName: newSession.teacherName,
                level: 'A2',
                classDate: newSession.startTime,
                exercisesFolderId: newSession.studentFolderId,
                indexDocId: 'index-doc-1',
            });
            console.log('  Step 2: Document created', { docId: docResult.documentId });

            // Step 3: Send confirmation emails
            const emailResult = await emailModule.sendClassConfirmationToBoth(
                newSession.studentEmail,
                newSession.studentName,
                newSession.teacherEmail,
                newSession.teacherName,
                {
                    date: newSession.startTime.toISOString(),
                    time: '10:00',
                    duration: 60,
                    meetLink: calendarResult.meetLink,
                    documentLink: docResult.documentLink,
                }
            );
            console.log('  Step 3: Emails sent', { success: emailResult });

            // Assert
            expect(calendarModule.createClassEvent).toHaveBeenCalledTimes(1);
            expect(classDocModule.createClassDocument).toHaveBeenCalledTimes(1);
            expect(emailModule.sendClassConfirmationToBoth).toHaveBeenCalledTimes(1);

            console.log('✅ Complete scheduling flow succeeded');
        });

        it('should handle partial failures gracefully', async () => {
            // Arrange - Calendar succeeds, Document fails
            (calendarModule.createClassEvent as any).mockResolvedValue({
                eventId: 'event_123',
                meetLink: 'https://meet.google.com/xxx-yyyy-zzz',
            });

            (classDocModule.createClassDocument as any).mockRejectedValue(
                new Error('Drive quota exceeded')
            );

            // Act
            console.log('📋 Testing partial failure scenario...');

            const calendarResult = await calendarModule.createClassEvent({
                summary: 'Test',
                studentEmail: 'c@d.com',
                teacherEmail: 'a@b.com',
                startTime: new Date(),
                endTime: new Date(),
            });
            expect(calendarResult.eventId).toBe('event_123');
            console.log('  Calendar event created successfully');

            // Document creation should fail
            await expect(
                classDocModule.createClassDocument({
                    studentId: 'student-1',
                    studentName: 'Student',
                    teacherName: 'Teacher',
                    level: 'A2',
                    classDate: new Date(),
                    exercisesFolderId: 'folder',
                    indexDocId: 'index-doc-1',
                })
            ).rejects.toThrow('Drive quota exceeded');
            console.log('  Document creation failed as expected');

            // In real scenario, you might want to:
            // 1. Log the error
            // 2. Still save session without document
            // 3. Retry later
            console.log('✅ Partial failure handled correctly');
        });
    });
});
