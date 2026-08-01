import React, { useState, useEffect, useId } from 'react';
import { CLASS_DURATION_OPTIONS_MINUTES, DEFAULT_CLASS_DURATION_MINUTES } from '../../lib/class-duration';
import { MADRID_TIME_ZONE, madridDateKey } from '../../lib/calendar/madrid-time';

interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

interface Slot {
    slot_start: string;
    slot_end: string;
}

type CreatedSession = {
    id: string;
    scheduled_at: string;
    duration_minutes: number;
    status: string;
    meet_link: string | null;
    teacher_notes: string | null;
    drive_doc_url: string | null;
    student: {
        id: string;
        full_name: string | null;
        email: string;
    };
};

interface ScheduleSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    students: Student[];
    teacherId: string;
    lang: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translations: Record<string, any>;
    onSessionCreated: (session: CreatedSession) => void;
}

type SessionCreateResponse = {
    error?: string;
    session?: unknown;
};

const isNullableString = (value: unknown): value is string | null => (
    value === null || typeof value === 'string'
);

const hasExplicitOffset = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);

const slotsFromPayload = (value: unknown): Slot[] | null => {
    if (!value || typeof value !== 'object') return null;
    const slots = (value as { slots?: unknown }).slots;
    if (!Array.isArray(slots)) return null;

    return slots.every((slot) => {
        if (!slot || typeof slot !== 'object') return false;
        const candidate = slot as Partial<Slot>;
        if (
            typeof candidate.slot_start !== 'string'
            || typeof candidate.slot_end !== 'string'
            || !hasExplicitOffset(candidate.slot_start)
            || !hasExplicitOffset(candidate.slot_end)
        ) {
            return false;
        }
        const start = Date.parse(candidate.slot_start);
        const end = Date.parse(candidate.slot_end);
        return Number.isFinite(start) && Number.isFinite(end) && end > start;
    }) ? slots as Slot[] : null;
};

const isCreatedSession = (value: unknown): value is CreatedSession => {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<CreatedSession>;
    const student = session.student as Partial<CreatedSession['student']> | null | undefined;

    return typeof session.id === 'string'
        && typeof session.scheduled_at === 'string'
        && !Number.isNaN(Date.parse(session.scheduled_at))
        && typeof session.duration_minutes === 'number'
        && typeof session.status === 'string'
        && isNullableString(session.meet_link)
        && isNullableString(session.teacher_notes)
        && isNullableString(session.drive_doc_url)
        && Boolean(student)
        && typeof student?.id === 'string'
        && isNullableString(student?.full_name)
        && typeof student?.email === 'string';
};

const formatDateInputValue = (date = new Date()) => {
    return madridDateKey(date);
};

