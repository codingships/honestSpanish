import React, { useEffect, useRef, useState } from 'react';
import {
    registerAcademyWebMcpTools,
    type AcademyWebMcpBridge,
    type LearningBriefDraft,
    type LearningLevel,
} from '../lib/academy-webmcp';
import type { PublicBookableSlot } from '../lib/public-bookable-slots';

interface AcademyWebMcpPanelProps {
    lang: 'es' | 'en' | 'ru';
    onPrepareBookingReview: (slot: PublicBookableSlot) => boolean;
    onClearBookingDraft: () => void;
}

const panelCopy = {
    es: {
        eyebrow: 'Preparación compartida',
        title: 'Prepara tu primer ciclo',
        intro: 'Puedes completar o editar este breve contexto antes de elegir una plaza. También puede ayudarte un agente desde este mismo navegador.',
        level: 'Nivel actual aproximado',
        goal: 'Objetivo de aprendizaje',
        goalPlaceholder: 'Por ejemplo: participar con más seguridad en reuniones de trabajo.',
        context: 'Contexto útil para el profesor',
        contextPlaceholder: 'Situaciones, temas o bloqueos que quieres practicar. No incluyas datos personales.',
        timezone: 'Tu zona horaria',
        clear: 'Limpiar preparación',
        privacy: 'Este borrador permanece en esta página. No se envía al CRM, al checkout ni al profesor.',
        drafted: 'El borrador se ha actualizado y puedes editarlo.',
        reviewing: 'La revisión de la plaza está abierta. Tú controlas el inicio de sesión, las condiciones y el pago.',
        cleared: 'La selección y el borrador se han limpiado.',
        levels: {
            not_sure: 'No lo sé', a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2', c1_plus: 'C1 o superior',
        },
    },
    en: {
        eyebrow: 'Shared preparation',
        title: 'Prepare your first cycle',
        intro: 'You can complete or edit this short context before choosing a place. An agent in this browser can help you with the same page.',
        level: 'Approximate current level',
        goal: 'Learning goal',
        goalPlaceholder: 'For example: take part in work meetings with more confidence.',
        context: 'Useful context for the teacher',
        contextPlaceholder: 'Situations, topics, or blocks you want to practise. Do not include personal details.',
        timezone: 'Your timezone',
        clear: 'Clear preparation',
        privacy: 'This draft stays on this page. It is not sent to the CRM, checkout, or a teacher.',
        drafted: 'The draft was updated and remains editable.',
        reviewing: 'The place review is open. You control sign-in, terms, and payment.',
        cleared: 'The selection and draft were cleared.',
        levels: {
            not_sure: 'Not sure', a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2', c1_plus: 'C1 or above',
        },
    },
    ru: {
        eyebrow: 'Совместная подготовка',
        title: 'Подготовьте первый цикл',
        intro: 'До выбора места можно заполнить или отредактировать краткое описание целей. Агент в этом браузере может помочь на той же странице.',
        level: 'Примерный текущий уровень',
        goal: 'Цель обучения',
        goalPlaceholder: 'Например: увереннее участвовать в рабочих встречах.',
        context: 'Полезный контекст для преподавателя',
        contextPlaceholder: 'Ситуации, темы или трудности для практики. Не указывайте личные данные.',
        timezone: 'Ваш часовой пояс',
        clear: 'Очистить подготовку',
        privacy: 'Черновик остаётся на этой странице и не отправляется в CRM, checkout или преподавателю.',
        drafted: 'Черновик обновлён; его можно редактировать.',
        reviewing: 'Проверка места открыта. Вход, условия и оплата остаются под вашим контролем.',
        cleared: 'Выбор и черновик очищены.',
        levels: {
            not_sure: 'Не уверен(а)', a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2', c1_plus: 'C1 или выше',
        },
    },
} as const;

function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid';
    } catch {
        return 'Europe/Madrid';
    }
}

function emptyBrief(): LearningBriefDraft {
    return {
        currentLevel: 'not_sure',
        goal: '',
        context: '',
        timezone: browserTimeZone(),
    };
}

