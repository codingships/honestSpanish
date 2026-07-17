import React, { useState } from 'react';

type DueChoice = 'now' | 'tomorrow' | 'one_week';

interface SubscriptionRenewalActionsProps {
    subscriptionId: string;
    status: string | null;
}

type SubscriptionRenewalResponse = {
    error?: string;
    existing?: boolean;
};

const dueChoiceLabels: Record<DueChoice, string> = {
    now: 'Hoy',
    tomorrow: 'Manana',
    one_week: '7 dias',
};

function dueAtForChoice(choice: DueChoice): string {
    const date = new Date();

    if (choice === 'tomorrow') {
        date.setDate(date.getDate() + 1);
        date.setHours(10, 0, 0, 0);
    } else if (choice === 'one_week') {
        date.setDate(date.getDate() + 7);
        date.setHours(10, 0, 0, 0);
    }

    return date.toISOString();
}

export default function SubscriptionRenewalActions({
    subscriptionId,
    status,
}: SubscriptionRenewalActionsProps) {
    const [dueChoice, setDueChoice] = useState<DueChoice>('now');
    const [isWorking, setIsWorking] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (status !== 'active') return null;

    const createRenewalTask = async () => {
        setIsWorking(true);
        setMessage(null);
        setError(null);

        try {
            const response = await fetch('/api/admin/crm/contact-actions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create_subscription_renewal_task',
                    subscriptionId,
                    dueAt: dueAtForChoice(dueChoice),
                }),
            });
            const data = await response.json() as SubscriptionRenewalResponse;
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
            <label className="sr-only" htmlFor={`subscription-renewal-due-${subscriptionId}`}>Plazo de renovacion</label>
            <select
                id={`subscription-renewal-due-${subscriptionId}`}
                value={dueChoice}
                onChange={(event) => setDueChoice(event.target.value as DueChoice)}
                disabled={isWorking}
                className="w-full border border-[#006064] bg-white px-2 py-1 text-xs font-bold uppercase text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 md:w-auto"
            >
                {(Object.keys(dueChoiceLabels) as DueChoice[]).map((choice) => (
                    <option key={choice} value={choice}>{dueChoiceLabels[choice]}</option>
                ))}
            </select>
            <button
                type="button"
                onClick={() => void createRenewalTask()}
                disabled={isWorking}
                aria-busy={isWorking}
                className="w-full border border-[#6A131C] px-3 py-1 text-xs font-bold uppercase text-[#6A131C] hover:bg-[#6A131C] hover:text-white disabled:opacity-50 md:w-auto"
            >
                {isWorking ? 'Creando...' : 'Crear tarea'}
            </button>
            {(message || error) && (
                <p
                    role={error ? 'alert' : 'status'}
                    className={`max-w-[160px] text-right font-mono text-[11px] ${error ? 'text-[#6A131C]' : 'text-[#006064]'}`}
                >
                    {error || message}
                </p>
            )}
        </div>
    );
}
