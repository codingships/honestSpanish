import React, { useEffect, useRef, useState } from 'react';

export interface AvailabilitySlot {
    id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_active: boolean | null;
}

interface AvailabilityManagerProps {
    initialAvailability: AvailabilitySlot[];
    teacherId: string;
    lang: string;
    onAvailabilityChange?: (availability: AvailabilitySlot[]) => void;
    translations: {
        dayNames: string[];
        addSlot: string;
        removeSlot: string;
        from: string;
        to: string;
        save: string;
        cancel: string;
        noSlots: string;
        day: string;
        slotAdded: string;
        slotRemoved: string;
        errorAdding: string;
        errorRemoving: string;
        invalidTimeRange?: string;
        timezoneNotice: string;
    };
}

type AvailabilityResponse = {
    availability?: AvailabilitySlot;
    error?: string;
};

export default function AvailabilityManager({
    initialAvailability,
    teacherId,
    onAvailabilityChange,

    translations: t
}: AvailabilityManagerProps) {
    const [availability, setAvailability] = useState<AvailabilitySlot[]>(initialAvailability);
    const [isAddingSlot, setIsAddingSlot] = useState(false);
    const [newSlot, setNewSlot] = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
    const [isLoading, setIsLoading] = useState(false);
    const [removingSlotId, setRemovingSlotId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearMessageTimer = () => {
        if (messageTimerRef.current) {
            clearTimeout(messageTimerRef.current);
            messageTimerRef.current = null;
        }
    };

    const showMessage = (nextMessage: { type: 'success' | 'error'; text: string }, autoHide = false) => {
        clearMessageTimer();
        setMessage(nextMessage);
        if (autoHide) {
            messageTimerRef.current = setTimeout(() => {
                setMessage(null);
                messageTimerRef.current = null;
            }, 3000);
        }
    };

    useEffect(() => () => {
        if (messageTimerRef.current) {
            clearTimeout(messageTimerRef.current);
        }
    }, []);

    // Agrupar disponibilidad por día
    const availabilityByDay = availability.reduce((acc, slot) => {
        if (!acc[slot.day_of_week]) {
            acc[slot.day_of_week] = [];
        }
        acc[slot.day_of_week].push(slot);
        return acc;
    }, {} as Record<number, AvailabilitySlot[]>);

    const isTimeRangeValid = newSlot.startTime < newSlot.endTime;
    const invalidTimeRangeMessage = t.invalidTimeRange || t.errorAdding;

    const handleAddSlot = async () => {
        if (!isTimeRangeValid) {
            showMessage({ type: 'error', text: invalidTimeRangeMessage });
            return;
        }

        setIsLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/teacher/availability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    teacherId,
                    dayOfWeek: newSlot.dayOfWeek,
                    startTime: newSlot.startTime,
                    endTime: newSlot.endTime
                })
            });

            const data = await response.json().catch(() => null) as AvailabilityResponse | null;
            if (!response.ok) {
                throw new Error(typeof data?.error === 'string' ? data.error : t.errorAdding);
            }

            const availabilitySlot = data?.availability;
            if (availabilitySlot) {
                const nextAvailability = [...availability, availabilitySlot];
                setAvailability(nextAvailability);
                onAvailabilityChange?.(nextAvailability);
            }

            setIsAddingSlot(false);
            setNewSlot({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
            showMessage({ type: 'success', text: t.slotAdded }, true);
        } catch (error) {
            showMessage({ type: 'error', text: error instanceof Error ? error.message : t.errorAdding });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveSlot = async (slotId: string) => {
        setIsLoading(true);
        setRemovingSlotId(slotId);
        setMessage(null);

        try {
            const response = await fetch('/api/teacher/availability', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: slotId })
            });

            const data = await response.json().catch(() => null) as AvailabilityResponse | null;
            if (!response.ok) {
                throw new Error(typeof data?.error === 'string' ? data.error : t.errorRemoving);
            }

            const nextAvailability = availability.filter((slot) => slot.id !== slotId);
            setAvailability(nextAvailability);
            onAvailabilityChange?.(nextAvailability);
            showMessage({ type: 'success', text: t.slotRemoved }, true);
        } catch (error) {
            showMessage({ type: 'error', text: error instanceof Error ? error.message : t.errorRemoving });
        } finally {
            setRemovingSlotId(null);
            setIsLoading(false);
        }
    };

    const formatTime = (time: string) => {
        return time.substring(0, 5);
    };

    // Días de la semana (empezando por lunes)
    const weekDays = [1, 2, 3, 4, 5, 6, 0]; // Lunes a Domingo

    return (
        <div className="space-y-6">
            <p
                role="note"
                className="border-2 border-[#006064] bg-[#E0F7FA] p-4 text-sm font-bold text-[#006064]"
            >
                {t.timezoneNotice}
            </p>

            {/* Mensaje */}
            {message && (
                <div role={message.type === 'success' ? 'status' : 'alert'} className={`p-4 font-bold text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                    {message.text}
                </div>
            )}

            {/* Grid de disponibilidad por día */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {weekDays.map(day => (
                    <div
                        key={day}
                        className="bg-white p-4 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064]"
                    >
                        <h3 className="font-display text-lg text-[#006064] uppercase mb-3">
                            {t.dayNames[day]}
                        </h3>

                        {availabilityByDay[day]?.length > 0 ? (
                            <div className="space-y-2">
                                {availabilityByDay[day]
                                    .sort((a, b) => a.start_time.localeCompare(b.start_time))
                                    .map(slot => (
                                        <div
                                            key={slot.id}
                                            className="flex items-center justify-between p-2 bg-[#E0F7FA] border border-[#006064]/20"
                                        >
                                            <span className="font-mono text-sm text-[#006064]">
                                                {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoveSlot(slot.id)}
                                                disabled={isLoading}
                                                aria-label={`${t.removeSlot}: ${formatTime(slot.start_time)} - ${formatTime(slot.end_time)}`}
                                                aria-busy={removingSlotId === slot.id}
                                                className="text-red-500 hover:text-red-700 font-bold text-lg leading-none"
                                                title={t.removeSlot}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                            </div>
                        ) : (
                            <p className="text-sm text-[#006064]/40 italic">{t.noSlots}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* Botón añadir / Formulario */}
            {!isAddingSlot ? (
                <button
                    type="button"
                    onClick={() => setIsAddingSlot(true)}
                    disabled={isLoading}
                    className="px-6 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
                >
                    + {t.addSlot}
                </button>
            ) : (
                <div className="bg-white p-6 border-2 border-[#006064] shadow-[4px_4px_0px_0px_#006064] max-w-md">
                    <h3 className="font-display text-xl text-[#006064] uppercase mb-4">{t.addSlot}</h3>

                    <div className="space-y-4">
                        {/* Día */}
                        <div>
                            <label htmlFor="availability-day" className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                                {t.day}
                            </label>
                            <select
                                id="availability-day"
                                value={newSlot.dayOfWeek}
                                onChange={(e) => setNewSlot({ ...newSlot, dayOfWeek: parseInt(e.target.value) })}
                                disabled={isLoading}
                                className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                            >
                                {weekDays.map(day => (
                                    <option key={day} value={day}>{t.dayNames[day]}</option>
                                ))}
                            </select>
                        </div>

                        {/* Hora inicio */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="availability-start-time" className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                                    {t.from}
                                </label>
                                <input
                                    id="availability-start-time"
                                    type="time"
                                    value={newSlot.startTime}
                                    onChange={(e) => setNewSlot({ ...newSlot, startTime: e.target.value })}
                                    disabled={isLoading}
                                    aria-describedby={!isTimeRangeValid ? 'availability-time-error' : undefined}
                                    className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                                />
                            </div>
                            <div>
                                <label htmlFor="availability-end-time" className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                                    {t.to}
                                </label>
                                <input
                                    id="availability-end-time"
                                    type="time"
                                    value={newSlot.endTime}
                                    onChange={(e) => setNewSlot({ ...newSlot, endTime: e.target.value })}
                                    disabled={isLoading}
                                    aria-describedby={!isTimeRangeValid ? 'availability-time-error' : undefined}
                                    className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                                />
                            </div>
                        </div>

                        {!isTimeRangeValid && (
                            <p id="availability-time-error" role="alert" className="text-sm text-red-700 font-bold">
                                {invalidTimeRangeMessage}
                            </p>
                        )}

                        {/* Botones */}
                        <div className="flex gap-2 pt-2">
                            <button
                                type="button"
                                onClick={handleAddSlot}
                                disabled={isLoading || !isTimeRangeValid}
                                aria-busy={isLoading && removingSlotId === null}
                                className="flex-1 px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50"
                            >
                                {isLoading ? '...' : t.save}
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsAddingSlot(false)}
                                disabled={isLoading}
                                className="px-4 py-3 bg-white text-[#006064] font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#E0F7FA] transition-colors"
                            >
                                {t.cancel}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
