import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function jsonResponse(payload: unknown) {
    return {
        ok: true,
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
                    return jsonResponse({ result: { processed: 2, succeeded: 1, failed: 1 } });
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
        expect(fetch).toHaveBeenCalledWith('/api/admin/fulfillment-jobs?status=pending&limit=100');
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
        expect(await screen.findByText('Procesados: 2, correctos: 1, fallidos: 1')).toBeInTheDocument();
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

        fireEvent.click(screen.getByText('Cancelar'));

        await waitFor(() => expect(postCalls()).toHaveLength(2));
        [, request] = postCalls()[1];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'cancel',
            jobId: failedJob.id,
        });
    });
});
