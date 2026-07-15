import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PricingSection from '../../src/components/PricingSection';
import { ui } from '../../src/i18n/translations';

// Component coverage for src/components/PricingSection.tsx.
type PricingSectionProps = React.ComponentProps<typeof PricingSection>;
const translations = ui.es.pricing as unknown as PricingSectionProps['translations'];

const hybridPackage = {
    id: 'pkg-hybrid',
    name: 'hybrid',
    display_name: { es: 'Plan Hybrid', en: 'Hybrid Plan', ru: 'Hybrid' },
    price_monthly: 24000,
    sessions_per_month: 4,
    has_group_session: true,
    has_dual_teacher: false,
    stripe_price_1m: 'price_1m',
    stripe_price_3m: 'price_3m',
    stripe_price_6m: 'price_6m',
};

function renderPricingSection(packages = [hybridPackage], props: Partial<PricingSectionProps> = {}) {
    return render(
        <>
            <div id="contacto" />
            <PricingSection
                packages={packages}
                lang="es"
                isLoggedIn={false}
                checkoutMode="application"
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
        expect(screen.getByRole('link', { name: translations.modal.contact })).toHaveAttribute('href', '/es#contacto');
    });

    it('renders the package fallback when its key has no translation', () => {
        const packageWithoutTranslation = {
            ...hybridPackage,
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
        expect(screen.getByTestId('select-plan-without-translation')).toHaveAttribute(
            'href',
            '/es?preferredPackage=without-translation&preferredPackageLabel=Plan%20sin%20traducci%C3%B3n#contacto',
        );
    });

    it('keeps application CTAs usable as links and dispatches preferred package context after hydration', () => {
        const preferredEvents: unknown[] = [];
        window.addEventListener('eh:preferred-package-selected', (event) => {
            preferredEvents.push((event as CustomEvent).detail);
        });

        renderPricingSection();

        const selectPlan = screen.getByTestId('select-plan-hybrid');
        expect(selectPlan).toHaveAttribute('href', '/es?preferredPackage=hybrid&preferredPackageLabel=Plan%20Hybrid#contacto');

        fireEvent.click(selectPlan);

        expect(JSON.parse(window.sessionStorage.getItem('eh_preferred_package') || '{}')).toEqual({
            preferredPackage: 'hybrid',
            preferredPackageLabel: 'Plan Hybrid',
        });
        expect(preferredEvents).toEqual([{
            preferredPackage: 'hybrid',
            preferredPackageLabel: 'Plan Hybrid',
        }]);
        expect(window.location.hash).toBe('#contacto');
    });

    it('opens the checkout modal when direct checkout is enabled and Stripe prices are ready', () => {
        renderPricingSection([hybridPackage], {
            checkoutMode: 'checkout',
            isLoggedIn: true,
        });

        fireEvent.click(screen.getByTestId('select-plan-hybrid'));

        expect(screen.getByRole('dialog', { name: 'Plan Hybrid' })).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('button', { name: translations.modal.continue })).toBeInTheDocument();
    });
});
