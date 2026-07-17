import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportTicketsManager from '../../src/components/admin/SupportTicketsManager';

const ticket = {
    id: '70000000-0000-4000-8000-000000000001',
    issue_type: 'bug',
    issue_title: 'Login roto',
    message: 'No puedo entrar al campus',
    page_url: 'https://example.com/es/campus',
    user_agent: 'Mozilla/5.0 test agent',
    status: 'open',
    admin_notes: 'Pendiente',
    created_at: '2026-06-24T10:00:00.000Z',
    user: { full_name: 'Marta Garcia', email: 'marta@example.com', role: 'student' },
};

const secondTicket = {
    ...ticket,
    id: '70000000-0000-4000-8000-000000000002',
    issue_title: 'Pago pendiente',
    status: 'triaged',
    admin_notes: '',
};

function jsonResponse(payload: unknown, ok = true) {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

describe('SupportTicketsManager', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('loads open support tickets with accessible filters and notes', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tickets: [ticket] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<SupportTicketsManager />);

        expect(await screen.findByText('Login roto')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith('/api/admin/support-tickets?status=open&limit=100', {
            signal: expect.any(AbortSignal),
        });
        expect(screen.getByRole('button', { name: 'Abiertos' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByLabelText('Notas internas')).toHaveValue('Pendiente');
    });

    it('reloads tickets when the status filter changes', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ tickets: [ticket] }))
            .mockResolvedValueOnce(jsonResponse({ tickets: [] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<SupportTicketsManager />);
        expect(await screen.findByText('Login roto')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Todos' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/support-tickets?status=all&limit=100', {
            signal: expect.any(AbortSignal),
        });
        expect(await screen.findByText('No hay avisos para este filtro')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('updates a ticket with internal notes and reloads the list', async () => {
        const closedTicket = { ...ticket, status: 'closed', admin_notes: 'Revisado por admin' };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ tickets: [ticket] }))
            .mockResolvedValueOnce(jsonResponse({ ticket: closedTicket }))
            .mockResolvedValueOnce(jsonResponse({ tickets: [closedTicket] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<SupportTicketsManager />);
        expect(await screen.findByText('Login roto')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Notas internas'), {
            target: { value: 'Revisado por admin' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/support-tickets');
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
            ticketId: ticket.id,
            status: 'closed',
            adminNotes: 'Revisado por admin',
        });
        expect(screen.getByText('Aviso actualizado')).toBeInTheDocument();
    });

    it('locks filters, notes and ticket actions while an update is in flight', async () => {
        let resolvePost!: (value: Response) => void;
        const pendingPost = new Promise<Response>((resolve) => {
            resolvePost = resolve;
        });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ tickets: [ticket, secondTicket] }))
            .mockReturnValueOnce(pendingPost)
            .mockResolvedValueOnce(jsonResponse({ tickets: [{ ...ticket, status: 'closed' }, secondTicket] }));
        vi.stubGlobal('fetch', fetchMock);

        render(<SupportTicketsManager />);
        expect(await screen.findByText('Login roto')).toBeInTheDocument();

        const closeButtons = screen.getAllByRole('button', { name: 'Cerrar' });
        fireEvent.click(closeButtons[0]);

        expect(screen.getByRole('button', { name: 'Abiertos' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Todos' })).toBeDisabled();
        for (const notesField of screen.getAllByLabelText('Notas internas')) {
            expect(notesField).toBeDisabled();
        }
        expect(closeButtons[0]).toBeDisabled();
        expect(closeButtons[0]).toHaveAttribute('aria-busy', 'true');
        expect(closeButtons[1]).toBeDisabled();
        expect(closeButtons[1]).toHaveAttribute('aria-busy', 'false');

        resolvePost(jsonResponse({ ticket: { ...ticket, status: 'closed' } }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    });

    it('announces load failures as alerts', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'No autorizado' }, false)));

        render(<SupportTicketsManager />);

        expect(await screen.findByRole('alert')).toHaveTextContent('No autorizado');
    });
});
