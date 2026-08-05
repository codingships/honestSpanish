import { useState } from 'react';
import { MADRID_TIME_ZONE } from '../../lib/calendar/madrid-time';

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type TaskType = 'email' | 'call' | 'whatsapp' | 'review' | 'admin';
type ActionMessage = { type: 'success' | 'error'; text: string };

interface CrmTaskItem {
    id: string;
    assigned_to?: string | null;
    title: string;
    task_type: string;
    priority: string;
    status: string;
    due_at: string | null;
    completed_at?: string | null;
    crm_contacts?: {
        full_name: string | null;
        primary_email: string;
    } | null;
}

interface CrmTaskListProps {
    tasks: CrmTaskItem[];
    emptyText?: string;
    showContact?: boolean;
}

const priorityLabels: Record<string, string> = {
    low: 'Baja',
    normal: 'Normal',
    high: 'Alta',
    urgent: 'Urgente',
};

const statusLabels: Record<string, string> = {
    open: 'Abierta',
    done: 'Hecha',
    snoozed: 'Aplazada',
    cancelled: 'Cancelada',
};

const taskTypeLabels: Record<string, string> = {
    review: 'Revision',
    email: 'Email',
    call: 'Llamada',
    whatsapp: 'WhatsApp',
    admin: 'Admin',
};

function contactLabel(task: CrmTaskItem) {
    return task.crm_contacts?.full_name || task.crm_contacts?.primary_email || 'Contacto sin nombre';
}

function formatDateTime(value: string | null) {
    if (!value) return null;
    return new Date(value).toLocaleString('es-ES', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: MADRID_TIME_ZONE,
    });
}

