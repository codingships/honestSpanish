import React, { useState } from 'react';

type TicketStatus = 'open' | 'triaged' | 'closed';

interface SupportTicketQuickActionsProps {
    ticketId: string;
    status: string | null;
}

type SupportTicketResponse = {
    error?: string;
};

const statusLabels: Record<TicketStatus, string> = {
    open: 'Abierto',
    triaged: 'Revisado',
    closed: 'Cerrado',
};

function normalizeStatus(status: string | null): TicketStatus {
    return status === 'triaged' || status === 'closed' ? status : 'open';
}

export default function SupportTicketQuickActions({
    ticketId,
    status,
}: SupportTicketQuickActionsProps) {
    const [currentStatus, setCurrentStatus] = useState<TicketStatus>(normalizeStatus(status));
    const [isWorking, setIsWorking] = useState<TicketStatus | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const updateTicket = async (nextStatus: TicketStatus) => {
        setIsWorking(nextStatus);
        setMessage(null);
        setError(null);

        try {
            const response = await fetch('/api/admin/support-tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ticketId,
                    status: nextStatus,
                }),
            });
            const data = await response.json() as SupportTicketResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el ticket');
            setCurrentStatus(nextStatus);
            setMessage(`Ticket ${statusLabels[nextStatus].toLowerCase()}`);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo actualizar el ticket');
        } finally {
            setIsWorking(null);
        }
    };

    return (
        <div className="flex flex-col items-end gap-2">
            <span
                aria-label={`Estado del ticket: ${statusLabels[currentStatus]}`}
                className="inline-flex w-fit border border-[#006064] px-2 py-1 text-xs font-bold uppercase text-[#006064]"
            >
                {statusLabels[currentStatus]}
            </span>

            {currentStatus !== 'triaged' && (
                <button
                    type="button"
                    onClick={() => void updateTicket('triaged')}
                    disabled={isWorking !== null}
                    aria-busy={isWorking === 'triaged'}
                    className="w-full border border-[#006064] px-3 py-1 text-xs font-bold uppercase text-[#006064] hover:bg-[#006064] hover:text-white disabled:opacity-50 md:w-auto"
                >
                    {isWorking === 'triaged' ? 'Guardando...' : 'Revisar'}
                </button>
            )}

            {currentStatus !== 'closed' && (
                <button
                    type="button"
                    onClick={() => void updateTicket('closed')}
                    disabled={isWorking !== null}
                    aria-busy={isWorking === 'closed'}
                    className="w-full border border-[#6A131C] px-3 py-1 text-xs font-bold uppercase text-[#6A131C] hover:bg-[#6A131C] hover:text-white disabled:opacity-50 md:w-auto"
                >
                    {isWorking === 'closed' ? 'Cerrando...' : 'Cerrar'}
                </button>
            )}

            {currentStatus === 'closed' && (
                <button
                    type="button"
                    onClick={() => void updateTicket('open')}
                    disabled={isWorking !== null}
                    aria-busy={isWorking === 'open'}
                    className="w-full border border-[#006064] px-3 py-1 text-xs font-bold uppercase text-[#006064] hover:bg-[#006064] hover:text-white disabled:opacity-50 md:w-auto"
                >
                    {isWorking === 'open' ? 'Reabriendo...' : 'Reabrir'}
                </button>
            )}

            {(message || error) && (
                <p
                    role={error ? 'alert' : 'status'}
                    className={`max-w-[160px] text-right font-mono text-[11px] ${error ? 'text-[#6A131C]' : 'text-[#006064]'}`}
                >
                    {error || message}
                </p>
            )}
        </div>
    );
}
