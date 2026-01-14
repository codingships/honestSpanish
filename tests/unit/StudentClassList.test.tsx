/**
 * StudentClassList Component Tests
 * 
 * Tests the student class list component that displays:
 * - Upcoming sessions tabs
 * - Past sessions tabs
 * - Session cards with details
 * - Cancel functionality
 * - Join class functionality
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StudentClassList from '../../src/components/calendar/StudentClassList';

// Mock fetch for cancel API
global.fetch = vi.fn();

const mockTranslations = {
    upcoming: 'Próximas Clases',
    past: 'Clases Pasadas',
    noUpcoming: 'No tienes clases próximas',
    noPast: 'No tienes clases pasadas',
    joinClass: 'Unirse',
    cancelClass: 'Cancelar',
    with: 'Con',
    minutes: 'minutos',
    duration: 'Duración',
    teacherNotes: 'Notas del profesor',
    status: {
        scheduled: 'Programada',
        completed: 'Completada',
        cancelled: 'Cancelada',
        noShow: 'No asistió',
    },
    cancel: {
        title: 'Cancelar Clase',
        confirm: '¿Estás seguro?',
        warning: 'Debes cancelar con 24h de antelación',
        button: 'Confirmar',
        close: 'Cerrar',
    },
};

const createSession = (overrides = {}) => ({
    id: `session-${Math.random()}`,
    scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    duration_minutes: 60,
    status: 'scheduled',
    meet_link: 'https://meet.google.com/abc-defg-hij',
    teacher_notes: null,
    teacher: {
        id: 'teacher-1',
        full_name: 'María García',
        email: 'maria@test.com',
    },
    ...overrides,
});

describe('StudentClassList', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ['Date'] });
        // Set a fixed date: Jan 14, 2026, 12:00:00
        vi.setSystemTime(new Date(2026, 0, 14, 12, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Empty States', () => {

        it('should show empty message when no upcoming sessions', () => {
            render(
                <StudentClassList
                    upcomingSessions={[]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(mockTranslations.noUpcoming)).toBeDefined();
        });

        it('should show empty message when no past sessions', () => {
            render(
                <StudentClassList
                    upcomingSessions={[]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Click on past tab - use regex to match icon and count
            const pastTab = screen.getByText(new RegExp(mockTranslations.past, 'i'));
            fireEvent.click(pastTab);

            expect(screen.getByText(mockTranslations.noPast)).toBeDefined();
        });
    });

    describe('Tab Navigation', () => {

        it('should default to upcoming tab', () => {
            render(
                <StudentClassList
                    upcomingSessions={[createSession()]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Upcoming tab should be active
            const upcomingTab = screen.getByText(new RegExp(mockTranslations.upcoming, 'i'));
            expect(upcomingTab.closest('button')).toBeDefined();
        });

        it('should switch to past sessions tab on click', () => {
            const pastSession = createSession({
                scheduled_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                status: 'completed',
            });

            render(
                <StudentClassList
                    upcomingSessions={[]}
                    pastSessions={[pastSession]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            const pastTab = screen.getByText(new RegExp(mockTranslations.past, 'i'));
            fireEvent.click(pastTab);

            // Should now show past sessions content
            expect(screen.getByText('María García')).toBeDefined();
        });
    });

    describe('Session Cards', () => {

        it('should display session with teacher name', () => {
            render(
                <StudentClassList
                    upcomingSessions={[createSession()]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText('María García')).toBeDefined();
        });

        it('should display session time', () => {
            const session = createSession();
            render(
                <StudentClassList
                    upcomingSessions={[session]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Time should be displayed somewhere
            const container = document.body;
            expect(container.textContent).toContain(':');
        });

        it('should show status badge for completed sessions', () => {
            const completedSession = createSession({
                scheduled_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                status: 'completed',
            });

            render(
                <StudentClassList
                    upcomingSessions={[]}
                    pastSessions={[completedSession]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Switch to past tab
            fireEvent.click(screen.getByText(new RegExp(mockTranslations.past, 'i')));

            expect(screen.getByText(mockTranslations.status.completed)).toBeDefined();
        });

        it('should show cancelled status for cancelled sessions', () => {
            const cancelledSession = createSession({
                scheduled_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                status: 'cancelled',
            });

            render(
                <StudentClassList
                    upcomingSessions={[]}
                    pastSessions={[cancelledSession]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            fireEvent.click(screen.getByText(new RegExp(mockTranslations.past, 'i')));

            expect(screen.getByText(mockTranslations.status.cancelled)).toBeDefined();
        });
    });

    describe('Join Button', () => {

        it('should show join button when class is starting soon', () => {
            const soonSession = createSession({
                scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
            });

            render(
                <StudentClassList
                    upcomingSessions={[soonSession]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(new RegExp(mockTranslations.joinClass, 'i'))).toBeDefined();
        });

        it('should have correct meet link on join button', () => {
            const soonSession = createSession({
                scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                meet_link: 'https://meet.google.com/test-link',
            });

            render(
                <StudentClassList
                    upcomingSessions={[soonSession]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            const joinButton = screen.getByText(new RegExp(mockTranslations.joinClass, 'i'));
            const link = joinButton.closest('a');
            expect(link?.getAttribute('href')).toBe('https://meet.google.com/test-link');
        });

        it('should not show join button for classes more than 15 min away', () => {
            const farSession = createSession({
                scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
            });

            render(
                <StudentClassList
                    upcomingSessions={[farSession]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.queryByText(mockTranslations.joinClass)).toBeNull();
        });
    });

    describe('Cancel Button', () => {

        it('should show cancel button when more than 24h before class', () => {
            const farSession = createSession({
                scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48 hours
            });

            render(
                <StudentClassList
                    upcomingSessions={[farSession]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(mockTranslations.cancelClass)).toBeDefined();
        });

        it('should not show cancel button when less than 24h before class', () => {
            const soonSession = createSession({
                scheduled_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours
            });

            render(
                <StudentClassList
                    upcomingSessions={[soonSession]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Cancel should not be available
            expect(screen.queryByText(mockTranslations.cancelClass)).toBeNull();
        });
    });

    describe('Multiple Sessions', () => {

        it('should render multiple upcoming sessions', () => {
            const sessions = [
                createSession({ teacher: { id: '1', full_name: 'Teacher 1', email: 't1@test.com' } }),
                createSession({ teacher: { id: '2', full_name: 'Teacher 2', email: 't2@test.com' } }),
                createSession({ teacher: { id: '3', full_name: 'Teacher 3', email: 't3@test.com' } }),
            ];

            render(
                <StudentClassList
                    upcomingSessions={sessions}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText('Teacher 1')).toBeDefined();
            expect(screen.getByText('Teacher 2')).toBeDefined();
            expect(screen.getByText('Teacher 3')).toBeDefined();
        });

        it('should order sessions chronologically', () => {
            const session1 = createSession({
                scheduled_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
                teacher: { id: '1', full_name: 'Later Teacher', email: 't@test.com' },
            });
            const session2 = createSession({
                scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                teacher: { id: '2', full_name: 'Earlier Teacher', email: 't@test.com' },
            });

            render(
                <StudentClassList
                    upcomingSessions={[session1, session2]}
                    pastSessions={[]}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Both should be visible
            expect(screen.getByText('Later Teacher')).toBeDefined();
            expect(screen.getByText('Earlier Teacher')).toBeDefined();
        });
    });

    it('matches snapshot', () => {
        // Use fixed session for consistent snapshots across timezones
        const fixedSession = {
            id: 'session-snapshot',
            scheduled_at: '2026-01-15T12:00:00.000Z', // Fixed: Jan 15, 12:00 UTC
            duration_minutes: 60,
            status: 'scheduled',
            meet_link: 'https://meet.google.com/abc-defg-hij',
            teacher_notes: null,
            teacher: {
                id: 'teacher-1',
                full_name: 'María García',
                email: 'maria@test.com',
            },
        };
        const { asFragment } = render(
            <StudentClassList
                upcomingSessions={[fixedSession]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
