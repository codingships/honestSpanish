import React, { useState } from 'react';

interface AvailabilitySlot {
    id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_active: boolean;
}

interface AvailabilityManagerProps {
    initialAvailability: AvailabilitySlot[];
    teacherId: string;
    lang: string;
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
    };
}

export default function AvailabilityManager({
    initialAvailability,
    teacherId,

    translations: t
}: AvailabilityManagerProps) {
    const [availability, setAvailability] = useState<AvailabilitySlot[]>(initialAvailability);
    const [isAddingSlot, setIsAddingSlot] = useState(false);
    const [newSlot, setNewSlot] = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    // Agrupar disponibilidad por día
    const availabilityByDay = availability.reduce((acc, slot) => {
        if (!acc[slot.day_of_week]) {
            acc[slot.day_of_week] = [];
        }
        acc[slot.day_of_week].push(slot);
        return acc;
    }, {} as Record<number, AvailabilitySlot[]>);

    const handleAddSlot = async () => {
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

            if (!response.ok) {
                throw new Error('Failed to add slot');
            }

            const data = await response.json();

            if (data.availability) {
                setAvailability([...availability, data.availability]);
            }

            setIsAddingSlot(false);
            setNewSlot({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
            setMessage({ type: 'success', text: t.slotAdded });

            setTimeout(() => setMessage(null), 3000);
        } catch {
            setMessage({ type: 'error', text: t.errorAdding });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemoveSlot = async (slotId: string) => {
        setIsLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/teacher/availability', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: slotId })
            });

            if (!response.ok) {
                throw new Error('Failed to remove slot');
            }

            setAvailability(availability.filter(s => s.id !== slotId));
            setMessage({ type: 'success', text: t.slotRemoved });

            setTimeout(() => setMessage(null), 3000);
        } catch {
            setMessage({ type: 'error', text: t.errorRemoving });
        } finally {
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
            {/* Mensaje */}
            {message && (
                <div className={`p-4 font-bold text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
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
                                                onClick={() => handleRemoveSlot(slot.id)}
                                                disabled={isLoading}
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
                    onClick={() => setIsAddingSlot(true)}
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
                            <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                                {t.day}
                            </label>
                            <select
                                value={newSlot.dayOfWeek}
                                onChange={(e) => setNewSlot({ ...newSlot, dayOfWeek: parseInt(e.target.value) })}
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
                                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                                    {t.from}
                                </label>
                                <input
                                    type="time"
                                    value={newSlot.startTime}
                                    onChange={(e) => setNewSlot({ ...newSlot, startTime: e.target.value })}
                                    className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-1">
                                    {t.to}
                                </label>
                                <input
                                    type="time"
                                    value={newSlot.endTime}
                                    onChange={(e) => setNewSlot({ ...newSlot, endTime: e.target.value })}
                                    className="w-full p-3 border-2 border-[#006064] text-[#006064]"
                                />
                            </div>
                        </div>

                        {/* Botones */}
                        <div className="flex gap-2 pt-2">
                            <button
                                onClick={handleAddSlot}
                                disabled={isLoading}
                                className="flex-1 px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors disabled:opacity-50"
                            >
                                {isLoading ? '...' : t.save}
                            </button>
                            <button
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
