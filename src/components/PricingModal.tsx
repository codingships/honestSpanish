import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { TurnstileInstance } from '@marsidev/react-turnstile';
import ResponsiveTurnstile from './ResponsiveTurnstile';
import { formatPackagePrice } from '../lib/package-pricing';
import { buildCheckoutLoginUrl, parseBookableSlotsResponse } from '../lib/public-checkout-ui';
import {
    captureAcquisitionAttribution,
    type AcquisitionAttribution,
} from '../lib/acquisition-attribution';
import type { PublicBookableSlot } from '../lib/public-bookable-slots';
import { CHECKOUT_TERMS_VERSION } from '../lib/legal-policy';

export interface PricingModalTranslations {
    title: string;
    availabilityLoading: string;
    availabilityEmpty: string;
    availabilityError: string;
    retryAvailability: string;
    slotChoice: string;
    teacher: string;
    weeklyTime: string;
    timezone: string;
    firstClass: string;
    cycleDates: string;
    renewalDate: string;
    viewAvailability: string;
    total: string;
    continue: string;
    login: string;
    loading: string;
    error: string;
    close: string;
    contact: string;
    contactMessage: string;
    checkoutClosed: string;
    securityError: string;
    slotConflict: string;
    activeSubscription: string;
    checkoutInProgress: string;
    accountNotEligible: string;
    paymentAccountConflict: string;
    adultConfirmation: string;
    termsAcceptance: string;
    termsLink: string;
    and: string;
    privacyLink: string;
    serviceStartRequest: string;
    withdrawalLossAcknowledgement: string;
    renewalDisclosure: string;
    sessionBankDisclosure: string;
    policyError: string;
    policyChanged: string;
}

interface PricingModalProps {
    isOpen: boolean;
    onClose: () => void;
    plan: {
        name: string;
        displayName: string;
        priceCents: number;
        sessionsPerCycle: number;
    } | null;
    lang: 'es' | 'en' | 'ru';
    onCheckoutStatus?: (status: 'unknown' | 'open' | 'closed') => void;
    onLoginRequired?: (url: string) => void;
    initialSlotPublicId?: string | null;
    translations: PricingModalTranslations;
}

type AvailabilityState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type AccountState = 'idle' | 'checking' | 'ready' | 'login' | 'ineligible' | 'error';

type CheckoutErrorCode =
    | 'ACTIVE_SUBSCRIPTION'
    | 'SLOT_UNAVAILABLE'
    | 'HOLD_CONFLICT'
    | 'CHECKOUT_RECONCILING'
    | 'CHECKOUT_IN_PROGRESS'
    | 'POLICY_VERSION_CHANGED'
    | 'CHECKOUT_DISABLED'
    | 'ACCOUNT_NOT_ELIGIBLE'
    | 'OFFER_CONFIGURATION_ERROR'
    | 'CUSTOMER_CONFIGURATION_ERROR'
    | 'CUSTOMER_BALANCE_CONFLICT'
    | 'CUSTOMER_DISCOUNT_CONFLICT'
    | 'CHECKOUT_PROVIDER_UNAVAILABLE'
    | 'CHECKOUT_CONFIGURATION_ERROR';

const checkoutErrorCodes = new Set<CheckoutErrorCode>([
    'ACTIVE_SUBSCRIPTION',
    'SLOT_UNAVAILABLE',
    'HOLD_CONFLICT',
    'CHECKOUT_RECONCILING',
    'CHECKOUT_IN_PROGRESS',
    'POLICY_VERSION_CHANGED',
    'CHECKOUT_DISABLED',
    'ACCOUNT_NOT_ELIGIBLE',
    'OFFER_CONFIGURATION_ERROR',
    'CUSTOMER_CONFIGURATION_ERROR',
    'CUSTOMER_BALANCE_CONFLICT',
    'CUSTOMER_DISCOUNT_CONFLICT',
    'CHECKOUT_PROVIDER_UNAVAILABLE',
    'CHECKOUT_CONFIGURATION_ERROR',
]);

const turnstileTestingSiteKey = '1x00000000000000000000AA';

function localeFor(lang: PricingModalProps['lang']): string {
    if (lang === 'en') return 'en-GB';
    if (lang === 'ru') return 'ru-RU';
    return 'es-ES';
}

