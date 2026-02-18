import React, { useState } from 'react';

interface Session {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    teacher_notes: string | null;
    student: {
        id: string;
        full_name: string | null;
        email: string;
    };
    teacher?: {
        id: string;
        full_name: string | null;
        email: string;
    } | null;
}

interface SessionDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    session: Session;
    lang: string;
    translations: Record<string, unknown>;
    onSessionUpdate: (session: Session) => void;
    canEdit: boolean;
}

export default function SessionDetailModal({
    isOpen,
    onClose,
    session,
    lang,
    translations: tProp,
    onSessionUpdate,
    canEdit
}: SessionDetailModalProps) {
    const t = tProp as Record<string, string>;
    const [notes, setNotes] = useState(session.teacher_notes || '');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleAction = async (action: 'complete' | 'cancel' | 'no_show' | 'update_notes') => {
        setIsLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/calendar/session-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session.id,
                    action,
                    notes: action === 'update_notes' || action === 'complete' ? notes : undefined
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Action failed');
            }

            // Actualizar estado local
            const updatedSession = {
                ...session,
                status: action === 'complete' ? 'completed' : action === 'cancel' ? 'cancelled' : action === 'no_show' ? 'no_show' : session.status,
                teacher_notes: notes
            };

            onSessionUpdate(updatedSession);
            setMessage({ type: 'success', text: t.updated });

            if (action !== 'update_notes') {
                setTimeout(() => {
                    onClose();
                    window.location.reload();
                }, 1000);
            }
        } catch (err: unknown) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error' });
        } finally {
            setIsLoading(false);
        }
    };

    const getStatusBadge = () => {
        switch (session.status) {
            case 'completed':
                return { text: t.completed, class: 'bg-green-100 text-green-700' };
            case 'cancelled':
                return { text: t.cancelled, class: 'bg-gray-100 text-gray-500' };
            case 'no_show':
                return { text: t.noShow, class: 'bg-red-100 text-red-700' };
            default:
                return { text: t.scheduled, class: 'bg-blue-100 text-blue-700' };
        }
    };

    const statusBadge = getStatusBadge();
    const isPast = new Date(session.scheduled_at) < new Date();
    const canModify = canEdit && session.status === 'scheduled';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-md w-full mx-4">
                {/* Header */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 className="font-display text-xl text-[#006064]">
                            {session.student?.full_name || session.student?.email}
                        </h2>
                        <p className="text-sm text-[#006064]/60">{session.student?.email}</p>
                    </div>
                    <button onClick={onClose} className="text-[#006064] hover:opacity-70 text-2xl">×</button>
                </div>

                {/* Info */}
                <div className="space-y-4 mb-6">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[#006064]/60">{t.status}</span>
                        <span className={`px-2 py-1 text-xs font-bold rounded ${statusBadge.class}`}>
                            {statusBadge.text}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[#006064]/60">{t.dateTime}</span>
                        <span className="font-bold text-[#006064]">{formatDateTime(session.scheduled_at)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[#006064]/60">{t.duration}</span>
                        <span className="font-mono text-[#006064]">{session.duration_minutes} min</span>
                    </div>

                    {session.meet_link && (
                        <div>
                            <span className="text-sm text-[#006064]/60 block mb-1">{t.meetLink}</span>
                            <a
                                href={session.meet_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline break-all"
                            >
                                {session.meet_link}
                            </a>
                        </div>
                    )}
                </div>

                {/* Notas */}
                {canEdit && (
                    <div className="mb-6">
                        <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.addNotes}
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full p-3 border-2 border-[#006064] text-[#006064] h-24 resize-none"
                            placeholder={t.sessionNotesPlaceholder}
                        />
                        <button
                            onClick={() => handleAction('update_notes')}
                            disabled={isLoading}
                            className="mt-2 px-4 py-2 text-xs font-bold text-[#006064] border border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                        >
                            {t.saveNotes}
                        </button>
                    </div>
                )}

                {/* Mensaje */}
                {message && (
                    <div className={`mb-4 p-3 text-sm font-bold ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* Acciones */}
                {canModify && (
                    <div className="space-y-2">
                        {isPast ? (
                            <>
                                <button
                                    onClick={() => handleAction('complete')}
                                    disabled={isLoading}
                                    className="w-full px-4 py-3 bg-green-600 text-white font-bold uppercase text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                    ✓ {t.markComplete}
                                </button>
                                <button
                                    onClick={() => handleAction('no_show')}
                                    disabled={isLoading}
                                    className="w-full px-4 py-3 bg-red-600 text-white font-bold uppercase text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
                                >
                                    ✗ {t.markNoShow}
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => handleAction('cancel')}
                                disabled={isLoading}
                                className="w-full px-4 py-3 bg-gray-600 text-white font-bold uppercase text-sm hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                {t.cancelSession}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
