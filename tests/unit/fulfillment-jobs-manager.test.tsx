import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FulfillmentJobsManager from '../../src/components/admin/FulfillmentJobsManager';

const failedJob = {
    id: '70000000-0000-4000-8000-000000000001',
    job_type: 'welcome_fulfillment',
    status: 'failed',
    attempts: 2,
    max_attempts: 3,
    created_at: '2026-06-26T09:00:00.000Z',
    last_error: 'Resend timeout',
    student: { full_name: 'Test Student', email: 'student@example.test' },
    session: { scheduled_at: '2026-06-27T10:00:00.000Z', status: 'scheduled' },
};

function jsonResponse(payload: unknown, ok = true) {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    };
}

function postCalls() {
    return vi.mocked(fetch).mock.calls.filter(([, init]) => init && typeof init === 'object' && init.method === 'POST');
}

describe('FulfillmentJobsManager', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
            if (init && typeof init === 'object' && init.method === 'POST') {
                const body = JSON.parse(init.body as string);
                if (body.action === 'process_due') {
                    return jsonResponse({ result: { queued: true, limit: 20 } });
                }
                return jsonResponse({ job: failedJob });
            }

            return jsonResponse({ jobs: [failedJob] });
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('loads the recovery table without mutating jobs', async () => {
        render(<FulfillmentJobsManager />);

        expect(await screen.findByText('welcome_fulfillment')).toBeInTheDocument();
        expect(screen.getByText('Test Student')).toBeInTheDocument();
        expect(screen.getByText('Resend timeout')).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledWith(
            '/api/admin/fulfillment-jobs?status=pending&limit=100',
            expect.objectContaining({ signal: expect.any(Object) }),
        );
        expect(postCalls()).toHaveLength(0);
    });

    it('posts process_due with the expected safe admin payload', async () => {
        render(<FulfillmentJobsManager />);

        await screen.findByText('welcome_fulfillment');
        fireEvent.click(screen.getByText('Procesar pendientes'));

        await waitFor(() => expect(postCalls()).toHaveLength(1));
        const [, request] = postCalls()[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'process_due',
            limit: 20,
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Procesamiento encolado. La lista se actualizará cuando termine.');
    });

    it('posts retry and cancel with the selected job id', async () => {
        render(<FulfillmentJobsManager />);

        await screen.findByText('welcome_fulfillment');
        fireEvent.click(screen.getByText('Reintentar'));

        await waitFor(() => expect(postCalls()).toHaveLength(1));
        let [, request] = postCalls()[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'retry',
            jobId: failedJob.id,
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Job reprogramado');

        fireEvent.click(screen.getByText('Cancelar'));

        await waitFor(() => expect(postCalls()).toHaveLength(2));
        [, request] = postCalls()[1];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'cancel',
            jobId: failedJob.id,
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Job cancelado');
    });

    it('disables queue controls while a job mutation is pending', async () => {
        vi.stubGlobal('fetch', vi.fn((_input, init) => {
            if (init && typeof init === 'object' && init.method === 'POST') {
                return new Promise(() => undefined);
            }

            return Promise.resolve(jsonResponse({ jobs: [failedJob] }));
        }));
        render(<FulfillmentJobsManager />);

        await screen.findByText('welcome_fulfillment');
        fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

        expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Reintentar' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Procesar pendientes' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'pending' })).toBeDisabled();
    });

    it('announces mutation failures as alerts and re-enables controls', async () => {
        vi.stubGlobal('fetch', vi.fn((_input, init) => {
            if (init && typeof init === 'object' && init.method === 'POST') {
                return Promise.resolve(jsonResponse({ error: 'Could not process queue' }, false));
            }

            return Promise.resolve(jsonResponse({ jobs: [failedJob] }));
        }));
        render(<FulfillmentJobsManager />);

        await screen.findByText('welcome_fulfillment');
        fireEvent.click(screen.getByRole('button', { name: 'Procesar pendientes' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not process queue');
        expect(screen.getByRole('button', { name: 'Procesar pendientes' })).not.toBeDisabled();
    });

    it('keeps loading visible when an aborted status request is replaced by a pending request', async () => {
        let rejectPendingRequest: ((error: Error) => void) | null = null;
        vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
            if (String(input).includes('status=pending')) {
                init?.signal?.addEventListener('abort', () => {
                    const error = new Error('Aborted');
                    error.name = 'AbortError';
                    rejectPendingRequest?.(error);
                });
                return new Promise((_, reject) => {
                    rejectPendingRequest = reject;
                });
            }

            return new Promise(() => undefined);
        }));
        render(<FulfillmentJobsManager />);

        fireEvent.click(screen.getByRole('button', { name: 'failed' }));
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(screen.getByText('Cargando...')).toBeInTheDocument();
        expect(screen.queryByText('No hay jobs para este filtro')).not.toBeInTheDocument();
    });
});
