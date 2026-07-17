import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CrmOpportunityList from '../../src/components/admin/CrmOpportunityList';

const opportunity = {
    id: '20000000-0000-4000-8000-000000000001',
    stage: 'new',
    interest: 'general',
    current_level: 'b1',
    learning_goal: 'Work meetings',
    availability: 'Mornings',
    packages: {
        name: 'intensive',
        display_name: { es: 'Intensivo', en: 'Intensive' },
    },
};

const secondOpportunity = {
    id: '20000000-0000-4000-8000-000000000002',
    stage: 'proposal',
    interest: null,
    current_level: null,
    learning_goal: null,
    availability: null,
    packages: {
        name: 'standard',
        display_name: null,
    },
};

// Component coverage for src/components/admin/CrmOpportunityList.tsx.
describe('CrmOpportunityList', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ opportunity }),
        }));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('renders opportunity context and updates the CRM stage from the selector', async () => {
        render(<CrmOpportunityList opportunities={[opportunity]} lang="es" />);

        expect(screen.getAllByText('Nueva')).toHaveLength(2);
        expect(screen.getByText('Pospuesta')).toBeInTheDocument();
        expect(screen.getByText('Plan: Intensivo')).toBeInTheDocument();
        expect(screen.getByText('Work meetings')).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Etapa CRM'), {
            target: { value: 'nurture' },
        });
        await act(async () => {});

        expect(fetch).toHaveBeenCalledTimes(1);
        const [, request] = vi.mocked(fetch).mock.calls[0];
        expect(request).toMatchObject({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        expect(JSON.parse(request?.body as string)).toEqual({
            action: 'update_opportunity_stage',
            opportunityId: opportunity.id,
            newStage: 'nurture',
        });
        expect(screen.getByRole('status')).toHaveTextContent('Etapa actualizada.');
    });

    it('keeps a clear empty state', () => {
        render(<CrmOpportunityList opportunities={[]} emptyText="Sin pipeline." />);

        expect(screen.getByText('Sin pipeline.')).toBeInTheDocument();
    });

    it('falls back to the package name when localized display names are missing', () => {
        render(<CrmOpportunityList opportunities={[secondOpportunity]} lang="ru" />);

        expect(screen.getAllByText('Propuesta')).toHaveLength(2);
        expect(screen.getByText('Sin interes declarado')).toBeInTheDocument();
        expect(screen.getByText('Plan: standard')).toBeInTheDocument();
    });

    it('disables every stage selector while one opportunity is being updated', () => {
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => undefined)));
        render(<CrmOpportunityList opportunities={[opportunity, secondOpportunity]} lang="es" />);

        const selectors = screen.getAllByLabelText('Etapa CRM');
        expect(selectors).toHaveLength(2);
        expect(selectors[0]).not.toBeDisabled();
        expect(selectors[1]).not.toBeDisabled();

        fireEvent.change(selectors[0], {
            target: { value: 'qualified' },
        });

        expect(selectors[0]).toBeDisabled();
        expect(selectors[0]).toHaveAttribute('aria-busy', 'true');
        expect(selectors[1]).toBeDisabled();
        expect(selectors[1]).toHaveAttribute('aria-busy', 'false');
    });

    it('announces API failures as alerts and re-enables stage controls', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            json: vi.fn().mockResolvedValue({ error: 'Could not update CRM opportunity' }),
        }));
        render(<CrmOpportunityList opportunities={[opportunity]} lang="es" />);

        fireEvent.change(screen.getByLabelText('Etapa CRM'), {
            target: { value: 'lost' },
        });
        await act(async () => {});

        expect(screen.getByRole('alert')).toHaveTextContent('Could not update CRM opportunity');
        expect(screen.getByLabelText('Etapa CRM')).not.toBeDisabled();
    });
});