function formatWeeklyTime(slot: PublicBookableSlot, lang: PricingModalProps['lang']): string {
    return new Intl.DateTimeFormat(localeFor(lang), {
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: slot.timezoneName,
    }).format(new Date(slot.firstClassAt));
}

function formatOccurrence(iso: string, timeZone: string, lang: PricingModalProps['lang']): string {
    return new Intl.DateTimeFormat(localeFor(lang), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone,
    }).format(new Date(iso));
}

export default function PricingModal({
    isOpen,
    onClose,
    plan,
    lang,
    onCheckoutStatus,
    onLoginRequired,
    initialSlotPublicId = null,
    translations: t,
}: PricingModalProps) {
    const [availabilityState, setAvailabilityState] = useState<AvailabilityState>('idle');
    const [checkoutEnabled, setCheckoutEnabled] = useState(false);
    const [accountState, setAccountState] = useState<AccountState>('idle');
    const [accountCheckRequest, setAccountCheckRequest] = useState(0);
    const [slots, setSlots] = useState<PublicBookableSlot[]>([]);
    const [selectedSlotPublicId, setSelectedSlotPublicId] = useState<string | null>(null);
    const [availabilityRequest, setAvailabilityRequest] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [adultConfirmed, setAdultConfirmed] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [serviceStartRequested, setServiceStartRequested] = useState(false);
    const [withdrawalLossAcknowledged, setWithdrawalLossAcknowledged] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const modalId = useId();
    const titleId = `${modalId}-title`;
    const descriptionId = `${modalId}-description`;
    const errorId = `${modalId}-error`;
    const dialogRef = useRef<HTMLDivElement>(null);
    const turnstileRef = useRef<TurnstileInstance>(null);
    const initialSelectionAttemptedRef = useRef(false);
    const unavailableSlotIdsRef = useRef(new Set<string>());
    const checkoutAttemptRef = useRef(0);
    const isLoadingRef = useRef(false);

    const resetTurnstile = useCallback(() => {
        setTurnstileToken(null);
        turnstileRef.current?.reset();
    }, []);

    const closeModal = useCallback(() => {
        if (isLoadingRef.current) return;
        checkoutAttemptRef.current += 1;
        resetTurnstile();
        onClose();
    }, [onClose, resetTurnstile]);

    useEffect(() => {
        checkoutAttemptRef.current += 1;
        isLoadingRef.current = false;
        setAvailabilityState('idle');
        setCheckoutEnabled(false);
        setAccountState('idle');
        setAccountCheckRequest(0);
        onCheckoutStatus?.('unknown');
        setSlots([]);
        setSelectedSlotPublicId(null);
        setAvailabilityRequest(0);
        setIsLoading(false);
        setError(null);
        setAdultConfirmed(false);
        setTermsAccepted(false);
        setServiceStartRequested(false);
        setWithdrawalLossAcknowledged(false);
        initialSelectionAttemptedRef.current = false;
        unavailableSlotIdsRef.current.clear();
        resetTurnstile();

        if (!isOpen || !plan) return undefined;

        return () => {
            checkoutAttemptRef.current += 1;
            isLoadingRef.current = false;
        };
    }, [isOpen, onCheckoutStatus, plan, resetTurnstile]);

    useEffect(() => {
        if (!isOpen || !plan) return;

        const controller = new AbortController();
        setAvailabilityState('loading');

        void (async () => {
            try {
                const response = await fetch('/api/bookable-slots', {
                    method: 'GET',
                    cache: 'no-store',
                    headers: { Accept: 'application/json' },
                    signal: controller.signal,
                });
                const payload: unknown = await response.json().catch(() => null);
                if (!response.ok) throw new Error(t.availabilityError);

                const parsed = parseBookableSlotsResponse(payload);
                if (!parsed) throw new Error(t.availabilityError);
                setCheckoutEnabled(parsed.checkoutEnabled);
                onCheckoutStatus?.(parsed.checkoutEnabled ? 'open' : 'closed');
                const nextSlots = parsed.slots.filter(
                    (slot) => !unavailableSlotIdsRef.current.has(slot.publicId),
                );

                const shouldAttemptInitialSelection = !initialSelectionAttemptedRef.current
                    && Boolean(initialSlotPublicId);
                setSlots(nextSlots);
                setAvailabilityState(nextSlots.length ? 'ready' : 'empty');
                setSelectedSlotPublicId((current) => {
                    if (current && nextSlots.some((slot) => slot.publicId === current)) return current;
                    if (
                        shouldAttemptInitialSelection
                        && initialSlotPublicId
                        && nextSlots.some((slot) => slot.publicId === initialSlotPublicId)
                    ) return initialSlotPublicId;
                    return null;
                });

                if (shouldAttemptInitialSelection && initialSlotPublicId) {
                    if (!nextSlots.some((slot) => slot.publicId === initialSlotPublicId)) {
                        setError(t.slotConflict);
                    }
                    initialSelectionAttemptedRef.current = true;
                }
            } catch {
                if (controller.signal.aborted) return;
                setSlots([]);
                setSelectedSlotPublicId(null);
                setCheckoutEnabled(false);
                onCheckoutStatus?.('unknown');
                setAvailabilityState('error');
                setError(null);
            }
        })();

        return () => controller.abort();
    }, [availabilityRequest, initialSlotPublicId, isOpen, onCheckoutStatus, plan, t.availabilityError, t.slotConflict]);

    useEffect(() => {
        setAdultConfirmed(false);
        setTermsAccepted(false);
        setServiceStartRequested(false);
        setWithdrawalLossAcknowledged(false);
        resetTurnstile();
    }, [resetTurnstile, selectedSlotPublicId]);

    useEffect(() => {
        if (!isOpen || !plan || !checkoutEnabled || !selectedSlotPublicId) {
            setAccountState('idle');
            return undefined;
        }

        const controller = new AbortController();
        setAccountState('checking');
        setError(null);

        void (async () => {
            try {
                const response = await fetch('/api/auth/checkout-readiness', {
                    method: 'GET',
                    cache: 'no-store',
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;

                if (response.status === 204) {
                    setAccountState('ready');
                    return;
                }
                if (response.status === 401 || response.status === 409) {
                    setAccountState('login');
                    return;
                }
                if (response.status === 403) {
                    setAccountState('ineligible');
                    setError(t.accountNotEligible);
                    return;
                }
                throw new Error('checkout readiness unavailable');
            } catch {
                if (controller.signal.aborted) return;
                setAccountState('error');
                setError(t.error);
            }
        })();

        return () => controller.abort();
    }, [
        accountCheckRequest,
        checkoutEnabled,
        isOpen,
        plan,
        selectedSlotPublicId,
        t.accountNotEligible,
        t.error,
    ]);

    useEffect(() => {
        if (!isOpen || !plan || typeof document === 'undefined') return;

        const previouslyFocused = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const bodyWasAlreadyLocked = document.body.classList.contains('overflow-hidden');
        document.body.classList.add('overflow-hidden');

        const getFocusable = () => Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
                'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
        ).filter((element) => !element.hasAttribute('disabled'));

        const focusTimer = window.setTimeout(() => {
            (getFocusable()[0] ?? dialogRef.current)?.focus();
        }, 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeModal();
                return;
            }

            if (event.key !== 'Tab' || !dialogRef.current) return;

            const focusable = getFocusable();

            if (focusable.length === 0) {
                event.preventDefault();
                dialogRef.current.focus();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);

            if (event.shiftKey && activeIndex <= 0) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (activeIndex === -1 || activeIndex === focusable.length - 1)) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('keydown', handleKeyDown);
            if (!bodyWasAlreadyLocked) document.body.classList.remove('overflow-hidden');
            previouslyFocused?.focus();
        };
    }, [closeModal, isOpen, plan]);

    if (!isOpen || !plan) return null;

    const selectedSlot = slots.find((slot) => slot.publicId === selectedSlotPublicId) ?? null;

    const loginWithSelection = (attribution?: AcquisitionAttribution | null) => {
        if (!selectedSlot) return;
        const url = buildCheckoutLoginUrl(
            lang,
            selectedSlot.publicId,
            attribution ?? captureAcquisitionAttribution(lang),
        );
        if (onLoginRequired) onLoginRequired(url);
        else window.location.assign(url);
    };

    const handleContinue = async () => {
        if (!selectedSlot) {
            setError(t.slotConflict);
            return;
        }
        const attribution = captureAcquisitionAttribution(lang);
        if (!checkoutEnabled || accountState !== 'ready') return;
        if (!adultConfirmed || !termsAccepted || !serviceStartRequested || !withdrawalLossAcknowledged) {
            setError(t.policyError);
            return;
        }
        if (!turnstileToken) {
            setError(t.securityError);
            return;
        }

        const checkoutAttempt = ++checkoutAttemptRef.current;
        isLoadingRef.current = true;
        setIsLoading(true);
        setError(null);

        const isCurrentAttempt = () => checkoutAttemptRef.current === checkoutAttempt;

        try {
            const response = await fetch('/api/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slotPublicId: selectedSlot.publicId,
                    lang,
                    policyVersion: CHECKOUT_TERMS_VERSION,
                    adultConfirmed,
                    termsAccepted,
                    serviceStartRequested,
                    withdrawalLossAcknowledged,
                    ...(attribution ? { attribution } : {}),
                    'cf-turnstile-response': turnstileToken,
                }),
            });
            const data = await response.json().catch(() => ({})) as {
                errorCode?: unknown;
                url?: unknown;
            };

            if (!isCurrentAttempt()) return;

            const errorCode = typeof data.errorCode === 'string'
                && checkoutErrorCodes.has(data.errorCode as CheckoutErrorCode)
                ? data.errorCode as CheckoutErrorCode
                : null;

            if (response.status === 401) {
                loginWithSelection(attribution);
                return;
            }
            if (response.status === 409 && (errorCode === 'SLOT_UNAVAILABLE' || errorCode === 'HOLD_CONFLICT')) {
                unavailableSlotIdsRef.current.add(selectedSlot.publicId);
                setSelectedSlotPublicId(null);
                setSlots((current) => {
                    const nextSlots = current.filter((slot) => slot.publicId !== selectedSlot.publicId);
                    setAvailabilityState(nextSlots.length ? 'ready' : 'empty');
                    return nextSlots;
                });
                setError(t.slotConflict);
                setAvailabilityRequest((request) => request + 1);
                return;
            }
            if (response.status === 409 && errorCode === 'ACTIVE_SUBSCRIPTION') {
                setError(t.activeSubscription);
                return;
            }
            if (response.status === 409 && (errorCode === 'CHECKOUT_RECONCILING' || errorCode === 'CHECKOUT_IN_PROGRESS')) {
                setError(t.checkoutInProgress);
                return;
            }
            if (response.status === 409 && errorCode === 'POLICY_VERSION_CHANGED') {
                setAdultConfirmed(false);
                setTermsAccepted(false);
                setServiceStartRequested(false);
                setWithdrawalLossAcknowledged(false);
                resetTurnstile();
                setError(t.policyChanged);
                return;
            }
            if (
                response.status === 409
                && (
                    errorCode === 'CUSTOMER_CONFIGURATION_ERROR'
                    || errorCode === 'CUSTOMER_BALANCE_CONFLICT'
                    || errorCode === 'CUSTOMER_DISCOUNT_CONFLICT'
                )
            ) {
                setError(t.paymentAccountConflict);
                return;
            }
            if (response.status === 403) {
                if (errorCode === 'CHECKOUT_DISABLED') {
                    setCheckoutEnabled(false);
                    onCheckoutStatus?.('closed');
                    setError(null);
                    return;
                }
                setError(errorCode === 'ACCOUNT_NOT_ELIGIBLE'
                    ? t.accountNotEligible
                    : t.error);
                return;
            }
            if (!response.ok) {
                throw new Error(t.error);
            }
            if (typeof data.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(data.url)) {
                if (!isCurrentAttempt()) return;
                window.location.assign(data.url);
                return;
            }
            throw new Error(t.error);
        } catch (caught) {
            if (!isCurrentAttempt()) return;
            setError(caught instanceof Error && caught.message ? caught.message : t.error);
        } finally {
            if (isCurrentAttempt()) {
                isLoadingRef.current = false;
                setIsLoading(false);
                resetTurnstile();
            }
        }
    };

    const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-12 md:py-20">
            <div
                className="absolute inset-0 bg-black/50"
                aria-hidden="true"
                data-testid="pricing-modal-backdrop"
                onClick={closeModal}
            />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={describedBy}
                aria-busy={isLoading || availabilityState === 'loading'}
                tabIndex={-1}
                data-testid="pricing-modal"
                className="relative z-10 max-h-[calc(100dvh-6rem)] w-full max-w-3xl overflow-y-auto border-2 border-[#006064] bg-white p-6 shadow-[8px_8px_0px_0px_#006064] md:p-8"
                onClick={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    onClick={closeModal}
                    disabled={isLoading}
                    className="absolute right-4 top-4 text-2xl font-bold text-[#006064] hover:opacity-70"
                    aria-label={t.close}
                >
                    <span aria-hidden="true">&times;</span>
                </button>

                <h2 id={titleId} className="pr-10 font-display text-2xl uppercase text-[#006064] md:text-3xl">
                    {plan.displayName}
                </h2>
                <p id={descriptionId} className="mb-6 mt-2 text-sm font-bold leading-6 text-[#006064]/80">
                    {t.title}
                </p>

                <div className="mb-6 grid gap-3 border-2 border-[#006064] bg-[#E0F7FA] p-4 sm:grid-cols-2">
                    <div>
                        <p className="font-mono text-xs uppercase tracking-widest text-[#006064]">{t.total}</p>
                        <p className="font-display text-3xl text-[#006064]">{formatPackagePrice(plan.priceCents, lang)}</p>
                    </div>
                    <div className="text-sm font-bold leading-6 text-[#006064]">
                        <p>{t.sessionBankDisclosure}</p>
                        <p className="mt-1">{t.renewalDisclosure}</p>
                    </div>
                </div>

                {availabilityState === 'loading' && (
                    <div role="status" aria-live="polite" className="border-2 border-[#006064]/30 p-5 text-center font-bold text-[#006064]">
                        {t.availabilityLoading}
                    </div>
                )}

                {availabilityState === 'error' && (
                    <div className="border-2 border-red-500 bg-red-50 p-5 text-center text-red-800">
                        <p role="status" className="font-bold">{t.availabilityError}</p>
                        <button
                            type="button"
                            onClick={() => {
                                setError(null);
                                setAvailabilityRequest((request) => request + 1);
                            }}
                            className="mt-4 border-2 border-red-700 px-4 py-2 text-xs font-bold uppercase"
                        >
                            {t.retryAvailability}
                        </button>
                    </div>
                )}

                {availabilityState === 'empty' && (
                    <div role="status" aria-live="polite" className="border-2 border-[#006064]/30 p-5 text-center font-bold text-[#006064]">
                        {t.availabilityEmpty}
                    </div>
                )}

                {availabilityState === 'ready' && (
                    <fieldset className="space-y-4">
                        <legend className="mb-3 font-display text-2xl uppercase text-[#006064]">{t.slotChoice}</legend>
                        {slots.map((slot) => {
                            const selected = selectedSlotPublicId === slot.publicId;
                            return (
                                <label
                                    key={slot.publicId}
                                    className={`block cursor-pointer border-2 p-4 transition-colors ${selected ? 'border-[#006064] bg-[#E0F7FA]' : 'border-[#006064]/25 hover:border-[#006064]'}`}
                                >
                                    <span className="flex items-start gap-3">
                                        <input
                                            type="radio"
                                            name="bookable-slot"
                                            value={slot.publicId}
                                            checked={selected}
                                            disabled={isLoading}
                                            onChange={() => {
                                                setSelectedSlotPublicId(slot.publicId);
                                                setError(null);
                                                resetTurnstile();
                                            }}
                                            className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block font-display text-2xl text-[#006064]">{slot.teacherName}</span>
                                            <span className="mt-1 block text-sm font-bold text-[#006064]">
                                                {t.weeklyTime}: {formatWeeklyTime(slot, lang)}
                                            </span>
                                            <span className="block text-xs text-[#006064]/75">
                                                {t.timezone}: {slot.timezoneName}
                                            </span>
                                        </span>
                                    </span>

                                    <span className="mt-4 grid gap-3 text-sm text-[#006064] sm:grid-cols-2">
                                        <span>
                                            <strong className="block font-mono text-xs uppercase tracking-wide">{t.firstClass}</strong>
                                            <time dateTime={slot.firstClassAt}>{formatOccurrence(slot.firstClassAt, slot.timezoneName, lang)}</time>
                                        </span>
                                        <span>
                                            <strong className="block font-mono text-xs uppercase tracking-wide">{t.renewalDate}</strong>
                                            <time dateTime={slot.renewalAt}>{formatOccurrence(slot.renewalAt, slot.timezoneName, lang)}</time>
                                        </span>
                                    </span>

                                    <span className="mt-4 block">
                                        <strong className="block font-mono text-xs uppercase tracking-wide text-[#006064]">{t.cycleDates}</strong>
                                        <span className="mt-2 grid gap-2 text-xs text-[#006064] sm:grid-cols-2">
                                            {slot.occurrences.map((occurrence) => (
                                                <time key={occurrence.index} dateTime={occurrence.startsAt} className="border border-[#006064]/20 bg-white px-2 py-1">
                                                    {occurrence.index}. {formatOccurrence(occurrence.startsAt, slot.timezoneName, lang)}
                                                </time>
                                            ))}
                                        </span>
                                    </span>
                                </label>
                            );
                        })}
                    </fieldset>
                )}

                {selectedSlot && !checkoutEnabled && (
                    <div role="status" className="mt-6 border-2 border-[#006064] bg-[#E0F7FA] p-4 text-sm font-bold leading-6 text-[#006064]">
                        {t.checkoutClosed}
                    </div>
                )}

                {selectedSlot && checkoutEnabled && accountState === 'checking' && (
                    <div role="status" aria-live="polite" className="mt-6 border-2 border-[#006064]/30 p-4 text-center text-sm font-bold text-[#006064]">
                        {t.loading}
                    </div>
                )}

                {selectedSlot && checkoutEnabled && accountState === 'login' && (
                    <button
                        type="button"
                        onClick={() => loginWithSelection()}
                        className="mt-6 w-full border-2 border-[#006064] bg-[#006064] py-4 text-sm font-bold uppercase tracking-widest text-white shadow-[4px_4px_0px_0px_#006064] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#004d40] hover:shadow-none"
                    >
                        {t.login}
                    </button>
                )}

                {selectedSlot && checkoutEnabled && accountState === 'error' && (
                    <button
                        type="button"
                        onClick={() => setAccountCheckRequest((request) => request + 1)}
                        className="mt-6 w-full border-2 border-[#006064] py-3 text-xs font-bold uppercase text-[#006064]"
                    >
                        {t.retryAvailability}
                    </button>
                )}

                {selectedSlot && checkoutEnabled && accountState === 'ready' && (
                    <>
                        <div className="mt-6 space-y-3 text-xs leading-5 text-[#006064]/80">
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

                            <label className="flex items-start gap-3">
                                <input
                                    type="checkbox"
                                    checked={withdrawalLossAcknowledged}
                                    onChange={(event) => {
                                        setWithdrawalLossAcknowledged(event.currentTarget.checked);
                                        setError(null);
                                    }}
                                    aria-required="true"
                                    className="mt-1 h-4 w-4 border-2 border-[#006064] text-[#006064] focus:ring-[#006064]/20"
                                />
                                <span>{t.withdrawalLossAcknowledgement}</span>
                            </label>
                        </div>

                        <div className="mt-6" id="checkout-turnstile">
                            <ResponsiveTurnstile
                                ref={turnstileRef}
                                siteKey={import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || turnstileTestingSiteKey}
                                options={{ action: 'checkout_hold', language: lang, size: 'flexible' }}
                                onSuccess={(token: string) => {
                                    setTurnstileToken(token);
                                    setError(null);
                                }}
                                onExpire={() => setTurnstileToken(null)}
                                onError={() => {
                                    setTurnstileToken(null);
                                    setError(t.securityError);
                                }}
                                onTimeout={() => setTurnstileToken(null)}
                                onUnsupported={() => {
                                    setTurnstileToken(null);
                                    setError(t.securityError);
                                }}
                            />
                        </div>
                    </>
                )}

                {error && (
                    <div id={errorId} role="alert" className="mt-4 border-2 border-red-500 bg-red-100 p-3 text-sm font-bold text-red-700">
                        {error}
                    </div>
                )}

                {selectedSlot && checkoutEnabled && accountState === 'ready' && (
                    <button
                        type="button"
                        onClick={handleContinue}
                        disabled={isLoading}
                        aria-busy={isLoading}
                        className={`mt-6 w-full border-2 border-[#006064] py-4 text-sm font-bold uppercase tracking-widest shadow-[4px_4px_0px_0px_#006064] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ${isLoading ? 'cursor-not-allowed bg-gray-400 text-white' : 'bg-[#006064] text-white hover:bg-[#004d40]'}`}
                    >
                        {isLoading ? t.loading : t.continue}
                    </button>
                )}
            </div>
        </div>
    );
}
