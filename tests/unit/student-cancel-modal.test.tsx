import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudentCancelModal from '../../src/components/calendar/StudentCancelModal';

const translations = {
    close: 'Cerrar cancelacion',
    cancelClass: 'Cancelar clase',
    cancelConfirm: 'Confirma que quieres cancelar esta clase',
    cancelWarning: 'La sesion quedara disponible para reprogramar.',
    cancelLateWarning: 'Menos de 24 horas: la sesion se consumira.',
    cancelReason: 'Motivo opcional',
    cancelReasonPlaceholder: 'Por que cancelas la clase',
    cancelError: 'No se pudo cancelar',
    with: 'Con',
    cancel: 'Volver',
    confirm: 'Confirmar cancelacion',
};

const makeSession = (overrides: Record<string, unknown> = {}) => ({
    id: 'session-1',
    scheduled_at: '2026-02-20T15:00:00.000Z',
    teacher: {
        full_name: 'Maria Garcia',
        email: 'maria@example.com',
    },
    ...overrides,
});

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    session: makeSession(),
    lang: 'es',
    translations,
    onSuccess: vi.fn(),
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
    <StudentCancelModal
        {...defaultProps}
        {...props}
    />,
);

describe('StudentCancelModal', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('renders a labelled dialog without corrupted visible symbols', () => {
        renderModal();

        expect(screen.getByRole('dialog', { name: translations.cancelClass })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toHaveAttribute('type', 'button');
        expect(screen.getByLabelText(translations.cancelReason)).toHaveAttribute('name', 'reason');
        expect(screen.getByText(/20 de febrero/i).closest('time')).toHaveAttribute('dateTime', defaultProps.session.scheduled_at);
        expect(screen.getByText(/maria garcia/i)).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('Ã');
        expect(document.body).not.toHaveTextContent('â');
    });

    it('warns that a cancellation inside 24 hours consumes the class', () => {
        renderModal({
            session: makeSession({ scheduled_at: '2026-02-19T10:00:00.000Z' }),
        });

        expect(screen.getByText(translations.cancelLateWarning)).toBeInTheDocument();
        expect(screen.queryByText(translations.cancelWarning)).not.toBeInTheDocument();
    });

    it('submits a trimmed cancellation reason and locks controls while pending', async () => {
        const pendingCancel = deferred<Response>();
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            return pendingCancel.promise;
        });
        vi.stubGlobal('fetch', fetchMock);
        const onClose = vi.fn();
        const onSuccess = vi.fn();
        renderModal({ onClose, onSuccess });

        fireEvent.change(screen.getByLabelText(translations.cancelReason), {
            target: { value: '  viaje de trabajo  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: translations.confirm }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
            sessionId: 'session-1',
            action: 'cancel',
            reason: 'viaje de trabajo',
        });
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.close })).toBeDisabled();
        expect(screen.getByRole('button', { name: translations.cancel })).toBeDisabled();
        expect(screen.getByRole('button', { name: '...' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByLabelText(translations.cancelReason)).toBeDisabled();

        await act(async () => {
            pendingCancel.resolve(Response.json({ success: true }));
        });

        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('session-1'));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows an alert for non-JSON cancellation failures and keeps the modal open', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            return Promise.resolve(new Response('server unavailable', { status: 503 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const onSuccess = vi.fn();
        renderModal({ onSuccess });

        fireEvent.click(screen.getByRole('button', { name: translations.confirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to cancel');
        expect(onSuccess).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getByRole('button', { name: translations.confirm })).toBeEnabled();
    });

    it('resets reason and errors when another session is shown in the mounted modal', async () => {
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            return Promise.resolve(Response.json({ error: 'Too late' }, { status: 400 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        const { rerender } = renderModal();

        fireEvent.change(screen.getByLabelText(translations.cancelReason), {
            target: { value: 'No puedo asistir' },
        });
        fireEvent.click(screen.getByRole('button', { name: translations.confirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Too late');

        rerender(
            <StudentCancelModal
                {...defaultProps}
                session={makeSession({
                    id: 'session-2',
                    scheduled_at: '2026-02-21T16:00:00.000Z',
                    teacher: {
                        full_name: null,
                        email: 'otro@example.com',
                    },
                })}
            />,
        );

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByLabelText(translations.cancelReason)).toHaveValue('');
        expect(screen.getByText(/otro@example.com/i)).toBeInTheDocument();
    });
});
