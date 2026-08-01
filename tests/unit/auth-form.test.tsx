import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
const slotPublicId = '10000000-0000-4000-8000-000000000001';
const englishReturnTo = `/en?checkoutSlot=${slotPublicId}#planes`;

function renderAuthForm(
    initialError: string | null = null,
    lang: 'es' | 'en' | 'ru' = 'es',
    returnTo: string | null = null,
) {
    return render(
        <AuthForm lang={lang} translations={ui[lang]} initialError={initialError} returnTo={returnTo} />,
    );
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

    it('renders credentials and submission disabled until the client hydrates', () => {
        const markup = renderToStaticMarkup(
            <AuthForm lang="es" translations={translations} initialError={null} />,
        );
        const container = document.createElement('div');
        container.innerHTML = markup;

        expect(container.querySelector('#auth-email')).toBeDisabled();
        expect(container.querySelector('#auth-password')).toBeDisabled();
        expect(container.querySelector('form button[type="submit"]')).toBeDisabled();
        expect(container.querySelector('form')).toHaveAttribute('aria-busy', 'true');
        expect(container.querySelector('noscript')).toHaveTextContent(translations.auth.javascriptRequired);
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

    it.each(['es', 'en', 'ru'] as const)(
        'registers in %s with the exact localized confirmation redirect and no secondary login',
        async (lang) => {
            const localized = ui[lang];
            authMock.signUp.mockResolvedValueOnce({
                data: { user: { id: 'user-1', identities: [{ id: 'identity-1' }] }, session: null },
                error: null,
            });

            renderAuthForm(null, lang);
            fireEvent.click(screen.getByRole('button', { name: localized.auth.register }));
            fireEvent.change(screen.getByLabelText(localized.auth.email), {
                target: { value: ' nueva@example.com ' },
            });
            fireEvent.change(screen.getByLabelText(localized.auth.password), {
                target: { value: 'secret123' },
            });
            fireEvent.click(screen.getByLabelText(localized.auth.adultConfirmation));
            fireEvent.click(screen.getByRole('button', { name: localized.auth.submitRegister }));

            await waitFor(() => expect(authMock.signUp).toHaveBeenCalledTimes(1));
            expect(authMock.signUp).toHaveBeenCalledWith({
                email: 'nueva@example.com',
                password: 'secret123',
                options: {
                    emailRedirectTo: `${window.location.origin}/api/auth/confirm?lang=${lang}`,
                    data: {
                        full_name: 'nueva',
                        adult_confirmed: true,
                        adult_confirmed_at: expect.any(String),
                        age_policy_version: '2026-07-10',
                    },
                },
            });
            expect(authMock.signInWithPassword).not.toHaveBeenCalled();
            expect(await screen.findByRole('status')).toHaveTextContent(localized.auth.success.registered);
        },
    );

    it('preserves an allowlisted public return in the registration confirmation URL', async () => {
        authMock.signUp.mockResolvedValueOnce({
            data: { user: { id: 'user-1' }, session: null },
            error: null,
        });
        renderAuthForm(null, 'en', englishReturnTo);
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.register }));
        fireEvent.change(screen.getByLabelText(ui.en.auth.email), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByLabelText(ui.en.auth.password), { target: { value: 'secret123' } });
        fireEvent.click(screen.getByLabelText(ui.en.auth.adultConfirmation));
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.submitRegister }));

        await waitFor(() => expect(authMock.signUp).toHaveBeenCalledTimes(1));
        expect(authMock.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
            `${window.location.origin}/api/auth/confirm?lang=en&returnTo=${encodeURIComponent(englishReturnTo)}`,
        );
    });

    it('drops an unsafe return from the registration confirmation URL', async () => {
        authMock.signUp.mockResolvedValueOnce({
            data: { user: { id: 'user-1' }, session: null },
            error: null,
        });
        renderAuthForm(null, 'es', '//evil.example/es');
        fireEvent.click(screen.getByRole('button', { name: translations.auth.register }));
        fireEvent.change(screen.getByLabelText(translations.auth.email), { target: { value: 'new@example.com' } });
        fireEvent.change(screen.getByLabelText(translations.auth.password), { target: { value: 'secret123' } });
        fireEvent.click(screen.getByLabelText(translations.auth.adultConfirmation));
        fireEvent.click(screen.getByRole('button', { name: translations.auth.submitRegister }));

        await waitFor(() => expect(authMock.signUp).toHaveBeenCalledTimes(1));
        expect(authMock.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
            `${window.location.origin}/api/auth/confirm?lang=es`,
        );
    });

    it.each(['es', 'en', 'ru'] as const)(
        'uses the exact %s reset-password redirect while suppressing provider errors',
        async (lang) => {
            const localized = ui[lang];
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            authMock.resetPasswordForEmail.mockRejectedValueOnce(new Error('User not found'));

            renderAuthForm(null, lang);
            fireEvent.click(screen.getByRole('button', { name: localized.auth.forgotPassword }));
            fireEvent.change(screen.getByLabelText(localized.auth.email), {
                target: { value: ' reset@example.com ' },
            });
            fireEvent.click(screen.getByRole('button', { name: localized.auth.sendResetLink }));

            await waitFor(() => expect(authMock.resetPasswordForEmail).toHaveBeenCalledTimes(1));
            expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith('reset@example.com', {
                redirectTo: `${window.location.origin}/${lang}/reset-password`,
            });
            expect(await screen.findByRole('status')).toHaveTextContent(localized.auth.success.resetEmailSent);
            expect(consoleError).not.toHaveBeenCalled();
        },
    );

    it('preserves the exact checkout return in the password-recovery redirect', async () => {
        authMock.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
        renderAuthForm(null, 'en', englishReturnTo);
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.forgotPassword }));
        fireEvent.change(screen.getByLabelText(ui.en.auth.email), {
            target: { value: 'student@example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.sendResetLink }));

        await waitFor(() => expect(authMock.resetPasswordForEmail).toHaveBeenCalledTimes(1));
        expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith('student@example.com', {
            redirectTo: `${window.location.origin}/en/reset-password?returnTo=${encodeURIComponent(englishReturnTo)}`,
        });
    });

    it('drops a same-origin return that is outside the exact checkout contract during recovery', async () => {
        authMock.resetPasswordForEmail.mockResolvedValueOnce({ data: {}, error: null });
        renderAuthForm(null, 'en', '/en?checkoutSlot=not-a-uuid#planes');
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.forgotPassword }));
        fireEvent.change(screen.getByLabelText(ui.en.auth.email), {
            target: { value: 'student@example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: ui.en.auth.sendResetLink }));

        await waitFor(() => expect(authMock.resetPasswordForEmail).toHaveBeenCalledTimes(1));
        expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith('student@example.com', {
            redirectTo: `${window.location.origin}/en/reset-password`,
        });
    });
});
