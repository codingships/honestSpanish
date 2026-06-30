import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProductCatalogManager from '../../src/components/admin/ProductCatalogManager';

const packageRows = [
    {
        id: '10000000-0000-4000-8000-000000000001',
        name: 'standard',
        display_name: { es: 'Estandar', en: 'Standard', ru: 'Standard' },
        price_monthly: 14500,
        sessions_per_month: 4,
        has_group_session: false,
        has_dual_teacher: false,
        stripe_product_id: 'prod_standard',
        stripe_price_1m: 'price_standard_1m',
        stripe_price_3m: 'price_standard_3m',
        stripe_price_6m: 'price_standard_6m',
        is_active: true,
        checkout_ready: true,
    },
    {
        id: '10000000-0000-4000-8000-000000000002',
        name: 'hybrid',
        display_name: { es: 'Hibrido', en: 'Hybrid', ru: 'Hybrid' },
        price_monthly: 15000,
        sessions_per_month: 4,
        has_group_session: true,
        has_dual_teacher: true,
        stripe_product_id: 'prod_hybrid',
        stripe_price_1m: 'price_hybrid_1m',
        stripe_price_3m: null,
        stripe_price_6m: null,
        is_active: true,
        checkout_ready: false,
    },
];

describe('ProductCatalogManager', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ packages: packageRows }),
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows checkout readiness and missing Stripe durations for active packages', async () => {
        render(<ProductCatalogManager />);

        expect(await screen.findByText('standard')).toBeInTheDocument();
        expect(screen.getByText('hybrid')).toBeInTheDocument();
        expect(screen.getByText('Checkout listo')).toBeInTheDocument();
        expect(screen.getByText('Activo sin checkout')).toBeInTheDocument();
        expect(screen.getByText('1 paquete(s) activos no tienen precios Stripe completos')).toBeInTheDocument();
        expect(screen.getByText('Faltan precios: 3m, 6m')).toBeInTheDocument();
        expect(screen.getByText('price_standa...d_1m')).toBeInTheDocument();
    });
});
