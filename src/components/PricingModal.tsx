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
        contact: string;
        contactMessage: string;
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

    const handleContinue = async () => {
        if (!isLoggedIn) {
            window.location.href = `/${lang}/login`;
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    priceId: getPriceId(selectedDuration),
                    lang,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error creating checkout session');
            }

            if (data.url) {
                window.location.href = data.url;
            }
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            setError(err.message || t.error);
        } finally {
            setIsLoading(false);
        }
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

                {/* Duration Options */}
                <div className="space-y-3 mb-6">
                    {durations.map(({ value, label }) => {
                        const savings = calculateSavings(value);
                        return (
                            <button
                                key={value}
                                onClick={() => setSelectedDuration(value)}
                                className={`w-full p-4 border-2 text-left transition-all ${selectedDuration === value
                                        ? 'border-[#006064] bg-[#E0F7FA]'
                                        : 'border-[#006064]/20 hover:border-[#006064]/50'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-[#006064]">{label}</span>
                                    <span className="font-mono text-[#006064]">
                                        {calculateMonthlyEquivalent(value)}€/{t.perMonth}
                                    </span>
                                </div>
                                {savings > 0 && (
                                    <p className="text-xs text-green-600 mt-1">
                                        {t.save} {savings}€
                                    </p>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Price Summary */}
                <div className="mb-6 p-4 bg-[#E0F7FA] border-2 border-[#006064]">
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-[#006064]">{t.total}</span>
                        <span className="font-display text-2xl text-[#006064]">
                            {calculateTotal(selectedDuration)}€
                        </span>
                    </div>
                </div>

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
                    {isLoading ? t.loading : (isLoggedIn ? t.continue : t.login)}
                </button>
            </div>
        </div>
    );
}
