import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthForm from '../../src/components/AuthForm.jsx';
import { ui } from '../../src/i18n/translations';

const authMock = vi.hoisted(() => ({
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
    supabase: {
        auth: authMock,
    },
}));

const translations = ui.es;

function renderAuthForm(initialError: string | null = null, lang: 'es' | 'en' | 'ru' = 'es') {
    return render(<AuthForm lang={lang} translations={ui[lang]} initialError={initialError} />);
}

function deferredAuthResult() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function fillCredentials(email = ' estudiante@example.com ', password = 'password123') {
    fireEvent.change(screen.getByLabelText(translations.auth.email), { target: { value: email } });
    fireEvent.change(screen.getByLabelText(translations.auth.password), { target: { value: password } });
}

describe('AuthForm', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('shows a generic confirmation failure supplied by the localized callback page', () => {
        renderAuthForm(translations.auth.error.confirmationFailed);
        expect(screen.getByRole('alert')).toHaveTextContent(translations.auth.error.confirmationFailed);
    });

    it.each(['es', 'en', 'ru'] as const)('localizes the home link and email placeholder in %s', (lang) => {
        const localized = ui[lang];
        renderAuthForm(null, lang);

        expect(screen.getByRole('link', { name: new RegExp(localized.auth.backHome) })).toHaveAttribute('href', `/${lang}`);
        expect(screen.getByLabelText(localized.auth.email)).toHaveAttribute('placeholder', localized.auth.emailPlaceholder);
    });

    it('uses localized generic copy instead of exposing an unexpected provider error', async () => {
        authMock.signInWithPassword.mockRejectedValueOnce(new Error('provider-internal-message'));
        renderAuthForm(null, 'en');

        fireEvent.change(screen.getByLabelText(ui.en.auth.email), { target: { value: 'student@example.com' } });
        fireEvent.change(screen.getByLabelText(ui.en.auth.password), { target: { value: 'password123' } });
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.submitLogin }));

        expect(await screen.findByRole('alert')).toHaveTextContent(ui.en.auth.error.generic);
        expect(screen.getByRole('alert')).not.toHaveTextContent('provider-internal-message');
    });

    it('submits trimmed login credentials, locks mode controls while pending and announces invalid credentials', async () => {
        const pendingLogin = deferredAuthResult();
        authMock.signInWithPassword.mockReturnValueOnce(pendingLogin.promise);

        renderAuthForm();
        fillCredentials();

        const submit = screen.getByRole('button', { name: translations.auth.submitLogin });
        fireEvent.click(submit);

        expect(submit).toBeDisabled();
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.auth.register })).toBeDisabled();
        expect(screen.getByRole('button', { name: translations.auth.forgotPassword })).toBeDisabled();

        pendingLogin.resolve({ error: { message: 'Invalid login credentials' } });

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.auth.error.invalidCredentials);
        expect(authMock.signInWithPassword).toHaveBeenCalledWith({
            email: 'estudiante@example.com',
            password: 'password123',
        });
    });

    it('registers with a trimmed email and does not perform a secondary login when Supabase returns no session', async () => {
        authMock.signUp.mockResolvedValueOnce({
            data: { user: { id: 'user-1', identities: [{ id: 'identity-1' }] }, session: null },
            error: null,
        });

        renderAuthForm();
        fireEvent.click(screen.getByRole('button', { name: translations.auth.register }));
        fillCredentials(' nueva@example.com ', 'secret123');
        fireEvent.click(screen.getByLabelText(translations.auth.adultConfirmation));
        fireEvent.click(screen.getByRole('button', { name: translations.auth.submitRegister }));

        await waitFor(() => expect(authMock.signUp).toHaveBeenCalledTimes(1));
        expect(authMock.signUp).toHaveBeenCalledWith({
            email: 'nueva@example.com',
            password: 'secret123',
            options: {
                emailRedirectTo: `${window.location.origin}/api/auth/confirm?lang=es`,
                data: {
                    full_name: 'nueva',
                    adult_confirmed: true,
                    adult_confirmed_at: expect.any(String),
                    age_policy_version: '2026-07-10',
                },
            },
        });
        expect(authMock.signInWithPassword).not.toHaveBeenCalled();
        expect(await screen.findByRole('status')).toHaveTextContent(translations.auth.success.registered);
    });

    it('always reports reset-email success while trimming the email and suppressing reset errors', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        authMock.resetPasswordForEmail.mockRejectedValueOnce(new Error('User not found'));

        renderAuthForm();
        fireEvent.click(screen.getByRole('button', { name: translations.auth.forgotPassword }));
        fireEvent.change(screen.getByLabelText(translations.auth.email), {
            target: { value: ' reset@example.com ' },
        });
        fireEvent.click(screen.getByRole('button', { name: translations.auth.sendResetLink }));

        await waitFor(() => expect(authMock.resetPasswordForEmail).toHaveBeenCalledTimes(1));
        expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith('reset@example.com', {
            redirectTo: expect.stringMatching(/\/es\/reset-password$/),
        });
        expect(await screen.findByRole('status')).toHaveTextContent(translations.auth.success.resetEmailSent);
        expect(consoleError).not.toHaveBeenCalled();
    });
});
