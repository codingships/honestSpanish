import React, { useEffect, useMemo, useRef, useState } from 'react';
import { eurosToCents } from '../../lib/money-input';

type Nullable<T> = T | null | undefined;

type Summary = {
    totalGrossCollectedCents?: number;
    totalRefundsCents?: number;
    totalNetRevenueCents?: number;
    totalTeacherObligationCents?: number;
    totalDirectCostCents?: number;
    totalAcquisitionAllocatedCents?: number;
    totalStripeFeeCents?: Nullable<number>;
    stripeFeeReconciliationStatus?: 'pending' | 'reconciled' | string;
    unreconciledPaymentCount?: number;
    totalProvisionalContributionCents?: Nullable<number>;
    totalCampaignSpendCents?: number;
    totalUnallocatedCampaignSpendCents?: number;
};

type Campaign = {
    id: string;
    name?: string;
    provider?: string;
    attributionMode?: 'observed_utm' | 'manual' | string;
    utmSource?: Nullable<string>;
    utmMedium?: Nullable<string>;
    utmCampaign?: Nullable<string>;
    utmTerm?: Nullable<string>;
    utmContent?: Nullable<string>;
    netSpendCents?: number;
    allocatedAcquisitionCents?: number;
    unallocatedAcquisitionCents?: number;
    studentCount?: number;
    grossCollectedCents?: number;
    refundsCents?: number;
    netCollectedCents?: number;
    teacherObligationCents?: number;
    directCostCents?: number;
    stripeFeeCents?: Nullable<number>;
    stripeFeeReconciliationStatus?: 'pending' | 'reconciled' | string;
    unreconciledPaymentCount?: number;
    provisionalContributionCents?: Nullable<number>;
};

type StudentEconomics = {
    studentId: string;
    studentName?: Nullable<string>;
    studentEmail?: Nullable<string>;
    grossCollectedCents?: number;
    refundsCents?: number;
    netCollectedCents?: number;
    teacherObligationCents?: number;
    directCostCents?: number;
    acquisitionCostCents?: number;
    stripeFeeCents?: Nullable<number>;
    stripeFeeReconciliationStatus?: 'pending' | 'reconciled' | string;
    unreconciledPaymentCount?: number;
    provisionalContributionCents?: Nullable<number>;
    campaignId?: Nullable<string>;
    campaignName?: Nullable<string>;
    acquisitionBasis?: Nullable<string>;
    firstCycleId?: Nullable<string>;
};

type CostEntry = {
    entryId: string;
    costKind?: string;
    campaignId?: Nullable<string>;
    studentId?: Nullable<string>;
    originalAmountCents?: number;
    adjustmentAmountCents?: number;
    netAmountCents?: number;
    currency?: string;
    incurredAt?: string;
    description?: string;
};

type Allocation = {
    entryId: string;
    campaignId?: Nullable<string>;
    campaignName?: Nullable<string>;
    studentId?: Nullable<string>;
    studentName?: Nullable<string>;
    originalAmountCents?: number;
    adjustmentAmountCents?: number;
    netAmountCents?: number;
    basis?: string;
    reason?: string;
};

type Candidate = {
    studentId: string;
    studentName?: Nullable<string>;
    studentEmail?: Nullable<string>;
    contactId?: Nullable<string>;
    firstSubscriptionId?: Nullable<string>;
    firstCycleId?: Nullable<string>;
    attributionEventId?: Nullable<string>;
    utmSource?: Nullable<string>;
    utmMedium?: Nullable<string>;
    utmCampaign?: Nullable<string>;
    utmTerm?: Nullable<string>;
    utmContent?: Nullable<string>;
    hasActiveAllocation?: boolean;
};

type FeeReconciliation = {
    paymentId: string;
    studentId: string;
    studentName?: Nullable<string>;
    studentEmail?: Nullable<string>;
    grossAmountCents?: number;
    amountRefundedCents?: number;
    currency?: string;
    status?: string;
    lastErrorCode?: Nullable<string>;
    lastAttemptedAt?: Nullable<string>;
};

type ProfitabilityResponse = {
    summary?: Summary;
    campaigns?: Campaign[];
    students?: StudentEconomics[];
    costs?: CostEntry[];
    allocations?: Allocation[];
    candidates?: Candidate[];
    feeReconciliations?: FeeReconciliation[];
    pagination?: {
        page?: number;
        limit?: number;
        studentsHasMore?: boolean;
        costsHasMore?: boolean;
        allocationsHasMore?: boolean;
    };
};

type Props = { lang?: string };

