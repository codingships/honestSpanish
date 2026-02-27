import React, { useState } from 'react';

interface Session {
    id: string;
    student: {
        id: string;
        full_name: string | null;
        email: string;
    };
}

interface PostClassReportProps {
    isOpen: boolean;
    onClose: () => void;
    session: Session;
    lang: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    translations: Record<string, any>;
    onSubmit: (reportData: any, homeworkText: string) => Promise<void>;
}

export default function PostClassReport({
    isOpen,
    onClose,
    session,
    lang,
    translations: t,
    onSubmit
}: PostClassReportProps) {
    const [rating, setRating] = useState(0);
    const [skills, setSkills] = useState({
        grammar: 'Good',
        vocabulary: 'Good',
        fluency: 'Good',
        pronunciation: 'Good'
    });
    const [comments, setComments] = useState('');
    const [homeworkText, setHomeworkText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const skillLevels = ['Needs Work', 'Good', 'Excellent'];

    const handleSubmit = async () => {
        if (rating === 0) {
            setError('Please provide a rating for the class.');
            return;
        }

        setIsLoading(true);
        setError(null);

        const reportData = {
            rating,
            skills,
            teacher_comments: comments
        };

        try {
            await onSubmit(reportData, homeworkText);
            onClose();
        } catch (err: any) {
            setError(err.message || 'Error saving the report');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

            <div className="relative bg-white border-4 border-[#006064] shadow-[12px_12px_0px_0px_#006064] p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-start mb-6 border-b-2 border-[#006064]/20 pb-4">
                    <div>
                        <h2 className="font-display text-2xl text-[#006064] uppercase tracking-wider">
                            Reporte Post-Clase
                        </h2>
                        <p className="font-mono text-sm text-[#006064]/70 mt-1">
                            Estudiante: {session.student.full_name || session.student.email}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-[#006064] hover:opacity-70 text-3xl font-light">×</button>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-100 border-l-4 border-red-500 text-red-800 text-sm font-bold font-mono">
                        {error}
                    </div>
                )}

                <div className="space-y-8">
                    {/* 1. Rating General */}
                    <section>
                        <h3 className="font-bold font-mono text-xs uppercase tracking-widest text-[#006064] mb-3">1. Valoración General</h3>
                        <div className="flex gap-2">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    onClick={() => setRating(star)}
                                    className={`text-4xl transition-transform hover:scale-110 ${rating >= star ? 'text-yellow-400' : 'text-gray-200'
                                        }`}
                                >
                                    ★
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* 2. Evaluación por Habilidades (Skills) */}
                    <section>
                        <h3 className="font-bold font-mono text-xs uppercase tracking-widest text-[#006064] mb-4">2. Evaluación por Áreas</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {Object.entries(skills).map(([skill, currentValue]) => (
                                <div key={skill} className="bg-[#E0F7FA] p-4 border border-[#006064]/20">
                                    <p className="font-bold text-sm uppercase text-[#006064] capitalize mb-3">
                                        {skill === 'fluency' ? 'Fluidez' :
                                            skill === 'grammar' ? 'Gramática' :
                                                skill === 'vocabulary' ? 'Vocabulario' : 'Pronunciación'}
                                    </p>
                                    <div className="flex flex-col gap-2">
                                        {skillLevels.map(level => (
                                            <label key={level} className="flex items-center gap-2 text-sm text-[#006064] cursor-pointer">
                                                <input
                                                    type="radio"
                                                    name={`skill-${skill}`}
                                                    value={level}
                                                    checked={currentValue === level}
                                                    onChange={(e) => setSkills(prev => ({ ...prev, [skill]: e.target.value }))}
                                                    className="accent-[#006064] w-4 h-4 cursor-pointer"
                                                />
                                                {level === 'Needs Work' ? 'Falla un poco' : level === 'Good' ? 'Bien' : 'Excelente'}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* 3. Comentarios */}
                    <section>
                        <h3 className="font-bold font-mono text-xs uppercase tracking-widest text-[#006064] mb-3">3. Comentarios para el Estudiante (Visible)</h3>
                        <textarea
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                            placeholder="Escribe aspectos positivos y cosas a mejorar..."
                            className="w-full h-32 p-4 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 text-sm"
                        />
                    </section>

                    {/* 4. Deberes (Se anexan al Doc) */}
                    <section className="bg-gray-50 border-2 border-dashed border-[#006064]/40 p-6">
                        <h3 className="font-bold font-mono text-xs uppercase tracking-widest text-[#006064] mb-2">4. Deberes (Se añadirán a su Documento)</h3>
                        <p className="text-xs text-[#006064]/60 mb-4">El texto escrito aquí se incrustará automáticamente al final del Google Doc de esta clase.</p>
                        <textarea
                            value={homeworkText}
                            onChange={(e) => setHomeworkText(e.target.value)}
                            placeholder="Ej: Escribe 5 frases usando el Presente Perfecto..."
                            className="w-full h-32 p-4 border-2 border-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20 text-sm"
                        />
                    </section>

                    {/* Submit */}
                    <div className="pt-4 border-t-2 border-[#006064]/20">
                        <button
                            onClick={handleSubmit}
                            disabled={isLoading}
                            className="w-full py-4 bg-[#006064] text-white font-bold uppercase tracking-widest text-sm border-2 border-[#006064] hover:bg-[#004d40] hover:translate-y-[-2px] hover:shadow-[0_4px_0_0_#004d40] transition-all disabled:opacity-50 disabled:transform-none disabled:shadow-none disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'GUARDANDO EN DRIVE Y COMPLETANDO...' : 'ENVIAR REPORTE Y COMPLETAR CLASE'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
