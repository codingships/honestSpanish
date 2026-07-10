import React, { useEffect, useId, useRef, useState } from 'react';

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
    const [errorMessage, setErrorMessage] = useState('Error');
    const clearStatusTimerRef = useRef<number | null>(null);
    const notesId = useId();
    const feedbackId = `${notesId}-feedback`;

    const clearSavedTimer = () => {
        if (clearStatusTimerRef.current !== null) {
            window.clearTimeout(clearStatusTimerRef.current);
            clearStatusTimerRef.current = null;
        }
    };

    useEffect(() => {
        setNotes(initialNotes || '');
        setIsSaving(false);
        setSaveStatus('idle');
        setErrorMessage('Error');
        clearSavedTimer();

        return clearSavedTimer;
    }, [initialNotes, studentId]);

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        clearSavedTimer();
        setIsSaving(true);
        setSaveStatus('idle');
        setErrorMessage('Error');

        try {
            const response = await fetch('/api/update-student-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentId, notes }),
            });
            const data = await response.json().catch(() => ({})) as { error?: unknown };

            if (!response.ok) {
                throw new Error(typeof data.error === 'string' && data.error ? data.error : 'Error');
            }

            setSaveStatus('saved');
            clearStatusTimerRef.current = window.setTimeout(() => {
                setSaveStatus('idle');
                clearStatusTimerRef.current = null;
            }, 3000);
        } catch (error) {
            console.error('Error saving notes:', error);
            setErrorMessage(error instanceof Error && error.message ? error.message : 'Error');
            setSaveStatus('error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSave} className="space-y-4" aria-label={t.save} aria-busy={isSaving}>
            <label htmlFor={notesId} className="sr-only">
                {t.placeholder}
            </label>
            <textarea
                id={notesId}
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t.placeholder}
                disabled={isSaving}
                aria-describedby={saveStatus !== 'idle' ? feedbackId : undefined}
                className="w-full h-40 p-4 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-[#006064] placeholder-[#006064]/40 resize-none"
            />

            <div className="flex items-center gap-4">
                <button
                    type="submit"
                    disabled={isSaving}
                    aria-busy={isSaving}
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
                    <span id={feedbackId} role="status" aria-live="polite" className="text-green-600 font-bold text-sm">
                        <span aria-hidden="true">✓</span> {t.saved}
                    </span>
                )}

                {saveStatus === 'error' && (
                    <span id={feedbackId} role="alert" className="text-red-600 font-bold text-sm">
                        <span aria-hidden="true">✗</span> {errorMessage}
                    </span>
                )}
            </div>
        </form>
    );
}
