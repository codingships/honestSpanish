import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import StudentFilters from '../../src/components/admin/StudentFilters';

const esTranslations = {
    search: 'Buscar estudiantes',
    filterStatus: 'Estado',
    filterPlan: 'Plan',
    all: 'Todos',
    withPlan: 'Con plan activo',
    noPlan: 'Sin plan',
    expired: 'Plan expirado',
    assignTeacher: 'Asignar profesor',
    registered: 'Registrado',
    viewDetails: 'Ver detalles',
    count: 'estudiantes',
    name: 'Nombre',
    email: 'Email',
    plan: 'Plan',
    status: 'Estado',
    teacher: 'Profesor',
    actions: 'Acciones',
    active: 'Activo',
    unassigned: 'Sin asignar',
    noResults: 'No se encontraron estudiantes',
};

const enTranslations = {
    search: 'Search students',
    filterStatus: 'Status',
    filterPlan: 'Plan',
    all: 'All',
    withPlan: 'With active plan',
    noPlan: 'No plan',
    expired: 'Expired plan',
    assignTeacher: 'Assign teacher',
    registered: 'Registered',
    viewDetails: 'View details',
    count: 'students',
    name: 'Name',
    email: 'Email',
    plan: 'Plan',
    status: 'Status',
    teacher: 'Teacher',
    actions: 'Actions',
    active: 'Active',
    unassigned: 'Unassigned',
    noResults: 'No students found',
};

const packages = [
    { name: 'standard', displayName: 'Standard' },
    { name: 'group', displayName: 'Grupo' },
];

const students = [
    {
        id: 'student-1',
        full_name: 'Marta Garcia',
        email: 'marta@example.com',
        phone: null,
        created_at: '2025-12-01T09:00:00.000Z',
        preferred_language: 'es',
        subscription_status: 'active',
        subscription_ends: '2026-02-01T09:00:00.000Z',
        package_name: 'standard',
        package_display_name: { es: 'Estandar', en: 'Standard' },
        teacher_name: 'Ana Teacher',
    },
    {
        id: 'student-2',
        full_name: null,
        email: 'diego@example.com',
        phone: null,
        created_at: '2025-12-02T09:00:00.000Z',
        preferred_language: 'es',
        subscription_status: 'active',
        subscription_ends: '2026-01-01T09:00:00.000Z',
        package_name: 'group',
        package_display_name: { es: 'Grupo', en: 'Group' },
        teacher_name: null,
    },
    {
        id: 'student-3',
        full_name: 'Ivan NoPlan',
        email: 'ivan@example.com',
        phone: null,
        created_at: '2025-12-03T09:00:00.000Z',
        preferred_language: 'en',
        subscription_status: null,
        subscription_ends: null,
        package_name: null,
        package_display_name: null,
        teacher_name: null,
    },
];

describe('StudentFilters', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders labelled filters, localized headers and student details', () => {
        render(<StudentFilters students={students} lang="es" translations={esTranslations} packages={packages} />);

        expect(screen.getByLabelText('Buscar estudiantes')).toHaveAttribute('placeholder', 'Buscar estudiantes');
        expect(screen.getByLabelText('Estado')).toHaveValue('all');
        expect(screen.getByLabelText('Plan')).toHaveValue('all');
        expect(screen.getByRole('status')).toHaveTextContent('3 estudiantes');
        expect(screen.getByRole('columnheader', { name: 'Nombre' })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: 'Acciones' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Marta Garcia' })).toHaveAttribute('href', '/es/campus/admin/student/student-1');
        expect(screen.getByText('Activo')).toBeInTheDocument();
        expect(screen.getAllByText('Sin asignar')).toHaveLength(2);
    });

    it('filters students by name or email and announces the visible count', () => {
        render(<StudentFilters students={students} lang="es" translations={esTranslations} packages={packages} />);

        fireEvent.change(screen.getByLabelText('Buscar estudiantes'), {
            target: { value: 'diego' },
        });

        expect(screen.getByRole('status')).toHaveTextContent('1 estudiantes');
        expect(screen.getByRole('link', { name: 'diego' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Marta Garcia' })).not.toBeInTheDocument();
    });

    it('treats active subscriptions with past end dates as expired for the status filter', () => {
        render(<StudentFilters students={students} lang="es" translations={esTranslations} packages={packages} />);

        fireEvent.change(screen.getByLabelText('Estado'), {
            target: { value: 'expired' },
        });

        expect(screen.getByRole('status')).toHaveTextContent('1 estudiantes');
        expect(screen.getByRole('link', { name: 'diego' })).toBeInTheDocument();
        expect(screen.getAllByText('Plan expirado')).toHaveLength(2);
        expect(screen.queryByRole('link', { name: 'Ivan NoPlan' })).not.toBeInTheDocument();
    });

    it('filters by package and renders the empty state inside the table', () => {
        render(<StudentFilters students={students} lang="es" translations={esTranslations} packages={packages} />);

        fireEvent.change(screen.getByLabelText('Plan'), {
            target: { value: 'standard' },
        });
        expect(screen.getByRole('status')).toHaveTextContent('1 estudiantes');
        expect(screen.getByRole('link', { name: 'Marta Garcia' })).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Buscar estudiantes'), {
            target: { value: 'sin coincidencias' },
        });

        expect(screen.getByRole('status')).toHaveTextContent('0 estudiantes');
        expect(within(screen.getByRole('table')).getByText('No se encontraron estudiantes')).toBeInTheDocument();
    });

    it('uses localized table labels and empty states for English admin routes', () => {
        render(<StudentFilters students={[students[2]]} lang="en" translations={enTranslations} packages={packages} />);

        expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('1 students');
        expect(screen.getByText('Unassigned')).toBeInTheDocument();
        expect(screen.getByLabelText('No plan')).toHaveTextContent('-');

        fireEvent.change(screen.getByLabelText('Search students'), {
            target: { value: 'nobody' },
        });

        expect(within(screen.getByRole('table')).getByText('No students found')).toBeInTheDocument();
    });
});
