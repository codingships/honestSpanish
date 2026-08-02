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
const responseQueues = new Map<string, Array<Response | Promise<Response>>>();

function availabilityResponse(slots = [slot], checkoutEnabled = true): Response {
    return Response.json({ slots, checkoutEnabled });
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

function queueResponse(url: string, response: Response | Promise<Response>) {
    const queue = responseQueues.get(url) ?? [];
    queue.push(response);
    responseQueues.set(url, queue);
}

async function acceptCheckoutPolicies() {
    await screen.findByRole('checkbox', { name: translations.adultConfirmation });
    fireEvent.click(screen.getByRole('checkbox', { name: translations.adultConfirmation }));
    fireEvent.click(screen.getByRole('checkbox', { name: /He leído y acepto los/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: translations.serviceStartRequest }));
    fireEvent.click(screen.getByRole('checkbox', { name: translations.withdrawalLossAcknowledgement }));
}

describe('PricingModal', () => {
    beforeEach(() => {
        window.history.pushState(null, '', '/es?utm_source=google&utm_campaign=first_students');
        responseQueues.clear();
        fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
            const queued = responseQueues.get(url)?.shift();
            if (queued) return queued;
            if (url === '/api/bookable-slots') return availabilityResponse();
            if (url === '/api/auth/checkout-readiness') return new Response(null, { status: 204 });
            if (url === '/api/create-checkout') return Response.json({});
            throw new Error(`Unexpected fetch: ${url}`);
        });
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
        queueResponse('/api/bookable-slots', availabilityResponse([slot], false));
        renderModal();

        await selectSlot();

        expect(screen.getByRole('status')).toHaveTextContent(translations.checkoutClosed);
        expect(screen.queryByRole('button', { name: translations.continue })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: translations.login })).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('submits only the selected slot, policy evidence and Turnstile token', async () => {
        queueResponse('/api/create-checkout', Response.json({}));
        renderModal();

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        turnstile.reset.mockClear();
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        const [url, init] = fetchMock.mock.calls[2] as [string, RequestInit];
        expect(url).toBe('/api/create-checkout');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({
            slotPublicId,
            lang: 'es',
            policyVersion: '2026-08-01',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
            attribution: expect.objectContaining({
                landingPath: '/es',
                entryLanguage: 'es',
                utmSource: 'google',
                utmCampaign: 'first_students',
            }),
            'cf-turnstile-response': 'verified-turnstile-token',
        });
        expect(JSON.parse(String(init.body))).not.toHaveProperty('priceId');
        expect(await screen.findByRole('alert')).toHaveTextContent(translations.error);
        expect(turnstile.reset).toHaveBeenCalled();
    });

    it('requires an account before rendering checkout policies or Turnstile', async () => {
        const onLoginRequired = vi.fn();
        queueResponse('/api/auth/checkout-readiness', Response.json({}, { status: 401 }));
        renderModal({ onLoginRequired });

        await selectSlot();
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Solve security check' })).not.toBeInTheDocument();
        fireEvent.click(await screen.findByRole('button', { name: translations.login }));

        await waitFor(() => expect(onLoginRequired).toHaveBeenCalledTimes(1));
        const loginUrl = new URL(onLoginRequired.mock.calls[0]![0], 'https://espanolhonesto.com');
        const returnTo = new URL(loginUrl.searchParams.get('returnTo')!, 'https://espanolhonesto.com');
        expect(loginUrl.pathname).toBe('/es/login');
        expect(returnTo.pathname).toBe('/es');
        expect(returnTo.searchParams.get('checkoutSlot')).toBe(slotPublicId);
        expect(returnTo.searchParams.get('utm_source')).toBeNull();
        expect(returnTo.searchParams.get('attrUtmSource')).toBe('google');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('recovers the final checkout 401 if the session expires after readiness', async () => {
        const onLoginRequired = vi.fn();
        queueResponse('/api/create-checkout', Response.json({}, { status: 401 }));
        renderModal({ onLoginRequired });

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(onLoginRequired).toHaveBeenCalledTimes(1));
        expect(onLoginRequired.mock.calls[0]![0]).toContain(`checkoutSlot%3D${slotPublicId}`);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('retries a transient account check without losing the selected place', async () => {
        queueResponse('/api/auth/checkout-readiness', Response.json(
            { errorCode: 'ACCOUNT_CHECK_UNAVAILABLE' },
            { status: 503 },
        ));
        queueResponse('/api/auth/checkout-readiness', new Response(null, { status: 204 }));
        renderModal();

        await selectSlot();
        expect(await screen.findByRole('alert')).toHaveTextContent(translations.error);
        expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: translations.retryAvailability }));

        expect(await screen.findByRole('checkbox', { name: translations.adultConfirmation })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: /Álex/i })).toBeChecked();
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('ignores an account response for a place that is no longer selected', async () => {
        const secondSlot = {
            ...slot,
            publicId: '22222222-2222-4222-8222-222222222222',
            teacherName: 'Irene',
        };
        let resolveFirstReadiness!: (response: Response) => void;
        const firstReadiness = new Promise<Response>((resolve) => {
            resolveFirstReadiness = resolve;
        });
        queueResponse('/api/bookable-slots', availabilityResponse([slot, secondSlot]));
        queueResponse('/api/auth/checkout-readiness', firstReadiness);
        queueResponse('/api/auth/checkout-readiness', new Response(null, { status: 204 }));
        renderModal();

        fireEvent.click(await screen.findByRole('radio', { name: /Álex/i }));
        fireEvent.click(screen.getByRole('radio', { name: /Irene/i }));
        expect(await screen.findByRole('checkbox', { name: translations.adultConfirmation })).toBeInTheDocument();

        resolveFirstReadiness(Response.json({}, { status: 401 }));
        await waitFor(() => expect(screen.queryByRole('button', { name: translations.login })).not.toBeInTheDocument());
        expect(screen.getByRole('radio', { name: /Irene/i })).toBeChecked();
    });

    it('clears legal evidence when the server rejects a stale terms version', async () => {
        queueResponse('/api/create-checkout', Response.json(
            { errorCode: 'POLICY_VERSION_CHANGED' },
            { status: 409 },
        ));
        renderModal();

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.policyChanged);
        expect(screen.getAllByRole('checkbox')).toHaveLength(4);
        for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
        expect(turnstile.reset).toHaveBeenCalled();
    });

    it('downgrades stale open state when checkout authoritatively closes', async () => {
        const onCheckoutStatus = vi.fn();
        queueResponse('/api/create-checkout', Response.json({ errorCode: 'CHECKOUT_DISABLED' }, { status: 403 }));
        renderModal({ onCheckoutStatus });

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('status')).toHaveTextContent(translations.checkoutClosed);
        expect(screen.queryByRole('button', { name: translations.continue })).not.toBeInTheDocument();
        expect(onCheckoutStatus).toHaveBeenLastCalledWith('closed');
    });

    it('refuses checkout until the security challenge has succeeded', async () => {
        renderModal();

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('alert')).toHaveTextContent(translations.securityError);
    });

    it('refreshes availability and removes a slot rejected with a conflict', async () => {
        queueResponse('/api/create-checkout', Response.json({ errorCode: 'SLOT_UNAVAILABLE' }, { status: 409 }));
        renderModal();

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(await screen.findByText(translations.availabilityEmpty)).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(translations.slotConflict);
    });

    it('does not refresh availability for a non-slot checkout conflict', async () => {
        queueResponse('/api/create-checkout', Response.json({
            error: 'server wording must never be rendered',
            errorCode: 'ACTIVE_SUBSCRIPTION',
        }, { status: 409 }));
        renderModal();

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.activeSubscription);
        expect(screen.getByRole('alert')).not.toHaveTextContent('server wording');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(screen.getByRole('radio', { name: /Álex/i })).toBeChecked();
    });

    it('localizes a Stripe Customer discount conflict without exposing server wording', async () => {
        queueResponse('/api/create-checkout', Response.json({
            error: 'The Stripe Customer has a discount that changes this purchase',
            errorCode: 'CUSTOMER_DISCOUNT_CONFLICT',
        }, { status: 409 }));
        renderModal();

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('alert')).toHaveTextContent(translations.paymentAccountConflict);
        expect(screen.getByRole('alert')).not.toHaveTextContent('Stripe Customer');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(screen.getByRole('radio', { name: /Álex/i })).toBeChecked();
    });

    it('cannot close while checkout creation is unresolved', async () => {
        let resolveCheckout!: (response: Response) => void;
        const pendingCheckout = new Promise<Response>((resolve) => {
            resolveCheckout = resolve;
        });
        queueResponse('/api/create-checkout', pendingCheckout);
        const onClose = vi.fn();
        renderModal({ onClose });

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
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
        queueResponse('/api/create-checkout', pendingCheckout);
        const stableProps = {
            onClose: vi.fn(),
            plan,
            lang: 'es' as const,
            translations,
        };
        const rendered = render(<PricingModal isOpen {...stableProps} />);

        await selectSlot();
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

        rendered.rerender(<PricingModal isOpen={false} {...stableProps} />);
        rendered.rerender(<PricingModal isOpen {...stableProps} />);
        expect(await screen.findByRole('radio', { name: /Álex/i })).not.toBeChecked();

        resolveCheckout(Response.json({ errorCode: 'ACTIVE_SUBSCRIPTION' }, { status: 409 }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: translations.close })).not.toBeDisabled();
    });

    it('fails closed on malformed availability and provides a retry', async () => {
        queueResponse('/api/bookable-slots', availabilityResponse([{
            ...slot,
            occurrences: slot.occurrences.map((occurrence) => ({ ...occurrence, durationMinutes: 40 })),
        }]));
        queueResponse('/api/bookable-slots', availabilityResponse());
        renderModal();

        expect(await screen.findByRole('button', { name: translations.retryAvailability })).toBeInTheDocument();
        expect(screen.queryByRole('radio')).not.toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByText(translations.checkoutClosed)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: translations.retryAvailability }));

        expect(await screen.findByRole('radio', { name: /Álex/i })).toBeInTheDocument();
    });

    it('keeps checkout status unknown when availability is unavailable', async () => {
        const onCheckoutStatus = vi.fn();
        queueResponse('/api/bookable-slots', Response.json(
            { error: 'Availability is temporarily unavailable' },
            { status: 503 },
        ));
        renderModal({ onCheckoutStatus });

        expect(await screen.findByRole('button', { name: translations.retryAvailability })).toBeInTheDocument();
        expect(screen.queryByText(translations.checkoutClosed)).not.toBeInTheDocument();
        expect(onCheckoutStatus).toHaveBeenLastCalledWith('unknown');
    });

    it('resets an authoritative open status to unknown when the modal closes', async () => {
        const onCheckoutStatus = vi.fn();
        const stableProps = {
            onClose: vi.fn(),
            plan,
            lang: 'es' as const,
            onCheckoutStatus,
            translations,
        };
        const rendered = render(<PricingModal isOpen {...stableProps} />);

        await screen.findByRole('radio', { name: /Álex/i });
        expect(onCheckoutStatus).toHaveBeenLastCalledWith('open');

        rendered.rerender(<PricingModal isOpen={false} {...stableProps} />);

        await waitFor(() => expect(onCheckoutStatus).toHaveBeenLastCalledWith('unknown'));
    });

    it('returns an authoritative open status to unknown when revalidation fails', async () => {
        const onCheckoutStatus = vi.fn();
        queueResponse('/api/bookable-slots', availabilityResponse());
        queueResponse('/api/bookable-slots', Response.json(
            { error: 'Availability is temporarily unavailable' },
            { status: 503 },
        ));
        queueResponse('/api/create-checkout', Response.json(
            { errorCode: 'SLOT_UNAVAILABLE' },
            { status: 409 },
        ));
        renderModal({ onCheckoutStatus });

        await selectSlot();
        expect(onCheckoutStatus).toHaveBeenLastCalledWith('open');
        await acceptCheckoutPolicies();
        fireEvent.click(screen.getByRole('button', { name: 'Solve security check' }));
        fireEvent.click(screen.getByRole('button', { name: translations.continue }));

        expect(await screen.findByRole('button', { name: translations.retryAvailability })).toBeInTheDocument();
        expect(onCheckoutStatus).toHaveBeenLastCalledWith('unknown');
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
