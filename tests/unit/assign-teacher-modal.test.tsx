import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AssignTeacherButton from '../../src/components/admin/AssignTeacherButton';
import AssignTeacherModal from '../../src/components/admin/AssignTeacherModal';

// Component coverage for src/components/admin/AssignTeacherButton.tsx and src/components/admin/AssignTeacherModal.tsx.
const teachers = [
    { id: 'teacher-1', full_name: 'Teacher One', email: 'one@example.com' },
    { id: 'teacher-2', full_name: null, email: 'two@example.com' },
];

const translations = {
    title: 'Assign teacher',
    select: 'Select teacher',
    primary: 'Primary teacher',
    assign: 'Assign',
    remove: 'Remove',
    success: 'Teacher assigned',
    current: 'Current teacher',
    none: 'No teacher',
};

describe('AssignTeacherButton and AssignTeacherModal', () => {
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('opens an accessible dialog and disables assignment until a teacher is selected', () => {
        render(
            <AssignTeacherButton
                studentId="student-1"
                studentName="Student One"
                teachers={teachers}
                buttonText="Open assignment"
                translations={translations}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open assignment' }));

        expect(screen.getByRole('dialog', { name: 'Assign teacher' })).toBeInTheDocument();
        expect(screen.getByText('Student One')).toBeInTheDocument();
        expect(screen.getByLabelText('Select teacher')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(screen.queryByRole('dialog', { name: 'Assign teacher' })).not.toBeInTheDocument();
    });

    it('submits selected non-primary teacher assignments and shows success status', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);
        const onClose = vi.fn();

        render(
            <AssignTeacherModal
                isOpen
                onClose={onClose}
                studentId="student-1"
                studentName="Student One"
                teachers={teachers}
                translations={translations}
            />,
        );

        fireEvent.change(screen.getByLabelText('Select teacher'), { target: { value: 'teacher-2' } });
        fireEvent.click(screen.getByLabelText('Primary teacher'));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
        });

        expect(fetchMock).toHaveBeenCalledWith('/api/admin/assign-teacher', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toEqual({
            studentId: 'student-1',
            teacherId: 'teacher-2',
            isPrimary: false,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Teacher assigned');
    });

    it('disables assignment controls while the assign request is in flight', async () => {
        let resolveFetch: (value: { ok: boolean }) => void = () => {};
        const pendingResponse = new Promise<{ ok: boolean }>((resolve) => {
            resolveFetch = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(pendingResponse);
        vi.stubGlobal('fetch', fetchMock);

        render(
            <AssignTeacherModal
                isOpen
                onClose={vi.fn()}
                studentId="student-1"
                studentName="Student One"
                teachers={teachers}
                translations={translations}
            />,
        );

        fireEvent.change(screen.getByLabelText('Select teacher'), { target: { value: 'teacher-1' } });
        const assignButton = screen.getByRole('button', { name: 'Assign' });
        fireEvent.click(assignButton);

        expect(assignButton).toBeDisabled();
        expect(assignButton).toHaveTextContent('...');

        await act(async () => {
            resolveFetch({ ok: true });
            await pendingResponse;
        });

        expect(assignButton).toBeEnabled();
    });

    it('shows an alert when assignment fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <AssignTeacherModal
                isOpen
                onClose={vi.fn()}
                studentId="student-1"
                studentName="Student One"
                teachers={teachers}
                translations={translations}
            />,
        );

        fireEvent.change(screen.getByLabelText('Select teacher'), { target: { value: 'teacher-1' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Error assigning teacher');
    });

    it('removes the current teacher assignment through the remove endpoint', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <AssignTeacherModal
                isOpen
                onClose={vi.fn()}
                studentId="student-1"
                studentName="Student One"
                currentTeacherId="teacher-1"
                teachers={teachers}
                translations={translations}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/remove-teacher', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toEqual({
            studentId: 'student-1',
            teacherId: 'teacher-1',
        });
    });
});
