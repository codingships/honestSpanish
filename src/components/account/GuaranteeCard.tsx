import React, { useEffect, useId, useRef, useState } from 'react';

const guaranteeStatuses = [
    'not_started',
    'eligible',
    'closed',
    'processing',
    'refund_pending',
    'refunded',
    'retryable',
    'manual_review',
] as const;

type GuaranteeStatus = typeof guaranteeStatuses[number];

type Guarantee = {
    subscriptionId: string;
    status: GuaranteeStatus;
    refundAmountCents: number;
    currency: 'eur';
    operationId?: string | null;
    reason?: string | null;
};

type GuaranteeResponse = {
    guarantee?: unknown;
    error?: string;
};

type Lang = 'es' | 'en' | 'ru';

type Props = {
    subscriptionId: string;
    lang: Lang;
};

type GuaranteeCopy = {
    title: string;
    loading: string;
    loadError: string;
    retryLoad: string;
    notStarted: string;
    eligible: string;
    closed: string;
    processing: string;
    refundPending: string;
    refunded: string;
    retryable: string;
    manualReview: string;
    request: string;
    retry: string;
    check: string;
    checking: string;
    submitting: string;
    amountLabel: string;
    support: string;
    reference: string;
    dialogTitle: string;
    dialogIntro: string;
    effects: (amount: string) => string[];
    acknowledge: string;
    confirm: string;
    cancel: string;
    requestError: string;
    invalidResponse: string;
};

const copy: Record<Lang, GuaranteeCopy> = {
    es: {
        title: 'Garantía de la primera clase',
        loading: 'Comprobando tu garantía…',
        loadError: 'No hemos podido comprobar la garantía. No se ha realizado ninguna solicitud.',
        retryLoad: 'Comprobar de nuevo',
        notStarted: 'La garantía estará disponible después de completar la primera clase y antes de comenzar la segunda.',
        eligible: 'Ya puedes solicitar la devolución de las tres clases restantes.',
        closed: 'La ventana de esta garantía está cerrada.',
        processing: 'Tu solicitud se está procesando. No necesitas crear otra.',
        refundPending: 'La devolución está en curso en el medio de pago original.',
        refunded: 'La devolución se ha completado y las futuras renovaciones están canceladas.',
        retryable: 'La solicitud no ha terminado. Puedes reintentar la misma operación con seguridad.',
        manualReview: 'La solicitud necesita revisión del equipo. No crees otra solicitud.',
        request: 'Solicitar devolución',
        retry: 'Reintentar la misma solicitud',
        check: 'Comprobar estado',
        checking: 'Comprobando…',
        submitting: 'Enviando…',
        amountLabel: 'Importe',
        support: 'Contactar con soporte',
        reference: 'Referencia',
        dialogTitle: 'Confirmar devolución',
        dialogIntro: 'Antes de continuar, confirma que entiendes todos los efectos:',
        effects: (amount: string) => [
            `Se devolverán ${amount} al medio de pago original.`,
            'La primera clase permanece pagada.',
            'Las otras tres clases quedarán invalidadas.',
            'Se cancelarán todas las renovaciones futuras.',
            'Esta acción no se puede deshacer.',
        ],
        acknowledge: 'Entiendo y quiero solicitar la devolución.',
        confirm: 'Confirmar devolución',
        cancel: 'Volver',
        requestError: 'No hemos podido confirmar el resultado. Conservamos la misma solicitud para poder comprobarla o reintentarla sin duplicarla.',
        invalidResponse: 'El estado recibido no es válido. No se ha habilitado ninguna operación.',
    },
    en: {
        title: 'First-class guarantee',
        loading: 'Checking your guarantee…',
        loadError: 'We could not check the guarantee. No request has been made.',
        retryLoad: 'Check again',
        notStarted: 'The guarantee will be available after the first class is completed and before the second begins.',
        eligible: 'You can now request a refund for the three remaining classes.',
        closed: 'This guarantee window is closed.',
        processing: 'Your request is being processed. You do not need to create another one.',
        refundPending: 'The refund is in progress to the original payment method.',
        refunded: 'The refund is complete and future renewals have been cancelled.',
        retryable: 'The request has not finished. You can safely retry the same operation.',
        manualReview: 'The request needs review by the team. Do not create another request.',
        request: 'Request refund',
        retry: 'Retry the same request',
        check: 'Check status',
        checking: 'Checking…',
        submitting: 'Sending…',
        amountLabel: 'Amount',
        support: 'Contact support',
        reference: 'Reference',
        dialogTitle: 'Confirm refund',
        dialogIntro: 'Before continuing, confirm that you understand every effect:',
        effects: (amount: string) => [
            `${amount} will be refunded to the original payment method.`,
            'The first class remains paid.',
            'The other three classes will be invalidated.',
            'All future renewals will be cancelled.',
            'This action cannot be undone.',
        ],
        acknowledge: 'I understand and want to request the refund.',
        confirm: 'Confirm refund',
        cancel: 'Go back',
        requestError: 'We could not confirm the result. We kept the same request so you can check or retry it without creating a duplicate.',
        invalidResponse: 'The received status is invalid. No operation has been enabled.',
    },
    ru: {
        title: 'Гарантия после первого занятия',
        loading: 'Проверяем гарантию…',
        loadError: 'Не удалось проверить гарантию. Запрос не был создан.',
        retryLoad: 'Проверить снова',
        notStarted: 'Гарантия станет доступна после завершения первого занятия и до начала второго.',
        eligible: 'Теперь можно запросить возврат за три оставшихся занятия.',
        closed: 'Срок действия этой гарантии завершён.',
        processing: 'Запрос обрабатывается. Создавать новый запрос не нужно.',
        refundPending: 'Возврат на исходный способ оплаты выполняется.',
        refunded: 'Возврат завершён, а будущие продления отменены.',
        retryable: 'Запрос не завершён. Можно безопасно повторить ту же операцию.',
        manualReview: 'Запрос требует проверки командой. Не создавайте новый запрос.',
        request: 'Запросить возврат',
        retry: 'Повторить тот же запрос',
        check: 'Проверить статус',
        checking: 'Проверяем…',
        submitting: 'Отправляем…',
        amountLabel: 'Сумма',
        support: 'Связаться с поддержкой',
        reference: 'Номер обращения',
        dialogTitle: 'Подтвердить возврат',
        dialogIntro: 'Перед продолжением подтвердите, что понимаете все последствия:',
        effects: (amount: string) => [
            `${amount} будут возвращены на исходный способ оплаты.`,
            'Первое занятие остаётся оплаченным.',
            'Остальные три занятия будут аннулированы.',
            'Все будущие продления будут отменены.',
            'Это действие нельзя отменить.',
        ],
        acknowledge: 'Я понимаю последствия и хочу запросить возврат.',
        confirm: 'Подтвердить возврат',
        cancel: 'Вернуться',
        requestError: 'Не удалось подтвердить результат. Мы сохранили тот же запрос, чтобы проверить или повторить его без дублирования.',
        invalidResponse: 'Получен недопустимый статус. Операция не была включена.',
    },
};

