import { useCallback, useEffect, useState } from 'react';

type LeadStatus = 'new' | 'contacted' | 'discarded';
type PipelineStage = 'new' | 'to_contact' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost' | 'nurture';
type LevelCheckStatus = 'not_requested' | 'recommended' | 'sent' | 'received' | 'reviewed' | 'waived';
type ActionMessage = { type: 'success' | 'error'; text: string };

interface SummaryItem {
    label: string;
    count: number;
}

interface SourcePerformanceItem {
    sourcePath: string;
    total: number;
    contacted: number;
    qualified: number;
    won: number;
}

interface LeadPipelineSummary {
    totalLeads: number;
    contactedLeads: number;
    discardedLeads: number;
    qualifiedLeadCount: number;
    activePipelineCount: number;
    wonOpportunities: number;
    lostOpportunities: number;
    contactedRate: number;
    wonRate: number;
    topSourcePaths: SummaryItem[];
    topInterests: SummaryItem[];
    topPreferredPackages: SummaryItem[];
    levelSummary: SummaryItem[];
    pipelineStageSummary: SummaryItem[];
    sourcePerformance: SourcePerformanceItem[];
}

interface LeadManagerProps {
    lang?: 'es' | 'en' | 'ru';
}

interface CheckoutPackageOption {
    id: string;
    name: string;
    display_name: Record<string, string> | null;
}

interface Lead {
    id: string;
    name: string | null;
    email: string;
    interest: string | null;
    current_level: string | null;
    learning_goal: string | null;
    availability: string | null;
    preferred_package: string | null;
    source_path: string | null;
    lang: string | null;
    spoken_languages: string[] | null;
    is_russian_speaker: boolean | null;
    level_check_status: LevelCheckStatus | null;
    level_check_summary: string | null;
    level_check_estimated_level: string | null;
    level_check_confidence: string | null;
    level_check_plan_recommendation: string | null;
    level_check_fit_flags: string[] | null;
    level_check_received_at: string | null;
    level_check_reviewed_at: string | null;
    level_check_raw_cleared_at: string | null;
    consent_given: boolean;
    ip_address: string | null;
    created_at: string;
    status: LeadStatus;
    crm_opportunity?: {
        id: string;
        contact_id: string;
        stage: PipelineStage;
        opened_at: string;
        closed_at: string | null;
        current_level: string | null;
        learning_goal: string | null;
        availability: string | null;
        preferred_package_id: string | null;
        checkout_approved_at: string | null;
        converted_subscription_id: string | null;
        packages: { name: string; display_name: Record<string, string> } | null;
        crm_contacts: {
            id: string;
            lifecycle_stage: string;
            next_follow_up_at: string | null;
            last_contacted_at: string | null;
        } | null;
    } | null;
}

type LeadListResponse = Lead[] | {
    error?: string;
    leads?: Lead[];
    summary?: LeadPipelineSummary;
    checkoutPackages?: CheckoutPackageOption[];
};

type LeadMutationResponse = {
    error?: string;
    lead?: Partial<Lead>;
    opportunity?: Lead['crm_opportunity'];
};

async function readApiErrorMessage(response: Response, fallback: string) {
    try {
        const body = await response.json() as { error?: string };
        return typeof body?.error === 'string' && body.error.trim() ? body.error : fallback;
    } catch {
        return fallback;
    }
}

