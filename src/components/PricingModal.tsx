import React, { useState } from 'react';

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
    plan: {
        name: string;
        displayName: string;
        priceMonthly: number;
        stripe_price_1m: string;
        stripe_price_3m: string;
        stripe_price_6m: string;
    } | null;
    lang: 'es' | 'en' | 'ru';
    isLoggedIn: boolean;
    translations: {
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
}

type Duration = 1 | 3 | 6;

export default function PricingModal({
    isOpen,
    onClose,
    plan,
    lang,
    isLoggedIn,
    translations: t
}: PricingModalProps) {
    const [selectedDuration, setSelectedDuration] = useState<Duration>(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen || !plan) return null;

    const discounts: Record<Duration, number> = {
        1: 1,
        3: 0.9,
        6: 0.8,
    };

    const calculateTotal = (duration: Duration) => {
        return Math.round(plan.priceMonthly * duration * discounts[duration]);
    };

    const calculateSavings = (duration: Duration) => {
        const fullPrice = plan.priceMonthly * duration;
        const discountedPrice = calculateTotal(duration);
        return fullPrice - discountedPrice;
    };

    const calculateMonthlyEquivalent = (duration: Duration) => {
        return Math.round(calculateTotal(duration) / duration);
    };

    const getPriceId = (duration: Duration): string => {
        switch (duration) {
            case 1: return plan.stripe_price_1m;
            case 3: return plan.stripe_price_3m;
            case 6: return plan.stripe_price_6m;
        }
    };

    // TEMPORALMENTE: Redirigir a contacto por email en vez de Stripe
    const handleContinue = () => {
        const subject = encodeURIComponent(`Interés en plan ${plan.displayName}`);
        const body = encodeURIComponent(`Hola,\n\nMe interesa el plan ${plan.displayName}.\n\nPor favor, contactadme para más información.\n\nGracias.`);
        window.location.href = `mailto:alejandro@espanolhonesto.com?subject=${subject}&body=${body}`;
    };

    const durations: { value: Duration; label: string }[] = [
        { value: 1, label: t.duration1 },
        { value: 3, label: t.duration3 },
        { value: 6, label: t.duration6 },
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
            onClick={onClose}
        >
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/50" />

            {/* Modal */}
            <div
                className="relative bg-white max-w-md w-full p-8 border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] z-10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-[#006064] hover:opacity-70 text-2xl font-bold"
                    aria-label={t.close}
                >
                    ×
                </button>

                {/* Title */}
                <h2 className="font-display text-2xl text-[#006064] uppercase mb-2">
                    {plan.displayName}
                </h2>
                <p className="text-[#006064]/60 text-sm uppercase tracking-wide mb-6">
                    {t.title}
                </p>

                {/* TEMPORALMENTE: Ocultar opciones de duración con precios */}
                {/* Mensaje de contacto */}
                <div className="mb-6 p-4 bg-[#E0F7FA] border-2 border-[#006064]">
                    <p className="text-[#006064] text-center">
                        Para conocer precios y disponibilidad, contáctanos directamente.
                    </p>
                </div>

                {/* TEMPORALMENTE: Ocultar resumen de precios */}

                {/* Error message */}
                {error && (
                    <div className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* CTA Button */}
                <button
                    onClick={handleContinue}
                    disabled={isLoading}
                    className={`
                        w-full py-4 font-bold text-sm uppercase tracking-widest
                        border-2 border-[#006064] 
                        shadow-[4px_4px_0px_0px_#006064] 
                        hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] 
                        transition-all
                        ${isLoading
                            ? 'bg-gray-400 text-white cursor-not-allowed'
                            : 'bg-[#006064] text-white hover:bg-[#004d40]'
                        }
                    `}
                >
                    Contactar
                </button>
            </div>
        </div>
    );
}
