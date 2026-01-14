import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import PricingModal from '../../src/components/PricingModal';

const mockPlan = {
    name: 'basic',
    displayName: 'Básico',
    priceMonthly: 160,
    stripe_price_1m: 'price_basic_1m',
    stripe_price_3m: 'price_basic_3m',
    stripe_price_6m: 'price_basic_6m',
};

const mockTranslations = {
    title: 'Selecciona duración',
    duration1: '1 mes',
    duration3: '3 meses',
    duration6: '6 meses',
    save: 'Ahorra',
    total: 'Total',
    perMonth: 'por mes',
    continue: 'Continuar',
    login: 'Iniciar sesión',
    loading: 'Cargando...',
    error: 'Error al procesar',
    close: 'Cerrar',
};

describe('PricingModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock fetch
        global.fetch = vi.fn();
    });

    it('should not render when isOpen is false', () => {
        render(
            <PricingModal
                isOpen={false}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={false}
                translations={mockTranslations}
            />
        );

        expect(screen.queryByText('Básico')).not.toBeInTheDocument();
    });

    it('should render when isOpen is true', () => {
        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={false}
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('Básico')).toBeInTheDocument();
        expect(screen.getByText('1 mes')).toBeInTheDocument();
        expect(screen.getByText('3 meses')).toBeInTheDocument();
        expect(screen.getByText('6 meses')).toBeInTheDocument();
    });

    it('should display prices correctly', () => {
        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );

        // Check that multiple price elements exist (using getAllByText)
        const priceElements = screen.getAllByText(/160/);
        expect(priceElements.length).toBeGreaterThan(0);
    });

    it('should update total when selecting 3 months', () => {
        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );

        // Click on 3 months radio button by its value
        const threeMonthRadio = screen.getByRole('radio', { name: /3 meses/i });
        fireEvent.click(threeMonthRadio);

        // 3 months with 10% discount: 160 * 3 * 0.9 = 432€
        const priceElements = screen.getAllByText(/432/);
        expect(priceElements.length).toBeGreaterThan(0);
    });

    it('should show login button when not logged in', () => {
        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={false}
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('Iniciar sesión')).toBeInTheDocument();
    });

    it('should show continue button when logged in', () => {
        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );

        expect(screen.getByText('Continuar')).toBeInTheDocument();
    });

    it('should call onClose when clicking overlay', () => {
        const onClose = vi.fn();
        render(
            <PricingModal
                isOpen={true}
                onClose={onClose}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );

        // Click on close button
        const closeButton = screen.getByLabelText('Cerrar');
        fireEvent.click(closeButton);

        expect(onClose).toHaveBeenCalled();
    });

    it('should make API call when clicking continue', async () => {
        vi.mocked(global.fetch).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ url: 'https://checkout.stripe.com/session' }),
        } as Response);

        // Mock window.location
        const originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            value: { href: '' },
            writable: true,
        });

        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );

        const continueButton = screen.getByText('Continuar');
        fireEvent.click(continueButton);

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith('/api/create-checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priceId: 'price_basic_1m', lang: 'es' }),
            });
        });

        // Restore window.location
        Object.defineProperty(window, 'location', {
            value: originalLocation,
            writable: true,
        });
    });

    it('should show discount savings for multi-month plans', () => {
        render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );

        // Check savings are displayed (using regex for flexibility)
        expect(screen.getByText(/Ahorra.*192/)).toBeInTheDocument();
    });

    it('matches snapshot', () => {
        const { asFragment } = render(
            <PricingModal
                isOpen={true}
                onClose={() => { }}
                plan={mockPlan}
                lang="es"
                isLoggedIn={true}
                translations={mockTranslations}
            />
        );
        expect(asFragment()).toMatchSnapshot();
    });
});
