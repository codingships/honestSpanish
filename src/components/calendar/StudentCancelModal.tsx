import React, { useEffect, useId, useState } from 'react';

interface Session {
    id: string;
    scheduled_at: string;
    teacher: {
        full_name: string | null;
        email: string;
    } | null;
}

interface StudentCancelModalProps {
    isOpen: boolean;
    onClose: () => void;
    session: Session;
    lang: string;
    translations: Record<string, unknown>;
    onSuccess: (sessionId: string) => void;
}

type StudentCancelResponse = {
    error?: string;
};

export default function StudentCancelModal({
    isOpen,
    onClose,
    session,
    lang,
    translations: tProp,
    onSuccess
}: StudentCancelModalProps) {
    const t = tProp as Record<string, string>;
    const dialogId = useId();
    const titleId = `${dialogId}-title`;
    const warningId = `${dialogId}-warning`;
    const classInfoId = `${dialogId}-class`;
    const reasonId = `${dialogId}-reason`;
    const errorId = `${dialogId}-error`;
    const closeLabel = t.close || t.cancel || 'Cerrar';
    const hoursUntilClass = (new Date(session.scheduled_at).getTime() - Date.now()) / (1000 * 60 * 60);
    const cancellationWarning = hoursUntilClass < 24
        ? (t.cancelLateWarning || t.cancelWarning)
        : t.cancelWarning;
    const [reason, setReason] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;

        setReason('');
        setError(null);
        setIsLoading(false);
    }, [isOpen, session.id]);

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleClose = () => {
        if (isLoading) return;
        onClose();
    };

    const handleCancel = async () => {
        if (isLoading) return;

        const trimmedReason = reason.trim();

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/calendar/session-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session.id,
                    action: 'cancel',
                    reason: trimmedReason || undefined
                })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({})) as StudentCancelResponse;
                throw new Error(data.error || 'Failed to cancel');
            }

            onSuccess(session.id);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : (t.cancelError || 'Error'));
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={handleClose} />

            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={`${warningId} ${classInfoId}`}
                aria-busy={isLoading}
                data-testid="student-cancel-modal"
                className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 id={titleId} className="font-display text-xl text-[#006064] uppercase">{t.cancelClass}</h2>
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isLoading}
                        aria-label={closeLabel}
                        className="text-[#006064] hover:opacity-70 text-2xl disabled:opacity-50"
                    >
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>

                {/* Advertencia */}
                <div id={warningId} className="mb-6 p-4 bg-yellow-50 border-2 border-yellow-400">
                    <p className="text-sm text-yellow-800 font-bold mb-2">
                        <span aria-hidden="true">&#9888;</span> {t.cancelConfirm}
                    </p>
                    <p className="text-xs text-yellow-700">{cancellationWarning}</p>
                </div>

                {/* Info de la clase */}
                <div id={classInfoId} className="mb-6 p-4 bg-[#E0F7FA] border border-[#006064]/20">
                    <time className="font-bold text-[#006064]" dateTime={session.scheduled_at}>
                        {formatDateTime(session.scheduled_at)}
                    </time>
                    <p className="text-sm text-[#006064]/70">
                        {t.with}: {session.teacher?.full_name || session.teacher?.email}
                    </p>
                </div>

                {/* Razon (opcional) */}
                <div className="mb-6">
                    <label htmlFor={reasonId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                        {t.cancelReason || ''}
                    </label>
                    <textarea
                        id={reasonId}
                        name="reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        disabled={isLoading}
                        aria-describedby={error ? errorId : undefined}
                        className="w-full p-3 border-2 border-[#006064] text-[#006064] h-20 resize-none"
                        placeholder={t.cancelReasonPlaceholder || ''}
                    />
                </div>

                {/* Error */}
                {error && (
                    <div id={errorId} role="alert" className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* Botones */}
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isLoading}
                        className="flex-1 px-4 py-3 bg-white text-[#006064] font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                    >
                        {t.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={handleCancel}
                        disabled={isLoading}
                        aria-busy={isLoading}
                        className="flex-1 px-4 py-3 bg-red-600 text-white font-bold uppercase text-sm border-2 border-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                        {isLoading ? '...' : t.confirm}
                    </button>
                </div>
            </div>
        </div>
    );
}
