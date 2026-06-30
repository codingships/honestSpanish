import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('CrmOpportunityList', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ opportunity }),
        }));
    });

    afterEach(() => {
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

        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
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
    });

    it('keeps a clear empty state', () => {
        render(<CrmOpportunityList opportunities={[]} emptyText="Sin pipeline." />);

        expect(screen.getByText('Sin pipeline.')).toBeInTheDocument();
    });
});
