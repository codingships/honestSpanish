import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TeacherCalendar from '../../src/components/calendar/TeacherCalendar';

type TestSession = React.ComponentProps<typeof TeacherCalendar>['sessions'][number];

vi.mock('../../src/components/calendar/ScheduleSessionModal', () => ({
    default: ({
        isOpen,
        onSessionCreated,
    }: {
        isOpen: boolean;
        onSessionCreated: (session: TestSession) => void;
    }) =>
        isOpen ? (
            <div data-testid="schedule-modal" role="dialog" aria-label="Programar clase">
                <button
                    type="button"
                    onClick={() => onSessionCreated({
                        id: 'session-created',
                        scheduled_at: '2026-02-19T15:00:00.000Z',
                        duration_minutes: 50,
                        status: 'scheduled',
                        meet_link: null,
                        teacher_notes: null,
                        drive_doc_url: null,
                        student: { id: 'student-created', full_name: 'Nueva Alumna', email: 'nueva@example.com' },
                    })}
                >
                    Crear mock session
                </button>
            </div>
        ) : null,
}));

vi.mock('../../src/components/calendar/BulkScheduleModal', () => ({
    default: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="bulk-schedule-modal" role="dialog" aria-label="Agendar curso">Bulk modal</div> : null,
}));

vi.mock('../../src/components/calendar/SessionDetailModal', () => ({
    default: ({
        isOpen,
        session,
        onSessionUpdate,
    }: {
        isOpen: boolean;
        session: TestSession;
        onSessionUpdate: (session: TestSession) => void;
    }) =>
        isOpen ? (
            <div data-testid="session-detail-modal" role="dialog" aria-label="Detalle de clase">
                <p>{session.student.full_name || session.student.email}</p>
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

const mockTranslations = {
    today: 'Hoy',
    scheduleClass: 'Programar clase',
    scheduleCourse: 'Agendar curso',
    previousWeek: 'Semana anterior',
    nextWeek: 'Semana siguiente',
    calendarGridLabel: 'Horario semanal',
    dayNames: ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'],
    scheduled: 'Programada',
    completed: 'Completada',
    noShow: 'No asistio',
    cancelled: 'Cancelada',
};

const students = [
    { id: 'student-1', full_name: 'Ana Lopez', email: 'ana@example.com' },
];

let sessionCounter = 0;

function makeSession(overrides: Partial<TestSession> = {}): TestSession {
    return {
        id: overrides.id || `session-${++sessionCounter}`,
        scheduled_at: '2026-02-18T15:00:00.000Z',
        duration_minutes: 50,
        status: 'scheduled',
        meet_link: null,
        teacher_notes: null,
        drive_doc_url: null,
        student: {
            id: 'student-1',
            full_name: 'Ana Lopez',
            email: 'ana@example.com',
        },
        ...overrides,
    };
}

function renderCalendar(sessions: TestSession[] = []) {
    return render(
        <TeacherCalendar
            sessions={sessions}
            students={students}
            teacherId="teacher-1"
            lang="es"
            translations={mockTranslations}
        />,
    );
}

beforeEach(() => {
    sessionCounter = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('TeacherCalendar - controls and navigation', () => {
    it('renders accessible navigation, schedule controls and the weekly grid', () => {
        renderCalendar();

        expect(screen.getByRole('button', { name: 'Semana anterior' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button', { name: 'Semana siguiente' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button', { name: 'Agendar curso' })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('button', { name: /\+ Programar clase/ })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('grid', { name: 'Horario semanal' })).toBeInTheDocument();
        expect(screen.getAllByRole('row')).toHaveLength(2);
        expect(screen.getAllByRole('columnheader')).toHaveLength(7);
        expect(screen.getAllByRole('gridcell')).toHaveLength(7);
    });

    it('moves between weeks and returns to the current week', () => {
        renderCalendar();

        const range = document.querySelector('[aria-live="polite"]');
        expect(range).not.toBeNull();
        const initialRange = range?.textContent;

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        expect(range?.textContent).not.toBe(initialRange);

        fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
        expect(range?.textContent).toBe(initialRange);

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        fireEvent.click(screen.getByRole('button', { name: 'Hoy' }));
        expect(range?.textContent).toBe(initialRange);
    });

    it('opens the single-session and bulk scheduling modals', () => {
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: /\+ Programar clase/ }));
        expect(screen.getByTestId('schedule-modal')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Agendar curso' }));
        expect(screen.getByTestId('bulk-schedule-modal')).toBeInTheDocument();
    });
});

describe('TeacherCalendar - session state', () => {
    it('renders current-week sessions and opens their detail modal', () => {
        renderCalendar([makeSession()]);

        const sessionButton = screen.getByRole('button', { name: /Ana Lopez.*Programada/ });
        expect(screen.getByText('Ana Lopez')).toBeInTheDocument();

        fireEvent.click(sessionButton);
        expect(screen.getByTestId('session-detail-modal')).toHaveTextContent('Ana Lopez');
    });

    it('updates the visible card and selected detail session after an edit', () => {
        renderCalendar([makeSession()]);

        fireEvent.click(screen.getByRole('button', { name: /Ana Lopez.*Programada/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar mock session' }));

        expect(screen.getByRole('button', { name: /Ana Actualizada.*Programada/ })).toBeInTheDocument();
        expect(screen.getByTestId('session-detail-modal')).toHaveTextContent('Ana Actualizada');
    });

    it('adds a newly created session without replacing the current list', () => {
        renderCalendar([makeSession()]);

        fireEvent.click(screen.getByRole('button', { name: /\+ Programar clase/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear mock session' }));

        expect(screen.getByText('Ana Lopez')).toBeInTheDocument();
        expect(screen.getByText('Nueva Alumna')).toBeInTheDocument();
    });

    it('resynchronizes when the sessions prop changes', async () => {
        const oldSession = makeSession({
            id: 'session-old',
            student: { id: 'student-old', full_name: 'Alumno Viejo', email: 'viejo@example.com' },
        });
        const newSession = makeSession({
            id: 'session-new',
            student: { id: 'student-new', full_name: 'Alumno Nuevo', email: 'nuevo@example.com' },
        });

        const { rerender } = render(
            <TeacherCalendar
                sessions={[oldSession]}
                students={students}
                teacherId="teacher-1"
                lang="es"
                translations={mockTranslations}
            />,
        );
        expect(screen.getByText('Alumno Viejo')).toBeInTheDocument();

        rerender(
            <TeacherCalendar
                sessions={[newSession]}
                students={students}
                teacherId="teacher-1"
                lang="es"
                translations={mockTranslations}
            />,
        );

        await waitFor(() => {
            expect(screen.queryByText('Alumno Viejo')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Alumno Nuevo')).toBeInTheDocument();
    });

    it('groups sessions by local date instead of UTC date', () => {
        const nearLocalMidnight = makeSession({
            scheduled_at: '2026-02-17T00:30:00+01:00',
            student: { id: 'student-midnight', full_name: 'Medianoche Local', email: 'medianoche@example.com' },
        });
        renderCalendar([nearLocalMidnight]);

        const tuesdayCell = screen.getByRole('gridcell', { name: /Martes.*1 Programada/ });
        expect(within(tuesdayCell).getByText('Medianoche Local')).toBeInTheDocument();

        const mondayCell = screen.getByRole('gridcell', { name: /Lunes.*0 Programada/ });
        expect(within(mondayCell).queryByText('Medianoche Local')).toBeNull();
    });
});

describe('TeacherCalendar page contract', () => {
    it('keeps the Astro tabs semantic and synchronized with hidden panels', () => {
        const source = readFileSync(
            path.join(process.cwd(), 'src/pages/[lang]/campus/teacher/calendar.astro'),
            'utf8',
        );

        expect(source).toContain('role="tablist"');
        expect(source).toContain('role="tab"');
        expect(source).toContain('aria-selected="true"');
        expect(source).toContain('role="tabpanel"');
        expect(source).toContain("setAttribute('aria-selected'");
        expect(source).toContain("setAttribute('hidden'");
        expect(source).not.toMatch(/Ã|Â|â|ðŸ|�/);
    });
});
