import React, { useState } from 'react';

interface Teacher {
    id: string;
    full_name: string | null;
    email: string;
}

interface AssignTeacherModalProps {
    isOpen: boolean;
    onClose: () => void;
    studentId: string;
    studentName: string;
    currentTeacherId?: string;
    teachers: Teacher[];
    translations: {
        title: string;
        select: string;
        primary: string;
        assign: string;
        remove: string;
        success: string;
        current: string;
        none: string;
    };
}

export default function AssignTeacherModal({
    isOpen,
    onClose,
    studentId,
    studentName,
    currentTeacherId,
    teachers,
    translations: t,
}: AssignTeacherModalProps) {
    const [selectedTeacherId, setSelectedTeacherId] = useState(currentTeacherId || '');
    const [isPrimary, setIsPrimary] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    if (!isOpen) return null;

    const handleAssign = async () => {
        if (!selectedTeacherId) return;

        setIsLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/admin/assign-teacher', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    teacherId: selectedTeacherId,
                    isPrimary,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to assign teacher');
            }

            setMessage({ type: 'success', text: t.success });
            setTimeout(() => {
                onClose();
                window.location.reload();
            }, 1000);
        } catch (error) {
            setMessage({ type: 'error', text: 'Error assigning teacher' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleRemove = async () => {
        if (!currentTeacherId) return;

        setIsLoading(true);
        setMessage(null);

        try {
            const response = await fetch('/api/admin/remove-teacher', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    studentId,
                    teacherId: currentTeacherId,
                }),
            });

            if (!response.ok) {
                throw new Error('Failed to remove teacher');
            }

            setTimeout(() => {
                onClose();
                window.location.reload();
            }, 500);
        } catch (error) {
            setMessage({ type: 'error', text: 'Error removing teacher' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50"
                onClick={onClose}
            />

            {/* Modal */}
            <div className="relative bg-white border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] p-6 max-w-md w-full mx-4">
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-display text-xl text-[#006064] uppercase">{t.title}</h2>
                    <button
                        onClick={onClose}
                        className="text-[#006064] hover:opacity-70 text-2xl"
                    >
                        ×
                    </button>
                </div>

                {/* Student name */}
                <p className="text-sm text-[#006064]/60 mb-4">
                    Estudiante: <span className="font-bold text-[#006064]">{studentName}</span>
                </p>

                {/* Current teacher */}
                {currentTeacherId && (
                    <div className="mb-4 p-3 bg-[#E0F7FA] border border-[#006064]/20">
                        <p className="text-xs font-mono uppercase text-[#006064]/60 mb-1">{t.current}:</p>
                        <p className="font-bold text-[#006064]">
                            {teachers.find(t => t.id === currentTeacherId)?.full_name ||
                                teachers.find(t => t.id === currentTeacherId)?.email}
                        </p>
                    </div>
                )}

                {/* Teacher select */}
                <div className="mb-4">
                    <label className="block text-xs font-mono uppercase text-[#006064]/60 mb-2">
                        {t.select}
                    </label>
                    <select
                        value={selectedTeacherId}
                        onChange={(e) => setSelectedTeacherId(e.target.value)}
                        className="w-full p-3 border-2 border-[#006064] bg-white text-[#006064]"
                    >
                        <option value="">{t.select}...</option>
                        {teachers.map(teacher => (
                            <option key={teacher.id} value={teacher.id}>
                                {teacher.full_name || teacher.email}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Primary checkbox */}
                <label className="flex items-center gap-2 mb-6 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={isPrimary}
                        onChange={(e) => setIsPrimary(e.target.checked)}
                        className="w-5 h-5 border-2 border-[#006064] accent-[#006064]"
                    />
                    <span className="text-sm text-[#006064]">{t.primary}</span>
                </label>

                {/* Message */}
                {message && (
                    <div className={`mb-4 p-3 text-sm font-bold ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                        {message.text}
                    </div>
                )}

                {/* Buttons */}
                <div className="flex gap-2">
                    <button
                        onClick={handleAssign}
                        disabled={!selectedTeacherId || isLoading}
                        className={`flex-1 px-4 py-3 font-bold uppercase text-sm border-2 border-[#006064] transition-colors ${!selectedTeacherId || isLoading
                                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                : 'bg-[#006064] text-white hover:bg-[#004d40]'
                            }`}
                    >
                        {isLoading ? '...' : t.assign}
                    </button>

                    {currentTeacherId && (
                        <button
                            onClick={handleRemove}
                            disabled={isLoading}
                            className="px-4 py-3 font-bold uppercase text-sm border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                        >
                            {t.remove}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