const emptyData: Required<Pick<ProfitabilityResponse, 'summary' | 'campaigns' | 'students' | 'costs' | 'allocations' | 'candidates' | 'feeReconciliations'>> = {
    summary: {}, campaigns: [], students: [], costs: [], allocations: [], candidates: [], feeReconciliations: [],
};

function money(cents: Nullable<number>, currency = 'EUR'): string {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format((cents ?? 0) / 100);
}

function moneyOrPending(cents: Nullable<number>, currency = 'EUR'): string {
    return cents == null ? 'Pendiente de conciliar' : money(cents, currency);
}

function dateTimeLabel(value: Nullable<string>): string {
    if (!value) return 'Nunca';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('es-ES') : 'No disponible';
}

function candidateLabel(candidate: Candidate): string {
    return candidate.studentName || candidate.studentEmail || candidate.studentId;
}

function campaignLabel(campaign: Campaign): string {
    const utm = [campaign.utmSource, campaign.utmMedium, campaign.utmCampaign].filter(Boolean).join(' / ');
    return `${campaign.name || 'Campaña sin nombre'}${utm ? ` · ${utm}` : ''}`;
}

function localDateTimeValue(): string {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

function stablePayloadKey(action: string, payload: Record<string, unknown>): string {
    const normalize = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(normalize);
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, nested]) => [key, normalize(nested)]));
        }
        return value;
    };
    return `${action}:${JSON.stringify(normalize(payload))}`;
}

