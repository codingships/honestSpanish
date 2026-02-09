import { useState, useEffect } from 'react';

export interface Slot {
    slot_start: string;
    slot_end: string;
}

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
    const [duration, setDuration] = useState(60);

    // Estado de Slots vs Custom Time
    const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
    const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
    const [useCustomTime, setUseCustomTime] = useState(false);
    const [customTime, setCustomTime] = useState('09:00');

    // Estado de Videollamada
    const [meetLink, setMeetLink] = useState('');
    const [autoCreateMeeting, setAutoCreateMeeting] = useState(true); // Nuevo: Por defecto true

    // Estado UI
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setSelectedStudent('');
            setSelectedTeacher('');
            setSelectedDate('');
            setSelectedSlot(null);
            setAvailableSlots([]);
            setDuration(60);
            setMeetLink('');
            setError(null);
            setUseCustomTime(false);
            setCustomTime('09:00');
            setAutoCreateMeeting(true);
        }
    }, [isOpen]);

    // Fetch Slots
    useEffect(() => {
        const fetchAvailableSlots = async () => {
            if (!selectedDate || !selectedTeacher || useCustomTime) return;

            setIsLoading(true);
            setError(null);

            try {
                const response = await fetch(
                    `/api/calendar/available-slots?teacherId=${selectedTeacher}&date=${selectedDate}&duration=${duration}`
                );

                if (!response.ok) throw new Error('Failed to fetch slots');

                const data = await response.json();
                setAvailableSlots(data.slots || []);
            } catch {
                setError('Error al cargar horarios disponibles');
            } finally {
                setIsLoading(false);
            }
        };

        fetchAvailableSlots();
    }, [selectedDate, selectedTeacher, useCustomTime, duration]);

    // Submit Logic
    const handleSubmit = async () => {
        if (!selectedStudent || !selectedTeacher) return;

        let scheduledAt: string;

        if (useCustomTime) {
            scheduledAt = `${selectedDate}T${customTime}:00`;
        } else if (selectedSlot) {
            scheduledAt = selectedSlot.slot_start;
        } else {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/calendar/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: selectedStudent,
                    teacherId: selectedTeacher,
                    scheduledAt,
                    durationMinutes: duration,
                    meetLink: meetLink || null,
                    autoCreateMeeting, // 👇 Flag crítico para tu backend
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create session');
            }

            const data = await response.json();
            onSessionCreated(data.session);
            onClose();
            // Eliminado reload() forzado para mejor UX
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
        // Actions
        handleSubmit
    };
}