function isGuarantee(value: unknown, subscriptionId: string): value is Guarantee {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<Guarantee>;
    return candidate.subscriptionId === subscriptionId
        && guaranteeStatuses.includes(candidate.status as GuaranteeStatus)
        && candidate.refundAmountCents === 19425
        && candidate.currency === 'eur'
        && (candidate.operationId === undefined
            || candidate.operationId === null
            || typeof candidate.operationId === 'string')
        && (candidate.reason === undefined
            || candidate.reason === null
            || typeof candidate.reason === 'string');
}

function storedRequestKey(subscriptionId: string) {
    return `honest-spanish:guarantee:${subscriptionId}:request-id`;
}

function readStoredRequestId(subscriptionId: string): string | null {
    try {
        return window.localStorage.getItem(storedRequestKey(subscriptionId));
    } catch {
        return null;
    }
}

function persistRequestId(subscriptionId: string, requestId: string) {
    try {
        window.localStorage.setItem(storedRequestKey(subscriptionId), requestId);
    } catch {
        // The backend remains authoritative if browser storage is unavailable.
    }
}

function clearStoredRequestId(subscriptionId: string) {
    try {
        window.localStorage.removeItem(storedRequestKey(subscriptionId));
    } catch {
        // Nothing else is required when storage is unavailable.
    }
}

function formatAmount(amountCents: number, currency: 'eur', lang: Lang) {
    return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : lang === 'ru' ? 'ru-RU' : 'en-GB', {
        style: 'currency',
        currency: currency.toUpperCase(),
    }).format(amountCents / 100);
}

function shortReference(operationId: string | null | undefined) {
    if (!operationId) return null;
    const compact = operationId.replace(/[^a-zA-Z0-9]/g, '');
    return compact ? compact.slice(-8).toUpperCase() : null;
}

