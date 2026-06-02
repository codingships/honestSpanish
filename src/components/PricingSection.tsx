import React, { useState } from 'react';
import PricingModal from './PricingModal';

interface Package {
    id: string;
    name: string;
    display_name: { es: string; en: string; ru: string };
    price_monthly: number;
    sessions_per_month: number;
    has_group_session?: boolean | null;
    has_dual_teacher?: boolean | null;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
}

interface PricingSectionProps {
    packages: Package[];
    lang: 'es' | 'en' | 'ru';
    isLoggedIn: boolean;
    translations: {
        title: string;
        subtitle: string;
        headers: {
            name: string;
            price: string;
            includes: string;
            action: string;
        };
        month: string;
        select: string;
        recommended: string;
        plans: Record<string, { name: string; description: string; features: string[] }>;
        modal: {
            title: string;
            duration1: string;
            duration3: string;
            duration6: string;
            save: string;
            total: string;
            perMonth: string;
            continue: string;
            login: string;
            loading: string;
            error: string;
            close: string;
            contact: string;
            contactMessage: string;
        };
    };
}

type PlanKey = string;

const s = {
    bg: 'bg-[#E0F7FA]',
    text: 'text-[#006064]',
    accent: 'bg-[#006064]',
    accentText: 'text-white',
    border: 'border-[#006064]',
    secondaryBg: 'bg-white',
};

