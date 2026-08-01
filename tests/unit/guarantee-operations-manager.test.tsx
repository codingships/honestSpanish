import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GuaranteeOperationsManager from '../../src/components/admin/GuaranteeOperationsManager';

const operation = {
    id: '10000000-0000-4000-8000-000000000001',
    subscriptionId: '20000000-0000-4000-8000-000000000002',
    student: { id: '30000000-0000-4000-8000-000000000003', fullName: 'Ana Alumna', email: 'ana@example.com' },
    status: 'retryable',
    grossCents: 25900,
    guaranteeRefundCents: 19425,
    refundedCents: 0,
    netCents: 25900,
    currency: 'eur',
    payment: { id: '40000000-0000-4000-8000-000000000004', status: 'succeeded' },
    stripeRefundId: null,
    stripeRefundStatus: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:05:00.000Z',
    refundCreatedAt: null,
    refundedAt: null,
    supportTicket: null,
    lastError: 'refund_preflight_temporarily_unavailable',
} as const;

const incident = {
    sessionId: '50000000-0000-4000-8000-000000000005',
    subscriptionId: operation.subscriptionId,
    student: operation.student,
    originalStatus: 'no_show',
    scheduledAt: '2026-08-01T11:00:00.000Z',
    incidentAt: '2026-08-01T11:15:00.000Z',
    canExcuse: true,
    resolution: null,
};

function jsonResponse(payload: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    }));
}

describe('GuaranteeOperationsManager', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('shows the exact financial breakdown and operational Stripe state in an accessible table', async () => {
        vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ operations: [operation], incidents: [] })));

        render(<GuaranteeOperationsManager lang="es" />);

        expect(await screen.findByText('Ana Alumna')).toBeInTheDocument();
        expect(screen.getByRole('table', { name: 'Operaciones de devolución de la garantía' })).toBeInTheDocument();
        expect(screen.getByText(/Bruto:/)).toHaveTextContent('259,00');
        expect(screen.getByText(/Garantía:/)).toHaveTextContent('194,25');
        expect(screen.getByText(/Devuelto:/)).toHaveTextContent('0,00');
        expect(screen.getByText(/Neto:/)).toHaveTextContent('259,00');
        expect(screen.getByText('Sin refund ID')).toBeInTheDocument();
        expect(screen.getByText('refund_preflight_temporarily_unavailable')).toBeInTheDocument();
    });

    it('resumes only the same immutable operation id and then reloads the list', async () => {
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => jsonResponse({ operations: [operation], incidents: [] }))
            .mockImplementationOnce(() => jsonResponse({ guarantee: { status: 'processing' } }, 202))
            .mockImplementationOnce(() => jsonResponse({ operations: [{ ...operation, status: 'processing' }], incidents: [] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<GuaranteeOperationsManager lang="es" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Reintentar misma operación' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            action: 'resume',
            operationId: operation.id,
        });
        expect(screen.getByRole('status')).toHaveTextContent('La misma operación se ha reconciliado');
    });

    it('requires a reason and sends only the exact incident RPC inputs exposed by the API', async () => {
        const resolvedIncident = {
            ...incident,
            canExcuse: false,
            resolution: {
                id: '60000000-0000-4000-8000-000000000006',
                admin_id: '70000000-0000-4000-8000-000000000007',
                original_status: 'no_show',
                incident_at: incident.incidentAt,
                reason: 'Incidencia verificada con el alumno.',
                created_at: '2026-08-01T12:00:00.000Z',
            },
        };
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => jsonResponse({ operations: [], incidents: [incident] }))
            .mockImplementationOnce(() => jsonResponse({ resolution: resolvedIncident.resolution }))
            .mockImplementationOnce(() => jsonResponse({ operations: [], incidents: [resolvedIncident] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<GuaranteeOperationsManager lang="es" />);

        const textarea = await screen.findByLabelText('Motivo obligatorio de la reclasificación');
        const submit = screen.getByRole('button', { name: 'Registrar reclasificación' });
        expect(submit).toBeDisabled();
        fireEvent.change(textarea, { target: { value: 'Incidencia verificada con el alumno.' } });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            action: 'excuse_incident',
            sessionId: incident.sessionId,
            reason: 'Incidencia verificada con el alumno.',
        });
        expect(await screen.findByText('Incidencia reclasificada')).toBeInTheDocument();
    });

    it('offers only read-only reconciliation when manual review has an existing refund id', async () => {
        const reviewed = {
            ...operation,
            status: 'manual_review',
            stripeRefundId: 're_existing',
            stripeRefundStatus: 'pending',
            supportTicket: { id: '80000000-0000-4000-8000-000000000008', status: 'open', title: 'Garantía en revisión' },
        };
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => jsonResponse({ operations: [reviewed], incidents: [] }))
            .mockImplementationOnce(() => jsonResponse({ guarantee: { status: 'refund_pending' } }, 202))
            .mockImplementationOnce(() => jsonResponse({ operations: [reviewed], incidents: [] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<GuaranteeOperationsManager lang="en" />);
        fireEvent.click(await screen.findByRole('button', { name: 'Reconciliar refund existente' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            action: 'reconcile_refund',
            operationId: operation.id,
        });
        expect(screen.queryByRole('button', { name: /Liberar revisión|Reintentar misma/ })).toBeNull();
    });

    it('does not retry failed or canceled refunds and states the required decision', async () => {
        vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
            operations: [{
                ...operation,
                status: 'manual_review',
                stripeRefundId: 're_failed',
                stripeRefundStatus: 'failed',
            }],
            incidents: [],
        })));

        render(<GuaranteeOperationsManager lang="es" />);

        expect(await screen.findByText(/No se reintenta: soporte debe resolverlo/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Reconciliar refund|Liberar revisión|Reintentar/ })).toBeNull();
    });

    it('releases review only with a closed ticket and mandatory audited reason', async () => {
        const reviewed = {
            ...operation,
            status: 'manual_review',
            supportTicket: { id: '80000000-0000-4000-8000-000000000008', status: 'closed', title: 'Garantía revisada' },
        };
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => jsonResponse({ operations: [reviewed], incidents: [] }))
            .mockImplementationOnce(() => jsonResponse({ guarantee: { status: 'processing' } }, 202))
            .mockImplementationOnce(() => jsonResponse({ operations: [{ ...reviewed, status: 'processing' }], incidents: [] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<GuaranteeOperationsManager lang="es" />);
        const reason = await screen.findByLabelText('Motivo obligatorio para liberar la revisión');
        const submit = screen.getByRole('button', { name: 'Liberar revisión y reintentar' });
        expect(submit).toBeDisabled();
        fireEvent.change(reason, { target: { value: 'Ticket resuelto y decisión documentada.' } });
        fireEvent.click(submit);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            action: 'resolve_review',
            operationId: operation.id,
            reason: 'Ticket resuelto y decisión documentada.',
        });
    });

    it('requires the support ticket to be closed before releasing a review without refund', async () => {
        vi.stubGlobal('fetch', vi.fn(() => jsonResponse({
            operations: [{
                ...operation,
                status: 'manual_review',
                supportTicket: { id: '80000000-0000-4000-8000-000000000008', status: 'open', title: 'Garantía en revisión' },
            }],
            incidents: [],
        })));

        render(<GuaranteeOperationsManager lang="en" />);

        expect(await screen.findByText(/Cierra primero el ticket de soporte/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Liberar revisión|Reconciliar refund|Reintentar/ })).toBeNull();
        expect(screen.getByRole('link', { name: /Ticket/ })).toHaveAttribute('href', '/en/campus/admin/support');
    });
});
