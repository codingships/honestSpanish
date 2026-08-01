import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MADRID_TIME_ZONE } from '../../lib/calendar/madrid-time';
import PostClassReport from './PostClassReport';

interface Session {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    drive_doc_url: string | null;
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

type SessionAction = 'complete' | 'cancel' | 'no_show' | 'update_notes';

type SessionActionResponse = {
    error?: string;
};

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
    const dialogId = useId();
    const titleId = `${dialogId}-title`;
    const detailsId = `${dialogId}-details`;
    const notesId = `${dialogId}-notes`;
    const messageId = `${dialogId}-message`;
    const closeLabel = t.close || t.cancel || 'Cerrar';
    const [notes, setNotes] = useState(session.teacher_notes || '');
    const [isLoading, setIsLoading] = useState(false);
    const [pendingAction, setPendingAction] = useState<SessionAction | 'complete_report' | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        clearCloseTimer();
        setNotes(session.teacher_notes || '');
        setMessage(null);
        setIsReportModalOpen(false);
        setIsLoading(false);
        setPendingAction(null);
    }, [clearCloseTimer, isOpen, session.id, session.teacher_notes]);

    useEffect(() => clearCloseTimer, [clearCloseTimer]);

    const formatDateTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: MADRID_TIME_ZONE,
        });
    };

    const handleClose = () => {
        if (isLoading) return;
        clearCloseTimer();
        onClose();
    };

    const scheduleClose = () => {
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => {
            onClose();
        }, 1000);
    };

    const handleAction = async (action: SessionAction) => {
        if (isLoading) return;

        setIsLoading(true);
        setPendingAction(action);
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
                const data = await response.json().catch(() => ({})) as SessionActionResponse;
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
                scheduleClose();
            }
        } catch (err: unknown) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error' });
        } finally {
            setIsLoading(false);
            setPendingAction(null);
        }
    };

    const handleCompleteClass = async (reportData: Record<string, unknown> & { teacher_comments?: string }, homeworkText: string) => {
        if (isLoading) return;

        setIsLoading(true);
        setPendingAction('complete_report');
        setMessage(null);

        try {
            const trimmedHomeworkText = homeworkText.trim();
            let homeworkDriveUrl = trimmedHomeworkText && session.drive_doc_url ? session.drive_doc_url : null;
            let homeworkAppendFailed = false;

            // 1. Inyectar texto en el Google Doc (si hay deberes escritos y la clase tiene un Doc asociado)
            if (trimmedHomeworkText && session.drive_doc_url) {
                const appendRes = await fetch('/api/drive/append-homework', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        docUrl: session.drive_doc_url,
                        text: trimmedHomeworkText,
                        classDate: session.scheduled_at
                    })
                });

                if (!appendRes.ok) {
                    homeworkDriveUrl = null;
                    homeworkAppendFailed = true;
                    console.error('Error inyectando deberes en el Google Doc, pero completaremos la clase de todas formas');
                }
            }

            // 2. Completar clase en DB
            const finalReportData = {
                ...reportData,
                homework_text: trimmedHomeworkText || null,
                homework_drive_url: homeworkDriveUrl,
                ...(homeworkAppendFailed ? { homework_append_failed: true } : {})
            };

            const response = await fetch('/api/calendar/session-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: session.id,
                    action: 'complete',
                    notes: finalReportData.teacher_comments || notes,
                    report: finalReportData
                })
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({})) as SessionActionResponse;
                throw new Error(data.error || 'Complete action failed');
            }

            // Actualizar estado local
            const updatedSession = {
                ...session,
                status: 'completed',
                teacher_notes: finalReportData.teacher_comments || notes
            };

            onSessionUpdate(updatedSession);
            setMessage({ type: 'success', text: t.updated });

            scheduleClose();
        } catch (err: unknown) {
            setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Error' });
            throw err; // Para que el modal muestre el error
        } finally {
            setIsLoading(false);
            setPendingAction(null);
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
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={handleClose} />

            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={detailsId}
                aria-busy={isLoading}
                data-testid="session-detail-modal"
                className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto"
            >
                {/* Header */}
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <h2 id={titleId} className="font-display text-xl text-[#006064]">
                            {session.student?.full_name || session.student?.email || t.studentUnavailable || 'Student unavailable'}
                        </h2>
                        <p className="text-sm text-[#006064]/60">{session.student?.email}</p>
                    </div>
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

                {/* Info */}
                <div id={detailsId} className="space-y-4 mb-6">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[#006064]/60">{t.status}</span>
                        <span
                            className={`px-2 py-1 text-xs font-bold rounded ${statusBadge.class}`}
                            aria-label={`${t.status}: ${statusBadge.text}`}
                        >
                            {statusBadge.text}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-sm text-[#006064]/60">{t.dateTime}</span>
                        <time className="font-bold text-[#006064]" dateTime={session.scheduled_at}>
                            {formatDateTime(session.scheduled_at)}
                        </time>
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
                                aria-label={`${t.meetLink}: ${session.meet_link}`}
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
                        <label htmlFor={notesId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.addNotes}
                        </label>
                        <textarea
                            id={notesId}
                            name="teacher_notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            disabled={isLoading}
                            aria-describedby={message ? messageId : undefined}
                            className="w-full p-3 border-2 border-[#006064] text-[#006064] h-24 resize-none"
                            placeholder={t.sessionNotesPlaceholder}
                        />
                        <button
                            type="button"
                            onClick={() => handleAction('update_notes')}
                            disabled={isLoading}
                            aria-busy={pendingAction === 'update_notes'}
                            className="mt-2 px-4 py-2 text-xs font-bold text-[#006064] border border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                        >
                            {t.saveNotes}
                        </button>
                    </div>
                )}

                {/* Mensaje */}
                {message && (
                    <div
                        id={messageId}
                        role={message.type === 'error' ? 'alert' : 'status'}
                        aria-live={message.type === 'error' ? 'assertive' : 'polite'}
                        className={`mb-4 p-3 text-sm font-bold ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}
                    >
                        {message.text}
                    </div>
                )}

                {/* Acciones */}
                {canModify && (
                    <div className="space-y-2">
                        {isPast ? (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setIsReportModalOpen(true)}
                                    disabled={isLoading}
                                    className="w-full px-4 py-3 bg-green-600 text-white font-bold uppercase text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
                                >
                                    <span aria-hidden="true">&#10003;</span> {t.markComplete}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAction('no_show')}
                                    disabled={isLoading}
                                    aria-busy={pendingAction === 'no_show'}
                                    className="w-full px-4 py-3 bg-red-600 text-white font-bold uppercase text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
                                >
                                    <span aria-hidden="true">&#10005;</span> {t.markNoShow}
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                onClick={() => handleAction('cancel')}
                                disabled={isLoading}
                                aria-busy={pendingAction === 'cancel'}
                                className="w-full px-4 py-3 bg-gray-600 text-white font-bold uppercase text-sm hover:bg-gray-700 transition-colors disabled:opacity-50"
                            >
                                {t.cancelSession}
                            </button>
                        )}
                    </div>
                )}
            </div>
            {isReportModalOpen && (
                <PostClassReport
                    isOpen={isReportModalOpen}
                    onClose={() => setIsReportModalOpen(false)}
                    session={session}
                    lang={lang}
                    translations={t}
                    onSubmit={handleCompleteClass}
                />
            )}
        </div>
    );
}
