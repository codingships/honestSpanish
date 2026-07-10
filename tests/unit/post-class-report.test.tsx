import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PostClassReport from '../../src/components/calendar/PostClassReport';

const session = {
    id: 'session-1',
    student: {
        id: 'student-1',
        full_name: 'Ana Lopez',
        email: 'ana@example.com',
    },
};

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    session,
    lang: 'es',
    translations: {},
    onSubmit: vi.fn().mockResolvedValue(undefined),
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

afterEach(() => {
    vi.clearAllMocks();
});

describe('PostClassReport', () => {
    it('renders an accessible dialog and announces a missing rating error', () => {
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<PostClassReport {...defaultProps} onSubmit={onSubmit} />);

        expect(screen.getByRole('dialog', { name: /reporte post-clase/i })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: 'Cerrar reporte post-clase' })).toHaveAttribute('type', 'button');
        expect(screen.getByLabelText(/comentarios para el estudiante/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/deberes/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /enviar reporte y completar clase/i }));

        expect(screen.getByRole('alert')).toHaveTextContent('Please provide a rating for the class.');
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('submits structured report data and homework text', async () => {
        const onClose = vi.fn();
        const onSubmit = vi.fn().mockResolvedValue(undefined);
        render(<PostClassReport {...defaultProps} onClose={onClose} onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Seleccionar 4 estrellas' }));
        fireEvent.click(screen.getByRole('radio', { name: 'Gramatica: Excelente' }));
        fireEvent.change(screen.getByLabelText(/comentarios para el estudiante/i), {
            target: { value: 'Buen progreso con los tiempos pasados.' },
        });
        fireEvent.change(screen.getByLabelText(/deberes/i), {
            target: { value: 'Escribe 10 frases usando preterito e imperfecto.' },
        });
        fireEvent.click(screen.getByRole('button', { name: /enviar reporte y completar clase/i }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({
                rating: 4,
                skills: expect.objectContaining({ grammar: 'Excellent' }),
                teacher_comments: 'Buen progreso con los tiempos pasados.',
            }),
            'Escribe 10 frases usando preterito e imperfecto.',
        );
    });

    it('locks controls while the report is being submitted', async () => {
        const onClose = vi.fn();
        const pendingSubmit = deferred<void>();
        const onSubmit = vi.fn().mockReturnValue(pendingSubmit.promise);
        render(<PostClassReport {...defaultProps} onClose={onClose} onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Seleccionar 5 estrellas' }));
        fireEvent.click(screen.getByRole('button', { name: /enviar reporte y completar clase/i }));

        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: /guardando en drive/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cerrar reporte post-clase' })).toBeDisabled();
        expect(screen.getByLabelText(/comentarios para el estudiante/i)).toBeDisabled();
        expect(screen.getByRole('radio', { name: 'Seleccionar 1 estrellas' })).toBeDisabled();

        await act(async () => {
            pendingSubmit.resolve();
        });

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('shows submit failures without closing the report', async () => {
        const onClose = vi.fn();
        const onSubmit = vi.fn().mockRejectedValue(new Error('Complete action failed'));
        render(<PostClassReport {...defaultProps} onClose={onClose} onSubmit={onSubmit} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Seleccionar 3 estrellas' }));
        fireEvent.click(screen.getByRole('button', { name: /enviar reporte y completar clase/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Complete action failed');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: /enviar reporte y completar clase/i })).toBeEnabled();
    });
});
