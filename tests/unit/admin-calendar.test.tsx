import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AdminCalendar from '../../src/components/calendar/AdminCalendar';
import type { Session } from '../../src/components/calendar/hooks/useAdminCalendar';

vi.mock('../../src/components/calendar/AdminScheduleModal', () => ({
    default: ({ isOpen, onSessionCreated }: { isOpen: boolean; onSessionCreated: (session: Session) => void }) =>
        isOpen ? (
            <div data-testid="admin-schedule-modal">
                <button
                    type="button"
                    onClick={() => onSessionCreated({
                        id: 'session-new',
                        scheduled_at: '2026-02-19T15:00:00.000Z',
                        duration_minutes: 50,
                        status: 'scheduled',
                        meet_link: null,
                        teacher_notes: null,
                        drive_doc_url: null,
                        student: { id: 'student-new', full_name: 'Nueva Alumna', email: 'nueva@example.com' },
                        teacher: { id: 'teacher-1', full_name: 'Profe Uno', email: 'profe1@example.com' },
                    })}
                >
                    Crear mock session
                </button>
            </div>
        ) : null,
}));

vi.mock('../../src/components/calendar/SessionDetailModal', () => ({
    default: ({
        isOpen,
        session,
        onSessionUpdate,
    }: {
        isOpen: boolean;
        session: Session;
        onSessionUpdate: (session: Session) => void;
    }) =>
        isOpen ? (
            <div data-testid="admin-session-detail-modal">
                <p>{session.id}</p>
                <button
                    type="button"
                    onClick={() => onSessionUpdate({
                        ...session,
                        student: { ...session.student, full_name: 'Ana Actualizada' },
                    })}
                >
                    Actualizar mock session
                </button>
            </div>
        ) : null,
}));

const translations = {
    today: 'Hoy',
    week: 'Semana',
    month: 'Mes',
    allTeachers: 'Todos los profesores',
    scheduleClass: 'Programar clase',
    dayNames: ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'],
};

const teachers = [
    { id: 'teacher-1', full_name: 'Profe Uno', email: 'profe1@example.com' },
    { id: 'teacher-2', full_name: 'Profe Dos', email: 'profe2@example.com' },
];

const students = [
    { id: 'student-1', full_name: 'Ana Lopez', email: 'ana@example.com' },
    { id: 'student-2', full_name: 'Beto Ruiz', email: 'beto@example.com' },
];

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        scheduled_at: '2026-02-18T15:00:00.000Z',
        duration_minutes: 50,
        status: 'scheduled',
        meet_link: null,
        teacher_notes: null,
        drive_doc_url: null,
        student: students[0],
        teacher: teachers[0],
        ...overrides,
    };
}

function renderCalendar(sessions: Session[] = [makeSession()]) {
    return render(
        <AdminCalendar
            sessions={sessions}
            teachers={teachers}
            students={students}
            lang="es"
            translations={translations}
        />,
    );
}

describe('AdminCalendar', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders accessible navigation, view toggles and teacher filtering', () => {
        const otherTeacherSession = makeSession({
            id: 'session-2',
            student: students[1],
            teacher: teachers[1],
        });
        renderCalendar([makeSession(), otherTeacherSession]);

        expect(screen.getByRole('button', { name: 'Semana anterior' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button', { name: 'Semana siguiente' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button', { name: translations.week })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: translations.month })).toHaveAttribute('aria-pressed', 'false');

        const teacherFilter = screen.getByLabelText('Filtrar por profesor');
        expect(teacherFilter).toHaveValue('all');
        fireEvent.change(teacherFilter, { target: { value: 'teacher-1' } });

        expect(screen.getByText('Ana Lopez')).toBeInTheDocument();
        expect(screen.queryByText('Beto Ruiz')).not.toBeInTheDocument();
    });

    it('uses a safe fallback color and accessible label for sessions with unknown teachers', () => {
        renderCalendar([
            makeSession({
                id: 'session-unknown-teacher',
                student: students[1],
                teacher: { id: 'teacher-missing', full_name: null, email: 'missing@example.com' },
            }),
        ]);

        const sessionButton = screen.getByRole('button', { name: /Beto Ruiz/ });
        expect(sessionButton).toHaveClass('border-l-gray-400');
        expect(sessionButton).toHaveAttribute('type', 'button');
    });

    it('opens modals and applies created or updated sessions through functional state handlers', () => {
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: /Ana Lopez/ }));
        expect(screen.getByTestId('admin-session-detail-modal')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar mock session' }));
        expect(screen.getByText('Ana Actualizada')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: `+ ${translations.scheduleClass}` }));
        expect(screen.getByTestId('admin-schedule-modal')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Crear mock session' }));
        expect(screen.getByText('Nueva Alumna')).toBeInTheDocument();
    });

    it('switches to month mode with pressed state, month navigation labels and overflow count', () => {
        const sessions = Array.from({ length: 4 }, (_, index) => makeSession({
            id: `session-${index + 1}`,
            student: { id: `student-${index + 1}`, full_name: `Alumno ${index + 1}`, email: `alumno${index + 1}@example.com` },
        }));
        renderCalendar(sessions);

        fireEvent.click(screen.getByRole('button', { name: translations.month }));

        expect(screen.getByRole('button', { name: translations.month })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Mes anterior' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mes siguiente' })).toBeInTheDocument();
        expect(screen.getByText('+1 más')).toBeInTheDocument();
    });
});
