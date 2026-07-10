import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LeadCaptureForm from '../../src/components/LeadCaptureForm';
import { ui } from '../../src/i18n/translations';

vi.mock('@marsidev/react-turnstile', async () => {
    const ReactRuntime = await import('react');
    return {
        Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => ReactRuntime.createElement(
            'button',
            {
                type: 'button',
                onClick: () => onSuccess('unit-turnstile-token'),
            },
            'Complete security check',
        ),
    };
});

// Component coverage for src/components/LeadCaptureForm.tsx.
const translations = ui.es.leadCapture;

function renderLeadCaptureForm(onSuccess = vi.fn()) {
    return {
        onSuccess,
        ...render(<LeadCaptureForm lang="es" translations={translations} onSuccess={onSuccess} />),
    };
}

function fillRequiredContactFields() {
    fireEvent.change(screen.getByLabelText(translations.name), {
        target: { value: 'Future Student' },
    });
    fireEvent.change(screen.getByLabelText(translations.email), {
        target: { value: 'future.student@example.com' },
    });
}

describe('LeadCaptureForm', () => {
    beforeEach(() => {
        window.history.pushState(null, '', '/es');
        window.sessionStorage.clear();
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        window.sessionStorage.clear();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('shows the localized adult-confirmation error before accepting an application', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        renderLeadCaptureForm();
        fillRequiredContactFields();

        fireEvent.click(screen.getByRole('button', { name: translations.button }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.adultError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('blocks submission with a security error while Turnstile has not produced a token', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        renderLeadCaptureForm();
        fillRequiredContactFields();
        fireEvent.click(screen.getByLabelText(translations.adultConfirmation));
        fireEvent.click(screen.getByLabelText(new RegExp(translations.consent)));
        fireEvent.click(screen.getByRole('button', { name: translations.button }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.securityError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('applies URL preferred package data, submits full lead context and announces success', async () => {
        window.history.pushState(null, '', '/es?preferredPackage=hybrid&preferredPackageLabel=Plan%20Hybrid#contacto');
        let resolveFetch: (value: { ok: boolean; json: () => Promise<{ message: string }> }) => void = () => {};
        const pendingFetch = new Promise<{ ok: boolean; json: () => Promise<{ message: string }> }>((resolve) => {
            resolveFetch = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(pendingFetch);
        vi.stubGlobal('fetch', fetchMock);
        const onSuccess = vi.fn();

        renderLeadCaptureForm(onSuccess);

        expect(await screen.findByText((_, element) => element?.textContent === 'Plan de interes: Plan Hybrid')).toBeVisible();
        expect(window.location.search).toBe('');
        fillRequiredContactFields();
        fireEvent.change(screen.getByLabelText(translations.goal), {
            target: { value: 'Quiero vivir en Espana y hablar mejor.' },
        });
        fireEvent.change(screen.getByLabelText(translations.availability), {
            target: { value: 'Tardes entre semana.' },
        });
        fireEvent.click(screen.getByLabelText(translations.languageOptions.russian));
        fireEvent.click(screen.getByLabelText(translations.adultConfirmation));
        fireEvent.click(screen.getByLabelText(new RegExp(translations.consent)));

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Complete security check' }));
        });

        const submit = screen.getByRole('button', { name: translations.button });
        fireEvent.click(submit);

        expect(submit).toBeDisabled();
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(submit.closest('form')).toHaveAttribute('aria-busy', 'true');

        await act(async () => {
            resolveFetch({
                ok: true,
                json: async () => ({ message: 'Success' }),
            });
            await pendingFetch;
        });

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(translations.success));
        expect(onSuccess).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/subscribe', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toMatchObject({
            name: 'Future Student',
            email: 'future.student@example.com',
            preferredPackage: 'hybrid',
            preferredPackageLabel: 'Plan Hybrid',
            spokenLanguages: ['ru'],
            isRussianSpeaker: true,
            adultConfirmed: true,
            lang: 'es',
            sourcePath: '/es',
            'cf-turnstile-response': 'unit-turnstile-token',
        });
    });
});