export default function AcademyWebMcpPanel({
    lang,
    onPrepareBookingReview,
    onClearBookingDraft,
}: AcademyWebMcpPanelProps) {
    const copy = panelCopy[lang];
    const [brief, setBrief] = useState<LearningBriefDraft>(() => emptyBrief());
    const [status, setStatus] = useState('');
    const panelRef = useRef<HTMLElement>(null);
    const liveActionsRef = useRef({ onPrepareBookingReview, onClearBookingDraft, copy });
    liveActionsRef.current = { onPrepareBookingReview, onClearBookingDraft, copy };

    const revealPanel = () => {
        const reduceMotion = typeof window !== 'undefined'
            && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        panelRef.current?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    };

    const bridgeRef = useRef<AcademyWebMcpBridge | null>(null);
    if (!bridgeRef.current) {
        bridgeRef.current = {
            draftLearningBrief: (draft) => {
                setBrief(draft);
                setStatus(liveActionsRef.current.copy.drafted);
                revealPanel();
                return true;
            },
            prepareBookingReview: (slot) => {
                const opened = liveActionsRef.current.onPrepareBookingReview(slot);
                if (!opened) return false;
                setStatus(liveActionsRef.current.copy.reviewing);
                return true;
            },
            clearBookingDraft: () => {
                setBrief(emptyBrief());
                setStatus(liveActionsRef.current.copy.cleared);
                liveActionsRef.current.onClearBookingDraft();
                revealPanel();
                return true;
            },
        };
    }

    useEffect(() => {
        if (typeof document === 'undefined' || !bridgeRef.current) return;
        let disposed = false;
        let release: (() => Promise<void>) | null = null;

        void registerAcademyWebMcpTools({
            document,
            bridge: bridgeRef.current,
        }).then((registration) => {
            if (disposed) void registration.release();
            else release = registration.release;
        }).catch(() => {
            // WebMCP is progressive enhancement. The complete human interface
            // remains available if an experimental browser rejects registration.
        });

        return () => {
            disposed = true;
            if (release) void release();
        };
    }, []);

    const updateBrief = <Key extends keyof LearningBriefDraft>(key: Key, value: LearningBriefDraft[Key]) => {
        setBrief((current) => ({ ...current, [key]: value }));
        setStatus('');
    };

    const clearFromPage = () => {
        void bridgeRef.current?.clearBookingDraft();
    };

    return (
        <section
            ref={panelRef}
            id="learning-brief"
            aria-labelledby="learning-brief-heading"
            className="mt-12 border-2 border-[#006064] bg-[#E0F7FA] p-5 shadow-[6px_6px_0px_0px_#006064] md:p-7"
            data-testid="academy-learning-brief"
        >
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-[#006064]">{copy.eyebrow}</p>
            <div className="mt-3 grid gap-7 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
                <div>
                    <h3 id="learning-brief-heading" className="font-display text-3xl uppercase text-[#006064]">{copy.title}</h3>
                    <p className="mt-3 text-sm font-bold leading-6 text-[#006064]">{copy.intro}</p>
                    <p className="mt-4 border-l-4 border-[#006064] pl-3 text-xs leading-5 text-[#006064]">{copy.privacy}</p>
                    <button
                        type="button"
                        onClick={clearFromPage}
                        className="mt-5 border-2 border-[#006064] bg-white px-4 py-2 font-mono text-xs font-bold uppercase tracking-wide text-[#006064] hover:bg-[#006064] hover:text-white focus:outline-none focus:ring-4 focus:ring-[#006064]/30"
                    >
                        {copy.clear}
                    </button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-bold uppercase tracking-wide text-[#006064]">
                        {copy.level}
                        <select
                            value={brief.currentLevel}
                            onChange={(event) => updateBrief('currentLevel', event.currentTarget.value as LearningLevel)}
                            className="mt-1 w-full border-2 border-[#006064] bg-white p-3 font-sans text-sm normal-case tracking-normal text-[#006064] focus:outline-none focus:ring-4 focus:ring-[#006064]/20"
                        >
                            {(Object.keys(copy.levels) as LearningLevel[]).map((level) => (
                                <option key={level} value={level}>{copy.levels[level]}</option>
                            ))}
                        </select>
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wide text-[#006064]">
                        {copy.timezone}
                        <input
                            type="text"
                            value={brief.timezone}
                            onChange={(event) => updateBrief('timezone', event.currentTarget.value.slice(0, 64))}
                            maxLength={64}
                            autoComplete="off"
                            className="mt-1 w-full border-2 border-[#006064] bg-white p-3 font-sans text-sm normal-case tracking-normal text-[#006064] focus:outline-none focus:ring-4 focus:ring-[#006064]/20"
                        />
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wide text-[#006064] sm:col-span-2">
                        {copy.goal}
                        <textarea
                            value={brief.goal}
                            onChange={(event) => updateBrief('goal', event.currentTarget.value.slice(0, 240))}
                            placeholder={copy.goalPlaceholder}
                            maxLength={240}
                            rows={2}
                            className="mt-1 w-full resize-y border-2 border-[#006064] bg-white p-3 font-sans text-sm normal-case tracking-normal text-[#006064] placeholder:text-[#006064]/60 focus:outline-none focus:ring-4 focus:ring-[#006064]/20"
                        />
                    </label>

                    <label className="block text-xs font-bold uppercase tracking-wide text-[#006064] sm:col-span-2">
                        {copy.context}
                        <textarea
                            value={brief.context}
                            onChange={(event) => updateBrief('context', event.currentTarget.value.slice(0, 500))}
                            placeholder={copy.contextPlaceholder}
                            maxLength={500}
                            rows={3}
                            className="mt-1 w-full resize-y border-2 border-[#006064] bg-white p-3 font-sans text-sm normal-case tracking-normal text-[#006064] placeholder:text-[#006064]/60 focus:outline-none focus:ring-4 focus:ring-[#006064]/20"
                        />
                    </label>
                </div>
            </div>
            {status && <p className="sr-only" role="status" aria-live="polite">{status}</p>}
        </section>
    );
}
