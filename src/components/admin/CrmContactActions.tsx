import { useState } from 'react';

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type TaskType = 'email' | 'call' | 'whatsapp' | 'review' | 'admin';
type CommunicationType = 'email_out' | 'email_in' | 'call' | 'whatsapp';
type CommunicationDirection = 'inbound' | 'outbound';
type CommunicationPurpose = 'transactional' | 'support' | 'sales_follow_up';

interface CrmContactActionsProps {
    contactId: string;
    opportunityId?: string | null;
}

export default function CrmContactActions({ contactId, opportunityId }: CrmContactActionsProps) {
    const [noteBody, setNoteBody] = useState('');
    const [communicationType, setCommunicationType] = useState<CommunicationType>('email_out');
    const [communicationDirection, setCommunicationDirection] = useState<CommunicationDirection>('outbound');
    const [communicationPurpose, setCommunicationPurpose] = useState<CommunicationPurpose>('sales_follow_up');
    const [communicationSubject, setCommunicationSubject] = useState('');
    const [communicationBody, setCommunicationBody] = useState('');
    const [consentOverrideReason, setConsentOverrideReason] = useState('');
    const [taskTitle, setTaskTitle] = useState('');
    const [taskType, setTaskType] = useState<TaskType>('review');
    const [priority, setPriority] = useState<Priority>('normal');
    const [dueAt, setDueAt] = useState('');
    const [saving, setSaving] = useState<'note' | 'communication' | 'task' | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const postAction = async (payload: Record<string, unknown>) => {
        const response = await fetch('/api/admin/crm/contact-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const body = await response.json().catch(() => null);
            throw new Error(body?.error || 'CRM action failed');
        }
    };

    const reloadSoon = () => {
        window.setTimeout(() => window.location.reload(), 350);
    };

    const saveNote = async () => {
        if (!noteBody.trim()) return;
        setSaving('note');
        setMessage(null);

        try {
            await postAction({
                action: 'create_note',
                contactId,
                opportunityId: opportunityId ?? null,
                body: noteBody,
            });
            setMessage('Nota guardada.');
            setNoteBody('');
            reloadSoon();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo guardar la nota.');
        } finally {
            setSaving(null);
        }
    };

    const saveCommunication = async () => {
        if (!communicationBody.trim()) return;
        setSaving('communication');
        setMessage(null);

        const direction = communicationType === 'email_in'
            ? 'inbound'
            : communicationType === 'email_out'
                ? 'outbound'
                : communicationDirection;

        try {
            await postAction({
                action: 'create_communication',
                contactId,
                opportunityId: opportunityId ?? null,
                communicationType,
                direction,
                purpose: communicationPurpose,
                subject: communicationSubject.trim() || null,
                body: communicationBody,
                occurredAt: null,
                consentOverrideReason: consentOverrideReason.trim() || null,
            });
            setMessage('Comunicacion registrada.');
            setCommunicationSubject('');
            setCommunicationBody('');
            setConsentOverrideReason('');
            reloadSoon();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo registrar la comunicacion.');
        } finally {
            setSaving(null);
        }
    };

    const saveTask = async () => {
        if (!taskTitle.trim()) return;
        setSaving('task');
        setMessage(null);

        try {
            await postAction({
                action: 'create_task',
                contactId,
                opportunityId: opportunityId ?? null,
                title: taskTitle,
                taskType,
                priority,
                dueAt: dueAt ? new Date(dueAt).toISOString() : null,
            });
            setMessage('Tarea creada.');
            setTaskTitle('');
            setDueAt('');
            reloadSoon();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'No se pudo crear la tarea.');
        } finally {
            setSaving(null);
        }
    };

    const locksDirection = communicationType === 'email_in' || communicationType === 'email_out';

    return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div>
                <h3 className="font-display text-lg uppercase text-[#006064]">Nueva nota CRM</h3>
                <textarea
                    aria-label="Nota interna"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    placeholder="Decision interna, contexto o recordatorio..."
                    className="mt-3 h-32 w-full resize-none border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                />
                <button
                    type="button"
                    onClick={saveNote}
                    disabled={saving !== null || !noteBody.trim()}
                    className="mt-3 border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving === 'note' ? 'Guardando...' : 'Guardar nota'}
                </button>
            </div>

            <div>
                <h3 className="font-display text-lg uppercase text-[#006064]">Comunicacion manual</h3>
                <div className="mt-3 grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                        <select
                            aria-label="Tipo de comunicacion"
                            value={communicationType}
                            onChange={(event) => setCommunicationType(event.target.value as CommunicationType)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="email_out">Email enviado</option>
                            <option value="email_in">Email recibido</option>
                            <option value="call">Llamada</option>
                            <option value="whatsapp">WhatsApp</option>
                        </select>
                        <select
                            aria-label="Direccion de comunicacion"
                            value={locksDirection ? (communicationType === 'email_in' ? 'inbound' : 'outbound') : communicationDirection}
                            onChange={(event) => setCommunicationDirection(event.target.value as CommunicationDirection)}
                            disabled={locksDirection}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064] disabled:opacity-60"
                        >
                            <option value="outbound">Saliente</option>
                            <option value="inbound">Entrante</option>
                        </select>
                        <select
                            aria-label="Finalidad de comunicacion"
                            value={communicationPurpose}
                            onChange={(event) => setCommunicationPurpose(event.target.value as CommunicationPurpose)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="sales_follow_up">Seguimiento comercial</option>
                            <option value="support">Soporte</option>
                            <option value="transactional">Transaccional</option>
                        </select>
                    </div>
                    <input
                        aria-label="Asunto de comunicacion"
                        value={communicationSubject}
                        onChange={(event) => setCommunicationSubject(event.target.value)}
                        placeholder="Asunto opcional"
                        className="border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                    <textarea
                        aria-label="Resumen de comunicacion"
                        value={communicationBody}
                        onChange={(event) => setCommunicationBody(event.target.value)}
                        placeholder="Resumen real de email, llamada o WhatsApp..."
                        className="h-24 w-full resize-none border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                    <input
                        aria-label="Motivo de revision legal"
                        value={consentOverrideReason}
                        onChange={(event) => setConsentOverrideReason(event.target.value)}
                        placeholder="Motivo si falta base legal"
                        className="border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                </div>
                <button
                    type="button"
                    onClick={saveCommunication}
                    disabled={saving !== null || !communicationBody.trim()}
                    className="mt-3 border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving === 'communication' ? 'Registrando...' : 'Registrar comunicacion'}
                </button>
            </div>

            <div>
                <h3 className="font-display text-lg uppercase text-[#006064]">Nueva tarea</h3>
                <div className="mt-3 grid grid-cols-1 gap-3">
                    <input
                        aria-label="Titulo de tarea"
                        value={taskTitle}
                        onChange={(event) => setTaskTitle(event.target.value)}
                        placeholder="Ej. Enviar propuesta de plan"
                        className="border-2 border-[#006064] p-3 text-sm text-[#006064] placeholder-[#006064]/40 focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                        <select
                            aria-label="Tipo de tarea"
                            value={taskType}
                            onChange={(event) => setTaskType(event.target.value as TaskType)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="review">Revision</option>
                            <option value="email">Email</option>
                            <option value="call">Llamada</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="admin">Admin</option>
                        </select>
                        <select
                            aria-label="Prioridad"
                            value={priority}
                            onChange={(event) => setPriority(event.target.value as Priority)}
                            className="border-2 border-[#006064] bg-white p-3 text-sm text-[#006064]"
                        >
                            <option value="low">Baja</option>
                            <option value="normal">Normal</option>
                            <option value="high">Alta</option>
                            <option value="urgent">Urgente</option>
                        </select>
                        <input
                            aria-label="Vencimiento"
                            type="datetime-local"
                            value={dueAt}
                            onChange={(event) => setDueAt(event.target.value)}
                            className="border-2 border-[#006064] p-3 text-sm text-[#006064]"
                        />
                    </div>
                </div>
                <button
                    type="button"
                    onClick={saveTask}
                    disabled={saving !== null || !taskTitle.trim()}
                    className="mt-3 border-2 border-[#006064] bg-[#006064] px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:bg-[#004d40] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving === 'task' ? 'Creando...' : 'Crear tarea'}
                </button>
            </div>

            {message && (
                <p className="font-mono text-xs text-[#006064] lg:col-span-3">{message}</p>
            )}
        </div>
    );
}
