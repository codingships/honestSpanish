import React, { useEffect, useId, useRef, useState } from 'react';

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
    plan: {
        name: string;
        displayName: string;
        priceMonthly: number;
        stripe_price_1m: string | null;
        stripe_price_3m: string | null;
        stripe_price_6m: string | null;
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
        adultConfirmation: string;
        termsAcceptance: string;
        termsLink: string;
        and: string;
        privacyLink: string;
        serviceStartRequest: string;
        policyError: string;
    };
}

type Duration = 1 | 3 | 6;

const EURO = '\u20ac';

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
    const [adultConfirmed, setAdultConfirmed] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [serviceStartRequested, setServiceStartRequested] = useState(false);
    const modalId = useId();
    const titleId = `${modalId}-title`;
    const descriptionId = `${modalId}-description`;
    const errorId = `${modalId}-error`;
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen || !plan) return;

        setSelectedDuration(1);
        setIsLoading(false);
        setError(null);
        setAdultConfirmed(false);
        setTermsAccepted(false);
        setServiceStartRequested(false);
    }, [isOpen, plan]);

    useEffect(() => {
        if (!isOpen || !plan || typeof document === 'undefined') return;

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const focusTimer = window.setTimeout(() => {
            dialogRef.current?.focus();
        }, 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }

            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            ).filter((element) => !element.hasAttribute('disabled'));

            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previouslyFocused?.focus();
        };
    }, [isOpen, onClose, plan]);

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

    const getPriceId = (duration: Duration): string | null => {
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

        const priceId = getPriceId(selectedDuration);
        if (!priceId) {
            setError(t.contactMessage || t.error);
            return;
        }

        if (!adultConfirmed || !termsAccepted || !serviceStartRequested) {
            setError(t.policyError);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    priceId,
                    lang,
                    adultConfirmed,
                    termsAccepted,
                    serviceStartRequested,
                }),
            });

            const data = await response.json().catch(() => ({})) as { error?: unknown; url?: unknown };

            if (!response.ok) {
                throw new Error(typeof data.error === 'string' && data.error ? data.error : t.error);
            }

            if (typeof data.url === 'string' && data.url) {
                window.location.href = data.url;
                return;
            }

            throw new Error(t.error);
        } catch (err: unknown) {
            setError(err instanceof Error && err.message ? err.message : t.error);
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
        >
            {/* Overlay */}
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={onClose} />

            {/* Modal */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
                aria-busy={isLoading}
                tabIndex={-1}
                data-testid="pricing-modal"
                className="relative bg-white max-w-md w-full p-8 border-2 border-[#006064] shadow-[8px_8px_0px_0px_#006064] z-10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close button */}
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 text-[#006064] hover:opacity-70 text-2xl font-bold"
                    aria-label={t.close}
                >
                    <span aria-hidden="true">&times;</span>
                </button>

                {/* Title */}
                <h2 id={titleId} className="font-display text-2xl text-[#006064] uppercase mb-2">
                    {plan.displayName}
                </h2>
                <p id={descriptionId} className="text-[#006064]/60 text-sm uppercase tracking-wide mb-6">
                    {t.title}
                </p>

                {/* Duration Options */}
                <div className="space-y-3 mb-6" role="group" aria-label={t.title}>
                    {durations.map(({ value, label }) => {
                        const savings = calculateSavings(value);
                        return (
                            <button
                                type="button"
                                key={value}
                                onClick={() => {
                                    setSelectedDuration(value);
                                    setError(null);
                                }}
                                disabled={isLoading}
                                aria-pressed={selectedDuration === value}
                                className={`w-full p-4 border-2 text-left transition-all ${selectedDuration === value
                                        ? 'border-[#006064] bg-[#E0F7FA]'
                                        : 'border-[#006064]/20 hover:border-[#006064]/50'
                                    }`}
                            >
                                <div className="flex justify-between items-center">
                                    <span className="font-bold text-[#006064]">{label}</span>
                                    <span className="font-mono text-[#006064]">
                                        {calculateMonthlyEquivalent(value)}{EURO}/{t.perMonth}
                                    </span>
                                </div>
                                {savings > 0 && (
                                    <p className="text-xs text-green-600 mt-1">
                                        {t.save} {savings}{EURO}
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
                            {calculateTotal(selectedDuration)}{EURO}
                        </span>
                    </div>
                </div>

                <div className="mb-6 space-y-3 text-xs leading-5 text-[#006064]/80">
                    <label className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={adultConfirmed}
                            onChange={(event) => {
                                setAdultConfirmed(event.currentTarget.checked);
                                setError(null);
                            }}
                            aria-required="true"
                            className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                        />
                        <span>{t.adultConfirmation}</span>
                    </label>

                    <label className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={termsAccepted}
                            onChange={(event) => {
                                setTermsAccepted(event.currentTarget.checked);
                                setError(null);
                            }}
                            aria-required="true"
                            className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                        />
                        <span>
                            {t.termsAcceptance}{' '}
                            <a href={`/${lang}/legal/terminos`} target="_blank" rel="noopener noreferrer" className="font-bold underline">{t.termsLink}</a>
                            {' '}{t.and}{' '}
                            <a href={`/${lang}/legal/privacidad`} target="_blank" rel="noopener noreferrer" className="font-bold underline">{t.privacyLink}</a>.
                        </span>
                    </label>

                    <label className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={serviceStartRequested}
                            onChange={(event) => {
                                setServiceStartRequested(event.currentTarget.checked);
                                setError(null);
                            }}
                            aria-required="true"
                            className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                        />
                        <span>{t.serviceStartRequest}</span>
                    </label>
                </div>

                {/* Error message */}
                {error && (
                    <div id={errorId} role="alert" className="mb-4 p-3 bg-red-100 border-2 border-red-500 text-red-700 text-sm font-bold">
                        {error}
                    </div>
                )}

                {/* CTA Button */}
                <button
                    type="button"
                    onClick={handleContinue}
                    disabled={isLoading}
                    aria-busy={isLoading}
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
