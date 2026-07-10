import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProfileForm from '../../src/components/account/ProfileForm';

// Component coverage for src/components/account/ProfileForm.tsx.
const profile = {
    full_name: 'Existing Student',
    email: 'student@example.com',
    phone: '+34 600 000 000',
    preferred_language: 'es',
    timezone: 'Europe/Madrid',
};

const translations = {
    fullName: 'Full name',
    email: 'Email',
    phone: 'Phone',
    language: 'Language',
    timezone: 'Timezone',
    save: 'Save changes',
    saved: 'Saved',
};

function renderProfileForm() {
    return render(<ProfileForm profile={profile} translations={translations} />);
}

describe('ProfileForm', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('associates labels with editable controls and keeps email read-only', () => {
        vi.stubGlobal('fetch', vi.fn());

        renderProfileForm();

        expect(screen.getByLabelText('Full name')).toHaveValue('Existing Student');
        expect(screen.getByLabelText('Email')).toHaveValue('student@example.com');
        expect(screen.getByLabelText('Email')).toBeDisabled();
        expect(screen.getByLabelText('Phone')).toHaveValue('+34 600 000 000');
        expect(screen.getByLabelText('Language')).toHaveValue('es');
        expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/Madrid');
    });

    it('posts edited profile values and exposes the saved status semantically', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);

        renderProfileForm();

        fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Updated Student' } });
        fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+34 611 222 333' } });
        fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'en' } });
        fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/New_York' } });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        expect(fetchMock).toHaveBeenCalledWith('/api/account/update-profile', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toEqual({
            fullName: 'Updated Student',
            phone: '+34 611 222 333',
            preferredLanguage: 'en',
            timezone: 'America/New_York',
        });
        expect(screen.getByRole('status')).toHaveTextContent('Saved');

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('disables the save button while the profile update is in flight', async () => {
        let resolveFetch: (value: { ok: boolean }) => void = () => {};
        const pendingResponse = new Promise<{ ok: boolean }>((resolve) => {
            resolveFetch = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(pendingResponse);
        vi.stubGlobal('fetch', fetchMock);

        renderProfileForm();

        const saveButton = screen.getByRole('button', { name: 'Save changes' });
        fireEvent.click(saveButton);

        expect(saveButton).toBeDisabled();
        expect(saveButton).toHaveTextContent('...');

        await act(async () => {
            resolveFetch({ ok: true });
            await pendingResponse;
        });

        expect(saveButton).toBeEnabled();
    });

    it('shows an alert and re-enables saving when the profile update fails', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: false });
        vi.stubGlobal('fetch', fetchMock);

        renderProfileForm();

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        });

        expect(screen.getByRole('alert')).toHaveTextContent('Error');
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    });
});
