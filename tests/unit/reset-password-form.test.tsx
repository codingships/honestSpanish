import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordForm from '../../src/components/ResetPasswordForm.jsx';
import { ui } from '../../src/i18n/translations';

const authMock = vi.hoisted(() => ({
    onAuthStateChange: vi.fn(),
    getSession: vi.fn(),
    updateUser: vi.fn(),
    unsubscribe: vi.fn(),
}));

vi.mock('../../src/lib/supabase', () => ({
    supabase: {
        auth: authMock,
    },
}));

const translations = ui.es;
let authListener: ((event: string, session: unknown) => void) | undefined;

const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
};

function mockAuthState(session: unknown) {
    authMock.onAuthStateChange.mockImplementation((callback) => {
        authListener = callback;
        return {
            data: {
                subscription: {
                    unsubscribe: authMock.unsubscribe,
                },
            },
        };
    });
    authMock.getSession.mockResolvedValue({
        data: { session },
        error: null,
    });
}

function renderResetPasswordForm() {
    return render(<ResetPasswordForm lang="es" translations={translations} />);
}

describe('ResetPasswordForm', () => {
    beforeEach(() => {
        authListener = undefined;
        authMock.updateUser.mockResolvedValue({ error: null });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('shows a recovery path for invalid links and unlocks when Supabase emits password recovery', async () => {
        mockAuthState(null);

        renderResetPasswordForm();

        expect(screen.getByRole('status')).toHaveTextContent('Verificando enlace');
        const submit = screen.getByRole('button', { name: translations.auth.resetPassword });
        expect(submit).toBeDisabled();
        expect(screen.getByLabelText(translations.auth.newPassword)).toBeDisabled();

        expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace no es valido o ha caducado');
        expect(screen.getByRole('link', { name: translations.auth.login })).toHaveAttribute('href', '/es/login');

        act(() => {
            authListener?.('PASSWORD_RECOVERY', { user: { id: 'user-1' } });
        });

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(submit).toBeEnabled();
        expect(screen.getByLabelText(translations.auth.newPassword)).toBeEnabled();
    });

    it('labels password fields and validates length and confirmation before updating Supabase', async () => {
        mockAuthState({ user: { id: 'user-1' } });
        renderResetPasswordForm();

        const newPassword = screen.getByLabelText(translations.auth.newPassword);
        const confirmPassword = screen.getByLabelText(translations.auth.confirmNewPassword);
        const submit = screen.getByRole('button', { name: translations.auth.resetPassword });

        await waitFor(() => expect(submit).toBeEnabled());
        expect(newPassword).toHaveAttribute('name', 'newPassword');
        expect(newPassword).toHaveAttribute('autocomplete', 'new-password');
        expect(confirmPassword).toHaveAttribute('name', 'confirmPassword');

        fireEvent.change(newPassword, { target: { value: 'abc' } });
        fireEvent.change(confirmPassword, { target: { value: 'abc' } });
        fireEvent.click(submit);

        expect(screen.getByRole('alert')).toHaveTextContent(translations.auth.passwordTooShort);
        expect(authMock.updateUser).not.toHaveBeenCalled();

        fireEvent.change(newPassword, { target: { value: 'abcdef' } });
        fireEvent.change(confirmPassword, { target: { value: 'abcdefg' } });
        fireEvent.click(submit);

        expect(screen.getByRole('alert')).toHaveTextContent(translations.auth.passwordsDoNotMatch);
        expect(authMock.updateUser).not.toHaveBeenCalled();
    });

    it('locks the form while updating the password and announces success', async () => {
        mockAuthState({ user: { id: 'user-1' } });
        const pendingUpdate = deferred<{ error: null }>();
        authMock.updateUser.mockReturnValueOnce(pendingUpdate.promise);
        renderResetPasswordForm();

        const newPassword = screen.getByLabelText(translations.auth.newPassword);
        const confirmPassword = screen.getByLabelText(translations.auth.confirmNewPassword);
        const submit = screen.getByRole('button', { name: translations.auth.resetPassword });
        await waitFor(() => expect(submit).toBeEnabled());

        fireEvent.change(newPassword, { target: { value: 'secret123' } });
        fireEvent.change(confirmPassword, { target: { value: 'secret123' } });
        fireEvent.click(submit);

        await waitFor(() => expect(authMock.updateUser).toHaveBeenCalledWith({ password: 'secret123' }));
        expect(screen.getByRole('form', { name: translations.auth.resetPassword })).toHaveAttribute('aria-busy', 'true');
        expect(newPassword).toBeDisabled();
        expect(confirmPassword).toBeDisabled();
        expect(screen.getByRole('button', { name: '...' })).toHaveAttribute('aria-busy', 'true');

        await act(async () => {
            pendingUpdate.resolve({ error: null });
        });

        expect(await screen.findByRole('status')).toHaveTextContent(translations.auth.success.passwordChanged);
        expect(screen.getByRole('link', { name: translations.auth.login })).toHaveAttribute('href', '/es/login');
    });
});
