import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingSection from '../../src/components/PricingSection';
import { ui } from '../../src/i18n/translations';

// Component coverage for src/components/PricingSection.tsx.
type PricingSectionProps = React.ComponentProps<typeof PricingSection>;
const translations = ui.es.pricing as unknown as PricingSectionProps['translations'];

const targetPackage = {
    id: 'pkg-target',
    name: 'individual_4x50_28d',
    display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 classes' },
    price_monthly: 25900,
    sessions_per_month: 4,
    has_group_session: false,
    has_dual_teacher: false,
    stripe_price_1m: 'price_1m',
    stripe_price_3m: 'price_3m',
    stripe_price_6m: 'price_6m',
};

function renderPricingSection(packages = [targetPackage], props: Partial<PricingSectionProps> = {}) {
    return render(
        <>
            <div id="contacto" />
            <PricingSection
                packages={packages}
                lang="es"
                isLoggedIn={false}
                checkoutMode="unavailable"
                translations={translations}
                {...props}
            />
        </>,
    );
}

describe('PricingSection', () => {
    beforeEach(() => {
        window.history.pushState(null, '', '/es');
        window.sessionStorage.clear();
        Object.defineProperty(Element.prototype, 'scrollIntoView', {
            configurable: true,
            value: vi.fn(),
        });
    });

    afterEach(() => {
        window.sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it('shows a contact recovery path when no packages are available', () => {
        renderPricingSection([]);

        expect(screen.getByRole('status')).toHaveTextContent(translations.modal.contactMessage);
        expect(screen.queryByRole('link', { name: translations.modal.contact })).not.toBeInTheDocument();
    });

    it('renders the package fallback when its key has no translation', () => {
        const packageWithoutTranslation = {
            ...targetPackage,
            id: 'pkg-without-translation',
            name: 'without-translation',
            display_name: {
                es: 'Plan sin traducción',
                en: 'Plan without translation',
                ru: 'Plan without translation',
            },
        };

        renderPricingSection([packageWithoutTranslation]);

        expect(screen.getByRole('heading', { name: 'Plan sin traducción' })).toBeInTheDocument();
        expect(screen.getByTestId('select-plan-without-translation')).toBeDisabled();
    });

    it('shows the exact target contract but keeps its purchase action disabled', () => {
        renderPricingSection();

        expect(screen.getByRole('heading', { name: '4 clases individuales' })).toBeInTheDocument();
        expect(screen.getByText(/259/)).toBeInTheDocument();
        expect(screen.getByText('4 clases individuales por ciclo')).toBeInTheDocument();
        expect(screen.getByText('50 minutos por clase')).toBeInTheDocument();
        expect(screen.getByText('Renovación automática cada 28 días')).toBeInTheDocument();
        expect(screen.getByText('Profesor y franja semanal identificados antes de pagar')).toBeInTheDocument();
        expect(screen.getByText('Garantía tras la primera clase y antes de la segunda')).toBeInTheDocument();
        expect(screen.getByTestId('select-plan-individual_4x50_28d')).toBeDisabled();
    });

    it('opens the checkout modal when direct checkout is enabled and Stripe prices are ready', () => {
        renderPricingSection([targetPackage], {
            checkoutMode: 'checkout',
            isLoggedIn: true,
        });

        fireEvent.click(screen.getByTestId('select-plan-individual_4x50_28d'));

        expect(screen.getByRole('dialog', { name: '4 clases individuales' })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: translations.modal.continue })).toBeInTheDocument();
    });
});
