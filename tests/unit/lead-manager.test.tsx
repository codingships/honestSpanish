import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LeadManager from '../../src/components/admin/LeadManager';

const checkoutPackage = {
    id: '70000000-0000-4000-8000-000000000001',
    name: 'standard',
    display_name: { es: 'Estandar', en: 'Standard', ru: 'Standard' },
};

const lead = {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Ana Alumna',
    email: 'ana@example.com',
    interest: 'general',
    current_level: 'b1',
    learning_goal: 'Work meetings',
    availability: 'Mornings',
    preferred_package: 'Intensivo',
    source_path: '/es',
    lang: 'es',
    spoken_languages: ['en'],
    is_russian_speaker: false,
    level_check_status: 'recommended',
    level_check_summary: null,
    level_check_estimated_level: null,
    level_check_confidence: null,
    level_check_plan_recommendation: null,
    level_check_fit_flags: null,
    level_check_received_at: null,
    level_check_reviewed_at: null,
    level_check_raw_cleared_at: null,
    consent_given: true,
    ip_address: null,
    created_at: '2026-06-20T10:00:00.000Z',
    status: 'new',
    crm_opportunity: {
        id: '50000000-0000-4000-8000-000000000001',
        contact_id: '60000000-0000-4000-8000-000000000001',
        stage: 'new',
        opened_at: '2026-06-20T10:00:00.000Z',
        closed_at: null,
        current_level: null,
        learning_goal: null,
        availability: null,
        preferred_package_id: checkoutPackage.id,
        checkout_approved_at: null,
        converted_subscription_id: null,
        packages: checkoutPackage,
        crm_contacts: {
            id: '60000000-0000-4000-8000-000000000001',
            lifecycle_stage: 'lead',
            next_follow_up_at: null,
            last_contacted_at: null,
        },
    },
};

function jsonResponse(payload: unknown, ok = true) {
    return {
        ok,
        json: vi.fn().mockResolvedValue(payload),
    } as unknown as Response;
}

function requestBody(index = 1) {
    const [, request] = vi.mocked(fetch).mock.calls[index];
    return JSON.parse(request?.body as string);
}

async function flushAction() {
    await act(async () => {});
}

