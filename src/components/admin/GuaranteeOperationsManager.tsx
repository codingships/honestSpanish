import React, { useCallback, useEffect, useState } from 'react';

type OperationStatus = 'requested' | 'processing' | 'refund_pending' | 'refunded' | 'retryable' | 'manual_review';

type Operation = {
    id: string;
    subscriptionId: string;
    cycleId: string;
    packagePriceId: string;
    cycleNumber: number;
    sessionsTotal: number;
    sessionsConsumed: number;
    sessionsRefundable: number;
    student: { id: string; fullName: string | null; email: string | null } | null;
    status: OperationStatus;
    grossCents: number;
    guaranteeRefundCents: number;
    refundedCents: number;
    netCents: number;
    currency: string;
    payment: { id: string; status: string } | null;
    stripeRefundId: string | null;
    stripeRefundStatus: string | null;
    createdAt: string;
    updatedAt: string;
    refundCreatedAt: string | null;
    refundedAt: string | null;
    supportTicket: { id: string; status: string; title: string } | null;
    lastError: string | null;
};

type Resolution = {
    id: string;
    admin_id: string;
    original_status: string;
    incident_at: string;
    reason: string;
    created_at: string;
};

type Incident = {
    sessionId: string;
    subscriptionId: string;
    cycleId: string;
    cycleNumber: number;
    cycleKind: string;
    sessionIndex: number;
    student: { id: string; fullName: string | null; email: string | null };
    originalStatus: string;
    scheduledAt: string | null;
    incidentAt: string | null;
    canExcuse: boolean;
    resolution: Resolution | null;
};

type ApiResponse = {
    operations?: Operation[];
    incidents?: Incident[];
    guarantee?: { status?: string };
    resolution?: Resolution;
    error?: string;
};

type Props = {
    lang: 'es' | 'en' | 'ru';
    studentId?: string | null;
};

const statuses: Array<OperationStatus | 'all'> = [
    'all',
    'requested',
    'processing',
    'refund_pending',
    'retryable',
    'manual_review',
    'refunded',
];

const statusLabels: Record<OperationStatus | 'all', string> = {
    all: 'Todas',
    requested: 'Solicitada',
    processing: 'Procesando',
    refund_pending: 'Stripe pendiente',
    refunded: 'Devuelta',
    retryable: 'Reintentable',
    manual_review: 'Revisión manual',
};

const resumableStatuses = new Set<OperationStatus>(['requested', 'processing', 'refund_pending', 'retryable']);

function formatMoney(cents: number, currency: string) {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: currency.toUpperCase(),
    }).format(cents / 100);
}

