import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EmailTemplateManager from '../../src/components/admin/EmailTemplateManager';

function jsonResponse(payload: unknown, ok = true) {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    };
}

function requestBody(index: number) {
    const [, request] = vi.mocked(fetch).mock.calls[index];
    return JSON.parse(request?.body as string);
}

async function flushEffects() {
    await act(async () => {});
}

// Component coverage for src/components/admin/EmailTemplateManager.tsx.
describe('EmailTemplateManager', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('loads the selected preview and sends a trimmed test email with status feedback', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                type: 'welcome',
                subject: 'Bienvenida',
                html: '<p>Hola</p>',
            }))
            .mockResolvedValueOnce(jsonResponse({
                message: 'Email enviado',
            })));

        render(<EmailTemplateManager adminEmail="admin@example.com" />);

        expect(await screen.findByTitle('Email preview')).toHaveAttribute('srcdoc', '<p>Hola</p>');
        expect(screen.getByText('Bienvenida')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Destinatario prueba'), {
            target: { value: '  qa@example.com  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }));
        await flushEffects();

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(requestBody(1)).toEqual({
            type: 'welcome',
            email: 'qa@example.com',
        });
        expect(screen.getByRole('status')).toHaveTextContent('Email enviado');
    });

    it('keeps the send button disabled for blank recipient input', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            type: 'welcome',
            subject: 'Bienvenida',
            html: '<p>Hola</p>',
        })));

        render(<EmailTemplateManager adminEmail="admin@example.com" />);
        expect(await screen.findByTitle('Email preview')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Destinatario prueba'), {
            target: { value: '   ' },
        });

        expect(screen.getByRole('button', { name: 'Enviar prueba' })).toBeDisabled();
    });

    it('announces preview loading failures as alerts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            error: 'No se pudo cargar la plantilla',
        }, false)));

        render(<EmailTemplateManager adminEmail="admin@example.com" />);
        await flushEffects();

        expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la plantilla');
        expect(screen.getByText('No hay preview disponible')).toBeInTheDocument();
    });

    it('keeps loading visible when an aborted preview request is replaced by a pending request', async () => {
        let abortFirstRequest: ((error: Error) => void) | null = null;
        vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
            if (String(url).includes('type=welcome')) {
                init?.signal?.addEventListener('abort', () => {
                    const error = new Error('Aborted');
                    error.name = 'AbortError';
                    abortFirstRequest?.(error);
                });
                return new Promise((_, reject) => {
                    abortFirstRequest = reject;
                });
            }

            return new Promise(() => undefined);
        }));

        render(<EmailTemplateManager adminEmail="admin@example.com" />);
        fireEvent.change(screen.getByLabelText('Tipo'), {
            target: { value: 'reminder' },
        });
        await flushEffects();

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Cargando...')).toBeInTheDocument();
        expect(screen.queryByText('No hay preview disponible')).not.toBeInTheDocument();
    });

    it('announces send failures as alerts without clearing the recipient', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                type: 'welcome',
                subject: 'Bienvenida',
                html: '<p>Hola</p>',
            }))
            .mockResolvedValueOnce(jsonResponse({
                error: 'Resend is not configured',
            }, false)));

        render(<EmailTemplateManager adminEmail="admin@example.com" />);
        expect(await screen.findByTitle('Email preview')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Destinatario prueba'), {
            target: { value: 'ops@example.com' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar prueba' }));
        await flushEffects();

        expect(screen.getByRole('alert')).toHaveTextContent('Resend is not configured');
        expect(screen.getByLabelText('Destinatario prueba')).toHaveValue('ops@example.com');
    });
});
