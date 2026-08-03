import { useEffect, useState } from 'react';

type AuditEvent = {
    id: string;
    actorId: string | null;
    actorLabel: string;
    action: string;
    entityType: string;
    entityId: string | null;
    createdAt: string | null;
    hasBefore: boolean;
    hasAfter: boolean;
};

type AuditResponse = {
    events?: AuditEvent[];
    nextBefore?: string | null;
    error?: string;
};

export default function AdminAuditHistory() {
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [nextBefore, setNextBefore] = useState<string | null>(null);
    const [entityType, setEntityType] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async (before?: string, append = false) => {
        if (append) setLoadingMore(true);
        else setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ limit: '50' });
            if (before) params.set('before', before);
            if (entityType.trim()) params.set('entityType', entityType.trim());
            const response = await fetch(`/api/admin/audit?${params.toString()}`);
            const data = await response.json() as AuditResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo cargar el historial');
            setEvents((current) => append ? [...current, ...(data.events ?? [])] : data.events ?? []);
            setNextBefore(data.nextBefore ?? null);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        void load();
        // The initial view intentionally has no filter.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-5">
            <form
                className="flex flex-col gap-3 border-2 border-[#006064] bg-white p-4 sm:flex-row sm:items-end"
                onSubmit={(event) => {
                    event.preventDefault();
                    void load();
                }}
            >
                <label className="flex-1 font-bold text-[#006064]">
                    Tipo de entidad
                    <input
                        value={entityType}
                        onChange={(event) => setEntityType(event.target.value)}
                        placeholder="Ej.: admin_access, package, lead"
                        pattern="[a-z0-9_.:-]{1,80}"
                        className="mt-1 w-full border-2 border-[#006064] px-3 py-2 font-mono text-sm focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#006064]"
                    />
                </label>
                <button type="submit" disabled={loading || loadingMore} className="border-2 border-[#006064] bg-[#006064] px-5 py-2 font-black uppercase text-white disabled:opacity-50">
                    Filtrar
                </button>
            </form>

            {error && <p role="alert" className="border-2 border-red-700 bg-red-50 p-4 font-bold text-red-800">{error}</p>}
            {loading ? (
                <p role="status" className="border-2 border-[#006064] bg-white p-6 font-mono text-[#006064]">Cargando historial...</p>
            ) : (
                <div className="overflow-x-auto border-2 border-[#006064] bg-white shadow-[4px_4px_0_0_#006064]">
                    <table className="min-w-full border-collapse text-left text-sm">
                        <thead className="bg-[#006064] text-white">
                            <tr>
                                <th className="p-3">Fecha</th>
                                <th className="p-3">Actor</th>
                                <th className="p-3">Acción</th>
                                <th className="p-3">Entidad</th>
                                <th className="p-3">Cambio</th>
                            </tr>
                        </thead>
                        <tbody>
                            {events.map((event) => (
                                <tr key={event.id} className="border-b border-[#006064]/20 align-top">
                                    <td className="whitespace-nowrap p-3 font-mono text-xs">{event.createdAt ? new Date(event.createdAt).toLocaleString('es-ES') : 'Sin fecha'}</td>
                                    <td className="p-3">{event.actorLabel}</td>
                                    <td className="p-3 font-mono text-xs font-bold">{event.action}</td>
                                    <td className="p-3"><span className="font-bold">{event.entityType}</span>{event.entityId && <span className="block break-all font-mono text-xs">{event.entityId}</span>}</td>
                                    <td className="p-3">{event.hasBefore && event.hasAfter ? 'Modificación' : event.hasAfter ? 'Alta' : event.hasBefore ? 'Retirada' : 'Evento'}</td>
                                </tr>
                            ))}
                            {events.length === 0 && (
                                <tr><td colSpan={5} role="status" className="p-8 text-center text-[#006064]">No hay eventos para este filtro.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {nextBefore && (
                <button type="button" disabled={loadingMore} onClick={() => void load(nextBefore, true)} className="border-2 border-[#006064] bg-white px-5 py-2 font-black uppercase text-[#006064] disabled:opacity-50">
                    {loadingMore ? 'Cargando...' : 'Cargar anteriores'}
                </button>
            )}
        </div>
    );
}