export default function ScheduleSessionModal({
    isOpen,
    onClose,
    students,
    teacherId,
    lang,
    translations: t,
    onSessionCreated
}: ScheduleSessionModalProps) {
    const [step, setStep] = useState(1);
    const [selectedStudent, setSelectedStudent] = useState('');
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
    const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
    const [duration, setDuration] = useState(DEFAULT_CLASS_DURATION_MINUTES);
    const [meetLink, setMeetLink] = useState('');
    const [isFetchingSlots, setIsFetchingSlots] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const modalId = useId();
    const titleId = `${modalId}-title`;
    const studentSelectId = `${modalId}-student`;
    const dateInputId = `${modalId}-date`;
    const durationSelectId = `${modalId}-duration`;
    const timeLabelId = `${modalId}-time`;
    const meetLinkId = `${modalId}-meet-link`;
    const closeLabel = t.close || t.cancel || 'Cerrar';

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setSelectedStudent('');
            setSelectedDate('');
            setSelectedSlot(null);
            setAvailableSlots([]);
            setDuration(DEFAULT_CLASS_DURATION_MINUTES);
            setMeetLink('');
            setIsFetchingSlots(false);
            setIsSubmitting(false);
            setError(null);
        }
    }, [isOpen]);

    // Cargar slots disponibles cuando se selecciona fecha
    useEffect(() => {
        if (!isOpen || !selectedDate) {
            setAvailableSlots([]);
            return;
        }

        const controller = new AbortController();

        const fetchAvailableSlots = async () => {
            setIsFetchingSlots(true);
            setError(null);
            setAvailableSlots([]);

            try {
                const params = new URLSearchParams({
                    teacherId,
                    date: selectedDate,
                    duration: String(duration),
                });
                const response = await fetch(`/api/calendar/available-slots?${params.toString()}`, {
                    signal: controller.signal,
                });

                if (controller.signal.aborted) return;

                if (!response.ok) {
                    throw new Error('Failed to fetch slots');
                }

                const data: unknown = await response.json();
                if (controller.signal.aborted) return;
                const slots = slotsFromPayload(data);
                if (!slots) throw new Error('Invalid slots response');
                setAvailableSlots(slots);
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return;
                setError(t.errorLoadingSlots || 'Error');
            } finally {
                if (!controller.signal.aborted) {
                    setIsFetchingSlots(false);
                }
            }
        };

        fetchAvailableSlots();

        return () => {
            controller.abort();
        };
    }, [isOpen, selectedDate, teacherId, duration, t.errorLoadingSlots]);

    const handleClose = () => {
        if (isSubmitting) return;
        onClose();
    };

    const handleDateChange = (value: string) => {
        setSelectedDate(value);
        setSelectedSlot(null);
        setAvailableSlots([]);
    };

    const handleDurationChange = (value: string) => {
        setDuration(Number(value));
        setSelectedSlot(null);
        setAvailableSlots([]);
    };

    const handleSubmit = async () => {
        if (!selectedStudent || !selectedSlot || isSubmitting) return;

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/calendar/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: selectedStudent,
                    teacherId,
                    scheduledAt: selectedSlot.slot_start,
                    durationMinutes: duration,
                    meetLink: meetLink.trim() || null
                })
            });

            if (!response.ok) {
                const data = await response.json() as SessionCreateResponse;
                throw new Error(data.error || 'Failed to create session');
            }

            const data = await response.json() as SessionCreateResponse;
            if (!isCreatedSession(data.session)) {
                throw new Error(t.errorScheduling || 'Invalid session response');
            }
            onSessionCreated(data.session);
            setIsSubmitting(false);
            onClose();
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message || t.errorScheduling || 'Error');
            setIsSubmitting(false);
        }
    };

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: MADRID_TIME_ZONE,
        });
    };

    // Fecha mínima: hoy
    const today = formatDateInputValue();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={handleClose} aria-hidden="true" />

            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-busy={isSubmitting}
                className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 id={titleId} className="font-display text-xl text-[#006064] uppercase">{t.scheduleClass}</h2>
                    <button
                        type="button"
                        aria-label={closeLabel}
                        onClick={handleClose}
                        disabled={isSubmitting}
                        className="text-[#006064] hover:opacity-70 text-2xl disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        ×
                    </button>
                </div>

                {/* Error */}
                {error && (
                    <div role="alert" className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* Step 1: Seleccionar estudiante */}
                {step === 1 && (
                    <div className="space-y-4">
                        <label htmlFor={studentSelectId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.selectStudent}
                        </label>
                        <select
                            id={studentSelectId}
                            value={selectedStudent}
                            onChange={(e) => setSelectedStudent(e.target.value)}
                            className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                        >
                            <option value="">{t.selectStudent}...</option>
                            {students.map(student => (
                                <option key={student.id} value={student.id}>
                                    {student.full_name || student.email}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={!selectedStudent}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t.continue || '→'}
                        </button>
                    </div>
                )}

                {/* Step 2: Seleccionar fecha */}
                {step === 2 && (
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="text-sm text-[#006064] hover:opacity-70"
                        >
                            {t.back || '←'}
                        </button>

                        <label htmlFor={dateInputId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.selectDate}
                        </label>
                        <input
                            id={dateInputId}
                            type="date"
                            value={selectedDate}
                            onChange={(e) => handleDateChange(e.target.value)}
                            min={today}
                            className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                        />

                        <label htmlFor={durationSelectId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.duration}
                        </label>
                        <select
                            id={durationSelectId}
                            value={duration}
                            onChange={(e) => handleDurationChange(e.target.value)}
                            className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                        >
                            {CLASS_DURATION_OPTIONS_MINUTES.map((minutes) => (
                                <option key={minutes} value={minutes}>
                                    {minutes} {t.minutes}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={() => setStep(3)}
                            disabled={!selectedDate}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t.continue || '→'}
                        </button>
                    </div>
                )}

                {/* Step 3: Seleccionar hora */}
                {step === 3 && (
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="text-sm text-[#006064] hover:opacity-70"
                        >
                            {t.back || '←'}
                        </button>

                        <p id={timeLabelId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.selectTime}
                        </p>

                        {isFetchingSlots ? (
                            <div role="status" className="text-center py-8 text-[#006064]/60">{t.loading || '...'}</div>
                        ) : availableSlots.length === 0 ? (
                            <div role="status" className="text-center py-8 text-[#006064]/60">
                                {t.noSlotsDate || '–'}
                                <br />
                                <span className="text-sm">{t.setupAvailability || ''}</span>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                                {availableSlots.map((slot, index) => (
                                    <button
                                        key={index}
                                        type="button"
                                        onClick={() => setSelectedSlot(slot)}
                                        aria-pressed={selectedSlot?.slot_start === slot.slot_start}
                                        aria-label={`${t.selectTime}: ${formatTime(slot.slot_start)}`}
                                        className={`p-3 border-2 text-sm font-mono transition-colors ${selectedSlot?.slot_start === slot.slot_start
                                            ? 'bg-[#006064] text-white border-[#006064]'
                                            : 'border-[#006064]/30 text-[#006064] hover:border-[#006064]'
                                            }`}
                                    >
                                        {formatTime(slot.slot_start)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {selectedSlot && (
                            <button
                                type="button"
                                onClick={() => setStep(4)}
                                className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                            >
                                {t.continue || '→'}
                            </button>
                        )}
                    </div>
                )}

                {/* Step 4: Confirmar */}
                {step === 4 && (
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => setStep(3)}
                            disabled={isSubmitting}
                            className="text-sm text-[#006064] hover:opacity-70"
                        >
                            {t.back || '←'}
                        </button>

                        {/* Resumen */}
                        <div className="p-4 bg-[#E0F7FA] border border-[#006064]/20">
                            <h3 className="font-bold text-[#006064] mb-2">{t.summary || '–'}</h3>
                            <div className="text-sm text-[#006064]/80 space-y-1">
                                <p><strong>{t.studentLabel || ''}</strong> {students.find(s => s.id === selectedStudent)?.full_name || students.find(s => s.id === selectedStudent)?.email}</p>
                                <p><strong>{t.dateLabel || ''}</strong> {new Date(`${selectedDate}T12:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: MADRID_TIME_ZONE })}</p>
                                <p><strong>{t.timeLabel || ''}</strong> {selectedSlot && formatTime(selectedSlot.slot_start)}</p>
                                <p><strong>{t.duration}:</strong> {duration} {t.minutes}</p>
                            </div>
                        </div>

                        {/* Link de Meet (opcional) */}
                        <div>
                            <label htmlFor={meetLinkId} className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                                {t.meetLinkOptional || ''}
                            </label>
                            <input
                                id={meetLinkId}
                                name="meet_link"
                                type="url"
                                value={meetLink}
                                disabled={isSubmitting}
                                onChange={(e) => setMeetLink(e.target.value)}
                                placeholder="https://meet.google.com/..."
                                className="w-full p-3 border-2 border-[#006064] text-[#006064] placeholder-[#006064]/40 disabled:cursor-not-allowed disabled:opacity-70"
                            />
                        </div>

                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={isSubmitting}
                            aria-busy={isSubmitting}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50"
                        >
                            {isSubmitting ? '...' : t.confirm}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