export default function LeadManager({ lang = 'es' }: LeadManagerProps) {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [checkoutPackages, setCheckoutPackages] = useState<CheckoutPackageOption[]>([]);
    const [checkoutPackageSelections, setCheckoutPackageSelections] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [updatingStageId, setUpdatingStageId] = useState<string | null>(null);
    const [updatingCheckoutApprovalId, setUpdatingCheckoutApprovalId] = useState<string | null>(null);
    const [sendingLevelCheckId, setSendingLevelCheckId] = useState<string | null>(null);
    const [reviewingLevelCheckId, setReviewingLevelCheckId] = useState<string | null>(null);
    const [sendingSalesEmailId, setSendingSalesEmailId] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
    const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('new');
    const [summary, setSummary] = useState<LeadPipelineSummary>(emptyLeadPipelineSummary);

    const fetchLeads = useCallback(async (signal?: AbortSignal) => {
        try {
            setLoading(true);
            setError(null);
            const params = new URLSearchParams({ status: statusFilter, limit: '100' });
            const res = await fetch(`/api/admin/leads?${params.toString()}`, { signal });
            if (signal?.aborted) return;
            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Failed to fetch leads'));
            const data = await res.json() as LeadListResponse;
            if (signal?.aborted) return;
            const nextLeads = Array.isArray(data) ? data : data.leads ?? [];
            setLeads(nextLeads);
            if (Array.isArray(data)) {
                setSummary(buildVisibleLeadSummary(nextLeads));
            } else {
                setSummary(data.summary ?? buildVisibleLeadSummary(nextLeads));
                setCheckoutPackages(data.checkoutPackages ?? []);
                setCheckoutPackageSelections((current) => {
                    const next = { ...current };
                    for (const lead of nextLeads) {
                        const opportunity = lead.crm_opportunity;
                        if (opportunity?.preferred_package_id && !next[opportunity.id]) {
                            next[opportunity.id] = opportunity.preferred_package_id;
                        }
                    }
                    return next;
                });
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError(err instanceof Error ? err.message : 'Unknown error');
            }
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        const controller = new AbortController();
        void fetchLeads(controller.signal);
        return () => controller.abort();
    }, [fetchLeads]);

    const updateStatus = async (leadId: string, newStatus: LeadStatus) => {
        try {
            setUpdatingId(leadId);
            setActionMessage(null);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId, newStatus })
            });

            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Failed to update status'));
            const data = await res.json() as LeadMutationResponse;
            const updatedLead = data.lead;

            setLeads(prev => {
                if (statusFilter !== 'all' && newStatus !== statusFilter) {
                    return prev.filter(lead => lead.id !== leadId);
                }

                return prev.map(lead =>
                    lead.id === leadId ? { ...lead, ...(updatedLead ?? {}), status: newStatus } : lead
                );
            });
            setActionMessage({ type: 'success', text: 'Estado actualizado.' });
        } catch (err) {
            setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error updating status' });
        } finally {
            setUpdatingId(null);
        }
    };

    const sendLevelCheck = async (leadId: string) => {
        try {
            setSendingLevelCheckId(leadId);
            setActionMessage(null);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'send_level_check', leadId })
            });

            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Failed to send diagnostic'));
            const data = await res.json() as LeadMutationResponse;
            const updatedLead = data.lead;

            setLeads(prev => prev.map(lead =>
                lead.id === leadId
                    ? { ...lead, ...(updatedLead ?? {}), level_check_status: updatedLead?.level_check_status ?? 'sent' }
                    : lead
            ));
            setActionMessage({ type: 'success', text: 'Diagnostico enviado.' });
        } catch (err) {
            setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error sending diagnostic' });
        } finally {
            setSendingLevelCheckId(null);
        }
    };

    const reviewLevelCheck = async (leadId: string) => {
        try {
            setReviewingLevelCheckId(leadId);
            setActionMessage(null);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'review_level_check', leadId })
            });

            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Failed to mark diagnostic as reviewed'));
            const data = await res.json() as LeadMutationResponse;
            const updatedLead = data.lead;

            setLeads(prev => prev.map(lead =>
                lead.id === leadId
                    ? {
                        ...lead,
                        ...(updatedLead ?? {}),
                        level_check_status: updatedLead?.level_check_status ?? 'reviewed',
                        level_check_raw_cleared_at: updatedLead?.level_check_raw_cleared_at ?? new Date().toISOString(),
                    }
                    : lead
            ));
            setActionMessage({ type: 'success', text: 'Diagnostico revisado y limpiado.' });
        } catch (err) {
            setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error reviewing diagnostic' });
        } finally {
            setReviewingLevelCheckId(null);
        }
    };

    const sendSalesEmail = async (leadId: string, template: 'missing_info' | 'proposal_next_step') => {
        try {
            setSendingSalesEmailId(`${leadId}:${template}`);
            setActionMessage(null);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'send_sales_email', leadId, template })
            });

            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Failed to send follow-up email'));
            const data = await res.json() as LeadMutationResponse;
            const updatedLead = data.lead;

            setLeads(prev => prev.map(lead =>
                lead.id === leadId
                    ? { ...lead, ...(updatedLead ?? {}), status: updatedLead?.status ?? 'contacted' }
                    : lead
            ));
            setActionMessage({ type: 'success', text: template === 'missing_info' ? 'Email de informacion enviado.' : 'Propuesta enviada.' });
        } catch (err) {
            setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error sending follow-up email' });
        } finally {
            setSendingSalesEmailId(null);
        }
    };

    const updatePipelineStage = async (leadId: string, opportunityId: string, newStage: PipelineStage) => {
        const nextStatus = mapPipelineStageToLeadStatus(newStage);

        try {
            setUpdatingStageId(opportunityId);
            setActionMessage(null);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'opportunity_stage', opportunityId, newStage })
            });

            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'Failed to update CRM stage'));
            const data = await res.json() as LeadMutationResponse;
            const updatedOpportunity = data.opportunity;

            setLeads(prev => {
                const updated = prev.map(lead =>
                    lead.id === leadId
                        ? {
                            ...lead,
                            status: nextStatus,
                            crm_opportunity: updatedOpportunity ?? (lead.crm_opportunity ? { ...lead.crm_opportunity, stage: newStage } : lead.crm_opportunity),
                        }
                        : lead
                );

                return statusFilter !== 'all'
                    ? updated.filter(lead => lead.status === statusFilter)
                    : updated;
            });
            setActionMessage({ type: 'success', text: 'Etapa CRM actualizada.' });
        } catch (err) {
            setActionMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error updating CRM stage' });
        } finally {
            setUpdatingStageId(null);
        }
    };

    const updateCheckoutApproval = async (
        leadId: string,
        opportunityId: string,
        packageId: string,
        approved: boolean,
    ) => {
        if (!packageId) {
            setActionMessage({ type: 'error', text: 'Selecciona un paquete activo antes de aprobar el pago.' });
            return;
        }

        try {
            setUpdatingCheckoutApprovalId(opportunityId);
            setActionMessage(null);
            const res = await fetch('/api/admin/leads', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'checkout_approval',
                    opportunityId,
                    packageId,
                    approved,
                }),
            });

            if (!res.ok) throw new Error(await readApiErrorMessage(res, 'No se pudo actualizar la aprobacion de pago'));
            const data = await res.json() as LeadMutationResponse;
            const updatedOpportunity = data.opportunity;
            if (!updatedOpportunity) throw new Error('La API no devolvio la oportunidad actualizada');

            setLeads((current) => current.map((lead) => (
                lead.id === leadId
                    ? { ...lead, crm_opportunity: updatedOpportunity }
                    : lead
            )));
            setCheckoutPackageSelections((current) => ({ ...current, [opportunityId]: packageId }));
            setActionMessage({
                type: 'success',
                text: approved ? 'Pago aprobado para el paquete seleccionado.' : 'Aprobacion de pago revocada.',
            });
        } catch (err) {
            setActionMessage({
                type: 'error',
                text: err instanceof Error ? err.message : 'Error actualizando la aprobacion de pago',
            });
        } finally {
            setUpdatingCheckoutApprovalId(null);
        }
    };

    const levelLabels: Record<string, string> = {
        not_sure: 'No lo sabe',
        a1: 'A1',
        a2: 'A2',
        b1: 'B1',
        b2: 'B2',
        c1_plus: 'C1+',
    };
    const statusFilterOptions: Array<{ value: LeadStatus | 'all'; label: string }> = [
        { value: 'new', label: 'Nuevas' },
        { value: 'contacted', label: 'Contactadas' },
        { value: 'discarded', label: 'Descartadas' },
        { value: 'all', label: 'Todas' },
    ];
    const interestLabels: Record<string, string> = {
        general: 'Vivir España',
        company: 'Profesional',
        other: 'Otro',
    };
    const pipelineStageLabels: Record<string, string> = {
        new: 'Nueva',
        to_contact: 'Por contactar',
        contacted: 'Contactada',
        qualified: 'Cualificada',
        proposal: 'Propuesta',
        won: 'Ganada',
        lost: 'Perdida',
        nurture: 'Pospuesta',
    };
    const levelCheckLabels: Record<string, string> = {
        not_requested: 'No solicitado',
        recommended: 'Recomendado',
        sent: 'Enviado',
        received: 'Recibido',
        reviewed: 'Revisado',
        waived: 'Omitido',
    };
    const pipelineStageOptions: Array<{ value: PipelineStage; label: string }> = [
        { value: 'new', label: pipelineStageLabels.new },
        { value: 'to_contact', label: pipelineStageLabels.to_contact },
        { value: 'contacted', label: pipelineStageLabels.contacted },
        { value: 'qualified', label: pipelineStageLabels.qualified },
        { value: 'proposal', label: pipelineStageLabels.proposal },
        { value: 'nurture', label: pipelineStageLabels.nurture },
        { value: 'won', label: pipelineStageLabels.won },
        { value: 'lost', label: pipelineStageLabels.lost },
    ];
    const languageLabels: Record<string, string> = {
        ru: 'Ruso',
        en: 'Ingles',
        es: 'Espanol',
    };
    const formatLeadLanguages = (lead: Lead) => {
        const languages = Array.isArray(lead.spoken_languages) ? lead.spoken_languages : [];
        return languages
            .map(item => languageLabels[item] || item)
            .join(', ');
    };
    const topInterests = summary.topInterests.map((item) => ({
        ...item,
        label: interestLabels[item.label] || item.label,
    }));
    const topPreferredPackages = summary.topPreferredPackages;
    const levelSummary = summary.levelSummary.map((item) => ({
        ...item,
        label: levelLabels[item.label] || item.label,
    }));
    const pipelineStageSummary = summary.pipelineStageSummary.map((item) => ({
        ...item,
        label: pipelineStageLabels[item.label] || item.label,
    }));

    const renderSummaryList = (items: SummaryItem[], emptyLabel: string) => (
        <ul className="mt-3 space-y-2">
            {(items.length > 0 ? items : [{ label: emptyLabel, count: 0 }]).map((item) => (
                <li key={item.label} className="flex items-start justify-between gap-3 text-xs">
                    <span className="min-w-0 break-words text-gray-600">{item.label}</span>
                    <span className="shrink-0 font-bold text-gray-900">{item.count}</span>
                </li>
            ))}
        </ul>
    );

    const renderSourcePerformance = (items: SourcePerformanceItem[]) => (
        <ul className="mt-3 space-y-2">
            {(items.length > 0 ? items : [{ sourcePath: 'Sin solicitudes', total: 0, contacted: 0, qualified: 0, won: 0 }]).map((item) => (
                <li key={item.sourcePath} className="text-xs">
                    <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 break-words text-gray-600">{item.sourcePath}</span>
                        <span className="shrink-0 font-bold text-gray-900">{item.total}</span>
                    </div>
                    {item.total > 0 && (
                        <p className="mt-1 text-[11px] leading-4 text-gray-500">
                            {item.contacted} contactadas - {item.qualified} cualificadas - {item.won} ganadas
                        </p>
                    )}
                </li>
            ))}
        </ul>
    );

    const crmContactHref = (lead: Lead) => {
        const contactId = lead.crm_opportunity?.crm_contacts?.id || lead.crm_opportunity?.contact_id;
        return contactId ? `/${lang}/campus/admin/crm/contact/${contactId}` : null;
    };
    const isAnyLeadAction = Boolean(
        updatingId
        || updatingStageId
        || updatingCheckoutApprovalId
        || sendingLevelCheckId
        || reviewingLevelCheckId
        || sendingSalesEmailId
    );

    if (loading) return <div className="text-gray-500 flex justify-center p-8"><span className="animate-pulse">Cargando leads...</span></div>;
    if (error) return <div role="alert" className="text-red-600 bg-red-50 p-4 rounded-xl border border-red-200">Error: {error}</div>;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Solicitudes de plaza (CRM)</h2>
                    <p className="text-sm text-gray-500 mt-1">Revisa encaje, nivel declarado, objetivo y disponibilidad antes de contactar.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    <label className="text-xs font-bold uppercase text-gray-500">
                        Estado
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value as LeadStatus | 'all')}
                            disabled={isAnyLeadAction}
                            className="ml-0 sm:ml-2 mt-1 sm:mt-0 border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                        >
                            {statusFilterOptions.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                    </label>
                    <div className="bg-[#E0F7FA] text-[#006064] text-sm font-medium px-4 py-2 rounded-full">
                        Mostrando: {leads.length}
                    </div>
                </div>
            </div>

            {actionMessage && (
                <div role={actionMessage.type === 'success' ? 'status' : 'alert'} className={`mx-6 mt-4 rounded-xl border p-4 font-mono text-sm ${actionMessage.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
                    {actionMessage.text}
                </div>
            )}

            <section aria-label="Aprendizaje SEO sin cookies" className="border-b border-gray-100 bg-gray-50">
                <div className="grid grid-cols-1 divide-y divide-gray-100 lg:grid-cols-6 lg:divide-x lg:divide-y-0">
                    <div className="p-5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Aprendizaje SEO sin cookies</p>
                        <p className="mt-3 text-3xl font-bold text-[#006064]">{summary.qualifiedLeadCount}</p>
                        <p className="mt-1 text-xs text-gray-600">solicitudes globales llegan a etapa cualificada.</p>
                        <p className="mt-2 text-[11px] leading-5 text-gray-500">
                            {summary.contactedRate}% contactadas - {summary.wonRate}% ganadas.
                        </p>
                        <p className="mt-3 text-[11px] leading-5 text-gray-500">
                            Usa estas señales agregadas para comparar rutas, niveles e intereses sin activar telemetría rica.
                        </p>
                    </div>
                    <div className="p-5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Rutas que convierten</p>
                        {renderSourcePerformance(summary.sourcePerformance)}
                    </div>
                    <div className="p-5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Interés declarado</p>
                        {renderSummaryList(topInterests, 'Sin solicitudes')}
                    </div>
                    <div className="p-5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Planes de interes</p>
                        {renderSummaryList(topPreferredPackages, 'Sin solicitudes')}
                    </div>
                    <div className="p-5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Nivel declarado</p>
                        {renderSummaryList(levelSummary, 'Sin solicitudes')}
                    </div>
                    <div className="p-5">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Embudo CRM</p>
                        {renderSummaryList(pipelineStageSummary, 'Sin oportunidades')}
                        <p className="mt-3 text-[11px] leading-5 text-gray-500">
                            {summary.activePipelineCount} abiertas - {summary.wonOpportunities} ganadas - {summary.lostOpportunities} perdidas.
                        </p>
                    </div>
                </div>
            </section>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                            <th className="p-4 font-medium">Fecha</th>
                            <th className="p-4 font-medium">Email / Contacto</th>
                            <th className="p-4 font-medium">Encaje</th>
                            <th className="p-4 font-medium">Objetivo y disponibilidad</th>
                            <th className="p-4 font-medium">Idioma</th>
                            <th className="p-4 font-medium text-right">Estado y Accion</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 text-sm">
                        {leads.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="p-8 text-center text-gray-500">
                                    No hay solicitudes en este estado.
                                </td>
                            </tr>
                        ) : (
                            leads.map((lead) => {
                                const contactHref = crmContactHref(lead);
                                const hasLevelCheck = Boolean(lead.level_check_status && lead.level_check_status !== 'not_requested');
                                const canSendLevelCheck = lead.status !== 'discarded'
                                    && lead.level_check_status !== 'received'
                                    && lead.level_check_status !== 'reviewed';
                                const canSendSalesEmail = lead.status !== 'discarded';
                                const opportunity = lead.crm_opportunity;
                                const selectedCheckoutPackageId = opportunity
                                    ? checkoutPackageSelections[opportunity.id] ?? opportunity.preferred_package_id ?? ''
                                    : '';
                                const checkoutApproved = Boolean(opportunity?.checkout_approved_at);
                                const checkoutConsumed = Boolean(opportunity?.converted_subscription_id);
                                const selectedPackageInCatalog = checkoutPackages.some((pkg) => pkg.id === selectedCheckoutPackageId);

                                return (
                                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 whitespace-nowrap text-gray-600">
                                        {new Date(lead.created_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                    </td>
                                    <td className="p-4">
                                        <div className="font-medium text-gray-900">{lead.email}</div>
                                        {lead.name && <div className="text-xs text-gray-500">{lead.name}</div>}
                                    </td>
                                    <td className="p-4 align-top">
                                        <div className="space-y-2">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                                {lead.interest || 'General'}
                                            </span>
                                            {lead.current_level && (
                                                <div className="text-xs text-gray-600">
                                                    Nivel: <span className="font-semibold text-gray-900">{levelLabels[lead.current_level] || lead.current_level}</span>
                                                </div>
                                            )}
                                            {lead.preferred_package && (
                                                <div className="text-xs text-gray-600">
                                                    Plan: <span className="font-semibold text-gray-900">{lead.preferred_package}</span>
                                                </div>
                                            )}
                                            {hasLevelCheck && (
                                                <div className="border border-[#006064]/30 bg-[#E0F7FA] p-2 text-xs leading-5 text-[#006064]">
                                                    <div className="font-bold uppercase">
                                                        Diagnostico: {levelCheckLabels[lead.level_check_status || 'not_requested'] || lead.level_check_status}
                                                    </div>
                                                    {lead.level_check_estimated_level && (
                                                        <div>
                                                            Nivel diag.: <span className="font-semibold">{levelLabels[lead.level_check_estimated_level] || lead.level_check_estimated_level}</span>
                                                            {lead.level_check_confidence ? ` (${lead.level_check_confidence})` : ''}
                                                        </div>
                                                    )}
                                                    {lead.level_check_received_at && (
                                                        <div>
                                                            Recibido: {new Date(lead.level_check_received_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                        </div>
                                                    )}
                                                    {lead.level_check_reviewed_at && (
                                                        <div>
                                                            Revisado: {new Date(lead.level_check_reviewed_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                        </div>
                                                    )}
                                                    {lead.level_check_raw_cleared_at && (
                                                        <div className="text-[11px]">
                                                            Contexto crudo limpiado
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {lead.source_path && (
                                                <div className="text-[11px] text-gray-400 break-all">
                                                    Origen: {lead.source_path}
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-4 align-top max-w-sm">
                                        {lead.learning_goal ? (
                                            <p className="text-gray-700 leading-5">{lead.learning_goal}</p>
                                        ) : (
                                            <p className="text-gray-400">Sin objetivo detallado.</p>
                                        )}
                                        {lead.availability && (
                                            <p className="mt-2 text-xs text-gray-500 leading-5">
                                                Disponibilidad: {lead.availability}
                                            </p>
                                        )}
                                        {lead.level_check_summary && (
                                            <p className="mt-3 border-l-4 border-[#006064] pl-3 text-xs leading-5 text-gray-600">
                                                {lead.level_check_summary}
                                            </p>
                                        )}
                                        {lead.level_check_plan_recommendation && (
                                            <p className="mt-2 text-xs font-semibold leading-5 text-[#006064]">
                                                Recomendacion: {lead.level_check_plan_recommendation}
                                            </p>
                                        )}
                                        {Array.isArray(lead.level_check_fit_flags) && lead.level_check_fit_flags.length > 0 && (
                                            <p className="mt-2 text-[11px] leading-5 text-gray-500">
                                                Flags: {lead.level_check_fit_flags.join(', ')}
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-4 align-top text-gray-600 text-xs">
                                        <div className="font-bold uppercase">{lead.lang || 'es'}</div>
                                        {lead.is_russian_speaker && (
                                            <span className="mt-2 inline-flex rounded bg-[#E0F7FA] px-2 py-1 font-bold uppercase text-[#006064]">
                                                Rusofono
                                            </span>
                                        )}
                                        {formatLeadLanguages(lead) && (
                                            <p className="mt-2 leading-5 text-gray-500">
                                                {formatLeadLanguages(lead)}
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="flex flex-wrap items-center justify-end gap-2">
                                            {/* Status Badge */}
                                            <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${lead.status === 'new' ? 'bg-[#F6FE51]/20 text-yellow-800' :
                                                    lead.status === 'contacted' ? 'bg-green-100 text-green-800' :
                                                        'bg-gray-100 text-gray-800'
                                                }`}>
                                                {lead.status === 'new' ? 'NUEVO' : lead.status === 'contacted' ? 'CONTACTADO' : 'DESCARTADO'}
                                            </span>
                                            {lead.crm_opportunity && (
                                                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-[#E0F7FA] text-[#006064]">
                                                    CRM: {pipelineStageLabels[lead.crm_opportunity.stage] || lead.crm_opportunity.stage}
                                                </span>
                                            )}
                                            {contactHref && (
                                                <a
                                                    href={contactHref}
                                                    className="inline-flex items-center px-2 py-1 rounded text-xs font-bold uppercase bg-white text-[#006064] border border-[#006064] hover:bg-[#E0F7FA]"
                                                >
                                                    Abrir ficha CRM
                                                </a>
                                            )}
                                            {lead.crm_opportunity?.crm_contacts?.next_follow_up_at && (
                                                <span className="w-full text-[11px] font-mono text-[#006064]">
                                                    Seguimiento: {new Date(lead.crm_opportunity.crm_contacts.next_follow_up_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                </span>
                                            )}
                                            {lead.crm_opportunity && (
                                                <label className="w-full text-right text-[11px] font-bold uppercase text-gray-500">
                                                    Etapa CRM
                                                    <select
                                                        value={lead.crm_opportunity.stage}
                                                        onChange={(event) => updatePipelineStage(lead.id, lead.crm_opportunity!.id, event.target.value as PipelineStage)}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={updatingStageId === lead.crm_opportunity.id}
                                                        className="ml-2 mt-1 border border-gray-300 bg-white px-2 py-1 text-xs normal-case text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#006064]/20 disabled:opacity-50"
                                                    >
                                                        {pipelineStageOptions.map(option => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </label>
                                            )}

                                            {opportunity && (
                                                <div className="w-full border border-[#006064]/30 bg-[#E0F7FA]/50 p-3 text-left">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <span className="text-[11px] font-bold uppercase text-[#006064]">
                                                            Autorizacion de pago
                                                        </span>
                                                        <span className={`px-2 py-1 text-[10px] font-bold uppercase ${checkoutConsumed
                                                            ? 'bg-gray-200 text-gray-700'
                                                            : checkoutApproved
                                                                ? 'bg-green-100 text-green-800'
                                                                : 'bg-yellow-100 text-yellow-800'
                                                            }`}>
                                                            {checkoutConsumed ? 'Consumida' : checkoutApproved ? 'Aprobada' : 'No aprobada'}
                                                        </span>
                                                    </div>
                                                    <label className="mt-2 block text-[11px] font-bold uppercase text-gray-500">
                                                        Paquete autorizado
                                                        <select
                                                            aria-label={`Paquete autorizado para ${lead.email}`}
                                                            value={selectedCheckoutPackageId}
                                                            onChange={(event) => setCheckoutPackageSelections((current) => ({
                                                                ...current,
                                                                [opportunity.id]: event.target.value,
                                                            }))}
                                                            disabled={isAnyLeadAction || checkoutApproved || checkoutConsumed}
                                                            className="mt-1 w-full border border-gray-300 bg-white px-2 py-2 text-xs normal-case text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#006064]/20 disabled:opacity-60"
                                                        >
                                                            <option value="">Selecciona un paquete</option>
                                                            {!selectedPackageInCatalog && selectedCheckoutPackageId && (
                                                                <option value={selectedCheckoutPackageId}>
                                                                    {opportunity.packages?.display_name?.[lang] || opportunity.packages?.name || 'Paquete actual'}
                                                                </option>
                                                            )}
                                                            {checkoutPackages.map((pkg) => (
                                                                <option key={pkg.id} value={pkg.id}>
                                                                    {pkg.display_name?.[lang] || pkg.display_name?.es || pkg.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                    <div className="mt-2 flex justify-end gap-2">
                                                        {checkoutApproved ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateCheckoutApproval(
                                                                    lead.id,
                                                                    opportunity.id,
                                                                    selectedCheckoutPackageId,
                                                                    false,
                                                                )}
                                                                disabled={isAnyLeadAction || checkoutConsumed || !selectedCheckoutPackageId}
                                                                aria-busy={updatingCheckoutApprovalId === opportunity.id}
                                                                className="border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                                            >
                                                                Revocar pago
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateCheckoutApproval(
                                                                    lead.id,
                                                                    opportunity.id,
                                                                    selectedCheckoutPackageId,
                                                                    true,
                                                                )}
                                                                disabled={isAnyLeadAction || checkoutConsumed || !selectedCheckoutPackageId}
                                                                aria-busy={updatingCheckoutApprovalId === opportunity.id}
                                                                className="bg-[#006064] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#004d40] disabled:opacity-50"
                                                            >
                                                                Aprobar pago
                                                            </button>
                                                        )}
                                                    </div>
                                                    {checkoutApproved && opportunity.packages && (
                                                        <p className="mt-2 text-[11px] text-[#006064]">
                                                            Aprobado para {opportunity.packages.display_name?.[lang] || opportunity.packages.name}.
                                                        </p>
                                                    )}
                                                </div>
                                            )}

                                            {canSendLevelCheck && (
                                                <button
                                                    type="button"
                                                    onClick={() => sendLevelCheck(lead.id)}
                                                    disabled={isAnyLeadAction}
                                                    aria-busy={sendingLevelCheckId === lead.id}
                                                    className="bg-[#E0F7FA] text-[#006064] hover:bg-[#b2ebf2] px-3 py-1.5 rounded text-xs font-bold transition-colors disabled:opacity-50"
                                                >
                                                    {lead.level_check_status === 'sent' ? 'Reenviar diagnostico' : 'Enviar diagnostico'}
                                                </button>
                                            )}
                                            {lead.level_check_status === 'received' && (
                                                <button
                                                    type="button"
                                                    onClick={() => reviewLevelCheck(lead.id)}
                                                    disabled={isAnyLeadAction}
                                                    aria-busy={reviewingLevelCheckId === lead.id}
                                                    className="bg-white text-[#006064] hover:bg-[#E0F7FA] px-3 py-1.5 rounded text-xs font-bold transition-colors border border-[#006064] disabled:opacity-50"
                                                >
                                                    Revisar y limpiar
                                                </button>
                                            )}
                                            {canSendSalesEmail && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendSalesEmail(lead.id, 'missing_info')}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={sendingSalesEmailId === `${lead.id}:missing_info`}
                                                        className="bg-white text-[#006064] hover:bg-[#E0F7FA] px-3 py-1.5 rounded text-xs font-bold transition-colors border border-[#006064] disabled:opacity-50"
                                                    >
                                                        Pedir info
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendSalesEmail(lead.id, 'proposal_next_step')}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={sendingSalesEmailId === `${lead.id}:proposal_next_step`}
                                                        className="bg-[#006064] text-white hover:bg-[#004d40] px-3 py-1.5 rounded text-xs font-bold transition-colors disabled:opacity-50"
                                                    >
                                                        Enviar propuesta
                                                    </button>
                                                </>
                                            )}

                                            {/* Action Buttons */}
                                            {lead.status === 'new' && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateStatus(lead.id, 'contacted')}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={updatingId === lead.id}
                                                        className="bg-[#6A131C] text-white hover:bg-[#8A1924] px-3 py-1.5 rounded text-xs font-medium transition-colors shadow-sm disabled:opacity-50"
                                                    >
                                                        Marcar contactada
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateStatus(lead.id, 'discarded')}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={updatingId === lead.id}
                                                        className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                                    >
                                                        Descartar
                                                    </button>
                                                </>
                                            )}
                                            {lead.status === 'contacted' && (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateStatus(lead.id, 'new')}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={updatingId === lead.id}
                                                        className="bg-gray-200 text-gray-700 hover:bg-gray-300 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                                    >
                                                        Reabrir
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateStatus(lead.id, 'discarded')}
                                                        disabled={isAnyLeadAction}
                                                        aria-busy={updatingId === lead.id}
                                                        className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                                    >
                                                        Descartar
                                                    </button>
                                                </>
                                            )}
                                            {lead.status === 'discarded' && (
                                                <button
                                                    type="button"
                                                    onClick={() => updateStatus(lead.id, 'new')}
                                                    disabled={isAnyLeadAction}
                                                    aria-busy={updatingId === lead.id}
                                                    className="bg-gray-200 text-gray-700 hover:bg-gray-300 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                                >
                                                    Reabrir
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const emptyLeadPipelineSummary: LeadPipelineSummary = {
    totalLeads: 0,
    contactedLeads: 0,
    discardedLeads: 0,
    qualifiedLeadCount: 0,
    activePipelineCount: 0,
    wonOpportunities: 0,
    lostOpportunities: 0,
    contactedRate: 0,
    wonRate: 0,
    topSourcePaths: [],
    topInterests: [],
    topPreferredPackages: [],
    levelSummary: [],
    pipelineStageSummary: [],
    sourcePerformance: [],
};

function countBy<T>(items: T[], getLabel: (item: T) => string): SummaryItem[] {
    const counts = new Map<string, number>();

    for (const item of items) {
        const label = getLabel(item).trim() || 'Sin dato';
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }

    return Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'es'))
        .slice(0, 4);
}

function isContactedStage(stage: PipelineStage | null | undefined) {
    return !!stage && !['new', 'to_contact'].includes(stage);
}

function isQualifiedStage(stage: PipelineStage | null | undefined) {
    return !!stage && ['qualified', 'proposal', 'won'].includes(stage);
}

function buildVisibleLeadSummary(leads: Lead[]): LeadPipelineSummary {
    const contactedLeads = leads.filter((lead) => lead.status === 'contacted' || isContactedStage(lead.crm_opportunity?.stage)).length;
    const qualifiedLeadCount = leads.filter((lead) => isQualifiedStage(lead.crm_opportunity?.stage)).length;
    const wonOpportunities = leads.filter((lead) => lead.crm_opportunity?.stage === 'won').length;
    const lostOpportunities = leads.filter((lead) => lead.crm_opportunity?.stage === 'lost').length;
    const activePipelineCount = leads.filter((lead) => lead.crm_opportunity && !['won', 'lost'].includes(lead.crm_opportunity.stage)).length;
    const sourcePerformance = leads.reduce<Map<string, SourcePerformanceItem>>((map, lead) => {
        const sourcePath = lead.source_path || 'Sin ruta';
        const item = map.get(sourcePath) ?? { sourcePath, total: 0, contacted: 0, qualified: 0, won: 0 };
        item.total += 1;
        if (lead.status === 'contacted' || isContactedStage(lead.crm_opportunity?.stage)) item.contacted += 1;
        if (isQualifiedStage(lead.crm_opportunity?.stage)) item.qualified += 1;
        if (lead.crm_opportunity?.stage === 'won') item.won += 1;
        map.set(sourcePath, item);
        return map;
    }, new Map());

    return {
        totalLeads: leads.length,
        contactedLeads,
        discardedLeads: leads.filter((lead) => lead.status === 'discarded').length,
        qualifiedLeadCount,
        activePipelineCount,
        wonOpportunities,
        lostOpportunities,
        contactedRate: leads.length > 0 ? Math.round((contactedLeads / leads.length) * 100) : 0,
        wonRate: leads.length > 0 ? Math.round((wonOpportunities / leads.length) * 100) : 0,
        topSourcePaths: countBy(leads, (lead) => lead.source_path || 'Sin ruta'),
        topInterests: countBy(leads, (lead) => lead.interest || 'Sin interes'),
        topPreferredPackages: countBy(leads, (lead) => lead.preferred_package || 'Sin plan'),
        levelSummary: countBy(leads, (lead) => lead.current_level || 'Sin nivel'),
        pipelineStageSummary: countBy(leads.filter((lead) => lead.crm_opportunity), (lead) => lead.crm_opportunity?.stage || 'Sin etapa'),
        sourcePerformance: Array.from(sourcePerformance.values()).slice(0, 5),
    };
}

function mapPipelineStageToLeadStatus(stage: PipelineStage): LeadStatus {
    if (stage === 'lost') return 'discarded';
    if (stage === 'new' || stage === 'to_contact') return 'new';
    return 'contacted';
}
