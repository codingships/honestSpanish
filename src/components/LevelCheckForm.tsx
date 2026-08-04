import React, { useEffect, useState } from 'react';
import { captureAcquisitionAttribution } from '../lib/acquisition-attribution';
import ResponsiveTurnstile from './ResponsiveTurnstile';

interface LevelCheckTranslations {
    title: string;
    subtitle: string;
    email: string;
    emailPlaceholder: string;
    level: string;
    levels: {
        not_sure: string;
        a1: string;
        a2: string;
        b1: string;
        b2: string;
        c1_plus: string;
    };
    comprehension: string;
    comprehensionOptions: {
        mostly_understand: string;
        depends_context: string;
        get_lost_fast: string;
        not_sure: string;
    };
    blocker: string;
    blockerOptions: {
        grammar: string;
        vocabulary: string;
        speed: string;
        confidence: string;
        culture: string;
        pronunciation: string;
        other: string;
    };
    useContext: string;
    useContextPlaceholder: string;
    writtenSample: string;
    writtenSamplePlaceholder: string;
    audioLater: string;
    adultConfirmation: string;
    consent: string;
    privacyLink: string;
    button: string;
    success: string;
    error: string;
    loading: string;
    consentError: string;
    adultError: string;
    securityError: string;
}

interface LevelCheckFormProps {
    lang: 'es' | 'en' | 'ru';
    translations: LevelCheckTranslations;
}

type LevelCheckResponse = {
    error?: string;
};

type LevelCheckPrefillResponse = {
    email?: string;
};

