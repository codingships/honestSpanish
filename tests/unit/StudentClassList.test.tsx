import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import StudentClassList from '../../src/components/calendar/StudentClassList';

// Mock the cancel modal to avoid rendering its dependencies
vi.mock('../../src/components/calendar/StudentCancelModal', () => ({
    default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
        isOpen ? (
            <div data-testid="cancel-modal">
                <button onClick={onClose}>Volver</button>
                <button>Confirmar cancelación</button>
            </div>
        ) : null,
}));

const mockTranslations = {
    upcoming: 'Próximas',
    past: 'Pasadas',
    noUpcoming: 'No tienes clases próximas programadas',
    noPast: 'No tienes clases pasadas',
    joinClass: 'Unirse a la clase',
    cancelClass: 'Cancelar clase',
    cancelUnavailable: 'Cancelación no disponible (menos de 24h)',
    linkAvailableSoon: 'Link disponible pronto',
    startingSoon: 'Empieza pronto',
    with: 'Con',
    duration: 'Duración',
    minutes: 'minutos',
    teacherNotes: 'Notas del profesor',
    unassigned: 'Sin asignar',
    viewDocument: 'Ver documento',
    status: {
        scheduled: 'Programada',
        completed: 'Completada',
        cancelled: 'Cancelada',
        noShow: 'No asistió',
    },
};

const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: `session-${Math.random().toString(36).slice(2)}`,
    scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    duration_minutes: 60,
    status: 'scheduled',
    meet_link: 'https://meet.google.com/abc-def',
    drive_doc_url: null as string | null,
    teacher_notes: null as string | null,
    teacher: {
        id: 'teacher-1',
        full_name: 'María García',
        email: 'maria@test.com',
    },
    ...overrides,
});

describe('StudentClassList — tabs', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows both Próximas and Pasadas tabs', () => {
        render(
            <StudentClassList
                upcomingSessions={[]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(/Próximas/)).toBeDefined();
        expect(screen.getByText(/Pasadas/)).toBeDefined();
    });

    it('defaults to upcoming tab showing noUpcoming message', () => {
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

    it('switches to past tab on click', () => {
        render(
            <StudentClassList
                upcomingSessions={[]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByText(/Pasadas/));
        expect(screen.getByText(mockTranslations.noPast)).toBeDefined();
    });
});

describe('StudentClassList — session card rendering', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('renders teacher name on session card', () => {
        render(
            <StudentClassList
                upcomingSessions={[makeSession()]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText('María García')).toBeDefined();
    });

    it('renders session status badge', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
            status: 'completed',
        });
        render(
            <StudentClassList
                upcomingSessions={[]}
                pastSessions={[session]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByText(/Pasadas/));
        expect(screen.getByText(mockTranslations.status.completed)).toBeDefined();
    });

    it('shows "unassigned" when teacher is null', () => {
        render(
            <StudentClassList
                upcomingSessions={[makeSession({ teacher: null })]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(mockTranslations.unassigned)).toBeDefined();
    });
});

describe('StudentClassList — canCancel logic', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows cancel button when session is 25h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(mockTranslations.cancelClass)).toBeDefined();
    });

    it('hides cancel button when session is only 23h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(mockTranslations.cancelClass)).toBeNull();
    });

    it('hides cancel button when status is cancelled', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            status: 'cancelled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(mockTranslations.cancelClass)).toBeNull();
    });

    it('clicking cancel button opens the cancel modal', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByText(mockTranslations.cancelClass));
        expect(screen.getByTestId('cancel-modal')).toBeDefined();
    });

    it('clicking Volver in modal closes it', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        fireEvent.click(screen.getByText(mockTranslations.cancelClass));
        expect(screen.getByTestId('cancel-modal')).toBeDefined();
        fireEvent.click(screen.getByText('Volver'));
        expect(screen.queryByTestId('cancel-modal')).toBeNull();
    });
});

describe('StudentClassList — canJoin logic', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows join button when session starts in 14 min and has meet link', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 14 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(mockTranslations.joinClass)).toBeDefined();
    });

    it('hides join button when session starts in 30 min (too early)', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(mockTranslations.joinClass)).toBeNull();
    });

    it('hides join button when session has no meet link', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: null,
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(mockTranslations.joinClass)).toBeNull();
    });

    it('hides join button when session ended 61 min ago', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
            status: 'scheduled',
            meet_link: 'https://meet.google.com/test',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(mockTranslations.joinClass)).toBeNull();
    });
});

describe('StudentClassList — isStartingSoon logic', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('shows "starting soon" badge when session is 23h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.getByText(new RegExp(mockTranslations.startingSoon))).toBeDefined();
    });

    it('does not show "starting soon" badge when session is 25h away', () => {
        const session = makeSession({
            scheduled_at: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
            status: 'scheduled',
        });
        render(
            <StudentClassList
                upcomingSessions={[session]}
                pastSessions={[]}
                lang="es"
                translations={mockTranslations}
            />
        );
        expect(screen.queryByText(new RegExp(mockTranslations.startingSoon))).toBeNull();
    });
});
