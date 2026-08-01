import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProfitabilityManager from '../../src/components/admin/ProfitabilityManager';
import { eurosToCents } from '../../src/lib/money-input';

const campaignId = '70000000-0000-4000-8000-000000000010';
const studentId = '70000000-0000-4000-8000-000000000011';
const activeStudentId = '70000000-0000-4000-8000-000000000015';

const baseResponse = {
    summary: {
        totalGrossCollectedCents: 0,
        totalRefundsCents: 0,
        totalNetRevenueCents: 0,
        totalTeacherObligationCents: 0,
        totalDirectCostCents: 0,
        totalAcquisitionAllocatedCents: 0,
        totalProvisionalContributionCents: -20000,
        totalCampaignSpendCents: 20000,
        totalUnallocatedCampaignSpendCents: 20000,
    },
    campaigns: [{
        id: campaignId,
        name: 'Piloto Google',
        provider: 'Google Ads',
        attributionMode: 'observed_utm',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'pilot',
        netSpendCents: 20000,
        allocatedAcquisitionCents: 0,
        unallocatedAcquisitionCents: 20000,
        studentCount: 0,
        netCollectedCents: 0,
        teacherObligationCents: 0,
        directCostCents: 0,
        provisionalContributionCents: -20000,
    }, {
        id: '70000000-0000-4000-8000-000000000020',
        name: 'Otra UTM',
        provider: 'Google Ads',
        attributionMode: 'observed_utm',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'pilot',
        utmTerm: 'different-term',
        netSpendCents: 0,
        studentCount: 0,
        provisionalContributionCents: 0,
    }, {
        id: '70000000-0000-4000-8000-000000000021',
        name: 'Campaña manual',
        provider: 'Boca a boca',
        attributionMode: 'manual',
        netSpendCents: 0,
        studentCount: 0,
        provisionalContributionCents: 0,
    }],
    students: [],
    costs: [],
    allocations: [],
    candidates: [{
        studentId,
        studentName: 'Ana Alumna',
        studentEmail: 'ana@example.test',
        firstSubscriptionId: '70000000-0000-4000-8000-000000000012',
        firstCycleId: '70000000-0000-4000-8000-000000000013',
        attributionEventId: '70000000-0000-4000-8000-000000000014',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'pilot',
        hasActiveAllocation: false,
    }, {
        studentId: activeStudentId,
        studentName: 'Beatriz Asignada',
        studentEmail: 'beatriz@example.test',
        firstSubscriptionId: '70000000-0000-4000-8000-000000000016',
        firstCycleId: '70000000-0000-4000-8000-000000000017',
        attributionEventId: '70000000-0000-4000-8000-000000000018',
        utmSource: 'google',
        utmMedium: 'cpc',
        utmCampaign: 'pilot',
        hasActiveAllocation: true,
    }],
    pagination: { page: 0, limit: 25, studentsHasMore: false, costsHasMore: false, allocationsHasMore: false },
};

