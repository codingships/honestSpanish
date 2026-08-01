import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionDetailModal from '../../src/components/calendar/SessionDetailModal';

vi.mock('../../src/components/calendar/PostClassReport', () => ({
    default: ({
        isOpen,
        onSubmit,
    }: {
        isOpen: boolean;
        onSubmit: (reportData: { teacher_comments: string }, homeworkText: string) => Promise<void>;
    }) =>
        isOpen ? (
            <div data-testid="post-class-report-mock">
                <button type="button" onClick={() => onSubmit({ teacher_comments: 'Reporte completo' }, '  deberes escritos  ')}>
                    Enviar reporte mock
                </button>
            </div>
        ) : null,
}));

const translations = {
    close: 'Cerrar detalle de clase',
    status: 'Estado',
    dateTime: 'Fecha y hora',
    duration: 'Duracion',
    meetLink: 'Link de Meet',
    saveNotes: 'Guardar notas',
    updated: 'Actualizado correctamente',
    sessionNotesPlaceholder: 'Notas internas',
    addNotes: 'Notas del profesor',
    completed: 'Completada',
    scheduled: 'Programada',
    cancelled: 'Cancelada',
    noShow: 'No asistio',
    markComplete: 'Completar clase',
    markNoShow: 'Marcar no asistencia',
    cancelSession: 'Cancelar clase',
};

const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'session-1',
    scheduled_at: '2026-02-18T15:00:00.000Z',
    duration_minutes: 50,
    status: 'scheduled',
    meet_link: 'https://meet.google.com/abc-defg-hij',
    drive_doc_url: 'https://docs.google.com/document/d/doc-1/edit',
    teacher_notes: 'Nota anterior',
    student: {
        id: 'student-1',
        full_name: 'Ana Lopez',
        email: 'ana@example.com',
    },
    teacher: {
        id: 'teacher-1',
        full_name: 'Profe Uno',
        email: 'profe@example.com',
    },
    ...overrides,
});

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    session: makeSession(),
    lang: 'es',
    translations,
    onSessionUpdate: vi.fn(),
    canEdit: true,
};

const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const renderModal = (props: Partial<typeof defaultProps> = {}) => render(
    <SessionDetailModal
        {...defaultProps}
        {...props}
    />,
);

describe('SessionDetailModal', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('renders a labelled dialog without corrupted visible control symbols', () => {
        renderModal();

        expect(screen.getByRole('dialog', { name: /ana lopez/i })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toHaveAttribute('type', 'button');
        expect(screen.getByLabelText(translations.addNotes)).toHaveValue('Nota anterior');
        expect(screen.getByRole('link', { name: /link de meet/i })).toHaveAttribute('href', translations.meetLink ? defaultProps.session.meet_link : '');
        expect(screen.getByText(/programada/i)).toHaveAccessibleName('Estado: Programada');
        expect(screen.getByText(/18 de febrero/i).closest('time')).toHaveAttribute('dateTime', defaultProps.session.scheduled_at);
        expect(document.body).not.toHaveTextContent('Ã');
        expect(document.body).not.toHaveTextContent('âœ');
    });

    it('saves notes with semantic pending and success states', async () => {
        const pendingSave = deferred<Response>();
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            return pendingSave.promise;
        });
        vi.stubGlobal('fetch', fetchMock);
        const onSessionUpdate = vi.fn();
        renderModal({ onSessionUpdate });

        fireEvent.change(screen.getByLabelText(translations.addNotes), { target: { value: 'Nueva nota interna' } });
        fireEvent.click(screen.getByRole('button', { name: translations.saveNotes }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
            sessionId: 'session-1',
            action: 'update_notes',
            notes: 'Nueva nota interna',
        });
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toBeDisabled();
        expect(screen.getByLabelText(translations.addNotes)).toBeDisabled();
        expect(screen.getByRole('button', { name: translations.saveNotes })).toHaveAttribute('aria-busy', 'true');

        await act(async () => {
            pendingSave.resolve(Response.json({ ok: true }));
        });

        await waitFor(() => expect(onSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
            id: 'session-1',
            teacher_notes: 'Nueva nota interna',
        })));
        expect(screen.getByRole('status')).toHaveTextContent(translations.updated);
        expect(defaultProps.onClose).not.toHaveBeenCalled();
    });

    it('locks no-show actions while pending and runs the controlled close timer after success', async () => {
        vi.useRealTimers();
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        vi.setSystemTime(new Date('2026-02-16T10:00:00.000Z'));
        const pendingNoShow = deferred<Response>();
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            return pendingNoShow.promise;
        });
        vi.stubGlobal('fetch', fetchMock);
        const onClose = vi.fn();
        const onSessionUpdate = vi.fn();
        renderModal({
            onClose,
            onSessionUpdate,
            session: makeSession({ scheduled_at: '2026-02-15T15:00:00.000Z' }),
        });

        fireEvent.click(screen.getByRole('button', { name: translations.markNoShow }));

        expect(screen.getByRole('button', { name: translations.markNoShow })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toBeDisabled();

        await act(async () => {
            pendingNoShow.resolve(Response.json({ ok: true }));
            await pendingNoShow.promise;
        });

        expect(onSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'no_show',
        }));
        expect(onClose).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets editable notes when a different session is shown in the same mounted modal', () => {
        const { rerender } = renderModal();

        fireEvent.change(screen.getByLabelText(translations.addNotes), { target: { value: 'Nota sin guardar' } });
        expect(screen.getByLabelText(translations.addNotes)).toHaveValue('Nota sin guardar');

        rerender(
            <SessionDetailModal
                {...defaultProps}
                session={makeSession({
                    id: 'session-2',
                    teacher_notes: 'Nota de otra clase',
                    student: {
                        id: 'student-2',
                        full_name: 'Beto Ruiz',
                        email: 'beto@example.com',
                    },
                })}
            />,
        );

        expect(screen.getByRole('dialog', { name: /beto ruiz/i })).toBeInTheDocument();
        expect(screen.getByLabelText(translations.addNotes)).toHaveValue('Nota de otra clase');
    });

    it('does not claim a Drive homework URL when append-homework fails before completion', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        let fetchCall = 0;
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            fetchCall += 1;
            if (fetchCall === 1) {
                return Promise.resolve(Response.json({ error: 'Drive unavailable' }, { status: 500 }));
            }
            return Promise.resolve(Response.json({ ok: true }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const onSessionUpdate = vi.fn();
        renderModal({
            onSessionUpdate,
            session: makeSession({ scheduled_at: '2026-02-15T15:00:00.000Z' }),
        });

        fireEvent.click(screen.getByRole('button', { name: translations.markComplete }));
        fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte mock' }));

        await waitFor(() => expect(onSessionUpdate).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
            teacher_notes: 'Reporte completo',
        })));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(expect.objectContaining({
            docUrl: 'https://docs.google.com/document/d/doc-1/edit',
            text: 'deberes escritos',
        }));
        const completeBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
        expect(completeBody).toEqual(expect.objectContaining({
            sessionId: 'session-1',
            action: 'complete',
            notes: 'Reporte completo',
        }));
        expect(completeBody.report).toEqual(expect.objectContaining({
            teacher_comments: 'Reporte completo',
            homework_text: 'deberes escritos',
            homework_drive_url: null,
            homework_append_failed: true,
        }));
        expect(consoleError).toHaveBeenCalledTimes(1);
    });
});
