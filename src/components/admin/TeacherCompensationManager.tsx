import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type EngagementKind = 'founder' | 'external';
type WorkKind = 'mandatory_training' | 'mandatory_meeting';

type Teacher = {
    id: string;
    fullName: string | null;
    email: string;
    currentEngagement: Engagement | null;
};

type Engagement = {
    id: string;
    teacherId: string;
    engagementKind: EngagementKind;
    effectiveFrom: string;
    reason: string;
    createdAt: string;
};

type Milestone = {
    tenActiveHistoryState: 'tracking' | 'requires_confirmation';
    firstReadyInitialAt: string | null;
    tenActiveReachedAt: string | null;
    tenActiveStudentsCount: number | null;
};

type HistoryCycle = {
    id: string;
    createdAt: string;
    studentLabel: string;
};

type CycleGap = {
    id: string;
    createdAt: string;
    cycleNumber: number;
    studentLabel: string;
};

type SessionGap = {
    id: string;
    scheduledAt: string;
    status: string;
    teacherLabel: string;
    studentLabel: string;
};

type ClassObligation = {
    id: string;
    teacherId: string;
    teacherLabel: string;
    studentLabel: string;
    eventKind: string;
    sourceOccurredAt: string;
    amountCents: number;
    currency: string;
};

type WorkEntry = {
    id: string;
    teacherId: string;
    teacherLabel: string;
    workKind: WorkKind;
    startedAt: string;
    endedAt: string;
    originalMinutes: number;
    originalAmountCents: number;
    adjustmentMinutes: number;
    adjustmentAmountCents: number;
    adjustedMinutes: number;
    adjustedAmountCents: number;
    currency: string;
    description: string;
    createdAt: string;
};

type WorkAdjustment = {
    id: string;
    teacherId: string;
    teacherLabel: string;
    workEntryId: string;
    minutesDelta: number;
    amountCents: number;
    currency: string;
    reason: string;
    createdAt: string;
};

type CompensationResponse = {
    error?: string;
    teachers?: Teacher[];
    engagements?: Engagement[];
    milestone?: Milestone;
    historyCycles?: HistoryCycle[];
    cycleGaps?: CycleGap[];
    sessionGaps?: SessionGap[];
    classObligations?: ClassObligation[];
    workObligations?: WorkEntry[];
    workAdjustments?: WorkAdjustment[];
    pagination?: {
        page: number;
        limit: number;
        hasPrevious: boolean;
        hasMore: boolean;
    };
};

const emptyData: Required<Pick<CompensationResponse,
    'teachers' | 'engagements' | 'historyCycles' | 'cycleGaps' | 'sessionGaps'
    | 'classObligations' | 'workObligations' | 'workAdjustments'>> = {
    teachers: [],
    engagements: [],
    historyCycles: [],
    cycleGaps: [],
    sessionGaps: [],
    classObligations: [],
    workObligations: [],
    workAdjustments: [],
};

function formatDate(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatMoney(cents: number, currency = 'eur'): string {
    return new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: currency.toUpperCase(),
    }).format(cents / 100);
}

function toIso(value: string): string {
    return new Date(value).toISOString();
}

function teacherName(teacher: Teacher): string {
    return teacher.fullName || teacher.email;
}

