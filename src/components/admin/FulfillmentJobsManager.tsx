import React, { useCallback, useEffect, useState } from 'react';

type JobStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

type FulfillmentJob = {
    id: string;
    job_type: string;
    status: JobStatus;
    attempts: number;
    max_attempts: number;
    created_at: string | null;
    last_error: string | null;
    student?: { full_name: string | null; email: string | null } | null;
    session?: { scheduled_at: string | null; status: string | null } | null;
};

type FulfillmentJobsResponse = {
    error?: string;
    jobs?: FulfillmentJob[];
    result?: {
        processed?: number;
        succeeded?: number;
        failed?: number;
    };
};

const statuses: Array<JobStatus | 'all'> = ['pending', 'failed', 'processing', 'succeeded', 'cancelled', 'all'];

function formatDate(value: string | null): string {
    if (!value) return '-';
    return new Date(value).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function statusClass(status: JobStatus): string {
    switch (status) {
        case 'failed': return 'bg-red-100 text-red-700';
        case 'pending': return 'bg-yellow-100 text-yellow-800';
        case 'processing': return 'bg-blue-100 text-blue-700';
        case 'succeeded': return 'bg-green-100 text-green-700';
        case 'cancelled': return 'bg-gray-100 text-gray-800';
    }
}

export default function FulfillmentJobsManager() {
    const [jobs, setJobs] = useState<FulfillmentJob[]>([]);
    const [status, setStatus] = useState<JobStatus | 'all'>('pending');
    const [isLoading, setIsLoading] = useState(true);
    const [workingId, setWorkingId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadJobs = useCallback(async (signal?: AbortSignal) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/admin/fulfillment-jobs?status=${status}&limit=100`, { signal });
            const data = await response.json() as FulfillmentJobsResponse;
            if (signal?.aborted) return;
            if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los jobs');
            setJobs(data.jobs || []);
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setError(err instanceof Error ? err.message : 'No se pudieron cargar los jobs');
            }
        } finally {
            if (!signal?.aborted) setIsLoading(false);
        }
    }, [status]);

    useEffect(() => {
        const controller = new AbortController();
        void loadJobs(controller.signal);
        return () => controller.abort();
    }, [loadJobs]);

    const runAction = async (action: 'retry' | 'cancel', jobId: string) => {
        setWorkingId(jobId);
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/fulfillment-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, jobId }),
            });
            const data = await response.json() as FulfillmentJobsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el job');
            setMessage(action === 'retry' ? 'Job reprogramado' : 'Job cancelado');
            await loadJobs();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo actualizar el job');
        } finally {
            setWorkingId(null);
        }
    };

    const processDue = async () => {
        setWorkingId('process_due');
        setMessage(null);
        setError(null);
        try {
            const response = await fetch('/api/admin/fulfillment-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'process_due', limit: 20 }),
            });
            const data = await response.json() as FulfillmentJobsResponse;
            if (!response.ok) throw new Error(data.error || 'No se pudo procesar la cola');
            setMessage(`Procesados: ${data.result?.processed ?? 0}, correctos: ${data.result?.succeeded ?? 0}, fallidos: ${data.result?.failed ?? 0}`);
            await loadJobs();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo procesar la cola');
        } finally {
            setWorkingId(null);
        }
    };

    const isWorking = workingId !== null;

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-wrap gap-2">
                    {statuses.map((item) => (
                        <button
                            key={item}
                            type="button"
                            onClick={() => setStatus(item)}
                            disabled={isWorking}
                            className={`border-2 px-3 py-2 text-xs font-bold uppercase ${status === item ? 'border-[#006064] bg-[#006064] text-white' : 'border-[#006064]/40 bg-white text-[#006064]'}`}
                        >
                            {item}
                        </button>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={() => void processDue()}
                    disabled={isWorking}
                    aria-busy={workingId === 'process_due'}
                    className="border-2 border-[#006064] bg-white px-4 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                >
                    {workingId === 'process_due' ? 'Procesando...' : 'Procesar pendientes'}
                </button>
            </div>

            {(message || error) && (
                <div role={error ? 'alert' : 'status'} className={`border-2 p-4 font-mono text-sm ${error ? 'border-red-500 bg-red-50 text-red-700' : 'border-green-600 bg-green-50 text-green-700'}`}>
                    {error || message}
                </div>
            )}

            <div
                className="overflow-x-auto border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]"
                tabIndex={0}
                aria-label="Tabla de jobs de cumplimiento"
            >
                <table className="w-full min-w-[980px] text-sm">
                    <thead className="bg-[#006064] text-white">
                        <tr>
                            <th className="p-3 text-left text-xs font-mono uppercase">Tipo</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Estado</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Alumno</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Clase</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Intentos</th>
                            <th className="p-3 text-left text-xs font-mono uppercase">Error</th>
                            <th className="p-3 text-right text-xs font-mono uppercase">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#006064]/20">
                        {isLoading ? (
                            <tr><td colSpan={7} className="p-5 font-mono text-[#006064]">Cargando...</td></tr>
                        ) : jobs.length === 0 ? (
                            <tr><td colSpan={7} className="p-5 font-mono text-[#006064]">No hay jobs para este filtro</td></tr>
                        ) : jobs.map((job) => (
                            <tr key={job.id} className="bg-white align-top">
                                <td className="p-3 font-mono text-xs text-[#006064]">
                                    <div className="font-bold">{job.job_type}</div>
                                    <div>{formatDate(job.created_at)}</div>
                                </td>
                                <td className="p-3">
                                    <span className={`inline-block px-2 py-1 text-xs font-bold ${statusClass(job.status)}`}>
                                        {job.status}
                                    </span>
                                </td>
                                <td className="p-3 text-[#006064]">
                                    <div className="font-bold">{job.student?.full_name || '-'}</div>
                                    <div className="text-xs text-[#006064]">{job.student?.email || ''}</div>
                                </td>
                                <td className="p-3 text-[#006064]">
                                    <div>{formatDate(job.session?.scheduled_at ?? null)}</div>
                                    <div className="text-xs text-[#006064]">{job.session?.status || ''}</div>
                                </td>
                                <td className="p-3 font-mono text-[#006064]">{job.attempts}/{job.max_attempts}</td>
                                <td className="max-w-[320px] p-3 text-xs text-red-700">
                                    <div className="line-clamp-3">{job.last_error || '-'}</div>
                                </td>
                                <td className="p-3 text-right">
                                    <div className="flex justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => void runAction('retry', job.id)}
                                            disabled={isWorking || job.status === 'processing'}
                                            aria-busy={workingId === job.id}
                                            className="border border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] disabled:opacity-50"
                                        >
                                            Reintentar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => void runAction('cancel', job.id)}
                                            disabled={isWorking || job.status === 'succeeded' || job.status === 'cancelled'}
                                            aria-busy={workingId === job.id}
                                            className="border border-red-600 px-3 py-2 text-xs font-bold uppercase text-red-700 disabled:opacity-50"
                                        >
                                            Cancelar
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
