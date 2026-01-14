import React, { useState, useEffect } from 'react';

interface Teacher {
    id: string;
    full_name: string | null;
    email: string;
}

interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

interface Slot {
    slot_start: string;
    slot_end: string;
}


interface AdminScheduleModalProps {
    isOpen: boolean;

    onClose: () => void;
    teachers: Teacher[];
    students: Student[];
    lang: string;
    translations: Record<string, string>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSessionCreated: (session: any) => void;
}

export default function AdminScheduleModal({
    isOpen,
    onClose,
    teachers,
    students,
    lang,
    translations: t,
    onSessionCreated
}: AdminScheduleModalProps) {
    const [step, setStep] = useState(1);
    const [selectedStudent, setSelectedStudent] = useState('');
    const [selectedTeacher, setSelectedTeacher] = useState('');
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
    const [availableSlots, setAvailableSlots] = useState<Slot[]>([]);
    const [duration, setDuration] = useState(60);
    const [meetLink, setMeetLink] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [useCustomTime, setUseCustomTime] = useState(false);
    const [customTime, setCustomTime] = useState('09:00');

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
        }
    }, [isOpen]);

    useEffect(() => {
        const fetchAvailableSlots = async () => {
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

        if (selectedDate && selectedTeacher && !useCustomTime) {
            fetchAvailableSlots();
        }
    }, [selectedDate, selectedTeacher, useCustomTime, duration]);

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

    const today = new Date().toISOString().split('T')[0];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-display text-xl text-[#006064] uppercase">{t.scheduleClass}</h2>
                    <button onClick={onClose} className="text-[#006064] hover:opacity-70 text-2xl">×</button>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* Step 1: Estudiante y Profesor */}
                {step === 1 && (
                    <div className="space-y-4">
                        <div>
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
                        </div>

                        <div>
                            <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                                {t.selectTeacher}
                            </label>
                            <select
                                value={selectedTeacher}
                                onChange={(e) => setSelectedTeacher(e.target.value)}
                                className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                            >
                                <option value="">{t.selectTeacher}...</option>
                                {teachers.map(teacher => (
                                    <option key={teacher.id} value={teacher.id}>
                                        {teacher.full_name || teacher.email}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={() => setStep(2)}
                            disabled={!selectedStudent || !selectedTeacher}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar →
                        </button>
                    </div>
                )}

                {/* Step 2: Fecha */}
                {step === 2 && (
                    <div className="space-y-4">
                        <button onClick={() => setStep(1)} className="text-sm text-[#006064] hover:opacity-70">
                            ← Volver
                        </button>

                        <div>
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
                        </div>

                        <button
                            onClick={() => setStep(3)}
                            disabled={!selectedDate}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar →
                        </button>
                    </div>
                )}

                {/* Step 3: Hora */}
                {step === 3 && (
                    <div className="space-y-4">
                        <button onClick={() => setStep(2)} className="text-sm text-[#006064] hover:opacity-70">
                            ← Volver
                        </button>

                        {/* Toggle entre slots y hora custom */}
                        <div className="flex items-center gap-4 p-3 bg-[#E0F7FA] border border-[#006064]/20">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useCustomTime}
                                    onChange={(e) => {
                                        setUseCustomTime(e.target.checked);
                                        setSelectedSlot(null);
                                    }}
                                    className="w-4 h-4"
                                />
                                <span className="text-sm text-[#006064]">Usar hora personalizada (ignorar disponibilidad)</span>
                            </label>
                        </div>

                        {useCustomTime ? (
                            <div>
                                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                                    Hora personalizada
                                </label>
                                <input
                                    type="time"
                                    value={customTime}
                                    onChange={(e) => setCustomTime(e.target.value)}
                                    className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                                />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                                    {t.selectTime}
                                </label>

                                {isLoading ? (
                                    <div className="text-center py-8 text-[#006064]/60">Cargando...</div>
                                ) : availableSlots.length === 0 ? (
                                    <div className="text-center py-8 text-[#006064]/60">
                                        No hay horarios disponibles.
                                        <br />
                                        <button
                                            onClick={() => setUseCustomTime(true)}
                                            className="mt-2 text-sm text-[#006064] underline"
                                        >
                                            Usar hora personalizada
                                        </button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
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
                            </div>
                        )}

                        {(selectedSlot || useCustomTime) && (
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
                        <button onClick={() => setStep(3)} className="text-sm text-[#006064] hover:opacity-70">
                            ← Volver
                        </button>

                        <div className="p-4 bg-[#E0F7FA] border border-[#006064]/20">
                            <h3 className="font-bold text-[#006064] mb-2">Resumen</h3>
                            <div className="text-sm text-[#006064]/80 space-y-1">
                                <p><strong>Estudiante:</strong> {students.find(s => s.id === selectedStudent)?.full_name || students.find(s => s.id === selectedStudent)?.email}</p>
                                <p><strong>Profesor:</strong> {teachers.find(t => t.id === selectedTeacher)?.full_name || teachers.find(t => t.id === selectedTeacher)?.email}</p>
                                <p><strong>Fecha:</strong> {new Date(selectedDate).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                                <p><strong>Hora:</strong> {useCustomTime ? customTime : (selectedSlot && formatTime(selectedSlot.slot_start))}</p>
                                <p><strong>Duración:</strong> {duration} min</p>
                            </div>
                        </div>

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
