import React, { useState } from 'react';

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

export default function StudentCancelModal({
    isOpen,
    onClose,
    session,
    lang,
    translations: tProp,
    onSuccess
}: StudentCancelModalProps) {
    const t = tProp as Record<string, string>;
    const [reason, setReason] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleCancel = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/calendar/session-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session.id,
                    action: 'cancel',
                    reason: reason || undefined
                })
            });

            if (!response.ok) {
                const data = await response.json();
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
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-md w-full mx-4">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-display text-xl text-[#006064] uppercase">{t.cancelClass}</h2>
                    <button onClick={onClose} className="text-[#006064] hover:opacity-70 text-2xl">×</button>
                </div>

                {/* Advertencia */}
                <div className="mb-6 p-4 bg-yellow-50 border-2 border-yellow-400">
                    <p className="text-sm text-yellow-800 font-bold mb-2">⚠️ {t.cancelConfirm}</p>
                    <p className="text-xs text-yellow-700">{t.cancelWarning}</p>
                </div>

                {/* Info de la clase */}
                <div className="mb-6 p-4 bg-[#E0F7FA] border border-[#006064]/20">
                    <p className="font-bold text-[#006064]">{formatDateTime(session.scheduled_at)}</p>
                    <p className="text-sm text-[#006064]/70">
                        {t.with}: {session.teacher?.full_name || session.teacher?.email}
                    </p>
                </div>

                {/* Razón (opcional) */}
                <div className="mb-6">
                    <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                        {t.cancelReason || ''}
                    </label>
                    <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full p-3 border-2 border-[#006064] text-[#006064] h-20 resize-none"
                        placeholder={t.cancelReasonPlaceholder || ''}
                    />
                </div>

                {/* Error */}
                {error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* Botones */}
                <div className="flex gap-2">
                    <button
                        onClick={onClose}
                        disabled={isLoading}
                        className="flex-1 px-4 py-3 bg-white text-[#006064] font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                    >
                        {t.cancel}
                    </button>
                    <button
                        onClick={handleCancel}
                        disabled={isLoading}
                        className="flex-1 px-4 py-3 bg-red-600 text-white font-bold uppercase text-sm border-2 border-red-600 hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                        {isLoading ? '...' : t.confirm}
                    </button>
                </div>
            </div>
        </div>
    );
}
