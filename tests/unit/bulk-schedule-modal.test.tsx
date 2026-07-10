import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BulkScheduleModal from '../../src/components/calendar/BulkScheduleModal';

const students = [
    { id: 'student-1', full_name: 'Ana Lopez', email: 'ana@example.com' },
    { id: 'student-2', full_name: null, email: 'beto@example.com' },
];

const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    students,
    teacherId: 'teacher-1',
    lang: 'es',
    translations: {},
    onSessionsCreated: vi.fn(),
};

const selectStudent = () => {
    fireEvent.change(screen.getByLabelText(/selecciona el alumno/i), { target: { value: 'student-1' } });
};

const advanceToPatternStep = () => {
    selectStudent();
    fireEvent.click(screen.getByRole('button', { name: /siguiente paso/i }));
};

const flushAsyncWork = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-02-01T10:00:00.000Z'));
});

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('BulkScheduleModal', () => {
    it('renders an accessible dialog and blocks invalid class counts before preview', () => {
        render(<BulkScheduleModal {...defaultProps} />);

        expect(screen.getByRole('dialog', { name: 'Agendar Curso' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cerrar agendamiento masivo' })).toHaveAttribute('type', 'button');
        expect(screen.getByLabelText(/selecciona el alumno/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /siguiente paso/i })).toBeDisabled();

        advanceToPatternStep();

        expect(screen.getByLabelText(/fecha inicio/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/hora/i)).toHaveValue('10:00');
        const classCount = screen.getByLabelText(/total de clases/i);
        fireEvent.change(screen.getByLabelText(/fecha inicio/i), { target: { value: '2026-10-10' } });
        fireEvent.change(classCount, { target: { value: '49' } });

        expect(classCount).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('button', { name: /generar horarios/i })).toBeDisabled();

        fireEvent.change(classCount, { target: { value: '2' } });
        expect(screen.getByRole('button', { name: /generar horarios/i })).toBeEnabled();
    });

    it('generates weekly dates and submits the selected student, teacher and duration', async () => {
        const onClose = vi.fn();
        const onSessionsCreated = vi.fn();
        const fetchMock = vi.fn((..._args: Parameters<typeof fetch>) => Promise.resolve(Response.json({
            message: 'ok',
            sessions: [],
        }, { status: 201 })));
        vi.stubGlobal('fetch', fetchMock);

        render(
            <BulkScheduleModal
                {...defaultProps}
                onClose={onClose}
                onSessionsCreated={onSessionsCreated}
            />,
        );

        advanceToPatternStep();
        fireEvent.change(screen.getByLabelText(/fecha inicio/i), { target: { value: '2026-10-10' } });
        fireEvent.change(screen.getByLabelText(/total de clases/i), { target: { value: '2' } });
        fireEvent.click(screen.getByRole('button', { name: /generar horarios/i }));

        expect(screen.getByRole('button', { name: /confirmar 2 clases/i })).toBeEnabled();
        expect(screen.getAllByRole('button', { name: /saltar clase/i })).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: /confirmar 2 clases/i }));

        await flushAsyncWork();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
        const body = JSON.parse(String(request.body));

        expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/calendar/bulk-sessions');
        expect(request.method).toBe('POST');
        expect(body.studentId).toBe('student-1');
        expect(body.teacherId).toBe('teacher-1');
        expect(body.durationMinutes).toBe(50);
        expect(body.sessions).toHaveLength(2);
        expect(new Date(body.sessions[1]).getTime() - new Date(body.sessions[0]).getTime()).toBe(7 * 24 * 60 * 60 * 1000);

        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(onSessionsCreated).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onSessionsCreated).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes a successful bulk schedule immediately without leaving a duplicate timer callback', async () => {
        const onClose = vi.fn();
        const onSessionsCreated = vi.fn();
        vi.stubGlobal('fetch', vi.fn((..._args: Parameters<typeof fetch>) => Promise.resolve(Response.json({
            message: 'ok',
            sessions: [],
        }, { status: 201 }))));

        render(
            <BulkScheduleModal
                {...defaultProps}
                onClose={onClose}
                onSessionsCreated={onSessionsCreated}
            />,
        );

        advanceToPatternStep();
        fireEvent.change(screen.getByLabelText(/fecha inicio/i), { target: { value: '2026-10-10' } });
        fireEvent.click(screen.getByRole('button', { name: /generar horarios/i }));
        fireEvent.click(screen.getByRole('button', { name: /confirmar 8 clases/i }));

        await flushAsyncWork();

        expect(screen.getByRole('status')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar agendamiento masivo' }));

        expect(onSessionsCreated).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(onSessionsCreated).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
