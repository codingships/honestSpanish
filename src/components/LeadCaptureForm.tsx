import React, { useState } from 'react';

interface LeadCaptureFormProps {
    lang: 'es' | 'en' | 'ru';
    translations: {
        title: string;
        subtitle: string;
        name: string;
        email: string;
        interest: string;
        interests: {
            general: string;
            company: string;
            other: string;
        };
        placeholder: string;
        consent: string;
        privacyLink: string;
        button: string;
        success: string;
        error: string;
        loading: string;
    };
    onSuccess?: () => void;
}

export default function LeadCaptureForm({ lang, translations: t, onSuccess }: LeadCaptureFormProps) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        interest: 'general',
        consent: false,
    });
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;

        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.consent) {
            setErrorMessage('Debes aceptar la política de privacidad');
            setStatus('error');
            return;
        }

        setStatus('loading');
        setErrorMessage('');

        try {
            const response = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, lang }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error subscribing');
            }

            setStatus('success');
            if (onSuccess) onSuccess();
            setFormData({ name: '', email: '', interest: 'general', consent: false });
        } catch (err: unknown) {
            setStatus('error');
            setErrorMessage(err instanceof Error ? err.message : t.error);
        }
    };

    return (
        <div className="bg-white p-8 max-w-lg mx-auto w-full border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064]">
            <h3 className="font-display text-2xl text-[#006064] mb-2 uppercase text-center">{t.title}</h3>
            <p className="font-sans text-[#006064]/70 mb-6 text-sm text-center">{t.subtitle}</p>

            {status === 'success' ? (
                <div className="bg-green-100 border-2 border-green-500 text-green-700 p-4 font-bold text-sm text-center">
                    {t.success}
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* Name */}
                    <div>
                        <label className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.name}</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full p-3 border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <label className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.email}</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            placeholder={t.placeholder}
                            required
                            className="w-full p-3 border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans"
                        />
                    </div>

                    {/* Interest */}
                    <div>
                        <label className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.interest}</label>
                        <select
                            name="interest"
                            value={formData.interest}
                            onChange={handleChange}
                            className="w-full p-3 border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-[#006064]"
                        >
                            <option value="general">{t.interests.general}</option>
                            <option value="company">{t.interests.company}</option>
                            <option value="other">{t.interests.other}</option>
                        </select>
                    </div>

                    {/* Consent Checkbox */}
                    <div className="flex items-start gap-2 mt-2">
                        <input
                            type="checkbox"
                            name="consent"
                            id="consent"
                            checked={formData.consent}
                            onChange={handleChange}
                            required
                            className="mt-1 w-4 h-4 text-[#006064] border-2 border-[#006064] rounded focus:ring-[#006064]/20"
                        />
                        <label htmlFor="consent" className="text-xs text-[#006064]/80 leading-snug">
                            {t.consent}
                            <a href={`/${lang}/legal#privacy`} target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-[#004d40]">
                                {t.privacyLink}
                            </a>.
                        </label>
                    </div>

                    {status === 'error' && (
                        <div className="text-red-600 text-xs font-bold text-left">
                            {errorMessage}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={status === 'loading'}
                        className={`
                            w-full mt-2 py-3 font-bold text-sm uppercase tracking-widest
                            border-2 border-[#006064] 
                            bg-[#006064] text-white
                            hover:bg-[#004d40] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)]
                            active:translate-y-[1px] active:translate-x-[1px] active:shadow-none
                            transition-all
                            disabled:opacity-50 disabled:cursor-not-allowed
                        `}
                    >
                        {status === 'loading' ? t.loading : t.button}
                    </button>

                    <p className="text-[10px] text-[#006064]/40 text-center">
                        {lang === 'es' ? '100% privacidad. Cero spam.' : lang === 'en' ? '100% privacy. Zero spam.' : '100% конфиденциальность. Ноль спама.'}
                    </p>
                </form>
            )}
        </div>
    );
}