export default function ProfitabilityManager({ lang = 'es' }: Props) {
    const [data, setData] = useState<ProfitabilityResponse>(emptyData);
    const [page, setPage] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    const [mutating, setMutating] = useState(false);
    const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
    const pendingRequestIds = useRef(new Map<string, string>());
    const [candidateQuery, setCandidateQuery] = useState('');
    const [appliedCandidateQuery, setAppliedCandidateQuery] = useState('');

    const [campaignName, setCampaignName] = useState('');
    const [campaignProvider, setCampaignProvider] = useState('');
    const [campaignExternalReference, setCampaignExternalReference] = useState('');
    const [campaignMode, setCampaignMode] = useState<'observed_utm' | 'manual'>('observed_utm');
    const [campaignUtmSource, setCampaignUtmSource] = useState('');
    const [campaignUtmMedium, setCampaignUtmMedium] = useState('');
    const [campaignUtmCampaign, setCampaignUtmCampaign] = useState('');
    const [campaignUtmTerm, setCampaignUtmTerm] = useState('');
    const [campaignUtmContent, setCampaignUtmContent] = useState('');

    const [costKind, setCostKind] = useState<'acquisition_spend' | 'delivery_material' | 'student_tool' | 'other_direct'>('acquisition_spend');
    const [costCampaignId, setCostCampaignId] = useState('');
    const [costStudentId, setCostStudentId] = useState('');
    const [costAmount, setCostAmount] = useState('');
    const [costIncurredAt, setCostIncurredAt] = useState(localDateTimeValue);
    const [costDescription, setCostDescription] = useState('');

    const [allocationCampaignId, setAllocationCampaignId] = useState('');
    const [allocationStudentId, setAllocationStudentId] = useState('');
    const [allocationBasis, setAllocationBasis] = useState<'observed_checkout' | 'manual'>('observed_checkout');
    const [allocationAmount, setAllocationAmount] = useState('');
    const [allocationReason, setAllocationReason] = useState('');

    const [adjustmentTarget, setAdjustmentTarget] = useState('');
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentReason, setAdjustmentReason] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        const params = new URLSearchParams({ page: String(page), limit: '25' });
        if (appliedCandidateQuery) params.set('candidateQuery', appliedCandidateQuery);
        setLoading(true);
        fetch(`/api/admin/profitability?${params.toString()}`, { signal: controller.signal })
            .then(async (response) => {
                const payload = await response.json() as ProfitabilityResponse & { error?: string };
                if (!response.ok) throw new Error(payload.error || 'No se pudo cargar la rentabilidad');
                setData({ ...emptyData, ...payload });
            })
            .catch((error: unknown) => {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'No se pudo cargar la rentabilidad' });
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [page, refresh, appliedCandidateQuery]);

    const campaigns = useMemo(() => data.campaigns || [], [data.campaigns]);
    const candidates = useMemo(() => data.candidates || [], [data.candidates]);
    const allocationCandidates = useMemo(
        () => candidates.filter((candidate) => !candidate.hasActiveAllocation),
        [candidates],
    );
    const selectedCostCandidate = candidates.find((candidate) => candidate.studentId === costStudentId);
    const selectedAllocationCandidate = allocationCandidates.find((candidate) => candidate.studentId === allocationStudentId);
    const summary = data.summary || {};
    const hasMore = Boolean(data.pagination?.studentsHasMore || data.pagination?.costsHasMore || data.pagination?.allocationsHasMore);

    const movementOptions = useMemo(() => [
        ...(data.costs || []).map((entry) => ({ value: `cost:${entry.entryId}`, label: `Coste · ${entry.description || entry.costKind || entry.entryId}` })),
        ...(data.allocations || []).map((entry) => ({ value: `allocation:${entry.entryId}`, label: `Asignación · ${entry.studentName || entry.studentId || entry.entryId}` })),
    ], [data.costs, data.allocations]);

    const eligibleAllocationCampaigns = useMemo(() => campaigns.filter((campaign) => {
        if (allocationBasis === 'manual') return true;
        if (campaign.attributionMode !== 'observed_utm') return false;
        if (!selectedAllocationCandidate) return true;
        return campaign.utmSource === selectedAllocationCandidate.utmSource
            && campaign.utmMedium === selectedAllocationCandidate.utmMedium
            && campaign.utmCampaign === selectedAllocationCandidate.utmCampaign
            && (campaign.utmTerm ?? null) === (selectedAllocationCandidate.utmTerm ?? null)
            && (campaign.utmContent ?? null) === (selectedAllocationCandidate.utmContent ?? null);
    }), [allocationBasis, campaigns, selectedAllocationCandidate]);

    useEffect(() => {
        if (allocationCampaignId && !eligibleAllocationCampaigns.some((campaign) => campaign.id === allocationCampaignId)) {
            setAllocationCampaignId('');
        }
    }, [allocationCampaignId, eligibleAllocationCampaigns]);

    useEffect(() => {
        if (allocationStudentId && !allocationCandidates.some((candidate) => candidate.studentId === allocationStudentId)) {
            setAllocationStudentId('');
        }
    }, [allocationCandidates, allocationStudentId]);

    async function postAction(action: string, payload: Record<string, unknown>, successText: string): Promise<boolean> {
        const requestKey = stablePayloadKey(action, payload);
        let requestId = pendingRequestIds.current.get(requestKey);
        if (!requestId) {
            requestId = crypto.randomUUID();
            pendingRequestIds.current.set(requestKey, requestId);
        }
        setMutating(true);
        setMessage(null);
        try {
            const response = await fetch('/api/admin/profitability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, requestId, ...payload }),
            });
            const body = await response.json() as { error?: string };
            if (!response.ok) throw new Error(body.error || 'No se pudo registrar el movimiento');
            pendingRequestIds.current.delete(requestKey);
            setMessage({ kind: 'success', text: successText });
            setRefresh((value) => value + 1);
            return true;
        } catch (error) {
            setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'No se pudo registrar el movimiento' });
            return false;
        } finally {
            setMutating(false);
        }
    }

    async function submitCost(event: React.FormEvent) {
        event.preventDefault();
        const amountCents = eurosToCents(costAmount);
        if (!amountCents || amountCents <= 0) return setMessage({ kind: 'error', text: 'Introduce un importe positivo con un máximo de dos decimales.' });
        if (costKind === 'acquisition_spend' && !costCampaignId) return setMessage({ kind: 'error', text: 'Selecciona la campaña que soporta este gasto.' });
        if (costKind !== 'acquisition_spend' && !selectedCostCandidate) return setMessage({ kind: 'error', text: 'Selecciona el alumno al que corresponde el coste directo.' });
        if (costDescription.trim().length < 5) return setMessage({ kind: 'error', text: 'Describe el coste con al menos cinco caracteres.' });
        const succeeded = await postAction('record_cost', {
            costKind,
            campaignId: costKind === 'acquisition_spend' ? costCampaignId : null,
            studentId: costKind === 'acquisition_spend' ? null : selectedCostCandidate?.studentId || null,
            amountCents,
            incurredAt: new Date(costIncurredAt).toISOString(),
            description: costDescription.trim(),
        }, costKind === 'acquisition_spend' ? 'Gasto de captación registrado' : 'Coste directo registrado');
        if (!succeeded) return;
        setCostAmount('');
        setCostDescription('');
    }

    async function submitCampaign(event: React.FormEvent) {
        event.preventDefault();
        if (campaignName.trim().length < 2 || campaignProvider.trim().length < 2) return setMessage({ kind: 'error', text: 'Indica un nombre y proveedor reconocibles.' });
        if (campaignMode === 'observed_utm' && (!campaignUtmSource.trim() || !campaignUtmMedium.trim() || !campaignUtmCampaign.trim())) return setMessage({ kind: 'error', text: 'Una campaña observada necesita source, medium y campaign.' });
        const succeeded = await postAction('create_campaign', {
            name: campaignName.trim(),
            provider: campaignProvider.trim(),
            externalReference: campaignExternalReference.trim() || null,
            attributionMode: campaignMode,
            utmSource: campaignMode === 'observed_utm' ? campaignUtmSource.trim() : null,
            utmMedium: campaignMode === 'observed_utm' ? campaignUtmMedium.trim() : null,
            utmCampaign: campaignMode === 'observed_utm' ? campaignUtmCampaign.trim() : null,
            utmTerm: campaignMode === 'observed_utm' ? campaignUtmTerm.trim() || null : null,
            utmContent: campaignMode === 'observed_utm' ? campaignUtmContent.trim() || null : null,
        }, 'Campaña creada');
        if (!succeeded) return;
        setCampaignName('');
        setCampaignProvider('');
        setCampaignExternalReference('');
        setCampaignUtmSource('');
        setCampaignUtmMedium('');
        setCampaignUtmCampaign('');
        setCampaignUtmTerm('');
        setCampaignUtmContent('');
    }

    async function submitAllocation(event: React.FormEvent) {
        event.preventDefault();
        const amountCents = eurosToCents(allocationAmount);
        if (!amountCents || amountCents <= 0) return setMessage({ kind: 'error', text: 'Introduce un importe positivo con un máximo de dos decimales.' });
        if (!allocationCampaignId || !selectedAllocationCandidate) return setMessage({ kind: 'error', text: 'Selecciona campaña y candidato pagado.' });
        if (!selectedAllocationCandidate.firstCycleId) return setMessage({ kind: 'error', text: 'El candidato aún no tiene primer ciclo pagado utilizable.' });
        if (allocationBasis === 'observed_checkout' && !selectedAllocationCandidate.attributionEventId) return setMessage({ kind: 'error', text: 'Este candidato no tiene checkout observado; usa asignación manual y documenta el motivo.' });
        if (allocationReason.trim().length < 5) return setMessage({ kind: 'error', text: 'Explica la asignación con al menos cinco caracteres.' });
        const succeeded = await postAction('record_allocation', {
            campaignId: allocationCampaignId,
            studentId: selectedAllocationCandidate.studentId,
            checkoutAttributionEventId: allocationBasis === 'observed_checkout' ? selectedAllocationCandidate.attributionEventId : null,
            basis: allocationBasis,
            amountCents,
            reason: allocationReason.trim(),
        }, 'Coste de captación asignado explícitamente');
        if (!succeeded) return;
        setAllocationAmount('');
        setAllocationReason('');
    }

    async function submitAdjustment(event: React.FormEvent) {
        event.preventDefault();
        const amountDeltaCents = eurosToCents(adjustmentAmount, true);
        const [kind, entryId] = adjustmentTarget.split(':');
        if (!entryId || !['cost', 'allocation'].includes(kind)) return setMessage({ kind: 'error', text: 'Selecciona el movimiento que quieres corregir.' });
        if (!amountDeltaCents) return setMessage({ kind: 'error', text: 'El ajuste debe ser distinto de cero y tener como máximo dos decimales.' });
        if (adjustmentReason.trim().length < 5) return setMessage({ kind: 'error', text: 'Explica el ajuste con al menos cinco caracteres.' });
        const succeeded = await postAction(kind === 'cost' ? 'adjust_cost' : 'adjust_allocation', {
            ...(kind === 'cost' ? { costEntryId: entryId } : { allocationEntryId: entryId }),
            amountDeltaCents,
            reason: adjustmentReason.trim(),
        }, 'Ajuste compensatorio registrado');
        if (!succeeded) return;
        setAdjustmentAmount('');
        setAdjustmentReason('');
    }

    async function retryStripeFee(paymentId: string) {
        await postAction(
            'reconcile_stripe_fee',
            { paymentId },
            'Comisión de Stripe conciliada',
        );
    }

    return (
        <div className="space-y-8" aria-busy={loading || mutating}>
            {message && <div role={message.kind === 'error' ? 'alert' : 'status'} className={`border-2 p-4 text-sm font-bold ${message.kind === 'error' ? 'border-red-800 bg-red-50 text-red-900' : 'border-[#006064] bg-white text-[#006064]'}`}>{message.text}</div>}

            <section aria-labelledby="totals-heading">
                <h2 id="totals-heading" className="font-display text-2xl uppercase text-[#006064]">Totales observados</h2>
                {(summary.unreconciledPaymentCount ?? 0) > 0 && (
                    <p role="status" className="mt-3 border-2 border-amber-700 bg-amber-50 p-4 text-sm font-bold text-amber-950">
                        Hay {summary.unreconciledPaymentCount} cobro{summary.unreconciledPaymentCount === 1 ? '' : 's'} sin comisiones conciliadas. La contribución permanece oculta hasta tener el coste real de Stripe.
                    </p>
                )}
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                        { label: 'Cobrado bruto', value: summary.totalGrossCollectedCents },
                        { label: 'Devuelto', value: summary.totalRefundsCents },
                        { label: 'Ingreso neto', value: summary.totalNetRevenueCents },
                        { label: 'Comisiones Stripe', value: summary.totalStripeFeeCents, pendingAware: true },
                        { label: 'Obligación docente', value: summary.totalTeacherObligationCents },
                        { label: 'Coste directo', value: summary.totalDirectCostCents },
                        { label: 'Captación asignada', value: summary.totalAcquisitionAllocatedCents },
                        { label: 'Contribución provisional', value: summary.totalProvisionalContributionCents, pendingAware: true },
                        { label: 'Gasto de campaña', value: summary.totalCampaignSpendCents },
                        { label: 'Gasto sin asignar', value: summary.totalUnallocatedCampaignSpendCents },
                    ].map(({ label, value, pendingAware }) => <div key={label} className="border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0_0_#006064]"><p className="font-display text-2xl text-[#006064]">{pendingAware ? moneyOrPending(value) : money(value)}</p><p className="mt-1 font-mono text-xs uppercase text-[#006064]">{label}</p></div>)}
                </div>
            </section>

            <section aria-labelledby="stripe-fees-heading" className="space-y-4">
                <div>
                    <h2 id="stripe-fees-heading" className="font-display text-2xl uppercase text-[#006064]">Conciliación Stripe</h2>
                    <p className="mt-1 text-sm text-[#006064]">Cada comisión procede de la transacción de saldo de Stripe; un cobro pendiente nunca se interpreta como comisión cero.</p>
                </div>
                {(data.feeReconciliations || []).length > 0 ? (
                    <div className="overflow-x-auto border-2 border-[#006064] bg-white" tabIndex={0} aria-label="Cobros pendientes de conciliar con Stripe">
                        <table className="w-full min-w-[900px] text-sm">
                            <caption className="sr-only">Cobros de Stripe cuya comisión todavía no está conciliada</caption>
                            <thead className="bg-[#006064] text-white"><tr>{['Alumno', 'Cobrado', 'Devuelto', 'Último intento', 'Motivo técnico', 'Acción'].map((label) => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead>
                            <tbody className="divide-y divide-[#006064]/20">
                                {(data.feeReconciliations || []).map((fee) => <tr key={fee.paymentId}>
                                    <td className="p-3"><a href={`/${lang}/campus/admin/student/${fee.studentId}`} className="font-bold text-[#006064] underline">{fee.studentName || fee.studentEmail || fee.studentId}</a></td>
                                    <td className="p-3 text-[#006064]">{money(fee.grossAmountCents, fee.currency || 'EUR')}</td>
                                    <td className="p-3 text-[#006064]">{money(fee.amountRefundedCents, fee.currency || 'EUR')}</td>
                                    <td className="p-3 text-[#006064]">{dateTimeLabel(fee.lastAttemptedAt)}</td>
                                    <td className="p-3 font-mono text-xs text-[#006064]">{fee.lastErrorCode || 'Pendiente inicial'}</td>
                                    <td className="p-3"><button type="button" onClick={() => retryStripeFee(fee.paymentId)} disabled={mutating} className="border-2 border-[#006064] px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Reintentar</button></td>
                                </tr>)}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p role="status" className="border-2 border-[#006064] bg-white p-4 text-sm font-bold text-[#006064]">No hay cobros pendientes de conciliación.</p>
                )}
            </section>

            <section aria-labelledby="create-campaign-heading" className="space-y-4">
                <div><h2 id="create-campaign-heading" className="font-display text-2xl uppercase text-[#006064]">Crear campaña</h2><p className="mt-1 text-sm text-[#006064]">Usa UTM observados cuando la campaña será medible en checkout; el modo manual deja los cinco campos UTM vacíos.</p></div>
                <form onSubmit={submitCampaign} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-2 xl:grid-cols-3">
                    <label className="text-sm font-bold text-[#006064]">Nombre<input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} minLength={2} maxLength={200} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064]">Proveedor<input value={campaignProvider} onChange={(event) => setCampaignProvider(event.target.value)} minLength={2} maxLength={100} placeholder="Google Ads" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064]">Referencia externa opcional<input value={campaignExternalReference} onChange={(event) => setCampaignExternalReference(event.target.value)} maxLength={200} disabled={mutating} className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064]">Atribución<select value={campaignMode} onChange={(event) => setCampaignMode(event.target.value as typeof campaignMode)} disabled={mutating} className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="observed_utm">UTM observado</option><option value="manual">Manual sin UTM</option></select></label>
                    {campaignMode === 'observed_utm' && <>
                        <label className="text-sm font-bold text-[#006064]">utm_source<input value={campaignUtmSource} onChange={(event) => setCampaignUtmSource(event.target.value)} maxLength={100} pattern="[A-Za-z0-9._~-]+" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                        <label className="text-sm font-bold text-[#006064]">utm_medium<input value={campaignUtmMedium} onChange={(event) => setCampaignUtmMedium(event.target.value)} maxLength={100} pattern="[A-Za-z0-9._~-]+" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                        <label className="text-sm font-bold text-[#006064]">utm_campaign<input value={campaignUtmCampaign} onChange={(event) => setCampaignUtmCampaign(event.target.value)} maxLength={100} pattern="[A-Za-z0-9._~-]+" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                        <label className="text-sm font-bold text-[#006064]">utm_term opcional<input value={campaignUtmTerm} onChange={(event) => setCampaignUtmTerm(event.target.value)} maxLength={100} pattern="[A-Za-z0-9._~-]+" disabled={mutating} className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                        <label className="text-sm font-bold text-[#006064]">utm_content opcional<input value={campaignUtmContent} onChange={(event) => setCampaignUtmContent(event.target.value)} maxLength={100} pattern="[A-Za-z0-9._~-]+" disabled={mutating} className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    </>}
                    <button type="submit" disabled={mutating} className="w-fit border-2 border-[#006064] bg-[#006064] px-5 py-3 text-xs font-bold uppercase text-white disabled:opacity-50">Crear campaña</button>
                </form>
            </section>

            <section aria-labelledby="record-cost-heading" className="space-y-4">
                <div><h2 id="record-cost-heading" className="font-display text-2xl uppercase text-[#006064]">Registrar coste real</h2><p className="mt-1 text-sm text-[#006064]">El gasto de campaña queda pendiente hasta que se asigne expresamente. Los costes directos se vinculan al alumno seleccionado.</p></div>
                <form onSubmit={submitCost} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-2 xl:grid-cols-3">
                    <label className="text-sm font-bold text-[#006064]">Tipo de coste<select value={costKind} onChange={(event) => setCostKind(event.target.value as typeof costKind)} disabled={mutating} className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="acquisition_spend">Gasto de captación</option><option value="delivery_material">Material de entrega</option><option value="student_tool">Herramienta del alumno</option><option value="other_direct">Otro coste directo</option></select></label>
                    {costKind === 'acquisition_spend' ? <label className="text-sm font-bold text-[#006064]">Campaña<select value={costCampaignId} onChange={(event) => setCostCampaignId(event.target.value)} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="">Seleccionar</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaignLabel(campaign)}</option>)}</select></label> : <label className="text-sm font-bold text-[#006064]">Alumno<select value={costStudentId} onChange={(event) => setCostStudentId(event.target.value)} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="">Seleccionar candidato pagado</option>{candidates.map((candidate) => <option key={candidate.studentId} value={candidate.studentId}>{candidateLabel(candidate)}</option>)}</select></label>}
                    <label className="text-sm font-bold text-[#006064]">Importe EUR<input value={costAmount} onChange={(event) => setCostAmount(event.target.value)} inputMode="decimal" placeholder="200,00" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064]">Fecha del coste<input type="datetime-local" value={costIncurredAt} onChange={(event) => setCostIncurredAt(event.target.value)} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064] md:col-span-2 xl:col-span-3">Descripción<input value={costDescription} onChange={(event) => setCostDescription(event.target.value)} minLength={5} maxLength={1000} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <button type="submit" disabled={mutating} className="w-fit border-2 border-[#006064] bg-[#006064] px-5 py-3 text-xs font-bold uppercase text-white disabled:opacity-50">Registrar coste</button>
                </form>
            </section>

            <section aria-labelledby="allocation-heading" className="space-y-4">
                <div><h2 id="allocation-heading" className="font-display text-2xl uppercase text-[#006064]">Asignar captación</h2><p className="mt-1 text-sm text-[#006064]">La asignación es manual y explícita. Nunca se reparte automáticamente el gasto entre alumnos.</p></div>
                <form onSubmit={(event) => { event.preventDefault(); setPage(0); setAppliedCandidateQuery(candidateQuery.trim()); }} role="search" className="flex flex-col gap-3 sm:flex-row"><label className="flex-1 text-sm font-bold text-[#006064]">Buscar candidato pagado<input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Nombre o email" className="mt-1 w-full border-2 border-[#006064] bg-white p-3 font-normal" /></label><button type="submit" disabled={loading || mutating} className="self-end border-2 border-[#006064] px-5 py-3 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Buscar</button></form>
                <form onSubmit={submitAllocation} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-2 xl:grid-cols-3">
                    <label className="text-sm font-bold text-[#006064]">Campaña compatible<select value={allocationCampaignId} onChange={(event) => setAllocationCampaignId(event.target.value)} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="">Seleccionar</option>{eligibleAllocationCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaignLabel(campaign)}</option>)}</select></label>
                    <label className="text-sm font-bold text-[#006064]">Candidato pagado<select value={allocationStudentId} onChange={(event) => setAllocationStudentId(event.target.value)} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="">Seleccionar</option>{allocationCandidates.map((candidate) => <option key={candidate.studentId} value={candidate.studentId}>{candidateLabel(candidate)}</option>)}</select></label>
                    <label className="text-sm font-bold text-[#006064]">Base<select value={allocationBasis} onChange={(event) => setAllocationBasis(event.target.value as typeof allocationBasis)} disabled={mutating} className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="observed_checkout">Checkout observado</option><option value="manual">Asignación manual documentada</option></select></label>
                    <label className="text-sm font-bold text-[#006064]">Importe EUR<input value={allocationAmount} onChange={(event) => setAllocationAmount(event.target.value)} inputMode="decimal" placeholder="40,00" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064] md:col-span-2">Motivo<input value={allocationReason} onChange={(event) => setAllocationReason(event.target.value)} minLength={5} maxLength={1000} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <button type="submit" disabled={mutating} className="w-fit border-2 border-[#006064] bg-[#006064] px-5 py-3 text-xs font-bold uppercase text-white disabled:opacity-50">Registrar asignación explícita</button>
                </form>
            </section>

            <section aria-labelledby="adjustment-heading" className="space-y-4">
                <div><h2 id="adjustment-heading" className="font-display text-2xl uppercase text-[#006064]">Ajustar movimientos</h2><p className="mt-1 text-sm text-[#006064]">La corrección añade un movimiento compensatorio; no edita ni elimina el original.</p></div>
                <form onSubmit={submitAdjustment} className="grid gap-4 border-2 border-[#006064] bg-white p-5 md:grid-cols-3">
                    <label className="text-sm font-bold text-[#006064]">Movimiento<select value={adjustmentTarget} onChange={(event) => setAdjustmentTarget(event.target.value)} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal"><option value="">Seleccionar</option>{movementOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    <label className="text-sm font-bold text-[#006064]">Ajuste EUR<input value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} inputMode="decimal" placeholder="-10,00 o 10,00" disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <label className="text-sm font-bold text-[#006064]">Motivo<input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} minLength={5} maxLength={1000} disabled={mutating} required className="mt-1 w-full border-2 border-[#006064] p-3 font-normal" /></label>
                    <button type="submit" disabled={mutating} className="w-fit border-2 border-[#006064] px-5 py-3 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Registrar ajuste</button>
                </form>
            </section>

            <section aria-labelledby="campaigns-heading" className="space-y-4">
                <h2 id="campaigns-heading" className="font-display text-2xl uppercase text-[#006064]">Campañas</h2>
                <div className="overflow-x-auto border-2 border-[#006064] bg-white" tabIndex={0} aria-label="Contribución provisional por campaña">
                    <table className="w-full min-w-[1400px] text-sm">
                        <caption className="sr-only">Gasto, asignación, comisiones e ingresos por campaña</caption>
                        <thead className="bg-[#006064] text-white"><tr>{['Campaña', 'Gasto', 'Asignado', 'Sin asignar', 'Alumnos asignados', 'Ingreso neto', 'Comisiones Stripe', 'Obligación docente', 'Coste directo', 'Contribución provisional', 'Gasto / alumno asignado'].map((label) => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead>
                        <tbody className="divide-y divide-[#006064]/20">{campaigns.length ? campaigns.map((campaign) => {
                            const students = campaign.studentCount ?? 0;
                            const cac = students > 0 ? money(Math.round((campaign.netSpendCents ?? 0) / students)) : 'N/A';
                            const contributionClass = campaign.provisionalContributionCents != null && campaign.provisionalContributionCents < 0 ? 'text-red-800' : 'text-[#006064]';
                            return <tr key={campaign.id}><td className="p-3 font-bold text-[#006064]">{campaignLabel(campaign)}</td><td className="p-3 text-[#006064]">{money(campaign.netSpendCents)}</td><td className="p-3 text-[#006064]">{money(campaign.allocatedAcquisitionCents)}</td><td className="p-3 text-[#006064]">{money(campaign.unallocatedAcquisitionCents)}</td><td className="p-3 text-[#006064]">{students}</td><td className="p-3 text-[#006064]">{money(campaign.netCollectedCents)}</td><td className="p-3 text-[#006064]">{moneyOrPending(campaign.stripeFeeCents)}</td><td className="p-3 text-[#006064]">{money(campaign.teacherObligationCents)}</td><td className="p-3 text-[#006064]">{money(campaign.directCostCents)}</td><td className={`p-3 font-bold ${contributionClass}`}>{moneyOrPending(campaign.provisionalContributionCents)}</td><td className="p-3 text-[#006064]">{cac}</td></tr>;
                        }) : <tr><td colSpan={11} role="status" className="p-5 text-[#006064]">No hay campañas registradas.</td></tr>}</tbody>
                    </table>
                </div>
            </section>

            <section aria-labelledby="students-heading" className="space-y-4">
                <h2 id="students-heading" className="font-display text-2xl uppercase text-[#006064]">Alumnos</h2>
                <div className="overflow-x-auto border-2 border-[#006064] bg-white" tabIndex={0} aria-label="Contribución provisional por alumno">
                    <table className="w-full min-w-[1200px] text-sm">
                        <caption className="sr-only">Cobros, comisiones y costes observados por alumno</caption>
                        <thead className="bg-[#006064] text-white"><tr>{['Alumno', 'Campaña', 'Bruto', 'Devoluciones', 'Neto', 'Comisiones Stripe', 'Obligación docente', 'Coste directo', 'Captación asignada', 'Contribución provisional'].map((label) => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead>
                        <tbody className="divide-y divide-[#006064]/20">{(data.students || []).length ? data.students!.map((student) => {
                            const contributionClass = student.provisionalContributionCents != null && student.provisionalContributionCents < 0 ? 'text-red-800' : 'text-[#006064]';
                            return <tr key={student.studentId}><td className="p-3"><a href={`/${lang}/campus/admin/student/${student.studentId}`} className="font-bold text-[#006064] underline">{student.studentName || student.studentEmail || student.studentId}</a></td><td className="p-3 text-[#006064]">{student.campaignName || 'Sin campaña asignada'}</td><td className="p-3 text-[#006064]">{money(student.grossCollectedCents)}</td><td className="p-3 text-[#006064]">{money(student.refundsCents)}</td><td className="p-3 text-[#006064]">{money(student.netCollectedCents)}</td><td className="p-3 text-[#006064]">{moneyOrPending(student.stripeFeeCents)}</td><td className="p-3 text-[#006064]">{money(student.teacherObligationCents)}</td><td className="p-3 text-[#006064]">{money(student.directCostCents)}</td><td className="p-3 text-[#006064]">{money(student.acquisitionCostCents)}</td><td className={`p-3 font-bold ${contributionClass}`}>{moneyOrPending(student.provisionalContributionCents)}</td></tr>;
                        }) : <tr><td colSpan={10} role="status" className="p-5 text-[#006064]">No hay alumnos con ciclos pagados en este filtro.</td></tr>}</tbody>
                    </table>
                </div>
            </section>

            <nav aria-label="Paginación de rentabilidad" className="flex items-center justify-between gap-4"><button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={loading || mutating || page === 0} className="border-2 border-[#006064] px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Anterior</button><span className="font-mono text-xs uppercase text-[#006064]">Página {page + 1}</span><button type="button" onClick={() => setPage((value) => value + 1)} disabled={loading || mutating || !hasMore} className="border-2 border-[#006064] px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Siguiente</button></nav>
        </div>
    );
}
