import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportTicketQuickActions from '../../src/components/admin/SupportTicketQuickActions';

describe('SupportTicketQuickActions', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ ticket: { id: 'ticket-1', status: 'triaged' } }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('marks an open support ticket as triaged from the dashboard', async () => {
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000001" status="open" updatedAt="2026-08-02T05:00:00.000Z" />);

        expect(screen.getByLabelText('Estado del ticket: Abierto')).toHaveTextContent('Abierto');
        fireEvent.click(screen.getByText('Revisar'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            requestId: expect.any(String),
            ticketId: '70000000-0000-4000-8000-000000000001',
            expectedStatus: 'open',
            expectedUpdatedAt: '2026-08-02T05:00:00.000Z',
            status: 'triaged',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Ticket revisado');
        expect(screen.getByLabelText('Estado del ticket: Revisado')).toHaveTextContent('Revisado');
    });

    it('can reopen a closed support ticket', async () => {
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000002" status="closed" updatedAt="2026-08-02T05:00:00.000Z" />);

        expect(screen.getByLabelText('Estado del ticket: Cerrado')).toHaveTextContent('Cerrado');
        fireEvent.click(screen.getByText('Reabrir'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            requestId: expect.any(String),
            ticketId: '70000000-0000-4000-8000-000000000002',
            expectedStatus: 'closed',
            expectedUpdatedAt: '2026-08-02T05:00:00.000Z',
            status: 'open',
        });
        expect(await screen.findByRole('status')).toHaveTextContent('Ticket abierto');
        expect(screen.getByLabelText('Estado del ticket: Abierto')).toHaveTextContent('Abierto');
    });

    it('normalizes unknown or missing statuses to open actions', () => {
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000003" status={null} updatedAt="2026-08-02T05:00:00.000Z" />);

        expect(screen.getByLabelText('Estado del ticket: Abierto')).toHaveTextContent('Abierto');
        expect(screen.getByRole('button', { name: 'Revisar' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Cerrar' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Reabrir' })).not.toBeInTheDocument();
    });

    it('locks quick actions while a ticket update is in flight', async () => {
        let resolveFetch!: (value: Response) => void;
        vi.mocked(fetch).mockReturnValueOnce(new Promise((resolve) => {
            resolveFetch = resolve;
        }) as Promise<Response>);
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000004" status="open" updatedAt="2026-08-02T05:00:00.000Z" />);

        fireEvent.click(screen.getByText('Cerrar'));

        const closeButton = screen.getByRole('button', { name: 'Cerrando...' });
        const triageButton = screen.getByRole('button', { name: 'Revisar' });
        expect(closeButton).toBeDisabled();
        expect(closeButton).toHaveAttribute('aria-busy', 'true');
        expect(triageButton).toBeDisabled();
        expect(triageButton).toHaveAttribute('aria-busy', 'false');

        resolveFetch({
            ok: true,
            json: vi.fn().mockResolvedValue({ ticket: { id: 'ticket-1', status: 'closed' } }),
        } as unknown as Response);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Reabrir' })).toBeEnabled());
    });

    it('announces API errors as alerts and keeps the current status unchanged', async () => {
        vi.mocked(fetch).mockResolvedValueOnce({
            ok: false,
            json: vi.fn().mockResolvedValue({ error: 'Ticket bloqueado' }),
        } as unknown as Response);
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000005" status="open" updatedAt="2026-08-02T05:00:00.000Z" />);

        fireEvent.click(screen.getByText('Cerrar'));

        expect(await screen.findByRole('alert')).toHaveTextContent('Ticket bloqueado');
        expect(screen.getByLabelText('Estado del ticket: Abierto')).toHaveTextContent('Abierto');
    });
});
