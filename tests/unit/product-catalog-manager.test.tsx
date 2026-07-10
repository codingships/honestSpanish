import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function jsonResponse(payload: unknown, ok = true): Response {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

function mockFetchResponses(...responses: Array<Response | Promise<Response>>) {
    const fetchMock = vi.fn();
    for (const response of responses) {
        if (response instanceof Promise) {
            fetchMock.mockReturnValueOnce(response);
        } else {
            fetchMock.mockResolvedValueOnce(response);
        }
    }
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function deferredResponse() {
    let resolve!: (response: Response) => void;
    const promise = new Promise<Response>((resolver) => {
        resolve = resolver;
    });
    return { promise, resolve };
}

function rowFor(label: string): HTMLElement {
    const row = screen.getByText(label).closest('tr');
    if (!row) throw new Error(`Missing row for ${label}`);
    return row;
}

function lastField(label: string): HTMLElement {
    const fields = screen.getAllByLabelText(label);
    const field = fields.at(-1);
    if (!field) throw new Error(`Missing field ${label}`);
    return field;
}

describe('ProductCatalogManager', () => {
    beforeEach(() => {
        mockFetchResponses(jsonResponse({ packages: packageRows }));
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
        expect(screen.getByText('1 paquete(s) activos no tienen precios Stripe completos')).toHaveAttribute('role', 'status');
    });

    it('distinguishes a synchronized group catalog from an operationally sellable checkout', async () => {
        vi.unstubAllGlobals();
        mockFetchResponses(jsonResponse({
            packages: [
                ...packageRows,
                {
                    ...packageRows[0],
                    id: '10000000-0000-4000-8000-000000000003',
                    name: 'group',
                    display_name: { es: 'Grupal', en: 'Group', ru: 'Group' },
                    has_group_session: true,
                },
            ],
        }));

        render(<ProductCatalogManager />);

        const groupRow = rowFor(await screen.findByText('group').then((node) => node.textContent || 'group'));
        expect(within(groupRow).getByText('Stripe listo · venta bloqueada')).toBeInTheDocument();
        expect(within(groupRow).getByText('Solo solicitud: falta el modelo de sesiones grupales.')).toBeInTheDocument();
        expect(within(groupRow).queryByText('Checkout listo')).not.toBeInTheDocument();

        const hybridRow = rowFor('hybrid');
        expect(within(hybridRow).getByText('Solo solicitud: faltan grupo y alta garantizada con dos profesores.')).toBeInTheDocument();
    });

    it('shows a strict empty state when the catalog has no packages', async () => {
        vi.unstubAllGlobals();
        mockFetchResponses(jsonResponse({ packages: [] }));

        render(<ProductCatalogManager />);

        expect(await screen.findByText('No hay paquetes.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Crear' })).toBeDisabled();
    });

    it('renders load failures as alerts', async () => {
        vi.unstubAllGlobals();
        mockFetchResponses(jsonResponse({ error: 'Could not load packages' }, false));

        render(<ProductCatalogManager />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not load packages');
    });

    it('saves package edits with trimmed localized names and status feedback', async () => {
        const updated = { ...packageRows[0], price_monthly: 15500 };
        vi.unstubAllGlobals();
        mockFetchResponses(
            jsonResponse({ packages: packageRows }),
            jsonResponse({ package: updated }),
        );

        render(<ProductCatalogManager />);
        await screen.findByText('standard');
        const standardRow = rowFor('standard');

        fireEvent.change(within(standardRow).getByLabelText('Nombre es'), { target: { value: ' Estandar Pro ' } });
        fireEvent.change(within(standardRow).getByLabelText('Precio mensual'), { target: { value: '155' } });
        fireEvent.click(within(standardRow).getByRole('button', { name: 'Guardar' }));

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        const [, request] = vi.mocked(fetch).mock.calls[1];
        expect(request).toMatchObject({
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toMatchObject({
            packageId: packageRows[0].id,
            displayName: { es: 'Estandar Pro', en: 'Standard', ru: 'Standard' },
            priceMonthlyEur: 155,
            sessionsPerMonth: 4,
            hasGroupSession: false,
            hasDualTeacher: false,
            isActive: true,
        });
        expect(await screen.findByText('Paquete guardado')).toHaveAttribute('role', 'status');
    });

    it('creates a package only after the draft is valid', async () => {
        const created = {
            ...packageRows[0],
            id: '10000000-0000-4000-8000-000000000003',
            name: 'intensive',
            display_name: { es: 'Intensivo', en: 'Intensive', ru: 'Intensive' },
            price_monthly: 22000,
            sessions_per_month: 8,
            is_active: false,
            checkout_ready: false,
        };
        vi.unstubAllGlobals();
        mockFetchResponses(
            jsonResponse({ packages: packageRows }),
            jsonResponse({ package: created }),
        );

        render(<ProductCatalogManager />);
        await screen.findByText('standard');
        const createButton = screen.getByRole('button', { name: 'Crear' });
        expect(createButton).toBeDisabled();

        fireEvent.change(lastField('Clave'), { target: { value: ' intensive ' } });
        fireEvent.change(lastField('Nombre es'), { target: { value: ' Intensivo ' } });
        fireEvent.change(lastField('Nombre en'), { target: { value: ' Intensive ' } });
        fireEvent.change(lastField('Nombre ru'), { target: { value: ' Intensive ' } });
        fireEvent.change(lastField('Precio mensual'), { target: { value: '220' } });
        fireEvent.change(lastField('Clases al mes'), { target: { value: '8' } });

        expect(createButton).not.toBeDisabled();
        fireEvent.click(createButton);

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        const [, request] = vi.mocked(fetch).mock.calls[1];
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'create_package',
            name: 'intensive',
            displayName: { es: 'Intensivo', en: 'Intensive', ru: 'Intensive' },
            priceMonthlyEur: 220,
            sessionsPerMonth: 8,
            hasGroupSession: false,
            hasDualTeacher: false,
            isActive: false,
        });
        expect(await screen.findByText('Paquete creado')).toHaveAttribute('role', 'status');
    });

    it('blocks overlapping catalog mutations while Stripe sync is pending', async () => {
        const sync = deferredResponse();
        vi.unstubAllGlobals();
        mockFetchResponses(
            jsonResponse({ packages: packageRows }),
            sync.promise,
        );

        render(<ProductCatalogManager />);
        await screen.findByText('standard');
        const standardRow = rowFor('standard');
        const hybridRow = rowFor('hybrid');
        const stripeButton = within(standardRow).getByRole('button', { name: 'Stripe' });

        fireEvent.click(stripeButton);

        expect(stripeButton).toHaveAttribute('aria-busy', 'true');
        expect(within(hybridRow).getByRole('button', { name: 'Guardar' })).toBeDisabled();
        expect(within(hybridRow).getByLabelText('Precio mensual')).toBeDisabled();

        await act(async () => {
            sync.resolve(jsonResponse({ package: packageRows[0] }));
        });

        expect(await screen.findByText('Stripe sincronizado')).toHaveAttribute('role', 'status');
    });
});
