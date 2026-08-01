import React, { useEffect, useId, useRef, useState } from 'react';
import {
    addDaysToDateKey,
    madridDateKey,
    madridDateTimeToUtcIso,
} from '../../lib/calendar/madrid-time';

export type StudentRescheduleTarget = {
    scheduledAt: string;
    operationKind: 'single_session' | 'provisional_anchor';
    affectedScheduledAts: string[];
};

export type StudentRescheduleSession = {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    teacher: {
        id: string;
        full_name: string | null;
        email: string;
    };
};

type ReschedulePayload = {
    requestId: string;
    sessionId: string;
    newScheduledAt: string;
};

type PendingReschedule = {
    payload: ReschedulePayload;
    target: StudentRescheduleTarget;
};

interface StudentRescheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    session: StudentRescheduleSession;
    lang: string;
    translations: Record<string, unknown>;
    onSuccess: () => void;
}

type RescheduleTargetsResponse = {
    targets?: unknown;
    error?: string;
    errorCode?: string;
};

const STORAGE_PREFIX = 'checkout-v2-reschedule:';
const MADRID_TIME_ZONE = 'Europe/Madrid';

const localeForLang = (lang: string) => (lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US');
const storageKey = (sessionId: string) => `${STORAGE_PREFIX}${sessionId}`;
const isValidInstant = (value: unknown): value is string => (
    typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
);

function parseTarget(value: unknown): StudentRescheduleTarget | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (!isValidInstant(candidate.scheduledAt)) return null;
    if (candidate.operationKind !== 'single_session' && candidate.operationKind !== 'provisional_anchor') {
        return null;
    }
    if (!Array.isArray(candidate.affectedScheduledAts) || !candidate.affectedScheduledAts.every(isValidInstant)) {
        return null;
    }

    return {
        scheduledAt: candidate.scheduledAt,
        operationKind: candidate.operationKind,
        affectedScheduledAts: candidate.affectedScheduledAts.length > 0
            ? candidate.affectedScheduledAts
            : [candidate.scheduledAt],
    };
}

function parseTargets(value: unknown): StudentRescheduleTarget[] | null {
    if (!Array.isArray(value)) return null;
    const targets = value.map(parseTarget);
    if (targets.some((target) => target === null)) return null;
    return (targets as StudentRescheduleTarget[])
        .sort((left, right) => Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt));
}

function loadPendingReschedule(sessionId: string): PendingReschedule | null {
    try {
        const raw = window.sessionStorage.getItem(storageKey(sessionId));
        if (!raw) return null;
        const value = JSON.parse(raw) as Record<string, unknown>;
        const payload = value.payload as Record<string, unknown> | undefined;
        const target = parseTarget(value.target);
        if (
            !payload
            || typeof payload.requestId !== 'string'
            || payload.sessionId !== sessionId
            || !isValidInstant(payload.newScheduledAt)
            || !target
            || target.scheduledAt !== payload.newScheduledAt
        ) {
            window.sessionStorage.removeItem(storageKey(sessionId));
            return null;
        }

        return {
            payload: {
                requestId: payload.requestId,
                sessionId,
                newScheduledAt: payload.newScheduledAt,
            },
            target,
        };
    } catch {
        return null;
    }
}

function persistPendingReschedule(operation: PendingReschedule): boolean {
    try {
        window.sessionStorage.setItem(storageKey(operation.payload.sessionId), JSON.stringify(operation));
        return true;
    } catch {
        return false;
    }
}

function clearPendingReschedule(sessionId: string): boolean {
    try {
        window.sessionStorage.removeItem(storageKey(sessionId));
        return true;
    } catch {
        return false;
    }
}

