import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import AssignTeacherModal from '../../src/components/admin/AssignTeacherModal';

const mockTeachers = [
    { id: 'teacher-1', full_name: 'María García', email: 'maria@test.com' },
    { id: 'teacher-2', full_name: 'Juan López', email: 'juan@test.com' },
    { id: 'teacher-3', full_name: null, email: 'pedro@test.com' },
];

const mockTranslations = {
    title: 'Asignar Profesor',
    select: 'Seleccionar profesor',
    primary: 'Profesor principal',
    assign: 'Asignar',
    remove: 'Eliminar',
    success: 'Profesor asignado correctamente',
    current: 'Profesor actual',
    none: 'Sin profesor asignado',
};

describe('AssignTeacherModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('should not render when isOpen is false', () => {
        render(
            <AssignTeacherModal
                isOpen={false}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        expect(screen.queryByText('Asignar Profesor')).not.toBeInTheDocument();
    });

    it('should render modal when isOpen is true', () => {
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('Asignar Profesor')).toBeInTheDocument();
        expect(screen.getByText('Test Student')).toBeInTheDocument();
    });

    it('should render teacher options in select', () => {
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('María García')).toBeInTheDocument();
        expect(screen.getByText('Juan López')).toBeInTheDocument();
        // Teacher 3 has no full_name, should show email
        expect(screen.getByText('pedro@test.com')).toBeInTheDocument();
    });

    it('should allow selecting a teacher', () => {
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'teacher-1' } });

        expect((select as HTMLSelectElement).value).toBe('teacher-1');
    });

    it('should toggle primary checkbox', () => {
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        const checkbox = screen.getByRole('checkbox');
        expect(checkbox).toBeChecked(); // Default is true

        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();
    });

    it('should call API when assigning teacher', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        } as Response);

        // Mock window.location.reload
        const reloadMock = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { reload: reloadMock },
            writable: true,
        });

        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        // Select a teacher
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'teacher-1' } });

        // Click assign button
        const assignButton = screen.getByText('Asignar');
        fireEvent.click(assignButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/admin/assign-teacher', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: 'student-123',
                    teacherId: 'teacher-1',
                    isPrimary: true,
                }),
            });
        });
    });

    it('should show success message after assignment', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        } as Response);

        Object.defineProperty(window, 'location', {
            value: { reload: vi.fn() },
            writable: true,
        });

        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: 'teacher-1' } });

        const assignButton = screen.getByText('Asignar');
        fireEvent.click(assignButton);

        await waitFor(() => {
            expect(screen.getByText('Profesor asignado correctamente')).toBeInTheDocument();
        });
    });

    it('should call onClose when clicking backdrop', () => {
        const onClose = vi.fn();
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={onClose}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        // Click close button (×)
        const closeButton = screen.getByText('×');
        fireEvent.click(closeButton);

        expect(onClose).toHaveBeenCalled();
    });

    it('should show remove button when current teacher exists', () => {
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                currentTeacherId="teacher-1"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('Eliminar')).toBeInTheDocument();
        expect(screen.getByText(/Profesor actual/i)).toBeInTheDocument();
    });

    it('should disable assign button when no teacher selected', () => {
        render(
            <AssignTeacherModal
                isOpen={true}
                onClose={() => { }}
                studentId="student-123"
                studentName="Test Student"
                teachers={mockTeachers}
                translations={mockTranslations}
            />
        );

        const assignButton = screen.getByText('Asignar');
        expect(assignButton).toBeDisabled();
    });
});
