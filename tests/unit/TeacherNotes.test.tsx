import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import TeacherNotes from '../../src/components/TeacherNotes';

const mockTranslations = {
    placeholder: 'Escribe notas sobre el estudiante...',
    save: 'Guardar',
    saved: 'Guardado',
};

describe('TeacherNotes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('should render with initial notes', () => {
        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes="Notas iniciales"
                translations={mockTranslations}
            />
        );

        expect(screen.getByDisplayValue('Notas iniciales')).toBeInTheDocument();
    });

    it('should render with empty notes when no initial notes', () => {
        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes=""
                translations={mockTranslations}
            />
        );

        const textarea = screen.getByPlaceholderText('Escribe notas sobre el estudiante...');
        expect(textarea).toBeInTheDocument();
        expect(textarea).toHaveValue('');
    });

    it('should allow editing notes', () => {
        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes=""
                translations={mockTranslations}
            />
        );

        const textarea = screen.getByPlaceholderText('Escribe notas sobre el estudiante...');
        fireEvent.change(textarea, { target: { value: 'Nuevas notas' } });

        expect(screen.getByDisplayValue('Nuevas notas')).toBeInTheDocument();
    });

    it('should call API when saving notes', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        } as Response);

        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes="Notas"
                translations={mockTranslations}
            />
        );

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/update-student-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId: 'student-123', notes: 'Notas' }),
            });
        });
    });

    it('should show success message after saving', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        } as Response);

        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes="Notas"
                translations={mockTranslations}
            />
        );

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(screen.getByText('✓ Guardado')).toBeInTheDocument();
        });
    });

    it('should show error message on API failure', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Failed' }),
        } as Response);

        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes="Notas"
                translations={mockTranslations}
            />
        );

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(screen.getByText('✗ Error')).toBeInTheDocument();
        });
    });

    it('should disable button while saving', async () => {
        vi.mocked(global.fetch).mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve({ ok: true } as Response), 100))
        );

        render(
            <TeacherNotes
                studentId="student-123"
                initialNotes="Notas"
                translations={mockTranslations}
            />
        );

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        expect(saveButton).toBeDisabled();
    });

    it('matches snapshot', () => {
        const { asFragment } = render(
            <TeacherNotes
                studentId="student-123"
                initialNotes="Notas"
                translations={mockTranslations}
            />
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
