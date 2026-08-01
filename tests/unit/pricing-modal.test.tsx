import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingModal, { type PricingModalTranslations } from '../../src/components/PricingModal';
import { ui } from '../../src/i18n/translations';
import { buildCheckoutLoginUrl } from '../../src/lib/public-checkout-ui';

const turnstile = vi.hoisted(() => ({ reset: vi.fn() }));

vi.mock('@marsidev/react-turnstile', async () => {
    const ReactModule = await import('react');
    const MockTurnstile = ReactModule.forwardRef((props: {
        onSuccess?: (token: string) => void;
    }, ref) => {
        ReactModule.useImperativeHandle(ref, () => ({ reset: turnstile.reset }));
        return ReactModule.createElement('button', {
            type: 'button',
            onClick: () => props.onSuccess?.('verified-turnstile-token'),
        }, 'Solve security check');
    });
    MockTurnstile.displayName = 'MockTurnstile';
    return { Turnstile: MockTurnstile };
});

const translations = ui.es.pricing.modal as PricingModalTranslations;
const slotPublicId = '11111111-1111-4111-8111-111111111111';
const slot = {
    publicId: slotPublicId,
    teacherName: 'Álex',
    weekday: 1,
    localStartTime: '18:00:00',
    timezoneName: 'Europe/Madrid',
    firstClassAt: '2035-01-08T17:00:00.000Z',
    renewalAt: '2035-02-05T17:00:00.000Z',
    occurrences: [
        { index: 1, startsAt: '2035-01-08T17:00:00.000Z', durationMinutes: 50 },
        { index: 2, startsAt: '2035-01-15T17:00:00.000Z', durationMinutes: 50 },
        { index: 3, startsAt: '2035-01-22T17:00:00.000Z', durationMinutes: 50 },
        { index: 4, startsAt: '2035-01-29T17:00:00.000Z', durationMinutes: 50 },
    ],
};
const plan = {
    name: 'individual_4x50_28d',
    displayName: '4 clases individuales',
    priceCents: 25900,
    sessionsPerCycle: 4,
};

let fetchMock: ReturnType<typeof vi.fn>;

function availabilityResponse(slots = [slot]): Response {
    return Response.json({ slots });
}

function renderModal(props: Partial<React.ComponentProps<typeof PricingModal>> = {}) {
    return render(
        <>
            <button type="button">Before modal</button>
            <PricingModal
                isOpen
                onClose={vi.fn()}
                plan={plan}
                lang="es"
                isLoggedIn
                checkoutEnabled
                translations={translations}
                {...props}
            />
        </>,
    );
}

async function selectSlot() {
    const radio = await screen.findByRole('radio', { name: /Álex/i });
    fireEvent.click(radio);
    return radio;
}

function acceptCheckoutPolicies() {
    fireEvent.click(screen.getByRole('checkbox', { name: translations.adultConfirmation }));
    fireEvent.click(screen.getByRole('checkbox', { name: /He leído y acepto los/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: translations.serviceStartRequest }));
    fireEvent.click(screen.getByRole('checkbox', { name: translations.withdrawalLossAcknowledgement }));
}

