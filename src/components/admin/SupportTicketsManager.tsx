import React, { useCallback, useEffect, useState } from 'react';

type TicketStatus = 'open' | 'triaged' | 'closed';

type SupportTicket = {
    id: string;
    issue_type: string;
    issue_title: string;
    message: string;
    page_url: string | null;
    user_agent: string | null;
    status: TicketStatus;
    admin_notes: string | null;
    created_at: string | null;
    user?: { full_name: string | null; email: string | null; role: string | null } | null;
};

const statuses: Array<TicketStatus | 'all'> = ['open', 'triaged', 'closed', 'all'];

const statusLabels: Record<TicketStatus | 'all', string> = {
    open: 'Abiertos',
    triaged: 'Revisados',
    closed: 'Cerrados',
    all: 'Todos',
};

type WorkingAction = { ticketId: string; status: TicketStatus } | null;

type SupportTicketsResponse = {
    error?: string;
    tickets?: SupportTicket[];
};

function formatDate(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function statusClass(status: TicketStatus): string {
    switch (status) {
        case 'open': return 'bg-yellow-100 text-yellow-800';
        case 'triaged': return 'bg-blue-100 text-blue-700';
        case 'closed': return 'bg-green-100 text-green-700';
    }
}

export default function SupportTicketsManager() {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [status, setStatus] = useState<TicketStatus | 'all'>('open');
    const [isLoading, setIsLoading] = useState(true);
    const [workingAction, setWorkingAction] = useState<WorkingAction>(null);
    const [notesByTicket, setNotesByTicket] = useState<Record<string, string>>({});
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const isMutating = workingAction !== null;

    const loadTickets = useCallback(async (signal?: AbortSignal) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/admin/support-tickets?status=${status}&limit=100`, { signal });
            const data = await response.json() as SupportTicketsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los avisos');
            if (signal?.aborted) return;
            const nextTickets = data.tickets || [];
            setTickets(nextTickets);
            setNotesByTicket(Object.fromEntries(
                nextTickets.map((ticket: SupportTicket) => [ticket.id, ticket.admin_notes || ''])
            ));
        } catch (err) {
            if (signal?.aborted) return;
            setError(err instanceof Error ? err.message : 'No se pudieron cargar los avisos');
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        const controller = new AbortController();
        void loadTickets(controller.signal);
        return () => controller.abort();
    }, [loadTickets]);

    const updateTicket = async (ticketId: string, nextStatus: TicketStatus) => {
        setWorkingAction({ ticketId, status: nextStatus });
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/support-tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticketId,
                    status: nextStatus,
                    adminNotes: notesByTicket[ticketId] || undefined,
                }),
            });
            const data = await response.json() as SupportTicketsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el aviso');
            setMessage('Aviso actualizado');
            await loadTickets();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo actualizar el aviso');
        } finally {
            setWorkingAction(null);
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
                {statuses.map((item) => (
                    <button
                        type="button"
                        key={item}
                        onClick={() => setStatus(item)}
                        disabled={isLoading || isMutating}
                        aria-pressed={status === item}
                        className={`border-2 px-3 py-2 text-xs font-bold uppercase ${status === item ? 'border-[#006064] bg-[#006064] text-white' : 'border-[#006064]/40 bg-white text-[#006064]'}`}
                    >
                        {statusLabels[item]}
                    </button>
                ))}
            </div>

            {(message || error) && (
                <div
                    role={error ? 'alert' : 'status'}
                    className={`border-2 p-4 font-mono text-sm ${error ? 'border-red-500 bg-red-50 text-red-700' : 'border-green-600 bg-green-50 text-green-700'}`}
                >
                    {error || message}
                </div>
            )}

            <div
                className="overflow-x-auto border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]"
                tabIndex={0}
                aria-label="Tabla de avisos de soporte"
            >
                <table className="w-full min-w-[1040px] text-sm">
                    <thead className="bg-[#006064] text-white">
                        <tr>
                            <th className="p-3 text-left text-xs font-mono uppercase">Aviso</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Estado</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Usuario</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Mensaje</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Notas</th>
                            <th className="p-3 text-right text-xs font-mono uppercase">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#006064]/20">
                        {isLoading ? (
                            <tr><td colSpan={6} role="status" className="p-5 font-mono text-[#006064]">Cargando...</td></tr>
                        ) : tickets.length === 0 ? (
                            <tr><td colSpan={6} className="p-5 font-mono text-[#006064]">No hay avisos para este filtro</td></tr>
                        ) : tickets.map((ticket) => (
                            <tr key={ticket.id} className="bg-white align-top">
                                <td className="p-3 text-[#006064]">
                                    <div className="font-display text-lg uppercase">{ticket.issue_title}</div>
                                    <div className="font-mono text-xs">{ticket.issue_type}</div>
                                    <div className="font-mono text-xs">{formatDate(ticket.created_at)}</div>
                                    {ticket.page_url && (
                                        <a href={ticket.page_url} className="mt-2 block text-xs font-bold underline" target="_blank" rel="noreferrer">
                                            Ver pagina
                                        </a>
                                    )}
                                </td>
                                <td className="p-3">
                                    <span className={`inline-block px-2 py-1 text-xs font-bold uppercase ${statusClass(ticket.status)}`}>
                                        {ticket.status}
                                    </span>
                                </td>
                                <td className="p-3 text-[#006064]">
                                    <div className="font-bold">{ticket.user?.full_name || '-'}</div>
                                    <div className="text-xs">{ticket.user?.email || ''}</div>
                                    <div className="text-xs uppercase">{ticket.user?.role || ''}</div>
                                </td>
                                <td className="max-w-[300px] p-3 text-[#006064]">
                                    <p className="whitespace-pre-wrap leading-6">{ticket.message}</p>
                                    {ticket.user_agent && (
                                        <p className="mt-3 line-clamp-2 font-mono text-[11px] text-[#006064]/60">{ticket.user_agent}</p>
                                    )}
                                </td>
                                <td className="p-3">
                                    <label className="sr-only" htmlFor={`ticket-notes-${ticket.id}`}>Notas internas</label>
                                    <textarea
                                        id={`ticket-notes-${ticket.id}`}
                                        value={notesByTicket[ticket.id] || ''}
                                        onChange={(event) => setNotesByTicket((current) => ({ ...current, [ticket.id]: event.target.value }))}
                                        disabled={isMutating}
                                        rows={4}
                                        maxLength={2000}
                                        className="w-full min-w-[220px] border border-[#006064]/40 p-2 text-sm text-[#006064] focus:border-[#006064] focus:outline-none"
                                    />
                                </td>
                                <td className="p-3 text-right">
                                    <div className="flex flex-col items-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void updateTicket(ticket.id, 'triaged')}
                                            disabled={isMutating || ticket.status === 'triaged'}
                                            aria-busy={workingAction?.ticketId === ticket.id && workingAction.status === 'triaged'}
                                            className="border border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                        >
                                            Revisado
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void updateTicket(ticket.id, 'closed')}
                                            disabled={isMutating || ticket.status === 'closed'}
                                            aria-busy={workingAction?.ticketId === ticket.id && workingAction.status === 'closed'}
                                            className="border border-green-700 px-3 py-2 text-xs font-bold uppercase text-green-800 disabled:opacity-50"
                                        >
                                            Cerrar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void updateTicket(ticket.id, 'open')}
                                            disabled={isMutating || ticket.status === 'open'}
                                            aria-busy={workingAction?.ticketId === ticket.id && workingAction.status === 'open'}
                                            className="border border-yellow-700 px-3 py-2 text-xs font-bold uppercase text-yellow-800 disabled:opacity-50"
                                        >
                                            Reabrir
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
