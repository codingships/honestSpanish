import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UserManager from '../../src/components/admin/UserManager';

const teachers = [
    { id: 'teacher-1', fullName: 'Ana Profesora', email: 'ana@example.com' },
    { id: 'teacher-2', fullName: 'Luis Profesor', email: 'luis@example.com' },
];

const students = [
    {
        id: 'student-1',
        fullName: 'Marta Garcia',
        email: 'marta@example.com',
        createdAt: '2026-06-01T10:00:00.000Z',
        activeSubscription: {
            id: 'sub-1',
            status: 'active',
            sessions_total: 4,
            contract_schema_version: 2,
            academicProgress: {
                state: 'ready',
                consumedSessions: 2,
                sessionsTotal: 4,
            },
            package: { name: 'standard', display_name: { es: 'Estandar' } },
        },
        primaryTeacher: { id: 'teacher-1', fullName: 'Ana Profesora' },
    },
    {
        id: 'student-2',
        fullName: null,
        email: 'sin-nombre@example.com',
        createdAt: '2026-06-02T10:00:00.000Z',
        activeSubscription: null,
        primaryTeacher: null,
    },
];

function jsonResponse(payload: unknown, ok = true): Response {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

describe('UserManager', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('loads users with status counts, active-plan text and labelled teacher selectors', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ teachers, students }));
        vi.stubGlobal('fetch', fetchMock);

        render(<UserManager />);

        expect(screen.getByRole('status')).toHaveTextContent('Cargando base de datos...');
        expect(await screen.findByRole('heading', { name: 'Gestión de Alumnos (Emparejador)' })).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', { signal: expect.any(AbortSignal) });
        expect(screen.getByText('Alumnos: 2')).toHaveAttribute('role', 'status');
        expect(screen.getByText('Profesores: 2')).toHaveAttribute('role', 'status');
        expect(screen.getByText('standard (4 clases)')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
        expect(screen.getByText('4 consumidas')).toBeInTheDocument();
        expect(screen.getByLabelText('Tutor asignado para Marta Garcia')).toHaveValue('teacher-1');
        expect(screen.getByLabelText('Tutor asignado para sin-nombre@example.com')).toHaveValue('');
    });

    it('does not present pending, inconsistent or legacy progress as zero classes', async () => {
        const progressStudents = [
            {
                ...students[0],
                id: 'student-pending',
                email: 'pending@example.com',
                activeSubscription: {
                    ...students[0].activeSubscription,
                    academicProgress: { state: 'pending', consumedSessions: null, sessionsTotal: 4 },
                },
            },
            {
                ...students[0],
                id: 'student-inconsistent',
                email: 'inconsistent@example.com',
                activeSubscription: {
                    ...students[0].activeSubscription,
                    academicProgress: { state: 'inconsistent', consumedSessions: null, sessionsTotal: null },
                },
            },
            {
                ...students[0],
                id: 'student-legacy',
                email: 'legacy@example.com',
                activeSubscription: {
                    ...students[0].activeSubscription,
                    contract_schema_version: 1,
                    academicProgress: { state: 'legacy', consumedSessions: null, sessionsTotal: null },
                },
            },
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ teachers, students: progressStudents })));

        render(<UserManager />);

        expect(await screen.findByText('Preparando ciclo')).toHaveAttribute('role', 'status');
        expect(screen.getByText('Progreso no disponible')).toHaveAttribute('role', 'alert');
        expect(screen.getByText('Plan anterior')).toHaveAttribute('role', 'status');
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('renders load failures and empty student lists semantically', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'Forbidden' }, false)));

        render(<UserManager />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Error: Forbidden');

        vi.unstubAllGlobals();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ teachers: [], students: [] })));

        render(<UserManager />);

        expect(await screen.findByText('No hay estudiantes registrados.')).toHaveAttribute('role', 'status');
    });

    it('assigns a teacher, locks every selector while pending and announces success', async () => {
        const pendingAssignment = deferredResponse();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ teachers, students }))
            .mockReturnValueOnce(pendingAssignment.promise);
        vi.stubGlobal('fetch', fetchMock);

        render(<UserManager />);
        await screen.findByText('Marta Garcia');

        const firstSelect = screen.getByLabelText('Tutor asignado para Marta Garcia');
        const secondSelect = screen.getByLabelText('Tutor asignado para sin-nombre@example.com');
        fireEvent.change(firstSelect, { target: { value: 'teacher-2' } });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/assign-teacher');
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            studentId: 'student-1',
            teacherId: 'teacher-2',
        });
        expect(firstSelect).toBeDisabled();
        expect(firstSelect).toHaveAttribute('aria-busy', 'true');
        expect(secondSelect).toBeDisabled();

        pendingAssignment.resolve(jsonResponse({ ok: true }));

        expect(await screen.findByText('Profesor asignado')).toHaveAttribute('role', 'status');
        await waitFor(() => expect(screen.getByLabelText('Tutor asignado para Marta Garcia')).toHaveValue('teacher-2'));
    });

    it('announces assignment failures in-page without window.alert', async () => {
        const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ teachers, students }))
            .mockResolvedValueOnce(jsonResponse({ error: 'Profesor inválido' }, false));
        vi.stubGlobal('fetch', fetchMock);

        render(<UserManager />);
        await screen.findByText('Marta Garcia');

        fireEvent.change(screen.getByLabelText('Tutor asignado para Marta Garcia'), {
            target: { value: 'teacher-2' },
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Profesor inválido');
        expect(alertSpy).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Tutor asignado para Marta Garcia')).toHaveValue('teacher-1');
    });
});
