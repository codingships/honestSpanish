import React, { useState } from 'react';

type DueChoice = 'now' | 'tomorrow' | 'three_days';

interface PaymentRecoveryActionsProps {
    paymentId: string;
    status: string | null;
}

const dueChoiceLabels: Record<DueChoice, string> = {
    now: 'Hoy',
    tomorrow: 'Manana',
    three_days: '3 dias',
};

function dueAtForChoice(choice: DueChoice): string {
    const date = new Date();

    if (choice === 'tomorrow') {
        date.setDate(date.getDate() + 1);
        date.setHours(10, 0, 0, 0);
    } else if (choice === 'three_days') {
        date.setDate(date.getDate() + 3);
        date.setHours(10, 0, 0, 0);
    }

    return date.toISOString();
}

export default function PaymentRecoveryActions({
    paymentId,
    status,
}: PaymentRecoveryActionsProps) {
    const [dueChoice, setDueChoice] = useState<DueChoice>('now');
    const [isWorking, setIsWorking] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (status !== 'failed') return null;

    const createRecoveryTask = async () => {
        setIsWorking(true);
        setMessage(null);
        setError(null);

        try {
            const response = await fetch('/api/admin/crm/contact-actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_payment_recovery_task',
                    paymentId,
                    dueAt: dueAtForChoice(dueChoice),
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'No se pudo crear la tarea');
            setMessage(data.existing ? 'Ya hay tarea abierta' : 'Tarea CRM creada');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo crear la tarea');
        } finally {
            setIsWorking(false);
        }
    };

    return (
        <div className="flex flex-col items-end gap-2">
            <label className="sr-only" htmlFor={`payment-recovery-due-${paymentId}`}>Plazo de seguimiento</label>
            <select
                id={`payment-recovery-due-${paymentId}`}
                value={dueChoice}
                onChange={(event) => setDueChoice(event.target.value as DueChoice)}
                className="w-full border border-[#006064] bg-white px-2 py-1 text-xs font-bold uppercase text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 md:w-auto"
            >
                {(Object.keys(dueChoiceLabels) as DueChoice[]).map((choice) => (
                    <option key={choice} value={choice}>{dueChoiceLabels[choice]}</option>
                ))}
            </select>
            <button
                type="button"
                onClick={() => void createRecoveryTask()}
                disabled={isWorking}
                className="w-full border border-[#6A131C] px-3 py-1 text-xs font-bold uppercase text-[#6A131C] hover:bg-[#6A131C] hover:text-white disabled:opacity-50 md:w-auto"
            >
                {isWorking ? 'Creando...' : 'Crear tarea'}
            </button>
            {(message || error) && (
                <p className={`max-w-[160px] text-right font-mono text-[11px] ${error ? 'text-[#6A131C]' : 'text-[#006064]'}`}>
                    {error || message}
                </p>
            )}
        </div>
    );
}
