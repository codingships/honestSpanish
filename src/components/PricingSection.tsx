import React, { useState } from 'react';
import PricingModal from './PricingModal';
import { formatPackagePrice } from '../lib/package-pricing';

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
    checkoutMode?: 'unavailable' | 'checkout';
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
        applicationNote?: string;
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
            adultConfirmation?: string;
            termsAcceptance?: string;
            termsLink?: string;
            and?: string;
            privacyLink?: string;
            serviceStartRequest?: string;
            withdrawalLossAcknowledgement?: string;
            renewalDisclosure?: string;
            sessionBankDisclosure?: string;
            policyError?: string;
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

export default function PricingSection({ packages, lang, isLoggedIn, checkoutMode = 'unavailable', translations: t }: PricingSectionProps) {
    const [selectedPlan, setSelectedPlan] = useState<{
        name: string;
        displayName: string;
        priceMonthlyCents: number;
        sessionsPerMonth: number;
        stripe_price_1m: string | null;
        stripe_price_3m: string | null;
        stripe_price_6m: string | null;
    } | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const copy = {
        title: t.title || 'Planes',
        subtitle: t.subtitle || '',
        headers: {
            name: t.headers?.name || 'Plan',
            price: t.headers?.price || 'Precio',
            includes: t.headers?.includes || 'Incluye',
            action: t.headers?.action || 'Accion',
        },
        month: t.month || 'cada 28 días',
        select: t.select || 'Seleccionar',
        recommended: t.recommended || 'Recomendado',
        applicationNote: t.applicationNote || {
            es: 'La compra directa se abrirá cuando puedas elegir una plaza real con profesor y horario antes de pagar.',
            en: 'Direct purchase will open once you can choose a real place with a teacher and schedule before paying.',
            ru: 'Прямая покупка откроется, когда до оплаты можно будет выбрать реальное место, преподавателя и расписание.',
        }[lang],
        plans: t.plans || {},
        modal: {
            title: t.modal?.title || 'Elige duracion',
            duration1: t.modal?.duration1 || '1 mes',
            duration3: t.modal?.duration3 || '3 meses',
            duration6: t.modal?.duration6 || '6 meses',
            save: t.modal?.save || 'Ahorra',
            total: t.modal?.total || 'Total',
            perMonth: t.modal?.perMonth || 'al mes',
            continue: t.modal?.continue || 'Continuar',
            login: t.modal?.login || 'Iniciar sesion',
            loading: t.modal?.loading || 'Cargando...',
            error: t.modal?.error || 'No se pudo continuar',
            close: t.modal?.close || 'Cerrar',
            contact: t.modal?.contact || 'Consultar',
            contactMessage: t.modal?.contactMessage || 'Escribenos para confirmar disponibilidad.',
            adultConfirmation: t.modal?.adultConfirmation || 'Confirmo que tengo 18 años o más.',
            termsAcceptance: t.modal?.termsAcceptance || 'He leído y acepto los',
            termsLink: t.modal?.termsLink || 'Términos',
            and: t.modal?.and || 'y la',
            privacyLink: t.modal?.privacyLink || 'Política de Privacidad',
            serviceStartRequest: t.modal?.serviceStartRequest || 'Solicito que el servicio pueda comenzar durante el periodo legal de desistimiento.',
            withdrawalLossAcknowledgement: t.modal?.withdrawalLossAcknowledgement || 'Reconozco que, una vez ejecutado íntegramente el servicio, perderé el derecho de desistimiento.',
            renewalDisclosure: t.modal?.renewalDisclosure || 'Se cobran 259 EUR al reservar. La siguiente cuota se cobra 28 días después de la primera clase; si esa fecha cambia antes de empezar, se mueve el ancla y, después de comenzar, queda fija. Desde entonces se renueva cada 28 días hasta que canceles antes del siguiente cobro.',
            sessionBankDisclosure: t.modal?.sessionBankDisclosure || 'Este periodo incluye {sessions} sesiones para usar durante {months} mes(es), sin tope mensual. Las no usadas caducan al terminar.',
            policyError: t.modal?.policyError || 'Debes confirmar y aceptar las condiciones antes de continuar.',
        },
    };

    const handleSelectPlan = (pkg: Package) => {
        setSelectedPlan({
            name: pkg.name,
            displayName: pkg.display_name?.[lang] || pkg.display_name?.['es'] || pkg.name,
            priceMonthlyCents: pkg.price_monthly,
            sessionsPerMonth: pkg.sessions_per_month,
            stripe_price_1m: pkg.stripe_price_1m,
            stripe_price_3m: pkg.stripe_price_3m,
            stripe_price_6m: pkg.stripe_price_6m,
        });
        setIsModalOpen(true);
    };

    // Get package data or use fallback
    const getPriceDisplay = (pkg: Package | undefined): { label: string; hasPrice: boolean } => {
        if (!pkg || !pkg.price_monthly) return { label: copy.modal.contact, hasPrice: false };
        return { label: formatPackagePrice(pkg.price_monthly, lang), hasPrice: true };
    };

    const recommendedPlanName = packages[0]?.name;

    const getLaunchFeatures = (pkg: Package): string[] => {
        const labels = {
            es: {
                sessions: `${pkg.sessions_per_month} clases individuales por ciclo`,
                duration: '50 minutos por clase',
                cadence: 'Renovación automática cada 28 días',
                capacity: 'Profesor y franja semanal identificados antes de pagar',
                guarantee: 'Garantía tras la primera clase y antes de la segunda',
                materials: 'Documento vivo, worksheets y carpeta de Drive',
                calendar: 'Meet y Calendar preparados desde el campus',
                support: 'Soporte dentro del campus',
            },
            en: {
                sessions: `${pkg.sessions_per_month} individual classes per cycle`,
                duration: '50 minutes per class',
                cadence: 'Automatic renewal every 28 days',
                capacity: 'Teacher and weekly time identified before payment',
                guarantee: 'Guarantee after the first class and before the second',
                materials: 'Live document, worksheets and Drive folder',
                calendar: 'Meet and Calendar prepared from the campus',
                support: 'In-campus support',
            },
            ru: {
                sessions: `${pkg.sessions_per_month} индивидуальных занятия за цикл`,
                duration: '50 минут на занятие',
                cadence: 'Автоматическое продление каждые 28 дней',
                capacity: 'Преподаватель и еженедельное время известны до оплаты',
                guarantee: 'Гарантия после первого занятия и до второго',
                materials: 'Живой документ, worksheets и папка Drive',
                calendar: 'Meet и Calendar готовятся из кампуса',
                support: 'Поддержка внутри кампуса',
            },
        }[lang];

        return [
            labels.sessions,
            labels.duration,
            labels.cadence,
            labels.capacity,
            labels.guarantee,
            labels.materials,
            labels.calendar,
            labels.support,
        ];
    };

    const getPlanFeatures = (pkg: Package, translatedFeatures: string[] | undefined): string[] => {
        const visibleTranslatedFeatures = (translatedFeatures || []).filter((feature) => !/\b55\b/.test(feature));
        const launchFeatures = getLaunchFeatures(pkg);
        const normalized = new Set(visibleTranslatedFeatures.map((feature) => feature.toLocaleLowerCase(lang)));

        return [
            ...visibleTranslatedFeatures,
            ...launchFeatures.filter((feature) => !normalized.has(feature.toLocaleLowerCase(lang))),
        ];
    };

    return (
        <>
            <section id="planes" aria-labelledby="plans-heading" className={`bg-white py-24 px-4 md:px-8 border-b-2 ${s.border}`}>
                <span id="pricing" className="block scroll-mt-20" aria-hidden="true" />
                <div className="max-w-7xl mx-auto">
                    <div className={`flex items-end justify-between mb-12 border-b-4 ${s.border} pb-4`}>
                        <h2 id="plans-heading" className="font-display text-6xl md:text-8xl tracking-tighter">{copy.title}</h2>
                        <span className="font-mono text-sm mb-2 hidden md:block">{copy.subtitle}</span>
                    </div>

                    <div className={`border-t-2 ${s.border}`}>
                        {/* Headers - Desktop */}
                        <div className="hidden md:grid grid-cols-12 gap-4 py-4 font-mono text-xs uppercase tracking-widest text-[#006064]">
                            <div className="col-span-3">{copy.headers.name}</div>
                            <div className="col-span-2">{copy.headers.price}</div>
                            <div className="col-span-5">{copy.headers.includes}</div>
                            <div className="col-span-2 text-center">{copy.headers.action}</div>
                        </div>

                        {packages.length === 0 ? (
                            <div className={`border-t-2 ${s.border} py-10 text-center`} role="status" aria-live="polite">
                                <p className="mx-auto max-w-2xl text-sm font-bold text-[#006064]">
                                    {copy.modal.contactMessage}
                                </p>
                            </div>
                        ) : packages.map((pkg, index) => {
                            const key = pkg.name || `plan-${index}`;
                            const highlight = pkg.name === recommendedPlanName;
                            const isRecommended = highlight;
                            const checkoutReady = Boolean(pkg.stripe_price_1m && pkg.stripe_price_3m && pkg.stripe_price_6m);
                            const checkoutEnabled = checkoutMode === 'checkout' && checkoutReady;
                            const planTranslations = copy.plans[key as PlanKey] ?? {
                                name: pkg.display_name?.[lang] || pkg.display_name?.es || key,
                                description: '',
                                features: [],
                            };
                            const canonicalPlanName = pkg.display_name?.[lang]
                                || pkg.display_name?.es
                                || pkg.name;
                            const planFeatures = getPlanFeatures(pkg, planTranslations.features);
                            const priceDisplay = getPriceDisplay(pkg);
                            const actionClass = `
                                w-auto px-6 ${highlight ? 'py-4' : 'py-2'}
                                ${highlight
                                    ? `${s.accent} ${s.accentText} text-sm shadow-[4px_4px_0px_0px_currentColor] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]`
                                    : `hover:bg-[#006064] hover:text-white text-xs`
                                }
                                border ${s.border} font-bold uppercase transition-all
                                disabled:opacity-50 disabled:cursor-not-allowed
                            `;

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
                                            {copy.recommended}
                                        </div>
                                    )}

                                    {/* Name & Description */}
                                    <div className="col-span-3">
                                        <h3 className={`font-display ${highlight ? 'text-4xl' : 'text-3xl'}`}>
                                            {canonicalPlanName}
                                        </h3>
                                        <p className="text-sm mt-1">{planTranslations.description}</p>
                                    </div>

                                    {/* Price */}
                                    <div className={`col-span-2 font-mono ${highlight ? 'text-3xl' : 'text-2xl'} font-bold`}>
                                        {priceDisplay.label}
                                        {priceDisplay.hasPrice && (
                                            <span className="block text-[11px] uppercase tracking-wide">
                                                {copy.month}
                                            </span>
                                        )}
                                    </div>

                                    {/* Features */}
                                    <div className={`col-span-5 text-sm ${highlight ? 'font-bold' : 'font-medium'} space-y-1`}>
                                        {planFeatures.map((feature, idx) => (
                                            <p key={idx}><span aria-hidden="true">{'\u2022'}</span> {feature}</p>
                                        ))}
                                    </div>

                                    {/* Action Button */}
                                    <div className="col-span-2 flex justify-center">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (checkoutEnabled) handleSelectPlan(pkg);
                                            }}
                                            disabled={!checkoutEnabled}
                                            data-plan={key}
                                            data-testid={`select-plan-${key}`}
                                            aria-describedby="pricing-availability-note"
                                            className={actionClass}
                                        >
                                            {checkoutEnabled ? copy.select : copy.modal.contact}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                {checkoutMode === 'unavailable' && (
                    <p id="pricing-availability-note" className="mx-auto mt-6 max-w-3xl text-center text-sm font-bold text-[#006064]">
                        {copy.applicationNote}
                    </p>
                )}
            </section>

            {/* Modal */}
            <PricingModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                plan={selectedPlan}
                lang={lang}
                isLoggedIn={isLoggedIn}
                translations={copy.modal}
            />
        </>
    );
}