export default function LevelCheckForm({ lang, translations: t }: LevelCheckFormProps) {
    const [formData, setFormData] = useState({
        email: '',
        currentLevel: 'not_sure',
        comprehensionComfort: 'not_sure',
        speakingBlocker: 'confidence',
        useContext: '',
        writtenSample: '',
        canSendAudioLater: false,
        adultConfirmed: false,
        consent: false,
    });
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [leadToken, setLeadToken] = useState<{ leadId: string; token: string } | null>(null);
    const [inviteState, setInviteState] = useState<'none' | 'loading' | 'resolved'>('none');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const fragment = new URLSearchParams(window.location.hash.replace(/^#/u, ''));
        const email = params.get('email');
        const leadId = fragment.get('leadId') ?? params.get('leadId');
        const token = fragment.get('token') ?? params.get('token');
        if (email) {
            setFormData(prev => ({ ...prev, email }));
            params.delete('email');
            const query = params.toString();
            window.history.replaceState(
                null,
                '',
                `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
            );
        }
        if (!leadId || !token) return;

        const controller = new AbortController();
        setInviteState('loading');
        void fetch('/api/level-check-prefill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId, token }),
            signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok) return null;
            return response.json() as Promise<LevelCheckPrefillResponse>;
        }).then((prefill) => {
            const resolvedEmail = prefill?.email?.trim().toLowerCase();
            if (!resolvedEmail) {
                setInviteState('none');
                return;
            }
            setFormData(prev => ({ ...prev, email: resolvedEmail }));
            setLeadToken({ leadId, token });
            setInviteState('resolved');
        }).catch((error: unknown) => {
            if (!(error instanceof DOMException && error.name === 'AbortError')) {
                setInviteState('none');
            }
        });

        return () => controller.abort();
    }, []);

    const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value, type } = event.target;
        const checked = (event.target as HTMLInputElement).checked;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!formData.adultConfirmed) {
            setErrorMessage(t.adultError);
            setStatus('error');
            return;
        }

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
            const attribution = captureAcquisitionAttribution(lang);
            const response = await fetch('/api/level-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    ...(leadToken ?? {}),
                    lang,
                    sourcePath: typeof window === 'undefined' ? '' : window.location.pathname,
                    ...(attribution ? { attribution } : {}),
                    'cf-turnstile-response': turnstileToken,
                }),
            });
            const data = await response.json() as LevelCheckResponse;

            if (!response.ok) {
                throw new Error(data.error || t.error);
            }

            setStatus('success');
        } catch (error) {
            setStatus('error');
            setErrorMessage(error instanceof Error ? error.message : t.error);
        }
    };

    if (status === 'success') {
        return (
            <div role="status" aria-live="polite" className="border-2 border-[#006064] bg-white p-8 text-center shadow-[8px_8px_0px_0px_#006064]">
                <h2 className="font-display text-2xl uppercase text-[#006064]">{t.title}</h2>
                <p className="mt-4 text-sm leading-6 text-[#006064]">{t.success}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="min-w-0 border-2 border-[#006064] bg-white p-6 shadow-[8px_8px_0px_0px_#006064] sm:p-8" aria-busy={status === 'loading' || inviteState === 'loading'}>
            <div className="mb-6 text-center">
                <h2 className="font-display text-2xl uppercase text-[#006064]">{t.title}</h2>
                <p className="mt-3 text-sm leading-6 text-[#006064]">{t.subtitle}</p>
            </div>

            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
                <div>
                    <label htmlFor="level-check-email" className="mb-1 block text-xs font-bold uppercase text-[#006064]">{t.email}</label>
                    <input
                        id="level-check-email"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        placeholder={t.emailPlaceholder}
                        readOnly={inviteState === 'loading' || inviteState === 'resolved'}
                        required
                        className="w-full border-2 border-[#006064] bg-white p-3 font-sans text-[#006064] read-only:bg-[#E0F7FA] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                </div>

                <div>
                    <label htmlFor="level-check-current-level" className="mb-1 block text-xs font-bold uppercase text-[#006064]">{t.level}</label>
                    <select
                        id="level-check-current-level"
                        name="currentLevel"
                        value={formData.currentLevel}
                        onChange={handleChange}
                        className="w-full border-2 border-[#006064] bg-white p-3 font-sans text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    >
                        <option value="not_sure">{t.levels.not_sure}</option>
                        <option value="a1">{t.levels.a1}</option>
                        <option value="a2">{t.levels.a2}</option>
                        <option value="b1">{t.levels.b1}</option>
                        <option value="b2">{t.levels.b2}</option>
                        <option value="c1_plus">{t.levels.c1_plus}</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="level-check-comprehension" className="mb-1 block text-xs font-bold uppercase text-[#006064]">{t.comprehension}</label>
                    <select
                        id="level-check-comprehension"
                        name="comprehensionComfort"
                        value={formData.comprehensionComfort}
                        onChange={handleChange}
                        className="w-full border-2 border-[#006064] bg-white p-3 font-sans text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    >
                        <option value="mostly_understand">{t.comprehensionOptions.mostly_understand}</option>
                        <option value="depends_context">{t.comprehensionOptions.depends_context}</option>
                        <option value="get_lost_fast">{t.comprehensionOptions.get_lost_fast}</option>
                        <option value="not_sure">{t.comprehensionOptions.not_sure}</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="level-check-blocker" className="mb-1 block text-xs font-bold uppercase text-[#006064]">{t.blocker}</label>
                    <select
                        id="level-check-blocker"
                        name="speakingBlocker"
                        value={formData.speakingBlocker}
                        onChange={handleChange}
                        className="w-full border-2 border-[#006064] bg-white p-3 font-sans text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    >
                        <option value="grammar">{t.blockerOptions.grammar}</option>
                        <option value="vocabulary">{t.blockerOptions.vocabulary}</option>
                        <option value="speed">{t.blockerOptions.speed}</option>
                        <option value="confidence">{t.blockerOptions.confidence}</option>
                        <option value="culture">{t.blockerOptions.culture}</option>
                        <option value="pronunciation">{t.blockerOptions.pronunciation}</option>
                        <option value="other">{t.blockerOptions.other}</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="level-check-use-context" className="mb-1 block text-xs font-bold uppercase text-[#006064]">{t.useContext}</label>
                    <textarea
                        id="level-check-use-context"
                        name="useContext"
                        value={formData.useContext}
                        onChange={handleChange}
                        placeholder={t.useContextPlaceholder}
                        maxLength={500}
                        rows={3}
                        className="min-h-20 w-full resize-y border-2 border-[#006064] bg-white p-3 font-sans text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                </div>

                <div>
                    <label htmlFor="level-check-written-sample" className="mb-1 block text-xs font-bold uppercase text-[#006064]">{t.writtenSample}</label>
                    <textarea
                        id="level-check-written-sample"
                        name="writtenSample"
                        value={formData.writtenSample}
                        onChange={handleChange}
                        placeholder={t.writtenSamplePlaceholder}
                        minLength={40}
                        maxLength={1200}
                        rows={5}
                        required
                        className="min-h-32 w-full resize-y border-2 border-[#006064] bg-white p-3 font-sans text-[#006064] focus:outline-none focus:ring-2 focus:ring-[#006064]/20"
                    />
                </div>

                <label className="flex items-start gap-3 border-2 border-[#006064] bg-[#E0F7FA] p-3 text-sm font-bold text-[#006064]">
                    <input
                        type="checkbox"
                        name="canSendAudioLater"
                        checked={formData.canSendAudioLater}
                        onChange={handleChange}
                        className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                    />
                    <span>{t.audioLater}</span>
                </label>

                <label className="flex items-start gap-3 text-xs leading-5 text-[#006064]/80">
                    <input
                        type="checkbox"
                        name="adultConfirmed"
                        checked={formData.adultConfirmed}
                        onChange={handleChange}
                        aria-required="true"
                        className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                    />
                    <span>{t.adultConfirmation}</span>
                </label>

                <label className="flex items-start gap-3 text-xs leading-5 text-[#006064]/80">
                    <input
                        type="checkbox"
                        name="consent"
                        checked={formData.consent}
                        onChange={handleChange}
                        aria-required="true"
                        className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                    />
                    <span>
                        {t.consent}
                        <a href={`/${lang}/legal/privacidad`} target="_blank" rel="noopener noreferrer" className="font-bold underline hover:text-[#004d40]">
                            {t.privacyLink}
                        </a>.
                    </span>
                </label>

                {status === 'error' && (
                    <div className="text-sm font-bold text-red-700" role="alert">
                        {errorMessage}
                    </div>
                )}

                <ResponsiveTurnstile
                    siteKey={import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'}
                    onSuccess={(token: string) => setTurnstileToken(token)}
                    onExpire={() => setTurnstileToken(null)}
                    onError={() => setTurnstileToken(null)}
                />

                <button
                    type="submit"
                    disabled={status === 'loading' || inviteState === 'loading'}
                    aria-busy={status === 'loading' || inviteState === 'loading'}
                    className="mt-2 w-full border-2 border-[#006064] bg-[#006064] py-3 text-sm font-bold uppercase tracking-widest text-white transition-all hover:bg-[#004d40] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,0.2)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {status === 'loading' || inviteState === 'loading' ? t.loading : t.button}
                </button>
            </div>
        </form>
    );
}