function formatDate(value: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function shortId(value: string) {
    return value.replace(/-/g, '').slice(-8).toUpperCase();
}

function statusClass(status: OperationStatus) {
    if (status === 'refunded') return 'bg-green-100 text-green-800';
    if (status === 'manual_review') return 'bg-red-100 text-red-800';
    if (status === 'retryable') return 'bg-amber-100 text-amber-900';
    return 'bg-blue-100 text-blue-800';
}

export default function GuaranteeOperationsManager({ lang, studentId = null }: Props) {
    const [status, setStatus] = useState<OperationStatus | 'all'>('all');
    const [operations, setOperations] = useState<Operation[]>([]);
    const [incidents, setIncidents] = useState<Incident[]>([]);
    const [reasons, setReasons] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [workingKey, setWorkingKey] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (signal?: AbortSignal) => {
        setIsLoading(true);
        setError(null);
        const params = new URLSearchParams({ status });
        if (studentId) params.set('studentId', studentId);
        try {
            const response = await fetch(`/api/admin/guarantees?${params.toString()}`, {
                signal,
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            const payload = await response.json().catch(() => ({})) as ApiResponse;
            if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar las garantías');
            if (signal?.aborted) return;
            setOperations(payload.operations ?? []);
            setIncidents(payload.incidents ?? []);
        } catch (loadError) {
            if (signal?.aborted) return;
            setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las garantías');
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, [status, studentId]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const postAction = async (key: string, body: Record<string, unknown>, successMessage: string) => {
        setWorkingKey(key);
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/guarantees', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            const payload = await response.json().catch(() => ({})) as ApiResponse;
            if (!response.ok && !payload.guarantee && !payload.resolution) {
                throw new Error(payload.error || 'La operación no pudo completarse');
            }
            setMessage(successMessage);
            await load();
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'La operación no pudo completarse');
        } finally {
            setWorkingKey(null);
        }
    };

    const resume = (operation: Operation) => postAction(
        `operation:${operation.id}`,
        { action: 'resume', operationId: operation.id },
        'La misma operación se ha reconciliado. Revisa su estado actualizado.',
    );

    const reconcileRefund = (operation: Operation) => postAction(
        `operation:${operation.id}`,
        { action: 'reconcile_refund', operationId: operation.id },
        'El refund existente se ha consultado en Stripe y reconciliado sin crear otro.',
    );

    const resolveReview = (operation: Operation) => {
        const reason = reasons[operation.id]?.trim() ?? '';
        if (reason.length < 5) {
            setError('El motivo para liberar la revisión debe tener al menos 5 caracteres.');
            return;
        }
        void postAction(
            `operation:${operation.id}`,
            { action: 'resolve_review', operationId: operation.id, reason },
            'La revisión se ha liberado con auditoría y la misma operación se ha reintentado.',
        );
    };

    const excuse = (incident: Incident) => {
        const reason = reasons[incident.sessionId]?.trim() ?? '';
        if (reason.length < 5) {
            setError('El motivo de la reclasificación debe tener al menos 5 caracteres.');
            return;
        }
        void postAction(
            `incident:${incident.sessionId}`,
            { action: 'excuse_incident', sessionId: incident.sessionId, reason },
            'La incidencia se ha reclasificado y ha quedado registrada en el ledger inmutable.',
        );
    };

    const isMutating = workingKey !== null;

    return (
        <div className="space-y-8">
            <section aria-labelledby="guarantee-operations-title" className="space-y-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 id="guarantee-operations-title" className="font-display text-2xl uppercase text-[#006064]">
                            Operaciones de garantía
                        </h2>
                        <p className="mt-1 text-sm text-[#006064]/70">
                            Solo se reconcilian operaciones ya existentes; importe e identificadores no son editables.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void load()}
                        disabled={isLoading || isMutating}
                        aria-busy={isLoading}
                        className="border-2 border-[#006064] bg-white px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                    >
                        {isLoading ? 'Actualizando…' : 'Actualizar'}
                    </button>
                </div>

                <div className="flex flex-wrap gap-2" aria-label="Filtrar operaciones por estado">
                    {statuses.map((item) => (
                        <button
                            key={item}
                            type="button"
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
                        aria-live="polite"
                        className={`border-2 p-4 font-mono text-sm ${error ? 'border-red-500 bg-red-50 text-red-800' : 'border-green-700 bg-green-50 text-green-800'}`}
                    >
                        {error || message}
                    </div>
                )}

                <div
                    className="overflow-x-auto border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]"
                    tabIndex={0}
                    aria-label="Tabla de operaciones de garantía"
                >
                    <table className="w-full min-w-[1320px] text-sm">
                        <caption className="sr-only">Operaciones de devolución de la garantía</caption>
                        <thead className="bg-[#006064] text-white">
                            <tr>
                                <th scope="col" className="p-3 text-left">Alumno y suscripción</th>
                                <th scope="col" className="p-3 text-left">Estado</th>
                                <th scope="col" className="p-3 text-left">Importes</th>
                                <th scope="col" className="p-3 text-left">Stripe</th>
                                <th scope="col" className="p-3 text-left">Tiempos</th>
                                <th scope="col" className="p-3 text-left">Revisión</th>
                                <th scope="col" className="p-3 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#006064]/20">
                            {isLoading ? (
                                <tr><td colSpan={7} role="status" className="p-5 font-mono text-[#006064]">Cargando…</td></tr>
                            ) : operations.length === 0 ? (
                                <tr><td colSpan={7} className="p-5 font-mono text-[#006064]">No hay operaciones para este filtro.</td></tr>
                            ) : operations.map((operation) => {
                                const actionKey = `operation:${operation.id}`;
                                const canResume = resumableStatuses.has(operation.status);
                                const refundNeedsDecision = operation.stripeRefundStatus === 'failed'
                                    || operation.stripeRefundStatus === 'canceled';
                                const canReconcileRefund = operation.status === 'manual_review'
                                    && Boolean(operation.stripeRefundId)
                                    && !refundNeedsDecision;
                                const canResolveReview = operation.status === 'manual_review'
                                    && !operation.stripeRefundId
                                    && operation.supportTicket?.status === 'closed';
                                const reviewReason = reasons[operation.id] ?? '';
                                return (
                                    <tr key={operation.id} className="align-top">
                                        <td className="p-3 text-[#006064]">
                                            {operation.student ? (
                                                <a
                                                    href={`/${lang}/campus/admin/student/${operation.student.id}`}
                                                    className="font-bold underline"
                                                >
                                                    {operation.student.fullName || operation.student.email || 'Alumno'}
                                                </a>
                                            ) : <span className="font-bold">Alumno no disponible</span>}
                                            <p className="text-xs">{operation.student?.email}</p>
                                            <p className="mt-2 font-mono text-xs">Suscripción {shortId(operation.subscriptionId)}</p>
                                            <p className="font-mono text-xs">Ciclo {operation.cycleNumber} · {operation.sessionsConsumed}/{operation.sessionsTotal} consumidas</p>
                                            <p className="font-mono text-xs">Reembolsables: {operation.sessionsRefundable}</p>
                                            <p className="font-mono text-xs">Operación {shortId(operation.id)}</p>
                                        </td>
                                        <td className="p-3">
                                            <span className={`inline-block px-2 py-1 text-xs font-bold uppercase ${statusClass(operation.status)}`}>
                                                {statusLabels[operation.status]}
                                            </span>
                                            <p className="mt-2 text-xs text-[#006064]">Pago: {operation.payment?.status || '—'}</p>
                                        </td>
                                        <td className="p-3 font-mono text-xs text-[#006064]">
                                            <p>Bruto: <strong>{formatMoney(operation.grossCents, operation.currency)}</strong></p>
                                            <p>Garantía: <strong>{formatMoney(operation.guaranteeRefundCents, operation.currency)}</strong></p>
                                            <p>Devuelto: <strong>{formatMoney(operation.refundedCents, operation.currency)}</strong></p>
                                            <p>Neto: <strong>{formatMoney(operation.netCents, operation.currency)}</strong></p>
                                        </td>
                                        <td className="max-w-[240px] p-3 font-mono text-xs text-[#006064]">
                                            <p>Estado: {operation.stripeRefundStatus || '—'}</p>
                                            <p className="mt-1 break-all">{operation.stripeRefundId || 'Sin refund ID'}</p>
                                        </td>
                                        <td className="p-3 text-xs text-[#006064]">
                                            <p>Creada: {formatDate(operation.createdAt)}</p>
                                            <p>Actualizada: {formatDate(operation.updatedAt)}</p>
                                            <p>Refund Stripe: {formatDate(operation.refundCreatedAt)}</p>
                                            <p>Confirmada: {formatDate(operation.refundedAt)}</p>
                                        </td>
                                        <td className="max-w-[260px] p-3 text-xs text-[#006064]">
                                            {operation.supportTicket ? (
                                                <a href={`/${lang}/campus/admin/support`} className="font-bold underline">
                                                    Ticket {shortId(operation.supportTicket.id)} · {operation.supportTicket.status}
                                                </a>
                                            ) : <p>Sin ticket enlazado</p>}
                                            {operation.lastError && (
                                                <p className="mt-2 break-words font-mono text-red-800">{operation.lastError}</p>
                                            )}
                                        </td>
                                        <td className="p-3 text-right">
                                            {canResume ? (
                                                <button
                                                    type="button"
                                                    onClick={() => void resume(operation)}
                                                    disabled={isMutating}
                                                    aria-busy={workingKey === actionKey}
                                                    className="border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                                >
                                                    {operation.status === 'retryable' ? 'Reintentar misma operación' : 'Reconciliar misma operación'}
                                                </button>
                                            ) : canReconcileRefund ? (
                                                <button
                                                    type="button"
                                                    onClick={() => void reconcileRefund(operation)}
                                                    disabled={isMutating}
                                                    aria-busy={workingKey === actionKey}
                                                    className="border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                                >
                                                    Reconciliar refund existente
                                                </button>
                                            ) : canResolveReview ? (
                                                <div className="min-w-[280px] text-left">
                                                    <label
                                                        htmlFor={`review-reason-${operation.id}`}
                                                        className="block text-xs font-bold uppercase text-[#006064]"
                                                    >
                                                        Motivo obligatorio para liberar la revisión
                                                    </label>
                                                    <textarea
                                                        id={`review-reason-${operation.id}`}
                                                        value={reviewReason}
                                                        onChange={(event) => setReasons((current) => ({
                                                            ...current,
                                                            [operation.id]: event.target.value,
                                                        }))}
                                                        disabled={isMutating}
                                                        minLength={5}
                                                        maxLength={2000}
                                                        rows={3}
                                                        className="mt-2 w-full border-2 border-[#006064] p-2 text-sm text-[#006064]"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => resolveReview(operation)}
                                                        disabled={isMutating || reviewReason.trim().length < 5}
                                                        aria-busy={workingKey === actionKey}
                                                        className="mt-2 border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                                    >
                                                        Liberar revisión y reintentar
                                                    </button>
                                                </div>
                                            ) : (
                                                operation.status === 'manual_review' && refundNeedsDecision ? (
                                                    <p className="max-w-[280px] border border-red-700 bg-red-50 p-3 text-left text-xs text-red-900">
                                                        El refund figura como {operation.stripeRefundStatus}. No se reintenta: soporte debe resolverlo y registrar la decisión financiera.
                                                    </p>
                                                ) : operation.status === 'manual_review' && !operation.stripeRefundId ? (
                                                    <p className="max-w-[280px] border border-amber-700 bg-amber-50 p-3 text-left text-xs text-amber-900">
                                                        Cierra primero el ticket de soporte enlazado. Después podrá liberarse la revisión con un motivo auditado.
                                                    </p>
                                                ) : (
                                                    <span className="text-xs text-[#006064]/70">
                                                        {operation.status === 'refunded' ? 'Completada' : 'Solo revisión'}
                                                    </span>
                                                )
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </section>

            <section aria-labelledby="guarantee-incidents-title" className="space-y-4">
                <div>
                    <h2 id="guarantee-incidents-title" className="font-display text-2xl uppercase text-[#006064]">
                        Incidencias de sesión
                    </h2>
                    <p className="mt-1 text-sm text-[#006064]/70">
                        La reclasificación documenta una excepción; no reabre, reprograma ni modifica una clase.
                    </p>
                </div>

                {incidents.length === 0 ? (
                    <p className="border-2 border-[#006064] bg-white p-5 font-mono text-sm text-[#006064]">
                        No hay incidencias compatibles con esta garantía.
                    </p>
                ) : (
                    <div className="space-y-4">
                        {incidents.map((incident) => {
                            const actionKey = `incident:${incident.sessionId}`;
                            const reason = reasons[incident.sessionId] ?? '';
                            return (
                                <article key={incident.sessionId} className="border-2 border-[#006064] bg-white p-5 shadow-[4px_4px_0px_0px_#006064]">
                                    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
                                        <div className="text-sm text-[#006064]">
                                            <a
                                                href={`/${lang}/campus/admin/student/${incident.student.id}`}
                                                className="font-bold underline"
                                            >
                                                {incident.student.fullName || incident.student.email || 'Alumno'}
                                            </a>
                                            <p>{incident.student.email}</p>
                                            <p className="mt-2 font-mono text-xs">Sesión {shortId(incident.sessionId)}</p>
                                            <p className="font-mono text-xs">
                                                Ciclo {incident.cycleNumber} ({incident.cycleKind}) · posición {incident.sessionIndex}
                                            </p>
                                            <p className="font-mono text-xs">Estado original: {incident.originalStatus}</p>
                                            <p className="font-mono text-xs">Programada: {formatDate(incident.scheduledAt)}</p>
                                            <p className="font-mono text-xs">Incidencia: {formatDate(incident.incidentAt)}</p>
                                        </div>

                                        {incident.resolution ? (
                                            <div className="border border-green-700 bg-green-50 p-4 text-sm text-green-900">
                                                <p className="font-bold uppercase">Incidencia reclasificada</p>
                                                <p className="mt-2 whitespace-pre-wrap">{incident.resolution.reason}</p>
                                                <p className="mt-2 font-mono text-xs">{formatDate(incident.resolution.created_at)}</p>
                                            </div>
                                        ) : incident.canExcuse ? (
                                            <div>
                                                <label
                                                    htmlFor={`incident-reason-${incident.sessionId}`}
                                                    className="block text-xs font-bold uppercase text-[#006064]"
                                                >
                                                    Motivo obligatorio de la reclasificación
                                                </label>
                                                <textarea
                                                    id={`incident-reason-${incident.sessionId}`}
                                                    value={reason}
                                                    onChange={(event) => setReasons((current) => ({
                                                        ...current,
                                                        [incident.sessionId]: event.target.value,
                                                    }))}
                                                    disabled={isMutating}
                                                    minLength={5}
                                                    maxLength={2000}
                                                    rows={4}
                                                    className="mt-2 w-full border-2 border-[#006064] p-3 text-sm text-[#006064]"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => excuse(incident)}
                                                    disabled={isMutating || reason.trim().length < 5}
                                                    aria-busy={workingKey === actionKey}
                                                    className="mt-3 border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50"
                                                >
                                                    Registrar reclasificación
                                                </button>
                                            </div>
                                        ) : (
                                            <p className="border border-amber-700 bg-amber-50 p-4 text-sm text-amber-900">
                                                Esta incidencia no puede reclasificarse desde aquí porque ya existe una operación o no cumple el contrato.
                                            </p>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}