export default function TeacherCompensationManager() {
    const [data, setData] = useState<CompensationResponse>(emptyData);
    const [teacherFilter, setTeacherFilter] = useState('all');
    const [page, setPage] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [workingKey, setWorkingKey] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const requestIds = useRef(new Map<string, string>());

    const [engagementTeacherId, setEngagementTeacherId] = useState('');
    const [engagementKind, setEngagementKind] = useState<EngagementKind>('external');
    const [effectiveFrom, setEffectiveFrom] = useState('');
    const [engagementReason, setEngagementReason] = useState('');

    const [historyConfirmation, setHistoryConfirmation] = useState<'not_reached' | 'reached'>('not_reached');
    const [historyCycleId, setHistoryCycleId] = useState('');
    const [historyCount, setHistoryCount] = useState('10');
    const [historyReason, setHistoryReason] = useState('');

    const [workTeacherId, setWorkTeacherId] = useState('');
    const [workKind, setWorkKind] = useState<WorkKind>('mandatory_training');
    const [workStartedAt, setWorkStartedAt] = useState('');
    const [workEndedAt, setWorkEndedAt] = useState('');
    const [workDescription, setWorkDescription] = useState('');
    const [adjustmentMinutes, setAdjustmentMinutes] = useState<Record<string, string>>({});
    const [adjustmentReasons, setAdjustmentReasons] = useState<Record<string, string>>({});

    const loadData = useCallback(async (signal?: AbortSignal) => {
        setIsLoading(true);
        setError(null);
        const query = new URLSearchParams({ page: String(page), limit: '50' });
        if (teacherFilter !== 'all') query.set('teacherId', teacherFilter);

        try {
            const response = await fetch(`/api/admin/teacher-compensation?${query}`, { signal });
            const body = await response.json() as CompensationResponse;
            if (signal?.aborted) return;
            if (!response.ok) throw new Error(body.error || 'No se pudo cargar la remuneración docente');
            setData({ ...emptyData, ...body });
        } catch (loadError) {
            if ((loadError as Error).name !== 'AbortError') {
                setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la remuneración docente');
            }
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, [page, teacherFilter]);

    useEffect(() => {
        const controller = new AbortController();
        void loadData(controller.signal);
        return () => controller.abort();
    }, [loadData]);

    useEffect(() => {
        const firstTeacher = data.teachers?.[0]?.id || '';
        if (!engagementTeacherId && firstTeacher) setEngagementTeacherId(firstTeacher);
        if (!workTeacherId && firstTeacher) setWorkTeacherId(firstTeacher);
        if (!historyCycleId && data.historyCycles?.[0]?.id) setHistoryCycleId(data.historyCycles[0].id);
    }, [data.teachers, data.historyCycles, engagementTeacherId, historyCycleId, workTeacherId]);

    const stableRequestId = (action: string, payload: Record<string, unknown>) => {
        const key = JSON.stringify({ action, ...payload });
        const existing = requestIds.current.get(key);
        if (existing) return existing;
        const requestId = crypto.randomUUID();
        requestIds.current.set(key, requestId);
        return requestId;
    };

    const postAction = async (
        action: string,
        payload: Record<string, unknown>,
        successMessage: string,
        requestIdRequired = false,
        key = action,
    ) => {
        setWorkingKey(key);
        setMessage(null);
        setError(null);
        const body = requestIdRequired
            ? { action, requestId: stableRequestId(action, payload), ...payload }
            : { action, ...payload };
        try {
            const response = await fetch('/api/admin/teacher-compensation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const responseBody = await response.json() as CompensationResponse;
            if (!response.ok) throw new Error(responseBody.error || 'No se pudo completar la operación');
            setMessage(successMessage);
            await loadData();
            return true;
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : 'No se pudo completar la operación');
            return false;
        } finally {
            setWorkingKey(null);
        }
    };

    const submitEngagement = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!engagementTeacherId || !effectiveFrom || engagementReason.trim().length < 5) return;
        const succeeded = await postAction('configure_engagement', {
            teacherId: engagementTeacherId,
            engagementKind,
            effectiveFrom: toIso(effectiveFrom),
            reason: engagementReason.trim(),
        }, 'Vínculo docente registrado', true);
        if (succeeded) setEngagementReason('');
    };

    const submitHistory = async (event: React.FormEvent) => {
        event.preventDefault();
        const payload = historyConfirmation === 'reached'
            ? {
                confirmation: historyConfirmation,
                triggerCycleId: historyCycleId,
                observedCount: Number(historyCount),
                reason: historyReason.trim(),
            }
            : {
                confirmation: historyConfirmation,
                triggerCycleId: null,
                observedCount: null,
                reason: historyReason.trim(),
            };
        await postAction('confirm_history', payload, 'Histórico confirmado', true);
    };

    const submitWork = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!workTeacherId || !workStartedAt || !workEndedAt || workDescription.trim().length < 5) return;
        const succeeded = await postAction('record_mandatory_work', {
            teacherId: workTeacherId,
            workKind,
            startedAt: toIso(workStartedAt),
            endedAt: toIso(workEndedAt),
            description: workDescription.trim(),
        }, 'Trabajo obligatorio registrado', true);
        if (succeeded) setWorkDescription('');
    };

    const classTotal = useMemo(() => (data.classObligations || [])
        .reduce((total, item) => total + item.amountCents, 0), [data.classObligations]);
    const workTotal = useMemo(() => (data.workObligations || [])
        .reduce((total, item) => total + item.adjustedAmountCents, 0), [data.workObligations]);
    const isMutating = workingKey !== null;
    const historyBlocked = data.milestone?.tenActiveHistoryState === 'requires_confirmation';

    return (
        <div className="space-y-8">
            {(message || error) && (
                <div
                    role={error ? 'alert' : 'status'}
                    aria-live="polite"
                    className={`border-2 p-4 font-mono text-sm ${error ? 'border-red-600 bg-red-50 text-red-800' : 'border-green-700 bg-green-50 text-green-800'}`}
                >
                    {error || message}
                </div>
            )}

            {isLoading && <p role="status" className="border-2 border-[#006064] bg-white p-4 font-mono text-[#006064]">Cargando obligaciones...</p>}

            <section aria-labelledby="engagements-heading" className="space-y-4">
                <header>
                    <h2 id="engagements-heading" className="font-display text-2xl uppercase text-[#006064]">Vínculos docentes</h2>
                    <p className="mt-1 text-sm text-[#006064]/70">Clasificación efectiva y append-only; no se infiere por nombre.</p>
                </header>
                <form onSubmit={submitEngagement} className="grid gap-4 border-2 border-[#006064] bg-white p-5 lg:grid-cols-2">
                    <label className="text-sm font-bold text-[#006064]">Profesor
                        <select value={engagementTeacherId} onChange={(event) => setEngagementTeacherId(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2">
                            {(data.teachers || []).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacherName(teacher)}</option>)}
                        </select>
                    </label>
                    <label className="text-sm font-bold text-[#006064]">Tipo de vínculo
                        <select value={engagementKind} onChange={(event) => setEngagementKind(event.target.value as EngagementKind)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2">
                            <option value="founder">Fundador</option>
                            <option value="external">Externo</option>
                        </select>
                    </label>
                    <label className="text-sm font-bold text-[#006064]">Efectivo desde
                        <input type="datetime-local" required value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                    </label>
                    <label className="text-sm font-bold text-[#006064]">Motivo
                        <input required minLength={5} maxLength={1000} value={engagementReason} onChange={(event) => setEngagementReason(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                    </label>
                    <button type="submit" disabled={isMutating || !engagementTeacherId} aria-busy={workingKey === 'configure_engagement'} className="w-fit border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50">
                        Registrar vínculo
                    </button>
                </form>
                <div className="overflow-x-auto border-2 border-[#006064] bg-white" tabIndex={0} aria-label="Vínculos docentes actuales">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-[#006064] text-white"><tr><th className="p-3 text-left">Profesor</th><th className="p-3 text-left">Vínculo actual</th><th className="p-3 text-left">Efectivo desde</th><th className="p-3 text-left">Motivo</th></tr></thead>
                        <tbody className="divide-y divide-[#006064]/20">
                            {(data.teachers || []).map((teacher) => <tr key={teacher.id}><td className="p-3 font-bold text-[#006064]">{teacherName(teacher)}</td><td className="p-3 text-[#006064]">{teacher.currentEngagement?.engagementKind || 'Sin configurar'}</td><td className="p-3 text-[#006064]">{formatDate(teacher.currentEngagement?.effectiveFrom || null)}</td><td className="p-3 text-[#006064]">{teacher.currentEngagement?.reason || '-'}</td></tr>)}
                        </tbody>
                    </table>
                </div>
            </section>

            <section aria-labelledby="history-heading" className="space-y-4">
                <header>
                    <h2 id="history-heading" className="font-display text-2xl uppercase text-[#006064]">Gate histórico</h2>
                    <p className="mt-1 text-sm text-[#006064]/70">Estado: <strong>{data.milestone?.tenActiveHistoryState || 'no disponible'}</strong></p>
                </header>
                {historyBlocked ? (
                    <form onSubmit={submitHistory} className="grid gap-4 border-2 border-amber-700 bg-amber-50 p-5 lg:grid-cols-2">
                        <p role="alert" className="lg:col-span-2 text-sm font-bold text-amber-900">La reconciliación permanece bloqueada hasta documentar el histórico real.</p>
                        <label className="text-sm font-bold text-[#006064]">Resultado
                            <select value={historyConfirmation} onChange={(event) => setHistoryConfirmation(event.target.value as 'not_reached' | 'reached')} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2">
                                <option value="not_reached">Nunca se alcanzaron diez activos</option>
                                <option value="reached">Se alcanzaron diez activos</option>
                            </select>
                        </label>
                        {historyConfirmation === 'reached' && <>
                            <label className="text-sm font-bold text-[#006064]">Ciclo que causó el hito
                                <select required value={historyCycleId} onChange={(event) => setHistoryCycleId(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2">
                                    {(data.historyCycles || []).map((cycle) => <option key={cycle.id} value={cycle.id}>{formatDate(cycle.createdAt)} · {cycle.studentLabel}</option>)}
                                </select>
                            </label>
                            <label className="text-sm font-bold text-[#006064]">Alumnos observados
                                <input type="number" min={10} max={32767} required value={historyCount} onChange={(event) => setHistoryCount(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                            </label>
                        </>}
                        <label className="text-sm font-bold text-[#006064] lg:col-span-2">Motivo documentado
                            <textarea required minLength={5} maxLength={1000} rows={3} value={historyReason} onChange={(event) => setHistoryReason(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                        </label>
                        <button type="submit" disabled={isMutating || historyReason.trim().length < 5 || (historyConfirmation === 'reached' && !historyCycleId)} aria-busy={workingKey === 'confirm_history'} className="w-fit border-2 border-amber-900 bg-amber-900 px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50">Confirmar histórico</button>
                    </form>
                ) : (
                    <p role="status" className="border-2 border-green-700 bg-green-50 p-4 text-sm text-green-900">El gate histórico está resuelto.</p>
                )}
            </section>

            <section aria-labelledby="reconciliation-heading" className="space-y-4">
                <header>
                    <h2 id="reconciliation-heading" className="font-display text-2xl uppercase text-[#006064]">Reconciliación</h2>
                    <p className="mt-1 text-sm text-[#006064]/70">Primero el siguiente ciclo pendiente; después, las sesiones terminales liquidables.</p>
                </header>
                <div className="grid gap-5 lg:grid-cols-2">
                    <div className="border-2 border-[#006064] bg-white p-5">
                        <h3 className="font-display text-lg uppercase text-[#006064]">Próximo ciclo sin términos</h3>
                        {(data.cycleGaps || []).length ? (() => {
                            const cycle = data.cycleGaps![0];
                            return <div className="mt-3 text-sm text-[#006064]"><p className="font-bold">{cycle.studentLabel}</p><p>Ciclo {cycle.cycleNumber} · {formatDate(cycle.createdAt)}</p><button type="button" onClick={() => void postAction('reconcile_cycle', { cycleId: cycle.id }, 'Ciclo reconciliado', false, `cycle:${cycle.id}`)} disabled={isMutating || historyBlocked} aria-busy={workingKey === `cycle:${cycle.id}`} className="mt-3 border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase disabled:opacity-50">Reconciliar siguiente ciclo</button></div>;
                        })() : <p role="status" className="mt-3 text-sm text-[#006064]">No hay ciclos pendientes.</p>}
                    </div>
                    <div className="border-2 border-[#006064] bg-white p-5">
                        <h3 className="font-display text-lg uppercase text-[#006064]">Sesiones sin obligación</h3>
                        {(data.sessionGaps || []).length ? <ul className="mt-3 space-y-3">{data.sessionGaps!.map((session) => <li key={session.id} className="border-t border-[#006064]/20 pt-3 text-sm text-[#006064]"><p className="font-bold">{session.teacherLabel} · {session.studentLabel}</p><p>{session.status} · {formatDate(session.scheduledAt)}</p><button type="button" onClick={() => void postAction('reconcile_session', { sessionId: session.id }, 'Sesión reconciliada', false, `session:${session.id}`)} disabled={isMutating || historyBlocked || Boolean(data.cycleGaps?.length)} aria-busy={workingKey === `session:${session.id}`} className="mt-2 border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase disabled:opacity-50">Reconciliar sesión</button></li>)}</ul> : <p role="status" className="mt-3 text-sm text-[#006064]">No hay sesiones pendientes.</p>}
                    </div>
                </div>
            </section>

            <section aria-labelledby="obligations-heading" className="space-y-4">
                <header>
                    <h2 id="obligations-heading" className="font-display text-2xl uppercase text-[#006064]">Obligaciones registradas</h2>
                    <p className="mt-1 text-sm text-[#006064]/70">Clases, formación y reuniones obligatorias; no representa una transferencia.</p>
                </header>
                <div className="flex flex-col gap-3 border-2 border-[#006064] bg-white p-4 md:flex-row md:items-end">
                    <label className="text-sm font-bold text-[#006064]">Filtrar profesor
                        <select value={teacherFilter} onChange={(event) => { setTeacherFilter(event.target.value); setPage(0); }} disabled={isMutating} className="mt-1 block min-w-64 border-2 border-[#006064] p-2">
                            <option value="all">Todos</option>
                            {(data.teachers || []).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacherName(teacher)}</option>)}
                        </select>
                    </label>
                    <p role="status" className="font-mono text-sm text-[#006064]">
                        En esta página: clases {formatMoney(classTotal)} + trabajo ajustado {formatMoney(workTotal)} = obligaciones {formatMoney(classTotal + workTotal)}
                    </p>
                </div>

                <form onSubmit={submitWork} className="grid gap-4 border-2 border-[#006064] bg-white p-5 lg:grid-cols-2">
                    <h3 className="font-display text-lg uppercase text-[#006064] lg:col-span-2">Registrar trabajo obligatorio</h3>
                    <label className="text-sm font-bold text-[#006064]">Profesor
                        <select value={workTeacherId} onChange={(event) => setWorkTeacherId(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2">{(data.teachers || []).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacherName(teacher)}</option>)}</select>
                    </label>
                    <label className="text-sm font-bold text-[#006064]">Tipo
                        <select value={workKind} onChange={(event) => setWorkKind(event.target.value as WorkKind)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2"><option value="mandatory_training">Formación obligatoria</option><option value="mandatory_meeting">Reunión obligatoria</option></select>
                    </label>
                    <label className="text-sm font-bold text-[#006064]">Inicio real
                        <input type="datetime-local" required value={workStartedAt} onChange={(event) => setWorkStartedAt(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                    </label>
                    <label className="text-sm font-bold text-[#006064]">Fin real
                        <input type="datetime-local" required value={workEndedAt} onChange={(event) => setWorkEndedAt(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                    </label>
                    <label className="text-sm font-bold text-[#006064] lg:col-span-2">Descripción
                        <textarea required minLength={5} maxLength={1000} rows={3} value={workDescription} onChange={(event) => setWorkDescription(event.target.value)} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                    </label>
                    <button type="submit" disabled={isMutating || !workTeacherId} aria-busy={workingKey === 'record_mandatory_work'} className="w-fit border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white disabled:opacity-50">Registrar trabajo</button>
                </form>

                <div className="overflow-x-auto border-2 border-[#006064] bg-white" tabIndex={0} aria-label="Obligaciones por clases">
                    <table className="w-full min-w-[900px] text-sm"><caption className="sr-only">Obligaciones registradas por clases</caption><thead className="bg-[#006064] text-white"><tr><th className="p-3 text-left">Fecha</th><th className="p-3 text-left">Profesor</th><th className="p-3 text-left">Alumno</th><th className="p-3 text-left">Resultado</th><th className="p-3 text-right">Importe</th></tr></thead><tbody className="divide-y divide-[#006064]/20">{(data.classObligations || []).length ? data.classObligations!.map((entry) => <tr key={entry.id}><td className="p-3 text-[#006064]">{formatDate(entry.sourceOccurredAt)}</td><td className="p-3 font-bold text-[#006064]">{entry.teacherLabel}</td><td className="p-3 text-[#006064]">{entry.studentLabel}</td><td className="p-3 text-[#006064]">{entry.eventKind}</td><td className="p-3 text-right font-mono text-[#006064]">{formatMoney(entry.amountCents, entry.currency)}</td></tr>) : <tr><td colSpan={5} role="status" className="p-5 text-[#006064]">No hay obligaciones de clase para este filtro.</td></tr>}</tbody></table>
                </div>

                <div className="space-y-3">
                    {(data.workObligations || []).map((entry) => (
                        <article key={entry.id} className="border-2 border-[#006064] bg-white p-5 text-sm text-[#006064]">
                            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
                                <div>
                                    <p className="font-bold">{entry.teacherLabel} · {entry.workKind}</p>
                                    <p>{formatDate(entry.startedAt)} – {formatDate(entry.endedAt)}</p>
                                    <p className="font-mono">Saldo actual: {entry.adjustedMinutes} min · {formatMoney(entry.adjustedAmountCents, entry.currency)}</p>
                                    {(entry.adjustedMinutes !== entry.originalMinutes || entry.adjustedAmountCents !== entry.originalAmountCents) && (
                                        <p className="font-mono text-xs">Alta original: {entry.originalMinutes} min · {formatMoney(entry.originalAmountCents, entry.currency)}</p>
                                    )}
                                    <p className="mt-1">{entry.description}</p>
                                </div>
                                <div className="grid min-w-[280px] gap-2">
                                    <label className="text-xs font-bold uppercase">Ajuste de minutos
                                        <input type="number" required min={-720} max={720} value={adjustmentMinutes[entry.id] || ''} onChange={(event) => setAdjustmentMinutes((current) => ({ ...current, [entry.id]: event.target.value }))} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                                    </label>
                                    <label className="text-xs font-bold uppercase">Motivo del ajuste
                                        <input minLength={5} maxLength={1000} value={adjustmentReasons[entry.id] || ''} onChange={(event) => setAdjustmentReasons((current) => ({ ...current, [entry.id]: event.target.value }))} disabled={isMutating} className="mt-1 block w-full border-2 border-[#006064] p-2" />
                                    </label>
                                    <button type="button" onClick={() => void postAction('adjust_mandatory_work', { workEntryId: entry.id, minutesDelta: Number(adjustmentMinutes[entry.id]), reason: (adjustmentReasons[entry.id] || '').trim() }, 'Ajuste compensatorio registrado', true, `adjust:${entry.id}`)} disabled={isMutating || !adjustmentMinutes[entry.id] || Number(adjustmentMinutes[entry.id]) === 0 || (adjustmentReasons[entry.id] || '').trim().length < 5} aria-busy={workingKey === `adjust:${entry.id}`} className="border-2 border-[#006064] px-3 py-2 text-xs font-bold uppercase disabled:opacity-50">Registrar ajuste</button>
                                </div>
                            </div>
                        </article>
                    ))}
                    {!(data.workObligations || []).length && <p role="status" className="border-2 border-[#006064] bg-white p-5 text-sm text-[#006064]">No hay trabajo obligatorio para este filtro.</p>}
                    {(data.workAdjustments || []).length > 0 && <div className="border-2 border-[#006064] bg-white p-5"><h3 className="font-display text-lg uppercase text-[#006064]">Movimientos de ajuste recientes</h3><p className="mt-1 text-xs text-[#006064]/70">Historial informativo independiente del total de la página.</p><ul className="mt-3 divide-y divide-[#006064]/20">{data.workAdjustments!.map((entry) => <li key={entry.id} className="py-3 text-sm text-[#006064]"><strong>{entry.teacherLabel}</strong> · {entry.minutesDelta > 0 ? '+' : ''}{entry.minutesDelta} min · {formatMoney(entry.amountCents, entry.currency)}<p>{entry.reason}</p></li>)}</ul></div>}
                </div>

                <nav aria-label="Paginación de obligaciones" className="flex items-center justify-between border-2 border-[#006064] bg-white p-3">
                    <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={isMutating || !data.pagination?.hasPrevious} className="border border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Anterior</button>
                    <span className="font-mono text-xs text-[#006064]">Página {(data.pagination?.page ?? page) + 1}</span>
                    <button type="button" onClick={() => setPage((current) => current + 1)} disabled={isMutating || !data.pagination?.hasMore} className="border border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50">Siguiente</button>
                </nav>
            </section>
        </div>
    );
}
