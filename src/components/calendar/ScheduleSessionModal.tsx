import React, { useState, useEffect } from 'react';

interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

interface Slot {
    slot_start: string;
    slot_end: string;
}

interface ScheduleSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    students: Student[];
    teacherId: string;
    lang: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translations: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSessionCreated: (session: any) => void;
}

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
    const [duration, setDuration] = useState(60);
    const [meetLink, setMeetLink] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset al abrir
    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setSelectedStudent('');
            setSelectedDate('');
            setSelectedSlot(null);
            setAvailableSlots([]);
            setDuration(60);
            setMeetLink('');
            setError(null);
        }
    }, [isOpen]);

    // Cargar slots disponibles cuando se selecciona fecha
    // Cargar slots disponibles cuando se selecciona fecha
    useEffect(() => {
        const fetchAvailableSlots = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const response = await fetch(
                    `/api/calendar/available-slots?teacherId=${teacherId}&date=${selectedDate}&duration=${duration}`
                );

                if (!response.ok) {
                    throw new Error('Failed to fetch slots');
                }

                const data = await response.json();
                setAvailableSlots(data.slots || []);
            } catch {
                setError('Error al cargar horarios disponibles');
            } finally {
                setIsLoading(false);
            }
        };

        if (selectedDate) {
            fetchAvailableSlots();
        }
    }, [selectedDate, teacherId, duration]);

    const handleSubmit = async () => {
        if (!selectedStudent || !selectedSlot) return;

        setIsLoading(true);
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
                    meetLink: meetLink || null
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create session');
            }

            const data = await response.json();
            onSessionCreated(data.session);
            onClose();

            // Recargar la página para mostrar la nueva sesión
            window.location.reload();
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message || 'Error al programar la clase');
        } finally {
            setIsLoading(false);
        }
    };

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Fecha mínima: hoy
    const today = new Date().toISOString().split('T')[0];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-display text-xl text-[#006064] uppercase">{t.scheduleClass}</h2>
                    <button onClick={onClose} className="text-[#006064] hover:opacity-70 text-2xl">×</button>
                </div>

                {/* Error */}
                {error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* Step 1: Seleccionar estudiante */}
                {step === 1 && (
                    <div className="space-y-4">
                        <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.selectStudent}
                        </label>
                        <select
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
                            onClick={() => setStep(2)}
                            disabled={!selectedStudent}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar →
                        </button>
                    </div>
                )}

                {/* Step 2: Seleccionar fecha */}
                {step === 2 && (
                    <div className="space-y-4">
                        <button
                            onClick={() => setStep(1)}
                            className="text-sm text-[#006064] hover:opacity-70"
                        >
                            ← Volver
                        </button>

                        <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.selectDate}
                        </label>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            min={today}
                            className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                        />

                        <button
                            onClick={() => setStep(3)}
                            disabled={!selectedDate}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar →
                        </button>
                    </div>
                )}

                {/* Step 3: Seleccionar hora */}
                {step === 3 && (
                    <div className="space-y-4">
                        <button
                            onClick={() => setStep(2)}
                            className="text-sm text-[#006064] hover:opacity-70"
                        >
                            ← Volver
                        </button>

                        <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                            {t.selectTime}
                        </label>

                        {isLoading ? (
                            <div className="text-center py-8 text-[#006064]/60">Cargando...</div>
                        ) : availableSlots.length === 0 ? (
                            <div className="text-center py-8 text-[#006064]/60">
                                No hay horarios disponibles para esta fecha.
                                <br />
                                <span className="text-sm">Configura tu disponibilidad primero.</span>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                                {availableSlots.map((slot, index) => (
                                    <button
                                        key={index}
                                        onClick={() => setSelectedSlot(slot)}
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
                                onClick={() => setStep(4)}
                                className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                            >
                                Continuar →
                            </button>
                        )}
                    </div>
                )}

                {/* Step 4: Confirmar */}
                {step === 4 && (
                    <div className="space-y-4">
                        <button
                            onClick={() => setStep(3)}
                            className="text-sm text-[#006064] hover:opacity-70"
                        >
                            ← Volver
                        </button>

                        {/* Resumen */}
                        <div className="p-4 bg-[#E0F7FA] border border-[#006064]/20">
                            <h3 className="font-bold text-[#006064] mb-2">Resumen</h3>
                            <div className="text-sm text-[#006064]/80 space-y-1">
                                <p><strong>Estudiante:</strong> {students.find(s => s.id === selectedStudent)?.full_name || students.find(s => s.id === selectedStudent)?.email}</p>
                                <p><strong>Fecha:</strong> {new Date(selectedDate).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                                <p><strong>Hora:</strong> {selectedSlot && formatTime(selectedSlot.slot_start)}</p>
                                <p><strong>Duración:</strong> {duration} min</p>
                            </div>
                        </div>

                        {/* Link de Meet (opcional) */}
                        <div>
                            <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                                Link de Google Meet (opcional)
                            </label>
                            <input
                                type="url"
                                value={meetLink}
                                onChange={(e) => setMeetLink(e.target.value)}
                                placeholder="https://meet.google.com/..."
                                className="w-full p-3 border-2 border-[#006064] text-[#006064] placeholder-[#006064]/40"
                            />
                        </div>

                        <button
                            onClick={handleSubmit}
                            disabled={isLoading}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50"
                        >
                            {isLoading ? '...' : t.confirm}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
