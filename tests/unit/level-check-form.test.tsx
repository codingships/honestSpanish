import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LevelCheckForm from '../../src/components/LevelCheckForm';
import { ui } from '../../src/i18n/translations';

vi.mock('@marsidev/react-turnstile', async () => {
    const ReactRuntime = await import('react');
    return {
        Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => ReactRuntime.createElement(
            'button',
            {
                type: 'button',
                onClick: () => onSuccess('unit-level-token'),
            },
            'Complete level security check',
        ),
    };
});

// Component coverage for src/components/LevelCheckForm.tsx.
const translations = ui.es.levelCheck.form;

function renderLevelCheckForm() {
    return render(<LevelCheckForm lang="es" translations={translations} />);
}

function fillRequiredDiagnosticFields() {
    fireEvent.change(screen.getByLabelText(translations.email), {
        target: { value: 'diagnostic@example.com' },
    });
    fireEvent.change(screen.getByLabelText(translations.writtenSample), {
        target: {
            value: 'Necesito hablar espanol con mas seguridad en reuniones y conversaciones reales.',
        },
    });
}

function consentCheckbox() {
    return document.querySelector('input[name="consent"]') as HTMLInputElement;
}

describe('LevelCheckForm', () => {
    beforeEach(() => {
        window.history.pushState(null, '', '/es/diagnostico?email=prefilled@example.com&utm_source=organic');
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('prefills email from the diagnostic URL and requires adult confirmation', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        renderLevelCheckForm();

        expect(screen.getByLabelText(translations.email)).toHaveValue('prefilled@example.com');
        fireEvent.change(screen.getByLabelText(translations.writtenSample), {
            target: {
                value: 'Necesito hablar espanol con mas seguridad en reuniones y conversaciones reales.',
            },
        });
        fireEvent.click(screen.getByRole('button', { name: translations.button }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.adultError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resolves signed fragment links without putting the email in the URL', async () => {
        const leadId = '00000000-0000-4000-8000-000000000001';
        window.history.pushState(null, '', `/es/diagnostico#leadId=${leadId}&token=signed-level-token`);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ email: 'linked.student@example.com' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        renderLevelCheckForm();

        await waitFor(() => expect(screen.getByLabelText(translations.email)).toHaveValue('linked.student@example.com'));
        expect(screen.getByLabelText(translations.email)).toHaveAttribute('readonly');
        expect(window.location.href).not.toContain('linked.student%40example.com');
        expect(fetchMock).toHaveBeenCalledWith('/api/level-check-prefill', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ leadId, token: 'signed-level-token' }),
        }));
    });

    it('requires diagnostic consent after adult confirmation is satisfied', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        renderLevelCheckForm();
        fillRequiredDiagnosticFields();
        fireEvent.click(document.querySelector('input[name="adultConfirmed"]') as HTMLInputElement);
        fireEvent.click(screen.getByRole('button', { name: translations.button }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.consentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('blocks submission with a security error when consent is checked but Turnstile is pending', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        renderLevelCheckForm();
        fillRequiredDiagnosticFields();
        fireEvent.click(document.querySelector('input[name="adultConfirmed"]') as HTMLInputElement);
        fireEvent.click(consentCheckbox());
        fireEvent.click(screen.getByRole('button', { name: translations.button }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.securityError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('submits diagnostic context with busy semantics and announces success', async () => {
        let resolveFetch: (value: { ok: boolean; json: () => Promise<{ message: string }> }) => void = () => {};
        const pendingFetch = new Promise<{ ok: boolean; json: () => Promise<{ message: string }> }>((resolve) => {
            resolveFetch = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(pendingFetch);
        vi.stubGlobal('fetch', fetchMock);

        renderLevelCheckForm();
        fillRequiredDiagnosticFields();
        fireEvent.change(screen.getByLabelText(translations.level), { target: { value: 'b1' } });
        fireEvent.change(screen.getByLabelText(translations.comprehension), { target: { value: 'depends_context' } });
        fireEvent.change(screen.getByLabelText(translations.blocker), { target: { value: 'culture' } });
        fireEvent.change(screen.getByLabelText(translations.useContext), {
            target: { value: 'Trabajo, vida diaria y tramites.' },
        });
        fireEvent.click(document.querySelector('input[name="canSendAudioLater"]') as HTMLInputElement);
        fireEvent.click(document.querySelector('input[name="adultConfirmed"]') as HTMLInputElement);
        fireEvent.click(consentCheckbox());

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Complete level security check' }));
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
        expect(fetchMock).toHaveBeenCalledWith('/api/level-check', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const request = fetchMock.mock.calls[0][1] as RequestInit;
        expect(JSON.parse(request.body as string)).toMatchObject({
            email: 'diagnostic@example.com',
            currentLevel: 'b1',
            comprehensionComfort: 'depends_context',
            speakingBlocker: 'culture',
            useContext: 'Trabajo, vida diaria y tramites.',
            canSendAudioLater: true,
            adultConfirmed: true,
            consent: true,
            lang: 'es',
            sourcePath: '/es/diagnostico',
            attribution: expect.objectContaining({
                landingPath: '/es/diagnostico',
                entryLanguage: 'es',
                utmSource: 'organic',
            }),
            'cf-turnstile-response': 'unit-level-token',
        });
    });
});
