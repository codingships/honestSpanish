import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import VersionedCatalogManager from '../../src/components/admin/VersionedCatalogManager';

function response(payload: unknown): Response {
    return {
        ok: true,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

const draft = {
    id: '22222222-2222-4222-8222-222222222222',
    package_id: '11111111-1111-4111-8111-111111111111',
    package_key: 'individual_4x50_28d',
    base_catalog_version: 1,
    revision: 1,
    status: 'draft',
    display_name: { es: '4 clases individuales', en: '4 individual classes', ru: '4 индивидуальных занятия' },
    amount_cents: 25900,
    currency: 'eur',
    billing_interval_unit: 'day',
    billing_interval_count: 28,
    sessions_per_period: 4,
    class_duration_minutes: 50,
    has_group_session: false,
    has_dual_teacher: false,
    is_publicly_listed: true,
    checkout_compatible: true,
    guarantee_schedule: [
        { consumedSessions: 1, consumedAmountCents: 6475, refundableAmountCents: 19425 },
    ],
    updated_at: '2026-08-03T10:00:00Z',
};

const catalog = {
    can_write: true,
    packages: [{
        id: '11111111-1111-4111-8111-111111111111',
        package_key: 'individual_4x50_28d',
        catalog_version: 1,
        display_name: draft.display_name,
        amount_cents: 25900,
        currency: 'eur',
        billing_interval_unit: 'day',
        billing_interval_count: 28,
        sessions_per_period: 4,
        class_duration_minutes: 50,
        has_group_session: false,
        has_dual_teacher: false,
        is_active: false,
        is_publicly_listed: true,
        checkout_compatible: true,
        sellable_now: false,
        stripe_product: null,
        active_price: null,
        draft,
        history: [],
    }],
};

describe('VersionedCatalogManager', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('shows the proportional guarantee and keeps publication behind a saved draft', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(catalog)));
        render(<VersionedCatalogManager />);

        expect(await screen.findByText('Catálogo versionado')).toBeInTheDocument();
        expect(screen.getAllByText('Compatible con checkout actual')).toHaveLength(2);
        const guarantee = screen.getByText('Garantía proporcional por clase');
        fireEvent.click(guarantee);

        const article = screen.getByText('individual_4x50_28d').closest('article');
        if (!article) throw new Error('Missing package article');
        const publish = within(article).getByRole('button', { name: 'Publicar' });
        const save = within(article).getByRole('button', { name: 'Guardar borrador' });
        expect(publish).not.toBeDisabled();
        expect(save).toBeDisabled();

        fireEvent.change(within(article).getByLabelText('Precio por ciclo (EUR)'), {
            target: { value: '299' },
        });
        expect(publish).toBeDisabled();
        expect(save).toBeDisabled();
        expect(within(article).getByText('Checkout pendiente')).toBeInTheDocument();

        const publicListing = within(article).getByLabelText('Mostrar públicamente');
        expect(publicListing).toBeChecked();
        expect(publicListing).not.toBeDisabled();
        fireEvent.click(publicListing);
        expect(save).not.toBeDisabled();
    });

    it('renders read-only capability without exposing mutation controls', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...catalog, can_write: false })));
        render(<VersionedCatalogManager />);

        expect(await screen.findByText(/Vista de solo lectura/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    });
});
