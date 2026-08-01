import { useState, useEffect } from 'react';
import { DEFAULT_CLASS_DURATION_MINUTES } from '../../../lib/class-duration';
import {
    dayOfWeekForDateKey,
    MADRID_TIME_ZONE,
    madridDateTimeToUtcIso,
} from '../../../lib/calendar/madrid-time';

export interface Slot {
    slot_start: string;
    slot_end: string;
}

type SlotsResponse = {
    error?: string;
    slots?: Slot[];
};

type SessionCreateResponse = {
    error?: string;
    session?: unknown;
};

type RecurringSessionsResponse = {
    error?: string;
    created?: number;
    errors?: string[];
    sessions?: unknown[];
};

const madridTimeFromInstant = (value: string): string => new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: MADRID_TIME_ZONE,
}).format(new Date(value));

interface UseAdminScheduleProps {
    isOpen: boolean;
    onSessionCreated: (session: unknown) => void;
    onClose: () => void;
}

export function useAdminSchedule({ isOpen, onSessionCreated, onClose }: UseAdminScheduleProps) {
    // Estado del Wizard
    const [step, setStep] = useState(1);

    // Estado del Formulario
    const [selectedStudent, setSelectedStudent] = useState('');
    const [selectedTeacher, setSelectedTeacher] = useState('');
    const [selectedDate, setSelectedDate] = useState('');
    const [duration, setDuration] = useState(DEFAULT_CLASS_DURATION_MINUTES);

    // Estado de Slots vs Custom Time
    const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
    const [useCustomTime, setUseCustomTime] = useState(false);
    const [customTime, setCustomTime] = useState('09:00');

    // Estado de Videollamada
    const [meetLink, setMeetLink] = useState('');
    const [autoCreateMeeting, setAutoCreateMeeting] = useState(true);

    // Estado de Recurrencia
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurringEndDate, setRecurringEndDate] = useState('');

    // Estado UI
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recurringResult, setRecurringResult] = useState<{ created: number; errors?: string[] } | null>(null);

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setSelectedStudent('');
            setSelectedTeacher('');
            setSelectedDate('');
            setSelectedSlot(null);
            setAvailableSlots([]);
            setDuration(DEFAULT_CLASS_DURATION_MINUTES);
            setMeetLink('');
            setError(null);
            setUseCustomTime(false);
            setCustomTime('09:00');
            setAutoCreateMeeting(true);
            setIsRecurring(false);
            setRecurringEndDate('');
            setRecurringResult(null);
        }
    }, [isOpen]);

    useEffect(() => {
        setSelectedSlot(null);
    }, [selectedDate, selectedTeacher, useCustomTime, duration]);

    // Fetch Slots
    useEffect(() => {
        if (!selectedDate || !selectedTeacher || useCustomTime) {
            setAvailableSlots([]);
            return;
        }

        const controller = new AbortController();

        const fetchAvailableSlots = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const params = new URLSearchParams({
                    teacherId: selectedTeacher,
                    date: selectedDate,
                    duration: String(duration),
                });

                const response = await fetch(`/api/calendar/available-slots?${params.toString()}`, {
                    signal: controller.signal,
                });

                if (!response.ok) throw new Error('Failed to fetch slots');

                const data = await response.json() as SlotsResponse;
                if (controller.signal.aborted) return;
                setAvailableSlots(data.slots || []);
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return;
                setError('Error al cargar horarios disponibles');
            } finally {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            }
        };

        fetchAvailableSlots();

        return () => {
            controller.abort();
        };
    }, [selectedDate, selectedTeacher, useCustomTime, duration]);

    // Submit Logic
    const handleSubmit = async () => {
        if (!selectedStudent || !selectedTeacher || !selectedDate) return;

        let scheduledAt: string;

        if (useCustomTime) {
            if (!customTime) return;
            const customInstant = madridDateTimeToUtcIso(selectedDate, customTime);
            if (!customInstant) {
                setError('La hora seleccionada no existe o es ambigua en Europe/Madrid');
                return;
            }
            scheduledAt = customInstant;
        } else if (selectedSlot) {
            scheduledAt = selectedSlot.slot_start;
        } else {
            return;
        }
        const normalizedMeetLink = meetLink.trim();

        setIsLoading(true);
        setError(null);
        setRecurringResult(null);

        try {
            if (isRecurring) {
                // Recurring: call bulk endpoint
                const dayOfWeek = dayOfWeekForDateKey(selectedDate);
                const time = useCustomTime ? customTime : madridTimeFromInstant(scheduledAt);

                const response = await fetch('/api/calendar/recurring-sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: selectedStudent,
                        teacherId: selectedTeacher,
                        dayOfWeek,
                        time,
                        durationMinutes: duration,
                        startDate: selectedDate,
                        endDate: recurringEndDate || undefined,
                        autoCreateMeeting,
                        meetLink: normalizedMeetLink || null,
                    })
                });

                if (!response.ok) {
                    const data = await response.json() as RecurringSessionsResponse;
                    throw new Error(data.error || 'Failed to create recurring sessions');
                }

                const data = await response.json() as RecurringSessionsResponse;
                setRecurringResult({ created: data.created ?? 0, errors: data.errors });

                if ((data.created ?? 0) > 0) {
                    onSessionCreated(data.sessions?.[0] || null);
                    // Don't close immediately — show result summary
                }
            } else {
                // Single session
                const response = await fetch('/api/calendar/sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        studentId: selectedStudent,
                        teacherId: selectedTeacher,
                        scheduledAt,
                        durationMinutes: duration,
                        meetLink: normalizedMeetLink || null,
                        autoCreateMeeting,
                    })
                });

                if (!response.ok) {
                    const data = await response.json() as SessionCreateResponse;
                    throw new Error(data.error || 'Failed to create session');
                }

                const data = await response.json() as SessionCreateResponse;
                onSessionCreated(data.session);
                onClose();
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Error al programar la clase';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    return {
        // State
        step,
        selectedStudent,
        selectedTeacher,
        selectedDate,
        duration,
        availableSlots,
        selectedSlot,
        useCustomTime,
        customTime,
        meetLink,
        autoCreateMeeting,
        isRecurring,
        recurringEndDate,
        recurringResult,
        isLoading,
        error,
        // Setters
        setStep,
        setSelectedStudent,
        setSelectedTeacher,
        setSelectedDate,
        setDuration,
        setSelectedSlot,
        setUseCustomTime,
        setCustomTime,
        setMeetLink,
        setAutoCreateMeeting,
        setIsRecurring,
        setRecurringEndDate,
        // Actions
        handleSubmit
    };
}
