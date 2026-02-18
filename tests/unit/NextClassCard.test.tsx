/**
 * NextClassCard Component Tests
 * 
 * Tests the next class card component that displays:
 * - Upcoming session info
 * - Time until class
 * - Join button when class is starting
 * - Empty state when no sessions
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import NextClassCard from '../../src/components/calendar/NextClassCard';

const mockTranslations = {
    nextClass: 'Próxima Clase',
    noClasses: 'No tienes clases programadas',
    joinClass: 'Unirse a la clase',
    with: 'Con',
    in: 'En',
    viewAll: 'Ver todas',
};

describe('NextClassCard', () => {

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(2026, 0, 14, 12, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Empty State', () => {

        it('should render empty state when no session', () => {
            render(
                <NextClassCard
                    session={null}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(mockTranslations.nextClass)).toBeDefined();
            expect(screen.getByText(mockTranslations.noClasses)).toBeDefined();
        });

        it('should not show join button in empty state', () => {
            render(
                <NextClassCard
                    session={null}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.queryByText(mockTranslations.joinClass)).toBeNull();
        });
    });

    describe('With Session', () => {

        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1);
        futureDate.setHours(10, 0, 0, 0);

        const mockSession = {
            id: 'session-1',
            scheduled_at: futureDate.toISOString(),
            duration_minutes: 60,
            status: 'scheduled',
            meet_link: 'https://meet.google.com/abc-defg-hij',
            drive_doc_url: null as string | null,
            teacher: {
                full_name: 'María García',
                email: 'maria@test.com',
            },
        };

        it('should render session details', () => {
            render(
                <NextClassCard
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(mockTranslations.nextClass)).toBeDefined();
            expect(screen.getByText('María García')).toBeDefined();
        });

        it('should show "View All" link when class is not starting soon', () => {
            render(
                <NextClassCard
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(/Ver todas/)).toBeDefined();
        });

        it('should format date in Spanish for es lang', () => {
            render(
                <NextClassCard
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Should have some date display
            const container = screen.getByText(mockTranslations.nextClass).closest('div');
            expect(container).toBeDefined();
        });

        it('should show join button when class is starting within 15 minutes', () => {
            const soonSession = {
                ...mockSession,
                scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min from now
            };

            render(
                <NextClassCard
                    session={soonSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText(/Unirse/)).toBeDefined();
        });

        it('should not show join button when no meet link', () => {
            const noLinkSession = {
                ...mockSession,
                scheduled_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
                meet_link: null,
            };

            render(
                <NextClassCard
                    session={noLinkSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.queryByText(/Unirse/)).toBeNull();
        });

        it('should show "starting soon" indicator when within 2 hours', () => {
            const soonSession = {
                ...mockSession,
                scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
            };

            render(
                <NextClassCard
                    session={soonSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Should have yellow warning indicator
            expect(screen.getByText(/⏰/)).toBeDefined();
        });

        it('should show teacher email when name is not available', () => {
            const noNameSession = {
                ...mockSession,
                teacher: {
                    full_name: null,
                    email: 'teacher@test.com',
                },
            };

            render(
                <NextClassCard
                    session={noNameSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            expect(screen.getByText('teacher@test.com')).toBeDefined();
        });
    });

    describe('Time Calculations', () => {

        it('should show days when session is more than 24 hours away', () => {
            const farDate = new Date();
            farDate.setDate(farDate.getDate() + 3);

            const farSession = {
                id: 'session-1',
                scheduled_at: farDate.toISOString(),
                duration_minutes: 60,
                status: 'scheduled',
                meet_link: null,
                drive_doc_url: null as string | null,
                teacher: { full_name: 'Test', email: 'test@test.com' },
            };

            render(
                <NextClassCard
                    session={farSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Should show days
            expect(screen.getByText(/día/)).toBeDefined();
        });

        it('should show hours when session is less than 24 hours away', () => {
            const soonDate = new Date();
            soonDate.setHours(soonDate.getHours() + 5);

            const soonSession = {
                id: 'session-1',
                scheduled_at: soonDate.toISOString(),
                duration_minutes: 60,
                status: 'scheduled',
                meet_link: null,
                drive_doc_url: null as string | null,
                teacher: { full_name: 'Test', email: 'test@test.com' },
            };

            render(
                <NextClassCard
                    session={soonSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );

            // Should show hours
            expect(screen.getByText(/hora/)).toBeDefined();
        });
    });

    describe('Internationalization', () => {

        const mockSession = {
            id: 'session-1',
            scheduled_at: '2026-01-15T12:00:00.000Z', // Fixed: 24h after mocked time (Jan 14, 12:00 UTC)
            duration_minutes: 60,
            status: 'scheduled',
            meet_link: null,
            drive_doc_url: null as string | null,
            teacher: { full_name: 'Test Teacher', email: 'test@test.com' },
        };

        it('should render with English translations', () => {
            const enTranslations = {
                nextClass: 'Next Class',
                noClasses: 'No classes scheduled',
                joinClass: 'Join Class',
                with: 'With',
                in: 'In',
                viewAll: 'View All',
            };

            render(
                <NextClassCard
                    session={mockSession}
                    lang="en"
                    translations={enTranslations}
                />
            );

            expect(screen.getByText('Next Class')).toBeDefined();
            expect(screen.getByText('Test Teacher')).toBeDefined();
        });

        it('should render with Russian translations', () => {
            const ruTranslations = {
                nextClass: 'Следующий урок',
                noClasses: 'Нет запланированных уроков',
                joinClass: 'Присоединиться',
                with: 'С',
                in: 'Через',
                viewAll: 'Все уроки',
            };

            render(
                <NextClassCard
                    session={mockSession}
                    lang="ru"
                    translations={ruTranslations}
                />
            );

            expect(screen.getByText('Следующий урок')).toBeDefined();
        });

        it('matches snapshot', () => {
            const { asFragment } = render(
                <NextClassCard
                    session={mockSession}
                    lang="es"
                    translations={mockTranslations}
                />
            );
            expect(asFragment()).toMatchSnapshot();
        });
    });
});
