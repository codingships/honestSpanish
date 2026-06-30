import React, { useEffect, useState } from 'react';
import { Turnstile } from '@marsidev/react-turnstile';

type PreferredPackageDetail = {
    preferredPackage?: string;
    preferredPackageLabel?: string;
};

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
        level: string;
        levels: {
            not_sure: string;
            a1: string;
            a2: string;
            b1: string;
            b2: string;
            c1_plus: string;
        };
        languages: string;
        languagesHelp: string;
        languageOptions: {
            russian: string;
            english: string;
            spanish: string;
        };
        otherLanguages: string;
        otherLanguagesPlaceholder: string;
        goal: string;
        goalPlaceholder: string;
        availability: string;
        availabilityPlaceholder: string;
        placeholder: string;
        consent: string;
        privacyLink: string;
        button: string;
        success: string;
        error: string;
        loading: string;
        consentError: string;
        securityError: string;
    };
    onSuccess?: () => void;
}

export default function LeadCaptureForm({ lang, translations: t, onSuccess }: LeadCaptureFormProps) {
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        interest: 'general',
        currentLevel: 'not_sure',
        spokenLanguages: [] as string[],
        otherLanguages: '',
        learningGoal: '',
        availability: '',
        preferredPackage: '',
        preferredPackageLabel: '',
        consent: false,
    });
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = e.target;
        const checked = (e.target as HTMLInputElement).checked;

        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleLanguageChange = (language: string, checked: boolean) => {
        setFormData(prev => ({
            ...prev,
            spokenLanguages: checked
                ? Array.from(new Set([...prev.spokenLanguages, language]))
                : prev.spokenLanguages.filter(item => item !== language),
        }));
    };

    useEffect(() => {
        const applyPreferredPackage = (detail: PreferredPackageDetail | null | undefined) => {
            if (!detail?.preferredPackage) return;
            setFormData(prev => ({
                ...prev,
                preferredPackage: detail.preferredPackage || '',
                preferredPackageLabel: detail.preferredPackageLabel || detail.preferredPackage || '',
            }));
        };

        try {
            const stored = window.sessionStorage.getItem('eh_preferred_package');
            if (stored) applyPreferredPackage(JSON.parse(stored) as PreferredPackageDetail);
        } catch {
            // Ignore unavailable or malformed session storage.
        }

        const handlePreferredPackage = (event: Event) => {
            applyPreferredPackage((event as CustomEvent<PreferredPackageDetail>).detail);
        };

        window.addEventListener('eh:preferred-package-selected', handlePreferredPackage);
        return () => window.removeEventListener('eh:preferred-package-selected', handlePreferredPackage);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.consent) {
            setErrorMessage(t.consentError);
            setStatus('error');
            return;
        }

        if (!turnstileToken) {
            setErrorMessage(t.securityError);
            setStatus('error');
            return;
        }

        setStatus('loading');
        setErrorMessage('');

        try {
            const response = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    isRussianSpeaker: formData.spokenLanguages.includes('ru'),
                    lang,
                    sourcePath: typeof window === 'undefined' ? '' : window.location.pathname,
                    'cf-turnstile-response': turnstileToken,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error subscribing');
            }

            setStatus('success');
            if (onSuccess) onSuccess();
            setFormData({
                name: '',
                email: '',
                interest: 'general',
                currentLevel: 'not_sure',
                spokenLanguages: [],
                otherLanguages: '',
                learningGoal: '',
                availability: '',
                preferredPackage: '',
                preferredPackageLabel: '',
                consent: false,
            });
            try {
                window.sessionStorage.removeItem('eh_preferred_package');
            } catch {
                // Session storage can be unavailable in strict privacy modes.
            }
        } catch (err: unknown) {
            setStatus('error');
            setErrorMessage(err instanceof Error ? err.message : t.error);
        }
    };

    return (
        <div className="bg-white p-8 max-w-lg mx-auto w-full border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064]">
            <h3 className="font-display text-2xl text-[#006064] mb-2 uppercase text-center">{t.title}</h3>
            <p className="font-sans text-[#006064] mb-6 text-sm text-center">{t.subtitle}</p>

            {status === 'success' ? (
                <div className="bg-green-100 border-2 border-green-500 text-green-700 p-4 font-bold text-sm text-center">
                    {t.success}
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* Name */}
                    <div>
                        <label htmlFor="lead-name" className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.name}</label>
                        <input
                            id="lead-name"
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
                        <label htmlFor="lead-email" className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.email}</label>
                        <input
                            id="lead-email"
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
                        <label htmlFor="lead-interest" className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.interest}</label>
                        <select
                            id="lead-interest"
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

                    <div>
                        <label htmlFor="lead-current-level" className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.level}</label>
                        <select
                            id="lead-current-level"
                            name="currentLevel"
                            value={formData.currentLevel}
                            onChange={handleChange}
                            className="w-full p-3 border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans text-[#006064]"
                        >
                            <option value="not_sure">{t.levels.not_sure}</option>
                            <option value="a1">{t.levels.a1}</option>
                            <option value="a2">{t.levels.a2}</option>
                            <option value="b1">{t.levels.b1}</option>
                            <option value="b2">{t.levels.b2}</option>
                            <option value="c1_plus">{t.levels.c1_plus}</option>
                        </select>
                    </div>

                    {formData.preferredPackageLabel && (
                        <div className="border-2 border-[#006064] bg-[#E0F7FA] px-3 py-2 text-xs font-bold uppercase text-[#006064]">
                            {lang === 'es' ? 'Plan de interes' : lang === 'en' ? 'Plan of interest' : 'Интересующий план'}: {formData.preferredPackageLabel}
                        </div>
                    )}

                    <fieldset className="border-2 border-[#006064] p-3">
                        <legend className="px-1 text-xs font-bold uppercase text-[#006064]">{t.languages}</legend>
                        <p className="mb-3 text-xs leading-snug text-[#006064]/80">{t.languagesHelp}</p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {[
                                ['ru', t.languageOptions.russian],
                                ['en', t.languageOptions.english],
                                ['es', t.languageOptions.spanish],
                            ].map(([value, label]) => (
                                <label key={value} className="flex items-center gap-2 text-sm font-bold text-[#006064]">
                                    <input
                                        type="checkbox"
                                        checked={formData.spokenLanguages.includes(value)}
                                        onChange={(event) => handleLanguageChange(value, event.currentTarget.checked)}
                                        className="h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                                    />
                                    {label}
                                </label>
                            ))}
                        </div>
                        <label htmlFor="lead-other-languages" className="mt-3 block text-xs font-bold uppercase text-[#006064]">{t.otherLanguages}</label>
                        <input
                            id="lead-other-languages"
                            type="text"
                            name="otherLanguages"
                            value={formData.otherLanguages}
                            onChange={handleChange}
                            placeholder={t.otherLanguagesPlaceholder}
                            maxLength={120}
                            className="mt-1 w-full border-2 border-[#006064] bg-white p-3 font-sans focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                        />
                    </fieldset>

                    <div>
                        <label htmlFor="lead-learning-goal" className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.goal}</label>
                        <textarea
                            id="lead-learning-goal"
                            name="learningGoal"
                            value={formData.learningGoal}
                            onChange={handleChange}
                            placeholder={t.goalPlaceholder}
                            maxLength={700}
                            rows={4}
                            className="w-full p-3 border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans resize-y min-h-24"
                        />
                    </div>

                    <div>
                        <label htmlFor="lead-availability" className="block text-xs font-bold uppercase text-[#006064] mb-1">{t.availability}</label>
                        <textarea
                            id="lead-availability"
                            name="availability"
                            value={formData.availability}
                            onChange={handleChange}
                            placeholder={t.availabilityPlaceholder}
                            maxLength={400}
                            rows={3}
                            className="w-full p-3 border-2 border-[#006064] bg-white focus:outline-none focus:ring-2 focus:ring-[#006064]/20 font-sans resize-y min-h-20"
                        />
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
                            <a href={`/${lang}/legal/privacidad`} target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-[#004d40]">
                                {t.privacyLink}
                            </a>.
                        </label>
                    </div>

                    {status === 'error' && (
                        <div className="text-red-600 text-xs font-bold text-left" role="alert">
                            {errorMessage}
                        </div>
                    )}

                    <Turnstile
                        siteKey={import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'}
                        onSuccess={(token: string) => setTurnstileToken(token)}
                    />

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

                    <p className="text-[10px] text-[#006064] text-center">
                        {lang === 'es' ? '100% privacidad. Cero spam.' : lang === 'en' ? '100% privacy. Zero spam.' : '100% конфиденциальность. Ноль спама.'}
                    </p>
                </form>
            )}
        </div>
    );
}
