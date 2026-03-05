import { useState, useEffect } from 'react';

type LeadStatus = 'new' | 'contacted' | 'discarded';

interface Lead {
    id: string;
    name: string | null;
    email: string;
    interest: string | null;
    lang: string | null;
    consent_given: boolean;
    ip_address: string | null;
    created_at: string;
    status: LeadStatus;
}

export default function LeadManager() {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        fetchLeads();
    }, []);

    const fetchLeads = async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/leads');
            if (!res.ok) throw new Error('Failed to fetch leads');
            const data = await res.json();
            setLeads(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const updateStatus = async (leadId: string, newStatus: LeadStatus) => {
        try {
            setUpdatingId(leadId);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId, newStatus })
            });

            if (!res.ok) throw new Error('Failed to update status');

            // Update local state without re-fetching everything
            setLeads(leads.map(lead =>
                lead.id === leadId ? { ...lead, status: newStatus } : lead
            ));
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Error updating status');
        } finally {
            setUpdatingId(null);
        }
    };

    if (loading) return <div className="text-gray-500 flex justify-center p-8"><span className="animate-pulse">Cargando leads...</span></div>;
    if (error) return <div className="text-red-600 bg-red-50 p-4 rounded-xl border border-red-200">Error: {error}</div>;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Gestión de Leads (CRM)</h2>
                    <p className="text-sm text-gray-500 mt-1">Sigue el estado de los prospectos capturados.</p>
                </div>
                <div className="bg-[#E0F7FA] text-[#006064] text-sm font-medium px-4 py-2 rounded-full">
                    Total: {leads.length}
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                            <th className="p-4 font-medium">Fecha</th>
                            <th className="p-4 font-medium">Email / Contacto</th>
                            <th className="p-4 font-medium">Interés</th>
                            <th className="p-4 font-medium">Idioma</th>
                            <th className="p-4 font-medium text-right">Estado y Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                        {leads.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="p-8 text-center text-gray-500">
                                    No hay ningún lead capturado todavía.
                                </td>
                            </tr>
                        ) : (
                            leads.map((lead) => (
                                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 whitespace-nowrap text-gray-600">
                                        {new Date(lead.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                    </td>
                                    <td className="p-4">
                                        <div className="font-medium text-gray-900">{lead.email}</div>
                                        {lead.name && <div className="text-xs text-gray-500">{lead.name}</div>}
                                    </td>
                                    <td className="p-4">
                                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                            {lead.interest || 'General'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-gray-600 uppercase text-xs font-bold">
                                        {lead.lang || 'es'}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {/* Status Badge */}
                                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${lead.status === 'new' ? 'bg-[#F6FE51]/20 text-yellow-800' :
                                                    lead.status === 'contacted' ? 'bg-green-100 text-green-800' :
                                                        'bg-gray-100 text-gray-800'
                                                }`}>
                                                {lead.status === 'new' ? 'NUEVO' : lead.status === 'contacted' ? 'CONTACTADO' : 'DESCARTADO'}
                                            </span>

                                            {/* Action Buttons */}
                                            {lead.status === 'new' && (
                                                <button
                                                    onClick={() => updateStatus(lead.id, 'contacted')}
                                                    disabled={updatingId === lead.id}
                                                    className="ml-2 bg-[#6A131C] text-white hover:bg-[#8A1924] px-3 py-1.5 rounded text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
                                                >
                                                    Marcar Contactado
                                                </button>
                                            )}
                                            {lead.status === 'contacted' && (
                                                <button
                                                    onClick={() => updateStatus(lead.id, 'new')}
                                                    disabled={updatingId === lead.id}
                                                    className="ml-2 bg-gray-200 text-gray-700 hover:bg-gray-300 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                                >
                                                    Deshacer
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