// Component coverage for src/components/admin/LeadManager.tsx.
describe('LeadManager', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn((input, init) => {
            if (init && typeof init === 'object' && init.method === 'PUT') {
                return Promise.resolve(jsonResponse({ lead: { ...lead, status: 'contacted' } }));
            }

            return Promise.resolve(jsonResponse({ leads: [lead], checkoutPackages: [checkoutPackage] }));
        }));
        vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('loads leads through the admin API with an abort signal', async () => {
        render(<LeadManager lang="es" />);

        expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledWith(
            '/api/admin/leads?status=new&limit=100',
            expect.objectContaining({ signal: expect.any(Object) }),
        );
        expect(screen.getByText('Mostrando: 1')).toBeInTheDocument();
    });

    it('updates lead status and reports success semantically', async () => {
        render(<LeadManager lang="es" />);
        await screen.findByText('ana@example.com');

        fireEvent.click(screen.getByRole('button', { name: 'Marcar contactada' }));
        await flushAction();

        expect(requestBody()).toEqual({
            leadId: lead.id,
            newStatus: 'contacted',
        });
        expect(screen.getByRole('status')).toHaveTextContent('Estado actualizado.');
        expect(screen.getByText('No hay solicitudes en este estado.')).toBeInTheDocument();
    });

    it('sends level checks and updates CRM stages from labelled controls', async () => {
        vi.mocked(fetch).mockImplementation((input, init) => {
            if (init && typeof init === 'object' && init.method === 'PUT') {
                const body = JSON.parse(init.body as string);
                if (body.action === 'opportunity_stage') {
                    return Promise.resolve(jsonResponse({
                        opportunity: {
                            ...lead.crm_opportunity,
                            stage: body.newStage,
                        },
                    }));
                }
                return Promise.resolve(jsonResponse({
                    lead: {
                        ...lead,
                        level_check_status: 'sent',
                    },
                }));
            }

            return Promise.resolve(jsonResponse({ leads: [lead] }));
        });
        render(<LeadManager lang="es" />);
        await screen.findByText('ana@example.com');

        fireEvent.click(screen.getByRole('button', { name: 'Enviar diagnostico' }));
        await flushAction();
        expect(requestBody()).toEqual({
            action: 'send_level_check',
            leadId: lead.id,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Diagnostico enviado.');

        vi.mocked(fetch).mockClear();
        fireEvent.change(screen.getByLabelText('Etapa CRM'), {
            target: { value: 'qualified' },
        });
        await flushAction();
        expect(requestBody(0)).toEqual({
            action: 'opportunity_stage',
            opportunityId: lead.crm_opportunity.id,
            newStage: 'qualified',
        });
        expect(screen.getByRole('status')).toHaveTextContent('Etapa CRM actualizada.');
    });

    it('approves and revokes checkout for the package selected by an admin', async () => {
        vi.mocked(fetch).mockImplementation((input, init) => {
            if (init && typeof init === 'object' && init.method === 'PUT') {
                const body = JSON.parse(init.body as string);
                if (body.action === 'checkout_approval') {
                    return Promise.resolve(jsonResponse({
                        opportunity: {
                            ...lead.crm_opportunity,
                            stage: 'proposal',
                            preferred_package_id: body.packageId,
                            checkout_approved_at: body.approved ? '2026-07-10T20:00:00.000Z' : null,
                        },
                    }));
                }
            }

            return Promise.resolve(jsonResponse({ leads: [lead], checkoutPackages: [checkoutPackage] }));
        });
        render(<LeadManager lang="es" />);
        await screen.findByText('ana@example.com');

        expect(screen.getByLabelText('Paquete autorizado para ana@example.com')).toHaveValue(checkoutPackage.id);
        fireEvent.click(screen.getByRole('button', { name: 'Aprobar pago' }));
        await flushAction();

        expect(requestBody()).toEqual({
            action: 'checkout_approval',
            opportunityId: lead.crm_opportunity.id,
            packageId: checkoutPackage.id,
            approved: true,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Pago aprobado para el paquete seleccionado.');
        expect(screen.getByText('Aprobada')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Revocar pago' }));
        await flushAction();

        expect(requestBody(2)).toEqual({
            action: 'checkout_approval',
            opportunityId: lead.crm_opportunity.id,
            packageId: checkoutPackage.id,
            approved: false,
        });
        expect(screen.getByRole('status')).toHaveTextContent('Aprobacion de pago revocada.');
        expect(screen.getByText('No aprobada')).toBeInTheDocument();
    });

    it('announces action failures as alerts without using window alert', async () => {
        vi.mocked(fetch).mockImplementation((input, init) => {
            if (init && typeof init === 'object' && init.method === 'PUT') {
                return Promise.resolve(jsonResponse({ error: 'Could not update lead' }, false));
            }

            return Promise.resolve(jsonResponse({ leads: [lead] }));
        });
        render(<LeadManager lang="es" />);
        await screen.findByText('ana@example.com');

        fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
        await flushAction();

        expect(screen.getByRole('alert')).toHaveTextContent('Could not update lead');
        expect(window.alert).not.toHaveBeenCalled();
    });

    it('disables lead actions and filters while one mutation is pending', async () => {
        vi.mocked(fetch).mockImplementation((input, init) => {
            if (init && typeof init === 'object' && init.method === 'PUT') {
                return new Promise(() => undefined);
            }

            return Promise.resolve(jsonResponse({ leads: [lead] }));
        });
        render(<LeadManager lang="es" />);
        await screen.findByText('ana@example.com');

        fireEvent.click(screen.getByRole('button', { name: 'Marcar contactada' }));

        expect(screen.getByRole('button', { name: 'Marcar contactada' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Marcar contactada' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Enviar diagnostico' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Pedir info' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Enviar propuesta' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Aprobar pago' })).toBeDisabled();
        expect(screen.getByLabelText('Estado')).toBeDisabled();
        expect(screen.getByLabelText('Etapa CRM')).toBeDisabled();
        expect(screen.getByLabelText('Paquete autorizado para ana@example.com')).toBeDisabled();
    });
});