export default function StudentRescheduleModal({
    isOpen,
    onClose,
    session,
    lang,
    translations: tProp,
    onSuccess,
}: StudentRescheduleModalProps) {
    const t = tProp as Record<string, string>;
    const dialogId = useId();
    const titleId = `${dialogId}-title`;
    const descriptionId = `${dialogId}-description`;
    const dateInputId = `${dialogId}-date`;
    const targetErrorId = `${dialogId}-target-error`;
    const submissionErrorId = `${dialogId}-submission-error`;
    const dialogRef = useRef<HTMLDivElement>(null);
    const submittingRef = useRef(false);
    const [selectedDate, setSelectedDate] = useState('');
    const [targets, setTargets] = useState<StudentRescheduleTarget[]>([]);
    const [selectedTarget, setSelectedTarget] = useState<StudentRescheduleTarget | null>(null);
    const [pendingOperation, setPendingOperation] = useState<PendingReschedule | null>(null);
    const [isLoadingTargets, setIsLoadingTargets] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [targetsError, setTargetsError] = useState<string | null>(null);
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [terminalError, setTerminalError] = useState(false);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const locale = localeForLang(lang);
    const today = madridDateKey(new Date());

    const formatDateTime = (dateStr: string) => new Date(dateStr).toLocaleString(locale, {
        timeZone: MADRID_TIME_ZONE,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
    });

    const formatTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString(locale, {
        timeZone: MADRID_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
    });

    useEffect(() => {
        if (!isOpen) return;

        const restored = loadPendingReschedule(session.id);
        setTargets([]);
        setTargetsError(null);
        setSubmissionError(null);
        setTerminalError(false);
        setRefreshVersion(0);
        setPendingOperation(restored);
        setSelectedTarget(restored?.target ?? null);
        setSelectedDate(restored ? madridDateKey(new Date(restored.payload.newScheduledAt)) : '');
    }, [isOpen, session.id]);

    useEffect(() => {
        if (!isOpen || !selectedDate || pendingOperation) return;

        const from = madridDateTimeToUtcIso(selectedDate, '00:00');
        const to = madridDateTimeToUtcIso(addDaysToDateKey(selectedDate, 1), '00:00');
        if (!from || !to) {
            setTargetsError(t.rescheduleTargetsError);
            setTargets([]);
            return;
        }

        const controller = new AbortController();
        const loadTargets = async () => {
            setIsLoadingTargets(true);
            setTargetsError(null);

            try {
                const params = new URLSearchParams({ sessionId: session.id, from, to });
                const response = await fetch(`/api/calendar/reschedule-v2?${params.toString()}`, {
                    signal: controller.signal,
                });
                const data = await response.json().catch(() => ({})) as RescheduleTargetsResponse;
                if (controller.signal.aborted) return;

                if (!response.ok) {
                    if (response.status === 401) throw new Error(t.rescheduleSessionExpired);
                    if (response.status === 403) throw new Error(t.rescheduleForbidden);
                    if (response.status === 404) throw new Error(t.rescheduleNotFound);
                    throw new Error(t.rescheduleTargetsError);
                }

                const parsedTargets = parseTargets(data.targets);
                if (!parsedTargets) throw new Error(t.rescheduleTargetsError);
                setTargets(parsedTargets);
                setSelectedTarget((current) => {
                    if (!current) return null;
                    return parsedTargets.find((target) => target.scheduledAt === current.scheduledAt) ?? current;
                });
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') return;
                setTargets([]);
                setTargetsError(error instanceof Error ? error.message : t.rescheduleTargetsError);
            } finally {
                if (!controller.signal.aborted) setIsLoadingTargets(false);
            }
        };

        void loadTargets();
        return () => controller.abort();
    }, [isOpen, pendingOperation, refreshVersion, selectedDate, session.id, t.rescheduleForbidden, t.rescheduleNotFound, t.rescheduleSessionExpired, t.rescheduleTargetsError]);

    useEffect(() => {
        if (!isOpen) return;
        dialogRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || submittingRef.current) return;
            onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleClose = () => {
        if (submittingRef.current) return;
        onClose();
    };

    const handleDateChange = (value: string) => {
        if (pendingOperation || terminalError || submittingRef.current) return;
        setSelectedDate(value);
        setSelectedTarget(null);
        setSubmissionError(null);
    };

    const clearOperationOrFailClosed = (): boolean => {
        if (!clearPendingReschedule(session.id)) {
            setSubmissionError(t.rescheduleStorageError);
            setTerminalError(true);
            return false;
        }
        setPendingOperation(null);
        return true;
    };

    const handleSubmit = async () => {
        if (submittingRef.current || terminalError) return;
        const target = pendingOperation?.target ?? selectedTarget;
        if (!target) return;

        const operation = pendingOperation ?? {
            payload: {
                requestId: globalThis.crypto.randomUUID(),
                sessionId: session.id,
                newScheduledAt: target.scheduledAt,
            },
            target,
        };

        if (!persistPendingReschedule(operation)) {
            setSubmissionError(t.rescheduleStorageError);
            return;
        }

        submittingRef.current = true;
        setPendingOperation(operation);
        setIsSubmitting(true);
        setSubmissionError(null);

        try {
            const response = await fetch('/api/calendar/reschedule-v2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(operation.payload),
            });
            const data = await response.json().catch(() => ({})) as RescheduleTargetsResponse;
            const errorCode = typeof data.errorCode === 'string' ? data.errorCode : null;

            if (response.ok) {
                clearPendingReschedule(session.id);
                setPendingOperation(null);
                onSuccess();
                return;
            }

            if (errorCode === 'RESCHEDULE_REQUIRES_REVIEW') {
                setSubmissionError(t.rescheduleReview);
                return;
            }
            if (response.status === 503 || errorCode === 'RESCHEDULE_RETRYABLE') {
                setSubmissionError(t.rescheduleRetryable);
                return;
            }
            if (response.status === 401) {
                setSubmissionError(t.rescheduleSessionExpired);
                return;
            }
            if (response.status === 409 || errorCode === 'RESCHEDULE_CONFLICT') {
                if (!clearOperationOrFailClosed()) return;
                setSelectedTarget(null);
                setTargets([]);
                setSubmissionError(t.rescheduleConflict);
                setRefreshVersion((version) => version + 1);
                return;
            }
            if (response.status === 403 || errorCode === 'RESCHEDULE_FORBIDDEN') {
                if (!clearOperationOrFailClosed()) return;
                setTerminalError(true);
                setSubmissionError(t.rescheduleForbidden);
                return;
            }
            if (response.status === 404 || errorCode === 'RESCHEDULE_NOT_FOUND') {
                if (!clearOperationOrFailClosed()) return;
                setTerminalError(true);
                setSubmissionError(t.rescheduleNotFound);
                return;
            }
            if (response.status === 400) {
                if (!clearOperationOrFailClosed()) return;
                setTerminalError(true);
                setSubmissionError(t.rescheduleInvalid);
                return;
            }

            setSubmissionError(t.rescheduleRetryable);
        } catch {
            setSubmissionError(t.rescheduleNetworkError);
        } finally {
            submittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const closeLabel = t.rescheduleClose || t.cancel;
    const submitLabel = pendingOperation ? t.rescheduleRetry : t.rescheduleConfirm;
    const describedBy = [descriptionId, targetsError ? targetErrorId : null, submissionError ? submissionErrorId : null]
        .filter(Boolean)
        .join(' ');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={handleClose} />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={describedBy}
                aria-busy={isSubmitting}
                tabIndex={-1}
                data-testid="student-reschedule-modal"
                className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto outline-none"
            >
                <div className="flex justify-between items-start gap-4 mb-4">
                    <div>
                        <h2 id={titleId} className="font-display text-xl text-[#006064] uppercase">
                            {t.rescheduleTitle}
                        </h2>
                        <p id={descriptionId} className="text-sm text-[#006064]/70 mt-1">
                            {t.rescheduleIntro}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        aria-label={closeLabel}
                        className="text-[#006064] hover:opacity-70 text-2xl disabled:opacity-50"
                    >
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>

                <div className="mb-5 p-4 bg-[#E0F7FA] border border-[#006064]/20">
                    <time className="font-bold text-[#006064]" dateTime={session.scheduled_at}>
                        {formatDateTime(session.scheduled_at)}
                    </time>
                    <p className="text-sm text-[#006064]/70">
                        {t.with}: {session.teacher.full_name || session.teacher.email}
                    </p>
                </div>

                {pendingOperation && (
                    <div role="status" className="mb-5 p-3 border-2 border-amber-400 bg-amber-50 text-sm text-amber-900">
                        {t.reschedulePendingNotice}
                    </div>
                )}

                <div className="mb-5">
                    <label htmlFor={dateInputId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                        {t.rescheduleDateLabel}
                    </label>
                    <input
                        id={dateInputId}
                        type="date"
                        value={selectedDate}
                        min={today}
                        onChange={(event) => handleDateChange(event.target.value)}
                        disabled={isSubmitting || !!pendingOperation || terminalError}
                        className="w-full p-3 border-2 border-[#006064] text-[#006064] disabled:bg-gray-100 disabled:opacity-70"
                    />
                </div>

                {isLoadingTargets && (
                    <p role="status" className="mb-4 text-sm font-mono text-[#006064]/70">
                        {t.rescheduleLoadingTargets}
                    </p>
                )}

                {targetsError && (
                    <div id={targetErrorId} role="alert" className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {targetsError}
                    </div>
                )}

                {!isLoadingTargets && selectedDate && !targetsError && targets.length === 0 && !selectedTarget && (
                    <p className="mb-4 p-3 bg-gray-100 text-[#006064]/70 text-sm">
                        {t.rescheduleNoTargets}
                    </p>
                )}

                {targets.length > 0 && (
                    <fieldset className="mb-5" disabled={isSubmitting || !!pendingOperation || terminalError}>
                        <legend className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.rescheduleTargetsLabel}
                        </legend>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {targets.map((target) => (
                                <button
                                    key={target.scheduledAt}
                                    type="button"
                                    onClick={() => {
                                        setSelectedTarget(target);
                                        setSubmissionError(null);
                                    }}
                                    aria-pressed={selectedTarget?.scheduledAt === target.scheduledAt}
                                    aria-label={`${t.rescheduleChooseTarget}: ${formatDateTime(target.scheduledAt)}`}
                                    className={`p-3 border-2 text-sm font-mono transition-colors disabled:opacity-60 ${
                                        selectedTarget?.scheduledAt === target.scheduledAt
                                            ? 'bg-[#006064] text-white border-[#006064]'
                                            : 'border-[#006064]/30 text-[#006064] hover:border-[#006064]'
                                    }`}
                                >
                                    {formatTime(target.scheduledAt)}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                )}

                {selectedTarget && (
                    <div className="mb-5 p-4 border-2 border-[#006064] bg-[#E0F7FA]" aria-live="polite">
                        <p className="text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.rescheduleAffectedDates}
                        </p>
                        <ul className="space-y-1 text-sm text-[#006064]">
                            {selectedTarget.affectedScheduledAts.map((affectedAt) => (
                                <li key={affectedAt}>
                                    <time dateTime={affectedAt}>{formatDateTime(affectedAt)}</time>
                                </li>
                            ))}
                        </ul>
                        {selectedTarget.operationKind === 'provisional_anchor' && (
                            <p className="mt-3 p-3 bg-amber-50 border border-amber-400 text-sm font-bold text-amber-900">
                                {t.rescheduleProvisionalWarning}
                            </p>
                        )}
                    </div>
                )}

                {submissionError && (
                    <div id={submissionErrorId} role="alert" className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {submissionError}
                    </div>
                )}

                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="flex-1 px-4 py-3 bg-white text-[#006064] font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#E0F7FA] transition-colors disabled:opacity-50"
                    >
                        {t.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={isSubmitting || !selectedTarget || terminalError}
                        aria-busy={isSubmitting}
                        className="flex-1 px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? t.rescheduleSubmitting : submitLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
