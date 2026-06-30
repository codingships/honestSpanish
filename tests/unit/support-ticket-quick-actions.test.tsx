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
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000001" status="open" />);

        fireEvent.click(screen.getByText('Revisar'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            ticketId: '70000000-0000-4000-8000-000000000001',
            status: 'triaged',
        });
        expect(await screen.findByText('Ticket revisado')).toBeInTheDocument();
    });

    it('can reopen a closed support ticket', async () => {
        render(<SupportTicketQuickActions ticketId="70000000-0000-4000-8000-000000000002" status="closed" />);

        fireEvent.click(screen.getByText('Reabrir'));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(JSON.parse(request?.body as string)).toEqual({
            ticketId: '70000000-0000-4000-8000-000000000002',
            status: 'open',
        });
        expect(await screen.findByText('Ticket abierto')).toBeInTheDocument();
    });
});
