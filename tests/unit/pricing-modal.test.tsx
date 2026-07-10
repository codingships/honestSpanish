import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingModal from '../../src/components/PricingModal';

const translations = {
    title: 'Elige duracion',
    duration1: '1 mes',
    duration3: '3 meses',
    duration6: '6 meses',
    save: 'Ahorras',
    total: 'Total',
    perMonth: 'al mes',
    continue: 'Continuar',
    login: 'Inicia sesion para continuar',
    loading: 'Procesando...',
    error: 'No se pudo continuar.',
    close: 'Cerrar',
    contact: 'Contactar',
    contactMessage: 'Antes de pagar confirmamos encaje.',
    adultConfirmation: 'Confirmo que tengo 18 años o más.',
    termsAcceptance: 'He leído y acepto los',
    termsLink: 'Términos',
    and: 'y la',
    privacyLink: 'Política de Privacidad',
    serviceStartRequest: 'Solicito que el servicio pueda comenzar durante los 14 días de desistimiento.',
    withdrawalLossAcknowledgement: 'Reconozco que perderé el derecho de desistimiento tras la ejecución íntegra.',
    policyError: 'Debes confirmar las condiciones.',
};

const plan = {
    name: 'hybrid',
    displayName: 'Plan Hybrid',
    priceMonthly: 240,
    stripe_price_1m: 'price_1m',
    stripe_price_3m: 'price_3m',
    stripe_price_6m: 'price_6m',
};

const deferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const renderModal = (props: Partial<React.ComponentProps<typeof PricingModal>> = {}) => render(
    <>
        <button type="button">Before modal</button>
        <PricingModal
            isOpen
            onClose={vi.fn()}
            plan={plan}
            lang="es"
            isLoggedIn
            translations={translations}
            {...props}
        />
    </>,
);

const acceptCheckoutPolicies = () => {
    fireEvent.click(screen.getByRole('checkbox', { name: translations.adultConfirmation }));
    fireEvent.click(screen.getByRole('checkbox', { name: /He leído y acepto los/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: translations.serviceStartRequest }));
    fireEvent.click(screen.getByRole('checkbox', { name: translations.withdrawalLossAcknowledgement }));
};

describe('PricingModal', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        document.body.style.overflow = '';
    });

    it('renders a labelled checkout dialog with keyboard close semantics', async () => {
        const onClose = vi.fn();
        renderModal({ onClose });

        const dialog = screen.getByRole('dialog', { name: 'Plan Hybrid' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-busy', 'false');
        expect(dialog).toHaveAccessibleDescription(translations.title);
        await waitFor(() => expect(dialog).toHaveFocus());

        expect(screen.getByRole('button', { name: translations.close })).toHaveAttribute('type', 'button');
        expect(screen.getByRole('group', { name: translations.title })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /1 mes/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText(`240\u20ac`)).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('\u00c3');
        expect(document.body).not.toHaveTextContent('\u00e2');

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows a recoverable contact error when the selected duration has no Stripe price', () => {
        renderModal({
            plan: {
                ...plan,
                stripe_price_3m: null,
            },
        });

        fireEvent.click(screen.getByRole('button', { name: /3 meses/i }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(translations.contactMessage);

        fireEvent.click(screen.getByRole('button', { name: /1 mes/i }));

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('submits the selected checkout price and reports a missing checkout URL', async () => {
        const checkout = deferred<Response>();
        const fetchMock = vi.fn(() => checkout.promise);
        vi.stubGlobal('fetch', fetchMock);
        renderModal();

        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: /6 meses/i }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock).toHaveBeenCalledWith('/api/create-checkout', expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        }));
        const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(String(requestInit.body))).toEqual({
            priceId: 'price_6m',
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
        });
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: translations.loading })).toHaveAttribute('aria-busy', 'true');

        await act(async () => {
            checkout.resolve(Response.json({}));
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.error);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
    });

    it('keeps checkout API failures user-readable when the response is not JSON', async () => {
        const fetchMock = vi.fn(() => Promise.resolve(new Response('server unavailable', { status: 503 })));
        vi.stubGlobal('fetch', fetchMock);
        renderModal();

        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.error);
    });

    it('does not call checkout until all policy confirmations are accepted', () => {
        renderModal();

        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(translations.policyError);
    });

    it('requires the separate acknowledgement of withdrawal loss after full performance', () => {
        renderModal();

        fireEvent.click(screen.getByRole('checkbox', { name: translations.adultConfirmation }));
        fireEvent.click(screen.getByRole('checkbox', { name: /He leído y acepto los/i }));
        fireEvent.click(screen.getByRole('checkbox', { name: translations.serviceStartRequest }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent(translations.policyError);
    });
});
