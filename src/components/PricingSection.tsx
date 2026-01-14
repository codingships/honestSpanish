import React, { useState } from 'react';
import PricingModal from './PricingModal';

interface Package {
    id: string;
    name: string;
    display_name: { es: string; en: string; ru: string };
    price_monthly: number;
    sessions_per_month: number;
    stripe_price_1m: string;
    stripe_price_3m: string;
    stripe_price_6m: string;
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
        plans: {
            essential: { name: string; description: string; features: string[] };
            intensive: { name: string; description: string; features: string[] };
            premium: { name: string; description: string; features: string[] };
        };
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
        };
    };
}

type PlanKey = 'essential' | 'intensive' | 'premium';

const s = {
    bg: 'bg-[#E0F7FA]',
    text: 'text-[#006064]',
    accent: 'bg-[#006064]',
    accentText: 'text-white',
    border: 'border-[#006064]',
    secondaryBg: 'bg-white',
};

export default function PricingSection({ packages, lang, isLoggedIn, translations: t }: PricingSectionProps) {
    // Debug: log what we received
    console.log('PricingSection props:', {
        packagesCount: packages?.length,
        packages: packages?.map(p => ({ name: p.name, price: p.price_monthly })),
        lang,
        isLoggedIn
    });

    const [selectedPlan, setSelectedPlan] = useState<{
        name: string;
        displayName: string;
        priceMonthly: number;
        stripe_price_1m: string;
        stripe_price_3m: string;
        stripe_price_6m: string;
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

    // Map packages by name for easy access
    const packageMap: Record<string, Package> = {};
    packages.forEach(pkg => {
        // Ensure display_name exists before mapping
        if (pkg && pkg.name) {
            packageMap[pkg.name] = pkg;
        }
    });

    // Get package data or use fallback
    const getPriceDisplay = (pkg: Package | undefined): string => {
        if (!pkg) return '€—';
        return `€${pkg.price_monthly / 100}`;
    };

    const planConfig: { key: PlanKey; isRecommended: boolean; highlight: boolean }[] = [
        { key: 'essential', isRecommended: false, highlight: false },
        { key: 'intensive', isRecommended: true, highlight: true },
        { key: 'premium', isRecommended: false, highlight: false },
    ];

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
                            const highlight = pkg.name === 'essential';
                            // Determine isRecommended based on the original planConfig logic if pkg.name matches
                            const configEntry = planConfig.find(config => config.key === pkg.name);
                            const isRecommended = configEntry ? configEntry.isRecommended : false;
                            const planTranslations = t.plans[key as PlanKey];

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

                                    {/* Price */}
                                    <div className={`col-span-2 font-mono ${highlight ? 'text-3xl' : 'text-2xl'} font-bold`}>
                                        {getPriceDisplay(pkg)}
                                        <span className="text-sm font-normal">{t.month}</span>
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
                                            disabled={!pkg}
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
                                            {t.select}
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
