import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    default: ({
        isOpen,
        onSessionsCreated,
    }: {
        isOpen: boolean;
        onSessionsCreated: () => void;
    }) =>
        isOpen ? (
            <div data-testid="bulk-schedule-modal" role="dialog" aria-label="Agendar curso">
                Bulk modal
                <button type="button" onClick={onSessionsCreated}>Completar curso mock</button>
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
    loading: 'Cargando...',
    noSessions: 'No hay clases esta semana',
    loadError: 'No se pudo cargar esta semana',
    retry: 'Reintentar',
};

const students = [
    { id: 'student-1', full_name: 'Ana Lopez', email: 'ana@example.com' },
];

let sessionCounter = 0;
const fetchMock = vi.fn();

function successfulWeekResponse(weekStartKey: string, sessions: TestSession[] = []) {
    return {
        ok: true,
        json: vi.fn().mockResolvedValue({ weekStartKey, sessions }),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

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
            initialWeekStartKey="2026-02-16"
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
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
        const url = new URL(String(input), 'http://localhost');
        const weekStartKey = url.searchParams.get('weekStart') || '';
        return Promise.resolve(successfulWeekResponse(weekStartKey));
    });
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

    it('loads the selected week from the bounded weekly endpoint', async () => {
        const nextWeekSession = makeSession({
            id: 'session-next-week',
            scheduled_at: '2026-02-25T15:00:00.000Z',
            student: { id: 'student-next', full_name: 'Semana Siguiente', email: 'next@example.com' },
        });
        fetchMock.mockResolvedValueOnce(successfulWeekResponse('2026-02-23', [nextWeekSession]));
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));

        expect(await screen.findByText('Semana Siguiente')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/calendar/sessions?weekStart=2026-02-23',
            expect.objectContaining({ credentials: 'same-origin' }),
        );
    });

    it('reuses weeks already loaded instead of repeating the request', async () => {
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await screen.findByText('No hay clases esta semana');

        fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));

        await screen.findByText('No hay clases esta semana');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not let an older response overwrite a newer visible week', async () => {
        const firstRequest = deferred<ReturnType<typeof successfulWeekResponse>>();
        const secondRequest = deferred<ReturnType<typeof successfulWeekResponse>>();
        fetchMock
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementationOnce(() => secondRequest.promise);
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const newestSession = makeSession({
            id: 'session-newest-week',
            scheduled_at: '2026-03-04T15:00:00.000Z',
            student: { id: 'student-newest', full_name: 'Semana Más Nueva', email: 'newest@example.com' },
        });
        await act(async () => {
            secondRequest.resolve(successfulWeekResponse('2026-03-02', [newestSession]));
            await secondRequest.promise;
        });
        expect(await screen.findByText('Semana Más Nueva')).toBeInTheDocument();

        const staleSession = makeSession({
            id: 'session-stale-week',
            scheduled_at: '2026-02-25T15:00:00.000Z',
            student: { id: 'student-stale', full_name: 'Respuesta Antigua', email: 'stale@example.com' },
        });
        await act(async () => {
            firstRequest.resolve(successfulWeekResponse('2026-02-23', [staleSession]));
            await firstRequest.promise;
            await Promise.resolve();
        });

        expect(screen.getByText('Semana Más Nueva')).toBeInTheDocument();
        expect(screen.queryByText('Respuesta Antigua')).toBeNull();
    });

    it('distinguishes loading and failure from a successful empty week, then retries', async () => {
        const pendingRequest = deferred<{ ok: boolean; json: ReturnType<typeof vi.fn> }>();
        fetchMock.mockImplementationOnce(() => pendingRequest.promise);
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));

        expect(await screen.findByText('Cargando...')).toBeInTheDocument();
        expect(screen.queryByRole('grid')).toBeNull();
        expect(screen.queryByText('No hay clases esta semana')).toBeNull();

        await act(async () => {
            pendingRequest.resolve({
                ok: false,
                json: vi.fn().mockResolvedValue({ error: 'sanitized' }),
            });
            await pendingRequest.promise;
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar esta semana');
        expect(screen.queryByText('No hay clases esta semana')).toBeNull();

        fetchMock.mockResolvedValueOnce(successfulWeekResponse('2026-02-23'));
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

        expect(await screen.findByRole('grid', { name: 'Horario semanal' })).toBeInTheDocument();
        expect(screen.getByText('No hay clases esta semana')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes the visible week after bulk scheduling without resetting navigation', async () => {
        renderCalendar();
        fireEvent.click(screen.getByRole('button', { name: 'Agendar curso' }));
        fireEvent.click(screen.getByRole('button', { name: 'Completar curso mock' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/calendar/sessions?weekStart=2026-02-16');
    });

    it('ignores an in-flight weekly response invalidated by a later mutation', async () => {
        const firstRefresh = deferred<ReturnType<typeof successfulWeekResponse>>();
        const secondRefresh = deferred<ReturnType<typeof successfulWeekResponse>>();
        fetchMock
            .mockImplementationOnce(() => firstRefresh.promise)
            .mockImplementationOnce(() => secondRefresh.promise);
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: 'Agendar curso' }));
        fireEvent.click(screen.getByRole('button', { name: 'Completar curso mock' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: /\+ Programar clase/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear mock session' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const staleSession = makeSession({
            id: 'stale-after-mutation',
            student: { id: 'stale', full_name: 'Respuesta Obsoleta', email: 'stale@example.com' },
        });
        await act(async () => {
            firstRefresh.resolve(successfulWeekResponse('2026-02-16', [staleSession]));
            await firstRefresh.promise;
        });
        expect(screen.queryByText('Respuesta Obsoleta')).toBeNull();
        expect(screen.getByText('Cargando...')).toBeInTheDocument();

        const currentSession = makeSession({
            id: 'current-after-mutation',
            student: { id: 'current', full_name: 'Estado Actual', email: 'current@example.com' },
        });
        await act(async () => {
            secondRefresh.resolve(successfulWeekResponse('2026-02-16', [currentSession]));
            await secondRefresh.promise;
        });

        expect(await screen.findByText('Estado Actual')).toBeInTheDocument();
        expect(screen.queryByText('Respuesta Obsoleta')).toBeNull();
    });

    it('invalidates cached weeks after a bulk mutation', async () => {
        fetchMock
            .mockResolvedValueOnce(successfulWeekResponse('2026-02-23'))
            .mockResolvedValueOnce(successfulWeekResponse('2026-02-16'))
            .mockResolvedValueOnce(successfulWeekResponse('2026-02-23'));
        renderCalendar();

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));

        fireEvent.click(screen.getByRole('button', { name: 'Agendar curso' }));
        fireEvent.click(screen.getByRole('button', { name: 'Completar curso mock' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/calendar/sessions?weekStart=2026-02-23');
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

    it('refreshes the visible week without resetting the detail modal after an edit', async () => {
        const initialSession = makeSession();
        const updatedSession = {
            ...initialSession,
            student: { ...initialSession.student, full_name: 'Ana Actualizada' },
        };
        fetchMock.mockResolvedValueOnce(successfulWeekResponse('2026-02-16', [updatedSession]));
        renderCalendar([initialSession]);

        fireEvent.click(screen.getByRole('button', { name: /Ana Lopez.*Programada/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar mock session' }));

        expect(await screen.findByRole('button', { name: /Ana Actualizada.*Programada/ })).toBeInTheDocument();
        expect(screen.getByTestId('session-detail-modal')).toHaveTextContent('Ana Lopez');
    });

    it('reloads the canonical week after creating a session without replacing existing sessions', async () => {
        const initialSession = makeSession();
        const createdSession = makeSession({
            id: 'session-created',
            scheduled_at: '2026-02-19T15:00:00.000Z',
            student: { id: 'student-created', full_name: 'Nueva Alumna', email: 'nueva@example.com' },
        });
        fetchMock.mockResolvedValueOnce(successfulWeekResponse(
            '2026-02-16',
            [initialSession, createdSession],
        ));
        renderCalendar([initialSession]);

        fireEvent.click(screen.getByRole('button', { name: /\+ Programar clase/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Crear mock session' }));

        expect(await screen.findByText('Ana Lopez')).toBeInTheDocument();
        expect(await screen.findByText('Nueva Alumna')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/calendar/sessions?weekStart=2026-02-16',
            expect.any(Object),
        );
    });

    it('does not restore the stale SSR snapshot after a mutation and round-trip navigation', async () => {
        const initialSession = makeSession();
        const updatedSession = {
            ...initialSession,
            student: { ...initialSession.student, full_name: 'Ana Actualizada' },
        };
        fetchMock
            .mockResolvedValueOnce(successfulWeekResponse('2026-02-16', [updatedSession]))
            .mockResolvedValueOnce(successfulWeekResponse('2026-02-23'));
        renderCalendar([initialSession]);

        fireEvent.click(screen.getByRole('button', { name: /Ana Lopez.*Programada/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Actualizar mock session' }));
        expect(await screen.findByText('Ana Actualizada')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
        await screen.findByText('No hay clases esta semana');
        fireEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));

        expect(await screen.findByText('Ana Actualizada')).toBeInTheDocument();
        expect(screen.queryByText('Ana Lopez')).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
                initialWeekStartKey="2026-02-16"
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
                initialWeekStartKey="2026-02-16"
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
        const componentSource = readFileSync(
            path.join(process.cwd(), 'src/components/calendar/TeacherCalendar.tsx'),
            'utf8',
        );
        const scheduleModalSource = readFileSync(
            path.join(process.cwd(), 'src/components/calendar/ScheduleSessionModal.tsx'),
            'utf8',
        );
        const detailModalSource = readFileSync(
            path.join(process.cwd(), 'src/components/calendar/SessionDetailModal.tsx'),
            'utf8',
        );

        expect(source).toContain('role="tablist"');
        expect(source).toContain('role="tab"');
        expect(source).toContain('aria-selected="true"');
        expect(source).toContain('role="tabpanel"');
        expect(source).toContain("setAttribute('aria-selected'");
        expect(source).toContain("setAttribute('hidden'");
        expect(source).toContain('madridWeekStartDateKey');
        expect(source).toContain('madridWeekUtcRange');
        expect(source).toContain(".gte('scheduled_at', initialWeekRange.fromUtc)");
        expect(source).toContain(".lt('scheduled_at', initialWeekRange.toUtcExclusive)");
        expect(source).toContain('initialWeekStartKey={initialWeekStartKey}');
        expect(source).toContain('calendarLoadFailed');
        expect(source).toContain('<CampusLoadError');
        expect(source).toContain('error: authError');
        expect(source).toContain('resolveCampusCollectionQuery');
        expect(source).toContain('<BaseLayout');
        expect(source).toContain('accessUnavailable');
        expect(source).not.toContain('.setHours(');
        expect(source).not.toContain('.getDay()');
        expect(source).not.toContain(".neq('status', 'cancelled')");
        expect(componentSource).toContain('dayOfWeekForDateKey(dayKey)');
        expect(componentSource).not.toContain('.getDay()');
        expect(componentSource).not.toContain('window.location.reload()');
        expect(scheduleModalSource).not.toContain('window.location.reload()');
        expect(detailModalSource).not.toContain('window.location.reload()');
        expect(source).not.toMatch(/Ã|Â|â|ðŸ|�/);
    });
});