describe('PricingModal', () => {
    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue(availabilityResponse());
        vi.stubGlobal('fetch', fetchMock);
        turnstile.reset.mockClear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.classList.remove('overflow-hidden');
    });

    it('loads only the capacity-backed offer and renders its complete schedule', async () => {
        renderModal();

        const dialog = screen.getByRole('dialog', { name: plan.displayName });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAccessibleDescription(translations.title);
        const closeButton = screen.getByRole('button', { name: translations.close });
        await waitFor(() => expect(closeButton).toHaveFocus());

        const radio = await screen.findByRole('radio', { name: /Álex/i });
        expect(radio).not.toBeChecked();
        expect(screen.getByText(/Europe\/Madrid/)).toBeInTheDocument();
        expect(document.querySelectorAll('time')).toHaveLength(6);
        expect(document.body).toHaveTextContent('259');
        expect(document.body).not.toHaveTextContent('3 meses');
        expect(document.body).not.toHaveTextContent('6 meses');
        expect(fetchMock).toHaveBeenCalledWith('/api/bookable-slots', expect.objectContaining({
            method: 'GET',
            cache: 'no-store',
        }));

        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(radio).toHaveFocus();
    });

    it('keeps real availability inspectable while closed and never calls checkout', async () => {
        renderModal({ checkoutEnabled: false });

        await selectSlot();

        expect(screen.getByRole('status')).toHaveTextContent(translations.checkoutClosed);
        expect(screen.queryByRole('button', { name: translations.continue })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: translations.login })).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('submits only the selected slot, policy evidence and Turnstile token', async () => {
        fetchMock
            .mockResolvedValueOnce(availabilityResponse())
            .mockResolvedValueOnce(Response.json({}));
        renderModal();

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        turnstile.reset.mockClear();
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
        expect(url).toBe('/api/create-checkout');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({
            slotPublicId,
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
            'cf-turnstile-response': 'verified-turnstile-token',
        });
        expect(JSON.parse(String(init.body))).not.toHaveProperty('priceId');
        expect(await screen.findByRole('alert')).toHaveTextContent(translations.error);
        expect(turnstile.reset).toHaveBeenCalled();
    });

    it('refuses checkout until the security challenge has succeeded', async () => {
        renderModal();

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('alert')).toHaveTextContent(translations.securityError);
    });

    it('refreshes availability and removes a slot rejected with a conflict', async () => {
        fetchMock
            .mockResolvedValueOnce(availabilityResponse())
            .mockResolvedValueOnce(Response.json({ errorCode: 'SLOT_UNAVAILABLE' }, { status: 409 }))
            // A five-second upstream micro-cache may still echo the rejected
            // slot; this modal session must not offer it again.
            .mockResolvedValueOnce(availabilityResponse());
        renderModal();

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(await screen.findByText(translations.availabilityEmpty)).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(translations.slotConflict);
    });

    it('does not refresh availability for a non-slot checkout conflict', async () => {
        fetchMock
            .mockResolvedValueOnce(availabilityResponse())
            .mockResolvedValueOnce(Response.json({
                error: 'server wording must never be rendered',
                errorCode: 'ACTIVE_SUBSCRIPTION',
            }, { status: 409 }));
        renderModal();

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.activeSubscription);
        expect(screen.getByRole('alert')).not.toHaveTextContent('server wording');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('radio', { name: /Álex/i })).toBeChecked();
    });

    it('localizes a Stripe Customer discount conflict without exposing server wording', async () => {
        fetchMock
            .mockResolvedValueOnce(availabilityResponse())
            .mockResolvedValueOnce(Response.json({
                error: 'The Stripe Customer has a discount that changes this purchase',
                errorCode: 'CUSTOMER_DISCOUNT_CONFLICT',
            }, { status: 409 }));
        renderModal();

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.paymentAccountConflict);
        expect(screen.getByRole('alert')).not.toHaveTextContent('Stripe Customer');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('radio', { name: /Álex/i })).toBeChecked();
    });

    it('cannot close while checkout creation is unresolved', async () => {
        let resolveCheckout!: (response: Response) => void;
        const pendingCheckout = new Promise<Response>((resolve) => {
            resolveCheckout = resolve;
        });
        fetchMock
            .mockResolvedValueOnce(availabilityResponse())
            .mockImplementationOnce(() => pendingCheckout);
        const onClose = vi.fn();
        renderModal({ onClose });

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        const closeButton = screen.getByRole('button', { name: translations.close });
        expect(closeButton).toBeDisabled();
        fireEvent.click(closeButton);
        fireEvent.click(screen.getByTestId('pricing-modal-backdrop'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();

        resolveCheckout(Response.json({ errorCode: 'CHECKOUT_IN_PROGRESS' }, { status: 409 }));
        expect(await screen.findByRole('alert')).toHaveTextContent(translations.checkoutInProgress);
        await waitFor(() => expect(closeButton).not.toBeDisabled());

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('ignores a checkout response from an earlier modal session', async () => {
        let resolveCheckout!: (response: Response) => void;
        const pendingCheckout = new Promise<Response>((resolve) => {
            resolveCheckout = resolve;
        });
        fetchMock
            .mockResolvedValueOnce(availabilityResponse())
            .mockImplementationOnce(() => pendingCheckout)
            .mockResolvedValueOnce(availabilityResponse());
        const stableProps = {
            onClose: vi.fn(),
            plan,
            lang: 'es' as const,
            isLoggedIn: true,
            checkoutEnabled: true,
            translations,
        };
        const rendered = render(<PricingModal isOpen {...stableProps} />);

        await selectSlot();
        acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        rendered.rerender(<PricingModal isOpen={false} {...stableProps} />);
        rendered.rerender(<PricingModal isOpen {...stableProps} />);
        expect(await screen.findByRole('radio', { name: /Álex/i })).not.toBeChecked();

        resolveCheckout(Response.json({ errorCode: 'ACTIVE_SUBSCRIPTION' }, { status: 409 }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: translations.close })).not.toBeDisabled();
    });

    it('fails closed on malformed availability and provides a retry', async () => {
        fetchMock
            .mockResolvedValueOnce(availabilityResponse([{
                ...slot,
                occurrences: slot.occurrences.map((occurrence) => ({ ...occurrence, durationMinutes: 40 })),
            }]))
            .mockResolvedValueOnce(availabilityResponse());
        renderModal();

        expect(await screen.findByRole('button', { name: translations.retryAvailability })).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: translations.retryAvailability }));

        expect(await screen.findByRole('radio', { name: /Álex/i })).toBeInTheDocument();
    });

    it('builds a localized, internal login return for the selected public slot', () => {
        expect(buildCheckoutLoginUrl('en', slotPublicId)).toBe(
            `/en/login?returnTo=${encodeURIComponent(`/en?checkoutSlot=${slotPublicId}#planes`)}`,
        );
    });

    it('closes with Escape and restores the previous focus', async () => {
        const onClose = vi.fn();
        renderModal({ onClose });

        await waitFor(() => expect(screen.getByRole('button', { name: translations.close })).toHaveFocus());
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
