import React, { useState, useEffect } from 'react';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translations: Record<string, any>;
    onSessionsCreated: () => void; // Trigger a reload
}

export default function BulkScheduleModal({
    isOpen,
    onClose,
    students,
    teacherId,
    lang,
    translations: t,
    onSessionsCreated
}: BulkScheduleModalProps) {
    const [step, setStep] = useState(1);
    const [selectedStudent, setSelectedStudent] = useState('');

    // Pattern parameters
    const [startDate, setStartDate] = useState('');
    const [startTime, setStartTime] = useState('10:00');
    const [numberOfClasses, setNumberOfClasses] = useState(8);
    const [duration] = useState(60);

    // Generated list of dates
    const [scheduledDates, setScheduledDates] = useState<Date[]>([]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successCount, setSuccessCount] = useState<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            setStep(1);
            setSelectedStudent('');
            setStartDate('');
            setStartTime('10:00');
            setNumberOfClasses(8);
            setScheduledDates([]);
            setError(null);
            setSuccessCount(null);
        }
    }, [isOpen]);

    const generateDates = () => {
        if (!startDate || !startTime) return;

        const dates: Date[] = [];
        const [year, month, day] = startDate.split('-').map(Number);
        const [hours, minutes] = startTime.split(':').map(Number);

        let current = new Date(year, month - 1, day, hours, minutes);

        for (let i = 0; i < numberOfClasses; i++) {
            dates.push(new Date(current));
            // Add 7 days exactly
            current = new Date(current.getTime() + 7 * 24 * 60 * 60 * 1000);
        }
        setScheduledDates(dates);
        setStep(3);
    };

    const removeDate = (indexToRemove: number) => {
        setScheduledDates(prev => prev.filter((_, i) => i !== indexToRemove));
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

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to bulk create sessions');
            }

            setSuccessCount(isoStrings.length);
            // Don't close immediately, let them see success
            setTimeout(() => {
                onSessionsCreated();
                onClose();
            }, 3000);

        } catch (err: any) {
            setError(err.message || 'Error occurred while scheduling');
        } finally {
            setIsLoading(false);
        }
    };

    const today = new Date().toISOString().split('T')[0];

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />

            <div className="relative bg-[#006064] border-2 border-white shadow-[8px_8px_0px_0px_#E0F7FA] p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto text-white">
                {/* Header */}
                <div className="flex justify-between items-center mb-6 border-b border-white/20 pb-4">
                    <div>
                        <h2 className="font-display text-2xl uppercase tracking-wider">Agendar Curso</h2>
                        <p className="font-mono text-xs opacity-70">Agendamiento Masivo</p>
                    </div>
                    <button onClick={onClose} className="hover:opacity-70 text-3xl font-light">×</button>
                </div>

                {/* Error */}
                {error && (
                    <div className="mb-6 p-4 bg-red-500/20 border-l-4 border-red-500 text-red-100 text-sm font-bold font-mono">
                        {error}
                    </div>
                )}

                {/* Success */}
                {successCount !== null && (
                    <div className="mb-6 p-4 bg-green-500/20 border-l-4 border-green-500 text-green-100 text-center">
                        <p className="text-3xl mb-2">✅</p>
                        <p className="font-bold font-mono text-lg">¡{successCount} clases agendadas!</p>
                        <p className="text-xs opacity-70 mt-2">Cerrando ventana...</p>
                    </div>
                )}

                {/* Step 1: Seleccionar estudiante */}
                {step === 1 && successCount === null && (
                    <div className="space-y-6">
                        <div>
                            <label className="block text-xs font-mono uppercase opacity-80 mb-2 mt-2">
                                1. Selecciona el Alumno
                            </label>
                            <select
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
                        <button onClick={() => setStep(1)} className="text-sm font-mono opacity-70 hover:opacity-100 transition-opacity">
                            ← Volver
                        </button>

                        <label className="block text-xs font-mono uppercase opacity-80 mb-4 border-b border-white/20 pb-2">
                            2. Configurar Patrón Semanal
                        </label>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-mono opacity-80 mb-2">Fecha Inicio</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    min={today}
                                    className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-mono opacity-80 mb-2">Hora (Local)</label>
                                <input
                                    type="time"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-mono opacity-80 mb-2">Total de Clases (8 al mes x N meses)</label>
                            <input
                                type="number"
                                min={1}
                                max={48}
                                value={numberOfClasses}
                                onChange={(e) => setNumberOfClasses(parseInt(e.target.value) || 0)}
                                className="w-full p-3 border-2 border-white bg-[#004d40] text-white focus:outline-none focus:border-[#E0F7FA]"
                            />
                        </div>

                        <button
                            onClick={generateDates}
                            disabled={!startDate || !startTime || numberOfClasses < 1}
                            className="w-full px-4 py-4 bg-white text-[#006064] font-bold uppercase tracking-widest text-sm hover:bg-[#E0F7FA] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Generar Horarios ↓
                        </button>
                    </div>
                )}

                {/* Step 3: Vista Previa y Confirmar */}
                {step === 3 && successCount === null && (
                    <div className="space-y-4">
                        <button onClick={() => setStep(2)} className="text-sm font-mono opacity-70 hover:opacity-100 transition-opacity">
                            ← Modificar Patrón
                        </button>

                        <label className="block text-xs font-mono uppercase opacity-80 mb-2 border-b border-white/20 pb-2">
                            3. Comprobar Clases ({scheduledDates.length} en total)
                        </label>

                        <div className="max-h-64 overflow-y-auto space-y-2 pr-2">
                            {scheduledDates.map((date, index) => (
                                <div key={index} className="flex items-center justify-between p-3 border border-white/30 bg-[#004d40]/50 text-sm">
                                    <span className="font-mono">
                                        {date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'short', day: '2-digit', month: 'short' })}
                                        {' - '}
                                        {date.toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    <button
                                        onClick={() => removeDate(index)}
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
                                onClick={handleSubmit}
                                disabled={isLoading || scheduledDates.length === 0}
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
