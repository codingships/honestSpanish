import React, { useCallback, useEffect, useRef, useState } from 'react';

type TicketStatus = 'open' | 'triaged' | 'closed';
type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
type MessageKind = 'internal_note' | 'public_reply';

type Admin = { id: string; full_name: string | null; email: string | null };
type SupportEvent = {
    id: string;
    sequence: number;
    event_type: 'created' | 'internal_note' | 'public_reply' | 'admin_update';
    visibility: 'internal' | 'public';
    body: string | null;
    created_at: string;
};
type SupportTicket = {
    id: string;
    issue_type: string;
    issue_title: string;
    message: string;
    page_url: string | null;
    status: TicketStatus;
    priority: TicketPriority;
    assigned_admin_id: string | null;
    created_at: string;
    updated_at: string;
    user?: { full_name: string | null; email: string | null; role: string | null } | null;
    assigned_admin?: Admin | null;
};

type TicketHistory = {
    events: SupportEvent[];
    nextBeforeSequence: number | null;
    hasMore: boolean;
    loaded: boolean;
    loading: boolean;
    error: string | null;
};

type Editor = {
    status: TicketStatus;
    priority: TicketPriority;
    assignedAdminId: string;
    messageKind: MessageKind;
    message: string;
};

type SupportTicketsResponse = {
    error?: string;
    tickets?: SupportTicket[];
    admins?: Admin[];
    events?: SupportEvent[];
    hasMore?: boolean;
    nextBeforeSequence?: number | null;
    pagination?: { page: number; pageSize: number; total: number; totalPages: number };
    notificationRisk?: string | null;
};

const statuses: Array<TicketStatus | 'all'> = ['open', 'triaged', 'closed', 'all'];
const priorities: Array<TicketPriority | 'all'> = ['urgent', 'high', 'normal', 'low', 'all'];

function editorFor(ticket: SupportTicket): Editor {
    return {
        status: ticket.status,
        priority: ticket.priority,
        assignedAdminId: ticket.assigned_admin_id ?? '',
        messageKind: 'internal_note',
        message: '',
    };
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
}

