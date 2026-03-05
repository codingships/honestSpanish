import React, { useState } from 'react';

interface TeacherNotesProps {
    studentId: string;
    initialNotes: string;
    translations: {
        placeholder: string;
        save: string;
        saved: string;
    };
}

export default function TeacherNotes({ studentId, initialNotes, translations: t }: TeacherNotesProps) {
    const [notes, setNotes] = useState(initialNotes || '');
    const [isSaving, setIsSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

    const handleSave = async () => {
        setIsSaving(true);
        setSaveStatus('idle');

        try {
            const response = await fetch('/api/update-student-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, notes }),
            });

            if (!response.ok) {
                throw new Error('Failed to save');
            }

            setSaveStatus('saved');
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (error) {
            console.error('Error saving notes:', error);
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t.placeholder}
                className="w-full h-40 p-4 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-[#006064] placeholder-[#006064]/40 resize-none"
            />

            <div className="flex items-center gap-4">
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`
                        px-6 py-2 font-bold text-xs uppercase tracking-wide
                        border-2 border-[#006064] 
                        transition-all
                        ${isSaving
                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                            : 'bg-[#006064] text-white hover:bg-[#004d40]'
                        }
                    `}
                >
                    {isSaving ? '...' : t.save}
                </button>

                {saveStatus === 'saved' && (
                    <span className="text-green-600 font-bold text-sm">
                        ✓ {t.saved}
                    </span>
                )}

                {saveStatus === 'error' && (
                    <span className="text-red-600 font-bold text-sm">
                        ✗ Error
                    </span>
                )}
            </div>
        </div>
    );
}