export default function PricingSection({ packages, lang, isLoggedIn, translations: t }: PricingSectionProps) {
    const [selectedPlan, setSelectedPlan] = useState<{
        name: string;
        displayName: string;
        priceMonthly: number;
        stripe_price_1m: string | null;
        stripe_price_3m: string | null;
        stripe_price_6m: string | null;
    } | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleSelectPlan = (pkg: Package) => {
        setSelectedPlan({
            name: pkg.name,
            displayName: pkg.display_name?.[lang] || pkg.display_name?.['es'] || pkg.name,
            priceMonthly: pkg.price_monthly / 100, // Convert from cents to euros
            stripe_price_1m: pkg.stripe_price_1m,
            stripe_price_3m: pkg.stripe_price_3m,
            stripe_price_6m: pkg.stripe_price_6m,
        });
        setIsModalOpen(true);
    };

    // Get package data or use fallback
    const getPriceDisplay = (pkg: Package | undefined): string => {
        if (!pkg || !pkg.price_monthly) return 'Consultar';
        return `${(pkg.price_monthly / 100).toFixed(0)}€`;
    };

    const recommendedPlanName = packages.some(pkg => pkg.name === 'hybrid')
        ? 'hybrid'
        : packages[Math.min(1, Math.max(packages.length - 1, 0))]?.name;

    const getFallbackFeatures = (pkg: Package): string[] => {
        const labels = {
            es: {
                sessions: `${pkg.sessions_per_month} sesiones/mes`,
                duration: '55 minutos por clase',
                group: 'Sesiones grupales incluidas',
                dual: 'Seguimiento con dos profesores',
            },
            en: {
                sessions: `${pkg.sessions_per_month} sessions/month`,
                duration: '55 minutes per class',
                group: 'Group sessions included',
                dual: 'Two-teacher follow-up',
            },
            ru: {
                sessions: `${pkg.sessions_per_month} занятий в месяц`,
                duration: '55 минут за занятие',
                group: 'Групповые занятия включены',
                dual: 'Сопровождение двух преподавателей',
            },
        }[lang];

        return [
            labels.sessions,
            labels.duration,
            ...(pkg.has_group_session ? [labels.group] : []),
            ...(pkg.has_dual_teacher ? [labels.dual] : []),
        ];
    };

    return (
        <>
            <section id="pricing" className={`bg-white py-24 px-4 md:px-8 border-b-2 ${s.border}`}>
                <div className="max-w-7xl mx-auto">
                    <div className={`flex items-end justify-between mb-12 border-b-4 ${s.border} pb-4`}>
                        <h2 className="font-display text-6xl md:text-8xl tracking-tighter">{t.title}</h2>
                        <span className="font-mono text-sm mb-2 hidden md:block">{t.subtitle}</span>
                    </div>

                    <div className={`border-t-2 ${s.border}`}>
                        {/* Headers - Desktop */}
                        <div className="hidden md:grid grid-cols-12 gap-4 py-4 font-mono text-xs uppercase tracking-widest opacity-60">
                            <div className="col-span-3">{t.headers.name}</div>
                            <div className="col-span-2">{t.headers.price}</div>
                            <div className="col-span-5">{t.headers.includes}</div>
                            <div className="col-span-2 text-center">{t.headers.action}</div>
                        </div>

                        {packages.map((pkg, index) => {
                            const key = pkg.name || `plan-${index}`;
                            const highlight = pkg.name === recommendedPlanName;
                            const isRecommended = highlight;
                            const checkoutReady = Boolean(pkg.stripe_price_1m && pkg.stripe_price_3m && pkg.stripe_price_6m);
                            const planTranslations = t.plans[key as PlanKey] ?? {
                                name: pkg.display_name?.[lang] || pkg.display_name?.es || key,
                                description: '',
                                features: getFallbackFeatures(pkg),
                            };

                            return (
                                <div
                                    key={key}
                                    className={`
                                        pricing-plan-card
                                        grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-4 
                                        ${highlight ? 'py-12' : 'py-8'} 
                                        border-t-2 ${highlight ? 'border-b-2' : ''} ${s.border} 
                                        items-center relative 
                                        ${highlight ? s.secondaryBg : ''}
                                    `}
                                >
                                    {isRecommended && (
                                        <div className={`absolute top-0 left-0 ${s.accent} ${s.accentText} px-2 py-1 text-[10px] font-bold uppercase tracking-widest`}>
                                            {t.recommended}
                                        </div>
                                    )}

                                    {/* Name & Description */}
                                    <div className="col-span-3">
                                        <h3 className={`font-display ${highlight ? 'text-4xl' : 'text-3xl'}`}>
                                            {planTranslations.name}
                                        </h3>
                                        <p className="text-sm opacity-70 mt-1">{planTranslations.description}</p>
                                    </div>

                                    {/* Price - TEMPORALMENTE: Solo mostrar "Consultar" */}
                                    <div className={`col-span-2 font-mono ${highlight ? 'text-3xl' : 'text-2xl'} font-bold`}>
                                        {getPriceDisplay(pkg)}
                                    </div>

                                    {/* Features */}
                                    <div className={`col-span-5 text-sm ${highlight ? 'font-bold' : 'font-medium'} space-y-1`}>
                                        {planTranslations.features.map((feature, idx) => (
                                            <p key={idx}>• {feature}</p>
                                        ))}
                                    </div>

                                    {/* Action Button */}
                                    <div className="col-span-2 flex justify-center">
                                        <button
                                            onClick={() => pkg && handleSelectPlan(pkg)}
                                            disabled={!pkg || !checkoutReady}
                                            data-plan={key}
                                            data-testid={`select-plan-${key}`}
                                            className={`
                                                w-auto px-6 ${highlight ? 'py-4' : 'py-2'} 
                                                ${highlight
                                                    ? `${s.accent} ${s.accentText} text-sm shadow-[4px_4px_0px_0px_currentColor] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]`
                                                    : `hover:bg-[#006064] hover:text-white text-xs`
                                                }
                                                border ${s.border} font-bold uppercase transition-all
                                                disabled:opacity-50 disabled:cursor-not-allowed
                                            `}
                                        >
                                            {checkoutReady ? t.select : t.modal.contact}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Modal */}
            <PricingModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                plan={selectedPlan}
                lang={lang}
                isLoggedIn={isLoggedIn}
                translations={t.modal}
            />
        </>
    );
}