export default function SupportTicketsManager() {
    const [tickets, setTickets] = useState<SupportTicket[]>([]);
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [status, setStatus] = useState<TicketStatus | 'all'>('open');
    const [priority, setPriority] = useState<TicketPriority | 'all'>('all');
    const [assignee, setAssignee] = useState('all');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [editors, setEditors] = useState<Record<string, Editor>>({});
    const [histories, setHistories] = useState<Record<string, TicketHistory>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [workingTicketId, setWorkingTicketId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const retryIds = useRef<Record<string, { fingerprint: string; requestId: string }>>({});

    const loadTickets = useCallback(async (signal?: AbortSignal) => {
        setIsLoading(true);
        setError(null);
        const params = new URLSearchParams({ status, priority, assignee, page: String(page), pageSize: '25' });
        try {
            const response = await fetch(`/api/admin/support-tickets?${params}`, { signal });
            const data = await response.json() as SupportTicketsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los tickets');
            if (signal?.aborted) return;
            const nextTickets = data.tickets ?? [];
            setTickets(nextTickets);
            setAdmins(data.admins ?? []);
            setTotalPages(data.pagination?.totalPages ?? 0);
            setEditors(Object.fromEntries(nextTickets.map((ticket) => [ticket.id, editorFor(ticket)])));
            setHistories({});
        } catch (cause) {
            if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los tickets');
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, [assignee, page, priority, status]);

    useEffect(() => {
        const controller = new AbortController();
        void loadTickets(controller.signal);
        return () => controller.abort();
    }, [loadTickets]);

    const changeFilter = (setter: (value: string) => void, value: string) => {
        setPage(1);
        setter(value);
    };

    const updateEditor = (ticketId: string, patch: Partial<Editor>) => {
        setEditors((current) => ({ ...current, [ticketId]: { ...current[ticketId], ...patch } }));
    };

    const loadHistory = async (ticketId: string, loadMore = false) => {
        const currentHistory = histories[ticketId];
        if (currentHistory?.loading || (loadMore && !currentHistory?.nextBeforeSequence)) return;

        setHistories((current) => ({
            ...current,
            [ticketId]: {
                events: current[ticketId]?.events ?? [],
                nextBeforeSequence: current[ticketId]?.nextBeforeSequence ?? null,
                hasMore: current[ticketId]?.hasMore ?? false,
                loaded: current[ticketId]?.loaded ?? false,
                loading: true,
                error: null,
            },
        }));

        const params = new URLSearchParams({ ticketId, eventLimit: '20' });
        if (loadMore && currentHistory?.nextBeforeSequence) {
            params.set('beforeSequence', String(currentHistory.nextBeforeSequence));
        }

        try {
            const response = await fetch(`/api/admin/support-tickets?${params}`);
            const data = await response.json() as SupportTicketsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo cargar el historial');

            setHistories((current) => {
                const previousEvents = loadMore ? (current[ticketId]?.events ?? []) : [];
                const incomingEvents = data.events ?? [];
                const events = Array.from(
                    new Map([...previousEvents, ...incomingEvents].map((event) => [event.id, event])).values(),
                );
                return {
                    ...current,
                    [ticketId]: {
                        events,
                        nextBeforeSequence: data.nextBeforeSequence ?? null,
                        hasMore: data.hasMore ?? false,
                        loaded: true,
                        loading: false,
                        error: null,
                    },
                };
            });
        } catch (cause) {
            setHistories((current) => ({
                ...current,
                [ticketId]: {
                    events: current[ticketId]?.events ?? [],
                    nextBeforeSequence: current[ticketId]?.nextBeforeSequence ?? null,
                    hasMore: current[ticketId]?.hasMore ?? false,
                    loaded: current[ticketId]?.loaded ?? false,
                    loading: false,
                    error: cause instanceof Error ? cause.message : 'No se pudo cargar el historial',
                },
            }));
        }
    };

    const saveTicket = async (ticket: SupportTicket) => {
        const editor = editors[ticket.id];
        if (!editor) return;
        const payload = {
            ticketId: ticket.id,
            expectedStatus: ticket.status,
            expectedUpdatedAt: ticket.updated_at,
            status: editor.status,
            priority: editor.priority,
            assignmentIsSet: true,
            assignedAdminId: editor.assignedAdminId || null,
            ...(editor.message.trim() ? { messageKind: editor.messageKind, message: editor.message.trim() } : {}),
        };
        const fingerprint = JSON.stringify(payload);
        const retry = retryIds.current[ticket.id];
        const requestId = retry?.fingerprint === fingerprint ? retry.requestId : crypto.randomUUID();
        retryIds.current[ticket.id] = { fingerprint, requestId };

        setWorkingTicketId(ticket.id);
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/support-tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ requestId, ...payload }),
            });
            const data = await response.json() as SupportTicketsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el ticket');
            delete retryIds.current[ticket.id];
            setMessage(data.notificationRisk
                ? 'Ticket guardado; la notificacion por correo queda pendiente de revision.'
                : 'Ticket actualizado');
            await loadTickets();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el ticket');
        } finally {
            setWorkingTicketId(null);
        }
    };

    const filtersDisabled = isLoading || workingTicketId !== null;

    return (
        <div className="space-y-5">
            <div className="grid gap-3 border-2 border-[#006064] bg-white p-4 md:grid-cols-3">
                <label className="text-xs font-bold uppercase text-[#006064]">
                    Estado
                    <select aria-label="Filtrar por estado" value={status} disabled={filtersDisabled}
                        onChange={(event) => changeFilter((value) => setStatus(value as TicketStatus | 'all'), event.target.value)}
                        className="mt-1 block w-full border-2 border-[#006064] p-2">
                        {statuses.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                </label>
                <label className="text-xs font-bold uppercase text-[#006064]">
                    Prioridad
                    <select aria-label="Filtrar por prioridad" value={priority} disabled={filtersDisabled}
                        onChange={(event) => changeFilter((value) => setPriority(value as TicketPriority | 'all'), event.target.value)}
                        className="mt-1 block w-full border-2 border-[#006064] p-2">
                        {priorities.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                </label>
                <label className="text-xs font-bold uppercase text-[#006064]">
                    Responsable
                    <select aria-label="Filtrar por responsable" value={assignee} disabled={filtersDisabled}
                        onChange={(event) => changeFilter(setAssignee, event.target.value)}
                        className="mt-1 block w-full border-2 border-[#006064] p-2">
                        <option value="all">Todos</option><option value="unassigned">Sin asignar</option>
                        {admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.full_name || admin.email}</option>)}
                    </select>
                </label>
            </div>

            {(message || error) && <div role={error ? 'alert' : 'status'} className="border-2 border-[#006064] bg-white p-4 font-mono text-sm">{error || message}</div>}

            {isLoading ? <p role="status">Cargando...</p> : tickets.length === 0 ? <p>No hay tickets para este filtro</p> : (
                <div className="space-y-5">
                    {tickets.map((ticket) => {
                        const editor = editors[ticket.id] ?? editorFor(ticket);
                        const history = histories[ticket.id];
                        return <article key={ticket.id} className="border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0_0_#006064]">
                            <header className="flex flex-wrap justify-between gap-3">
                                <div><h2 className="font-display text-xl uppercase text-[#006064]">{ticket.issue_title}</h2>
                                    <p className="font-mono text-xs">{ticket.user?.email} · {formatDate(ticket.created_at)}</p></div>
                                <span className="font-mono text-xs uppercase">{ticket.issue_type}</span>
                            </header>
                            <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{ticket.message}</p>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                                <label>Estado<select aria-label={`Estado ${ticket.issue_title}`} value={editor.status} disabled={workingTicketId !== null}
                                    onChange={(event) => updateEditor(ticket.id, { status: event.target.value as TicketStatus })} className="block w-full border p-2">
                                    {statuses.slice(0, 3).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                                <label>Prioridad<select aria-label={`Prioridad ${ticket.issue_title}`} value={editor.priority} disabled={workingTicketId !== null}
                                    onChange={(event) => updateEditor(ticket.id, { priority: event.target.value as TicketPriority })} className="block w-full border p-2">
                                    {priorities.slice(0, 4).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                                <label>Responsable<select aria-label={`Responsable ${ticket.issue_title}`} value={editor.assignedAdminId} disabled={workingTicketId !== null}
                                    onChange={(event) => updateEditor(ticket.id, { assignedAdminId: event.target.value })} className="block w-full border p-2">
                                    <option value="">Sin asignar</option>{admins.map((admin) => <option key={admin.id} value={admin.id}>{admin.full_name || admin.email}</option>)}</select></label>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
                                <select aria-label={`Tipo de mensaje ${ticket.issue_title}`} value={editor.messageKind} disabled={workingTicketId !== null}
                                    onChange={(event) => updateEditor(ticket.id, { messageKind: event.target.value as MessageKind })} className="border p-2">
                                    <option value="internal_note">Nota interna</option><option value="public_reply">Respuesta publica</option>
                                </select>
                                <textarea aria-label={`Mensaje ${ticket.issue_title}`} value={editor.message} disabled={workingTicketId !== null} maxLength={4000}
                                    onChange={(event) => updateEditor(ticket.id, { message: event.target.value })} className="border p-2" rows={3} />
                            </div>
                            <section className="mt-4 border-t border-[#006064]/20 pt-4" aria-label={`Historial ${ticket.issue_title}`}>
                                {!history?.loaded && !history?.error && <button type="button" disabled={history?.loading || workingTicketId !== null}
                                    onClick={() => void loadHistory(ticket.id)} className="font-bold uppercase text-[#006064] disabled:opacity-50">
                                    {history?.loading ? 'Cargando historial...' : 'Ver historial'}
                                </button>}
                                {history?.error && <p role="alert" className="mt-2 text-sm text-red-700">{history.error}</p>}
                                {history?.error && !history.loading && <button type="button" onClick={() => void loadHistory(ticket.id, history.loaded)}
                                    className="mt-2 font-bold uppercase text-[#006064]">Reintentar historial</button>}
                                {history?.loaded && <ol className="mt-3 space-y-2">{history.events.map((event) =>
                                    <li key={event.id} className={`border-l-4 p-3 ${event.visibility === 'internal' ? 'border-amber-500 bg-amber-50' : 'border-[#006064] bg-[#E0F7FA]'}`}>
                                        <p className="font-mono text-xs uppercase">{event.event_type} · {event.visibility} · {formatDate(event.created_at)}</p>
                                        {event.body && <p className="mt-1 whitespace-pre-wrap text-sm">{event.body}</p>}
                                    </li>)}</ol>}
                                {history?.loaded && history.events.length === 0 && <p className="mt-2 text-sm">No hay eventos.</p>}
                                {history?.loaded && history.hasMore && !history.error && <button type="button" disabled={history.loading || workingTicketId !== null}
                                    onClick={() => void loadHistory(ticket.id, true)} className="mt-3 font-bold uppercase text-[#006064] disabled:opacity-50">
                                    {history.loading ? 'Cargando historial...' : 'Cargar mas historial'}
                                </button>}
                            </section>
                            <button type="button" onClick={() => void saveTicket(ticket)} disabled={workingTicketId !== null}
                                aria-busy={workingTicketId === ticket.id} className="mt-4 border-2 border-[#006064] bg-[#006064] px-4 py-2 font-bold uppercase text-white disabled:opacity-50">
                                {workingTicketId === ticket.id ? 'Guardando...' : 'Guardar cambios'}
                            </button>
                        </article>;
                    })}
                </div>
            )}

            <nav className="flex items-center justify-between" aria-label="Paginacion de soporte">
                <button type="button" disabled={filtersDisabled || page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button>
                <span>Pagina {page} de {Math.max(totalPages, 1)}</span>
                <button type="button" disabled={filtersDisabled || page >= totalPages} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
            </nav>
        </div>
    );
}
