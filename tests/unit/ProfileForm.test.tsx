import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ProfileForm from '../../src/components/account/ProfileForm';

const mockProfile = {
    full_name: 'Test User',
    email: 'test@example.com',
    phone: '+34612345678',
    preferred_language: 'es',
    timezone: 'Europe/Madrid',
};

const mockTranslations = {
    fullName: 'Nombre completo',
    email: 'Email',
    phone: 'Teléfono',
    language: 'Idioma',
    timezone: 'Zona horaria',
    save: 'Guardar',
    saved: 'Guardado',
};

describe('ProfileForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        global.fetch = vi.fn();
    });

    it('should render with initial profile data', () => {
        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        expect(screen.getByDisplayValue('Test User')).toBeInTheDocument();
        expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
        expect(screen.getByDisplayValue('+34612345678')).toBeInTheDocument();
    });

    it('should have email field disabled', () => {
        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const emailInput = screen.getByDisplayValue('test@example.com');
        expect(emailInput).toBeDisabled();
    });

    it('should allow editing name field', () => {
        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const nameInput = screen.getByDisplayValue('Test User');
        fireEvent.change(nameInput, { target: { value: 'New Name' } });

        expect(screen.getByDisplayValue('New Name')).toBeInTheDocument();
    });

    it('should allow editing phone field', () => {
        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const phoneInput = screen.getByDisplayValue('+34612345678');
        fireEvent.change(phoneInput, { target: { value: '+34699999999' } });

        expect(screen.getByDisplayValue('+34699999999')).toBeInTheDocument();
    });

    it('should allow selecting different language', () => {
        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const languageSelect = screen.getByDisplayValue('Español');
        fireEvent.change(languageSelect, { target: { value: 'en' } });

        expect((languageSelect as HTMLSelectElement).value).toBe('en');
    });

    it('should allow selecting different timezone', () => {
        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const timezoneSelect = screen.getByDisplayValue('Madrid (UTC+1/+2)');
        fireEvent.change(timezoneSelect, { target: { value: 'Europe/London' } });

        expect((timezoneSelect as HTMLSelectElement).value).toBe('Europe/London');
    });

    it('should call API when submitting form', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        } as Response);

        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/account/update-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: expect.any(String),
            });
        });
    });

    it('should show saved message after successful submit', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        } as Response);

        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

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

        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        await waitFor(() => {
            expect(screen.getByText('✗ Error')).toBeInTheDocument();
        });
    });

    it('should disable save button while saving', async () => {
        vi.mocked(global.fetch).mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve({ ok: true } as Response), 100))
        );

        render(<ProfileForm profile={mockProfile} translations={mockTranslations} />);

        const saveButton = screen.getByText('Guardar');
        fireEvent.click(saveButton);

        expect(saveButton).toBeDisabled();
    });
});
