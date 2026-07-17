import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ScheduleSessionModal from '../../src/components/calendar/ScheduleSessionModal';

const students = [
    { id: 'student-1', full_name: 'Ana Lopez', email: 'ana@example.com' },
    { id: 'student-2', full_name: null, email: 'beto@example.com' },
];

const translations = {
    scheduleClass: 'Programar clase',
    selectStudent: 'Selecciona el alumno',
    selectDate: 'Fecha',
    selectTime: 'Hora',
    duration: 'Duracion',
    minutes: 'min',
    continue: 'Continuar',
    back: 'Volver',
    loading: 'Cargando',
    noSlotsDate: 'Sin huecos',
    setupAvailability: 'Configura disponibilidad',
    summary: 'Resumen',
    studentLabel: 'Alumno:',
    dateLabel: 'Fecha:',
    timeLabel: 'Hora:',
    meetLinkOptional: 'Link de Meet opcional',
    confirm: 'Confirmar clase',
    close: 'Cerrar programacion',
    errorLoadingSlots: 'No se pudieron cargar huecos',
    errorScheduling: 'No se pudo programar',
};

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    students,
    teacherId: 'teacher-1',
    lang: 'es',
    translations,
    onSessionCreated: vi.fn(),
};

const slotFor = (date: string, time: string) => ({
    slot_start: `${date}T${time}:00`,
    slot_end: `${date}T${time}:00`,
});

const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const mockReload = () => {
    const reload = vi.fn();
    vi.stubGlobal('location', {
        ...window.location,
        reload,
    });
    return reload;
};

const installFetchWithSlots = () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), 'http://localhost:4321');
        if (url.pathname === '/api/calendar/available-slots') {
            const date = url.searchParams.get('date') || '2026-10-10';
            const time = date.endsWith('11') ? '11:00' : '10:00';
            return Promise.resolve(Response.json({ slots: [slotFor(date, time)] }));
        }

        if (url.pathname === '/api/calendar/sessions') {
            return Promise.resolve(Response.json({ session: { id: 'session-new' } }, { status: 201 }));
        }

        return Promise.reject(new Error(`Unexpected URL: ${url.toString()}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

const selectStudentAndGoToDateStep = () => {
    fireEvent.change(screen.getByLabelText(/selecciona el alumno/i), { target: { value: 'student-1' } });
    fireEvent.click(screen.getByRole('button', { name: translations.continue }));
};

const chooseDateAndGoToTimeStep = async (date = '2026-10-10') => {
    fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: date } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/calendar/available-slots?teacherId=teacher-1&date=${date}&duration=50`),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    fireEvent.click(screen.getByRole('button', { name: translations.continue }));
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('ScheduleSessionModal', () => {
    it('renders an accessible first step and blocks progress until a student is selected', () => {
        render(<ScheduleSessionModal {...defaultProps} />);

        expect(screen.getByRole('dialog', { name: translations.scheduleClass })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toHaveAttribute('type', 'button');
        expect(screen.getByLabelText(/selecciona el alumno/i)).toHaveValue('');
        expect(screen.getByRole('button', { name: translations.continue })).toBeDisabled();
    });

    it('clears a previously selected slot when date changes before confirmation', async () => {
        installFetchWithSlots();
        render(<ScheduleSessionModal {...defaultProps} />);

        selectStudentAndGoToDateStep();
        await chooseDateAndGoToTimeStep('2026-10-10');
        fireEvent.click(await screen.findByRole('button', { name: /hora.*10:00/i }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        fireEvent.click(screen.getByRole('button', { name: translations.back }));
        fireEvent.click(screen.getByRole('button', { name: translations.back }));
        fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: '2026-10-11' } });
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await screen.findByRole('button', { name: /hora.*11:00/i });
        expect(screen.queryByRole('button', { name: translations.continue })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /hora.*11:00/i }));
        expect(screen.getByRole('button', { name: translations.continue })).toBeEnabled();
    });

    it('ignores stale slot responses after the date changes', async () => {
        const firstSlots = deferred<Response>();
        const secondSlots = deferred<Response>();
        const fetchMock = vi.fn((input: RequestInfo | URL) => {
            const url = new URL(String(input), 'http://localhost:4321');
            if (url.searchParams.get('date') === '2026-10-10') return firstSlots.promise;
            if (url.searchParams.get('date') === '2026-10-11') return secondSlots.promise;
            return Promise.reject(new Error(`Unexpected URL: ${url.toString()}`));
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<ScheduleSessionModal {...defaultProps} />);
        selectStudentAndGoToDateStep();
        fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: '2026-10-10' } });
        fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: '2026-10-11' } });

        await act(async () => {
            secondSlots.resolve(Response.json({ slots: [slotFor('2026-10-11', '11:00')] }));
        });
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));
        expect(await screen.findByRole('button', { name: /hora.*11:00/i })).toBeInTheDocument();

        await act(async () => {
            firstSlots.resolve(Response.json({ slots: [slotFor('2026-10-10', '10:00')] }));
        });

        expect(screen.queryByRole('button', { name: /hora.*10:00/i })).not.toBeInTheDocument();
    });

    it('submits a trimmed Meet link and locks close controls while pending', async () => {
        const reload = mockReload();
        const submitResponse = deferred<Response>();
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input), 'http://localhost:4321');
            if (url.pathname === '/api/calendar/available-slots') {
                return Promise.resolve(Response.json({ slots: [slotFor('2026-10-10', '10:00')] }));
            }
            if (url.pathname === '/api/calendar/sessions') {
                return submitResponse.promise;
            }
            return Promise.reject(new Error(`Unexpected URL: ${url.toString()}`));
        });
        vi.stubGlobal('fetch', fetchMock);
        const onClose = vi.fn();
        const onSessionCreated = vi.fn();

        render(
            <ScheduleSessionModal
                {...defaultProps}
                onClose={onClose}
                onSessionCreated={onSessionCreated}
            />,
        );

        selectStudentAndGoToDateStep();
        await chooseDateAndGoToTimeStep('2026-10-10');
        fireEvent.click(await screen.findByRole('button', { name: /hora.*10:00/i }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));
        fireEvent.change(screen.getByLabelText(/meet/i), { target: { value: '  https://meet.google.com/abc-defg-hij  ' } });
        fireEvent.click(screen.getByRole('button', { name: translations.confirm }));

        const sessionRequest = fetchMock.mock.calls.find(([input]) => String(input) === '/api/calendar/sessions')?.[1] as RequestInit;
        expect(JSON.parse(String(sessionRequest.body))).toEqual(expect.objectContaining({
            studentId: 'student-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-10-10T10:00:00',
            durationMinutes: 50,
            meetLink: 'https://meet.google.com/abc-defg-hij',
        }));
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toBeDisabled();
        expect(screen.getByRole('button', { name: '...' })).toBeDisabled();

        await act(async () => {
            submitResponse.resolve(Response.json({ session: { id: 'session-new' } }, { status: 201 }));
        });

        await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith({ id: 'session-new' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(reload).toHaveBeenCalledTimes(1);
    });
});
