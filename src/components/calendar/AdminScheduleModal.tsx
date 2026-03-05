import React from 'react';
import type { Teacher, Student } from './hooks/useAdminCalendar'; // Reusamos tipos
import { useAdminSchedule } from './hooks/useAdminSchedule';

interface AdminScheduleModalProps {
    isOpen: boolean;
    onClose: () => void;
    teachers: Teacher[];
    students: Student[];
    lang: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translations: Record<string, any>;
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
    // 👇 CONEXIÓN CEREBRAL
    const logic = useAdminSchedule({ isOpen, onSessionCreated, onClose });

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString(lang === 'es' ? 'es-ES' : 'en-US', {
            hour: '2-digit', minute: '2-digit'
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

                {logic.error && (
                    <div className="mb-4 p-3 bg-red-100 text-red-700 text-sm font-bold border-l-4 border-red-500">
                        {logic.error}
                    </div>
                )}

                {/* Step 1: Estudiante y Profesor */}
                {logic.step === 1 && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">{t.selectStudent}</label>
                            <select
                                value={logic.selectedStudent}
                                onChange={(e) => logic.setSelectedStudent(e.target.value)}
                                className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                            >
                                <option value="">{t.selectStudent}...</option>
                                {students.map(student => (
                                    <option key={student.id} value={student.id}>{student.full_name || student.email}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">{t.selectTeacher}</label>
                            <select
                                value={logic.selectedTeacher}
                                onChange={(e) => logic.setSelectedTeacher(e.target.value)}
                                className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                            >
                                <option value="">{t.selectTeacher}...</option>
                                {teachers.map(teacher => (
                                    <option key={teacher.id} value={teacher.id}>{teacher.full_name || teacher.email}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={() => logic.setStep(2)}
                            disabled={!logic.selectedStudent || !logic.selectedTeacher}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar →
                        </button>
                    </div>
                )}

                {/* Step 2: Fecha */}
                {logic.step === 2 && (
                    <div className="space-y-4">
                        <button onClick={() => logic.setStep(1)} className="text-sm text-[#006064] hover:opacity-70">← Volver</button>
                        <div>
                            <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">{t.selectDate}</label>
                            <input
                                type="date"
                                value={logic.selectedDate}
                                onChange={(e) => logic.setSelectedDate(e.target.value)}
                                min={today}
                                className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                            />
                        </div>

                        {/* Recurring Toggle */}
                        <div className="p-3 bg-[#E0F7FA] border border-[#006064]/20 space-y-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={logic.isRecurring}
                                    onChange={(e) => logic.setIsRecurring(e.target.checked)}
                                    className="w-4 h-4 accent-[#006064]"
                                />
                                <span className="text-sm text-[#006064] font-bold">🔁 Clase recurrente (cada semana)</span>
                            </label>

                            {logic.isRecurring && logic.selectedDate && (
                                <>
                                    <p className="text-xs text-[#006064]/70">
                                        Se crearán clases cada <strong>
                                            {new Date(logic.selectedDate + 'T00:00:00').toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'long' })}
                                        </strong> hasta la fecha final.
                                    </p>
                                    <div>
                                        <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">Fecha final (opcional)</label>
                                        <input
                                            type="date"
                                            value={logic.recurringEndDate}
                                            onChange={(e) => logic.setRecurringEndDate(e.target.value)}
                                            min={logic.selectedDate}
                                            className="w-full p-2 border-2 border-[#006064] text-[#006064] text-sm"
                                        />
                                        <p className="text-xs text-[#006064]/50 mt-1">Si no se indica, se usará la fecha fin de suscripción</p>
                                    </div>
                                </>
                            )}
                        </div>

                        <button
                            onClick={() => logic.setStep(3)}
                            disabled={!logic.selectedDate}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Continuar →
                        </button>
                    </div>
                )}

                {/* Step 3: Hora */}
                {logic.step === 3 && (
                    <div className="space-y-4">
                        <button onClick={() => logic.setStep(2)} className="text-sm text-[#006064] hover:opacity-70">← Volver</button>

                        <div className="flex items-center gap-4 p-3 bg-[#E0F7FA] border border-[#006064]/20">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={logic.useCustomTime}
                                    onChange={(e) => {
                                        logic.setUseCustomTime(e.target.checked);
                                        logic.setSelectedSlot(null);
                                    }}
                                    className="w-4 h-4 accent-[#006064]"
                                />
                                <span className="text-sm text-[#006064] font-medium">Forzar hora manual</span>
                            </label>
                        </div>

                        {logic.useCustomTime ? (
                            <div>
                                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">Hora personalizada</label>
                                <input
                                    type="time"
                                    value={logic.customTime}
                                    onChange={(e) => logic.setCustomTime(e.target.value)}
                                    className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                                />
                            </div>
                        ) : (
                            <div>
                                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">{t.selectTime}</label>
                                {logic.isLoading ? (
                                    <div className="text-center py-8 text-[#006064]/60 animate-pulse">Buscando huecos...</div>
                                ) : logic.availableSlots.length === 0 ? (
                                    <div className="text-center py-8 text-[#006064]/60 bg-gray-50 border-2 border-dashed">
                                        No hay horarios disponibles.
                                        <button onClick={() => logic.setUseCustomTime(true)} className="block w-full mt-2 text-sm text-[#006064] underline font-bold">Usar hora personalizada</button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
                                        {logic.availableSlots.map((slot, index) => (
                                            <button
                                                key={index}
                                                onClick={() => logic.setSelectedSlot(slot)}
                                                className={`p-2 border-2 text-sm font-mono transition-all ${logic.selectedSlot?.slot_start === slot.slot_start
                                                    ? 'bg-[#006064] text-white border-[#006064] scale-105 shadow-md'
                                                    : 'border-[#006064]/30 text-[#006064] hover:border-[#006064] hover:bg-[#E0F7FA]'
                                                    }`}
                                            >
                                                {formatTime(slot.slot_start)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {(logic.selectedSlot || logic.useCustomTime) && (
                            <button
                                onClick={() => logic.setStep(4)}
                                className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                            >
                                Continuar →
                            </button>
                        )}
                    </div>
                )}

                {/* Step 4: Confirmar y Notificar */}
                {logic.step === 4 && (
                    <div className="space-y-4">
                        <button onClick={() => logic.setStep(3)} className="text-sm text-[#006064] hover:opacity-70">← Volver</button>

                        <div className="p-4 bg-[#E0F7FA] border border-[#006064]/20 space-y-2">
                            <h3 className="font-bold text-[#006064] uppercase border-b border-[#006064]/20 pb-1 mb-2">Resumen de la Clase</h3>
                            <div className="text-sm text-[#006064]/80 grid grid-cols-[100px_1fr] gap-1">
                                <span className="font-bold">Estudiante:</span>
                                <span>{(() => {
                                    const student = students.find(s => s.id === logic.selectedStudent);
                                    return student?.full_name || student?.email || logic.selectedStudent || '...';
                                })()}</span>

                                <span className="font-bold">Profesor:</span>
                                <span>{(() => {
                                    const teacher = teachers.find(t => t.id === logic.selectedTeacher);
                                    return teacher?.full_name || teacher?.email || logic.selectedTeacher || '...';
                                })()}</span>

                                <span className="font-bold">Fecha:</span>
                                <span>{logic.selectedDate ? new Date(logic.selectedDate + 'T00:00:00').toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }) : '...'}</span>

                                <span className="font-bold">Hora:</span>
                                <span>{logic.useCustomTime ? logic.customTime : (logic.selectedSlot && formatTime(logic.selectedSlot.slot_start))}</span>
                            </div>
                        </div>

                        {/* 👇 LA CLAVE DEL MAILING: Opción de auto-generar */}
                        <div className="space-y-3">
                            <label className="flex items-start gap-3 p-3 border-2 border-[#006064] bg-[#F0FDFA] cursor-pointer hover:bg-[#E0F7FA] transition-colors">
                                <input
                                    type="checkbox"
                                    checked={logic.autoCreateMeeting}
                                    onChange={(e) => logic.setAutoCreateMeeting(e.target.checked)}
                                    className="mt-1 w-5 h-5 accent-[#006064]"
                                />
                                <div>
                                    <span className="block font-bold text-[#006064] text-sm">Generar Google Meet y Enviar Email</span>
                                    <span className="block text-xs text-[#006064]/70">
                                        Creará el evento en Calendar, generará el link de video y enviará la invitación por correo automáticamente.
                                    </span>
                                </div>
                            </label>

                            {!logic.autoCreateMeeting && (
                                <div>
                                    <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">Link manual (opcional)</label>
                                    <input
                                        type="url"
                                        value={logic.meetLink}
                                        onChange={(e) => logic.setMeetLink(e.target.value)}
                                        placeholder="https://meet.google.com/..."
                                        className="w-full p-3 border-2 border-[#006064] text-[#006064] placeholder-[#006064]/40"
                                    />
                                </div>
                            )}
                        </div>

                        <button
                            onClick={logic.handleSubmit}
                            disabled={logic.isLoading}
                            className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                            {logic.isLoading ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                                    {logic.isRecurring ? 'Creando clases...' : 'Procesando...'}
                                </>
                            ) : logic.isRecurring ? `Crear clases recurrentes` : t.confirm}
                        </button>

                        {/* Recurring result summary */}
                        {logic.recurringResult && (
                            <div className="p-4 bg-green-50 border-2 border-green-500 space-y-2">
                                <p className="font-bold text-green-700">
                                    ✅ {logic.recurringResult.created} clases creadas
                                </p>
                                {logic.recurringResult.errors && logic.recurringResult.errors.length > 0 && (
                                    <div className="text-xs text-red-600 space-y-1">
                                        {logic.recurringResult.errors.map((err, i) => (
                                            <p key={i}>⚠ {err}</p>
                                        ))}
                                    </div>
                                )}
                                <button
                                    onClick={() => { onClose(); window.location.reload(); }}
                                    className="w-full mt-2 px-4 py-2 bg-green-600 text-white font-bold uppercase text-sm border-2 border-green-600 hover:bg-green-700 transition-colors"
                                >
                                    Cerrar y actualizar calendario
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}