import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupportTicketsManager from '../../src/components/admin/SupportTicketsManager';

const admin = { id: '70000000-0000-4000-8000-000000000010', full_name: 'Admin One', email: 'admin@test.invalid' };
const ticket = {
    id: '70000000-0000-4000-8000-000000000001', issue_type: 'bug', issue_title: 'Login roto',
    message: 'No puedo entrar al campus', page_url: null, status: 'open', priority: 'normal',
    assigned_admin_id: null, created_at: '2026-06-24T10:00:00.000Z', updated_at: '2026-06-24T10:00:00.000Z',
    user: { full_name: 'Marta Garcia', email: 'marta@example.com', role: 'student' },
};

function response(payload: unknown, ok = true) {
    return { ok, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

function listPayload(tickets: Record<string, unknown>[] = [ticket]) {
    return { tickets, admins: [admin], pagination: { page: 1, pageSize: 25, total: tickets.length, totalPages: tickets.length ? 1 : 0 } };
}

describe('SupportTicketsManager', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('loads a server-paginated queue with status, priority and assignee controls', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(listPayload()));
        vi.stubGlobal('fetch', fetchMock);
        render(<SupportTicketsManager />);

        expect(await screen.findByText('Login roto')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/admin/support-tickets?status=open&priority=all&assignee=all&page=1&pageSize=25',
            { signal: expect.any(AbortSignal) },
        );
        expect(screen.getByLabelText('Filtrar por estado')).toHaveValue('open');
        expect(screen.getByLabelText('Filtrar por prioridad')).toHaveValue('all');
        expect(screen.getByLabelText('Filtrar por responsable')).toHaveValue('all');
        expect(screen.getByLabelText('Responsable Login roto')).toHaveTextContent('Admin One');
        expect(screen.getByRole('button', { name: 'Ver historial' })).toBeInTheDocument();
    });

    it('loads bounded history only when requested and pages with the sequence cursor', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(listPayload()))
            .mockResolvedValueOnce(response({
                events: [{ id: 'event-3', sequence: 3, event_type: 'public_reply', visibility: 'public', body: 'Respuesta reciente', created_at: '2026-06-24T10:03:00.000Z' }],
                hasMore: true,
                nextBeforeSequence: 3,
            }))
            .mockResolvedValueOnce(response({
                events: [{ id: 'event-1', sequence: 1, event_type: 'created', visibility: 'public', body: 'No puedo entrar al campus', created_at: '2026-06-24T10:00:00.000Z' }],
                hasMore: false,
                nextBeforeSequence: null,
            }));
        vi.stubGlobal('fetch', fetchMock);
        render(<SupportTicketsManager />);
        await screen.findByText('Login roto');

        fireEvent.click(screen.getByRole('button', { name: 'Ver historial' }));
        expect(await screen.findByText('Respuesta reciente')).toBeInTheDocument();
        expect(fetchMock.mock.calls[1][0]).toBe(`/api/admin/support-tickets?ticketId=${ticket.id}&eventLimit=20`);

        fireEvent.click(screen.getByRole('button', { name: 'Cargar mas historial' }));
        expect(await screen.findByText('No puedo entrar al campus')).toBeInTheDocument();
        expect(fetchMock.mock.calls[2][0]).toBe(`/api/admin/support-tickets?ticketId=${ticket.id}&eventLimit=20&beforeSequence=3`);
        expect(screen.queryByRole('button', { name: 'Cargar mas historial' })).not.toBeInTheDocument();
    });

    it('reloads from page one when a server-side filter changes', async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(response(listPayload())).mockResolvedValueOnce(response(listPayload([])));
        vi.stubGlobal('fetch', fetchMock);
        render(<SupportTicketsManager />);
        await screen.findByText('Login roto');

        fireEvent.change(screen.getByLabelText('Filtrar por prioridad'), { target: { value: 'urgent' } });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/support-tickets?status=open&priority=urgent&assignee=all&page=1&pageSize=25');
        expect(await screen.findByText('No hay tickets para este filtro')).toBeInTheDocument();
    });

    it('submits assignment, priority, state and a public response with a request id', async () => {
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('70000000-0000-4000-8000-000000000099');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(listPayload()))
            .mockResolvedValueOnce(response({ ticket: { ...ticket, status: 'closed' }, notificationRisk: null }))
            .mockResolvedValueOnce(response(listPayload([{ ...ticket, status: 'closed', priority: 'high', assigned_admin_id: admin.id }])));
        vi.stubGlobal('fetch', fetchMock);
        render(<SupportTicketsManager />);
        await screen.findByText('Login roto');

        fireEvent.change(screen.getByLabelText('Estado Login roto'), { target: { value: 'closed' } });
        fireEvent.change(screen.getByLabelText('Prioridad Login roto'), { target: { value: 'high' } });
        fireEvent.change(screen.getByLabelText('Responsable Login roto'), { target: { value: admin.id } });
        fireEvent.change(screen.getByLabelText('Tipo de mensaje Login roto'), { target: { value: 'public_reply' } });
        fireEvent.change(screen.getByLabelText('Mensaje Login roto'), { target: { value: 'Ya esta resuelto.' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        const payload = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
        expect(payload).toEqual({
            requestId: '70000000-0000-4000-8000-000000000099', ticketId: ticket.id,
            expectedStatus: 'open', expectedUpdatedAt: ticket.updated_at,
            status: 'closed', priority: 'high', assignmentIsSet: true,
            assignedAdminId: admin.id, messageKind: 'public_reply', message: 'Ya esta resuelto.',
        });
        expect(screen.getByText('Ticket actualizado')).toBeInTheDocument();
    });

    it('retains the request id after an ambiguous failure so retry cannot duplicate notification', async () => {
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('70000000-0000-4000-8000-000000000098');
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(listPayload()))
            .mockResolvedValueOnce(response({ error: 'network outcome unknown' }, false))
            .mockResolvedValueOnce(response({ ticket, replayed: true }))
            .mockResolvedValueOnce(response(listPayload()));
        vi.stubGlobal('fetch', fetchMock);
        render(<SupportTicketsManager />);
        await screen.findByText('Login roto');
        fireEvent.change(screen.getByLabelText('Mensaje Login roto'), { target: { value: 'Solo interna' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

        const first = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
        const retry = JSON.parse(fetchMock.mock.calls[2][1]?.body as string);
        expect(retry.requestId).toBe(first.requestId);
    });
});