function response(payload: unknown, ok = true): Response {
    return { ok, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

function postBodies() {
    return vi.mocked(fetch).mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => JSON.parse(init?.body as string));
}

describe('ProfitabilityManager', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => init?.method === 'POST'
            ? response({ result: { id: 'result-1' } })
            : response(baseResponse)));
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('70000000-0000-4000-8000-000000000001');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('converts decimal euro strings to cents without floating-point arithmetic', () => {
        expect(eurosToCents('0.29')).toBe(29);
        expect(eurosToCents('200,01')).toBe(20001);
        expect(eurosToCents('-10,25', true)).toBe(-1025);
        expect(eurosToCents('1.001')).toBeNull();
    });

    it('shows a campaign without sales as negative and leaves CAC unavailable', async () => {
        render(<ProfitabilityManager lang="es" />);

        expect(await screen.findByRole('heading', { name: 'Campañas' })).toBeInTheDocument();
        const campaignTable = screen.getByRole('table', { name: 'Gasto, asignación e ingresos por campaña' });
        const campaignRow = within(campaignTable).getByText(/Piloto Google/).closest('tr');
        expect(campaignRow).toHaveTextContent('-200,00');
        expect(campaignRow).toHaveTextContent('N/A');
        expect(screen.getByText('La asignación es manual y explícita. Nunca se reparte automáticamente el gasto entre alumnos.')).toBeInTheDocument();
    });

    it('creates an observed campaign with its exact UTM identity', async () => {
        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Campaña mudanza' } });
        fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Google Ads' } });
        fireEvent.change(screen.getByLabelText('utm_source'), { target: { value: 'google' } });
        fireEvent.change(screen.getByLabelText('utm_medium'), { target: { value: 'cpc' } });
        fireEvent.change(screen.getByLabelText('utm_campaign'), { target: { value: 'move_to_spain' } });
        fireEvent.click(screen.getByRole('button', { name: 'Crear campaña' }));

        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toEqual({
            action: 'create_campaign',
            requestId: '70000000-0000-4000-8000-000000000001',
            name: 'Campaña mudanza',
            provider: 'Google Ads',
            externalReference: null,
            attributionMode: 'observed_utm',
            utmSource: 'google',
            utmMedium: 'cpc',
            utmCampaign: 'move_to_spain',
            utmTerm: null,
            utmContent: null,
        });
    });

    it('reuses the same request id after a lost response and preserves the form until success', async () => {
        let postAttempt = 0;
        vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
            if (init?.method !== 'POST') return response(baseResponse);
            postAttempt += 1;
            if (postAttempt === 1) throw new Error('Respuesta perdida');
            return response({ result: { id: 'campaign-1' } });
        }));
        const randomId = vi.mocked(globalThis.crypto.randomUUID);
        randomId.mockReset();
        randomId
            .mockReturnValueOnce('70000000-0000-4000-8000-000000000030')
            .mockReturnValue('70000000-0000-4000-8000-000000000031');

        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        const name = screen.getByLabelText('Nombre');
        fireEvent.change(name, { target: { value: 'Campaña reintentable' } });
        fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Google Ads' } });
        fireEvent.change(screen.getByLabelText('utm_source'), { target: { value: 'google' } });
        fireEvent.change(screen.getByLabelText('utm_medium'), { target: { value: 'cpc' } });
        fireEvent.change(screen.getByLabelText('utm_campaign'), { target: { value: 'retry_campaign' } });

        fireEvent.click(screen.getByRole('button', { name: 'Crear campaña' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Respuesta perdida');
        expect(name).toHaveValue('Campaña reintentable');

        fireEvent.click(screen.getByRole('button', { name: 'Crear campaña' }));
        expect(await screen.findByText('Campaña creada')).toHaveAttribute('role', 'status');

        const bodies = postBodies();
        expect(bodies).toHaveLength(2);
        expect(bodies[0].requestId).toBe('70000000-0000-4000-8000-000000000030');
        expect(bodies[1].requestId).toBe(bodies[0].requestId);
        expect(randomId).toHaveBeenCalledTimes(1);
        expect(name).toHaveValue('');
    });

    it('records campaign spend without creating an automatic student allocation', async () => {
        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        fireEvent.change(screen.getByLabelText('Campaña', { selector: 'select' }), { target: { value: campaignId } });
        fireEvent.change(screen.getAllByLabelText('Importe EUR', { selector: 'input' })[0], { target: { value: '200,00' } });
        fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: 'Primer gasto publicitario' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar coste' }));

        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toMatchObject({
            action: 'record_cost',
            requestId: '70000000-0000-4000-8000-000000000001',
            costKind: 'acquisition_spend',
            campaignId,
            studentId: null,
            amountCents: 20000,
            description: 'Primer gasto publicitario',
        });
        expect(postBodies()[0]).not.toHaveProperty('firstCycleId');
        expect(postBodies().some((body) => body.action === 'record_allocation')).toBe(false);
    });

    it('requires and posts an explicit allocation amount for a paid candidate', async () => {
        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        fireEvent.change(screen.getByLabelText('Candidato pagado'), { target: { value: studentId } });
        fireEvent.change(screen.getByLabelText('Campaña compatible'), { target: { value: campaignId } });
        const amountInputs = screen.getAllByLabelText('Importe EUR', { selector: 'input' });
        fireEvent.change(amountInputs[1], { target: { value: '40,00' } });
        fireEvent.change(screen.getAllByLabelText('Motivo')[0], { target: { value: 'Asignación revisada del checkout' } });
        fireEvent.click(screen.getByRole('button', { name: 'Registrar asignación explícita' }));

        await waitFor(() => expect(postBodies()).toHaveLength(1));
        expect(postBodies()[0]).toMatchObject({
            action: 'record_allocation',
            campaignId,
            studentId,
            checkoutAttributionEventId: '70000000-0000-4000-8000-000000000014',
            basis: 'observed_checkout',
            amountCents: 4000,
        });
        expect(postBodies()[0]).not.toHaveProperty('firstCycleId');
    });

    it('keeps all candidates for direct costs but excludes active allocations from the new-allocation selector', async () => {
        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        fireEvent.change(screen.getByLabelText('Tipo de coste'), { target: { value: 'delivery_material' } });
        const directCostStudent = screen.getByLabelText('Alumno');
        expect(within(directCostStudent).getByRole('option', { name: 'Ana Alumna' })).toBeInTheDocument();
        expect(within(directCostStudent).getByRole('option', { name: 'Beatriz Asignada' })).toBeInTheDocument();

        const allocationStudent = screen.getByLabelText('Candidato pagado');
        expect(within(allocationStudent).getByRole('option', { name: 'Ana Alumna' })).toBeInTheDocument();
        expect(within(allocationStudent).queryByRole('option', { name: 'Beatriz Asignada' })).not.toBeInTheDocument();
    });

    it('requires exact five-field UTM matching for observed allocation but allows any campaign for manual allocation', async () => {
        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        fireEvent.change(screen.getByLabelText('Candidato pagado'), { target: { value: studentId } });
        const campaignSelect = screen.getByLabelText('Campaña compatible');
        await waitFor(() => expect(within(campaignSelect).getByRole('option', { name: /Piloto Google/ })).toBeInTheDocument());
        expect(within(campaignSelect).queryByRole('option', { name: /Otra UTM/ })).not.toBeInTheDocument();
        expect(within(campaignSelect).queryByRole('option', { name: /Campaña manual/ })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Base'), { target: { value: 'manual' } });
        await waitFor(() => {
            expect(within(campaignSelect).getByRole('option', { name: /Piloto Google/ })).toBeInTheDocument();
            expect(within(campaignSelect).getByRole('option', { name: /Otra UTM/ })).toBeInTheDocument();
            expect(within(campaignSelect).getByRole('option', { name: /Campaña manual/ })).toBeInTheDocument();
        });
    });

    it('uses the same campaign text limits as the database contract', async () => {
        render(<ProfitabilityManager lang="es" />);
        await screen.findByRole('heading', { name: 'Campañas' });

        expect(screen.getByLabelText('Nombre')).toHaveAttribute('maxlength', '200');
        expect(screen.getByLabelText('Proveedor')).toHaveAttribute('maxlength', '100');
        expect(screen.getByLabelText('Referencia externa opcional')).toHaveAttribute('maxlength', '200');
        expect(screen.getByLabelText('utm_source')).toHaveAttribute('maxlength', '100');
        expect(screen.getByLabelText('utm_source')).toHaveAttribute('pattern', '[A-Za-z0-9._~-]+');
        expect(screen.getByLabelText('utm_medium')).toHaveAttribute('maxlength', '100');
        expect(screen.getByLabelText('utm_campaign')).toHaveAttribute('maxlength', '100');
        expect(screen.getByLabelText('utm_term opcional')).toHaveAttribute('maxlength', '100');
        expect(screen.getByLabelText('utm_content opcional')).toHaveAttribute('maxlength', '100');
    });
});
