import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminScheduleModal from '../../src/components/calendar/AdminScheduleModal';

const teachers = [
    { id: 'teacher-1', full_name: 'Profe Uno', email: 'teacher@example.com', role: 'teacher' },
];

const students = [
    { id: 'student-1', full_name: 'Ana Lopez', email: 'ana@example.com', role: 'student' },
];

const translations = {
    scheduleClass: 'Programar clase',
    selectStudent: 'Seleccionar estudiante',
    selectTeacher: 'Seleccionar profesor',
    selectDate: 'Seleccionar fecha',
    selectTime: 'Seleccionar hora',
    duration: 'Duracion',
    minutes: 'minutos',
    confirm: 'Confirmar',
    cancel: 'Cerrar',
};

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    teachers,
    students,
    lang: 'es',
    translations,
    onSessionCreated: vi.fn(),
};

const chooseStudentAndTeacher = () => {
    fireEvent.change(screen.getByLabelText(translations.selectStudent), { target: { value: 'student-1' } });
    fireEvent.change(screen.getByLabelText(translations.selectTeacher), { target: { value: 'teacher-1' } });
};

afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('AdminScheduleModal', () => {
    it('renders as an accessible dialog with labelled first-step controls', () => {
        render(<AdminScheduleModal {...defaultProps} />);

        expect(screen.getByRole('dialog', { name: translations.scheduleClass })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: translations.cancel })).toBeInTheDocument();
        expect(screen.getByLabelText(translations.selectStudent)).toBeInTheDocument();
        expect(screen.getByLabelText(translations.selectTeacher)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /continuar/i })).toBeDisabled();

        chooseStudentAndTeacher();
        expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled();
    });

    it('aborts the available-slots request when the modal unmounts', async () => {
        const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) => new Promise<Response>(() => {}));
        vi.stubGlobal('fetch', fetchMock);

        const { unmount } = render(<AdminScheduleModal {...defaultProps} />);
        chooseStudentAndTeacher();
        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
        fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: '2026-02-20' } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const requestOptions = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const signal = requestOptions?.signal as AbortSignal;
        expect(signal.aborted).toBe(false);

        unmount();
        expect(signal.aborted).toBe(true);
    });

    it('submits a selected slot with a trimmed manual Meet link', async () => {
        const onClose = vi.fn();
        const onSessionCreated = vi.fn();
        const fetchMock = vi
            .fn((..._args: Parameters<typeof fetch>) => Promise.resolve(Response.json({})))
            .mockResolvedValueOnce(Response.json({
                slots: [
                    {
                        slot_start: '2026-02-20T10:00:00.000Z',
                        slot_end: '2026-02-20T10:50:00.000Z',
                    },
                ],
            }))
            .mockResolvedValueOnce(Response.json({
                session: {
                    id: 'session-1',
                    scheduled_at: '2026-02-20T10:00:00.000Z',
                },
            }));
        vi.stubGlobal('fetch', fetchMock);

        render(
            <AdminScheduleModal
                {...defaultProps}
                onClose={onClose}
                onSessionCreated={onSessionCreated}
            />
        );

        chooseStudentAndTeacher();
        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
        fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: '2026-02-20' } });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/calendar/available-slots?teacherId=teacher-1&date=2026-02-20&duration=50');

        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Seleccionar hora: 11:00/i }));
        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));

        fireEvent.click(screen.getByRole('checkbox', { name: /Generar Google Meet/i }));
        fireEvent.change(screen.getByLabelText(/Link manual/i), {
            target: { value: '  https://meet.google.com/abc-defg-hij  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: translations.confirm }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const createRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
        expect(createRequest.method).toBe('POST');
        expect(JSON.parse(String(createRequest.body))).toEqual({
            studentId: 'student-1',
            teacherId: 'teacher-1',
            scheduledAt: '2026-02-20T10:00:00.000Z',
            durationMinutes: 50,
            meetLink: 'https://meet.google.com/abc-defg-hij',
            autoCreateMeeting: false,
        });
        expect(onSessionCreated).toHaveBeenCalledWith({
            id: 'session-1',
            scheduled_at: '2026-02-20T10:00:00.000Z',
        });
        expect(onClose).toHaveBeenCalled();
    });

    it('converts a custom Madrid wall time to an explicit instant for a single class', async () => {
        const onClose = vi.fn();
        const fetchMock = vi
            .fn((..._args: Parameters<typeof fetch>) => Promise.resolve(Response.json({})))
            .mockResolvedValueOnce(Response.json({ slots: [] }))
            .mockResolvedValueOnce(Response.json({
                session: { id: 'session-custom', scheduled_at: '2026-07-15T08:00:00.000Z' },
            }));
        vi.stubGlobal('fetch', fetchMock);

        render(<AdminScheduleModal {...defaultProps} onClose={onClose} />);
        chooseStudentAndTeacher();
        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
        fireEvent.change(screen.getByLabelText(translations.selectDate), { target: { value: '2026-07-15' } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: /Forzar hora manual/i }));
        fireEvent.change(screen.getByLabelText(/Hora personalizada/i), { target: { value: '10:00' } });
        fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
        fireEvent.click(screen.getByRole('button', { name: translations.confirm }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const createRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
        expect(JSON.parse(String(createRequest.body))).toEqual(expect.objectContaining({
            scheduledAt: '2026-07-15T08:00:00.000Z',
        }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
