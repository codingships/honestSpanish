import { useState } from 'react';

type PipelineStage = 'new' | 'to_contact' | 'contacted' | 'qualified' | 'proposal' | 'won' | 'lost' | 'nurture';
type ActionMessage = { type: 'success' | 'error'; text: string };

interface CrmOpportunityItem {
    id: string;
    stage: string;
    interest: string | null;
    current_level: string | null;
    learning_goal: string | null;
    availability?: string | null;
    packages?: {
        name: string;
        display_name: unknown;
    } | null;
}

interface CrmOpportunityListProps {
    opportunities: CrmOpportunityItem[];
    lang?: 'es' | 'en' | 'ru';
    emptyText?: string;
}

const stageLabels: Record<string, string> = {
    new: 'Nueva',
    to_contact: 'Por contactar',
    contacted: 'Contactada',
    qualified: 'Cualificada',
    proposal: 'Propuesta',
    won: 'Ganada',
    lost: 'Perdida',
    nurture: 'Pospuesta',
};

const stageOptions: Array<{ value: PipelineStage; label: string }> = [
    { value: 'new', label: stageLabels.new },
    { value: 'to_contact', label: stageLabels.to_contact },
    { value: 'contacted', label: stageLabels.contacted },
    { value: 'qualified', label: stageLabels.qualified },
    { value: 'proposal', label: stageLabels.proposal },
    { value: 'nurture', label: stageLabels.nurture },
    { value: 'won', label: stageLabels.won },
    { value: 'lost', label: stageLabels.lost },
];

function getDisplayName(displayName: unknown, lang: 'es' | 'en' | 'ru') {
    if (!displayName || typeof displayName !== 'object' || Array.isArray(displayName)) return null;
    const labels = displayName as Record<string, unknown>;
    const localized = labels[lang] || labels.es;
    return typeof localized === 'string' ? localized : null;
}

function getPackageName(opportunity: CrmOpportunityItem, lang: 'es' | 'en' | 'ru') {
    return getDisplayName(opportunity.packages?.display_name, lang) || opportunity.packages?.name || null;
}

export default function CrmOpportunityList({
    opportunities,
    lang = 'es',
    emptyText = 'Sin oportunidades abiertas.',
}: CrmOpportunityListProps) {
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<ActionMessage | null>(null);

    const updateStage = async (opportunityId: string, newStage: PipelineStage) => {
        setSavingId(opportunityId);
        setMessage(null);

        try {
            const response = await fetch('/api/admin/crm/contact-actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'update_opportunity_stage',
                    opportunityId,
                    newStage,
                }),
            });

            if (!response.ok) {
                const body = await response.json().catch(() => null) as { error?: string } | null;
                throw new Error(body?.error || 'No se pudo actualizar la oportunidad.');
            }

            setMessage({ type: 'success', text: 'Etapa actualizada.' });
            window.setTimeout(() => window.location.reload(), 350);
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo actualizar la oportunidad.' });
        } finally {
            setSavingId(null);
        }
    };

    if (opportunities.length === 0) {
        return <p className="text-[#006064]/60 font-mono text-sm">{emptyText}</p>;
    }

    return (
        <div className="space-y-3">
            {opportunities.map((opportunity) => {
                const packageName = getPackageName(opportunity, lang);
                const isSaving = savingId === opportunity.id;
                const isAnySaving = savingId !== null;

                return (
                    <div key={opportunity.id} className="border-b border-[#006064]/10 pb-3 last:border-0">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                                <p className="font-bold text-[#006064] text-sm">
                                    {stageLabels[opportunity.stage] || opportunity.stage}
                                </p>
                                <p className="text-xs text-[#006064]/70 mt-1">
                                    {opportunity.interest || 'Sin interes declarado'}
                                    {opportunity.current_level ? ` - ${opportunity.current_level.toUpperCase()}` : ''}
                                </p>
                                {packageName && <p className="text-xs text-[#006064]/70 mt-1">Plan: {packageName}</p>}
                                {opportunity.learning_goal && <p className="text-xs text-[#006064]/70 mt-1">{opportunity.learning_goal}</p>}
                                {opportunity.availability && <p className="text-xs text-[#006064]/70 mt-1">Disponibilidad: {opportunity.availability}</p>}
                            </div>

                            <label className="w-full text-left text-[11px] font-bold uppercase text-[#006064] md:w-auto md:text-right">
                                Etapa CRM
                                <select
                                    value={opportunity.stage}
                                    onChange={(event) => updateStage(opportunity.id, event.target.value as PipelineStage)}
                                    disabled={isAnySaving}
                                    aria-busy={isSaving}
                                    className="mt-1 block w-full border border-[#006064] bg-white px-2 py-1 text-xs normal-case text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 disabled:opacity-50 md:w-40"
                                >
                                    {stageOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                        </div>
                    </div>
                );
            })}

            {message && (
                <p role={message.type === 'success' ? 'status' : 'alert'} className="font-mono text-xs text-[#006064]">{message.text}</p>
            )}
        </div>
    );
}
