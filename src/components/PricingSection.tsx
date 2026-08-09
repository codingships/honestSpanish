import React, { useCallback, useEffect, useState } from 'react';
import PricingModal, { type PricingModalTranslations } from './PricingModal';
import { formatPackagePrice } from '../lib/package-pricing';

interface Package {
    name: string;
    price_monthly: number;
    sessions_per_month: number;
}

interface PricingSectionProps {
    packages: Package[];
    lang: 'es' | 'en' | 'ru';
    purchaseEnabled?: boolean;
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
        contactCta?: string;
        applicationNote?: string;
        plans: Record<string, { name: string; description: string; features: string[] }>;
        modal: Partial<PricingModalTranslations>;
    };
}

type PlanKey = string;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const s = {
    accent: 'bg-[#006064]',
    accentText: 'text-white',
    border: 'border-[#006064]',
    secondaryBg: 'bg-white',
};

export default function PricingSection({
    packages,
    lang,
    purchaseEnabled = true,
    translations: t,
}: PricingSectionProps) {
    const [selectedPlan, setSelectedPlan] = useState<{
        name: string;
        displayName: string;
        priceCents: number;
        sessionsPerCycle: number;
    } | null>(null);
    const [initialSlotPublicId, setInitialSlotPublicId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [checkoutState, setCheckoutState] = useState<'unknown' | 'open' | 'closed'>('unknown');
    const copy = {
        title: t.title || 'Planes',
        subtitle: t.subtitle || '',
        headers: {
            name: t.headers?.name || 'Plan',
            price: t.headers?.price || 'Precio',
            includes: t.headers?.includes || 'Incluye',
            action: t.headers?.action || 'Acción',
        },
        month: t.month || 'cada 28 días',
        select: t.select || 'Seleccionar',
        recommended: t.recommended || 'Recomendado',
        contactCta: t.contactCta || {
            es: 'HABLEMOS',
            en: "LET'S TALK",
            ru: 'ПОГОВОРИМ',
        }[lang],
        applicationNote: t.applicationNote || {
            es: 'El precio y la oferta están publicados. Escríbenos para comprobar disponibilidad y empezar. La compra directa se abrirá cuando habilitemos el pago.',
            en: 'Price and offer are published. Write to us to check availability and get started. Direct purchase opens when we enable payment.',
            ru: 'Цена и предложение опубликованы. Напишите нам, чтобы уточнить наличие мест и начать. Прямая покупка откроется, когда мы включим оплату.',
        }[lang],
        plans: t.plans || {},
        modal: {
            title: t.modal?.title || 'Elige profesor y horario antes de pagar',
            availabilityLoading: t.modal?.availabilityLoading || 'Consultando plazas reales...',
            availabilityEmpty: t.modal?.availabilityEmpty || 'Ahora mismo no hay plazas publicadas disponibles.',
            availabilityError: t.modal?.availabilityError || 'No se pudo consultar la disponibilidad.',
            retryAvailability: t.modal?.retryAvailability || 'Reintentar',
            slotChoice: t.modal?.slotChoice || 'Plazas semanales disponibles',
            teacher: t.modal?.teacher || 'Profesor',
            weeklyTime: t.modal?.weeklyTime || 'Horario semanal',
            timezone: t.modal?.timezone || 'Zona horaria',
            firstClass: t.modal?.firstClass || 'Primera clase',
            cycleDates: t.modal?.cycleDates || 'Cuatro clases del ciclo',
            renewalDate: t.modal?.renewalDate || 'Siguiente cobro',
            viewAvailability: t.modal?.viewAvailability || 'Ver plazas',
            total: t.modal?.total || 'Cobro al reservar',
            continue: t.modal?.continue || 'Reservar y pagar',
            login: t.modal?.login || 'Inicia sesión para continuar',
            loading: t.modal?.loading || 'Procesando...',
            error: t.modal?.error || 'No se pudo continuar.',
            close: t.modal?.close || 'Cerrar',
            contact: t.modal?.contact || 'Consultar disponibilidad',
            contactMessage: t.modal?.contactMessage || 'No se pudo publicar la oferta ahora mismo.',
            checkoutClosed: t.modal?.checkoutClosed || 'Esta plaza es real, pero el pago todavía no está habilitado.',
            securityError: t.modal?.securityError || 'La verificación de seguridad ha caducado o ha fallado.',
            slotConflict: t.modal?.slotConflict || 'La plaza ya no está disponible. Consulta las opciones actualizadas.',
            activeSubscription: t.modal?.activeSubscription || 'Ya tienes una suscripción activa. Puedes gestionarla desde tu cuenta.',
            checkoutInProgress: t.modal?.checkoutInProgress || 'Ya hay una reserva en curso. Vuelve a intentarlo dentro de unos minutos.',
            accountNotEligible: t.modal?.accountNotEligible || 'Esta cuenta necesita revisión antes de poder pagar. Escríbenos para comprobarla.',
            paymentAccountConflict: t.modal?.paymentAccountConflict || 'Tu perfil de pago necesita revisión antes de continuar. Escríbenos para comprobarlo.',
            adultConfirmation: t.modal?.adultConfirmation || 'Confirmo que tengo 18 años o más.',
            termsAcceptance: t.modal?.termsAcceptance || 'He leído y acepto los',
            termsLink: t.modal?.termsLink || 'Términos',
            and: t.modal?.and || 'y la',
            privacyLink: t.modal?.privacyLink || 'Política de Privacidad',
            serviceStartRequest: t.modal?.serviceStartRequest || 'Solicito que el servicio pueda comenzar durante el periodo legal de desistimiento.',
            withdrawalLossAcknowledgement: t.modal?.withdrawalLossAcknowledgement || 'Reconozco que, una vez ejecutado íntegramente el servicio, perderé el derecho de desistimiento.',
            renewalDisclosure: t.modal?.renewalDisclosure || 'La siguiente cuota se cobra 28 días después de la primera clase.',
            sessionBankDisclosure: t.modal?.sessionBankDisclosure || 'Cada ciclo incluye cuatro clases individuales de 50 minutos.',
            policyError: t.modal?.policyError || 'Debes confirmar y aceptar las cuatro condiciones antes de continuar.',
            policyChanged: t.modal?.policyChanged || 'Las condiciones han cambiado. Recarga la página y vuelve a confirmarlas.',
        } satisfies PricingModalTranslations,
    };

    const handleSelectPlan = useCallback((pkg: Package, slotPublicId: string | null = null) => {
        setSelectedPlan({
            name: pkg.name,
            displayName: t.plans?.[pkg.name]?.name || pkg.name,
            priceCents: pkg.price_monthly,
            sessionsPerCycle: pkg.sessions_per_month,
        });
        setInitialSlotPublicId(slotPublicId);
        setIsModalOpen(true);
    }, [t.plans]);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setInitialSlotPublicId(null);
    }, []);

    useEffect(() => {
        if (!purchaseEnabled) return;
        if (typeof window === 'undefined') return;

        const url = new URL(window.location.href);
        const slotPublicId = url.searchParams.get('checkoutSlot');
        if (!slotPublicId) return;

        if (!uuidPattern.test(slotPublicId)) {
            url.searchParams.delete('checkoutSlot');
            window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
            return;
        }
        if (!packages[0]) return;

        url.searchParams.delete('checkoutSlot');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        handleSelectPlan(packages[0], slotPublicId);
    }, [handleSelectPlan, packages, purchaseEnabled]);

    const getPriceDisplay = (pkg: Package | undefined): { label: string; hasPrice: boolean } => {
        if (!pkg || !Number.isInteger(pkg.price_monthly) || pkg.price_monthly <= 0) {
            return { label: copy.modal.contact, hasPrice: false };
        }
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
                guarantee: 'Garantía proporcional sobre las clases no consumidas',
                materials: 'Documento vivo, worksheets y carpeta de Drive',
                calendar: 'Meet y Calendar preparados desde el campus',
                support: 'Soporte dentro del campus',
            },
            en: {
                sessions: `${pkg.sessions_per_month} individual classes per cycle`,
                duration: '50 minutes per class',
                cadence: 'Automatic renewal every 28 days',
                capacity: 'Teacher and weekly time identified before payment',
                guarantee: 'Proportional guarantee for unconsumed classes',
                materials: 'Live document, worksheets and Drive folder',
                calendar: 'Meet and Calendar prepared from the campus',
                support: 'In-campus support',
            },
            ru: {
                sessions: `${pkg.sessions_per_month} индивидуальных занятия за цикл`,
                duration: '50 минут на занятие',
                cadence: 'Автоматическое продление каждые 28 дней',
                capacity: 'Преподаватель и еженедельное время известны до оплаты',
                guarantee: 'Пропорциональная гарантия за неиспользованные занятия',
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

    const showDiscoveryNote = !purchaseEnabled || checkoutState === 'closed';

    return (
        <>
            <section id="planes" aria-labelledby="plans-heading" className={`border-b-2 bg-white px-4 py-24 md:px-8 ${s.border}`}>
                <span id="pricing" className="block scroll-mt-20" aria-hidden="true" />
                <div className="mx-auto max-w-7xl">
                    <div className={`mb-12 flex items-end justify-between border-b-4 pb-4 ${s.border}`}>
                        <h2 id="plans-heading" className="font-display text-6xl tracking-tighter md:text-8xl">{copy.title}</h2>
                        <span className="mb-2 hidden font-mono text-sm md:block">{copy.subtitle}</span>
                    </div>

                    <div className={`border-t-2 ${s.border}`}>
                        <div className="hidden grid-cols-12 gap-4 py-4 font-mono text-xs uppercase tracking-widest text-[#006064] md:grid">
                            <div className="col-span-3">{copy.headers.name}</div>
                            <div className="col-span-2">{copy.headers.price}</div>
                            <div className="col-span-5">{copy.headers.includes}</div>
                            <div className="col-span-2 text-center">{copy.headers.action}</div>
                        </div>

                        {packages.length === 0 ? (
                            <div className={`border-t-2 py-10 text-center ${s.border}`} role="status" aria-live="polite">
                                <p className="mx-auto max-w-2xl text-sm font-bold text-[#006064]">{copy.modal.contactMessage}</p>
                            </div>
                        ) : packages.map((pkg, index) => {
                            const key = pkg.name || `plan-${index}`;
                            const highlight = pkg.name === recommendedPlanName;
                            const planTranslations = copy.plans[key as PlanKey] ?? {
                                name: key,
                                description: '',
                                features: [],
                            };
                            const canonicalPlanName = planTranslations.name || pkg.name;
                            const planFeatures = getPlanFeatures(pkg, planTranslations.features);
                            const priceDisplay = getPriceDisplay(pkg);
                            const actionClass = `w-auto border px-6 ${highlight ? 'py-4' : 'py-2'} ${highlight
                                ? `${s.accent} ${s.accentText} text-sm shadow-[4px_4px_0px_0px_currentColor] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-none`
                                : 'text-xs hover:bg-[#006064] hover:text-white'} ${s.border} font-bold uppercase transition-all disabled:cursor-not-allowed disabled:opacity-50`;

                            return (
                                <div
                                    key={key}
                                    className={`pricing-plan-card relative grid grid-cols-1 items-center gap-6 border-t-2 md:grid-cols-12 md:gap-4 ${highlight ? `border-b-2 py-12 ${s.secondaryBg}` : 'py-8'} ${s.border}`}
                                >
                                    {highlight && (
                                        <div className={`absolute left-0 top-0 px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${s.accent} ${s.accentText}`}>
                                            {copy.recommended}
                                        </div>
                                    )}

                                    <div className="col-span-3">
                                        <h3 className={`font-display ${highlight ? 'text-4xl' : 'text-3xl'}`}>{canonicalPlanName}</h3>
                                        <p className="mt-1 text-sm">{planTranslations.description}</p>
                                    </div>

                                    <div className={`col-span-2 font-mono font-bold ${highlight ? 'text-3xl' : 'text-2xl'}`}>
                                        {priceDisplay.label}
                                        {priceDisplay.hasPrice && <span className="block text-[11px] uppercase tracking-wide">{copy.month}</span>}
                                    </div>

                                    <div className={`col-span-5 space-y-1 text-sm ${highlight ? 'font-bold' : 'font-medium'}`}>
                                        {planFeatures.map((feature, featureIndex) => (
                                            <p key={featureIndex}><span aria-hidden="true">•</span> {feature}</p>
                                        ))}
                                    </div>

                                    <div className="col-span-2 flex justify-center">
                                        {purchaseEnabled ? (
                                            <button
                                                type="button"
                                                onClick={() => handleSelectPlan(pkg)}
                                                disabled={!priceDisplay.hasPrice}
                                                data-plan={key}
                                                data-testid={`select-plan-${key}`}
                                                aria-describedby={checkoutState === 'closed' ? 'pricing-availability-note' : undefined}
                                                className={actionClass}
                                            >
                                                {copy.modal.viewAvailability}
                                            </button>
                                        ) : (
                                            <a
                                                href="#contacto"
                                                data-plan={key}
                                                data-testid={`select-plan-${key}`}
                                                aria-describedby="pricing-availability-note"
                                                className={actionClass}
                                            >
                                                {copy.contactCta}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                {showDiscoveryNote && (
                    <p id="pricing-availability-note" className="mx-auto mt-6 max-w-3xl text-center text-sm font-bold text-[#006064]">
                        {copy.applicationNote}
                    </p>
                )}
            </section>

            {purchaseEnabled && (
                <PricingModal
                    isOpen={isModalOpen}
                    onClose={closeModal}
                    plan={selectedPlan}
                    lang={lang}
                    onCheckoutStatus={setCheckoutState}
                    initialSlotPublicId={initialSlotPublicId}
                    translations={copy.modal}
                />
            )}
        </>
    );
}