export default function GuaranteeCard({ subscriptionId, lang }: Props) {
    const t = copy[lang];
    const dialogTitleId = useId();
    const dialogDescriptionId = useId();
    const dialogRef = useRef<HTMLDivElement>(null);
    const acknowledgeRef = useRef<HTMLInputElement>(null);
    const requestButtonRef = useRef<HTMLButtonElement>(null);
    const [guarantee, setGuarantee] = useState<Guarantee | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [requestId, setRequestId] = useState<string | null>(null);
    const [isConfirming, setIsConfirming] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);

    const acceptResponse = (payload: GuaranteeResponse) => {
        if (!isGuarantee(payload.guarantee, subscriptionId)) {
            throw new Error(t.invalidResponse);
        }
        setGuarantee(payload.guarantee);
        if (payload.guarantee.status === 'refunded' || payload.guarantee.status === 'closed') {
            clearStoredRequestId(subscriptionId);
            setRequestId(null);
        }
        return payload.guarantee;
    };

    const loadGuarantee = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/account/guarantee?subscriptionId=${encodeURIComponent(subscriptionId)}`, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            const payload = await response.json().catch(() => ({})) as GuaranteeResponse;
            if (!response.ok && !isGuarantee(payload.guarantee, subscriptionId)) {
                throw new Error(payload.error || t.loadError);
            }
            acceptResponse(payload);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : t.loadError);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        setRequestId(readStoredRequestId(subscriptionId));
        void loadGuarantee();
        // The subscription is the stable identity of this card.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscriptionId]);

    useEffect(() => {
        if (!isConfirming) return;
        acknowledgeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isSubmitting) {
                setIsConfirming(false);
                setAcknowledged(false);
                requestButtonRef.current?.focus();
                return;
            }
            if (event.key === 'Tab' && dialogRef.current) {
                const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                    'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ));
                if (focusable.length === 0) {
                    event.preventDefault();
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                const activeElement = document.activeElement;
                if (event.shiftKey && (activeElement === first || !dialogRef.current.contains(activeElement))) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && (activeElement === last || !dialogRef.current.contains(activeElement))) {
                    event.preventDefault();
                    first.focus();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isConfirming, isSubmitting]);

    const submitRequest = async (existingRequestId?: string | null) => {
        const sameRequestId = existingRequestId
            || requestId
            || guarantee?.operationId
            || crypto.randomUUID();
        persistRequestId(subscriptionId, sameRequestId);
        setRequestId(sameRequestId);
        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/account/guarantee', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ subscriptionId, requestId: sameRequestId }),
            });
            const payload = await response.json().catch(() => ({})) as GuaranteeResponse;
            if (!response.ok && !isGuarantee(payload.guarantee, subscriptionId)) {
                throw new Error(payload.error || t.requestError);
            }
            acceptResponse(payload);
            setIsConfirming(false);
            setAcknowledged(false);
        } catch {
            setError(t.requestError);
            setIsConfirming(false);
            setAcknowledged(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    const amount = formatAmount(
        guarantee?.refundAmountCents ?? 19425,
        guarantee?.currency ?? 'eur',
        lang,
    );
    const statusCopy = guarantee ? {
        not_started: t.notStarted,
        eligible: t.eligible,
        closed: t.closed,
        processing: t.processing,
        refund_pending: t.refundPending,
        refunded: t.refunded,
        retryable: t.retryable,
        manual_review: t.manualReview,
    }[guarantee.status] : null;
    const reference = guarantee?.status === 'manual_review'
        ? shortReference(guarantee.operationId)
        : null;
    const canRetry = guarantee?.status === 'retryable' && Boolean(requestId || guarantee.operationId);
    const canCheck = guarantee?.status === 'processing'
        || guarantee?.status === 'refund_pending'
        || guarantee?.status === 'manual_review'
        || (guarantee?.status === 'retryable' && !canRetry);
    const showRetryAfterUncertainSubmit = Boolean(error && requestId && guarantee?.status === 'eligible');

    return (
        <section
            aria-labelledby={`${dialogTitleId}-card`}
            className="border-2 border-[#006064] bg-white p-6 shadow-[4px_4px_0px_0px_#006064]"
        >
            <h2 id={`${dialogTitleId}-card`} className="mb-4 font-display text-xl uppercase text-[#006064]">
                {t.title}
            </h2>

            {isLoading && !guarantee ? (
                <p role="status" className="font-mono text-sm text-[#006064]/70">{t.loading}</p>
            ) : (
                <div className="space-y-4">
                    {guarantee && (
                        <>
                            <p role="status" aria-live="polite" className="text-sm leading-6 text-[#006064]/80">
                                {statusCopy}
                            </p>
                            <p className="font-mono text-sm text-[#006064]">
                                <span className="font-bold">{t.amountLabel}:</span> {amount}
                            </p>
                            {reference && (
                                <p className="font-mono text-xs text-[#006064]/70">
                                    {t.reference}: {reference}
                                </p>
                            )}
                        </>
                    )}

                    {error && (
                        <p role="alert" className="border-2 border-red-500 bg-red-50 p-3 text-sm text-red-700">
                            {error}
                        </p>
                    )}

                    <div className="flex flex-wrap gap-3">
                        {guarantee?.status === 'eligible' && !showRetryAfterUncertainSubmit && (
                            <button
                                ref={requestButtonRef}
                                type="button"
                                onClick={() => setIsConfirming(true)}
                                disabled={isSubmitting}
                                className="border-2 border-[#006064] bg-[#006064] px-4 py-3 text-sm font-bold uppercase text-white hover:bg-[#004d40] disabled:opacity-50"
                            >
                                {t.request}
                            </button>
                        )}
                        {(canRetry || showRetryAfterUncertainSubmit) && (
                            <button
                                type="button"
                                onClick={() => void submitRequest(requestId || guarantee?.operationId)}
                                disabled={isSubmitting}
                                aria-busy={isSubmitting}
                                className="border-2 border-[#006064] bg-[#006064] px-4 py-3 text-sm font-bold uppercase text-white hover:bg-[#004d40] disabled:opacity-50"
                            >
                                {isSubmitting ? t.submitting : t.retry}
                            </button>
                        )}
                        {(canCheck || (!guarantee && error)) && (
                            <button
                                type="button"
                                onClick={() => void loadGuarantee()}
                                disabled={isLoading || isSubmitting}
                                aria-busy={isLoading}
                                className="border-2 border-[#006064] bg-white px-4 py-3 text-sm font-bold uppercase text-[#006064] hover:bg-[#E0F7FA] disabled:opacity-50"
                            >
                                {isLoading ? t.checking : (guarantee ? t.check : t.retryLoad)}
                            </button>
                        )}
                        {guarantee?.status === 'manual_review' && (
                            <a
                                href={`/${lang}/campus/support`}
                                className="border-2 border-[#006064] bg-white px-4 py-3 text-sm font-bold uppercase text-[#006064] hover:bg-[#E0F7FA]"
                            >
                                {t.support}
                            </a>
                        )}
                    </div>
                </div>
            )}

            {isConfirming && guarantee?.status === 'eligible' && (
                <div
                    ref={dialogRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={dialogTitleId}
                    aria-describedby={dialogDescriptionId}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
                >
                    <div className="w-full max-w-lg border-2 border-[#006064] bg-white p-6 shadow-[6px_6px_0px_0px_#006064]">
                        <h3 id={dialogTitleId} className="font-display text-2xl uppercase text-[#006064]">
                            {t.dialogTitle}
                        </h3>
                        <p id={dialogDescriptionId} className="mt-3 text-sm text-[#006064]/80">
                            {t.dialogIntro}
                        </p>
                        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[#006064]">
                            {t.effects(amount).map((effect) => <li key={effect}>{effect}</li>)}
                        </ul>
                        <label className="mt-5 flex items-start gap-3 text-sm font-bold text-[#006064]">
                            <input
                                ref={acknowledgeRef}
                                type="checkbox"
                                checked={acknowledged}
                                onChange={(event) => setAcknowledged(event.target.checked)}
                                disabled={isSubmitting}
                                className="mt-1 h-4 w-4"
                            />
                            <span>{t.acknowledge}</span>
                        </label>
                        <div className="mt-6 flex flex-wrap justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setIsConfirming(false);
                                    setAcknowledged(false);
                                    requestButtonRef.current?.focus();
                                }}
                                disabled={isSubmitting}
                                className="border-2 border-[#006064] bg-white px-4 py-3 text-sm font-bold uppercase text-[#006064] disabled:opacity-50"
                            >
                                {t.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={() => void submitRequest()}
                                disabled={!acknowledged || isSubmitting}
                                aria-busy={isSubmitting}
                                className="border-2 border-red-700 bg-red-700 px-4 py-3 text-sm font-bold uppercase text-white disabled:opacity-50"
                            >
                                {isSubmitting ? t.submitting : t.confirm}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
