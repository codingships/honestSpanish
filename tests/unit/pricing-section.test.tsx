import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingSection from '../../src/components/PricingSection';
import { ui } from '../../src/i18n/translations';

type PricingSectionProps = React.ComponentProps<typeof PricingSection>;
const translations = ui.es.pricing as unknown as PricingSectionProps['translations'];
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
const targetPackage = {
    id: 'pkg-target',
    name: 'individual_4x50_28d',
    display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 classes' },
    price_monthly: 25900,
    sessions_per_month: 4,
    has_group_session: false,
    has_dual_teacher: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

function renderPricingSection(packages = [targetPackage], props: Partial<PricingSectionProps> = {}) {
    return render(
        <PricingSection
            packages={packages}
            lang="es"
            isLoggedIn={false}
            checkoutMode="unavailable"
            translations={translations}
            {...props}
        />,
    );
}

describe('PricingSection', () => {
    beforeEach(() => {
        window.history.pushState(null, '', '/es');
        fetchMock = vi.fn().mockResolvedValue(Response.json({ slots: [slot] }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.classList.remove('overflow-hidden');
    });

    it('shows a safe recovery state when the public offer is unavailable', () => {
        renderPricingSection([]);

        expect(screen.getByRole('status')).toHaveTextContent(translations.modal.contactMessage!);
        expect(screen.queryByRole('button', { name: translations.modal.viewAvailability! })).not.toBeInTheDocument();
    });

    it('renders the exact launch contract without any legacy Stripe price requirement', () => {
        renderPricingSection();

        expect(screen.getByRole('heading', { name: '4 clases individuales' })).toBeInTheDocument();
        expect(screen.getByText(/259/)).toBeInTheDocument();
        expect(screen.getByText('4 clases individuales por ciclo')).toBeInTheDocument();
        expect(screen.getByText('50 minutos por clase')).toBeInTheDocument();
        expect(screen.getByText('Renovación automática cada 28 días')).toBeInTheDocument();
        expect(screen.getByText('Profesor y franja semanal identificados antes de pagar')).toBeInTheDocument();
        expect(screen.getByText('Garantía tras la primera clase y antes de la segunda')).toBeInTheDocument();
        expect(screen.getByTestId('select-plan-individual_4x50_28d')).toBeEnabled();
        expect(screen.getByTestId('select-plan-individual_4x50_28d')).toHaveTextContent(translations.modal.viewAvailability!);
    });

    it('opens real availability while checkout is closed and cannot POST', async () => {
        renderPricingSection();

        fireEvent.click(screen.getByTestId('select-plan-individual_4x50_28d'));
        fireEvent.click(await screen.findByRole('radio', { name: /Álex/i }));

        expect(screen.getByRole('dialog', { name: '4 clases individuales' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(translations.modal.checkoutClosed!);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reopens a returned selection only after revalidating it against current availability', async () => {
        window.history.replaceState(null, '', `/es?checkoutSlot=${slotPublicId}#planes`);
        renderPricingSection([targetPackage], { checkoutMode: 'checkout' });

        const selected = await screen.findByRole('radio', { name: /Álex/i });
        await waitFor(() => expect(selected).toBeChecked());
        expect(screen.getByRole('button', { name: translations.modal.login! })).toBeInTheDocument();
        expect(window.location.pathname).toBe('/es');
        expect(window.location.search).toBe('');
        expect(window.location.hash).toBe('#planes');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('discards an invalid returned slot without opening the modal', () => {
        window.history.replaceState(null, '', '/es?checkoutSlot=not-a-slot#planes');
        renderPricingSection();

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(window.location.search).toBe('');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preserves a valid returned slot when the offer failed to load', () => {
        window.history.replaceState(null, '', `/es?checkoutSlot=${slotPublicId}#planes`);
        renderPricingSection([]);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(window.location.search).toBe(`?checkoutSlot=${slotPublicId}`);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