function toDatetimeLocal(value: string | null) {
    if (!value) return '';
    const date = new Date(value);
    const pad = (part: number) => part.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function tomorrowMorningIso() {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
    return date.toISOString();
}

export default function CrmTaskList({ tasks, emptyText = 'No hay tareas abiertas.', showContact = false }: CrmTaskListProps) {
    const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
    const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
    const [message, setMessage] = useState<ActionMessage | null>(null);
    const [draft, setDraft] = useState({
        title: '',
        taskType: 'review' as TaskType,
        priority: 'normal' as Priority,
        dueAt: '',
    });

    const postTaskAction = async (payload: Record<string, unknown>) => {
        const response = await fetch('/api/admin/crm/contact-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null) as { error?: string } | null;
            throw new Error(body?.error || 'No se pudo actualizar la tarea.');
        }
    };

    const reloadSoon = () => {
        window.setTimeout(() => window.location.reload(), 350);
    };

    const runAction = async (taskId: string, payload: Record<string, unknown>, successMessage: string) => {
        setSavingTaskId(taskId);
        setMessage(null);

        try {
            await postTaskAction(payload);
            setMessage({ type: 'success', text: successMessage });
            reloadSoon();
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo actualizar la tarea.' });
        } finally {
            setSavingTaskId(null);
        }
    };

    const beginEdit = (task: CrmTaskItem) => {
        setEditingTaskId(task.id);
        setDraft({
            title: task.title,
            taskType: (task.task_type as TaskType) || 'review',
            priority: (task.priority as Priority) || 'normal',
            dueAt: toDatetimeLocal(task.due_at),
        });
        setMessage(null);
    };

    const saveEdit = async (taskId: string) => {
        if (!draft.title.trim()) return;

        await runAction(taskId, {
            action: 'update_task',
            taskId,
            title: draft.title,
            taskType: draft.taskType,
            priority: draft.priority,
            dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        }, 'Tarea actualizada.');
    };

    if (tasks.length === 0) {
        return <p className="font-mono text-sm text-[#006064]/60">{emptyText}</p>;
    }

    return (
        <div className="space-y-3">
            {tasks.map((task) => {
                const isSaving = savingTaskId === task.id;
                const isAnySaving = savingTaskId !== null;
                const isEditing = editingTaskId === task.id;
                const isActive = task.status === 'open' || task.status === 'snoozed';
                const dueLabel = formatDateTime(task.due_at);

                return (
                    <div key={task.id} className="border-b border-[#006064]/10 pb-3 last:border-0">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                                <p className="text-sm font-bold text-[#006064]">{task.title}</p>
                                <p className="mt-1 text-xs text-[#006064]/70">
                                    {showContact ? `${contactLabel(task)} - ` : ''}
                                    {taskTypeLabels[task.task_type] || task.task_type} - {priorityLabels[task.priority] || task.priority} - {statusLabels[task.status] || task.status} - {task.assigned_to ? 'Asignada' : 'Cola compartida'}
                                </p>
                                {dueLabel && <p className="mt-1 font-mono text-xs text-[#006064]/70">{dueLabel}</p>}
                            </div>

                            {isActive && (
                                <div className="flex flex-wrap gap-2 md:justify-end">
                                    {!task.assigned_to && (
                                        <button
                                            type="button"
                                            onClick={() => runAction(task.id, { action: 'claim_task', taskId: task.id }, 'Tarea asignada.')}
                                            disabled={isAnySaving}
                                            aria-busy={isSaving}
                                            className="border border-[#006064] bg-white px-2 py-1 text-xs font-bold uppercase text-[#006064] hover:bg-[#E0F7FA] disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            Asignarme
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => runAction(task.id, { action: 'complete_task', taskId: task.id }, 'Tarea completada.')}
                                        disabled={isAnySaving}
                                        aria-busy={isSaving}
                                        className="border border-[#006064] bg-[#006064] px-2 py-1 text-xs font-bold uppercase text-white hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Hecha
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => runAction(task.id, { action: 'snooze_task', taskId: task.id, dueAt: tomorrowMorningIso() }, 'Tarea aplazada.')}
                                        disabled={isAnySaving}
                                        aria-busy={isSaving}
                                        className="border border-[#006064] px-2 py-1 text-xs font-bold uppercase text-[#006064] hover:bg-[#E0F7FA] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Aplazar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => beginEdit(task)}
                                        disabled={isAnySaving}
                                        className="border border-[#006064] px-2 py-1 text-xs font-bold uppercase text-[#006064] hover:bg-[#E0F7FA] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Editar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => runAction(task.id, { action: 'cancel_task', taskId: task.id }, 'Tarea cancelada.')}
                                        disabled={isAnySaving}
                                        aria-busy={isSaving}
                                        className="border border-[#6A131C] px-2 py-1 text-xs font-bold uppercase text-[#6A131C] hover:bg-[#6A131C] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Cancelar
                                    </button>
                                </div>
                            )}
                        </div>

                        {isEditing && (
                            <div className="mt-3 grid grid-cols-1 gap-2 border border-[#006064] bg-[#E0F7FA] p-3">
                                <input
                                    aria-label="Titulo de tarea"
                                    value={draft.title}
                                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                                    disabled={isAnySaving}
                                    className="border border-[#006064] bg-white p-2 text-sm text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                                />
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    <select
                                        aria-label="Tipo de tarea"
                                        value={draft.taskType}
                                        onChange={(event) => setDraft((current) => ({ ...current, taskType: event.target.value as TaskType }))}
                                        disabled={isAnySaving}
                                        className="border border-[#006064] bg-white p-2 text-sm text-[#006064]"
                                    >
                                        <option value="review">Revision</option>
                                        <option value="email">Email</option>
                                        <option value="call">Llamada</option>
                                        <option value="whatsapp">WhatsApp</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                    <select
                                        aria-label="Prioridad de tarea"
                                        value={draft.priority}
                                        onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as Priority }))}
                                        disabled={isAnySaving}
                                        className="border border-[#006064] bg-white p-2 text-sm text-[#006064]"
                                    >
                                        <option value="low">Baja</option>
                                        <option value="normal">Normal</option>
                                        <option value="high">Alta</option>
                                        <option value="urgent">Urgente</option>
                                    </select>
                                    <input
                                        aria-label="Vencimiento de tarea"
                                        type="datetime-local"
                                        value={draft.dueAt}
                                        onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value }))}
                                        disabled={isAnySaving}
                                        className="border border-[#006064] bg-white p-2 text-sm text-[#006064]"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => saveEdit(task.id)}
                                        disabled={isAnySaving || !draft.title.trim()}
                                        className="border border-[#006064] bg-[#006064] px-3 py-2 text-xs font-bold uppercase text-white hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Guardar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setEditingTaskId(null)}
                                        disabled={isAnySaving}
                                        className="border border-[#006064] px-3 py-2 text-xs font-bold uppercase text-[#006064] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        Cerrar
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            {message && (
                <p role={message.type === 'success' ? 'status' : 'alert'} className="font-mono text-xs text-[#006064]">{message.text}</p>
            )}
        </div>
    );
}
