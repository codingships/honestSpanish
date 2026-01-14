import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import StudentFilters from '../../src/components/admin/StudentFilters';

const mockStudents = [
    {
        id: 'student-1',
        full_name: 'María García',
        email: 'maria@test.com',
        phone: '+34600111222',
        created_at: '2024-01-15',
        preferred_language: 'es',
        subscription_status: 'active',
        subscription_ends: '2024-06-15',
        package_name: 'basic',
        package_display_name: { es: 'Básico', en: 'Basic' },
        teacher_name: 'Juan López',
    },
    {
        id: 'student-2',
        full_name: 'John Smith',
        email: 'john@test.com',
        phone: null,
        created_at: '2024-02-20',
        preferred_language: 'en',
        subscription_status: null,
        subscription_ends: null,
        package_name: null,
        package_display_name: null,
        teacher_name: null,
    },
    {
        id: 'student-3',
        full_name: 'Pedro Martínez',
        email: 'pedro@test.com',
        phone: '+34600333444',
        created_at: '2023-12-01',
        preferred_language: 'es',
        subscription_status: 'expired',
        subscription_ends: '2024-01-01',
        package_name: 'premium',
        package_display_name: { es: 'Premium', en: 'Premium' },
        teacher_name: 'Ana Rodríguez',
    },
];

const mockPackages = [
    { name: 'basic', displayName: 'Básico' },
    { name: 'premium', displayName: 'Premium' },
];

const mockTranslations = {
    search: 'Buscar estudiante...',
    filterStatus: 'Estado',
    filterPlan: 'Plan',
    all: 'Todos',
    withPlan: 'Con plan',
    noPlan: 'Sin plan',
    expired: 'Expirado',
    assignTeacher: 'Asignar profesor',
    registered: 'Registrado',
    viewDetails: 'Ver detalles',
};

describe('StudentFilters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render list of students', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        expect(screen.getByText('María García')).toBeInTheDocument();
        expect(screen.getByText('John Smith')).toBeInTheDocument();
        expect(screen.getByText('Pedro Martínez')).toBeInTheDocument();
    });

    it('should show search input', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        expect(screen.getByPlaceholderText('Buscar estudiante...')).toBeInTheDocument();
    });

    it('should filter students by search text', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        const searchInput = screen.getByPlaceholderText('Buscar estudiante...');
        fireEvent.change(searchInput, { target: { value: 'María' } });

        expect(screen.getByText('María García')).toBeInTheDocument();
        expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
        expect(screen.queryByText('Pedro Martínez')).not.toBeInTheDocument();
    });

    it('should filter by email search', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        const searchInput = screen.getByPlaceholderText('Buscar estudiante...');
        fireEvent.change(searchInput, { target: { value: 'john@test' } });

        expect(screen.queryByText('María García')).not.toBeInTheDocument();
        expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    it('should show status filter options', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        // Should have status filter
        expect(screen.getByText('Estado')).toBeInTheDocument();
    });

    it('should show plan filter options', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        // Should have plan filter
        expect(screen.getByText('Plan')).toBeInTheDocument();
    });

    it('should display correct number of students', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        // All 3 students should be visible initially
        const studentCards = screen.getAllByText(/Ver detalles/i);
        expect(studentCards.length).toBe(3);
    });

    it('should render empty state when no students match filter', () => {
        render(
            <StudentFilters
                students={mockStudents}
                lang="es"
                translations={mockTranslations}
                packages={mockPackages}
            />
        );

        const searchInput = screen.getByPlaceholderText('Buscar estudiante...');
        fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

        // None of the original names should be visible
        expect(screen.queryByText('María García')).not.toBeInTheDocument();
        expect(screen.queryByText('John Smith')).not.toBeInTheDocument();
        expect(screen.queryByText('Pedro Martínez')).not.toBeInTheDocument();
    });
});
