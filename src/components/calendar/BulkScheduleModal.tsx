import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CLASS_DURATION_OPTIONS_MINUTES, DEFAULT_CLASS_DURATION_MINUTES } from '../../lib/class-duration';

const MAX_BULK_CLASSES = 48;

interface Student {
    id: string;
    full_name: string | null;
    email: string;
}

interface BulkScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    students: Student[];
    teacherId: string;
    lang: string;
    translations: Record<string, unknown>;
    onSessionsCreated: () => void; // Trigger a reload
}

type BulkScheduleResponse = {
    error?: string;
};

export default function BulkScheduleModal({
    isOpen,
    onClose,
    students,
    teacherId,
    lang,
    translations: _t,
    onSessionsCreated
}: BulkScheduleModalProps) {
    const [step, setStep] = useState(1);
    const [selectedStudent, setSelectedStudent] = useState('');

    // Pattern parameters
    const [startDate, setStartDate] = useState('');
    const [startTime, setStartTime] = useState('10:00');
    const [numberOfClasses, setNumberOfClasses] = useState(8);
    const [duration, setDuration] = useState(DEFAULT_CLASS_DURATION_MINUTES);

    // Generated list of dates
    const [scheduledDates, setScheduledDates] = useState<Date[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successCount, setSuccessCount] = useState<number | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const today = new Date().toISOString().split('T')[0];

    const clearCloseTimer = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            clearCloseTimer();
            setStep(1);
            setSelectedStudent('');
            setStartDate('');
            setStartTime('10:00');
            setNumberOfClasses(8);
            setDuration(DEFAULT_CLASS_DURATION_MINUTES);
            setScheduledDates([]);
            setError(null);
            setSuccessCount(null);
            setIsLoading(false);
        }
    }, [clearCloseTimer, isOpen]);

    useEffect(() => () => {
        clearCloseTimer();
    }, [clearCloseTimer]);

    const generateDates = () => {
        setError(null);

        if (!startDate || !startTime) {
            setError('Selecciona fecha y hora antes de generar horarios.');
            return;
        }

        if (startDate < today) {
            setError('La fecha de inicio no puede estar en el pasado.');
            return;
        }

        if (numberOfClasses < 1 || numberOfClasses > MAX_BULK_CLASSES) {
            setError(`El total de clases debe estar entre 1 y ${MAX_BULK_CLASSES}.`);
            return;
        }

        const dates: Date[] = [];
        const [year, month, day] = startDate.split('-').map(Number);
        const [hours, minutes] = startTime.split(':').map(Number);

        let current = new Date(year, month - 1, day, hours, minutes);
        if ([year, month, day, hours, minutes].some((value) => !Number.isFinite(value)) || Number.isNaN(current.getTime())) {
            setError('Fecha u hora no validas.');
            return;
        }

        for (let i = 0; i < numberOfClasses; i++) {
            dates.push(new Date(current));
            // Add 7 days exactly
            current = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
        setScheduledDates(dates);
        setStep(3);
    };

    const formatScheduledDate = (date: Date) => `${date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'short', day: '2-digit', month: 'short' })} - ${date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`;

    const removeDate = (indexToRemove: number) => {
        setScheduledDates(prev => prev.filter((_, i) => i !== indexToRemove));
    };

    const handleClose = () => {
        if (isLoading) return;

        clearCloseTimer();
        if (successCount !== null) {
            onSessionsCreated();
        }
        onClose();
    };

    const handleSubmit = async () => {
        if (!selectedStudent || scheduledDates.length === 0) return;

        setIsLoading(true);
        setError(null);

        try {
            const isoStrings = scheduledDates.map(d => d.toISOString());

            const response = await fetch('/api/calendar/bulk-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId: selectedStudent,
                    teacherId,
                    sessions: isoStrings,
                    durationMinutes: duration,
                })
            });

            const data = await response.json() as BulkScheduleResponse;

            if (!response.ok) {
                throw new Error(data.error || 'Failed to bulk create sessions');
            }

            setSuccessCount(isoStrings.length);
            // Don't close immediately, let them see success
            closeTimerRef.current = setTimeout(() => {
                onSessionsCreated();
                onClose();
                closeTimerRef.current = null;
            }, 3000);

        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Error occurred while scheduling');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    const canGenerateDates = Boolean(startDate && startTime && startDate >= today && numberOfClasses >= 1 && numberOfClasses <= MAX_BULK_CLASSES);
    const dialogTitleId = 'bulk-schedule-title';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={handleClose} aria-hidden="true" />

            <div
                className="relative bg-[#006064] border-2 border-white shadow-[8px_8px_0px_0px_#E0F7FA] p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto text-white"
                role="dialog"
                aria-modal="true"
                aria-labelledby={dialogTitleId}
                aria-busy={isLoading}
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-6 border-b border-white/20 pb-4">
                    <div>
                        <h2 id={dialogTitleId} className="font-display text-2xl uppercase tracking-wider">Agendar Curso</h2>
                        <p className="font-mono text-xs opacity-70">Agendamiento Masivo</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleClose}
                        disabled={isLoading}
                        aria-label="Cerrar agendamiento masivo"
                        className="hover:opacity-70 text-3xl font-light disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        &times;
                    </button>
                </div>

                {/* Error */}
                {error && (
                    <div role="alert" className="mb-6 p-4 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm font-bold font-mono">
                        {error}
                    </div>
                )}

                {/* Success */}
                {successCount !== null && (
                    <div role="status" aria-live="polite" className="mb-6 p-4 bg-green-500/20 border-l-4 border-green-500 text-green-100 text-center">
                        <p className="text-3xl mb-2">✅</p>
                        <p className="font-bold font-mono text-lg">¡{successCount} clases agendadas!</p>
                        <p className="text-xs opacity-70 mt-2">Cerrando ventana...</p>
                    </div>
                )}

                {/* Step 1: Seleccionar estudiante */}
                {step === 1 && successCount === null && (
                    <div className="space-y-6">
                        <div>
                            <label htmlFor="bulk-student" className="block text-xs font-mono uppercase opacity-80 mb-2 mt-2">
                                1. Selecciona el Alumno
                            </label>
                            <select
                                id="bulk-student"
                                value={selectedStudent}
                                onChange={(e) => setSelectedStudent(e.target.value)}
                                className="w-full p-4 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA] transition-colors"
                            >
                                <option value="">Selecciona estudiante...</option>
                                {students.map(student => (
                                    <option key={student.id} value={student.id}>
                                        {student.full_name || student.email}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={!selectedStudent}
                            className="w-full px-4 py-4 bg-white text-[#006064] font-bold uppercase tracking-widest text-sm hover:bg-[#E0F7FA] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                        >
                            Siguiente Paso →
                        </button>
                    </div>
                )}

                {/* Step 2: Definir Patrón */}
                {step === 2 && successCount === null && (
                    <div className="space-y-6">
                        <button type="button" onClick={() => setStep(1)} className="text-sm font-mono opacity-70 hover:opacity-100 transition-opacity">
                            ← Volver
                        </button>

                        <h3 className="block text-xs font-mono uppercase opacity-80 mb-4 border-b border-white/20 pb-2">
                            2. Configurar Patrón Semanal
                        </h3>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="bulk-start-date" className="block text-xs font-mono opacity-80 mb-2">Fecha Inicio</label>
                                <input
                                    id="bulk-start-date"
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    min={today}
                                    className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                                />
                            </div>
                            <div>
                                <label htmlFor="bulk-start-time" className="block text-xs font-mono opacity-80 mb-2">Hora (Local)</label>
                                <input
                                    id="bulk-start-time"
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                                />
                            </div>
                        </div>

                        <div>
                            <label htmlFor="bulk-class-count" className="block text-xs font-mono opacity-80 mb-2">Total de Clases</label>
                            <input
                                id="bulk-class-count"
                                type="number"
                                min={1}
                                max={MAX_BULK_CLASSES}
                                value={numberOfClasses}
                                onChange={(e) => setNumberOfClasses(parseInt(e.target.value) || 0)}
                                aria-invalid={numberOfClasses < 1 || numberOfClasses > MAX_BULK_CLASSES}
                                className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                            />
                        </div>

                        <div>
                            <label htmlFor="bulk-duration" className="block text-xs font-mono opacity-80 mb-2">Duracion por clase</label>
                            <select
                                id="bulk-duration"
                                value={duration}
                                onChange={(e) => setDuration(Number(e.target.value))}
                                className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                            >
                                {CLASS_DURATION_OPTIONS_MINUTES.map((minutes) => (
                                    <option key={minutes} value={minutes}>
                                        {minutes} minutos
                                    </option>
                                ))}
                            </select>
                        </div>

                        <button
                            type="button"
                            onClick={generateDates}
                            disabled={!canGenerateDates}
                            className="w-full px-4 py-4 bg-white text-[#006064] font-bold uppercase tracking-widest text-sm hover:bg-[#E0F7FA] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Generar Horarios ↓
                        </button>
                    </div>
                )}

                {/* Step 3: Vista Previa y Confirmar */}
                {step === 3 && successCount === null && (
                    <div className="space-y-4">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={isLoading}
                            className="text-sm font-mono opacity-70 hover:opacity-100 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            ← Modificar Patrón
                        </button>

                        <h3 className="block text-xs font-mono uppercase opacity-80 mb-2 border-b border-white/20 pb-2">
                            3. Comprobar Clases ({scheduledDates.length} en total)
                        </h3>

                        <div className="max-h-64 overflow-y-auto space-y-2 pr-2" aria-label="Clases generadas">
                            {scheduledDates.map((date, index) => (
                                <div key={index} className="flex items-center justify-between p-3 border border-white/30 bg-[#004d40]/50 text-sm">
                                    <span className="font-mono">
                                        {formatScheduledDate(date)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => removeDate(index)}
                                        disabled={isLoading}
                                        aria-label={`Saltar clase ${formatScheduledDate(date)}`}
                                        className="text-red-300 hover:text-red-100 font-bold px-2 py-1 rounded hover:bg-red-500/20 transition-colors"
                                        title="Eliminar (ej: festivo)"
                                    >
                                        Saltar
                                    </button>
                                </div>
                            ))}
                        </div>

                        {scheduledDates.length === 0 && (
                            <p className="text-center text-sm font-mono opacity-70 my-4">No hay sesiones en la lista</p>
                        )}

                        <div className="pt-4 border-t border-white/20">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={isLoading || scheduledDates.length === 0}
                                aria-busy={isLoading}
                                className="w-full px-4 py-4 bg-[#E0F7FA] text-[#006064] font-bold uppercase tracking-widest text-sm shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? 'PROCESANDO CON GOOGLE...' : `CONFIRMAR ${scheduledDates.length} CLASES`}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
